#!/usr/bin/env node
/**
 * openclaw-costs — CLI analytics and Telegram report generator
 *
 * Commands:
 *   (none)          summary + top (default)
 *   summary         overall cost summary
 *   top             top contexts by cost
 *   breakdown CTX   detailed breakdown of a context
 *   alerts          calls over cost threshold
 *   hourly          hourly usage pattern
 *   tail            recent calls
 *   report          weekly Telegram report (plain text)
 *   contexts        list detected contexts
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DATA_DIR = join(process.env.HOME || homedir(), '.openclaw', 'cost-tracker');
const LOG_FILE = join(DATA_DIR, 'calls.jsonl');

// --- Model display names ---
const MODEL_SHORT = {
  'claude-sonnet-4-5-20250929': 'sonnet-4.5',
  'claude-sonnet-4-20250514': 'sonnet-4',
  'claude-opus-4-20250514': 'opus-4',
  'claude-haiku-4-5-20251001': 'haiku-4.5',
};

// Models that are cheap enough for summarization/monitoring
const CHEAP_MODELS = new Set(['claude-haiku-4-5-20251001']);

// Known monitoring/summarization tasks that don't need Sonnet
const SUMMARIZATION_PATTERNS = [
  'gmail', 'reddit', 'moltbook', 'product-hunt', 'producthunt',
  'monitor', 'digest', 'flashcard', 'heartbeat',
];

// --- Helpers ---
function shortModel(m) { return MODEL_SHORT[m] || m; }

function fmtCost(c) { return c >= 1 ? `$${c.toFixed(2)}` : `$${c.toFixed(4)}`; }

function fmtTokens(t) {
  if (t >= 1e6) return `${(t / 1e6).toFixed(1)}M`;
  if (t >= 1e3) return `${(t / 1e3).toFixed(1)}K`;
  return String(t);
}

function fmtDate(ts) {
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

function sinceTs(days) {
  return Math.floor((Date.now() - days * 86400000) / 1000);
}

// --- Data loading ---
function loadCalls(days = 7) {
  if (!existsSync(LOG_FILE)) return [];
  const cutoff = sinceTs(days);
  const lines = readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean);
  const calls = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.ts >= cutoff) calls.push(entry);
    } catch {}
  }
  return calls;
}

/** Normalize context string into a short label. */
function normalizeContext(ctx) {
  if (!ctx) return 'unknown';

  // Cron contexts: "cron:Gmail Digest — Morning" → "gmail-digest-morning"
  if (ctx.startsWith('cron:')) {
    return ctx.slice(5)
      .toLowerCase()
      .replace(/[—–-]+/g, '-')
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
  }

  if (ctx === 'compaction') return 'compaction';
  if (ctx.startsWith('system:')) return 'session';

  // Detect known patterns from raw text
  const lower = ctx.toLowerCase();
  if (lower.includes('compacted into the following summary')) return 'compaction';
  if (lower.includes('jobs-monitor') || lower.includes('вакансий')) return 'jobs-monitor';
  if (lower.includes('reddit-monitor') || lower.includes('подборку интересных постов')) return 'reddit-monitor';
  if (lower.includes('reddit-seo-digest') || lower.includes('r/seo digest')) return 'reddit-seo-digest';
  if (lower.includes('product hunt') || lower.includes('producthunt')) return 'product-hunt';
  if (lower.includes('moltbook')) return 'moltbook';
  if (lower.includes('gmail') || lower.includes('входящие письма')) return 'gmail-digest';
  if (lower.includes('flashcard') || lower.includes('morning greek')) return 'greek-flashcards';
  if (lower.includes('греческого урока') || lower.includes('greek lesson')) return 'greek-lesson';
  if (lower.includes('weekly greek test')) return 'greek-test';
  if (lower.includes('seo analysis') || lower.includes('seo deep dive')) return 'seo-analysis';
  if (lower.includes('memory maintenance')) return 'memory-maintenance';

  return 'session';
}

/** Group calls by normalized context. */
function groupByContext(calls) {
  const groups = {};
  for (const c of calls) {
    const ctx = normalizeContext(c.ctx);
    if (!groups[ctx]) groups[ctx] = { calls: [], cost: 0, tokens_in: 0, tokens_out: 0, models: {} };
    const g = groups[ctx];
    g.calls.push(c);
    g.cost += c.cost || 0;
    g.tokens_in += c.input_tokens || 0;
    g.tokens_out += c.output_tokens || 0;
    const m = shortModel(c.model);
    g.models[m] = (g.models[m] || 0) + 1;
  }
  return groups;
}

// --- Commands ---

