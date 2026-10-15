#!/usr/bin/env node

/**
 * scripts/check-crate-age.mjs
 *
 * Supply-chain release-age policy checker for Rust crates.
 * Enforces that newly added or updated crates from crates.io are at least
 * min-days old (default 7 days) and not yanked.
 *
 * Zero external dependencies (Node >= 22).
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

export const DEFAULT_USER_AGENT =
  "vsc-git-crate-age-checker/1.0 (https://github.com/DavidHuynh1804/vsc_git)";

/**
 * Parse Cargo.lock content into an array of package objects.
 * Handles Cargo.lock v3 and v4 formats.
 */
export function parseCargoLock(content) {
  if (!content || typeof content !== "string") return [];
  const packages = [];
  let current = null;
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "[[package]]") {
      if (current && current.name && current.version) {
        packages.push(current);
      }
      current = { name: "", version: "", source: null };
      continue;
    }
    if (trimmed.startsWith("[") && trimmed !== "[[package]]") {
      if (current && current.name && current.version) {
        packages.push(current);
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const mName = trimmed.match(/^name\s*=\s*"([^"]+)"/);
    if (mName) {
      current.name = mName[1];
      continue;
    }
    const mVer = trimmed.match(/^version\s*=\s*"([^"]+)"/);
    if (mVer) {
      current.version = mVer[1];
      continue;
    }
    const mSrc = trimmed.match(/^source\s*=\s*"([^"]+)"/);
    if (mSrc) {
      current.source = mSrc[1];
      continue;
    }
  }

  if (current && current.name && current.version) {
    packages.push(current);
  }

  return packages;
}

/**
 * Filter crates.io packages that are new or changed version compared to base.
 * If basePkgs is null or undefined, returns all crates.io packages in current.
 */
export function diffPackages(currentPkgs, basePkgs) {
  const isCratesIo = (pkg) =>
    Boolean(
      pkg.source &&
        (pkg.source.includes("crates.io") ||
          pkg.source.startsWith("registry+"))
    );

  const currentCratesIo = (currentPkgs || []).filter(isCratesIo);

  if (!basePkgs) {
    return deduplicatePackages(currentCratesIo);
  }

  const baseSet = new Set(
    basePkgs
      .filter(isCratesIo)
      .map((p) => `${p.name}@${p.version}`)
  );

  const changedOrNew = currentCratesIo.filter(
    (p) => !baseSet.has(`${p.name}@${p.version}`)
  );

  return deduplicatePackages(changedOrNew);
}

function deduplicatePackages(pkgs) {
  const map = new Map();
  for (const p of pkgs) {
    const key = `${p.name}@${p.version}`;
    if (!map.has(key)) {
      map.set(key, p);
    }
  }
  return Array.from(map.values());
}

/**
 * Parse supply-chain allowlist file.
 * Each line: `<name>@<version> # <reason>`
 */
export function parseAllowlist(content) {
  const allowed = new Map();
  if (!content || typeof content !== "string") return allowed;
  const lines = content.split("\n");
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    const [rawEntry, ...commentParts] = line.split("#");
    const entry = rawEntry.trim();
    const reason = commentParts.join("#").trim();
    if (entry) {
      allowed.set(entry, reason || "Allowlisted");
    }
  }
  return allowed;
}

/**
 * Evaluate release age and yanked status of a crate version.
 */
export function evaluateVersionAge(versionInfo, minDays, nowMs = Date.now()) {
  if (!versionInfo || !versionInfo.created_at) {
    return {
      ok: false,
      reason: "Missing release timestamp",
      ageDays: 0,
    };
  }

  const createdMs = Date.parse(versionInfo.created_at);
  if (isNaN(createdMs)) {
    return {
      ok: false,
      reason: `Invalid created_at timestamp "${versionInfo.created_at}"`,
      ageDays: 0,
    };
  }

  const ageMs = nowMs - createdMs;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (versionInfo.yanked) {
    return {
      ok: false,
      reason: "Version is yanked on crates.io",
      ageDays,
    };
  }

  if (ageDays < minDays) {
    return {
      ok: false,
      reason: `Released ${ageDays < 0 ? "in the future" : `${ageDays.toFixed(1)}d ago`} (< ${minDays}d)`,
      ageDays,
    };
  }

  return {
    ok: true,
    ageDays,
  };
}

/**
 * Find the latest non-yanked version that satisfies the min-days policy.
 */
export function findSafeVersion(
  versionsList,
  violatedVersion,
  minDays,
  nowMs = Date.now()
) {
  if (!Array.isArray(versionsList)) return null;

  const minAgeMs = minDays * 24 * 60 * 60 * 1000;
  const candidates = [];

  for (const v of versionsList) {
    if (v.num === violatedVersion) continue;
    if (v.yanked) continue;
    const createdMs = Date.parse(v.created_at);
    if (isNaN(createdMs)) continue;
    const ageMs = nowMs - createdMs;
    if (ageMs >= minAgeMs) {
      candidates.push({ ...v, createdMs });
    }
  }

  if (candidates.length === 0) return null;

  // Newest eligible version first
  candidates.sort((a, b) => b.createdMs - a.createdMs);
  return candidates[0].num;
}

