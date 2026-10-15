import React, { useState } from "react";
import { AlertCircle, X, ChevronDown, ChevronUp, Terminal, Lightbulb } from "lucide-react";
import { AppError } from "@/scm/types";
import { useUIStore } from "@/stores/ui";
import { useScmStore } from "@/scm/scmStore";

export interface ErrorToastProps {
  error: AppError;
  onClose: () => void;
}

export function getHintForErrorKind(kind: AppError["kind"]): {
  actionLabel: string;
  suggestion: string;
  actionId: string;
} | null {
  switch (kind) {
    case "DirtyWorktree":
      return {
        actionLabel: "Stash & Continue",
        suggestion: "Your working tree is dirty. Stash your changes to continue.",
        actionId: "stash_continue",
      };
    case "HookFailed":
      return {
        actionLabel: "Commit with --no-verify",
        suggestion: "A pre-commit hook failed. You can bypass hooks if necessary.",
        actionId: "no_verify_commit",
      };
    case "NonFastForward":
      return {
        actionLabel: "Pull then Push",
        suggestion: "Remote has new commits. Pull first to integrate changes.",
        actionId: "pull_push",
      };
    case "IndexLocked":
      return {
        actionLabel: "Retry",
        suggestion: "Another git process might be running or index.lock is stale.",
        actionId: "retry_lock",
      };
    case "PatchFailed":
      return {
        actionLabel: "Refresh Status",
        suggestion: "Diff has changed on disk. Refresh and try again.",
        actionId: "refresh_status",
      };
    case "AuthFailed":
      return {
        actionLabel: "Check Credentials",
        suggestion: "Authentication failed. Check your SSH keys or personal access token.",
        actionId: "check_auth",
      };
    default:
      return null;
  }
}

export const ErrorToast: React.FC<ErrorToastProps> = ({ error, onClose }) => {
  const { setGitOutputOpen } = useUIStore();
  const { refreshStatus, stashPush, pull, push } = useScmStore();
  const [showDetails, setShowDetails] = useState(false);

  const hint = error.hint || getHintForErrorKind(error.kind);

  const handleHintAction = async (actionId: string) => {
    switch (actionId) {
      case "stash_continue":
        await stashPush({ message: "Auto-stash before operation" });
        onClose();
        break;
      case "pull_push":
        await pull();
        await push();
        onClose();
        break;
      case "refresh_status":
        await refreshStatus();
        onClose();
        break;
      default:
        onClose();
        break;
    }
  };

  return (
    <div
      role="alert"
      className="fixed bottom-8 right-4 z-50 flex max-w-lg flex-col rounded border border-error bg-vscode-sidebar p-3 shadow-2xl text-xs text-vscode-fg"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0 text-error mt-0.5" />
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-error">
              {error.kind}: {error.message}
            </span>

            {/* Hint suggestion */}
            {hint && (
              <div className="flex items-center gap-1.5 text-[11px] text-vscode-muted">
                <Lightbulb className="h-3 w-3 text-warning flex-shrink-0" />
                <span>{"suggestion" in hint ? hint.suggestion : hint.label}</span>
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-vscode-muted hover:bg-vscode-hover hover:text-vscode-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Action buttons */}
      <div className="mt-3 flex items-center justify-between border-t border-vscode-border/50 pt-2 gap-2">
        <div className="flex items-center gap-2">
          {error.git_stderr && (
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-1 text-[11px] text-vscode-muted hover:text-vscode-fg"
            >
              <span>Chi tiết</span>
              {showDetails ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => setGitOutputOpen(true)}
            className="flex items-center gap-1 text-[11px] text-vscode-muted hover:text-vscode-fg"
          >
            <Terminal className="h-3 w-3" />
            <span>Mở Git Output</span>
          </button>
        </div>

        {hint && (
          <button
            type="button"
            onClick={() => handleHintAction("actionId" in hint ? hint.actionId : hint.action)}
            className="rounded bg-vscode-accent px-2.5 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90"
          >
            {"actionLabel" in hint ? hint.actionLabel : hint.label}
          </button>
        )}
      </div>

      {/* Expanded stderr details */}
      {showDetails && error.git_stderr && (
        <div className="mt-2 max-h-36 overflow-y-auto rounded bg-vscode-bg p-2 font-mono text-[10px] text-error whitespace-pre-wrap border border-vscode-border">
          {error.git_stderr}
        </div>
      )}
    </div>
  );
};
