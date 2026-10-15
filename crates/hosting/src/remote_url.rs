use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HostKind {
    GitHub,
    GitLab,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostConfig {
    pub host: String,
    pub kind: HostKind,
    pub api_base_url: String,
}

impl HostConfig {
    pub fn default_hosts() -> Vec<Self> {
        vec![
            HostConfig {
                host: "github.com".to_string(),
                kind: HostKind::GitHub,
                api_base_url: "https://api.github.com".to_string(),
            },
            HostConfig {
                host: "gitlab.com".to_string(),
                kind: HostKind::GitLab,
                api_base_url: "https://gitlab.com/api/v4".to_string(),
            },
        ]
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RemoteUrlError {
    #[error("remote URL is empty")]
    Empty,
    #[error("invalid remote URL format: {0}")]
    InvalidFormat(String),
    #[error("missing host in remote URL: {0}")]
    MissingHost(String),
    #[error("missing repository name in remote URL: {0}")]
    MissingRepo(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRef {
    pub host: String,
    pub namespace: String,
    pub repo: String,
}

impl RemoteRef {
    pub fn parse(raw_url: &str) -> Result<Self, RemoteUrlError> {
        let trimmed = raw_url.trim();
        if trimmed.is_empty() {
            return Err(RemoteUrlError::Empty);
        }

        let (host, path) = if let Some((_scheme, rest)) = trimmed.split_once("://") {
            let (auth, path) = rest.split_once('/').unwrap_or((rest, ""));
            let host_port = if let Some((_user, hp)) = auth.rsplit_once('@') {
                hp
            } else {
                auth
            };
            let host = if host_port.starts_with('[') && host_port.contains(']') {
                let end = host_port.find(']').unwrap();
                &host_port[1..end]
            } else if let Some((h, _port)) = host_port.split_once(':') {
                h
            } else {
                host_port
            };
            let host = host.trim().to_ascii_lowercase();
            if host.is_empty() {
                return Err(RemoteUrlError::MissingHost(trimmed.to_string()));
            }
            (host, path.to_string())
        } else if let Some((left, right)) = trimmed.split_once(':') {
            let host_part = if let Some((_user, h)) = left.rsplit_once('@') {
                h
            } else {
                left
            };
            let host = host_part.trim().to_ascii_lowercase();
            if host.is_empty() {
                return Err(RemoteUrlError::MissingHost(trimmed.to_string()));
            }
            (host, right.to_string())
        } else {
            return Err(RemoteUrlError::InvalidFormat(trimmed.to_string()));
        };

        let path = path.trim();
        let path = path.trim_start_matches('/');
        let path = path.trim_end_matches('/');
        let path = path.strip_suffix(".git").unwrap_or(path);
        let path = path.trim_end_matches('/');

        let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        if segments.is_empty() {
            return Err(RemoteUrlError::MissingRepo(trimmed.to_string()));
        }

        let repo = segments.last().unwrap().to_string();
        let namespace = if segments.len() > 1 {
            segments[..segments.len() - 1].join("/")
        } else {
            String::new()
        };

        Ok(RemoteRef {
            host,
            namespace,
            repo,
        })
    }

    pub fn full_path(&self) -> String {
        if self.namespace.is_empty() {
            self.repo.clone()
        } else {
            format!("{}/{}", self.namespace, self.repo)
        }
    }

    pub fn gitlab_project_id(&self) -> String {
        self.full_path().replace('/', "%2F")
    }

    pub fn match_host<'a>(&self, configs: &'a [HostConfig]) -> Option<&'a HostConfig> {
        configs
            .iter()
            .find(|cfg| cfg.host.eq_ignore_ascii_case(&self.host))
    }

    pub fn resolve_host_config(&self, custom_configs: &[HostConfig]) -> Option<HostConfig> {
        if let Some(cfg) = self.match_host(custom_configs) {
            return Some(cfg.clone());
        }
        self.match_host(&HostConfig::default_hosts()).cloned()
    }
}

impl FromStr for RemoteRef {
    type Err = RemoteUrlError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::parse(s)
    }
}

impl fmt::Display for RemoteRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.namespace.is_empty() {
            write!(f, "{}:{}", self.host, self.repo)
        } else {
            write!(f, "{}:{}/{}", self.host, self.namespace, self.repo)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_table() {
        let cases = vec![
            (
                "git@github.com:owner/repo.git",
                RemoteRef {
                    host: "github.com".into(),
                    namespace: "owner".into(),
                    repo: "repo".into(),
                },
            ),
            (
                "git@github.com:owner/repo",
                RemoteRef {
                    host: "github.com".into(),
                    namespace: "owner".into(),
                    repo: "repo".into(),
                },
            ),
            (
                "git@gitlab.com:group/subgroup/deep/repo.git",
                RemoteRef {
                    host: "gitlab.com".into(),
                    namespace: "group/subgroup/deep".into(),
                    repo: "repo".into(),
                },
            ),
            (
                "ssh://git@host:port/group/sub/repo.git",
                RemoteRef {
                    host: "host".into(),
                    namespace: "group/sub".into(),
                    repo: "repo".into(),
                },
            ),
            (
                "ssh://git@host:2222/group/sub/repo.git",
                RemoteRef {
                    host: "host".into(),
                    namespace: "group/sub".into(),
                    repo: "repo".into(),
                },
            ),
            (
                "ssh://user:secret@gitlab.example.com/team/repo.git",
                RemoteRef {
                    host: "gitlab.example.com".into(),
                    namespace: "team".into(),
                    repo: "repo".into(),
                },
            ),
            (
                "https://github.com/owner/repo.git",
                RemoteRef {
                    host: "github.com".into(),
                    namespace: "owner".into(),
                    repo: "repo".into(),
                },
            ),
            (
                "https://github.com/owner/repo",
                RemoteRef {
                    host: "github.com".into(),
                    namespace: "owner".into(),
                    repo: "repo".into(),
                },
            ),
            (
                "https://github.com/owner/repo/",
                RemoteRef {
                    host: "github.com".into(),
                    namespace: "owner".into(),
                    repo: "repo".into(),
                },
            ),
            (
                "https://oauth2:ghp_secrettoken123@github.com/owner/repo.git",
                RemoteRef {
                    host: "github.com".into(),
                    namespace: "owner".into(),
                    repo: "repo".into(),
                },
            ),
            (
                "https://user:token@gitlab.com/sub/repo.git",
                RemoteRef {
                    host: "gitlab.com".into(),
                    namespace: "sub".into(),
                    repo: "repo".into(),
                },
            ),
            (
                "git://github.com/owner/repo.git",
                RemoteRef {
                    host: "github.com".into(),
                    namespace: "owner".into(),
                    repo: "repo".into(),
                },
            ),
        ];

        for (url, expected) in cases {
            let parsed = RemoteRef::parse(url).unwrap_or_else(|e| panic!("failed on {url}: {e}"));
            assert_eq!(parsed, expected, "mismatch for {url}");
        }
    }

    #[test]
    fn test_host_config_mapping() {
        let _defaults = HostConfig::default_hosts();
        let gh_ref = RemoteRef::parse("https://github.com/owner/repo").unwrap();
        let gh_cfg = gh_ref.resolve_host_config(&[]).unwrap();
        assert_eq!(gh_cfg.kind, HostKind::GitHub);
        assert_eq!(gh_cfg.api_base_url, "https://api.github.com");

        let gl_ref = RemoteRef::parse("git@gitlab.com:group/sub/repo.git").unwrap();
        let gl_cfg = gl_ref.resolve_host_config(&[]).unwrap();
        assert_eq!(gl_cfg.kind, HostKind::GitLab);
        assert_eq!(gl_cfg.api_base_url, "https://gitlab.com/api/v4");

        let custom = vec![
            HostConfig {
                host: "git.myenterprise.com".into(),
                kind: HostKind::GitHub,
                api_base_url: "https://git.myenterprise.com/api/v3".into(),
            },
            HostConfig {
                host: "gitlab.internal.net".into(),
                kind: HostKind::GitLab,
                api_base_url: "https://gitlab.internal.net/api/v4".into(),
            },
        ];

        let ent_ref = RemoteRef::parse("https://git.myenterprise.com/org/service.git").unwrap();
        let ent_cfg = ent_ref.resolve_host_config(&custom).unwrap();
        assert_eq!(ent_cfg.kind, HostKind::GitHub);
        assert_eq!(ent_cfg.api_base_url, "https://git.myenterprise.com/api/v3");

        let unknown_ref = RemoteRef::parse("https://unknown.host/repo.git").unwrap();
        assert!(unknown_ref.resolve_host_config(&custom).is_none());
    }

    #[test]
    fn test_gitlab_project_id() {
        let r = RemoteRef::parse("git@gitlab.com:my-group/nested/my-repo.git").unwrap();
        assert_eq!(r.gitlab_project_id(), "my-group%2Fnested%2Fmy-repo");
    }

    #[test]
    fn test_parse_errors() {
        assert_eq!(RemoteRef::parse(""), Err(RemoteUrlError::Empty));
        assert_eq!(RemoteRef::parse("   "), Err(RemoteUrlError::Empty));
        assert!(matches!(
            RemoteRef::parse("https://"),
            Err(RemoteUrlError::MissingHost(_) | RemoteUrlError::InvalidFormat(_))
        ));
        assert!(matches!(
            RemoteRef::parse("not-a-valid-url"),
            Err(RemoteUrlError::InvalidFormat(_))
        ));
    }
}
