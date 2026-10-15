declare global {
  interface PromiseConstructor {
    withResolvers<T>(): {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  }
}

if (typeof Promise.withResolvers !== "function") {
  Promise.withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

export type FileStatus =
  | "Unmodified"
  | "Modified"
  | "Added"
  | "Deleted"
  | "Renamed"
  | "Copied"
  | "TypeChanged"
  | "Untracked"
  | "Ignored"
  | "Unmerged";

export interface BranchInfo {
  oid?: string | null;
  head?: string | null;
  upstream?: string | null;
  ahead: number;
  behind: number;
  is_detached?: boolean;
  is_initial?: boolean;
}

export interface SubmoduleState {
  is_submodule: boolean;
  commit_changed: boolean;
  modified: boolean;
  untracked: boolean;
}

export type StatusEntryKind =
  | {
      type: "Ordinary";
      staged: FileStatus;
      unstaged: FileStatus;
      submodule?: SubmoduleState;
      head_mode?: string;
      index_mode?: string;
      worktree_mode?: string;
      head_sha?: string;
      index_sha?: string;
    }
  | {
      type: "RenamedOrCopied";
      staged: FileStatus;
      unstaged: FileStatus;
      submodule?: SubmoduleState;
      head_mode?: string;
      index_mode?: string;
      worktree_mode?: string;
      head_sha?: string;
      index_sha?: string;
      is_rename: boolean;
      score: number;
      orig_path: string;
    }
  | {
      type: "Unmerged";
      conflict_type: string;
      submodule?: SubmoduleState;
      stage1_mode?: string;
      stage2_mode?: string;
      stage3_mode?: string;
      worktree_mode?: string;
      stage1_sha?: string;
      stage2_sha?: string;
      stage3_sha?: string;
    }
  | { type: "Untracked" }
  | { type: "Ignored" };

export interface StatusEntry {
  path: string;
  kind: StatusEntryKind;
}

export interface RepoStatus {
  branch: BranchInfo;
  entries: StatusEntry[];
}

export type DiffSide = "Original" | "Modified";

export interface LineSelection {
  side: DiffSide;
  start: number;
  end: number;
}

export interface CommitOptions {
  message: string;
  amend?: boolean;
  signoff?: boolean;
  no_verify?: boolean;
  all?: boolean;
}

export type RefKind = "local" | "remote" | "tag";

export interface RefItem {
  name: string;
  fullName: string;
  kind: RefKind;
  remote?: string;
  isHead?: boolean;
  upstream?: string | null;
  ahead?: number;
  behind?: number;
  targetOid?: string;
}

export interface RefList {
  branches: RefItem[];
  remotes: RefItem[];
  tags: RefItem[];
  head?: string | null;
}

export interface StashItem {
  index: number;
  message: string;
  branch: string;
  date: string;
  hash?: string;
}

export interface StashPushOptions {
  message?: string;
  includeUntracked?: boolean;
  paths?: string[];
}

export type FileRev =
  | { kind: "Head" }
  | { kind: "Index" }
  | { kind: "Worktree" }
  | { kind: "Commit"; sha: string }
  | { kind: "Stage"; n: number };

export type JobId = string;

export interface JobProgress {
  jobId: JobId;
  title: string;
  percent?: number;
  message?: string;
  cancelable?: boolean;
}

export type ErrorKind =
  | "NotARepo"
  | "GitMissing"
  | "GitTooOld"
  | "IndexLocked"
  | "Conflict"
  | "DirtyWorktree"
  | "AuthFailed"
  | "NonFastForward"
  | "HookFailed"
  | "NothingToCommit"
  | "Network"
  | "PatchFailed"
  | "HostApi"
  | "AiProvider"
  | "Cancelled"
  | "Internal";

export interface Hint {
  label: string;
  action: string;
}

export interface AppError {
  kind: ErrorKind;
  message: string;
  git_stderr?: string | null;
  hint?: Hint | null;
}

export function isEntryStaged(entry: StatusEntry): boolean {
  if (entry.kind.type === "Ordinary" || entry.kind.type === "RenamedOrCopied") {
    return entry.kind.staged !== "Unmodified";
  }
  return false;
}

export function isEntryUnstaged(entry: StatusEntry): boolean {
  if (entry.kind.type === "Ordinary" || entry.kind.type === "RenamedOrCopied") {
    return entry.kind.unstaged !== "Unmodified";
  }
  return false;
}

export function isEntryUntracked(entry: StatusEntry): boolean {
  return entry.kind.type === "Untracked";
}

export function isEntryConflict(entry: StatusEntry): boolean {
  return entry.kind.type === "Unmerged";
}

export function getEntryBadge(entry: StatusEntry, context: "staged" | "unstaged" | "untracked" | "merge"): {
  letter: string;
  color: string;
  tooltip: string;
} {
  if (entry.kind.type === "Unmerged") {
    return { letter: "U", color: "text-error", tooltip: "Conflict / Unmerged" };
  }
  if (entry.kind.type === "Untracked") {
    return { letter: "U", color: "text-success", tooltip: "Untracked" };
  }
  if (entry.kind.type === "Ignored") {
    return { letter: "!", color: "text-vscode-muted", tooltip: "Ignored" };
  }

  const status = context === "staged" ? entry.kind.staged : entry.kind.unstaged;
  switch (status) {
    case "Added":
      return { letter: "A", color: "text-success", tooltip: "Added" };
    case "Modified":
      return { letter: "M", color: "text-warning", tooltip: "Modified" };
    case "Deleted":
      return { letter: "D", color: "text-error", tooltip: "Deleted" };
    case "Renamed":
      return { letter: "R", color: "text-vscode-accent", tooltip: "Renamed" };
    case "Copied":
      return { letter: "C", color: "text-vscode-accent", tooltip: "Copied" };
    case "TypeChanged":
      return { letter: "T", color: "text-warning", tooltip: "Type Changed" };
    default:
      return { letter: "M", color: "text-warning", tooltip: "Modified" };
  }
}
