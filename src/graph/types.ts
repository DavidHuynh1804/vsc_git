export type RefKind = "LocalBranch" | "RemoteBranch" | "Tag" | "Head" | "Stash";

export interface RefLabel {
  name: string;
  kind: RefKind;
}

export type EdgeKind = "Straight" | "MergeIn" | "BranchOut";

export interface Edge {
  from_col: number;
  to_col: number;
  kind: EdgeKind;
  color: number;
}

export interface GraphRow {
  sha: string;
  col: number;
  color: number;
  edges: Edge[];
}

export interface CommitSummary {
  sha: string;
  short_sha: string;
  parents: string[];
  author_name: string;
  author_email: string;
  author_time: number;
  committer_time: number;
  subject: string;
  refs: RefLabel[];
}

export interface GraphPage {
  commits: CommitSummary[];
  rows: GraphRow[];
  has_more: boolean;
}

export type FileStatus = "A" | "M" | "D" | "R" | "C" | "T";

export interface FileChange {
  path: string;
  old_path?: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface CommitterInfo {
  name: string;
  email: string;
  time: number;
}

export interface CommitDetail {
  summary: CommitSummary;
  body?: string | null;
  committer: CommitterInfo;
  signature_present: boolean;
  files: FileChange[];
}

export type RefFilter = "All" | { Selected: string[] };

export interface GraphFilter {
  refs: RefFilter;
  include_remotes: boolean;
  include_tags: boolean;
  include_stash: boolean;
  first_parent_only: boolean;
}

export interface GraphAction {
  type: string;
  payload: Record<string, unknown>;
  danger?: boolean;
  gitCommand?: string;
  twoStepConfirm?: boolean;
}

export type DateDisplayFormat = "relative" | "absolute";

export interface ColumnDefinition {
  id: "graph" | "refs" | "message" | "author" | "date" | "sha";
  label: string;
  width: number;
  minWidth: number;
  visible: boolean;
}
