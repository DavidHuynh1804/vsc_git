import React, { useEffect, useRef, useState } from "react";
import type { ColumnDefinition, DateDisplayFormat, GraphFilter } from "@/graph/types";
import {
  Search,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Crosshair,
  Settings2,
  CloudDownload,
  X,
  Check,
} from "lucide-react";

/**
 * Toolbar laid out like the VS Code "Git Graph" extension: a centered
 * "Branches: [Show All]" picker and "Show Remote Branches" checkbox, with
 * find / go to HEAD / settings / fetch / refresh icon buttons on the right.
 */

interface GraphToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onNextMatch: () => void;
  onPrevMatch: () => void;
  matchIndex: number;
  matchCount: number;
  filter: GraphFilter;
  onFilterChange: (newFilter: GraphFilter) => void;
  availableBranches?: string[];
  dateFormat: DateDisplayFormat;
  onDateFormatToggle: () => void;
  onGoToHead: () => void;
  onRefresh: () => void;
  onFetch?: () => void;
  isRefreshing?: boolean;
  columns: ColumnDefinition[];
  onToggleColumn: (id: string) => void;
}

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, close]);
  return ref;
}

const iconButton =
  "flex h-6 w-6 items-center justify-center rounded text-vscode-muted hover:text-vscode-fg hover:bg-vscode-hover";

