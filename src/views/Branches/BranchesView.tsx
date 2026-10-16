import React, { useState, useEffect } from "react";
import {
  GitBranch,
  GitCommitHorizontal,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Tag,
  ArrowUpDown,
  GitMerge,
  ExternalLink,
} from "lucide-react";
import { useScmStore } from "@/scm/scmStore";
import { RefItem } from "@/scm/types";
import { PromptDialog } from "@/components/PromptDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface BranchDialogs {
  create: { isOpen: boolean };
  rename: { isOpen: boolean; target: string };
  deleteLocal: { isOpen: boolean; target: string };
  deleteRemote: { isOpen: boolean; target: string };
  unsetUpstream: { isOpen: boolean; target: string };
  needCheckout: { isOpen: boolean; target: string };
}

export const BranchesView: React.FC = () => {
  const { refs, refreshRefs, checkout, createBranch, renameBranch, deleteBranch, stashPush, setUpstream } =
    useScmStore();

  const [dialogs, setDialogs] = useState<BranchDialogs>({
    create: { isOpen: false },
    rename: { isOpen: false, target: "" },
    deleteLocal: { isOpen: false, target: "" },
    deleteRemote: { isOpen: false, target: "" },
    unsetUpstream: { isOpen: false, target: "" },
    needCheckout: { isOpen: false, target: "" },
  });

  useEffect(() => {
    void refreshRefs();
  }, [refreshRefs]);

  const localBranches = refs?.branches ?? [];
  const remoteBranches = refs?.remotes ?? [];
  const tags = refs?.tags ?? [];

  const handleCheckout = async (refName: string) => {
    try {
      await checkout(refName);
    } catch (err: unknown) {
      if (err && typeof err === "object" && "kind" in err && (err as { kind: string }).kind === "DirtyWorktree") {
        setDialogs((d) => ({ ...d, needCheckout: { isOpen: true, target: refName } }));
      }
    }
  };

  const handleStashAndCheckout = async () => {
    const target = dialogs.needCheckout.target;
    setDialogs((d) => ({ ...d, needCheckout: { isOpen: false, target: "" } }));
    await stashPush({ message: `WIP before checkout ${target}` });
    await checkout(target);
  };

  const branchActions = (branch: RefItem) => (
    <div className="flex items-center gap-1">
      {!branch.isHead && (
        <button
          type="button"
          title="Checkout"
          aria-label={`Checkout ${branch.name}`}
          onClick={() => handleCheckout(branch.name)}
          className="rounded p-0.5 hover:bg-vscode-active text-vscode-muted hover:text-vscode-fg transition-colors"
        >
          <GitCommitHorizontal className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        title="Create branch from here"
        aria-label={`Create branch from ${branch.name}`}
        onClick={() => setDialogs((d) => ({ ...d, create: { isOpen: true } }))}
        className="rounded p-0.5 hover:bg-vscode-active text-vscode-muted hover:text-vscode-fg transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Rename branch"
        aria-label={`Rename branch ${branch.name}`}
        onClick={() => setDialogs((d) => ({ ...d, rename: { isOpen: true, target: branch.name } }))}
        className="rounded p-0.5 hover:bg-vscode-active text-vscode-muted hover:text-vscode-fg transition-colors"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Delete branch"
        aria-label={`Delete branch ${branch.name}`}
        onClick={() => setDialogs((d) => ({ ...d, deleteLocal: { isOpen: true, target: branch.name } }))}
        className="rounded p-0.5 hover:bg-vscode-active text-vscode-muted hover:text-error transition-colors"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-vscode-sidebar text-vscode-fg">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-vscode-border px-3 py-2">
        <span className="text-xs font-semibold tracking-wider text-vscode-muted">BRANCHES</span>
        <div className="flex items-center gap-1 text-vscode-muted">
          <button
            type="button"
            title="Create New Branch"
            aria-label="Create New Branch"
            onClick={() => setDialogs((d) => ({ ...d, create: { isOpen: true } }))}
            className="rounded p-1 hover:bg-vscode-hover hover:text-vscode-fg transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Refresh Branches"
            aria-label="Refresh Branches"
            onClick={() => refreshRefs()}
            className="rounded p-1 hover:bg-vscode-hover hover:text-vscode-fg transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto">
        {/* Local Branches */}
        <div className="pb-2">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-vscode-muted">
            Local Branches
          </div>
          {localBranches.map((branch) => (
            <div
              key={branch.fullName}
              className={`group flex h-7 items-center justify-between px-3 text-xs cursor-pointer hover:bg-vscode-hover ${
                branch.isHead ? "bg-vscode-accent/10 font-semibold" : ""
              }`}
            >
              <div className="flex items-center gap-1.5 overflow-hidden">
                <GitBranch className={`h-3.5 w-3.5 flex-shrink-0 ${branch.isHead ? "text-vscode-accent" : "text-vscode-muted"}`} />
                <span className="truncate">{branch.name}</span>
                {branch.isHead && (
                  <span className="rounded bg-vscode-accent px-1 py-0.2 text-[9px] text-white">
                    HEAD
                  </span>
                )}
                {branch.ahead !== undefined && branch.ahead > 0 && (
                  <span className="font-mono text-[10px] text-vscode-accent">↑{branch.ahead}</span>
                )}
                {branch.behind !== undefined && branch.behind > 0 && (
                  <span className="font-mono text-[10px] text-warning">↓{branch.behind}</span>
                )}
              </div>

              <div className="hidden group-hover:flex">{branchActions(branch)}</div>
            </div>
          ))}
        </div>

        {/* Remote Branches */}
        <div className="border-t border-vscode-border/50 pb-2">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-vscode-muted">
            Remote Branches
          </div>
          {remoteBranches.map((branch) => (
            <div
              key={branch.fullName}
              className="group flex h-7 items-center justify-between px-3 text-xs cursor-pointer hover:bg-vscode-hover"
            >
              <div className="flex items-center gap-1.5 overflow-hidden">
                <ArrowUpDown className="h-3.5 w-3.5 flex-shrink-0 text-vscode-muted" />
                <span className="truncate">{branch.name}</span>
              </div>

              <div className="hidden group-hover:flex items-center gap-1">
                <button
                  type="button"
                  title="Compare with HEAD"
                  className="rounded p-0.5 hover:bg-vscode-active text-vscode-muted hover:text-vscode-fg"
                >
                  <GitMerge className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Delete remote branch"
                  onClick={() => setDialogs((d) => ({ ...d, deleteRemote: { isOpen: true, target: branch.name } }))}
                  className="rounded p-0.5 hover:bg-vscode-active text-vscode-muted hover:text-error"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Tags */}
        <div className="border-t border-vscode-border/50 pb-2">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-vscode-muted">
            Tags
          </div>
          {tags.map((tag) => (
            <div
              key={tag.fullName}
              className="group flex h-7 items-center justify-between px-3 text-xs cursor-pointer hover:bg-vscode-hover"
            >
              <div className="flex items-center gap-1.5 overflow-hidden">
                <Tag className="h-3.5 w-3.5 flex-shrink-0 text-vscode-muted" />
                <span className="truncate">{tag.name}</span>
              </div>

              <div className="hidden group-hover:flex items-center gap-1">
                <button
                  type="button"
                  title="Open on web"
                  className="rounded p-0.5 hover:bg-vscode-active text-vscode-muted hover:text-vscode-fg"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create Branch Dialog */}
      <PromptDialog
        isOpen={dialogs.create.isOpen}
        title="Create Branch"
        label="Branch name"
        placeholder="feat/my-feature"
        confirmLabel="Create"
        onConfirm={async (value) => {
          setDialogs((d) => ({ ...d, create: { isOpen: false } }));
          await createBranch(value);
        }}
        onCancel={() => setDialogs((d) => ({ ...d, create: { isOpen: false } }))}
      />

      {/* Rename Branch Dialog */}
      <PromptDialog
        isOpen={dialogs.rename.isOpen}
        title="Rename Branch"
        label="New name"
        initialValue={dialogs.rename.target}
        confirmLabel="Rename"
        onConfirm={async (value) => {
          setDialogs((d) => ({ ...d, rename: { isOpen: false, target: "" } }));
          await renameBranch(dialogs.rename.target, value);
        }}
        onCancel={() => setDialogs((d) => ({ ...d, rename: { isOpen: false, target: "" } }))}
      />

      {/* Delete Local Branch Confirm */}
      <ConfirmDialog
        isOpen={dialogs.deleteLocal.isOpen}
        isDestructive
        title="Delete Branch"
        message={`Are you sure you want to delete branch '${dialogs.deleteLocal.target}'?`}
        confirmLabel="Delete"
        onConfirm={async () => {
          await deleteBranch(dialogs.deleteLocal.target, true);
          setDialogs((d) => ({ ...d, deleteLocal: { isOpen: false, target: "" } }));
        }}
        onCancel={() => setDialogs((d) => ({ ...d, deleteLocal: { isOpen: false, target: "" } }))}
      />

      {/* Delete Remote Branch Confirm */}
      <ConfirmDialog
        isOpen={dialogs.deleteRemote.isOpen}
        isDestructive
        title="Delete Remote Branch"
        message={`Are you sure you want to delete remote branch '${dialogs.deleteRemote.target}'? This will affect the remote repository.`}
        confirmLabel="Delete Remote"
        onConfirm={async () => {
          await deleteBranch(dialogs.deleteRemote.target, true);
          setDialogs((d) => ({ ...d, deleteRemote: { isOpen: false, target: "" } }));
        }}
        onCancel={() => setDialogs((d) => ({ ...d, deleteRemote: { isOpen: false, target: "" } }))}
      />

      {/* Unset Upstream */}
      <ConfirmDialog
        isOpen={dialogs.unsetUpstream.isOpen}
        title="Unset Upstream"
        message={`Would you like to unset the upstream tracking for '${dialogs.unsetUpstream.target}'?`}
        confirmLabel="Unset"
        onConfirm={async () => {
          await setUpstream(dialogs.unsetUpstream.target, "");
          setDialogs((d) => ({ ...d, unsetUpstream: { isOpen: false, target: "" } }));
        }}
        onCancel={() => setDialogs((d) => ({ ...d, unsetUpstream: { isOpen: false, target: "" } }))}
      />

      {/* Checkout dirty worktree confirm */}
      <ConfirmDialog
        isOpen={dialogs.needCheckout.isOpen}
        title="Working Tree Has Unsaved Changes"
        message={`Your working tree is dirty and would be overwritten by checkout of '${dialogs.needCheckout.target}'. Stash and checkout instead?`}
        confirmLabel="Stash & Checkout"
        cancelLabel="Cancel"
        onConfirm={handleStashAndCheckout}
        onCancel={() => setDialogs((d) => ({ ...d, needCheckout: { isOpen: false, target: "" } }))}
      />
    </div>
  );
};
