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
    <footer
      aria-label="Status Bar"
      className="flex h-6 w-full items-center justify-between bg-vscode-statusbar px-2 text-[11px] select-none transition-colors"
      style={{ color: "var(--vscode-statusbar-fg)" }}
    >
      <div className="flex items-center gap-2">
        {currentBranch ? (
          <div
            role="status"
            title={`Current branch: ${currentBranch}`}
            className="inline-flex items-center gap-1 hover:bg-white/10 px-1.5 py-0.5 rounded cursor-default font-mono"
          >
            <GitBranch className="h-3 w-3" />
            <span className="font-sans font-medium">{currentBranch}</span>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1 opacity-80 px-1.5 py-0.5">
            <span>No Repo</span>
          </div>
        )}

        <button
          type="button"
          onClick={() => void sync()}
          title={`Sync with remote: ${behind} commits behind, ${ahead} commits ahead`}
          className="inline-flex items-center gap-1 hover:bg-white/10 active:bg-white/20 px-1.5 py-0.5 rounded cursor-pointer transition-colors"
        >
          <RefreshCw className="h-2.5 w-2.5" />
          <span className="font-mono">
            ↓{behind} ↑{ahead}
          </span>
        </button>

        {/* Active background jobs */}
        {jobsList.map((job) => (
          <div
            key={job.jobId}
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-1.5 bg-black/20 px-2 py-0.5 rounded text-[10px]"
          >
            <RefreshCw className="h-2.5 w-2.5 animate-spin" />
            <span>
              {job.title} {job.percent !== undefined ? `(${job.percent}%)` : "…"}
            </span>
            {job.cancelable !== false && (
              <button
                type="button"
                title="Cancel job"
                aria-label={`Cancel ${job.title}`}
                onClick={() => void cancelJob(job.jobId)}
                className="rounded p-0.5 hover:bg-black/30 hover:text-red-200 transition-colors"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        ))}

        {gitVersion && (
          <div
            role="status"
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
          aria-label="Toggle Git Output panel"
          aria-expanded={isGitOutputOpen}
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded transition-colors ${
            isGitOutputOpen ? "bg-black/20 font-medium" : "hover:bg-white/10"
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
