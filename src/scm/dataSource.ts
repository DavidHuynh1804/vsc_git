import {
  RepoStatus,
  LineSelection,
  CommitOptions,
  FileRev,
  RefList,
  StashItem,
  StashPushOptions,
  JobId,
  JobProgress,
  StatusEntry,
  AppError,
  BranchInfo,
  StatusEntryKind,
  RefItem,
} from "./types";
import { commands, events, AppFileRev, AppError as BindingsAppError } from "@/bindings";
import { reportAppError } from "@/utils/errors";
import { isMock } from "@/env";
import { defaultAiDataSource } from "@/integrations/ai";
import { applySelectedLines } from "./diffUtils";

export interface ScmDataSource {
  getStatus(): Promise<RepoStatus>;
  stage(paths: string[]): Promise<void>;
  unstage(paths: string[]): Promise<void>;
  discard(paths: string[]): Promise<void>;
  stageAll(): Promise<void>;
  unstageAll(): Promise<void>;
  discardAll(): Promise<void>;
  stageSelections(path: string, selections: LineSelection[]): Promise<void>;
  unstageSelections(path: string, selections: LineSelection[]): Promise<void>;
  revertSelections(path: string, selections: LineSelection[]): Promise<void>;
  fileContent(path: string, rev: FileRev): Promise<string>;
  saveFile(path: string, content: string): Promise<void>;
  commit(options: CommitOptions): Promise<void>;
  lastCommitMessage(): Promise<string>;
  getDraftMessage(repoPath?: string): Promise<string>;
  setDraftMessage(message: string, repoPath?: string): Promise<void>;
  getRefs(): Promise<RefList>;
  checkout(refName: string): Promise<void>;
  createBranch(name: string, startPoint?: string): Promise<void>;
  renameBranch(oldName: string, newName: string): Promise<void>;
  deleteBranch(name: string, force?: boolean): Promise<void>;
  setUpstream(branch: string, upstream: string): Promise<void>;
  listStashes(): Promise<StashItem[]>;
  stashPush(options: StashPushOptions): Promise<void>;
  stashApply(index: number): Promise<void>;
  stashPop(index: number): Promise<void>;
  stashDrop(index: number): Promise<void>;
  stashDiff(index: number): Promise<string>;
  fetch(remote?: string): Promise<JobId>;
  pull(opts?: { remote?: string; branch?: string; rebase?: boolean }): Promise<JobId>;
  push(opts?: { remote?: string; branch?: string; forceWithLease?: boolean }): Promise<JobId>;
  sync(): Promise<JobId>;
  subscribeJobProgress(jobId: JobId, callback: (progress: JobProgress) => void): () => void;
  cancelJob(jobId: JobId): Promise<void>;
  aiGenerateCommit(onChunk?: (chunk: string) => void): Promise<string>;
  openInEditor(path: string, line?: number): Promise<void>;
  reveal(path: string): Promise<void>;
  onStatusChanged(cb: () => void): () => void;
}

interface MockFileRecord {
  head: string;
  index: string;
  worktree: string;
  isUntracked?: boolean;
  isConflict?: boolean;
}

export class MockScmDataSource implements ScmDataSource {
  private files: Map<string, MockFileRecord> = new Map();
  private draftMessages: Map<string, string> = new Map();
  private lastCommit = "feat(core): initialize application structure";
  private listeners: Set<() => void> = new Set();
  private jobSubscribers: Map<JobId, Set<(p: JobProgress) => void>> = new Map();
  private cancelledJobs: Set<JobId> = new Set();

  private headBranch = "main";
  private branches = ["main", "feat/m1-frontend", "feat/m0-app-shell"];
  private remotes = ["origin/main", "origin/feat/m0-app-shell"];
  private tags = ["v0.1.0"];
  private stashes: StashItem[] = [
    {
      index: 0,
      message: "WIP on main: partial refactor",
      branch: "main",
      date: "2 hours ago",
      hash: "stash@{0}",
    },
  ];

  constructor() {
    this.initMockFiles();
  }

