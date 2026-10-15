import React, { useState, useEffect, useRef } from "react";
import { MessageSquare, X } from "lucide-react";

export interface EditMessageDialogProps {
  isOpen: boolean;
  sha: string;
  initialMessage: string;
  onSave: (newMessage: string) => void;
  onCancel: () => void;
}

export const EditMessageDialog: React.FC<EditMessageDialogProps> = ({
  isOpen,
  sha,
  initialMessage,
  onSave,
  onCancel,
}) => {
  const [message, setMessage] = useState(initialMessage);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMessage(initialMessage);
  }, [initialMessage, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        textareaRef.current?.focus();
        textareaRef.current?.select();
      }, 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        onCancel();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onSave(message);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, message, onCancel, onSave]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 select-none"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-vscode-border bg-vscode-sidebar p-5 shadow-2xl flex flex-col gap-3 text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-vscode-border pb-2">
          <div className="flex items-center gap-2 font-semibold text-vscode-fg">
            <MessageSquare className="h-4 w-4 text-vscode-accent" />
            <span>Edit Commit Message ({sha.slice(0, 7)})</span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1 text-vscode-muted hover:bg-vscode-hover hover:text-vscode-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-vscode-muted font-medium">Commit Message:</label>
          <textarea
            ref={textareaRef}
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full resize-y rounded border border-vscode-border bg-vscode-input p-2 font-mono text-xs text-vscode-fg focus:outline-none focus:border-vscode-accent"
            placeholder="Enter commit message..."
          />
          <span className="text-[10px] text-vscode-muted">
            Press Cmd+Enter (Ctrl+Enter) to save, Esc to cancel.
          </span>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-vscode-border">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1.5 border border-vscode-border text-vscode-muted hover:bg-vscode-hover hover:text-vscode-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!message.trim()}
            onClick={() => onSave(message.trim())}
            className="rounded bg-vscode-accent px-3 py-1.5 font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            Save Message
          </button>
        </div>
      </div>
    </div>
  );
};
