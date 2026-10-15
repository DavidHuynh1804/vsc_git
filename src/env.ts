import { isTauri } from "@tauri-apps/api/core";

/**
 * Returns true if mock data source should be used instead of Tauri IPC commands.
 * Defaults to Tauri when running inside Tauri, mock when in test or VITE_USE_MOCK=1.
 */
export function isMock(): boolean {
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
