import { commands, type AppError } from "@/bindings";
import type { GraphAction } from "@/graph/types";
import { useScmStore } from "@/scm/scmStore";
import { useUIStore } from "@/stores/ui";
import { reportAppError } from "@/utils/errors";

type Result<T> = { status: "ok"; data: T } | { status: "error"; error: AppError };

/** Actions that need a name from the user before they can run. */
export type GraphPromptKind = "create-branch" | "create-tag" | "rename-ref";

export function needsPrompt(type: string): type is GraphPromptKind {
  return type === "create-branch" || type === "create-tag" || type === "rename-ref";
}

function str(action: GraphAction, key: string): string | undefined {
  const v = action.payload?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function toAppError(err: unknown): AppError {
  if (err && typeof err === "object" && "kind" in err && "message" in err) {
    return err as AppError;
  }
  return {
    kind: "Internal",
    message: err instanceof Error ? err.message : String(err),
    git_stderr: null,
    hint: null,
  };
}

async function run<T>(res: Promise<Result<T>>): Promise<T> {
  const r = await res;
  if (r.status === "error") throw r.error;
  return r.data;
}

async function refreshAll(): Promise<void> {
  const scm = useScmStore.getState();
  await Promise.all([scm.refreshStatus(), scm.refreshRefs(), scm.refreshStashes()]);
}

/** Split "origin/feature/x" into remote + branch. */
export function splitRemoteRef(name: string): { remote: string; branch: string } {
  const idx = name.indexOf("/");
  if (idx === -1) return { remote: "origin", branch: name };
  return { remote: name.slice(0, idx), branch: name.slice(idx + 1) };
}

export function webUrlFor(
  host: { host: string; kind: string; namespace: string; repo: string },
  target: { sha?: string; branch?: string }
): string {
  const base = `https://${host.host}/${host.namespace}/${host.repo}`;
  const gitlab = host.kind.toLowerCase().includes("gitlab");
  if (target.sha) return `${base}/${gitlab ? "-/" : ""}commit/${target.sha}`;
  if (target.branch) return `${base}/${gitlab ? "-/" : ""}tree/${encodeURI(target.branch)}`;
  return base;
}

/**
 * Executes a Git Graph context-menu action against the real backend.
 * `input` carries the user-provided name for actions in {@link needsPrompt}.
 */
export async function executeGraphAction(action: GraphAction, input?: string): Promise<void> {
  const sha = str(action, "sha");
  const name = str(action, "name");
  const kind = str(action, "kind");

  try {
    switch (action.type) {
      case "checkout-detached":
        if (sha) await run(commands.checkout(sha));
        break;
      case "checkout-ref":
        if (name) {
          // Checking out "origin/foo" by its short name lets git create a tracking branch.
          const target = kind === "RemoteBranch" ? splitRemoteRef(name).branch : name;
          await run(commands.checkout(target));
        }
        break;
      case "create-branch":
        if (input) await run(commands.createBranch(input, sha ?? null));
        break;
      case "create-tag":
        if (input) await run(commands.createTag(input, sha ?? null, null));
        break;
      case "rename-ref":
        if (name && input && input !== name) await run(commands.renameBranch(name, input));
        break;
      case "delete-ref":
        if (!name) break;
        if (kind === "RemoteBranch") {
          const { remote, branch } = splitRemoteRef(name);
          await run(commands.deleteRemoteBranch(remote, branch));
        } else if (kind === "Tag") {
          await run(commands.deleteTag(name));
        } else {
          await run(commands.deleteBranch(name, false));
        }
        break;
      case "cherry-pick":
        if (sha) await run(commands.cherryPick(sha));
        break;
      case "revert":
        if (sha) await run(commands.revert(sha));
        break;
      case "reset-soft":
      case "reset-mixed":
      case "reset-hard":
        if (sha) await run(commands.reset(sha, action.type.slice("reset-".length)));
        break;
      case "merge-into-current":
        if (sha) await run(commands.merge(sha, null));
        break;
      case "merge-ref-into-current":
        if (name) await run(commands.merge(name, null));
        break;
      case "rebase-onto":
        if (sha) await run(commands.rebase(sha));
        break;
      case "rebase-current-onto-ref":
        if (name) await run(commands.rebase(name));
        break;
      case "push-ref":
        if (name) {
          if (kind === "Tag") {
            await run(commands.pushTag(name, null));
          } else {
            await run(
              commands.push({
                remote: null,
                branch: name,
                set_upstream: true,
                force_with_lease: false,
                tags: false,
              })
            );
          }
        }
        break;
      case "set-upstream":
        if (name) await run(commands.setUpstream(name, `origin/${name}`));
        break;
      case "create-pr":
        useUIStore.getState().setCreatePrOpen(true);
        return;
      case "open-web": {
        const host = await run(commands.hostInfo());
        if (!host) {
          throw toAppError(new Error("No supported hosting remote (GitHub/GitLab) found for this repository"));
        }
        await run(commands.openUrl(webUrlFor(host, { sha, branch: name })));
        return;
      }
      case "copy-sha":
      case "copy-message":
        // Clipboard write happens in the menu itself.
        return;
      default:
        return;
    }
    await refreshAll();
  } catch (err) {
    reportAppError(toAppError(err));
    // State may have partially changed (e.g. a conflicted cherry-pick); refresh anyway.
    await refreshAll().catch(() => {});
  }
}
