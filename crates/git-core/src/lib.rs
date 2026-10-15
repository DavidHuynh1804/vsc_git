pub mod cli;
pub mod error;
pub mod parse;

pub use cli::{
    CancelToken, CommandObserver, CommandOptions, GitCli, GitCommandRecord, GitOutput, GitVersion,
};
pub use error::{ErrorKind, GitError};
pub use parse::{
    parse_status_v2, BranchInfo, FileStatus, RepoStatus, StatusEntry, StatusEntryKind,
    SubmoduleState,
};
