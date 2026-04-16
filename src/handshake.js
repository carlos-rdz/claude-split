#!/usr/bin/env node
/**
 * Handshake — session-to-session ping/pong before work starts.
 *
 * Flow:
 *   Session A: claude-split ping --name alpha
 *     → writes .claude/split/handshake.json with { alpha: { status: "waiting", ts } }
 *     → polls until another session responds
 *
 *   Session B: claude-split ping --name beta
 *     → sees alpha is waiting, writes { beta: { status: "ready", ts } }
 *     → updates alpha to "ready"
 *     → both see green light
 *
 * Both sessions must be "ready" before work starts.
 * Timeout after 60s if no partner shows up.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ensureDir } from "./state.js";

const HANDSHAKE_FILE = ".claude/split/handshake.json";
const TIMEOUT_MS = 120_000; // 2 minutes
const POLL_MS = 1000;

function readHandshake() {
  if (!existsSync(HANDSHAKE_FILE)) return { sessions: {} };
  try {
    return JSON.parse(readFileSync(HANDSHAKE_FILE, "utf-8"));
  } catch {
    return { sessions: {} };
  }
}

function writeHandshake(data) {
  ensureDir();
  data.lastUpdated = new Date().toISOString();
  writeFileSync(HANDSHAKE_FILE, JSON.stringify(data, null, 2) + "\n");
}

export async function ping(sessionName) {
  if (!sessionName) {
    console.error("Usage: claude-split ping --name <session-name>");
    process.exit(1);
  }

  ensureDir();
  const start = Date.now();

  // Register ourselves
  const hs = readHandshake();
  hs.sessions[sessionName] = {
    status: "waiting",
    ts: new Date().toISOString(),
    pid: process.pid,
  };
  writeHandshake(hs);

  console.log(`[${sessionName}] Pinging... waiting for partner`);

  // Poll for partner
  while (Date.now() - start < TIMEOUT_MS) {
    const current = readHandshake();
    const others = Object.entries(current.sessions).filter(([name]) => name !== sessionName);

    if (others.length > 0) {
      // Partner found — mark both ready
      const [partnerName] = others[0];
      current.sessions[sessionName].status = "ready";
      current.sessions[partnerName].status = "ready";
      current.sessions[sessionName].partner = partnerName;
      current.sessions[partnerName].partner = sessionName;
      writeHandshake(current);

      console.log(`[${sessionName}] Partner found: ${partnerName}`);
      console.log(`[${sessionName}] GREEN LIGHT — both sessions ready`);
      console.log("");
      console.log("State file: .claude/split/state.json");
      console.log("Run: claude-split status");
      return { ok: true, partner: partnerName };
    }

    // Show waiting indicator
    const elapsed = Math.round((Date.now() - start) / 1000);
    process.stdout.write(`\r[${sessionName}] Waiting for partner... ${elapsed}s`);

    await sleep(POLL_MS);
  }

  // Timeout
  console.log(`\n[${sessionName}] Timeout — no partner responded in ${TIMEOUT_MS / 1000}s`);
  console.log("Start another session and run: claude-split ping --name <name>");

  // Clean up
  const final = readHandshake();
  delete final.sessions[sessionName];
  writeHandshake(final);

  return { ok: false };
}

export async function pong(sessionName) {
  // Check if someone is waiting
  const hs = readHandshake();
  const waiting = Object.entries(hs.sessions).filter(([, info]) => info.status === "waiting");

  if (waiting.length === 0) {
    console.log("No sessions waiting. Run 'claude-split ping --name <name>' first.");
    return { ok: false };
  }

  const [partnerName] = waiting[0];

  // Register and mark both ready
  hs.sessions[sessionName] = {
    status: "ready",
    ts: new Date().toISOString(),
    pid: process.pid,
    partner: partnerName,
  };
  hs.sessions[partnerName].status = "ready";
  hs.sessions[partnerName].partner = sessionName;
  writeHandshake(hs);

  console.log(`[${sessionName}] Connected to ${partnerName}`);
  console.log(`[${sessionName}] GREEN LIGHT — both sessions ready`);
  return { ok: true, partner: partnerName };
}

export async function checkReady() {
  const hs = readHandshake();
  const sessions = Object.entries(hs.sessions);
  const ready = sessions.filter(([, info]) => info.status === "ready");

  if (ready.length >= 2) {
    console.log("GREEN LIGHT — both sessions connected:");
    ready.forEach(([name, info]) => {
      console.log(`  ${name} ↔ ${info.partner} (since ${info.ts})`);
    });
    return true;
  }

  const waiting = sessions.filter(([, info]) => info.status === "waiting");
  if (waiting.length > 0) {
    console.log("YELLOW — waiting for partner:");
    waiting.forEach(([name]) => console.log(`  ${name} is waiting...`));
    return false;
  }

  console.log("RED — no sessions registered. Run: claude-split ping --name <name>");
  return false;
}

export async function reset() {
  writeHandshake({ sessions: {} });
  console.log("Handshake reset.");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
