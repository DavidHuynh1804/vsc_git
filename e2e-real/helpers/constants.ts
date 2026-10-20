import os from "node:os";
import path from "node:path";

export const DEV_PORT = 5273;
/**
 * Isolated HOME for the app and for test-side git: keeps the suite away from the
 * developer's real settings.json, recent repos and ~/.gitconfig (e.g.
 * push.autoSetupRemote would hide upstream bugs). Created by launch-app.mjs.
 */
export const E2E_HOME = path.join(os.tmpdir(), "vsc-git-e2e-real", "home");
export const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT ?? 9321);
export const DEV_URL = `http://127.0.0.1:${DEV_PORT}`;
export const BRIDGE_URL = `http://127.0.0.1:${BRIDGE_PORT}`;
/** Tauri identifier; used to locate the app config dir (settings.json). */
export const APP_IDENTIFIER = "io.github.davidhuynh1804.vscgit";
