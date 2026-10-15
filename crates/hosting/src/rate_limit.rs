use reqwest::header::HeaderMap;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HostErrorKind {
    Auth,
    NotFound,
    RateLimited,
    Network,
    Api,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitInfo {
    pub limit: Option<u64>,
    pub remaining: Option<u64>,
    pub reset_at: Option<u64>,
    pub retry_after: Option<u64>,
}

impl RateLimitInfo {
    pub fn from_headers(headers: &HeaderMap) -> Self {
        let limit = headers
            .get("X-RateLimit-Limit")
            .or_else(|| headers.get("RateLimit-Limit"))
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<u64>().ok());

        let remaining = headers
            .get("X-RateLimit-Remaining")
            .or_else(|| headers.get("RateLimit-Remaining"))
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<u64>().ok());

        let reset_at = headers
            .get("X-RateLimit-Reset")
            .or_else(|| headers.get("RateLimit-Reset"))
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<u64>().ok());

        let retry_after = headers
            .get("Retry-After")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<u64>().ok());

        RateLimitInfo {
            limit,
            remaining,
            reset_at,
            retry_after,
        }
    }

    pub fn is_depleted(&self) -> bool {
        self.remaining == Some(0) || self.retry_after.is_some()
    }

    pub fn suggested_poll_interval(&self, now_sec: u64, default_interval: Duration) -> Duration {
        let default_secs = default_interval.as_secs().max(1);

        if let Some(retry) = self.retry_after {
            return Duration::from_secs(retry.max(default_secs));
        }

        if let Some(remaining) = self.remaining {
            if remaining == 0 {
                if let Some(reset) = self.reset_at {
                    if reset > now_sec {
                        let wait = reset - now_sec;
                        return Duration::from_secs(wait.max(default_secs));
                    }
                }
                return Duration::from_secs(default_secs * 2);
            }

            if remaining < 10 {
                return Duration::from_secs(default_secs * 3);
            }

            if let Some(limit) = self.limit {
                if limit > 0 && (remaining as f64 / limit as f64) < 0.20 {
                    return Duration::from_secs(default_secs * 2);
                }
            }
        }

        default_interval
    }
}

pub fn sanitize_text(text: &str) -> String {
    let mut current = text.to_string();

    let prefixes = [
        "ghp_",
        "github_pat_",
        "gho_",
        "ghu_",
        "ghs_",
        "ghr_",
        "glpat-",
    ];
    for prefix in prefixes {
        let mut idx = 0;
        while idx < current.len() {
            if let Some(pos) = current[idx..].find(prefix) {
                let start = idx + pos;
                let after = &current[start + prefix.len()..];
                let end_offset = after
                    .find(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '-')
                    .unwrap_or(after.len());
                let end = start + prefix.len() + end_offset;
                current.replace_range(start..end, "[REDACTED]");
                idx = start + "[REDACTED]".len();
            } else {
                break;
            }
        }
    }

    let auth_headers = ["Bearer ", "token ", "PRIVATE-TOKEN: "];
    for auth in auth_headers {
        let mut idx = 0;
        let auth_lower = auth.to_ascii_lowercase();
        while idx < current.len() {
            if let Some(pos) = current[idx..].to_ascii_lowercase().find(&auth_lower) {
                let start = idx + pos;
                let val_start = start + auth.len();
                if current[val_start..].starts_with("[REDACTED]") {
                    idx = val_start + "[REDACTED]".len();
                    continue;
                }
                let after = &current[val_start..];
                let end_offset = after
                    .find(|c: char| {
                        c.is_whitespace() || c == ',' || c == ';' || c == '"' || c == '\''
                    })
                    .unwrap_or(after.len());
                let end = val_start + end_offset;
                current.replace_range(val_start..end, "[REDACTED]");
                idx = val_start + "[REDACTED]".len();
            } else {
                break;
            }
        }
    }

    let mut idx = 0;
    while idx < current.len() {
        if let Some(pos) = current[idx..].find("://") {
            let proto_pos = idx + pos;
            let rest = &current[proto_pos + 3..];
            let slash_pos = rest.find('/').unwrap_or(rest.len());
            let authority = &rest[..slash_pos];
            if authority.contains('@') {
                if let Some(at_pos) = authority.rfind('@') {
                    let userinfo = &authority[..at_pos];
                    if userinfo.contains(':') {
                        let abs_userinfo_start = proto_pos + 3;
                        let abs_at_pos = abs_userinfo_start + at_pos;
                        current.replace_range(abs_userinfo_start..abs_at_pos, "[REDACTED]");
                        idx = abs_userinfo_start + "[REDACTED]".len();
                        continue;
                    }
                }
            }
            idx = proto_pos + 3;
        } else {
            break;
        }
    }

    current
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, Serialize, Deserialize)]
#[error("{kind:?}: {message}")]
pub struct HostError {
    pub kind: HostErrorKind,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_limit: Option<RateLimitInfo>,
}

