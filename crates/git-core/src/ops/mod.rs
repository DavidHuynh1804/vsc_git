pub mod commit;
pub mod stage;
pub mod status;

pub use commit::{commit, last_commit_message, CommitOptions};
pub use stage::{discard, discard_all, repo_has_commits, stage, stage_all, unstage, unstage_all};
pub use status::status;
