use crate::rate_limit::HostError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentUser {
    pub username: String,
    pub name: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub id: u64,
    pub number: u64,
    pub title: String,
    pub body: Option<String>,
    pub url: String,
    pub base: String,
    pub head: String,
    pub draft: bool,
    pub state: String,
    pub author: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePr {
    pub base: String,
    pub head: String,
    pub title: String,
    pub body: String,
    pub draft: bool,
    pub reviewers: Vec<String>,
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CiState {
    Success,
    Failure,
    Pending,
    None,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub name: String,
    pub state: CiState,
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CiStatus {
    pub state: CiState,
    pub checks: Vec<Check>,
}

impl CiStatus {
    pub fn new(checks: Vec<Check>) -> Self {
        let state = Self::aggregate_state(&checks);
        CiStatus { state, checks }
    }

    pub fn aggregate_state(checks: &[Check]) -> CiState {
        if checks.is_empty() {
            return CiState::None;
        }

        if checks.iter().any(|c| c.state == CiState::Failure) {
            return CiState::Failure;
        }

        if checks.iter().any(|c| c.state == CiState::Pending) {
            return CiState::Pending;
        }

        CiState::Success
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum Target {
    Commit(String),
    Branch(String),
    Pr(u64),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reviewer {
    pub username: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

#[async_trait]
pub trait Host: Send + Sync {
    async fn current_user(&self) -> Result<CurrentUser, HostError>;
    async fn find_pr_for_branch(&self, branch: &str) -> Result<Option<PullRequest>, HostError>;
    async fn create_pr(&self, req: CreatePr) -> Result<PullRequest, HostError>;
    async fn ci_status(&self, sha: &str) -> Result<CiStatus, HostError>;
    async fn avatar_url(&self, email: &str) -> Result<Option<String>, HostError>;
    fn web_url(&self, target: Target) -> Result<String, HostError>;
    async fn search_reviewers(&self, q: &str) -> Result<Vec<Reviewer>, HostError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ci_status_aggregation() {
        let empty = CiStatus::new(vec![]);
        assert_eq!(empty.state, CiState::None);

        let all_success = CiStatus::new(vec![
            Check {
                name: "test".into(),
                state: CiState::Success,
                url: None,
            },
            Check {
                name: "lint".into(),
                state: CiState::Success,
                url: None,
            },
        ]);
        assert_eq!(all_success.state, CiState::Success);

        let with_pending = CiStatus::new(vec![
            Check {
                name: "test".into(),
                state: CiState::Success,
                url: None,
            },
            Check {
                name: "build".into(),
                state: CiState::Pending,
                url: None,
            },
        ]);
        assert_eq!(with_pending.state, CiState::Pending);

        let with_failure = CiStatus::new(vec![
            Check {
                name: "test".into(),
                state: CiState::Success,
                url: None,
            },
            Check {
                name: "build".into(),
                state: CiState::Pending,
                url: None,
            },
            Check {
                name: "security".into(),
                state: CiState::Failure,
                url: None,
            },
        ]);
        assert_eq!(with_failure.state, CiState::Failure);
    }
}
