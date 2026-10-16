import React from "react";
import {
  GitPullRequest,
  GitGraph,
  GitBranch,
  Archive,
  Settings as SettingsIcon,
  Sun,
  Moon,
} from "lucide-react";
import { useUIStore, ActivityView } from "@/stores/ui";

interface ActivityItem {
  id: ActivityView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const activities: ActivityItem[] = [
  { id: "changes", label: "Source Control", icon: GitPullRequest },
  { id: "graph", label: "Git Graph", icon: GitGraph },
  { id: "branches", label: "Branches", icon: GitBranch },
  { id: "stashes", label: "Stashes", icon: Archive },
];

export const ActivityBar: React.FC = () => {
  const { activeActivity, isSidebarOpen, setActiveActivity, theme, setTheme, openTab } = useUIStore();

  const toggleTheme = () => {
    const isLight = typeof document !== "undefined" && document.documentElement.classList.contains("light");
    setTheme(isLight ? "dark" : "light");
  };
  return (
    <nav
      aria-label="Activity Bar"
      className="flex w-12 flex-shrink-0 flex-col justify-between border-r bg-vscode-activity select-none py-2"
      style={{ color: "var(--vscode-activity-muted)" }}
    >
      <div className="flex flex-col items-center gap-1.5">
        {activities.map((item) => {
          const Icon = item.icon;
          const isActive = activeActivity === item.id && isSidebarOpen;
          return (
            <button
              key={item.id}
              type="button"
              title={item.label}
              aria-label={item.label}
              aria-pressed={isActive}
              onClick={() => {
                setActiveActivity(item.id);
                if (item.id === "graph") {
                  openTab({ id: "graph", title: "Git Graph", closable: true });
                }
              }}
              className={`relative flex h-10 w-10 items-center justify-center rounded transition-colors ${
                isActive
                  ? "bg-vscode-hover font-semibold"
                  : "hover:bg-vscode-hover"
              }`}
              style={{
                color: isActive ? "var(--vscode-activity-fg)" : "var(--vscode-activity-muted)",
              }}
            >
              {isActive && (
                <div
                  className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-vscode-accent"
                  style={{ width: "2px" }}
                />
              )}
              <Icon className="h-5 w-5" />
            </button>
          );
        })}
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <button
          type="button"
          title={`Switch theme (current: ${theme})`}
          aria-label={`Switch theme (current: ${theme})`}
          onClick={toggleTheme}
          className="flex h-10 w-10 items-center justify-center rounded hover:bg-vscode-hover transition-colors"
          style={{ color: "var(--vscode-activity-muted)" }}
        >
          {theme === "light" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        <button
          type="button"
          title="Settings"
          aria-label="Settings"
          onClick={() => {
            setActiveActivity("settings");
            openTab({ id: "settings", title: "Settings", closable: true });
          }}
          className={`flex h-10 w-10 items-center justify-center rounded transition-colors ${
            activeActivity === "settings" && isSidebarOpen
              ? "bg-vscode-hover font-semibold"
              : "hover:bg-vscode-hover"
          }`}
          style={{
            color: activeActivity === "settings" && isSidebarOpen ? "var(--vscode-activity-fg)" : "var(--vscode-activity-muted)",
          }}
        >
          <SettingsIcon className="h-5 w-5" />
        </button>
      </div>
    </nav>
  );
};
