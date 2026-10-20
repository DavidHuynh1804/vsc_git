import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { executeGraphAction, splitRemoteRef, webUrlFor } from "@/graph/graphActions";
import { useScmStore } from "@/scm/scmStore";
import { setGlobalErrorHandler } from "@/utils/errors";
import { AppError } from "@/bindings";

const SHA = "1111111111111111111111111111111111111111";

describe("executeGraphAction", () => {
  let calls: { cmd: string; args: Record<string, unknown> }[];
  let reportedError: AppError | null;
  let failCmd: string | null;

  beforeEach(() => {
    calls = [];
    reportedError = null;
    failCmd = null;
    setGlobalErrorHandler((err) => {
      reportedError = err;
    });
    mockIPC((cmd, args) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      if (cmd === failCmd) {
        throw { kind: "Conflict", message: "boom", git_stderr: null, hint: null };
      }
      if (cmd === "host_info") {
        return { host: "github.com", kind: "github", apiBaseUrl: "", namespace: "acme", repo: "app" };
      }
      return null;
    });
    // Keep store refreshes from hitting the mock with real data sources.
    useScmStore.setState({
      refreshStatus: async () => {},
      refreshRefs: async () => {},
      refreshStashes: async () => {},
    });
  });

  afterEach(() => {
    clearMocks();
    setGlobalErrorHandler(null);
  });

  const invoked = (cmd: string) => calls.find((c) => c.cmd === cmd);

  it.each([
    ["checkout-detached", { sha: SHA }, "checkout", { refName: SHA }],
    ["cherry-pick", { sha: SHA }, "cherry_pick", { sha: SHA }],
    ["revert", { sha: SHA }, "revert", { sha: SHA }],
    ["reset-hard", { sha: SHA }, "reset", { sha: SHA, mode: "hard" }],
    ["reset-soft", { sha: SHA }, "reset", { sha: SHA, mode: "soft" }],
    ["merge-into-current", { sha: SHA }, "merge", { refName: SHA, opts: null }],
    ["merge-ref-into-current", { name: "feature" }, "merge", { refName: "feature", opts: null }],
    ["rebase-onto", { sha: SHA }, "rebase", { refName: SHA }],
    ["rebase-current-onto-ref", { name: "main" }, "rebase", { refName: "main" }],
    ["set-upstream", { name: "feature" }, "set_upstream", { branch: "feature", upstream: "origin/feature" }],
  ])("%s calls %s", async (type, payload, cmd, args) => {
    await executeGraphAction({ type, payload });
    expect(invoked(cmd)?.args).toEqual(args);
    expect(reportedError).toBeNull();
  });

  it("checks out a remote branch by its short name", async () => {
    await executeGraphAction({ type: "checkout-ref", payload: { name: "origin/feat/x", kind: "RemoteBranch" } });
    expect(invoked("checkout")?.args).toEqual({ refName: "feat/x" });
  });

  it("creates branch and tag at the commit with the prompted name", async () => {
    await executeGraphAction({ type: "create-branch", payload: { sha: SHA } }, "topic");
    expect(invoked("create_branch")?.args).toEqual({ name: "topic", startPoint: SHA });
    await executeGraphAction({ type: "create-tag", payload: { sha: SHA } }, "v2");
    expect(invoked("create_tag")?.args).toEqual({ name: "v2", target: SHA, message: null });
  });

  it("renames a branch", async () => {
    await executeGraphAction({ type: "rename-ref", payload: { name: "old" } }, "new");
    expect(invoked("rename_branch")?.args).toEqual({ oldName: "old", newName: "new" });
  });

  it("deletes local, remote and tag refs with the matching command", async () => {
    await executeGraphAction({ type: "delete-ref", payload: { name: "feature", kind: "LocalBranch" } });
    expect(invoked("delete_branch")?.args).toEqual({ name: "feature", force: false });
    await executeGraphAction({ type: "delete-ref", payload: { name: "origin/feature", kind: "RemoteBranch" } });
    expect(invoked("delete_remote_branch")?.args).toEqual({ remote: "origin", branch: "feature" });
    await executeGraphAction({ type: "delete-ref", payload: { name: "v1", kind: "Tag" } });
    expect(invoked("delete_tag")?.args).toEqual({ name: "v1" });
  });

  it("pushes a branch with upstream and a tag via push_tag", async () => {
    await executeGraphAction({ type: "push-ref", payload: { name: "feature", kind: "LocalBranch" } });
    expect(invoked("push")?.args).toEqual({
      options: { remote: null, branch: "feature", set_upstream: true, force_with_lease: false, tags: false },
    });
    await executeGraphAction({ type: "push-ref", payload: { name: "v1", kind: "Tag" } });
    expect(invoked("push_tag")?.args).toEqual({ name: "v1", remote: null });
  });

  it("opens the commit on the hosting web UI", async () => {
    await executeGraphAction({ type: "open-web", payload: { sha: SHA } });
    expect(invoked("open_url")?.args).toEqual({ url: `https://github.com/acme/app/commit/${SHA}` });
  });

  it("reports backend errors instead of swallowing them", async () => {
    failCmd = "cherry_pick";
    await executeGraphAction({ type: "cherry-pick", payload: { sha: SHA } });
    expect(reportedError?.kind).toBe("Conflict");
  });
});

describe("graph action helpers", () => {
  it("splits remote refs", () => {
    expect(splitRemoteRef("origin/feat/x")).toEqual({ remote: "origin", branch: "feat/x" });
  });

  it("builds GitLab URLs", () => {
    const host = { host: "gitlab.com", kind: "gitlab", namespace: "g", repo: "r" };
    expect(webUrlFor(host, { branch: "main" })).toBe("https://gitlab.com/g/r/-/tree/main");
  });
});
