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
  "update_channel"?: UpdateChannelOption;
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

export function isValidGlob(pattern: string): { valid: boolean; error?: string } {
  if (typeof pattern !== "string" || pattern.trim() === "") {
    return { valid: false, error: "Glob pattern cannot be empty" };
  }
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "[") {
      bracketDepth++;
      if (bracketDepth > 1) {
        return { valid: false, error: `Nested square brackets in glob: "${pattern}"` };
      }
    } else if (ch === "]") {
      if (bracketDepth === 0) {
        return { valid: false, error: `Unmatched closing bracket in glob: "${pattern}"` };
      }
      bracketDepth--;
    } else if (ch === "{") {
      braceDepth++;
    } else if (ch === "}") {
      if (braceDepth === 0) {
        return { valid: false, error: `Unmatched closing brace in glob: "${pattern}"` };
      }
      braceDepth--;
    }
  }
  if (bracketDepth !== 0) {
    return { valid: false, error: `Unmatched opening bracket in glob: "${pattern}"` };
  }
  if (braceDepth !== 0) {
    return { valid: false, error: `Unmatched opening brace in glob: "${pattern}"` };
  }
  return { valid: true };
}

const VALID_SMART_COMMIT: Record<string, true> = { ask: true, always: true, never: true };
const VALID_UNTRACKED: Record<string, true> = { mixed: true, separate: true, hidden: true };
const VALID_SCM_VIEW_MODE: Record<string, true> = { list: true, tree: true };
const VALID_DATE_FORMAT: Record<string, true> = { relative: true, absolute: true };
const VALID_AI_PROVIDER: Record<string, true> = { claude: true, openai: true, ollama: true };
const VALID_AI_LANG: Record<string, true> = { auto: true, en: true, vi: true };
const VALID_THEME: Record<string, true> = { system: true, dark: true, light: true };
const VALID_CHANNEL: Record<string, true> = { stable: true, beta: true };

export function validateSetting<K extends SettingKey>(
  key: K,
  value: AppSettings[K]
): { valid: boolean; error?: string } {
  switch (key) {
    case "git.autoFetch":
    case "git.confirmSync":
    case "git.pruneOnFetch":
    case "diff.renderSideBySide":
    case "diff.ignoreTrimWhitespace":
    case "graph.showRemoteBranches":
    case "graph.showTags":
    case "graph.showStashes":
    case "ai.enabled": {
      if (typeof value !== "boolean") {
        return { valid: false, error: "Must be a boolean (true/false)" };
      }
      return { valid: true };
    }
    case "git.autoFetchPeriodSec":
    case "graph.pageSize":
    case "ai.maxDiffTokens": {
      const num = Number(value);
      if (typeof value !== "number" || isNaN(num) || !Number.isInteger(num) || num <= 0) {
        return { valid: false, error: "Must be a positive integer" };
      }
      return { valid: true };
    }
    case "git.enableSmartCommit": {
      if (typeof value !== "string" || !VALID_SMART_COMMIT[value]) {
        return { valid: false, error: "Must be one of: 'ask', 'always', 'never'" };
      }
      return { valid: true };
    }
    case "git.untrackedChanges": {
      if (typeof value !== "string" || !VALID_UNTRACKED[value]) {
        return { valid: false, error: "Must be one of: 'mixed', 'separate', 'hidden'" };
      }
      return { valid: true };
    }
    case "scm.viewMode": {
      if (typeof value !== "string" || !VALID_SCM_VIEW_MODE[value]) {
        return { valid: false, error: "Must be one of: 'list', 'tree'" };
      }
      return { valid: true };
    }
    case "graph.dateFormat": {
      if (typeof value !== "string" || !VALID_DATE_FORMAT[value]) {
        return { valid: false, error: "Must be one of: 'relative', 'absolute'" };
      }
      return { valid: true };
    }
    case "ai.provider": {
      if (typeof value !== "string" || !VALID_AI_PROVIDER[value]) {
        return { valid: false, error: "Must be one of: 'claude', 'openai', 'ollama'" };
      }
      return { valid: true };
    }
    case "ai.language": {
      if (typeof value !== "string" || !VALID_AI_LANG[value]) {
        return { valid: false, error: "Must be one of: 'auto', 'en', 'vi'" };
      }
      return { valid: true };
    }
    case "ui.theme": {
      if (typeof value !== "string" || !VALID_THEME[value]) {
        return { valid: false, error: "Must be one of: 'system', 'dark', 'light'" };
      }
      return { valid: true };
    }
    case "update_channel":
    case "update.channel": {
      if (typeof value !== "string" || !VALID_CHANNEL[value]) {
        return { valid: false, error: "Must be one of: 'stable', 'beta'" };
      }
      return { valid: true };
    }
    case "git.path":
    case "git.defaultCloneDir": {
      if (value !== null && typeof value !== "string") {
        return { valid: false, error: "Must be a string or null" };
      }
      return { valid: true };
    }
    case "externalEditor.command":
    case "ai.model": {
      if (typeof value !== "string" || value.trim() === "") {
        return { valid: false, error: "Must be a non-empty string" };
      }
      return { valid: true };
    }
    case "externalEditor.args":
    case "ai.disabledRepos": {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        return { valid: false, error: "Must be an array of strings" };
      }
      return { valid: true };
    }
    case "ai.baseUrl": {
      if (value === null || value === "") {
        return { valid: true };
      }
      if (typeof value !== "string") {
        return { valid: false, error: "Must be a string or null" };
      }
      try {
        const url = new URL(value);
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
        const check = isValidGlob(item);
        if (!check.valid) {
          return { valid: false, error: check.error };
        }
      }
      return { valid: true };
    }
    case "hosts": {
      if (!Array.isArray(value)) {
        return { valid: false, error: "Hosts must be an array" };
      }
      for (const host of value) {
        if (
          typeof host !== "object" ||
          host === null ||
          typeof host.host !== "string" ||
          !host.host.trim() ||
          typeof host.kind !== "string" ||
          typeof host.apiBaseUrl !== "string"
        ) {
          return { valid: false, error: "Invalid host configuration object" };
        }
        try {
          new URL(host.apiBaseUrl);
        } catch {
          return { valid: false, error: `Invalid apiBaseUrl for host ${host.host}` };
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
      if (!(k in DEFAULT_SETTINGS)) {
        return { valid: false, error: `Unknown setting key: "${k}"` };
      }
      const check = validateSetting(k as SettingKey, v as never);
      if (!check.valid) {
        return { valid: false, error: `Invalid ${k}: ${check.error}` };
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
