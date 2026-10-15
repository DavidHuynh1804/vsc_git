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

export class TauriHostingDataSource implements HostingDataSource {
  private fallback = new MockHostingDataSource();

  async testConnection(
    host: HostConfig,
    token?: string
  ): Promise<{ user: CurrentUser; scopeCheck: ScopeCheckResult }> {
    // Backend hook: commands.testHostToken or fallback
    return this.fallback.testConnection(host, token);
  }

  async setHostToken(host: string, token: string): Promise<void> {
    // Backend hook: commands.setHostToken or fallback
    return this.fallback.setHostToken(host, token);
  }

  async createPullRequest(req: CreatePrRequest): Promise<PullRequestResult> {
    // Backend hook: commands.createPullRequest or fallback
    return this.fallback.createPullRequest(req);
  }

  async searchReviewers(host: string, query: string): Promise<Reviewer[]> {
    return this.fallback.searchReviewers(host, query);
  }

  async checkBranchPushed(headBranch: string): Promise<boolean> {
    return this.fallback.checkBranchPushed(headBranch);
  }

  async pushBranch(branch: string): Promise<void> {
    return this.fallback.pushBranch(branch);
  }
}

export const defaultHostingDataSource = new TauriHostingDataSource();
