/**
 * Real-backend spec: settings persist end-to-end.
 *
 * The UI toggle goes through `set_settings` into the real app config dir; the
 * spec asserts the value via the backend command and by reading the real
 * settings.json on disk. The original value is always restored afterwards.
 */
import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { bridgeInvoke } from "../helpers/bridge";
import { gotoActivity, openApp } from "../helpers/app";
import { settingsFilePath } from "../helpers/paths";

interface RawSettings {
  "git.autoFetch"?: boolean;
}

function settingsOnDisk(): RawSettings | null {
  const file = settingsFilePath();
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as RawSettings;
}

test.describe("settings", () => {
  test("toggling auto-fetch in the UI persists through the backend to settings.json", async ({
    page,
  }) => {
    const before = await bridgeInvoke<RawSettings>("get_settings");
    const original = before["git.autoFetch"] ?? true;

    try {
      await openApp(page);
      await gotoActivity(page, "Settings");

      const row = page.locator('[data-testid="setting-row-git.autoFetch"]');
      await expect(row).toBeVisible();
      const checkbox = row.getByRole("checkbox", { name: "Auto Fetch" });
      await expect(checkbox).toBeChecked({ checked: original });

      // Toggle in the UI (the view autosaves after a 300ms debounce).
      await checkbox.click();
      await expect(checkbox).toBeChecked({ checked: !original });

      // The backend and the real settings.json on disk both picked it up.
      await expect
        .poll(async () => (await bridgeInvoke<RawSettings>("get_settings"))["git.autoFetch"])
        .toBe(!original);
      await expect.poll(() => settingsOnDisk()?.["git.autoFetch"]).toBe(!original);

      // Toggling back persists the restore as well.
      await checkbox.click();
      await expect(checkbox).toBeChecked({ checked: original });
      await expect.poll(() => settingsOnDisk()?.["git.autoFetch"]).toBe(original);
    } finally {
      // Safety net: never leave the developer's real settings file modified.
      await bridgeInvoke("set_settings", {
        patchJson: JSON.stringify({ "git.autoFetch": original }),
      });
    }
  });
});
