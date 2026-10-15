import {
  RawOperationState,
  ConflictVersions,
  Resolution,
  BlameOptions,
  BlameLine,
  FileHistoryEntry,
  RebaseTodoEntry,
} from "./types";

export interface M3DataSource {
  getOperationState(): Promise<RawOperationState>;
  opContinue(): Promise<void>;
  opSkip(): Promise<void>;
  opAbort(): Promise<void>;
  getConflict(path: string): Promise<ConflictVersions>;
  resolveConflict(path: string, content: string): Promise<void>;
  resolveWith(path: string, resolution: Resolution): Promise<void>;
  blame(path: string, rev?: string, opts?: BlameOptions): Promise<BlameLine[]>;
  fileHistory(path: string, skip?: number, limit?: number): Promise<FileHistoryEntry[]>;
  rebaseInteractive(base: string): Promise<string>;
  submitRebaseTodo(items: RebaseTodoEntry[]): Promise<void>;
  openInEditor(path: string, line?: number): Promise<void>;
  saveWorktreeFile(path: string, content: string): Promise<void>;
  onOperationChanged(cb: () => void): () => void;
}

export class MockM3DataSource implements M3DataSource {
  private operationState: RawOperationState = {
    Rebasing: {
      step: 3,
      total: 7,
      onto: "main",
      branch: "feature-m3",
    },
  };

  private conflicts = new Map<string, ConflictVersions>();
  private blameData = new Map<string, BlameLine[]>();
  private historyData = new Map<string, FileHistoryEntry[]>();
  private rebaseTodoItems: RebaseTodoEntry[] = [];
  private listeners: Array<() => void> = [];

  constructor() {
    this.seedDefaults();
  }

  private seedDefaults() {
    // Default conflict file
    const sampleConflictWorktree = [
      "import React from 'react';",
      "<<<<<<< HEAD",
      "const title = 'Current Branch Title';",
      "const version = '2.0.0';",
      "||||||| base",
      "const title = 'Original Base Title';",
      "const version = '1.0.0';",
      "=======",
      "const title = 'Incoming Feature Title';",
      "const version = '2.1.0-beta';",
      ">>>>>>> feat/new-title",
      "export default function App() {",
      "  return <h1>{title}</h1>;",
      "}",
    ].join("\n");

    const sampleBase = [
      "import React from 'react';",
      "const title = 'Original Base Title';",
      "const version = '1.0.0';",
      "export default function App() {",
      "  return <h1>{title}</h1>;",
      "}",
    ].join("\n");

    const sampleOurs = [
      "import React from 'react';",
      "const title = 'Current Branch Title';",
      "const version = '2.0.0';",
      "export default function App() {",
      "  return <h1>{title}</h1>;",
      "}",
    ].join("\n");

    const sampleTheirs = [
      "import React from 'react';",
      "const title = 'Incoming Feature Title';",
      "const version = '2.1.0-beta';",
      "export default function App() {",
      "  return <h1>{title}</h1>;",
      "}",
    ].join("\n");

    this.conflicts.set("src/App.tsx", {
      base: sampleBase,
      ours: sampleOurs,
      theirs: sampleTheirs,
      worktree: sampleConflictWorktree,
    });

    const now = Math.floor(Date.now() / 1000);
    this.blameData.set("src/App.tsx", [
      {
        line_no: 1,
        commit: {
          sha: "a1b2c3d4e5f67890123456789012345678901234",
          author: "Alice Developer",
          author_mail: "alice@example.com",
          author_time: now - 86400 * 20, // 20 days ago
          summary: "feat: initialize root application structure",
          previous: "0000000000000000000000000000000000000000",
        },
      },
      {
        line_no: 2,
        commit: {
          sha: "b2c3d4e5f6789012345678901234567890123456",
          author: "Bob Engineer",
          author_mail: "bob@example.com",
          author_time: now - 86400 * 5, // 5 days ago
          summary: "fix(app): update version and title formatting",
          previous: "a1b2c3d4e5f67890123456789012345678901234",
        },
      },
      {
        line_no: 3,
        commit: {
          sha: "b2c3d4e5f6789012345678901234567890123456",
          author: "Bob Engineer",
          author_mail: "bob@example.com",
          author_time: now - 86400 * 5,
          summary: "fix(app): update version and title formatting",
          previous: "a1b2c3d4e5f67890123456789012345678901234",
        },
      },
    ]);

    this.historyData.set("src/App.tsx", [
      {
        sha: "b2c3d4e5f6789012345678901234567890123456",
        parents: ["a1b2c3d4e5f67890123456789012345678901234"],
        author: "Bob Engineer",
        time: now - 86400 * 5,
        subject: "fix(app): update version and title formatting",
        path_at_commit: "src/App.tsx",
        status: "M",
      },
      {
        sha: "a1b2c3d4e5f67890123456789012345678901234",
        parents: [],
        author: "Alice Developer",
        time: now - 86400 * 20,
        subject: "feat: initialize root application structure",
        path_at_commit: "src/AppOld.tsx",
        status: "R100",
      },
    ]);

    this.rebaseTodoItems = [
      {
        action: "pick",
        sha: "1a2b3c4",
        subject: "feat(core): add conflict markers parser",
      },
      {
        action: "pick",
        sha: "2b3c4d5",
        subject: "fix(editor): fix CRLF normalization during merge",
      },
      {
        action: "squash",
        sha: "3c4d5e6",
        subject: "fixup! typo in variable name",
      },
      {
        action: "reword",
        sha: "4d5e6f7",
        subject: "feat(ui): operation banner status indicators",
      },
    ];
  }

