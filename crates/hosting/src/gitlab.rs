use crate::host::{
    Check, CiState, CiStatus, CreatePr, CurrentUser, Host, PullRequest, Reviewer, Target,
};
use crate::rate_limit::HostError;
use crate::remote_url::{HostConfig, HostKind, RemoteRef};
use async_trait::async_trait;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, USER_AGENT};
use reqwest::{Client, Response};
use serde::Deserialize;
use std::time::Duration;

pub const DEFAULT_USER_AGENT: &str = "vsc-git-hosting";

#[derive(Clone)]
pub struct GitLabHost {
    config: HostConfig,
    remote: RemoteRef,
    token: Option<String>,
    client: Client,
    web_base_url: String,
    project_id: String,
}

impl GitLabHost {
    pub fn new(
        remote: RemoteRef,
        token: Option<String>,
        custom_configs: &[HostConfig],
    ) -> Result<Self, HostError> {
        let config = remote
            .resolve_host_config(custom_configs)
            .unwrap_or_else(|| {
                let api_base_url = if remote.host.eq_ignore_ascii_case("gitlab.com") {
                    "https://gitlab.com/api/v4".to_string()
                } else {
                    format!("https://{}/api/v4", remote.host)
                };
                HostConfig {
                    host: remote.host.clone(),
                    kind: HostKind::GitLab,
                    api_base_url,
                }
            });

        let web_base_url = format!("https://{}", remote.host);
        let project_id = remote.gitlab_project_id();
        let client = Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| HostError::network(format!("failed to build HTTP client: {e}")))?;

