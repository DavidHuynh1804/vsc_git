import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Clock, RefreshCw, Trash2, Search, AlertCircle, CheckCircle } from "lucide-react";
import { commands, events, GitOutputEntry } from "@/bindings";
import { isMock } from "@/env";

export const MOCK_GIT_TIMINGS: GitOutputEntry[] = [
  {
    id: 1,
    timestamp: Date.now() - 60000,
    cmd: "git status --porcelain=v2 --branch",
    cwd: "/workspace/repo",
    exit_code: 0,
    duration_ms: 24,
    stdout: "",
    stderr: "",
  },
  {
    id: 2,
    timestamp: Date.now() - 45000,
    cmd: "git log --oneline -n 50 --graph",
    cwd: "/workspace/repo",
    exit_code: 0,
    duration_ms: 115,
    stdout: "",
    stderr: "",
  },
  {
    id: 3,
    timestamp: Date.now() - 30000,
    cmd: "git fetch origin https://[REDACTED]@github.com/org/repo.git",
    cwd: "/workspace/repo",
    exit_code: 0,
    duration_ms: 450,
    stdout: "",
    stderr: "",
  },
  {
    id: 4,
    timestamp: Date.now() - 15000,
    cmd: "git push origin main",
    cwd: "/workspace/repo",
    exit_code: 1,
    duration_ms: 320,
    stdout: "",
    stderr: "error: failed to push some refs",
  },
];

export interface GitTimingsViewProps {
  initialEntries?: GitOutputEntry[];
}

