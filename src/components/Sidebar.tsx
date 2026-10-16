import React, { useRef, useState, useCallback, useEffect } from "react";
import { Settings, RefreshCw, FolderOpen } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { useRepoStore } from "@/stores/repo";
import { commands, Settings as AppSettings } from "@/bindings";
import { SourceControlView } from "@/views/SourceControl/SourceControlView";
import { BranchesView } from "@/views/Branches/BranchesView";
import { StashesView } from "@/views/Stashes/StashesView";

export const Sidebar: React.FC = () => {
  const { activeActivity, isSidebarOpen, sidebarWidth, setSidebarWidth, openTab } = useUIStore();
  const { repoRoot, setRepo, setLoading, setError } = useRepoStore();

  const [isDragging, setIsDragging] = useState(false);
  const [settingsData, setSettingsData] = useState<AppSettings | null>(null);
  const dragStartX = useRef(0);
  const initialWidth = useRef(sidebarWidth);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartX.current = e.clientX;
    initialWidth.current = sidebarWidth;
    document.body.style.cursor = "col-resize";
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const delta = e.clientX - dragStartX.current;
      setSidebarWidth(initialWidth.current + delta);
    },
    [isDragging, setSidebarWidth]
  );

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      document.body.style.cursor = "default";
    }
  }, [isDragging]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  useEffect(() => {
    if (activeActivity === "settings") {
      commands.getSettings().then((res) => {
        if (res.status === "ok") {
          setSettingsData(res.data);
        }
      });
    }
  }, [activeActivity]);

  const handleOpenFolder = async () => {
    try {
      setLoading(true);
      const picked = await commands.pickFolder();
      if (picked.status === "ok" && picked.data) {
        const opened = await commands.openRepo(picked.data);
        if (opened.status === "ok") {
          setRepo(opened.data);
        } else {
          setError(opened.error.message);
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to open folder");
    } finally {
      setLoading(false);
    }
  };

  if (!isSidebarOpen) {
    return null;
  }

  const renderContent = () => {
    if (!repoRoot && activeActivity !== "settings" && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      return (
        <div className="flex flex-col items-center justify-center p-6 text-center text-vscode-muted gap-3">
          <p className="text-xs">No repository currently opened in this window.</p>
          <button
            type="button"
            onClick={handleOpenFolder}
            className="flex items-center gap-1.5 rounded bg-vscode-accent px-3 py-1.5 text-xs text-white hover:opacity-90"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span>Open Repository</span>
          </button>
        </div>
      );
    }

    switch (activeActivity) {
      case "changes":
        return <SourceControlView />;
      case "graph":
        return (
          <div className="flex flex-col p-3 gap-3">
            <div className="flex items-center justify-between border-b pb-2 text-vscode-muted">
              <span className="font-semibold text-xs tracking-wider">GIT GRAPH</span>
              <span className="text-[11px] bg-vscode-badge px-1.5 py-0.2 rounded text-white font-mono">
                M2
              </span>
            </div>
            <div className="rounded border bg-vscode-bg p-3 text-xs text-vscode-muted">
              <p>Commit topology, virtual lanes, and interactive graph history view (M2).</p>
            </div>
          </div>
        );

      case "branches":
        return <BranchesView />;

      case "stashes":
        return <StashesView />;

      case "settings":
        return (
          <div className="flex flex-col p-3 gap-3 overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-2 text-vscode-muted">
              <span className="font-semibold text-xs tracking-wider">SETTINGS</span>
              <Settings className="h-3.5 w-3.5" />
            </div>
            <button
              type="button"
              onClick={() => openTab({ id: "settings", title: "Settings", closable: true })}
              className="flex items-center justify-center gap-1.5 rounded bg-vscode-accent px-3 py-1.5 text-xs text-white hover:opacity-90 font-medium"
            >
              <span>Open Settings Editor</span>
            </button>
            {settingsData ? (
              <div className="flex flex-col gap-2.5 text-xs text-vscode-muted">
                <div>
                  <span className="text-vscode-fg font-medium block">UI Theme</span>
                  <span className="text-[11px]">{settingsData["ui.theme"]}</span>
                </div>
                <div>
                  <span className="text-vscode-fg font-medium block">Auto Fetch</span>
                  <span className="text-[11px]">
                    {settingsData["git.autoFetch"] ? "Enabled (every 180s)" : "Disabled"}
                  </span>
                </div>
                <div>
                  <span className="text-vscode-fg font-medium block">Smart Commit</span>
                  <span className="text-[11px]">{settingsData["git.enableSmartCommit"]}</span>
                </div>
                <div>
                  <span className="text-vscode-fg font-medium block">External Editor</span>
                  <span className="text-[11px]">{settingsData["externalEditor.command"]}</span>
                </div>
                <div>
                  <span className="text-vscode-fg font-medium block">AI Model</span>
                  <span className="text-[11px]">{settingsData["ai.model"]}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-vscode-muted">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>Loading settings...</span>
              </div>
            )}
          </div>
        );
    }
  };

  const getTitle = () => {
    switch (activeActivity) {
      case "changes":
        return "Source Control";
      case "graph":
        return "Git Graph";
      case "branches":
        return "Branches";
      case "stashes":
        return "Stashes";
      case "settings":
        return "Settings";
    }
  };

  return (
    <aside
      aria-label={getTitle()}
      className="relative flex flex-shrink-0 flex-col border-r bg-vscode-sidebar select-none min-w-0"
      style={{ width: `${sidebarWidth}px` }}
    >
      <div className="flex h-9 items-center justify-between border-b px-3 text-[11px] font-semibold uppercase text-vscode-muted tracking-wider">
        <span>{getTitle()}</span>
      </div>

      <div className="flex-1 overflow-y-auto">{renderContent()}</div>

      {/* Resize handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={sidebarWidth}
        aria-valuemin={180}
        aria-valuemax={700}
        tabIndex={0}
        onMouseDown={handleMouseDown}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setSidebarWidth(sidebarWidth - 10);
          if (e.key === "ArrowRight") setSidebarWidth(sidebarWidth + 10);
        }}
        className="absolute top-0 right-0 h-full cursor-col-resize hover:bg-vscode-accent active:bg-vscode-accent transition-colors z-10"
        style={{ width: "4px" }}
      />
    </aside>
  );
};
