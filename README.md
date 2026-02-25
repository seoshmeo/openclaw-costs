# openclaw-costs

Token usage tracking for [OpenClaw](https://github.com/nichochar/open-claw). See where your Claude tokens go, catch runaway sessions, get weekly cost reports in Telegram.

## Why

OpenClaw doesn't track per-call token usage. If you run multiple crons and Telegram integrations, you have no idea which one is eating your quota — until you hit the weekly limit.

This tool intercepts all Anthropic API calls, logs token counts, and generates actionable reports.

## What it catches

- **Runaway sessions** — compaction loops that burn 100K+ tokens per cycle
- **Wrong model for the job** — Sonnet used for simple monitoring tasks where Haiku would cost 10x less
- **Failed delivery waste** — crons that do full LLM calls then fail to deliver the result
- **Cost distribution** — which crons, sessions, and Telegram groups consume the most

## Install

### Option 1: As OpenClaw Skill (recommended)

Copy this repo into your OpenClaw skills directory:

```bash
git clone https://github.com/seoshmeo/openclaw-costs.git ~/.openclaw/workspace/skills/cost-tracker
```

Then tell your OpenClaw agent:

> Install the cost-tracker skill

The agent will read `SKILL.md` and follow the installation instructions automatically.

### Option 2: Manual

```bash
git clone https://github.com/seoshmeo/openclaw-costs.git
cd openclaw-costs
chmod +x install.sh
./install.sh
```

Then add the hook to your OpenClaw startup.

**Docker Compose:**

```yaml
environment:
  - NODE_OPTIONS=--import /home/openclaw/.openclaw/cost-hook.mjs --max-old-space-size=768
```

**Direct:**

```bash
export NODE_OPTIONS="--import ~/.openclaw/cost-hook.mjs"
openclaw gateway
```

Restart the gateway. You'll see `[openclaw-costs] Token tracking active` in the logs.

## Usage

```bash
# Inside the container (or wherever OpenClaw runs):
node ~/.openclaw/cost-tracker/cost-report.mjs

# Summary + top contexts (default)
node ~/.openclaw/cost-tracker/cost-report.mjs

# Top spenders today
node ~/.openclaw/cost-tracker/cost-report.mjs top --days=1

# Detailed breakdown
node ~/.openclaw/cost-tracker/cost-report.mjs breakdown gmail

# Expensive calls
node ~/.openclaw/cost-tracker/cost-report.mjs alerts --threshold=0.50

# Hourly pattern
node ~/.openclaw/cost-tracker/cost-report.mjs hourly --days=3

# Recent calls
node ~/.openclaw/cost-tracker/cost-report.mjs tail --limit=30

# Weekly report (Telegram-friendly text)
node ~/.openclaw/cost-tracker/cost-report.mjs report
```

## Weekly Telegram Report

Tell your OpenClaw agent:

> Create a weekly cron that runs `node ~/.openclaw/cost-tracker/cost-report.mjs report` and sends the output to me via Telegram. Schedule it for Monday 10:00.

Example report:

```
📊 Weekly Cost Report (Feb 17 – Feb 24)

Total: 847 calls, ~$42.30 estimated

🔴 Top spenders:
  1. compaction — $28.40 (67%, 89 calls, sonnet-4.5)
  2. gmail-digest — $5.20 (12%, 28 calls, sonnet-4.5)
  3. reddit-monitor — $3.10 (7%, 28 calls, sonnet-4.5)
  4. moltbook — $2.80 (7%, 28 calls, sonnet-4.5)
  5. product-hunt — $1.40 (3%, 14 calls, sonnet-4.5)

⚠️ Issues detected:
• 89 compaction calls (~$28.40) — possible context loop. Consider reducing TTL or killing stale sessions.
• gmail-digest uses Sonnet for 28 calls (~$5.20). Switch to Haiku → save ~$4.78/week
• reddit-monitor uses Sonnet for 28 calls (~$3.10). Switch to Haiku → save ~$2.85/week
• 15 calls over $0.50 each (total: $11.20). Usually compaction or large context.

💡 Estimated savings if fixed: ~$30.18/week
```

## How it works

1. **cost-hook.mjs** patches `globalThis.fetch` inside the Node.js process
2. Every Anthropic API call is intercepted after it completes
3. Token usage from the response is extracted (supports both streaming and non-streaming)
4. Each call is logged as a JSON line in `~/.openclaw/cost-tracker/calls.jsonl`
5. **cost-report.mjs** reads the JSONL and generates analytics

No external services. No extra processes. No dependencies. Just two JS files.

## Project structure

```
openclaw-costs/
├── SKILL.md              OpenClaw skill definition (for agent-based install)
├── install.sh            Manual installation script
├── scripts/
│   ├── cost-hook.mjs     Fetch hook — intercepts Anthropic API calls
│   └── cost-report.mjs   CLI analytics + Telegram report generator
├── README.md
└── LICENSE
```

## Cost estimates

The tool estimates costs based on published Anthropic API pricing. If you're on a Claude subscription (Max/Team), you don't pay per token — but the estimates show **relative cost**, which is what matters for optimization.

| Model | Input | Output | Cache Write | Cache Read |
|-------|-------|--------|-------------|------------|
| Sonnet 4.5 | $3/MTok | $15/MTok | $3.75/MTok | $0.30/MTok |
| Opus 4 | $15/MTok | $75/MTok | $18.75/MTok | $1.50/MTok |
| Haiku 4.5 | $0.80/MTok | $4/MTok | $1/MTok | $0.08/MTok |

## Data

Calls are stored in `~/.openclaw/cost-tracker/calls.jsonl`. Each line:

```json
{"ts":1740500000,"model":"claude-sonnet-4-5-20250929","ctx":"cron:Gmail Digest","preview":"Check inbox...","input_tokens":100,"output_tokens":500,"cache_read":8000,"cache_write":0,"cost":0.0083,"latency_ms":3500,"stream":true}
```

File auto-rotates at 50MB.

## Zero overhead

- The hook runs inside the existing Node.js process — no extra services
- Logging is fire-and-forget (async file append)
- JSONL format means no database dependencies
- Report generation is pure computation, no LLM calls

## License

MIT
