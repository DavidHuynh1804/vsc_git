import type { Edge, GraphRow } from "./types";
import { PALETTE_HEX } from "./dataSource";

export const LIGHT_PALETTE_HEX: readonly string[] = [
  "#1d4ed8",
  "#15803d",
  "#b45309",
  "#b91c1c",
  "#7e22ce",
  "#0e7490",
  "#c2410c",
  "#be185d",
  "#4d7c0f",
  "#4338ca",
  "#0f766e",
  "#be123c",
];

export function getLaneColor(colorIndex: number, isLight?: boolean): string {
  const idx = ((colorIndex % 12) + 12) % 12;
  const light =
    isLight ??
    (typeof document !== "undefined" && document.documentElement.classList.contains("light"));
  return light ? LIGHT_PALETTE_HEX[idx] : PALETTE_HEX[idx];
}
export interface Point {
  x: number;
  y: number;
}

export interface LineSegment {
  type: "line";
  from: Point;
  to: Point;
}

export interface BezierSegment {
  type: "bezier";
  from: Point;
  cp1: Point;
  cp2: Point;
  to: Point;
}

export type PathSegment = LineSegment | BezierSegment;

export const ROW_HEIGHT = 24;
export const LANE_WIDTH = 16;
export const GRAPH_LEFT_MARGIN = 10;
export const NODE_RADIUS = 4;

export function getLaneX(col: number, laneWidth = LANE_WIDTH, margin = GRAPH_LEFT_MARGIN): number {
  return (col + 0.5) * laneWidth + margin;
}

export function getRowBounds(
  rowIndex: number,
  rowHeight = ROW_HEIGHT
): { top: number; center: number; bottom: number } {
  const top = rowIndex * rowHeight;
  return {
    top,
    center: top + rowHeight * 0.5,
    bottom: top + rowHeight,
  };
}

export function calculateStraightPath(
  fromCol: number,
  rowIndex: number,
  mode: "full" | "top" | "bottom" = "full",
  rowHeight = ROW_HEIGHT,
  laneWidth = LANE_WIDTH
): LineSegment {
  const x = getLaneX(fromCol, laneWidth);
  const { top, center, bottom } = getRowBounds(rowIndex, rowHeight);

  if (mode === "top") {
    return {
      type: "line",
      from: { x, y: top },
      to: { x, y: center },
    };
  }
  if (mode === "bottom") {
    return {
      type: "line",
      from: { x, y: center },
      to: { x, y: bottom },
    };
  }
  return {
    type: "line",
    from: { x, y: top },
    to: { x, y: bottom },
  };
}

/**
 * A lane that closes into this row's commit. The curve spans a full row, from
 * the lane at the previous row's center to this row's node, like Git Graph's
 * S-shaped connectors (the previous row stops that lane at its center).
 */
export function calculateMergeInPath(
  fromCol: number,
  toCol: number,
  rowIndex: number,
  rowHeight = ROW_HEIGHT,
  laneWidth = LANE_WIDTH
): BezierSegment {
  const fromX = getLaneX(fromCol, laneWidth);
  const toX = getLaneX(toCol, laneWidth);
  const { top, center } = getRowBounds(rowIndex, rowHeight);

  return {
    type: "bezier",
    from: { x: fromX, y: center - rowHeight },
    cp1: { x: fromX, y: top },
    cp2: { x: toX, y: top },
    to: { x: toX, y: center },
  };
}

/**
 * A secondary parent leaving this row's node. The curve ends at the next
 * row's center on the parent's lane (the next row starts that lane there).
 */
export function calculateBranchOutPath(
  fromCol: number,
  toCol: number,
  rowIndex: number,
  rowHeight = ROW_HEIGHT,
  laneWidth = LANE_WIDTH
): BezierSegment {
  const fromX = getLaneX(fromCol, laneWidth);
  const toX = getLaneX(toCol, laneWidth);
  const { center, bottom } = getRowBounds(rowIndex, rowHeight);

  return {
    type: "bezier",
    from: { x: fromX, y: center },
    cp1: { x: fromX, y: bottom },
    cp2: { x: toX, y: bottom },
    to: { x: toX, y: center + rowHeight },
  };
}

