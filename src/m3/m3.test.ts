import { describe, it, expect } from "vitest";
import {
  parseConflictRegions,
  countConflictMarkers,
  resolveConflictRegion,
  detectEol,
} from "./conflictParser";
import { normalizeOperationState } from "./types";
import { MockM3DataSource } from "./dataSource";

describe("Conflict Parser", () => {
  it("detects CRLF and LF line endings correctly", () => {
    expect(detectEol("line 1\r\nline 2")).toBe("\r\n");
    expect(detectEol("line 1\nline 2")).toBe("\n");
  });

  it("parses 2-way conflict regions", () => {
    const content = [
      "header line",
      "<<<<<<< HEAD",
      "my current line 1",
      "my current line 2",
      "=======",
      "their incoming line 1",
      ">>>>>>> branch-a",
      "footer line",
    ].join("\n");

    const result = parseConflictRegions(content);
    expect(result.eol).toBe("\n");
    expect(result.hasDiff3).toBe(false);
    expect(result.regions).toHaveLength(1);

    const region = result.regions[0];
    expect(region.id).toBe(1);
    expect(region.startLine).toBe(2);
    expect(region.endLine).toBe(7);
    expect(region.currentHeader).toBe("HEAD");
    expect(region.incomingHeader).toBe("branch-a");
    expect(region.current).toBe("my current line 1\nmy current line 2");
    expect(region.incoming).toBe("their incoming line 1");
    expect(region.base).toBeUndefined();
  });

  it("parses diff3 conflict regions with base section", () => {
    const content = [
      "start",
      "<<<<<<< HEAD",
      "our version",
      "||||||| 1a2b3c4",
      "original base version",
      "=======",
      "their version",
      ">>>>>>> feat/xyz",
      "end",
    ].join("\r\n");

    const result = parseConflictRegions(content);
    expect(result.eol).toBe("\r\n");
    expect(result.hasDiff3).toBe(true);
    expect(result.regions).toHaveLength(1);

    const region = result.regions[0];
    expect(region.currentHeader).toBe("HEAD");
    expect(region.baseHeader).toBe("1a2b3c4");
    expect(region.incomingHeader).toBe("feat/xyz");
    expect(region.current).toBe("our version");
    expect(region.base).toBe("original base version");
    expect(region.incoming).toBe("their version");
  });

  it("counts conflict markers accurately", () => {
    const content = [
      "<<<<<<< HEAD",
      "A",
      "=======",
      "B",
      ">>>>>>> C",
      "middle",
      "<<<<<<< HEAD",
      "D",
      "=======",
      "E",
      ">>>>>>> F",
    ].join("\n");

    expect(countConflictMarkers(content)).toBe(2);
  });

  it("resolves conflict region with current", () => {
    const content = [
      "before",
      "<<<<<<< HEAD",
      "current",
      "=======",
      "incoming",
      ">>>>>>> feat",
      "after",
    ].join("\n");

    const resolved = resolveConflictRegion(content, 1, "current");
    expect(resolved).toBe("before\ncurrent\nafter");
  });

  it("resolves conflict region with incoming", () => {
    const content = [
      "before",
      "<<<<<<< HEAD",
      "current",
      "=======",
      "incoming",
      ">>>>>>> feat",
      "after",
    ].join("\n");

    const resolved = resolveConflictRegion(content, 1, "incoming");
    expect(resolved).toBe("before\nincoming\nafter");
  });

  it("resolves conflict region with both (current before incoming)", () => {
    const content = [
      "before",
      "<<<<<<< HEAD",
      "current line",
      "=======",
      "incoming line",
      ">>>>>>> feat",
      "after",
    ].join("\n");

    const resolved = resolveConflictRegion(content, 1, "both");
    expect(resolved).toBe("before\ncurrent line\nincoming line\nafter");
  });

  it("resolves diff3 conflict region with base", () => {
    const content = [
      "before",
      "<<<<<<< HEAD",
      "current",
      "||||||| base-rev",
      "base line",
      "=======",
      "incoming",
      ">>>>>>> feat",
      "after",
    ].join("\r\n");

    const resolved = resolveConflictRegion(content, 1, "base");
    expect(resolved).toBe("before\r\nbase line\r\nafter");
  });
});

describe("OperationState Normalization", () => {
  it("normalizes raw string 'None'", () => {
    const normalized = normalizeOperationState("None");
    expect(normalized).toEqual({ kind: "None", isActive: false });
  });

  it("normalizes Rebasing state", () => {
    const raw = {
      Rebasing: {
        step: 3,
        total: 7,
        onto: "main",
        branch: "feat",
      },
    };
    const normalized = normalizeOperationState(raw);
    expect(normalized).toEqual({
      kind: "Rebasing",
      isActive: true,
      step: 3,
      total: 7,
      onto: "main",
      branch: "feat",
    });
  });

  it("normalizes Merging state", () => {
    const raw = { Merging: { commit_id: "c0ffee" } };
    const normalized = normalizeOperationState(raw);
    expect(normalized).toEqual({
      kind: "Merging",
      isActive: true,
      commit_id: "c0ffee",
    });
  });
});

describe("MockM3DataSource", () => {
  it("manages operation state and continue/skip/abort transitions", async () => {
    const ds = new MockM3DataSource();
    const initial = await ds.getOperationState();
    const norm = normalizeOperationState(initial);
    expect(norm.kind).toBe("Rebasing");
    expect(norm.step).toBe(3);

    await ds.opContinue();
    const updated = normalizeOperationState(await ds.getOperationState());
    expect(updated.step).toBe(4);

    await ds.opAbort();
    const aborted = normalizeOperationState(await ds.getOperationState());
    expect(aborted.isActive).toBe(false);
  });

  it("manages conflict retrieval and resolutions", async () => {
    const ds = new MockM3DataSource();
    const conflict = await ds.getConflict("src/App.tsx");
    expect(conflict.worktree).toBeDefined();

    await ds.resolveWith("src/App.tsx", "Ours");
    const resolved = await ds.getConflict("src/App.tsx");
    expect(resolved.worktree).toBe(conflict.ours);
  });

  it("returns blame and file history", async () => {
    const ds = new MockM3DataSource();
    const blameLines = await ds.blame("src/App.tsx");
    expect(blameLines.length).toBeGreaterThan(0);
    expect(blameLines[0].commit.author).toBeDefined();

    const history = await ds.fileHistory("src/App.tsx");
    expect(history.length).toBeGreaterThan(0);
    expect(history[1].status).toBe("R100");
    expect(history[1].path_at_commit).toBe("src/AppOld.tsx");
  });
});
