import React, { useEffect, useRef } from "react";
import type { CommitSummary, GraphAction, RefLabel } from "@/graph/types";
import {
  GitCommit,
  GitBranch,
  Tag,
  GitPullRequest,
  Copy,
  ExternalLink,
  Sparkles,
  RotateCcw,
  GitMerge,
  Split,
  Trash2,
  UploadCloud,
  Layers,
} from "lucide-react";

export interface ContextMenuTarget {
  type: "commit" | "ref";
  commit?: CommitSummary;
  refLabel?: RefLabel;
  x: number;
  y: number;
}

interface GraphContextMenuProps {
  target: ContextMenuTarget | null;
  onClose: () => void;
  onAction: (action: GraphAction) => void;
}

export const GraphContextMenu: React.FC<GraphContextMenuProps> = ({
  target,
  onClose,
  onAction,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  if (!target) return null;

  const handleAction = (action: GraphAction) => {
    onClose();
    onAction(action);
  };

  const renderCommitItems = (commit: CommitSummary) => (
    <>
      <div className="px-3 py-1 text-[10px] font-semibold text-vscode-muted uppercase tracking-wider border-b border-vscode-border">
        Commit {commit.short_sha}
      </div>

      <button
        type="button"
        onClick={() =>
          handleAction({
            type: "checkout-detached",
            payload: { sha: commit.sha },
            gitCommand: `git checkout ${commit.sha}`,
          })
        }
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
      >
        <GitCommit className="h-3.5 w-3.5" />
        <span>Checkout (detached)</span>
      </button>

      <button
        type="button"
        onClick={() =>
          handleAction({
            type: "create-branch",
            payload: { sha: commit.sha },
            gitCommand: `git branch <name> ${commit.sha}`,
          })
        }
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
      >
        <GitBranch className="h-3.5 w-3.5" />
        <span>Create Branch...</span>
      </button>

      <button
        type="button"
        onClick={() =>
          handleAction({
            type: "create-tag",
            payload: { sha: commit.sha },
            gitCommand: `git tag <tagname> ${commit.sha}`,
          })
        }
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
      >
        <Tag className="h-3.5 w-3.5" />
        <span>Create Tag...</span>
      </button>

      <div className="my-1 border-t border-vscode-border" />

      <button
        type="button"
        onClick={() =>
          handleAction({
            type: "cherry-pick",
            payload: { sha: commit.sha },
            gitCommand: `git cherry-pick ${commit.sha}`,
          })
        }
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
      >
        <GitMerge className="h-3.5 w-3.5" />
        <span>Cherry-pick</span>
      </button>

      <button
        type="button"
        onClick={() =>
          handleAction({
            type: "revert",
            payload: { sha: commit.sha },
            gitCommand: `git revert ${commit.sha}`,
          })
        }
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        <span>Revert</span>
      </button>

      {/* Reset options */}
      <div className="relative group">
        <button
          type="button"
          onClick={() =>
            handleAction({
              type: "reset-soft",
              payload: { sha: commit.sha, mode: "soft" },
              gitCommand: `git reset --soft ${commit.sha}`,
            })
          }
          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Reset current branch (Soft)</span>
        </button>
        <button
          type="button"
          onClick={() =>
            handleAction({
              type: "reset-mixed",
              payload: { sha: commit.sha, mode: "mixed" },
              gitCommand: `git reset --mixed ${commit.sha}`,
            })
          }
          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Reset current branch (Mixed)</span>
        </button>
        <button
          type="button"
          onClick={() =>
            handleAction({
              type: "reset-hard",
              payload: { sha: commit.sha, mode: "hard" },
              danger: true,
              twoStepConfirm: true,
              gitCommand: `git reset --hard ${commit.sha}`,
            })
          }
          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-error hover:bg-error hover:text-white"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Reset current branch (Hard)...</span>
        </button>
      </div>

      <div className="my-1 border-t border-vscode-border" />

      <button
        type="button"
        onClick={() =>
          handleAction({
            type: "merge-into-current",
            payload: { sha: commit.sha },
            gitCommand: `git merge ${commit.sha}`,
          })
        }
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
      >
        <GitMerge className="h-3.5 w-3.5" />
        <span>Merge into current branch</span>
      </button>

      <button
        type="button"
        onClick={() =>
          handleAction({
            type: "rebase-onto",
            payload: { sha: commit.sha },
            gitCommand: `git rebase ${commit.sha}`,
          })
        }
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
      >
        <Split className="h-3.5 w-3.5" />
        <span>Rebase current branch onto this</span>
      </button>

      <button
        type="button"
        onClick={() =>
          handleAction({
            type: "rebase-interactive",
            payload: { sha: commit.sha },
            gitCommand: `git rebase -i ${commit.sha}`,
          })
        }
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
      >
        <Layers className="h-3.5 w-3.5" />
        <span>Interactive rebase from here</span>
      </button>

      <div className="my-1 border-t border-vscode-border" />

      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(commit.sha);
          handleAction({ type: "copy-sha", payload: { sha: commit.sha } });
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
      >
        <Copy className="h-3.5 w-3.5" />
        <span>Copy SHA</span>
      </button>

      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(commit.subject);
          handleAction({ type: "copy-message", payload: { message: commit.subject } });
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
      >
        <Copy className="h-3.5 w-3.5" />
        <span>Copy Message</span>
      </button>

      <button
        type="button"
        onClick={() =>
          handleAction({
            type: "open-web",
            payload: { sha: commit.sha },
          })
        }
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        <span>Open on GitHub/GitLab</span>
      </button>

      <button
        type="button"
        onClick={() =>
          handleAction({
            type: "ai-explain",
            payload: { sha: commit.sha },
          })
        }
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
      >
        <Sparkles className="h-3.5 w-3.5 text-yellow-400" />
        <span>Explain commit (AI)</span>
      </button>
    </>
  );

  const renderRefItems = (ref: RefLabel) => (
    <>
      <div className="px-3 py-1 text-[10px] font-semibold text-vscode-muted uppercase tracking-wider border-b border-vscode-border">
        {ref.kind}: {ref.name}
      </div>

      <button
        type="button"
        onClick={() =>
          handleAction({
            type: "checkout-ref",
            payload: { name: ref.name, kind: ref.kind },
            gitCommand: `git checkout ${ref.name}`,
          })
        }
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
      >
        <GitBranch className="h-3.5 w-3.5" />
        <span>Checkout</span>
      </button>

      <button
        type="button"
        onClick={() =>
          handleAction({
            type: "merge-ref-into-current",
            payload: { name: ref.name },
            gitCommand: `git merge ${ref.name}`,
          })
        }
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
      >
        <GitMerge className="h-3.5 w-3.5" />
        <span>Merge into current</span>
      </button>

      <button
        type="button"
        onClick={() =>
          handleAction({
            type: "rebase-current-onto-ref",
            payload: { name: ref.name },
            gitCommand: `git rebase ${ref.name}`,
          })
        }
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
      >
        <Split className="h-3.5 w-3.5" />
        <span>Rebase current onto</span>
      </button>

      <button
        type="button"
        onClick={() =>
          handleAction({
            type: "rename-ref",
            payload: { name: ref.name },
            gitCommand: `git branch -m ${ref.name} <new-name>`,
          })
        }
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
      >
        <GitBranch className="h-3.5 w-3.5" />
        <span>Rename</span>
      </button>

      <button
        type="button"
        onClick={() =>
          handleAction({
            type: "delete-ref",
            payload: { name: ref.name, kind: ref.kind },
            danger: true,
            twoStepConfirm: false,
            gitCommand:
              ref.kind === "RemoteBranch"
                ? `git push origin --delete ${ref.name}`
                : `git branch -d ${ref.name}`,
          })
        }
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-error hover:bg-error hover:text-white"
      >
        <Trash2 className="h-3.5 w-3.5" />
        <span>Delete ({ref.kind === "RemoteBranch" ? "remote" : "local"})</span>
      </button>

      <div className="my-1 border-t border-vscode-border" />

      <button
        type="button"
        onClick={() =>
          handleAction({
            type: "push-ref",
            payload: { name: ref.name },
            gitCommand: `git push origin ${ref.name}`,
          })
        }
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
      >
        <UploadCloud className="h-3.5 w-3.5" />
        <span>Push</span>
      </button>

      <button
        type="button"
        onClick={() =>
          handleAction({
            type: "set-upstream",
            payload: { name: ref.name },
            gitCommand: `git branch --set-upstream-to=origin/${ref.name} ${ref.name}`,
          })
        }
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
      >
        <GitBranch className="h-3.5 w-3.5" />
        <span>Set upstream</span>
      </button>

      <button
        type="button"
        onClick={() =>
          handleAction({
            type: "compare-with-head",
            payload: { name: ref.name },
          })
        }
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
      >
        <Split className="h-3.5 w-3.5" />
        <span>Compare with HEAD</span>
      </button>

      <button
        type="button"
        onClick={() =>
          handleAction({
            type: "create-pr",
            payload: { name: ref.name },
          })
        }
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
      >
        <GitPullRequest className="h-3.5 w-3.5" />
        <span>Create PR/MR</span>
      </button>

      <button
        type="button"
        onClick={() =>
          handleAction({
            type: "open-web",
            payload: { name: ref.name },
          })
        }
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        <span>Open on web</span>
      </button>
    </>
  );

  return (
    <div
      ref={menuRef}
      style={{
        left: `${Math.min(target.x, window.innerWidth - 240)}px`,
        top: `${Math.min(target.y, window.innerHeight - 380)}px`,
      }}
      className="fixed z-50 min-w-[220px] rounded-md border border-vscode-border bg-vscode-sidebar py-1 shadow-2xl animate-in fade-in select-none text-xs"
    >
      {target.type === "commit" && target.commit && renderCommitItems(target.commit)}
      {target.type === "ref" && target.refLabel && renderRefItems(target.refLabel)}
    </div>
  );
};