function cmdSummary(calls, days) {
  if (!calls.length) { console.log(`No data for the last ${days} days.`); return; }

  const totalCost = calls.reduce((s, c) => s + (c.cost || 0), 0);
  const totalIn = calls.reduce((s, c) => s + (c.input_tokens || 0), 0);
  const totalOut = calls.reduce((s, c) => s + (c.output_tokens || 0), 0);
  const totalCacheR = calls.reduce((s, c) => s + (c.cache_read || 0), 0);
  const totalCacheW = calls.reduce((s, c) => s + (c.cache_write || 0), 0);

  console.log(`=== Cost Summary — last ${days} days ===\n`);
  console.log(`Total calls:    ${calls.length}`);
  console.log(`Total cost:     ${fmtCost(totalCost)}`);
  console.log(`Input tokens:   ${fmtTokens(totalIn)}`);
  console.log(`Output tokens:  ${fmtTokens(totalOut)}`);
  console.log(`Cache read:     ${fmtTokens(totalCacheR)}`);
  console.log(`Cache write:    ${fmtTokens(totalCacheW)}`);
  console.log(`Avg cost/call:  ${fmtCost(totalCost / calls.length)}`);
  console.log();

  // By model
  const models = {};
  for (const c of calls) {
    const m = shortModel(c.model);
    if (!models[m]) models[m] = { calls: 0, cost: 0, in: 0, out: 0 };
    models[m].calls++;
    models[m].cost += c.cost || 0;
    models[m].in += c.input_tokens || 0;
    models[m].out += c.output_tokens || 0;
  }
  console.log('--- By model ---');
  for (const [m, d] of Object.entries(models).sort((a, b) => b[1].cost - a[1].cost)) {
    console.log(`  ${m.padEnd(16)} ${fmtCost(d.cost).padStart(10)}  (${d.calls} calls, in=${fmtTokens(d.in)}, out=${fmtTokens(d.out)})`);
  }
  console.log();
}

