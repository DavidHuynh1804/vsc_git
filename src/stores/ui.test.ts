import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "./ui";

describe("useUIStore", () => {
  beforeEach(() => {
    useUIStore.setState({
      activeActivity: "changes",
      isSidebarOpen: true,
      sidebarWidth: 280,
      isGitOutputOpen: false,
      isCommandPaletteOpen: false,
      theme: "dark",
      tabs: [{ id: "welcome", title: "Welcome", closable: false }],
      activeTabId: "welcome",
    });
  });

  it("toggles sidebar on repeat click or explicit toggle", () => {
    expect(useUIStore.getState().isSidebarOpen).toBe(true);

    // Clicking same activity toggles sidebar closed
    useUIStore.getState().setActiveActivity("changes");
    expect(useUIStore.getState().isSidebarOpen).toBe(false);

    // Clicking different activity switches and opens sidebar
    useUIStore.getState().setActiveActivity("graph");
    expect(useUIStore.getState().activeActivity).toBe("graph");
    expect(useUIStore.getState().isSidebarOpen).toBe(true);

    // Explicit toggle
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().isSidebarOpen).toBe(false);
  });

  it("clamps sidebar width within min/max bounds", () => {
    useUIStore.getState().setSidebarWidth(100);
    expect(useUIStore.getState().sidebarWidth).toBe(180);

    useUIStore.getState().setSidebarWidth(900);
    expect(useUIStore.getState().sidebarWidth).toBe(700);

    useUIStore.getState().setSidebarWidth(350);
    expect(useUIStore.getState().sidebarWidth).toBe(350);
  });

  it("manages tabs lifecycle", () => {
    // Open new tab
    useUIStore.getState().openTab({ id: "graph", title: "Git Graph", closable: true });
    expect(useUIStore.getState().tabs.length).toBe(2);
    expect(useUIStore.getState().activeTabId).toBe("graph");

    // Close tab switches back to previous tab
    useUIStore.getState().closeTab("graph");
    expect(useUIStore.getState().tabs.length).toBe(1);
    expect(useUIStore.getState().activeTabId).toBe("welcome");
  });

  it("toggles git output and command palette", () => {
    expect(useUIStore.getState().isGitOutputOpen).toBe(false);
    useUIStore.getState().toggleGitOutput();
    expect(useUIStore.getState().isGitOutputOpen).toBe(true);

    expect(useUIStore.getState().isCommandPaletteOpen).toBe(false);
    useUIStore.getState().toggleCommandPalette();
    expect(useUIStore.getState().isCommandPaletteOpen).toBe(true);
  });
});
