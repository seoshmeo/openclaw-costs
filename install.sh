#!/usr/bin/env bash
#
# openclaw-costs installer
#
# Copies the hook and report into your OpenClaw data directory
# and shows how to enable tracking.
#
set -euo pipefail

OPENCLAW_DIR="${HOME}/.openclaw"
INSTALL_DIR="${OPENCLAW_DIR}/cost-tracker"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "📊 openclaw-costs installer"
echo ""

# Check OpenClaw directory exists
if [ ! -d "$OPENCLAW_DIR" ]; then
  echo "❌ OpenClaw directory not found at $OPENCLAW_DIR"
  echo "   Make sure OpenClaw is installed first."
  exit 1
fi

# Create install directory
mkdir -p "$INSTALL_DIR"

# Copy files
cp "$SCRIPT_DIR/cost-hook.mjs" "$OPENCLAW_DIR/cost-hook.mjs"
cp "$SCRIPT_DIR/cost-report.mjs" "$INSTALL_DIR/cost-report.mjs"

echo "✅ Files installed:"
echo "   $OPENCLAW_DIR/cost-hook.mjs"
echo "   $INSTALL_DIR/cost-report.mjs"
echo ""

# Check current NODE_OPTIONS
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Next steps:"
echo ""
echo "1. Add the hook to your NODE_OPTIONS:"
echo ""
echo "   If using docker-compose.yml:"
echo "   ┌──────────────────────────────────────────────────────────────────────┐"
echo "   │ environment:                                                        │"
echo "   │   - NODE_OPTIONS=--import /home/openclaw/.openclaw/cost-hook.mjs \\ │"
echo "   │                  --max-old-space-size=768                            │"
echo "   └──────────────────────────────────────────────────────────────────────┘"
echo ""
echo "   If running directly:"
echo "   ┌──────────────────────────────────────────────────────────────────────┐"
echo "   │ export NODE_OPTIONS=\"--import ${OPENCLAW_DIR}/cost-hook.mjs\"        │"
echo "   │ openclaw gateway                                                    │"
echo "   └──────────────────────────────────────────────────────────────────────┘"
echo ""
echo "2. Restart OpenClaw gateway"
echo ""
echo "3. Check it works:"
echo "   node ${INSTALL_DIR}/cost-report.mjs"
echo ""
echo "4. (Optional) Add weekly Telegram report cron:"
echo "   Tell your OpenClaw agent:"
echo "   \"Create a weekly cron that runs:"
echo "    node ~/.openclaw/cost-tracker/cost-report.mjs report"
echo "    and sends the output to me via Telegram.\""
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Data will be stored at: $INSTALL_DIR/calls.jsonl"
echo "🔍 Run reports: node $INSTALL_DIR/cost-report.mjs --help"
echo ""
echo "Done! Restart your gateway to start tracking."
