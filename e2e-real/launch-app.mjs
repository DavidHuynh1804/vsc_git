/**
 * Playwright webServer command for the real E2E suite.
 *
 * Spawns the debug app binary with the E2E bridge enabled and keeps it alive
 * for the whole test run. Playwright polls http://127.0.0.1:<port>/ready until
 * it returns 200 (a real round-trip into the app webview), so tests only start
 * once the backend is actually answering.
 */
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binary = path.join(repoRoot, "target", "debug", "vsc_git");
const bridgePort = Number(process.env.E2E_BRIDGE_PORT ?? 9321);
const readyUrl = `http://127.0.0.1:${bridgePort}/ready`;

if (!existsSync(binary)) {
  console.error(
    `[e2e-real] app binary not found at ${binary}\n` +
      "[e2e-real] build it first: node e2e-real/build-app.mjs (or use 'pnpm e2e:real')"
  );
  process.exit(1);
}

/** Kills a leftover app from a previous run that still holds the bridge port. */
function killStaleApp() {
  let output = "";
  try {
    output = execSync(`lsof -nP -iTCP:${bridgePort} -sTCP:LISTEN -t`, {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return; // nothing listening
  }
  if (!output) return;
  for (const pid of output.split("\n")) {
    let comm = "";
    try {
      comm = execSync(`ps -p ${pid} -o comm=`, { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
    } catch {
      continue;
    }
    if (comm.includes("vsc_git")) {
      console.log(`[e2e-real] killing stale app process ${pid} holding port ${bridgePort}`);
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {
        // already gone
      }
    } else {
      console.error(
        `[e2e-real] port ${bridgePort} is held by '${comm}' (pid ${pid}); refusing to kill it`
      );
      process.exit(1);
    }
  }
}

killStaleApp();

// Isolated HOME (keep in sync with E2E_HOME in helpers/constants.ts): the app's
// settings.json, recent repos and git config all live here, never in the real HOME.
const e2eHome = path.join(os.tmpdir(), "vsc-git-e2e-real", "home");
rmSync(e2eHome, { recursive: true, force: true });
mkdirSync(e2eHome, { recursive: true });
writeFileSync(
  path.join(e2eHome, ".gitconfig"),
  "[user]\n\tname = E2E Bot\n\temail = e2e@test.local\n[init]\n\tdefaultBranch = main\n"
);

const child = spawn(binary, [], {
  cwd: repoRoot,
  env: {
    ...process.env,
    HOME: e2eHome,
    XDG_CONFIG_HOME: path.join(e2eHome, ".config"),
    GIT_CONFIG_NOSYSTEM: "1",
    VSC_GIT_E2E_BRIDGE_PORT: String(bridgePort),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (data) => process.stdout.write(`[app] ${data}`));
child.stderr.on("data", (data) => process.stderr.write(`[app] ${data}`));

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    child.kill("SIGKILL");
  } catch {
    // already gone
  }
  process.exit(code);
}
process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
child.on("exit", (code, signal) => {
  if (shuttingDown) return;
  console.error(`[e2e-real] app exited unexpectedly (code=${code}, signal=${signal})`);
  process.exit(1);
});

const deadline = Date.now() + 120_000;
let ready = false;
while (Date.now() < deadline && child.exitCode === null) {
  try {
    const response = await fetch(readyUrl, { signal: AbortSignal.timeout(2000) });
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    // not up yet
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
}

if (!ready) {
  console.error("[e2e-real] app did not become ready within 120s");
  shutdown(1);
}
console.log(`[e2e-real] app is ready (bridge on 127.0.0.1:${bridgePort})`);

// Keep the process alive; Playwright kills it when the run ends.
setInterval(() => {}, 1 << 30);
