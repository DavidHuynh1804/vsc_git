import React, { useEffect } from "react";
import { GitBranch, Terminal, RefreshCw, CheckCircle2, X } from "lucide-react";
import { useRepoStore } from "@/stores/repo";
import { useUIStore } from "@/stores/ui";
import { useScmStore } from "@/scm/scmStore";
import { commands } from "@/bindings";

export const StatusBar: React.FC = () => {
  const { headBranch, gitVersion, setGitVersion } = useRepoStore();
  const { isGitOutputOpen, toggleGitOutput } = useUIStore();
  const { status, activeJobs, sync, cancelJob } = useScmStore();

  useEffect(() => {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      commands.gitVersion().then((res) => {
        if (res.status === "ok") {
          setGitVersion(res.data);
        }
      });
    }
  }, [setGitVersion]);

  const currentBranch = status?.branch.head || headBranch;
  const ahead = status?.branch.ahead ?? 0;
  const behind = status?.branch.behind ?? 0;

  const jobsList = Array.from(activeJobs.values());

  return (
    <footer className="flex h-6 w-full items-center justify-between bg-vscode-statusbar px-2 text-[11px] text-white select-none">
      <div className="flex items-center gap-3">
        {currentBranch ? (
          <div
            title={`Current branch: ${currentBranch}`}
            className="inline-flex items-center gap-1 hover:bg-vscode-hover px-1.5 py-0.5 rounded cursor-pointer"
          >
            <GitBranch className="h-3 w-3" />
            <span>{currentBranch}</span>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1 text-white opacity-80 px-1.5 py-0.5">
            <span>No Repo</span>
          </div>
        )}

        <button
          type="button"
          onClick={() => void sync()}
          title="Sync with remote (Click to pull and push)"
          className="inline-flex items-center gap-1 hover:bg-vscode-hover px-1.5 py-0.5 rounded cursor-pointer opacity-90"
        >
          <RefreshCw className="h-2.5 w-2.5" />
          <span>
            ↓{behind} ↑{ahead}
          </span>
        </button>

        {/* Active background jobs */}
        {jobsList.map((job) => (
          <div
            key={job.jobId}
            className="inline-flex items-center gap-1.5 bg-vscode-hover px-2 py-0.5 rounded text-[10px]"
          >
            <RefreshCw className="h-2.5 w-2.5 animate-spin" />
            <span>
              {job.title} {job.percent !== undefined ? `(${job.percent}%)` : "..."}
            </span>
            {job.cancelable !== false && (
              <button
                type="button"
                title="Cancel job"
                onClick={() => void cancelJob(job.jobId)}
                className="rounded p-0.5 hover:bg-vscode-active hover:text-error"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        ))}

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
      </div>
    </footer>
  );
};
