/**
 * Real-backend spec: the commit graph renders real history and the commit
 * detail panel shows real metadata (sha, subject, changed files).
 */
import { test, expect } from "@playwright/test";
import { bridgeOpenRepo } from "../helpers/bridge";
import { git, shortSha } from "../helpers/git";
import { createBaseRepo } from "../helpers/fixtures";
import { commitDetailPanel, gotoGraphWithCommit, openApp } from "../helpers/app";

test.describe("graph and commit detail", () => {
  test("shows both real commits and opens their details", async ({ page }) => {
    const repo = createBaseRepo("graph");
    await bridgeOpenRepo(repo.dir);
    await openApp(page);
    await gotoGraphWithCommit(page, repo.secondSha);

    // Both real commits are rendered as rows keyed by full sha.
    const secondRow = page.locator(`[data-sha="${repo.secondSha}"]`).first();
    await expect(secondRow).toBeVisible();
    await expect(page.locator(`[data-sha="${repo.firstSha}"]`).first()).toBeVisible();

    // Open the newest commit's detail panel.
    await secondRow.click();
    const detail = commitDetailPanel(page);
    await expect(detail).toBeVisible();

    const expected = {
      short: shortSha(repo.dir, repo.secondSha),
      subject: git(repo.dir, ["log", "-1", "--format=%s", repo.secondSha]),
      files: git(repo.dir, ["show", "--name-only", "--format=", repo.secondSha])
        .split("\n")
        .filter(Boolean),
    };

    await expect(detail).toContainText("Commit:");
    await expect(detail).toContainText(expected.short);
    await expect(detail).toContainText(expected.subject);
    await expect(detail).toContainText(`Changed Files (${expected.files.length})`);

    // Selecting the oldest commit switches the panel content.
    await page.locator(`[data-sha="${repo.firstSha}"]`).first().click();
    await expect(detail).toContainText(shortSha(repo.dir, repo.firstSha));
    await expect(detail).toContainText("chore: initial commit");
  });
});
