import type {
  CommitDetail,
  CommitSummary,
  Edge,
  FileChange,
  FileStatus,
  GraphFilter,
  GraphPage,
  GraphRow,
  RefLabel,
  EdgeKind,
} from "./types";
import { commands, AppGraphFilter } from "@/bindings";
import { reportAppError } from "@/utils/errors";

export interface GraphDataSource {
  reset(filter?: GraphFilter): Promise<void>;
  page(n: number): Promise<GraphPage>;
  detail(sha: string): Promise<CommitDetail>;
  compare(a: string, b: string): Promise<FileChange[]>;
  isDirty?(): Promise<boolean>;
}

// 12-color palette hex codes (spec 6.2 / crates/git-graph/src/color.rs)
export const PALETTE_HEX: readonly string[] = [
  "#3b82f6", // 0: Blue
  "#22c55e", // 1: Green
  "#eab308", // 2: Amber
  "#ef4444", // 3: Red
  "#a855f7", // 4: Purple
  "#06b6d4", // 5: Cyan
  "#f97316", // 6: Orange
  "#ec4899", // 7: Pink
  "#84cc16", // 8: Lime
  "#6366f1", // 9: Indigo
  "#14b8a6", // 10: Teal
  "#f43f5e", // 11: Rose
];

export function branchColorIndex(name: string): number {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask64 = 0xffffffffffffffffn;
  for (let i = 0; i < name.length; i++) {
    hash ^= BigInt(name.charCodeAt(i));
    hash = (hash * prime) & mask64;
  }
  return Number(hash % 12n);
}

interface MockLane {
  target: string;
  color: number;
}

export class MockLaneState {
  private active: (MockLane | null)[] = [];

  reset(): void {
    this.active = [];
  }

  layoutPage(commits: { sha: string; parents: string[]; refs: RefLabel[] }[]): GraphRow[] {
    const rows: GraphRow[] = [];

    for (const commit of commits) {
      // 1. Find all active lanes waiting for this commit.
      const waitingIndices: number[] = [];
      for (let i = 0; i < this.active.length; i++) {
        const lane = this.active[i];
        if (lane && lane.target === commit.sha) {
          waitingIndices.push(i);
        }
      }

      // 2. Col for this commit: leftmost waiting lane, or first free slot / append.
      let col: number;
      if (waitingIndices.length > 0) {
        col = waitingIndices[0];
      } else {
        const emptyIdx = this.active.indexOf(null);
        col = emptyIdx !== -1 ? emptyIdx : this.active.length;
      }

      // Color priority: primary ref > waiting lane color > col % 12
      let color: number;
      const primaryRef =
        commit.refs.find((r) => r.kind === "LocalBranch") ||
        commit.refs.find((r) => r.kind === "RemoteBranch") ||
        commit.refs.find((r) => r.kind === "Head") ||
        commit.refs.find((r) => r.kind === "Tag") ||
        commit.refs[0];

      if (primaryRef) {
        color = branchColorIndex(primaryRef.name);
      } else if (waitingIndices.length > 0 && this.active[col]) {
        color = this.active[col]!.color;
      } else {
        color = col % 12;
      }

      while (this.active.length <= col) {
        this.active.push(null);
      }

      const edges: Edge[] = [];

      // MergeIn: secondary waiting lanes converge into col and close
      const closingIndices = waitingIndices.slice(1);
      for (const otherCol of closingIndices) {
        const otherLane = this.active[otherCol];
        if (otherLane) {
          edges.push({
            from_col: otherCol,
            to_col: col,
            kind: "MergeIn",
            color: otherLane.color,
          });
          this.active[otherCol] = null;
        }
      }

      // Straight passing lanes
      for (let i = 0; i < this.active.length; i++) {
        if (i !== col && !closingIndices.includes(i)) {
          const lane = this.active[i];
          if (lane) {
            edges.push({
              from_col: i,
              to_col: i,
              kind: "Straight",
              color: lane.color,
            });
          }
        }
      }

      // Parents
      if (commit.parents.length === 0) {
        this.active[col] = null;
      } else {
        const p0 = commit.parents[0];
        this.active[col] = { target: p0, color };
        edges.push({
          from_col: col,
          to_col: col,
          kind: "Straight",
          color,
        });

        // Secondary parents
        const seenSecondary = new Set<string>();
        for (let pIdx = 1; pIdx < commit.parents.length; pIdx++) {
          const pSub = commit.parents[pIdx];
          if (pSub === p0 || seenSecondary.has(pSub)) continue;
          seenSecondary.add(pSub);

          const existingIdx = this.active.findIndex(
            (l, idx) => idx !== col && l !== null && l.target === pSub
          );

          if (existingIdx !== -1) {
            const branchColor = this.active[existingIdx]!.color;
            edges.push({
              from_col: col,
              to_col: existingIdx,
              kind: "BranchOut",
              color: branchColor,
            });
          } else {
            let newCol = this.active.indexOf(null);
            if (newCol === -1) {
              newCol = this.active.length;
            }
            const newColor = (color + 1 + (newCol % 11)) % 12;
            while (this.active.length <= newCol) {
              this.active.push(null);
            }
            this.active[newCol] = { target: pSub, color: newColor };
            edges.push({
              from_col: col,
              to_col: newCol,
              kind: "BranchOut",
              color: newColor,
            });
          }
        }
      }

      // Trim trailing empty lanes
      while (this.active.length > 0 && this.active[this.active.length - 1] === null) {
        this.active.pop();
      }

      // Sort edges deterministically
      edges.sort((a, b) => {
        if (a.from_col !== b.from_col) return a.from_col - b.from_col;
        if (a.to_col !== b.to_col) return a.to_col - b.to_col;
        return a.kind.localeCompare(b.kind);
      });

      rows.push({
        sha: commit.sha,
        col,
        color,
        edges,
      });
    }

    return rows;
  }
}

