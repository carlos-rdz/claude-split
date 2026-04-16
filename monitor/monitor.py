#!/usr/bin/env python3
"""
Claude Code Monitor — streams live session activity over WebSocket.

Watches the active Claude Code session JSONL file and pushes parsed events
to connected clients in real-time with turn grouping, severity levels,
duration tracking, correlation IDs, and structured metadata.

Usage:
    python3 monitor.py                    # auto-detect active session
    python3 monitor.py --port 8765        # custom port
    python3 monitor.py --session <uuid>   # specific session
"""

import argparse
import asyncio
import json
import os
import time
from datetime import datetime
from pathlib import Path

try:
    import websockets
except ImportError:
    print("[!] Missing dependency: pip3 install websockets")
    raise SystemExit(1)

CLAUDE_DIR = Path.home() / ".claude"
SESSIONS_DIR = CLAUDE_DIR / "sessions"
PROJECTS_DIR = CLAUDE_DIR / "projects"

clients = set()
event_history = []
MAX_HISTORY = 500

# ─── Session / file discovery ─────────────────────────────────────────────────

def find_active_sessions():
    sessions = []
    if not SESSIONS_DIR.exists():
        return sessions
    for f in SESSIONS_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text())
            pid = data.get("pid")
            if pid:
                try:
                    os.kill(pid, 0)
                    sessions.append(data)
                except ProcessLookupError:
                    pass
        except (json.JSONDecodeError, KeyError):
            continue
    return sessions


def find_session_jsonl(session_id=None):
    if session_id:
        for jsonl in PROJECTS_DIR.rglob(f"{session_id}.jsonl"):
            return jsonl
        return None
    all_jsonl = list(PROJECTS_DIR.rglob("*.jsonl"))
    main_sessions = [f for f in all_jsonl if "subagents" not in str(f)]
    if not main_sessions:
        return None
    return max(main_sessions, key=lambda f: f.stat().st_mtime)


# ─── Timestamp helper ─────────────────────────────────────────────────────────

def parse_timestamp(raw_ts):
    """Normalize a timestamp to epoch milliseconds (int)."""
    if isinstance(raw_ts, (int, float)):
        return int(raw_ts)
    if isinstance(raw_ts, str):
        try:
            return int(datetime.fromisoformat(raw_ts.replace("Z", "+00:00")).timestamp() * 1000)
        except (ValueError, TypeError):
            pass
    return int(time.time() * 1000)


# ─── Turn / correlation tracker ───────────────────────────────────────────────

class TurnTracker:
    """Tracks conversation turns and correlates tool calls with results."""

    def __init__(self):
        self.turn_id = 0
        self.seq = 0
        self.tool_timestamps = {}  # correlation_id -> timestamp_ms
        self.turn_summary = {}     # turn_id -> {tool_calls, errors, ...}

    def on_user(self):
        self.turn_id += 1
        self.seq = 0
        self.turn_summary[self.turn_id] = {
            "tool_calls": 0, "responses": 0, "errors": 0, "thinking": 0,
        }

    def next_seq(self):
        s = self.seq
        self.seq += 1
        return s

    def record_tool_call(self, correlation_id, timestamp_ms):
        self.tool_timestamps[correlation_id] = timestamp_ms
        summary = self.turn_summary.get(self.turn_id)
        if summary:
            summary["tool_calls"] += 1

    def resolve_tool_result(self, correlation_id, timestamp_ms):
        start = self.tool_timestamps.pop(correlation_id, None)
        if start:
            return timestamp_ms - start
        return None

    def record(self, category):
        summary = self.turn_summary.get(self.turn_id)
        if not summary:
            return
        if category == "response":
            summary["responses"] += 1
        elif category == "thinking":
            summary["thinking"] += 1
        elif category == "tool_result_error":
            summary["errors"] += 1


# ─── Event parsing ────────────────────────────────────────────────────────────

TOOL_ICONS = {
    "Bash": "terminal.fill", "Read": "doc.text.fill", "Write": "doc.fill",
    "Edit": "pencil", "Grep": "magnifyingglass", "Glob": "folder.fill",
    "Agent": "person.2.fill", "WebFetch": "globe", "WebSearch": "globe",
    "TodoWrite": "checklist", "Skill": "star.fill", "ToolSearch": "wrench.fill",
}
TOOL_COLORS = {
    "Bash": "orange", "Read": "cyan", "Write": "green", "Edit": "yellow",
    "Grep": "indigo", "Glob": "indigo", "Agent": "purple",
    "WebFetch": "blue", "WebSearch": "blue",
}


