/**
 * E2E bridge shim (Chromium only).
 *
 * When `VITE_E2E_BRIDGE=1` is set and the page is NOT running inside a real
 * Tauri webview, this module replaces `window.__TAURI_INTERNALS__` with a shim
 * that speaks to the debug-only bridge HTTP server started by
 * `src-tauri/src/e2e_bridge.rs` (see `VSC_GIT_E2E_BRIDGE_PORT`):
 *
 * * `invoke` is relayed to the real app webview over `POST /invoke`, so every
 *   command runs against the real backend with real git state.
 * * Backend events arrive over `GET /events` (SSE) and are dispatched to
 *   `plugin:event|listen` registrations exactly like real Tauri `runCallback`.
 * * Native-only pieces are stubbed: `pick_folder` returns the path set through
 *   `POST /control` (or `null` when unset) and `plugin:updater|check` reports
 *   "no update" so no network/native dialog is involved.
 *
 * The module must be imported before any app module that captures `isMock()`
 * (see `src/main.tsx`), and it is a no-op inside the real app webview and under
 * Vitest.
 */
import { isE2eBridge } from "./env";

const DEFAULT_BRIDGE_PORT = 9321;

interface EventRegistration {
  event: string;
  callbackId: number;
}

interface InternalsLike {
  __e2eBridge?: boolean;
  invoke: (cmd: string, args?: unknown, options?: unknown) => Promise<unknown>;
  transformCallback: (
    callback?: (response: unknown) => void,
    once?: boolean
  ) => number;
  unregisterCallback: (id: number) => void;
  runCallback: (id: number, data?: unknown) => void;
  callbacks: Map<number, (data: unknown) => unknown>;
}

