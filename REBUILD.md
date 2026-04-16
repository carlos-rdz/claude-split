# claude-split v2 — Rebuild Plan

## What's wrong with v1

1. **`state.json` with two writers** — races even with the lock file (lock is process-level, sessions are separate terminals)
2. **Runtime CLI coordination** (`claim`, `done`, `ping`) — agents forget to call these; sessions end mid-task leaving state dirty
3. **Handshake/RED/YELLOW/GREEN** — solves presence detection, which agents don't need
4. **Directory split** — real tasks cross directories; creates constant ownership conflicts

## New architecture in one sentence

Two agents, two one-way inbox files, roles assigned at init — no shared mutable state, no runtime commands.

---

## File structure after rebuild

```
.claude/split/
  inbox-planner.md    ← Executor writes here, Planner reads+ACKs
  inbox-executor.md   ← Planner writes here, Executor reads+ACKs

src/
  state.js            ← inbox primitives (read, append, ACK)
  init.js             ← creates dirs, inboxes, injects CLAUDE.md, creates worktree
  status.js           ← human-facing display of both inboxes

bin/
  cli.js              ← exposes: init, status only
```

### Files to delete
`claim.js`, `done.js`, `handshake.js`, `server.js`, `monitor-ctl.js`, `doctor.js`, `launch.js`

---

## Message format (the contract between sessions)

```markdown
## MSG-[YYYYMMDD]-[seq]
**From:** planner | executor
**Type:** task | result | question | block
**Priority:** p0 | p1 | p2

[body — fully self-contained, no assumed context]

[ACK - planner]
```

Rules:
- ACK is appended in-place to the message when acted on
- Unacked messages = pending work (recoverable after crash)
- `question` type means the Executor hit something requiring judgment — goes back to Planner
- Task bodies must be atomic and verifiable (done/not-done without judgment)

---

## CLAUDE.md injection (what init writes into the project)

```markdown
## Split Session Config
**Role:** Planner

On every session start:
1. Read `.claude/split/inbox-planner.md`
2. Act on any message without [ACK]
3. Append `[ACK - planner]` to each message you act on
4. Then proceed with your work
```

(Executor gets the mirror of this.)

---

## Why one-way inboxes beat state.json

| Problem | state.json + lock | inbox files |
|---|---|---|
| Two writers | lock races, stale locks | impossible — one writer per file |
| Session crash mid-task | state stuck "in progress" | unACK'd message = pending, self-describing |
| Agent forgets to call done/claim | broken state | no runtime commands needed |
| Audit trail | log array in JSON | inbox file IS the log |

---

## CLI surface (minimal)

```bash
claude-split init [--planner-dir .] [--executor-dir ./worktree]
# Creates .claude/split/, inboxes, injects CLAUDE.md for both roles,
# runs: git worktree add ./worktree -b split-executor

claude-split status
# Human-facing only. Reads both inboxes, shows pending/ACK'd messages.
# Claude never calls this.
```

Nothing else. No claim, done, ping, serve, handshake.

---

## Work split

### Terminal instance owns

**`src/state.js`** — rewrite. New exports:
```js
readInbox(role)           // returns parsed messages array
appendMessage(role, msg)  // appends formatted message to inbox file
ackMessage(role, msgId)   // appends [ACK - {role}] to that message in-place
parseInbox(text)          // parses markdown inbox into message objects
INBOX_PATH(role)          // '.claude/split/inbox-{role}.md'
```
No JSON. No lock. No state.json.

**`src/init.js`** — rewrite. Must:
- Create `.claude/split/` dir
- Create empty `inbox-planner.md` and `inbox-executor.md` with header comment
- Detect if `CLAUDE.md` exists, inject split config block for each role
- Run `git worktree add` for executor (fail gracefully if not a git repo)
- Print instructions for opening each session

### Desktop instance owns

**`src/status.js`** — rewrite. Must:
- Call `readInbox('planner')` and `readInbox('executor')`
- Display pending messages (no ACK) highlighted
- Display last 5 ACK'd messages per inbox as history
- Show which role has unread work

**`bin/cli.js`** — rewrite. Expose only `init` and `status`.
Remove all references to claim, done, ping, handshake, serve.

**`README.md`** — rewrite. New workflow:
1. `npx claude-split init`
2. Open Planner session in project root
3. Open Executor session in `./worktree/`
4. Planner writes tasks to `inbox-executor.md` manually or via Claude
5. Executor reads on startup, executes, writes results to `inbox-planner.md`

**Deletions**: `claim.js`, `done.js`, `handshake.js`, `server.js`, `monitor-ctl.js`, `doctor.js`, `launch.js`

**`package.json`** — remove bin entries for deleted commands, bump to 2.0.0

---

## Integration point

Terminal finishes `state.js` first — it defines the `readInbox`/`appendMessage`/`parseInbox` interface.
Desktop imports from `./state.js` in `status.js`. No other cross-dependencies.

Terminal signals done by writing to the shared inbox once `state.js` is committed:
```
MSG: state.js done — exports: readInbox, appendMessage, ackMessage, parseInbox, INBOX_PATH
```

Desktop unblocks and starts `status.js` after that signal.

---

## Done criteria

- [ ] `claude-split init` creates dirs, inboxes, injects CLAUDE.md, creates worktree
- [ ] `claude-split status` shows pending/ACK'd messages from both inboxes
- [ ] No `state.json` anywhere
- [ ] No `claim`/`done`/`ping`/`handshake` commands
- [ ] Old files deleted
- [ ] README reflects new workflow