/**
 * Fetch wrapper with exponential backoff on 429 and 5xx.
 */
export async function fetchWithRetry(url, options = {}, retries = 2) {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt < retries) {
          const retryAfter = res.headers.get("retry-after");
          const delayMs = retryAfter
            ? parseFloat(retryAfter) * 1000
            : 500 * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, Math.min(delayMs, 5000)));
          attempt++;
          continue;
        }
      }
      return res;
    } catch (err) {
      if (attempt < retries) {
        attempt++;
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Concurrent map helper to avoid hammering the remote API.
 */
export async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Load Cargo.lock from git base ref.
 */
export function getBaseLockfile(baseRef, lockfilePath = "Cargo.lock") {
  if (!baseRef) return null;
  const candidates = [
    baseRef,
    `origin/${baseRef}`,
    baseRef.replace(/^origin\//, ""),
  ];
  for (const ref of candidates) {
    try {
      const output = execFileSync("git", ["show", `${ref}:${lockfilePath}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return { ref, content: output };
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Main checking routine.
 */
export async function runCheck(options = {}) {
  const {
    baseRef = process.env.BASE_REF || "origin/main",
    minDays = 7,
    lockfilePath = "Cargo.lock",
    allowlistPath = "supply-chain/crate-age-allow.txt",
    concurrency = 4,
    checkAll = false,
    userAgent = DEFAULT_USER_AGENT,
    nowMs = Date.now(),
  } = options;

  if (!fs.existsSync(lockfilePath)) {
    throw new Error(`Lockfile not found at ${lockfilePath}`);
  }

  const currentContent = fs.readFileSync(lockfilePath, "utf8");
  const currentPkgs = parseCargoLock(currentContent);

  let basePkgs = null;
  let resolvedBaseRef = null;

  if (!checkAll) {
    // Try candidate refs: baseRef, then origin/main, main, HEAD~1
    const candidateRefs = [baseRef, "origin/main", "main", "HEAD~1"].filter(
      Boolean
    );
    for (const ref of candidateRefs) {
      const result = getBaseLockfile(ref, lockfilePath);
      if (result) {
        resolvedBaseRef = result.ref;
        basePkgs = parseCargoLock(result.content);
        break;
      }
    }
  }

  const toCheck = diffPackages(currentPkgs, basePkgs);

  // Load allowlist
  let allowlist = new Map();
  if (fs.existsSync(allowlistPath)) {
    const allowContent = fs.readFileSync(allowlistPath, "utf8");
    allowlist = parseAllowlist(allowContent);
  }

  console.log(`Supply-chain policy: minimum crate release age = ${minDays} days`);
  if (checkAll) {
    console.log(`Mode: checking all packages in ${lockfilePath}`);
  } else if (resolvedBaseRef) {
    console.log(
      `Mode: diffing against base ref "${resolvedBaseRef}" (${toCheck.length} new or updated crate(s))`
    );
  } else {
    console.log(
      `Notice: no base ref could be resolved. Checking all crates.io packages (${toCheck.length} package(s))`
    );
  }

  if (toCheck.length === 0) {
    console.log("No new or updated crates.io packages to check. All clean!");
    return { ok: true, violations: [], allowlisted: [], totalChecked: 0 };
  }

  const headers = {
    "User-Agent": userAgent,
    Accept: "application/json",
  };

  const results = await mapConcurrent(toCheck, concurrency, async (pkg) => {
    const key = `${pkg.name}@${pkg.version}`;
    const allowReason = allowlist.get(key);

    const verUrl = `https://crates.io/api/v1/crates/${encodeURIComponent(
      pkg.name
    )}/${encodeURIComponent(pkg.version)}`;

    try {
      const res = await fetchWithRetry(verUrl, { headers });
      if (res.status === 404) {
        return {
          pkg,
          ok: false,
          reason: "Package or version not found on crates.io",
          ageDays: 0,
          allowlisted: Boolean(allowReason),
          allowReason,
          safeVersion: null,
        };
      }
      if (!res.ok) {
        return {
          pkg,
          ok: false,
          reason: `crates.io API error: HTTP ${res.status}`,
          ageDays: 0,
          allowlisted: Boolean(allowReason),
          allowReason,
          safeVersion: null,
        };
      }

      const json = await res.json();
      const versionData = json.version;
      const evaluation = evaluateVersionAge(versionData, minDays, nowMs);

      if (evaluation.ok) {
        return {
          pkg,
          ok: true,
          created_at: versionData.created_at,
          ageDays: evaluation.ageDays,
          allowlisted: false,
        };
      }

      // If not ok, find safe version
      let safeVersion = null;
      try {
        const listUrl = `https://crates.io/api/v1/crates/${encodeURIComponent(
          pkg.name
        )}/versions`;
        const listRes = await fetchWithRetry(listUrl, { headers });
        if (listRes.ok) {
          const listJson = await listRes.json();
          safeVersion = findSafeVersion(
            listJson.versions,
            pkg.version,
            minDays,
            nowMs
          );
        }
      } catch {
        // Safe version lookup is best-effort
      }

      return {
        pkg,
        ok: false,
        reason: evaluation.reason,
        created_at: versionData.created_at,
        ageDays: evaluation.ageDays,
        allowlisted: Boolean(allowReason),
        allowReason,
        safeVersion,
      };
    } catch (err) {
      return {
        pkg,
        ok: false,
        reason: `Network error: ${err.message}`,
        ageDays: 0,
        allowlisted: Boolean(allowReason),
        allowReason,
        safeVersion: null,
      };
    }
  });

  const violations = [];
  const allowlisted = [];

  for (const item of results) {
    if (!item.ok) {
      if (item.allowlisted) {
        allowlisted.push(item);
      } else {
        violations.push(item);
      }
    }
  }

  // Print summary
  if (allowlisted.length > 0) {
    console.log("\nAllowlisted packages:");
    for (const a of allowlisted) {
      console.log(
        `  - ${a.pkg.name}@${a.pkg.version}: ${a.allowReason} (${a.reason})`
      );
    }
  }

  if (violations.length > 0) {
    printViolationTable(violations);
    return {
      ok: false,
      violations,
      allowlisted,
      totalChecked: toCheck.length,
    };
  }

  console.log(
    `\nSuccess: checked ${toCheck.length} crate(s). All meet the release age policy (>= ${minDays} days).`
  );
  return {
    ok: true,
    violations: [],
    allowlisted,
    totalChecked: toCheck.length,
  };
}

/**
 * Format and print the violation table with remediation commands.
 */
function printViolationTable(violations) {
  console.error("\n" + "=".repeat(88));
  console.error("CRATE AGE POLICY VIOLATIONS DETECTED");
  console.error("=".repeat(88));
  console.error(
    "The following dependencies were published too recently or yanked:\n"
  );

  const colPackage = "Package";
  const colVer = "Version";
  const colDate = "Published";
  const colAge = "Age";
  const colReason = "Status / Reason";

  console.error(
    `${colPackage.padEnd(22)} ${colVer.padEnd(10)} ${colDate.padEnd(12)} ${colAge.padEnd(10)} ${colReason}`
  );
  console.error("-".repeat(88));

  for (const v of violations) {
    const pubDate = v.created_at ? v.created_at.slice(0, 10) : "unknown";
    const ageStr = v.ageDays ? `${v.ageDays.toFixed(1)}d` : "-";
    console.error(
      `${v.pkg.name.padEnd(22)} ${v.pkg.version.padEnd(10)} ${pubDate.padEnd(12)} ${ageStr.padEnd(10)} ${v.reason}`
    );

    const suggestion = v.safeVersion
      ? `cargo update -p ${v.pkg.name}@${v.pkg.version} --precise ${v.safeVersion}`
      : `(no prior safe version found; consider allowlist if emergency)`;

    console.error(`  --> Suggested fix: ${suggestion}\n`);

    // Emit GitHub Actions annotation if running in workflow
    if (process.env.GITHUB_ACTIONS) {
      console.error(
        `::error file=Cargo.lock::Crate ${v.pkg.name}@${v.pkg.version} violates supply-chain release-age policy: ${v.reason}. Fix: ${suggestion}`
      );
    }
  }

  console.error("-".repeat(88));
  console.error(
    "To resolve:\n" +
      "  1. Run the suggested `cargo update` command(s) to pin an eligible release.\n" +
      "  2. Or if this is an urgent zero-day patch, add `<name>@<version> # <reason>`\n" +
      "     to `supply-chain/crate-age-allow.txt`."
  );
  console.error("=".repeat(88) + "\n");
}

// CLI execution
const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const { values } = parseArgs({
    options: {
      base: { type: "string" },
      "min-days": { type: "string", default: "7" },
      lockfile: { type: "string", default: "Cargo.lock" },
      allowlist: { type: "string", default: "supply-chain/crate-age-allow.txt" },
      concurrency: { type: "string", default: "4" },
      all: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`
Usage: node scripts/check-crate-age.mjs [options]

Options:
  --base <ref>          Base git ref to compare Cargo.lock against (default: $BASE_REF or origin/main)
  --min-days <days>     Minimum release age in days (default: 7)
  --lockfile <path>     Path to Cargo.lock (default: Cargo.lock)
  --allowlist <path>    Path to allowlist file (default: supply-chain/crate-age-allow.txt)
  --concurrency <num>   Max concurrent crates.io requests (default: 4)
  --all                 Check all crates.io dependencies in Cargo.lock regardless of base
  -h, --help            Show this help message
`);
    process.exit(0);
  }

  runCheck({
    baseRef: values.base,
    minDays: parseFloat(values["min-days"]) || 7,
    lockfilePath: values.lockfile,
    allowlistPath: values.allowlist,
    concurrency: parseInt(values.concurrency, 10) || 4,
    checkAll: values.all,
  })
    .then((result) => {
      if (!result.ok) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
}
