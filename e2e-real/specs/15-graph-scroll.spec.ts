/**
 * Real-backend spec: the graph canvas keeps drawing lanes after the commit
 * list is scrolled (it must stay pinned to the viewport, not scroll away).
 */
import { test, expect } from "@playwright/test";
import { bridgeOpenRepo } from "../helpers/bridge";
import { git, headSha } from "../helpers/git";
import { commitAll, initRepo, writeFile } from "../helpers/fixtures";
import { gotoGraphWithCommit, openApp } from "../helpers/app";

test.describe("graph scrolling", () => {
  test("lanes stay visible after scrolling down a long history", async ({ page }) => {
    const dir = initRepo("graph-scroll");
    writeFile(dir, "a.txt", "0\n");
    commitAll(dir, "commit 0");
    for (let i = 1; i < 150; i++) {
      git(dir, ["commit", "-q", "--allow-empty", "-m", `commit ${i}`]);
    }
    await bridgeOpenRepo(dir);
    await openApp(page);
    await gotoGraphWithCommit(page, headSha(dir));

    const scroller = page.locator("[data-sha]").first().locator("xpath=ancestor::div[contains(@class,'overflow-auto')][1]");
    await scroller.evaluate((el) => el.scrollTo(0, 2000));
    await expect(page.getByText("commit 50", { exact: true })).toBeVisible();

    // The canvas still overlaps the scroller's viewport and has lane pixels
    // in the middle of it (the single lane is column 0).
    await expect
      .poll(() =>
        scroller.evaluate((el) => {
          const canvas = el.querySelector("canvas");
          if (!canvas) return "no canvas";
          const view = el.getBoundingClientRect();
          const box = canvas.getBoundingClientRect();
          if (box.bottom <= view.top || box.top >= view.bottom) return "canvas scrolled out of view";
          const dpr = window.devicePixelRatio || 1;
          const ctx = canvas.getContext("2d");
          if (!ctx) return "no context";
          const x = Math.round(18 * dpr);
          const y = Math.round((view.top + view.height / 2 - box.top) * dpr);
          const alpha = ctx.getImageData(x - 2, y, 5, 1).data.filter((_, i) => i % 4 === 3);
          return Math.max(...alpha) > 0 ? "drawn" : "blank";
        })
      )
      .toBe("drawn");
  });
});
