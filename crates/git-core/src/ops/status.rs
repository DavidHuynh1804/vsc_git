use crate::cli::{CommandOptions, GitCli};
use crate::error::GitError;
use crate::parse::{parse_status_v2, RepoStatus};
use std::path::Path;

/// Query status of the repository at `repo_path` using `git status --porcelain=v2 -z --branch`.
pub fn status(cli: &GitCli, repo_path: &Path) -> Result<RepoStatus, GitError> {
    let out = cli.exec(
        repo_path,
        &["status", "--porcelain=v2", "-z", "--branch"],
        CommandOptions::read_only(),
    )?;
    parse_status_v2(&out.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn init_temp_repo() -> tempfile::TempDir {
        let dir = tempdir().unwrap();
        let cli = GitCli::default();
        cli.exec(dir.path(), &["init"], CommandOptions::default())
            .unwrap();
        cli.exec(
            dir.path(),
            &["config", "user.email", "test@test.com"],
            CommandOptions::default(),
        )
        .unwrap();
        cli.exec(
            dir.path(),
            &["config", "user.name", "Tester"],
            CommandOptions::default(),
        )
        .unwrap();
        dir
    }

    #[test]
    fn test_status_new_repo() {
        let dir = init_temp_repo();
        let cli = GitCli::default();
        let st = status(&cli, dir.path()).unwrap();
        assert!(st.branch.is_initial);
        assert!(st.entries.is_empty());
    }
}
