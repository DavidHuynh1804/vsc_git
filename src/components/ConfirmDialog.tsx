import React, { useEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  isDestructive = false,
  onConfirm,
  onCancel,
}) => {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      confirmBtnRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        onCancel();
      } else if (e.key === "Enter") {
        onConfirm();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel, onConfirm]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      style={{ overscrollBehavior: "contain" }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        className="flex w-full max-w-md flex-col rounded-lg border border-vscode-border bg-vscode-sidebar p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-vscode-border pb-3">
          <div className="flex items-center gap-2">
            {isDestructive && <AlertTriangle className="h-4 w-4 text-error shrink-0" />}
            <h3 id="confirm-dialog-title" className="text-sm font-semibold text-vscode-fg">{title}</h3>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onCancel}
            className="rounded p-1 text-vscode-muted hover:bg-vscode-hover hover:text-vscode-fg transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <p className="my-4 text-xs leading-relaxed text-vscode-fg whitespace-pre-wrap">
          {message}
        </p>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-vscode-border px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-hover"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            className={`rounded px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 ${
              isDestructive ? "bg-error" : "bg-vscode-accent"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