/** Neighbouring rows, so straight lanes can stop where a curve takes over. */
export interface RowNeighbors {
  prev?: GraphRow;
  next?: GraphRow;
}

function hasStraight(row: GraphRow | undefined, col: number): boolean {
  return !!row?.edges.some((e) => e.kind === "Straight" && e.from_col === col);
}

/** Lane `col` starts in this row because the previous row branched out into it. */
function opensFromAbove(prev: GraphRow | undefined, col: number): boolean {
  return (
    !!prev &&
    prev.edges.some((e) => e.kind === "BranchOut" && e.to_col === col) &&
    !hasStraight(prev, col)
  );
}

/** Lane `col` ends in the next row by merging into that row's commit. */
function closesBelow(next: GraphRow | undefined, col: number): boolean {
  return !!next?.edges.some((e) => e.kind === "MergeIn" && e.from_col === col);
}

export function calculateEdgePath(
  edge: Edge,
  commitCol: number,
  rowIndex: number,
  rowHeight = ROW_HEIGHT,
  laneWidth = LANE_WIDTH,
  neighbors: RowNeighbors = {}
): PathSegment | null {
  if (edge.kind === "MergeIn") {
    return calculateMergeInPath(edge.from_col, edge.to_col, rowIndex, rowHeight, laneWidth);
  }
  if (edge.kind === "BranchOut") {
    return calculateBranchOutPath(edge.from_col, edge.to_col, rowIndex, rowHeight, laneWidth);
  }
  // Straight: the commit's own lane leaves the node downwards (to its first
  // parent); other lanes pass through the whole row.
  const x = getLaneX(edge.from_col, laneWidth);
  const { top, center, bottom } = getRowBounds(rowIndex, rowHeight);
  const isCommitLane = edge.from_col === commitCol;
  const startY = isCommitLane || opensFromAbove(neighbors.prev, edge.from_col) ? center : top;
  const endY = closesBelow(neighbors.next, edge.from_col) ? center : bottom;
  if (endY <= startY) return null;
  return { type: "line", from: { x, y: startY }, to: { x, y: endY } };
}

export function calculateNodePosition(
  col: number,
  rowIndex: number,
  rowHeight = ROW_HEIGHT,
  laneWidth = LANE_WIDTH
): Point {
  return {
    x: getLaneX(col, laneWidth),
    y: getRowBounds(rowIndex, rowHeight).center,
  };
}

export interface ComputedRowGeometry {
  edgeSegments: { segment: PathSegment; color: number }[];
  nodeCenter: Point;
  nodeColor: number;
}

export function computeRowGeometry(
  row: GraphRow,
  rowIndex: number,
  hasIncomingStraight: boolean,
  rowHeight = ROW_HEIGHT,
  laneWidth = LANE_WIDTH,
  neighbors: RowNeighbors = {}
): ComputedRowGeometry {
  const edgeSegments: { segment: PathSegment; color: number }[] = [];

  // If commit has incoming straight connection from child above
  if (hasIncomingStraight) {
    edgeSegments.push({
      segment: calculateStraightPath(row.col, rowIndex, "top", rowHeight, laneWidth),
      color: row.color,
    });
  }

  for (const edge of row.edges) {
    const segment = calculateEdgePath(edge, row.col, rowIndex, rowHeight, laneWidth, neighbors);
    if (!segment) continue;
    edgeSegments.push({
      segment,
      color: edge.color,
    });
  }

  return {
    edgeSegments,
    nodeCenter: calculateNodePosition(row.col, rowIndex, rowHeight, laneWidth),
    nodeColor: row.color,
  };
}

/** Width the graph column needs to show every lane of `rows`. */
export function graphWidthFor(rows: GraphRow[], laneWidth = LANE_WIDTH, margin = GRAPH_LEFT_MARGIN): number {
  let maxCol = 0;
  for (const row of rows) {
    if (row.col > maxCol) maxCol = row.col;
    for (const e of row.edges) {
      if (e.from_col > maxCol) maxCol = e.from_col;
      if (e.to_col > maxCol) maxCol = e.to_col;
    }
  }
  return margin * 2 + (maxCol + 1) * laneWidth;
}