def parse_event(line, tracker: TurnTracker):
    """Parse a JSONL line into enriched events."""
    try:
        raw = json.loads(line)
    except json.JSONDecodeError:
        return

    ts = parse_timestamp(raw.get("timestamp", int(time.time() * 1000)))
    event_type = raw.get("type", "unknown")

    if event_type in ("progress", "queue-operation"):
        return

    base = {
        "timestamp": ts,
        "uuid": raw.get("uuid", ""),
        "type": event_type,
        "session_id": raw.get("sessionId", ""),
    }

    msg = raw.get("message", {})
    content = msg.get("content", "")

    # ── User message ──────────────────────────────────────────────────────
    if event_type == "user":
        tracker.on_user()
        body = ""
        if isinstance(content, str):
            body = content[:500]
        elif isinstance(content, list):
            texts = [c.get("text", "") for c in content if c.get("type") == "text"]
            body = " ".join(texts)[:500]
        if not body.strip():
            return
        yield {
            **base,
            "turn_id": tracker.turn_id,
            "seq": tracker.next_seq(),
            "category": "user_input",
            "level": "info",
            "title": "User",
            "body": body,
            "icon": "person.fill",
            "color": "green",
        }

    # ── Assistant message ─────────────────────────────────────────────────
    elif event_type == "assistant":
        usage = msg.get("usage", {})
        model = msg.get("model", "")
        tok_in = usage.get("input_tokens", 0)
        tok_out = usage.get("output_tokens", 0)
        cache_write = usage.get("cache_creation_input_tokens", 0)
        cache_read = usage.get("cache_read_input_tokens", 0)

        extra = {
            "tokens_in": tok_in,
            "tokens_out": tok_out,
            "cache_write": cache_write,
            "cache_read": cache_read,
            "model": model,
        }

        if isinstance(content, list):
            for block in content:
                btype = block.get("type", "")

                if btype == "thinking":
                    thinking = block.get("thinking", "")
                    if not thinking:
                        continue
                    # Detect warn-level thinking (mentions of failure/retry)
                    lower = thinking.lower()
                    level = "warn" if any(w in lower for w in ("error", "fail", "retry", "issue", "problem", "wrong")) else "debug"
                    tracker.record("thinking")
                    yield {
                        **base, **extra,
                        "turn_id": tracker.turn_id,
                        "seq": tracker.next_seq(),
                        "category": "thinking",
                        "level": level,
                        "title": "Thinking",
                        "body": thinking[:500] + ("..." if len(thinking) > 500 else ""),
                        "icon": "brain.head.profile",
                        "color": "purple",
                    }

                elif btype == "text":
                    text = block.get("text", "")
                    if not text.strip():
                        continue
                    tracker.record("response")
                    yield {
                        **base, **extra,
                        "turn_id": tracker.turn_id,
                        "seq": tracker.next_seq(),
                        "category": "response",
                        "level": "info",
                        "title": "Response",
                        "body": text[:500],
                        "icon": "bubble.left.fill",
                        "color": "blue",
                    }

                elif btype == "tool_use":
                    tool_name = block.get("name", "unknown")
                    tool_input = block.get("input", {})
                    tool_id = block.get("id", "")
                    tracker.record_tool_call(tool_id, ts)
                    ev = _make_tool_event(base, extra, tool_name, tool_input, tracker)
                    ev["correlation_id"] = tool_id
                    yield ev

                elif btype == "tool_result":
                    content_val = block.get("content", "")
                    if isinstance(content_val, list):
                        texts = [c.get("text", "") for c in content_val if isinstance(c, dict)]
                        content_val = "\n".join(texts)
                    is_error = block.get("is_error", False)
                    corr_id = block.get("tool_use_id", "")
                    duration_ms = tracker.resolve_tool_result(corr_id, ts)
                    if is_error:
                        tracker.record("tool_result_error")
                    yield {
                        **base, **extra,
                        "turn_id": tracker.turn_id,
                        "seq": tracker.next_seq(),
                        "category": "tool_result",
                        "level": "error" if is_error else "info",
                        "title": "Error" if is_error else "Result",
                        "body": str(content_val)[:500],
                        "icon": "exclamationmark.triangle.fill" if is_error else "checkmark.circle.fill",
                        "color": "red" if is_error else "green",
                        "correlation_id": corr_id,
                        "duration_ms": duration_ms,
                    }

        elif isinstance(content, str) and content.strip():
            tracker.record("response")
            yield {
                **base, **extra,
                "turn_id": tracker.turn_id,
                "seq": tracker.next_seq(),
                "category": "response",
                "level": "info",
                "title": "Response",
                "body": content[:500],
                "icon": "bubble.left.fill",
                "color": "blue",
            }


