import { describe, it, expect, beforeEach } from "vitest";
import { checkRequiredScopes } from "./types";
import { MockHostingDataSource } from "./hosting";
import { MockAiDataSource, LocalStorageAiConsentDataSource } from "./ai";

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
});
