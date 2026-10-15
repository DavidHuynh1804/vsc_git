import { create } from "zustand";

export type ActivityView = "changes" | "graph" | "branches" | "stashes" | "settings";

export interface TabItem {
  id: string;
  title: string;
  closable?: boolean;
  baseSha?: string;
}

export interface UIState {
  activeActivity: ActivityView;
  isSidebarOpen: boolean;
  sidebarWidth: number;
  isGitOutputOpen: boolean;
  isCommandPaletteOpen: boolean;
  theme: "dark" | "light" | "system";
  isCreatePrOpen: boolean;
  tabs: TabItem[];
  activeTabId: string;
  selectedGraphSha: string | null;
  setActiveActivity: (view: ActivityView) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  toggleGitOutput: () => void;
  setGitOutputOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setTheme: (theme: "dark" | "light" | "system") => void;
  setCreatePrOpen: (open: boolean) => void;
  openTab: (tab: TabItem) => void;
  closeTab: (id: string) => void;
  setActiveTabId: (id: string) => void;
  setSelectedGraphSha: (sha: string | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeActivity: "changes",
  isSidebarOpen: true,
  sidebarWidth: 280,
  isGitOutputOpen: false,
  isCommandPaletteOpen: false,
  theme: "system",
  isCreatePrOpen: false,
  tabs: [{ id: "welcome", title: "Welcome", closable: false }],
  activeTabId: "welcome",
  selectedGraphSha: null,
  setActiveActivity: (view) =>
    set((state) => ({
      activeActivity: view,
      isSidebarOpen: state.activeActivity === view && state.isSidebarOpen ? false : true,
    })),

  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setSidebarWidth: (width) => set({ sidebarWidth: Math.max(180, Math.min(width, 700)) }),
  toggleGitOutput: () => set((state) => ({ isGitOutputOpen: !state.isGitOutputOpen })),
  setGitOutputOpen: (isGitOutputOpen) => set({ isGitOutputOpen }),
  toggleCommandPalette: () => set((state) => ({ isCommandPaletteOpen: !state.isCommandPaletteOpen })),
  setCommandPaletteOpen: (isCommandPaletteOpen) => set({ isCommandPaletteOpen }),

  setTheme: (theme) => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    if (theme === "light") {
      root.classList.add("light");
    } else if (theme === "dark") {
      root.classList.add("dark");
    } else {
      const isSystemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (!isSystemDark) {
        root.classList.add("light");
      }
    }
    set({ theme });
  },
  setCreatePrOpen: (isCreatePrOpen) => set({ isCreatePrOpen }),

  openTab: (tab) =>
    set((state) => {
      const exists = state.tabs.some((t) => t.id === tab.id);
      const nextTabs = exists
        ? state.tabs.map((t) => (t.id === tab.id ? { ...t, ...tab } : t))
        : [...state.tabs, tab];
      return {
        tabs: nextTabs,
        activeTabId: tab.id,
      };
    }),

  closeTab: (id) =>
    set((state) => {
      const newTabs = state.tabs.filter((t) => t.id !== id);
      const nextActive =
        state.activeTabId === id
          ? (newTabs[newTabs.length - 1]?.id ?? "welcome")
          : state.activeTabId;
      return {
        tabs: newTabs.length > 0 ? newTabs : [{ id: "welcome", title: "Welcome", closable: false }],
        activeTabId: nextActive,
      };
    }),

  setActiveTabId: (activeTabId) => set({ activeTabId }),
  setSelectedGraphSha: (selectedGraphSha) => set({ selectedGraphSha }),
}));