def _make_tool_event(base, extra, tool_name, tool_input, tracker):
    """Build a structured tool_call event with metadata."""
    meta = {}

    if tool_name == "Bash":
        meta["command"] = tool_input.get("command", "")[:500]
        meta["description"] = tool_input.get("description", "")
        body = meta["description"] or meta["command"][:200]
    elif tool_name == "Read":
        meta["file_path"] = tool_input.get("file_path", "")
        meta["offset"] = tool_input.get("offset")
        meta["limit"] = tool_input.get("limit")
        body = meta["file_path"]
    elif tool_name in ("Write", "Edit"):
        meta["file_path"] = tool_input.get("file_path", "")
        if tool_name == "Edit":
            meta["old_string"] = tool_input.get("old_string", "")[:200]
            meta["new_string"] = tool_input.get("new_string", "")[:200]
            meta["replace_all"] = tool_input.get("replace_all", False)
            body = meta["file_path"]
            old_preview = meta["old_string"][:60]
            new_preview = meta["new_string"][:60]
            if old_preview and new_preview:
                body += f"\n- {old_preview}\n+ {new_preview}"
        else:
            body = meta["file_path"]
    elif tool_name == "Grep":
        meta["pattern"] = tool_input.get("pattern", "")
        meta["path"] = tool_input.get("path", ".")
        meta["glob"] = tool_input.get("glob", "")
        body = f'"{meta["pattern"]}" in {meta["path"]}'
    elif tool_name == "Glob":
        meta["pattern"] = tool_input.get("pattern", "")
        meta["path"] = tool_input.get("path", ".")
        body = meta["pattern"]
    elif tool_name == "Agent":
        meta["description"] = tool_input.get("description", "")
        meta["subagent_type"] = tool_input.get("subagent_type", "")
        meta["prompt"] = tool_input.get("prompt", "")[:300]
        body = meta["description"] or meta["prompt"][:200]
    else:
        body = json.dumps(tool_input, indent=2)[:300]

    return {
        **base, **extra,
        "turn_id": tracker.turn_id,
        "seq": tracker.next_seq(),
        "category": "tool_call",
        "level": "info",
        "title": tool_name,
        "body": body,
        "icon": TOOL_ICONS.get(tool_name, "wrench.fill"),
        "color": TOOL_COLORS.get(tool_name, "gray"),
        "metadata": {k: v for k, v in meta.items() if v is not None and v != ""},
    }


# ─── WebSocket server ─────────────────────────────────────────────────────────

async def tail_jsonl(path, from_line=0):
    line_num = 0
    while True:
        try:
            with open(path, "r") as f:
                for i, line in enumerate(f):
                    if i < from_line:
                        continue
                    line = line.strip()
                    if line:
                        line_num = i + 1
                        yield line_num, line
        except FileNotFoundError:
            pass
        from_line = line_num
        await asyncio.sleep(0.3)


async def broadcast(event):
    global clients
    if not clients:
        return
    msg = json.dumps(event)
    dead = set()
    for ws in clients:
        try:
            await ws.send(msg)
        except websockets.exceptions.ConnectionClosed:
            dead.add(ws)
    clients -= dead


async def handle_client(websocket):
    global clients
    clients.add(websocket)
    remote = websocket.remote_address
    print(f"  [+] Client connected: {remote[0]}:{remote[1]} ({len(clients)} total)")

    try:
        # Send session meta first
        if session_meta:
            await websocket.send(json.dumps(session_meta))

        # Replay history
        for event in event_history:
            await websocket.send(json.dumps(event))

        async for msg in websocket:
            pass
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        clients.discard(websocket)
        print(f"  [-] Client disconnected: {remote[0]}:{remote[1]} ({len(clients)} total)")


