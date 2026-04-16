import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export async function doctor() {
  console.log("claude-split doctor\n");
  let allGood = true;

  // Node.js
  try {
    const ver = execSync("node -v", { encoding: "utf-8" }).trim();
    const major = parseInt(ver.replace("v", ""));
    if (major >= 18) {
      ok(`Node.js ${ver}`);
    } else {
      fail(`Node.js ${ver} — need v18+`);
      allGood = false;
    }
  } catch {
    fail("Node.js not found");
    allGood = false;
  }

  // Python 3
  try {
    const ver = execSync("python3 --version", { encoding: "utf-8" }).trim();
    ok(ver);
  } catch {
    fail("Python 3 not found");
    allGood = false;
  }

  // Claude CLI
  try {
    const ver = execSync("claude --version", { encoding: "utf-8" }).trim().split("\n")[0];
    ok(`Claude CLI: ${ver}`);
  } catch {
    fail("Claude CLI not found — npm install -g @anthropic-ai/claude-code");
    allGood = false;
  }

  // Monitor venv
  const venv = join(dirname(fileURLToPath(import.meta.url)), "..", "monitor", "venv");
  if (existsSync(venv)) {
    ok("Monitor venv ready");
  } else {
    warn("Monitor venv not created — run ./setup.sh or claude-split monitor start");
  }

  // Split dir in cwd
  if (existsSync(".claude/split/state.json")) {
    ok("Split initialized in current directory");
  } else {
    warn("No .claude/split/ in current directory — run: claude-split init");
  }

  // Monitor running
  try {
    const pid = execSync("cat /tmp/claude-split-monitor.pid 2>/dev/null", { encoding: "utf-8" }).trim();
    execSync(`kill -0 ${pid} 2>/dev/null`);
    ok(`Monitor running (PID ${pid})`);
  } catch {
    warn("Monitor not running — run: claude-split monitor start");
  }

  console.log(allGood ? "\nAll good." : "\nSome issues found. Fix them and run doctor again.");
}

function ok(msg) { console.log(`  \x1b[32m✓\x1b[0m ${msg}`); }
function fail(msg) { console.log(`  \x1b[31m✗\x1b[0m ${msg}`); }
function warn(msg) { console.log(`  \x1b[33m!\x1b[0m ${msg}`); }
