import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readState, writeState, ensureDir } from "./state.js";

const SPLIT_DIR = ".claude/split";

const README = `# Claude Split

Two Claude Code sessions. One repo. No conflicts.

## For Claude (read this on session start)

You are one of two Claude Code sessions working on this repo simultaneously.

### Before doing anything:
1. Run \`cat .claude/split/state.json\` to see current state
2. Check which tasks are unclaimed
3. Claim a task before starting: update state.json with your session name on the task
4. Never edit files another session owns

### While working:
- Only edit files related to your claimed tasks
- If you need a file another session owns, wait or ask the user to coordinate
- Update state.json when you finish a task

### When you're done or running low on context:
- Mark your tasks as done in state.json
- Write what you accomplished and what's left
- The other session will read state.json and continue

### Task format in state.json:
\`\`\`json
{
  "tasks": [
    {
      "id": "task-1",
      "description": "Fix the checkout bug",
      "files": ["src/checkout.ts"],
      "status": "claimed",
      "owner": "swift-falcon",
      "result": null
    }
  ]
}
\`\`\`

Status values: "open" | "claimed" | "done"
`;

const GITIGNORE = `.lock
`;

export async function init() {
  ensureDir();

  // Write README for Claude to read
  const readmePath = join(SPLIT_DIR, "README.md");
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, README);
    console.log("Created .claude/split/README.md");
  } else {
    console.log(".claude/split/README.md already exists, skipping");
  }

  // Write .gitignore for lock file
  writeFileSync(join(SPLIT_DIR, ".gitignore"), GITIGNORE);

  // Initialize state if needed
  const state = readState();
  if (Object.keys(state.sessions).length === 0) {
    writeState(state);
    console.log("Created .claude/split/state.json");
  } else {
    console.log(".claude/split/state.json already exists, skipping");
  }

  // Add to project CLAUDE.md if it exists
  const claudeMd = "CLAUDE.md";
  if (existsSync(claudeMd)) {
    const content = (await import("node:fs")).readFileSync(claudeMd, "utf-8");
    if (!content.includes("claude/split")) {
      console.log("");
      console.log("Add this to your CLAUDE.md:");
      console.log('  @.claude/split/README.md');
    }
  }

  console.log("");
  console.log("Ready. Start two Claude sessions:");
  console.log('  Session A: "Read .claude/split/README.md and pick up open tasks"');
  console.log('  Session B: "Read .claude/split/README.md and pick up open tasks"');
  console.log("");
  console.log("Add tasks:");
  console.log('  npx claude-split claim "Fix checkout bug" --name session-a');
  console.log('  npx claude-split status');
}
