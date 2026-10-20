/**
 * Real-backend spec: opening a repository through the actual UI flow
 * (Welcome "Open Repository" -> stubbed native picker -> real `open_repo`).
 */
import { test, expect } from "@playwright/test";
import { bridgeCurrentRepo, bridgeOpenRepo } from "../helpers/bridge";
import { currentBranch, headSha } from "../helpers/git";
import { createBaseRepo } from "../helpers/fixtures";
import { openApp, openRepoViaUi } from "../helpers/app";

test.describe("open repository", () => {
  test("opens a fixture repo from the Welcome screen and the session persists", async ({ page }) => {
    const repo = createBaseRepo("open-repo");

    await openApp(page);

    // No repository yet: the welcome screen offers the open flow.
    await expect(page.getByText("Open an existing local Git repository")).toBeVisible();

    await openRepoViaUi(page, repo.dir);

    // The graph tab is opened automatically once a repo is loaded and the
    // status bar reflects the real branch.
    await expect(page.getByText("Git Graph").first()).toBeVisible();
    await expect(page.locator('[title="Current branch: main"]')).toBeVisible();

    // The backend session points at the real fixture repository.
    const session = await bridgeCurrentRepo();
    expect(session?.root).toBe(repo.dir);
    expect(session?.head_branch).toBe("main");

    // Real git agrees.
    expect(currentBranch(repo.dir)).toBe("main");
    expect(headSha(repo.dir)).toBe(repo.secondSha);

    // Reloading the page keeps the repo (backend session survives the reload).
    await openApp(page);
    await expect(page.locator('[title="Current branch: main"]')).toBeVisible();
  });

  test("switching the session to another repo is picked up after reload", async ({ page }) => {
    const first = createBaseRepo("open-repo-a");
    const second = createBaseRepo("open-repo-b");

    await bridgeOpenRepo(first.dir);
    await openApp(page);
    await expect(page.getByText("open-repo-a").first()).toBeVisible();

    await bridgeOpenRepo(second.dir);
    await openApp(page);
    await expect(page.getByText("open-repo-b").first()).toBeVisible();
    await expect
      .poll(async () => (await bridgeCurrentRepo())?.root)
      .toBe(second.dir);
  });
});
