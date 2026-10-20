import { create } from "zustand";
import {
  ScmDataSource,
  MockScmDataSource,
  TauriScmDataSource,
} from "./dataSource";
import { isMock } from "@/env";
import { setGlobalErrorHandler } from "@/utils/errors";
import { useRepoStore } from "@/stores/repo";
import {
  RepoStatus,
  RefList,
  StashItem,
  CommitOptions,
  JobId,
  JobProgress,
  AppError,
  StashPushOptions,
} from "./types";

export interface ActiveDiffTarget {
  path: string;
  context: "staged" | "unstaged" | "untracked" | "merge";
}

export interface ScmState {
  dataSource: ScmDataSource;
  status: RepoStatus | null;
  refs: RefList | null;
  stashes: StashItem[];
  isLoading: boolean;
  activeJobs: Map<JobId, JobProgress>;
  viewMode: "list" | "tree";
  groupUntrackedSeparately: boolean;
  selectedPaths: Set<string>;
  diffSideBySide: boolean;
  diffIgnoreWhitespace: boolean;
  draftCommitMessage: string;
  smartCommitSetting: "always" | "ask" | "never";
  activeDiff: ActiveDiffTarget | null;
  error: AppError | null;

  setDataSource: (ds: ScmDataSource) => void;
  refreshStatus: () => Promise<void>;
  refreshRefs: () => Promise<void>;
  refreshStashes: () => Promise<void>;
  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  discard: (paths: string[]) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageAll: () => Promise<void>;
  discardAll: () => Promise<void>;
  commit: (options: CommitOptions) => Promise<void>;
  openDiff: (path: string, context: "staged" | "unstaged" | "untracked" | "merge") => void;
  closeDiff: () => void;
  toggleViewMode: () => void;
  setGroupUntrackedSeparately: (val: boolean) => void;
  togglePathSelection: (path: string, multi?: boolean, rangeList?: string[]) => void;
  clearSelection: () => void;
  selectAll: (paths: string[]) => void;
  setDraftCommitMessage: (msg: string) => void;
  setDiffSideBySide: (val: boolean) => void;
  setDiffIgnoreWhitespace: (val: boolean) => void;
  setSmartCommitSetting: (val: "always" | "ask" | "never") => void;
  setError: (err: AppError | null) => void;
  checkout: (refName: string) => Promise<void>;
  createBranch: (name: string, startPoint?: string) => Promise<void>;
  renameBranch: (oldName: string, newName: string) => Promise<void>;
  deleteBranch: (name: string, force?: boolean) => Promise<void>;
  setUpstream: (branch: string, upstream: string) => Promise<void>;
  stashPush: (opts: StashPushOptions) => Promise<void>;
  stashApply: (index: number) => Promise<void>;
  stashPop: (index: number) => Promise<void>;
  stashDrop: (index: number) => Promise<void>;
  fetch: () => Promise<void>;
  pull: () => Promise<void>;
  push: () => Promise<void>;
  sync: () => Promise<void>;
  cancelJob: (id: JobId) => Promise<void>;
}

// Default to MockScmDataSource for M1 development & tests
const defaultDataSource: ScmDataSource = isMock()
  ? new MockScmDataSource()
  : new TauriScmDataSource();