// Simple seeded pseudo-random number generator (Mulberry32)
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MockGraphDataSource implements GraphDataSource {
  private totalCommits: number;
  private seed: number;
  private offset = 0;
  private filter: GraphFilter | null = null;
  private laneState: MockLaneState;
  private dirty = true;
  private commitCache: Map<string, CommitSummary> = new Map();

  constructor(totalCommits = 200000, seed = 42, dirty = true) {
    this.totalCommits = totalCommits;
    this.seed = seed;
    this.dirty = dirty;
    this.laneState = new MockLaneState();
  }

  setDirty(dirty: boolean): void {
    this.dirty = dirty;
  }

  async isDirty(): Promise<boolean> {
    return this.dirty;
  }

  async reset(filter?: GraphFilter): Promise<void> {
    this.offset = 0;
    this.filter = filter ?? null;
    this.laneState.reset();
  }

  async page(n: number): Promise<GraphPage> {
    const count = Math.min(n, this.totalCommits - this.offset);
    if (count <= 0) {
      return { commits: [], rows: [], has_more: false };
    }

    const rawCommits: {
      summary: CommitSummary;
      parents: string[];
    }[] = [];

    const authors = [
      { name: "Linus Torvalds", email: "torvalds@linux-foundation.org" },
      { name: "David Huynh", email: "david@example.com" },
      { name: "Alice Smith", email: "alice@example.com" },
      { name: "Bob Jones", email: "bob@example.com" },
      { name: "Charlie Brown", email: "charlie@example.com" },
    ];

    const subjects = [
      "feat(graph-ui): virtualized canvas Git Graph view",
      "fix(walker): topology date ordering on merge commits",
      "refactor(lanes): improve lane allocation efficiency",
      "test(canvas): add bezier path coordinate tests",
      "docs: update architecture design record for M2",
      "perf: reduce canvas overdraw with clipping bounds",
      "chore: bump dependencies for release verification",
      "Merge branch 'feat/m1-backend' into main",
      "Merge pull request #42 from vsc_git/feat/ai",
      "Octopus merge: integrate core, graph, and hosting modules",
    ];

    const baseTime = 1729000000; // ~Oct 2024

    for (let i = 0; i < count; i++) {
      const idx = this.offset + i;
      const prng = mulberry32(this.seed + idx * 7919);

      // Deterministic SHA: 40-character hex
      const hexPart = (0x100000000 + Math.floor(prng() * 0xefffffff)).toString(16);
      const sha = `${hexPart.padStart(8, "0")}${(idx + 1).toString(16).padStart(32, "0")}`;
      const shortSha = sha.slice(0, 7);

      const author = authors[Math.floor(prng() * authors.length)];
      const subject =
        idx === 0
          ? "feat(graph-ui): virtualized canvas Git Graph view"
          : idx === 1
            ? "Merge branch 'feat/m1-backend' into main"
            : idx === 4
              ? "Octopus merge: integrate core, graph, and hosting modules"
              : subjects[Math.floor(prng() * subjects.length)];

      const authorTime = baseTime - idx * 3600;
      const committerTime = authorTime + 120;

      // Parents logic: linear with periodic branches and merges
      const parents: string[] = [];
      const hasNext = idx + 1 < this.totalCommits;

      if (hasNext) {
        const nextHex = (0x100000000 + Math.floor(mulberry32(this.seed + (idx + 1) * 7919)() * 0xefffffff)).toString(16);
        const p0 = `${nextHex.padStart(8, "0")}${(idx + 2).toString(16).padStart(32, "0")}`;
        parents.push(p0);

        // Octopus merge at idx 4: 3 parents
        if (idx === 4 && idx + 3 < this.totalCommits) {
          const p1Hex = (0x100000000 + Math.floor(mulberry32(this.seed + (idx + 2) * 7919)() * 0xefffffff)).toString(16);
          const p2Hex = (0x100000000 + Math.floor(mulberry32(this.seed + (idx + 3) * 7919)() * 0xefffffff)).toString(16);
          parents.push(`${p1Hex.padStart(8, "0")}${(idx + 3).toString(16).padStart(32, "0")}`);
          parents.push(`${p2Hex.padStart(8, "0")}${(idx + 4).toString(16).padStart(32, "0")}`);
        } else if (idx % 7 === 1 && idx + 2 < this.totalCommits) {
          // Normal 2-parent merge every 7 commits
          const p1Hex = (0x100000000 + Math.floor(mulberry32(this.seed + (idx + 2) * 7919)() * 0xefffffff)).toString(16);
          parents.push(`${p1Hex.padStart(8, "0")}${(idx + 3).toString(16).padStart(32, "0")}`);
        }
      }

      // Refs assignment
      const refs: RefLabel[] = [];
      if (idx === 0) {
        refs.push({ name: "HEAD", kind: "Head" });
        refs.push({ name: "main", kind: "LocalBranch" });
        refs.push({ name: "origin/main", kind: "RemoteBranch" });
      } else if (idx === 1) {
        refs.push({ name: "origin/feat/m1-backend", kind: "RemoteBranch" });
      } else if (idx === 3) {
        refs.push({ name: "v1.0.0", kind: "Tag" });
      } else if (idx === 8) {
        refs.push({ name: "feat/search", kind: "LocalBranch" });
      } else if (idx === 14) {
        refs.push({ name: "stash@{0}", kind: "Stash" });
      } else if (idx === 25) {
        refs.push({ name: "v0.9.0", kind: "Tag" });
      }

      // Filter check if filter applied
      if (this.filter) {
        if (!this.filter.include_remotes) {
          // Remove remote branches from refs
          const filteredRefs = refs.filter((r) => r.kind !== "RemoteBranch");
          refs.length = 0;
          refs.push(...filteredRefs);
        }
        if (!this.filter.include_tags) {
          const filteredRefs = refs.filter((r) => r.kind !== "Tag");
          refs.length = 0;
          refs.push(...filteredRefs);
        }
        if (!this.filter.include_stash) {
          const filteredRefs = refs.filter((r) => r.kind !== "Stash");
          refs.length = 0;
          refs.push(...filteredRefs);
        }
        if (this.filter.first_parent_only && parents.length > 1) {
          parents.splice(1);
        }
      }

      const summary: CommitSummary = {
        sha,
        short_sha: shortSha,
        parents: [...parents],
        author_name: author.name,
        author_email: author.email,
        author_time: authorTime,
        committer_time: committerTime,
        subject,
        refs,
      };

      this.commitCache.set(sha, summary);
      rawCommits.push({ summary, parents });
    }

    const layoutInput = rawCommits.map((c) => ({
      sha: c.summary.sha,
      parents: c.parents,
      refs: c.summary.refs,
    }));

    const rows = this.laneState.layoutPage(layoutInput);
    this.offset += count;
    const hasMore = this.offset < this.totalCommits;

    return {
      commits: rawCommits.map((c) => c.summary),
      rows,
      has_more: hasMore,
    };
  }

  async detail(sha: string): Promise<CommitDetail> {
    const summary =
      this.commitCache.get(sha) ?? {
        sha,
        short_sha: sha.slice(0, 7),
        parents: [],
        author_name: "Linus Torvalds",
        author_email: "torvalds@linux-foundation.org",
        author_time: 1729000000,
        committer_time: 1729000100,
        subject: `Commit ${sha.slice(0, 7)}`,
        refs: [],
      };

    const files: FileChange[] = [
      {
        path: "src/views/Graph/GraphView.tsx",
        old_path: null,
        status: "M",
        additions: 142,
        deletions: 18,
        binary: false,
      },
      {
        path: "src/graph/dataSource.ts",
        old_path: null,
        status: "A",
        additions: 220,
        deletions: 0,
        binary: false,
      },
      {
        path: "crates/git-graph/src/lanes.rs",
        old_path: null,
        status: "M",
        additions: 35,
        deletions: 12,
        binary: false,
      },
      {
        path: "docs/spec.md",
        old_path: null,
        status: "M",
        additions: 10,
        deletions: 2,
        binary: false,
      },
      {
        path: "assets/logo.png",
        old_path: null,
        status: "M",
        additions: 0,
        deletions: 0,
        binary: true,
      },
    ];

    return {
      summary,
      body: `Detailed commit body for ${summary.short_sha}.\n\nThis commit implements high performance features according to spec 6.3 and spec 14.\nAll tests and lints pass.`,
      committer: {
        name: summary.author_name,
        email: summary.author_email,
        time: summary.committer_time,
      },
      signature_present: true,
      files,
    };
  }

  async compare(_a: string, _b: string): Promise<FileChange[]> {
    return [
      {
        path: "src/views/Graph/GraphView.tsx",
        old_path: null,
        status: "M",
        additions: 180,
        deletions: 45,
        binary: false,
      },
      {
        path: "src/components/graph/GraphCanvas.tsx",
        old_path: null,
        status: "A",
        additions: 95,
        deletions: 0,
        binary: false,
      },
      {
        path: "crates/git-read/src/detail.rs",
        old_path: null,
        status: "M",
        additions: 24,
        deletions: 8,
        binary: false,
      },
      {
        path: "old_unused_module.ts",
        old_path: null,
        status: "D",
        additions: 0,
        deletions: 60,
        binary: false,
      },
    ];
  }
}

