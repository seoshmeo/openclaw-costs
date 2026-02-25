#!/usr/bin/env bash
#
# openclaw-costs installer
#
# Works both as standalone and as OpenClaw skill installer.
# Copies the hook and report into ~/.openclaw/cost-tracker/
# and shows how to enable tracking.
#
set -euo pipefail

OPENCLAW_DIR="${HOME}/.openclaw"
INSTALL_DIR="${OPENCLAW_DIR}/cost-tracker"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Locate source files — check scripts/ subdirectory first (skill layout),
# then current directory (flat layout)
if [ -f "$SCRIPT_DIR/scripts/cost-hook.mjs" ]; then
  SRC_DIR="$SCRIPT_DIR/scripts"
elif [ -f "$SCRIPT_DIR/cost-hook.mjs" ]; then
  SRC_DIR="$SCRIPT_DIR"
else
  echo "Error: Cannot find cost-hook.mjs"
  echo "Expected in $SCRIPT_DIR/scripts/ or $SCRIPT_DIR/"
  exit 1
fi

echo "openclaw-costs installer"
echo ""

# Create directories
mkdir -p "$INSTALL_DIR"

# Copy files
cp "$SRC_DIR/cost-hook.mjs" "$OPENCLAW_DIR/cost-hook.mjs"
cp "$SRC_DIR/cost-report.mjs" "$INSTALL_DIR/cost-report.mjs"

echo "Files installed:"
echo "  $OPENCLAW_DIR/cost-hook.mjs"
echo "  $INSTALL_DIR/cost-report.mjs"
echo ""

echo "Next steps:"
echo ""
echo "1. Add the hook to NODE_OPTIONS:"
echo ""
echo "   Docker Compose:"
echo "     environment:"
echo "       - NODE_OPTIONS=--import /home/openclaw/.openclaw/cost-hook.mjs --max-old-space-size=768"
echo ""
echo "   Direct:"
echo "     export NODE_OPTIONS=\"--import ${OPENCLAW_DIR}/cost-hook.mjs\""
echo "     openclaw gateway"
echo ""
echo "2. Restart the gateway"
echo ""
echo "3. Check it works:"
echo "   node ${INSTALL_DIR}/cost-report.mjs"
echo ""
echo "4. (Optional) Weekly Telegram report:"
echo "   Tell your agent: \"Create a weekly cron that runs"
echo "   node ~/.openclaw/cost-tracker/cost-report.mjs report"
echo "   and sends the output to me via Telegram.\""
echo ""
echo "Data: $INSTALL_DIR/calls.jsonl"
echo "Reports: node $INSTALL_DIR/cost-report.mjs --help"
