import { readState, writeState, generateSessionName, addLogEntry } from "./state.js";

export async function claim(description, sessionName) {
  if (!description) {
    console.error("Usage: claude-split claim <description> [--name session-name]");
    process.exit(1);
  }

  const name = sessionName || generateSessionName();
  const state = readState();

  const id = `task-${state.tasks.length + 1}`;
  const task = {
    id,
    description,
    files: [],
    status: "claimed",
    owner: name,
    result: null,
    claimedAt: new Date().toISOString(),
  };

  state.tasks.push(task);

  // Register/update session
  state.sessions[name] = {
    lastSeen: new Date().toISOString(),
    currentTask: id,
  };

  addLogEntry(state, name, "claimed", description);
  writeState(state);

  console.log(`Task ${id} claimed by ${name}: ${description}`);
}