export const GitTimingsView: React.FC<GitTimingsViewProps> = ({ initialEntries }) => {
  const [entries, setEntries] = useState<GitOutputEntry[]>(() => {
    if (initialEntries) return initialEntries;
    if (isMock()) return MOCK_GIT_TIMINGS;
    return [];
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "error">("all");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "duration-desc" | "duration-asc">("newest");
  const [isLoading, setIsLoading] = useState(false);

  const fetchEntries = useCallback(async () => {
    if (initialEntries) return;
    if (isMock()) {
      setEntries(MOCK_GIT_TIMINGS);
      return;
    }
    setIsLoading(true);
    try {
      const res = await commands.getGitOutput();
      if (res.status === "ok") {
        setEntries(res.data);
      }
    } finally {
      setIsLoading(false);
    }
  }, [initialEntries]);

  useEffect(() => {
    void fetchEntries();

    if (isMock() || initialEntries) return;

    let active = true;
    const unlistenPromise = events.gitOutput.listen((event) => {
      if (active) {
        setEntries((prev) => [...prev, event.payload]);
      }
    });

    return () => {
      active = false;
      void unlistenPromise.then((fn) => fn());
    };
  }, [fetchEntries, initialEntries]);

  const handleClear = async () => {
    if (!isMock() && !initialEntries) {
      await commands.clearGitOutput();
    }
    setEntries([]);
  };

  const filteredEntries = useMemo(() => {
    let result = entries;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) => e.cmd.toLowerCase().includes(q) || e.cwd.toLowerCase().includes(q)
      );
    }

    if (statusFilter === "success") {
      result = result.filter((e) => e.exit_code === 0);
    } else if (statusFilter === "error") {
      result = result.filter((e) => e.exit_code !== 0);
    }

    return [...result].sort((a, b) => {
      switch (sortBy) {
        case "newest":
          return (b.timestamp ?? 0) - (a.timestamp ?? 0);
        case "oldest":
          return (a.timestamp ?? 0) - (b.timestamp ?? 0);
        case "duration-desc":
          return b.duration_ms - a.duration_ms;
        case "duration-asc":
          return a.duration_ms - b.duration_ms;
        default:
          return 0;
      }
    });
  }, [entries, searchQuery, statusFilter, sortBy]);

  const stats = useMemo(() => {
    const total = entries.length;
    const errors = entries.filter((e) => e.exit_code !== 0).length;
    const avgMs =
      total > 0
        ? Math.round(entries.reduce((acc, curr) => acc + curr.duration_ms, 0) / total)
        : 0;
    return { total, errors, avgMs };
  }, [entries]);

  return (
    <div className="flex h-full w-full flex-col bg-vscode-bg text-vscode-fg">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-vscode-border px-4 py-3 bg-vscode-sidebar">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-vscode-accent" />
          <h2 className="text-sm font-semibold">Git Command Timings</h2>
          <span className="text-xs text-vscode-muted ml-2">
            ({stats.total} commands, avg {stats.avgMs}ms, {stats.errors} errors)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="refresh-btn"
            title="Refresh timing records"
            onClick={() => void fetchEntries()}
            disabled={isLoading}
            className="flex items-center gap-1 rounded bg-vscode-input px-2.5 py-1 text-xs hover:bg-vscode-hover"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            data-testid="clear-btn"
            title="Clear all timing records"
            onClick={() => void handleClear()}
            className="flex items-center gap-1 rounded bg-error/20 text-error px-2.5 py-1 text-xs hover:bg-error/30"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex items-center justify-between gap-3 border-b border-vscode-border px-4 py-2 bg-vscode-bg text-xs">
        <div className="relative flex flex-1 max-w-md items-center">
          <Search className="absolute left-2.5 h-3.5 w-3.5 text-vscode-muted" />
          <input
            type="text"
            data-testid="filter-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter commands or directory..."
            className="w-full rounded border border-vscode-border bg-vscode-input pl-8 pr-3 py-1 text-xs text-vscode-fg placeholder-vscode-muted focus:border-vscode-accent focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-vscode-muted">Status:</span>
            <select
              data-testid="status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | "success" | "error")}
              className="rounded border border-vscode-border bg-vscode-input px-2 py-1 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
            >
              <option value="all">All</option>
              <option value="success">Success (0)</option>
              <option value="error">Errors</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-vscode-muted">Sort:</span>
            <select
              data-testid="sort-select"
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as "newest" | "oldest" | "duration-desc" | "duration-asc")
              }
              className="rounded border border-vscode-border bg-vscode-input px-2 py-1 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="duration-desc">Duration (Slowest)</option>
              <option value="duration-asc">Duration (Fastest)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table Content */}
      <div className="flex-1 overflow-auto">
        {filteredEntries.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-vscode-muted text-xs">
            <p>No git command timing records found.</p>
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-vscode-sidebar border-b border-vscode-border text-vscode-muted uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-2 px-3 font-medium w-24">Time</th>
                <th className="py-2 px-3 font-medium w-20">Duration</th>
                <th className="py-2 px-3 font-medium w-20">Exit</th>
                <th className="py-2 px-3 font-medium">Command</th>
                <th className="py-2 px-3 font-medium w-48">Working Directory</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vscode-border/40 font-mono">
              {filteredEntries.map((entry) => {
                const dateStr = entry.timestamp
                  ? new Date(entry.timestamp).toLocaleTimeString()
                  : "-";
                const isSuccess = entry.exit_code === 0;
                return (
                  <tr key={entry.id} className="hover:bg-vscode-hover/50 transition-colors">
                    <td className="py-2 px-3 text-vscode-muted whitespace-nowrap">{dateStr}</td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded font-semibold text-[10px] ${
                          entry.duration_ms > 300
                            ? "bg-warning/20 text-warning"
                            : "bg-vscode-input text-vscode-fg"
                        }`}
                      >
                        {entry.duration_ms} ms
                      </span>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          isSuccess ? "bg-success/15 text-success" : "bg-error/20 text-error"
                        }`}
                      >
                        {isSuccess ? (
                          <CheckCircle className="h-3 w-3" />
                        ) : (
                          <AlertCircle className="h-3 w-3" />
                        )}
                        {entry.exit_code}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-vscode-fg break-all font-semibold">
                      {entry.cmd}
                      {entry.stderr && (
                        <div className="text-[10px] text-error mt-0.5 font-normal">
                          {entry.stderr}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3 text-vscode-muted truncate max-w-xs" title={entry.cwd}>
                      {entry.cwd}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