  private initMockFiles() {
    // 1. Modified file with staged + unstaged changes
    this.files.set("src/app.ts", {
      head: `import { createServer } from "http";

const port = 3000;
const app = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Hello World\\n");
});

app.listen(port, () => {
  console.log(\`Server running at http://localhost:\${port}/\`);
});`,
      index: `import { createServer } from "http";

const port = 3000;
function getGreeting(name: string): string {
  return \`Hello \${name}!\\n\`;
}

const app = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Hello World\\n");
});

app.listen(port, () => {
  console.log(\`Server running at http://localhost:\${port}/\`);
});`,
      worktree: `import { createServer } from "http";

const port = 8080;
function getGreeting(name: string): string {
  return \`Hello \${name}!\\n\`;
}

const app = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200);
    return res.end("OK");
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(getGreeting("World"));
});

app.listen(port, () => {
  console.log(\`Server running at http://localhost:\${port}/\`);
});`,
    });

    // 2. Staged added file
    this.files.set("README.md", {
      head: `# vsc_git\n\nA modern Git client for developers.\n`,
      index: `# vsc_git\n\nA modern, lightning-fast Git client built with Tauri and React.\n\n## Features\n- Monaco Diff Editor\n- Source Control View\n`,
      worktree: `# vsc_git\n\nA modern, lightning-fast Git client built with Tauri and React.\n\n## Features\n- Monaco Diff Editor\n- Source Control View\n`,
    });

    // 3. Untracked file
    this.files.set("src/utils/format.ts", {
      head: "",
      index: "",
      worktree: `export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}`,
      isUntracked: true,
    });

    // 4. Merge conflict file
    this.files.set("config/settings.json", {
      head: `{\n  "theme": "system",\n  "version": 1\n}\n`,
      index: `{\n  "theme": "dark",\n  "version": 2\n}\n`,
      worktree: `{\n<<<<<<< HEAD\n  "theme": "dark",\n=======\n  "theme": "light",\n>>>>>>> incoming-branch\n  "version": 2\n}\n`,
      isConflict: true,
    });
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // ignore listener errors
      }
    }
  }

  onStatusChanged(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async getStatus(): Promise<RepoStatus> {
    const entries: StatusEntry[] = [];

    for (const [path, record] of this.files.entries()) {
      if (record.isConflict) {
        entries.push({
          path,
          kind: {
            type: "Unmerged",
            conflict_type: "both modified",
          },
        });
        continue;
      }

      if (record.isUntracked) {
        entries.push({
          path,
          kind: { type: "Untracked" },
        });
        continue;
      }

      const stagedStatus =
        record.head === record.index
          ? "Unmodified"
          : record.head === ""
          ? "Added"
          : record.index === ""
          ? "Deleted"
          : "Modified";

      const unstagedStatus =
        record.index === record.worktree
          ? "Unmodified"
          : record.worktree === ""
          ? "Deleted"
          : "Modified";

      if (stagedStatus !== "Unmodified" || unstagedStatus !== "Unmodified") {
        entries.push({
          path,
          kind: {
            type: "Ordinary",
            staged: stagedStatus,
            unstaged: unstagedStatus,
          },
        });
      }
    }

    return {
      branch: {
        oid: "a1b2c3d4e5f6",
        head: this.headBranch,
        upstream: `origin/${this.headBranch}`,
        ahead: 1,
        behind: 0,
        is_detached: false,
        is_initial: false,
      },
      entries,
    };
  }

  async stage(paths: string[]): Promise<void> {
    for (const path of paths) {
      const rec = this.files.get(path);
      if (rec) {
        rec.index = rec.worktree;
        rec.isUntracked = false;
        rec.isConflict = false;
      }
    }
    this.notify();
  }

  async unstage(paths: string[]): Promise<void> {
    for (const path of paths) {
      const rec = this.files.get(path);
      if (rec) {
        rec.index = rec.head;
        if (rec.head === "" && rec.worktree !== "") {
          rec.isUntracked = true;
        }
      }
    }
    this.notify();
  }

  async discard(paths: string[]): Promise<void> {
    for (const path of paths) {
      const rec = this.files.get(path);
      if (rec) {
        if (rec.isUntracked) {
          this.files.delete(path);
        } else {
          rec.worktree = rec.index !== "" ? rec.index : rec.head;
        }
      }
    }
    this.notify();
  }

  async stageAll(): Promise<void> {
    for (const rec of this.files.values()) {
      rec.index = rec.worktree;
      rec.isUntracked = false;
      rec.isConflict = false;
    }
    this.notify();
  }

  async unstageAll(): Promise<void> {
    for (const rec of this.files.values()) {
      rec.index = rec.head;
      if (rec.head === "" && rec.worktree !== "") {
        rec.isUntracked = true;
      }
    }
    this.notify();
  }

  async discardAll(): Promise<void> {
    for (const [path, rec] of Array.from(this.files.entries())) {
      if (rec.isUntracked) {
        this.files.delete(path);
      } else {
        rec.worktree = rec.index !== "" ? rec.index : rec.head;
      }
    }
    this.notify();
  }

  async stageSelections(path: string, selections: LineSelection[]): Promise<void> {
    const rec = this.files.get(path);
    if (!rec) return;
    rec.index = applySelectedLines(rec.index, rec.worktree, selections, "stage");
    this.notify();
  }

  async unstageSelections(path: string, selections: LineSelection[]): Promise<void> {
    const rec = this.files.get(path);
    if (!rec) return;
    rec.index = applySelectedLines(rec.head, rec.index, selections, "unstage");
    this.notify();
  }

  async revertSelections(path: string, selections: LineSelection[]): Promise<void> {
    const rec = this.files.get(path);
    if (!rec) return;
    rec.worktree = applySelectedLines(rec.index, rec.worktree, selections, "revert");
    this.notify();
  }

  async fileContent(path: string, rev: FileRev): Promise<string> {
    const rec = this.files.get(path);
    if (!rec) return "";
    switch (rev.kind) {
      case "Head":
        return rec.head;
      case "Index":
        return rec.index;
      case "Worktree":
        return rec.worktree;
      default:
        return rec.head;
    }
  }

  async saveFile(path: string, content: string): Promise<void> {
    const rec = this.files.get(path);
    if (rec) {
      rec.worktree = content;
    } else {
      this.files.set(path, {
        head: "",
        index: "",
        worktree: content,
        isUntracked: true,
      });
    }
    this.notify();
  }

  async commit(options: CommitOptions): Promise<void> {
    if (options.all) {
      await this.stageAll();
    }
    for (const rec of this.files.values()) {
      rec.head = rec.index;
    }
    this.lastCommit = options.message;
    this.notify();
  }

  async lastCommitMessage(): Promise<string> {
    return this.lastCommit;
  }

  async getDraftMessage(repoPath = "default"): Promise<string> {
    return this.draftMessages.get(repoPath) ?? "";
  }

  async setDraftMessage(message: string, repoPath = "default"): Promise<void> {
    this.draftMessages.set(repoPath, message);
  }

  async getRefs(): Promise<RefList> {
    return {
      head: this.headBranch,
      branches: this.branches.map((b) => ({
        name: b,
        fullName: `refs/heads/${b}`,
        kind: "local",
        isHead: b === this.headBranch,
        upstream: `origin/${b}`,
        ahead: b === this.headBranch ? 1 : 0,
        behind: 0,
      })),
      remotes: this.remotes.map((r) => ({
        name: r,
        fullName: `refs/remotes/${r}`,
        kind: "remote",
        remote: "origin",
      })),
      tags: this.tags.map((t) => ({
        name: t,
        fullName: `refs/tags/${t}`,
        kind: "tag",
      })),
    };
  }

  async checkout(refName: string): Promise<void> {
    // Check if dirty
    const status = await this.getStatus();
    const hasUnstaged = status.entries.some((e) => {
      if (e.kind.type === "Ordinary") {
        return e.kind.unstaged !== "Unmodified";
      }
      return false;
    });

    if (hasUnstaged) {
      const err: AppError = {
        kind: "DirtyWorktree",
        message: "Your local changes would be overwritten by checkout.",
        hint: {
          label: "Stash & Checkout",
          action: "stash_and_checkout",
        },
      };
      throw err;
    }

    this.headBranch = refName;
    this.notify();
  }

  async createBranch(name: string, _startPoint?: string): Promise<void> {
    if (!this.branches.includes(name)) {
      this.branches.push(name);
    }
    this.headBranch = name;
    this.notify();
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    const idx = this.branches.indexOf(oldName);
    if (idx !== -1) {
      this.branches[idx] = newName;
      if (this.headBranch === oldName) {
        this.headBranch = newName;
      }
      this.notify();
    }
  }

  async deleteBranch(name: string, _force = false): Promise<void> {
    this.branches = this.branches.filter((b) => b !== name);
    this.notify();
  }

  async setUpstream(_branch: string, upstream: string): Promise<void> {
    if (!this.remotes.includes(upstream)) {
      this.remotes.push(upstream);
    }
    this.notify();
  }

  async listStashes(): Promise<StashItem[]> {
    return [...this.stashes];
  }

  async stashPush(options: StashPushOptions): Promise<void> {
    const newStash: StashItem = {
      index: this.stashes.length,
      message: options.message || "WIP on " + this.headBranch,
      branch: this.headBranch,
      date: "Just now",
      hash: `stash@{${this.stashes.length}}`,
    };
    this.stashes.unshift(newStash);
    // Reset worktree to head
    for (const rec of this.files.values()) {
      if (options.includeUntracked && rec.isUntracked) {
        rec.worktree = "";
      } else if (!rec.isUntracked) {
        rec.worktree = rec.head;
        rec.index = rec.head;
      }
    }
    this.notify();
  }

  async stashApply(index: number): Promise<void> {
    const target = this.stashes[index];
    if (target) {
      // simulate applying
      this.notify();
    }
  }

  async stashPop(index: number): Promise<void> {
    if (index >= 0 && index < this.stashes.length) {
      this.stashes.splice(index, 1);
      // Re-index remaining
      this.stashes.forEach((s, idx) => (s.index = idx));
      this.notify();
    }
  }

  async stashDrop(index: number): Promise<void> {
    if (index >= 0 && index < this.stashes.length) {
      this.stashes.splice(index, 1);
      this.stashes.forEach((s, idx) => (s.index = idx));
      this.notify();
    }
  }

  async stashDiff(index: number): Promise<string> {
    return `diff --git a/stash_${index}.txt b/stash_${index}.txt\n--- a/stash_${index}.txt\n+++ b/stash_${index}.txt\n@@ -1,3 +1,3 @@\n-old line\n+stashed modification\n`;
  }

  private createJob(title: string): JobId {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.jobSubscribers.set(jobId, new Set());

    // Simulate progress ticks
    let percent = 10;
    const interval = setInterval(() => {
      if (this.cancelledJobs.has(jobId) || percent >= 100) {
        clearInterval(interval);
        const subs = this.jobSubscribers.get(jobId);
        if (subs) {
          for (const sub of subs) {
            sub({
              jobId,
              title,
              percent: 100,
              message: this.cancelledJobs.has(jobId) ? "Cancelled" : "Completed",
              cancelable: false,
            });
          }
        }
        return;
      }

      percent += 30;
      const subs = this.jobSubscribers.get(jobId);
      if (subs) {
        for (const sub of subs) {
          sub({
            jobId,
            title,
            percent: Math.min(100, percent),
            message: `Processing... (${Math.min(100, percent)}%)`,
            cancelable: true,
          });
        }
      }
    }, 200);

    return jobId;
  }

  async fetch(remote = "origin"): Promise<JobId> {
    return this.createJob(`Fetching ${remote}`);
  }

  async pull(): Promise<JobId> {
    return this.createJob("Pulling changes");
  }

  async push(): Promise<JobId> {
    return this.createJob("Pushing changes");
  }

  async sync(): Promise<JobId> {
    return this.createJob("Syncing with remote");
  }

  subscribeJobProgress(jobId: JobId, callback: (progress: JobProgress) => void): () => void {
    const set = this.jobSubscribers.get(jobId) ?? new Set();
    set.add(callback);
    this.jobSubscribers.set(jobId, set);
    return () => set.delete(callback);
  }

  async cancelJob(jobId: JobId): Promise<void> {
    this.cancelledJobs.add(jobId);
  }

  async aiGenerateCommit(onChunk?: (chunk: string) => void): Promise<string> {
    const fullMessage =
      "feat(scm): add source control view and Monaco diff editor\n\n- Group changes into Merge, Staged, Changes, and Untracked\n- Support line and hunk level staging with Monaco gutter\n- Add branch and stash views with interactive dialogs";

    if (!onChunk) {
      return fullMessage;
    }

    const words = fullMessage.split(" ");
    let accumulated = "";
    for (const word of words) {
      accumulated += (accumulated ? " " : "") + word;
      onChunk(accumulated);
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 25);
      await promise;
    }
    return fullMessage;
  }

  async openInEditor(_path: string, _line?: number): Promise<void> {
    // mock external editor invocation
  }

  async reveal(_path: string): Promise<void> {
    // mock reveal in file manager
  }
}

