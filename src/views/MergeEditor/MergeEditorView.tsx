import React, { useState, useEffect, useRef } from "react";
import { Editor } from "@monaco-editor/react";
import "@/monaco/monacoLoader";
import type * as MonacoEditor from "monaco-editor";
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  ExternalLink,
  Layers,
  FileCode,
  AlertTriangle,
} from "lucide-react";
import { useM3Store } from "@/m3/m3Store";
import { useScmStore } from "@/scm/scmStore";
import { useUIStore } from "@/stores/ui";
import { guessLanguageByPath } from "@/monaco/language";
import {
  parseConflictRegions,
  countConflictMarkers,
  resolveConflictRegion,
} from "@/m3/conflictParser";
import { ConflictVersions, ConflictKind, Resolution } from "@/m3/types";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { NonTextConflictDialog } from "./NonTextConflictDialog";

export interface MergeEditorViewProps {
  filePath: string;
  onResolved?: () => void;
}

function toText(val: Uint8Array | string | null | undefined): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  if (val instanceof Uint8Array) {
    return new TextDecoder().decode(val);
  }
  return "";
}

export const MergeEditorView: React.FC<MergeEditorViewProps> = ({
  filePath,
  onResolved,
}) => {
  const { dataSource: m3DataSource } = useM3Store();
  const { stage, refreshStatus } = useScmStore();
  const { theme, closeTab } = useUIStore();

  const [isLoading, setIsLoading] = useState(true);
  const [conflictVersions, setConflictVersions] = useState<ConflictVersions | null>(null);
  const [currentText, setCurrentText] = useState("");
  const [incomingText, setIncomingText] = useState("");
  const [baseText, setBaseText] = useState("");
  const [resultText, setResultText] = useState("");
  const [showBase, setShowBase] = useState(false);
  const [showResolveWarning, setShowResolveWarning] = useState(false);
  const [activeConflictIdx, setActiveConflictIdx] = useState(0);

  const resultEditorRef = useRef<MonacoEditor.editor.IStandaloneCodeEditor | null>(null);

  // Load conflict versions
  useEffect(() => {
    let active = true;
    setIsLoading(true);

    m3DataSource
      .getConflict(filePath)
      .then((versions) => {
        if (!active) return;
        setConflictVersions(versions);

        const current = toText(versions.ours);
        const incoming = toText(versions.theirs);
        const base = toText(versions.base);
        const worktree = toText(versions.worktree);

        setCurrentText(current);
        setIncomingText(incoming);
        setBaseText(base);
        setResultText(worktree || current || incoming);
      })
      .catch((err) => {
        console.error("Failed to load conflict versions:", err);
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [filePath, m3DataSource]);

  const { regions, hasDiff3 } = parseConflictRegions(resultText);
  const remainingConflicts = countConflictMarkers(resultText);

  // Determine if it's a non-textual conflict
  const isBinaryOrNonText =
    conflictVersions &&
    !resultText.includes("<<<<<<<") &&
    (!conflictVersions.ours || !conflictVersions.theirs);

  let conflictKind: ConflictKind = "BothModified";
  if (conflictVersions) {
    if (!conflictVersions.ours && conflictVersions.theirs) {
      conflictKind = "DeletedByUs";
    } else if (conflictVersions.ours && !conflictVersions.theirs) {
      conflictKind = "DeletedByThem";
    } else if (!conflictVersions.ours && !conflictVersions.theirs) {
      conflictKind = "BothDeleted";
    }
  }

  const handleResolveNonText = async (resolution: Resolution) => {
    await m3DataSource.resolveWith(filePath, resolution);
    await stage([filePath]);
    await refreshStatus();
    onResolved?.();
    closeTab(`merge-${filePath}`);
  };

  const handleApplyResolution = (choice: "current" | "incoming" | "both" | "base") => {
    if (regions.length === 0) return;
    const activeRegion = regions[activeConflictIdx] ?? regions[0];
    const newContent = resolveConflictRegion(resultText, activeRegion.id, choice);
    setResultText(newContent);
    if (resultEditorRef.current) {
      resultEditorRef.current.setValue(newContent);
    }
  };

  const handleJumpToConflict = (idx: number) => {
    if (regions.length === 0) return;
    const clamped = Math.max(0, Math.min(idx, regions.length - 1));
    setActiveConflictIdx(clamped);
    const targetRegion = regions[clamped];
    if (resultEditorRef.current && targetRegion) {
      resultEditorRef.current.revealLineInCenter(targetRegion.startLine);
      resultEditorRef.current.setPosition({
        lineNumber: targetRegion.startLine,
        column: 1,
      });
      resultEditorRef.current.focus();
    }
  };

  const executeMarkResolved = async () => {
    await m3DataSource.saveWorktreeFile(filePath, resultText);
    await stage([filePath]);
    await refreshStatus();
    onResolved?.();
    closeTab(`merge-${filePath}`);
  };

  const handleMarkResolvedClick = () => {
    if (remainingConflicts > 0) {
      setShowResolveWarning(true);
    } else {
      void executeMarkResolved();
    }
  };

  const handleOpenExternal = () => {
    void m3DataSource.openInEditor(filePath);
  };

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-vscode-bg text-xs text-vscode-muted">
        Loading merge conflict editor...
      </div>
    );
  }

  if (isBinaryOrNonText) {
    return (
      <NonTextConflictDialog
        filePath={filePath}
        conflictKind={conflictKind}
        onResolve={handleResolveNonText}
      />
    );
  }

  const monacoTheme = theme === "light" ? "vs" : "vs-dark";
  const language = guessLanguageByPath(filePath);
  const activeRegion = regions[activeConflictIdx] ?? regions[0];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-vscode-bg text-vscode-fg">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-vscode-border bg-vscode-sidebar px-3 py-1.5 text-xs select-none">
        <div className="flex items-center gap-2 min-w-0">
          <FileCode className="h-4 w-4 shrink-0 text-vscode-accent" />
          <span className="font-semibold text-vscode-fg truncate">{filePath}</span>

          <span
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold ${
              remainingConflicts > 0
                ? "bg-amber-500/20 text-amber-400"
                : "bg-emerald-500/20 text-emerald-400"
            }`}
          >
            {remainingConflicts > 0 ? (
              <>
                <AlertTriangle className="h-3 w-3" />
                <span>{remainingConflicts} conflict{remainingConflicts > 1 ? "s" : ""} remaining</span>
              </>
            ) : (
              <>
                <CheckCircle className="h-3 w-3" />
                <span>All conflicts resolved</span>
              </>
            )}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Conflict Navigation */}
          {regions.length > 0 && (
            <div className="flex items-center gap-1 border-r border-vscode-border pr-2 mr-1">
              <span className="text-[11px] text-vscode-muted">
                {activeConflictIdx + 1} / {regions.length}
              </span>
              <button
                type="button"
                onClick={() => handleJumpToConflict(activeConflictIdx - 1)}
                disabled={activeConflictIdx <= 0}
                title="Previous Conflict"
                className="rounded p-1 text-vscode-muted hover:bg-vscode-hover hover:text-vscode-fg disabled:opacity-30"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleJumpToConflict(activeConflictIdx + 1)}
                disabled={activeConflictIdx >= regions.length - 1}
                title="Next Conflict"
                className="rounded p-1 text-vscode-muted hover:bg-vscode-hover hover:text-vscode-fg disabled:opacity-30"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Toggle Base View */}
          <button
            type="button"
            onClick={() => setShowBase(!showBase)}
            title="Toggle Base (:1) view"
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs border border-vscode-border transition-colors ${
              showBase
                ? "bg-vscode-accent text-white"
                : "bg-vscode-input text-vscode-fg hover:bg-vscode-hover"
            }`}
          >
            <Layers className="h-3 w-3" />
            <span>Base (:1)</span>
          </button>

          {/* Open in External Editor */}
          <button
            type="button"
            onClick={handleOpenExternal}
            title="Open in external editor"
            className="inline-flex items-center gap-1 rounded border border-vscode-border bg-vscode-input px-2 py-1 text-xs text-vscode-fg hover:bg-vscode-hover"
          >
            <ExternalLink className="h-3 w-3" />
            <span>External</span>
          </button>

          {/* Mark as Resolved */}
          <button
            type="button"
            onClick={handleMarkResolvedClick}
            className="inline-flex items-center gap-1 rounded bg-vscode-accent px-2.5 py-1 text-xs font-medium text-white hover:brightness-110 shadow-sm"
          >
            <CheckCircle className="h-3.5 w-3.5" />
            <span>Mark as Resolved</span>
          </button>
        </div>
      </div>

      {/* Conflict Quick Action Bar */}
      {regions.length > 0 && activeRegion && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-vscode-activity px-3 py-1 text-xs border-b border-vscode-border">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-vscode-muted">
              Conflict #{activeRegion.id} (lines {activeRegion.startLine}-{activeRegion.endLine}):
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleApplyResolution("current")}
              className="rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 px-2 py-0.5 text-xs font-medium transition-colors"
              title="Accept Current (:2) change"
            >
              Accept Current
            </button>

            <button
              type="button"
              onClick={() => handleApplyResolution("incoming")}
              className="rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 px-2 py-0.5 text-xs font-medium transition-colors"
              title="Accept Incoming (:3) change"
            >
              Accept Incoming
            </button>

            <button
              type="button"
              onClick={() => handleApplyResolution("both")}
              className="rounded bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 px-2 py-0.5 text-xs font-medium transition-colors"
              title="Accept Both (Current first)"
            >
              Accept Both
            </button>

            {(hasDiff3 || showBase || activeRegion.base !== undefined) && (
              <button
                type="button"
                onClick={() => handleApplyResolution("base")}
                className="rounded bg-gray-500/20 text-gray-300 hover:bg-gray-500/30 px-2 py-0.5 text-xs font-medium transition-colors"
                title="Accept Base (:1) change"
              >
                Accept Base
              </button>
            )}
          </div>
        </div>
      )}

      {/* Editor Panes: Top Half (Sources) and Bottom Half (Result) */}
      <div className="flex flex-1 flex-col overflow-hidden min-h-0">
        {/* Top Panes Row */}
        <div className="flex flex-1 border-b border-vscode-border overflow-hidden min-h-[160px]">
          {/* Current (:2, ours) */}
          <div className="flex flex-1 flex-col border-r border-vscode-border min-w-0">
            <div className="flex items-center justify-between bg-blue-500/10 px-2 py-1 text-[11px] font-semibold text-blue-400 border-b border-vscode-border select-none">
              <span>Current (Ours, :2)</span>
            </div>
            <div className="flex-1 min-h-0">
              <Editor
                height="100%"
                width="100%"
                language={language}
                theme={monacoTheme}
                value={currentText}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 12,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
              />
            </div>
          </div>

          {/* Base (:1, optional) */}
          {showBase && (
            <div className="flex flex-1 flex-col border-r border-vscode-border min-w-0">
              <div className="flex items-center justify-between bg-zinc-500/10 px-2 py-1 text-[11px] font-semibold text-zinc-400 border-b border-vscode-border select-none">
                <span>Base (:1)</span>
              </div>
              <div className="flex-1 min-h-0">
                <Editor
                  height="100%"
                  width="100%"
                  language={language}
                  theme={monacoTheme}
                  value={baseText}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                  }}
                />
              </div>
            </div>
          )}

          {/* Incoming (:3, theirs) */}
          <div className="flex flex-1 flex-col min-w-0">
            <div className="flex items-center justify-between bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-400 border-b border-vscode-border select-none">
              <span>Incoming (Theirs, :3)</span>
            </div>
            <div className="flex-1 min-h-0">
              <Editor
                height="100%"
                width="100%"
                language={language}
                theme={monacoTheme}
                value={incomingText}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 12,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
              />
            </div>
          </div>
        </div>

        {/* Bottom Pane (Result Editor - Editable) */}
        <div className="flex flex-1 flex-col min-h-[180px] overflow-hidden">
          <div className="flex items-center justify-between bg-vscode-activity px-2 py-1 text-[11px] font-semibold text-vscode-fg border-b border-vscode-border select-none">
            <span>Result (Working Tree with conflict markers — editable)</span>
            <span className="text-[10px] text-vscode-muted">
              Auto-saved to result buffer. Click &quot;Mark as Resolved&quot; to stage.
            </span>
          </div>
          <div className="flex-1 min-h-0">
            <Editor
              height="100%"
              width="100%"
              language={language}
              theme={monacoTheme}
              value={resultText}
              onMount={(editor) => {
                resultEditorRef.current = editor;
                editor.onDidChangeModelContent(() => {
                  setResultText(editor.getValue());
                });
              }}
              options={{
                readOnly: false,
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          </div>
        </div>
      </div>

      {/* Warning Dialog when marking resolved with conflict markers remaining */}
      <ConfirmDialog
        isOpen={showResolveWarning}
        title="Unresolved Conflict Markers Detected"
        message={`This file still contains ${remainingConflicts} conflict marker(s) (\`<<<<<<<\`). Marking it as resolved will save the file with raw markers into git index. Are you sure you want to proceed?`}
        confirmLabel="Mark as Resolved Anyway"
        isDestructive
        onConfirm={() => {
          setShowResolveWarning(false);
          void executeMarkResolved();
        }}
        onCancel={() => setShowResolveWarning(false)}
      />
    </div>
  );
};
