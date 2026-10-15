pub mod cli;
pub mod error;
pub mod ops;
pub mod parse;
pub mod patch;

pub use cli::{
    CancelToken, CommandObserver, CommandOptions, GitCli, GitCommandRecord, GitOutput, GitVersion,
};
pub use error::{ErrorKind, GitError};
pub use ops::{
    commit, discard, discard_all, last_commit_message, repo_has_commits, stage, stage_all, status,
    unstage, unstage_all, CommitOptions,
};
pub use parse::{
    parse_status_v2, BranchInfo, FileStatus, RepoStatus, StatusEntry, StatusEntryKind,
    SubmoduleState,
};
pub use patch::{
    apply_ranges, build_range_patch, hunk_selections, ApplyMode, LineRange, LineSelection, Side,
};
