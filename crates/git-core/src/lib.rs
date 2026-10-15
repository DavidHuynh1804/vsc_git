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
    checkout, checkout_detached, commit, create_branch, create_tag, delete_branch, delete_tag,
    discard, discard_all, last_commit_message, list_refs, rename_branch, repo_has_commits,
    set_upstream, stage, stage_all, stash_apply, stash_drop, stash_list, stash_pop, stash_push,
    stash_show, status, unstage, unstage_all, CommitOptions, RefInfo, RefKind, StashEntry,
    StashPushOptions,
};
pub use parse::{
    parse_status_v2, BranchInfo, FileStatus, RepoStatus, StatusEntry, StatusEntryKind,
    SubmoduleState,
};
pub use patch::{
    apply_ranges, build_range_patch, hunk_selections, ApplyMode, LineRange, LineSelection, Side,
};
