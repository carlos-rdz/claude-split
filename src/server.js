import { createServer } from "node:http";
import { readState, writeState, addLogEntry, generateSessionName } from "./state.js";

// Lightweight HTTP coordination server
// Both Claude sessions can hit this to read/write state atomically
// Also serves as a foundation for MCP server later

export async function server(port = 7433) {
  const srv = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    res.setHeader("Content-Type", "application/json");

    try {
      if (req.method === "GET" && url.pathname === "/state") {
        res.end(JSON.stringify(readState()));

      } else if (req.method === "POST" && url.pathname === "/heartbeat") {
        const body = await readBody(req);
        const state = readState();
        const name = body.session || generateSessionName();
        state.sessions[name] = {
          lastSeen: new Date().toISOString(),
          currentTask: state.sessions[name]?.currentTask || null,
        };
        writeState(state);
        res.end(JSON.stringify({ ok: true, session: name }));

      } else if (req.method === "POST" && url.pathname === "/claim") {
        const body = await readBody(req);
        const state = readState();
        const name = body.session || generateSessionName();

        // Find first open task or create new
        let task;
        if (body.taskId) {
          task = state.tasks.find((t) => t.id === body.taskId && t.status === "open");
        } else if (body.description) {
          task = {
            id: `task-${state.tasks.length + 1}`,
            description: body.description,
            files: body.files || [],
            status: "open",
            owner: null,
            result: null,
          };
          state.tasks.push(task);
        } else {
          task = state.tasks.find((t) => t.status === "open");
        }

        if (!task) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "No open tasks" }));
          return;
        }

        task.status = "claimed";
        task.owner = name;
        task.claimedAt = new Date().toISOString();
        state.sessions[name] = { lastSeen: new Date().toISOString(), currentTask: task.id };
        addLogEntry(state, name, "claimed", task.description);
        writeState(state);
        res.end(JSON.stringify({ ok: true, task }));

      } else if (req.method === "POST" && url.pathname === "/done") {
        const body = await readBody(req);
        const state = readState();
        const task = state.tasks.find((t) => t.id === body.taskId);
        if (!task) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "Task not found" }));
          return;
        }
        task.status = "done";
        task.result = body.result || null;
        task.completedAt = new Date().toISOString();
        addLogEntry(state, task.owner || body.session, "completed", task.description);
        writeState(state);
        res.end(JSON.stringify({ ok: true, task }));

      } else if (req.method === "POST" && url.pathname === "/message") {
        const body = await readBody(req);
        const state = readState();
        addLogEntry(state, body.from, "message", body.text);
        writeState(state);
        res.end(JSON.stringify({ ok: true }));

      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Not found" }));
      }
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  srv.listen(port, () => {
    console.log(`claude-split server running on http://localhost:${port}`);
    console.log("");
    console.log("Endpoints:");
    console.log("  GET  /state          — current state");
    console.log("  POST /heartbeat      — register/ping session");
    console.log("  POST /claim          — claim or create a task");
    console.log("  POST /done           — mark task complete");
    console.log("  POST /message        — send message to log");
    console.log("");
    console.log("Claude sessions can use curl to coordinate:");
    console.log(`  curl -s localhost:${port}/state | jq .`);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
  });
}
