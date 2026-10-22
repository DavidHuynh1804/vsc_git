import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { useUIStore } from "@/stores/ui";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

describe("app graph tab smoke", () => {
  beforeEach(() => {
    localStorage.clear();
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

  it("opens the Graph tab through the UI store and shows the mock graph", async () => {
    const { container } = render(<App />);
    // Same store action as the "Open Graph" palette command
    useUIStore.getState().openTab({ id: "graph", title: "Git Graph", closable: true });
    useUIStore.getState().setActiveActivity("graph");

    await waitFor(() => {
      expect(
        screen.getAllByText(/virtualized canvas Git Graph view/).length
      ).toBeGreaterThan(0);
    });

    expect(container.querySelector("canvas")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go to HEAD" })).toBeInTheDocument();
  });
});
