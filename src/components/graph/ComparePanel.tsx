import React, { useState, useRef, useCallback } from "react";
import type { CommitSummary, FileChange, FileStatus } from "@/graph/types";
import { X, ArrowLeftRight, FileText, List, FolderTree, ChevronDown, ChevronRight, Folder } from "lucide-react";

interface ComparePanelProps {
  commitA: CommitSummary;
  commitB: CommitSummary;
  changes: FileChange[];
  loading?: boolean;
  height: number;
  onHeightChange: (h: number) => void;
  onSwap: () => void;
  onClose: () => void;
  onOpenDiff: (shaA: string, shaB: string, path: string) => void;
}

const STATUS_CONFIG: Record<FileStatus, { label: string; text: string; bg: string }> = {
  A: { label: "A", text: "#4ade80", bg: "rgba(74, 222, 128, 0.15)" },
  M: { label: "M", text: "#60a5fa", bg: "rgba(96, 165, 250, 0.15)" },
  D: { label: "D", text: "#f87171", bg: "rgba(248, 113, 113, 0.15)" },
  R: { label: "R", text: "#c084fc", bg: "rgba(192, 132, 252, 0.15)" },
  C: { label: "C", text: "#38bdf8", bg: "rgba(56, 189, 248, 0.15)" },
  T: { label: "T", text: "#facc15", bg: "rgba(250, 204, 21, 0.15)" },
};

interface TreeNode {
  name: string;
  path: string;
  file?: FileChange;
  children: Record<string, TreeNode>;
}

function buildFileTree(files: FileChange[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: {} };

  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;

      if (!current.children[part]) {
        current.children[part] = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          children: {},
          file: isLeaf ? file : undefined,
        };
      }
      current = current.children[part];
    }
  }

  return root;
}

