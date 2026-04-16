import { readState, writeState, addLogEntry } from "./state.js";

export async function done(taskId, sessionName) {
  const state = readState();

  if (taskId) {
    // Mark specific task done
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) {
      console.error(`Task ${taskId} not found`);
      process.exit(1);
    }
    task.status = "done";
    task.completedAt = new Date().toISOString();
    addLogEntry(state, task.owner || sessionName || "unknown", "completed", task.description);
  } else if (sessionName) {
    // Mark all tasks for this session done
    const tasks = state.tasks.filter((t) => t.owner === sessionName && t.status === "claimed");
    tasks.forEach((t) => {
      t.status = "done";
      t.completedAt = new Date().toISOString();
      addLogEntry(state, sessionName, "completed", t.description);
    });
    console.log(`Marked ${tasks.length} tasks done for ${sessionName}`);
  } else {
    console.error("Usage: claude-split done <task-id> or claude-split done --name <session>");
    process.exit(1);
  }

  // Update session
  if (sessionName && state.sessions[sessionName]) {
    state.sessions[sessionName].lastSeen = new Date().toISOString();
    state.sessions[sessionName].currentTask = null;
  }

  writeState(state);
  console.log("Status updated.");
}
