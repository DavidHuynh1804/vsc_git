import { describe, it, expect, beforeEach } from "vitest";
import { useRepoStore } from "./repo";

describe("useRepoStore", () => {
  beforeEach(() => {
    useRepoStore.setState({
      repoRoot: null,
      repoName: null,
      headBranch: null,
      recentRepos: [],
      gitVersion: null,
      isLoading: false,
      error: null,
    });
  });

  it("initializes with default state", () => {
    const state = useRepoStore.getState();
    expect(state.repoRoot).toBeNull();
    expect(state.repoName).toBeNull();
    expect(state.headBranch).toBeNull();
    expect(state.recentRepos).toEqual([]);
  });

  it("updates repository info and extracts repo name", () => {
    useRepoStore.getState().setRepo({
      root: "/Users/dev/my-project",
      head_branch: "feature/awesome",
    });

    const state = useRepoStore.getState();
    expect(state.repoRoot).toBe("/Users/dev/my-project");
    expect(state.repoName).toBe("my-project");
    expect(state.headBranch).toBe("feature/awesome");
    expect(state.error).toBeNull();
  });

  it("clears repository info on null", () => {
    useRepoStore.getState().setRepo({
      root: "/Users/dev/my-project",
      head_branch: "main",
    });
    useRepoStore.getState().setRepo(null);

    const state = useRepoStore.getState();
    expect(state.repoRoot).toBeNull();
    expect(state.repoName).toBeNull();
    expect(state.headBranch).toBeNull();
  });

  it("manages recent repos and git version", () => {
    const repos = [
      { path: "/repo1", name: "repo1", last_opened: 1000 },
      { path: "/repo2", name: "repo2", last_opened: 2000 },
    ];
    useRepoStore.getState().setRecentRepos(repos);
    useRepoStore.getState().setGitVersion("2.55.0");

    const state = useRepoStore.getState();
    expect(state.recentRepos.length).toBe(2);
    expect(state.gitVersion).toBe("2.55.0");
  });
});
