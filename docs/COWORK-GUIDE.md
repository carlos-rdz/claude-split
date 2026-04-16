# How to Run Multiple Claude Sessions Together

**The problem:** You hit token limits on one Claude session. You're paying for more capacity. You want two (or more) sessions working on the same codebase at the same time without stepping on each other.

**The solution:** There are 3 ways to do this, from simplest to most powerful.

---

## Option 1: Desktop + Code as MCP Server (Recommended)

**What it is:** Claude Desktop is the boss. Claude Code instances are its hands. You talk to Desktop, it delegates work to Code instances running in the background.

**Picture this:**
```
┌──────────────────────────────────┐
│       Claude Desktop (UI)        │
│       You talk here only         │
│                                  │
│   "Fix the login bug and         │
│    then run the tests"           │
│                                  │
│         ┌──────┐ ┌──────┐        │
│         │Code A│ │Code B│        │
│         │(tool)│ │(tool)│        │
│         └──┬───┘ └──┬───┘        │
│            │        │            │
│      ┌─────┴────────┴─────┐      │
│      │   Your Codebase    │      │
│      └────────────────────┘      │
└──────────────────────────────────┘
```

**Setup (5 minutes):**

1. Find your Claude Desktop config file:
   - Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add Claude Code as MCP servers:
```json
{
  "mcpServers": {
    "claude-code-a": {
      "command": "claude",
      "args": ["mcp", "serve", "--dangerously-skip-permissions"],
      "cwd": "/path/to/your/repo"
    },
    "claude-code-b": {
      "command": "claude",
      "args": ["mcp", "serve", "--dangerously-skip-permissions"],
      "cwd": "/path/to/your/repo"
    }
  }
}
```

3. Quit Claude Desktop completely (Cmd+Q / Alt+F4, not just close the window)
4. Reopen Claude Desktop
5. Start a new conversation — both Code instances are now available as tools

**How it works:**
- You type in Desktop like normal
- Desktop decides which Code instance to use
- Each Code instance can read files, write files, run commands
- You never leave Desktop — one window, one conversation

**When to use:** You want the simplest setup. You don't need two separate conversations. You just want more capacity.

**Limitations:**
- Desktop picks which instance to use — you can't explicitly say "use instance B"
- Both instances share the same repo — file conflicts are possible if Desktop sends both to the same file
- `--dangerously-skip-permissions` means no approval prompts (be careful in production repos)

---

## Option 2: Two Terminal Sessions + Shared State File (DIY)

**What it is:** Two Claude Code sessions in two terminal windows. They coordinate through a shared JSON file that tracks who's doing what.

**Picture this:**
```
┌─────────────────┐  ┌─────────────────┐
│  Terminal A      │  │  Terminal B      │
│  Claude Code     │  │  Claude Code     │
│                  │  │                  │
│  "I'm working   │  │  "I'm working   │
│   on src/auth/"  │  │   on src/api/"  │
│                  │  │                  │
│  Reads/writes    │  │  Reads/writes   │
│  state.json      │  │  state.json     │
└────────┬─────────┘  └────────┬────────┘
         │                     │
    ┌────┴─────────────────────┴────┐
    │  .claude/split/state.json     │
    │  (who owns what, task list)   │
    └───────────────────────────────┘
```

**Setup (2 minutes):**

1. Install:
```bash
cd your-repo
npx claude-split init
```

2. This creates `.claude/split/` with:
   - `README.md` — instructions Claude reads on startup
   - `state.json` — shared state (tasks, ownership, log)

3. Open two terminals. In each one:
```bash
cd your-repo
claude
# Then say: "Read .claude/split/README.md and pick up open tasks"
```

4. Add tasks from either terminal:
```bash
npx claude-split claim "Fix checkout bug" --name session-a
npx claude-split claim "Add dark mode" --name session-b
npx claude-split status
```

**The rules (both sessions follow these):**
1. Read `state.json` before doing anything
2. Never edit files the other session owns
3. Update `state.json` when you start, finish, or die

**When one session dies (token limit):**
- Start a new session in that terminal
- Say: "Read .claude/split/README.md and pick up open tasks"
- It reads state.json, sees what's done and what's left, continues

**When to use:** You want full control. You want two separate conversations. You want to direct each session independently.

**Limitations:**
- You're the coordinator — you decide what each session works on
- File-based coordination is async (not real-time)
- If both sessions edit the same file, you get conflicts

