import React, { useState, useEffect } from "react";
import { AlertCircle, GitMerge, Play, SkipForward, XCircle } from "lucide-react";
import { useM3Store } from "@/m3/m3Store";
import { useScmStore } from "@/scm/scmStore";
import { NormalizedOperationState } from "@/m3/types";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export interface OperationBannerProps {
  operationState?: NormalizedOperationState;
  hasConflict?: boolean;
  onContinue?: () => Promise<void> | void;
  onSkip?: () => Promise<void> | void;
  onAbort?: () => Promise<void> | void;
  className?: string;
}

export const OperationBanner: React.FC<OperationBannerProps> = ({
  operationState: propState,
  hasConflict: propHasConflict,
  onContinue: propOnContinue,
  onSkip: propOnSkip,
  onAbort: propOnAbort,
  className = "",
}) => {
  const {
    operationState: storeState,
    refreshOperationState,
    opContinue: storeContinue,
    opSkip: storeSkip,
    opAbort: storeAbort,
    isLoading,
  } = useM3Store();

  const { status } = useScmStore();
  const [showAbortConfirm, setShowAbortConfirm] = useState(false);

  useEffect(() => {
    if (!propState) {
      void refreshOperationState();
    }
  }, [propState, refreshOperationState]);

  const state = propState ?? storeState;
  const hasConflict =
    propHasConflict ??
    (status?.entries.some((e) => e.kind.type === "Unmerged") ?? false);

  if (!state || !state.isActive || state.kind === "None") {
    return null;
  }

  const handleContinue = async () => {
    if (propOnContinue) {
      await propOnContinue();
    } else {
      await storeContinue();
    }
  };

  const handleSkip = async () => {
    if (propOnSkip) {
      await propOnSkip();
    } else {
      await storeSkip();
    }
  };

  const handleAbort = async () => {
    setShowAbortConfirm(false);
    if (propOnAbort) {
      await propOnAbort();
    } else {
      await storeAbort();
    }
  };

  let titleText = "";
  if (state.kind === "Rebasing") {
    const branch = state.branch ?? "HEAD";
    const onto = state.onto ?? "upstream";
    const step = state.step ?? 1;
    const total = state.total ?? 1;
    titleText = `Rebasing \`${branch}\` onto \`${onto}\` — bước ${step}/${total}`;
  } else if (state.kind === "Merging") {
    const target = state.commit_id ? `commit \`${state.commit_id.slice(0, 7)}\`` : "";
    titleText = `Merging ${target}`.trim();
  } else if (state.kind === "CherryPicking") {
    const target = state.commit_id ? `commit \`${state.commit_id.slice(0, 7)}\`` : "";
    titleText = `Cherry-picking ${target}`.trim();
  } else if (state.kind === "Reverting") {
    const target = state.commit_id ? `commit \`${state.commit_id.slice(0, 7)}\`` : "";
    titleText = `Reverting ${target}`.trim();
  }

  return (
    <>
      <div
        role="region"
        aria-label="In-progress git operation"
        className={`flex flex-col gap-2 border-b border-amber-500/30 bg-amber-500/10 p-2.5 text-xs select-none ${className}`}
      >
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <GitMerge className="h-4 w-4 shrink-0 text-amber-500" />
            <span className="font-medium truncate text-vscode-fg text-[11px]" title={titleText}>
              {titleText}
            </span>
          </div>
          {hasConflict && (
            <span
              className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-500 shrink-0"
              title="Resolve all merge conflicts before continuing"
            >
              <AlertCircle className="h-3 w-3" />
              <span>Conflicts</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 justify-end">
          <button
            type="button"
            disabled={hasConflict || isLoading}
            onClick={() => void handleContinue()}
            aria-label="Continue operation"
            title={
              hasConflict
                ? "Cannot continue while there are unresolved conflicts"
                : "Continue operation"
            }
            className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              hasConflict || isLoading
                ? "cursor-not-allowed bg-vscode-input text-vscode-muted opacity-50"
                : "bg-vscode-accent text-white hover:bg-vscode-accent-hover"
            }`}
          >
            <Play className="h-3 w-3 fill-current" />
            <span>Continue</span>
          </button>

          <button
            type="button"
            disabled={isLoading}
            onClick={() => void handleSkip()}
            aria-label="Skip current patch"
            title="Skip current patch"
            className="inline-flex items-center gap-1 rounded border border-vscode-border bg-vscode-sidebar px-2 py-1 text-xs text-vscode-fg hover:bg-vscode-hover disabled:opacity-50 transition-colors"
          >
            <SkipForward className="h-3 w-3" />
            <span>Skip</span>
          </button>

          <button
            type="button"
            disabled={isLoading}
            onClick={() => setShowAbortConfirm(true)}
            aria-label="Abort operation"
            title="Abort operation"
            className="inline-flex items-center gap-1 rounded border border-vscode-border bg-vscode-sidebar px-2 py-1 text-xs text-error hover:bg-vscode-hover disabled:opacity-50 transition-colors"
          >
            <XCircle className="h-3 w-3" />
            <span>Abort</span>
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showAbortConfirm}
        title="Abort Git Operation"
        message="Are you sure you want to abort the current operation? Any in-progress resolution will be discarded and the repository will be restored to its previous state."
        confirmLabel="Abort"
        isDestructive
        onConfirm={() => void handleAbort()}
        onCancel={() => setShowAbortConfirm(false)}
      />
    </>
  );
};
