import React, { useEffect, useRef, useState } from "react";
import type { DateDisplayFormat, GraphFilter } from "@/graph/types";
import {
  Search,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  GitBranch,
  Clock,
  Compass,
} from "lucide-react";

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
  isRefreshing?: boolean;
}

export const GraphToolbar: React.FC<GraphToolbarProps> = ({
  searchQuery,
  onSearchChange,
  onNextMatch,
  onPrevMatch,
  matchIndex,
  matchCount,
  filter,
  onFilterChange,
  availableBranches = ["main", "feat/m1-backend", "feat/search"],
  dateFormat,
  onDateFormatToggle,
  onGoToHead,
  onRefresh,
  isRefreshing = false,
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isBranchMenuOpen, setIsBranchMenuOpen] = useState(false);
  const branchMenuRef = useRef<HTMLDivElement>(null);

  // Global '/' shortcut to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if already inside an input or textarea
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        if (target === searchInputRef.current && e.key === "Escape") {
          searchInputRef.current.blur();
        }
        return;
      }

      if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close branch dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (branchMenuRef.current && !branchMenuRef.current.contains(e.target as Node)) {
        setIsBranchMenuOpen(false);
      }
    };
    if (isBranchMenuOpen) {
      window.addEventListener("mousedown", handleClickOutside);
    }
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [isBranchMenuOpen]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        onPrevMatch();
      } else {
        onNextMatch();
      }
    }
  };

  const toggleBranchSelection = (branchName: string) => {
    let currentSelected: string[] = [];
    if (typeof filter.refs === "object" && "Selected" in filter.refs) {
      currentSelected = [...filter.refs.Selected];
    } else {
      currentSelected = [...availableBranches];
    }

    const idx = currentSelected.indexOf(branchName);
    if (idx !== -1) {
      currentSelected.splice(idx, 1);
    } else {
      currentSelected.push(branchName);
    }

    onFilterChange({
      ...filter,
      refs:
        currentSelected.length === availableBranches.length
          ? "All"
          : { Selected: currentSelected },
    });
  };

  const isBranchSelected = (name: string): boolean => {
    if (filter.refs === "All") return true;
    if (typeof filter.refs === "object" && "Selected" in filter.refs) {
      return filter.refs.Selected.includes(name);
    }
    return true;
  };

  return (
    <div className="flex h-10 w-full items-center justify-between border-b border-vscode-border bg-vscode-activity px-3 text-xs select-none">
      {/* Left controls: Search & Matches */}
      <div className="flex items-center gap-2">
        <div className="relative flex items-center">
          <Search className="absolute left-2 h-3.5 w-3.5 text-vscode-muted pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search commits, authors, shas... (Press '/')"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="h-7 w-64 rounded bg-vscode-input pl-7 pr-16 text-xs text-vscode-fg placeholder:text-vscode-muted border border-vscode-border outline-none focus:border-vscode-accent"
          />

          {searchQuery && (
            <div className="absolute right-1 flex items-center gap-0.5 text-[10px] text-vscode-muted">
              <span>
                {matchCount > 0 ? `${matchIndex + 1}/${matchCount}` : "0/0"}
              </span>
              <button
                type="button"
                onClick={onPrevMatch}
                title="Previous match (Shift+Enter)"
                className="rounded p-0.5 hover:bg-vscode-hover hover:text-vscode-fg"
              >
                <ChevronUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={onNextMatch}
                title="Next match (Enter)"
                className="rounded p-0.5 hover:bg-vscode-hover hover:text-vscode-fg"
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        {/* Go to HEAD button */}
        <button
          type="button"
          onClick={onGoToHead}
          title="Jump to HEAD commit"
          className="flex h-7 items-center gap-1.5 rounded border border-vscode-border bg-vscode-input px-2 text-xs text-vscode-fg hover:bg-vscode-hover hover:border-vscode-accent"
        >
          <Compass className="h-3.5 w-3.5 text-vscode-accent" />
          <span>Go to HEAD</span>
        </button>
      </div>

      {/* Right controls: Filters, Date toggle, Refresh */}
      <div className="flex items-center gap-2">
        {/* Branch Multi-select Dropdown */}
        <div className="relative" ref={branchMenuRef}>
          <button
            type="button"
            onClick={() => setIsBranchMenuOpen(!isBranchMenuOpen)}
            className="flex h-7 items-center gap-1.5 rounded border border-vscode-border bg-vscode-input px-2 text-xs text-vscode-fg hover:bg-vscode-hover"
          >
            <GitBranch className="h-3.5 w-3.5 text-vscode-accent" />
            <span>Branches</span>
            <ChevronDown className="h-3 w-3 text-vscode-muted" />
          </button>

          {isBranchMenuOpen && (
            <div className="absolute right-0 top-8 z-50 flex w-52 flex-col rounded border border-vscode-border bg-vscode-sidebar p-2 shadow-xl">
              <span className="mb-1 text-[10px] font-semibold uppercase text-vscode-muted">
                Filter Branches
              </span>
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                {availableBranches.map((b) => (
                  <label
                    key={b}
                    className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-vscode-hover cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={isBranchSelected(b)}
                      onChange={() => toggleBranchSelection(b)}
                      className="rounded accent-vscode-accent"
                    />
                    <span className="truncate text-vscode-fg">{b}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Quick Filter Toggles */}
        <div className="flex items-center rounded border border-vscode-border bg-vscode-input p-0.5">
          <button
            type="button"
            title="Toggle remote branches"
            onClick={() =>
              onFilterChange({
                ...filter,
                include_remotes: !filter.include_remotes,
              })
            }
            className={`rounded px-2 py-0.5 text-[11px] ${
              filter.include_remotes
                ? "bg-vscode-accent text-white font-medium"
                : "text-vscode-muted hover:text-vscode-fg"
            }`}
          >
            Remote
          </button>

          <button
            type="button"
            title="Toggle tags"
            onClick={() =>
              onFilterChange({
                ...filter,
                include_tags: !filter.include_tags,
              })
            }
            className={`rounded px-2 py-0.5 text-[11px] ${
              filter.include_tags
                ? "bg-vscode-accent text-white font-medium"
                : "text-vscode-muted hover:text-vscode-fg"
            }`}
          >
            Tags
          </button>

          <button
            type="button"
            title="Toggle stashes"
            onClick={() =>
              onFilterChange({
                ...filter,
                include_stash: !filter.include_stash,
              })
            }
            className={`rounded px-2 py-0.5 text-[11px] ${
              filter.include_stash
                ? "bg-vscode-accent text-white font-medium"
                : "text-vscode-muted hover:text-vscode-fg"
            }`}
          >
            Stash
          </button>

          <button
            type="button"
            title="Only follow the first parent commit"
            onClick={() =>
              onFilterChange({
                ...filter,
                first_parent_only: !filter.first_parent_only,
              })
            }
            className={`rounded px-2 py-0.5 text-[11px] ${
              filter.first_parent_only
                ? "bg-vscode-accent text-white font-medium"
                : "text-vscode-muted hover:text-vscode-fg"
            }`}
          >
            1st Parent
          </button>
        </div>

        {/* Date format toggle */}
        <button
          type="button"
          onClick={onDateFormatToggle}
          title={`Date display: ${dateFormat} (click to toggle)`}
          className="flex h-7 items-center gap-1 rounded border border-vscode-border bg-vscode-input px-2 text-xs text-vscode-fg hover:bg-vscode-hover"
        >
          <Clock className="h-3.5 w-3.5 text-vscode-muted" />
          <span className="capitalize">{dateFormat}</span>
        </button>

        {/* Refresh button */}
        <button
          type="button"
          onClick={onRefresh}
          title="Refresh Git Graph"
          className="flex h-7 w-7 items-center justify-center rounded border border-vscode-border bg-vscode-input text-vscode-muted hover:text-vscode-fg hover:bg-vscode-hover"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin text-vscode-accent" : ""}`} />
        </button>
      </div>
    </div>
  );
};
