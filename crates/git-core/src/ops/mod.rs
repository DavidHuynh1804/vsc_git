pub mod branch;
pub mod commit;
pub mod stage;
pub mod status;

pub use branch::{
    checkout, checkout_detached, create_branch, create_tag, delete_branch, delete_tag, list_refs,
    rename_branch, set_upstream, RefInfo, RefKind,
};
pub use commit::{commit, last_commit_message, CommitOptions};
pub use stage::{discard, discard_all, repo_has_commits, stage, stage_all, unstage, unstage_all};
pub use status::status;
