import React, { useState, useEffect, useRef, useTransition, useMemo } from "react";
import {
  AppSettings,
  DEFAULT_SETTINGS,
  SettingKey,
  SettingsDataSource,
  isSettingModified,
  validateSetting,
  validateRawSettingsJson,
} from "@/settings/types";
import { AiDataSource, HostingDataSource } from "@/integrations/types";
import { defaultAiDataSource } from "@/integrations/ai";
import { defaultHostingDataSource } from "@/integrations/hosting";
import { AiSection } from "./AiSection";
import { HostsSection } from "./HostsSection";
import { ListEditor } from "./ListEditor";
import { useUIStore } from "@/stores/ui";
import {
  Search,
  RotateCcw,
  Code,
  Sliders,
  Check,
  AlertCircle,
  GitBranch,
  FolderGit2,
  Columns,
  GitGraph,
  ExternalLink,
  Sparkles,
  Server,
  Palette,
  ArrowUpCircle,
} from "lucide-react";

export type SettingsSectionId =
  | "git"
  | "scm"
  | "diff"
  | "graph"
  | "externalEditor"
  | "ai"
  | "hosts"
  | "appearance"
  | "updates";

interface SectionDef {
  id: SettingsSectionId;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SECTIONS: SectionDef[] = [
  { id: "git", title: "Git", icon: GitBranch },
  { id: "scm", title: "Source Control", icon: FolderGit2 },
  { id: "diff", title: "Diff", icon: Columns },
  { id: "graph", title: "Graph", icon: GitGraph },
  { id: "externalEditor", title: "External Editor", icon: ExternalLink },
  { id: "ai", title: "AI Assistance", icon: Sparkles },
  { id: "hosts", title: "Hosting & Remotes", icon: Server },
  { id: "appearance", title: "Appearance", icon: Palette },
  { id: "updates", title: "Updates", icon: ArrowUpCircle },
];

export interface SettingsViewProps {
  dataSource: SettingsDataSource;
  aiDataSource?: AiDataSource;
  hostingDataSource?: HostingDataSource;
  onClose?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  dataSource,
  aiDataSource = defaultAiDataSource,
  hostingDataSource = defaultHostingDataSource,
}) => {
  const [, startTransition] = useTransition();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("git");
  const [searchQuery, setSearchQuery] = useState("");
  const [mode, setMode] = useState<"ui" | "json">("ui");

  // Raw JSON state
  const [rawJsonText, setRawJsonText] = useState("");
  const [rawJsonError, setRawJsonError] = useState<string | null>(null);
  const [rawJsonSaved, setRawJsonSaved] = useState(false);

  // Validation errors map
  const [errors, setErrors] = useState<Partial<Record<SettingKey, string>>>({});

  // Debounce save timer
  const debounceTimerRef = useRef<number | undefined>(undefined);

  // Load initial settings
  useEffect(() => {
    let active = true;
    dataSource.get().then((loaded) => {
      if (active) {
        startTransition(() => {
          setSettings(loaded);
          setRawJsonText(JSON.stringify(loaded, null, 2));
          setLoading(false);
        });
      }
    });

    const unsub = dataSource.onChanged((updated) => {
      if (active) {
        startTransition(() => {
          setSettings(updated);
          setRawJsonText(JSON.stringify(updated, null, 2));
        });
      }
    });

    return () => {
      active = false;
      unsub();
      clearTimeout(debounceTimerRef.current);
    };
  }, [dataSource]);

  // Patch a setting and debounce save to dataSource
  const handleUpdate = (patch: Partial<AppSettings>) => {
    // Validate fields in patch
    const newErrors = { ...errors };
    let hasError = false;

    for (const [k, v] of Object.entries(patch)) {
      const key = k as SettingKey;
      const check = validateSetting(key, v as never);
      if (!check.valid) {
        newErrors[key] = check.error;
        hasError = true;
      } else {
        delete newErrors[key];
      }
    }

    setErrors(newErrors);

    const merged = { ...settings, ...patch };
    setSettings(merged);
    setRawJsonText(JSON.stringify(merged, null, 2));

    if (!hasError) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = window.setTimeout(() => {
        dataSource.patch(patch);
      }, 300);
    }
  };

  const handleResetSetting = async (key: SettingKey) => {
    const updated = await dataSource.reset(key);
    setSettings(updated);
    setRawJsonText(JSON.stringify(updated, null, 2));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleResetAll = async () => {
    if (confirm("Reset all settings to default values?")) {
      const updated = await dataSource.resetAll();
      setSettings(updated);
      setRawJsonText(JSON.stringify(updated, null, 2));
      setErrors({});
    }
  };

  const handleSaveRawJson = async () => {
    const check = validateRawSettingsJson(rawJsonText);
    if (!check.valid || !check.data) {
      setRawJsonError(check.error ?? "Invalid JSON format");
      return;
    }

    setRawJsonError(null);
    const updated = await dataSource.patch(check.data);
    setSettings(updated);
    setRawJsonText(JSON.stringify(updated, null, 2));
    setRawJsonSaved(true);
    setTimeout(() => setRawJsonSaved(false), 3000);
  };

  // Filter sections & items based on searchQuery
  const matchesSearch = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return (text: string) => !q || text.toLowerCase().includes(q);
  }, [searchQuery]);

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8 text-xs text-vscode-muted">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-vscode-bg text-vscode-fg select-none">
      {/* Top Header */}
      <div className="flex h-11 items-center justify-between border-b border-vscode-border px-4 bg-vscode-sidebar/50">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-xs tracking-wide">SETTINGS</span>
          <div className="flex items-center rounded border border-vscode-border bg-vscode-input ml-4 px-2 py-1 w-64 md:w-80">
            <Search className="h-3.5 w-3.5 text-vscode-muted mr-1.5 flex-shrink-0" />
            <input
              type="text"
              placeholder="Search settings (e.g. autoFetch, ai.model, diff)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent text-xs text-vscode-fg focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Mode Switcher */}
          <div className="flex rounded border border-vscode-border bg-vscode-hover p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode("ui")}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 transition-colors ${
                mode === "ui"
                  ? "bg-vscode-bg font-medium text-vscode-fg shadow-sm"
                  : "text-vscode-muted hover:text-vscode-fg"
              }`}
            >
              <Sliders className="h-3.5 w-3.5" />
              <span>UI</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setRawJsonText(JSON.stringify(settings, null, 2));
                setMode("json");
              }}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 transition-colors ${
                mode === "json"
                  ? "bg-vscode-bg font-medium text-vscode-fg shadow-sm"
                  : "text-vscode-muted hover:text-vscode-fg"
              }`}
            >
              <Code className="h-3.5 w-3.5" />
              <span>Open JSON</span>
            </button>
          </div>

          <button
            type="button"
            title="Reset all settings to default"
            onClick={handleResetAll}
            className="flex items-center gap-1.5 rounded border border-vscode-border bg-vscode-hover px-2.5 py-1 text-xs text-vscode-muted hover:text-vscode-fg transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset All</span>
          </button>
        </div>
      </div>

      {/* Main Body */}
      {mode === "json" ? (
        /* Raw JSON Editor */
        <div className="flex flex-1 flex-col p-4 overflow-hidden gap-3">
          <div className="flex items-center justify-between text-xs text-vscode-muted">
            <span className="font-mono">settings.json</span>
            <div className="flex items-center gap-2">
              {rawJsonSaved && (
                <span className="text-emerald-400 font-medium flex items-center gap-1">
                  <Check className="h-3 w-3" />
                  Saved
                </span>
              )}
              <button
                type="button"
                onClick={handleSaveRawJson}
                className="rounded bg-vscode-accent px-3 py-1 text-xs text-white hover:opacity-90 transition-opacity"
              >
                Apply JSON Changes
              </button>
            </div>
          </div>

          {rawJsonError && (
            <div className="flex items-center gap-2 rounded border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{rawJsonError}</span>
            </div>
          )}

          <textarea
            aria-label="Raw settings JSON editor"
            value={rawJsonText}
            onChange={(e) => {
              setRawJsonText(e.target.value);
              if (rawJsonError) setRawJsonError(null);
            }}
            spellCheck={false}
            className="flex-1 w-full rounded border border-vscode-border bg-vscode-input p-3 font-mono text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none resize-none leading-relaxed"
          />
        </div>
      ) : (
        /* Visual Form Sections */
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Section Nav Sidebar */}
          {!searchQuery && (
            <div className="w-48 flex-shrink-0 border-r border-vscode-border bg-vscode-sidebar/40 p-2 overflow-y-auto flex flex-col gap-0.5">
              {SECTIONS.map((sec) => {
                const Icon = sec.icon;
                const isActive = activeSection === sec.id;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => setActiveSection(sec.id)}
                    className={`flex items-center gap-2 rounded px-2.5 py-1.5 text-xs text-left transition-colors ${
                      isActive
                        ? "bg-vscode-accent text-white font-medium"
                        : "text-vscode-muted hover:bg-vscode-hover hover:text-vscode-fg"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>{sec.title}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Form Content Area */}
          <div className="flex-1 overflow-y-auto p-6 max-w-4xl">
            {/* Git Section */}
            {(searchQuery || activeSection === "git") && (
              <div className="flex flex-col gap-6 mb-10">
                <h2 className="text-sm font-semibold text-vscode-fg border-b border-vscode-border pb-2 flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-vscode-accent" />
                  <span>Git Configuration</span>
                </h2>

                {/* git.path */}
                {matchesSearch("git.path git executable path") && (
                  <SettingRow
                    label="Git Executable Path"
                    settingKey="git.path"
                    description="Custom path to git binary. Leave empty to detect from system PATH."
                    modified={isSettingModified("git.path", settings)}
                    error={errors["git.path"]}
                    onReset={() => handleResetSetting("git.path")}
                  >
                    <input
                      type="text"
                      placeholder="e.g. /usr/local/bin/git or C:\Program Files\Git\bin\git.exe"
                      value={settings["git.path"] ?? ""}
                      onChange={(e) =>
                        handleUpdate({ "git.path": e.target.value.trim() || null })
                      }
                      className="w-full rounded border border-vscode-border bg-vscode-input px-2.5 py-1.5 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
                    />
                  </SettingRow>
                )}

                {/* git.autoFetch */}
                {matchesSearch("git.autoFetch auto fetch") && (
                  <SettingRow
                    label="Auto Fetch"
                    settingKey="git.autoFetch"
                    description="When enabled, automatically fetches changes from remotes in the background."
                    modified={isSettingModified("git.autoFetch", settings)}
                    onReset={() => handleResetSetting("git.autoFetch")}
                  >
                    <input
                      type="checkbox"
                      aria-label="Auto Fetch"
                      checked={settings["git.autoFetch"]}
                      onChange={(e) => handleUpdate({ "git.autoFetch": e.target.checked })}
                      className="h-4 w-4 rounded accent-vscode-accent"
                    />
                  </SettingRow>
                )}

                {/* git.autoFetchPeriodSec */}
                {matchesSearch("git.autoFetchPeriodSec fetch interval") && (
                  <SettingRow
                    label="Auto Fetch Interval (Seconds)"
                    settingKey="git.autoFetchPeriodSec"
                    description="Interval in seconds between background fetch operations. Must be a positive integer."
                    modified={isSettingModified("git.autoFetchPeriodSec", settings)}
                    error={errors["git.autoFetchPeriodSec"]}
                    onReset={() => handleResetSetting("git.autoFetchPeriodSec")}
                  >
                    <input
                      type="number"
                      aria-label="Auto Fetch Interval (Seconds)"
                      min="10"
                      value={settings["git.autoFetchPeriodSec"]}
                      onChange={(e) =>
                        handleUpdate({
                          "git.autoFetchPeriodSec": parseInt(e.target.value, 10),
                        })
                      }
                      className="w-48 rounded border border-vscode-border bg-vscode-input px-2.5 py-1.5 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
                    />
                  </SettingRow>
                )}

                {/* git.confirmSync */}
                {matchesSearch("git.confirmSync confirm sync pull push") && (
                  <SettingRow
                    label="Confirm Sync"
                    settingKey="git.confirmSync"
                    description="Ask for confirmation before syncing (pulling and pushing) a repository."
                    modified={isSettingModified("git.confirmSync", settings)}
                    onReset={() => handleResetSetting("git.confirmSync")}
                  >
                    <input
                      type="checkbox"
                      checked={settings["git.confirmSync"]}
                      onChange={(e) => handleUpdate({ "git.confirmSync": e.target.checked })}
                      className="h-4 w-4 rounded accent-vscode-accent"
                    />
                  </SettingRow>
                )}

                {/* git.enableSmartCommit */}
                {matchesSearch("git.enableSmartCommit smart commit stage all") && (
                  <SettingRow
                    label="Smart Commit"
                    settingKey="git.enableSmartCommit"
                    description="Controls commit behavior when there are no staged changes."
                    modified={isSettingModified("git.enableSmartCommit", settings)}
                    onReset={() => handleResetSetting("git.enableSmartCommit")}
                  >
                    <select
                      value={settings["git.enableSmartCommit"]}
                      onChange={(e) =>
                        handleUpdate({
                          "git.enableSmartCommit": e.target
                            .value as AppSettings["git.enableSmartCommit"],
                        })
                      }
                      className="w-48 rounded border border-vscode-border bg-vscode-input px-2.5 py-1.5 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
                    >
                      <option value="ask">Ask every time</option>
                      <option value="always">Always stage all and commit</option>
                      <option value="never">Never auto-stage</option>
                    </select>
                  </SettingRow>
                )}

                {/* git.untrackedChanges */}
                {matchesSearch("git.untrackedChanges untracked changes view") && (
                  <SettingRow
                    label="Untracked Changes Grouping"
                    settingKey="git.untrackedChanges"
                    description="How untracked files are displayed in the Source Control panel."
                    modified={isSettingModified("git.untrackedChanges", settings)}
                    onReset={() => handleResetSetting("git.untrackedChanges")}
                  >
                    <select
                      value={settings["git.untrackedChanges"]}
                      onChange={(e) =>
                        handleUpdate({
                          "git.untrackedChanges": e.target
                            .value as AppSettings["git.untrackedChanges"],
                        })
                      }
                      className="w-48 rounded border border-vscode-border bg-vscode-input px-2.5 py-1.5 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
                    >
                      <option value="mixed">Mixed with changes</option>
                      <option value="separate">Separate group</option>
                      <option value="hidden">Hidden</option>
                    </select>
                  </SettingRow>
                )}

                {/* git.pruneOnFetch */}
                {matchesSearch("git.pruneOnFetch prune fetch") && (
                  <SettingRow
                    label="Prune On Fetch"
                    settingKey="git.pruneOnFetch"
                    description="Prune tracking branches when fetching from remotes."
                    modified={isSettingModified("git.pruneOnFetch", settings)}
                    onReset={() => handleResetSetting("git.pruneOnFetch")}
                  >
                    <input
                      type="checkbox"
                      checked={settings["git.pruneOnFetch"]}
                      onChange={(e) => handleUpdate({ "git.pruneOnFetch": e.target.checked })}
                      className="h-4 w-4 rounded accent-vscode-accent"
                    />
                  </SettingRow>
                )}

                {/* git.defaultCloneDir */}
                {matchesSearch("git.defaultCloneDir clone folder destination") && (
                  <SettingRow
                    label="Default Clone Directory"
                    settingKey="git.defaultCloneDir"
                    description="Default filesystem location when cloning new repositories."
                    modified={isSettingModified("git.defaultCloneDir", settings)}
                    onReset={() => handleResetSetting("git.defaultCloneDir")}
                  >
                    <input
                      type="text"
                      placeholder="e.g. /home/user/workspace or C:\Users\Dev\Projects"
                      value={settings["git.defaultCloneDir"] ?? ""}
                      onChange={(e) =>
                        handleUpdate({
                          "git.defaultCloneDir": e.target.value.trim() || null,
                        })
                      }
                      className="w-full rounded border border-vscode-border bg-vscode-input px-2.5 py-1.5 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
                    />
                  </SettingRow>
                )}
              </div>
            )}

            {/* SCM Section */}
            {(searchQuery || activeSection === "scm") && (
              <div className="flex flex-col gap-6 mb-10">
                <h2 className="text-sm font-semibold text-vscode-fg border-b border-vscode-border pb-2 flex items-center gap-2">
                  <FolderGit2 className="h-4 w-4 text-vscode-accent" />
                  <span>Source Control View</span>
                </h2>

                {matchesSearch("scm.viewMode list tree") && (
                  <SettingRow
                    label="View Mode"
                    settingKey="scm.viewMode"
                    description="Display changed files as a flat list or hierarchical tree."
                    modified={isSettingModified("scm.viewMode", settings)}
                    onReset={() => handleResetSetting("scm.viewMode")}
                  >
                    <select
                      value={settings["scm.viewMode"]}
                      onChange={(e) =>
                        handleUpdate({
                          "scm.viewMode": e.target.value as AppSettings["scm.viewMode"],
                        })
                      }
                      className="w-48 rounded border border-vscode-border bg-vscode-input px-2.5 py-1.5 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
                    >
                      <option value="list">List</option>
                      <option value="tree">Tree</option>
                    </select>
                  </SettingRow>
                )}
              </div>
            )}

            {/* Diff Section */}
            {(searchQuery || activeSection === "diff") && (
              <div className="flex flex-col gap-6 mb-10">
                <h2 className="text-sm font-semibold text-vscode-fg border-b border-vscode-border pb-2 flex items-center gap-2">
                  <Columns className="h-4 w-4 text-vscode-accent" />
                  <span>Diff Editor</span>
                </h2>

                {matchesSearch("diff.renderSideBySide side by side inline") && (
                  <SettingRow
                    label="Side By Side Diff"
                    settingKey="diff.renderSideBySide"
                    description="Render diff editor side by side instead of inline."
                    modified={isSettingModified("diff.renderSideBySide", settings)}
                    onReset={() => handleResetSetting("diff.renderSideBySide")}
                  >
                    <input
                      type="checkbox"
                      checked={settings["diff.renderSideBySide"]}
                      onChange={(e) =>
                        handleUpdate({ "diff.renderSideBySide": e.target.checked })
                      }
                      className="h-4 w-4 rounded accent-vscode-accent"
                    />
                  </SettingRow>
                )}

                {matchesSearch("diff.ignoreTrimWhitespace whitespace") && (
                  <SettingRow
                    label="Ignore Trim Whitespace"
                    settingKey="diff.ignoreTrimWhitespace"
                    description="Ignore leading and trailing whitespace changes in diff editor."
                    modified={isSettingModified("diff.ignoreTrimWhitespace", settings)}
                    onReset={() => handleResetSetting("diff.ignoreTrimWhitespace")}
                  >
                    <input
                      type="checkbox"
                      checked={settings["diff.ignoreTrimWhitespace"]}
                      onChange={(e) =>
                        handleUpdate({ "diff.ignoreTrimWhitespace": e.target.checked })
                      }
                      className="h-4 w-4 rounded accent-vscode-accent"
                    />
                  </SettingRow>
                )}
              </div>
            )}

            {/* Graph Section */}
            {(searchQuery || activeSection === "graph") && (
              <div className="flex flex-col gap-6 mb-10">
                <h2 className="text-sm font-semibold text-vscode-fg border-b border-vscode-border pb-2 flex items-center gap-2">
                  <GitGraph className="h-4 w-4 text-vscode-accent" />
                  <span>Git Graph</span>
                </h2>

                {matchesSearch("graph.showRemoteBranches remotes") && (
                  <SettingRow
                    label="Show Remote Branches"
                    settingKey="graph.showRemoteBranches"
                    description="Include remote branches in the commit graph."
                    modified={isSettingModified("graph.showRemoteBranches", settings)}
                    onReset={() => handleResetSetting("graph.showRemoteBranches")}
                  >
                    <input
                      type="checkbox"
                      checked={settings["graph.showRemoteBranches"]}
                      onChange={(e) =>
                        handleUpdate({ "graph.showRemoteBranches": e.target.checked })
                      }
                      className="h-4 w-4 rounded accent-vscode-accent"
                    />
                  </SettingRow>
                )}

                {matchesSearch("graph.showTags tags") && (
                  <SettingRow
                    label="Show Tags"
                    settingKey="graph.showTags"
                    description="Include git tags in the commit graph."
                    modified={isSettingModified("graph.showTags", settings)}
                    onReset={() => handleResetSetting("graph.showTags")}
                  >
                    <input
                      type="checkbox"
                      checked={settings["graph.showTags"]}
                      onChange={(e) => handleUpdate({ "graph.showTags": e.target.checked })}
                      className="h-4 w-4 rounded accent-vscode-accent"
                    />
                  </SettingRow>
                )}

                {matchesSearch("graph.showStashes stashes") && (
                  <SettingRow
                    label="Show Stashes"
                    settingKey="graph.showStashes"
                    description="Include stash entries as nodes in the commit graph."
                    modified={isSettingModified("graph.showStashes", settings)}
                    onReset={() => handleResetSetting("graph.showStashes")}
                  >
                    <input
                      type="checkbox"
                      checked={settings["graph.showStashes"]}
                      onChange={(e) =>
                        handleUpdate({ "graph.showStashes": e.target.checked })
                      }
                      className="h-4 w-4 rounded accent-vscode-accent"
                    />
                  </SettingRow>
                )}

                {matchesSearch("graph.dateFormat relative absolute") && (
                  <SettingRow
                    label="Date Format"
                    settingKey="graph.dateFormat"
                    description="Display commit dates as relative (e.g. 2 hours ago) or absolute timestamps."
                    modified={isSettingModified("graph.dateFormat", settings)}
                    onReset={() => handleResetSetting("graph.dateFormat")}
                  >
                    <select
                      value={settings["graph.dateFormat"]}
                      onChange={(e) =>
                        handleUpdate({
                          "graph.dateFormat": e.target
                            .value as AppSettings["graph.dateFormat"],
                        })
                      }
                      className="w-48 rounded border border-vscode-border bg-vscode-input px-2.5 py-1.5 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
                    >
                      <option value="relative">Relative</option>
                      <option value="absolute">Absolute</option>
                    </select>
                  </SettingRow>
                )}

                {matchesSearch("graph.pageSize pagination") && (
                  <SettingRow
                    label="Graph Page Size"
                    settingKey="graph.pageSize"
                    description="Number of commits fetched per page during topological graph traversal."
                    modified={isSettingModified("graph.pageSize", settings)}
                    error={errors["graph.pageSize"]}
                    onReset={() => handleResetSetting("graph.pageSize")}
                  >
                    <input
                      type="number"
                      min="50"
                      step="50"
                      value={settings["graph.pageSize"]}
                      onChange={(e) =>
                        handleUpdate({ "graph.pageSize": parseInt(e.target.value, 10) })
                      }
                      className="w-48 rounded border border-vscode-border bg-vscode-input px-2.5 py-1.5 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
                    />
                  </SettingRow>
                )}
              </div>
            )}

            {/* External Editor Section */}
            {(searchQuery || activeSection === "externalEditor") && (
              <div className="flex flex-col gap-6 mb-10">
                <h2 className="text-sm font-semibold text-vscode-fg border-b border-vscode-border pb-2 flex items-center gap-2">
                  <ExternalLink className="h-4 w-4 text-vscode-accent" />
                  <span>External Editor</span>
                </h2>

                {matchesSearch("externalEditor.command command") && (
                  <SettingRow
                    label="Editor Command"
                    settingKey="externalEditor.command"
                    description="Executable name or full path of external editor (e.g. 'code', 'zed', 'subl')."
                    modified={isSettingModified("externalEditor.command", settings)}
                    onReset={() => handleResetSetting("externalEditor.command")}
                  >
                    <input
                      type="text"
                      value={settings["externalEditor.command"]}
                      onChange={(e) =>
                        handleUpdate({ "externalEditor.command": e.target.value })
                      }
                      className="w-64 rounded border border-vscode-border bg-vscode-input px-2.5 py-1.5 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
                    />
                  </SettingRow>
                )}

                {matchesSearch("externalEditor.args arguments") && (
                  <SettingRow
                    label="Editor Command Arguments"
                    settingKey="externalEditor.args"
                    description="Command line arguments passed to editor. Use {file} and {line} placeholders."
                    modified={isSettingModified("externalEditor.args", settings)}
                    onReset={() => handleResetSetting("externalEditor.args")}
                  >
                    <ListEditor
                      items={settings["externalEditor.args"]}
                      placeholder="e.g. --goto, {file}:{line}"
                      onChange={(newArgs) =>
                        handleUpdate({ "externalEditor.args": newArgs })
                      }
                    />
                  </SettingRow>
                )}
              </div>
            )}

            {/* AI Section */}
            {(searchQuery || activeSection === "ai") && (
              <div className="flex flex-col gap-6 mb-10">
                <h2 className="text-sm font-semibold text-vscode-fg border-b border-vscode-border pb-2 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-vscode-accent" />
                  <span>AI Assistance</span>
                </h2>
                <AiSection
                  settings={settings}
                  aiDataSource={aiDataSource}
                  onUpdate={handleUpdate}
                  onReset={handleResetSetting}
                />
              </div>
            )}

            {/* Hosts Section */}
            {(searchQuery || activeSection === "hosts") && (
              <div className="flex flex-col gap-6 mb-10">
                <h2 className="text-sm font-semibold text-vscode-fg border-b border-vscode-border pb-2 flex items-center gap-2">
                  <Server className="h-4 w-4 text-vscode-accent" />
                  <span>Git Hosting Providers</span>
                </h2>
                <HostsSection
                  hosts={settings.hosts}
                  hostingDataSource={hostingDataSource}
                  onUpdateHosts={(newHosts) => handleUpdate({ hosts: newHosts })}
                  onResetHosts={() => handleResetSetting("hosts")}
                />
              </div>
            )}

            {/* Appearance Section */}
            {(searchQuery || activeSection === "appearance") && (
              <div className="flex flex-col gap-6 mb-10">
                <h2 className="text-sm font-semibold text-vscode-fg border-b border-vscode-border pb-2 flex items-center gap-2">
                  <Palette className="h-4 w-4 text-vscode-accent" />
                  <span>Appearance</span>
                </h2>

                {matchesSearch("ui.theme theme light dark system") && (
                  <SettingRow
                    label="UI Theme"
                    settingKey="ui.theme"
                    description="Color theme matching VS Code Modern styles."
                    modified={isSettingModified("ui.theme", settings)}
                    onReset={() => {
                      handleResetSetting("ui.theme");
                      useUIStore.getState().setTheme(DEFAULT_SETTINGS["ui.theme"]);
                    }}
                  >
                    <select
                      value={settings["ui.theme"]}
                      aria-label="UI Theme"
                      onChange={(e) => {
                        const val = e.target.value as AppSettings["ui.theme"];
                        handleUpdate({ "ui.theme": val });
                        useUIStore.getState().setTheme(val);
                      }}
                      className="w-48 rounded border border-vscode-border bg-vscode-input px-2.5 py-1.5 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
                    >
                      <option value="system">Follow System</option>
                      <option value="dark">Dark Modern</option>
                      <option value="light">Light Modern</option>
                    </select>
                  </SettingRow>
                )}
              </div>
            )}

            {/* Updates Section */}
            {(searchQuery || activeSection === "updates") && (
              <div className="flex flex-col gap-6 mb-10">
                <h2 className="text-sm font-semibold text-vscode-fg border-b border-vscode-border pb-2 flex items-center gap-2">
                  <ArrowUpCircle className="h-4 w-4 text-vscode-accent" />
                  <span>Application Updates</span>
                </h2>

                {matchesSearch("update.channel stable beta") && (
                  <SettingRow
                    label="Update Channel"
                    settingKey="update.channel"
                    description="Select between production-ready stable releases or early preview beta releases."
                    modified={isSettingModified("update.channel", settings)}
                    onReset={() => handleResetSetting("update.channel")}
                  >
                    <select
                      value={settings["update.channel"]}
                      onChange={(e) =>
                        handleUpdate({
                          "update.channel": e.target
                            .value as AppSettings["update.channel"],
                        })
                      }
                      className="w-48 rounded border border-vscode-border bg-vscode-input px-2.5 py-1.5 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
                    >
                      <option value="stable">Stable</option>
                      <option value="beta">Beta</option>
                    </select>
                  </SettingRow>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface SettingRowProps {
  label: string;
  settingKey: SettingKey;
  description: string;
  modified?: boolean;
  error?: string;
  onReset?: () => void;
  children: React.ReactNode;
}

const SettingRow: React.FC<SettingRowProps> = ({
  label,
  settingKey,
  description,
  modified,
  error,
  onReset,
  children,
}) => (
  <div
    className="flex flex-col gap-1.5 border-b border-vscode-border pb-4"
    data-testid={`setting-row-${settingKey}`}
  >
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-vscode-fg">{label}</span>
        {modified && (
          <span className="rounded bg-vscode-accent/20 px-1.5 py-0.2 text-[10px] font-mono text-vscode-accent">
            Modified
          </span>
        )}
      </div>
      {modified && onReset && (
        <button
          type="button"
          title="Reset to default"
          aria-label={`Reset ${label} to default`}
          onClick={onReset}
          className="rounded p-0.5 text-vscode-muted hover:text-vscode-fg"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      )}
    </div>
    <p className="text-[11px] text-vscode-muted">{description}</p>
    <div className="mt-1">{children}</div>
    {error && <span className="text-[11px] font-medium text-rose-500">{error}</span>}
  </div>
);
