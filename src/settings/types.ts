import { commands, HostConfig } from "@/bindings";

export type SmartCommitOption = "ask" | "always" | "never";
export type UntrackedChangesOption = "mixed" | "separate" | "hidden";
export type ScmViewModeOption = "list" | "tree";
export type DateFormatOption = "relative" | "absolute";
export type AiProviderOption = "claude" | "openai" | "ollama";
export type AiLanguageOption = "auto" | "en" | "vi";
export type UIThemeOption = "system" | "dark" | "light";
export type UpdateChannelOption = "stable" | "beta";

export interface AppSettings {
  "git.path": string | null;
  "git.autoFetch": boolean;
  "git.autoFetchPeriodSec": number;
  "git.confirmSync": boolean;
  "git.enableSmartCommit": SmartCommitOption;
  "git.untrackedChanges": UntrackedChangesOption;
  "git.pruneOnFetch": boolean;
  "git.defaultCloneDir": string | null;
  "scm.viewMode": ScmViewModeOption;
  "diff.renderSideBySide": boolean;
  "diff.ignoreTrimWhitespace": boolean;
  "graph.showRemoteBranches": boolean;
  "graph.showTags": boolean;
  "graph.showStashes": boolean;
  "graph.dateFormat": DateFormatOption;
  "graph.pageSize": number;
  "externalEditor.command": string;
  "externalEditor.args": string[];
  "ai.enabled": boolean;
  "ai.provider": AiProviderOption;
  "ai.model": string;
  "ai.baseUrl": string | null;
  "ai.language": AiLanguageOption;
  "ai.maxDiffTokens": number;
  "ai.excludeGlobs": string[];
  "ai.disabledRepos": string[];
  hosts: HostConfig[];
  "ui.theme": UIThemeOption;
  "update.channel": UpdateChannelOption;
}

export const DEFAULT_SETTINGS: AppSettings = {
  "git.path": null,
  "git.autoFetch": true,
  "git.autoFetchPeriodSec": 180,
  "git.confirmSync": true,
  "git.enableSmartCommit": "ask",
  "git.untrackedChanges": "mixed",
  "git.pruneOnFetch": true,
  "git.defaultCloneDir": null,
  "scm.viewMode": "list",
  "diff.renderSideBySide": true,
  "diff.ignoreTrimWhitespace": false,
  "graph.showRemoteBranches": true,
  "graph.showTags": true,
  "graph.showStashes": true,
  "graph.dateFormat": "relative",
  "graph.pageSize": 500,
  "externalEditor.command": "code",
  "externalEditor.args": ["--goto", "{file}:{line}"],
  "ai.enabled": true,
  "ai.provider": "claude",
  "ai.model": "claude-haiku-5-5",
  "ai.baseUrl": null,
  "ai.language": "auto",
  "ai.maxDiffTokens": 20000,
  "ai.excludeGlobs": [
    "**/*.lock",
    "**/package-lock.json",
    "**/pnpm-lock.yaml",
    "**/*.min.*",
    "dist/**",
    "build/**",
  ],
  "ai.disabledRepos": [],
  hosts: [
    { host: "github.com", kind: "github", apiBaseUrl: "https://api.github.com" },
    { host: "gitlab.com", kind: "gitlab", apiBaseUrl: "https://gitlab.com/api/v4" },
  ],
  "ui.theme": "system",
  "update.channel": "stable",
};

export type SettingKey = keyof AppSettings;

export function validateSetting<K extends SettingKey>(
  key: K,
  value: AppSettings[K]
): { valid: boolean; error?: string } {
  switch (key) {
    case "git.autoFetchPeriodSec":
    case "graph.pageSize":
    case "ai.maxDiffTokens": {
      const num = Number(value);
      if (isNaN(num) || !Number.isInteger(num) || num <= 0) {
        return { valid: false, error: "Must be a positive integer" };
      }
      return { valid: true };
    }
    case "ai.baseUrl": {
      if (value === null || value === "") {
        return { valid: true };
      }
      try {
        const url = new URL(String(value));
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          return { valid: false, error: "Must use http:// or https://" };
        }
        return { valid: true };
      } catch {
        return { valid: false, error: "Invalid URL format" };
      }
    }
    case "ai.excludeGlobs": {
      if (!Array.isArray(value)) {
        return { valid: false, error: "Must be an array of globs" };
      }
      for (const item of value) {
        if (typeof item !== "string" || item.trim() === "") {
          return { valid: false, error: "Glob entries cannot be empty" };
        }
      }
      return { valid: true };
    }
    default:
      return { valid: true };
  }
}

