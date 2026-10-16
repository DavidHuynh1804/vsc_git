import React, { useState, useEffect, useRef, useCallback } from "react";
import { Editor } from "@monaco-editor/react";
import "@/monaco/monacoLoader";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import {
  FileText,
  RefreshCw,
  GitCommit,
  History,
  ArrowLeft,
} from "lucide-react";
import { useM3Store } from "@/m3/m3Store";
import { useUIStore } from "@/stores/ui";
import { useScmStore } from "@/scm/scmStore";
import { guessLanguageByPath } from "@/monaco/language";
import { BlameLine, BlameOptions } from "@/m3/types";
import { formatRelativeDate, getCommitAgeColor } from "./blameUtils";

export interface BlameViewProps {
  filePath: string;
  initialRev?: string;
  onSelectCommitInGraph?: (sha: string) => void;
}

const LINE_HEIGHT = 19; // standard Monaco line height at 12px fontSize

export const BlameView: React.FC<BlameViewProps> = ({
  filePath,
  initialRev,
  onSelectCommitInGraph,
}) => {
  const { dataSource: m3DataSource } = useM3Store();
  const { dataSource: scmDataSource } = useScmStore();
  const { theme, openTab } = useUIStore();

  const [rev, setRev] = useState<string | undefined>(initialRev);
  const [revHistory, setRevHistory] = useState<string[]>([]);
  const [blameLines, setBlameLines] = useState<BlameLine[]>([]);
  const [fileContent, setFileContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Blame options
  const [ignoreWs, setIgnoreWs] = useState<boolean>(false);
  const [detectMoves, setDetectMoves] = useState<boolean>(false);
  const [detectCopies, setDetectCopies] = useState<boolean>(false);

  // Hover state for tooltip card
  const [hoveredLine, setHoveredLine] = useState<{
    line: BlameLine;
    x: number;
    y: number;
  } | null>(null);

  const gutterRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsCollectionRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  const loadBlame = useCallback(async () => {
    setIsLoading(true);
    try {
      const opts: BlameOptions = {
        ignore_ws: ignoreWs,
        detect_moves: detectMoves,
        detect_copies: detectCopies,
      };

      const [blameResult, contentResult] = await Promise.all([
        m3DataSource.blame(filePath, rev, opts),
        scmDataSource
          .fileContent(filePath, rev ? { kind: "Commit", sha: rev } : { kind: "Worktree" })
          .catch(() => ""),
      ]);

      setBlameLines(blameResult);

      if (contentResult) {
        setFileContent(contentResult);
      } else if (blameResult.length > 0) {
        // Fallback placeholder lines if worktree content read fails
        const placeholder = blameResult.map((b) => `// Line ${b.line_no}`).join("\n");
        setFileContent(placeholder);
      }
    } catch (err) {
      console.error("Failed to load blame:", err);
    } finally {
      setIsLoading(false);
    }
  }, [filePath, rev, ignoreWs, detectMoves, detectCopies, m3DataSource, scmDataSource]);

  useEffect(() => {
    void loadBlame();
  }, [loadBlame]);

  // Update Monaco decorations when blameLines change
  useEffect(() => {
    if (!editorRef.current || blameLines.length === 0) return;

    const decorations: monaco.editor.IModelDeltaDecoration[] = blameLines.map((b) => ({
      range: new monaco.Range(b.line_no, 1, b.line_no, 1),
      options: {
        isWholeLine: false,
        hoverMessage: {
          value: `**${b.commit.summary}**\n\n- **Author:** ${b.commit.author} <${b.commit.author_mail}>\n- **Date:** ${formatRelativeDate(b.commit.author_time)}\n- **Commit:** \`${b.commit.sha.slice(0, 7)}\``,
        },
      },
    }));

    if (decorationsCollectionRef.current) {
      decorationsCollectionRef.current.set(decorations);
    } else {
      decorationsCollectionRef.current = editorRef.current.createDecorationsCollection(decorations);
    }
  }, [blameLines]);

  const handleSelectCommit = (sha: string) => {
    if (onSelectCommitInGraph) {
      onSelectCommitInGraph(sha);
    } else {
      openTab({ id: "graph", title: "Graph", closable: false });
    }
  };

  const handleBlameBefore = (previousSha: string) => {
    if (rev) {
      setRevHistory((prev) => [...prev, rev]);
    } else {
      setRevHistory((prev) => [...prev, "HEAD"]);
    }
    setRev(previousSha);
    setHoveredLine(null);
  };

  const handleBackRev = () => {
    if (revHistory.length === 0) return;
    const nextHistory = [...revHistory];
    const lastRev = nextHistory.pop();
    setRevHistory(nextHistory);
    setRev(lastRev === "HEAD" ? undefined : lastRev);
    setHoveredLine(null);
  };

  const isLight =
    theme === "light" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      !window.matchMedia("(prefers-color-scheme: dark)").matches);
  const monacoTheme = isLight ? "vs" : "vs-dark";
  const language = guessLanguageByPath(filePath);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-vscode-bg text-vscode-fg">
      {/* Blame Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-vscode-border bg-vscode-sidebar px-3 py-1.5 text-xs select-none">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 shrink-0 text-vscode-accent" />
          <span className="font-semibold text-vscode-fg truncate">{filePath}</span>
          <span className="rounded bg-vscode-input px-1.5 py-0.5 text-[10px] font-mono text-vscode-muted">
            {rev ? rev.slice(0, 7) : "HEAD"}
          </span>

          {revHistory.length > 0 && (
            <button
              type="button"
              onClick={handleBackRev}
              title="Go back to previous revision"
              className="inline-flex items-center gap-1 rounded bg-vscode-hover px-1.5 py-0.5 text-[10px] text-vscode-fg hover:bg-vscode-active"
            >
              <ArrowLeft className="h-3 w-3" />
              <span>Back</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Options checkboxes: -w, -M, -C */}
          <div className="flex items-center gap-2 text-vscode-muted text-[11px]">
            <label className="flex items-center gap-1 cursor-pointer hover:text-vscode-fg">
              <input
                type="checkbox"
                checked={ignoreWs}
                onChange={(e) => setIgnoreWs(e.target.checked)}
                className="rounded border-vscode-border"
              />
              <span title="Ignore whitespace (-w)">-w</span>
            </label>

            <label className="flex items-center gap-1 cursor-pointer hover:text-vscode-fg">
              <input
                type="checkbox"
                checked={detectMoves}
                onChange={(e) => setDetectMoves(e.target.checked)}
                className="rounded border-vscode-border"
              />
              <span title="Detect moves (-M)">-M</span>
            </label>

            <label className="flex items-center gap-1 cursor-pointer hover:text-vscode-fg">
              <input
                type="checkbox"
                checked={detectCopies}
                onChange={(e) => setDetectCopies(e.target.checked)}
                className="rounded border-vscode-border"
              />
              <span title="Detect copies (-C)">-C</span>
            </label>
          </div>

          <button
            type="button"
            onClick={() => void loadBlame()}
            title="Refresh blame"
            aria-label="Refresh blame"
            className="rounded p-1 text-vscode-muted hover:bg-vscode-hover hover:text-vscode-fg transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Main Blame Area: Gutter + Monaco Editor */}
      <div className="flex flex-1 overflow-hidden min-h-0 relative">
        {/* Left Synchronized Blame Gutter */}
        <div
          ref={gutterRef}
          className="flex flex-col border-r border-vscode-border bg-vscode-sidebar/40 overflow-hidden select-none font-mono text-[11px] w-[260px] shrink-0"
        >
          {blameLines.map((line) => {
            const ageColor = getCommitAgeColor(line.commit.author_time);
            const relativeDate = formatRelativeDate(line.commit.author_time);

            return (
              <div
                key={line.line_no}
                style={{ height: `${LINE_HEIGHT}px`, minHeight: `${LINE_HEIGHT}px` }}
                onClick={() => handleSelectCommit(line.commit.sha)}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHoveredLine({
                    line,
                    x: rect.right + 8,
                    y: Math.min(rect.top, window.innerHeight - 180),
                  });
                }}
                onMouseLeave={() => setHoveredLine(null)}
                className="group relative flex items-center justify-between px-2 cursor-pointer border-b border-transparent hover:bg-vscode-hover hover:border-vscode-border/30 transition-colors"
              >
                {/* Age color indicator bar */}
                <div
                  style={{ backgroundColor: ageColor }}
                  className="absolute left-0 top-0 bottom-0 w-1"
                />

                <div className="flex items-center gap-1.5 pl-1.5 overflow-hidden">
                  <span className="truncate text-vscode-fg font-medium max-w-[110px]" title={line.commit.author}>
                    {line.commit.author}
                  </span>
                  <span className="text-[10px] text-vscode-muted shrink-0">
                    {relativeDate}
                  </span>
                </div>

                <span className="text-[10px] text-vscode-muted/70 group-hover:text-vscode-accent shrink-0">
                  {line.commit.sha.slice(0, 7)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Monaco Code Editor */}
        <div className="flex-1 min-w-0 h-full relative">
          <Editor
            height="100%"
            width="100%"
            language={language}
            theme={monacoTheme}
            value={fileContent}
            onMount={(editor) => {
              editorRef.current = editor;
              editor.onDidScrollChange((e) => {
                if (gutterRef.current) {
                  gutterRef.current.scrollTop = e.scrollTop;
                }
              });
            }}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 12,
              lineHeight: LINE_HEIGHT,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        </div>

        {/* Hover commit summary tooltip card */}
        {hoveredLine && (
          <div
            style={{
              position: "fixed",
              left: `${hoveredLine.x}px`,
              top: `${hoveredLine.y}px`,
              zIndex: 100,
            }}
            className="w-72 rounded-md border border-vscode-border bg-vscode-sidebar p-3 shadow-2xl text-xs flex flex-col gap-2 pointer-events-auto"
            onMouseEnter={() => {}}
            onMouseLeave={() => setHoveredLine(null)}
          >
            <div className="flex items-start justify-between gap-1">
              <span className="font-semibold text-vscode-fg line-clamp-2">
                {hoveredLine.line.commit.summary}
              </span>
              <span className="rounded bg-vscode-input px-1 py-0.2 text-[10px] font-mono text-vscode-muted shrink-0">
                {hoveredLine.line.commit.sha.slice(0, 7)}
              </span>
            </div>

            <div className="flex flex-col text-[11px] text-vscode-muted gap-0.5">
              <span>
                <strong>Author:</strong> {hoveredLine.line.commit.author} ({hoveredLine.line.commit.author_mail})
              </span>
              <span>
                <strong>Date:</strong> {formatRelativeDate(hoveredLine.line.commit.author_time)}
              </span>
            </div>

            <div className="flex items-center gap-1.5 pt-1 border-t border-vscode-border">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelectCommit(hoveredLine.line.commit.sha);
                }}
                className="flex-1 inline-flex items-center justify-center gap-1 rounded bg-vscode-input hover:bg-vscode-hover px-2 py-1 text-[11px] text-vscode-fg transition-colors"
              >
                <GitCommit className="h-3 w-3" />
                <span>Show in Graph</span>
              </button>

              {hoveredLine.line.commit.previous && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (hoveredLine.line.commit.previous) {
                      handleBlameBefore(hoveredLine.line.commit.previous);
                    }
                  }}
                  title="Blame prior to this commit"
                  className="flex-1 inline-flex items-center justify-center gap-1 rounded bg-vscode-input hover:bg-vscode-hover px-2 py-1 text-[11px] text-vscode-fg transition-colors"
                >
                  <History className="h-3 w-3" />
                  <span>Blame Prior</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
