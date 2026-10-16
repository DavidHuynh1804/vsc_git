import React, { useEffect, useState, useRef } from "react";
import { X } from "lucide-react";

export interface PromptDialogProps {
  isOpen: boolean;
  title: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export const PromptDialog: React.FC<PromptDialogProps> = ({
  isOpen,
  title,
  label,
  initialValue = "",
  placeholder,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}) => {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(initialValue);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isOpen, initialValue]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        onCancel();
      } else if (e.key === "Enter") {
        onConfirm(value);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel, onConfirm, value]);

  if (!isOpen) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-dialog-title"
      style={{ overscrollBehavior: "contain" }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        className="flex w-full max-w-md flex-col rounded-lg border border-vscode-border bg-vscode-sidebar p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-vscode-border pb-3">
          <h3 id="prompt-dialog-title" className="text-sm font-semibold text-vscode-fg">{title}</h3>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onCancel}
            className="rounded p-1 text-vscode-muted hover:bg-vscode-hover hover:text-vscode-fg transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="my-4 flex flex-col gap-1.5">
          {label && <label htmlFor="prompt-dialog-input" className="text-[11px] text-vscode-muted">{label}</label>}
          <input
            ref={inputRef}
            id="prompt-dialog-input"
            type="text"
            name="promptInput"
            aria-label={label || title}
            spellCheck={false}
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            className="rounded border border-vscode-border bg-vscode-input px-2.5 py-1.5 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-accent"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-vscode-border px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-hover"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => value.trim() && onConfirm(value.trim())}
            disabled={!value.trim()}
            className="rounded bg-vscode-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
