#!/bin/bash
# Demo script — shows claude-split in action without needing Claude CLI
# Good for recording terminal gifs with asciinema or vhs
set -e

CLI="$(cd "$(dirname "$0")/.." && pwd)/bin/cli.js"
DEMO_DIR=$(mktemp -d /tmp/claude-split-demo.XXXXXX)

echo -e "\033[1;36m"
echo "  claude-split demo"
echo "  ═════════════════"
echo -e "\033[0m"

# Setup
echo -e "\033[1m1. Initialize\033[0m"
cd "$DEMO_DIR"
git init -q .
node "$CLI" init
echo ""

# Handshake
echo -e "\033[1m2. Handshake\033[0m"
node "$CLI" reset 2>/dev/null

# Simulate alpha waiting
node -e "
import { writeFileSync } from 'fs';
writeFileSync('.claude/split/handshake.json', JSON.stringify({
  sessions: { alpha: { status: 'waiting', ts: new Date().toISOString(), pid: 1 } }
}, null, 2));
"
echo "  [alpha] Waiting for partner..."
sleep 1

# Beta connects
node "$CLI" ping --name beta
echo ""

# Tasks
echo -e "\033[1m3. Claim tasks\033[0m"
node "$CLI" claim "Fix authentication module" --name alpha
node "$CLI" claim "Write integration tests" --name beta
echo ""

# Status
echo -e "\033[1m4. Status\033[0m"
node "$CLI" status
echo ""

# Complete a task
echo -e "\033[1m5. Complete a task\033[0m"
node "$CLI" done task-1 --name alpha
node "$CLI" status
echo ""

# Doctor
echo -e "\033[1m6. Doctor check\033[0m"
node "$CLI" doctor
echo ""

# Cleanup
rm -rf "$DEMO_DIR"

echo -e "\033[1;32m"
echo "  Demo complete!"
echo "  Get started: git clone https://github.com/carlos-rdz/claude-split && cd claude-split && ./setup.sh"
echo -e "\033[0m"
