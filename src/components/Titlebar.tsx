import React from "react";
import { GitBranch, RefreshCw, Search, FolderGit2 } from "lucide-react";
import { useRepoStore } from "@/stores/repo";
import { useUIStore } from "@/stores/ui";

export const Titlebar: React.FC = () => {
  const { repoName, headBranch } = useRepoStore();
  const { toggleCommandPalette } = useUIStore();

  const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
  const shortcutHint = isMac ? "Cmd+K" : "Ctrl+K";

  return (
    <header className="flex h-9 w-full items-center justify-between border-b bg-vscode-titlebar px-3 select-none text-vscode-fg text-xs">
      <div className="flex items-center gap-2">
        <FolderGit2 className="h-4 w-4 text-vscode-accent" />
        <span className="font-semibold text-vscode-fg">vsc_git</span>
        {repoName && (
          <>
            <span className="text-vscode-muted">/</span>
            <span className="font-medium">{repoName}</span>
          </>
        )}
        {headBranch && (
          <div className="inline-flex items-center gap-1 rounded bg-vscode-badge px-1.5 py-0.5 text-xs text-white">
            <GitBranch className="h-3 w-3" />
            <span>{headBranch}</span>
          </div>
        )}
      </div>

      <div className="flex flex-1 justify-center max-w-xl px-4">
        <button
          type="button"
          onClick={toggleCommandPalette}
          className="flex h-6 w-full items-center justify-between rounded border border-vscode-border bg-vscode-input px-3 text-vscode-muted hover:text-vscode-fg hover:bg-vscode-hover"
        >
          <div className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5" />
            <span>{repoName ? `Search commands (${repoName})` : "Search commands..."}</span>
          </div>
          <kbd className="rounded border border-vscode-border bg-vscode-bg px-1 py-0.2 text-[10px] text-vscode-muted">
            {shortcutHint}
          </kbd>
        </button>
      </div>

      <div className="flex items-center gap-3">
        {repoName && (
          <div className="inline-flex items-center gap-1 text-vscode-muted hover:text-vscode-fg cursor-pointer">
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Sync</span>
          </div>
        )}
      </div>
    </header>
  );
};
