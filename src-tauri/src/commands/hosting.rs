use std::path::Path;

use git_core::cli::{CommandOptions, GitCli};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Window};

use crate::app::secrets::{
    delete_host_token as del_token, get_host_token, set_host_token as save_token,
};
use crate::app::settings::{get_settings, HostConfig};
use crate::commands::mod_helpers::active_session;
use crate::error::{AppError, ErrorKind};
use crate::git_exec::create_git_cli;

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    pub host: String,
    pub kind: String,
    pub api_base_url: String,
    pub namespace: String,
    pub repo: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CurrentUser {
    pub username: String,
    pub name: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub scopes: Vec<String>,
}

impl From<hosting::CurrentUser> for CurrentUser {
    fn from(u: hosting::CurrentUser) -> Self {
        Self {
            username: u.username,
            name: u.name,
            email: u.email,
            avatar_url: u.avatar_url,
            scopes: u.scopes,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScopeCheckResult {
    pub ok: bool,
    pub required_scopes: Vec<String>,
    pub missing_scopes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResult {
    pub user: CurrentUser,
    pub scope_check: ScopeCheckResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub id: u32,
    pub number: u32,
    pub title: String,
    pub body: Option<String>,
    pub url: String,
    pub base: String,
    pub head: String,
    pub draft: bool,
    pub state: String,
    pub author: String,
}

impl From<hosting::PullRequest> for PullRequest {
    fn from(pr: hosting::PullRequest) -> Self {
        Self {
            id: pr.id as u32,
            number: pr.number as u32,
            title: pr.title,
            body: pr.body,
            url: pr.url,
            base: pr.base,
            head: pr.head,
            draft: pr.draft,
            state: pr.state,
            author: pr.author,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreatePrRequest {
    pub base: String,
    pub head: String,
    pub title: String,
    pub body: String,
    pub draft: bool,
    pub reviewers: Vec<String>,
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Reviewer {
    pub username: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

impl From<hosting::Reviewer> for Reviewer {
    fn from(r: hosting::Reviewer) -> Self {
        Self {
            username: r.username,
            name: r.name,
            avatar_url: r.avatar_url,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CiState {
    Success,
    Failure,
    Pending,
    None,
}

impl From<hosting::CiState> for CiState {
    fn from(s: hosting::CiState) -> Self {
        match s {
            hosting::CiState::Success => CiState::Success,
            hosting::CiState::Failure => CiState::Failure,
            hosting::CiState::Pending => CiState::Pending,
            hosting::CiState::None => CiState::None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CiCheck {
    pub name: String,
    pub state: CiState,
    pub url: Option<String>,
}

impl From<hosting::Check> for CiCheck {
    fn from(c: hosting::Check) -> Self {
        Self {
            name: c.name,
            state: c.state.into(),
            url: c.url,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CiStatus {
    pub state: CiState,
    pub checks: Vec<CiCheck>,
}

impl From<hosting::CiStatus> for CiStatus {
    fn from(s: hosting::CiStatus) -> Self {
        Self {
            state: s.state.into(),
            checks: s.checks.into_iter().map(Into::into).collect(),
        }
    }
}

pub fn map_host_error(err: hosting::HostError) -> AppError {
    let kind = match err.kind {
        hosting::HostErrorKind::Auth => ErrorKind::AuthFailed,
        hosting::HostErrorKind::RateLimited => ErrorKind::HostApi,
        hosting::HostErrorKind::NotFound => ErrorKind::HostApi,
        hosting::HostErrorKind::Network => ErrorKind::Network,
        hosting::HostErrorKind::Api => ErrorKind::HostApi,
    };
    AppError::new(kind, err.message)
}

pub fn check_scopes(kind: &str, user_scopes: &[String]) -> ScopeCheckResult {
    let normalized: Vec<String> = user_scopes
        .iter()
        .map(|s| s.trim().to_lowercase())
        .collect();
    let is_gitlab = kind.eq_ignore_ascii_case("gitlab");
    let required = if is_gitlab {
        vec!["api".to_string()]
    } else {
        vec!["repo".to_string(), "read:user".to_string()]
    };
    let missing: Vec<String> = required
        .iter()
        .filter(|req| !normalized.contains(&req.to_lowercase()))
        .cloned()
        .collect();
    let ok = missing.is_empty();
    ScopeCheckResult {
        ok,
        required_scopes: required,
        missing_scopes: missing,
    }
}

pub fn detect_remote_ref(
    cli: &GitCli,
    repo_root: &Path,
) -> Result<Option<hosting::RemoteRef>, AppError> {
    // Try remote origin url first
    let res = cli.exec(
        repo_root,
        &["config", "--get", "remote.origin.url"],
        CommandOptions::read_only(),
    );

    let raw_url = match res {
        Ok(out) => {
            let s = out.stdout_lossy().trim().to_string();
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        }
        Err(_) => None,
    };

    let url = if let Some(u) = raw_url {
        u
    } else {
        // Fallback: list remotes and get first remote's url
        let remotes_res = cli.exec(repo_root, &["remote"], CommandOptions::read_only());
        if let Ok(out) = remotes_res {
            let first_remote = out
                .stdout_lossy()
                .lines()
                .next()
                .map(|s| s.trim().to_string());
            if let Some(r) = first_remote.filter(|s| !s.is_empty()) {
                let get_url_res = cli.exec(
                    repo_root,
                    &["config", "--get", &format!("remote.{r}.url")],
                    CommandOptions::read_only(),
                );
                if let Ok(out) = get_url_res {
                    out.stdout_lossy().trim().to_string()
                } else {
                    return Ok(None);
                }
            } else {
                return Ok(None);
            }
        } else {
            return Ok(None);
        }
    };

    match hosting::RemoteRef::parse(&url) {
        Ok(parsed) => Ok(Some(parsed)),
        Err(_) => Ok(None),
    }
}

fn build_host_client(
    app: &AppHandle,
    remote: &hosting::RemoteRef,
    custom_token: Option<String>,
) -> Result<Box<dyn hosting::Host>, AppError> {
    let settings = get_settings(app.clone()).unwrap_or_default();
    let custom_configs: Vec<hosting::HostConfig> = settings
        .hosts
        .into_iter()
        .map(|h| {
            let kind = if h.kind.eq_ignore_ascii_case("gitlab") {
                hosting::HostKind::GitLab
            } else {
                hosting::HostKind::GitHub
            };
            hosting::HostConfig {
                host: h.host,
                kind,
                api_base_url: h.api_base_url,
            }
        })
        .collect();

    let resolved = remote
        .resolve_host_config(&custom_configs)
        .unwrap_or_else(|| {
            let is_github = remote.host.eq_ignore_ascii_case("github.com");
            let kind = if is_github {
                hosting::HostKind::GitHub
            } else {
                hosting::HostKind::GitLab
            };
            let api_base_url = if is_github {
                "https://api.github.com".to_string()
            } else {
                format!("https://{}/api/v4", remote.host)
            };
            hosting::HostConfig {
                host: remote.host.clone(),
                kind,
                api_base_url,
            }
        });

    let token = if let Some(t) = custom_token.filter(|s| !s.trim().is_empty()) {
        Some(t)
    } else {
        get_host_token(&remote.host)?
    };

    let client: Box<dyn hosting::Host> = if resolved.kind == hosting::HostKind::GitLab {
        Box::new(
            hosting::GitLabHost::new(remote.clone(), token, &custom_configs)
                .map_err(map_host_error)?,
        )
    } else {
        Box::new(
            hosting::GitHubHost::new(remote.clone(), token, &custom_configs)
                .map_err(map_host_error)?,
        )
    };
    Ok(client)
}

#[tauri::command]
#[specta::specta]
pub fn host_info(app: AppHandle, window: Window) -> Result<Option<HostInfo>, AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();

    let remote_ref = match detect_remote_ref(&cli, &session.root)? {
        Some(r) => r,
        None => return Ok(None),
    };

    let settings = get_settings(app).unwrap_or_default();
    let custom_configs: Vec<hosting::HostConfig> = settings
        .hosts
        .into_iter()
        .map(|h| {
            let kind = if h.kind.eq_ignore_ascii_case("gitlab") {
                hosting::HostKind::GitLab
            } else {
                hosting::HostKind::GitHub
            };
            hosting::HostConfig {
                host: h.host,
                kind,
                api_base_url: h.api_base_url,
            }
        })
        .collect();

    let resolved = remote_ref
        .resolve_host_config(&custom_configs)
        .unwrap_or_else(|| {
            let is_github = remote_ref.host.eq_ignore_ascii_case("github.com");
            let kind = if is_github {
                hosting::HostKind::GitHub
            } else {
                hosting::HostKind::GitLab
            };
            let api_base_url = if is_github {
                "https://api.github.com".to_string()
            } else {
                format!("https://{}/api/v4", remote_ref.host)
            };
            hosting::HostConfig {
                host: remote_ref.host.clone(),
                kind,
                api_base_url,
            }
        });

    let kind_str = match resolved.kind {
        hosting::HostKind::GitHub => "github",
        hosting::HostKind::GitLab => "gitlab",
    };

    Ok(Some(HostInfo {
        host: remote_ref.host,
        kind: kind_str.to_string(),
        api_base_url: resolved.api_base_url,
        namespace: remote_ref.namespace,
        repo: remote_ref.repo,
    }))
}

#[tauri::command]
#[specta::specta]
pub fn set_host_token(_app: AppHandle, host: String, token: String) -> Result<(), AppError> {
    save_token(&host, &token)
}

#[tauri::command]
#[specta::specta]
pub fn delete_host_token(_app: AppHandle, host: String) -> Result<(), AppError> {
    del_token(&host)
}

pub async fn test_host_token_impl(
    host: HostConfig,
    token: Option<String>,
) -> Result<ConnectionTestResult, AppError> {
    let pat = if let Some(t) = token.filter(|s| !s.trim().is_empty()) {
        Some(t)
    } else {
        get_host_token(&host.host)?
    };

    let pat = match pat {
        Some(t) if !t.trim().is_empty() => t,
        _ => {
            return Err(AppError::new(
                ErrorKind::AuthFailed,
                format!(
                    "No access token found or configured for host '{}'",
                    host.host
                ),
            ))
        }
    };

    let dummy_remote = hosting::RemoteRef {
        host: host.host.clone(),
        namespace: "test".to_string(),
        repo: "test".to_string(),
    };

    let target_kind = if host.kind.eq_ignore_ascii_case("gitlab") {
        hosting::HostKind::GitLab
    } else {
        hosting::HostKind::GitHub
    };
    let custom_configs = vec![hosting::HostConfig {
        host: host.host.clone(),
        kind: target_kind,
        api_base_url: host.api_base_url.clone(),
    }];

    let client: Box<dyn hosting::Host> = if target_kind == hosting::HostKind::GitLab {
        Box::new(
            hosting::GitLabHost::new(dummy_remote, Some(pat), &custom_configs)
                .map_err(map_host_error)?,
        )
    } else {
        Box::new(
            hosting::GitHubHost::new(dummy_remote, Some(pat), &custom_configs)
                .map_err(map_host_error)?,
        )
    };

    let user = client.current_user().await.map_err(map_host_error)?;
    let scope_check = check_scopes(&host.kind, &user.scopes);

    Ok(ConnectionTestResult {
        user: user.into(),
        scope_check,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn test_host_token(
    _app: AppHandle,
    host: HostConfig,
    token: Option<String>,
) -> Result<ConnectionTestResult, AppError> {
    test_host_token_impl(host, token).await
}

#[tauri::command]
#[specta::specta]
pub async fn current_pull_request(
    app: AppHandle,
    window: Window,
) -> Result<Option<PullRequest>, AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();

    let remote_ref = match detect_remote_ref(&cli, &session.root)? {
        Some(r) => r,
        None => return Ok(None),
    };

    let client = build_host_client(&app, &remote_ref, None)?;
    let branch = session.head_branch.read().clone();
    let pr = client
        .find_pr_for_branch(&branch)
        .await
        .map_err(map_host_error)?;

    Ok(pr.map(Into::into))
}

#[tauri::command]
#[specta::specta]
pub async fn list_pull_requests(
    app: AppHandle,
    window: Window,
) -> Result<Vec<PullRequest>, AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();

    let remote_ref = match detect_remote_ref(&cli, &session.root)? {
        Some(r) => r,
        None => return Ok(Vec::new()),
    };

    let client = build_host_client(&app, &remote_ref, None)?;
    let branch = session.head_branch.read().clone();
    let pr = client
        .find_pr_for_branch(&branch)
        .await
        .map_err(map_host_error)?;

    Ok(pr.into_iter().map(Into::into).collect())
}

#[tauri::command]
#[specta::specta]
pub async fn create_pull_request(
    app: AppHandle,
    window: Window,
    req: CreatePrRequest,
) -> Result<PullRequest, AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();

    let remote_ref = match detect_remote_ref(&cli, &session.root)? {
        Some(r) => r,
        None => {
            return Err(AppError::new(
                ErrorKind::HostApi,
                "Cannot create pull request: no git remote host detected",
            ))
        }
    };

    let client = build_host_client(&app, &remote_ref, None)?;
    let create_req = hosting::CreatePr {
        base: req.base,
        head: req.head,
        title: req.title,
        body: req.body,
        draft: req.draft,
        reviewers: req.reviewers,
        labels: req.labels,
    };

    let created = client.create_pr(create_req).await.map_err(map_host_error)?;
    Ok(created.into())
}

#[tauri::command]
#[specta::specta]
pub async fn ci_status(app: AppHandle, window: Window, sha: String) -> Result<CiStatus, AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();

    let remote_ref = match detect_remote_ref(&cli, &session.root)? {
        Some(r) => r,
        None => {
            return Ok(CiStatus {
                state: CiState::None,
                checks: Vec::new(),
            })
        }
    };

    let client = build_host_client(&app, &remote_ref, None)?;
    let status = client.ci_status(&sha).await.map_err(map_host_error)?;
    Ok(status.into())
}

#[tauri::command]
#[specta::specta]
pub async fn search_reviewers(
    app: AppHandle,
    window: Window,
    host_name: Option<String>,
    query: String,
) -> Result<Vec<Reviewer>, AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();

    let remote_ref = match detect_remote_ref(&cli, &session.root)? {
        Some(r) => r,
        None => {
            if let Some(host) = host_name {
                hosting::RemoteRef {
                    host,
                    namespace: String::new(),
                    repo: String::new(),
                }
            } else {
                return Ok(Vec::new());
            }
        }
    };

    let client = build_host_client(&app, &remote_ref, None)?;
    let reviewers = client
        .search_reviewers(&query)
        .await
        .map_err(map_host_error)?;

    Ok(reviewers.into_iter().map(Into::into).collect())
}

#[tauri::command]
#[specta::specta]
pub fn check_branch_pushed(
    app: AppHandle,
    window: Window,
    head_branch: String,
) -> Result<bool, AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();

    let res = cli.exec(
        &session.root,
        &["branch", "-r", "--list", &format!("origin/{head_branch}")],
        CommandOptions::read_only(),
    );

    match res {
        Ok(out) => Ok(!out.stdout_lossy().trim().is_empty()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn avatar(_app: AppHandle, email: String) -> Result<Option<String>, AppError> {
    if email.trim().is_empty() {
        return Ok(None);
    }
    let hash = hosting::email_hash(&email);
    let gravatar = hosting::gravatar_url_for_hash(&hash);
    Ok(Some(gravatar))
}
