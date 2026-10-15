import React, { useState, useEffect, useRef, useMemo } from "react";
import { Search, FolderOpen, Terminal, Settings, Sun, Moon, RefreshCw, FileText, GitPullRequest, GitGraph, GitMerge, Layers } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { useRepoStore } from "@/stores/repo";
import { useScmStore } from "@/scm/scmStore";
import { commands } from "@/bindings";

export interface PaletteCommand {
  id: string;
  title: string;
  category: string;
  icon?: React.ComponentType<{ className?: string }>;
  action: () => void | Promise<void>;
}

export function filterCommands(commandsList: PaletteCommand[], query: string): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commandsList;
  return commandsList.filter((cmd) => {
    const full = `${cmd.category}: ${cmd.title}`.toLowerCase();
    return full.includes(q);
  });
}

export const CommandPalette: React.FC = () => {
  const {
    isCommandPaletteOpen,
    setCommandPaletteOpen,
    setActiveActivity,
    toggleGitOutput,
    theme,
    setTheme,
    openTab,
    setCreatePrOpen,
  } = useUIStore();
  const { setRepo, setLoading, setError } = useRepoStore();

  const { status: scmStatus, stageAll, unstageAll, sync, fetch, pull, push, refreshStatus } = useScmStore();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commandList: PaletteCommand[] = useMemo(
    () => [
      {
        id: "open-repo",
        category: "Git",
        title: "Open Repository...",
        icon: FolderOpen,
        action: async () => {
          try {
            setLoading(true);
            const picked = await commands.pickFolder();
            if (picked.status === "ok" && picked.data) {
              const opened = await commands.openRepo(picked.data);
              if (opened.status === "ok") {
                setRepo(opened.data);
                openTab({ id: "graph", title: "Git Graph", closable: true });
              } else {
                setError(opened.error.message);
              }
            }
          } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to open folder");
          } finally {
            setLoading(false);
          }
        },
      },
      {
        id: "toggle-git-output",
        category: "Git",
        title: "Toggle Git Output",
        icon: Terminal,
        action: () => toggleGitOutput(),
      },
      {
        id: "git-commit",
        category: "Git",
        title: "Commit",
        action: () => setActiveActivity("changes"),
      },
      {
        id: "git-stage-all",
        category: "Git",
        title: "Stage All Changes",
        action: () => stageAll(),
      },
      {
        id: "git-unstage-all",
        category: "Git",
        title: "Unstage All Changes",
        action: () => unstageAll(),
      },
      {
        id: "git-sync",
        category: "Git",
        title: "Sync (Pull & Push)",
        action: () => sync(),
      },
      {
        id: "git-fetch",
        category: "Git",
        title: "Fetch",
        action: () => fetch(),
      },
      {
        id: "git-pull",
        category: "Git",
        title: "Pull",
        action: () => pull(),
      },
      {
        id: "git-push",
        category: "Git",
        title: "Push",
        action: () => push(),
      },
      {
        id: "git-refresh",
        category: "Git",
        title: "Refresh Status",
        action: () => refreshStatus(),
      },
      {
        id: "view-changes",
        category: "View",
        title: "Show Source Control",
        action: () => setActiveActivity("changes"),
      },
      {
        id: "open-graph",
        category: "Git",
        title: "Open Graph",
        icon: GitGraph,
        action: () => {
          setActiveActivity("graph");
          openTab({ id: "graph", title: "Git Graph", closable: true });
        },
      },
      {
        id: "view-graph",
        category: "View",
        title: "Show Git Graph",
        action: () => {
          setActiveActivity("graph");
          openTab({ id: "graph", title: "Git Graph", closable: true });
        },
      },
      {
        id: "view-branches",
        category: "View",
        title: "Show Branches",
        action: () => setActiveActivity("branches"),
      },
      {
        id: "view-stashes",
        category: "View",
        title: "Show Stashes",
        action: () => setActiveActivity("stashes"),
      },
      {
        id: "git-interactive-rebase",
        category: "Git",
        title: "Interactive Rebase...",
        icon: Layers,
        action: () => {
          openTab({ id: "rebase-interactive", title: "Interactive Rebase", closable: true });
        },
      },
      {
        id: "git-open-merge-editor",
        category: "Git",
        title: "Open Merge Conflict Editor",
        icon: GitMerge,
        action: () => {
          const unmerged = scmStatus?.entries.find((e) => e.kind.type === "Unmerged");
          const targetPath = unmerged ? unmerged.path : "src/App.tsx";
          const fileName = targetPath.split("/").pop() ?? targetPath;
          openTab({ id: `merge-${targetPath}`, title: `Merge: ${fileName}`, closable: true });
        },
      },
      {
        id: "view-settings",
        category: "Preferences",
        title: "Open Settings",
        icon: Settings,
        action: () => {
          setActiveActivity("settings");
          openTab({ id: "settings", title: "Settings", closable: true });
        },
      },
      {
        id: "create-pull-request",
        category: "Git",
        title: "Create Pull Request",
        icon: GitPullRequest,
        action: () => setCreatePrOpen(true),
      },
      {
        id: "toggle-theme",
        category: "Preferences",
        title: `Switch Theme (current: ${theme})`,
        icon: theme === "dark" ? Sun : Moon,
        action: () => setTheme(theme === "dark" ? "light" : "dark"),
      },
      {
        id: "export-logs",
        category: "App",
        title: "Export Logs to File",
        icon: FileText,
        action: async () => {
          const res = await commands.exportLogs();
          if (res.status === "ok") {
            alert(`Logs exported to:\n${res.data.path} (${res.data.line_count} lines)`);
          }
        },
      },
      {
        id: "reload-window",
        category: "App",
        title: "Reload Window",
        icon: RefreshCw,
        action: () => window.location.reload(),
      },
    ],
    [openTab, setActiveActivity, setCreatePrOpen, setError, setLoading, setRepo, setTheme, theme, toggleGitOutput]
  );

  const filtered = useMemo(() => filterCommands(commandList, query), [commandList, query]);

  // Handle global shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (
        (isCmdOrCtrl && e.key.toLowerCase() === "k") ||
        (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === "p")
      ) {
        e.preventDefault();
        setCommandPaletteOpen(!isCommandPaletteOpen);
      } else if (e.key === "Escape" && isCommandPaletteOpen) {
        e.preventDefault();
        setCommandPaletteOpen(false);
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        setActiveActivity("changes");
      } else if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void sync();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isCommandPaletteOpen, setActiveActivity, setCommandPaletteOpen, sync]);

  // Focus input when opened
  useEffect(() => {
    if (isCommandPaletteOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isCommandPaletteOpen]);

  const executeSelected = (index: number) => {
    const cmd = filtered[index];
    if (cmd) {
      setCommandPaletteOpen(false);
      cmd.action();
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      executeSelected(selectedIndex);
    }
  };

  if (!isCommandPaletteOpen) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-12 select-none"
      onClick={() => setCommandPaletteOpen(false)}
    >
      <div
        className="flex w-full max-w-xl flex-col rounded-lg border border-vscode-border bg-vscode-sidebar shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-vscode-border bg-vscode-input px-3 py-2 text-vscode-fg">
          <Search className="h-4 w-4 text-vscode-muted flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-xs text-vscode-fg outline-none placeholder:text-vscode-muted font-sans"
          />
        </div>

        <div className="max-h-72 overflow-y-auto p-1 flex flex-col gap-0.5">
          {filtered.length === 0 ? (
            <div className="p-3 text-center text-xs text-vscode-muted">No commands found</div>
          ) : (
            filtered.map((cmd, idx) => {
              const Icon = cmd.icon;
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={cmd.id}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => executeSelected(idx)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between rounded px-3 py-1.5 text-xs cursor-pointer ${
                    isSelected
                      ? "bg-vscode-accent text-white"
                      : "text-vscode-fg hover:bg-vscode-hover"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {Icon ? (
                      <Icon className="h-3.5 w-3.5 opacity-80" />
                    ) : (
                      <div className="w-3.5" />
                    )}
                    <span>
                      <span className={isSelected ? "text-white opacity-80" : "text-vscode-muted"}>
                        {cmd.category}:{" "}
                      </span>
                      <span className="font-medium">{cmd.title}</span>
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
