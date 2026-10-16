import React from "react";
import {
  Columns,
  Rows,
  Space,
  ChevronUp,
  ChevronDown,
  Plus,
  Minus,
  RotateCcw,
  Save,
} from "lucide-react";
import { useScmStore } from "@/scm/scmStore";

export interface DiffToolbarProps {
  filePath: string;
  context: "staged" | "unstaged" | "untracked" | "merge";
  isDirty: boolean;
  canSave: boolean;
  onSave: () => void;
  onStageSelection: () => void;
  onUnstageSelection: () => void;
  onRevertSelection: () => void;
  onPreviousChange: () => void;
  onNextChange: () => void;
}

export const DiffToolbar: React.FC<DiffToolbarProps> = ({
  filePath,
  context,
  isDirty,
  canSave,
  onSave,
  onStageSelection,
  onUnstageSelection,
  onRevertSelection,
  onPreviousChange,
  onNextChange,
}) => {
  const {
    diffSideBySide,
    setDiffSideBySide,
    diffIgnoreWhitespace,
    setDiffIgnoreWhitespace,
  } = useScmStore();

  const isStaged = context === "staged";

  return (
    <div className="flex h-9 w-full items-center justify-between border-b border-vscode-border bg-vscode-sidebar px-3 text-xs select-none">
      {/* File & Context title */}
      <div className="flex items-center gap-2 overflow-hidden">
        <span className="font-semibold text-vscode-fg truncate">{filePath}</span>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-mono font-medium"
          style={{
            backgroundColor: "var(--vscode-badge-bg)",
            color: "var(--vscode-badge-fg)",
          }}
        >
          {isStaged ? "Index ↔ HEAD" : "Working Tree ↔ Index"}
        </span>
        {isDirty && (
          <span className="h-2 w-2 rounded-full bg-vscode-accent" title="Unsaved changes" aria-label="Unsaved changes" />
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1 text-vscode-muted">
        {/* Navigation */}
        <button
          type="button"
          title="Previous Change (Alt+F5)"
          aria-label="Previous Change (Alt+F5)"
          onClick={onPreviousChange}
          className="rounded p-1 hover:bg-vscode-hover hover:text-vscode-fg transition-colors"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Next Change (Shift+Alt+F5)"
          aria-label="Next Change (Shift+Alt+F5)"
          onClick={onNextChange}
          className="rounded p-1 hover:bg-vscode-hover hover:text-vscode-fg transition-colors"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>

        <div className="mx-1 h-3.5 w-[1px] bg-vscode-border" />

        {/* Stage / Unstage / Revert Selection */}
        {isStaged ? (
          <button
            type="button"
            title="Unstage Selected Ranges"
            aria-label="Unstage Selected Ranges"
            onClick={onUnstageSelection}
            className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-vscode-hover hover:text-vscode-fg text-[11px] transition-colors"
          >
            <Minus className="h-3 w-3" />
            <span>Unstage Ranges</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              title="Stage Selected Ranges (Cmd+K Cmd+Alt+S)"
              aria-label="Stage Selected Ranges (Cmd+K Cmd+Alt+S)"
              onClick={onStageSelection}
              className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-vscode-hover hover:text-vscode-fg text-[11px] transition-colors"
            >
              <Plus className="h-3 w-3" />
              <span>Stage Ranges</span>
            </button>
            <button
              type="button"
              title="Revert Selected Ranges (Cmd+K Cmd+R)"
              aria-label="Revert Selected Ranges (Cmd+K Cmd+R)"
              onClick={onRevertSelection}
              className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-vscode-hover hover:text-error text-[11px] transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Revert Ranges</span>
            </button>
          </>
        )}

        <div className="mx-1 h-3.5 w-[1px] bg-vscode-border" />

        {/* Toggle Ignore Whitespace */}
        <button
          type="button"
          title={diffIgnoreWhitespace ? "Include Whitespace" : "Ignore Whitespace"}
          aria-label={diffIgnoreWhitespace ? "Include Whitespace" : "Ignore Whitespace"}
          aria-pressed={diffIgnoreWhitespace}
          onClick={() => setDiffIgnoreWhitespace(!diffIgnoreWhitespace)}
          className={`rounded p-1 transition-colors ${
            diffIgnoreWhitespace
              ? "bg-vscode-accent text-white"
              : "hover:bg-vscode-hover hover:text-vscode-fg"
          }`}
        >
          <Space className="h-3.5 w-3.5" />
        </button>

        {/* Toggle Side-by-Side vs Inline */}
        <button
          type="button"
          title={diffSideBySide ? "Switch to Inline View" : "Switch to Side-by-Side View"}
          aria-label={diffSideBySide ? "Switch to Inline View" : "Switch to Side-by-Side View"}
          onClick={() => setDiffSideBySide(!diffSideBySide)}
          className="rounded p-1 hover:bg-vscode-hover hover:text-vscode-fg transition-colors"
        >
          {diffSideBySide ? (
            <Columns className="h-3.5 w-3.5" />
          ) : (
            <Rows className="h-3.5 w-3.5" />
          )}
        </button>

        {/* Save button if editable */}
        {canSave && (
          <button
            type="button"
            title="Save File (Cmd+S)"
            aria-label="Save File (Cmd+S)"
            onClick={onSave}
            disabled={!isDirty}
            className={`flex items-center gap-1 rounded px-2.5 py-1 ml-1 text-[11px] font-medium transition-colors ${
              isDirty
                ? "bg-vscode-accent text-white hover:bg-vscode-accent-hover"
                : "opacity-40 cursor-not-allowed text-vscode-muted"
            }`}
          >
            <Save className="h-3 w-3" />
            <span>Save</span>
          </button>
        )}
      </div>
    </div>
  );
};
