import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GraphView } from "./GraphView";
import { MockGraphDataSource } from "@/graph/dataSource";

describe("GraphView component", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      value: 800,
    });
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      bezierCurveTo: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  it("renders with mock data, displays initial commits and refs", async () => {
    const ds = new MockGraphDataSource(100, 42, true);
    render(<GraphView dataSource={ds} />);

    // Wait for commits to render
    await waitFor(() => {
      expect(
        screen.getAllByText("feat(graph-ui): virtualized canvas Git Graph view").length
      ).toBeGreaterThan(0);
    });
    // Uncommitted changes row should be present
    expect(screen.getByText("Uncommitted changes")).toBeInTheDocument();

    // Check refs badge
    expect(screen.getByText("HEAD")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("selects a commit on click and displays the CommitDetailPanel", async () => {
    const ds = new MockGraphDataSource(50, 42, false);
    const onOpenDiff = vi.fn();
    render(<GraphView dataSource={ds} onOpenDiff={onOpenDiff} />);

    const commitRow = (
      await screen.findAllByText("feat(graph-ui): virtualized canvas Git Graph view")
    )[0];
    fireEvent.click(commitRow);

    // Detail panel header and content should appear
    await waitFor(() => {
      expect(screen.getByText("Changed Files (5)")).toBeInTheDocument();
      expect(screen.getAllByText("Linus Torvalds").length).toBeGreaterThan(0);
    });

    // Clicking a changed file triggers onOpenDiff
    const changedFile = screen.getByText("src/views/Graph/GraphView.tsx");
    fireEvent.click(changedFile);
    expect(onOpenDiff).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "src/views/Graph/GraphView.tsx"
    );
  });

  it("enters compare mode on Cmd/Ctrl+click on a second commit", async () => {
    const ds = new MockGraphDataSource(50, 42, false);
    render(<GraphView dataSource={ds} />);

    const firstCommit = (
      await screen.findAllByText("feat(graph-ui): virtualized canvas Git Graph view")
    )[0];
    fireEvent.click(firstCommit);

    await waitFor(() => {
      expect(screen.getByText("Changed Files (5)")).toBeInTheDocument();
    });

    const secondCommit = (
      await screen.findAllByText("Merge branch 'feat/m1-backend' into main")
    )[0];
    // Cmd+click second commit
    fireEvent.click(secondCommit, { metaKey: true });

    await waitFor(() => {
      expect(screen.getByText(/Comparing Commits/i)).toBeInTheDocument();
    });
  });

  it("searches and highlights matching commits, navigating with Enter / Shift+Enter", async () => {
    const ds = new MockGraphDataSource(50, 42, false);
    render(<GraphView dataSource={ds} />);

    await screen.findAllByText("feat(graph-ui): virtualized canvas Git Graph view");

    const searchInput = screen.getByPlaceholderText(/Search commits/i);
    fireEvent.change(searchInput, { target: { value: "virtualized" } });

    await waitFor(() => {
      expect(screen.getByText(/1\/\d+/)).toBeInTheDocument();
    });

    // Press Enter to trigger next match
    fireEvent.keyDown(searchInput, { key: "Enter" });
    // Press Shift+Enter to trigger previous match
    fireEvent.keyDown(searchInput, { key: "Enter", shiftKey: true });
  });

  it("opens context menu on commit with spec 6.5 items", async () => {
    const ds = new MockGraphDataSource(50, 42, false);
    const onAction = vi.fn();
    render(<GraphView dataSource={ds} onAction={onAction} />);

    const commitRow = (
      await screen.findAllByText("feat(graph-ui): virtualized canvas Git Graph view")
    )[0];
    fireEvent.contextMenu(commitRow, { clientX: 200, clientY: 200 });

    // Verify spec 6.5 items on commit
    expect(screen.getByText("Checkout (detached)")).toBeInTheDocument();
    expect(screen.getByText("Create Branch...")).toBeInTheDocument();
    expect(screen.getByText("Create Tag...")).toBeInTheDocument();
    expect(screen.getByText("Cherry-pick")).toBeInTheDocument();
    expect(screen.getByText("Revert")).toBeInTheDocument();
    expect(screen.getByText("Reset current branch (Soft)")).toBeInTheDocument();
    expect(screen.getByText("Reset current branch (Mixed)")).toBeInTheDocument();
    expect(screen.getByText("Reset current branch (Hard)...")).toBeInTheDocument();
    expect(screen.getByText("Merge into current branch")).toBeInTheDocument();
    expect(screen.getByText("Rebase current branch onto this")).toBeInTheDocument();
    expect(screen.getByText("Interactive rebase from here")).toBeInTheDocument();
    expect(screen.getByText("Copy SHA")).toBeInTheDocument();
    expect(screen.getByText("Copy Message")).toBeInTheDocument();
    expect(screen.getByText("Open on GitHub/GitLab")).toBeInTheDocument();
    expect(screen.getByText("Explain commit (AI)")).toBeInTheDocument();
  });

  it("opens context menu on ref with spec 6.5 items", async () => {
    const ds = new MockGraphDataSource(50, 42, false);
    render(<GraphView dataSource={ds} />);

    const headRef = (await screen.findAllByText("HEAD"))[0];
    fireEvent.contextMenu(headRef, { clientX: 200, clientY: 200 });

    // Verify spec 6.5 items on ref
    expect(screen.getByText("Checkout")).toBeInTheDocument();
    expect(screen.getByText("Merge into current")).toBeInTheDocument();
    expect(screen.getByText("Rebase current onto")).toBeInTheDocument();
    expect(screen.getByText("Rename")).toBeInTheDocument();
    expect(screen.getByText("Delete (local)")).toBeInTheDocument();
    expect(screen.getByText("Push")).toBeInTheDocument();
    expect(screen.getByText("Set upstream")).toBeInTheDocument();
    expect(screen.getByText("Compare with HEAD")).toBeInTheDocument();
    expect(screen.getByText("Create PR/MR")).toBeInTheDocument();
    expect(screen.getByText("Open on web")).toBeInTheDocument();
  });

  it("handles 2-step confirmation for dangerous reset hard operation", async () => {
    const ds = new MockGraphDataSource(50, 42, false);
    const onAction = vi.fn();
    render(<GraphView dataSource={ds} onAction={onAction} />);

    const commitRow = (
      await screen.findAllByText("feat(graph-ui): virtualized canvas Git Graph view")
    )[0];
    fireEvent.contextMenu(commitRow, { clientX: 200, clientY: 200 });

    const resetHardBtn = screen.getByText("Reset current branch (Hard)...");
    fireEvent.click(resetHardBtn);

    // Step 1: Confirm dialog appears
    await waitFor(() => {
      expect(screen.getByText("Step 1 of 2:")).toBeInTheDocument();
      expect(screen.getByText(/git reset --hard/)).toBeInTheDocument();
    });

    // Click step 1 proceed button
    const confirmBtn = screen.getByTestId("confirm-dialog-btn");
    expect(confirmBtn).toHaveTextContent("I Understand, Proceed");
    fireEvent.click(confirmBtn);

    // Step 2: Final confirmation required
    expect(screen.getByText(/Step 2 of 2: FINAL CONFIRMATION/)).toBeInTheDocument();

    // Click step 2 confirm button
    fireEvent.click(confirmBtn);

    // Action dispatched upon completion of 2-step confirmation
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "reset-hard",
        danger: true,
        twoStepConfirm: true,
      })
    );
  });

  it("supports pagination when requested from data source", async () => {
    const ds = new MockGraphDataSource(1500, 42, false);
    const page1 = await ds.page(500);
    expect(page1.commits).toHaveLength(500);
    expect(page1.has_more).toBe(true);

    const page2 = await ds.page(500);
    expect(page2.commits).toHaveLength(500);
    expect(page2.has_more).toBe(true);

    const page3 = await ds.page(500);
    expect(page3.commits).toHaveLength(500);
    expect(page3.has_more).toBe(false);
  });

  it("measures performance with 200,000 commits mock: first page render time and virtual row count", async () => {
    const ds = new MockGraphDataSource(200000, 42, true);

    const start = performance.now();
    const page = await ds.page(500);
    const dataFetchTime = performance.now() - start;

    expect(page.commits).toHaveLength(500);
    expect(page.rows).toHaveLength(500);
    expect(page.has_more).toBe(true);
    // Data generation for first 500 commits is fast
    expect(dataFetchTime).toBeLessThan(100);

    const renderStart = performance.now();
    const { container } = render(<GraphView dataSource={ds} />);
    const renderTime = performance.now() - renderStart;

    await waitFor(() => {
      expect(
        screen.getAllByText("feat(graph-ui): virtualized canvas Git Graph view").length
      ).toBeGreaterThan(0);
    });

    // Check virtualization: only visible rows rendered in DOM, not 200k or even 500
    const renderedRows = container.querySelectorAll("[data-sha]");
    expect(renderedRows.length).toBeLessThan(100);
    expect(renderedRows.length).toBeGreaterThan(0);

    console.info(
      `[Benchmark 200k commits] First page data: ${dataFetchTime.toFixed(2)}ms, Initial render: ${renderTime.toFixed(2)}ms, DOM row count: ${renderedRows.length}`
    );
  });
});
