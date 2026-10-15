import React, { useEffect, useState, useRef } from "react";
import { Terminal, Trash2, X, CheckCircle2, AlertCircle } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { commands, events, GitOutputEntry } from "@/bindings";

export const GitOutputPanel: React.FC = () => {
  const { isGitOutputOpen, toggleGitOutput } = useUIStore();
  const [logs, setLogs] = useState<GitOutputEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load existing logs on mount
  useEffect(() => {
    commands.getGitOutput().then((res) => {
      if (res.status === "ok") {
        setLogs(res.data);
      }
    });

    // Listen to real-time git://output events
    const unlistenPromise = events.gitOutput.listen((event) => {
      setLogs((prev) => [...prev, event.payload]);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Scroll to bottom on new log
  useEffect(() => {
    if (scrollRef.current && isGitOutputOpen) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isGitOutputOpen]);

  if (!isGitOutputOpen) {
    return null;
  }

  const handleClear = () => {
    setLogs([]);
  };

  return (
    <section
      aria-label="Git Output"
      className="flex h-56 w-full flex-col border-t bg-vscode-output select-text font-mono text-xs min-h-0"
    >
      {/* Header */}
      <div className="flex h-7 w-full items-center justify-between border-b bg-vscode-activity px-3 select-none text-vscode-muted">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-vscode-accent" />
          <span className="font-semibold text-vscode-fg">GIT OUTPUT</span>
          <span className="text-[10px] rounded bg-vscode-badge px-1.5 py-0.2 text-white">
            {logs.length} entries
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            title="Clear output"
            onClick={handleClear}
            className="rounded p-1 hover:bg-vscode-hover hover:text-vscode-fg"
          >
            <Trash2 className="h-3 w-3" />
          </button>
          <button
            type="button"
            title="Close panel"
            onClick={toggleGitOutput}
            className="rounded p-1 hover:bg-vscode-hover hover:text-vscode-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Log list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-1.5">
        {logs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-vscode-muted text-xs italic select-none">
            No git commands executed yet.
          </div>
        ) : (
          logs.map((entry) => {
            const isSuccess = entry.exit_code === 0;
            return (
              <div
                key={entry.id}
                className="flex flex-col gap-0.5 rounded border border-vscode-border bg-vscode-bg p-2 text-[11px]"
              >
                <div className="flex items-center justify-between text-vscode-muted">
                  <div className="flex items-center gap-1.5 font-semibold text-vscode-fg">
                    {isSuccess ? (
                      <CheckCircle2 className="h-3 w-3 text-success flex-shrink-0" />
                    ) : (
                      <AlertCircle className="h-3 w-3 text-error flex-shrink-0" />
                    )}
                    <span className="text-vscode-accent">&gt;</span>
                    <span className="text-vscode-fg">{entry.cmd}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="opacity-75">{entry.duration_ms}ms</span>
                    <span className={isSuccess ? "text-success" : "text-error"}>
                      exit {entry.exit_code}
                    </span>
                  </div>
                </div>

                <div className="text-[10px] text-vscode-muted">cwd: {entry.cwd}</div>

                {entry.stdout && (
                  <pre className="mt-1 whitespace-pre-wrap rounded bg-vscode-input p-1.5 text-vscode-fg text-[11px] leading-tight">
                    {entry.stdout.trim()}
                  </pre>
                )}

                {entry.stderr && (
                  <pre className="mt-1 whitespace-pre-wrap rounded bg-vscode-input p-1.5 text-error text-[11px] leading-tight">
                    {entry.stderr.trim()}
                  </pre>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
