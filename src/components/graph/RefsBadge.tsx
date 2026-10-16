import React from "react";
import type { RefKind, RefLabel } from "@/graph/types";
import { GitBranch, Tag, Bookmark, ShieldAlert } from "lucide-react";

interface RefsBadgeProps {
  refs: RefLabel[];
  onContextMenu?: (e: React.MouseEvent, ref: RefLabel) => void;
  maxDisplay?: number;
}

function getRefStyle(kind: RefKind, isLight: boolean) {
  if (isLight) {
    switch (kind) {
      case "Head":
        return { bg: "rgba(0, 95, 184, 0.15)", border: "#005fb8", text: "#005fb8", icon: GitBranch };
      case "LocalBranch":
        return { bg: "rgba(29, 78, 216, 0.12)", border: "#1d4ed8", text: "#1e40af", icon: GitBranch };
      case "RemoteBranch":
        return { bg: "rgba(126, 34, 206, 0.12)", border: "#7e22ce", text: "#6b21a8", icon: GitBranch };
      case "Tag":
        return { bg: "rgba(180, 83, 9, 0.12)", border: "#b45309", text: "#92400e", icon: Tag };
      case "Stash":
        return { bg: "rgba(15, 118, 110, 0.12)", border: "#0f766e", text: "#115e59", icon: Bookmark };
      default:
        return { bg: "rgba(100, 116, 139, 0.12)", border: "#64748b", text: "#334155", icon: ShieldAlert };
    }
  }
  switch (kind) {
    case "Head":
      return { bg: "rgba(0, 122, 204, 0.25)", border: "#007acc", text: "#ffffff", icon: GitBranch };
    case "LocalBranch":
      return { bg: "rgba(59, 130, 246, 0.2)", border: "#3b82f6", text: "#93c5fd", icon: GitBranch };
    case "RemoteBranch":
      return { bg: "rgba(168, 85, 247, 0.2)", border: "#a855f7", text: "#d8b4fe", icon: GitBranch };
    case "Tag":
      return { bg: "rgba(234, 179, 8, 0.2)", border: "#eab308", text: "#fde047", icon: Tag };
    case "Stash":
      return { bg: "rgba(20, 184, 166, 0.2)", border: "#14b8a6", text: "#5eead4", icon: Bookmark };
    default:
      return { bg: "rgba(128, 128, 128, 0.2)", border: "#888888", text: "#cccccc", icon: ShieldAlert };
  }
}
export const RefsBadge: React.FC<RefsBadgeProps> = ({
  refs,
  onContextMenu,
  maxDisplay = 4,
}) => {
  if (!refs || refs.length === 0) return null;

  const visibleRefs = refs.slice(0, maxDisplay);
  const overflowCount = refs.length - maxDisplay;

  const isLight =
    typeof document !== "undefined" && document.documentElement.classList.contains("light");

  return (
    <div className="inline-flex items-center gap-1.5 overflow-hidden max-w-full flex-wrap">
      {visibleRefs.map((r, i) => {
        const style = getRefStyle(r.kind, isLight);
        const Icon = style.icon;
        return (
          <span
            key={`${r.name}-${i}`}
            title={`${r.kind}: ${r.name}`}
            onContextMenu={(e) => {
              if (onContextMenu) {
                e.preventDefault();
                e.stopPropagation();
                onContextMenu(e, r);
              }
            }}
            style={{
              backgroundColor: style.bg,
              borderColor: style.border,
              color: style.text,
            }}
            className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap cursor-pointer select-none hover:brightness-125 transition-all"
          >
            {Icon && <Icon className="h-2.5 w-2.5 flex-shrink-0" />}
            <span className="truncate max-w-[120px]">{r.name}</span>
          </span>
        );
      })}

      {overflowCount > 0 && (
        <span
          title={refs.slice(maxDisplay).map((r) => `${r.kind}: ${r.name}`).join("\n")}
          className="inline-flex items-center rounded border border-vscode-border bg-vscode-input px-1 py-0.5 text-[10px] text-vscode-muted"
        >
          +{overflowCount}
        </span>
      )}
    </div>
  );
};
