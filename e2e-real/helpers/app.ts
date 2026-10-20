/**
 * UI-driving helpers for the "real" E2E suite.
 *
 * These wrap the app's actual DOM (see the selector notes in docs/e2e-real.md)
 * so specs read like user flows while assertions still come from real git.
 */
import { expect, type Page } from "@playwright/test";
import { bridgeControl } from "./bridge";

export async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(
    () =>
      (window as unknown as { __TAURI_INTERNALS__?: { __e2eBridge?: boolean } })
        .__TAURI_INTERNALS__?.__e2eBridge === true,
    undefined,
    { timeout: 30_000 }
  );
  await expect(page.getByRole("navigation", { name: "Activity Bar" })).toBeVisible();
}

/** Opens a repo through the real Welcome/Sidebar "Open Repository" flow (folder picker stubbed). */
export async function openRepoViaUi(page: Page, repoPath: string): Promise<void> {
  await bridgeControl({ pick_folder: repoPath });
  await page.getByRole("button", { name: "Open Repository" }).first().click();
}

export type ActivityName = "Source Control" | "Git Graph" | "Branches" | "Stashes" | "Settings";

/** Switches the sidebar to an activity without toggling it off when already active. */
export async function gotoActivity(page: Page, name: ActivityName): Promise<void> {
  const aside = page.locator(`aside[aria-label="${name}"]`);
  if (!(await aside.isVisible())) {
    // Scope to the Activity Bar: other components (e.g. the graph toolbar)
    // render buttons with the same accessible names.
    await page
      .getByRole("navigation", { name: "Activity Bar" })
      .getByRole("button", { name, exact: true })
      .click();
  }
  await expect(aside).toBeVisible();
}

export function changeRow(page: Page, listLabel: string, fileName: string) {
  return page
    .getByRole("list", { name: listLabel })
    .getByRole("listitem")
    .filter({ hasText: fileName })
    .first();
}

/**
 * Opens the diff/merge editor for a row by clicking its file name.
 *
 * Clicking the row's geometric center is unsafe: hovering reveals the inline
 * action buttons, which shifts the layout so a center click can land on
 * "Stage changes" instead of opening the diff.
 */
export async function openDiffViaUi(
  page: Page,
  listLabel: string,
  fileName: string
): Promise<void> {
  const row = changeRow(page, listLabel, fileName);
  await expect(row).toBeVisible();
  await row.getByText(fileName, { exact: true }).click();
}

/**
 * Opens the Git Graph and waits for a specific commit row.
 *
 * The dev-mode StrictMode double mount races the graph's initial
 * reset+page pair, so the first page can come back empty; pressing
 * "Refresh Git Graph" retries a single load.
 */
export async function gotoGraphWithCommit(page: Page, sha: string): Promise<void> {
  await gotoActivity(page, "Git Graph");
  const row = page.locator(`[data-sha="${sha}"]`).first();
  await expect(async () => {
    if (!(await row.isVisible())) {
      await page.getByRole("button", { name: "Refresh Git Graph" }).click();
    }
    await expect(row).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 30_000 });
}

export async function stageFileViaUi(page: Page, fileName: string): Promise<void> {
  const row = page
    .getByRole("list", { name: /Unstaged changes|Untracked changes/ })
    .getByRole("listitem")
    .filter({ hasText: fileName })
    .first();
  await row.hover();
  await row.getByRole("button", { name: "Stage changes" }).click();
}

export async function unstageFileViaUi(page: Page, fileName: string): Promise<void> {
  const row = changeRow(page, "Staged changes", fileName);
  await row.hover();
  await row.getByRole("button", { name: "Unstage changes" }).click();
}

export async function discardFileViaUi(page: Page, fileName: string): Promise<void> {
  const row = page
    .getByRole("listitem")
    .filter({ hasText: fileName })
    .first();
  await row.click({ button: "right" });
  await page.getByRole("button", { name: "Discard Changes..." }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Discard Changes");
  await dialog.getByRole("button", { name: "Discard Changes", exact: true }).click();
}

export async function commitViaUi(page: Page, message: string): Promise<void> {
  await page.getByRole("textbox", { name: /Commit message/ }).fill(message);
  await page.getByRole("button", { name: "Commit", exact: true }).click();
}

/** Runs a command palette entry by its exact "Category: Title" text. */
export async function runPaletteCommand(page: Page, commandText: string): Promise<void> {
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${modifier}+k`);
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  await expect(palette).toBeVisible();
  const input = page.getByRole("textbox", { name: "Search commands" });
  await input.fill(commandText);
  const option = palette.getByRole("option").filter({ hasText: commandText }).first();
  await expect(option).toBeVisible();
  await input.press("Enter");
  await expect(palette).toBeHidden();
}

/** Opens a commit row's context menu and invokes one of its actions. */
export async function graphContextAction(page: Page, sha: string, actionLabel: string): Promise<void> {
  const row = page.locator(`[data-sha="${sha}"]`).first();
  await expect(row).toBeVisible();
  await row.click({ button: "right" });
  await page.getByRole("button", { name: actionLabel, exact: true }).click();
}

export function branchRow(page: Page, name: string) {
  const sidebar = page.locator('aside[aria-label="Branches"]');
  // `has` is resolved relative to each row, so it must be page-rooted, not sidebar-rooted.
  return sidebar
    .locator("div.group")
    .filter({ has: page.getByText(name, { exact: true }) })
    .first();
}

export function stashRow(page: Page, message: string) {
  const sidebar = page.locator('aside[aria-label="Stashes"]');
  return sidebar.locator("div.group").filter({ hasText: message }).first();
}

export function commitDetailPanel(page: Page) {
  return page
    .locator("div.relative")
    .filter({ has: page.getByRole("button", { name: "Copy SHA" }) })
    .first();
}
