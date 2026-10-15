import { HostConfig } from "@/bindings";
import {
  CurrentUser,
  CreatePrRequest,
  HostingDataSource,
  PullRequestResult,
  Reviewer,
  ScopeCheckResult,
  checkRequiredScopes,
} from "./types";

export class MockHostingDataSource implements HostingDataSource {
  private userScopesByHost: Record<string, string[]> = {
    "github.com": ["repo", "read:user"],
    "gitlab.com": ["api"],
  };

  private pushedBranches = new Set<string>(["main", "master", "develop"]);
  private createdPrs: PullRequestResult[] = [];
  public lastSetTokenHost: string | null = null;

  setUserScopes(host: string, scopes: string[]) {
    this.userScopesByHost[host] = scopes;
  }

  setPushedBranches(branches: string[]) {
    this.pushedBranches = new Set(branches);
  }

  async testConnection(
    host: HostConfig,
    _token?: string
  ): Promise<{ user: CurrentUser; scopeCheck: ScopeCheckResult }> {
    const scopes = this.userScopesByHost[host.host] ?? (host.kind === "github" ? ["read:user"] : []);
    const user: CurrentUser = {
      username: host.kind === "github" ? "octocat" : "tanuki",
      name: host.kind === "github" ? "The Octocat" : "GitLab Mascot",
      email: `${host.kind}@example.com`,
      avatarUrl: `https://${host.host}/avatar.png`,
      scopes,
    };
    const scopeCheck = checkRequiredScopes(host.kind, scopes);
    return { user, scopeCheck };
  }

  async setHostToken(host: string, _token: string): Promise<void> {
    this.lastSetTokenHost = host;
  }

  async createPullRequest(req: CreatePrRequest): Promise<PullRequestResult> {
    const number = this.createdPrs.length + 101;
    const result: PullRequestResult = {
      id: 1000 + number,
      number,
      title: req.title,
      body: req.body,
      url: `https://github.com/org/repo/pull/${number}`,
      base: req.base,
      head: req.head,
      draft: req.draft,
      state: "open",
      author: "developer",
    };
    this.createdPrs.push(result);
    return result;
  }

  async searchReviewers(_host: string, query: string): Promise<Reviewer[]> {
    const allReviewers: Reviewer[] = [
      { username: "alice", name: "Alice Smith", avatarUrl: "https://avatar.png/alice" },
      { username: "bob", name: "Bob Jones", avatarUrl: "https://avatar.png/bob" },
      { username: "charlie", name: "Charlie Brown", avatarUrl: "https://avatar.png/charlie" },
      { username: "david", name: "David Huynh", avatarUrl: "https://avatar.png/david" },
    ];
    if (!query.trim()) {
      return allReviewers;
    }
    const q = query.toLowerCase();
    return allReviewers.filter(
      (r) =>
        r.username.toLowerCase().includes(q) ||
        (r.name && r.name.toLowerCase().includes(q))
    );
  }

  async checkBranchPushed(headBranch: string): Promise<boolean> {
    return this.pushedBranches.has(headBranch);
  }

  async pushBranch(branch: string): Promise<void> {
    this.pushedBranches.add(branch);
  }
}
export class UnavailableFeatureError extends Error {
  public readonly kind = "unavailable" as const;
  constructor(featureName: string) {
    super(`Tính năng ${featureName} chưa được backend hỗ trợ.`);
    this.name = "UnavailableFeatureError";
  }
}

export class TauriHostingDataSource implements HostingDataSource {
  async testConnection(
    host: HostConfig,
    _token?: string
  ): Promise<{ user: CurrentUser; scopeCheck: ScopeCheckResult }> {
    throw new UnavailableFeatureError(`kiểm tra kết nối host ${host.host} (test_host_token)`);
  }

  async setHostToken(host: string, _token: string): Promise<void> {
    throw new UnavailableFeatureError(`lưu token host ${host} (set_host_token)`);
  }

  async createPullRequest(_req: CreatePrRequest): Promise<PullRequestResult> {
    throw new UnavailableFeatureError("tạo Pull Request (create_pull_request)");
  }

  async searchReviewers(_host: string, _query: string): Promise<Reviewer[]> {
    return [];
  }

  async checkBranchPushed(_headBranch: string): Promise<boolean> {
    return false;
  }

  async pushBranch(branch: string): Promise<void> {
    throw new UnavailableFeatureError(`push branch ${branch}`);
  }
}

export const defaultHostingDataSource =
  import.meta.env?.VITE_USE_MOCK === "true"
    ? new MockHostingDataSource()
    : new TauriHostingDataSource();
