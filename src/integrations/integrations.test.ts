import { describe, it, expect, beforeEach } from "vitest";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { events } from "@/bindings";
import { checkRequiredScopes } from "./types";
import { MockHostingDataSource, TauriHostingDataSource } from "./hosting";
import {
  MockAiDataSource,
  LocalStorageAiConsentDataSource,
  TauriAiDataSource,
  TauriAiConsentDataSource,
} from "./ai";
describe("Integrations and Scope Checking", () => {
  describe("checkRequiredScopes", () => {
    it("detects missing GitHub scopes", () => {
      const missingRepo = checkRequiredScopes("github", ["read:user"]);
      expect(missingRepo.ok).toBe(false);
      expect(missingRepo.missingScopes).toEqual(["repo"]);

      const missingUser = checkRequiredScopes("github", ["repo"]);
      expect(missingUser.ok).toBe(false);
      expect(missingUser.missingScopes).toEqual(["read:user"]);

      const fullScopes = checkRequiredScopes("github", ["repo", "read:user", "workflow"]);
      expect(fullScopes.ok).toBe(true);
      expect(fullScopes.missingScopes).toEqual([]);
    });

    it("detects missing GitLab scopes", () => {
      const missingApi = checkRequiredScopes("gitlab", ["read_user", "read_repository"]);
      expect(missingApi.ok).toBe(false);
      expect(missingApi.missingScopes).toEqual(["api"]);

      const fullApi = checkRequiredScopes("gitlab", ["api", "read_user"]);
      expect(fullApi.ok).toBe(true);
      expect(fullApi.missingScopes).toEqual([]);
    });
  });

  describe("MockHostingDataSource", () => {
    it("tests connection and returns missing scopes if insufficient", async () => {
      const hostDs = new MockHostingDataSource();
      hostDs.setUserScopes("github.com", ["read:user"]);

      const res = await hostDs.testConnection({
        host: "github.com",
        kind: "github",
        apiBaseUrl: "https://api.github.com",
      });

      expect(res.user.username).toBe("octocat");
      expect(res.scopeCheck.ok).toBe(false);
      expect(res.scopeCheck.missingScopes).toContain("repo");
    });

    it("filters reviewers by query", async () => {
      const hostDs = new MockHostingDataSource();
      const all = await hostDs.searchReviewers("github.com", "");
      expect(all.length).toBeGreaterThan(0);

      const filtered = await hostDs.searchReviewers("github.com", "alice");
      expect(filtered.length).toBe(1);
      expect(filtered[0].username).toBe("alice");
    });

    it("tracks branch pushed status and allows pushing", async () => {
      const hostDs = new MockHostingDataSource();
      expect(await hostDs.checkBranchPushed("feat/new-ui")).toBe(false);

      await hostDs.pushBranch("feat/new-ui");
      expect(await hostDs.checkBranchPushed("feat/new-ui")).toBe(true);
    });

    it("creates a pull request successfully", async () => {
      const hostDs = new MockHostingDataSource();
      const pr = await hostDs.createPullRequest({
        base: "main",
        head: "feat/new-ui",
        title: "feat: add settings",
        body: "Description",
        draft: false,
        reviewers: ["alice"],
        labels: ["enhancement"],
      });

      expect(pr.number).toBeGreaterThan(0);
      expect(pr.title).toBe("feat: add settings");
      expect(pr.url).toContain("pull");
    });
  });

  describe("MockAiDataSource", () => {
    it("lists default models for claude, openai, and ollama", async () => {
      const aiDs = new MockAiDataSource();
      const claudeModels = await aiDs.listModels("claude");
      expect(claudeModels).toContain("claude-haiku-5-5");

      const openaiModels = await aiDs.listModels("openai");
      expect(openaiModels).toContain("gpt-4o");

      const ollamaModels = await aiDs.listModels("ollama");
      expect(ollamaModels).toContain("llama3.2");
    });

    it("handles setAiKey without storing the raw secret in frontend store", async () => {
      const aiDs = new MockAiDataSource();
      await aiDs.setAiKey("claude", "sk-ant-api-key-test");
      expect(aiDs.lastSavedKeyProvider).toBe("claude");
      // Key itself is not accessible as property on dataSource
      expect((aiDs as unknown as Record<string, unknown>)["sk-ant-api-key-test"]).toBeUndefined();
    });

    it("streams PR generation in chunks", async () => {
      const aiDs = new MockAiDataSource();
      const receivedChunks: string[] = [];

      const result = await aiDs.generatePr("main", "feat/my-branch", (chunk) => {
        receivedChunks.push(chunk);
      });

      expect(receivedChunks.length).toBeGreaterThan(1);
      expect(result.body).toBe(receivedChunks.join(""));
      expect(result.title).toContain("feat: integrate changes");
    });
  });

  describe("LocalStorageAiConsentDataSource", () => {
    beforeEach(() => {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.clear();
      }
    });

    it("remembers consent per repo and provider", () => {
      const consentDs = new LocalStorageAiConsentDataSource();
      const repoA = "/path/to/repoA";
      const repoB = "/path/to/repoB";

      expect(consentDs.hasConsent(repoA, "claude")).toBe(false);
      expect(consentDs.hasConsent(repoB, "claude")).toBe(false);

      consentDs.setConsent(repoA, "claude", true);
      expect(consentDs.hasConsent(repoA, "claude")).toBe(true);
      expect(consentDs.hasConsent(repoB, "claude")).toBe(false);
      expect(consentDs.hasConsent(repoA, "openai")).toBe(false);
    });
  });

  describe("TauriHostingDataSource with mockIPC", () => {
    beforeEach(() => {
      clearMocks();
    });

    it("calls test_host_token command and returns user and scope check", async () => {
      mockIPC((cmd) => {
        if (cmd === "test_host_token") {
          return {
            user: {
              username: "octocat",
              name: "The Octocat",
              scopes: ["repo", "read:user"],
            },
            scopeCheck: {
              ok: true,
              requiredScopes: ["repo", "read:user"],
              missingScopes: [],
            },
          };
        }
      });

      const ds = new TauriHostingDataSource();
      const result = await ds.testConnection(
        { host: "github.com", kind: "github", apiBaseUrl: "https://api.github.com" },
        "ghp_test"
      );
      expect(result.user.username).toBe("octocat");
      expect(result.scopeCheck.ok).toBe(true);
    });

    it("calls set_host_token and throws on error", async () => {
      mockIPC((cmd) => {
        if (cmd === "set_host_token") {
          throw { kind: "AuthFailed", message: "Keyring access denied" };
        }
      });

      const ds = new TauriHostingDataSource();
      await expect(ds.setHostToken("github.com", "ghp_abc")).rejects.toThrow(
        "Keyring access denied"
      );
    });

    it("creates pull request and checks branch pushed", async () => {
      const eventListeners = new Map<string, number[]>();
      let nextId = 1;

      mockIPC(async (cmd, args) => {
        if (cmd === "plugin:event|listen") {
          if (args && typeof args === "object" && "event" in args && "handler" in args) {
            const ev = String(args.event);
            const hid = Number(args.handler);
            const list = eventListeners.get(ev) ?? [];
            list.push(hid);
            eventListeners.set(ev, list);
          }
          return nextId++;
        }
        if (cmd === "plugin:event|emit") {
          if (args && typeof args === "object" && "event" in args && "payload" in args) {
            const ev = String(args.event);
            const list = eventListeners.get(ev) ?? [];
            const win = window as unknown as {
              __TAURI_INTERNALS__?: {
                runCallback: (id: number, data: unknown) => void;
              };
            };
            for (const hid of list) {
              win.__TAURI_INTERNALS__?.runCallback(hid, {
                event: ev,
                id: hid,
                payload: args.payload,
              });
            }
          }
          return null;
        }
        if (cmd === "create_pull_request") {
          let title = "feat: add feature";
          if (args && typeof args === "object" && "req" in args) {
            const req = args.req;
            if (
              req &&
              typeof req === "object" &&
              "title" in req &&
              typeof req.title === "string"
            ) {
              title = req.title;
            }
          }
          return {
            id: 101,
            number: 1,
            title,
            url: "https://github.com/owner/repo/pull/1",
            base: "main",
            head: "feature",
            draft: false,
            state: "open",
            author: "octocat",
          };
        }
        if (cmd === "check_branch_pushed") {
          return true;
        }
        if (cmd === "push") {
          const jobId = "push-job-1";
          Promise.resolve().then(async () => {
            await events.jobDone.emit({
              id: jobId,
              success: true,
              error: null,
            });
          });
          return jobId;
        }
      });

      const ds = new TauriHostingDataSource();
      const isPushed = await ds.checkBranchPushed("feature");
      expect(isPushed).toBe(true);

      const pr = await ds.createPullRequest({
        base: "main",
        head: "feature",
        title: "feat: add feature",
        body: "body",
        draft: false,
        reviewers: [],
        labels: [],
      });
      expect(pr.number).toBe(1);
      expect(pr.title).toBe("feat: add feature");

      await expect(ds.pushBranch("feature")).resolves.not.toThrow();
    });

    it("pushBranch awaits jobDone and rejects if push fails", async () => {
      const eventListeners = new Map<string, number[]>();
      let nextId = 1;

      mockIPC(async (cmd, args) => {
        if (cmd === "plugin:event|listen") {
          if (args && typeof args === "object" && "event" in args && "handler" in args) {
            const ev = String(args.event);
            const hid = Number(args.handler);
            const list = eventListeners.get(ev) ?? [];
            list.push(hid);
            eventListeners.set(ev, list);
          }
          return nextId++;
        }
        if (cmd === "plugin:event|emit") {
          if (args && typeof args === "object" && "event" in args && "payload" in args) {
            const ev = String(args.event);
            const list = eventListeners.get(ev) ?? [];
            const win = window as unknown as {
              __TAURI_INTERNALS__?: {
                runCallback: (id: number, data: unknown) => void;
              };
            };
            for (const hid of list) {
              win.__TAURI_INTERNALS__?.runCallback(hid, {
                event: ev,
                id: hid,
                payload: args.payload,
              });
            }
          }
          return null;
        }
        if (cmd === "push") {
          const jobId = "failed-push-job-77";
          Promise.resolve().then(async () => {
            await events.jobDone.emit({
              id: jobId,
              success: false,
              error: "Remote rejected push: non-fast-forward",
            });
          });
          return jobId;
        }
      });

      const ds = new TauriHostingDataSource();
      await expect(ds.pushBranch("feature")).rejects.toThrow(
        "Remote rejected push: non-fast-forward"
      );
    });
  });

  describe("TauriAiDataSource and TauriAiConsentDataSource with mockIPC", () => {
    beforeEach(() => {
      clearMocks();
    });

    it("lists models and tests provider through mockIPC", async () => {
      mockIPC((cmd) => {
        if (cmd === "ai_list_models") {
          return ["claude-haiku-5-5", "claude-sonnet-5-5"];
        }
        if (cmd === "test_ai_provider") {
          return "Connection to claude successful";
        }
        if (cmd === "set_ai_key") {
          return null;
        }
      });

      const ds = new TauriAiDataSource();
      const models = await ds.listModels("claude");
      expect(models).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);

      const testMsg = await ds.testProvider("claude");
      expect(testMsg).toContain("Connection to claude successful");

      await expect(ds.setAiKey("claude", "sk-ant-test")).resolves.not.toThrow();
    });

    it("TauriAiConsentDataSource syncs consent from settings and calls backend command", async () => {
      let savedConsent: { repoPath: string; provider: string; granted: boolean } | null = null;
      mockIPC((cmd, args) => {
        if (cmd === "get_settings") {
          return {
            "ai.consents": {
              "/path/to/consented-repo": ["claude"],
            },
          };
        }
        if (cmd === "ai_set_consent") {
          if (
            args &&
            typeof args === "object" &&
            "repoPath" in args &&
            "provider" in args &&
            "granted" in args &&
            typeof args.repoPath === "string" &&
            typeof args.provider === "string" &&
            typeof args.granted === "boolean"
          ) {
            savedConsent = {
              repoPath: args.repoPath,
              provider: args.provider,
              granted: args.granted,
            };
          }
          return null;
        }
        if (cmd === "ai_has_consent") {
          return false;
        }
      });

      const consentDs = new TauriAiConsentDataSource();
      await consentDs.sync();
      expect(consentDs.hasConsent("/path/to/consented-repo", "claude")).toBe(true);
      expect(consentDs.hasConsent("/path/to/other-repo", "claude")).toBe(false);

      consentDs.setConsent("/path/to/other-repo", "claude", true);
      expect(consentDs.hasConsent("/path/to/other-repo", "claude")).toBe(true);
      expect(savedConsent).toEqual({
        repoPath: "/path/to/other-repo",
        provider: "claude",
        granted: true,
      });
    });
    it("handles fast-failure streaming path when backend fails immediately", async () => {
      const eventListeners = new Map<string, number[]>();
      let nextId = 1;

      mockIPC(async (cmd, args) => {
        if (cmd === "plugin:event|listen") {
          if (args && typeof args === "object" && "event" in args && "handler" in args) {
            const ev = String(args.event);
            const hid = Number(args.handler);
            const list = eventListeners.get(ev) ?? [];
            list.push(hid);
            eventListeners.set(ev, list);
          }
          return nextId++;
        }
        if (cmd === "plugin:event|emit") {
          if (args && typeof args === "object" && "event" in args && "payload" in args) {
            const ev = String(args.event);
            const list = eventListeners.get(ev) ?? [];
            const win = window as unknown as {
              __TAURI_INTERNALS__?: {
                runCallback: (id: number, data: unknown) => void;
              };
            };
            for (const hid of list) {
              win.__TAURI_INTERNALS__?.runCallback(hid, {
                event: ev,
                id: hid,
                payload: args.payload,
              });
            }
          }
          return null;
        }
        if (cmd === "ai_generate_commit") {
          const jobId = "fast-fail-job-1";
          // Emit error immediately
          await events.jobDone.emit({
            id: jobId,
            success: false,
            error: "No staged changes found in repository",
          });
          return jobId;
        }
      });

      const ds = new TauriAiDataSource();
      await expect(ds.generateCommit()).rejects.toThrow(
        "No staged changes found in repository"
      );
    });

    it("maintains concurrent-job isolation during streaming", async () => {
      const targetJobId = "target-ai-job-42";
      const otherJobId = "unrelated-fetch-job-99";
      const eventListeners = new Map<string, number[]>();
      let nextId = 1;

      mockIPC(async (cmd, args) => {
        if (cmd === "plugin:event|listen") {
          if (args && typeof args === "object" && "event" in args && "handler" in args) {
            const ev = String(args.event);
            const hid = Number(args.handler);
            const list = eventListeners.get(ev) ?? [];
            list.push(hid);
            eventListeners.set(ev, list);
          }
          return nextId++;
        }
        if (cmd === "plugin:event|emit") {
          if (args && typeof args === "object" && "event" in args && "payload" in args) {
            const ev = String(args.event);
            const list = eventListeners.get(ev) ?? [];
            const win = window as unknown as {
              __TAURI_INTERNALS__?: {
                runCallback: (id: number, data: unknown) => void;
              };
            };
            for (const hid of list) {
              win.__TAURI_INTERNALS__?.runCallback(hid, {
                event: ev,
                id: hid,
                payload: args.payload,
              });
            }
          }
          return null;
        }
        if (cmd === "ai_generate_commit") {
          // Emit noise from another unrelated job before target starts
          await events.jobChunk.emit({
            id: otherJobId,
            chunk: "unrelated chunk that must be ignored",
          });
          await events.jobDone.emit({
            id: otherJobId,
            success: true,
            error: null,
          });

          // Now emit for target job
          Promise.resolve().then(async () => {
            await events.jobChunk.emit({
              id: targetJobId,
              chunk: "feat: target commit chunk",
            });
            await events.jobDone.emit({
              id: targetJobId,
              success: true,
              error: null,
            });
          });

          return targetJobId;
        }
      });

      const receivedChunks: string[] = [];
      const ds = new TauriAiDataSource();
      const fullMessage = await ds.generateCommit((chunk) => {
        receivedChunks.push(chunk);
      });

      expect(receivedChunks).toEqual(["feat: target commit chunk"]);
      expect(fullMessage).toBe("feat: target commit chunk");
    });
  });
});