impl HostError {
    pub fn new(kind: HostErrorKind, message: impl Into<String>) -> Self {
        HostError {
            kind,
            message: sanitize_text(&message.into()),
            rate_limit: None,
        }
    }

    pub fn with_rate_limit(mut self, info: RateLimitInfo) -> Self {
        self.rate_limit = Some(info);
        self
    }

    pub fn auth(message: impl Into<String>) -> Self {
        Self::new(HostErrorKind::Auth, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(HostErrorKind::NotFound, message)
    }

    pub fn rate_limited(message: impl Into<String>, info: Option<RateLimitInfo>) -> Self {
        let mut err = Self::new(HostErrorKind::RateLimited, message);
        err.rate_limit = info;
        err
    }

    pub fn network(message: impl Into<String>) -> Self {
        Self::new(HostErrorKind::Network, message)
    }

    pub fn api(message: impl Into<String>) -> Self {
        Self::new(HostErrorKind::Api, message)
    }

    pub fn from_status_and_body(
        status: reqwest::StatusCode,
        body: &str,
        headers: &HeaderMap,
    ) -> Self {
        let rate_info = RateLimitInfo::from_headers(headers);
        let sanitized = sanitize_text(body);
        let msg = if sanitized.trim().is_empty() {
            format!("HTTP {status}")
        } else {
            format!("HTTP {status}: {sanitized}")
        };

        match status.as_u16() {
            401 => HostError::new(HostErrorKind::Auth, msg),
            403 => {
                if rate_info.is_depleted() || msg.to_ascii_lowercase().contains("rate limit") {
                    HostError::rate_limited(msg, Some(rate_info))
                } else {
                    HostError::new(HostErrorKind::Auth, msg)
                }
            }
            404 => HostError::new(HostErrorKind::NotFound, msg),
            429 => HostError::rate_limited(msg, Some(rate_info)),
            _ => HostError::new(HostErrorKind::Api, msg),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::HeaderValue;

    #[test]
    fn test_parse_github_ratelimit_headers() {
        let mut headers = HeaderMap::new();
        headers.insert("X-RateLimit-Limit", HeaderValue::from_static("5000"));
        headers.insert("X-RateLimit-Remaining", HeaderValue::from_static("4990"));
        headers.insert("X-RateLimit-Reset", HeaderValue::from_static("1700000000"));

        let info = RateLimitInfo::from_headers(&headers);
        assert_eq!(info.limit, Some(5000));
        assert_eq!(info.remaining, Some(4990));
        assert_eq!(info.reset_at, Some(1700000000));
        assert_eq!(info.retry_after, None);
        assert!(!info.is_depleted());
    }

    #[test]
    fn test_parse_gitlab_ratelimit_headers() {
        let mut headers = HeaderMap::new();
        headers.insert("RateLimit-Limit", HeaderValue::from_static("2000"));
        headers.insert("RateLimit-Remaining", HeaderValue::from_static("0"));
        headers.insert("RateLimit-Reset", HeaderValue::from_static("1700000100"));
        headers.insert("Retry-After", HeaderValue::from_static("60"));

        let info = RateLimitInfo::from_headers(&headers);
        assert_eq!(info.limit, Some(2000));
        assert_eq!(info.remaining, Some(0));
        assert_eq!(info.reset_at, Some(1700000100));
        assert_eq!(info.retry_after, Some(60));
        assert!(info.is_depleted());
    }

    #[test]
    fn test_poll_interval_backoff() {
        let default_poll = Duration::from_secs(60);

        let normal = RateLimitInfo {
            limit: Some(5000),
            remaining: Some(4500),
            reset_at: Some(1000),
            retry_after: None,
        };
        assert_eq!(
            normal.suggested_poll_interval(900, default_poll),
            Duration::from_secs(60)
        );

        let depleted_reset = RateLimitInfo {
            limit: Some(5000),
            remaining: Some(0),
            reset_at: Some(1120),
            retry_after: None,
        };
        assert_eq!(
            depleted_reset.suggested_poll_interval(1000, default_poll),
            Duration::from_secs(120)
        );

        let retry = RateLimitInfo {
            limit: Some(5000),
            remaining: Some(0),
            reset_at: None,
            retry_after: Some(180),
        };
        assert_eq!(
            retry.suggested_poll_interval(1000, default_poll),
            Duration::from_secs(180)
        );

        let low = RateLimitInfo {
            limit: Some(5000),
            remaining: Some(5),
            reset_at: Some(1500),
            retry_after: None,
        };
        assert_eq!(
            low.suggested_poll_interval(1000, default_poll),
            Duration::from_secs(180)
        );
    }

    #[test]
    fn test_sanitize_tokens() {
        let raw = "Error with ghp_99ABCDEF0123456789abcdef and glpat-xyz123456789_-foo";
        let clean = sanitize_text(raw);
        assert!(!clean.contains("ghp_"));
        assert!(!clean.contains("glpat-"));
        assert!(clean.contains("[REDACTED]"));

        let header_raw = "Failed Authorization: Bearer secret_token_value_abc in request";
        let clean_auth = sanitize_text(header_raw);
        assert!(!clean_auth.contains("secret_token_value_abc"));
        assert!(clean_auth.contains("[REDACTED]"));

        let url_raw = "Remote clone error https://oauth2:secret_pass_xyz@github.com/repo";
        let clean_url = sanitize_text(url_raw);
        assert!(!clean_url.contains("secret_pass_xyz"));
        assert!(clean_url.contains("[REDACTED]@github.com"));

        let err = HostError::api("Failed token ghp_secret1234567890");
        assert!(!err.message.contains("ghp_secret"));
        assert!(err.message.contains("[REDACTED]"));
    }

    #[test]
    fn test_from_status_and_body() {
        let mut headers = HeaderMap::new();
        headers.insert("X-RateLimit-Remaining", HeaderValue::from_static("0"));
        let err403 = HostError::from_status_and_body(
            reqwest::StatusCode::FORBIDDEN,
            "rate limit exceeded",
            &headers,
        );
        assert_eq!(err403.kind, HostErrorKind::RateLimited);
        assert!(err403.rate_limit.is_some());

        let err401 = HostError::from_status_and_body(
            reqwest::StatusCode::UNAUTHORIZED,
            "Bad credentials for ghp_mysecret",
            &HeaderMap::new(),
        );
        assert_eq!(err401.kind, HostErrorKind::Auth);
        assert!(!err401.message.contains("ghp_mysecret"));
        assert!(err401.message.contains("[REDACTED]"));

        let err404 = HostError::from_status_and_body(
            reqwest::StatusCode::NOT_FOUND,
            "Not Found",
            &HeaderMap::new(),
        );
        assert_eq!(err404.kind, HostErrorKind::NotFound);
    }
}
