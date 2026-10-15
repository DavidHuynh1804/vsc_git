import React, { useState, useEffect, useRef, useCallback } from "react";
import { DiffEditor } from "@monaco-editor/react";
import "@/monaco/monacoLoader";
import type * as MonacoEditor from "monaco-editor";
import { useScmStore } from "@/scm/scmStore";
import { useUIStore } from "@/stores/ui";
import { DiffToolbar } from "./DiffToolbar";
import { ImageDiffView } from "./ImageDiffView";
import { BinaryDiffView } from "./BinaryDiffView";
import { guessLanguageByPath } from "@/monaco/language";
import { FileRev, LineSelection } from "@/scm/types";
import { mapMonacoSelectionToLineSelection } from "@/scm/diffUtils";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"]);
const BINARY_EXTENSIONS = new Set(["zip", "tar", "gz", "pdf", "exe", "dll", "so", "dylib", "wasm", "iso", "bin"]);

export interface DiffViewProps {
  filePath: string;
  context?: "staged" | "unstaged" | "untracked" | "merge";
}

export const DiffView: React.FC<DiffViewProps> = ({ filePath, context = "unstaged" }) => {
  const { dataSource, diffSideBySide, diffIgnoreWhitespace, refreshStatus } = useScmStore();
  const { theme } = useUIStore();

  const [originalContent, setOriginalContent] = useState<string>("");
  const [modifiedContent, setModifiedContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [currentModifiedValue, setCurrentModifiedValue] = useState<string>("");

  const diffEditorRef = useRef<MonacoEditor.editor.IStandaloneDiffEditor | null>(null);

  const isStaged = context === "staged";
  const isWorktree = !isStaged;

  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const isImage = IMAGE_EXTENSIONS.has(ext);
  const isBinary = BINARY_EXTENSIONS.has(ext);

  // Load original and modified contents
  useEffect(() => {
    let active = true;
    setIsLoading(true);

    const leftRev: FileRev = isStaged ? { kind: "Head" } : { kind: "Index" };
    const rightRev: FileRev = isStaged ? { kind: "Index" } : { kind: "Worktree" };

    Promise.all([
      dataSource.fileContent(filePath, leftRev),
      dataSource.fileContent(filePath, rightRev),
    ]).then(([left, right]) => {
      if (!active) return;
      setOriginalContent(left);
      setModifiedContent(right);
      setCurrentModifiedValue(right);
      setIsDirty(false);
      setIsLoading(false);
    });

    return () => {
      active = false;
    };
  }, [dataSource, filePath, isStaged]);

  const handleSave = useCallback(async () => {
    if (!isWorktree || !isDirty) return;
    await dataSource.saveFile(filePath, currentModifiedValue);
    setModifiedContent(currentModifiedValue);
    setIsDirty(false);
    await refreshStatus();
  }, [currentModifiedValue, dataSource, filePath, isDirty, isWorktree, refreshStatus]);

  const getActiveSelection = useCallback((): LineSelection | null => {
    if (!diffEditorRef.current) return null;
    const origEditor = diffEditorRef.current.getOriginalEditor();
    const modEditor = diffEditorRef.current.getModifiedEditor();

    const origSel = origEditor.getSelection();
    const modSel = modEditor.getSelection();

    if (modSel && !modSel.isEmpty()) {
      return mapMonacoSelectionToLineSelection(
        "Modified",
        modSel.startLineNumber,
        modSel.endLineNumber
      );
    }
    if (origSel && !origSel.isEmpty()) {
      return mapMonacoSelectionToLineSelection(
        "Original",
        origSel.startLineNumber,
        origSel.endLineNumber
      );
    }

    // Default to modified cursor line if any
    const pos = modEditor.getPosition();
    if (pos) {
      return mapMonacoSelectionToLineSelection("Modified", pos.lineNumber, pos.lineNumber);
    }
    return null;
  }, []);

  const handleStageSelection = useCallback(async () => {
    const sel = getActiveSelection();
    if (!sel) return;
    await dataSource.stageSelections(filePath, [sel]);
    await refreshStatus();
  }, [dataSource, filePath, getActiveSelection, refreshStatus]);

  const handleUnstageSelection = useCallback(async () => {
    const sel = getActiveSelection();
    if (!sel) return;
    await dataSource.unstageSelections(filePath, [sel]);
    await refreshStatus();
  }, [dataSource, filePath, getActiveSelection, refreshStatus]);

  const handleRevertSelection = useCallback(async () => {
    const sel = getActiveSelection();
    if (!sel) return;
    await dataSource.revertSelections(filePath, [sel]);
    await refreshStatus();
  }, [dataSource, filePath, getActiveSelection, refreshStatus]);

  const handleNextChange = useCallback(() => {
    diffEditorRef.current?.goToDiff("next");
  }, []);

  const handlePreviousChange = useCallback(() => {
    diffEditorRef.current?.goToDiff("previous");
  }, []);

  // Global shortcuts for Diff Editor
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+S: Save file
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void handleSave();
        return;
      }

      // Alt+F5: Previous change, Shift+Alt+F5: Next change
      if (e.altKey && e.key === "F5") {
        e.preventDefault();
        if (e.shiftKey) {
          handleNextChange();
        } else {
          handlePreviousChange();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNextChange, handlePreviousChange, handleSave]);

  if (isImage) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden">
        <DiffToolbar
          filePath={filePath}
          context={context}
          isDirty={false}
          canSave={false}
          onSave={() => {}}
          onStageSelection={handleStageSelection}
          onUnstageSelection={handleUnstageSelection}
          onRevertSelection={handleRevertSelection}
          onPreviousChange={handlePreviousChange}
          onNextChange={handleNextChange}
        />
        <ImageDiffView
          filePath={filePath}
          originalSrc={originalContent}
          modifiedSrc={modifiedContent}
        />
      </div>
    );
  }

  if (isBinary || (originalContent.length > 5_000_000 || modifiedContent.length > 5_000_000)) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden">
        <DiffToolbar
          filePath={filePath}
          context={context}
          isDirty={false}
          canSave={false}
          onSave={() => {}}
          onStageSelection={handleStageSelection}
          onUnstageSelection={handleUnstageSelection}
          onRevertSelection={handleRevertSelection}
          onPreviousChange={handlePreviousChange}
          onNextChange={handleNextChange}
        />
        <BinaryDiffView filePath={filePath} />
      </div>
    );
  }

  const monacoTheme = theme === "light" ? "vs" : "vs-dark";
  const language = guessLanguageByPath(filePath);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-vscode-bg">
      <DiffToolbar
        filePath={filePath}
        context={context}
        isDirty={isDirty}
        canSave={isWorktree}
        onSave={() => void handleSave()}
        onStageSelection={() => void handleStageSelection()}
        onUnstageSelection={() => void handleUnstageSelection()}
        onRevertSelection={() => void handleRevertSelection()}
        onPreviousChange={handlePreviousChange}
        onNextChange={handleNextChange}
      />

      <div className="flex-1 min-h-0 relative">
        {isLoading ? (
          <div className="flex h-full w-full items-center justify-center text-xs text-vscode-muted">
            Loading diff...
          </div>
        ) : (
          <DiffEditor
            height="100%"
            width="100%"
            language={language}
            theme={monacoTheme}
            original={originalContent}
            modified={modifiedContent}
            onMount={(editor) => {
              diffEditorRef.current = editor;
              const modEditor = editor.getModifiedEditor();
              modEditor.onDidChangeModelContent(() => {
                const val = modEditor.getValue();
                setCurrentModifiedValue(val);
                setIsDirty(val !== modifiedContent);
              });
            }}
            options={{
              renderSideBySide: diffSideBySide,
              ignoreTrimWhitespace: diffIgnoreWhitespace,
              readOnly: !isWorktree,
              originalEditable: false,
              automaticLayout: true,
              scrollBeyondLastLine: false,
              minimap: { enabled: false },
              fontSize: 12,
              renderOverviewRuler: false,
            }}
          />
        )}
      </div>
    </div>
  );
};
