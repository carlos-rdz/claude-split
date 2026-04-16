#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────────────────
# claude-split setup — one command to get two Claude sessions working together
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONITOR_PORT=8765
MONITOR_PID_FILE="/tmp/claude-split-monitor.pid"
MONITOR_LOG="/tmp/claude-split-monitor.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

banner() {
  echo ""
  echo -e "${CYAN}${BOLD}"
  echo "  ┌─────────────────────────────────────┐"
  echo "  │         claude-split setup           │"
  echo "  │   Two sessions. One codebase. Go.    │"
  echo "  └─────────────────────────────────────┘"
  echo -e "${NC}"
}

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
info() { echo -e "  ${CYAN}→${NC} $1"; }

# ─── Dependency checks ───────────────────────────────────────────────────────

check_deps() {
  echo -e "\n${BOLD}Checking dependencies...${NC}"

  # Node.js
  if command -v node &>/dev/null; then
    NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VER" -ge 18 ]; then
      ok "Node.js $(node -v)"
    else
      fail "Node.js $(node -v) — need v18+"
      exit 1
    fi
  else
    fail "Node.js not found — install from https://nodejs.org"
    exit 1
  fi

  # Python 3
  if command -v python3 &>/dev/null; then
    ok "Python $(python3 --version 2>&1 | cut -d' ' -f2)"
  else
    fail "Python 3 not found — install from https://python.org"
    exit 1
  fi

  # Claude CLI
  if command -v claude &>/dev/null; then
    ok "Claude CLI $(claude --version 2>/dev/null | head -1)"
  else
    fail "Claude CLI not found"
    echo ""
    echo "  Install: npm install -g @anthropic-ai/claude-code"
    echo "  Docs:    https://docs.anthropic.com/claude-code"
    exit 1
  fi
}

# ─── Target repo ──────────────────────────────────────────────────────────────

pick_repo() {
  echo -e "\n${BOLD}Where do you want to split?${NC}"

  if [ -n "$1" ]; then
    TARGET_REPO="$1"
  elif [ -d ".git" ] && [ "$(pwd)" != "$SCRIPT_DIR" ]; then
    TARGET_REPO="$(pwd)"
    info "Detected git repo: $TARGET_REPO"
    read -p "  Use this repo? [Y/n] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
      read -p "  Enter repo path: " TARGET_REPO
    fi
  else
    read -p "  Enter repo path: " TARGET_REPO
  fi

  TARGET_REPO="${TARGET_REPO/#\~/$HOME}"

  if [ ! -d "$TARGET_REPO" ]; then
    fail "Directory not found: $TARGET_REPO"
    exit 1
  fi

  if [ ! -d "$TARGET_REPO/.git" ]; then
    warn "$TARGET_REPO is not a git repo (will still work, but no worktree support)"
  fi

  ok "Target: $TARGET_REPO"
}

# ─── Initialize split ────────────────────────────────────────────────────────

init_split() {
  echo -e "\n${BOLD}Initializing claude-split...${NC}"

  cd "$TARGET_REPO"
  node "$SCRIPT_DIR/bin/cli.js" init 2>/dev/null
  node "$SCRIPT_DIR/bin/cli.js" reset 2>/dev/null
  ok "Created .claude/split/ in $TARGET_REPO"
}

# ─── Start monitor ────────────────────────────────────────────────────────────

start_monitor() {
  echo -e "\n${BOLD}Starting monitor server...${NC}"

  # Check if already running
  if [ -f "$MONITOR_PID_FILE" ] && kill -0 "$(cat "$MONITOR_PID_FILE")" 2>/dev/null; then
    ok "Monitor already running (PID $(cat "$MONITOR_PID_FILE"))"
    return
  fi

  # Create venv if needed
  VENV_DIR="$SCRIPT_DIR/monitor/venv"
  if [ ! -d "$VENV_DIR" ]; then
    info "Creating Python venv..."
    python3 -m venv "$VENV_DIR"
    "$VENV_DIR/bin/pip" install -q websockets
  fi

  # Start in background
  nohup "$VENV_DIR/bin/python3" "$SCRIPT_DIR/monitor/monitor.py" \
    --port "$MONITOR_PORT" \
    > "$MONITOR_LOG" 2>&1 &
  echo $! > "$MONITOR_PID_FILE"

  sleep 1
  if kill -0 "$(cat "$MONITOR_PID_FILE")" 2>/dev/null; then
    ok "Monitor running on ws://localhost:$MONITOR_PORT (PID $(cat "$MONITOR_PID_FILE"))"
  else
    warn "Monitor failed to start — check $MONITOR_LOG"
  fi
}

# ─── Launch terminals ─────────────────────────────────────────────────────────

