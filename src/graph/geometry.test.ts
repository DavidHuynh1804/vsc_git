import { describe, expect, it } from "vitest";
import {
  calculateBranchOutPath,
  calculateEdgePath,
  calculateMergeInPath,
  calculateNodePosition,
  calculateStraightPath,
  computeRowGeometry,
  getLaneX,
  getRowBounds,
  LANE_WIDTH,
  ROW_HEIGHT,
} from "./geometry";
import type { GraphRow } from "./types";

describe("graph geometry and path coordinate calculations", () => {
  it("calculates correct lane X coordinates with margin", () => {
    expect(getLaneX(0)).toBe(0.5 * LANE_WIDTH + 10);
    expect(getLaneX(1)).toBe(1.5 * LANE_WIDTH + 10);
    expect(getLaneX(2)).toBe(2.5 * LANE_WIDTH + 10);
  });

  it("calculates row bounds", () => {
    const r0 = getRowBounds(0, 24);
    expect(r0.top).toBe(0);
    expect(r0.center).toBe(12);
    expect(r0.bottom).toBe(24);

    const r3 = getRowBounds(3, 24);
    expect(r3.top).toBe(72);
    expect(r3.center).toBe(84);
    expect(r3.bottom).toBe(96);
  });

  it("calculates Straight path coordinates for full, top, and bottom modes", () => {
    const x0 = getLaneX(0);

    // Full passing lane in row 1
    const full = calculateStraightPath(0, 1, "full");
    expect(full.type).toBe("line");
    expect(full.from).toEqual({ x: x0, y: 24 });
    expect(full.to).toEqual({ x: x0, y: 48 });

    // Top incoming edge into commit node
    const top = calculateStraightPath(0, 1, "top");
    expect(top.from).toEqual({ x: x0, y: 24 });
    expect(top.to).toEqual({ x: x0, y: 36 });

    // Bottom outgoing edge to parent
    const bottom = calculateStraightPath(0, 1, "bottom");
    expect(bottom.from).toEqual({ x: x0, y: 36 });
    expect(bottom.to).toEqual({ x: x0, y: 48 });
  });

  it("calculates MergeIn bezier curve coordinates accurately", () => {
    const fromX = getLaneX(1);
    const toX = getLaneX(0);
    const rowIndex = 2; // top: 48, center: 60, bottom: 72

    const merge = calculateMergeInPath(1, 0, rowIndex);
    expect(merge.type).toBe("bezier");
    expect(merge.from).toEqual({ x: fromX, y: 48 });
    expect(merge.to).toEqual({ x: toX, y: 60 });
    // Midpoint Y between 48 and 60 is 54
    expect(merge.cp1).toEqual({ x: fromX, y: 54 });
    expect(merge.cp2).toEqual({ x: toX, y: 54 });
  });

  it("calculates BranchOut bezier curve coordinates accurately", () => {
    const fromX = getLaneX(0);
    const toX = getLaneX(1);
    const rowIndex = 0; // top: 0, center: 12, bottom: 24

    const branch = calculateBranchOutPath(0, 1, rowIndex);
    expect(branch.type).toBe("bezier");
    expect(branch.from).toEqual({ x: fromX, y: 12 });
    expect(branch.to).toEqual({ x: toX, y: 24 });
    // Midpoint Y between 12 and 24 is 18
    expect(branch.cp1).toEqual({ x: fromX, y: 18 });
    expect(branch.cp2).toEqual({ x: toX, y: 18 });
  });

  it("calculates node circle position at row center", () => {
    const node = calculateNodePosition(2, 4);
    expect(node.x).toBe(getLaneX(2));
    expect(node.y).toBe(4 * ROW_HEIGHT + ROW_HEIGHT * 0.5);
  });

  it("dispatches calculateEdgePath correctly according to edge kind", () => {
    const straightEdge = calculateEdgePath(
      { from_col: 0, to_col: 0, kind: "Straight", color: 1 },
      0,
      1
    );
    expect(straightEdge.type).toBe("line");

    const mergeEdge = calculateEdgePath(
      { from_col: 1, to_col: 0, kind: "MergeIn", color: 2 },
      0,
      1
    );
    expect(mergeEdge.type).toBe("bezier");

    const branchEdge = calculateEdgePath(
      { from_col: 0, to_col: 1, kind: "BranchOut", color: 3 },
      0,
      1
    );
    expect(branchEdge.type).toBe("bezier");
  });

  it("computes row geometry with multiple edges and incoming straight edge", () => {
    const row: GraphRow = {
      sha: "c1",
      col: 0,
      color: 0,
      edges: [
        { from_col: 0, to_col: 0, kind: "Straight", color: 0 },
        { from_col: 0, to_col: 1, kind: "BranchOut", color: 1 },
        { from_col: 2, to_col: 0, kind: "MergeIn", color: 2 },
        { from_col: 3, to_col: 3, kind: "Straight", color: 3 },
      ],
    };

    const geom = computeRowGeometry(row, 1, true);
    // 1 incoming straight + 4 row edges = 5 segments
    expect(geom.edgeSegments).toHaveLength(5);
    expect(geom.nodeCenter).toEqual({ x: getLaneX(0), y: 36 });
    expect(geom.nodeColor).toBe(0);
  });
});
