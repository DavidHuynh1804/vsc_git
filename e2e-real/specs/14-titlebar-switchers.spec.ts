/**
 * Real-backend spec: the Titlebar switchers. The branch badge opens a quick
 * pick that checks out or creates branches, and the repo name opens a menu
 * to open another folder or jump to a recent repository.
 */
import { test, expect } from "@playwright/test";
import { bridgeControl, bridgeCurrentRepo, bridgeOpenRepo } from "../helpers/bridge";
import { currentBranch, git, headSha, localBranches } from "../helpers/git";
import { createBaseRepo, createBranchRepo } from "../helpers/fixtures";
import { openApp } from "../helpers/app";

test.describe("titlebar switchers", () => {
  test("creates and checks out branches from the branch picker", async ({ page }) => {
    const repo = createBranchRepo("branch-picker");
    await bridgeOpenRepo(repo.dir);
    await openApp(page);

    const header = page.getByRole("banner", { name: "Application titlebar" });
    const picker = page.getByRole("dialog", { name: "Switch Branch" });

    // Type a new name -> "Create new branch" creates it and switches to it.
    await header.getByRole("button", { name: "Switch branch (current: main)" }).click();
    await expect(picker).toBeVisible();
    await picker.getByRole("textbox", { name: "Branch name" }).fill("e2e/picked");
    await expect(picker.getByRole("option").first()).toContainText('Create new branch "e2e/picked"');
    await picker.getByRole("textbox", { name: "Branch name" }).press("Enter");
    await expect(picker).toBeHidden();
    await expect.poll(() => currentBranch(repo.dir)).toBe("e2e/picked");
    expect(localBranches(repo.dir)).toContain("e2e/picked");
    await expect(header.getByRole("button", { name: "Switch branch (current: e2e/picked)" })).toBeVisible();

    // The status bar badge opens the same picker; pick an existing branch.
    await page
      .getByRole("contentinfo", { name: "Status Bar" })
      .getByRole("button", { name: /Switch branch/ })
      .click();
    await picker.getByRole("option").filter({ has: page.getByText("feature", { exact: true }) }).click();
    await expect.poll(() => currentBranch(repo.dir)).toBe("feature");
  });

  test("creates a branch from a chosen ref and checks out a tag detached", async ({ page }) => {
    const repo = createBranchRepo("branch-picker-from");
    git(repo.dir, ["tag", "v1.0", repo.firstSha]);
    await bridgeOpenRepo(repo.dir);
    await openApp(page);

    const picker = page.getByRole("dialog", { name: "Switch Branch" });
    const input = picker.getByRole("textbox", { name: "Branch name" });
    const option = (name: string) =>
      picker.getByRole("option").filter({ has: page.getByText(name, { exact: true }) });
    const openPicker = () =>
      page
        .getByRole("banner", { name: "Application titlebar" })
        .getByRole("button", { name: /Switch branch/ })
        .click();

    // VS Code style rows: the ref, its tip author/sha/subject and a section label.
    await openPicker();
    await expect(option("feature")).toContainText("feat: pick me");
    await expect(option("feature")).toContainText(repo.featureSha.slice(0, 8));
    await expect(picker.getByText("branches", { exact: true })).toBeVisible();

    // Create new branch from... -> pick `feature` -> name it.
    await option("Create new branch from...").click();
    await option("feature").click();
    await input.fill("e2e/from-feature");
    await input.press("Enter");
    await expect.poll(() => currentBranch(repo.dir)).toBe("e2e/from-feature");
    expect(headSha(repo.dir)).toBe(repo.featureSha);

    // Checkout detached... -> pick the tag.
    await openPicker();
    await option("Checkout detached...").click();
    await option("v1.0").click();
    await expect.poll(() => headSha(repo.dir)).toBe(repo.firstSha);
    expect(currentBranch(repo.dir)).toBe("HEAD");
  });

  test("switches repositories from the repo menu", async ({ page }) => {
    const first = createBaseRepo("switch-a");
    const second = createBaseRepo("switch-b");
    const third = createBaseRepo("switch-c");
    // Opening both records them as recent; `second` stays the active one.
    await bridgeOpenRepo(first.dir);
    await bridgeOpenRepo(second.dir);
    await openApp(page);

    const header = page.getByRole("banner", { name: "Application titlebar" });
    const menuButton = header.getByRole("button", { name: "Switch Repository" });
    await expect(menuButton).toContainText("switch-b");

    // Recent repository.
    await menuButton.click();
    await page.getByRole("menu", { name: "Repositories" }).getByRole("menuitem", { name: /switch-a/ }).click();
    await expect.poll(async () => (await bridgeCurrentRepo())?.root).toBe(first.dir);
    await expect(menuButton).toContainText("switch-a");

    // Open Folder... goes through the (stubbed) native picker.
    await bridgeControl({ pick_folder: third.dir });
    await menuButton.click();
    await page.getByRole("menuitem", { name: "Open Folder..." }).click();
    await expect.poll(async () => (await bridgeCurrentRepo())?.root).toBe(third.dir);
    await expect(menuButton).toContainText("switch-c");
  });
});
