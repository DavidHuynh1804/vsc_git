#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

export function generateLatestJson({
  version,
  notes = "",
  pubDate = new Date().toISOString(),
  repoOwner = "DavidHuynh1804",
  repoName = "vsc_git",
  artifactsDir,
}) {
  const downloadBase = `https://github.com/${repoOwner}/${repoName}/releases/download/v${version}`;

  const manifest = {
    version,
    notes,
    pub_date: pubDate,
    platforms: {},
  };

  if (!artifactsDir || !fs.existsSync(artifactsDir)) {
    return manifest;
  }

  // Scan for files and .sig files
  const files = fs.readdirSync(artifactsDir);

  for (const file of files) {
    if (file.endsWith(".sig")) continue;

    const sigFile = `${file}.sig`;
    const sigPath = path.join(artifactsDir, sigFile);

    if (fs.existsSync(sigPath)) {
      const signature = fs.readFileSync(sigPath, "utf-8").trim();
      const url = `${downloadBase}/${encodeURIComponent(file)}`;

      // Match platform
      if (file.includes("universal-apple-darwin") || (file.endsWith(".app.tar.gz") && !file.includes("aarch64") && !file.includes("x86_64"))) {
        manifest.platforms["darwin-universal"] = { signature, url };
        manifest.platforms["darwin-aarch64"] = { signature, url };
        manifest.platforms["darwin-x86_64"] = { signature, url };
      } else if (file.includes("aarch64-apple-darwin") || file.includes("aarch64.app.tar.gz")) {
        manifest.platforms["darwin-aarch64"] = { signature, url };
      } else if (file.includes("x86_64-apple-darwin") || file.includes("x86_64.app.tar.gz")) {
        manifest.platforms["darwin-x86_64"] = { signature, url };
      } else if (file.includes("x64") || file.includes("x86_64") || file.endsWith(".nsis.zip") || file.endsWith(".msi.zip")) {
        manifest.platforms["windows-x86_64"] = { signature, url };
      }
    }
  }

  return manifest;
}

// CLI execution
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  let version = null;
  let notes = "";
  let dir = ".";
  let out = "latest.json";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--version" && args[i + 1]) version = args[++i];
    else if (args[i] === "--notes" && args[i + 1]) notes = args[++i];
    else if (args[i] === "--dir" && args[i + 1]) dir = args[++i];
    else if (args[i] === "--out" && args[i + 1]) out = args[++i];
  }

  if (!version) {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
    version = pkg.version;
  }

  const result = generateLatestJson({ version, notes, artifactsDir: dir });
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n", "utf-8");
  console.log(`Generated ${out}:`);
  console.log(JSON.stringify(result, null, 2));
}