function bridgePort(): number {
  const raw = import.meta.env.VITE_E2E_BRIDGE_PORT;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BRIDGE_PORT;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Installs the shim. Idempotent; returns the uninstall function. */
export function setupE2eBridge(): () => void {
  const win = window as unknown as { __TAURI_INTERNALS__?: InternalsLike };
  const internals = (win.__TAURI_INTERNALS__ ??= {} as InternalsLike);
  if (internals.__e2eBridge) {
    return () => {};
  }
  internals.__e2eBridge = true;

  const base = `http://127.0.0.1:${bridgePort()}`;

  // --- callback registry (mirrors @tauri-apps/api/mocks) -------------------
  const callbacks = new Map<number, (data: unknown) => unknown>();
  let nextCallbackId = 1;

  function transformCallback(
    callback?: (response: unknown) => void,
    once = false
  ): number {
    const identifier = nextCallbackId++;
    callbacks.set(identifier, (data) => {
      if (once) {
        callbacks.delete(identifier);
      }
      return callback?.(data);
    });
    return identifier;
  }

  function unregisterCallback(id: number): void {
    callbacks.delete(id);
  }

  function runCallback(id: number, data?: unknown): void {
    const callback = callbacks.get(id);
    if (callback) {
      callback(data);
    } else {
      console.warn(
        `[e2e-bridge] Couldn't find callback id ${id}. This might happen when the page is reloaded while Rust is running an asynchronous operation.`
      );
    }
  }

  // --- event registrations --------------------------------------------------
  const registrations = new Map<number, EventRegistration>();
  let nextEventId = 1;

  function registerListener(event: string, handlerId: number): number {
    const eventId = nextEventId++;
    registrations.set(eventId, { event, callbackId: handlerId });
    return eventId;
  }

  function unregisterListener(eventId: number): void {
    registrations.delete(eventId);
  }

  function removeRegistrationForCallback(callbackId: number): void {
    for (const [eventId, reg] of registrations) {
      if (reg.callbackId === callbackId) {
        registrations.delete(eventId);
      }
    }
  }

  function dispatchEvent(event: string, payload: unknown): void {
    for (const [eventId, reg] of registrations) {
      if (reg.event !== event) continue;
      runCallback(reg.callbackId, { event, id: eventId, payload });
    }
  }

  // --- HTTP helpers ---------------------------------------------------------
  async function postJson(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`e2e-bridge: HTTP ${response.status} for ${path}`);
    }
    return response.json();
  }

  async function invoke(cmd: string, rawArgs?: unknown, _options?: unknown): Promise<unknown> {
    const args: Record<string, unknown> = isRecord(rawArgs) ? rawArgs : {};
    switch (cmd) {
      case "plugin:event|listen": {
        const event = String(args.event ?? "");
        const handler = Number(args.handler);
        return registerListener(event, handler);
      }
      case "plugin:event|unlisten": {
        unregisterListener(Number(args.eventId));
        return null;
      }
      case "plugin:event|emit":
      case "plugin:event|emit_to": {
        // Relay to the real backend so Rust-side and webview-side listeners
        // behave exactly like in the app; the event comes back over SSE.
        const response = (await postJson("/invoke", { cmd, args })) as {
          ok: boolean;
          result?: unknown;
          error?: unknown;
        };
        if (!response.ok) {
          throw response.error;
        }
        return response.result ?? null;
      }
      case "pick_folder": {
        // Native-only: always answered by the bridge stub (never relays, so no
        // native dialog can ever open in the real app window).
        const response = await fetch(`${base}/stub/pick_folder`);
        if (!response.ok) {
          throw new Error(`e2e-bridge: HTTP ${response.status} for pick_folder`);
        }
        const data = (await response.json()) as { path: string | null };
        return data.path;
      }
      case "plugin:updater|check":
        // Stub: never hit the network; report "no update available".
        return null;
      default: {
        const response = (await postJson("/invoke", { cmd, args })) as {
          ok: boolean;
          result?: unknown;
          error?: unknown;
        };
        if (!response.ok) {
          throw response.error;
        }
        return response.result ?? null;
      }
    }
  }

  internals.invoke = invoke;
  internals.transformCallback = transformCallback;
  internals.unregisterCallback = unregisterCallback;
  internals.runCallback = runCallback;
  internals.callbacks = callbacks;

  const eventPluginInternals = ((
    window as unknown as Record<string, unknown>
  ).__TAURI_EVENT_PLUGIN_INTERNALS__ ??= {}) as {
    unregisterListener?: (event: string, eventId: number) => void;
  };
  eventPluginInternals.unregisterListener = (_event: string, eventId: number) => {
    unregisterListener(eventId);
  };

  // Keep callback bookkeeping tidy when the frontend drops its unlisten cb.
  const originalUnregister = unregisterCallback;
  internals.unregisterCallback = (id: number) => {
    removeRegistrationForCallback(id);
    originalUnregister(id);
  };

  // --- SSE stream for backend events ---------------------------------------
  const debug = {
    sseConnected: false,
    sseMessages: 0,
    lastEvent: null as string | null,
    listenersFor: (event: string): number =>
      [...registrations.values()].filter((reg) => reg.event === event).length,
  };
  (win as unknown as Record<string, unknown>).__e2eBridgeDebug = debug;

  const source = new EventSource(`${base}/events`);
  source.onopen = () => {
    debug.sseConnected = true;
  };
  source.onmessage = (message: MessageEvent<string>) => {
    debug.sseMessages += 1;
    try {
      const data = JSON.parse(message.data) as {
        event: string;
        payload: unknown;
      };
      debug.lastEvent = data.event;
      dispatchEvent(data.event, data.payload);
    } catch (error) {
      console.warn("[e2e-bridge] malformed SSE message", error);
    }
  };
  source.onerror = () => {
    // EventSource reconnects automatically; surface it for test debugging.
    debug.sseConnected = false;
    console.warn("[e2e-bridge] SSE connection issue; retrying");
  };

  console.info(`[e2e-bridge] shim installed, backend at ${base}`);
  console.info(
    `[e2e-bridge] control stubs via POST ${base}/control, e.g. {"pick_folder":"/path"}`
  );

  return () => {
    source.close();
  };
}

if (isE2eBridge()) {
  setupE2eBridge();
}
