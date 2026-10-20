/**
 * Real-backend spec: status reporting plus file stage/unstage through the
 * Source Control UI, verified against the real git index.
 */
import { test, expect } from "@playwright/test";
import { bridgeOpenRepo } from "../helpers/bridge";
import { stagedPaths, statusPorcelain, unstagedPaths } from "../helpers/git";
import { createDirtyRepo } from "../helpers/fixtures";
import { gotoActivity, openApp, stageFileViaUi, unstageFileViaUi } from "../helpers/app";

test.describe("status and stage/unstage", () => {
  test("shows real modifications and stages/unstages files via the UI", async ({ page }) => {
    const repo = createDirtyRepo("stage");

    // Real git state before the app: one modification, one untracked file.
    expect(unstagedPaths(repo.dir)).toEqual(["README.md"]);
    expect(statusPorcelain(repo.dir)).toContain("?? untracked.txt");

    await bridgeOpenRepo(repo.dir);
    await openApp(page);
    await gotoActivity(page, "Source Control");

    const unstagedList = page.getByRole("list", { name: "Unstaged changes" });
    const untrackedList = page.getByRole("list", { name: "Untracked changes" });
    await expect(unstagedList.getByText("README.md")).toBeVisible();
    await expect(untrackedList.getByText("untracked.txt")).toBeVisible();

    // Stage the modified file -> real index gains the file.
    await stageFileViaUi(page, "README.md");
    await expect.poll(() => stagedPaths(repo.dir)).toEqual(["README.md"]);
    await expect(page.getByRole("list", { name: "Staged changes" }).getByText("README.md")).toBeVisible();

    // Unstage it again -> real index is empty.
    await unstageFileViaUi(page, "README.md");
    await expect.poll(() => stagedPaths(repo.dir)).toEqual([]);
    await expect(unstagedList.getByText("README.md")).toBeVisible();

    // Stage the untracked file (covers untracked rows).
    await stageFileViaUi(page, "untracked.txt");
    await expect.poll(() => stagedPaths(repo.dir)).toEqual(["untracked.txt"]);

    // Unstage everything to leave the fixture clean-ish for other assertions.
    await unstageFileViaUi(page, "untracked.txt");
    await expect.poll(() => stagedPaths(repo.dir)).toEqual([]);
  });
});
