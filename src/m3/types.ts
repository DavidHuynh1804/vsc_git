export type OperationKind = "Merge" | "Rebase" | "CherryPick" | "Revert";

export type RawOperationState =
  | "None"
  | { None: null }
  | { Merging: { commit_id?: string | null } }
  | {
      Rebasing: {
        step: number;
        total: number;
        onto?: string | null;
        branch?: string | null;
      };
    }
  | { CherryPicking: { commit_id?: string | null } }
  | { Reverting: { commit_id?: string | null } };

export interface NormalizedOperationState {
  kind: "None" | "Merging" | "Rebasing" | "CherryPicking" | "Reverting";
  isActive: boolean;
  step?: number;
  total?: number;
  onto?: string | null;
  branch?: string | null;
  commit_id?: string | null;
}

export function normalizeOperationState(
  state: RawOperationState | NormalizedOperationState | null | undefined
): NormalizedOperationState {
  if (!state || state === "None") {
    return { kind: "None", isActive: false };
  }

  if (typeof state === "object" && "isActive" in state && "kind" in state) {
    return state;
  }

  if (typeof state === "object") {
    if ("None" in state) {
      return { kind: "None", isActive: false };
    }
    if ("Merging" in state) {
      return {
        kind: "Merging",
        isActive: true,
        commit_id: state.Merging.commit_id ?? null,
      };
    }
    if ("Rebasing" in state) {
      return {
        kind: "Rebasing",
        isActive: true,
        step: state.Rebasing.step,
        total: state.Rebasing.total,
        onto: state.Rebasing.onto ?? null,
        branch: state.Rebasing.branch ?? null,
      };
    }
    if ("CherryPicking" in state) {
      return {
        kind: "CherryPicking",
        isActive: true,
        commit_id: state.CherryPicking.commit_id ?? null,
      };
    }
    if ("Reverting" in state) {
      return {
        kind: "Reverting",
        isActive: true,
        commit_id: state.Reverting.commit_id ?? null,
      };
    }
  }

  return { kind: "None", isActive: false };
}

export interface ConflictVersions {
  base: Uint8Array | string | null;
  ours: Uint8Array | string | null;
  theirs: Uint8Array | string | null;
  worktree: Uint8Array | string | null;
}

export type ConflictKind =
  | "BothModified"
  | "DeletedByUs"
  | "DeletedByThem"
  | "BothAdded"
  | "RenameConflict"
  | "BothDeleted"
  | "Unknown";

export type Resolution = "Ours" | "Theirs" | "Delete";

export interface ConflictRegion {
  id: number;
  startLine: number; // 1-based start line of <<<<<<<
  endLine: number; // 1-based end line of >>>>>>>
  current: string;
  incoming: string;
  base?: string;
  currentHeader: string;
  baseHeader?: string;
  incomingHeader: string;
}

export interface BlameOptions {
  ignore_ws?: boolean;
  detect_moves?: boolean;
  detect_copies?: boolean;
}

export interface BlameCommit {
  sha: string;
  author: string;
  author_mail: string;
  author_time: number;
  summary: string;
  previous?: string | null;
}

export interface BlameLine {
  line_no: number;
  commit: BlameCommit;
}

export interface FileHistoryEntry {
  sha: string;
  parents: string[];
  author: string;
  time: number;
  subject: string;
  path_at_commit: string;
  status: string;
}

export type RebaseAction =
  | "pick"
  | "reword"
  | "edit"
  | "squash"
  | "fixup"
  | "drop"
  | "exec"
  | "break";

export interface RebaseTodoEntry {
  action: RebaseAction;
  sha: string;
  subject: string;
}
