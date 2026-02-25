/**
 * openclaw-costs — LLM cost tracking hook for OpenClaw
 *
 * Patches globalThis.fetch to intercept Anthropic API calls.
 * Logs token usage to a JSONL file inside ~/.openclaw/cost-tracker/.
 *
 * Usage:
 *   NODE_OPTIONS="--import /path/to/cost-hook.mjs" openclaw gateway ...
 */

import { writeFileSync, mkdirSync, existsSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// --- Config ---
const DATA_DIR = join(process.env.HOME || homedir(), '.openclaw', 'cost-tracker');
const LOG_FILE = join(DATA_DIR, 'calls.jsonl');
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB, then rotate
const ANTHROPIC_HOST = 'api.anthropic.com';
const MESSAGES_PATH = '/v1/messages';

// --- Pricing (USD per million tokens) ---
const PRICING = {
  'claude-sonnet-4-5-20250929':  { in: 3.0,  out: 15.0, cache_read: 0.30, cache_write: 3.75 },
  'claude-sonnet-4-20250514':    { in: 3.0,  out: 15.0, cache_read: 0.30, cache_write: 3.75 },
  'claude-opus-4-20250514':      { in: 15.0, out: 75.0, cache_read: 1.50, cache_write: 18.75 },
  'claude-haiku-4-5-20251001':   { in: 0.80, out: 4.0,  cache_read: 0.08, cache_write: 1.0 },
};
const DEFAULT_PRICING = { in: 3.0, out: 15.0, cache_read: 0.30, cache_write: 3.75 };

// --- Init ---
try { mkdirSync(DATA_DIR, { recursive: true }); } catch {}

function rotateIfNeeded() {
  try {
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > MAX_FILE_SIZE) {
      renameSync(LOG_FILE, LOG_FILE + '.old');
    }
  } catch {}
}

function appendLog(entry) {
  try {
    rotateIfNeeded();
    writeFileSync(LOG_FILE, JSON.stringify(entry) + '\n', { flag: 'a' });
  } catch {}
}

function estimateCost(model, inTok, outTok, cacheRead, cacheWrite) {
  const p = PRICING[model] || DEFAULT_PRICING;
  return (
    inTok * p.in / 1e6 +
    outTok * p.out / 1e6 +
    cacheRead * p.cache_read / 1e6 +
    cacheWrite * p.cache_write / 1e6
  );
}

// --- Context extraction ---

/** Extract cron name or session context from the request body. */
function extractContext(body) {
  // 1. Check metadata.user_id (some OpenClaw versions set this)
  const userId = body?.metadata?.user_id;
  if (userId && typeof userId === 'string') return userId;

  // 2. Parse first user message for [cron:UUID NAME] pattern
  const messages = body?.messages || [];
  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    const text = typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.find(b => b?.type === 'text')?.text || ''
        : '';
    if (!text) continue;

    // OpenClaw cron format: [cron:UUID Name] ...
    const cronMatch = text.match(/^\[cron:[a-f0-9-]+ ([^\]]+)\]/i);
    if (cronMatch) return `cron:${cronMatch[1].trim()}`;

    // Compaction marker
    if (text.startsWith('The conversation history before this point was compacted'))
      return 'compaction';

    // Return first 100 chars as fallback
    return text.slice(0, 100);
  }

  // 3. Check system prompt
  const sys = body?.system;
  if (typeof sys === 'string' && sys.length > 0) return `system:${sys.slice(0, 80)}`;

  return 'unknown';
}

/** Extract short preview of the first user message. */
function extractPreview(body) {
  const messages = body?.messages || [];
  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    const text = typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.find(b => b?.type === 'text')?.text || ''
        : '';
    if (text) return text.slice(0, 200);
  }
  return '';
}

// --- SSE parsing for streaming responses ---
function parseSSEUsage(text) {
  let inputTokens = 0, outputTokens = 0, cacheRead = 0, cacheWrite = 0;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) continue;
    const data = trimmed.slice(6);
    if (data === '[DONE]') continue;
    try {
      const obj = JSON.parse(data);
      if (obj.type === 'message_start') {
        const u = obj.message?.usage || {};
        inputTokens = u.input_tokens || 0;
        cacheRead = u.cache_read_input_tokens || 0;
        cacheWrite = u.cache_creation_input_tokens || 0;
      } else if (obj.type === 'message_delta') {
        outputTokens = (obj.usage || {}).output_tokens || 0;
      }
    } catch {}
  }
  return { inputTokens, outputTokens, cacheRead, cacheWrite };
}

// --- Fetch patch ---
const originalFetch = globalThis.fetch;

globalThis.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : input?.url || String(input);

  if (!url.includes(ANTHROPIC_HOST) || !url.includes(MESSAGES_PATH)) {
    return originalFetch.call(this, input, init);
  }

  const t0 = Date.now();
  let body = {};
  let model = 'unknown';
  let streaming = false;

  try {
    const raw = typeof init?.body === 'string' ? init.body : '';
    if (raw) {
      body = JSON.parse(raw);
      model = body.model || 'unknown';
      streaming = !!body.stream;
    }
  } catch {}

  const ctx = extractContext(body);
  const preview = extractPreview(body);

  const response = await originalFetch.call(this, input, init);
  const latency = Date.now() - t0;

  try {
    if (streaming && response.ok && response.body) {
      const [logStream, returnStream] = response.body.tee();

      // Background: read log stream and extract usage
      (async () => {
        try {
          const reader = logStream.getReader();
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          const text = Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf-8');
          const { inputTokens, outputTokens, cacheRead, cacheWrite } = parseSSEUsage(text);
          if (inputTokens > 0 || outputTokens > 0) {
            appendLog({
              ts: Math.floor(Date.now() / 1000),
              model, ctx, preview,
              input_tokens: inputTokens,
              output_tokens: outputTokens,
              cache_read: cacheRead,
              cache_write: cacheWrite,
              cost: Math.round(estimateCost(model, inputTokens, outputTokens, cacheRead, cacheWrite) * 1e6) / 1e6,
              latency_ms: Date.now() - t0,
              stream: true,
            });
          }
        } catch {}
      })();

      return new Response(returnStream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });

    } else if (response.ok) {
      const clone = response.clone();
      clone.json().then(data => {
        const u = data?.usage;
        if (!u) return;
        const inTok = u.input_tokens || 0;
        const outTok = u.output_tokens || 0;
        const cr = u.cache_read_input_tokens || 0;
        const cw = u.cache_creation_input_tokens || 0;
        appendLog({
          ts: Math.floor(Date.now() / 1000),
          model: data.model || model, ctx, preview,
          input_tokens: inTok,
          output_tokens: outTok,
          cache_read: cr,
          cache_write: cw,
          cost: Math.round(estimateCost(data.model || model, inTok, outTok, cr, cw) * 1e6) / 1e6,
          latency_ms: latency,
          stream: false,
        });
      }).catch(() => {});
    }
  } catch {}

  return response;
};

console.error('[openclaw-costs] Token tracking active');
