/**
 * Node-side client for the debug-only bridge HTTP server (src-tauri/src/e2e_bridge.rs).
 *
 * `bridgeInvoke` relays a command into the real app webview, so it runs against
 * the real backend with the real session/window — the same thing the Chromium
 * UI does through the shim (src/e2eBridge.ts). Tests use it for setup steps and
 * backend-level assertions; UI flows use the page itself.
 */
import { BRIDGE_URL } from "./constants";

export class BridgeInvokeError extends Error {
  readonly cmd: string;
  readonly info: unknown;

  constructor(cmd: string, info: unknown) {
    const message =
      typeof info === "object" && info !== null && "message" in info
        ? String((info as { message: unknown }).message)
        : JSON.stringify(info);
    super(`bridge invoke '${cmd}' failed: ${message}`);
    this.name = "BridgeInvokeError";
    this.cmd = cmd;
    this.info = info;
  }
}

interface InvokeResponse<T> {
  ok: boolean;
  result?: T;
  error?: unknown;
}

export async function bridgeInvoke<T = unknown>(
  cmd: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const response = await fetch(`${BRIDGE_URL}/invoke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cmd, args }),
  });
  if (!response.ok) {
    throw new Error(`bridge invoke '${cmd}' HTTP ${response.status}`);
  }
  const body = (await response.json()) as InvokeResponse<T>;
  if (!body.ok) {
    throw new BridgeInvokeError(cmd, body.error);
  }
  return body.result as T;
}

/** Configures the bridge's native-only stubs (e.g. the folder picker path). */
export async function bridgeControl(patch: { pick_folder?: string | null }): Promise<void> {
  const response = await fetch(`${BRIDGE_URL}/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    throw new Error(`bridge control HTTP ${response.status}`);
  }
}

export interface RepoInfo {
  root: string;
  head_branch: string;
}

export async function bridgeOpenRepo(path: string): Promise<RepoInfo> {
  return bridgeInvoke<RepoInfo>("open_repo", { path });
}

export async function bridgeCurrentRepo(): Promise<RepoInfo | null> {
  return bridgeInvoke<RepoInfo | null>("get_current_repo");
}
