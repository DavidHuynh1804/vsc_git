import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DiffView } from "./DiffView";
import { mapMonacoSelectionToLineSelection } from "@/scm/diffUtils";
import { useScmStore } from "@/scm/scmStore";
import { MockScmDataSource } from "@/scm/dataSource";
import type { FileRev, StatusEntry } from "@/scm/types";

vi.mock("@/monaco/monacoLoader", () => ({
  monaco: {},
}));

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: ({ original, modified }: { original: string; modified: string }) => (
    <div data-testid="diff-editor">
      <span data-testid="original-content">{original}</span>
      <span data-testid="modified-content">{modified}</span>
    </div>
  ),
}));

describe("Diff mapping", () => {
  it("maps selections to LineSelection on Original side", () => {
    const sel = mapMonacoSelectionToLineSelection("Original", 5, 9);
    expect(sel.side).toBe("Original");
    expect(sel.start).toBe(5);
    expect(sel.end).toBe(9);
  });

  it("maps selections to LineSelection on Modified side with reversed lines", () => {
    const sel = mapMonacoSelectionToLineSelection("Modified", 20, 15);
    expect(sel.side).toBe("Modified");
    expect(sel.start).toBe(15);
    expect(sel.end).toBe(20);
  });
});

describe("DiffView", () => {
  beforeEach(async () => {
    const ds = new MockScmDataSource();
    useScmStore.getState().setDataSource(ds);
    await useScmStore.getState().refreshStatus();
  });

  it("shows binary diff for binary file", async () => {
    render(<DiffView filePath="src/app.zip" />);
    await waitFor(() => {
      expect(
        screen.getByText(/Binary file or large file \(> 5 MB\) cannot be displayed/)
      ).toBeInTheDocument();
    });
  });

  it("loads diff and shows Monaco editor for text file", async () => {
    render(<DiffView filePath="src/app.ts" />);
    await waitFor(() => {
      expect(screen.getByTestId("diff-editor")).toBeInTheDocument();
    });
  });

  describe("files missing on one side", () => {
    // Mirrors the backend: `git show` fails for a path absent from HEAD or the index.
    class MissingSidesDataSource extends MockScmDataSource {
      constructor(
        private sides: Record<string, string>,
        private entries: StatusEntry[]
      ) {
        super();
      }
      async getStatus() {
        return { ...(await super.getStatus()), entries: this.entries };
      }
      async fileContent(path: string, rev: FileRev): Promise<string> {
        const key = `${rev.kind}:${path}`;
        if (key in this.sides) return this.sides[key];
        throw new Error(`fatal: path '${path}' does not exist in ${rev.kind}`);
      }
    }

    const loadSource = async (sides: Record<string, string>, entries: StatusEntry[]) => {
      useScmStore.getState().setDataSource(new MissingSidesDataSource(sides, entries));
      await useScmStore.getState().refreshStatus();
    };

    it("shows the full content of an untracked file", async () => {
      await loadSource({ "Worktree:change.txt": "hello" }, [
        { path: "change.txt", kind: { type: "Untracked" } },
      ]);

      render(<DiffView filePath="change.txt" context="untracked" />);
      await waitFor(() => {
        expect(screen.getByTestId("modified-content")).toHaveTextContent("hello");
      });
      expect(screen.getByTestId("original-content")).toHaveTextContent("");
    });

    it("shows a newly added staged file against an empty HEAD", async () => {
      await loadSource({ "Index:new.txt": "added" }, [
        { path: "new.txt", kind: { type: "Ordinary", staged: "Added", unstaged: "Unmodified" } },
      ]);

      render(<DiffView filePath="new.txt" context="staged" />);
      await waitFor(() => {
        expect(screen.getByTestId("modified-content")).toHaveTextContent("added");
      });
    });

    it("shows a staged deletion against an empty index", async () => {
      await loadSource({ "Head:gone.txt": "old" }, [
        { path: "gone.txt", kind: { type: "Ordinary", staged: "Deleted", unstaged: "Unmodified" } },
      ]);

      render(<DiffView filePath="gone.txt" context="staged" />);
      await waitFor(() => {
        expect(screen.getByTestId("original-content")).toHaveTextContent("old");
      });
    });

    it("reads the original side of a staged rename from its old path", async () => {
      await loadSource({ "Head:old-name.txt": "before", "Index:new-name.txt": "after" }, [
        {
          path: "new-name.txt",
          kind: {
            type: "RenamedOrCopied",
            staged: "Renamed",
            unstaged: "Unmodified",
            is_rename: true,
            score: 90,
            orig_path: "old-name.txt",
          },
        },
      ]);

      render(<DiffView filePath="new-name.txt" context="staged" />);
      await waitFor(() => {
        expect(screen.getByTestId("original-content")).toHaveTextContent("before");
        expect(screen.getByTestId("modified-content")).toHaveTextContent("after");
      });
    });
  });
});