  setOperationState(state: RawOperationState) {
    this.operationState = state;
    this.notify();
  }

  setConflict(path: string, versions: ConflictVersions) {
    this.conflicts.set(path, versions);
  }
  getRebaseTodo(): RebaseTodoEntry[] {
    return [...this.rebaseTodoItems];
  }


  setBlame(path: string, lines: BlameLine[]) {
    this.blameData.set(path, lines);
  }

  setFileHistory(path: string, entries: FileHistoryEntry[]) {
    this.historyData.set(path, entries);
  }

  setRebaseTodo(items: RebaseTodoEntry[]) {
    this.rebaseTodoItems = [...items];
  }

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  async getOperationState(): Promise<RawOperationState> {
    return this.operationState;
  }

  async opContinue(): Promise<void> {
    if (typeof this.operationState === "object" && "Rebasing" in this.operationState) {
      const { step, total, onto, branch } = this.operationState.Rebasing;
      if (step < total) {
        this.operationState = {
          Rebasing: { step: step + 1, total, onto, branch },
        };
      } else {
        this.operationState = "None";
      }
    } else {
      this.operationState = "None";
    }
    this.notify();
  }

  async opSkip(): Promise<void> {
    await this.opContinue();
  }

  async opAbort(): Promise<void> {
    this.operationState = "None";
    this.notify();
  }

  async getConflict(path: string): Promise<ConflictVersions> {
    const existing = this.conflicts.get(path);
    if (existing) {
      return existing;
    }
    return {
      base: null,
      ours: null,
      theirs: null,
      worktree: null,
    };
  }

  async resolveConflict(path: string, content: string): Promise<void> {
    const existing = this.conflicts.get(path);
    if (existing) {
      this.conflicts.set(path, {
        ...existing,
        worktree: content,
      });
    }
  }

  async resolveWith(path: string, resolution: Resolution): Promise<void> {
    const existing = this.conflicts.get(path);
    if (!existing) return;

    if (resolution === "Ours") {
      this.conflicts.set(path, {
        ...existing,
        worktree: existing.ours,
      });
    } else if (resolution === "Theirs") {
      this.conflicts.set(path, {
        ...existing,
        worktree: existing.theirs,
      });
    } else if (resolution === "Delete") {
      this.conflicts.delete(path);
    }
  }

