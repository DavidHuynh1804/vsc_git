#!/usr/bin/env node

import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

function runBench(size, isRelease = true) {
  const flag = isRelease ? "--release" : "";
  console.log(`Running benchmark for size: ${size} (${isRelease ? "release" : "debug"})...`);

  const cmd = `cargo run ${flag} --bin bench_cmds -- --create ${size} --json`;
  const raw = execSync(cmd, {
    cwd: repoRoot,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "inherit"],
  });

  const lines = raw.trim().split("\n");
  const jsonLine = lines.find((l) => l.startsWith("{") && l.endsWith("}"));
  if (!jsonLine) {
    throw new Error(`Could not parse JSON output from bench_cmds: ${raw}`);
  }

  return JSON.parse(jsonLine);
}

function printTable(results) {
  console.log("\n### Benchmark Performance Results (Spec 14)\n");
  console.log("| Command / Operation | Small Repo (100 commits) | Medium/Large Repo (20k commits, 5k files) | Target Threshold |");
  console.log("|---|---|---|---|");

  const small = results.small || {};
  const large = results.large || {};

  const format = (v) => (v !== undefined ? `${v.toFixed(2)} ms` : "N/A");

  console.log(`| **Status** (\`status_v2\`) | ${format(small.status_ms)} | ${format(large.status_ms)} | < 500 ms |`);
  console.log(`| **Graph First Page** (500 rows) | ${format(small.graph_ms)} | ${format(large.graph_ms)} | < 300 ms |`);
  console.log(`| **Log** (100 commits) | ${format(small.log_ms)} | ${format(large.log_ms)} | < 200 ms |`);
  console.log(`| **Diff** (HEAD detail & diff) | ${format(small.diff_ms)} | ${format(large.diff_ms)} | < 100 ms |`);
  console.log("\n*Repo generated on-the-fly using \`git fast-import\` and purged immediately after benchmark.*");
}

async function main() {
  const args = process.argv.slice(2);
  let size = "small";
  let isRelease = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--size" && args[i + 1]) {
      size = args[++i];
    } else if (args[i] === "--all") {
      size = "all";
    } else if (args[i] === "--debug") {
      isRelease = false;
    }
  }

  const results = {};

  if (size === "small" || size === "all") {
    results.small = runBench("small", isRelease);
  }

  if (size === "large" || size === "all") {
    results.large = runBench("large", isRelease);
  }

  printTable(results);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