launch_terminals() {
  echo -e "\n${BOLD}Launching Claude sessions...${NC}"

  OS="$(uname -s)"
  CLI_PATH="$SCRIPT_DIR/bin/cli.js"

  # Create temp launch scripts
  LAUNCH_A=$(mktemp /tmp/claude-split-a.XXXXXX.sh)
  LAUNCH_B=$(mktemp /tmp/claude-split-b.XXXXXX.sh)

  cat > "$LAUNCH_A" << SCRIPT
#!/bin/bash
cd "$TARGET_REPO"
echo -e "\033[1;36m"
echo "  ┌─────────────────────────────┐"
echo "  │  Claude Split — Session A   │"
echo "  │  Name: alpha                │"
echo "  └─────────────────────────────┘"
echo -e "\033[0m"
node "$CLI_PATH" ping --name alpha &
PING_PID=\$!
sleep 2
echo ""
echo "Starting Claude Code..."
echo "Tell Claude: Read .claude/split/README.md — I'm alpha."
echo ""
claude
SCRIPT

  cat > "$LAUNCH_B" << SCRIPT
#!/bin/bash
cd "$TARGET_REPO"
echo -e "\033[1;33m"
echo "  ┌─────────────────────────────┐"
echo "  │  Claude Split — Session B   │"
echo "  │  Name: beta                 │"
echo "  └─────────────────────────────┘"
echo -e "\033[0m"
sleep 3
node "$CLI_PATH" ping --name beta &
PING_PID=\$!
sleep 2
echo ""
echo "Starting Claude Code..."
echo "Tell Claude: Read .claude/split/README.md — I'm beta."
echo ""
claude
SCRIPT

  chmod +x "$LAUNCH_A" "$LAUNCH_B"

  case "$OS" in
    Darwin)
      # macOS — open two Terminal.app windows
      osascript -e "
        tell application \"Terminal\"
          activate
          set w1 to do script \"bash $LAUNCH_A\"
          delay 1
          set w2 to do script \"bash $LAUNCH_B\"

          -- Tile windows side by side
          set bounds of window 1 to {0, 25, 960, 800}
          set bounds of window 2 to {960, 25, 1920, 800}
        end tell
      " 2>/dev/null
      ok "Opened two Terminal windows (alpha + beta)"
      ;;
    Linux)
      if command -v gnome-terminal &>/dev/null; then
        gnome-terminal --title="Claude Split — Alpha" -- bash "$LAUNCH_A" &
        gnome-terminal --title="Claude Split — Beta" -- bash "$LAUNCH_B" &
        ok "Opened two gnome-terminal windows"
      elif command -v xterm &>/dev/null; then
        xterm -title "Claude Split — Alpha" -e "bash $LAUNCH_A" &
        xterm -title "Claude Split — Beta" -e "bash $LAUNCH_B" &
        ok "Opened two xterm windows"
      else
        warn "No supported terminal emulator found"
        echo "  Run these manually in two terminals:"
        echo "    bash $LAUNCH_A"
        echo "    bash $LAUNCH_B"
        return
      fi
      ;;
    *)
      warn "Unsupported OS: $OS"
      echo "  Run these manually in two terminals:"
      echo "    bash $LAUNCH_A"
      echo "    bash $LAUNCH_B"
      return
      ;;
  esac
}

# ─── Wait for handshake ──────────────────────────────────────────────────────

wait_for_green() {
  echo -e "\n${BOLD}Waiting for handshake...${NC}"

  HANDSHAKE="$TARGET_REPO/.claude/split/handshake.json"
  TIMEOUT=120
  ELAPSED=0

  while [ $ELAPSED -lt $TIMEOUT ]; do
    if [ -f "$HANDSHAKE" ]; then
      READY=$(python3 -c "
import json
try:
    h = json.load(open('$HANDSHAKE'))
    ready = sum(1 for s in h.get('sessions',{}).values() if s.get('status')=='ready')
    print(ready)
except: print(0)
" 2>/dev/null)
      if [ "$READY" -ge 2 ]; then
        ok "GREEN LIGHT — both sessions connected!"
        return
      fi
    fi
    sleep 2
    ELAPSED=$((ELAPSED + 2))
    printf "\r  ${YELLOW}Waiting...${NC} %ds" "$ELAPSED"
  done

  echo ""
  warn "Timed out after ${TIMEOUT}s — sessions may still connect"
}

# ─── Success ──────────────────────────────────────────────────────────────────

success_banner() {
  echo ""
  echo -e "${GREEN}${BOLD}"
  echo "  ┌─────────────────────────────────────────────┐"
  echo "  │          claude-split is running!            │"
  echo "  │                                             │"
  echo "  │  Two Claude sessions are ready.             │"
  echo "  │  Talk to either terminal window.            │"
  echo "  │                                             │"
  echo "  │  Commands:                                  │"
  echo "  │    npx claude-split status    — who's doing │"
  echo "  │    npx claude-split claim     — add task    │"
  echo "  │    npx claude-split done      — finish task │"
  echo "  │                                             │"
  echo "  │  Monitor: ws://localhost:$MONITOR_PORT          │"
  echo "  │  Logs: $MONITOR_LOG   │"
  echo "  └─────────────────────────────────────────────┘"
  echo -e "${NC}"
}

# ─── Main ─────────────────────────────────────────────────────────────────────

banner
check_deps
pick_repo "$1"
init_split
start_monitor
launch_terminals
wait_for_green
success_banner