function cmdTop(calls, days, limit = 15) {
  if (!calls.length) { console.log(`No data for the last ${days} days.`); return; }

  const groups = groupByContext(calls);
  const totalCost = calls.reduce((s, c) => s + (c.cost || 0), 0);
  const sorted = Object.entries(groups).sort((a, b) => b[1].cost - a[1].cost);

  console.log(`=== Top Contexts — last ${days} days (total: ${fmtCost(totalCost)}) ===\n`);
  console.log(`${'Context'.padEnd(28)} ${'Cost'.padStart(10)} ${'Calls'.padStart(6)} ${'Avg'.padStart(8)} ${'%'.padStart(5)} Models`);
  console.log('-'.repeat(85));

  for (const [ctx, g] of sorted.slice(0, limit)) {
    const avg = g.cost / g.calls.length;
    const pct = totalCost > 0 ? (g.cost / totalCost * 100) : 0;
    const models = Object.entries(g.models).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m}(${n})`).join(', ');
    console.log(`${ctx.padEnd(28)} ${fmtCost(g.cost).padStart(10)} ${String(g.calls.length).padStart(6)} ${fmtCost(avg).padStart(8)} ${pct.toFixed(0).padStart(4)}% ${models}`);
  }
  console.log();
}

function cmdBreakdown(calls, ctx, days) {
  const groups = groupByContext(calls);
  const match = Object.entries(groups).find(([k]) => k.includes(ctx.toLowerCase()));
  if (!match) {
    console.log(`No calls found for context "${ctx}"`);
    console.log('Available:', Object.keys(groups).sort().join(', '));
    return;
  }

  const [name, g] = match;
  console.log(`=== Breakdown: ${name} — last ${days} days ===\n`);
  console.log(`Total cost:     ${fmtCost(g.cost)}`);
  console.log(`Calls:          ${g.calls.length}`);
  console.log(`Input tokens:   ${fmtTokens(g.tokens_in)}`);
  console.log(`Output tokens:  ${fmtTokens(g.tokens_out)}`);
  console.log();

  // Models
  console.log('Models:');
  for (const [m, n] of Object.entries(g.models).sort((a, b) => b[1] - a[1])) {
    const pct = (n / g.calls.length * 100).toFixed(0);
    console.log(`  ${m}: ${n} calls (${pct}%)`);
  }
  console.log();

  // Most expensive
  const expensive = g.calls.sort((a, b) => (b.cost || 0) - (a.cost || 0)).slice(0, 5);
  console.log('Most expensive calls:');
  for (const c of expensive) {
    console.log(`  ${fmtCost(c.cost).padStart(8)} | ${fmtDate(c.ts)} | in=${fmtTokens(c.input_tokens)} out=${fmtTokens(c.output_tokens)} cache_w=${fmtTokens(c.cache_write || 0)} | ${c.latency_ms}ms`);
  }
  console.log();
}

function cmdAlerts(calls, threshold = 0.10) {
  const expensive = calls.filter(c => (c.cost || 0) >= threshold).sort((a, b) => b.cost - a.cost);
  if (!expensive.length) { console.log(`No calls over ${fmtCost(threshold)}.`); return; }

  console.log(`=== Alerts — ${expensive.length} calls over ${fmtCost(threshold)} ===\n`);
  for (const c of expensive.slice(0, 30)) {
    const ctx = normalizeContext(c.ctx);
    console.log(`  ⚠️  ${fmtCost(c.cost).padStart(8)} | ${fmtDate(c.ts)} | ${ctx} | ${shortModel(c.model)}`);
    console.log(`       in=${fmtTokens(c.input_tokens)} out=${fmtTokens(c.output_tokens)} cache_w=${fmtTokens(c.cache_write || 0)} | ${c.latency_ms}ms`);
  }
  console.log();
}

function cmdHourly(calls, days) {
  if (!calls.length) { console.log('No data.'); return; }

  const hours = {};
  for (const c of calls) {
    const h = fmtDate(c.ts).slice(0, 13); // "2026-02-25 06"
    if (!hours[h]) hours[h] = { calls: 0, cost: 0 };
    hours[h].calls++;
    hours[h].cost += c.cost || 0;
  }

  const maxCost = Math.max(...Object.values(hours).map(h => h.cost));
  console.log(`=== Hourly Usage — last ${days} days ===\n`);
  for (const h of Object.keys(hours).sort()) {
    const d = hours[h];
    const barLen = maxCost > 0 ? Math.round(d.cost / maxCost * 40) : 0;
    console.log(`  ${h}  ${fmtCost(d.cost).padStart(8)} (${String(d.calls).padStart(3)} calls) ${'█'.repeat(barLen)}`);
  }
  console.log();
}

function cmdTail(calls, limit = 20) {
  const recent = calls.slice(-limit);
  if (!recent.length) { console.log('No data.'); return; }

  console.log(`=== Last ${limit} calls ===\n`);
  for (const c of recent) {
    const ctx = normalizeContext(c.ctx).padEnd(24);
    const m = shortModel(c.model).padEnd(12);
    const s = c.stream ? '⚡' : '  ';
    console.log(`  ${fmtDate(c.ts)} ${s} ${m} ${fmtCost(c.cost).padStart(8)} in=${fmtTokens(c.input_tokens).padStart(6)} out=${fmtTokens(c.output_tokens).padStart(6)} ${String(c.latency_ms).padStart(5)}ms  [${ctx.trim()}]`);
  }
  console.log();
}

function cmdContexts(calls) {
  const groups = groupByContext(calls);
  console.log('Detected contexts:');
  for (const ctx of Object.keys(groups).sort()) {
    console.log(`  ${ctx} (${groups[ctx].calls.length} calls)`);
  }
}

// --- Weekly Telegram Report ---

function cmdReport(calls, days = 7) {
  if (!calls.length) {
    console.log('No data for weekly report.');
    return;
  }

  const totalCost = calls.reduce((s, c) => s + (c.cost || 0), 0);
  const groups = groupByContext(calls);
  const sorted = Object.entries(groups).sort((a, b) => b[1].cost - a[1].cost);

  const lines = [];
  const now = new Date();
  const weekAgo = new Date(now - days * 86400000);
  const dateRange = `${weekAgo.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  lines.push(`📊 Weekly Cost Report (${dateRange})\n`);
  lines.push(`Total: ${calls.length} calls, ~${fmtCost(totalCost)} estimated\n`);

  // Top spenders
  lines.push('🔴 Top spenders:');
  for (const [ctx, g] of sorted.slice(0, 5)) {
    const pct = totalCost > 0 ? (g.cost / totalCost * 100).toFixed(0) : 0;
    const models = Object.keys(g.models).join(', ');
    lines.push(`${sorted.indexOf([ctx, g]) + 1}. ${ctx} — ${fmtCost(g.cost)} (${pct}%, ${g.calls.length} calls, ${models})`);
  }
  // Re-number since indexOf won't work with new array refs
  const topLines = [];
  sorted.slice(0, 5).forEach(([ctx, g], i) => {
    const pct = totalCost > 0 ? (g.cost / totalCost * 100).toFixed(0) : 0;
    const models = Object.keys(g.models).join(', ');
    topLines.push(`  ${i + 1}. ${ctx} — ${fmtCost(g.cost)} (${pct}%, ${g.calls.length} calls, ${models})`);
  });
  // Replace bad lines
  lines.splice(lines.indexOf('🔴 Top spenders:') + 1, sorted.slice(0, 5).length, ...topLines);

  // Detect issues
  const issues = [];
  let estimatedSavings = 0;

  // Issue: compaction loops
  const compactionCalls = calls.filter(c => normalizeContext(c.ctx) === 'compaction');
  if (compactionCalls.length > 10) {
    const compactionCost = compactionCalls.reduce((s, c) => s + (c.cost || 0), 0);
    issues.push(`• ${compactionCalls.length} compaction calls (~${fmtCost(compactionCost)}) — possible context loop. Consider reducing TTL or killing stale sessions.`);
    estimatedSavings += compactionCost * 0.7;
  }

  // Issue: Sonnet used for summarization tasks
  for (const [ctx, g] of sorted) {
    const isSummarization = SUMMARIZATION_PATTERNS.some(p => ctx.includes(p));
    if (!isSummarization) continue;

    const sonnetCalls = g.calls.filter(c => !CHEAP_MODELS.has(c.model));
    if (sonnetCalls.length > 0) {
      const sonnetCost = sonnetCalls.reduce((s, c) => s + (c.cost || 0), 0);
      const haikuEstimate = sonnetCost * 0.08; // Haiku is ~8% of Sonnet cost
      const savings = sonnetCost - haikuEstimate;
      issues.push(`• ${ctx} uses Sonnet for ${sonnetCalls.length} calls (~${fmtCost(sonnetCost)}). Switch to Haiku → save ~${fmtCost(savings)}/week`);
      estimatedSavings += savings;
    }
  }

  // Issue: high cost single calls
  const expensiveCalls = calls.filter(c => (c.cost || 0) > 0.50);
  if (expensiveCalls.length > 0) {
    const totalExpensive = expensiveCalls.reduce((s, c) => s + (c.cost || 0), 0);
    issues.push(`• ${expensiveCalls.length} calls over $0.50 each (total: ${fmtCost(totalExpensive)}). Usually compaction or large context.`);
  }

  if (issues.length) {
    lines.push('');
    lines.push('⚠️ Issues detected:');
    lines.push(...issues);
  }

  if (estimatedSavings > 0) {
    lines.push('');
    lines.push(`💡 Estimated savings if fixed: ~${fmtCost(estimatedSavings)}/week`);
  }

  // If everything looks fine
  if (!issues.length) {
    lines.push('');
    lines.push('✅ No issues detected. Usage looks healthy.');
  }

  console.log(lines.join('\n'));
}

// --- CLI ---
const args = process.argv.slice(2);
const cmd = args[0] || '';
const days = parseInt(args.find(a => a.startsWith('--days='))?.split('=')[1] || '7');
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '15');
const threshold = parseFloat(args.find(a => a.startsWith('--threshold='))?.split('=')[1] || '0.10');

