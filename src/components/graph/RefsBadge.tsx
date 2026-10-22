import React from "react";
import type { RefLabel } from "@/graph/types";
import { GitBranch, Tag, Archive } from "lucide-react";

/**
 * Ref labels drawn like the "Git Graph" extension: a lane-colored icon cell
 * followed by the name; a local branch and its remote counterparts on the
 * same commit share one badge ("main | origin"), and the checked-out branch
 * is bold.
 */

interface RefsBadgeProps {
  refs: RefLabel[];
  onContextMenu?: (e: React.MouseEvent, ref: RefLabel) => void;
  maxDisplay?: number;
  /** Lane color of the commit; tints the badges. */
  color?: string;
  /** Name of the checked-out branch, shown bold. */
  headBranch?: string | null;
}

interface BadgeGroup {
  key: string;
  label: string;
  ref: RefLabel;
  remotes: string[];
  isHead: boolean;
}

/** Collapses `origin/x` into the local `x` badge when both are on this commit. */
function groupRefs(refs: RefLabel[], headBranch?: string | null): BadgeGroup[] {
  const groups: BadgeGroup[] = [];
  const locals = new Map<string, BadgeGroup>();
  const headIsDetached = refs.some((r) => r.kind === "Head") && !refs.some((r) => r.name === headBranch);

  for (const r of refs) {
    if (r.kind === "LocalBranch") {
      const g = { key: r.name, label: r.name, ref: r, remotes: [], isHead: r.name === headBranch };
      locals.set(r.name, g);
      groups.push(g);
    }
  }
  for (const r of refs) {
    if (r.kind === "LocalBranch") continue;
    if (r.kind === "Head") {
      // The checked-out branch is already bold; only a detached HEAD needs its own badge.
      if (headIsDetached) groups.unshift({ key: "HEAD", label: "HEAD", ref: r, remotes: [], isHead: true });
      continue;
    }
    if (r.kind === "RemoteBranch") {
      const slash = r.name.indexOf("/");
      const remote = slash === -1 ? r.name : r.name.slice(0, slash);
      const branch = slash === -1 ? "" : r.name.slice(slash + 1);
      const local = locals.get(branch);
      if (local) {
        local.remotes.push(remote);
        continue;
      }
    }
    groups.push({ key: `${r.kind}:${r.name}`, label: r.name, ref: r, remotes: [], isHead: false });
  }
  return groups;
}

export const RefsBadge: React.FC<RefsBadgeProps> = ({
  refs,
  onContextMenu,
  maxDisplay = 4,
  color = "#0e639c",
  headBranch,
}) => {
  if (!refs || refs.length === 0) return null;

  const groups = groupRefs(refs, headBranch);
  const visible = groups.slice(0, maxDisplay);
  const overflow = groups.slice(maxDisplay);

  return (
    <span className="inline-flex items-center gap-1 overflow-hidden max-w-full flex-shrink-0">
      {visible.map((g) => {
        const Icon = g.ref.kind === "Tag" ? Tag : g.ref.kind === "Stash" ? Archive : GitBranch;
        return (
          <span
            key={g.key}
            title={g.remotes.length ? `${g.label} (${g.remotes.join(", ")})` : `${g.ref.kind}: ${g.label}`}
            onContextMenu={(e) => {
              if (onContextMenu) {
                e.preventDefault();
                e.stopPropagation();
                onContextMenu(e, g.ref);
              }
            }}
            style={{ borderColor: color }}
            className="inline-flex h-[18px] items-stretch overflow-hidden rounded-[3px] border text-[11px] leading-none whitespace-nowrap cursor-pointer select-none"
          >
            <span style={{ backgroundColor: color }} className="flex items-center px-1 text-white">
              <Icon className="h-3 w-3" />
            </span>
            <span className={`flex items-center px-1.5 text-vscode-fg ${g.isHead ? "font-bold" : ""}`}>
              {g.label}
            </span>
            {g.remotes.map((remote) => (
              <span
                key={remote}
                style={{ borderColor: color }}
                className="flex items-center border-l px-1.5 italic text-vscode-muted"
              >
                {remote}
              </span>
            ))}
          </span>
        );
      })}

      {overflow.length > 0 && (
        <span
          title={overflow.map((g) => g.label).join("\n")}
          className="inline-flex h-[18px] items-center rounded-[3px] border border-vscode-border px-1 text-[10px] text-vscode-muted"
        >
          +{overflow.length}
        </span>
      )}
    </span>
  );
};
