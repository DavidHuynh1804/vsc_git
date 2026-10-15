use thiserror::Error;

#[derive(Debug, Error)]
pub enum ReadError {
    #[error("Git error: {0}")]
    Git(#[from] git_core::GitError),
    #[error("Gix error: {0}")]
    Gix(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Invalid reference: {0}")]
    InvalidRef(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}