/**
 * TauriScmDataSource: wraps Tauri invoke commands according to Spec 11.
 */
export class TauriScmDataSource implements ScmDataSource {
  private listeners: Set<() => void> = new Set();
  private debounceTimer: number | null = null;
  private unlistenStatusPromise: Promise<() => void> | null = null;
  private unlistenRefsPromise: Promise<() => void> | null = null;
  // Jobs can finish before a caller subscribes, so remember recent completions.
  private finishedJobs = new Map<string, { success: boolean; error: string | null }>();
  private unlistenJobDonePromise: Promise<() => void> | null = null;

  constructor() {
    this.setupWatcher();
  }

  private setupWatcher() {
    if (isMock()) return;
    const notifyDebounced = () => {
      clearTimeout(this.debounceTimer ?? undefined);
      this.debounceTimer = window.setTimeout(() => {
        this.notifyListeners();
      }, 300);
    };

    this.unlistenStatusPromise = events.repoStatusChanged.listen(() => {
      notifyDebounced();
    });

    this.unlistenRefsPromise = events.repoRefsChanged.listen(() => {
      notifyDebounced();
    });

    this.unlistenJobDonePromise = events.jobDone.listen((e) => {
      this.finishedJobs.set(e.payload.id, { success: e.payload.success, error: e.payload.error });
      if (this.finishedJobs.size > 100) {
        const oldest = this.finishedJobs.keys().next().value;
        if (oldest !== undefined) this.finishedJobs.delete(oldest);
      }
    });

    if (typeof window !== "undefined") {
      window.addEventListener("focus", () => {
        this.notifyListeners();
      });
    }
  }

