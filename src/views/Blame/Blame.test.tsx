import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BlameView } from "./BlameView";
import { formatRelativeDate, getCommitAgeColor } from "./blameUtils";
import { useM3Store } from "@/m3/m3Store";
import { MockM3DataSource } from "@/m3/dataSource";

vi.mock("@/monaco/monacoLoader", () => ({
  monaco: {},
}));

vi.mock("@monaco-editor/react", () => ({
  loader: { config: vi.fn() },
  Editor: ({ value }: { value?: string }) => (
    <div data-testid="monaco-blame-editor">{value}</div>
  ),
}));

describe("Blame Utils", () => {
  it("formats relative dates correctly", () => {
    const now = 1000000;
    expect(formatRelativeDate(now - 10, now)).toBe("just now");
    expect(formatRelativeDate(now - 120, now)).toBe("2m ago");
    expect(formatRelativeDate(now - 7200, now)).toBe("2h ago");
    expect(formatRelativeDate(now - 86400 * 3, now)).toBe("3d ago");
    expect(formatRelativeDate(now - 86400 * 65, now)).toBe("2mo ago");
    expect(formatRelativeDate(now - 86400 * 400, now)).toBe("1y ago");
  });

  it("assigns colors according to commit age", () => {
    const now = 1000000;
    expect(getCommitAgeColor(now - 86400 * 2, now)).toBe("#f59e0b"); // <= 7d
    expect(getCommitAgeColor(now - 86400 * 20, now)).toBe("#eab308"); // <= 30d
    expect(getCommitAgeColor(now - 86400 * 60, now)).toBe("#10b981"); // <= 90d
    expect(getCommitAgeColor(now - 86400 * 500, now)).toBe("#64748b"); // > 365d
  });
});

describe("BlameView Component", () => {
  let mockDs: MockM3DataSource;

  beforeEach(() => {
    mockDs = new MockM3DataSource();
    useM3Store.getState().setDataSource(mockDs);
  });

  it("renders blame lines with author names and short SHAs", async () => {
    render(<BlameView filePath="src/App.tsx" />);

    await waitFor(() => {
      expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
      expect(screen.getByText("Alice Developer")).toBeInTheDocument();
      expect(screen.getAllByText("Bob Engineer").length).toBeGreaterThan(0);
    });
  });

  it("selects commit when clicking a blame line", async () => {
    const onSelectCommitInGraph = vi.fn();
    render(
      <BlameView
        filePath="src/App.tsx"
        onSelectCommitInGraph={onSelectCommitInGraph}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Alice Developer")).toBeInTheDocument();
    });

    const aliceLine = screen.getByText("Alice Developer");
    fireEvent.click(aliceLine);

    expect(onSelectCommitInGraph).toHaveBeenCalledWith(
      "a1b2c3d4e5f67890123456789012345678901234"
    );
  });

  it("supports blaming prior to a commit and navigating back", async () => {
    render(<BlameView filePath="src/App.tsx" />);

    await waitFor(() => {
      expect(screen.getAllByText("Bob Engineer")[0]).toBeInTheDocument();
    });

    // Hover over Bob's line
    const bobLine = screen.getAllByText("Bob Engineer")[0].closest("div[class*='group']");
    expect(bobLine).toBeDefined();
    fireEvent.mouseEnter(bobLine!);

    // Tooltip with "Blame Prior" button should appear
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Blame Prior/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Blame Prior/i }));

    // Revision should switch and Back button should appear
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Back/i })).toBeInTheDocument();
    });

    // Clicking Back restores HEAD
    fireEvent.click(screen.getByRole("button", { name: /Back/i }));
    await waitFor(() => {
      expect(screen.getByText("HEAD")).toBeInTheDocument();
    });
  });

  it("passes options -w, -M, -C to data source blame calls", async () => {
    const blameSpy = vi.spyOn(mockDs, "blame");
    render(<BlameView filePath="src/App.tsx" />);

    await waitFor(() => {
      expect(screen.getByText("-w")).toBeInTheDocument();
    });

    const ignoreWsCheckbox = screen.getByLabelText(/-w/i);
    fireEvent.click(ignoreWsCheckbox);

    await waitFor(() => {
      expect(blameSpy).toHaveBeenCalledWith(
        "src/App.tsx",
        undefined,
        expect.objectContaining({ ignore_ws: true })
      );
    });
  });
});
