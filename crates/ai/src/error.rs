use serde::{Deserialize, Serialize};

/// Categorized AI operation error kinds matching specification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AiErrorKind {
    Auth,
    RateLimited,
    Network,
    BadResponse,
    Cancelled,
    Disabled,
    Internal,
}

/// AI operation error with error kind and sanitized message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[error("{kind:?}: {message}")]
pub struct AiError {
    pub kind: AiErrorKind,
    pub message: String,
}

impl AiError {
    pub fn new(kind: AiErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(AiErrorKind::Auth, msg)
    }

    pub fn rate_limited(msg: impl Into<String>) -> Self {
        Self::new(AiErrorKind::RateLimited, msg)
    }

    pub fn network(msg: impl Into<String>) -> Self {
        Self::new(AiErrorKind::Network, msg)
    }

    pub fn bad_response(msg: impl Into<String>) -> Self {
        Self::new(AiErrorKind::BadResponse, msg)
    }

    pub fn cancelled() -> Self {
        Self::new(AiErrorKind::Cancelled, "operation cancelled")
    }

    pub fn disabled(msg: impl Into<String>) -> Self {
        Self::new(AiErrorKind::Disabled, msg)
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self::new(AiErrorKind::Internal, msg)
    }
}
