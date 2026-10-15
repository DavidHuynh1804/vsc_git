import { HostConfig } from "@/bindings";

export type HostKind = "github" | "gitlab" | string;

export interface CurrentUser {
  username: string;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  scopes: string[];
}

export interface Reviewer {
  username: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export type CiState = "success" | "failure" | "pending" | "none";

export interface CiCheck {
  name: string;
  state: CiState;
  url?: string | null;
}

export interface CiStatus {
  state: CiState;
  checks: CiCheck[];
}

export interface CreatePrRequest {
  base: string;
  head: string;
  title: string;
  body: string;
  draft: boolean;
  reviewers: string[];
  labels: string[];
}

export interface PullRequestResult {
  id: number;
  number: number;
  title: string;
  body?: string | null;
  url: string;
  base: string;
  head: string;
  draft: boolean;
  state: string;
  author: string;
}

export interface ScopeCheckResult {
  ok: boolean;
  requiredScopes: string[];
  missingScopes: string[];
}

export function checkRequiredScopes(kind: HostKind, userScopes: string[]): ScopeCheckResult {
  const normalizedUserScopes = userScopes.map((s) => s.trim().toLowerCase());

  const isGitLab = kind.toLowerCase() === "gitlab";
  const requiredScopes = isGitLab ? ["api"] : ["repo", "read:user"];

  const missingScopes = requiredScopes.filter(
    (required) => !normalizedUserScopes.includes(required.toLowerCase())
  );

  return {
    ok: missingScopes.length === 0,
    requiredScopes,
    missingScopes,
  };
}

export interface HostingDataSource {
  testConnection(
    host: HostConfig,
    token?: string
  ): Promise<{ user: CurrentUser; scopeCheck: ScopeCheckResult }>;
  setHostToken(host: string, token: string): Promise<void>;
  createPullRequest(req: CreatePrRequest): Promise<PullRequestResult>;
  searchReviewers(host: string, query: string): Promise<Reviewer[]>;
  checkBranchPushed(headBranch: string): Promise<boolean>;
  pushBranch(branch: string): Promise<void>;
}

export interface AiDataSource {
  listModels(provider: string, baseUrl?: string | null): Promise<string[]>;
  setAiKey(provider: string, key: string): Promise<void>;
  testProvider(provider: string, model?: string, baseUrl?: string | null): Promise<string>;
  generatePr(
    base: string,
    head: string,
    onChunk: (chunk: string) => void
  ): Promise<{ title: string; body: string }>;
  generateCommit?(onChunk?: (chunk: string) => void): Promise<string>;
}

export interface AiConsentDataSource {
  hasConsent(repoPath: string, provider: string): boolean;
  setConsent(repoPath: string, provider: string, granted: boolean): void;
}
