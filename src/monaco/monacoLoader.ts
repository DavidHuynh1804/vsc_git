import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";

// Configure @monaco-editor/react to use local bundled monaco instance (never CDN!)
loader.config({ monaco });

if (typeof window !== "undefined") {
  (window as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
    getWorker: function (_moduleId: unknown, _label: string) {
      const workerBlob = new Blob(
        [
          `self.onmessage = function () {
            // local offline worker
          };`,
        ],
        { type: "application/javascript" }
      );
      return new Worker(URL.createObjectURL(workerBlob));
    },
  };
}

export function guessLanguageByPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "json":
    case "jsonc":
      return "json";
    case "css":
    case "scss":
    case "less":
      return "css";
    case "html":
    case "htm":
      return "html";
    case "md":
    case "markdown":
      return "markdown";
    case "rs":
      return "rust";
    case "py":
      return "python";
    case "go":
      return "go";
    case "yaml":
    case "yml":
      return "yaml";
    case "toml":
      return "toml";
    case "sh":
    case "bash":
    case "zsh":
      return "shell";
    case "sql":
      return "sql";
    case "xml":
    case "svg":
      return "xml";
    default:
      return "plaintext";
  }
}

export { monaco };
