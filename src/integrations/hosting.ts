import { commands, HostConfig } from "@/bindings";
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
    token?: string
  ): Promise<{ user: CurrentUser; scopeCheck: ScopeCheckResult }> {
    const res = await commands.testHostToken(host, token ?? null);
    if (res.status === "error") {
      throw new Error(res.error.message);
    }
    return {
      user: res.data.user,
      scopeCheck: res.data.scopeCheck,
    };
  }

  async setHostToken(host: string, token: string): Promise<void> {
    const res = await commands.setHostToken(host, token);
    if (res.status === "error") {
      throw new Error(res.error.message);
    }
  }

  async createPullRequest(req: CreatePrRequest): Promise<PullRequestResult> {
    const res = await commands.createPullRequest(req);
    if (res.status === "error") {
      throw new Error(res.error.message);
    }
    return res.data;
  }

  async searchReviewers(host: string, query: string): Promise<Reviewer[]> {
    const res = await commands.searchReviewers(host, query);
    if (res.status === "error") {
      throw new Error(res.error.message);
    }
    return res.data;
  }

  async checkBranchPushed(headBranch: string): Promise<boolean> {
    const res = await commands.checkBranchPushed(headBranch);
    if (res.status === "error") {
      throw new Error(res.error.message);
    }
    return res.data;
  }

  async pushBranch(branch: string): Promise<void> {
    const res = await commands.push({
      remote: null,
      branch,
      set_upstream: true,
      force_with_lease: false,
      tags: false,
    });
    if (res.status === "error") {
      throw new Error(res.error.message);
    }
  }
}

export const defaultHostingDataSource =
  import.meta.env?.VITE_USE_MOCK === "true"
    ? new MockHostingDataSource()
    : new TauriHostingDataSource();
