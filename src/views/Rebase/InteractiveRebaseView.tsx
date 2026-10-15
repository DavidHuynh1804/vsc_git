import React, { useState, useEffect, useCallback } from "react";
import {
  GripVertical,
  ArrowUp,
  ArrowDown,
  Edit2,
  Trash2,
  Layers,
  AlertCircle,
  Play,
  X,
  RotateCcw,
} from "lucide-react";
import { RebaseTodoEntry, RebaseAction } from "@/m3/types";
import { useM3Store } from "@/m3/m3Store";
import { useUIStore } from "@/stores/ui";
import { validateRebaseTodo, moveEntry, parseRebaseTodo } from "./rebaseUtils";
import { commands, events } from "@/bindings";
import { EditMessageDialog } from "./EditMessageDialog";
import { isMock } from "@/env";

export interface InteractiveRebaseViewProps {
  baseSha?: string;
  initialEntries?: RebaseTodoEntry[];
  onStart?: (entries: RebaseTodoEntry[]) => Promise<void> | void;
  onCancel?: () => void;
}

const ACTION_COLORS: Record<RebaseAction, { bg: string; text: string; border: string }> = {
  pick: { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30" },
  reword: { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/30" },
  edit: { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/30" },
  squash: { bg: "bg-purple-500/15", text: "text-purple-400", border: "border-purple-500/30" },
  fixup: { bg: "bg-fuchsia-500/15", text: "text-fuchsia-400", border: "border-fuchsia-500/30" },
  drop: { bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/30" },
  exec: { bg: "bg-zinc-500/15", text: "text-zinc-400", border: "border-zinc-500/30" },
  break: { bg: "bg-zinc-500/15", text: "text-zinc-400", border: "border-zinc-500/30" },
};

export const InteractiveRebaseView: React.FC<InteractiveRebaseViewProps> = ({
  baseSha,
  initialEntries,
  onStart,
  onCancel,
}) => {
  const { dataSource: m3DataSource } = useM3Store();
  const { closeTab } = useUIStore();

  const [entries, setEntries] = useState<RebaseTodoEntry[]>(initialEntries ?? []);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [editingEntry, setEditingEntry] = useState<{ index: number; entry: RebaseTodoEntry } | null>(
    null
  );
  const [promptId, setPromptId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isMock()) return;
    let active = true;
    const unlistenPromise = events.promptRequest.listen((event) => {
      if (active && event.payload.kind === "sequence_editor") {
        setPromptId(event.payload.id);
        const parsed = parseRebaseTodo(event.payload.prompt);
        if (parsed.length > 0) {
          setEntries(parsed);
        }
      }
    });
    return () => {
      active = false;
      unlistenPromise.then((u) => u());
    };
  }, []);

  useEffect(() => {
    if (!initialEntries || initialEntries.length === 0) {
      if (m3DataSource.getRebaseTodo) {
        const mockItems = m3DataSource.getRebaseTodo();
        if (mockItems && mockItems.length > 0) {
          setEntries(mockItems);
        }
      }
    }
  }, [initialEntries, m3DataSource]);

  const validation = validateRebaseTodo(entries);

  const handleActionChange = (index: number, newAction: RebaseAction) => {
    const updated = [...entries];
    updated[index] = { ...updated[index], action: newAction };
    setEntries(updated);

    if (newAction === "reword") {
      setEditingEntry({ index, entry: updated[index] });
    }
  };

  const handleMove = useCallback((from: number, to: number) => {
    setEntries((prev) => moveEntry(prev, from, to));
    setSelectedIndex(to);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (e.altKey && e.key === "ArrowUp") {
        e.preventDefault();
        if (index > 0) {
          handleMove(index, index - 1);
        }
      } else if (e.altKey && e.key === "ArrowDown") {
        e.preventDefault();
        if (index < entries.length - 1) {
          handleMove(index, index + 1);
        }
      }
    },
    [entries.length, handleMove]
  );

  const handleSaveMessage = (newMessage: string) => {
    if (!editingEntry) return;
    const updated = [...entries];
    updated[editingEntry.index] = {
      ...updated[editingEntry.index],
      subject: newMessage,
    };
    setEntries(updated);
    setEditingEntry(null);
  };

  const handleStart = async () => {
    if (!validation.isValid || isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (onStart) {
        await onStart(entries);
      } else {
        await m3DataSource.submitRebaseTodo(entries, promptId ?? undefined);
      }
      closeTab("rebase-interactive");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    if (promptId) {
      void commands.answerPrompt(promptId, null);
    }
    if (onCancel) {
      onCancel();
    } else {
      closeTab("rebase-interactive");
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-vscode-bg text-vscode-fg">
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-vscode-border bg-vscode-sidebar px-4 py-2 text-xs select-none">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-vscode-accent" />
          <span className="font-semibold text-vscode-fg">Interactive Rebase</span>
          {baseSha && (
            <span className="rounded bg-vscode-input px-1.5 py-0.5 text-[10px] font-mono text-vscode-muted">
              onto {baseSha.slice(0, 7)}
            </span>
          )}
          <span className="text-vscode-muted">
            ({entries.length} commit{entries.length === 1 ? "" : "s"})
          </span>
        </div>

        <span className="text-[11px] text-vscode-muted hidden sm:inline">
          Drag to reorder · Use <kbd className="rounded bg-vscode-input px-1 py-0.2 border border-vscode-border">Alt+↑</kbd> / <kbd className="rounded bg-vscode-input px-1 py-0.2 border border-vscode-border">Alt+↓</kbd>
        </span>
      </div>

      {/* Validation Warning / Error Banner */}
      {!validation.isValid && validation.error && (
        <div className="flex items-center gap-2 border-b border-error/30 bg-error/10 px-4 py-2 text-xs text-error font-medium">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{validation.error}</span>
        </div>
      )}

      {/* Commit List Container */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-1.5">
        {entries.map((entry, index) => {
          const isSelected = selectedIndex === index;
          const isDragOver = dragOverIndex === index;
          const color = ACTION_COLORS[entry.action] ?? ACTION_COLORS.pick;

          return (
            <div
              key={`${entry.sha}-${index}`}
              tabIndex={0}
              onFocus={() => setSelectedIndex(index)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              draggable
              onDragStart={(e) => {
                setDraggedIndex(index);
                e.dataTransfer.setData("text/plain", index.toString());
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverIndex(index);
              }}
              onDragLeave={() => {
                if (dragOverIndex === index) setDragOverIndex(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedIndex !== null && draggedIndex !== index) {
                  handleMove(draggedIndex, index);
                }
                setDraggedIndex(null);
                setDragOverIndex(null);
              }}
              className={`flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs transition-colors cursor-default outline-none ${
                isDragOver
                  ? "border-vscode-accent bg-vscode-hover"
                  : isSelected
                  ? "border-vscode-accent/60 bg-vscode-active"
                  : "border-vscode-border/60 bg-vscode-sidebar/40 hover:bg-vscode-hover"
              }`}
            >
              {/* Drag Handle */}
              <div
                className="cursor-grab text-vscode-muted hover:text-vscode-fg p-0.5"
                title="Drag to reorder commit"
              >
                <GripVertical className="h-4 w-4" />
              </div>

              {/* Action Dropdown */}
              <select
                value={entry.action}
                onChange={(e) => handleActionChange(index, e.target.value as RebaseAction)}
                className={`rounded border px-2 py-0.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-vscode-accent cursor-pointer ${color.bg} ${color.text} ${color.border}`}
              >
                <option value="pick">pick</option>
                <option value="reword">reword</option>
                <option value="edit">edit</option>
                <option value="squash">squash</option>
                <option value="fixup">fixup</option>
                <option value="drop">drop</option>
              </select>

              {/* Commit SHA */}
              <span className="font-mono text-[11px] text-vscode-muted w-16 shrink-0">
                {entry.sha.slice(0, 7)}
              </span>

              {/* Commit Subject */}
              <span
                className={`flex-1 truncate font-medium ${
                  entry.action === "drop"
                    ? "line-through text-vscode-muted opacity-60"
                    : "text-vscode-fg"
                }`}
                title={entry.subject}
              >
                {entry.subject}
              </span>

              {/* Row Quick Action Buttons */}
              <div className="flex items-center gap-1 shrink-0 text-vscode-muted">
                {/* Edit Message Button for reword/squash */}
                {(entry.action === "reword" || entry.action === "squash") && (
                  <button
                    type="button"
                    onClick={() => setEditingEntry({ index, entry })}
                    title="Edit commit message"
                    className="rounded p-1 hover:bg-vscode-active hover:text-vscode-accent"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                )}

                {/* Move Up Button */}
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => handleMove(index, index - 1)}
                  title="Move up (Alt+↑)"
                  className="rounded p-1 hover:bg-vscode-active hover:text-vscode-fg disabled:opacity-20"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>

                {/* Move Down Button */}
                <button
                  type="button"
                  disabled={index === entries.length - 1}
                  onClick={() => handleMove(index, index + 1)}
                  title="Move down (Alt+↓)"
                  className="rounded p-1 hover:bg-vscode-active hover:text-vscode-fg disabled:opacity-20"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>

                {/* Drop / Pick Toggle */}
                <button
                  type="button"
                  onClick={() =>
                    handleActionChange(index, entry.action === "drop" ? "pick" : "drop")
                  }
                  title={entry.action === "drop" ? "Restore commit (pick)" : "Drop commit"}
                  className="rounded p-1 hover:bg-vscode-active hover:text-error"
                >
                  {entry.action === "drop" ? (
                    <RotateCcw className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Footer Action Bar */}
      <div className="flex items-center justify-between border-t border-vscode-border bg-vscode-sidebar px-4 py-2.5 text-xs">
        <button
          type="button"
          onClick={handleCancel}
          className="inline-flex items-center gap-1.5 rounded border border-vscode-border bg-vscode-input px-3 py-1.5 text-vscode-fg hover:bg-vscode-hover font-medium transition-colors"
        >
          <X className="h-3.5 w-3.5" />
          <span>Cancel</span>
        </button>

        <button
          type="button"
          disabled={!validation.isValid || isSubmitting}
          onClick={() => void handleStart()}
          className="inline-flex items-center gap-1.5 rounded bg-vscode-accent px-4 py-1.5 text-xs font-semibold text-white hover:brightness-110 shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Play className="h-3.5 w-3.5 fill-current" />
          <span>Start Rebase</span>
        </button>
      </div>

      {/* Edit message modal */}
      {editingEntry && (
        <EditMessageDialog
          isOpen={true}
          sha={editingEntry.entry.sha}
          initialMessage={editingEntry.entry.subject}
          onSave={handleSaveMessage}
          onCancel={() => setEditingEntry(null)}
        />
      )}
    </div>
  );
};
