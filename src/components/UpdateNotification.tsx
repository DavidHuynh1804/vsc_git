import { useEffect, useState, useCallback } from "react";
import type { Update, DownloadEvent } from "@tauri-apps/plugin-updater";
import { check } from "@tauri-apps/plugin-updater";
import { RefreshCw, X, Download } from "lucide-react";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function UpdateNotification() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const checkForUpdate = useCallback(async () => {
    try {
      const updateResult = await check();
      if (updateResult?.available) {
        setUpdate(updateResult);
        setDismissed(false);
      }
    } catch {
      // In dev mode, browser environment, or network offline, ignore silently
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void checkForUpdate();
    }, 4000);

    const interval = setInterval(() => {
      void checkForUpdate();
    }, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [checkForUpdate]);

  const handleUpdateAndRestart = async () => {
    if (!update || isUpdating) return;

    setIsUpdating(true);
    setStatusText("Đang tải bản cập nhật...");

    try {
      let downloaded = 0;
      let total = 0;

      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started" && event.data.contentLength) {
          total = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) {
            const pct = Math.round((downloaded / total) * 100);
            setStatusText(`Đang tải... ${pct}%`);
          }
        } else if (event.event === "Finished") {
          setStatusText("Đã cập nhật xong. Khởi động lại ứng dụng để áp dụng.");
        }
      });
    } catch (err) {
      setIsUpdating(false);
      setStatusText(
        `Lỗi cập nhật: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  if (!update || dismissed) {
    return null;
  }

  return (
    <div
      role="alert"
      className="fixed bottom-12 right-4 z-50 flex max-w-sm flex-col gap-2 rounded border border-vscode-border bg-vscode-sidebar p-3 shadow-xl text-xs text-vscode-fg"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 font-medium">
          <Download className="h-4 w-4 text-vscode-accent shrink-0" />
          <span>Có bản cập nhật mới (v{update.version})</span>
        </div>
        <button
          type="button"
          aria-label="Đóng thông báo"
          className="text-vscode-muted hover:text-vscode-fg transition-colors"
          onClick={() => setDismissed(true)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {statusText ? (
        <div className="flex items-center gap-1.5 text-vscode-muted">
          <RefreshCw className="h-3 w-3 animate-spin" />
          <span>{statusText}</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 mt-1">
          <button
            type="button"
            disabled={isUpdating}
            className="flex items-center gap-1.5 rounded bg-vscode-accent px-2.5 py-1 text-white hover:bg-vscode-accent-hover transition-colors font-medium disabled:opacity-50"
            onClick={handleUpdateAndRestart}
          >
            <RefreshCw className={`h-3 w-3 ${isUpdating ? "animate-spin" : ""}`} />
            <span>Cập nhật & khởi động lại</span>
          </button>
          <button
            type="button"
            className="rounded border border-vscode-border px-2 py-1 text-vscode-muted hover:text-vscode-fg transition-colors"
            onClick={() => setDismissed(true)}
          >
            Để sau
          </button>
        </div>
      )}
    </div>
  );
}
