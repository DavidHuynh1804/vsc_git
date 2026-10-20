import { isTauri } from "@tauri-apps/api/core";

/**
 * Returns true when the Playwright E2E bridge shim (src/e2eBridge.ts) is
 * active: the dev server was started with VITE_E2E_BRIDGE=1 and the page is
 * NOT inside a real Tauri webview (i.e. it runs in Chromium) where the shim
 * relays IPC to the real app through the debug-only bridge.
 */
export function isE2eBridge(): boolean {
  if (typeof import.meta !== "undefined" && import.meta.env) {
    return import.meta.env.VITE_E2E_BRIDGE === "1" && !isTauri();
  }
  return false;
}

/**
 * Returns true if mock data source should be used instead of Tauri IPC commands.
 * Defaults to Tauri when running inside Tauri, mock when in test or VITE_USE_MOCK=1.
 */
export function isMock(): boolean {
  if (isE2eBridge()) {
    // Chromium drives the real backend through the bridge shim.
    return false;
  }
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") {
    return true;
  }
  if (typeof import.meta !== "undefined" && import.meta.env) {
    if (
      import.meta.env.MODE === "test" ||
      import.meta.env.VITE_USE_MOCK === "1" ||
      import.meta.env.VITE_USE_MOCK === "true"
    ) {
      return true;
    }
  }
  return !isTauri();
}