export const GraphToolbar: React.FC<GraphToolbarProps> = ({
  searchQuery,
  onSearchChange,
  onNextMatch,
  onPrevMatch,
  matchIndex,
  matchCount,
  filter,
  onFilterChange,
  availableBranches = [],
  dateFormat,
  onDateFormatToggle,
  onGoToHead,
  onRefresh,
  onFetch,
  isRefreshing = false,
  columns,
  onToggleColumn,
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [isBranchMenuOpen, setIsBranchMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const branchMenuRef = useOutsideClose(isBranchMenuOpen, () => setIsBranchMenuOpen(false));
  const settingsRef = useOutsideClose(isSettingsOpen, () => setIsSettingsOpen(false));

  const openFind = () => {
    setIsFindOpen(true);
    setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 0);
  };

  const closeFind = () => {
    setIsFindOpen(false);
    onSearchChange("");
  };

  // '/' or Cmd/Ctrl+F opens the find widget
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      const isFind = (e.key === "/" && !e.metaKey && !e.ctrlKey) || ((e.metaKey || e.ctrlKey) && e.key === "f");
      if (isFind) {
        e.preventDefault();
        openFind();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onPrevMatch();
      else onNextMatch();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeFind();
    }
  };

  const selected = typeof filter.refs === "object" && "Selected" in filter.refs ? filter.refs.Selected : null;
  const branchLabel = !selected
    ? "Show All"
    : selected.length === 1
      ? selected[0]
      : `${selected.length} branches`;

  const toggleBranchSelection = (branchName: string) => {
    const current = selected ? [...selected] : [];
    const idx = current.indexOf(branchName);
    if (idx !== -1) current.splice(idx, 1);
    else current.push(branchName);
    onFilterChange({ ...filter, refs: current.length === 0 ? "All" : { Selected: current } });
  };

  const toggle = (key: "include_remotes" | "include_tags" | "include_stash" | "first_parent_only") =>
    onFilterChange({ ...filter, [key]: !filter[key] });

  return (
    <div className="relative flex h-9 w-full items-center border-b border-vscode-border bg-vscode-bg px-3 text-xs select-none">
      <div className="flex flex-1 items-center justify-center gap-5">
        {/* Branches picker */}
        <div className="flex items-center gap-2">
          <span className="font-semibold text-vscode-fg">Branches:</span>
          <div className="relative" ref={branchMenuRef}>
            <button
              type="button"
              aria-label="Branches"
              aria-haspopup="listbox"
              aria-expanded={isBranchMenuOpen}
              onClick={() => setIsBranchMenuOpen(!isBranchMenuOpen)}
              className="flex h-6 w-64 items-center justify-between rounded border border-vscode-border bg-vscode-input px-2 text-xs text-vscode-fg hover:border-vscode-accent"
            >
              <span className="truncate">{branchLabel}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-vscode-muted" />
            </button>

            {isBranchMenuOpen && (
              <div
                role="listbox"
                aria-label="Branch filter"
                aria-multiselectable="true"
                className="absolute left-0 top-7 z-50 flex w-64 flex-col rounded border border-vscode-border bg-vscode-sidebar py-1 shadow-xl max-h-80 overflow-y-auto"
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={!selected}
                  onClick={() => onFilterChange({ ...filter, refs: "All" })}
                  className="flex items-center gap-2 px-2 py-1 text-left text-xs hover:bg-vscode-hover"
                >
                  <Check className={`h-3.5 w-3.5 ${selected ? "invisible" : "text-vscode-accent"}`} />
                  <span>Show All</span>
                </button>
                {availableBranches.map((b) => {
                  const isOn = !!selected?.includes(b);
                  return (
                    <button
                      key={b}
                      type="button"
                      role="option"
                      aria-selected={isOn}
                      onClick={() => toggleBranchSelection(b)}
                      className="flex items-center gap-2 px-2 py-1 text-left text-xs hover:bg-vscode-hover"
                    >
                      <Check className={`h-3.5 w-3.5 shrink-0 ${isOn ? "text-vscode-accent" : "invisible"}`} />
                      <span className="truncate">{b}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <label className="flex items-center gap-1.5 cursor-pointer font-semibold text-vscode-fg">
          <input
            type="checkbox"
            checked={filter.include_remotes}
            onChange={() => toggle("include_remotes")}
            className="accent-vscode-accent"
          />
          <span>Show Remote Branches</span>
        </label>
      </div>

      {/* Right icon buttons */}
      <div className="absolute right-2 flex items-center gap-0.5">
        <button type="button" onClick={openFind} title="Find" aria-label="Find" className={iconButton}>
          <Search className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onGoToHead} title="Go to HEAD" aria-label="Go to HEAD" className={iconButton}>
          <Crosshair className="h-3.5 w-3.5" />
        </button>
        <div className="relative" ref={settingsRef}>
          <button
            type="button"
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            title="Graph Settings"
            aria-label="Graph Settings"
            aria-expanded={isSettingsOpen}
            className={iconButton}
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
          {isSettingsOpen && (
            <div className="absolute right-0 top-7 z-50 flex w-52 flex-col gap-0.5 rounded border border-vscode-border bg-vscode-sidebar p-2 shadow-xl">
              <span className="mb-1 text-[10px] font-semibold uppercase text-vscode-muted">Show</span>
              {(
                [
                  ["include_tags", "Tags"],
                  ["include_stash", "Stashes"],
                  ["first_parent_only", "First parent only"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-vscode-hover cursor-pointer">
                  <input type="checkbox" checked={filter[key]} onChange={() => toggle(key)} className="accent-vscode-accent" />
                  <span>{label}</span>
                </label>
              ))}
              <label className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-vscode-hover cursor-pointer">
                <input
                  type="checkbox"
                  checked={dateFormat === "relative"}
                  onChange={onDateFormatToggle}
                  className="accent-vscode-accent"
                />
                <span>Relative dates</span>
              </label>
              <span className="mt-2 mb-1 text-[10px] font-semibold uppercase text-vscode-muted">Columns</span>
              {columns.map((col) => (
                <label key={col.id} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-vscode-hover cursor-pointer">
                  <input
                    type="checkbox"
                    checked={col.visible}
                    disabled={col.id === "graph" || col.id === "message"}
                    onChange={() => onToggleColumn(col.id)}
                    className="accent-vscode-accent"
                  />
                  <span>{col.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        {onFetch && (
          <button
            type="button"
            onClick={onFetch}
            title="Fetch from Remote(s)"
            aria-label="Fetch from Remote(s)"
            className={iconButton}
          >
            <CloudDownload className="h-3.5 w-3.5" />
          </button>
        )}
        <button type="button" onClick={onRefresh} title="Refresh Git Graph" aria-label="Refresh Git Graph" className={iconButton}>
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin text-vscode-accent" : ""}`} />
        </button>
      </div>

      {/* Find widget (like the editor find box) */}
      {isFindOpen && (
        <div className="absolute right-2 top-10 z-40 flex items-center gap-1 rounded border border-vscode-border bg-vscode-sidebar p-1 shadow-xl">
          <input
            ref={searchInputRef}
            type="text"
            aria-label="Find commits"
            placeholder="Search commits, authors, shas..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="h-6 w-60 rounded bg-vscode-input px-2 text-xs text-vscode-fg placeholder:text-vscode-muted border border-vscode-border outline-none focus:border-vscode-accent"
          />
          <span className="w-12 text-center text-[11px] text-vscode-muted tabular-nums">
            {searchQuery ? (matchCount > 0 ? `${matchIndex + 1}/${matchCount}` : "No results") : ""}
          </span>
          <button type="button" onClick={onPrevMatch} title="Previous match (Shift+Enter)" className={iconButton}>
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onNextMatch} title="Next match (Enter)" className={iconButton}>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={closeFind} title="Close (Escape)" className={iconButton}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
