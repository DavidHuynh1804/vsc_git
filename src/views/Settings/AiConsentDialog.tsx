import React, { useState } from "react";
import { AiConsentDataSource } from "@/integrations/types";
import { ShieldAlert, Check, X } from "lucide-react";

export interface AiConsentDialogProps {
  isOpen: boolean;
  repoPath: string;
  provider: string;
  host: string;
  consentDataSource: AiConsentDataSource;
  onConfirm: () => void;
  onCancel: () => void;
}

export const AiConsentDialog: React.FC<AiConsentDialogProps> = ({
  isOpen,
  repoPath,
  provider,
  host,
  consentDataSource,
  onConfirm,
  onCancel,
}) => {
  const [remember, setRemember] = useState(true);

  if (!isOpen) {
    return null;
  }

  const handleContinue = () => {
    if (remember) {
      consentDataSource.setConsent(repoPath, provider, true);
    }
    onConfirm();
  };

  const handleCancel = () => {
    onCancel();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-consent-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 select-none backdrop-blur-[1px]"
    >
      <div className="flex w-full max-w-md flex-col rounded-lg border border-vscode-border bg-vscode-sidebar p-5 shadow-2xl text-vscode-fg">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-amber-500/10 p-2 text-amber-500">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h3 id="ai-consent-title" className="text-sm font-semibold text-vscode-fg">
              Xác nhận gửi dữ liệu qua AI (AI Consent)
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-vscode-muted">
              Diff staged sẽ được gửi tới <strong>{provider}</strong> ({host}). Tiếp tục?
            </p>
            <p className="mt-1.5 text-[11px] text-vscode-muted/80">
              Repository: <span className="font-mono text-vscode-fg">{repoPath}</span>
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded bg-vscode-bg p-2.5 border border-vscode-border">
          <input
            id="remember-ai-consent"
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-4 w-4 rounded accent-vscode-accent"
          />
          <label htmlFor="remember-ai-consent" className="text-xs text-vscode-fg cursor-pointer">
            Nhớ lựa chọn cho repository này
          </label>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={handleCancel}
            className="inline-flex items-center gap-1.5 rounded border border-vscode-border bg-vscode-hover px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-bg transition-colors"
          >
            <X className="h-3.5 w-3.5" />
            <span>Huỷ</span>
          </button>
          <button
            type="button"
            onClick={handleContinue}
            className="inline-flex items-center gap-1.5 rounded bg-vscode-accent px-3 py-1.5 text-xs text-white hover:opacity-90 transition-opacity font-medium"
          >
            <Check className="h-3.5 w-3.5" />
            <span>Tiếp tục</span>
          </button>
        </div>
      </div>
    </div>
  );
};
