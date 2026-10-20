/**
 * Real-backend spec: blame and file history for a tracked file, opened from
 * the Source Control row menu. Both views must render real attribution from
 * the fixture's actual commits.
 */
import { test, expect } from "@playwright/test";
import { bridgeOpenRepo } from "../helpers/bridge";
import { shortSha } from "../helpers/git";
import { createBaseRepo, writeFile } from "../helpers/fixtures";
import { changeRow, gotoActivity, openApp } from "../helpers/app";

test.describe("blame and file history", () => {
  test("shows real blame attribution and file history from the SCM row menu", async ({
    page,
  }) => {
    const repo = createBaseRepo("blame-history");
    // Uncommitted third line so src/app.ts shows up in the SCM list.
    writeFile(
      repo.dir,
      "src/app.ts",
      "export const value = 1;\nexport const added = 2;\nexport const draft = 3;\n"
    );

    await bridgeOpenRepo(repo.dir);
    await openApp(page);
    await gotoActivity(page, "Source Control");

    const row = changeRow(page, "Unstaged changes", "app.ts");
    await expect(row).toBeVisible();

    // --- Blame ---
    await row.hover();
    await row.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("button", { name: "Blame", exact: true }).click();
    // The menu click also bubbles to the row and opens the diff, so bring the
    // blame tab to the front explicitly.
    await page.getByRole("tab", { name: /Blame: app\.ts/ }).click();

    // The gutter shows the real author and the shas of the two real commits.
    await expect(page.getByText("E2E Bot").first()).toBeVisible();
    await expect(page.getByText(shortSha(repo.dir, repo.firstSha)).first()).toBeVisible();
    await expect(page.getByText(shortSha(repo.dir, repo.secondSha)).first()).toBeVisible();

    // --- File history ---
    await row.hover();
    await row.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("button", { name: "File History", exact: true }).click();
    await page.getByRole("tab", { name: /History: app\.ts/ }).click();

    await expect(page.getByText("2 commits")).toBeVisible();
    await expect(page.getByText("feat: add value").first()).toBeVisible();
    await expect(page.getByText("chore: initial commit").first()).toBeVisible();
    // The newest commit is selected by default and its parent diff is loaded.
    await expect(
      page.getByText(`Diff at commit: ${shortSha(repo.dir, repo.secondSha)}`)
    ).toBeVisible();

    // Selecting the older entry switches the diff to that commit.
    await page.getByText("chore: initial commit").first().click();
    await expect(
      page.getByText(`Diff at commit: ${shortSha(repo.dir, repo.firstSha)}`)
    ).toBeVisible();
  });
});
