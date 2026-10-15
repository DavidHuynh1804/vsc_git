import { AiConsentDataSource, AiDataSource } from "./types";

const PROVIDER_DEFAULT_MODELS: Record<string, string[]> = {
  claude: ["claude-haiku-5-5", "claude-sonnet-5-5"],
  openai: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
  ollama: ["llama3.2", "qwen2.5-coder", "mistral"],
};

export class MockAiDataSource implements AiDataSource {
  public lastTestedProvider: string | null = null;
  public lastSavedKeyProvider: string | null = null;
  // Crucial: key is never stored in persistent state or logged.
  // In mock, we only remember whether a key was submitted.
  private hasKeyForProvider = new Set<string>();

  async listModels(provider: string, _baseUrl?: string | null): Promise<string[]> {
    return PROVIDER_DEFAULT_MODELS[provider.toLowerCase()] ?? ["default-model"];
  }

  async setAiKey(provider: string, key: string): Promise<void> {
    if (key.trim()) {
      this.hasKeyForProvider.add(provider);
      this.lastSavedKeyProvider = provider;
    }
  }

  async testProvider(provider: string, model?: string, _baseUrl?: string | null): Promise<string> {
    this.lastTestedProvider = provider;
    return `Connection to ${provider} (${model ?? "default"}) succeeded: AI is ready for commit and PR generation.`;
  }

  async generatePr(
    base: string,
    head: string,
    onChunk: (chunk: string) => void
  ): Promise<{ title: string; body: string }> {
    const title = `feat: integrate changes from ${head} into ${base}`;
    const chunks = [
      "## Summary of Changes\n\n",
      `- Merges branch \`${head}\` into \`${base}\`.\n`,
      "- Adds robust integration and settings interfaces.\n",
      "- Full tests included.\n\n",
      "## Testing Done\n\n",
      "- Unit tests and integration suite verified.\n",
    ];

    let fullBody = "";
    for (const chunk of chunks) {
      fullBody += chunk;
      onChunk(chunk);
      await Promise.resolve();
    }
    return { title, body: fullBody };
  }
}

export class TauriAiDataSource implements AiDataSource {
  async listModels(provider: string, _baseUrl?: string | null): Promise<string[]> {
    throw new Error(`Listing models for ${provider} is pending M4 backend AI commands.`);
  }

  async setAiKey(provider: string, _key: string): Promise<void> {
    throw new Error(`Saving AI key for ${provider} is pending M4 backend keyring commands.`);
  }

  async testProvider(provider: string, _model?: string, _baseUrl?: string | null): Promise<string> {
    throw new Error(`Testing AI provider ${provider} is pending M4 backend commands.`);
  }

  async generatePr(
    _base: string,
    _head: string,
    _onChunk: (chunk: string) => void
  ): Promise<{ title: string; body: string }> {
    throw new Error("AI PR generation is pending M4 backend AI commands.");
  }
}

export class LocalStorageAiConsentDataSource implements AiConsentDataSource {
  private memoryMap = new Map<string, boolean>();

  private makeKey(repoPath: string, provider: string): string {
    return `vsc_git_ai_consent:${repoPath}:${provider}`;
  }

  hasConsent(repoPath: string, provider: string): boolean {
    const key = this.makeKey(repoPath, provider);
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const val = window.localStorage.getItem(key);
        if (val !== null) {
          return val === "true";
        }
      }
    } catch {
      // Fallback to memory
    }
    return this.memoryMap.get(key) === true;
  }

  setConsent(repoPath: string, provider: string, granted: boolean): void {
    const key = this.makeKey(repoPath, provider);
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(key, granted ? "true" : "false");
      }
    } catch {
      // Fallback to memory
    }
    this.memoryMap.set(key, granted);
  }
}

export const defaultAiDataSource = new TauriAiDataSource();
export const defaultAiConsentDataSource = new LocalStorageAiConsentDataSource();
