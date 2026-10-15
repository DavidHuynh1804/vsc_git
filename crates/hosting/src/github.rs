use crate::host::{
    Check, CiState, CiStatus, CreatePr, CurrentUser, Host, PullRequest, Reviewer, Target,
};
use crate::rate_limit::HostError;
use crate::remote_url::{HostConfig, HostKind, RemoteRef};
use async_trait::async_trait;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, USER_AGENT};
use reqwest::{Client, Response};
use serde::Deserialize;
use std::time::Duration;

pub const GITHUB_API_VERSION: &str = "2022-11-28";
pub const DEFAULT_USER_AGENT: &str = "vsc-git-hosting";

#[derive(Clone)]
pub struct GitHubHost {
    config: HostConfig,
    remote: RemoteRef,
    token: Option<String>,
    client: Client,
    web_base_url: String,
}

impl GitHubHost {
    pub fn new(
        remote: RemoteRef,
        token: Option<String>,
        custom_configs: &[HostConfig],
    ) -> Result<Self, HostError> {
        let config = remote
            .resolve_host_config(custom_configs)
            .unwrap_or_else(|| {
                let api_base_url = if remote.host.eq_ignore_ascii_case("github.com") {
                    "https://api.github.com".to_string()
                } else {
                    format!("https://{}/api/v3", remote.host)
                };
                HostConfig {
                    host: remote.host.clone(),
                    kind: HostKind::GitHub,
                    api_base_url,
                }
            });

        let web_base_url = format!("https://{}", remote.host);
        let client = Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| HostError::network(format!("failed to build HTTP client: {e}")))?;

        Ok(GitHubHost {
            config,
            remote,
            token,
            client,
            web_base_url,
        })
    }

    pub fn with_client_and_base(
        remote: RemoteRef,
        token: Option<String>,
        api_base_url: String,
        web_base_url: String,
        client: Client,
    ) -> Self {
        let config = HostConfig {
            host: remote.host.clone(),
            kind: HostKind::GitHub,
            api_base_url,
        };
        GitHubHost {
            config,
            remote,
            token,
            client,
            web_base_url,
        }
    }

    fn default_headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            ACCEPT,
            HeaderValue::from_static("application/vnd.github+json"),
        );
        headers.insert(
            "X-GitHub-Api-Version",
            HeaderValue::from_static(GITHUB_API_VERSION),
        );
        headers.insert(USER_AGENT, HeaderValue::from_static(DEFAULT_USER_AGENT));
        if let Some(token) = &self.token {
            if let Ok(val) = HeaderValue::from_str(&format!("Bearer {token}")) {
                headers.insert(AUTHORIZATION, val);
            }
        }
        headers
    }

    async fn handle_error_response(&self, resp: Response) -> HostError {
        let status = resp.status();
        let headers = resp.headers().clone();
        let body = resp.text().await.unwrap_or_default();
        HostError::from_status_and_body(status, &body, &headers)
    }

    pub fn remote(&self) -> &RemoteRef {
        &self.remote
    }

    pub fn config(&self) -> &HostConfig {
        &self.config
    }
}

