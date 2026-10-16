import React, { useState, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Minus,
  RotateCcw,
  List,
  FolderTree,
  RefreshCw,
} from "lucide-react";
import { useScmStore } from "@/scm/scmStore";
import { useUIStore } from "@/stores/ui";
import { StatusEntry } from "@/scm/types";
import { CommitBox } from "./CommitBox";
import { FileItem } from "./FileItem";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { OperationBanner } from "@/components/OperationBanner";

export const SourceControlView: React.FC = () => {
  const {
    status,
    refreshStatus,
    stage,
    unstage,
    discard,
    stageAll,
    unstageAll,
    discardAll,
    openDiff,
    viewMode,
    toggleViewMode,
    groupUntrackedSeparately,
    selectedPaths,
    togglePathSelection,
    clearSelection,
  } = useScmStore();

  const { openTab } = useUIStore();

  const [isMergeOpen, setIsMergeOpen] = useState(true);
  const [isStagedOpen, setIsStagedOpen] = useState(true);
  const [isChangesOpen, setIsChangesOpen] = useState(true);
  const [isUntrackedOpen, setIsUntrackedOpen] = useState(true);

  const [confirmDiscardAllChanges, setConfirmDiscardAllChanges] = useState(false);
  const [confirmDiscardAllUntracked, setConfirmDiscardAllUntracked] = useState(false);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const entries = status?.entries ?? [];

  const mergeEntries = entries.filter((e) => e.kind.type === "Unmerged");

  const stagedEntries = entries.filter(
    (e) =>
      (e.kind.type === "Ordinary" || e.kind.type === "RenamedOrCopied") &&
      e.kind.staged !== "Unmodified"
  );

  const untrackedEntries = entries.filter((e) => e.kind.type === "Untracked");

  const changesEntries = entries.filter((e) => {
    if (e.kind.type === "Ordinary" || e.kind.type === "RenamedOrCopied") {
      return e.kind.unstaged !== "Unmodified";
    }
    if (!groupUntrackedSeparately && e.kind.type === "Untracked") {
      return true;
    }
    return false;
  });

  const handleOpenDiff = (entry: StatusEntry, context: "staged" | "unstaged" | "untracked" | "merge") => {
    const fileName = entry.path.split("/").pop() ?? entry.path;
    if (context === "merge") {
      openTab({
        id: `merge-${entry.path}`,
        title: `Merge: ${fileName}`,
        closable: true,
      });
      return;
    }
    openDiff(entry.path, context);
    openTab({
      id: `diff-${entry.path}`,
      title: `${fileName} (${context === "staged" ? "Index" : "Working Tree"})`,
      closable: true,
    });
  };

  const handleItemSelect = (
    path: string,
    allSectionPaths: string[],
    e: React.MouseEvent
  ) => {
    if (e.shiftKey) {
      // Range selection
      const lastSelected = Array.from(selectedPaths).pop();
      const lastIdx = lastSelected ? allSectionPaths.indexOf(lastSelected) : 0;
      const currentIdx = allSectionPaths.indexOf(path);
      const start = Math.min(lastIdx, currentIdx);
      const end = Math.max(lastIdx, currentIdx);
      const range = allSectionPaths.slice(start, end + 1);
      togglePathSelection(path, true, range);
    } else if (e.metaKey || e.ctrlKey) {
      togglePathSelection(path, true);
    } else {
      clearSelection();
      togglePathSelection(path, false);
    }
  };

  const handleDropOnStaged = (e: React.DragEvent) => {
    e.preventDefault();
    const path = e.dataTransfer.getData("text/plain");
    const srcContext = e.dataTransfer.getData("application/vsc-git-context");
    if (path && srcContext !== "staged") {
      void stage([path]);
    }
  };

  const handleDropOnChanges = (e: React.DragEvent) => {
    e.preventDefault();
    const path = e.dataTransfer.getData("text/plain");
    const srcContext = e.dataTransfer.getData("application/vsc-git-context");
    if (path && srcContext === "staged") {
      void unstage([path]);
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-vscode-sidebar text-vscode-fg">
      {/* Top Header / View Actions */}
      {/* In-progress operation banner */}
      <OperationBanner />

      <div className="flex items-center justify-between border-b border-vscode-border px-3 py-2">
        <span className="text-xs font-semibold tracking-wider text-vscode-muted">
          SOURCE CONTROL
        </span>
        <div className="flex items-center gap-1 text-vscode-muted">
          <button
            type="button"
            title={viewMode === "list" ? "View as Tree" : "View as List"}
            aria-label={viewMode === "list" ? "View as Tree" : "View as List"}
            onClick={toggleViewMode}
            className="rounded p-1 hover:bg-vscode-hover hover:text-vscode-fg transition-colors"
          >
            {viewMode === "list" ? (
              <FolderTree className="h-3.5 w-3.5" />
            ) : (
              <List className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            title="Refresh Status"
            aria-label="Refresh Status"
            onClick={() => refreshStatus()}
            className="rounded p-1 hover:bg-vscode-hover hover:text-vscode-fg transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {/* Commit Box */}
      <CommitBox />

      {/* Scrollable File Groups */}
      <div role="tree" aria-label="Source Control changes tree" className="flex-1 overflow-y-auto">
        {/* Merge Changes Group */}
        {mergeEntries.length > 0 && (
          <div className="flex flex-col border-b border-vscode-border/50">
            <div
              role="button"
              tabIndex={0}
              aria-expanded={isMergeOpen}
              onClick={() => setIsMergeOpen(!isMergeOpen)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setIsMergeOpen(!isMergeOpen);
                }
              }}
              className="flex h-7 items-center justify-between px-2 text-xs font-semibold text-error cursor-pointer hover:bg-vscode-hover select-none"
            >
              <div className="flex items-center gap-1">
                {isMergeOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                <span>MERGE CHANGES</span>
              </div>
              <span className="rounded bg-error/20 px-1.5 py-0.2 text-[10px] text-error font-mono font-bold">
                {mergeEntries.length}
              </span>
            </div>

            {isMergeOpen && (
              <div role="group" aria-label="Merge changes" className="flex flex-col">
                {mergeEntries.map((entry) => (
                  <FileItem
                    key={entry.path}
                    entry={entry}
                    context="merge"
                    isSelected={selectedPaths.has(entry.path)}
                    onSelect={(e) =>
                      handleItemSelect(
                        entry.path,
                        mergeEntries.map((m) => m.path),
                        e
                      )
                    }
                    onOpenDiff={() => handleOpenDiff(entry, "merge")}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Staged Changes Group */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDropOnStaged}
          className="flex flex-col border-b border-vscode-border/50"
        >
          <div
            role="button"
            tabIndex={0}
            aria-expanded={isStagedOpen}
            onClick={() => setIsStagedOpen(!isStagedOpen)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setIsStagedOpen(!isStagedOpen);
              }
            }}
            className="group flex h-7 items-center justify-between px-2 text-xs font-semibold text-vscode-fg cursor-pointer hover:bg-vscode-hover select-none"
          >
            <div className="flex items-center gap-1">
              {isStagedOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              <span>STAGED CHANGES</span>
            </div>

            <div className="flex items-center gap-1.5">
              {stagedEntries.length > 0 && (
                <div className="hidden group-hover:flex items-center gap-1">
                  <button
                    type="button"
                    title="Unstage All Changes"
                    aria-label="Unstage All Changes"
                    onClick={(e) => {
                      e.stopPropagation();
                      void unstageAll();
                    }}
                    className="rounded p-0.5 hover:bg-vscode-active text-vscode-muted hover:text-vscode-fg transition-colors"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <span className="rounded bg-vscode-input px-1.5 py-0.2 text-[10px] text-vscode-muted font-mono">
                {stagedEntries.length}
              </span>
            </div>
          </div>

          {isStagedOpen && (
            <div role="group" aria-label="Staged changes" className="flex flex-col">
              {stagedEntries.map((entry) => (
                <FileItem
                  key={entry.path}
                  entry={entry}
                  context="staged"
                  isSelected={selectedPaths.has(entry.path)}
                  onSelect={(e) =>
                    handleItemSelect(
                      entry.path,
                      stagedEntries.map((s) => s.path),
                      e
                    )
                  }
                  onOpenDiff={() => handleOpenDiff(entry, "staged")}
                />
              ))}
              {stagedEntries.length === 0 && (
                <div className="px-4 py-2 text-[11px] text-vscode-muted italic">
                  Drag changes here or click + to stage
                </div>
              )}
            </div>
          )}
        </div>

        {/* Changes Group */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDropOnChanges}
          className="flex flex-col border-b border-vscode-border/50"
        >
          <div
            role="button"
            tabIndex={0}
            aria-expanded={isChangesOpen}
            onClick={() => setIsChangesOpen(!isChangesOpen)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setIsChangesOpen(!isChangesOpen);
              }
            }}
            className="group flex h-7 items-center justify-between px-2 text-xs font-semibold text-vscode-fg cursor-pointer hover:bg-vscode-hover select-none"
          >
            <div className="flex items-center gap-1">
              {isChangesOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              <span>CHANGES</span>
            </div>

            <div className="flex items-center gap-1.5">
              {changesEntries.length > 0 && (
                <div className="hidden group-hover:flex items-center gap-1">
                  <button
                    type="button"
                    title="Discard All Changes"
                    aria-label="Discard All Changes"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDiscardAllChanges(true);
                    }}
                    className="rounded p-0.5 hover:bg-vscode-active text-vscode-muted hover:text-vscode-fg transition-colors"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Stage All Changes"
                    aria-label="Stage All Changes"
                    onClick={(e) => {
                      e.stopPropagation();
                      void stageAll();
                    }}
                    className="rounded p-0.5 hover:bg-vscode-active text-vscode-muted hover:text-vscode-fg transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <span className="rounded bg-vscode-input px-1.5 py-0.2 text-[10px] text-vscode-muted font-mono">
                {changesEntries.length}
              </span>
            </div>
          </div>

          {isChangesOpen && (
            <div role="group" aria-label="Unstaged changes" className="flex flex-col">
              {changesEntries.map((entry) => (
                <FileItem
                  key={entry.path}
                  entry={entry}
                  context="unstaged"
                  isSelected={selectedPaths.has(entry.path)}
                  onSelect={(e) =>
                    handleItemSelect(
                      entry.path,
                      changesEntries.map((c) => c.path),
                      e
                    )
                  }
                  onOpenDiff={() => handleOpenDiff(entry, "unstaged")}
                />
              ))}
              {changesEntries.length === 0 && (
                <div className="px-4 py-2 text-[11px] text-vscode-muted italic">
                  No changes detected
                </div>
              )}
            </div>
          )}
        </div>

        {/* Untracked Group (if separated) */}
        {groupUntrackedSeparately && untrackedEntries.length > 0 && (
          <div className="flex flex-col border-b border-vscode-border/50">
          <div
            role="button"
            tabIndex={0}
            aria-expanded={isUntrackedOpen}
            onClick={() => setIsUntrackedOpen(!isUntrackedOpen)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setIsUntrackedOpen(!isUntrackedOpen);
              }
            }}
            className="group flex h-7 items-center justify-between px-2 text-xs font-semibold text-vscode-fg cursor-pointer hover:bg-vscode-hover select-none"
          >
            <div className="flex items-center gap-1">
              {isUntrackedOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              <span>UNTRACKED</span>
            </div>

            <div className="flex items-center gap-1.5">
              <div className="hidden group-hover:flex items-center gap-1">
                <button
                  type="button"
                  title="Discard All Untracked"
                  aria-label="Discard All Untracked"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDiscardAllUntracked(true);
                  }}
                  className="rounded p-0.5 hover:bg-vscode-active text-vscode-muted hover:text-vscode-fg transition-colors"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Stage All Untracked"
                  aria-label="Stage All Untracked"
                  onClick={(e) => {
                    e.stopPropagation();
                    void stage(untrackedEntries.map((u) => u.path));
                  }}
                  className="rounded p-0.5 hover:bg-vscode-active text-vscode-muted hover:text-vscode-fg transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <span className="rounded bg-vscode-input px-1.5 py-0.2 text-[10px] text-vscode-muted font-mono">
                {untrackedEntries.length}
              </span>
            </div>
          </div>

          {isUntrackedOpen && (
            <div role="group" aria-label="Untracked changes" className="flex flex-col">
                {untrackedEntries.map((entry) => (
                  <FileItem
                    key={entry.path}
                    entry={entry}
                    context="untracked"
                    isSelected={selectedPaths.has(entry.path)}
                    onSelect={(e) =>
                      handleItemSelect(
                        entry.path,
                        untrackedEntries.map((u) => u.path),
                        e
                      )
                    }
                    onOpenDiff={() => handleOpenDiff(entry, "untracked")}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Discard All Changes Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDiscardAllChanges}
        isDestructive
        title="Discard All Changes"
        message="Are you sure you want to discard ALL working tree changes?\nThis cannot be undone."
        confirmLabel="Discard All"
        cancelLabel="Cancel"
        onConfirm={async () => {
          setConfirmDiscardAllChanges(false);
          await discardAll();
        }}
        onCancel={() => setConfirmDiscardAllChanges(false)}
      />

      {/* Discard All Untracked Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDiscardAllUntracked}
        isDestructive
        title="Delete All Untracked Files"
        message="Are you sure you want to delete all untracked files?\nThey will be removed permanently."
        confirmLabel="Delete All"
        cancelLabel="Cancel"
        onConfirm={async () => {
          setConfirmDiscardAllUntracked(false);
          await discard(untrackedEntries.map((u) => u.path));
        }}
        onCancel={() => setConfirmDiscardAllUntracked(false)}
      />
    </div>
  );
};