/**
 * Tauri adapter stub connecting to Rust Tauri commands (spec 11).
 * Will be populated once M1 backend bindings are generated.
 */
function toGraphFileStatus(s: string): FileStatus {
  switch (s) {
    case "Added":
      return "A";
    case "Deleted":
      return "D";
    case "Renamed":
      return "R";
    case "Copied":
      return "C";
    case "TypeChanged":
      return "T";
    default:
      return "M";
  }
}

export class TauriGraphDataSource implements GraphDataSource {
  async reset(filter?: GraphFilter): Promise<void> {
    const refs =
      !filter?.refs || filter.refs === "All"
        ? null
        : typeof filter.refs === "object" && "Selected" in filter.refs
        ? filter.refs.Selected
        : null;
    const appFilter: AppGraphFilter = {
      refs,
      include_remotes: filter?.include_remotes ?? true,
      include_tags: filter?.include_tags ?? true,
      include_stash: filter?.include_stash ?? true,
      first_parent_only: filter?.first_parent_only ?? false,
    };
    const res = await commands.graphReset(appFilter);
    if (res.status === "error") {
      reportAppError(res.error);
      throw res.error;
    }
  }

  async page(n: number): Promise<GraphPage> {
    const res = await commands.graphPage(n);
    if (res.status === "error") {
      reportAppError(res.error);
      throw res.error;
    }
    return {
      commits: res.data.commits.map((c) => ({
        sha: c.sha,
        short_sha: c.short_sha,
        parents: c.parents,
        author_name: c.author_name,
        author_email: c.author_email,
        author_time: c.author_time ?? 0,
        committer_time: c.committer_time ?? 0,
        subject: c.subject,
        refs: c.refs.map((r) => ({
          name: r.name,
          kind: r.kind,
        })),
      })),
      rows: res.data.rows.map((r) => ({
        sha: r.sha,
        col: r.col,
        color: r.color,
        edges: r.edges.map((e) => ({
          from_col: e.from_col,
          to_col: e.to_col,
          kind: e.kind as EdgeKind,
          color: e.color,
        })),
      })),
      has_more: res.data.has_more,
    };
  }

