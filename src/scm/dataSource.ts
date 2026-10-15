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
} from "./types";
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
  // TODO: connect with Tauri commands once feat/m1-backend bindings are generated
  private mockFallback = new MockScmDataSource();

  async getStatus(): Promise<RepoStatus> {
    // Spec 11: get_status() -> RepoStatus
    return this.mockFallback.getStatus();
  }

  async stage(paths: string[]): Promise<void> {
    // Spec 11: stage(paths)
    return this.mockFallback.stage(paths);
  }

  async unstage(paths: string[]): Promise<void> {
    // Spec 11: unstage(paths)
    return this.mockFallback.unstage(paths);
  }

  async discard(paths: string[]): Promise<void> {
    // Spec 11: discard(paths)
    return this.mockFallback.discard(paths);
  }

  async stageAll(): Promise<void> {
    // Spec 11: stage_all()
    return this.mockFallback.stageAll();
  }

  async unstageAll(): Promise<void> {
    // Spec 11: unstage_all()
    return this.mockFallback.unstageAll();
  }

  async discardAll(): Promise<void> {
    // Spec 11: discard_all()
    return this.mockFallback.discardAll();
  }

  async stageSelections(path: string, selections: LineSelection[]): Promise<void> {
    // Spec 11: stage_ranges(path, ranges)
    return this.mockFallback.stageSelections(path, selections);
  }

  async unstageSelections(path: string, selections: LineSelection[]): Promise<void> {
    // Spec 11: unstage_ranges(path, ranges)
    return this.mockFallback.unstageSelections(path, selections);
  }

  async revertSelections(path: string, selections: LineSelection[]): Promise<void> {
    // Spec 11: revert_ranges(path, ranges)
    return this.mockFallback.revertSelections(path, selections);
  }

  async fileContent(path: string, rev: FileRev): Promise<string> {
    // Spec 11: get_file_content(path, rev)
    return this.mockFallback.fileContent(path, rev);
  }

  async saveFile(path: string, content: string): Promise<void> {
    // Spec 11: save_worktree_file(path, content)
    return this.mockFallback.saveFile(path, content);
  }

  async commit(options: CommitOptions): Promise<void> {
    // Spec 11: commit(CommitOptions)
    return this.mockFallback.commit(options);
  }

  async lastCommitMessage(): Promise<string> {
    // Spec 11: last_commit_message()
    return this.mockFallback.lastCommitMessage();
  }

  async getDraftMessage(repoPath?: string): Promise<string> {
    // Spec 11: get_draft_message()
    return this.mockFallback.getDraftMessage(repoPath);
  }

  async setDraftMessage(message: string, repoPath?: string): Promise<void> {
    // Spec 11: set_draft_message()
    return this.mockFallback.setDraftMessage(message, repoPath);
  }

  async getRefs(): Promise<RefList> {
    // Spec 11: list_refs()
    return this.mockFallback.getRefs();
  }

  async checkout(refName: string): Promise<void> {
    // Spec 11: checkout(ref)
    return this.mockFallback.checkout(refName);
  }

  async createBranch(name: string, startPoint?: string): Promise<void> {
    // Spec 11: create_branch(name, start)
    return this.mockFallback.createBranch(name, startPoint);
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    // Spec 11: rename_branch(old, new)
    return this.mockFallback.renameBranch(oldName, newName);
  }

  async deleteBranch(name: string, force?: boolean): Promise<void> {
    // Spec 11: delete_branch(name, force)
    return this.mockFallback.deleteBranch(name, force);
  }

  async setUpstream(branch: string, upstream: string): Promise<void> {
    // Spec 11: set_upstream(branch, upstream)
    return this.mockFallback.setUpstream(branch, upstream);
  }

  async listStashes(): Promise<StashItem[]> {
    // Spec 11: list_stashes()
    return this.mockFallback.listStashes();
  }

  async stashPush(options: StashPushOptions): Promise<void> {
    // Spec 11: stash_push(opts)
    return this.mockFallback.stashPush(options);
  }

  async stashApply(index: number): Promise<void> {
    // Spec 11: stash_apply(i)
    return this.mockFallback.stashApply(index);
  }

  async stashPop(index: number): Promise<void> {
    // Spec 11: stash_pop(i)
    return this.mockFallback.stashPop(index);
  }

  async stashDrop(index: number): Promise<void> {
    // Spec 11: stash_drop(i)
    return this.mockFallback.stashDrop(index);
  }

  async stashDiff(index: number): Promise<string> {
    // Spec 11: stash_diff(i)
    return this.mockFallback.stashDiff(index);
  }

  async fetch(remote?: string): Promise<JobId> {
    // Spec 11: fetch(remote) -> JobId
    return this.mockFallback.fetch(remote);
  }

  async pull(_opts?: { remote?: string; branch?: string; rebase?: boolean }): Promise<JobId> {
    // Spec 11: pull(opts) -> JobId
    return this.mockFallback.pull();
  }

  async push(_opts?: { remote?: string; branch?: string; forceWithLease?: boolean }): Promise<JobId> {
    // Spec 11: push(opts) -> JobId
    return this.mockFallback.push();
  }

  async sync(): Promise<JobId> {
    // Spec 11: sync() -> JobId
    return this.mockFallback.sync();
  }

  subscribeJobProgress(jobId: JobId, callback: (progress: JobProgress) => void): () => void {
    return this.mockFallback.subscribeJobProgress(jobId, callback);
  }

  async cancelJob(jobId: JobId): Promise<void> {
    // Spec 11: cancel_job(id)
    return this.mockFallback.cancelJob(jobId);
  }

  async aiGenerateCommit(onChunk?: (chunk: string) => void): Promise<string> {
    // Spec 11: ai_generate_commit() -> JobId
    return this.mockFallback.aiGenerateCommit(onChunk);
  }

  async openInEditor(path: string, line?: number): Promise<void> {
    // Spec 11: open_in_editor(path, line)
    return this.mockFallback.openInEditor(path, line);
  }

  async reveal(path: string): Promise<void> {
    // Spec 11: reveal_in_file_manager(path)
    return this.mockFallback.reveal(path);
  }

  onStatusChanged(cb: () => void): () => void {
    return this.mockFallback.onStatusChanged(cb);
  }
}