#[derive(Deserialize)]
struct GhUser {
    login: String,
    name: Option<String>,
    email: Option<String>,
    avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct GhPull {
    id: u64,
    number: u64,
    title: String,
    body: Option<String>,
    html_url: String,
    base: GhBranchRef,
    head: GhBranchRef,
    #[serde(default)]
    draft: bool,
    state: String,
    user: GhUserRef,
}

#[derive(Deserialize)]
struct GhBranchRef {
    #[serde(rename = "ref")]
    branch_ref: String,
}

#[derive(Deserialize)]
struct GhUserRef {
    login: String,
}

#[derive(Deserialize)]
struct GhCheckRunsResponse {
    #[serde(default)]
    check_runs: Vec<GhCheckRun>,
}

#[derive(Deserialize)]
struct GhCheckRun {
    name: String,
    status: String,
    conclusion: Option<String>,
    html_url: Option<String>,
}

#[derive(Deserialize)]
struct GhCombinedStatus {
    #[serde(default)]
    statuses: Vec<GhStatusItem>,
}

#[derive(Deserialize)]
struct GhStatusItem {
    context: String,
    state: String,
    target_url: Option<String>,
}

#[derive(Deserialize)]
struct GhSearchUsersResponse {
    #[serde(default)]
    items: Vec<GhUser>,
}

#[derive(Deserialize)]
struct GhCommitAuthorInfo {
    avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct GhCommitItem {
    author: Option<GhCommitAuthorInfo>,
}

#[async_trait]
impl Host for GitHubHost {
    async fn current_user(&self) -> Result<CurrentUser, HostError> {
        let url = format!("{}/user", self.config.api_base_url);
        let resp = self
            .client
            .get(&url)
            .headers(self.default_headers())
            .send()
            .await
            .map_err(|e| HostError::network(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(self.handle_error_response(resp).await);
        }

        let scopes = resp
            .headers()
            .get("X-OAuth-Scopes")
            .and_then(|v| v.to_str().ok())
            .map(|s| {
                s.split(',')
                    .map(|scope| scope.trim().to_string())
                    .filter(|scope| !scope.is_empty())
                    .collect()
            })
            .unwrap_or_default();

        let user: GhUser = resp
            .json()
            .await
            .map_err(|e| HostError::api(format!("failed to parse user json: {e}")))?;

        Ok(CurrentUser {
            username: user.login,
            name: user.name,
            email: user.email,
            avatar_url: user.avatar_url,
            scopes,
        })
    }

    async fn find_pr_for_branch(&self, branch: &str) -> Result<Option<PullRequest>, HostError> {
        let head = format!("{}:{}", self.remote.namespace, branch);
        let url = format!(
            "{}/repos/{}/{}/pulls?head={}&state=open",
            self.config.api_base_url, self.remote.namespace, self.remote.repo, head
        );

        let resp = self
            .client
            .get(&url)
            .headers(self.default_headers())
            .send()
            .await
            .map_err(|e| HostError::network(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(self.handle_error_response(resp).await);
        }

        let pulls: Vec<GhPull> = resp
            .json()
            .await
            .map_err(|e| HostError::api(format!("failed to parse pulls: {e}")))?;

        if let Some(p) = pulls.into_iter().next() {
            Ok(Some(PullRequest {
                id: p.id,
                number: p.number,
                title: p.title,
                body: p.body,
                url: p.html_url,
                base: p.base.branch_ref,
                head: p.head.branch_ref,
                draft: p.draft,
                state: p.state,
                author: p.user.login,
            }))
        } else {
            Ok(None)
        }
    }

    async fn create_pr(&self, req: CreatePr) -> Result<PullRequest, HostError> {
        let url = format!(
            "{}/repos/{}/{}/pulls",
            self.config.api_base_url, self.remote.namespace, self.remote.repo
        );

        let body = serde_json::json!({
            "title": req.title,
            "head": req.head,
            "base": req.base,
            "body": req.body,
            "draft": req.draft,
        });

        let resp = self
            .client
            .post(&url)
            .headers(self.default_headers())
            .json(&body)
            .send()
            .await
            .map_err(|e| HostError::network(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(self.handle_error_response(resp).await);
        }

        let p: GhPull = resp
            .json()
            .await
            .map_err(|e| HostError::api(format!("failed to parse created pull: {e}")))?;

        if !req.reviewers.is_empty() {
            let rev_url = format!(
                "{}/repos/{}/{}/pulls/{}/requested_reviewers",
                self.config.api_base_url, self.remote.namespace, self.remote.repo, p.number
            );
            let rev_body = serde_json::json!({ "reviewers": req.reviewers });
            let _ = self
                .client
                .post(&rev_url)
                .headers(self.default_headers())
                .json(&rev_body)
                .send()
                .await;
        }

        if !req.labels.is_empty() {
            let label_url = format!(
                "{}/repos/{}/{}/issues/{}/labels",
                self.config.api_base_url, self.remote.namespace, self.remote.repo, p.number
            );
            let label_body = serde_json::json!({ "labels": req.labels });
            let _ = self
                .client
                .post(&label_url)
                .headers(self.default_headers())
                .json(&label_body)
                .send()
                .await;
        }

        Ok(PullRequest {
            id: p.id,
            number: p.number,
            title: p.title,
            body: p.body,
            url: p.html_url,
            base: p.base.branch_ref,
            head: p.head.branch_ref,
            draft: p.draft,
            state: p.state,
            author: p.user.login,
        })
    }

    async fn ci_status(&self, sha: &str) -> Result<CiStatus, HostError> {
        let mut checks = Vec::new();

        // 1. Check Runs
        let check_runs_url = format!(
            "{}/repos/{}/{}/commits/{}/check-runs",
            self.config.api_base_url, self.remote.namespace, self.remote.repo, sha
        );
        let cr_resp = self
            .client
            .get(&check_runs_url)
            .headers(self.default_headers())
            .send()
            .await
            .map_err(|e| HostError::network(e.to_string()))?;

        if !cr_resp.status().is_success() {
            return Err(self.handle_error_response(cr_resp).await);
        }

        let cr_data: GhCheckRunsResponse = cr_resp
            .json()
            .await
            .map_err(|e| HostError::api(format!("failed to parse check runs: {e}")))?;

        for cr in cr_data.check_runs {
            let state = if cr.status != "completed" {
                CiState::Pending
            } else {
                match cr.conclusion.as_deref() {
                    Some("success") | Some("neutral") | Some("skipped") => CiState::Success,
                    Some("failure")
                    | Some("timed_out")
                    | Some("action_required")
                    | Some("cancelled") => CiState::Failure,
                    _ => CiState::Pending,
                }
            };
            checks.push(Check {
                name: cr.name,
                state,
                url: cr.html_url,
            });
        }

        // 2. Combined Status
        let status_url = format!(
            "{}/repos/{}/{}/commits/{}/status",
            self.config.api_base_url, self.remote.namespace, self.remote.repo, sha
        );
        let st_resp = self
            .client
            .get(&status_url)
            .headers(self.default_headers())
            .send()
            .await
            .map_err(|e| HostError::network(e.to_string()))?;

        if !st_resp.status().is_success() {
            return Err(self.handle_error_response(st_resp).await);
        }

        let st_data: GhCombinedStatus = st_resp
            .json()
            .await
            .map_err(|e| HostError::api(format!("failed to parse combined status: {e}")))?;

        for st in st_data.statuses {
            let state = match st.state.as_str() {
                "success" => CiState::Success,
                "failure" | "error" => CiState::Failure,
                _ => CiState::Pending,
            };
            checks.push(Check {
                name: st.context,
                state,
                url: st.target_url,
            });
        }

        Ok(CiStatus::new(checks))
    }

    async fn avatar_url(&self, email: &str) -> Result<Option<String>, HostError> {
        // Try search users first
        let encoded_email = urlencoding_simple(email);
        let search_url = format!(
            "{}/search/users?q={}+in:email",
            self.config.api_base_url, encoded_email
        );

        if let Ok(resp) = self
            .client
            .get(&search_url)
            .headers(self.default_headers())
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(search_res) = resp.json::<GhSearchUsersResponse>().await {
                    if let Some(user) = search_res.items.into_iter().next() {
                        if user.avatar_url.is_some() {
                            return Ok(user.avatar_url);
                        }
                    }
                }
            }
        }

        // Fallback: search author of commit in current repo
        let commits_url = format!(
            "{}/repos/{}/{}/commits?author={}&per_page=1",
            self.config.api_base_url, self.remote.namespace, self.remote.repo, encoded_email
        );
        if let Ok(resp) = self
            .client
            .get(&commits_url)
            .headers(self.default_headers())
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(commits) = resp.json::<Vec<GhCommitItem>>().await {
                    if let Some(c) = commits.into_iter().next() {
                        if let Some(author) = c.author {
                            if author.avatar_url.is_some() {
                                return Ok(author.avatar_url);
                            }
                        }
                    }
                }
            }
        }

