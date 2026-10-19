import React, { useEffect } from "react";
import { FolderOpen, History, GitFork, Sparkles, FolderGit2 } from "lucide-react";
import { useRepoStore } from "@/stores/repo";
import { useUIStore } from "@/stores/ui";
import { commands, RepoInfo } from "@/bindings";
import { useScmStore } from "@/scm/scmStore";
import { useM3Store } from "@/m3/m3Store";

export const WelcomeView: React.FC = () => {
  const { recentRepos, setRecentRepos, setRepo, setLoading, setError, repoRoot } = useRepoStore();
  const { openTab } = useUIStore();

  useEffect(() => {
    commands.recentRepos().then((res) => {
      if (res.status === "ok") {
        setRecentRepos(res.data);
      }
    });
  }, [setRecentRepos]);

  const onRepoOpened = async (repoInfo: RepoInfo) => {
    setRepo(repoInfo);
    const scm = useScmStore.getState();
    void scm.refreshStatus();
    void scm.refreshRefs();
    void scm.refreshStashes();
    const m3 = useM3Store.getState();
    void m3.refreshOperationState();
    const recent = await commands.recentRepos();
    if (recent.status === "ok") {
      setRecentRepos(recent.data);
    }
    openTab({ id: "graph", title: "Git Graph", closable: true });
  };

  const handleOpenFolder = async () => {
    try {
      setLoading(true);
      const picked = await commands.pickFolder();
      if (picked.status === "ok" && picked.data) {
        const opened = await commands.openRepo(picked.data);
        if (opened.status === "ok") {
          await onRepoOpened(opened.data);
        } else {
          setError(opened.error.message);
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to open repository");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenRecent = async (path: string) => {
    try {
      setLoading(true);
      const opened = await commands.openRepo(path);
      if (opened.status === "ok") {
        await onRepoOpened(opened.data);
      } else {
        setError(opened.error.message);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to open repository");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8 select-none text-vscode-fg overflow-y-auto">
      <div className="flex max-w-2xl w-full flex-col gap-8">
        {/* Header Branding */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-vscode-accent text-white">
              <FolderGit2 className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-vscode-fg">vsc_git</h1>
              <p className="text-xs text-vscode-muted">
                Fast, lightweight Git GUI inspired by VS Code
              </p>
            </div>
          </div>
        </div>

        {/* Start Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex flex-col gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-vscode-muted">
              Start
            </h2>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleOpenFolder}
                className="flex items-center gap-2.5 rounded border border-vscode-border bg-vscode-input p-3 text-left hover:bg-vscode-hover hover:border-vscode-accent focus-visible:ring-1 focus-visible:ring-vscode-accent transition-colors"
              >
                <FolderOpen className="h-5 w-5 text-vscode-accent flex-shrink-0" />
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-vscode-fg">Open Repository</span>
                  <span className="text-[11px] text-vscode-muted">
                    Open an existing local Git repository
                  </span>
                </div>
              </button>
              <div className="flex items-center gap-2.5 rounded border border-vscode-border bg-vscode-sidebar p-3">
                <GitFork className="h-5 w-5 text-vscode-muted flex-shrink-0" />
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-vscode-fg">Clone Repository (M1)</span>
                  <span className="text-[11px] text-vscode-muted">
                    Clone from GitHub or GitLab remote URL
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Repositories */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-vscode-muted">
                Recent Repositories
              </h2>
              <History className="h-3.5 w-3.5 text-vscode-muted" />
            </div>

            {recentRepos.length === 0 ? (
              <div className="rounded border border-dashed border-vscode-border p-6 text-center text-xs text-vscode-muted">
                No recent repositories. Open a folder to get started.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
                {recentRepos.map((repo) => {
                  const rPath = repo.path || ("root" in repo && typeof repo.root === "string" ? repo.root : "");
                  const rName = repo.name || rPath.split("/").filter(Boolean).pop() || "repository";
                  return (
                    <button
                      key={rPath || rName}
                      type="button"
                      onClick={() => handleOpenRecent(rPath)}
                      className="flex flex-col rounded border border-vscode-border bg-vscode-input p-2 text-left hover:bg-vscode-hover hover:border-vscode-accent transition-colors"
                    >
                      <span className="text-xs font-medium text-vscode-fg">{rName}</span>
                      <span className="text-[10px] text-vscode-muted truncate">{rPath}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Shortcuts & Info */}
        <div className="rounded border border-vscode-border bg-vscode-sidebar p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-medium text-vscode-fg">
            <Sparkles className="h-4 w-4 text-vscode-accent" />
            <span>Quick Shortcuts</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-vscode-muted">
            <div className="flex items-center justify-between">
              <span>Command Palette</span>
              <kbd className="rounded border border-vscode-border bg-vscode-bg px-1.5 py-0.5 text-[10px] font-mono text-vscode-muted">
                Cmd/Ctrl+K
              </kbd>
            </div>
            <div className="flex items-center justify-between">
              <span>Toggle Git Output</span>
              <kbd className="rounded border border-vscode-border bg-vscode-bg px-1.5 py-0.5 text-[10px] font-mono text-vscode-muted">
                Status bar
              </kbd>
            </div>
            {repoRoot && (
              <div className="flex items-center justify-between col-span-2">
                <span>Active Repo</span>
                <span className="text-vscode-fg font-mono text-[10px] truncate max-w-xs">
                  {repoRoot}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
