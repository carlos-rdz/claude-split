import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { ensureInboxes, SPLIT_DIR } from "./state.js";

const CLAUDE_MD_BLOCK = (role, worktreePath) => `
## Split Session Config
**Role:** ${role.charAt(0).toUpperCase() + role.slice(1)}

On every session start:
1. Read \`.claude/split/inbox-${role}.md\`
2. Act on any message without [ACK]
3. Append \`[ACK - ${role}]\` to each message you act on
4. Then proceed with your work

Your inbox: \`.claude/split/inbox-${role}.md\`
Your outbox (write tasks/results here): \`.claude/split/inbox-${role === "planner" ? "executor" : "planner"}.md\`
${worktreePath ? `Your working directory: ${worktreePath}` : ""}
`;

function injectClaudeMd(role, worktreePath) {
  const marker = "## Split Session Config";

  // Planner: inject into root CLAUDE.md
  // Executor: inject into worktree CLAUDE.md (created if missing)
  const target = worktreePath
    ? `${worktreePath}/CLAUDE.md`
    : "CLAUDE.md";

  const block = CLAUDE_MD_BLOCK(role, worktreePath);

  if (existsSync(target)) {
    const content = readFileSync(target, "utf-8");
    if (content.includes(marker)) {
      console.log(`  ${target} already has split config, skipping`);
      return;
    }
    appendFileSync(target, "\n" + block);
  } else {
    writeFileSync(target, block.trimStart());
  }
  console.log(`  Injected ${role} config into ${target}`);
}

function createWorktree(dir) {
  const branch = "split-executor";
  try {
    // Check if worktree already exists
    const existing = execSync("git worktree list --porcelain", { encoding: "utf-8" });
    if (existing.includes(dir)) {
      console.log(`  Worktree ${dir} already exists`);
      return true;
    }
    // Check if branch exists
    try {
      execSync(`git show-ref --verify --quiet refs/heads/${branch}`, { stdio: "ignore" });
      execSync(`git worktree add ${dir} ${branch}`, { stdio: "inherit" });
    } catch {
      execSync(`git worktree add -b ${branch} ${dir}`, { stdio: "inherit" });
    }
    console.log(`  Created worktree at ${dir} (branch: ${branch})`);
    return true;
  } catch (err) {
    console.warn(`  Warning: could not create worktree — ${err.message}`);
    console.warn("  Executor will share the working tree (not recommended)");
    return false;
  }
}

export async function init({ executorDir = ".claude/worktrees/executor" } = {}) {
  console.log("Initializing claude-split v2...\n");

  // 1. Create inbox files
  ensureInboxes();
  console.log(`  Created ${SPLIT_DIR}/inbox-planner.md`);
  console.log(`  Created ${SPLIT_DIR}/inbox-executor.md`);

  // 2. Create git worktree for executor
  const isGitRepo = existsSync(".git");
  let worktreeCreated = false;
  if (isGitRepo) {
    worktreeCreated = createWorktree(executorDir);
  } else {
    console.warn("  Not a git repo — skipping worktree creation");
  }

  // 3. Inject CLAUDE.md for planner (root)
  injectClaudeMd("planner", null);

  // 4. Inject CLAUDE.md for executor (worktree or root if no worktree)
  injectClaudeMd("executor", worktreeCreated ? executorDir : null);

  // 5. Print instructions
  console.log(`
Done. Open two Claude Code sessions:

  Planner session (this directory):
    claude  OR  code .

  Executor session (worktree):
    cd ${worktreeCreated ? executorDir : "."}  &&  claude

The Planner decides and assigns tasks via inbox-executor.md.
The Executor implements and reports back via inbox-planner.md.
Messages are appended to the inbox files — no state.json, no coordination commands.

Human status view:
  npx claude-split status
`);
}
