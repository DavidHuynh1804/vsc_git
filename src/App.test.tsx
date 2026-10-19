import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import App from "./App";
import { useRepoStore } from "@/stores/repo";
import { useUIStore } from "@/stores/ui";

// Mock Tauri invoke and events
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockImplementation((cmd: string) => {
    if (cmd === "get_current_repo") return Promise.resolve(null);
    if (cmd === "recent_repos") return Promise.resolve([]);
    if (cmd === "git_version") return Promise.resolve("2.55.0");
    if (cmd === "get_git_output") return Promise.resolve([]);
    if (cmd === "get_settings") return Promise.resolve({});
    return Promise.resolve(null);
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

describe("App Shell", () => {
  it("renders main app components and titlebar", async () => {
    await act(async () => {
      render(<App />);
    });
    expect(screen.getAllByText("vsc_git").length).toBeGreaterThan(0);
    expect(screen.getByText("Start")).toBeInTheDocument();
    expect(screen.getByText("Recent Repositories")).toBeInTheDocument();
    expect(screen.getByText("Git Output")).toBeInTheDocument();
  });

  it("opens the Git Graph tab by default once a repository is open", async () => {
    await act(async () => {
      render(<App />);
    });
    expect(useUIStore.getState().activeTabId).toBe("welcome");

    await act(async () => {
      useRepoStore.getState().setRepo({ root: "/tmp/repo", head_branch: "main" });
    });
    expect(useUIStore.getState().activeTabId).toBe("graph");
  });
});
