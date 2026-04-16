import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PID_FILE = "/tmp/claude-split-monitor.pid";
const LOG_FILE = "/tmp/claude-split-monitor.log";
const MONITOR_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "monitor");
const VENV_DIR = join(MONITOR_DIR, "venv");

function ensureVenv() {
  if (!existsSync(VENV_DIR)) {
    console.log("Creating Python venv...");
    execSync(`python3 -m venv "${VENV_DIR}"`, { stdio: "inherit" });
    execSync(`"${VENV_DIR}/bin/pip" install -q -r "${MONITOR_DIR}/requirements.txt"`, { stdio: "inherit" });
  }
}

function getPid() {
  if (!existsSync(PID_FILE)) return null;
  const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim());
  try { process.kill(pid, 0); return pid; } catch { return null; }
}

export async function monitorCtl(action, port = 8765) {
  switch (action) {
    case "start": {
      const existing = getPid();
      if (existing) {
        console.log(`Monitor already running (PID ${existing})`);
        return;
      }

      ensureVenv();

      const child = spawn(
        `${VENV_DIR}/bin/python3`,
        [join(MONITOR_DIR, "monitor.py"), "--port", String(port)],
        { detached: true, stdio: ["ignore", "pipe", "pipe"] }
      );

      // Write logs
      const { createWriteStream } = await import("node:fs");
      const logStream = createWriteStream(LOG_FILE, { flags: "a" });
      child.stdout.pipe(logStream);
      child.stderr.pipe(logStream);
      child.unref();

      writeFileSync(PID_FILE, String(child.pid));
      console.log(`Monitor started on ws://localhost:${port} (PID ${child.pid})`);
      console.log(`Logs: ${LOG_FILE}`);
      break;
    }

    case "stop": {
      const pid = getPid();
      if (!pid) {
        console.log("Monitor not running.");
        return;
      }
      process.kill(pid, "SIGTERM");
      try { unlinkSync(PID_FILE); } catch {}
      console.log(`Monitor stopped (PID ${pid})`);
      break;
    }

    case "status": {
      const pid = getPid();
      if (pid) {
        console.log(`Monitor running (PID ${pid})`);
        console.log(`WebSocket: ws://localhost:${port}`);
        console.log(`Logs: ${LOG_FILE}`);
      } else {
        console.log("Monitor not running.");
        console.log("Start with: claude-split monitor start");
      }
      break;
    }

    default:
      console.error("Usage: claude-split monitor <start|stop|status>");
      process.exit(1);
  }
}
