/**
 * Real-backend spec: stash push/apply/drop/pop through the Stashes sidebar,
 * verified against `git stash list` and the real worktree.
 */
import { test, expect } from "@playwright/test";
import { bridgeInvoke, bridgeOpenRepo } from "../helpers/bridge";
import { repoStateSnapshot, stashMessages, statusPorcelain } from "../helpers/git";
import { createStashRepo } from "../helpers/fixtures";
import { gotoActivity, openApp, stashRow } from "../helpers/app";

interface GitLogEntry {
  id: number;
  cmd: string;
  cwd: string;
  exit_code: number;
}

/**
 * Tail of the app's own git command log (every git process the app backend
 * spawned), filtered to one repo. Embedded in assertion messages so failures
 * show whether the app itself mutated the repo.
 */
async function appGitLogFor(repoDir: string): Promise<string> {
  const entries = await bridgeInvoke<GitLogEntry[]>("get_git_output");
  return entries
    .filter((entry) => entry.cwd === repoDir)
    .slice(-12)
    .map((entry) => `#${entry.id} ${entry.cmd} (exit ${entry.exit_code})`)
    .join("\n");
}

test.describe("stashes", () => {
  test("pushes, applies, drops and pops stashes via the UI", async ({ page }) => {
    const repo = createStashRepo("stash");
    // Guard the fixture invariant before any UI is involved.
    expect(
      statusPorcelain(repo.dir),
      `fixture state after creation:\n${repoStateSnapshot(repo.dir)}`
    ).toContain(" M README.md");
    await bridgeOpenRepo(repo.dir);
    await openApp(page);
    await gotoActivity(page, "Stashes");

    // Real state before: modified tracked file + untracked file.
    expect(
      statusPorcelain(repo.dir),
      `state after opening the repo in the UI\n` +
        `app git commands for this repo:\n${await appGitLogFor(repo.dir)}\n` +
        `${repoStateSnapshot(repo.dir)}`
    ).toContain(" M README.md");
    expect(statusPorcelain(repo.dir)).toContain("?? wip.txt");

    // --- push stash A ---
    await page.getByRole("button", { name: "Create Stash" }).click();
    const createDialog = page.getByRole("dialog");
    await expect(createDialog).toContainText("Create Stash");
    await createDialog.getByPlaceholder("WIP on branch...").fill("e2e stash A");
    await createDialog.getByRole("button", { name: "Stash", exact: true }).click();

    await expect.poll(() => stashMessages(repo.dir).length).toBe(1);
    expect(stashMessages(repo.dir)[0]).toContain("e2e stash A");
    // The tracked modification is gone; the untracked file was not included.
    expect(statusPorcelain(repo.dir)).not.toContain(" M README.md");
    expect(statusPorcelain(repo.dir)).toContain("?? wip.txt");
    await expect(stashRow(page, "e2e stash A")).toBeVisible();

    // --- apply stash A (keeps the stash entry) ---
    await stashRow(page, "e2e stash A").hover();
    await page.getByRole("button", { name: "Apply stash 0" }).click();
    await expect.poll(() => statusPorcelain(repo.dir)).toContain(" M README.md");
    expect(stashMessages(repo.dir).length).toBe(1);

    // --- drop stash A ---
    await stashRow(page, "e2e stash A").hover();
    await page.getByRole("button", { name: "Drop stash 0" }).click();
    const dropDialog = page.getByRole("dialog");
    await expect(dropDialog).toContainText("Drop Stash");
    await dropDialog.getByRole("button", { name: "Drop Stash", exact: true }).click();
    await expect.poll(() => stashMessages(repo.dir).length).toBe(0);

    // --- push stash B, then pop it (apply + drop) ---
    await page.getByRole("button", { name: "Create Stash" }).click();
    const secondDialog = page.getByRole("dialog");
    await secondDialog.getByPlaceholder("WIP on branch...").fill("e2e stash B");
    await secondDialog.getByRole("button", { name: "Stash", exact: true }).click();
    await expect.poll(() => stashMessages(repo.dir).length).toBe(1);
    await expect.poll(() => statusPorcelain(repo.dir)).not.toContain(" M README.md");

    await stashRow(page, "e2e stash B").hover();
    await page.getByRole("button", { name: "Pop stash 0" }).click();
    await expect.poll(() => stashMessages(repo.dir).length).toBe(0);
    await expect.poll(() => statusPorcelain(repo.dir)).toContain(" M README.md");
  });
});
