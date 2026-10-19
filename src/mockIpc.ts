import { mockIPC } from "@tauri-apps/api/mocks";
import { useRepoStore } from "@/stores/repo";
import { useScmStore } from "@/scm/scmStore";
import { MOCK_GIT_TIMINGS } from "@/views/Debug/GitTimingsView";

export function setupMockIpc() {
  if (typeof window === "undefined") return;

  const repoStore = useRepoStore.getState();
  if (!repoStore.repoRoot) {
    repoStore.setRepo({
      root: "/workspace/vsc_git",
      head_branch: "main",
    });
    repoStore.setGitVersion("git version 2.39.0");
  }

  mockIPC((cmd, args) => {
    switch (cmd) {
      case "get_current_repo":
        return { root: "/workspace/vsc_git", head_branch: "main" };
      case "recent_repos":
        return [{ path: "/workspace/vsc_git", name: "vsc_git", last_opened: Date.now() }];
      case "open_repo":
        return {
          root:
            typeof args === "object" && args && "path" in args
              ? String(args.path)
              : "/workspace/vsc_git",
          head_branch: "main",
        };
      case "git_version":
        return "git version 2.39.0";
      case "get_settings":
        return {
          "git.autoFetch": false,
          "ui.theme": "dark",
          "update.channel": "stable",
        };
      case "set_settings":
        return {};
      case "get_git_output":
        return MOCK_GIT_TIMINGS;
      case "clear_git_output":
        return null;
      case "cherry_pick":
        return null;
      case "revert":
        return null;
      case "reset":
        return null;
      case "merge":
        return null;
      case "pick_folder":
        return "/workspace/vsc_git";
      case "plugin:event|listen":
        return 1;
      case "plugin:event|emit":
        return null;
      case "plugin:updater|check":
        return null;
      default:
        return null;
    }
  });

  setTimeout(() => {
    const scm = useScmStore.getState();
    void scm.refreshStatus();
    void scm.refreshRefs();
    void scm.refreshStashes();
  }, 50);
}