  dispose(): void {
    clearTimeout(this.debounceTimer ?? undefined);
    this.unlistenStatusPromise?.then((u) => u());
    this.unlistenRefsPromise?.then((u) => u());
    this.unlistenJobDonePromise?.then((u) => u());
    this.listeners.clear();
  }
  private handleError(error: BindingsAppError): never {
    reportAppError(error);
    throw error;
  }


  private notifyListeners() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // ignore
      }
    }
  }

  onStatusChanged(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  async getStatus(): Promise<RepoStatus> {
    const res = await commands.getStatus();
    if (res.status === "error") {
      this.handleError(res.error);
    }
    const branch: BranchInfo = {
      head: res.data.branch.head ?? "",
      upstream: res.data.branch.upstream ?? null,
      ahead: res.data.branch.ahead,
      behind: res.data.branch.behind,
    };
    const entries: StatusEntry[] = res.data.entries.map((entry) => {
      let kind: StatusEntryKind;
      if (entry.conflict_type || entry.kind === "Unmerged") {
        kind = {
          type: "Unmerged",
          conflict_type: entry.conflict_type || "both modified",
        };
      } else if (entry.kind === "Untracked") {
        kind = { type: "Untracked" };
      } else if (entry.kind === "Renamed" || entry.orig_path) {
        kind = {
          type: "RenamedOrCopied",
          staged: entry.staged ? "Renamed" : "Unmodified",
          unstaged: entry.unstaged ? "Modified" : "Unmodified",
          is_rename: true,
          score: 100,
          orig_path: entry.orig_path ?? entry.path,
        };
      } else {
        kind = {
          type: "Ordinary",
          staged: entry.staged
            ? entry.kind === "Added"
              ? "Added"
              : entry.kind === "Deleted"
              ? "Deleted"
              : "Modified"
            : "Unmodified",
          unstaged: entry.unstaged
            ? entry.kind === "Deleted"
              ? "Deleted"
              : "Modified"
            : "Unmodified",
        };
      }
      return { path: entry.path, kind };
    });
    return { branch, entries };
  }

  async stage(paths: string[]): Promise<void> {
    const res = await commands.stage(paths);
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async unstage(paths: string[]): Promise<void> {
    const res = await commands.unstage(paths);
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async discard(paths: string[]): Promise<void> {
    const res = await commands.discard(paths);
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async stageAll(): Promise<void> {
    const res = await commands.stageAll();
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async unstageAll(): Promise<void> {
    const res = await commands.unstageAll();
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async discardAll(): Promise<void> {
    const status = await this.getStatus();
    const paths = status.entries.map((e) => e.path);
    if (paths.length > 0) {
      await this.discard(paths);
    }
  }

  async stageSelections(path: string, selections: LineSelection[]): Promise<void> {
    const res = await commands.stageSelections(path, selections);
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async unstageSelections(path: string, selections: LineSelection[]): Promise<void> {
    const res = await commands.unstageSelections(path, selections);
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async revertSelections(path: string, selections: LineSelection[]): Promise<void> {
    const res = await commands.revertSelections(path, selections);
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async fileContent(path: string, rev: FileRev): Promise<string> {
    let appRev: AppFileRev;
    switch (rev.kind) {
      case "Head":
        appRev = "Head";
        break;
      case "Index":
        appRev = "Index";
        break;
      case "Worktree":
        appRev = "Worktree";
        break;
      case "Commit":
        appRev = { Commit: rev.sha };
        break;
      case "Stage":
        appRev = { Stage: rev.n };
        break;
    }
    const res = await commands.getFileContent(path, appRev);
    if (res.status === "error") {
      this.handleError(res.error);
    }
    return res.data;
  }

  async saveFile(path: string, content: string): Promise<void> {
    const res = await commands.saveWorktreeFile(path, content);
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async commit(options: CommitOptions): Promise<void> {
    const res = await commands.commit({
      message: options.message,
      amend: options.amend ?? false,
      signoff: options.signoff ?? false,
      no_verify: options.no_verify ?? false,
      all: options.all ?? false,
    });
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async lastCommitMessage(): Promise<string> {
    const res = await commands.lastCommitMessage();
    if (res.status === "error") {
      this.handleError(res.error);
    }
    return res.data;
  }

  async getDraftMessage(_repoPath?: string): Promise<string> {
    const res = await commands.getDraftMessage();
    if (res.status === "error") {
      this.handleError(res.error);
    }
    return res.data;
  }

  async setDraftMessage(message: string, _repoPath?: string): Promise<void> {
    const res = await commands.setDraftMessage(message);
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async getRefs(): Promise<RefList> {
    const res = await commands.listRefs();
    if (res.status === "error") {
      this.handleError(res.error);
    }
    const branches: RefItem[] = [];
    const remotes: RefItem[] = [];
    const tags: RefItem[] = [];
    let head: string | null = null;
    for (const r of res.data) {
      if (r.kind === "LocalBranch" || r.kind === "Head") {
        branches.push({
          name: r.name,
          fullName: `refs/heads/${r.name}`,
          kind: "local",
          isHead: r.is_head,
          upstream: r.upstream,
          ahead: r.ahead,
          behind: r.behind,
          targetOid: r.target_sha,
        });
        if (r.is_head) {
          head = r.name;
        }
      } else if (r.kind === "RemoteBranch") {
        const slashIdx = r.name.indexOf("/");
        const remoteName = slashIdx !== -1 ? r.name.slice(0, slashIdx) : "origin";
        remotes.push({
          name: r.name,
          fullName: `refs/remotes/${r.name}`,
          kind: "remote",
          remote: remoteName,
          targetOid: r.target_sha,
        });
      } else if (r.kind === "Tag") {
        tags.push({
          name: r.name,
          fullName: `refs/tags/${r.name}`,
          kind: "tag",
          targetOid: r.target_sha,
        });
      }
    }
    return { branches, remotes, tags, head };
  }

  async checkout(refName: string): Promise<void> {
    const res = await commands.checkout(refName);
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async createBranch(name: string, startPoint?: string): Promise<void> {
    const res = await commands.createBranch(name, startPoint ?? null);
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    const res = await commands.renameBranch(oldName, newName);
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async deleteBranch(name: string, force?: boolean): Promise<void> {
    const res = await commands.deleteBranch(name, force ?? false);
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async setUpstream(branch: string, upstream: string): Promise<void> {
    const res = await commands.setUpstream(branch, upstream);
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async listStashes(): Promise<StashItem[]> {
    const res = await commands.listStashes();
    if (res.status === "error") {
      this.handleError(res.error);
    }
    return res.data.map((s) => ({
      index: s.index,
      message: s.subject,
      branch: s.name,
      date: s.date,
      hash: s.commit_id,
    }));
  }

  async stashPush(options: StashPushOptions): Promise<void> {
    const res = await commands.stashPush({
      message: options.message ?? null,
      include_untracked: options.includeUntracked ?? false,
      paths: options.paths ?? [],
    });
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async stashApply(index: number): Promise<void> {
    const res = await commands.stashApply(index);
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async stashPop(index: number): Promise<void> {
    const res = await commands.stashPop(index);
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async stashDrop(index: number): Promise<void> {
    const res = await commands.stashDrop(index);
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async stashDiff(index: number): Promise<string> {
    const res = await commands.stashDiff(index);
    if (res.status === "error") {
      this.handleError(res.error);
    }
    return res.data;
  }

  async fetch(remote?: string): Promise<JobId> {
    const res = await commands.fetch(remote ?? null);
    if (res.status === "error") {
      this.handleError(res.error);
    }
    return res.data;
  }

  async pull(opts?: { remote?: string; branch?: string; rebase?: boolean }): Promise<JobId> {
    const mode = opts?.rebase ? "Rebase" : "Default";
    const res = await commands.pull(mode);
    if (res.status === "error") {
      this.handleError(res.error);
    }
    return res.data;
  }

  async push(opts?: { remote?: string; branch?: string; forceWithLease?: boolean }): Promise<JobId> {
    let remote = opts?.remote ?? null;
    let branch = opts?.branch ?? null;
    let setUpstream = false;
    if (!branch) {
      // A branch without an upstream must be published with `push -u <remote> <branch>`.
      const { branch: info } = await this.getStatus();
      if (info.head && !info.upstream) {
        remote = remote ?? "origin";
        branch = info.head;
        setUpstream = true;
      }
    }
    const res = await commands.push({
      remote,
      branch,
      set_upstream: setUpstream,
      force_with_lease: opts?.forceWithLease ?? false,
      tags: false,
    });
    if (res.status === "error") {
      this.handleError(res.error);
    }
    return res.data;
  }

  async sync(): Promise<JobId> {
    const res = await commands.sync();
    if (res.status === "error") {
      this.handleError(res.error);
    }
    return res.data;
  }

  subscribeJobProgress(jobId: JobId, callback: (progress: JobProgress) => void): () => void {
    let active = true;
    const emitDone = (done: { success: boolean; error: string | null }) => {
      if (!active) return;
      active = false;
      callback({
        jobId,
        title: done.error ?? "Done",
        percent: 100,
        message: done.error ?? "Done",
        error: done.success ? undefined : done.error ?? "Operation failed",
      });
      unlistenProgressPromise.then((u) => u());
      unlistenDonePromise.then((u) => u());
    };
    const unlistenProgressPromise = events.jobProgress.listen((e) => {
      if (active && e.payload.id === jobId) {
        callback({
          jobId,
          title: e.payload.message,
          percent: e.payload.percent ?? undefined,
          message: e.payload.message,
        });
      }
    });
    const unlistenDonePromise = events.jobDone.listen((e) => {
      if (e.payload.id === jobId) {
        emitDone({ success: e.payload.success, error: e.payload.error });
      }
    });
    const alreadyDone = this.finishedJobs.get(jobId);
    if (alreadyDone) {
      emitDone(alreadyDone);
    } else {
      // Close the gap between the job starting and our listener being registered.
      void unlistenDonePromise.then(() => {
        const done = this.finishedJobs.get(jobId);
        if (done) emitDone(done);
      });
    }
    return () => {
      active = false;
      unlistenProgressPromise.then((u) => u());
      unlistenDonePromise.then((u) => u());
    };
  }

  async cancelJob(jobId: JobId): Promise<void> {
    const res = await commands.cancelJob(jobId);
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async aiGenerateCommit(onChunk?: (chunk: string) => void): Promise<string> {
    // Backend streams deltas; callers expect the accumulated message so far.
    let accumulated = "";
    return defaultAiDataSource.generateCommit((chunk) => {
      accumulated += chunk;
      onChunk?.(accumulated);
    });
  }

  async openInEditor(path: string, line?: number): Promise<void> {
    const res = await commands.openInEditor(path, line ?? null);
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }

  async reveal(path: string): Promise<void> {
    const res = await commands.revealInFileManager(path);
    if (res.status === "error") {
      this.handleError(res.error);
    }
  }
}
