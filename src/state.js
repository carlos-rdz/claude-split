/**
 * Inbox primitives for claude-split v2.
 *
 * Architecture: two one-way inbox files, one writer per file.
 *   inbox-planner.md  — Executor writes, Planner reads+ACKs
 *   inbox-executor.md — Planner writes, Executor reads+ACKs
 *
 * No shared mutable state. No locks. No state.json.
 * Unacked messages = pending work. Recoverable after any crash.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const SPLIT_DIR = ".claude/split";

export function INBOX_PATH(role) {
  if (role !== "planner" && role !== "executor") {
    throw new Error(`Invalid role: ${role}. Must be 'planner' or 'executor'.`);
  }
  return join(SPLIT_DIR, `inbox-${role}.md`);
}

const INBOX_HEADER = (role) =>
  `# Inbox → ${role.charAt(0).toUpperCase() + role.slice(1)}\n\n` +
  `${role === "planner" ? "Executor" : "Planner"} writes here. ` +
  `${role.charAt(0).toUpperCase() + role.slice(1)} reads and ACKs.\n\n---\n`;

// ---------------------------------------------------------------------------
// Init helpers
// ---------------------------------------------------------------------------

export function ensureDir() {
  if (!existsSync(SPLIT_DIR)) {
    mkdirSync(SPLIT_DIR, { recursive: true });
  }
}

export function ensureInboxes() {
  ensureDir();
  for (const role of ["planner", "executor"]) {
    const path = INBOX_PATH(role);
    if (!existsSync(path)) {
      writeFileSync(path, INBOX_HEADER(role));
    }
  }
}

// ---------------------------------------------------------------------------
// Message format
//
// ## MSG-YYYYMMDD-NNN
// **From:** planner | executor
// **Type:** task | result | question | block
// **Priority:** p0 | p1 | p2
//
// body text
//
// [ACK - planner]
// ---------------------------------------------------------------------------

function todayPrefix() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

let _seq = 0;
function nextSeq() {
  return String(++_seq).padStart(3, "0");
}

/**
 * Parse an inbox markdown file into an array of message objects.
 * @param {string} text - raw file contents
 * @returns {{ id, from, type, priority, body, acked, ackedBy }[]}
 */
export function parseInbox(text) {
  const messages = [];
  const blocks = text.split(/(?=^## MSG-)/m).filter((b) => b.trim().startsWith("## MSG-"));

  for (const block of blocks) {
    const lines = block.split("\n");
    const header = lines[0].trim();
    const id = header.replace(/^## /, "").trim();

    const from = (block.match(/\*\*From:\*\*\s*(\S+)/) || [])[1] || "";
    const type = (block.match(/\*\*Type:\*\*\s*(\S+)/) || [])[1] || "";
    const priority = (block.match(/\*\*Priority:\*\*\s*(\S+)/) || [])[1] || "p1";

    const metaEnd = block.search(/\n\n/);
    const rawAfterMeta = metaEnd !== -1 ? block.slice(metaEnd).trim() : "";
    const ackMatch = rawAfterMeta.match(/\[ACK - ([^\]]+)\]/);
    const body = rawAfterMeta
      .replace(/\[ACK - [^\]]+\]/g, "")
      .trim();

    messages.push({ id, from, type, priority, body, acked: !!ackMatch, ackedBy: ackMatch ? ackMatch[1] : null });
  }

  return messages;
}

/**
 * Read and parse an inbox file for the given role.
 * @param {'planner'|'executor'} role
 * @returns {{ id, from, type, priority, body, acked, ackedBy }[]}
 */
export function readInbox(role) {
  const path = INBOX_PATH(role);
  if (!existsSync(path)) return [];
  return parseInbox(readFileSync(path, "utf-8"));
}

/**
 * Append a new message to an inbox.
 * @param {'planner'|'executor'} role - destination inbox
 * @param {{ from, type, priority, body }} msg
 * @returns {string} the generated message ID
 */
export function appendMessage(role, { from, type = "task", priority = "p1", body }) {
  ensureInboxes();
  const id = `MSG-${todayPrefix()}-${nextSeq()}`;
  const text = [
    "",
    `## ${id}`,
    `**From:** ${from}`,
    `**Type:** ${type}`,
    `**Priority:** ${priority}`,
    "",
    body,
    "",
    "---",
    "",
  ].join("\n");

  appendFileSync(INBOX_PATH(role), text);
  return id;
}

/**
 * Append an ACK tag to a specific message in an inbox file in-place.
 * @param {'planner'|'executor'} role - which inbox to ACK in
 * @param {string} msgId - e.g. "MSG-20260415-001"
 * @returns {boolean} true if found and ACK'd, false if not found or already ACK'd
 */
export function ackMessage(role, msgId) {
  const path = INBOX_PATH(role);
  if (!existsSync(path)) return false;

  const text = readFileSync(path, "utf-8");
  const msgStart = text.indexOf(`## ${msgId}`);
  if (msgStart === -1) return false;

  const nextMsg = text.indexOf("\n## MSG-", msgStart + 1);
  const msgBlock = nextMsg === -1 ? text.slice(msgStart) : text.slice(msgStart, nextMsg);

  if (msgBlock.includes(`[ACK - ${role}]`)) return false;

  const ackLine = `[ACK - ${role}]`;
  const updated =
    text.slice(0, msgStart) +
    msgBlock.replace(/(\n---\s*$)/, `\n${ackLine}$1`) +
    (nextMsg === -1 ? "" : text.slice(nextMsg));

  writeFileSync(path, updated);
  return true;
}

/**
 * Return only unACK'd messages from an inbox.
 * @param {'planner'|'executor'} role
 */
export function pendingMessages(role) {
  return readInbox(role).filter((m) => !m.acked);
}