        Ok(None)
    }

    fn web_url(&self, target: Target) -> Result<String, HostError> {
        match target {
            Target::Commit(sha) => Ok(format!(
                "{}/{}/{}/commit/{}",
                self.web_base_url, self.remote.namespace, self.remote.repo, sha
            )),
            Target::Branch(branch) => Ok(format!(
                "{}/{}/{}/tree/{}",
                self.web_base_url, self.remote.namespace, self.remote.repo, branch
            )),
            Target::Pr(number) => Ok(format!(
                "{}/{}/{}/pull/{}",
                self.web_base_url, self.remote.namespace, self.remote.repo, number
            )),
        }
    }

    async fn search_reviewers(&self, q: &str) -> Result<Vec<Reviewer>, HostError> {
        let mut results = Vec::new();
        let mut page = 1;
        let per_page = 30;

        loop {
            let url = format!(
                "{}/repos/{}/{}/collaborators?per_page={}&page={}",
                self.config.api_base_url, self.remote.namespace, self.remote.repo, per_page, page
            );

            let resp = self
                .client
                .get(&url)
                .headers(self.default_headers())
                .send()
                .await
                .map_err(|e| HostError::network(e.to_string()))?;

            if !resp.status().is_success() {
                return Err(self.handle_error_response(resp).await);
            }

            let users: Vec<GhUser> = resp
                .json()
                .await
                .map_err(|e| HostError::api(format!("failed to parse collaborators: {e}")))?;

            if users.is_empty() {
                break;
            }

            let q_lower = q.to_ascii_lowercase();
            let count_on_page = users.len();

            for u in users {
                let matches_login = u.login.to_ascii_lowercase().contains(&q_lower);
                let matches_name = u
                    .name
                    .as_deref()
                    .map(|n| n.to_ascii_lowercase().contains(&q_lower))
                    .unwrap_or(false);

                if q.is_empty() || matches_login || matches_name {
                    results.push(Reviewer {
                        username: u.login,
                        name: u.name,
                        avatar_url: u.avatar_url,
                    });
                }
            }

            if count_on_page < per_page {
                break;
            }
            page += 1;
        }

        Ok(results)
    }
}

fn urlencoding_simple(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'~' {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn setup_host(server: &MockServer) -> GitHubHost {
        let remote = RemoteRef {
            host: "github.com".into(),
            namespace: "owner".into(),
            repo: "repo".into(),
        };
        GitHubHost::with_client_and_base(
            remote,
            Some("ghp_testtoken".into()),
            server.uri(),
            "https://github.com".into(),
            Client::new(),
        )
    }

    #[tokio::test]
    async fn test_current_user_happy_and_auth() {
        let server = MockServer::start().await;
        let host = setup_host(&server);

        Mock::given(method("GET"))
            .and(path("/user"))
            .and(header("Authorization", "Bearer ghp_testtoken"))
            .and(header("Accept", "application/vnd.github+json"))
            .and(header("X-GitHub-Api-Version", "2022-11-28"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("X-OAuth-Scopes", "repo, read:user")
                    .set_body_json(serde_json::json!({
                        "login": "octocat",
                        "name": "Mona Lisa Octocat",
                        "email": "octocat@github.com",
                        "avatar_url": "https://github.com/images/error/octocat_happy.gif"
                    })),
            )
            .mount(&server)
            .await;

        let user = host.current_user().await.unwrap();
        assert_eq!(user.username, "octocat");
        assert_eq!(user.scopes, vec!["repo", "read:user"]);
    }

    #[tokio::test]
    async fn test_current_user_401_unauthorized() {
        let server = MockServer::start().await;
        let host = setup_host(&server);

        Mock::given(method("GET"))
            .and(path("/user"))
            .respond_with(ResponseTemplate::new(401).set_body_json(serde_json::json!({
                "message": "Bad credentials"
            })))
            .mount(&server)
            .await;

        let err = host.current_user().await.unwrap_err();
        assert_eq!(err.kind, crate::rate_limit::HostErrorKind::Auth);
    }

    #[tokio::test]
    async fn test_rate_limited_403() {
        let server = MockServer::start().await;
        let host = setup_host(&server);

        Mock::given(method("GET"))
            .and(path("/user"))
            .respond_with(
                ResponseTemplate::new(403)
                    .insert_header("X-RateLimit-Limit", "60")
                    .insert_header("X-RateLimit-Remaining", "0")
                    .insert_header("X-RateLimit-Reset", "1700000000")
                    .set_body_json(serde_json::json!({
                        "message": "API rate limit exceeded for user"
                    })),
            )
            .mount(&server)
            .await;

        let err = host.current_user().await.unwrap_err();
        assert_eq!(err.kind, crate::rate_limit::HostErrorKind::RateLimited);
        let rl = err.rate_limit.unwrap();
        assert_eq!(rl.remaining, Some(0));
        assert_eq!(rl.reset_at, Some(1700000000));
    }

    #[tokio::test]
    async fn test_find_pr_for_branch_happy_and_none() {
        let server = MockServer::start().await;
        let host = setup_host(&server);

        Mock::given(method("GET"))
            .and(path("/repos/owner/repo/pulls"))
            .and(query_param("head", "owner:feat/test"))
            .and(query_param("state", "open"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {
                    "id": 101,
                    "number": 42,
                    "title": "Add feature",
                    "body": "PR description",
                    "html_url": "https://github.com/owner/repo/pull/42",
                    "base": { "ref": "main" },
                    "head": { "ref": "feat/test" },
                    "draft": false,
                    "state": "open",
                    "user": { "login": "dev" }
                }
            ])))
            .mount(&server)
            .await;

        Mock::given(method("GET"))
            .and(path("/repos/owner/repo/pulls"))
            .and(query_param("head", "owner:empty-branch"))
            .and(query_param("state", "open"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
            .mount(&server)
            .await;

        let pr = host.find_pr_for_branch("feat/test").await.unwrap();
        assert!(pr.is_some());
        let pr = pr.unwrap();
        assert_eq!(pr.number, 42);
        assert_eq!(pr.title, "Add feature");

        let empty = host.find_pr_for_branch("empty-branch").await.unwrap();
        assert!(empty.is_none());
    }

    #[tokio::test]
    async fn test_create_pr() {
        let server = MockServer::start().await;
        let host = setup_host(&server);

        Mock::given(method("POST"))
            .and(path("/repos/owner/repo/pulls"))
            .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
                "id": 501,
                "number": 7,
                "title": "New PR",
                "body": "Description",
                "html_url": "https://github.com/owner/repo/pull/7",
                "base": { "ref": "main" },
                "head": { "ref": "feat/x" },
                "draft": true,
                "state": "open",
                "user": { "login": "author_user" }
            })))
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .and(path("/repos/owner/repo/pulls/7/requested_reviewers"))
            .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({})))
            .mount(&server)
            .await;

        Mock::given(method("POST"))
            .and(path("/repos/owner/repo/issues/7/labels"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
            .mount(&server)
            .await;

        let req = CreatePr {
            base: "main".into(),
            head: "feat/x".into(),
            title: "New PR".into(),
            body: "Description".into(),
            draft: true,
            reviewers: vec!["reviewer1".into()],
            labels: vec!["enhancement".into()],
        };

        let pr = host.create_pr(req).await.unwrap();
        assert_eq!(pr.number, 7);
        assert!(pr.draft);
    }

    #[tokio::test]
    async fn test_ci_status() {
        let server = MockServer::start().await;
        let host = setup_host(&server);
        let sha = "abcd1234ef5678";

        Mock::given(method("GET"))
            .and(path(format!("/repos/owner/repo/commits/{sha}/check-runs")))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "check_runs": [
                    {
                        "name": "build",
                        "status": "completed",
                        "conclusion": "success",
                        "html_url": "https://github.com/run/1"
                    },
                    {
                        "name": "lint",
                        "status": "in_progress",
                        "conclusion": null,
                        "html_url": "https://github.com/run/2"
                    }
                ]
            })))
            .mount(&server)
            .await;

        Mock::given(method("GET"))
            .and(path(format!("/repos/owner/repo/commits/{sha}/status")))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "statuses": [
                    {
                        "context": "ci/circleci",
                        "state": "success",
                        "target_url": "https://circleci.com/1"
                    }
                ]
            })))
            .mount(&server)
            .await;

        let ci = host.ci_status(sha).await.unwrap();
        assert_eq!(ci.checks.len(), 3);
        assert_eq!(ci.state, CiState::Pending);
    }

    #[tokio::test]
    async fn test_search_reviewers_pagination() {
        let server = MockServer::start().await;
        let host = setup_host(&server);

        // Page 1: full page of 30
        let mut page1_users = Vec::new();
        for i in 1..=30 {
            page1_users.push(serde_json::json!({
                "login": format!("user_{i}"),
                "name": format!("User {i}"),
                "avatar_url": format!("https://avatar/{i}")
            }));
        }

        // Page 2: 2 users
        let page2_users = vec![
            serde_json::json!({
                "login": "bob_reviewer",
                "name": "Bob Reviewer",
                "avatar_url": null
            }),
            serde_json::json!({
                "login": "alice_reviewer",
                "name": "Alice Reviewer",
                "avatar_url": null
            }),
        ];

        Mock::given(method("GET"))
            .and(path("/repos/owner/repo/collaborators"))
            .and(query_param("page", "1"))
            .and(query_param("per_page", "30"))
            .respond_with(ResponseTemplate::new(200).set_body_json(page1_users))
            .mount(&server)
            .await;

        Mock::given(method("GET"))
            .and(path("/repos/owner/repo/collaborators"))
            .and(query_param("page", "2"))
            .and(query_param("per_page", "30"))
            .respond_with(ResponseTemplate::new(200).set_body_json(page2_users))
            .mount(&server)
            .await;

        let results = host.search_reviewers("reviewer").await.unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].username, "bob_reviewer");
        assert_eq!(results[1].username, "alice_reviewer");
    }

    #[tokio::test]
    async fn test_web_url() {
        let host = setup_host(&MockServer::start().await);
        let commit_url = host.web_url(Target::Commit("sha123".into())).unwrap();
        assert_eq!(commit_url, "https://github.com/owner/repo/commit/sha123");

        let branch_url = host.web_url(Target::Branch("main".into())).unwrap();
        assert_eq!(branch_url, "https://github.com/owner/repo/tree/main");

        let pr_url = host.web_url(Target::Pr(42)).unwrap();
        assert_eq!(pr_url, "https://github.com/owner/repo/pull/42");
    }

    #[tokio::test]
    async fn test_github_404_not_found() {
        let server = MockServer::start().await;
        let host = setup_host(&server);

        Mock::given(method("GET"))
            .and(path("/repos/owner/repo/commits/missing-sha/check-runs"))
            .respond_with(ResponseTemplate::new(404).set_body_json(serde_json::json!({
                "message": "Not Found"
            })))
            .mount(&server)
            .await;

        let err = host.ci_status("missing-sha").await.unwrap_err();
        assert_eq!(err.kind, crate::rate_limit::HostErrorKind::NotFound);
    }
}
