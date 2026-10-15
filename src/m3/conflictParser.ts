import { ConflictRegion } from "./types";

export function detectEol(content: string): "\r\n" | "\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

export function countConflictMarkers(content: string): number {
  const lines = content.split(/\r?\n/);
  let count = 0;
  for (const line of lines) {
    if (line.startsWith("<<<<<<<")) {
      count++;
    }
  }
  return count;
}

export function parseConflictRegions(content: string): {
  eol: "\r\n" | "\n";
  regions: ConflictRegion[];
  hasDiff3: boolean;
} {
  const eol = detectEol(content);
  const lines = content.split(/\r?\n/);
  const regions: ConflictRegion[] = [];
  let hasDiff3 = false;

  let currentRegion: {
    id: number;
    startLine: number;
    currentHeader: string;
    baseHeader?: string;
    incomingHeader: string;
    currentLines: string[];
    baseLines?: string[];
    incomingLines: string[];
    state: "current" | "base" | "incoming";
  } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (line.startsWith("<<<<<<<")) {
      currentRegion = {
        id: regions.length + 1,
        startLine: lineNo,
        currentHeader: line.slice(7).trim(),
        incomingHeader: "",
        currentLines: [],
        incomingLines: [],
        state: "current",
      };
      continue;
    }

    if (!currentRegion) {
      continue;
    }

    if (line.startsWith("|||||||")) {
      hasDiff3 = true;
      currentRegion.state = "base";
      currentRegion.baseHeader = line.slice(7).trim();
      currentRegion.baseLines = [];
      continue;
    }

    if (line.startsWith("=======")) {
      currentRegion.state = "incoming";
      continue;
    }

    if (line.startsWith(">>>>>>>")) {
      currentRegion.incomingHeader = line.slice(7).trim();
      regions.push({
        id: currentRegion.id,
        startLine: currentRegion.startLine,
        endLine: lineNo,
        current: currentRegion.currentLines.join(eol),
        base: currentRegion.baseLines ? currentRegion.baseLines.join(eol) : undefined,
        incoming: currentRegion.incomingLines.join(eol),
        currentHeader: currentRegion.currentHeader,
        baseHeader: currentRegion.baseHeader,
        incomingHeader: currentRegion.incomingHeader,
      });
      currentRegion = null;
      continue;
    }

    if (currentRegion.state === "current") {
      currentRegion.currentLines.push(line);
    } else if (currentRegion.state === "base") {
      currentRegion.baseLines?.push(line);
    } else if (currentRegion.state === "incoming") {
      currentRegion.incomingLines.push(line);
    }
  }

  return { eol, regions, hasDiff3 };
}

export function resolveConflictRegion(
  content: string,
  regionId: number,
  choice: "current" | "incoming" | "both" | "base"
): string {
  const { eol, regions } = parseConflictRegions(content);
  const target = regions.find((r) => r.id === regionId);
  if (!target) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  // target.startLine and target.endLine are 1-based inclusive
  const beforeLines = lines.slice(0, target.startLine - 1);
  const afterLines = lines.slice(target.endLine);

  let replacement: string[];
  switch (choice) {
    case "current":
      replacement = target.current.length > 0 ? target.current.split(/\r?\n/) : [];
      break;
    case "incoming":
      replacement = target.incoming.length > 0 ? target.incoming.split(/\r?\n/) : [];
      break;
    case "both": {
      const c = target.current.length > 0 ? target.current.split(/\r?\n/) : [];
      const inc = target.incoming.length > 0 ? target.incoming.split(/\r?\n/) : [];
      replacement = [...c, ...inc];
      break;
    }
    case "base":
      replacement =
        target.base !== undefined && target.base.length > 0
          ? target.base.split(/\r?\n/)
          : [];
      break;
  }

  return [...beforeLines, ...replacement, ...afterLines].join(eol);
}
