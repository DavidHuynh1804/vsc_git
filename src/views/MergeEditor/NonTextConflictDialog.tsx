import React from "react";
import { AlertTriangle, FileText, Trash2, ArrowLeftRight } from "lucide-react";
import { Resolution, ConflictKind } from "@/m3/types";

export interface NonTextConflictDialogProps {
  filePath: string;
  conflictKind: ConflictKind;
  onResolve: (resolution: Resolution) => void | Promise<void>;
  onCancel?: () => void;
}

export const NonTextConflictDialog: React.FC<NonTextConflictDialogProps> = ({
  filePath,
  conflictKind,
  onResolve,
  onCancel,
}) => {
  let description = "This conflict cannot be resolved using the text editor.";
  switch (conflictKind) {
    case "DeletedByUs":
      description = "File was deleted by us (Current) but modified or added by them (Incoming).";
      break;
    case "DeletedByThem":
      description = "File was modified by us (Current) but deleted by them (Incoming).";
      break;
    case "RenameConflict":
      description = "File was renamed or involved in conflicting renames.";
      break;
    case "BothDeleted":
      description = "File was deleted in both branches.";
      break;
    default:
      description = "This file appears to be binary or non-textual.";
      break;
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-6 bg-vscode-bg text-vscode-fg">
      <div className="max-w-md w-full rounded-lg border border-vscode-border bg-vscode-sidebar p-6 shadow-xl flex flex-col gap-4">
        <div className="flex items-center gap-3 text-amber-400">
          <AlertTriangle className="h-6 w-6 shrink-0" />
          <h2 className="text-sm font-semibold">Non-Text Merge Conflict</h2>
        </div>

        <div className="flex flex-col gap-1 text-xs">
          <p className="font-mono text-vscode-fg break-all font-medium">{filePath}</p>
          <p className="text-vscode-muted">{description}</p>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <button
            type="button"
            onClick={() => void onResolve("Ours")}
            className="flex items-center justify-between px-3 py-2 rounded border border-vscode-border bg-vscode-input hover:bg-vscode-hover text-xs font-medium text-vscode-fg transition-colors"
          >
            <span className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-400" />
              <span>Keep Ours (Current)</span>
            </span>
            <span className="text-[10px] text-vscode-muted">:2</span>
          </button>

          <button
            type="button"
            onClick={() => void onResolve("Theirs")}
            className="flex items-center justify-between px-3 py-2 rounded border border-vscode-border bg-vscode-input hover:bg-vscode-hover text-xs font-medium text-vscode-fg transition-colors"
          >
            <span className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-emerald-400" />
              <span>Keep Theirs (Incoming)</span>
            </span>
            <span className="text-[10px] text-vscode-muted">:3</span>
          </button>

          <button
            type="button"
            onClick={() => void onResolve("Delete")}
            className="flex items-center justify-between px-3 py-2 rounded border border-vscode-border bg-vscode-input hover:bg-vscode-hover text-xs font-medium text-error transition-colors"
          >
            <span className="flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              <span>Delete File</span>
            </span>
          </button>
        </div>

        {onCancel && (
          <div className="flex justify-end pt-2 border-t border-vscode-border">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1 text-xs text-vscode-muted hover:text-vscode-fg"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
