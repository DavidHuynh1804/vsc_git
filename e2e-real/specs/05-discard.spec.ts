/**
 * Real-backend spec: discarding a modified file through the row context menu,
 * verified against the real worktree content.
 */
import { test, expect } from "@playwright/test";
import { bridgeOpenRepo } from "../helpers/bridge";
import { readFile } from "../helpers/fixtures";
import { statusPorcelain, unstagedPaths, worktreeDiff } from "../helpers/git";
import { createDirtyRepo } from "../helpers/fixtures";
import { discardFileViaUi, gotoActivity, openApp } from "../helpers/app";

test.describe("discard", () => {
  test("discards a modified file via context menu + confirm dialog", async ({ page }) => {
    const repo = createDirtyRepo("discard");
    const modified = readFile(repo.dir, "README.md");
    expect(modified).toContain("local modification");

    await bridgeOpenRepo(repo.dir);
    await openApp(page);
    await gotoActivity(page, "Source Control");
    await expect(page.getByRole("list", { name: "Unstaged changes" }).getByText("README.md")).toBeVisible();

    await discardFileViaUi(page, "README.md");

    // Real worktree: content restored, no diff for the tracked file.
    await expect.poll(() => readFile(repo.dir, "README.md")).not.toContain("local modification");
    expect(worktreeDiff(repo.dir)).toBe("");
    expect(unstagedPaths(repo.dir)).toEqual([]);
    expect(statusPorcelain(repo.dir)).toContain("?? untracked.txt");

    // UI: the modified file moved out of the unstaged list.
    await expect(page.getByRole("list", { name: "Unstaged changes" }).getByText("README.md")).toBeHidden();
  });
});
