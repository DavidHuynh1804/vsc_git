import React, { useState, useEffect, useCallback } from "react";
import { DiffEditor } from "@monaco-editor/react";
import "@/monaco/monacoLoader";
import {
  History,
  GitCommit,
  RefreshCw,
  GitFork,
  ArrowRight,
  FileCode,
} from "lucide-react";
import { useM3Store } from "@/m3/m3Store";
import { useScmStore } from "@/scm/scmStore";
import { useUIStore } from "@/stores/ui";
import { FileHistoryEntry } from "@/m3/types";
import { guessLanguageByPath } from "@/monaco/language";
import { formatRelativeDate } from "@/views/Blame/blameUtils";

export interface FileHistoryViewProps {
  filePath: string;
}

export const FileHistoryView: React.FC<FileHistoryViewProps> = ({ filePath }) => {
  const { dataSource: m3DataSource } = useM3Store();
  const { dataSource: scmDataSource } = useScmStore();
  const { theme } = useUIStore();

  const [entries, setEntries] = useState<FileHistoryEntry[]>([]);
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [parentContent, setParentContent] = useState<string>("");
  const [commitContent, setCommitContent] = useState<string>("");
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(true);
  const [isLoadingDiff, setIsLoadingDiff] = useState<boolean>(false);

  const loadHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const list = await m3DataSource.fileHistory(filePath);
      setEntries(list);
      if (list.length > 0 && !selectedSha) {
        setSelectedSha(list[0].sha);
      }
    } catch (err) {
      console.error("Failed to load file history:", err);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [filePath, m3DataSource, selectedSha]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const selectedEntry = entries.find((e) => e.sha === selectedSha) ?? entries[0];

  // Load diff when selected entry changes
  useEffect(() => {
    if (!selectedEntry) return;

    let active = true;
    setIsLoadingDiff(true);

    const parentSha = selectedEntry.parents[0];
    const pathAtCommit = selectedEntry.path_at_commit || filePath;

    const fetchParent = parentSha
      ? scmDataSource
          .fileContent(pathAtCommit, { kind: "Commit", sha: parentSha })
          .catch(() => "")
      : Promise.resolve("");

    const fetchCurrent = scmDataSource
      .fileContent(pathAtCommit, { kind: "Commit", sha: selectedEntry.sha })
      .catch(() => "");

    Promise.all([fetchParent, fetchCurrent])
      .then(([left, right]) => {
        if (!active) return;
        setParentContent(left);
        setCommitContent(right);
      })
      .catch((err) => {
        console.error("Failed to load commit diff:", err);
      })
      .finally(() => {
        if (active) {
          setIsLoadingDiff(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedEntry, filePath, scmDataSource]);

  const monacoTheme = theme === "light" ? "vs" : "vs-dark";
  const language = guessLanguageByPath(filePath);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-vscode-bg text-vscode-fg">
      {/* Header Toolbar */}
      <div className="flex items-center justify-between border-b border-vscode-border bg-vscode-sidebar px-3 py-1.5 text-xs select-none">
        <div className="flex items-center gap-2 min-w-0">
          <History className="h-4 w-4 shrink-0 text-vscode-accent" />
          <span className="font-semibold text-vscode-fg truncate">History: {filePath}</span>
          <span className="rounded bg-vscode-input px-1.5 py-0.5 text-[10px] text-vscode-muted font-mono">
            {entries.length} commit{entries.length === 1 ? "" : "s"}
          </span>
        </div>

        <button
          type="button"
          onClick={() => void loadHistory()}
          title="Refresh history"
          className="rounded p-1 text-vscode-muted hover:bg-vscode-hover hover:text-vscode-fg"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoadingHistory ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Main Split Area: Left commit list with mini-graph, Right Monaco Diff */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left: Commit list with mini graph */}
        <div className="flex w-96 flex-col border-r border-vscode-border bg-vscode-sidebar/20 overflow-y-auto select-none shrink-0">
          {isLoadingHistory ? (
            <div className="p-4 text-xs text-vscode-muted">Loading file history...</div>
          ) : entries.length === 0 ? (
            <div className="p-4 text-xs text-vscode-muted">No history found for this file.</div>
          ) : (
            <div className="flex flex-col py-1">
              {entries.map((entry, idx) => {
                const isSelected = entry.sha === selectedSha;
                const isRename =
                  entry.status.startsWith("R") ||
                  (entry.path_at_commit && entry.path_at_commit !== filePath);

                return (
                  <div
                    key={entry.sha}
                    onClick={() => setSelectedSha(entry.sha)}
                    className={`relative flex items-start gap-2.5 px-3 py-2 text-xs cursor-pointer border-l-2 transition-colors ${
                      isSelected
                        ? "bg-vscode-active border-l-vscode-accent text-vscode-fg"
                        : "border-l-transparent text-vscode-muted hover:bg-vscode-hover hover:text-vscode-fg"
                    }`}
                  >
                    {/* Mini graph vertical node & line */}
                    <div className="relative flex flex-col items-center shrink-0 w-3 pt-0.5">
                      <div
                        className={`h-2.5 w-2.5 rounded-full border ${
                          isSelected
                            ? "bg-vscode-accent border-vscode-accent"
                            : "bg-vscode-bg border-vscode-border"
                        }`}
                      />
                      {idx < entries.length - 1 && (
                        <div className="w-[1.5px] h-8 bg-vscode-border mt-0.5" />
                      )}
                    </div>

                    {/* Entry details */}
                    <div className="flex flex-1 flex-col min-w-0 gap-0.5">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-medium text-vscode-fg truncate line-clamp-1">
                          {entry.subject}
                        </span>
                        <span className="rounded bg-vscode-input px-1 py-0.2 text-[10px] font-mono shrink-0">
                          {entry.sha.slice(0, 7)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-vscode-muted">
                        <span className="truncate max-w-[140px]">{entry.author}</span>
                        <span>{formatRelativeDate(entry.time)}</span>
                      </div>

                      {/* Rename info badge */}
                      {isRename && (
                        <div className="flex items-center gap-1 text-[10px] text-amber-400 mt-0.5">
                          <GitFork className="h-3 w-3 shrink-0" />
                          <span className="truncate font-mono">
                            Renamed: {entry.path_at_commit}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Monaco Diff Viewer */}
        <div className="flex flex-1 flex-col min-w-0 h-full overflow-hidden">
          {selectedEntry ? (
            <>
              {/* Diff Context Sub-Header */}
              <div className="flex items-center justify-between border-b border-vscode-border bg-vscode-activity px-3 py-1 text-xs select-none">
                <div className="flex items-center gap-2">
                  <FileCode className="h-3.5 w-3.5 text-vscode-accent" />
                  <span className="font-medium text-vscode-fg">
                    Diff at commit: {selectedEntry.sha.slice(0, 7)}
                  </span>
                  {selectedEntry.parents[0] && (
                    <span className="text-vscode-muted flex items-center gap-1">
                      <span>({selectedEntry.parents[0].slice(0, 7)}</span>
                      <ArrowRight className="h-3 w-3" />
                      <span>{selectedEntry.sha.slice(0, 7)})</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 text-[11px] text-vscode-muted">
                  <GitCommit className="h-3 w-3" />
                  <span>{selectedEntry.subject}</span>
                </div>
              </div>

              {/* Monaco Diff Editor */}
              <div className="flex-1 min-h-0 relative">
                {isLoadingDiff ? (
                  <div className="flex h-full w-full items-center justify-center text-xs text-vscode-muted">
                    Loading diff...
                  </div>
                ) : (
                  <DiffEditor
                    height="100%"
                    width="100%"
                    language={language}
                    theme={monacoTheme}
                    original={parentContent}
                    modified={commitContent}
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      fontSize: 12,
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                    }}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-vscode-muted">
              Select a commit from the history list to view changes
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
