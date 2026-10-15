import React, { useState, useRef, useEffect } from "react";
import { Plus, Minus, RotateCcw, ExternalLink, MoreHorizontal } from "lucide-react";
import { StatusEntry, getEntryBadge } from "@/scm/types";
import { useScmStore } from "@/scm/scmStore";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useUIStore } from "@/stores/ui";

export interface FileItemProps {
  entry: StatusEntry;
  context: "staged" | "unstaged" | "untracked" | "merge";
  isSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onOpenDiff: () => void;
}

export const FileItem: React.FC<FileItemProps> = ({
  entry,
  context,
  isSelected,
  onSelect,
  onOpenDiff,
}) => {
  const { stage, unstage, discard, dataSource } = useScmStore();
  const { openTab } = useUIStore();
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const parts = entry.path.split("/");
  const fileName = parts.pop() ?? entry.path;
  const dirPath = parts.join("/");

  const badge = getEntryBadge(entry, context);

  // Close context menu on outside click
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener("mousedown", handleOutside);
    }
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showMenu]);

  const handleStage = (e: React.MouseEvent) => {
    e.stopPropagation();
    void stage([entry.path]);
  };

  const handleUnstage = (e: React.MouseEvent) => {
    e.stopPropagation();
    void unstage([entry.path]);
  };

  const handleDiscard = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDiscardConfirm(true);
  };

  const handleOpenExternal = (e: React.MouseEvent) => {
    e.stopPropagation();
    void dataSource.openInEditor(entry.path);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowMenu(true);
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", entry.path);
    e.dataTransfer.setData("application/vsc-git-context", context);
  };

  const handleCopyPath = () => {
    void navigator.clipboard.writeText(entry.path);
    setShowMenu(false);
  };

  const handleReveal = () => {
    void dataSource.reveal(entry.path);
    setShowMenu(false);
  };

  return (
    <div
      role="treeitem"
      draggable
      onDragStart={handleDragStart}
      onClick={onSelect}
      onDoubleClick={onOpenDiff}
      onContextMenu={handleContextMenu}
      className={`group relative flex h-7 items-center justify-between px-3 text-xs cursor-pointer select-none transition-colors ${
        isSelected
          ? "bg-vscode-accent/20 text-vscode-fg"
          : "hover:bg-vscode-hover text-vscode-fg"
      }`}
    >
      {/* File name & dimmed directory path */}
      <div className="flex flex-1 items-center gap-2 overflow-hidden mr-2">
        <span className="font-medium truncate">{fileName}</span>
        {dirPath && (
          <span className="truncate text-[10px] text-vscode-muted opacity-70">
            {dirPath}
          </span>
        )}
      </div>

      {/* Right side: inline actions on hover, badge on normal */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <div className="hidden group-hover:flex items-center gap-1">
          {context === "staged" ? (
            <button
              type="button"
              title="Unstage changes"
              onClick={handleUnstage}
              className="rounded p-0.5 hover:bg-vscode-active text-vscode-muted hover:text-vscode-fg"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
          ) : (
            <>
              <button
                type="button"
                title="Stage changes"
                onClick={handleStage}
                className="rounded p-0.5 hover:bg-vscode-active text-vscode-muted hover:text-vscode-fg"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Discard changes"
                onClick={handleDiscard}
                className="rounded p-0.5 hover:bg-vscode-active text-vscode-muted hover:text-vscode-fg"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </>
          )}

          <button
            type="button"
            title="Open in external editor"
            onClick={handleOpenExternal}
            className="rounded p-0.5 hover:bg-vscode-active text-vscode-muted hover:text-vscode-fg"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            title="More actions"
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="rounded p-0.5 hover:bg-vscode-active text-vscode-muted hover:text-vscode-fg"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Status Badge */}
        <span
          title={badge.tooltip}
          className={`font-mono text-[11px] font-bold ${badge.color} group-hover:hidden`}
        >
          {badge.letter}
        </span>
      </div>

      {/* Context Menu Dropdown */}
      {showMenu && (
        <div
          ref={menuRef}
          className="absolute right-2 top-7 z-50 min-w-[160px] rounded border border-vscode-border bg-vscode-sidebar py-1 shadow-2xl text-xs"
        >
          <button
            type="button"
            onClick={() => {
              setShowMenu(false);
              onOpenDiff();
            }}
            className="flex w-full px-3 py-1.5 text-left text-vscode-fg hover:bg-vscode-hover"
          >
            Open Changes
          </button>

          {context === "staged" ? (
            <button
              type="button"
              onClick={(e) => {
                setShowMenu(false);
                handleUnstage(e);
              }}
              className="flex w-full px-3 py-1.5 text-left text-vscode-fg hover:bg-vscode-hover"
            >
              Unstage Changes
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={(e) => {
                  setShowMenu(false);
                  handleStage(e);
                }}
                className="flex w-full px-3 py-1.5 text-left text-vscode-fg hover:bg-vscode-hover"
              >
                Stage Changes
              </button>
              <button
                type="button"
                onClick={(e) => {
                  setShowMenu(false);
                  handleDiscard(e);
                }}
                className="flex w-full px-3 py-1.5 text-left text-error hover:bg-vscode-hover"
              >
                Discard Changes...
              </button>
            </>
          )}

          <div className="my-1 border-t border-vscode-border" />

          <button
            type="button"
            onClick={handleCopyPath}
            className="flex w-full px-3 py-1.5 text-left text-vscode-fg hover:bg-vscode-hover"
          >
            Copy Relative Path
          </button>
          <button
            type="button"
            onClick={handleReveal}
            className="flex w-full px-3 py-1.5 text-left text-vscode-fg hover:bg-vscode-hover"
          >
            Reveal in File Manager
          </button>
          <button
            type="button"
            onClick={() => {
              setShowMenu(false);
              openTab({
                id: `blame-${entry.path}`,
                title: `Blame: ${fileName}`,
                closable: true,
              });
            }}
            className="flex w-full px-3 py-1.5 text-left text-vscode-fg hover:bg-vscode-hover"
          >
            Blame
          </button>
          <button
            type="button"
            onClick={() => {
              setShowMenu(false);
              openTab({
                id: `file-history-${entry.path}`,
                title: `History: ${fileName}`,
                closable: true,
              });
            }}
            className="flex w-full px-3 py-1.5 text-left text-vscode-fg hover:bg-vscode-hover"
          >
            File History
          </button>
        </div>
      )}

      {/* Discard Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDiscardConfirm}
        isDestructive
        title="Discard Changes"
        message={`Are you sure you want to discard changes in '${fileName}'?\nThis cannot be undone.`}
        confirmLabel="Discard Changes"
        cancelLabel="Cancel"
        onConfirm={async () => {
          setShowDiscardConfirm(false);
          await discard([entry.path]);
        }}
        onCancel={() => setShowDiscardConfirm(false)}
      />
    </div>
  );
};