export const ComparePanel: React.FC<ComparePanelProps> = ({
  commitA,
  commitB,
  changes,
  loading = false,
  height,
  onHeightChange,
  onSwap,
  onClose,
  onOpenDiff,
}) => {
  const [viewMode, setViewMode] = useState<"list" | "tree">("list");
  const [fileFilter, setFileFilter] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(height);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      startYRef.current = e.clientY;
      startHeightRef.current = height;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const delta = startYRef.current - moveEvent.clientY;
        const newHeight = Math.max(120, Math.min(startHeightRef.current + delta, window.innerHeight * 0.75));
        onHeightChange(newHeight);
      };

      const handleMouseUp = () => {
        isDraggingRef.current = false;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [height, onHeightChange]
  );

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderPath]: prev[folderPath] === undefined ? false : !prev[folderPath],
    }));
  };

  const filteredChanges = fileFilter
    ? changes.filter((f) => f.path.toLowerCase().includes(fileFilter.toLowerCase()))
    : changes;

  const totalAdditions = changes.reduce((acc, f) => acc + f.additions, 0);
  const totalDeletions = changes.reduce((acc, f) => acc + f.deletions, 0);

  const renderTreeItem = (node: TreeNode, depth = 0): React.ReactNode => {
    const isFolder = Object.keys(node.children).length > 0;
    const isExpanded = expandedFolders[node.path] ?? true;

    if (isFolder) {
      return (
        <div key={node.path} className="flex flex-col">
          <div
            onClick={() => toggleFolder(node.path)}
            style={{ paddingLeft: `${depth * 14 + 6}px` }}
            className="flex items-center gap-1.5 py-1 text-xs text-vscode-muted hover:text-vscode-fg hover:bg-vscode-hover cursor-pointer rounded select-none"
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 flex-shrink-0" />
            ) : (
              <ChevronRight className="h-3 w-3 flex-shrink-0" />
            )}
            <Folder className="h-3.5 w-3.5 text-vscode-accent flex-shrink-0" />
            <span className="font-medium text-vscode-fg">{node.name}</span>
          </div>

          {isExpanded && (
            <div className="flex flex-col">
              {Object.values(node.children).map((child) => renderTreeItem(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    if (node.file) {
      const file = node.file;
      const status = STATUS_CONFIG[file.status] ?? STATUS_CONFIG.M;
      return (
        <div
          key={file.path}
          onClick={() => onOpenDiff(commitA.sha, commitB.sha, file.path)}
          style={{ paddingLeft: `${depth * 14 + 6}px` }}
          className="flex items-center justify-between gap-2 py-1 px-2 text-xs text-vscode-fg hover:bg-vscode-hover cursor-pointer rounded select-none group"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              style={{ color: status.text, backgroundColor: status.bg }}
              className="rounded px-1 text-[9px] font-bold"
            >
              {status.label}
            </span>
            <FileText className="h-3.5 w-3.5 text-vscode-muted flex-shrink-0" />
            <span className="truncate">{node.name}</span>
          </div>

          <div className="flex items-center gap-1 text-[10px] font-mono flex-shrink-0">
            {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
            {file.deletions > 0 && <span className="text-error">-{file.deletions}</span>}
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div
      style={{ height: `${height}px` }}
      className="relative flex flex-col border-t border-vscode-border bg-vscode-sidebar text-vscode-fg shadow-lg select-none min-h-[120px]"
    >
      {/* Resizer handle */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute -top-1 left-0 right-0 h-2 cursor-row-resize hover:bg-vscode-accent/50 transition-colors z-10"
        title="Drag to resize panel"
      />

      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-vscode-border px-3 py-1.5 bg-vscode-activity text-xs">
        <div className="flex items-center gap-3 overflow-hidden">
          <span className="font-semibold text-vscode-fg uppercase text-[10px] tracking-wider">
            Comparing Commits
          </span>

          <div className="flex items-center gap-2 font-mono text-xs bg-vscode-input px-2 py-0.5 rounded border border-vscode-border">
            <span className="text-vscode-accent font-semibold">{commitA.short_sha}</span>
            <span className="text-vscode-muted">({commitA.subject.slice(0, 30)})</span>

            <button
              type="button"
              onClick={onSwap}
              title="Swap compare direction"
              className="rounded p-1 hover:bg-vscode-hover text-vscode-muted hover:text-vscode-fg"
            >
              <ArrowLeftRight className="h-3 w-3" />
            </button>

            <span className="text-vscode-accent font-semibold">{commitB.short_sha}</span>
            <span className="text-vscode-muted">({commitB.subject.slice(0, 30)})</span>
          </div>

          <div className="flex items-center gap-1 text-[11px] font-mono">
            <span>{changes.length} changed files:</span>
            <span className="text-success">+{totalAdditions}</span>
            <span className="text-error">-{totalDeletions}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              title="List View"
              className={`rounded p-1 ${
                viewMode === "list"
                  ? "bg-vscode-hover text-vscode-fg"
                  : "text-vscode-muted hover:text-vscode-fg"
              }`}
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("tree")}
              title="Tree View"
              className={`rounded p-1 ${
                viewMode === "tree"
                  ? "bg-vscode-hover text-vscode-fg"
                  : "text-vscode-muted hover:text-vscode-fg"
              }`}
            >
              <FolderTree className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            title="Exit compare mode"
            className="rounded p-1 text-vscode-muted hover:text-vscode-fg hover:bg-vscode-hover"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="p-1.5 border-b border-vscode-border bg-vscode-bg">
        <input
          type="text"
          placeholder="Filter compared files..."
          value={fileFilter}
          onChange={(e) => setFileFilter(e.target.value)}
          className="w-full rounded bg-vscode-input border border-vscode-border px-2 py-0.5 text-xs text-vscode-fg placeholder:text-vscode-muted outline-none focus:border-vscode-accent"
        />
      </div>

      {/* Changes list / tree content */}
      <div className="flex-1 overflow-y-auto p-2 text-xs bg-vscode-bg">
        {loading ? (
          <div className="flex h-full items-center justify-center text-vscode-muted text-xs">
            Computing diff...
          </div>
        ) : filteredChanges.length === 0 ? (
          <div className="flex h-full items-center justify-center text-vscode-muted text-xs">
            No changes found between {commitA.short_sha} and {commitB.short_sha}.
          </div>
        ) : viewMode === "list" ? (
          <div className="flex flex-col gap-0.5">
            {filteredChanges.map((file) => {
              const status = STATUS_CONFIG[file.status] ?? STATUS_CONFIG.M;
              return (
                <div
                  key={file.path}
                  onClick={() => onOpenDiff(commitA.sha, commitB.sha, file.path)}
                  className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-vscode-hover cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      style={{ color: status.text, backgroundColor: status.bg }}
                      className="rounded px-1 text-[9px] font-bold flex-shrink-0"
                    >
                      {status.label}
                    </span>
                    <span className="truncate text-vscode-fg">{file.path}</span>
                    {file.old_path && (
                      <span className="text-[10px] text-vscode-muted truncate">
                        (from {file.old_path})
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 text-[10px] font-mono flex-shrink-0">
                    {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
                    {file.deletions > 0 && <span className="text-error">-{file.deletions}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {Object.values(buildFileTree(filteredChanges).children).map((child) =>
              renderTreeItem(child, 0)
            )}
          </div>
        )}
      </div>
    </div>
  );
};
