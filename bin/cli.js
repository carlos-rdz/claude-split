#!/usr/bin/env node

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
    port: { type: "string", short: "p", default: "7433" },
    name: { type: "string", short: "n" },
    single: { type: "boolean" },
  },
});

const command = positionals[0];

const HELP = `
  claude-split v${pkg.version}
  Run two Claude Code sessions on the same codebase. No conflicts.

  ${"\x1b[1m"}Setup:${"\x1b[0m"}
    ./setup.sh                Full guided setup (recommended)
    init                      Set up .claude/split/ in current repo

  ${"\x1b[1m"}Handshake:${"\x1b[0m"}
    ping --name <n>           Register + wait for partner (GREEN LIGHT)
    ready                     Check: RED / YELLOW / GREEN
    reset                     Clear handshake, start fresh

  ${"\x1b[1m"}Tasks:${"\x1b[0m"}
    status                    Who's working on what
    claim "desc" --name <n>   Create and claim a task
    done <task-id> --name <n> Mark complete

  ${"\x1b[1m"}Advanced:${"\x1b[0m"}
    launch [--single]         Open terminal windows with Claude
    monitor <start|stop|status>  Session monitor server
    serve [--port 7433]       HTTP coordination server
    doctor                    Check all dependencies

  ${"\x1b[1m"}Options:${"\x1b[0m"}
    -n, --name      Session name (default: random)
    -p, --port      Server port
    -v, --version   Show version
    -h, --help      Show this help
`;

if (values.version) {
  console.log(`claude-split v${pkg.version}`);
  process.exit(0);
}

if (values.help || !command) {
  console.log(HELP);
  process.exit(0);
}

switch (command) {
  case "init": {
    const { init } = await import("../src/init.js");
    await init();
    break;
  }
  case "ping": {
    const { ping } = await import("../src/handshake.js");
    await ping(values.name);
    break;
  }
  case "pong": {
    const { pong } = await import("../src/handshake.js");
    await pong(values.name);
    break;
  }
  case "ready": {
    const { checkReady } = await import("../src/handshake.js");
    await checkReady();
    break;
  }
  case "reset": {
    const { reset } = await import("../src/handshake.js");
    await reset();
    break;
  }
  case "status": {
    const { status } = await import("../src/status.js");
    await status();
    break;
  }
  case "claim": {
    const { claim } = await import("../src/claim.js");
    await claim(positionals[1], values.name);
    break;
  }
  case "done": {
    const { done } = await import("../src/done.js");
    await done(positionals[1], values.name);
    break;
  }
  case "launch": {
    const { launch } = await import("../src/launch.js");
    await launch({ single: values.single });
    break;
  }
  case "monitor": {
    const { monitorCtl } = await import("../src/monitor-ctl.js");
    await monitorCtl(positionals[1], parseInt(values.port) || 8765);
    break;
  }
  case "serve": {
    const { server } = await import("../src/server.js");
    await server(parseInt(values.port));
    break;
  }
  case "doctor": {
    const { doctor } = await import("../src/doctor.js");
    await doctor();
    break;
  }
  default:
    console.error(`Unknown command: ${command}\nRun claude-split --help for usage.`);
    process.exit(1);
}
