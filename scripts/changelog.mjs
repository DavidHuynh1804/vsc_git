#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const TYPE_MAPPING = {
  feat: "Features",
  fix: "Bug Fixes",
  perf: "Performance Improvements",
  refactor: "Code Refactoring",
  docs: "Documentation",
  ci: "Continuous Integration",
  build: "Build System",
  test: "Tests",
  chore: "Chores & Maintenance",
};

export function parseCommit(line) {
  // Format: SHA|subject|author|date
  const parts = line.split("|");
  if (parts.length < 4) return null;

  const [sha, fullSubject, author, date] = parts;
  const subject = fullSubject.trim();

  // Skip merge commits
  if (subject.startsWith("Merge pull request") || subject.startsWith("Merge branch") || subject.startsWith("Merge remote-tracking")) {
    return null;
  }

  // Conventional commit regex: type(scope)!: message
  const match = subject.match(/^([a-z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/i);
  if (!match) {
    return {
      sha: sha.substring(0, 7),
      type: "other",
      scope: null,
      breaking: false,
      description: subject,
      author,
      date,
    };
  }

  const [, rawType, scope, breakingExcl, description] = match;
  return {
    sha: sha.substring(0, 7),
    type: rawType.toLowerCase(),
    scope: scope || null,
    breaking: Boolean(breakingExcl),
    description: description.trim(),
    author,
    date,
  };
}

export function generateChangelogSection({ version, date, fromRef, toRef = "HEAD" }) {
  let range = "";
  if (fromRef) {
    range = `${fromRef}..${toRef}`;
  } else {
    // Find initial commit
    try {
      const rootCommit = execSync("git rev-list --max-parents=0 HEAD", {
        cwd: repoRoot,
        encoding: "utf-8",
      }).trim().split("\n")[0];
      range = `${rootCommit}..${toRef}`;
    } catch {
      range = toRef;
    }
  }

  let logOutput = "";
  try {
    logOutput = execSync(`git log ${range} --format="%H|%s|%an|%ad" --date=short`, {
      cwd: repoRoot,
      encoding: "utf-8",
    });
  } catch (err) {
    console.error(`Failed to execute git log for range ${range}:`, err.message);
    return "";
  }

  const lines = logOutput.trim().split("\n").filter(Boolean);
  const commits = lines.map(parseCommit).filter(Boolean);

  const groups = {
    breaking: [],
    feat: [],
    fix: [],
    perf: [],
    refactor: [],
    docs: [],
    ci: [],
    build: [],
    test: [],
    chore: [],
    other: [],
  };

  for (const c of commits) {
    if (c.breaking) {
      groups.breaking.push(c);
    }
    if (groups[c.type]) {
      groups[c.type].push(c);
    } else {
      groups.other.push(c);
    }
  }

  const linesOut = [];
  linesOut.push(`## [${version}] - ${date}\n`);

  if (groups.breaking.length > 0) {
    linesOut.push("### BREAKING CHANGES\n");
    for (const c of groups.breaking) {
      const scopePart = c.scope ? `**${c.scope}**: ` : "";
      linesOut.push(`- ${scopePart}${c.description} (${c.sha})`);
    }
    linesOut.push("");
  }

  const order = ["feat", "fix", "perf", "refactor", "docs", "ci", "build", "test", "chore"];
  for (const type of order) {
    const list = groups[type];
    if (list && list.length > 0) {
      linesOut.push(`### ${TYPE_MAPPING[type] || type}\n`);
      for (const c of list) {
        const scopePart = c.scope ? `**${c.scope}**: ` : "";
        linesOut.push(`- ${scopePart}${c.description} (${c.sha})`);
      }
      linesOut.push("");
    }
  }

  return linesOut.join("\n").trim();
}

export function updateChangelogFile(newSection, filePath = path.join(repoRoot, "CHANGELOG.md")) {
  let content = "";
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, "utf-8");
  }

  const header = "# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n";

  if (!content) {
    content = `${header}${newSection}\n`;
  } else if (content.startsWith("# Changelog")) {
    const headerEnd = content.indexOf("\n\n");
    if (headerEnd !== -1) {
      const rest = content.slice(headerEnd + 2).trimStart();
      content = `${content.slice(0, headerEnd + 2)}${newSection}\n\n${rest}`;
    } else {
      content = `${content}\n\n${newSection}\n`;
    }
  } else {
    content = `${header}${newSection}\n\n${content}`;
  }

  fs.writeFileSync(filePath, content.trim() + "\n", "utf-8");
}

// CLI execution
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  let version = null;
  let fromRef = null;
  let toRef = "HEAD";
  let shouldWrite = false;
  let date = new Date().toISOString().split("T")[0];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--version" && args[i + 1]) {
      version = args[++i];
    } else if (args[i] === "--from" && args[i + 1]) {
      fromRef = args[++i];
    } else if (args[i] === "--to" && args[i + 1]) {
      toRef = args[++i];
    } else if (args[i] === "--date" && args[i + 1]) {
      date = args[++i];
    } else if (args[i] === "--write") {
      shouldWrite = true;
    }
  }

  if (!version) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
      version = pkg.version || "0.1.0";
    } catch {
      version = "0.1.0";
    }
  }

  if (!fromRef) {
    try {
      fromRef = execSync("git describe --tags --abbrev=0", {
        cwd: repoRoot,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      fromRef = null;
    }
  }

  const section = generateChangelogSection({ version, date, fromRef, toRef });
  if (shouldWrite) {
    updateChangelogFile(section);
    console.log(`Updated CHANGELOG.md for version ${version}`);
  } else {
    console.log(section);
  }
}
