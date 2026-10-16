import { test, expect } from "@playwright/test";

test.describe("vsc_git core user flows (web mock)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
  });

  test("Flow 1: open repo -> stage hunk -> commit", async ({ page }) => {
    // 1. Verify repo is opened and source control shows unstaged changes
    const unstagedList = page.getByRole("list", { name: "Unstaged changes" });
    await expect(unstagedList).toBeVisible({ timeout: 10000 });
    const appTsItem = unstagedList.getByRole("listitem").filter({ hasText: "app.ts" }).first();
    await expect(appTsItem).toBeVisible();

    // 2. Open file in Diff editor
    await appTsItem.getByText("app.ts").click();

    // 3. Click Stage Ranges to stage hunk
    const stageRangesBtn = page.getByRole("button", { name: /Stage Selected Ranges/i });
    await expect(stageRangesBtn).toBeVisible({ timeout: 10000 });
    await stageRangesBtn.click();

    // 4. Verify file appears in STAGED CHANGES
    const stagedList = page.getByRole("list", { name: "Staged changes" });
    await expect(stagedList.getByText("app.ts").first()).toBeVisible();

    // 5. Enter commit message in CommitBox and commit
    const commitInput = page.getByPlaceholder(/Message \(Cmd\+Enter to commit\)/i);
    await commitInput.fill("feat: update greeting port and endpoint");
    const commitBtn = page.getByRole("button", { name: /^Commit$/i });
    await expect(commitBtn).toBeEnabled();
    await commitBtn.click();

    // Commit message clears upon commit
    await expect(commitInput).toHaveValue("");
  });

  test("Flow 2: graph -> cherry-pick", async ({ page }) => {
    // 1. Navigate to Graph view via ActivityBar
    const graphNavBtn = page.getByRole("button", { name: /Git Graph/i });
    await expect(graphNavBtn).toBeVisible();
    await graphNavBtn.click();

    // 2. Graph view opens and commit rows are rendered
    await expect(
      page.getByPlaceholder("Search commits, authors, shas... (Press '/')")
    ).toBeVisible({ timeout: 10000 });
    const commitRow = page.locator("[data-sha]").first();
    await expect(commitRow).toBeVisible({ timeout: 10000 });

    // 3. Right-click on commit to open context menu
    await commitRow.click({ button: "right" });

    // 4. Verify context menu contains Cherry-pick and click it
    const cherryPickBtn = page.getByRole("button", { name: "Cherry-pick" });
    await expect(cherryPickBtn).toBeVisible();
    await cherryPickBtn.click();

    // Context menu closes after action
    await expect(cherryPickBtn).not.toBeVisible();
  });

  test("Flow 3: resolve conflict in merge editor", async ({ page }) => {
    // 1. In Source Control, locate conflict file under MERGE CHANGES
    const mergeList = page.getByRole("list", { name: "Merge changes" });
    await expect(mergeList).toBeVisible({ timeout: 10000 });
    const conflictItem = mergeList.getByRole("listitem").filter({ hasText: "settings.json" }).first();
    await expect(conflictItem).toBeVisible();

    // 2. Click to open Merge Editor
    await conflictItem.getByText("settings.json").click();

    // 3. In Merge Editor, click "Accept Current"
    const acceptCurrentBtn = page.getByRole("button", { name: /Accept Current/i });
    await expect(acceptCurrentBtn).toBeVisible({ timeout: 10000 });
    await acceptCurrentBtn.click();

    // 4. Click "Mark as Resolved"
    const markResolvedBtn = page.getByRole("button", { name: /Mark as Resolved/i });
    await expect(markResolvedBtn).toBeVisible();
    await markResolvedBtn.click();

    // 5. Merge editor closes once marked resolved
    await expect(acceptCurrentBtn).not.toBeVisible();
  });
});
