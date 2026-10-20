/**
 * Real-backend spec: partial staging. Covers staging a single changed line
 * from the Diff toolbar (range staging UI) and the precise range APIs
 * (stage_selections / unstage_selections / revert_selections) against the
 * real git index and worktree.
 */
import { test, expect } from "@playwright/test";
import { bridgeInvoke, bridgeOpenRepo } from "../helpers/bridge";
import { readFile } from "../helpers/fixtures";
import { stagedDiff, stagedPaths, worktreeDiff } from "../helpers/git";
import { createTwoHunkRepo } from "../helpers/fixtures";
import { gotoActivity, openApp, openDiffViaUi } from "../helpers/app";

test.describe("range staging", () => {
  test("stages and unstages a single changed line from the diff toolbar", async ({ page }) => {
    const repo = createTwoHunkRepo("ranges-ui");
    await bridgeOpenRepo(repo.dir);
    await openApp(page);
    await gotoActivity(page, "Source Control");

    // Open the working-tree diff for notes.txt.
    await openDiffViaUi(page, "Unstaged changes", "notes.txt");

    // Click the changed line on the modified (right) side, then stage just it.
    const modifiedLine = page.locator(".editor.modified .view-line").filter({ hasText: "changed02" }).first();
    await expect(modifiedLine).toBeVisible();
    await modifiedLine.click();
    await page.getByRole("button", { name: /Stage Selected Ranges/ }).click();

    // Real index: only the +changed02 hunk got staged.
    await expect.poll(() => stagedPaths(repo.dir)).toEqual(["notes.txt"]);
    const cached = stagedDiff(repo.dir, "notes.txt");
    expect(cached).toContain("+changed02");
    expect(cached).not.toContain("+changed10");
    // Worktree still has the other change.
    expect(worktreeDiff(repo.dir, "notes.txt")).toContain("+changed10");

    // Now open the staged diff and unstage that same line from the toolbar.
    await openDiffViaUi(page, "Staged changes", "notes.txt");
    const stagedLine = page.locator(".editor.modified .view-line").filter({ hasText: "changed02" }).first();
    await expect(stagedLine).toBeVisible();
    await stagedLine.click();
    await page.getByRole("button", { name: /Unstage Selected Ranges/ }).click();

    await expect.poll(() => stagedPaths(repo.dir)).toEqual([]);
  });

  test("stage_selections / revert_selections apply exact line ranges", async () => {
    const repo = createTwoHunkRepo("ranges-api");
    await bridgeOpenRepo(repo.dir);

    // Stage only line 2 (the +changed02 modification). A modification needs
    // both sides of the line: the Original side for the deleted line and the
    // Modified side for the added one.
    await bridgeInvoke("stage_selections", {
      path: "notes.txt",
      selections: [
        { side: "Original", start: 2, end: 2 },
        { side: "Modified", start: 2, end: 2 },
      ],
    });
    await expect.poll(() => stagedPaths(repo.dir)).toEqual(["notes.txt"]);
    const cached = stagedDiff(repo.dir, "notes.txt");
    expect(cached).toContain("-line02");
    expect(cached).toContain("+changed02");
    expect(cached).not.toContain("+changed10");

    // Unstage that line again -> index back to HEAD.
    await bridgeInvoke("unstage_selections", {
      path: "notes.txt",
      selections: [
        { side: "Original", start: 2, end: 2 },
        { side: "Modified", start: 2, end: 2 },
      ],
    });
    await expect.poll(() => stagedPaths(repo.dir)).toEqual([]);

    // Revert the line-10 change in the worktree -> only changed02 remains.
    await bridgeInvoke("revert_selections", {
      path: "notes.txt",
      selections: [
        { side: "Original", start: 10, end: 10 },
        { side: "Modified", start: 10, end: 10 },
      ],
    });
    await expect.poll(() => readFile(repo.dir, "notes.txt")).toContain("line10");
    const remaining = worktreeDiff(repo.dir, "notes.txt");
    expect(remaining).toContain("+changed02");
    expect(remaining).not.toContain("+changed10");
  });
});