  async blame(path: string, _rev?: string, _opts?: BlameOptions): Promise<BlameLine[]> {
    const lines = this.blameData.get(path);
    if (lines) {
      return lines;
    }
    const now = Math.floor(Date.now() / 1000);
    return [
      {
        line_no: 1,
        commit: {
          sha: "fedcba9876543210fedcba9876543210fedcba98",
          author: "Git Author",
          author_mail: "author@example.com",
          author_time: now - 3600,
          summary: "Initial commit for " + path,
          previous: null,
        },
      },
    ];
  }

  async fileHistory(
    path: string,
    skip: number = 0,
    limit: number = 50
  ): Promise<FileHistoryEntry[]> {
    const list = this.historyData.get(path) ?? [];
    return list.slice(skip, skip + limit);
  }

  async rebaseInteractive(_base: string): Promise<string> {
    return "mock-rebase-job-id";
  }

  async submitRebaseTodo(items: RebaseTodoEntry[]): Promise<void> {
    this.rebaseTodoItems = [...items];
  }

  async openInEditor(_path: string, _line?: number): Promise<void> {
    // Mock external editor opening
  }

  async saveWorktreeFile(path: string, content: string): Promise<void> {
    await this.resolveConflict(path, content);
  }

  onOperationChanged(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }
}

/**
 * TauriM3DataSource: Invokes Tauri commands defined in Spec 11.
 */
export class TauriM3DataSource implements M3DataSource {
  // TODO: connect with Tauri commands once feat/m1-backend bindings are generated
  private fallback = new MockM3DataSource();

  async getOperationState(): Promise<RawOperationState> {
    // Spec 11: get_operation_state() -> OperationState
    return this.fallback.getOperationState();
  }

  async opContinue(): Promise<void> {
    // Spec 11: op_continue()
    return this.fallback.opContinue();
  }

  async opSkip(): Promise<void> {
    // Spec 11: op_skip()
    return this.fallback.opSkip();
  }

  async opAbort(): Promise<void> {
    // Spec 11: op_abort()
    return this.fallback.opAbort();
  }

  async getConflict(path: string): Promise<ConflictVersions> {
    // Spec 11: get_conflict(path) -> ConflictVersions
    return this.fallback.getConflict(path);
  }

  async resolveConflict(path: string, content: string): Promise<void> {
    // Spec 11: resolve_conflict(path, content)
    return this.fallback.resolveConflict(path, content);
  }

  async resolveWith(path: string, resolution: Resolution): Promise<void> {
    // Spec 11: resolve_with(path, resolution)
    return this.fallback.resolveWith(path, resolution);
  }

  async blame(path: string, rev?: string, opts?: BlameOptions): Promise<BlameLine[]> {
    // Spec 11: blame(path, rev?, opts)
    return this.fallback.blame(path, rev, opts);
  }

  async fileHistory(
    path: string,
    skip?: number,
    limit?: number
  ): Promise<FileHistoryEntry[]> {
    // Spec 11: file_history(path, cursor)
    return this.fallback.fileHistory(path, skip, limit);
  }

  async rebaseInteractive(base: string): Promise<string> {
    // Spec 11: rebase_interactive(base) -> JobId
    return this.fallback.rebaseInteractive(base);
  }

  async submitRebaseTodo(items: RebaseTodoEntry[]): Promise<void> {
    // Spec 11: submit_rebase_todo(items)
    return this.fallback.submitRebaseTodo(items);
  }

  async openInEditor(path: string, line?: number): Promise<void> {
    // Spec 11: open_in_editor(path, line?)
    return this.fallback.openInEditor(path, line);
  }

  async saveWorktreeFile(path: string, content: string): Promise<void> {
    // Spec 11: save_worktree_file(path, content)
    return this.fallback.saveWorktreeFile(path, content);
  }

  onOperationChanged(cb: () => void): () => void {
    // Spec 11: repo://operation-changed
    return this.fallback.onOperationChanged(cb);
  }
}
