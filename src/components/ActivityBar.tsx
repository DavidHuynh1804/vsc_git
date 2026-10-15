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
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <nav className="flex w-12 flex-shrink-0 flex-col justify-between border-r bg-vscode-activity select-none py-2 text-vscode-muted">
      <div className="flex flex-col items-center gap-2">
        {activities.map((item) => {
          const Icon = item.icon;
          const isActive = activeActivity === item.id && isSidebarOpen;
          return (
            <button
              key={item.id}
              type="button"
              title={item.label}
              onClick={() => setActiveActivity(item.id)}
              className={`relative flex h-10 w-10 items-center justify-center rounded transition-colors ${
                isActive
                  ? "text-vscode-fg bg-vscode-hover font-semibold"
                  : "hover:text-vscode-fg hover:bg-vscode-hover"
              }`}
            >
              {isActive && (
                <div
                  className="absolute left-0 top-1 bottom-1 w-0.5 bg-vscode-accent"
                  style={{ width: "2px" }}
                />
              )}
              <Icon className="h-5 w-5" />
            </button>
          );
        })}
      </div>

      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          title={`Theme: ${theme}`}
          onClick={toggleTheme}
          className="flex h-10 w-10 items-center justify-center rounded hover:text-vscode-fg hover:bg-vscode-hover"
        >
          {theme === "light" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        <button
          type="button"
          title="Settings"
          onClick={() => {
            setActiveActivity("settings");
            openTab({ id: "settings", title: "Settings", closable: true });
          }}
          className={`flex h-10 w-10 items-center justify-center rounded transition-colors ${
            activeActivity === "settings" && isSidebarOpen
              ? "text-vscode-fg bg-vscode-hover"
              : "hover:text-vscode-fg hover:bg-vscode-hover"
          }`}
        >
          <SettingsIcon className="h-5 w-5" />
        </button>
      </div>
    </nav>
  );
};
