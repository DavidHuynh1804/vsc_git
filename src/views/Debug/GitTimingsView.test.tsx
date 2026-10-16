import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { GitTimingsView, MOCK_GIT_TIMINGS } from "./GitTimingsView";
import { GitOutputEntry } from "@/bindings";

describe("GitTimingsView", () => {
  const sampleEntries: GitOutputEntry[] = [
    {
      id: 1,
      timestamp: 1000,
      cmd: "git status --porcelain=v2",
      cwd: "/repo/one",
      exit_code: 0,
      duration_ms: 25,
      stdout: "",
      stderr: "",
    },
    {
      id: 2,
      timestamp: 2000,
      cmd: "git log --oneline -n 20",
      cwd: "/repo/one",
      exit_code: 0,
      duration_ms: 150,
      stdout: "",
      stderr: "",
    },
    {
      id: 3,
      timestamp: 3000,
      cmd: "git push origin main",
      cwd: "/repo/one",
      exit_code: 1,
      duration_ms: 400,
      stdout: "",
      stderr: "remote rejected",
    },
  ];

  it("renders timing records and summary statistics", () => {
    render(<GitTimingsView initialEntries={sampleEntries} />);

    expect(screen.getByText("Git Command Timings")).toBeInTheDocument();
    expect(screen.getByText("git status --porcelain=v2")).toBeInTheDocument();
    expect(screen.getByText("git log --oneline -n 20")).toBeInTheDocument();
    expect(screen.getByText("git push origin main")).toBeInTheDocument();
    expect(screen.getByText(/3 commands/)).toBeInTheDocument();
    expect(screen.getByText(/1 errors/)).toBeInTheDocument();
  });

  it("filters records by search query", () => {
    render(<GitTimingsView initialEntries={sampleEntries} />);

    const searchInput = screen.getByTestId("filter-input");
    fireEvent.change(searchInput, { target: { value: "push" } });

    expect(screen.queryByText("git status --porcelain=v2")).not.toBeInTheDocument();
    expect(screen.getByText("git push origin main")).toBeInTheDocument();
  });

  it("filters records by status", () => {
    render(<GitTimingsView initialEntries={sampleEntries} />);

    const statusSelect = screen.getByTestId("status-filter");

    // Errors only
    fireEvent.change(statusSelect, { target: { value: "error" } });
    expect(screen.queryByText("git status --porcelain=v2")).not.toBeInTheDocument();
    expect(screen.getByText("git push origin main")).toBeInTheDocument();

    // Success only
    fireEvent.change(statusSelect, { target: { value: "success" } });
    expect(screen.getByText("git status --porcelain=v2")).toBeInTheDocument();
    expect(screen.queryByText("git push origin main")).not.toBeInTheDocument();
  });

  it("sorts records by duration", () => {
    render(<GitTimingsView initialEntries={sampleEntries} />);

    const sortSelect = screen.getByTestId("sort-select");
    fireEvent.change(sortSelect, { target: { value: "duration-desc" } });

    const rows = screen.getAllByRole("row");
    // rows[0] is table header
    expect(rows[1]).toHaveTextContent("git push origin main");
    expect(rows[2]).toHaveTextContent("git log --oneline -n 20");
    expect(rows[3]).toHaveTextContent("git status --porcelain=v2");
  });

  it("clears records when clear button is clicked", () => {
    render(<GitTimingsView initialEntries={sampleEntries} />);

    const clearBtn = screen.getByTestId("clear-btn");
    fireEvent.click(clearBtn);

    expect(screen.getByText("No git command timing records found.")).toBeInTheDocument();
    expect(screen.queryByText("git status --porcelain=v2")).not.toBeInTheDocument();
  });

  it("renders mock timings when no initial entries are provided in mock mode", () => {
    render(<GitTimingsView />);
    expect(screen.getByText(MOCK_GIT_TIMINGS[0].cmd)).toBeInTheDocument();
  });
});
