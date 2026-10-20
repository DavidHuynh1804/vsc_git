/**
 * Real-backend spec: branch create / checkout / rename / delete through the
 * Branches sidebar, verified against real git.
 */
import { test, expect } from "@playwright/test";
import { bridgeOpenRepo } from "../helpers/bridge";
import { currentBranch, localBranches } from "../helpers/git";
import { createBranchRepo } from "../helpers/fixtures";
import { branchRow, gotoActivity, openApp } from "../helpers/app";

test.describe("branches", () => {
  test("creates, checks out, renames and deletes branches via the UI", async ({ page }) => {
    const repo = createBranchRepo("branches");
    await bridgeOpenRepo(repo.dir);
    await openApp(page);
    await gotoActivity(page, "Branches");

    // Both real branches are listed.
    await expect(branchRow(page, "main")).toBeVisible();
    await expect(branchRow(page, "feature")).toBeVisible();

    // --- create ---
    await page.getByRole("button", { name: "Create New Branch" }).click();
    const createDialog = page.getByRole("dialog");
    await expect(createDialog).toContainText("Create Branch");
    await createDialog.getByRole("textbox", { name: "Branch name" }).fill("e2e/new-branch");
    await createDialog.getByRole("button", { name: "Create" }).click();
    await expect.poll(() => localBranches(repo.dir)).toContain("e2e/new-branch");
    await expect(branchRow(page, "e2e/new-branch")).toBeVisible();

    // --- checkout ---
    await branchRow(page, "feature").hover();
    await page.getByRole("button", { name: "Checkout feature" }).click();
    await expect.poll(() => currentBranch(repo.dir)).toBe("feature");
    await expect(page.locator('[title="Current branch: feature"]')).toBeVisible();

    // --- rename ---
    await branchRow(page, "feature").hover();
    await page.getByRole("button", { name: "Rename branch feature" }).click();
    const renameDialog = page.getByRole("dialog");
    await expect(renameDialog).toContainText("Rename Branch");
    await renameDialog.getByRole("textbox", { name: "New name" }).fill("feature-renamed");
    await renameDialog.getByRole("button", { name: "Rename" }).click();
    await expect.poll(() => localBranches(repo.dir)).toContain("feature-renamed");
    expect(localBranches(repo.dir)).not.toContain("feature");
    await expect(branchRow(page, "feature-renamed")).toBeVisible();

    // --- checkout back, then delete ---
    await branchRow(page, "main").hover();
    await page.getByRole("button", { name: "Checkout main" }).click();
    await expect.poll(() => currentBranch(repo.dir)).toBe("main");

    await branchRow(page, "feature-renamed").hover();
    await page.getByRole("button", { name: "Delete branch feature-renamed" }).click();
    const deleteDialog = page.getByRole("dialog");
    await expect(deleteDialog).toContainText("Delete Branch");
    await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect.poll(() => localBranches(repo.dir)).not.toContain("feature-renamed");
  });
});
