import React, { useState } from "react";
import { AlertTriangle, X } from "lucide-react";

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  gitCommand?: string;
  twoStepConfirm?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  gitCommand,
  twoStepConfirm = false,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
}) => {
  const [step, setStep] = useState<1 | 2>(1);

  if (!isOpen) return null;

  const handleClose = () => {
    setStep(1);
    onCancel();
  };

  const handleConfirmClick = () => {
    if (twoStepConfirm && step === 1) {
      setStep(2);
      return;
    }
    setStep(1);
    onConfirm();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex w-full max-w-md flex-col rounded-lg border border-vscode-border bg-vscode-sidebar p-5 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-vscode-border">
          <div className="flex items-center gap-2 text-error font-semibold text-sm">
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            <span>{title}</span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded p-1 text-vscode-muted hover:text-vscode-fg hover:bg-vscode-hover"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-3 py-4 text-xs text-vscode-fg leading-relaxed">
          <p>{message}</p>

          {gitCommand && (
            <div className="flex flex-col gap-1 rounded bg-vscode-input p-2.5 border border-vscode-border">
              <span className="text-[10px] text-vscode-muted uppercase tracking-wider font-semibold">
                Git command to run:
              </span>
              <code className="font-mono text-error font-semibold break-all text-xs">
                {gitCommand}
              </code>
            </div>
          )}

          {twoStepConfirm && (
            <div
              className={`rounded border p-2.5 text-[11px] ${
                step === 1
                  ? "border-vscode-border bg-vscode-input text-vscode-muted"
                  : "border-error/50 bg-error/10 text-error font-medium"
              }`}
            >
              {step === 1 ? (
                <span>
                  <strong>Step 1 of 2:</strong> This action cannot be undone. Please confirm you understand the consequences.
                </span>
              ) : (
                <span>
                  <strong>Step 2 of 2: FINAL CONFIRMATION.</strong> All uncommitted modifications and targeted history will be permanently discarded.
                </span>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-vscode-border">
          <button
            type="button"
            onClick={handleClose}
            className="rounded px-3 py-1.5 text-xs text-vscode-muted hover:text-vscode-fg hover:bg-vscode-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="confirm-dialog-btn"
            onClick={handleConfirmClick}
            className={`rounded px-4 py-1.5 text-xs font-semibold text-white transition-colors ${
              twoStepConfirm && step === 2
                ? "bg-red-600 hover:bg-red-700"
                : "bg-vscode-accent hover:opacity-90"
            }`}
          >
            {twoStepConfirm && step === 1 ? "I Understand, Proceed" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
