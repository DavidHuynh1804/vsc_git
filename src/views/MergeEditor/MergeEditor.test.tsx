import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MergeEditorView } from "./MergeEditorView";
import { NonTextConflictDialog } from "./NonTextConflictDialog";
import { useM3Store } from "@/m3/m3Store";
import { MockM3DataSource } from "@/m3/dataSource";
import { useScmStore } from "@/scm/scmStore";
vi.mock("@/monaco/monacoLoader", () => ({
  monaco: {},
}));

vi.mock("@monaco-editor/react", () => ({
  loader: { config: vi.fn() },
  Editor: ({
    value,
    options,
    onMount,
  }: {
    value?: string;
    options?: { readOnly?: boolean };
    onMount?: (editor: {
      getValue: () => string;
      setValue: (v: string) => void;
      onDidChangeModelContent: (cb: () => void) => void;
      revealLineInCenter: (l: number) => void;
      setPosition: (p: { lineNumber: number; column: number }) => void;
      focus: () => void;
    }) => void;
  }) => {
    let internalValue = value ?? "";
    const changeListeners: Array<() => void> = [];

    const mockEditor = {
      getValue: () => internalValue,
      setValue: (v: string) => {
        internalValue = v;
        for (const cb of changeListeners) cb();
      },
      onDidChangeModelContent: (cb: () => void) => {
        changeListeners.push(cb);
      },
      revealLineInCenter: vi.fn(),
      setPosition: vi.fn(),
      focus: vi.fn(),
    };

    if (onMount) {
      setTimeout(() => onMount(mockEditor), 0);
    }

    return (
      <textarea
        data-testid={options?.readOnly ? "monaco-readonly" : "monaco-editable"}
        value={value}
        readOnly={options?.readOnly}
        onChange={(e) => {
          internalValue = e.target.value;
          for (const cb of changeListeners) cb();
        }}
      />
    );
  },
}));

describe("MergeEditorView", () => {
  let mockDs: MockM3DataSource;

  beforeEach(() => {
    mockDs = new MockM3DataSource();
    useM3Store.getState().setDataSource(mockDs);
  });

  it("renders 3 panes (Current, Incoming, Result) and loads conflict text", async () => {
    render(<MergeEditorView filePath="src/App.tsx" />);

    await waitFor(() => {
      expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
      expect(screen.getByText(/Current \(Ours, :2\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Incoming \(Theirs, :3\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Result \(Working Tree/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/1 conflict remaining/i)).toBeInTheDocument();
  });

  it("toggles Base pane visibility on Base (:1) button click", async () => {
    render(<MergeEditorView filePath="src/App.tsx" />);

    await waitFor(() => {
      expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
    });

    expect(screen.queryByText(/Base \(:1\)/i)).toBeInTheDocument(); // button exists
    expect(screen.queryByText("Base (:1)", { selector: "span" })).toBeInTheDocument();

    const baseBtn = screen.getByRole("button", { name: /Base \(:1\)/i });
    fireEvent.click(baseBtn);

    // Now Base pane header should be visible
    expect(screen.getAllByText(/Base \(:1\)/i).length).toBeGreaterThan(1);
  });

  it("accepts Current change and resolves the conflict marker in Result", async () => {
    render(<MergeEditorView filePath="src/App.tsx" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Accept Current/i })).toBeInTheDocument();
    });

    const acceptCurrentBtn = screen.getByRole("button", { name: /Accept Current/i });
    fireEvent.click(acceptCurrentBtn);

    await waitFor(() => {
      expect(screen.getByText(/All conflicts resolved/i)).toBeInTheDocument();
    });
  });

  it("warns when Mark as Resolved is clicked with conflict markers remaining", async () => {
    render(<MergeEditorView filePath="src/App.tsx" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Mark as Resolved/i })).toBeInTheDocument();
    });

    const markResolvedBtn = screen.getByRole("button", { name: /Mark as Resolved/i });
    fireEvent.click(markResolvedBtn);

    await waitFor(() => {
      expect(screen.getByText("Unresolved Conflict Markers Detected")).toBeInTheDocument();
    });
  });

  it("marks as resolved directly and calls save and stage when no markers remain", async () => {
    const onResolved = vi.fn();
    const saveSpy = vi.spyOn(mockDs, "saveWorktreeFile");
    const stageSpy = vi.spyOn(useScmStore.getState(), "stage");

    render(<MergeEditorView filePath="src/App.tsx" onResolved={onResolved} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Accept Current/i })).toBeInTheDocument();
    });

    // Resolve conflict
    fireEvent.click(screen.getByRole("button", { name: /Accept Current/i }));

    await waitFor(() => {
      expect(screen.getByText(/All conflicts resolved/i)).toBeInTheDocument();
    });

    // Mark as resolved
    fireEvent.click(screen.getByRole("button", { name: /Mark as Resolved/i }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith("src/App.tsx", expect.not.stringContaining("<<<<<<<"));
      expect(stageSpy).toHaveBeenCalledWith(["src/App.tsx"]);
      expect(onResolved).toHaveBeenCalledTimes(1);
    });
  });
});

describe("NonTextConflictDialog", () => {
  it("renders non-text conflict actions (Ours, Theirs, Delete)", () => {
    const onResolve = vi.fn();
    render(
      <NonTextConflictDialog
        filePath="images/logo.png"
        conflictKind="BothModified"
        onResolve={onResolve}
      />
    );

    expect(screen.getByText("Non-Text Merge Conflict")).toBeInTheDocument();
    expect(screen.getByText("images/logo.png")).toBeInTheDocument();

    const keepOursBtn = screen.getByRole("button", { name: /Keep Ours/i });
    fireEvent.click(keepOursBtn);
    expect(onResolve).toHaveBeenCalledWith("Ours");

    const keepTheirsBtn = screen.getByRole("button", { name: /Keep Theirs/i });
    fireEvent.click(keepTheirsBtn);
    expect(onResolve).toHaveBeenCalledWith("Theirs");

    const deleteBtn = screen.getByRole("button", { name: /Delete File/i });
    fireEvent.click(deleteBtn);
    expect(onResolve).toHaveBeenCalledWith("Delete");
  });
});
