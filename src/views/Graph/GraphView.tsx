import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  ColumnDefinition,
  CommitDetail,
  CommitSummary,
  DateDisplayFormat,
  FileChange,
  GraphAction,
  GraphFilter,
  GraphRow,
} from "@/graph/types";
import { type GraphDataSource, MockGraphDataSource, TauriGraphDataSource } from "@/graph/dataSource";
import { isMock } from "@/env";
import { events } from "@/bindings";
import { ROW_HEIGHT } from "@/graph/geometry";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { RefsBadge } from "@/components/graph/RefsBadge";
import { GraphToolbar } from "@/components/graph/GraphToolbar";
import { CommitDetailPanel } from "@/components/graph/CommitDetailPanel";
import { ComparePanel } from "@/components/graph/ComparePanel";
import {
  GraphContextMenu,
  type ContextMenuTarget,
} from "@/components/graph/GraphContextMenu";
import { ConfirmDialog } from "@/components/graph/ConfirmDialog";
import { OperationBanner } from "@/components/OperationBanner";
import { useUIStore } from "@/stores/ui";
import { Sparkles } from "lucide-react";

interface GraphViewProps {
  dataSource?: GraphDataSource;
  onOpenDiff?: (leftSha: string, rightSha: string, path: string) => void;
  onAction?: (action: GraphAction) => void;
}

const DEFAULT_COLUMNS: ColumnDefinition[] = [
  { id: "graph", label: "Graph", width: 140, minWidth: 80, visible: true },
  { id: "refs", label: "Refs", width: 160, minWidth: 60, visible: true },
  { id: "message", label: "Message", width: 380, minWidth: 140, visible: true },
  { id: "author", label: "Author", width: 150, minWidth: 80, visible: true },
  { id: "date", label: "Date", width: 110, minWidth: 70, visible: true },
  { id: "sha", label: "SHA", width: 75, minWidth: 55, visible: true },
];

const STORAGE_KEY = "vsc_git_graph_columns";

function loadSavedColumns(): ColumnDefinition[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_COLUMNS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === DEFAULT_COLUMNS.length) {
      return parsed;
    }
  } catch {
    // localStorage error or corrupted data -> fallback to defaults
  }
  return DEFAULT_COLUMNS;
}

function saveColumns(cols: ColumnDefinition[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cols));
  } catch {
    // ignore localStorage quota/disabled errors
  }
}

