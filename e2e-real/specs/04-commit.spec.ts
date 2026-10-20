/**
 * Real-backend spec: committing through the CommitBox, verified with real git.
 * This is the acceptance-critical flow: a deliberately broken backend (commit
 * command turned into a no-op) must make these assertions fail.
 */
import { test, expect } from "@playwright/test";
import { bridgeOpenRepo } from "../helpers/bridge";
import { commitCount, logSubjects, stagedPaths, statusPorcelain, worktreeDiff } from "../helpers/git";
import { createDirtyRepo } from "../helpers/fixtures";
import { commitViaUi, gotoActivity, openApp, stageFileViaUi } from "../helpers/app";

test.describe("commit", () => {
  test("commits staged changes with the typed message", async ({ page }) => {
    const repo = createDirtyRepo("commit");
    const before = commitCount(repo.dir);

    await bridgeOpenRepo(repo.dir);
    await openApp(page);
    await gotoActivity(page, "Source Control");

    await stageFileViaUi(page, "README.md");
    await expect.poll(() => stagedPaths(repo.dir)).toEqual(["README.md"]);

    const message = "feat: commit from e2e-real";
    await commitViaUi(page, message);

    // Real git: a new commit with the exact subject, index empty for the file.
    await expect.poll(() => commitCount(repo.dir)).toBe(before + 1);
    expect(logSubjects(repo.dir, 1)[0]).toBe(message);
    expect(worktreeDiff(repo.dir)).toBe("");
    expect(statusPorcelain(repo.dir)).toContain("?? untracked.txt");

    // UI reflects the commit: staged list empty and commit box cleared.
    await expect(page.getByRole("list", { name: "Staged changes" }).getByText("README.md")).toBeHidden();
    await expect(page.getByRole("textbox", { name: /Commit message/ })).toHaveValue("");
  });
});
