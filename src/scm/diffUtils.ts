import { LineSelection, DiffSide } from "./types";

export interface DiffHunk {
  id: string;
  originalStart: number;
  originalLength: number;
  modifiedStart: number;
  modifiedLength: number;
  originalLines: string[];
  modifiedLines: string[];
}

export function computeHunks(originalText: string, modifiedText: string): DiffHunk[] {
  const orig = originalText ? originalText.split(/\r?\n/) : [];
  const mod = modifiedText ? modifiedText.split(/\r?\n/) : [];

  // Simple LCS diff matrix for lines
  const m = orig.length;
  const n = mod.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (orig[i] === mod[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  type DiffOp = { type: "equal" | "delete" | "add"; origIndex?: number; modIndex?: number };
  const ops: DiffOp[] = [];

  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && orig[i - 1] === mod[j - 1]) {
      ops.push({ type: "equal", origIndex: i - 1, modIndex: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: "add", modIndex: j - 1 });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      ops.push({ type: "delete", origIndex: i - 1 });
      i--;
    }
  }
  ops.reverse();

  // Group contiguous changes into hunks
  const hunks: DiffHunk[] = [];
  let idx = 0;
  let hunkCount = 0;

  while (idx < ops.length) {
    // skip equal lines
    while (idx < ops.length && ops[idx].type === "equal") {
      idx++;
    }
    if (idx >= ops.length) break;

    const startIdx = idx;
    const origLinesInHunk: string[] = [];
    const modLinesInHunk: string[] = [];

    let origStart: number | null = null;
    let modStart: number | null = null;

    while (idx < ops.length && ops[idx].type !== "equal") {
      const op = ops[idx];
      if (op.type === "delete" && op.origIndex !== undefined) {
        if (origStart === null) origStart = op.origIndex + 1;
        origLinesInHunk.push(orig[op.origIndex]);
      } else if (op.type === "add" && op.modIndex !== undefined) {
        if (modStart === null) modStart = op.modIndex + 1;
        modLinesInHunk.push(mod[op.modIndex]);
      }
      idx++;
    }

    // fallback line positions if one side had 0 lines
    if (origStart === null) {
      const prevEqual = ops.slice(0, startIdx).reverse().find((o) => o.origIndex !== undefined);
      origStart = prevEqual?.origIndex !== undefined ? prevEqual.origIndex + 2 : 1;
    }
    if (modStart === null) {
      const prevEqual = ops.slice(0, startIdx).reverse().find((o) => o.modIndex !== undefined);
      modStart = prevEqual?.modIndex !== undefined ? prevEqual.modIndex + 2 : 1;
    }

    hunkCount++;
    hunks.push({
      id: `hunk-${hunkCount}`,
      originalStart: origStart,
      originalLength: origLinesInHunk.length,
      modifiedStart: modStart,
      modifiedLength: modLinesInHunk.length,
      originalLines: origLinesInHunk,
      modifiedLines: modLinesInHunk,
    });
  }

  return hunks;
}

/**
 * Maps a Monaco editor selection to a git LineSelection.
 */
export function mapMonacoSelectionToLineSelection(
  side: DiffSide,
  startLine: number,
  endLine: number
): LineSelection {
  const normStart = Math.min(startLine, endLine);
  const normEnd = Math.max(startLine, endLine);
  return {
    side,
    start: Math.max(1, normStart),
    end: Math.max(1, normEnd),
  };
}

/**
 * Apply selective line edits from modified to original or vice versa.
 */
export function applySelectedLines(
  originalText: string,
  modifiedText: string,
  selections: LineSelection[],
  direction: "stage" | "unstage" | "revert"
): string {
  const hunks = computeHunks(originalText, modifiedText);
  if (hunks.length === 0) return originalText;

  const origLines = originalText ? originalText.split(/\r?\n/) : [];
  const modLines = modifiedText ? modifiedText.split(/\r?\n/) : [];

  if (direction === "stage") {
    // Applying modified selections into original
    const result = [...origLines];
    // Sort selections in reverse order to keep line indices stable
    const sorted = [...selections].sort((a, b) => b.start - a.start);
    for (const sel of sorted) {
      // Find hunk overlapping with sel
      for (const hunk of hunks) {
        if (
          sel.side === "Modified" &&
          sel.start <= hunk.modifiedStart + hunk.modifiedLength - 1 &&
          sel.end >= hunk.modifiedStart
        ) {
          const sliceStart = Math.max(0, sel.start - hunk.modifiedStart);
          const sliceEnd = Math.min(
            hunk.modifiedLength,
            sel.end - hunk.modifiedStart + 1
          );
          const linesToInsert = hunk.modifiedLines.slice(sliceStart, sliceEnd);

          const origInsertPos = Math.max(0, hunk.originalStart - 1);
          result.splice(origInsertPos, hunk.originalLength, ...linesToInsert);
        }
      }
    }
    return result.join("\n");
  }

  if (direction === "unstage" || direction === "revert") {
    // Reverting modified changes back to original
    const result = [...modLines];
    for (const sel of selections) {
      for (const hunk of hunks) {
        if (
          sel.start <= hunk.modifiedStart + hunk.modifiedLength - 1 &&
          sel.end >= hunk.modifiedStart
        ) {
          const targetPos = Math.max(0, hunk.modifiedStart - 1);
          result.splice(targetPos, hunk.modifiedLength, ...hunk.originalLines);
        }
      }
    }
    return result.join("\n");
  }

  return originalText;
}