const calls = loadCalls(days);

switch (cmd) {
  case 'summary':
    cmdSummary(calls, days);
    break;
  case 'top':
    cmdTop(calls, days, limit);
    break;
  case 'breakdown':
    cmdBreakdown(calls, args[1] || '', days);
    break;
  case 'alerts':
    cmdAlerts(calls, threshold);
    break;
  case 'hourly':
    cmdHourly(calls, days);
    break;
  case 'tail':
    cmdTail(calls, limit);
    break;
  case 'report':
    cmdReport(calls, days);
    break;
  case 'contexts':
    cmdContexts(calls);
    break;
  case 'help':
  case '--help':
  case '-h':
    console.log(`openclaw-costs — LLM cost analytics for OpenClaw

Commands:
  (none)              summary + top (default)
  summary             overall cost summary
  top                 top contexts by cost
  breakdown <ctx>     detailed context breakdown
  alerts              expensive calls (>$0.10)
  hourly              hourly usage pattern
  tail                recent calls
  report              weekly Telegram report
  contexts            list detected contexts

Options:
  --days=N            lookback period (default: 7)
  --limit=N           max rows (default: 15)
  --threshold=N       alert threshold in USD (default: 0.10)

Examples:
  node cost-report.mjs                     # summary + top
  node cost-report.mjs top --days=1        # today's top spenders
  node cost-report.mjs breakdown gmail     # gmail details
  node cost-report.mjs report              # weekly Telegram report
  node cost-report.mjs alerts --threshold=0.50
`);
    break;
  default:
    cmdSummary(calls, days);
    cmdTop(calls, days, limit);
}
