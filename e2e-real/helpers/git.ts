/**
 * Runs the *real* git CLI against fixture repositories. All assertions about
 * repository state go through these helpers, so specs verify actual git state
 * rather than the app's own view of it.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { E2E_HOME } from "./constants";

/** Same isolated HOME the app runs with, so test-side git ignores the user's ~/.gitconfig. */
export function isolatedHomeEnv(): Record<string, string> {
  return {
    HOME: E2E_HOME,
    XDG_CONFIG_HOME: path.join(E2E_HOME, ".config"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

export interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function gitRaw(cwd: string, args: string[]): GitResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...isolatedHomeEnv(),
      GIT_TERMINAL_PROMPT: "0",
      // Read-only queries (notably `git status`) must not write the index for
      // stat refreshes: that takes `.git/index.lock` and races the app's own
      // mutating commands (stash apply, stage, …), which then fail with
      // IndexLocked. Required locks for real mutations are still taken.
      GIT_OPTIONAL_LOCKS: "0",
      // Deterministic identity for commits made by tests themselves.
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "E2E Bot",
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "e2e@test.local",
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? "E2E Bot",
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? "e2e@test.local",
    },
  });
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Runs git and returns trimmed stdout; throws on non-zero exit. */
export function git(cwd: string, args: string[]): string {
  const result = gitRaw(cwd, args);
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd} (exit ${result.status}):\n${result.stderr}`
    );
  }
  return result.stdout.trim();
}

export function gitAllowFail(cwd: string, args: string[]): GitResult {
  return gitRaw(cwd, args);
}

export function headSha(cwd: string): string {
  return git(cwd, ["rev-parse", "HEAD"]);
}

export function shortSha(cwd: string, ref = "HEAD"): string {
  return git(cwd, ["rev-parse", "--short", ref]);
}

export function currentBranch(cwd: string): string {
  return git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

export function commitCount(cwd: string, ref = "HEAD"): number {
  return Number(git(cwd, ["rev-list", "--count", ref]));
}

export function logSubjects(cwd: string, count = 10): string[] {
  return git(cwd, ["log", `-${count}`, "--format=%s"]).split("\n").filter(Boolean);
}

export function statusPorcelain(cwd: string): string {
  return gitPreserveLeading(cwd, ["status", "--porcelain"]);
}

/**
 * Like `git`, but strips only the trailing newline. Porcelain output encodes
 * state in leading columns (e.g. " M" = worktree-only change vs. "M " =
 * staged change), so a full trim would corrupt the first line.
 */
function gitPreserveLeading(cwd: string, args: string[]): string {
  const result = gitRaw(cwd, args);
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd} (exit ${result.status}):\n${result.stderr}`
    );
  }
  return result.stdout.replace(/\n+$/, "");
}

/**
 * Multi-line diagnostic snapshot of a repo, embedded in assertion failure
 * messages so a failure reports the exact state (index vs. HEAD vs. worktree,
 * stashes) at the moment it happened.
 */
export function repoStateSnapshot(cwd: string): string {
  const porcelain = gitRaw(cwd, ["status", "--porcelain"]);
  const cached = gitRaw(cwd, ["diff", "--cached", "--name-status"]);
  const stash = gitRaw(cwd, ["stash", "list"]);
  return [
    `cwd: ${cwd}`,
    `status --porcelain (exit ${porcelain.status}):\n${porcelain.stdout}`,
    `diff --cached --name-status (exit ${cached.status}):\n${cached.stdout}`,
    `stash list (exit ${stash.status}):\n${stash.stdout}`,
  ].join("\n");
}

export function stagedPaths(cwd: string): string[] {
  return git(cwd, ["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
}

export function unstagedPaths(cwd: string): string[] {
  return git(cwd, ["diff", "--name-only"]).split("\n").filter(Boolean);
}

export function localBranches(cwd: string): string[] {
  return git(cwd, ["branch", "--format=%(refname:short)"]).split("\n").filter(Boolean);
}

export function stashMessages(cwd: string): string[] {
  // `--format=%gs` resolves the stash through its reflog, so while a stash
  // drop/pop is deleting refs/stash git can transiently report
  // "fatal: bad revision 'refs/stash'". Retry briefly rather than failing.
  for (let attempt = 0; ; attempt++) {
    const result = gitRaw(cwd, ["stash", "list", "--format=%gs"]);
    if (result.status === 0) {
      return result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    }
    const transient = /bad revision 'refs\/stash'/.test(result.stderr);
    if (!transient || attempt >= 9) {
      throw new Error(
        `git stash list failed in ${cwd} (exit ${result.status}):\n${result.stderr}`
      );
    }
    sleepSync(30);
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function stagedDiff(cwd: string, path?: string): string {
  const args = ["diff", "--cached", "-U0", "--"];
  if (path) args.push(path);
  return git(cwd, args);
}

export function worktreeDiff(cwd: string, path?: string): string {
  const args = ["diff", "-U0", "--"];
  if (path) args.push(path);
  return git(cwd, args);
}

export function showFile(cwd: string, rev: string, path: string): string {
  return git(cwd, ["show", `${rev}:${path}`]);
}

export function revParse(cwd: string, ref: string): string {
  return git(cwd, ["rev-parse", ref]);
}

/** Like {@link revParse} but returns "" for a missing ref, so it is safe inside `expect.poll`. */
export function tryRevParse(cwd: string, ref: string): string {
  const r = gitAllowFail(cwd, ["rev-parse", "-q", "--verify", `${ref}^{commit}`]);
  return r.status === 0 ? r.stdout.trim() : "";
}
