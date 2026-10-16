import React, { useState, useEffect } from "react";
import { Archive, Plus, RefreshCw, Play, Forward, Trash2, GitBranch, GitCommitHorizontal, X } from "lucide-react";
import { useScmStore } from "@/scm/scmStore";
import { useUIStore } from "@/stores/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { StashItem } from "@/scm/types";

export const StashesView: React.FC = () => {
  const { stashes, refreshStashes, stashPush, stashPop, stashDrop, stashApply, createBranch } =
    useScmStore();
  const { openTab } = useUIStore();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [stashMessage, setStashMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [confirmDrop, setConfirmDrop] = useState<StashItem | null>(null);

  useEffect(() => {
    void refreshStashes();
  }, [refreshStashes]);

  const handleCreateStash = async () => {
    await stashPush({ message: stashMessage || undefined, includeUntracked });
    setStashMessage("");
    setIncludeUntracked(false);
    setIsCreateOpen(false);
  };

  const handleViewDiff = (stash: StashItem) => {
    const stashFileName = `stash-${stash.index}`;
    openTab({
      id: `diff-${stashFileName}`,
      title: `Stash ${stash.index}: ${stash.message.split("\n")[0]}`,
      closable: true,
    });
  };

  const handleCreateBranch = async (stash: StashItem) => {
    // Apply stash then create branch; simplified for mock
    await stashApply(stash.index);
    const branchName = `stash-${stash.index}-${stash.branch}`;
    await createBranch(branchName);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-vscode-sidebar text-vscode-fg">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-vscode-border px-3 py-2">
        <span className="text-xs font-semibold tracking-wider text-vscode-muted">STASHES</span>
        <div className="flex items-center gap-1 text-vscode-muted">
          <button
            type="button"
            title="Create Stash"
            aria-label="Create Stash"
            onClick={() => setIsCreateOpen(true)}
            className="rounded p-1 hover:bg-vscode-hover hover:text-vscode-fg transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Refresh Stashes"
            aria-label="Refresh Stashes"
            onClick={() => refreshStashes()}
            className="rounded p-1 hover:bg-vscode-hover hover:text-vscode-fg transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Stash list */}
      <div className="flex-1 overflow-y-auto">
        {stashes.length === 0 && (
          <div className="flex flex-col items-center justify-center p-8 text-center gap-3 text-vscode-muted">
            <Archive className="h-10 w-10 opacity-50" />
            <p className="text-xs">No stashes yet</p>
            <p className="text-[11px]">Stash away your local changes to work on something else.</p>
          </div>
        )}

        {stashes.map((stash) => (
          <div
            key={`stash-${stash.index}-${stash.date}-${stash.message}`}
            className="group flex h-12 items-center justify-between border-b border-vscode-border/50 px-3 text-xs hover:bg-vscode-hover"
          >
            <div className="flex flex-col overflow-hidden">
              <span className="truncate font-medium text-vscode-fg">{stash.message}</span>
              <span className="text-[10px] text-vscode-muted">
                {stash.branch} · {stash.date}
              </span>
            </div>

            <div className="hidden group-hover:flex items-center gap-1">
              <button
                type="button"
                title="Apply stash"
                aria-label={`Apply stash ${stash.index}`}
                onClick={() => void stashApply(stash.index)}
                className="rounded p-1 hover:bg-vscode-active text-vscode-muted hover:text-vscode-fg transition-colors"
              >
                <Play className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Pop stash (apply and drop)"
                aria-label={`Pop stash ${stash.index}`}
                onClick={() => void stashPop(stash.index)}
                className="rounded p-1 hover:bg-vscode-active text-vscode-muted hover:text-vscode-fg transition-colors"
              >
                <Forward className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Create branch from stash"
                aria-label={`Create branch from stash ${stash.index}`}
                onClick={() => handleCreateBranch(stash)}
                className="rounded p-1 hover:bg-vscode-active text-vscode-muted hover:text-vscode-fg transition-colors"
              >
                <GitBranch className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="View stash diff"
                aria-label={`View diff for stash ${stash.index}`}
                onClick={() => handleViewDiff(stash)}
                className="rounded p-1 hover:bg-vscode-active text-vscode-muted hover:text-vscode-fg transition-colors"
              >
                <GitCommitHorizontal className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Drop stash"
                aria-label={`Drop stash ${stash.index}`}
                onClick={() => setConfirmDrop(stash)}
                className="rounded p-1 hover:bg-vscode-active text-vscode-muted hover:text-error transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Create Stash Dialog */}
      {isCreateOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="flex w-full max-w-md flex-col rounded border border-vscode-border bg-vscode-sidebar p-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-vscode-border pb-3">
              <h3 className="text-sm font-semibold text-vscode-fg">Create Stash</h3>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="rounded p-1 text-vscode-muted hover:bg-vscode-hover hover:text-vscode-fg"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="my-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] text-vscode-muted">Stash message (optional)</label>
                <input
                  type="text"
                  value={stashMessage}
                  onChange={(e) => setStashMessage(e.target.value)}
                  placeholder="WIP on branch..."
                  className="rounded border border-vscode-border bg-vscode-input px-2 py-1.5 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-vscode-fg">
                <input
                  type="checkbox"
                  checked={includeUntracked}
                  onChange={(e) => setIncludeUntracked(e.target.checked)}
                  className="accent-vscode-accent"
                />
                <span>Include untracked files</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="rounded border border-vscode-border px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-hover"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateStash}
                className="rounded bg-vscode-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
              >
                Stash
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drop Stash Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDrop !== null}
        isDestructive
        title="Drop Stash"
        message={`Are you sure you want to drop stash "${confirmDrop?.message}"?\nThis cannot be undone.`}
        confirmLabel="Drop Stash"
        onConfirm={async () => {
          if (confirmDrop) {
            await stashDrop(confirmDrop.index);
          }
          setConfirmDrop(null);
        }}
        onCancel={() => setConfirmDrop(null)}
      />
    </div>
  );
};
