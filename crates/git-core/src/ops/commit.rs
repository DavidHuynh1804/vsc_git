use crate::cli::{CommandOptions, GitCli};
use crate::error::GitError;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::Path;
use tempfile::NamedTempFile;

/// Options for git commit operation matching specification section 4.2.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct CommitOptions {
    pub message: String,
    #[serde(default)]
    pub amend: bool,
    #[serde(default)]
    pub signoff: bool,
    #[serde(default)]
    pub no_verify: bool,
    #[serde(default)]
    pub all: bool,
}

impl CommitOptions {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            amend: false,
            signoff: false,
            no_verify: false,
            all: false,
        }
    }
}

/// Commit changes to repository via `git commit -F <tmpfile>`.
pub fn commit(cli: &GitCli, repo_path: &Path, options: CommitOptions) -> Result<(), GitError> {
    let mut tmp = NamedTempFile::new().map_err(|e| {
        GitError::internal(format!(
            "failed to create temporary commit message file: {e}"
        ))
    })?;
    tmp.write_all(options.message.as_bytes())
        .map_err(|e| GitError::internal(format!("failed to write commit message: {e}")))?;
    tmp.flush()
        .map_err(|e| GitError::internal(format!("failed to flush commit message: {e}")))?;

    let tmp_path = tmp.path().to_string_lossy().to_string();
    let mut args = vec!["commit", "-F", &tmp_path];
    if options.amend {
        args.push("--amend");
    }
    if options.signoff {
        args.push("--signoff");
    }
    if options.no_verify {
        args.push("--no-verify");
    }
    if options.all {
        args.push("--all");
    }

    cli.exec(repo_path, &args, CommandOptions::default())?;
    Ok(())
}

/// Retrieve the raw commit message of the current HEAD (`git log -1 --format=%B`).
pub fn last_commit_message(cli: &GitCli, repo_path: &Path) -> Result<String, GitError> {
    let out = cli.exec(
        repo_path,
        &["log", "-1", "--format=%B"],
        CommandOptions::read_only(),
    )?;
    Ok(out
        .stdout_lossy()
        .trim_end_matches(['\r', '\n'])
        .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ops::{stage, status};
    use tempfile::tempdir;

    #[test]
    fn test_commit_and_last_message() {
        let dir = tempdir().unwrap();
        let path = dir.path();
        let cli = GitCli::default();

        cli.exec(path, &["init"], CommandOptions::default())
            .unwrap();
        cli.exec(
            path,
            &["config", "core.autocrlf", "false"],
            CommandOptions::default(),
        )
        .unwrap();
        cli.exec(
            path,
            &["config", "user.email", "tester@test.com"],
            CommandOptions::default(),
        )
        .unwrap();
        cli.exec(
            path,
            &["config", "user.name", "Tester"],
            CommandOptions::default(),
        )
        .unwrap();

        std::fs::write(path.join("file.txt"), "hello\n").unwrap();
        stage(&cli, path, &[Path::new("file.txt")]).unwrap();

        commit(&cli, path, CommitOptions::new("first commit\n\nbody here")).unwrap();

        let msg = last_commit_message(&cli, path).unwrap();
        assert_eq!(msg, "first commit\n\nbody here");

        // Amend commit
        commit(
            &cli,
            path,
            CommitOptions {
                message: "amended commit".into(),
                amend: true,
                signoff: true,
                ..Default::default()
            },
        )
        .unwrap();

        let amended = last_commit_message(&cli, path).unwrap();
        assert!(amended.starts_with("amended commit"));
        assert!(amended.contains("Signed-off-by: Tester <tester@test.com>"));

        let st = status(&cli, path).unwrap();
        assert_eq!(st.staged().len(), 0);
    }
}