session_meta = {}


async def watch_session(jsonl_path):
    global session_meta
    print(f"  [*] Watching: {jsonl_path}")
    print(f"  [*] Reading existing events...")

    # Extract project from path
    project_path = str(jsonl_path.parent.name).replace("-", "/")
    session_id = jsonl_path.stem[:8]

    session_meta = {
        "category": "session_meta",
        "level": "info",
        "title": "Session",
        "body": f"Session {session_id}",
        "timestamp": int(time.time() * 1000),
        "uuid": "session-meta",
        "type": "meta",
        "session_id": jsonl_path.stem,
        "turn_id": 0,
        "seq": 0,
        "icon": "server.rack",
        "color": "cyan",
        "metadata": {
            "project": project_path,
            "session_id": jsonl_path.stem,
            "file": str(jsonl_path),
        },
    }

    # Count existing lines
    line_count = 0
    try:
        with open(jsonl_path) as f:
            line_count = sum(1 for _ in f)
    except FileNotFoundError:
        pass

    start_line = max(0, line_count - 150)
    tracker = TurnTracker()
    event_count = 0

    async for line_num, line in tail_jsonl(jsonl_path, from_line=start_line):
        for event in parse_event(line, tracker):
            event["_line"] = line_num

            event_history.append(event)
            if len(event_history) > MAX_HISTORY:
                event_history.pop(0)

            await broadcast(event)
            event_count += 1

            # Console log
            cat = event.get("category", "?")
            title = event.get("title", "?")
            level = event.get("level", "info")
            body = event.get("body", "")[:80].replace("\n", " ")
            dur = event.get("duration_ms")
            dur_str = f" ({dur}ms)" if dur else ""
            turn = event.get("turn_id", 0)
            try:
                ts = datetime.fromtimestamp(int(event["timestamp"]) / 1000).strftime("%H:%M:%S")
            except (ValueError, TypeError):
                ts = "??:??:??"
            lvl = {"error": "!!", "warn": "??", "info": "  ", "debug": ".."}
            print(f"  {ts} T{turn:02d} [{lvl.get(level, '  ')}] {title}: {body}{dur_str}")


# ─── Cowork awareness ────────────────────────────────────────────────────────

def find_cowork_state():
    """Scan common locations for claude-split state files."""
    # Check current working directory and any active session project dirs
    candidates = []

    # Check all project dirs under ~/.claude/projects/
    for project_dir in PROJECTS_DIR.iterdir():
        if project_dir.is_dir():
            split_dir = project_dir / ".claude" / "split"
            if not split_dir.exists():
                # Try to resolve the actual project path from the dir name
                real_path = Path("/") / project_dir.name.replace("-", "/")
                split_dir = real_path / ".claude" / "split"
            candidates.append(split_dir)

    # Also check active sessions for their CWD
    for sess in find_active_sessions():
        cwd = sess.get("cwd", "")
        if cwd:
            candidates.append(Path(cwd) / ".claude" / "split")

    for split_dir in candidates:
        state_file = split_dir / "state.json"
        handshake_file = split_dir / "handshake.json"
        if state_file.exists() or handshake_file.exists():
            return split_dir

    return None


def read_cowork_status(split_dir):
    """Read handshake + state into a cowork status event."""
    result = {"handshake": None, "tasks": None, "sessions": {}}

    handshake_file = split_dir / "handshake.json"
    if handshake_file.exists():
        try:
            hs = json.loads(handshake_file.read_text())
            sessions = hs.get("sessions", {})
            ready_count = sum(1 for s in sessions.values() if s.get("status") == "ready")
            waiting_count = sum(1 for s in sessions.values() if s.get("status") == "waiting")

            if ready_count >= 2:
                result["handshake"] = "green"
            elif waiting_count > 0:
                result["handshake"] = "yellow"
            else:
                result["handshake"] = "red"

            result["sessions"] = sessions
        except (json.JSONDecodeError, KeyError):
            result["handshake"] = "red"

    state_file = split_dir / "state.json"
    if state_file.exists():
        try:
            state = json.loads(state_file.read_text())
            tasks = state.get("tasks", [])
            result["tasks"] = {
                "open": len([t for t in tasks if t.get("status") == "open"]),
                "claimed": len([t for t in tasks if t.get("status") == "claimed"]),
                "done": len([t for t in tasks if t.get("status") == "done"]),
                "total": len(tasks),
            }
            result["state_sessions"] = state.get("sessions", {})
            result["log"] = state.get("log", [])[-5:]
        except (json.JSONDecodeError, KeyError):
            pass

    return result


