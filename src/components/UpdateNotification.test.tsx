import { render, screen, act, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UpdateNotification } from "./UpdateNotification";
import * as updaterPlugin from "@tauri-apps/plugin-updater";

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

describe("UpdateNotification", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not render when no update is available", async () => {
    vi.mocked(updaterPlugin.check).mockResolvedValue(null);

    render(<UpdateNotification />);

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders notification banner when update is available and allows dismissing", async () => {
    const mockUpdate = {
      available: true,
      currentVersion: "0.1.0",
      version: "0.2.0",
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as updaterPlugin.Update;

    vi.mocked(updaterPlugin.check).mockResolvedValue(mockUpdate);

    render(<UpdateNotification />);

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Có bản cập nhật mới (v0.2.0)")).toBeInTheDocument();
    expect(screen.getByText("Cập nhật & khởi động lại")).toBeInTheDocument();

    const dismissBtn = screen.getByText("Để sau");
    fireEvent.click(dismissBtn);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
