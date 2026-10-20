/**
 * Builds the debug app binary the "real" E2E suite drives.
 *
 * The binary loads its frontend from `devUrl` baked in at compile time, so we
 * override it with `TAURI_CONFIG` to point at the suite's dedicated dev-server
 * port (5273) instead of the developer default (5173). This keeps the suite
 * independent from any other vite instance running for the same repo.
 *
 * Run via `pnpm e2e:real` (which builds first) or directly before re-running
 * `playwright test -c playwright.real.config.ts`.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_URL = "http://127.0.0.1:5273";

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    console.error(`[e2e-real] '${command} ${args.join(" ")}' failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

run("node", ["scripts/build-sidecars.mjs"]);
run("cargo", ["build", "-p", "vsc_git"], {
  TAURI_CONFIG: JSON.stringify({ build: { devUrl: DEV_URL } }),
});

console.log(`[e2e-real] debug binary ready (devUrl ${DEV_URL})`);
