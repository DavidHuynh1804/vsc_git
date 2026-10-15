import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DiffView } from "./DiffView";
import { mapMonacoSelectionToLineSelection } from "@/scm/diffUtils";
import { useScmStore } from "@/scm/scmStore";
import { MockScmDataSource } from "@/scm/dataSource";

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
});
