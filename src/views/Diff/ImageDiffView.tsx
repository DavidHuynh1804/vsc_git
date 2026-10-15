import React from "react";
import { ImageIcon } from "lucide-react";

export interface ImageDiffViewProps {
  filePath: string;
  originalSrc?: string;
  modifiedSrc?: string;
}

export const ImageDiffView: React.FC<ImageDiffViewProps> = ({
  filePath,
  originalSrc,
  modifiedSrc,
}) => {
  return (
    <div className="flex h-full w-full flex-col p-4 overflow-auto bg-vscode-bg">
      <div className="flex items-center gap-2 border-b border-vscode-border pb-2 mb-4 text-xs text-vscode-muted">
        <ImageIcon className="h-4 w-4 text-vscode-accent" />
        <span className="font-medium text-vscode-fg">Image Diff: {filePath}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
        {/* Left: Original */}
        <div className="flex flex-col items-center justify-center rounded border border-vscode-border bg-vscode-sidebar p-4 overflow-hidden">
          <span className="mb-2 text-[11px] font-semibold text-vscode-muted uppercase tracking-wider">
            Original (Before)
          </span>
          {originalSrc ? (
            <img
              src={originalSrc}
              alt="Original"
              className="max-h-[80%] max-w-[90%] object-contain rounded shadow"
            />
          ) : (
            <div className="text-xs text-vscode-muted italic">Image not present in base</div>
          )}
        </div>

        {/* Right: Modified */}
        <div className="flex flex-col items-center justify-center rounded border border-vscode-border bg-vscode-sidebar p-4 overflow-hidden">
          <span className="mb-2 text-[11px] font-semibold text-vscode-muted uppercase tracking-wider">
            Modified (After)
          </span>
          {modifiedSrc ? (
            <img
              src={modifiedSrc}
              alt="Modified"
              className="max-h-[80%] max-w-[90%] object-contain rounded shadow"
            />
          ) : (
            <div className="text-xs text-vscode-muted italic">File deleted</div>
          )}
        </div>
      </div>
    </div>
  );
};
