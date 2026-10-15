import React, { useState } from "react";
import { HostConfig } from "@/bindings";
import { HostingDataSource, CurrentUser, ScopeCheckResult } from "@/integrations/types";
import { Plus, Trash2, Key, CheckCircle, AlertTriangle, RefreshCw } from "lucide-react";

export interface HostsSectionProps {
  hosts: HostConfig[];
  hostingDataSource: HostingDataSource;
  onUpdateHosts: (hosts: HostConfig[]) => void;
  onResetHosts: () => void;
}

export const HostsSection: React.FC<HostsSectionProps> = ({
  hosts,
  hostingDataSource,
  onUpdateHosts,
  onResetHosts,
}) => {
  // New host form inputs
  const [newHost, setNewHost] = useState("");
  const [newKind, setNewKind] = useState<"github" | "gitlab">("github");
  const [newApiUrl, setNewApiUrl] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  // PAT inputs per host
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [tokenStatus, setTokenStatus] = useState<Record<string, string>>({});

  // Test connection status per host
  const [testResults, setTestResults] = useState<
    Record<string, { user?: CurrentUser; scopeCheck?: ScopeCheckResult; error?: string }>
  >({});
  const [testingHosts, setTestingHosts] = useState<Record<string, boolean>>({});

  const handleAddHost = () => {
    const trimmedHost = newHost.trim().toLowerCase();
    const trimmedApi = newApiUrl.trim();

    if (!trimmedHost) {
      setAddError("Host name is required (e.g. github.corp.internal)");
      return;
    }
    if (!trimmedApi) {
      setAddError("API Base URL is required (e.g. https://github.corp.internal/api/v3)");
      return;
    }

    try {
      new URL(trimmedApi);
    } catch {
      setAddError("API Base URL must be a valid URL");
      return;
    }

    if (hosts.some((h) => h.host.toLowerCase() === trimmedHost)) {
      setAddError("A configuration for this host already exists");
      return;
    }

    onUpdateHosts([
      ...hosts,
      {
        host: trimmedHost,
        kind: newKind,
        apiBaseUrl: trimmedApi,
      },
    ]);

    setNewHost("");
    setNewApiUrl("");
    setAddError(null);
  };

  const handleRemoveHost = (hostName: string) => {
    onUpdateHosts(hosts.filter((h) => h.host !== hostName));
  };

  const handleSaveToken = async (hostName: string) => {
    const token = tokens[hostName]?.trim();
    if (!token) return;

    try {
      await hostingDataSource.setHostToken(hostName, token);
      setTokens((prev) => ({ ...prev, [hostName]: "" }));
      setTokenStatus((prev) => ({ ...prev, [hostName]: "Token securely saved in OS Keyring" }));
      setTimeout(() => {
        setTokenStatus((prev) => {
          const next = { ...prev };
          delete next[hostName];
          return next;
        });
      }, 4000);
    } catch (err: unknown) {
      setTokenStatus((prev) => ({
        ...prev,
        [hostName]: `Failed to save token: ${err instanceof Error ? err.message : "Error"}`,
      }));
    }
  };

  const handleTestConnection = async (host: HostConfig) => {
    setTestingHosts((prev) => ({ ...prev, [host.host]: true }));
    try {
      const res = await hostingDataSource.testConnection(host, tokens[host.host]);
      setTestResults((prev) => ({
        ...prev,
        [host.host]: { user: res.user, scopeCheck: res.scopeCheck },
      }));
    } catch (err: unknown) {
      setTestResults((prev) => ({
        ...prev,
        [host.host]: {
          error: err instanceof Error ? err.message : "Connection failed",
        },
      }));
    } finally {
      setTestingHosts((prev) => ({ ...prev, [host.host]: false }));
    }
  };

  return (
    <div className="flex flex-col gap-6" data-testid="hosts-settings-section">
      <div className="flex items-center justify-between border-b border-vscode-border pb-3">
        <div>
          <h3 className="text-xs font-semibold text-vscode-fg">Configured Git Hosting Providers</h3>
          <p className="text-xs text-vscode-muted">
            Configure authentication and API endpoints for GitHub, GitLab, and self-hosted Enterprise instances.
          </p>
        </div>
        <button
          type="button"
          onClick={onResetHosts}
          className="text-xs text-vscode-muted hover:text-vscode-fg underline"
        >
          Reset to default hosts
        </button>
      </div>

      {/* Hosts list */}
      <div className="flex flex-col gap-4">
        {hosts.map((host) => {
          const testRes = testResults[host.host];
          const isTesting = !!testingHosts[host.host];

          return (
            <div
              key={host.host}
              className="flex flex-col gap-3 rounded border border-vscode-border bg-vscode-sidebar p-3.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-xs text-vscode-fg">{host.host}</span>
                  <span className="rounded bg-vscode-hover px-1.5 py-0.5 text-[10px] font-mono text-vscode-muted uppercase">
                    {host.kind}
                  </span>
                </div>
                {hosts.length > 1 && (
                  <button
                    type="button"
                    title={`Delete host ${host.host}`}
                    aria-label={`Delete host ${host.host}`}
                    onClick={() => handleRemoveHost(host.host)}
                    className="text-vscode-muted hover:text-rose-500 p-1 rounded"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="text-[11px] text-vscode-muted font-mono break-all">
                API Base URL: {host.apiBaseUrl}
              </div>

              {/* PAT Token Input */}
              <div className="flex flex-col gap-1.5 pt-1">
                <div className="flex gap-2">
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder={`Enter Personal Access Token (PAT) for ${host.host}...`}
                    value={tokens[host.host] ?? ""}
                    onChange={(e) =>
                      setTokens((prev) => ({ ...prev, [host.host]: e.target.value }))
                    }
                    className="flex-1 rounded border border-vscode-border bg-vscode-input px-2.5 py-1 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveToken(host.host)}
                    className="inline-flex items-center gap-1 rounded bg-vscode-hover border border-vscode-border px-2.5 py-1 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white transition-colors"
                  >
                    <Key className="h-3 w-3" />
                    <span>Set PAT</span>
                  </button>
                  <button
                    type="button"
                    disabled={isTesting}
                    onClick={() => handleTestConnection(host)}
                    className="inline-flex items-center gap-1 rounded bg-vscode-accent px-2.5 py-1 text-xs text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    {isTesting ? (
                      <RefreshCw className="h-3 w-3 animate-spin" />
                    ) : (
                      <CheckCircle className="h-3 w-3" />
                    )}
                    <span>Test Connection</span>
                  </button>
                </div>
                {tokenStatus[host.host] && (
                  <span className="text-[11px] text-emerald-400 font-medium">
                    {tokenStatus[host.host]}
                  </span>
                )}
              </div>

              {/* Test Result details */}
              {testRes && (
                <div className="mt-1 flex flex-col gap-1.5 rounded border border-vscode-border bg-vscode-bg p-2.5 text-xs">
                  {testRes.error ? (
                    <div className="flex items-center gap-1.5 text-rose-400">
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                      <span>{testRes.error}</span>
                    </div>
                  ) : testRes.user ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-vscode-fg">
                          Authenticated as: {testRes.user.username}
                        </span>
                        {testRes.user.name && (
                          <span className="text-vscode-muted">({testRes.user.name})</span>
                        )}
                      </div>
                      <div className="text-[11px] text-vscode-muted font-mono">
                        Scopes detected: [{testRes.user.scopes.join(", ") || "none"}]
                      </div>

                      {/* Scope Warning */}
                      {testRes.scopeCheck && !testRes.scopeCheck.ok && (
                        <div className="mt-1.5 flex items-start gap-2 rounded bg-amber-500/10 border border-amber-500/30 p-2 text-amber-400 text-xs">
                          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                          <div>
                            <span className="font-medium block">
                              Warning: Missing required permissions!
                            </span>
                            <span className="text-[11px]">
                              Spec 9.2 requires scopes:{" "}
                              <strong>{testRes.scopeCheck.missingScopes.join(", ")}</strong>. Some
                              actions (like creating PRs or reading CI status) may fail.
                            </span>
                          </div>
                        </div>
                      )}

                      {testRes.scopeCheck && testRes.scopeCheck.ok && (
                        <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" />
                          All required scopes ({testRes.scopeCheck.requiredScopes.join(", ")}) are present.
                        </span>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add New Host Form */}
      <div className="flex flex-col gap-3 rounded border border-dashed border-vscode-border p-3.5 bg-vscode-bg/50">
        <h4 className="text-xs font-medium text-vscode-fg">Add Self-Hosted or Enterprise Instance</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          <input
            type="text"
            placeholder="Host (e.g. git.company.com)"
            value={newHost}
            onChange={(e) => setNewHost(e.target.value)}
            className="rounded border border-vscode-border bg-vscode-input px-2.5 py-1 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
          />
          <select
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as "github" | "gitlab")}
            className="rounded border border-vscode-border bg-vscode-input px-2.5 py-1 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
          >
            <option value="github">GitHub Enterprise</option>
            <option value="gitlab">GitLab Self-Hosted</option>
          </select>
          <input
            type="text"
            placeholder="API Base URL (e.g. https://git.company.com/api/v4)"
            value={newApiUrl}
            onChange={(e) => setNewApiUrl(e.target.value)}
            className="rounded border border-vscode-border bg-vscode-input px-2.5 py-1 text-xs text-vscode-fg focus:border-vscode-accent focus:outline-none"
          />
        </div>

        {addError && <span className="text-[11px] text-rose-500 font-medium">{addError}</span>}

        <div>
          <button
            type="button"
            onClick={handleAddHost}
            className="inline-flex items-center gap-1.5 rounded bg-vscode-hover border border-vscode-border px-3 py-1.5 text-xs text-vscode-fg hover:bg-vscode-accent hover:text-white transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Host</span>
          </button>
        </div>
      </div>
    </div>
  );
};
