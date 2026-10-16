#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const isWindows = process.platform === "win32";
const binaryName = isWindows ? "vsc_git.exe" : "vsc_git";

const candidates = [
  path.join(repoRoot, "target", "debug", binaryName),
  path.join(repoRoot, "src-tauri", "target", "debug", binaryName),
];

if (process.argv[2]) {
  candidates.unshift(path.resolve(process.argv[2]));
}

const binaryPath = candidates.find((p) => fs.existsSync(p));

if (!binaryPath) {
  console.error("Binary not found. Checked locations:\n" + candidates.map((c) => ` - ${c}`).join("\n"));
  process.exit(1);
}

console.log(`Starting smoke test for binary: ${binaryPath}`);
const RUN_MS = 10000;
const MIN_MS = 6000;
const WATCHDOG_MS = 25000;

const startTime = Date.now();
const child = spawn(binaryPath, [], {
  cwd: repoRoot,
  env: {
    ...process.env,
    VSC_GIT_SMOKE_EXIT_AFTER_MS: String(RUN_MS),
    RUST_BACKTRACE: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";

child.stdout.on("data", (chunk) => {
  const str = chunk.toString();
  stdout += str;
  process.stdout.write(str);
});

child.stderr.on("data", (chunk) => {
  const str = chunk.toString();
  stderr += str;
  process.stderr.write(str);
});

const watchdog = setTimeout(() => {
  console.error(`\nSmoke test timed out after ${WATCHDOG_MS}ms without self-exit. Terminating process.`);
  child.kill("SIGKILL");
  process.exit(1);
}, WATCHDOG_MS);

child.on("error", (err) => {
  clearTimeout(watchdog);
  console.error("\nFailed to spawn process:", err);
  process.exit(1);
});

child.on("close", (code, signal) => {
  clearTimeout(watchdog);
  const duration = Date.now() - startTime;
  console.log(`\nProcess finished in ${duration}ms with exit code: ${code}, signal: ${signal}`);

  const combined = (stdout + "\n" + stderr).toLowerCase();
  if (combined.includes("panicked at") || combined.includes("panic:")) {
    console.error("\nFAIL: Application panicked during startup!");
    process.exit(1);
  }

  if (code !== 0) {
    console.error(`\nFAIL: Application exited with non-zero exit code: ${code}`);
    process.exit(1);
  }

  if (duration < MIN_MS) {
    console.error(`\nFAIL: Application exited prematurely after only ${duration}ms (expected >= ${MIN_MS}ms)!`);
    process.exit(1);
  }

  console.log(`\nSUCCESS: App startup smoke test passed! Running ~${Math.round(duration / 1000)}s without panic.`);
  process.exit(0);
});