        Ok(GitLabHost {
            config,
            remote,
            token,
            client,
            web_base_url,
            project_id,
        })
    }

    pub fn with_client_and_base(
        remote: RemoteRef,
        token: Option<String>,
        api_base_url: String,
        web_base_url: String,
        client: Client,
    ) -> Self {
        let project_id = remote.gitlab_project_id();
        let config = HostConfig {
            host: remote.host.clone(),
            kind: HostKind::GitLab,
            api_base_url,
        };
        GitLabHost {
            config,
            remote,
            token,
            client,
            web_base_url,
            project_id,
        }
    }

    fn default_headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
        headers.insert(USER_AGENT, HeaderValue::from_static(DEFAULT_USER_AGENT));
        if let Some(token) = &self.token {
            if let Ok(val) = HeaderValue::from_str(token) {
                headers.insert("PRIVATE-TOKEN", val);
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

    pub fn project_id(&self) -> &str {
        &self.project_id
    }
}

#[derive(Deserialize)]
struct GlUser {
    username: String,
    name: Option<String>,
    email: Option<String>,
    avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct GlTokenInfo {
    #[serde(default)]
    scopes: Vec<String>,
}

#[derive(Deserialize)]
struct GlMergeRequest {
    id: u64,
    iid: u64,
    title: String,
    description: Option<String>,
    web_url: String,
    target_branch: String,
    source_branch: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    work_in_progress: bool,
    state: String,
    author: GlAuthor,
}

#[derive(Deserialize)]
struct GlAuthor {
    username: String,
}

#[derive(Deserialize)]
struct GlPipeline {
    id: u64,
    status: String,
    web_url: Option<String>,
}

#[derive(Deserialize)]
struct GlJob {
    name: String,
    status: String,
    web_url: Option<String>,
}

#[derive(Deserialize)]
struct GlAvatarResponse {
    avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct GlMember {
    username: String,
    name: Option<String>,
    avatar_url: Option<String>,
}

#[async_trait]
impl Host for GitLabHost {
    async fn current_user(&self) -> Result<CurrentUser, HostError> {
        let user_url = format!("{}/user", self.config.api_base_url);
        let resp = self
            .client
            .get(&user_url)
            .headers(self.default_headers())
            .send()
            .await
            .map_err(|e| HostError::network(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(self.handle_error_response(resp).await);
        }

        let gl_user: GlUser = resp
            .json()
            .await
            .map_err(|e| HostError::api(format!("failed to parse user json: {e}")))?;

        // Try to fetch scopes via personal_access_tokens/self
        let mut scopes = Vec::new();
        let token_url = format!("{}/personal_access_tokens/self", self.config.api_base_url);
        if let Ok(token_resp) = self
            .client
            .get(&token_url)
            .headers(self.default_headers())
            .send()
            .await
        {
            if token_resp.status().is_success() {
                if let Ok(info) = token_resp.json::<GlTokenInfo>().await {
                    scopes = info.scopes;
                }
            }
        }

        Ok(CurrentUser {
            username: gl_user.username,
            name: gl_user.name,
            email: gl_user.email,
            avatar_url: gl_user.avatar_url,
            scopes,
        })
    }

    async fn find_pr_for_branch(&self, branch: &str) -> Result<Option<PullRequest>, HostError> {
        let url = format!(
            "{}/projects/{}/merge_requests?source_branch={}&state=opened",
            self.config.api_base_url, self.project_id, branch
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

        let mrs: Vec<GlMergeRequest> = resp
            .json()
            .await
            .map_err(|e| HostError::api(format!("failed to parse merge requests: {e}")))?;

        if let Some(mr) = mrs.into_iter().next() {
            let is_draft = mr.draft || mr.work_in_progress || mr.title.starts_with("Draft:");
            Ok(Some(PullRequest {
                id: mr.id,
                number: mr.iid,
                title: mr.title,
                body: mr.description,
                url: mr.web_url,
                base: mr.target_branch,
                head: mr.source_branch,
                draft: is_draft,
                state: mr.state,
                author: mr.author.username,
            }))
        } else {
            Ok(None)
        }
    }

    async fn create_pr(&self, req: CreatePr) -> Result<PullRequest, HostError> {
        let url = format!(
            "{}/projects/{}/merge_requests",
            self.config.api_base_url, self.project_id
        );

        let title = if req.draft && !req.title.starts_with("Draft:") {
            format!("Draft: {}", req.title)
        } else {
            req.title
        };

        let labels = req.labels.join(",");
        let body = serde_json::json!({
            "source_branch": req.head,
            "target_branch": req.base,
            "title": title,
            "description": req.body,
            "labels": labels,
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

        let mr: GlMergeRequest = resp
            .json()
            .await
            .map_err(|e| HostError::api(format!("failed to parse created MR: {e}")))?;

        let is_draft = mr.draft || mr.work_in_progress || mr.title.starts_with("Draft:");
        Ok(PullRequest {
            id: mr.id,
            number: mr.iid,
            title: mr.title,
            body: mr.description,
            url: mr.web_url,
            base: mr.target_branch,
            head: mr.source_branch,
            draft: is_draft,
            state: mr.state,
            author: mr.author.username,
        })
    }

    async fn ci_status(&self, sha: &str) -> Result<CiStatus, HostError> {
        let pipelines_url = format!(
            "{}/projects/{}/pipelines?sha={}",
            self.config.api_base_url, self.project_id, sha
        );

        let resp = self
            .client
            .get(&pipelines_url)
            .headers(self.default_headers())
            .send()
            .await
            .map_err(|e| HostError::network(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(self.handle_error_response(resp).await);
        }

        let pipelines: Vec<GlPipeline> = resp
            .json()
            .await
            .map_err(|e| HostError::api(format!("failed to parse pipelines: {e}")))?;

        let latest = match pipelines.into_iter().next() {
            Some(p) => p,
            None => return Ok(CiStatus::new(vec![])),
        };

        let jobs_url = format!(
            "{}/projects/{}/pipelines/{}/jobs",
            self.config.api_base_url, self.project_id, latest.id
        );

        let mut checks = Vec::new();
        if let Ok(jobs_resp) = self
            .client
            .get(&jobs_url)
            .headers(self.default_headers())
            .send()
            .await
        {
            if jobs_resp.status().is_success() {
                if let Ok(jobs) = jobs_resp.json::<Vec<GlJob>>().await {
                    for job in jobs {
                        let state = match job.status.as_str() {
                            "success" | "skipped" => CiState::Success,
                            "failed" | "canceled" => CiState::Failure,
                            _ => CiState::Pending,
                        };
                        checks.push(Check {
                            name: job.name,
                            state,
                            url: job.web_url,
                        });
                    }
                }
            }
        }

        if checks.is_empty() {
            let state = match latest.status.as_str() {
                "success" | "skipped" => CiState::Success,
                "failed" | "canceled" => CiState::Failure,
                _ => CiState::Pending,
            };
            checks.push(Check {
                name: format!("pipeline #{}", latest.id),
                state,
                url: latest.web_url,
            });
        }

        Ok(CiStatus::new(checks))
    }

    async fn avatar_url(&self, email: &str) -> Result<Option<String>, HostError> {
        let encoded_email = urlencoding_simple(email);
        let url = format!(
            "{}/avatar?email={}",
            self.config.api_base_url, encoded_email
        );

        let resp = self
            .client
            .get(&url)
            .headers(self.default_headers())
            .send()
            .await
            .map_err(|e| HostError::network(e.to_string()))?;

        if !resp.status().is_success() {
            return Ok(None);
        }

        let avatar_resp: GlAvatarResponse = resp
            .json()
            .await
            .map_err(|e| HostError::api(format!("failed to parse avatar json: {e}")))?;

        Ok(avatar_resp.avatar_url)
    }

    fn web_url(&self, target: Target) -> Result<String, HostError> {
        let full_path = self.remote.full_path();
        match target {
            Target::Commit(sha) => Ok(format!(
                "{}/{}/-/commit/{}",
                self.web_base_url, full_path, sha
            )),
            Target::Branch(branch) => Ok(format!(
                "{}/{}/-/tree/{}",
                self.web_base_url, full_path, branch
            )),
            Target::Pr(number) => Ok(format!(
                "{}/{}/-/merge_requests/{}",
                self.web_base_url, full_path, number
            )),
        }
    }

    async fn search_reviewers(&self, q: &str) -> Result<Vec<Reviewer>, HostError> {
        let mut results = Vec::new();
        let mut page = 1;
        let per_page = 20;

        loop {
            let url = format!(
                "{}/projects/{}/members?per_page={}&page={}&query={}",
                self.config.api_base_url,
                self.project_id,
                per_page,
                page,
                urlencoding_simple(q)
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

            let members: Vec<GlMember> = resp
                .json()
                .await
                .map_err(|e| HostError::api(format!("failed to parse members: {e}")))?;

            if members.is_empty() {
                break;
            }

            let count_on_page = members.len();
            for m in members {
                results.push(Reviewer {
                    username: m.username,
                    name: m.name,
                    avatar_url: m.avatar_url,
                });
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

    fn setup_gitlab_host(server: &MockServer) -> GitLabHost {
        let remote = RemoteRef {
            host: "gitlab.com".into(),
            namespace: "my-group/sub".into(),
            repo: "my-repo".into(),
        };
        GitLabHost::with_client_and_base(
            remote,
            Some("glpat-testtoken123".into()),
            server.uri(),
            "https://gitlab.com".into(),
            Client::new(),
        )
    }

    #[tokio::test]
    async fn test_gitlab_current_user_and_scopes() {
        let server = MockServer::start().await;
        let host = setup_gitlab_host(&server);

        Mock::given(method("GET"))
            .and(path("/user"))
            .and(header("PRIVATE-TOKEN", "glpat-testtoken123"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "username": "tanuki",
                "name": "GitLab Tanuki",
                "email": "tanuki@gitlab.com",
                "avatar_url": "https://gitlab.com/uploads/-/system/user/avatar/1/avatar.png"
            })))
            .mount(&server)
            .await;

        Mock::given(method("GET"))
            .and(path("/personal_access_tokens/self"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "scopes": ["api", "read_repository"]
            })))
            .mount(&server)
            .await;

        let user = host.current_user().await.unwrap();
        assert_eq!(user.username, "tanuki");
        assert_eq!(user.scopes, vec!["api", "read_repository"]);
    }

    #[tokio::test]
    async fn test_gitlab_auth_failure_401() {
        let server = MockServer::start().await;
        let host = setup_gitlab_host(&server);

        Mock::given(method("GET"))
            .and(path("/user"))
            .respond_with(ResponseTemplate::new(401).set_body_json(serde_json::json!({
                "message": "401 Unauthorized"
            })))
            .mount(&server)
            .await;

        let err = host.current_user().await.unwrap_err();
        assert_eq!(err.kind, crate::rate_limit::HostErrorKind::Auth);
    }

    #[tokio::test]
    async fn test_gitlab_rate_limited_429() {
        let server = MockServer::start().await;
        let host = setup_gitlab_host(&server);

        Mock::given(method("GET"))
            .and(path("/user"))
            .respond_with(
                ResponseTemplate::new(429)
                    .insert_header("RateLimit-Remaining", "0")
                    .insert_header("Retry-After", "120")
                    .set_body_string("Too Many Requests"),
            )
            .mount(&server)
            .await;

        let err = host.current_user().await.unwrap_err();
        assert_eq!(err.kind, crate::rate_limit::HostErrorKind::RateLimited);
        let rl = err.rate_limit.unwrap();
        assert_eq!(rl.retry_after, Some(120));
    }

    #[tokio::test]
    async fn test_gitlab_find_pr_for_branch() {
        let server = MockServer::start().await;
        let host = setup_gitlab_host(&server);

        Mock::given(method("GET"))
            .and(path("/projects/my-group%2Fsub%2Fmy-repo/merge_requests"))
            .and(query_param("source_branch", "feature/gl"))
            .and(query_param("state", "opened"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {
                    "id": 999,
                    "iid": 12,
                    "title": "Draft: Great feature",
                    "description": "Details here",
                    "web_url": "https://gitlab.com/my-group/sub/my-repo/-/merge_requests/12",
                    "target_branch": "main",
                    "source_branch": "feature/gl",
                    "draft": true,
                    "state": "opened",
                    "author": { "username": "gl_dev" }
                }
            ])))
            .mount(&server)
            .await;

        let pr = host
            .find_pr_for_branch("feature/gl")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(pr.number, 12);
        assert!(pr.draft);
        assert_eq!(pr.author, "gl_dev");
    }

    #[tokio::test]
    async fn test_gitlab_create_mr_draft() {
        let server = MockServer::start().await;
        let host = setup_gitlab_host(&server);

        Mock::given(method("POST"))
            .and(path("/projects/my-group%2Fsub%2Fmy-repo/merge_requests"))
            .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
                "id": 1001,
                "iid": 15,
                "title": "Draft: Implement feature",
                "description": "Some description",
                "web_url": "https://gitlab.com/my-group/sub/my-repo/-/merge_requests/15",
                "target_branch": "main",
                "source_branch": "feat/gl-mr",
                "draft": true,
                "state": "opened",
                "author": { "username": "author_tanuki" }
            })))
            .mount(&server)
            .await;

        let req = CreatePr {
            base: "main".into(),
            head: "feat/gl-mr".into(),
            title: "Implement feature".into(),
            body: "Some description".into(),
            draft: true,
            reviewers: vec![],
            labels: vec!["frontend".into(), "backend".into()],
        };

        let created = host.create_pr(req).await.unwrap();
        assert_eq!(created.number, 15);
        assert!(created.draft);
    }

    #[tokio::test]
    async fn test_gitlab_ci_status_pipeline_and_jobs() {
        let server = MockServer::start().await;
        let host = setup_gitlab_host(&server);
        let sha = "aabbcc112233";

        Mock::given(method("GET"))
            .and(path("/projects/my-group%2Fsub%2Fmy-repo/pipelines"))
            .and(query_param("sha", sha))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {
                    "id": 456,
                    "status": "running",
                    "web_url": "https://gitlab.com/pipelines/456"
                }
            ])))
            .mount(&server)
            .await;

        Mock::given(method("GET"))
            .and(path(
                "/projects/my-group%2Fsub%2Fmy-repo/pipelines/456/jobs",
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {
                    "name": "cargo-test",
                    "status": "success",
                    "web_url": "https://gitlab.com/jobs/1"
                },
                {
                    "name": "cargo-clippy",
                    "status": "running",
                    "web_url": "https://gitlab.com/jobs/2"
                }
            ])))
            .mount(&server)
            .await;

        let ci = host.ci_status(sha).await.unwrap();
        assert_eq!(ci.checks.len(), 2);
        assert_eq!(ci.state, CiState::Pending);
    }

    #[tokio::test]
    async fn test_gitlab_avatar_url() {
        let server = MockServer::start().await;
        let host = setup_gitlab_host(&server);

        Mock::given(method("GET"))
            .and(path("/avatar"))
            .and(query_param("email", "user@gitlab.example.com"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "avatar_url": "https://gitlab.com/avatar/user.png"
            })))
            .mount(&server)
            .await;

        let avatar = host.avatar_url("user@gitlab.example.com").await.unwrap();
        assert_eq!(avatar, Some("https://gitlab.com/avatar/user.png".into()));
    }

    #[tokio::test]
    async fn test_gitlab_search_reviewers_pagination() {
        let server = MockServer::start().await;
        let host = setup_gitlab_host(&server);

        let mut page1 = Vec::new();
        for i in 1..=20 {
            page1.push(serde_json::json!({
                "username": format!("member_{i}"),
                "name": format!("Member {i}"),
                "avatar_url": null
            }));
        }

        let page2 = vec![serde_json::json!({
            "username": "lead_reviewer",
            "name": "Lead Reviewer",
            "avatar_url": "https://avatar/lead.png"
        })];

        Mock::given(method("GET"))
            .and(path("/projects/my-group%2Fsub%2Fmy-repo/members"))
            .and(query_param("per_page", "20"))
            .and(query_param("page", "1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(page1))
            .mount(&server)
            .await;

        Mock::given(method("GET"))
            .and(path("/projects/my-group%2Fsub%2Fmy-repo/members"))
            .and(query_param("per_page", "20"))
            .and(query_param("page", "2"))
            .respond_with(ResponseTemplate::new(200).set_body_json(page2))
            .mount(&server)
            .await;

        let reviewers = host.search_reviewers("").await.unwrap();
        assert_eq!(reviewers.len(), 21);
        assert_eq!(reviewers[20].username, "lead_reviewer");
    }

    #[tokio::test]
    async fn test_gitlab_web_urls() {
        let host = setup_gitlab_host(&MockServer::start().await);
        let commit_url = host.web_url(Target::Commit("sha999".into())).unwrap();
        assert_eq!(
            commit_url,
            "https://gitlab.com/my-group/sub/my-repo/-/commit/sha999"
        );

        let branch_url = host.web_url(Target::Branch("main".into())).unwrap();
        assert_eq!(
            branch_url,
            "https://gitlab.com/my-group/sub/my-repo/-/tree/main"
        );

        let pr_url = host.web_url(Target::Pr(77)).unwrap();
        assert_eq!(
            pr_url,
            "https://gitlab.com/my-group/sub/my-repo/-/merge_requests/77"
        );
    }
}
