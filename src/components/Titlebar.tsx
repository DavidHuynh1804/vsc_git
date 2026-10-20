import React from "react";
import { GitBranch, RefreshCw, Search, FolderGit2 } from "lucide-react";
import { useRepoStore } from "@/stores/repo";
import { useUIStore } from "@/stores/ui";
import { useScmStore } from "@/scm/scmStore";
import { RepoMenu } from "@/components/RepoMenu";

export const Titlebar: React.FC = () => {
  const { repoName, headBranch } = useRepoStore();
  const { toggleCommandPalette, setBranchPickerOpen } = useUIStore();
  const sync = useScmStore((s) => s.sync);

  const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
  const shortcutHint = isMac ? "Cmd+K" : "Ctrl+K";

  return (
    <header
      aria-label="Application titlebar"
      className="flex h-9 w-full items-center justify-between border-b bg-vscode-titlebar px-3 select-none text-vscode-fg text-xs"
    >
      <div className="flex items-center gap-2 min-w-0">
        <FolderGit2 className="h-4 w-4 text-vscode-accent shrink-0" />
        <span className="font-semibold text-vscode-fg shrink-0">vsc_git</span>
        <span className="text-vscode-muted">/</span>
        <RepoMenu />
        {headBranch && (
          <button
            type="button"
            title="Switch or create branch"
            aria-label={`Switch branch (current: ${headBranch})`}
            onClick={() => setBranchPickerOpen(true)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-mono font-medium shrink-0 hover:opacity-80"
            style={{
              backgroundColor: "var(--vscode-badge-bg)",
              color: "var(--vscode-badge-fg)",
            }}
          >
            <GitBranch className="h-3 w-3" />
            <span>{headBranch}</span>
          </button>
        )}
      </div>

      <div className="flex flex-1 justify-center max-w-xl px-4">
        <button
          type="button"
          onClick={toggleCommandPalette}
          title="Search commands"
          className="flex h-6 w-full items-center justify-between rounded border border-vscode-border bg-vscode-input px-3 text-vscode-muted hover:text-vscode-fg hover:bg-vscode-hover focus-visible:ring-1 focus-visible:ring-vscode-accent transition-colors"
        >
          <div className="flex items-center gap-2 truncate">
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{repoName ? `Search commands (${repoName})` : "Search commands..."}</span>
          </div>
          <kbd className="rounded border border-vscode-border bg-vscode-bg px-1.5 py-0.2 text-[10px] text-vscode-muted font-mono shrink-0 ml-2">
            {shortcutHint}
          </kbd>
        </button>
      </div>

      <div className="flex items-center gap-2">
        {repoName && (
          <button
            type="button"
            title="Sync changes"
            onClick={() => void sync()}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-vscode-muted hover:text-vscode-fg hover:bg-vscode-hover transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Sync</span>
          </button>
        )}
      </div>
    </header>
  );
};
