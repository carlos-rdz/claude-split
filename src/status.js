import { readInbox, pendingMessages } from "./state.js";

export async function status() {
  const plannerMsgs = readInbox("planner");
  const executorMsgs = readInbox("executor");
  const plannerPending = pendingMessages("planner");
  const executorPending = pendingMessages("executor");

  console.log("  claude-split status\n");

  // Summary line
  const totalPending = plannerPending.length + executorPending.length;
  if (totalPending === 0 && plannerMsgs.length === 0 && executorMsgs.length === 0) {
    console.log("  No messages yet. Planner writes to inbox-executor.md to assign tasks.");
    return;
  }

  // Planner inbox (messages FROM executor)
  printInbox("Planner", plannerMsgs, plannerPending);

  console.log("");

  // Executor inbox (messages FROM planner)
  printInbox("Executor", executorMsgs, executorPending);

  // Bottom summary
  console.log("");
  if (totalPending > 0) {
    console.log(`  \x1b[33m${totalPending} pending message${totalPending > 1 ? "s" : ""}\x1b[0m`);
  } else {
    console.log("  \x1b[32mAll messages ACK'd\x1b[0m");
  }
}

function printInbox(label, messages, pending) {
  console.log(`  \x1b[1m${label} inbox\x1b[0m (${messages.length} total, ${pending.length} pending)`);

  if (pending.length > 0) {
    console.log("  \x1b[33mPending:\x1b[0m");
    for (const msg of pending) {
      const badge = typeBadge(msg.type);
      const pri = msg.priority === "p0" ? " \x1b[31m!!\x1b[0m" : "";
      console.log(`    ${badge} ${msg.id}: ${truncate(msg.body, 60)}${pri}`);
    }
  }

  // Last 5 ACK'd messages as history
  const acked = messages.filter((m) => m.acked).slice(-5);
  if (acked.length > 0) {
    console.log("  \x1b[2mHistory:\x1b[0m");
    for (const msg of acked) {
      console.log(`    \x1b[32m✓\x1b[0m ${msg.id}: ${truncate(msg.body, 55)} \x1b[2m[${msg.ackedBy}]\x1b[0m`);
    }
  }
}

function typeBadge(type) {
  switch (type) {
    case "task": return "\x1b[36m[TASK]\x1b[0m";
    case "result": return "\x1b[32m[RSLT]\x1b[0m";
    case "question": return "\x1b[33m[ASK?]\x1b[0m";
    case "block": return "\x1b[31m[BLCK]\x1b[0m";
    default: return `[${type}]`;
  }
}

function truncate(text, len) {
  const oneline = text.replace(/\n/g, " ").trim();
  return oneline.length > len ? oneline.slice(0, len - 1) + "\u2026" : oneline;
}
