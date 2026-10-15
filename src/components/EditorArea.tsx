import React from "react";
import { X, GitGraph, FileCode, Sparkles } from "lucide-react";
import { useUIStore, TabItem } from "@/stores/ui";
import { WelcomeView } from "@/components/WelcomeView";
import { useRepoStore } from "@/stores/repo";

export const EditorArea: React.FC = () => {
  const { tabs, activeTabId, setActiveTabId, closeTab } = useUIStore();
  const { repoName, headBranch } = useRepoStore();

  const renderTabContent = (tab: TabItem) => {
    if (tab.id === "welcome") {
      return <WelcomeView />;
    }

    if (tab.id === "graph") {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center p-8 text-center text-vscode-muted gap-3">
          <GitGraph className="h-12 w-12 text-vscode-accent opacity-80" />
          <h2 className="text-base font-semibold text-vscode-fg">Git Graph (Milestone 2)</h2>
          <p className="max-w-md text-xs leading-relaxed">
            Fast, interactive commit graph with topological lanes, commit details, compare diffs,
            and 60 FPS virtualization for repositories with 200k+ commits.
          </p>
        </div>
      );
    }

    if (tab.id.startsWith("diff-")) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center p-8 text-center text-vscode-muted gap-3">
          <FileCode className="h-12 w-12 text-vscode-accent opacity-80" />
          <h2 className="text-base font-semibold text-vscode-fg">Monaco Diff Editor (Milestone 1)</h2>
          <p className="max-w-md text-xs leading-relaxed">
            Side-by-side and inline diffs, syntax highlighting, hunk staging, and range reversion.
          </p>
        </div>
      );
    }

    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-8 text-center text-vscode-muted gap-2">
        <Sparkles className="h-8 w-8 text-vscode-accent" />
        <h3 className="text-sm font-medium text-vscode-fg">{tab.title}</h3>
        <p className="text-xs">
          {repoName ? `Active repository: ${repoName} (${headBranch})` : "No repository active"}
        </p>
      </div>
    );
  };

  const currentTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  return (
    <main className="flex flex-1 flex-col overflow-hidden bg-vscode-bg min-w-0">
      {/* Tab bar */}
      <div className="flex h-9 w-full items-center border-b bg-vscode-activity overflow-x-auto select-none">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTabId(tab.id)}
              className={`flex h-full items-center gap-2 border-r px-3.5 text-xs cursor-pointer transition-colors ${
                isActive
                  ? "bg-vscode-bg text-vscode-fg font-medium border-t-2 border-t-vscode-accent"
                  : "bg-vscode-sidebar text-vscode-muted hover:bg-vscode-hover hover:text-vscode-fg"
              }`}
            >
              <span>{tab.title}</span>
              {tab.closable !== false && (
                <button
                  type="button"
                  title="Close tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className="rounded p-0.5 hover:bg-vscode-hover hover:text-vscode-fg"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Editor Content */}
      <div className="flex-1 overflow-auto">{currentTab && renderTabContent(currentTab)}</div>
    </main>
  );
};
