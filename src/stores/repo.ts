import { create } from "zustand";
import { RecentRepo, RepoInfo } from "@/bindings";

export interface RepoState {
  repoRoot: string | null;
  repoName: string | null;
  headBranch: string | null;
  recentRepos: RecentRepo[];
  gitVersion: string | null;
  isLoading: boolean;
  error: string | null;

  setRepo: (info: RepoInfo | null) => void;
  setRecentRepos: (repos: RecentRepo[]) => void;
  setGitVersion: (version: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useRepoStore = create<RepoState>((set) => ({
  repoRoot: null,
  repoName: null,
  headBranch: null,
  recentRepos: [],
  gitVersion: null,
  isLoading: false,
  error: null,

  setRepo: (info) =>
    set({
      repoRoot: info?.root ?? null,
      repoName: info ? (info.root.split("/").filter(Boolean).pop() || info.root) : null,
      headBranch: info?.head_branch ?? null,
      error: null,
    }),

  setRecentRepos: (recentRepos) => set({ recentRepos }),
  setGitVersion: (gitVersion) => set({ gitVersion }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));