---

## Option 3: Agent Teams (Built-in, Experimental)

**What it is:** One Claude Code session spawns "teammates" — other Claude instances that work in parallel, talk to each other, and share a task list. All in one terminal.

**Picture this:**
```
┌───────────────────────────────────┐
│  One Terminal                     │
│                                   │
│  ┌─────────┐                      │
│  │  Lead   │ ← you talk to this   │
│  └────┬────┘                      │
│       │ spawns                    │
│  ┌────┴────┐  ┌─────────┐        │
│  │ Worker A│──│ Worker B │        │
│  │ (auth)  │  │ (tests)  │        │
│  └─────────┘  └──────────┘        │
│       ↕ direct messaging ↕        │
└───────────────────────────────────┘
```

**Setup (1 minute):**

1. Enable the feature:
```bash
# In your shell profile (.zshrc, .bashrc)
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1

# Or in .claude/settings.json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

2. Start Claude Code normally:
```bash
claude
```

3. Ask it to spawn teammates:
```
Create a team: one teammate works on fixing bugs in src/auth/,
another works on writing tests in src/__tests__/. Go.
```

4. Navigate between teammates:
   - `Shift+Down` — cycle between lead and teammates
   - `Ctrl+T` — toggle task list view

**How it works:**
- Lead session coordinates everything
- Teammates work independently in their own context windows
- They message each other directly (not through you)
- Shared task list prevents duplicate work
- Each teammate can have its own git worktree (no file conflicts)

**When to use:** You want fully autonomous parallel work. You don't want to coordinate manually. Best for tasks with clear boundaries (different directories, different features).

**Limitations:**
- Experimental — may have rough edges
- Token costs scale linearly (each teammate = full context window)
- Can't resume teammates with `/resume`
- One team per session, no nested teams
- Lead is fixed (can't promote a teammate)

---

## Which One Should I Use?

| Situation | Use |
|-----------|-----|
| "I just want more capacity, keep it simple" | Option 1 (Desktop + MCP) |
| "I want to direct two sessions myself" | Option 2 (Two terminals + state file) |
| "Let Claude figure out the split" | Option 3 (Agent Teams) |
| "I keep running out of tokens mid-task" | Option 2 — when one dies, the other reads state and continues |
| "I'm doing a big refactor across many files" | Option 3 — teammates each own a directory |
| "I want one conversation, not two" | Option 1 or Option 3 |

---

## Common Mistakes

### 1. Both sessions editing the same file
**Fix:** Split by directory. Session A owns `src/app/`, Session B owns `src/lib/`. Or split by task — one fixes bugs, the other writes tests.

### 2. Sessions duplicating work
**Fix:** Use a shared state file (Option 2) or Agent Teams task list (Option 3). Before starting, check what the other session is doing.

### 3. Merge conflicts
**Fix:** Use git worktrees. Each session works on its own branch:
```bash
# Session A
claude --worktree feature-auth

# Session B  
claude --worktree feature-tests
```
Merge when both are done.

### 4. One session dies and work is lost
**Fix:** The dying session's last act should be updating state. If it died without warning, the survivor checks `git log --oneline -10` and `git diff` to see what happened.

### 5. Over-engineering the coordination
**Fix:** Keep it simple. Two sessions, clear file ownership, one shared state file. Don't build inbox systems, polling crons, or message protocols. The state file is enough.

---

## FAQ

**Q: Does running two sessions cost more?**
A: Yes. Each session uses its own tokens. Two sessions = roughly 2x token usage. But you get 2x throughput and avoid the "ran out of tokens mid-task" problem.

**Q: Can I run three or more sessions?**
A: Yes, but coordination overhead grows. 2-3 is the sweet spot. Beyond that, use Agent Teams (Option 3) which handles coordination automatically.

**Q: What about Claude Desktop's Cowork feature?**
A: Cowork is Claude Desktop's built-in multi-session support. It handles task routing and autonomous workflows. If it's available in your plan, it's the most polished option. The approaches above are for when you need more control or are using Claude Code CLI.

**Q: Do the sessions share context?**
A: No. Each session has its own context window. They don't know what the other session "said" or "thought." They only share what's written to files (state.json, code, git history).

**Q: What if I'm working on a monorepo?**
A: Perfect use case. Each session owns a different package/service. Split by `packages/auth/` vs `packages/api/` etc.
