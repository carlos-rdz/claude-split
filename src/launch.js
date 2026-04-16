import { execSync, spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSessionName } from "./state.js";

export async function launch(options = {}) {
  const os = process.platform;
  const cwd = process.cwd();
  const nameA = options.nameA || "alpha";
  const nameB = options.nameB || "beta";
  const single = options.single || false;
  const cliPath = join(import.meta.dirname, "..", "bin", "cli.js");

  // Verify claude CLI exists
  try {
    execSync("which claude", { stdio: "ignore" });
  } catch {
    console.error("Claude CLI not found. Install: npm install -g @anthropic-ai/claude-code");
    process.exit(1);
  }

  const makeScript = (name, color, delay = 0) => {
    const colorCode = name === nameA ? "\\033[1;36m" : "\\033[1;33m";
    const script = `#!/bin/bash
cd "${cwd}"
echo -e "${colorCode}"
echo "  ┌─────────────────────────────┐"
echo "  │  Claude Split — ${name.padEnd(12)}│"
echo "  └─────────────────────────────┘"
echo -e "\\033[0m"
${delay > 0 ? `sleep ${delay}` : ""}
node "${cliPath}" ping --name ${name} &
sleep 2
echo ""
echo "Tell Claude: Read .claude/split/README.md — I'm ${name}."
echo ""
claude
`;
    const path = join(tmpdir(), `claude-split-${name}-${Date.now()}.sh`);
    writeFileSync(path, script);
    execSync(`chmod +x "${path}"`);
    return path;
  };

  const scriptA = makeScript(nameA, "cyan");
  const scriptB = single ? null : makeScript(nameB, "yellow", 3);

  console.log(`Launching session${single ? "" : "s"} in ${cwd}...`);

  if (os === "darwin") {
    // macOS — Terminal.app
    const sessions = single ? `
      do script "bash ${scriptA}"
    ` : `
      set w1 to do script "bash ${scriptA}"
      delay 1
      set w2 to do script "bash ${scriptB}"
      set bounds of window 1 to {0, 25, 960, 800}
      set bounds of window 2 to {960, 25, 1920, 800}
    `;

    execSync(`osascript -e '
      tell application "Terminal"
        activate
        ${sessions}
      end tell
    '`);
    console.log(single ? `Opened terminal: ${nameA}` : `Opened two terminals: ${nameA} + ${nameB}`);

  } else if (os === "linux") {
    const term = ["gnome-terminal", "xterm", "konsole"].find((t) => {
      try { execSync(`which ${t}`, { stdio: "ignore" }); return true; } catch { return false; }
    });

    if (!term) {
      console.log("No supported terminal found. Run manually:");
      console.log(`  bash ${scriptA}`);
      if (!single) console.log(`  bash ${scriptB}`);
      return;
    }

    if (term === "gnome-terminal") {
      spawn("gnome-terminal", ["--title", `Split: ${nameA}`, "--", "bash", scriptA], { detached: true, stdio: "ignore" });
      if (!single) spawn("gnome-terminal", ["--title", `Split: ${nameB}`, "--", "bash", scriptB], { detached: true, stdio: "ignore" });
    } else {
      spawn(term, ["-e", `bash ${scriptA}`], { detached: true, stdio: "ignore" });
      if (!single) spawn(term, ["-e", `bash ${scriptB}`], { detached: true, stdio: "ignore" });
    }
    console.log(`Opened ${single ? "1" : "2"} ${term} window(s)`);

  } else {
    console.log("Unsupported platform. Run manually:");
    console.log(`  bash ${scriptA}`);
    if (!single) console.log(`  bash ${scriptB}`);
  }
}
