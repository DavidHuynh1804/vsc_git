use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
pub struct Hint {
    pub action: String,
    pub label: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
pub enum ErrorKind {
    NotARepo,
    GitMissing,
    GitTooOld,
    IndexLocked,
    Conflict,
    DirtyWorktree,
    AuthFailed,
    NonFastForward,
    HookFailed,
    NothingToCommit,
    Network,
    PatchFailed,
    HostApi,
    AiProvider,
    Cancelled,
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, thiserror::Error, PartialEq, Eq)]
#[error("{message}")]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
    pub git_stderr: Option<String>,
    pub hint: Option<Hint>,
}

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            git_stderr: None,
            hint: None,
        }
    }

    pub fn with_stderr(mut self, stderr: impl Into<String>) -> Self {
        let s = stderr.into();
        if !s.trim().is_empty() {
            self.git_stderr = Some(s);
        }
        self
    }

    pub fn with_hint(mut self, action: impl Into<String>, label: impl Into<String>) -> Self {
        self.hint = Some(Hint {
            action: action.into(),
            label: label.into(),
        });
        self
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Internal, message)
    }

    pub fn not_a_repo(path: impl Into<String>) -> Self {
        Self::new(
            ErrorKind::NotARepo,
            format!("The directory '{}' is not a git repository", path.into()),
        )
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        Self::internal(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        Self::internal(format!("JSON error: {err}"))
    }
}

impl From<git_core::GitError> for AppError {
    fn from(err: git_core::GitError) -> Self {
        let kind = match err.kind {
            git_core::ErrorKind::NotARepo => ErrorKind::NotARepo,
            git_core::ErrorKind::GitMissing => ErrorKind::GitMissing,
            git_core::ErrorKind::GitTooOld => ErrorKind::GitTooOld,
            git_core::ErrorKind::IndexLocked => ErrorKind::IndexLocked,
            git_core::ErrorKind::Conflict => ErrorKind::Conflict,
            git_core::ErrorKind::DirtyWorktree => ErrorKind::DirtyWorktree,
            git_core::ErrorKind::AuthFailed => ErrorKind::AuthFailed,
            git_core::ErrorKind::NonFastForward => ErrorKind::NonFastForward,
            git_core::ErrorKind::HookFailed => ErrorKind::HookFailed,
            git_core::ErrorKind::NothingToCommit => ErrorKind::NothingToCommit,
            git_core::ErrorKind::Network => ErrorKind::Network,
            git_core::ErrorKind::PatchFailed => ErrorKind::PatchFailed,
            git_core::ErrorKind::Cancelled => ErrorKind::Cancelled,
            git_core::ErrorKind::Internal => ErrorKind::Internal,
        };
        let mut app_err = AppError::new(kind, err.message);
        if let Some(stderr) = err.git_stderr {
            app_err = app_err.with_stderr(stderr);
        }
        if let Some(hint_str) = err
            .hint
            .or_else(|| git_core::error::default_hint(err.kind).map(|s| s.to_string()))
        {
            app_err = app_err.with_hint(hint_str.clone(), hint_str);
        }
        app_err
    }
}

impl From<git_read::ReadError> for AppError {
    fn from(err: git_read::ReadError) -> Self {
        match err {
            git_read::ReadError::Git(e) => e.into(),
            git_read::ReadError::Io(e) => e.into(),
            git_read::ReadError::NotFound(msg) => AppError::internal(format!("Not found: {msg}")),
            git_read::ReadError::InvalidRef(msg) => {
                AppError::internal(format!("Invalid ref: {msg}"))
            }
            git_read::ReadError::Gix(msg) => AppError::internal(format!("Git read error: {msg}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_construction() {
        let err = AppError::new(ErrorKind::NotARepo, "Not a repo")
            .with_stderr("fatal: not a git repo")
            .with_hint("open_folder", "Open Folder");

        assert_eq!(err.kind, ErrorKind::NotARepo);
        assert_eq!(err.git_stderr.as_deref(), Some("fatal: not a git repo"));
        assert_eq!(err.hint.unwrap().action, "open_folder");
    }
}
