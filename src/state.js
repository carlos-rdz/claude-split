import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const SPLIT_DIR = ".claude/split";
const STATE_FILE = join(SPLIT_DIR, "state.json");
const LOCK_FILE = join(SPLIT_DIR, ".lock");

function defaultState() {
  return {
    version: 1,
    sessions: {},
    tasks: [],
    log: [],
  };
}

export function ensureDir() {
  if (!existsSync(SPLIT_DIR)) {
    mkdirSync(SPLIT_DIR, { recursive: true });
  }
}

export function readState() {
  if (!existsSync(STATE_FILE)) return defaultState();
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return defaultState();
  }
}

export function writeState(state) {
  ensureDir();
  state.lastUpdated = new Date().toISOString();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

// Simple file-based lock to prevent concurrent writes
export function withLock(fn) {
  const lockId = randomBytes(4).toString("hex");
  const maxWait = 3000;
  const start = Date.now();

  while (existsSync(LOCK_FILE)) {
    if (Date.now() - start > maxWait) {
      // Stale lock — break it
      try { unlinkSync(LOCK_FILE); } catch {}
      break;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }

  writeFileSync(LOCK_FILE, lockId);
  try {
    return fn();
  } finally {
    try {
      if (readFileSync(LOCK_FILE, "utf-8") === lockId) {
        unlinkSync(LOCK_FILE);
      }
    } catch {}
  }
}

export function generateSessionName() {
  const adjectives = ["swift", "bright", "calm", "bold", "keen", "warm"];
  const nouns = ["falcon", "river", "cedar", "flint", "sage", "ridge"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}`;
}

export function addLogEntry(state, session, action, detail) {
  state.log.push({
    time: new Date().toISOString(),
    session,
    action,
    detail,
  });
  // Keep last 50 entries
  if (state.log.length > 50) state.log = state.log.slice(-50);
}
