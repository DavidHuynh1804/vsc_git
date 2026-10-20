import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, FolderGit2, FolderOpen, History } from "lucide-react";
import { useRepoStore } from "@/stores/repo";
import { commands } from "@/bindings";
import { openRepository, pickAndOpenRepository } from "@/stores/openRepository";

/** Titlebar repo switcher: open another folder or jump to a recent repository. */
export const RepoMenu: React.FC = () => {
  const { repoName, repoRoot, recentRepos, setRecentRepos } = useRepoStore();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    commands.recentRepos().then((res) => {
      if (res.status === "ok") setRecentRepos(res.data);
    });
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [isOpen, setRecentRepos]);

  const others = (recentRepos ?? []).filter((r) => r.path !== repoRoot);

  const choose = (fn: () => Promise<void>) => {
    setIsOpen(false);
    void fn();
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        title={repoRoot ? `${repoRoot} (switch repository)` : "Open Repository"}
        aria-label="Switch Repository"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 min-w-0 hover:bg-vscode-hover transition-colors"
      >
        <span className="font-medium truncate">{repoName ?? "Open Repository"}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-vscode-muted" />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Repositories"
          className="absolute left-0 top-full z-50 mt-1 w-72 rounded border border-vscode-border bg-vscode-sidebar p-1 shadow-2xl"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => choose(pickAndOpenRepository)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-vscode-hover"
          >
            <FolderOpen className="h-3.5 w-3.5 text-vscode-accent" />
            <span>Open Folder...</span>
          </button>

          {others.length > 0 && (
            <>
              <div className="mt-1 flex items-center gap-1.5 border-t border-vscode-border px-2 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-vscode-muted">
                <History className="h-3 w-3" />
                <span>Recent</span>
              </div>
              {others.map((repo) => (
                <button
                  key={repo.path}
                  type="button"
                  role="menuitem"
                  title={repo.path}
                  onClick={() => choose(() => openRepository(repo.path))}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-vscode-hover"
                >
                  <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-vscode-muted" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{repo.name}</span>
                    <span className="truncate text-[10px] text-vscode-muted">{repo.path}</span>
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};