  async detail(sha: string): Promise<CommitDetail> {
    const res = await commands.commitDetail(sha);
    if (res.status === "error") {
      reportAppError(res.error);
      throw res.error;
    }
    return {
      summary: {
        sha: res.data.summary.sha,
        short_sha: res.data.summary.short_sha,
        parents: res.data.summary.parents,
        author_name: res.data.summary.author_name,
        author_email: res.data.summary.author_email,
        author_time: res.data.summary.author_time ?? 0,
        committer_time: res.data.summary.committer_time ?? 0,
        subject: res.data.summary.subject,
        refs: res.data.summary.refs.map((r) => ({
          name: r.name,
          kind: r.kind,
        })),
      },
      body: res.data.body,
      committer: {
        name: res.data.committer.name,
        email: res.data.committer.email,
        time: res.data.committer.time ?? 0,
      },
      signature_present: res.data.signature_present,
      files: res.data.files.map((f) => ({
        path: f.path,
        old_path: f.old_path,
        status: toGraphFileStatus(f.status),
        additions: f.additions,
        deletions: f.deletions,
        binary: f.binary,
      })),
    };
  }

  async compare(a: string, b: string): Promise<FileChange[]> {
    const res = await commands.compare(a, b);
    if (res.status === "error") {
      reportAppError(res.error);
      throw res.error;
    }
    return res.data.map((f) => ({
      path: f.path,
      old_path: f.old_path,
      status: toGraphFileStatus(f.status),
      additions: f.additions,
      deletions: f.deletions,
      binary: f.binary,
    }));
  }

  async isDirty(): Promise<boolean> {
    const res = await commands.getStatus();
    if (res.status === "error") return false;
    return res.data.entries.length > 0;
  }
}
