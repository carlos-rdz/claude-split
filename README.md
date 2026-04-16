# claude-split

**Two Claude Code sessions. One codebase. No conflicts.**

```
Planner                              Executor
┌──────────────────────┐            ┌──────────────────────┐
│ Decides what to do   │            │ Implements tasks     │
│                      │            │                      │
│ Writes tasks to ─────┼──────────→ │ inbox-executor.md    │
│                      │            │                      │
│ inbox-planner.md ←───┼────────── │ Writes results back  │
└──────────────────────┘            └──────────────────────┘
         │                                   │
         └──── no shared state ──────────────┘
              one writer per file
```

## The Problem

You run out of tokens on one Claude session. You start a second one. Now they're editing the same files, duplicating work, and you're playing messenger.

**claude-split** gives each session a role, a one-way inbox, and gets out of the way.

## How It Works

Two roles. Two inbox files. No shared mutable state.

- **Planner** — decides what to do, writes tasks to `inbox-executor.md`
- **Executor** — implements tasks, writes results to `inbox-planner.md`

Each session reads its inbox on startup, acts on unACK'd messages, appends `[ACK]` when done. That's the entire protocol.

Messages are append-only markdown. If a session dies, unACK'd messages survive as pending work. The next session picks them up.

## Get Started

```bash
npx claude-split init
```

This creates:
- `.claude/split/inbox-planner.md` — Executor writes here
- `.claude/split/inbox-executor.md` — Planner writes here
- A git worktree for the Executor (isolated branch, no file conflicts)
- Injects split config into `CLAUDE.md` for both roles

Then open two sessions:

```bash
# Terminal A (Planner) — project root
claude

# Terminal B (Executor) — worktree
cd .claude/worktrees/executor && claude
```

Each Claude session reads its CLAUDE.md on startup and knows:
1. What role it has
2. Where its inbox is
3. Where to write messages for the other session
4. To ACK messages after acting on them

## Message Format

```markdown
## MSG-20260416-001
**From:** planner
**Type:** task
**Priority:** p0

Fix the discount codes — MAGA20 and EAGLE15 are displayed
on ad landing pages but missing from src/lib/discounts.ts.
Add them to DISCOUNT_MAP.

[ACK - executor]
---
```

Types: `task` | `result` | `question` | `block`

- **task** — Planner assigns work to Executor
- **result** — Executor reports back what was done
- **question** — Executor needs a judgment call from Planner
- **block** — either session is stuck, needs help

## Check Status (Humans Only)

```bash
npx claude-split status
```

```
  claude-split status

  Planner inbox (3 total, 1 pending)
  Pending:
    [RSLT] MSG-20260416-003: Fixed discount codes, tsc clean, pushed !!
  History:
    ✓ MSG-20260416-001: Auth module refactored [executor]
    ✓ MSG-20260416-002: Tests passing, 94% coverage [executor]

  Executor inbox (2 total, 0 pending)
  History:
    ✓ MSG-20260416-001: Fix discount codes in src/lib/discounts.ts [planner]
    ✓ MSG-20260416-002: Add biometric consent checkbox [planner]

  All messages ACK'd
```

Claude sessions never call `status`. This is for you.

## Why Not state.json?

| Problem | state.json | inbox files |
|---------|-----------|-------------|
| Two writers | lock races | impossible — one writer per file |
| Session dies mid-task | state stuck "in progress" | unACK'd message = pending |
| Agent forgets to call `done` | broken state | no runtime commands needed |
| Audit trail | must build separately | inbox IS the log |

## When a Session Dies

1. Start a new session in the same terminal
2. Claude reads CLAUDE.md, sees its role
3. Reads its inbox, finds unACK'd messages
4. Picks up where the dead session left off

No cleanup needed. No stale locks. No orphaned state.

## Commands

```bash
claude-split init      # set up inboxes + worktree + CLAUDE.md injection
claude-split status    # show pending/ACK'd messages (human view)
claude-split --version
claude-split --help
```

That's it. Two commands. Everything else happens through the inbox files.

## Monitor Dashboard

Want a live web dashboard showing agent status, pending tasks, and message flow?

See [claude-split-monitor](https://github.com/carlos-rdz/claude-split-monitor) — a standalone companion app.

## License

MIT
