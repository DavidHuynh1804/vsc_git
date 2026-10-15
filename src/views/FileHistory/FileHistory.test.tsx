import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FileHistoryView } from "./FileHistoryView";
import { useM3Store } from "@/m3/m3Store";
import { MockM3DataSource } from "@/m3/dataSource";
import { useScmStore } from "@/scm/scmStore";

vi.mock("@/monaco/monacoLoader", () => ({
  monaco: {},
}));

vi.mock("@monaco-editor/react", () => ({
  loader: { config: vi.fn() },
  DiffEditor: ({ original, modified }: { original?: string; modified?: string }) => (
    <div data-testid="mock-diff-editor">
      <div data-testid="left-diff">{original}</div>
      <div data-testid="right-diff">{modified}</div>
    </div>
  ),
}));

describe("FileHistoryView Component", () => {
  let mockDs: MockM3DataSource;

  beforeEach(() => {
    mockDs = new MockM3DataSource();
    useM3Store.getState().setDataSource(mockDs);
  });

  it("renders history list with commit subjects, authors, and count", async () => {
    render(<FileHistoryView filePath="src/App.tsx" />);

    await waitFor(() => {
      expect(screen.getByText("History: src/App.tsx")).toBeInTheDocument();
      expect(screen.getByText(/2 commits/i)).toBeInTheDocument();
      expect(screen.getAllByText("fix(app): update version and title formatting").length).toBeGreaterThan(0);
      expect(screen.getByText("feat: initialize root application structure")).toBeInTheDocument();
    });
  });

  it("detects and highlights file renames with path_at_commit", async () => {
    render(<FileHistoryView filePath="src/App.tsx" />);

    await waitFor(() => {
      expect(screen.getByText("Renamed: src/AppOld.tsx")).toBeInTheDocument();
    });
  });

  it("selects a commit and loads its diff against parent", async () => {
    const fileContentSpy = vi.spyOn(useScmStore.getState().dataSource, "fileContent");

    render(<FileHistoryView filePath="src/App.tsx" />);

    await waitFor(() => {
      expect(screen.getByText("feat: initialize root application structure")).toBeInTheDocument();
    });

    const secondCommit = screen.getByText("feat: initialize root application structure");
    fireEvent.click(secondCommit);

    await waitFor(() => {
      expect(screen.getByText("Diff at commit: a1b2c3d")).toBeInTheDocument();
      expect(fileContentSpy).toHaveBeenCalledWith(
        "src/AppOld.tsx",
        expect.objectContaining({ kind: "Commit", sha: "a1b2c3d4e5f67890123456789012345678901234" })
      );
    });
  });
});
