import { RebaseAction, RebaseTodoEntry } from "@/m3/types";

export interface RebaseValidationResult {
  isValid: boolean;
  error?: string;
}

export function validateRebaseTodo(entries: RebaseTodoEntry[]): RebaseValidationResult {
  if (entries.length === 0) {
    return {
      isValid: false,
      error: "Rebase todo list is empty.",
    };
  }

  const firstAction = entries[0].action;
  if (firstAction === "squash" || firstAction === "fixup") {
    return {
      isValid: false,
      error: `Cannot '${firstAction}' the first commit. The first commit must be picked, reworded, edited, or dropped.`,
    };
  }

  const hasNonDrop = entries.some((e) => e.action !== "drop");
  if (!hasNonDrop) {
    return {
      isValid: true,
      error: "Warning: All commits will be dropped, abandoning the branch changes.",
    };
  }

  return { isValid: true };
}

export function moveEntry(
  entries: RebaseTodoEntry[],
  fromIndex: number,
  toIndex: number
): RebaseTodoEntry[] {
  if (
    fromIndex < 0 ||
    fromIndex >= entries.length ||
    toIndex < 0 ||
    toIndex >= entries.length ||
    fromIndex === toIndex
  ) {
    return entries;
  }

  const next = [...entries];
  const [removed] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, removed);
  return next;
}

export function serializeRebaseTodo(entries: RebaseTodoEntry[]): string {
  return (
    entries
      .map((entry) => `${entry.action} ${entry.sha} ${entry.subject}`)
      .join("\n") + "\n"
  );
}

const ACTION_MAP: Record<string, RebaseAction> = {
  p: "pick",
  pick: "pick",
  r: "reword",
  reword: "reword",
  e: "edit",
  edit: "edit",
  s: "squash",
  squash: "squash",
  f: "fixup",
  fixup: "fixup",
  d: "drop",
  drop: "drop",
  x: "exec",
  exec: "exec",
  b: "break",
  break: "break",
};

export function parseRebaseTodo(text: string): RebaseTodoEntry[] {
  const lines = text.split("\n");
  const entries: RebaseTodoEntry[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length >= 3) {
      const action = ACTION_MAP[parts[0].toLowerCase()];
      if (action) {
        entries.push({
          action,
          sha: parts[1],
          subject: parts.slice(2).join(" "),
        });
      }
    }
  }
  return entries;
}
