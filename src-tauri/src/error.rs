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