export function validateRawSettingsJson(jsonStr: string): {
  valid: boolean;
  data?: Partial<AppSettings>;
  error?: string;
} {
  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { valid: false, error: "Settings must be a JSON object" };
    }

    for (const [k, v] of Object.entries(parsed)) {
      if (k in DEFAULT_SETTINGS) {
        const check = validateSetting(k as SettingKey, v as never);
        if (!check.valid) {
          return { valid: false, error: `Invalid ${k}: ${check.error}` };
        }
      }
    }

    return { valid: true, data: parsed };
  } catch (err: unknown) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Malformed JSON syntax",
    };
  }
}

export interface SettingsDataSource {
  get(): Promise<AppSettings>;
  patch(partial: Partial<AppSettings>): Promise<AppSettings>;
  reset(key: SettingKey): Promise<AppSettings>;
  resetAll(): Promise<AppSettings>;
  onChanged(cb: (settings: AppSettings) => void): () => void;
}

export class MockSettingsDataSource implements SettingsDataSource {
  private current: AppSettings;
  private listeners: Set<(settings: AppSettings) => void> = new Set();

  constructor(initial: Partial<AppSettings> = {}) {
    this.current = { ...DEFAULT_SETTINGS, ...initial };
  }

  async get(): Promise<AppSettings> {
    return { ...this.current };
  }

  async patch(partial: Partial<AppSettings>): Promise<AppSettings> {
    this.current = { ...this.current, ...partial };
    this.notify();
    return { ...this.current };
  }

  async reset(key: SettingKey): Promise<AppSettings> {
    this.current = {
      ...this.current,
      [key]: DEFAULT_SETTINGS[key],
    };
    this.notify();
    return { ...this.current };
  }

  async resetAll(): Promise<AppSettings> {
    this.current = { ...DEFAULT_SETTINGS };
    this.notify();
    return { ...this.current };
  }

  onChanged(cb: (settings: AppSettings) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify() {
    for (const cb of this.listeners) {
      cb({ ...this.current });
    }
  }
}

/**
 * TauriSettingsDataSource delegates to backend IPC via `get_settings` and `set_settings`.
 * Fallback to in-memory mock if run outside Tauri environment.
 */
export class TauriSettingsDataSource implements SettingsDataSource {
  private listeners: Set<(settings: AppSettings) => void> = new Set();
  private mockFallback = new MockSettingsDataSource();

  async get(): Promise<AppSettings> {
    try {
      const res = await commands.getSettings();
      if (res.status === "ok" && res.data) {
        return { ...DEFAULT_SETTINGS, ...(res.data as unknown as Partial<AppSettings>) };
      }
    } catch {
      // Running in test or web fallback
    }
    return this.mockFallback.get();
  }

  async patch(partial: Partial<AppSettings>): Promise<AppSettings> {
    try {
      const res = await commands.setSettings(JSON.stringify(partial));
      if (res.status === "ok" && res.data) {
        const merged: AppSettings = {
          ...DEFAULT_SETTINGS,
          ...(res.data as unknown as Partial<AppSettings>),
        };
        this.notify(merged);
        return merged;
      }
    } catch {
      // Running in test or web fallback
    }
    const updated = await this.mockFallback.patch(partial);
    this.notify(updated);
    return updated;
  }

  async reset(key: SettingKey): Promise<AppSettings> {
    const resetPatch = { [key]: DEFAULT_SETTINGS[key] } as Partial<AppSettings>;
    return this.patch(resetPatch);
  }

  async resetAll(): Promise<AppSettings> {
    return this.patch(DEFAULT_SETTINGS);
  }

  onChanged(cb: (settings: AppSettings) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify(settings: AppSettings) {
    for (const cb of this.listeners) {
      cb({ ...settings });
    }
  }
}

export function isSettingModified<K extends SettingKey>(
  key: K,
  settings: AppSettings
): boolean {
  return JSON.stringify(settings[key]) !== JSON.stringify(DEFAULT_SETTINGS[key]);
}
