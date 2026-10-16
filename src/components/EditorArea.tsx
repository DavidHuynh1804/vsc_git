import React from "react";
import { X, Sparkles } from "lucide-react";
import { useUIStore, TabItem } from "@/stores/ui";
import { WelcomeView } from "@/components/WelcomeView";
import { DiffView } from "@/views/Diff/DiffView";
import { GraphView } from "@/views/Graph/GraphView";
import { MergeEditorView } from "@/views/MergeEditor/MergeEditorView";
import { BlameView } from "@/views/Blame/BlameView";
import { FileHistoryView } from "@/views/FileHistory/FileHistoryView";
import { InteractiveRebaseView } from "@/views/Rebase/InteractiveRebaseView";
import { GraphAction } from "@/graph/types";
import { useScmStore } from "@/scm/scmStore";
import { useRepoStore } from "@/stores/repo";
import { SettingsView } from "@/views/Settings/SettingsView";
import { defaultSettingsDataSource } from "@/settings";

export const EditorArea: React.FC = () => {
  const { tabs, activeTabId, setActiveTabId, closeTab } = useUIStore();
  const { repoName, headBranch } = useRepoStore();
  const { activeDiff } = useScmStore();

  const { openTab } = useUIStore();

  const handleGraphAction = (action: GraphAction) => {
    if (action.type === "rebase-interactive") {
      const sha = typeof action.payload?.sha === "string" ? action.payload.sha : undefined;
      openTab({
        id: "rebase-interactive",
        title: sha ? `Rebase (${sha.slice(0, 7)})` : "Interactive Rebase",
        closable: true,
        baseSha: sha,
      });
    }
  };

  const renderTabContent = (tab: TabItem) => {
    if (tab.id === "welcome") {
      return <WelcomeView />;
    }

    if (tab.id === "settings") {
      return <SettingsView dataSource={defaultSettingsDataSource} />;
    }

    if (tab.id === "graph") {
      return <GraphView onAction={handleGraphAction} />;
    }

    if (tab.id.startsWith("diff-") && tab.id !== "diff-") {
      const filePath = tab.id.substring("diff-".length);
      const diffContext =
        activeDiff && activeDiff.path === filePath ? activeDiff.context : "unstaged";
      return <DiffView filePath={filePath} context={diffContext} />;
    }

    if (tab.id.startsWith("merge-")) {
      const filePath = tab.id.substring("merge-".length);
      return <MergeEditorView filePath={filePath} />;
    }

    if (tab.id.startsWith("blame-")) {
      const filePath = tab.id.substring("blame-".length);
      return (
        <BlameView
          filePath={filePath}
          onSelectCommitInGraph={(sha) => {
            useUIStore.getState().setSelectedGraphSha(sha);
            openTab({ id: "graph", title: "Git Graph", closable: true });
          }}
        />
      );
    }

    if (tab.id.startsWith("file-history-")) {
      const filePath = tab.id.substring("file-history-".length);
      return <FileHistoryView filePath={filePath} />;
    }

    if (tab.id === "rebase-interactive") {
      return <InteractiveRebaseView baseSha={tab.baseSha} />;
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
      <div
        role="tablist"
        aria-label="Editor tabs"
        className="flex h-9 w-full items-center border-b bg-vscode-tab-bar overflow-x-auto select-none"
      >
        {tabs.map((tab, idx) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              id={`tab-${tab.id}`}
              aria-controls={`tabpanel-${tab.id}`}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveTabId(tab.id)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") {
                  const next = tabs[(idx + 1) % tabs.length];
                  if (next) setActiveTabId(next.id);
                } else if (e.key === "ArrowLeft") {
                  const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
                  if (prev) setActiveTabId(prev.id);
                }
              }}
              className={`flex h-full items-center gap-2 border-r border-vscode-border px-3.5 text-xs cursor-pointer transition-colors ${
                isActive
                  ? "bg-vscode-tab-active text-vscode-fg font-medium border-t-2 border-t-vscode-accent"
                  : "bg-vscode-tab-inactive text-vscode-muted hover:bg-vscode-hover hover:text-vscode-fg"
              }`}
            >
              <span className="truncate max-w-[200px]">{tab.title}</span>
              {tab.closable !== false && (
                <button
                  type="button"
                  title={`Close ${tab.title}`}
                  aria-label={`Close ${tab.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className="rounded p-0.5 hover:bg-vscode-hover hover:text-vscode-fg transition-colors"
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
