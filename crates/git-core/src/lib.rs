pub mod cli;
pub mod error;
pub mod ops;
pub mod parse;

pub use cli::{
    CancelToken, CommandObserver, CommandOptions, GitCli, GitCommandRecord, GitOutput, GitVersion,
};
pub use error::{ErrorKind, GitError};
pub use ops::{
    discard, discard_all, repo_has_commits, stage, stage_all, status, unstage, unstage_all,
};
pub use parse::{
    parse_status_v2, BranchInfo, FileStatus, RepoStatus, StatusEntry, StatusEntryKind,
    SubmoduleState,
};
