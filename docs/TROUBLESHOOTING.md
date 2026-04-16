# Troubleshooting

## "Claude CLI not found"

Install Claude Code:
```bash
npm install -g @anthropic-ai/claude-code
```

Then verify: `claude --version`

## "Node.js not found" or wrong version

Need Node 18+. Install from https://nodejs.org or:
```bash
# macOS
brew install node

# Linux
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

## Handshake stuck on "waiting for partner"

1. Make sure both terminals are running `claude-split ping`
2. Check they're in the same repo directory
3. Try: `npx claude-split reset` then ping again
4. Check file permissions on `.claude/split/handshake.json`

## Monitor won't start

```bash
npx claude-split doctor    # check all dependencies
```

Common fixes:
- Python venv broken: `rm -rf monitor/venv && claude-split monitor start`
- Port in use: `lsof -i :8765` then kill the process, or use `--port 9000`
- Check logs: `cat /tmp/claude-split-monitor.log`

## Both sessions editing the same file

This means the split wasn't clear. Fix:
1. Stop both sessions
2. Decide who owns which directories
3. Update `.claude/split/state.json` with file ownership
4. Restart

Rule of thumb: split by directory, not by task type.

## Session died mid-task

Start a new session and say:
```
Read .claude/split/README.md. Pick up unfinished work.
```

It reads state.json, sees what's done and what's left, continues.

If state.json is stale, check git:
```bash
git log --oneline -10    # what was committed
git diff                 # uncommitted changes
```

## Lock file stuck

If you see errors about `.claude/split/.lock`:
```bash
rm .claude/split/.lock
```

The lock has a 3-second timeout and should auto-break, but sometimes it gets stuck if a process crashes.

## Terminal windows don't open

`setup.sh` and `launch` try to open Terminal.app (macOS) or gnome-terminal (Linux). If neither works:

Run manually in two terminals:
```bash
# Terminal A
cd your-repo && claude-split ping --name alpha && claude

# Terminal B
cd your-repo && claude-split ping --name beta && claude
```

## "Permission denied" on setup.sh

```bash
chmod +x setup.sh
./setup.sh
```
