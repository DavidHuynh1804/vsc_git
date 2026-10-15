import { describe, expect, it } from "vitest";
import { MockGraphDataSource, branchColorIndex } from "./dataSource";

describe("MockGraphDataSource", () => {
  it("generates deterministic first page with 500 commits and valid rows", async () => {
    const ds = new MockGraphDataSource(1500, 42);
    const page = await ds.page(500);

    expect(page.commits).toHaveLength(500);
    expect(page.rows).toHaveLength(500);
    expect(page.has_more).toBe(true);

    const firstCommit = page.commits[0];
    expect(firstCommit.refs.map((r) => r.name)).toContain("HEAD");
    expect(firstCommit.refs.map((r) => r.name)).toContain("main");

    const firstRow = page.rows[0];
    expect(firstRow.sha).toBe(firstCommit.sha);
    expect(firstRow.col).toBe(0);
    expect(firstRow.edges.length).toBeGreaterThan(0);
  });

  it("handles pagination until has_more is false", async () => {
    const ds = new MockGraphDataSource(100, 42);
    const p1 = await ds.page(60);
    expect(p1.commits).toHaveLength(60);
    expect(p1.has_more).toBe(true);

    const p2 = await ds.page(60);
    expect(p2.commits).toHaveLength(40);
    expect(p2.has_more).toBe(false);

    const p3 = await ds.page(60);
    expect(p3.commits).toHaveLength(0);
    expect(p3.has_more).toBe(false);
  });

  it("returns commit detail with diff stats and file changes", async () => {
    const ds = new MockGraphDataSource(10, 42);
    const p1 = await ds.page(5);
    const sha = p1.commits[0].sha;

    const detail = await ds.detail(sha);
    expect(detail.summary.sha).toBe(sha);
    expect(detail.files.length).toBeGreaterThan(0);
    expect(detail.files[0]).toHaveProperty("additions");
    expect(detail.files[0]).toHaveProperty("deletions");
  });

  it("compares two commits and returns file changes", async () => {
    const ds = new MockGraphDataSource(10, 42);
    const p1 = await ds.page(2);
    const diff = await ds.compare(p1.commits[0].sha, p1.commits[1].sha);
    expect(diff.length).toBeGreaterThan(0);
  });

  it("computes stable branch color index in 0..11", () => {
    expect(branchColorIndex("main")).toBe(branchColorIndex("main"));
    expect(branchColorIndex("main")).toBeGreaterThanOrEqual(0);
    expect(branchColorIndex("main")).toBeLessThan(12);
  });
});
