/**
 * Real-backend spec: history operations.
 *
 * Cherry-pick is covered through the graph context menu (which is wired).
 * Revert and reset are covered at the backend level (bridge invoke + real git
 * assertions): the graph context menu items for those actions are rendered but
 * never dispatch a backend command in the current UI (see the test.fixme
 * below), so they cannot be driven through the UI yet.
 */
import { test, expect } from "@playwright/test";
import { bridgeInvoke, bridgeOpenRepo } from "../helpers/bridge";
import { commitCount, headSha, logSubjects, revParse, tryRevParse, stagedPaths, statusPorcelain } from "../helpers/git";
import { createBaseRepo, createBranchRepo, readFile, writeFile } from "../helpers/fixtures";
import { gotoGraphWithCommit, graphContextAction, openApp } from "../helpers/app";

test.describe("history operations", () => {
  test("cherry-picks a commit from the graph context menu", async ({ page }) => {
    const repo = createBranchRepo("cherry-pick");
    await bridgeOpenRepo(repo.dir);
    await openApp(page);
    await gotoGraphWithCommit(page, repo.featureSha);

    expect(headSha(repo.dir)).toBe(repo.firstSha);
    expect(commitCount(repo.dir)).toBe(1);

    await graphContextAction(page, repo.featureSha, "Cherry-pick");

    // Real git: a new commit with the picked subject on top of main.
    await expect.poll(() => commitCount(repo.dir)).toBe(2);
    expect(logSubjects(repo.dir, 1)[0]).toBe("feat: pick me");
    expect(readFile(repo.dir, "feature.txt")).toBe("feature work\n");
    // The original branch still points at its own commit.
    expect(revParse(repo.dir, "feature")).toBe(repo.featureSha);
  });

  test("reverts a commit through the backend command", async () => {
    const repo = createBaseRepo("revert");
    await bridgeOpenRepo(repo.dir);

    await bridgeInvoke("revert", { sha: repo.secondSha });

    await expect.poll(() => commitCount(repo.dir)).toBe(3);
    const subject = logSubjects(repo.dir, 1)[0];
    expect(subject).toContain(`Revert "feat: add value"`);
    expect(readFile(repo.dir, "src/app.ts")).toBe("export const value = 1;\n");
  });

  test("resets the branch with soft/mixed/hard modes through the backend command", async () => {
    const repo = createBaseRepo("reset");
    await bridgeOpenRepo(repo.dir);

    // Soft: HEAD moves back, index keeps the newer tree -> staged changes.
    await bridgeInvoke("reset", { sha: repo.firstSha, mode: "soft" });
    await expect.poll(() => headSha(repo.dir)).toBe(repo.firstSha);
    expect(stagedPaths(repo.dir)).toEqual(["src/app.ts"]);

    // Mixed (default): HEAD moves, index reset, worktree untouched.
    await bridgeInvoke("reset", { sha: repo.secondSha, mode: "mixed" });
    await expect.poll(() => headSha(repo.dir)).toBe(repo.secondSha);
    expect(stagedPaths(repo.dir)).toEqual([]);
    expect(statusPorcelain(repo.dir)).toBe("");

    // Hard: worktree is overwritten.
    writeFile(repo.dir, "src/app.ts", "export const value = 1;\n// scratch\n");
    await bridgeInvoke("reset", { sha: repo.firstSha, mode: "hard" });
    await expect.poll(() => headSha(repo.dir)).toBe(repo.firstSha);
    expect(readFile(repo.dir, "src/app.ts")).toBe("export const value = 1;\n");
    expect(statusPorcelain(repo.dir)).toBe("");
  });

  test("reverts and resets from the graph context menu", async ({ page }) => {
    const repo = createBaseRepo("revert-ui");
    await bridgeOpenRepo(repo.dir);
    await openApp(page);
    await gotoGraphWithCommit(page, repo.secondSha);

    await graphContextAction(page, repo.secondSha, "Revert");
    await expect.poll(() => commitCount(repo.dir)).toBe(3);
    expect(logSubjects(repo.dir, 1)[0]).toContain("Revert");

    // Soft reset back to the first commit keeps the changes staged.
    await gotoGraphWithCommit(page, repo.firstSha);
    await graphContextAction(page, repo.firstSha, "Reset current branch (Soft)");
    await expect.poll(() => headSha(repo.dir)).toBe(repo.firstSha);
  });

  test("creates a branch and a tag at a commit from the graph context menu", async ({ page }) => {
    const repo = createBaseRepo("graph-branch-tag");
    await bridgeOpenRepo(repo.dir);
    await openApp(page);
    await gotoGraphWithCommit(page, repo.firstSha);

    await graphContextAction(page, repo.firstSha, "Create Branch...");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Branch name" }).fill("from-graph");
    await dialog.getByRole("button", { name: "OK" }).click();
    await expect.poll(() => tryRevParse(repo.dir, "from-graph")).toBe(repo.firstSha);

    await graphContextAction(page, repo.firstSha, "Create Tag...");
    await page.getByRole("dialog").getByRole("textbox", { name: "Tag name" }).fill("v-graph");
    await page.getByRole("dialog").getByRole("button", { name: "OK" }).click();
    await expect.poll(() => tryRevParse(repo.dir, "v-graph")).toBe(repo.firstSha);
  });
});