_last_cowork_status = None


async def watch_cowork():
    """Poll cowork state and broadcast changes."""
    global _last_cowork_status
    while True:
        split_dir = find_cowork_state()
        if split_dir:
            status = read_cowork_status(split_dir)
            status_key = json.dumps(status, sort_keys=True)

            if status_key != _last_cowork_status:
                _last_cowork_status = status_key

                # Build event
                hs = status["handshake"] or "none"
                session_names = list(status.get("sessions", {}).keys())
                tasks = status.get("tasks")
                task_str = ""
                if tasks:
                    task_str = f" | tasks: {tasks['done']}/{tasks['total']} done"

                event = {
                    "category": "cowork",
                    "level": "info",
                    "title": "Cowork",
                    "body": f"[{hs.upper()}] {', '.join(session_names) or 'no sessions'}{task_str}",
                    "timestamp": int(time.time() * 1000),
                    "uuid": f"cowork-{int(time.time())}",
                    "type": "cowork_status",
                    "turn_id": 0,
                    "seq": 0,
                    "icon": "person.2.fill" if hs == "green" else "person.2.slash" if hs == "red" else "person.2.wave.2",
                    "color": "green" if hs == "green" else "red" if hs == "red" else "yellow",
                    "metadata": {
                        "handshake": hs,
                        "sessions": session_names,
                        "tasks": tasks,
                        "split_dir": str(split_dir),
                    },
                }

                await broadcast(event)
                print(f"  [COWORK] {hs.upper()}: {', '.join(session_names) or 'none'}{task_str}")

        await asyncio.sleep(2)


_watch_task: asyncio.Task | None = None


async def watch_for_new_sessions(port, initial_path=None):
    global _watch_task
    current_path = initial_path
    while True:
        latest = find_session_jsonl()
        if latest and latest != current_path:
            current_path = latest
            session_name = latest.stem[:8]
            print(f"\n  [*] New active session detected: {session_name}...")
            # Cancel old watcher before starting a new one
            if _watch_task and not _watch_task.done():
                _watch_task.cancel()
                try:
                    await _watch_task
                except asyncio.CancelledError:
                    pass
            event_history.clear()
            _watch_task = asyncio.create_task(watch_session(latest))
        await asyncio.sleep(2)


async def main(port, session_id=None):
    if session_id:
        jsonl_path = find_session_jsonl(session_id)
        if not jsonl_path:
            print(f"[!] Session not found: {session_id}")
            return
    else:
        jsonl_path = find_session_jsonl()
        if not jsonl_path:
            print("[!] No active session found")
            return

    session_name = jsonl_path.stem[:8]

    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
    except Exception:
        local_ip = "127.0.0.1"
    finally:
        s.close()

    print(f"""
  ┌─────────────────────────────────────────┐
  │  Claude Code Monitor v2                 │
  │                                         │
  │  WebSocket:  ws://{local_ip}:{port}  │
  │  Session:    {session_name}...                  │
  │  Features:   turns, severity, durations │
  │                                         │
  └─────────────────────────────────────────┘
""")

    server = await websockets.serve(
        handle_client, "0.0.0.0", port,
        ping_interval=20, ping_timeout=10,
    )

    global _watch_task
    _watch_task = asyncio.create_task(watch_session(jsonl_path))
    session_watch = asyncio.create_task(watch_for_new_sessions(port, initial_path=jsonl_path))
    cowork_watch = asyncio.create_task(watch_cowork())

    try:
        await asyncio.gather(session_watch, cowork_watch)
    except KeyboardInterrupt:
        print("\n  [*] Shutting down.")
        server.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Claude Code Monitor Server")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--session", help="Specific session UUID")
    args = parser.parse_args()

    try:
        asyncio.run(main(args.port, args.session))
    except KeyboardInterrupt:
        pass
