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
    blame, checkout, checkout_detached, commit, create_branch, create_tag, delete_branch,
    delete_tag, discard, discard_all, fetch, file_content, file_history, last_commit_message,
    list_refs, op_abort, op_continue, op_skip, operation_state, parse_file_history,
    parse_progress_line, parse_progress_stream, pull, push, rename_branch, repo_has_commits,
    set_upstream, stage, stage_all, stash_apply, stash_drop, stash_list, stash_pop, stash_push,
    stash_show, status, unified_diff, unstage, unstage_all, BlameOptions, CommitOptions,
    FetchTarget, FileHistoryEntry, FileRev, OperationKind, OperationState, Progress,
    ProgressCallback, PullMode, PushOptions, RefInfo, RefKind, StashEntry, StashPushOptions,
};
pub use parse::{
    parse_blame, parse_status_v2, BlameCommit, BlameLine, BranchInfo, FileStatus, RepoStatus,
    StatusEntry, StatusEntryKind, SubmoduleState,
};
pub use patch::{apply_ranges, build_range_patch, hunk_selections, ApplyMode, LineSelection, Side};

/// Inclusive line range (1-based index) in file coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct LineRange {
    pub start: u32,
    pub end: u32,
}

impl LineRange {
    pub fn new(start: u32, end: u32) -> Self {
        Self { start, end }
    }

    pub fn on_side(self, side: Side) -> LineSelection {
        LineSelection::new(side, self.start, self.end)
    }
}
