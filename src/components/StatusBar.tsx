import React, { useEffect } from "react";
import { GitBranch, Terminal, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { useRepoStore } from "@/stores/repo";
import { useUIStore } from "@/stores/ui";
import { commands } from "@/bindings";

export const StatusBar: React.FC = () => {
  const { headBranch, gitVersion, setGitVersion } = useRepoStore();
  const { isGitOutputOpen, toggleGitOutput } = useUIStore();

  useEffect(() => {
    commands.gitVersion().then((res) => {
      if (res.status === "ok") {
        setGitVersion(res.data);
      }
    });
  }, [setGitVersion]);

  return (
    <footer className="flex h-6 w-full items-center justify-between bg-vscode-statusbar px-2 text-[11px] text-white select-none">
      <div className="flex items-center gap-3">
        {headBranch ? (
          <div className="inline-flex items-center gap-1 hover:bg-vscode-hover px-1.5 py-0.5 rounded cursor-pointer">
            <GitBranch className="h-3 w-3" />
            <span>{headBranch}</span>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1 text-white opacity-80 px-1.5 py-0.5">
            <span>No Repo</span>
          </div>
        )}

        <div className="inline-flex items-center gap-1 hover:bg-vscode-hover px-1.5 py-0.5 rounded cursor-pointer opacity-90">
          <RefreshCw className="h-2.5 w-2.5" />
          <span>↓0 ↑0</span>
        </div>

        {gitVersion && (
          <div
            title={`Git version ${gitVersion}`}
            className="inline-flex items-center gap-1 text-[10px] opacity-80 px-1"
          >
            <CheckCircle2 className="h-2.5 w-2.5 text-success" />
            <span>git {gitVersion}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggleGitOutput}
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded transition-colors ${
            isGitOutputOpen ? "bg-vscode-active font-medium" : "hover:bg-vscode-hover opacity-90"
          }`}
          title="Toggle Git Output panel"
        >
          <Terminal className="h-3 w-3" />
          <span>Git Output</span>
        </button>

        <div className="inline-flex items-center gap-1 opacity-75 px-1">
          <AlertTriangle className="h-2.5 w-2.5" />
          <span>M0 Shell</span>
        </div>
      </div>
    </footer>
  );
};
