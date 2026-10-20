import { commands, events, type RepoInfo } from "@/bindings";
import { useRepoStore } from "@/stores/repo";
import { useUIStore } from "@/stores/ui";
import { useScmStore } from "@/scm/scmStore";
import { useM3Store } from "@/m3/m3Store";

/** Activates an opened repository: updates every store and shows the graph. */
export async function activateRepo(info: RepoInfo): Promise<void> {
  const repo = useRepoStore.getState();
  repo.setRepo(info);
  const scm = useScmStore.getState();
  scm.clearSelection();
  scm.closeDiff();
  void scm.refreshStatus();
  void scm.refreshRefs();
  void scm.refreshStashes();
  void useM3Store.getState().refreshOperationState();
  const recent = await commands.recentRepos();
  if (recent.status === "ok") {
    repo.setRecentRepos(recent.data);
  }
  useUIStore.getState().openTab({ id: "graph", title: "Git Graph", closable: true });
}

async function withLoading(fallbackMessage: string, fn: () => Promise<void>): Promise<void> {
  const repo = useRepoStore.getState();
  try {
    repo.setLoading(true);
    await fn();
  } catch (e: unknown) {
    repo.setError(e instanceof Error ? e.message : fallbackMessage);
  } finally {
    repo.setLoading(false);
  }
}

export function openRepository(path: string): Promise<void> {
  return withLoading("Failed to open repository", async () => {
    const opened = await commands.openRepo(path);
    if (opened.status === "ok") {
      await activateRepo(opened.data);
    } else {
      useRepoStore.getState().setError(opened.error.message);
    }
  });
}

/** Shows the folder picker, then opens the chosen folder. */
export function pickAndOpenRepository(): Promise<void> {
  return withLoading("Failed to open repository", async () => {
    const picked = await commands.pickFolder();
    if (picked.status === "ok" && picked.data) {
      await openRepository(picked.data);
    }
  });
}

/** Picks a folder, runs `git init` there, then opens it. */
export function initRepository(): Promise<void> {
  return withLoading("Failed to initialize repository", async () => {
    const picked = await commands.pickFolder();
    if (picked.status !== "ok" || !picked.data) return;
    const res = await commands.initRepo(picked.data);
    if (res.status === "ok") {
      // init_repo does not register a session; open_repo does.
      await openRepository(res.data.root);
    } else {
      useRepoStore.getState().setError(res.error.message);
    }
  });
}

/** "https://host/acme/app.git" -> "app" */
export function repoNameFromUrl(url: string): string {
  const last = url.trim().replace(/[\\/]+$/, "").split(/[\\/:]/).pop() ?? "";
  return last.replace(/\.git$/, "") || "repo";
}

/** Clones `url` into a new folder under a picked parent folder, then opens the clone. */
export function cloneRepository(url: string): Promise<void> {
  return withLoading("Failed to clone repository", async () => {
    const picked = await commands.pickFolder();
    if (picked.status !== "ok" || !picked.data) return;
    const sep = picked.data.includes("\\") && !picked.data.includes("/") ? "\\" : "/";
    const target = `${picked.data.replace(/[\\/]+$/, "")}${sep}${repoNameFromUrl(url)}`;

    // Listen before starting so a fast failure is not missed.
    let jobId: string | null = null;
    const finished = new Map<string, { success: boolean; error: string | null }>();
    let settle: (r: { success: boolean; error: string | null }) => void = () => {};
    const done = new Promise<{ success: boolean; error: string | null }>((r) => (settle = r));
    const unlisten = await events.jobDone.listen((e) => {
      const r = { success: e.payload.success, error: e.payload.error };
      if (jobId === null) finished.set(e.payload.id, r);
      else if (e.payload.id === jobId) settle(r);
    });
    try {
      const res = await commands.cloneRepo(url, target);
      if (res.status !== "ok") {
        useRepoStore.getState().setError(res.error.message);
        return;
      }
      jobId = res.data;
      const early = finished.get(jobId);
      if (early) settle(early);
      const result = await done;
      if (!result.success) {
        useRepoStore.getState().setError(result.error ?? "Clone failed");
        return;
      }
    } finally {
      unlisten();
    }
    await openRepository(target);
  });
}
