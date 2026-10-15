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
