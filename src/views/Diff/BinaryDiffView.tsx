import React from "react";
import { FileWarning, Download } from "lucide-react";
import { useScmStore } from "@/scm/scmStore";

export interface BinaryDiffViewProps {
  filePath: string;
}

export const BinaryDiffView: React.FC<BinaryDiffViewProps> = ({ filePath }) => {
  const { dataSource } = useScmStore();

  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8 text-center text-vscode-muted gap-4 bg-vscode-bg">
      <div className="rounded-full bg-vscode-sidebar p-4 border border-vscode-border">
        <FileWarning className="h-10 w-10 text-vscode-accent" />
      </div>

      <div className="flex flex-col gap-1 max-w-md">
        <h3 className="text-sm font-semibold text-vscode-fg">{filePath}</h3>
        <p className="text-xs text-vscode-muted">
          Binary file or large file (&gt; 5 MB) cannot be displayed in text diff editor.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void dataSource.openInEditor(filePath)}
          className="flex items-center gap-1.5 rounded border border-vscode-border bg-vscode-sidebar px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-hover"
        >
          <Download className="h-3.5 w-3.5" />
          <span>Open with External Application</span>
        </button>
      </div>
    </div>
  );
};
