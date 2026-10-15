import { useEffect, useState } from "react";
import { Titlebar } from "@/components/Titlebar";
import { ActivityBar } from "@/components/ActivityBar";
import { Sidebar } from "@/components/Sidebar";
import { EditorArea } from "@/components/EditorArea";
import { GitOutputPanel } from "@/components/GitOutputPanel";
import { StatusBar } from "@/components/StatusBar";
import { CommandPalette } from "@/components/CommandPalette";
import { ErrorToast } from "@/components/ErrorToast";
import { useRepoStore } from "@/stores/repo";
import { useScmStore } from "@/scm/scmStore";
import { commands, events } from "@/bindings";
import { AlertCircle, X } from "lucide-react";

export default function App() {
  const { error, setError, setRepo } = useRepoStore();
  const { error: scmError, setError: setScmError } = useScmStore();
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Check initial opened repo if any
  useEffect(() => {
    commands.getCurrentRepo().then((res) => {
      if (res.status === "ok" && res.data) {
        setRepo(res.data);
      }
    });

    // Listen to repository status & refs changes from watcher
    const unlistenStatus = events.repoStatusChanged.listen((event) => {
      setToastMessage(`Status changed in ${event.payload.root}`);
      setTimeout(() => setToastMessage(null), 3000);
    });

    const unlistenRefs = events.repoRefsChanged.listen((event) => {
      setToastMessage(`Refs changed in ${event.payload.root}`);
      setTimeout(() => setToastMessage(null), 3000);
    });

    return () => {
      unlistenStatus.then((u) => u());
      unlistenRefs.then((u) => u());
    };
  }, [setRepo]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-vscode-bg text-vscode-fg">
      <Titlebar />

      <div className="flex flex-1 overflow-hidden min-h-0">
        <ActivityBar />
        <Sidebar />

        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          <EditorArea />
          <GitOutputPanel />
        </div>
      </div>

      <StatusBar />
      <CommandPalette />

      {/* AppError Toast per spec 12 */}
      {scmError && (
        <ErrorToast error={scmError} onClose={() => setScmError(null)} />
      )}

      {/* Legacy/Simple error notification banner */}
      {error && !scmError && (
        <div className="fixed bottom-8 right-4 z-50 flex max-w-md items-center justify-between gap-3 rounded border border-error bg-vscode-sidebar p-3 shadow-lg text-xs">
          <div className="flex items-center gap-2 text-error">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span className="text-vscode-fg">{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="rounded p-1 hover:bg-vscode-hover text-vscode-muted hover:text-vscode-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Status change toast notification */}
      {toastMessage && (
        <div className="fixed bottom-8 left-16 z-50 flex items-center gap-2 rounded border border-vscode-border bg-vscode-input px-3 py-1.5 shadow-lg text-xs text-vscode-fg">
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
