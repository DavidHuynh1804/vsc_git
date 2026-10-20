import { defineConfig, devices } from "@playwright/test";

/**
 * E2E "real" suite: drives the actual Tauri app (debug build) with a real
 * backend and real git repositories.
 *
 * Architecture (see docs/e2e-real.md):
 * - vite dev server on 127.0.0.1:5273 with VITE_E2E_BRIDGE=1
 * - debug app binary launched by e2e-real/launch-app.mjs with
 *   VSC_GIT_E2E_BRIDGE_PORT=9321 (its devUrl is overridden to 5273 at build
 *   time by e2e-real/build-app.mjs)
 * - Chromium loads the same dev server; the shim (src/e2eBridge.ts) relays
 *   every invoke to the real app webview and streams backend events back.
 */

const DEV_PORT = 5273;
const BRIDGE_PORT = 9321;
const DEV_URL = `http://127.0.0.1:${DEV_PORT}`;
const BRIDGE_URL = `http://127.0.0.1:${BRIDGE_PORT}`;

export default defineConfig({
  testDir: "./e2e-real/specs",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: DEV_URL,
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command: "pnpm dev:e2e",
      url: DEV_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        VITE_E2E_BRIDGE: "1",
        VITE_E2E_BRIDGE_PORT: String(BRIDGE_PORT),
      },
    },
    {
      command: "node e2e-real/launch-app.mjs",
      // /ready performs a real round-trip into the app webview, so the suite
      // only starts once the real backend can answer invokes.
      url: `${BRIDGE_URL}/ready`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        E2E_BRIDGE_PORT: String(BRIDGE_PORT),
      },
    },
  ],
});
