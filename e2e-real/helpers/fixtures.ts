/**
 * Builds throwaway real git repositories for the "real" E2E suite.
 *
 * Every fixture is a genuine git repo under the OS temp dir (one unique root
 * per test run), so tests can drive the app and then assert with the real git
 * CLI. Nothing here touches the developer's repos.
 */
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { git, gitAllowFail } from "./git";

const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const runRoot = path.join(os.tmpdir(), "vsc-git-e2e-real", runStamp);

export function fixtureRunRoot(): string {
  return runRoot;
}

function fixtureDir(name: string): string {
  const dir = path.join(runRoot, name);
  mkdirSync(dir, { recursive: true });
  // Resolve symlinks (e.g. /var -> /private/var on macOS) so paths match what
  // the app reports after `git rev-parse --show-toplevel`.
  return realpathSync(dir);
}

export function writeFile(dir: string, relPath: string, content: string): void {
  const target = path.join(dir, relPath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

export function readFile(dir: string, relPath: string): string {
  return readFileSync(path.join(dir, relPath), "utf8");
}

export function initRepo(name: string): string {
  const dir = fixtureDir(name);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.name", "E2E Bot"]);
  git(dir, ["config", "user.email", "e2e@test.local"]);
  return dir;
}

export function commitAll(dir: string, message: string): string {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]);
}

export interface BaseRepo {
  dir: string;
  firstSha: string;
  secondSha: string;
}

/** Two commits on `main`, with README.md and src/app.ts. */
export function createBaseRepo(name: string): BaseRepo {
  const dir = initRepo(name);
  writeFile(dir, "README.md", "# Fixture\n\nhello world\n");
  writeFile(dir, "src/app.ts", "export const value = 1;\n");
  const firstSha = commitAll(dir, "chore: initial commit");
  writeFile(dir, "src/app.ts", "export const value = 1;\nexport const added = 2;\n");
  const secondSha = commitAll(dir, "feat: add value");
  return { dir, firstSha, secondSha };
}

export interface DirtyRepo extends BaseRepo {
  untrackedPath: string;
}

/** Base repo plus one unstaged modification and one untracked file. */
export function createDirtyRepo(name: string): DirtyRepo {
  const base = createBaseRepo(name);
  writeFile(base.dir, "README.md", "# Fixture\n\nhello world\n\nlocal modification\n");
  writeFile(base.dir, "untracked.txt", "brand new file\n");
  return { ...base, untrackedPath: "untracked.txt" };
}

/** A 12-line file with two modified lines (2 and 10) far enough apart to be separate hunks. */
export function createTwoHunkRepo(name: string): BaseRepo {
  const dir = initRepo(name);
  const lines = Array.from({ length: 12 }, (_, i) => `line${String(i + 1).padStart(2, "0")}`);
  const original = `${lines.join("\n")}\n`;
  writeFile(dir, "notes.txt", original);
  const firstSha = commitAll(dir, "chore: notes");
  writeFile(dir, "README.md", "# Two-hunk fixture\n");
  const secondSha = commitAll(dir, "chore: readme");
  // Uncommitted worktree changes: two separate hunks (lines 2 and 10).
  const modified = [...lines];
  modified[1] = "changed02";
  modified[9] = "changed10";
  writeFile(dir, "notes.txt", `${modified.join("\n")}\n`);
  return { dir, firstSha, secondSha };
}

export interface BranchRepo extends BaseRepo {
  featureSha: string;
}

/** `main` (1 commit) plus branch `feature` with one extra commit. */
export function createBranchRepo(name: string): BranchRepo {
  const dir = initRepo(name);
  writeFile(dir, "README.md", "# Branch fixture\n");
  const firstSha = commitAll(dir, "chore: base");
  git(dir, ["checkout", "-q", "-b", "feature"]);
  writeFile(dir, "feature.txt", "feature work\n");
  const featureSha = commitAll(dir, "feat: pick me");
  git(dir, ["checkout", "-q", "main"]);
  return { dir, firstSha, secondSha: firstSha, featureSha };
}

export interface StashRepo extends BaseRepo {
  untrackedPath: string;
}

/** Base repo with a modified tracked file and an untracked file to stash. */
export function createStashRepo(name: string): StashRepo {
  const base = createBaseRepo(name);
  writeFile(base.dir, "README.md", "# Fixture\n\nhello world\n\nstash me\n");
  writeFile(base.dir, "wip.txt", "work in progress\n");
  return { ...base, untrackedPath: "wip.txt" };
}

export interface ConflictRepo {
  dir: string;
  baseSha: string;
  oursSha: string;
  theirsSha: string;
}

/** Two branches (`ours`, `theirs`) that both edit file.txt line 2 from a common base. */
export function createConflictRepo(name: string): ConflictRepo {
  const dir = initRepo(name);
  writeFile(dir, "file.txt", "line1\nline2\nline3\n");
  const baseSha = commitAll(dir, "chore: base");
  git(dir, ["checkout", "-q", "-b", "theirs"]);
  writeFile(dir, "file.txt", "line1\nincoming change\nline3\n");
  const theirsSha = commitAll(dir, "feat: theirs");
  git(dir, ["checkout", "-q", "main"]);
  git(dir, ["checkout", "-q", "-b", "ours"]);
  writeFile(dir, "file.txt", "line1\ncurrent change\nline3\n");
  const oursSha = commitAll(dir, "feat: ours");
  return { dir, baseSha, oursSha, theirsSha };
}

/** Starts the conflicting merge in the fixture (worktree left in conflicted state). */
export function startConflictMerge(repo: ConflictRepo): void {
  // git merge exits with status 1 on conflicts; that is the expected outcome.
  gitAllowFail(repo.dir, ["merge", "theirs"]);
}

export interface RemoteRepo {
  bare: string;
  repo: string;
}

/** Bare repo plus a clone that tracks `origin/main`. */
export function createRemoteRepo(name: string): RemoteRepo {
  const bare = fixtureDir(`${name}-bare`);
  git(bare, ["init", "-q", "--bare", "-b", "main"]);
  const repo = initRepo(`${name}-repo`);
  writeFile(repo, "README.md", "# Remote fixture\n");
  commitAll(repo, "chore: initial");
  git(repo, ["remote", "add", "origin", bare]);
  git(repo, ["push", "-q", "-u", "origin", "main"]);
  return { bare, repo };
}

/** A second clone of the bare repo, for simulating remote-side changes. */
export function cloneRemote(bare: string, name: string): string {
  const dir = fixtureDir(name);
  git(dir, ["clone", "-q", bare, "."]);
  git(dir, ["config", "user.name", "E2E Remote Bot"]);
  git(dir, ["config", "user.email", "remote@test.local"]);
  return dir;
}

/** Commits and pushes a new file from a remote-side clone. */
export function pushRemoteCommit(other: string, relPath: string, content: string, message: string): string {
  writeFile(other, relPath, content);
  const sha = commitAll(other, message);
  git(other, ["push", "-q", "origin", "main"]);
  return sha;
}
