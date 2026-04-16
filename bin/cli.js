#!/usr/bin/env node

import { parseArgs } from "node:util";
import { init } from "../src/init.js";
import { status } from "../src/status.js";
import { claim } from "../src/claim.js";
import { done } from "../src/done.js";
import { server } from "../src/server.js";
import { ping, pong, checkReady, reset } from "../src/handshake.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    port: { type: "string", short: "p", default: "7433" },
    name: { type: "string", short: "n" },
  },
});

const command = positionals[0];

const HELP = `
claude-split — coordinate multiple Claude Code sessions

Commands:
  init              Set up claude-split in current repo (.claude/split/)
  ping              Register and wait for partner session (green light)
  pong              Respond to a waiting session
  ready             Check if both sessions are connected
  reset             Clear handshake state
  status            Show who's working on what
  claim <task>      Claim a task for your session
  done [task]       Mark task complete, update status
  serve             Start coordination server

Options:
  -n, --name        Session name (default: random)
  -p, --port        Server port (default: 7433)
  -h, --help        Show this help

Quick start:
  1. cd your-repo && npx claude-split init
  2. Terminal A: npx claude-split ping --name alpha
  3. Terminal B: npx claude-split ping --name beta
  4. Both get GREEN LIGHT — start working
`;

if (values.help || !command) {
  console.log(HELP);
  process.exit(0);
}

switch (command) {
  case "init":
    await init();
    break;
  case "ping":
    await ping(values.name);
    break;
  case "pong":
    await pong(values.name);
    break;
  case "ready":
    await checkReady();
    break;
  case "reset":
    await reset();
    break;
  case "status":
    await status();
    break;
  case "claim":
    await claim(positionals[1], values.name);
    break;
  case "done":
    await done(positionals[1], values.name);
    break;
  case "serve":
    await server(parseInt(values.port));
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
