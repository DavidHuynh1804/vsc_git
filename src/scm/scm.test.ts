import { describe, it, expect } from "vitest";
import {
  computeHunks,
  mapMonacoSelectionToLineSelection,
  applySelectedLines,
} from "./diffUtils";
import { MockScmDataSource } from "./dataSource";

describe("SCM Diff Utils", () => {
  it("computes hunks between original and modified text", () => {
    const original = "line 1\nline 2\nline 3";
    const modified = "line 1\nline 2 modified\nline 3\nline 4";
    const hunks = computeHunks(original, modified);

    expect(hunks.length).toBeGreaterThan(0);
    expect(hunks[0].originalLines).toContain("line 2");
    expect(hunks[0].modifiedLines).toContain("line 2 modified");
  });

  it("maps Monaco selection to LineSelection for both sides", () => {
    const selOrig = mapMonacoSelectionToLineSelection("Original", 4, 10);
    expect(selOrig).toEqual({
      side: "Original",
      start: 4,
      end: 10,
    });

    const selMod = mapMonacoSelectionToLineSelection("Modified", 12, 8);
    expect(selMod).toEqual({
      side: "Modified",
      start: 8,
      end: 12,
    });
  });

  it("applies selected lines for staging", () => {
    const original = "alpha\nbeta\ngamma";
    const modified = "alpha\nbeta-mod\ngamma";
    const selection = mapMonacoSelectionToLineSelection("Modified", 2, 2);

    const result = applySelectedLines(original, modified, [selection], "stage");
    expect(result).toBe("alpha\nbeta-mod\ngamma");
  });
});

describe("MockScmDataSource", () => {
  it("loads status with staged, unstaged, untracked, and conflict entries", async () => {
    const ds = new MockScmDataSource();
    const status = await ds.getStatus();

    expect(status.branch.head).toBe("main");
    expect(status.entries.length).toBeGreaterThan(0);

    const staged = status.entries.find((e) => e.path === "README.md");
    expect(staged).toBeDefined();

    const untracked = status.entries.find((e) => e.path === "src/utils/format.ts");
    expect(untracked?.kind.type).toBe("Untracked");

    const conflict = status.entries.find((e) => e.path === "config/settings.json");
    expect(conflict?.kind.type).toBe("Unmerged");
  });

  it("stages, unstages, and commits files", async () => {
    const ds = new MockScmDataSource();

    // Stage untracked file
    await ds.stage(["src/utils/format.ts"]);
    let status = await ds.getStatus();
    const entry = status.entries.find((e) => e.path === "src/utils/format.ts");
    expect(entry?.kind.type).toBe("Ordinary");

    // Commit
    await ds.commit({ message: "feat(utils): add format utility" });
    const lastMsg = await ds.lastCommitMessage();
    expect(lastMsg).toBe("feat(utils): add format utility");

    // Unstage
    await ds.unstage(["src/app.ts"]);
    status = await ds.getStatus();
    expect(status).toBeDefined();
  });

  it("handles stashes and branches", async () => {
    const ds = new MockScmDataSource();

    await ds.createBranch("feat/test-branch");
    const refs = await ds.getRefs();
    expect(refs.head).toBe("feat/test-branch");

    await ds.stashPush({ message: "WIP test" });
    const stashes = await ds.listStashes();
    expect(stashes[0].message).toBe("WIP test");

    await ds.stashPop(0);
    const afterPop = await ds.listStashes();
    expect(afterPop.find((s) => s.message === "WIP test")).toBeUndefined();
  });
});
