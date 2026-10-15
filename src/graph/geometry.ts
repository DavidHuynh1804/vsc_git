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

  const midY = top + (center - top) * 0.5;
  return {
    type: "bezier",
    from: { x: fromX, y: top },
    cp1: { x: fromX, y: midY },
    cp2: { x: toX, y: midY },
    to: { x: toX, y: center },
  };
}

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

  const midY = center + (bottom - center) * 0.5;
  return {
    type: "bezier",
    from: { x: fromX, y: center },
    cp1: { x: fromX, y: midY },
    cp2: { x: toX, y: midY },
    to: { x: toX, y: bottom },
  };
}

export function calculateEdgePath(
  edge: Edge,
  commitCol: number,
  rowIndex: number,
  rowHeight = ROW_HEIGHT,
  laneWidth = LANE_WIDTH
): PathSegment {
  if (edge.kind === "MergeIn") {
    return calculateMergeInPath(edge.from_col, edge.to_col, rowIndex, rowHeight, laneWidth);
  }
  if (edge.kind === "BranchOut") {
    return calculateBranchOutPath(edge.from_col, edge.to_col, rowIndex, rowHeight, laneWidth);
  }
  // Straight: if it is the commit's own lane, it connects to bottom (outgoing to first parent)
  const isCommitLane = edge.from_col === commitCol;
  return calculateStraightPath(
    edge.from_col,
    rowIndex,
    isCommitLane ? "bottom" : "full",
    rowHeight,
    laneWidth
  );
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
  laneWidth = LANE_WIDTH
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
    const segment = calculateEdgePath(edge, row.col, rowIndex, rowHeight, laneWidth);
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
