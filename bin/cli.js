#!/usr/bin/env node

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
    "executor-dir": { type: "string" },
  },
});

const command = positionals[0];

const HELP = `
  claude-split v${pkg.version}
  Two Claude sessions. One codebase. No conflicts.

  ${"\x1b[1m"}Commands:${"\x1b[0m"}
    init [--executor-dir path]   Set up inboxes, worktree, inject CLAUDE.md
    status                       Show pending and ACK'd messages

  ${"\x1b[1m"}Options:${"\x1b[0m"}
    -v, --version   Show version
    -h, --help      Show this help

  ${"\x1b[1m"}Workflow:${"\x1b[0m"}
    1. npx claude-split init
    2. Open Planner session in project root
    3. Open Executor session in worktree
    4. Planner writes tasks to inbox-executor.md
    5. Executor reads, implements, writes results to inbox-planner.md
    6. npx claude-split status   (human view)
`;

if (values.version) {
  console.log(`claude-split v${pkg.version}`);
  process.exit(0);
}

if (values.help || !command) {
  console.log(HELP);
  process.exit(0);
}

switch (command) {
  case "init": {
    const { init } = await import("../src/init.js");
    await init({ executorDir: values["executor-dir"] || ".claude/worktrees/executor" });
    break;
  }
  case "status": {
    const { status } = await import("../src/status.js");
    await status();
    break;
  }
  default:
    console.error(`Unknown command: ${command}\nRun claude-split --help for usage.`);
    process.exit(1);
}
