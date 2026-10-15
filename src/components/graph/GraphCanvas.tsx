import React, { useEffect, useRef } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";
import type { CommitSummary, GraphRow } from "@/graph/types";
import {
  computeRowGeometry,
  getLaneColor,
  getLaneX,
  NODE_RADIUS,
  ROW_HEIGHT,
} from "@/graph/geometry";

interface GraphCanvasProps {
  rows: GraphRow[];
  commits: CommitSummary[];
  virtualItems: VirtualItem[];
  scrollTop: number;
  width: number;
  height: number;
  hasDirtyRow?: boolean;
}

export const GraphCanvas: React.FC<GraphCanvasProps> = ({
  rows,
  commits,
  virtualItems,
  scrollTop,
  width,
  height,
  hasDirtyRow = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }

    rafIdRef.current = requestAnimationFrame(() => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const isLight = document.documentElement.classList.contains("light");
      const bgColor = isLight ? "#ffffff" : "#1e1e1e";

      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      for (const item of virtualItems) {
        const itemIndex = item.index;
        const rowTop = item.start - scrollTop;

        // Dirty row at index 0 if uncommitted changes exist
        if (hasDirtyRow && itemIndex === 0) {
          const colX = getLaneX(0);
          const centerY = rowTop + ROW_HEIGHT * 0.5;

          // Outgoing line to next commit
          if (rows.length > 0) {
            ctx.strokeStyle = getLaneColor(0, isLight);
            ctx.setLineDash([3, 2]);
            ctx.beginPath();
            ctx.moveTo(colX, centerY);
            ctx.lineTo(colX, rowTop + ROW_HEIGHT);
            ctx.stroke();
            ctx.setLineDash([]);
          }

          // Dashed circle for uncommitted changes
          ctx.strokeStyle = isLight ? "#d97706" : "#f59e0b";
          ctx.lineWidth = 2;
          ctx.fillStyle = bgColor;
          ctx.beginPath();
          ctx.arc(colX, centerY, NODE_RADIUS + 0.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          continue;
        }

        const dataIndex = hasDirtyRow ? itemIndex - 1 : itemIndex;
        if (dataIndex < 0 || dataIndex >= rows.length) continue;

        const row = rows[dataIndex];
        const commit = commits[dataIndex];

        // Check if there is an incoming straight connection from the row above
        let hasIncoming = false;
        if (dataIndex > 0 && dataIndex - 1 < rows.length) {
          const prevRow = rows[dataIndex - 1];
          hasIncoming = prevRow.edges.some(
            (e) =>
              (e.kind === "Straight" && e.from_col === row.col) ||
              (e.kind === "BranchOut" && e.to_col === row.col)
          );
        } else if (dataIndex === 0 && hasDirtyRow) {
          // Connected from uncommitted row above
          hasIncoming = true;
        }

        // Compute path geometry for this row relative to item.start
        const geom = computeRowGeometry(row, 0, hasIncoming);
        const yOffset = rowTop;

        // Draw edge paths
        for (const { segment, color } of geom.edgeSegments) {
          ctx.strokeStyle = getLaneColor(color, isLight);
          ctx.beginPath();

          if (segment.type === "line") {
            ctx.moveTo(segment.from.x, segment.from.y + yOffset);
            ctx.lineTo(segment.to.x, segment.to.y + yOffset);
          } else {
            ctx.moveTo(segment.from.x, segment.from.y + yOffset);
            ctx.bezierCurveTo(
              segment.cp1.x,
              segment.cp1.y + yOffset,
              segment.cp2.x,
              segment.cp2.y + yOffset,
              segment.to.x,
              segment.to.y + yOffset
            );
          }
          ctx.stroke();
        }

        // Draw commit node
        const nodeX = geom.nodeCenter.x;
        const nodeY = geom.nodeCenter.y + yOffset;
        const nodeColor = getLaneColor(geom.nodeColor, isLight);
        const isHead = commit?.refs.some((r) => r.kind === "Head");

        ctx.beginPath();
        ctx.arc(nodeX, nodeY, NODE_RADIUS, 0, Math.PI * 2);

        if (isHead) {
          // Hollow HEAD dot: background inside, thick colored ring
          ctx.fillStyle = bgColor;
          ctx.fill();
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = nodeColor;
          ctx.stroke();
          ctx.lineWidth = 2; // restore
        } else {
          // Solid regular commit dot
          ctx.fillStyle = nodeColor;
          ctx.fill();
        }
      }

      ctx.restore();
    });

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [rows, commits, virtualItems, scrollTop, width, height, hasDirtyRow]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${width}px`,
        height: `${height}px`,
      }}
      className="pointer-events-none absolute left-0 top-0 z-10"
    />
  );
};
