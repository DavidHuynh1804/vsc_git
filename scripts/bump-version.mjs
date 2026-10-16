#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseSemver(ver) {
  const match = ver.match(SEMVER_REGEX);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null,
  };
}

export function bumpSemver(current, type) {
  const parsed = parseSemver(current);
  if (!parsed) {
    throw new Error(`Current version "${current}" is not valid semver`);
  }

  switch (type) {
    case "major":
      return `${parsed.major + 1}.0.0`;
    case "minor":
      return `${parsed.major}.${parsed.minor + 1}.0`;
    case "patch":
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
    default:
      if (SEMVER_REGEX.test(type)) {
        return type;
      }
      throw new Error(
        `Invalid version or bump type "${type}". Expected major, minor, patch, or valid semver X.Y.Z`
      );
  }
}

export function bumpVersion(targetVersion, options = { dryRun: false }) {
  const pkgPath = path.join(repoRoot, "package.json");
  const tauriConfPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
  const tauriCargoPath = path.join(repoRoot, "src-tauri", "Cargo.toml");
  const rootCargoPath = path.join(repoRoot, "Cargo.toml");

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const currentVersion = pkg.version;
  const newVersion = bumpSemver(currentVersion, targetVersion);

  console.log(`Bumping version: ${currentVersion} -> ${newVersion}`);

  if (options.dryRun) {
    console.log("[dry-run] Would update files to version", newVersion);
    return newVersion;
  }

  // 1. package.json
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
  console.log(`Updated ${path.relative(repoRoot, pkgPath)}`);

  // 2. src-tauri/tauri.conf.json
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf-8"));
  tauriConf.version = newVersion;
  fs.writeFileSync(
    tauriConfPath,
    JSON.stringify(tauriConf, null, 2) + "\n",
    "utf-8"
  );
  console.log(`Updated ${path.relative(repoRoot, tauriConfPath)}`);

  // 3. src-tauri/Cargo.toml ([package] version = "...")
  let tauriCargo = fs.readFileSync(tauriCargoPath, "utf-8");
  tauriCargo = tauriCargo.replace(
    /(\[package\][\s\S]*?version\s*=\s*")[^"]+(")/,
    `$1${newVersion}$2`
  );
  fs.writeFileSync(tauriCargoPath, tauriCargo, "utf-8");
  console.log(`Updated ${path.relative(repoRoot, tauriCargoPath)}`);

  // 4. Root Cargo.toml ([workspace.package] version = "...")
  if (fs.existsSync(rootCargoPath)) {
    let rootCargo = fs.readFileSync(rootCargoPath, "utf-8");
    if (rootCargo.includes("[workspace.package]")) {
      rootCargo = rootCargo.replace(
        /(\[workspace\.package\][\s\S]*?version\s*=\s*")[^"]+(")/,
        `$1${newVersion}$2`
      );
      fs.writeFileSync(rootCargoPath, rootCargo, "utf-8");
      console.log(`Updated ${path.relative(repoRoot, rootCargoPath)}`);
    }
  }

  // 5. Update Cargo.lock to match
  try {
    execSync("cargo check -p vsc_git --quiet", { cwd: repoRoot, stdio: "ignore" });
    console.log("Updated Cargo.lock");
  } catch {
    // Non-fatal if cargo check fails in headless environment
  }

  return newVersion;
}

// CLI execution
const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const target = args[0];
  const dryRun = args.includes("--dry-run");

  if (!target || target === "--help" || target === "-h") {
    console.log("Usage: node scripts/bump-version.mjs <patch|minor|major|X.Y.Z> [--dry-run]");
    process.exit(1);
  }

  try {
    bumpVersion(target, { dryRun });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