export const useScmStore = create<ScmState>((set, get) => {
  setGlobalErrorHandler((err) => {
    // Cast between bindings and SCM transport AppError shape
    const appError = err as unknown as AppError;
    set({ error: appError });
  });

  // Listen for background status updates
  defaultDataSource.onStatusChanged(() => {
    void get().refreshStatus();
    void get().refreshRefs();
    void get().refreshStashes();
  });

  const trackJob = (jobId: JobId) => {
    get().dataSource.subscribeJobProgress(jobId, (progress) => {
      const next = new Map(get().activeJobs);
      if (progress.percent && progress.percent >= 100) {
        next.delete(jobId);
        set({ activeJobs: next });
        if (progress.error) {
          set({
            error: { kind: "Internal", message: progress.error, git_stderr: progress.error, hint: null },
          });
        }
        void get().refreshStatus();
        void get().refreshRefs();
      } else {
        next.set(jobId, progress);
        set({ activeJobs: next });
      }
    });
  };

  return {
    dataSource: defaultDataSource,
    status: null,
    refs: null,
    stashes: [],
    isLoading: false,
    activeJobs: new Map(),
    viewMode: "list",
    groupUntrackedSeparately: true,
    selectedPaths: new Set(),
    diffSideBySide: true,
    diffIgnoreWhitespace: false,
    draftCommitMessage: "",
    smartCommitSetting: "ask",
    activeDiff: null,
    error: null,

    setDataSource: (dataSource) => {
      set({ dataSource });
      void get().refreshStatus();
      void get().refreshRefs();
      void get().refreshStashes();
    },

    refreshStatus: async () => {
      try {
        const status = await get().dataSource.getStatus();
        set({ status });
        // Keep the titlebar / PR dialog branch in sync after checkout, rebase, etc.
        const head = status.branch.head || null;
        if (head && useRepoStore.getState().headBranch !== head) {
          useRepoStore.getState().setHeadBranch(head);
        }
      } catch (err: unknown) {
        if (err && typeof err === "object" && "kind" in err) {
          set({ error: err as AppError });
        }
      }
    },

    refreshRefs: async () => {
      try {
        const refs = await get().dataSource.getRefs();
        set({ refs });
      } catch (err: unknown) {
        if (err && typeof err === "object" && "kind" in err) {
          set({ error: err as AppError });
        }
      }
    },

    refreshStashes: async () => {
      try {
        const stashes = await get().dataSource.listStashes();
        set({ stashes });
      } catch (err: unknown) {
        if (err && typeof err === "object" && "kind" in err) {
          set({ error: err as AppError });
        }
      }
    },

    stage: async (paths) => {
      try {
        await get().dataSource.stage(paths);
        await get().refreshStatus();
      } catch (err: unknown) {
        if (err && typeof err === "object" && "kind" in err) {
          set({ error: err as AppError });
        }
      }
    },

    unstage: async (paths) => {
      try {
        await get().dataSource.unstage(paths);
        await get().refreshStatus();
      } catch (err: unknown) {
        if (err && typeof err === "object" && "kind" in err) {
          set({ error: err as AppError });
        }
      }
    },

    discard: async (paths) => {
      try {
        await get().dataSource.discard(paths);
        await get().refreshStatus();
      } catch (err: unknown) {
        if (err && typeof err === "object" && "kind" in err) {
          set({ error: err as AppError });
        }
      }
    },

    stageAll: async () => {
      try {
        await get().dataSource.stageAll();
        await get().refreshStatus();
      } catch (err: unknown) {
        if (err && typeof err === "object" && "kind" in err) {
          set({ error: err as AppError });
        }
      }
    },

    unstageAll: async () => {
      try {
        await get().dataSource.unstageAll();
        await get().refreshStatus();
      } catch (err: unknown) {
        if (err && typeof err === "object" && "kind" in err) {
          set({ error: err as AppError });
        }
      }
    },

    discardAll: async () => {
      try {
        await get().dataSource.discardAll();
        await get().refreshStatus();
      } catch (err: unknown) {
        if (err && typeof err === "object" && "kind" in err) {
          set({ error: err as AppError });
        }
      }
    },

    commit: async (options) => {
      try {
        await get().dataSource.commit(options);
        set({ draftCommitMessage: "" });
        await get().refreshStatus();
      } catch (err: unknown) {
        if (err && typeof err === "object" && "kind" in err) {
          set({ error: err as AppError });
        }
      }
    },

    openDiff: (path, context) => {
      set({ activeDiff: { path, context } });
    },

    closeDiff: () => {
      set({ activeDiff: null });
    },

    toggleViewMode: () => {
      set((state) => ({ viewMode: state.viewMode === "list" ? "tree" : "list" }));
    },

    setGroupUntrackedSeparately: (groupUntrackedSeparately) => {
      set({ groupUntrackedSeparately });
    },

    togglePathSelection: (path, multi = false, rangeList?: string[]) => {
      set((state) => {
        const next = new Set(multi ? state.selectedPaths : []);
        if (rangeList && rangeList.length > 0) {
          // range select
          for (const p of rangeList) {
            next.add(p);
          }
          return { selectedPaths: next };
        }
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return { selectedPaths: next };
      });
    },

    clearSelection: () => {
      set({ selectedPaths: new Set() });
    },

    selectAll: (paths) => {
      set({ selectedPaths: new Set(paths) });
    },

    setDraftCommitMessage: (draftCommitMessage) => {
      set({ draftCommitMessage });
    },

    setDiffSideBySide: (diffSideBySide) => {
      set({ diffSideBySide });
    },

    setDiffIgnoreWhitespace: (diffIgnoreWhitespace) => {
      set({ diffIgnoreWhitespace });
    },

    setSmartCommitSetting: (smartCommitSetting) => {
      set({ smartCommitSetting });
    },

    setError: (error) => {
      set({ error });
    },

    checkout: async (refName) => {
      try {
        await get().dataSource.checkout(refName);
        await get().refreshStatus();
        await get().refreshRefs();
      } catch (err: unknown) {
        if (err && typeof err === "object" && "kind" in err) {
          set({ error: err as AppError });
        }
        throw err;
      }
    },

    createBranch: async (name, startPoint) => {
      try {
        await get().dataSource.createBranch(name, startPoint);
        await get().refreshRefs();
        await get().refreshStatus();
      } catch (err: unknown) {
        if (err && typeof err === "object" && "kind" in err) {
          set({ error: err as AppError });
        }
      }
    },

    renameBranch: async (oldName, newName) => {
      try {
        await get().dataSource.renameBranch(oldName, newName);
        await get().refreshRefs();
      } catch (err: unknown) {
        if (err && typeof err === "object" && "kind" in err) {
          set({ error: err as AppError });
        }
      }
    },

    deleteBranch: async (name, force) => {
      try {
        await get().dataSource.deleteBranch(name, force);
        await get().refreshRefs();
      } catch (err: unknown) {
        if (err && typeof err === "object" && "kind" in err) {
          set({ error: err as AppError });
        }
      }
    },

    setUpstream: async (branch, upstream) => {
      try {
        await get().dataSource.setUpstream(branch, upstream);
        await get().refreshRefs();
      } catch (err: unknown) {
        if (err && typeof err === "object" && "kind" in err) {
          set({ error: err as AppError });
        }
      }
    },

    stashPush: async (opts) => {
      try {
        await get().dataSource.stashPush(opts);
        await get().refreshStashes();
        await get().refreshStatus();
      } catch (err: unknown) {
        if (err && typeof err === "object" && "kind" in err) {
          set({ error: err as AppError });
        }
      }
    },

    stashApply: async (index) => {
      try {
        await get().dataSource.stashApply(index);
        await get().refreshStatus();
        await get().refreshStashes();
      } catch (err: unknown) {
        if (err && typeof err === "object" && "kind" in err) {
          set({ error: err as AppError });
        }
      }
    },

    stashPop: async (index) => {
      try {
        await get().dataSource.stashPop(index);
        await get().refreshStashes();
        await get().refreshStatus();
      } catch (err: unknown) {
        if (err && typeof err === "object" && "kind" in err) {
          set({ error: err as AppError });
        }
      }
    },

    stashDrop: async (index) => {
      try {
        await get().dataSource.stashDrop(index);
        await get().refreshStashes();
      } catch (err: unknown) {
        if (err && typeof err === "object" && "kind" in err) {
          set({ error: err as AppError });
        }
      }
    },

    fetch: async () => {
      const jobId = await get().dataSource.fetch();
      trackJob(jobId);
    },

    pull: async () => {
      const jobId = await get().dataSource.pull();
      trackJob(jobId);
    },

    push: async () => {
      const jobId = await get().dataSource.push();
      trackJob(jobId);
    },

    sync: async () => {
      const jobId = await get().dataSource.sync();
      trackJob(jobId);
    },

    cancelJob: async (id) => {
      await get().dataSource.cancelJob(id);
      const next = new Map(get().activeJobs);
      next.delete(id);
      set({ activeJobs: next });
    },
  };
});
