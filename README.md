# claude-split

**Run two Claude Code sessions on the same codebase. No conflicts. No wasted tokens.**

```
Terminal A                          Terminal B
┌─────────────────────┐            ┌─────────────────────┐
│ claude-split ping    │            │ claude-split ping    │
│ --name alpha         │───────────│ --name beta          │
│                      │  GREEN    │                      │
│ "Fix auth module"    │  LIGHT    │ "Write test suite"   │
│                      │           │                      │
│ src/auth/*           │           │ src/__tests__/*      │
└─────────────────────┘            └─────────────────────┘
         │                                   │
         └───────── state.json ──────────────┘
              (shared task tracker)
```

## The Problem

You're deep in a Claude Code session, context window is 80% full, and you still have work to do. You start a second session but now they're stepping on each other's files, duplicating work, and you're playing messenger between two terminals.

**claude-split** fixes this with:
- A **handshake** so both sessions confirm they're connected before starting
- A **shared state file** tracking who owns what files and tasks
- A **CLI** both sessions can call to coordinate
- Zero dependencies, zero config, zero servers required

## Get Started (1 minute)

```bash
git clone https://github.com/carlos-rdz/claude-split.git
cd claude-split
./setup.sh
```

That's it. Setup checks your dependencies, initializes your repo, starts the monitor, opens two terminal windows with Claude, and does the handshake automatically.

### Or, manual setup:

```bash
# In your project repo:
npx claude-split init

# Terminal A:
npx claude-split ping --name alpha
claude
# Tell Claude: "Read .claude/split/README.md — I'm alpha."

# Terminal B:
npx claude-split ping --name beta
claude
# Tell Claude: "Read .claude/split/README.md — I'm beta."
```

## Track work

```bash
npx claude-split claim "Fix auth bugs" --name alpha
npx claude-split claim "Write tests" --name beta
npx claude-split status
npx claude-split done task-1 --name alpha
```

## How It Works

### The Handshake

Before any work starts, both sessions do a ping. The first session waits, the second connects, both get a GREEN LIGHT. This prevents the "is the other session even running?" problem.

```
RED    → no sessions registered
YELLOW → one session waiting for partner
GREEN  → both connected, start working
```

```bash
npx claude-split ready    # check status anytime
npx claude-split reset    # clear and start over
```

### The State File

`.claude/split/state.json` is the single source of truth:

```json
{
  "sessions": {
    "alpha": { "lastSeen": "2025-...", "currentTask": "task-1" },
    "beta": { "lastSeen": "2025-...", "currentTask": "task-2" }
  },
  "tasks": [
    { "id": "task-1", "description": "Fix auth", "owner": "alpha", "status": "claimed" },
    { "id": "task-2", "description": "Tests", "owner": "beta", "status": "claimed" }
  ],
  "log": [...]
}
```

Both Claude sessions read this file to know what's happening. They update it when they claim or finish tasks.

### The README Inside Your Repo

`npx claude-split init` creates `.claude/split/README.md` — instructions written *for Claude*. When you tell Claude "Read .claude/split/README.md", it learns the rules:

1. Check state.json before doing anything
2. Never edit files another session owns
3. Update state.json when you start, finish, or run out of context

### When a Session Dies

Claude sessions run out of tokens. It happens. The surviving session checks state.json and git log to see what the dead session accomplished, then picks up the remaining work.

Start a replacement session:
```bash
claude
# "Read .claude/split/README.md. Pick up unfinished work."
```

## Commands

| Command | Description |
|---------|-------------|
| `init` | Set up claude-split in current repo |
| `ping --name X` | Register session, wait for partner |
| `ready` | Check handshake status (RED/YELLOW/GREEN) |
| `reset` | Clear handshake, start fresh |
| `status` | Show sessions, tasks, recent activity |
| `claim "desc" --name X` | Create and claim a task |
| `done task-1 --name X` | Mark task complete |
| `launch` | Open two terminal windows with Claude |
| `monitor start\|stop\|status` | Session monitor server |
| `doctor` | Check all dependencies |
| `serve` | Start HTTP coordination server (optional) |

## Coordination Server (Optional)

For real-time coordination, run the built-in HTTP server:

```bash
npx claude-split serve --port 7433
```

Both sessions can coordinate via HTTP:

```bash
curl localhost:7433/state                    # get current state
curl -X POST localhost:7433/claim \
  -d '{"session":"alpha","description":"Fix bug"}'
curl -X POST localhost:7433/done \
  -d '{"taskId":"task-1"}'
curl -X POST localhost:7433/message \
  -d '{"from":"alpha","text":"Done with auth, starting API"}'
```

## Best Practices

### Split by directory, not by role

```
alpha owns: src/app/, src/components/
beta owns:  src/lib/, src/__tests__/
```

Don't split by "you do backend, I do frontend." Split by files to prevent conflicts.

### Use git worktrees for isolation

```bash
# Terminal A
claude --worktree feature-auth

# Terminal B
claude --worktree feature-tests
```

Each session gets its own branch. Merge when done. Zero conflict risk.

### Keep tasks small

Big tasks = wasted tokens if a session dies mid-task. Small tasks = easy handoff.

```bash
# Too big
npx claude-split claim "Refactor entire auth system" --name alpha

# Just right
npx claude-split claim "Fix password validation in src/auth/validate.ts" --name alpha
npx claude-split claim "Add rate limiting to src/auth/login.ts" --name alpha
```

### Let the dying session update state

When you notice a session running low on context, tell it:
> "Update .claude/split/state.json with what you've done and what's left, then stop."

## Claude Monitor Integration

If you use [claude-monitor](https://github.com/carlos-rdz/claude-monitor), the cowork status shows up automatically in your menu bar:

```
👥 Split: alpha + beta (GREEN)
```

The monitor server watches `.claude/split/` and broadcasts handshake/task state to the macOS app.

## FAQ

**Does this cost more?**
Yes — two sessions = ~2x token usage. But you get 2x throughput and avoid the "ran out of tokens mid-task" problem.

**Can I use more than 2 sessions?**
Yes. The handshake supports multiple sessions. But coordination overhead grows — 2-3 is the sweet spot.

**What about Anthropic's Agent Teams?**
Agent Teams is a built-in experimental feature that works differently — one lead session spawns teammates within a single context. claude-split is for two *independent* sessions with separate context windows (= more total tokens). Use Agent Teams when you want autonomous coordination; use claude-split when you want more capacity.

**Does it work with Claude Desktop?**
You can add Claude Code as MCP servers in Desktop's config to orchestrate from one window. See [docs/COWORK-GUIDE.md](docs/COWORK-GUIDE.md) for setup.

## License

MIT

## Contributing

Issues and PRs welcome. Keep it simple — the whole tool is <500 lines with zero dependencies.