function formatRelativeTime(seconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - seconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}mo ago`;
  return `${Math.floor(diff / 31536000)}y ago`;
}

function getInitials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return text;

  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-500/30 text-yellow-200 px-0.5 rounded">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export const GraphView: React.FC<GraphViewProps> = ({
  dataSource: propDataSource,
  onOpenDiff,
  onAction,
}) => {
  const { setActiveActivity, openTab, selectedGraphSha, setSelectedGraphSha } = useUIStore();

  const [activeDataSource] = useState<GraphDataSource>(
    () => propDataSource ?? (isMock() ? new MockGraphDataSource(200000) : new TauriGraphDataSource())
  );

  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [rows, setRows] = useState<GraphRow[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Column definitions with localStorage persistence
  const [columns, setColumns] = useState<ColumnDefinition[]>(loadSavedColumns);

  // Selection & Details panel
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailHeight, setDetailHeight] = useState(260);

  // Compare mode (selected A and B)
  const [compareCommits, setCompareCommits] = useState<{
    a: CommitSummary;
    b: CommitSummary;
  } | null>(null);
  const [compareChanges, setCompareChanges] = useState<FileChange[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [matchCursor, setMatchCursor] = useState(0);
  const [dateFormat, setDateFormat] = useState<DateDisplayFormat>("relative");
  const [filter, setFilter] = useState<GraphFilter>({
    refs: "All",
    include_remotes: true,
    include_tags: true,
    include_stash: true,
    first_parent_only: false,
  });

  // Context Menu & Confirmation
  const [contextTarget, setContextTarget] = useState<ContextMenuTarget | null>(
    null
  );
  const [pendingDangerousAction, setPendingDangerousAction] =
    useState<GraphAction | null>(null);

  const parentRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  // Resizing columns
  const resizingColumnRef = useRef<{ id: string; startX: number; startWidth: number } | null>(null);

  // Check dirty state on mount
  useEffect(() => {
    activeDataSource.isDirty?.().then((dirty: boolean) => {
      setIsDirty(Boolean(dirty));
    });
  }, [activeDataSource]);

  // Anchor SHA to preserve scroll position on reset/filter-change
  const pendingRestoreShaRef = useRef<string | null>(null);
  const scrollTopRef = useRef(0);
  const commitsRef = useRef<CommitSummary[]>([]);
  const isDirtyRef = useRef(false);
  useEffect(() => {
    commitsRef.current = commits;
  }, [commits]);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  // Load initial page of commits
  const loadInitialPage = useCallback(async () => {
    // Capture the topmost visible commit SHA so we can restore scroll after reset
    const allCommits = commitsRef.current;
    const topRowIndex = Math.floor(scrollTopRef.current / ROW_HEIGHT);
    const anchor =
      allCommits[isDirtyRef.current ? topRowIndex - 1 : topRowIndex] ??
      allCommits[0];
    pendingRestoreShaRef.current = anchor?.sha ?? null;

    setLoading(true);
    try {
      await activeDataSource.reset(filter);
      const page = await activeDataSource.page(500);
      setCommits(page.commits);
      setRows(page.rows);
      setHasMore(page.has_more);
    } finally {
      setLoading(false);
    }
  }, [activeDataSource, filter]);

  useEffect(() => {
    loadInitialPage();
  }, [loadInitialPage]);

  // After the refreshed page lands, restore scroll to the anchor SHA if still present
  useEffect(() => {
    const anchorSha = pendingRestoreShaRef.current;
    if (!anchorSha) return;

    const idx = rows.findIndex((r) => r.sha === anchorSha);
    if (idx !== -1) {
      virtualizer.scrollToIndex(isDirty ? idx + 1 : idx, { align: "start" });
    }
    pendingRestoreShaRef.current = null;
  }, [rows]);

  // Load next page on scroll near bottom
  const loadNextPage = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const page = await activeDataSource.page(500);
      setCommits((prev) => [...prev, ...page.commits]);
      setRows((prev) => [...prev, ...page.rows]);
      setHasMore(page.has_more);
    } finally {
      setLoadingMore(false);
    }
  }, [activeDataSource, hasMore, loadingMore]);

  // Virtualizer setup
  const totalItemsCount = commits.length + (isDirty ? 1 : 0);

  const virtualizer = useVirtualizer({
    count: totalItemsCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Scroll listener for infinite pagination & canvas redraw
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    scrollTopRef.current = target.scrollTop;
    setScrollTop(target.scrollTop);

    const distanceToBottom =
      target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom < 600 && hasMore && !loadingMore) {
      loadNextPage();
    }
  };

  // Search matching indices
  const matchingIndices = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const indices: number[] = [];
    for (let i = 0; i < commits.length; i++) {
      const c = commits[i];
      if (
        c.subject.toLowerCase().includes(q) ||
        c.author_name.toLowerCase().includes(q) ||
        c.sha.toLowerCase().includes(q) ||
        c.short_sha.toLowerCase().includes(q)
      ) {
        indices.push(isDirty ? i + 1 : i);
      }
    }
    return indices;
  }, [commits, searchQuery, isDirty]);

  const jumpToMatch = (index: number) => {
    if (matchingIndices.length === 0) return;
    const targetRowIndex = matchingIndices[index];
    setMatchCursor(index);
    virtualizer.scrollToIndex(targetRowIndex, { align: "center" });
  };

  const handleNextMatch = () => {
    if (matchingIndices.length === 0) return;
    const next = (matchCursor + 1) % matchingIndices.length;
    jumpToMatch(next);
  };

  const handlePrevMatch = () => {
    if (matchingIndices.length === 0) return;
    const prev = (matchCursor - 1 + matchingIndices.length) % matchingIndices.length;
    jumpToMatch(prev);
  };

  // Select commit or toggle compare mode
  const handleRowClick = async (
    e: React.MouseEvent,
    commit: CommitSummary
  ) => {
    if (e.metaKey || e.ctrlKey) {
      // Cmd/Ctrl click: compare mode
      if (selectedSha && selectedSha !== commit.sha) {
        const commitA = commits.find((c) => c.sha === selectedSha) ?? commit;
        const commitB = commit;
        setCompareCommits({ a: commitA, b: commitB });
        setCompareLoading(true);
        try {
          const changes = await activeDataSource.compare(commitA.sha, commitB.sha);
          setCompareChanges(changes);
        } finally {
          setCompareLoading(false);
        }
        return;
      }
    }

    // Single click: show commit details
    setCompareCommits(null);
    setSelectedSha(commit.sha);
    setDetailLoading(true);
    try {
      const d = await activeDataSource.detail(commit.sha);
      setDetail(d);
    } finally {
      setDetailLoading(false);
    }
  };

  // Jump to commit by SHA (e.g. from parent click or reset)
  const jumpToSha = (sha: string): boolean => {
    const idx = commits.findIndex((c) => c.sha === sha);
    if (idx !== -1) {
      const targetIndex = isDirty ? idx + 1 : idx;
      virtualizer.scrollToIndex(targetIndex, { align: "center" });
      setSelectedSha(sha);
      activeDataSource.detail(sha).then(setDetail);
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (selectedGraphSha) {
      const found = jumpToSha(selectedGraphSha);
      if (found) {
        setSelectedGraphSha(null);
      }
    }
  }, [selectedGraphSha, commits]);

  // Subscribe to external repo watcher changes
  useEffect(() => {
    if (isMock()) return;
    let active = true;
    const unlistenRefsPromise = events.repoRefsChanged.listen(() => {
      if (active) {
        void loadInitialPage();
      }
    });
    const unlistenStatusPromise = events.repoStatusChanged.listen(() => {
      if (active) {
        activeDataSource.isDirty?.().then((dirty: boolean) => {
          if (active) setIsDirty(Boolean(dirty));
        });
      }
    });
    return () => {
      active = false;
      unlistenRefsPromise.then((u) => u());
      unlistenStatusPromise.then((u) => u());
    };
  }, [activeDataSource, loadInitialPage]);

  // Go to HEAD
  const handleGoToHead = () => {
    const headIdx = commits.findIndex((c) =>
      c.refs.some((r) => r.kind === "Head")
    );
    const targetIdx = headIdx !== -1 ? (isDirty ? headIdx + 1 : headIdx) : 0;
    virtualizer.scrollToIndex(targetIdx, { align: "start" });
  };

  // Column resizing handlers
  const handleColumnResizeStart = (e: React.MouseEvent, colId: string) => {
    e.preventDefault();
    const col = columns.find((c) => c.id === colId);
    if (!col) return;

    resizingColumnRef.current = {
      id: colId,
      startX: e.clientX,
      startWidth: col.width,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizingColumnRef.current) return;
      const { id, startX, startWidth } = resizingColumnRef.current;
      const diff = moveEvent.clientX - startX;
      setColumns((prev) => {
        const updated = prev.map((c) => {
          if (c.id === id) {
            return {
              ...c,
              width: Math.max(c.minWidth, startWidth + diff),
            };
          }
          return c;
        });
        saveColumns(updated);
        return updated;
      });
    };

    const handleMouseUp = () => {
      resizingColumnRef.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Action dispatcher
  const handleAction = (action: GraphAction) => {
    if (action.danger) {
      setPendingDangerousAction(action);
      return;
    }
    onAction?.(action);
  };

  const handleOpenDiffFallback = (
    left: string,
    right: string,
    path: string
  ) => {
    if (onOpenDiff) {
      onOpenDiff(left, right, path);
    } else {
      openTab({
        id: `diff-${left.slice(0, 7)}-${right.slice(0, 7)}-${path}`,
        title: `diff: ${path.split("/").pop()}`,
        closable: true,
      });
    }
  };

  const graphColWidth =
    columns.find((c) => c.id === "graph" && c.visible)?.width ?? 140;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-vscode-bg text-vscode-fg select-none">
      {/* Top Toolbar */}
      <GraphToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onNextMatch={handleNextMatch}
        onPrevMatch={handlePrevMatch}
        matchIndex={matchCursor}
        matchCount={matchingIndices.length}
        filter={filter}
        onFilterChange={(f) => {
          setFilter(f);
        }}
        dateFormat={dateFormat}
        onDateFormatToggle={() =>
          setDateFormat((prev) => (prev === "relative" ? "absolute" : "relative"))
        }
        onGoToHead={handleGoToHead}
        onRefresh={loadInitialPage}
        isRefreshing={loading}
        columns={columns}
        onToggleColumn={(id) => {
          setColumns((prev) => {
            const updated = prev.map((c) =>
              c.id === id ? { ...c, visible: !c.visible } : c
            );
            saveColumns(updated);
            return updated;
          });
        }}
      />
      {/* In-progress operation banner */}
      <OperationBanner />


      {/* Main Table Area */}
      <div className="flex flex-1 flex-col overflow-hidden min-h-0 relative">
        {/* Table Header */}
        <div className="flex h-7 w-full items-center border-b border-vscode-border bg-vscode-sidebar text-[11px] font-semibold text-vscode-muted select-none">
          {columns
            .filter((c) => c.visible)
            .map((col) => (
              <div
                key={col.id}
                style={{ width: `${col.width}px` }}
                className="relative flex h-full items-center px-2 flex-shrink-0 border-r border-vscode-border"
              >
                <span className="truncate">{col.label}</span>
                <div
                  onMouseDown={(e) => handleColumnResizeStart(e, col.id)}
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-vscode-accent"
                />
              </div>
            ))}
        </div>

        {/* Scrollable virtual container */}
        <div
          ref={parentRef}
          onScroll={handleScroll}
          className="flex-1 overflow-auto relative min-h-0 bg-vscode-bg"
        >
          {/* Canvas overlay over graph column */}
          <GraphCanvas
            rows={rows}
            commits={commits}
            virtualItems={virtualItems}
            scrollTop={scrollTop}
            width={graphColWidth}
            height={parentRef.current?.clientHeight ?? 800}
            hasDirtyRow={isDirty}
          />

          {/* Virtualizer space container */}
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualItems.map((virtualRow) => {
              const itemIndex = virtualRow.index;

              // Uncommitted changes row
              if (isDirty && itemIndex === 0) {
                return (
                  <div
                    key="uncommitted-changes"
                    onClick={() => setActiveActivity("changes")}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${ROW_HEIGHT}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className="flex items-center text-xs text-vscode-muted hover:bg-vscode-hover hover:text-vscode-fg cursor-pointer border-b border-vscode-border/50"
                  >
                    <div style={{ width: `${graphColWidth}px` }} className="flex-shrink-0" />
                    <div className="flex items-center gap-2 px-2 text-warning font-medium">
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Uncommitted changes</span>
                      <span className="text-[10px] text-vscode-muted">(click to view working tree)</span>
                    </div>
                  </div>
                );
              }

              const commitIndex = isDirty ? itemIndex - 1 : itemIndex;
              const commit = commits[commitIndex];
              if (!commit) return null;

              const isSelected = selectedSha === commit.sha;
              const isCompareA = compareCommits?.a.sha === commit.sha;
              const isCompareB = compareCommits?.b.sha === commit.sha;
              const isHighlighted = matchingIndices.includes(itemIndex);

              return (
                <div
                  key={commit.sha}
                  data-index={virtualRow.index}
                  data-sha={commit.sha}
                  onClick={(e) => handleRowClick(e, commit)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextTarget({
                      type: "commit",
                      commit,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${ROW_HEIGHT}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className={`flex items-center text-xs cursor-pointer border-b border-vscode-border/30 transition-colors ${
                    isCompareA || isCompareB
                      ? "bg-purple-900/30 text-white font-medium"
                      : isSelected
                        ? "bg-vscode-accent/25 text-white font-medium"
                        : isHighlighted
                          ? "bg-yellow-500/10 text-vscode-fg"
                          : "text-vscode-fg hover:bg-vscode-hover"
                  }`}
                >
                  {columns
                    .filter((c) => c.visible)
                    .map((col) => {
                      if (col.id === "graph") {
                        return (
                          <div
                            key={col.id}
                            style={{ width: `${col.width}px` }}
                            className="flex-shrink-0 h-full"
                          />
                        );
                      }

                      if (col.id === "refs") {
                        return (
                          <div
                            key={col.id}
                            style={{ width: `${col.width}px` }}
                            className="flex-shrink-0 px-1 overflow-hidden"
                          >
                            <RefsBadge
                              refs={commit.refs}
                              onContextMenu={(e, ref) => {
                                setContextTarget({
                                  type: "ref",
                                  refLabel: ref,
                                  x: e.clientX,
                                  y: e.clientY,
                                });
                              }}
                            />
                          </div>
                        );
                      }

                      if (col.id === "message") {
                        return (
                          <div
                            key={col.id}
                            style={{ width: `${col.width}px` }}
                            className="flex-shrink-0 px-2 truncate leading-tight"
                            title={commit.subject}
                          >
                            {highlightText(commit.subject, searchQuery)}
                          </div>
                        );
                      }

                      if (col.id === "author") {
                        return (
                          <div
                            key={col.id}
                            style={{ width: `${col.width}px` }}
                            className="flex-shrink-0 flex items-center gap-1.5 px-2 overflow-hidden"
                            title={`${commit.author_name} <${commit.author_email}>`}
                          >
                            <div className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-vscode-input text-[8px] font-bold text-vscode-accent">
                              {getInitials(commit.author_name)}
                            </div>
                            <span className="truncate text-vscode-fg text-[11px]">
                              {highlightText(commit.author_name, searchQuery)}
                            </span>
                          </div>
                        );
                      }

                      if (col.id === "date") {
                        const dateStr =
                          dateFormat === "relative"
                            ? formatRelativeTime(commit.author_time)
                            : new Date(commit.author_time * 1000).toLocaleDateString();

                        return (
                          <div
                            key={col.id}
                            style={{ width: `${col.width}px` }}
                            className="flex-shrink-0 px-2 text-[11px] font-mono tabular-nums text-vscode-muted truncate"
                            title={new Date(commit.author_time * 1000).toLocaleString()}
                          >
                            {dateStr}
                          </div>
                        );
                      }

                      if (col.id === "sha") {
                        return (
                          <div
                            key={col.id}
                            style={{ width: `${col.width}px` }}
                            className="flex-shrink-0 px-2 font-mono text-[11px] text-vscode-muted-high font-medium truncate"
                          >
                            {highlightText(commit.short_sha, searchQuery)}
                          </div>
                        );
                      }

                      return null;
                    })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Compare Panel when 2 commits selected */}
      {compareCommits && (
        <ComparePanel
          commitA={compareCommits.a}
          commitB={compareCommits.b}
          changes={compareChanges}
          loading={compareLoading}
          height={detailHeight}
          onHeightChange={setDetailHeight}
          onSwap={() => {
            setCompareCommits({ a: compareCommits.b, b: compareCommits.a });
            activeDataSource.compare(compareCommits.b.sha, compareCommits.a.sha).then(setCompareChanges);
          }}
          onClose={() => setCompareCommits(null)}
          onOpenDiff={handleOpenDiffFallback}
        />
      )}

      {/* Commit Detail Panel when 1 commit selected and not comparing */}
      {!compareCommits && selectedSha && (
        <CommitDetailPanel
          detail={detail}
          loading={detailLoading}
          height={detailHeight}
          onHeightChange={setDetailHeight}
          onClose={() => setSelectedSha(null)}
          onSelectCommit={jumpToSha}
          onOpenDiff={handleOpenDiffFallback}
        />
      )}

      {/* Context Menu */}
      <GraphContextMenu
        target={contextTarget}
        onClose={() => setContextTarget(null)}
        onAction={handleAction}
      />

      {/* Dangerous Action Confirm Dialog */}
      {pendingDangerousAction && (
        <ConfirmDialog
          isOpen={true}
          title={pendingDangerousAction.type.toUpperCase()}
          message="Are you sure you want to proceed with this destructive operation?"
          gitCommand={pendingDangerousAction.gitCommand}
          twoStepConfirm={pendingDangerousAction.twoStepConfirm}
          onConfirm={() => {
            onAction?.(pendingDangerousAction);
            setPendingDangerousAction(null);
          }}
          onCancel={() => setPendingDangerousAction(null)}
        />
      )}
    </div>
  );
};
