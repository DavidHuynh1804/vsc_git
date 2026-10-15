import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { TauriGraphDataSource } from "@/graph/dataSource";
import { TauriScmDataSource } from "@/scm/dataSource";
import { TauriM3DataSource } from "@/m3/dataSource";
import { setGlobalErrorHandler } from "@/utils/errors";
import { AppError } from "@/bindings";

describe("Tauri Data Sources with mockIPC", () => {
  let reportedError: AppError | null = null;

  beforeEach(() => {
    reportedError = null;
    setGlobalErrorHandler((err) => {
      reportedError = err;
    });
  });

  afterEach(() => {
    clearMocks();
    setGlobalErrorHandler(null);
  });

  describe("TauriGraphDataSource", () => {
    it("resets with mapped filter and fetches pages", async () => {
      let resetArgs: Record<string, unknown> | null = null;
      let pageArgs: Record<string, unknown> | null = null;

      mockIPC((cmd, args) => {
        if (cmd === "graph_reset") {
          resetArgs = args as Record<string, unknown>;
          return null;
        }
        if (cmd === "graph_page") {
          pageArgs = args as Record<string, unknown>;
          return {
            commits: [
              {
                sha: "1111111111111111111111111111111111111111",
                short_sha: "1111111",
                parents: [],
                author_name: "Test Author",
                author_email: "test@example.com",
                author_time: 1700000000,
                committer_time: 1700000000,
                subject: "feat: test commit",
                refs: [{ name: "main", kind: "LocalBranch" }],
              },
            ],
            rows: [
              {
                sha: "1111111111111111111111111111111111111111",
                col: 0,
                color: 0,
                edges: [],
              },
            ],
            has_more: false,
          };
        }
      });

      const ds = new TauriGraphDataSource();
      await ds.reset({
        refs: { Selected: ["main"] },
        include_remotes: false,
        include_tags: true,
        include_stash: false,
        first_parent_only: true,
      });

      expect(resetArgs).toEqual({
        filter: {
          refs: ["main"],
          include_remotes: false,
          include_tags: true,
          include_stash: false,
          first_parent_only: true,
        },
      });

      const page = await ds.page(100);
      expect(pageArgs).toEqual({ limit: 100 });
      expect(page.commits).toHaveLength(1);
      expect(page.commits[0].subject).toBe("feat: test commit");
      expect(page.rows).toHaveLength(1);
      expect(page.has_more).toBe(false);
    });

    it("fetches commit detail and compares commits", async () => {
      mockIPC((cmd, args) => {
        if (cmd === "commit_detail") {
          const sha = typeof args === "object" && args && "sha" in args ? String(args.sha) : "";
          return {
            summary: {
              sha,
              short_sha: "2222222",
              parents: ["1111111"],
              author_name: "Author",
              author_email: "author@test.com",
              author_time: 1700000000,
              committer_time: 1700000000,
              subject: "detail subject",
              refs: [],
            },
            body: "Full commit body",
            committer: {
              name: "Committer",
              email: "committer@test.com",
              time: 1700000000,
            },
            signature_present: true,
            files: [
              {
                path: "src/main.rs",
                old_path: null,
                status: "Modified",
                additions: 10,
                deletions: 2,
                binary: false,
              },
            ],
          };
        }
        if (cmd === "compare") {
          return [
            {
              path: "Cargo.toml",
              old_path: null,
              status: "Added",
              additions: 5,
              deletions: 0,
              binary: false,
            },
          ];
        }
        if (cmd === "get_status") {
          return {
            branch: { oid: "abc", head: "main", upstream: null, ahead: 0, behind: 0 },
            entries: [{ path: "file.txt", staged: true, unstaged: false, kind: "Modified", orig_path: null, conflict_type: null }],
          };
        }
      });

      const ds = new TauriGraphDataSource();
      const detail = await ds.detail("2222222222222222222222222222222222222222");
      expect(detail.summary.subject).toBe("detail subject");
      expect(detail.files[0].status).toBe("M");

      const changes = await ds.compare("111", "222");
      expect(changes).toHaveLength(1);
      expect(changes[0].status).toBe("A");

      const dirty = await ds.isDirty?.();
      expect(dirty).toBe(true);
    });

    it("propagates AppError to error reporter on failure", async () => {
      mockIPC((cmd) => {
        if (cmd === "graph_page") {
          throw {
            kind: "Internal",
            message: "Failed to read graph page",
            git_stderr: null,
            hint: null,
          };
        }
      });

      const ds = new TauriGraphDataSource();
      await expect(ds.page(50)).rejects.toMatchObject({
        kind: "Internal",
        message: "Failed to read graph page",
      });
      expect(reportedError).toMatchObject({
        kind: "Internal",
        message: "Failed to read graph page",
      });
    });
  });

  describe("TauriScmDataSource", () => {
    it("gets status, stages, unstages, and commits", async () => {
      let stagedPaths: string[] | null = null;
      let committedOptions: Record<string, unknown> | null = null;

      mockIPC((cmd, args) => {
        if (cmd === "get_status") {
          return {
            branch: {
              oid: "abc",
              head: "feature/test",
              upstream: "origin/feature/test",
              ahead: 1,
              behind: 2,
            },
            entries: [
              {
                path: "modified.txt",
                staged: false,
                unstaged: true,
                kind: "Modified",
                orig_path: null,
                conflict_type: null,
              },
              {
                path: "untracked.txt",
                staged: false,
                unstaged: true,
                kind: "Untracked",
                orig_path: null,
                conflict_type: null,
              },
              {
                path: "conflict.txt",
                staged: false,
                unstaged: true,
                kind: "Unmerged",
                orig_path: null,
                conflict_type: "both modified",
              },
            ],
          };
        }
        if (cmd === "stage") {
          if (typeof args === "object" && args && "paths" in args) {
            stagedPaths = args.paths as string[];
          }
          return null;
        }
        if (cmd === "commit") {
          if (typeof args === "object" && args && "options" in args) {
            committedOptions = args.options as Record<string, unknown>;
          }
          return null;
        }
        if (cmd === "last_commit_message") {
          return "feat: last commit message";
        }
      });

      const ds = new TauriScmDataSource();
      const status = await ds.getStatus();

      expect(status.branch.head).toBe("feature/test");
      expect(status.branch.ahead).toBe(1);
      expect(status.branch.behind).toBe(2);
      expect(status.entries).toHaveLength(3);
      expect(status.entries[0].kind.type).toBe("Ordinary");
      expect(status.entries[1].kind.type).toBe("Untracked");
      expect(status.entries[2].kind.type).toBe("Unmerged");

      await ds.stage(["modified.txt"]);
      expect(stagedPaths).toEqual(["modified.txt"]);

      await ds.commit({ message: "feat: ship wired frontend" });
      expect(committedOptions).toMatchObject({
        message: "feat: ship wired frontend",
        amend: false,
      });

      const lastMsg = await ds.lastCommitMessage();
      expect(lastMsg).toBe("feat: last commit message");

      ds.dispose();
    });

    it("handles refs, stashes, and file content", async () => {
      mockIPC((cmd) => {
        if (cmd === "list_refs") {
          return [
            {
              name: "main",
              kind: "Head",
              target_sha: "111",
              upstream: "origin/main",
              ahead: 0,
              behind: 0,
              is_head: true,
            },
            {
              name: "origin/main",
              kind: "RemoteBranch",
              target_sha: "111",
              upstream: null,
              ahead: 0,
              behind: 0,
              is_head: false,
            },
            {
              name: "v1.0.0",
              kind: "Tag",
              target_sha: "111",
              upstream: null,
              ahead: 0,
              behind: 0,
              is_head: false,
            },
          ];
        }
        if (cmd === "list_stashes") {
          return [
            {
              index: 0,
              name: "stash@{0}",
              commit_id: "333",
              subject: "WIP on main",
              date: "1 hour ago",
            },
          ];
        }
        if (cmd === "get_file_content") {
          return "content of file";
        }
      });

      const ds = new TauriScmDataSource();
      const refs = await ds.getRefs();
      expect(refs.head).toBe("main");
      expect(refs.branches).toHaveLength(1);
      expect(refs.branches[0].isHead).toBe(true);
      expect(refs.remotes).toHaveLength(1);
      expect(refs.remotes[0].remote).toBe("origin");
      expect(refs.tags).toHaveLength(1);

      const stashes = await ds.listStashes();
      expect(stashes).toHaveLength(1);
      expect(stashes[0].message).toBe("WIP on main");

      const content = await ds.fileContent("src/test.ts", { kind: "Head" });
      expect(content).toBe("content of file");

      ds.dispose();
    });

    it("handles sync/push/pull job spawning and cancel", async () => {
      let cancelledJobId: string | null = null;
      mockIPC((cmd, args) => {
        if (cmd === "sync") {
          return "job_sync_123";
        }
        if (cmd === "cancel_job") {
          if (typeof args === "object" && args && "id" in args) {
            cancelledJobId = String(args.id);
          }
          return null;
        }
      });

      const ds = new TauriScmDataSource();
      const jobId = await ds.sync();
      expect(jobId).toBe("job_sync_123");

      await ds.cancelJob("job_sync_123");
      expect(cancelledJobId).toBe("job_sync_123");

      ds.dispose();
    });
  });

  describe("TauriM3DataSource", () => {
    it("manages operation state and continue/skip/abort", async () => {
      let calledCmd = "";
      mockIPC((cmd) => {
        if (cmd === "get_operation_state") {
          return {
            Rebasing: {
              step: 2,
              total: 5,
              onto: "main",
              branch: "feat",
            },
          };
        }
        if (cmd === "op_continue" || cmd === "op_skip" || cmd === "op_abort") {
          calledCmd = cmd;
          return null;
        }
      });

      const ds = new TauriM3DataSource();
      const state = await ds.getOperationState();
      expect(state).toEqual({
        Rebasing: {
          step: 2,
          total: 5,
          onto: "main",
          branch: "feat",
        },
      });

      await ds.opContinue();
      expect(calledCmd).toBe("op_continue");

      await ds.opSkip();
      expect(calledCmd).toBe("op_skip");

      await ds.opAbort();
      expect(calledCmd).toBe("op_abort");
    });

    it("gets conflict versions and resolves", async () => {
      let resolvedContent: string | null = null;
      let resolvedWithMethod: string | null = null;

      mockIPC((cmd, args) => {
        if (cmd === "get_conflict") {
          return {
            base: [98, 97, 115, 101], // "base"
            ours: [111, 117, 114, 115], // "ours"
            theirs: [116, 104, 101, 105, 114, 115], // "theirs"
            worktree: [119, 111, 114, 107], // "work"
          };
        }
        if (cmd === "resolve_conflict") {
          if (typeof args === "object" && args && "content" in args) {
            resolvedContent = String(args.content);
          }
          return null;
        }
        if (cmd === "resolve_with") {
          if (typeof args === "object" && args && "resolution" in args) {
            resolvedWithMethod = String(args.resolution);
          }
          return null;
        }
      });

      const ds = new TauriM3DataSource();
      const versions = await ds.getConflict("conflict.txt");
      expect(versions.base).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(versions.base as Uint8Array)).toBe("base");
      expect(new TextDecoder().decode(versions.ours as Uint8Array)).toBe("ours");

      await ds.resolveConflict("conflict.txt", "resolved content");
      expect(resolvedContent).toBe("resolved content");

      await ds.resolveWith("conflict.txt", "Ours");
      expect(resolvedWithMethod).toBe("Ours");
    });

    it("handles blame, file history, and interactive rebase submit", async () => {
      let submittedItems: unknown = null;
      let submittedPromptId: string | null = null;

      mockIPC((cmd, args) => {
        if (cmd === "blame") {
          return [
            {
              line_no: 1,
              commit: {
                sha: "aaaa",
                author: "Tester",
                author_mail: "tester@example.com",
                author_time: 1700000000,
                summary: "blame summary",
              },
            },
          ];
        }
        if (cmd === "file_history") {
          return [
            {
              sha: "bbbb",
              parents: ["aaaa"],
              author: "Tester",
              date: 1700000000,
              subject: "history subject",
            },
          ];
        }
        if (cmd === "rebase_interactive") {
          return "job_rebase_1";
        }
        if (cmd === "submit_rebase_todo") {
          if (typeof args === "object" && args) {
            if ("items" in args) submittedItems = args.items;
            if ("promptId" in args) submittedPromptId = args.promptId as string | null;
          }
          return null;
        }
      });

      const ds = new TauriM3DataSource();
      const lines = await ds.blame("file.txt");
      expect(lines).toHaveLength(1);
      expect(lines[0].commit.sha).toBe("aaaa");

      const history = await ds.fileHistory("file.txt");
      expect(history).toHaveLength(1);
      expect(history[0].sha).toBe("bbbb");
      expect(history[0].time).toBe(1700000000);

      const jobId = await ds.rebaseInteractive("main");
      expect(jobId).toBe("job_rebase_1");

      await ds.submitRebaseTodo(
        [
          { action: "pick", sha: "111", subject: "commit 1" },
          { action: "reword", sha: "222", subject: "commit 2" },
        ],
        "prompt-123"
      );
      expect(submittedPromptId).toBe("prompt-123");
      expect(submittedItems).toEqual([
        { action: "Pick", sha: "111", subject: "commit 1" },
        { action: "Reword", sha: "222", subject: "commit 2" },
      ]);
    });
  });
});
