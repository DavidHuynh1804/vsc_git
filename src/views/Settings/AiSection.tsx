import React, { useState, useEffect, useTransition } from "react";
import { AppSettings, isSettingModified } from "@/settings/types";
import { AiDataSource } from "@/integrations/types";
import { ListEditor } from "./ListEditor";
import { Sparkles, Key, Check, AlertCircle, RotateCcw } from "lucide-react";

const DEFAULT_MODELS_BY_PROVIDER: Record<string, string[]> = {
  claude: ["claude-haiku-5-5", "claude-sonnet-5-5"],
  openai: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
  ollama: ["llama3.2", "qwen2.5-coder", "mistral"],
};
export interface AiSectionProps {
  settings: AppSettings;
  aiDataSource: AiDataSource;
  onUpdate: (patch: Partial<AppSettings>) => void;
  onReset: (key: keyof AppSettings) => void;
}

export const AiSection: React.FC<AiSectionProps> = ({
  settings,
  aiDataSource,
  onUpdate,
  onReset,
}) => {
  const [, startTransition] = useTransition();
  const [availableModels, setAvailableModels] = useState<string[]>(
    () => DEFAULT_MODELS_BY_PROVIDER[settings["ai.provider"]] ?? []
  );
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeySavedStatus, setApiKeySavedStatus] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Load models when provider or baseUrl changes
  useEffect(() => {
    let active = true;
    aiDataSource.listModels(settings["ai.provider"], settings["ai.baseUrl"]).then((models) => {
      if (active && models.length > 0) {
        startTransition(() => {
          setAvailableModels(models);
        });
      }
    });
    return () => {
      active = false;
    };
  }, [aiDataSource, settings]);

  const handleSaveApiKey = async () => {
    if (!apiKeyInput.trim()) return;
    try {
      await aiDataSource.setAiKey(settings["ai.provider"], apiKeyInput);
      setApiKeyInput("");
      setApiKeySavedStatus("Key securely stored in system keyring.");
      setTimeout(() => setApiKeySavedStatus(null), 4000);
    } catch (err: unknown) {
      setApiKeySavedStatus(
        `Failed to save key: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  };

  const handleTestProvider = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const msg = await aiDataSource.testProvider(
        settings["ai.provider"],
        settings["ai.model"],
        settings["ai.baseUrl"]
      );
      setTestResult({ ok: true, message: msg });
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : "Provider test failed",
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6" data-testid="ai-settings-section">
      {/* AI Enabled */}
      <div className="flex items-start justify-between border-b border-vscode-border pb-4">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-medium text-xs text-vscode-fg">Enable AI Assistance</span>
            {isSettingModified("ai.enabled", settings) && (
              <span className="text-[10px] bg-vscode-accent/20 text-vscode-accent px-1.5 py-0.2 rounded font-mono">
                Modified
              </span>
            )}
          </div>
          <p className="text-xs text-vscode-muted">
            Enables commit message generation, PR descriptions, and commit explanations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSettingModified("ai.enabled", settings) && (
            <button
              type="button"
              title="Reset to default"
              onClick={() => onReset("ai.enabled")}
              className="text-vscode-muted hover:text-vscode-fg p-1 rounded"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          <input
            type="checkbox"
            checked={settings["ai.enabled"]}
            onChange={(e) => onUpdate({ "ai.enabled": e.target.checked })}
            className="h-4 w-4 rounded accent-vscode-accent"
          />
        </div>
      </div>

      {/* Provider & Model */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-b border-vscode-border pb-4">
        {/* Provider */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="ai-provider" className="text-xs font-medium text-vscode-fg">
              AI Provider
            </label>
            {isSettingModified("ai.provider", settings) && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] bg-vscode-accent/20 text-vscode-accent px-1.5 py-0.2 rounded font-mono">
                  Modified
                </span>
                <button
                  type="button"
                  title="Reset to default"
                  onClick={() => onReset("ai.provider")}
                  className="text-vscode-muted hover:text-vscode-fg p-0.5"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
          <select
            id="ai-provider"
            value={settings["ai.provider"]}
            onChange={(e) => {
              const provider = e.target.value as AppSettings["ai.provider"];
              const defaultModel =
                provider === "claude"
                  ? "claude-haiku-5-5"
                  : provider === "openai"
                    ? "gpt-4o"
                    : "llama3.2";
              onUpdate({
                "ai.provider": provider,
                "ai.model": defaultModel,
              });
            }}
            className="rounded border border-vscode-border bg-vscode-input px-2.5 py-1.5 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
          >
            <option value="claude">Claude (Anthropic)</option>
            <option value="openai">OpenAI-compatible</option>
            <option value="ollama">Ollama (Local)</option>
          </select>
        </div>

        {/* Model */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="ai-model" className="text-xs font-medium text-vscode-fg">
              Model
            </label>
            {isSettingModified("ai.model", settings) && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] bg-vscode-accent/20 text-vscode-accent px-1.5 py-0.2 rounded font-mono">
                  Modified
                </span>
                <button
                  type="button"
                  title="Reset to default"
                  onClick={() => onReset("ai.model")}
                  className="text-vscode-muted hover:text-vscode-fg p-0.5"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <select
              id="ai-model"
              value={
                availableModels.includes(settings["ai.model"]) ? settings["ai.model"] : "custom"
              }
              onChange={(e) => {
                if (e.target.value !== "custom") {
                  onUpdate({ "ai.model": e.target.value });
                }
              }}
              className="rounded border border-vscode-border bg-vscode-input px-2.5 py-1.5 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none w-1/2"
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value="custom">Custom...</option>
            </select>
            <input
              type="text"
              aria-label="Custom Model Name"
              value={settings["ai.model"]}
              onChange={(e) => onUpdate({ "ai.model": e.target.value })}
              placeholder="Or enter custom model name"
              className="flex-1 rounded border border-vscode-border bg-vscode-input px-2.5 py-1.5 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Base URL (if openai or ollama or custom) */}
      <div className="flex flex-col gap-1.5 border-b border-vscode-border pb-4">
        <div className="flex items-center justify-between">
          <label htmlFor="ai-base-url" className="text-xs font-medium text-vscode-fg">
            Custom Base URL (Optional)
          </label>
          {isSettingModified("ai.baseUrl", settings) && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] bg-vscode-accent/20 text-vscode-accent px-1.5 py-0.2 rounded font-mono">
                Modified
              </span>
              <button
                type="button"
                title="Reset to default"
                onClick={() => onReset("ai.baseUrl")}
                className="text-vscode-muted hover:text-vscode-fg p-0.5"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
        <input
          id="ai-base-url"
          type="text"
          value={settings["ai.baseUrl"] ?? ""}
          onChange={(e) => onUpdate({ "ai.baseUrl": e.target.value.trim() || null })}
          placeholder="e.g. http://localhost:11434 or https://api.openai.com/v1"
          className="rounded border border-vscode-border bg-vscode-input px-2.5 py-1.5 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
        />
        <p className="text-[11px] text-vscode-muted">
          Required for self-hosted OpenAI gateways or custom Ollama instances.
        </p>
      </div>

      {/* API Key management */}
      <div className="flex flex-col gap-2 border-b border-vscode-border pb-4">
        <div className="flex items-center justify-between">
          <label htmlFor="ai-api-key" className="text-xs font-medium text-vscode-fg">
            API Key for {settings["ai.provider"]}
          </label>
          <span className="text-[11px] text-vscode-muted italic">
            Saved securely in OS Keyring. Never saved in settings.json.
          </span>
        </div>
        <div className="flex gap-2">
          <input
            id="ai-api-key"
            type="password"
            autoComplete="new-password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder={`Enter ${settings["ai.provider"]} API key...`}
            className="flex-1 rounded border border-vscode-border bg-vscode-input px-2.5 py-1.5 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSaveApiKey}
            className="inline-flex items-center gap-1.5 rounded bg-vscode-hover border border-vscode-border px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white transition-colors"
          >
            <Key className="h-3.5 w-3.5" />
            <span>Save Key</span>
          </button>
        </div>
        {apiKeySavedStatus && (
          <span className="text-xs text-emerald-500 font-medium">{apiKeySavedStatus}</span>
        )}
      </div>

      {/* Language & Max Tokens */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-b border-vscode-border pb-4">
        {/* Language */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="ai-language" className="text-xs font-medium text-vscode-fg">
              Language
            </label>
            {isSettingModified("ai.language", settings) && (
              <button
                type="button"
                title="Reset to default"
                onClick={() => onReset("ai.language")}
                className="text-vscode-muted hover:text-vscode-fg p-0.5"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            )}
          </div>
          <select
            id="ai-language"
            value={settings["ai.language"]}
            onChange={(e) =>
              onUpdate({ "ai.language": e.target.value as AppSettings["ai.language"] })
            }
            className="rounded border border-vscode-border bg-vscode-input px-2.5 py-1.5 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
          >
            <option value="auto">Auto (Detect from recent commits)</option>
            <option value="en">English (en)</option>
            <option value="vi">Tiếng Việt (vi)</option>
          </select>
        </div>

        {/* Max Tokens */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="ai-max-tokens" className="text-xs font-medium text-vscode-fg">
              Max Diff Tokens Budget
            </label>
            {isSettingModified("ai.maxDiffTokens", settings) && (
              <button
                type="button"
                title="Reset to default"
                onClick={() => onReset("ai.maxDiffTokens")}
                className="text-vscode-muted hover:text-vscode-fg p-0.5"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            )}
          </div>
          <input
            id="ai-max-tokens"
            type="number"
            min="1000"
            step="1000"
            value={settings["ai.maxDiffTokens"]}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!isNaN(val) && val > 0) {
                onUpdate({ "ai.maxDiffTokens": val });
              }
            }}
            className="rounded border border-vscode-border bg-vscode-input px-2.5 py-1.5 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
          />
        </div>
      </div>

      {/* Exclude Globs */}
      <div className="flex flex-col gap-2 border-b border-vscode-border pb-4">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-vscode-fg">Exclude Globs from AI Diff</label>
          {isSettingModified("ai.excludeGlobs", settings) && (
            <button
              type="button"
              title="Reset to default"
              onClick={() => onReset("ai.excludeGlobs")}
              className="text-vscode-muted hover:text-vscode-fg p-0.5"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
        </div>
        <p className="text-[11px] text-vscode-muted">
          Matching files will have their contents excluded from AI prompts to save token budget.
        </p>
        <ListEditor
          items={settings["ai.excludeGlobs"]}
          placeholder="e.g. **/*.lock, dist/**"
          onChange={(newGlobs) => onUpdate({ "ai.excludeGlobs": newGlobs })}
        />
      </div>

      {/* Disabled Repos */}
      <div className="flex flex-col gap-2 border-b border-vscode-border pb-4">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-vscode-fg">Disabled Repositories</label>
          {isSettingModified("ai.disabledRepos", settings) && (
            <button
              type="button"
              title="Reset to default"
              onClick={() => onReset("ai.disabledRepos")}
              className="text-vscode-muted hover:text-vscode-fg p-0.5"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
        </div>
        <p className="text-[11px] text-vscode-muted">
          AI features are strictly disabled for matching repository paths or URLs (Spec 8.7).
        </p>
        <ListEditor
          items={settings["ai.disabledRepos"]}
          placeholder="e.g. /home/user/work/confidential-repo or git@host:org/repo.git"
          onChange={(newRepos) => onUpdate({ "ai.disabledRepos": newRepos })}
        />
      </div>

      {/* Test Connection Button */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={isTesting}
            onClick={handleTestProvider}
            className="inline-flex items-center gap-2 rounded bg-vscode-accent px-4 py-2 text-xs text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>{isTesting ? "Testing Provider..." : "Test AI Connection"}</span>
          </button>
        </div>
        {testResult && (
          <div
            className={`flex items-start gap-2 p-3 rounded text-xs border ${
              testResult.ok
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                : "bg-rose-500/10 text-rose-400 border-rose-500/30"
            }`}
          >
            {testResult.ok ? (
              <Check className="h-4 w-4 flex-shrink-0 text-emerald-500" />
            ) : (
              <AlertCircle className="h-4 w-4 flex-shrink-0 text-rose-500" />
            )}
            <span>{testResult.message}</span>
          </div>
        )}
      </div>
    </div>
  );
};
