# claude-split

This is the claude-split tool itself. If you're a Claude session reading this, you're working ON the tool, not WITH it.

## What this repo is
A CLI tool that coordinates two Claude Code sessions on the same codebase. Handshake, shared state, task tracking.

## Structure
- `bin/cli.js` — CLI entry point
- `src/` — modules (init, handshake, state, status, claim, done, launch, server, monitor-ctl, doctor)
- `monitor/` — Python WebSocket server for real-time session monitoring
- `setup.sh` — one-command installer
- `docs/` — user guides
- `examples/` — demo scripts

## Stack
- Node.js (ESM, zero npm deps)
- Python 3 (monitor server, only dep: websockets)
- Bash (setup.sh, launch scripts)

## Rules
- Zero npm dependencies — stdlib only
- Keep it simple — this is a coordination tool, not a framework
- macOS + Linux support, no Windows yet


## Split Session Config
**Role:** Planner

On every session start:
1. Read `.claude/split/inbox-planner.md`
2. Act on any message without [ACK]
3. Append `[ACK - planner]` to each message you act on
4. Then proceed with your work

Your inbox: `.claude/split/inbox-planner.md`
Your outbox (write tasks/results here): `.claude/split/inbox-executor.md`

