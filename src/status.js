import { readState } from "./state.js";

export async function status() {
  const state = readState();

  console.log("=== Claude Split Status ===\n");

  // Sessions
  const sessions = Object.entries(state.sessions);
  if (sessions.length === 0) {
    console.log("Sessions: none registered");
  } else {
    console.log("Sessions:");
    for (const [name, info] of sessions) {
      const age = timeSince(info.lastSeen);
      const status = age > 600000 ? "probably dead" : "active";
      console.log(`  ${name}: ${status} (last seen ${formatAge(age)})`);
    }
  }

  console.log("");

  // Tasks
  if (state.tasks.length === 0) {
    console.log("Tasks: none");
    console.log('  Add one: npx claude-split claim "description" --name session-name');
  } else {
    const open = state.tasks.filter((t) => t.status === "open");
    const claimed = state.tasks.filter((t) => t.status === "claimed");
    const done = state.tasks.filter((t) => t.status === "done");

    if (open.length) {
      console.log(`Open (${open.length}):`);
      open.forEach((t) => console.log(`  [ ] ${t.id}: ${t.description}`));
    }
    if (claimed.length) {
      console.log(`In progress (${claimed.length}):`);
      claimed.forEach((t) => console.log(`  [~] ${t.id}: ${t.description} (${t.owner})`));
    }
    if (done.length) {
      console.log(`Done (${done.length}):`);
      done.forEach((t) => console.log(`  [x] ${t.id}: ${t.description}${t.result ? ` — ${t.result}` : ""}`));
    }
  }

  // Recent log
  if (state.log.length > 0) {
    console.log("\nRecent activity:");
    state.log.slice(-5).forEach((entry) => {
      const time = new Date(entry.time).toLocaleTimeString();
      console.log(`  ${time} [${entry.session}] ${entry.action}: ${entry.detail}`);
    });
  }

  console.log(`\nLast updated: ${state.lastUpdated || "never"}`);
}

function timeSince(iso) {
  return Date.now() - new Date(iso).getTime();
}

function formatAge(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
  return `${Math.round(ms / 3600000)}h ago`;
}
