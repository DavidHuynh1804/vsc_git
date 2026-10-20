import path from "node:path";
import { APP_IDENTIFIER, E2E_HOME } from "./constants";

/** Same resolution the Tauri path API uses for the app config dir. */
export function appConfigDir(): string {
  if (process.platform === "darwin") {
    return path.join(E2E_HOME, "Library", "Application Support", APP_IDENTIFIER);
  }
  if (process.platform === "win32") {
    return path.join(
      path.join(E2E_HOME, "AppData", "Roaming"),
      APP_IDENTIFIER
    );
  }
  return path.join(
    path.join(E2E_HOME, ".config"),
    APP_IDENTIFIER
  );
}

export function settingsFilePath(): string {
  return path.join(appConfigDir(), "settings.json");
}
