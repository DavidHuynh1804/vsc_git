/**
 * Real-backend spec: finishing a conflicted merge through the merge editor.
 *
 * The conflict is created by a real `git merge theirs` in the fixture (the app
 * itself never has to be the one to start it), then the UI opens the merge
 * editor for the unmerged file, accepts the incoming change, stages the
 * resolution and continues the merge operation. The final merge commit and the
 * resolved worktree are verified with the real git CLI.
 */
import { test, expect } from "@playwright/test";
import { bridgeOpenRepo } from "../helpers/bridge";
import {
  commitCount,
  git,
  gitAllowFail,
  logSubjects,
  stagedDiff,
} from "../helpers/git";
import { createConflictRepo, readFile, startConflictMerge } from "../helpers/fixtures";
import { gotoActivity, openApp } from "../helpers/app";

test.describe("merge conflict", () => {
  test("resolves a conflicted file in the merge editor and continues the merge", async ({
    page,
  }) => {
    const repo = createConflictRepo("merge-conflict");
    startConflictMerge(repo);

    // Real git: the fixture is mid-merge with file.txt unmerged.
    expect(gitAllowFail(repo.dir, ["ls-files", "-u"]).stdout).toContain("file.txt");

    await bridgeOpenRepo(repo.dir);
    await openApp(page);
    await gotoActivity(page, "Source Control");

    // The operation banner (in the Source Control sidebar) and the
    // "Merge changes" list reflect real state. The graph tab renders its own
    // banner, so scope to the sidebar to keep the locator unique.
    const scmSidebar = page.getByRole("complementary", { name: "Source Control" });
    const banner = scmSidebar.getByRole("region", { name: "In-progress git operation" });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Merging");

    const mergeChanges = scmSidebar.getByRole("list", { name: "Merge changes" });
    const row = mergeChanges.getByRole("listitem").filter({ hasText: "file.txt" }).first();
    await expect(row).toBeVisible();
    // Click the file name: a center click can land on the hover actions.
    await row.getByText("file.txt", { exact: true }).click();

    // The merge editor opens with the raw conflict markers still present.
    await expect(page.getByText("Merge: file.txt").first()).toBeVisible();
    await expect(page.getByText("1 conflict remaining")).toBeVisible();
    await expect(page.getByText("incoming change").first()).toBeVisible();

    // Accept the incoming side, then mark the file as resolved (saves + stages).
    await page.getByRole("button", { name: "Accept Incoming", exact: true }).click();
    await expect(page.getByText("All conflicts resolved")).toBeVisible();
    await page.getByRole("button", { name: "Mark as Resolved" }).click();

    // Real git: no unmerged entries left and the resolution is staged.
    await expect
      .poll(() => gitAllowFail(repo.dir, ["ls-files", "-u"]).stdout.trim())
      .toBe("");
    await expect
      .poll(() => readFile(repo.dir, "file.txt"))
      .toBe("line1\nincoming change\nline3\n");
    expect(stagedDiff(repo.dir, "file.txt")).toContain("+incoming change");

    // With no conflicts left the banner allows continuing the merge.
    const continueButton = banner.getByRole("button", { name: "Continue operation" });
    await expect(continueButton).toBeEnabled();
    await continueButton.click();

    // Real git: a merge commit with both parents, and the operation is over.
    // base + theirs + ours + the merge commit.
    await expect.poll(() => commitCount(repo.dir)).toBe(4);
    const parents = git(repo.dir, ["rev-list", "--parents", "-n", "1", "HEAD"]).split(" ");
    expect(parents).toHaveLength(3);
    expect(logSubjects(repo.dir, 1)[0]).toContain("Merge branch 'theirs'");
    expect(gitAllowFail(repo.dir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).status).not.toBe(0);
    await expect(banner).toBeHidden();
  });
});
