use crate::cli::{CommandOptions, GitCli};
use crate::error::GitError;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Structured representation of a stash entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StashEntry {
    pub index: usize,
    pub name: String,
    pub commit_id: String,
    pub message: String,
    pub branch: Option<String>,
    pub date: String,
}

/// Options for `git stash push`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct StashPushOptions {
    pub message: Option<String>,
    #[serde(default)]
    pub include_untracked: bool,
    #[serde(default)]
    pub paths: Vec<PathBuf>,
}

impl StashPushOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_message(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }

    pub fn with_untracked(mut self, untracked: bool) -> Self {
        self.include_untracked = untracked;
        self
    }

    pub fn with_paths(mut self, paths: Vec<PathBuf>) -> Self {
        self.paths = paths;
        self
    }
}

/// List all stashes using `git stash list -z --format=...`.
pub fn stash_list(cli: &GitCli, repo_path: &Path) -> Result<Vec<StashEntry>, GitError> {
    let fmt = "--format=%gd%x00%H%x00%gs%x00%ci";
    let out = cli.exec(
        repo_path,
        &["stash", "list", "-z", fmt],
        CommandOptions::read_only(),
    )?;

    let stdout = out.stdout_lossy();
    if stdout.is_empty() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    let parts: Vec<&str> = stdout.split('\0').collect();
    for chunk in parts.as_chunks::<4>().0 {
        let name = chunk[0].to_string();
        let commit_id = chunk[1].to_string();
        let subject = chunk[2];
        let date = chunk[3].to_string();

        let index = name
            .strip_prefix("stash@{")
            .and_then(|s| s.strip_suffix('}'))
            .and_then(|s| s.parse().ok())
            .unwrap_or(entries.len());

        let (branch, message) = if let Some(rest) = subject.strip_prefix("On ") {
            if let Some((b, m)) = rest.split_once(": ") {
                (Some(b.to_string()), m.to_string())
            } else {
                (Some(rest.to_string()), String::new())
            }
        } else if let Some(rest) = subject.strip_prefix("WIP on ") {
            if let Some((b, m)) = rest.split_once(": ") {
                (Some(b.to_string()), m.to_string())
            } else {
                (Some(rest.to_string()), String::new())
            }
        } else {
            (None, subject.to_string())
        };

        entries.push(StashEntry {
            index,
            name,
            commit_id,
            message,
            branch,
            date,
        });
    }

    Ok(entries)
}

/// Push changes onto stash: `git stash push [-u] [-m <msg>] [-- <paths>]`.
pub fn stash_push(
    cli: &GitCli,
    repo_path: &Path,
    options: StashPushOptions,
) -> Result<(), GitError> {
    let mut args: Vec<String> = vec!["stash".into(), "push".into()];
    if options.include_untracked {
        args.push("-u".into());
    }
    if let Some(msg) = options.message {
        args.push("-m".into());
        args.push(msg);
    }
    if !options.paths.is_empty() {
        args.push("--".into());
        for p in options.paths {
            args.push(p.to_string_lossy().into_owned());
        }
    }

    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    cli.exec(repo_path, &arg_refs, CommandOptions::default())?;
    Ok(())
}

/// Apply a stash: `git stash apply [<stash_ref>]`.
pub fn stash_apply(
    cli: &GitCli,
    repo_path: &Path,
    stash_ref: Option<&str>,
) -> Result<(), GitError> {
    let mut args = vec!["stash", "apply"];
    if let Some(r) = stash_ref {
        args.push(r);
    }
    cli.exec(repo_path, &args, CommandOptions::default())?;
    Ok(())
}

/// Pop a stash: `git stash pop [<stash_ref>]`.
pub fn stash_pop(cli: &GitCli, repo_path: &Path, stash_ref: Option<&str>) -> Result<(), GitError> {
    let mut args = vec!["stash", "pop"];
    if let Some(r) = stash_ref {
        args.push(r);
    }
    cli.exec(repo_path, &args, CommandOptions::default())?;
    Ok(())
}

/// Drop a stash: `git stash drop [<stash_ref>]`.
pub fn stash_drop(cli: &GitCli, repo_path: &Path, stash_ref: Option<&str>) -> Result<(), GitError> {
    let mut args = vec!["stash", "drop"];
    if let Some(r) = stash_ref {
        args.push(r);
    }
    cli.exec(repo_path, &args, CommandOptions::default())?;
    Ok(())
}

/// Show patch for a stash: `git stash show -p [<stash_ref>]`.
pub fn stash_show(
    cli: &GitCli,
    repo_path: &Path,
    stash_ref: Option<&str>,
) -> Result<String, GitError> {
    let mut args = vec!["stash", "show", "-p"];
    if let Some(r) = stash_ref {
        args.push(r);
    }
    let out = cli.exec(repo_path, &args, CommandOptions::read_only())?;
    Ok(out.stdout_lossy())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ops::{commit, stage_all, CommitOptions};
    use tempfile::tempdir;

    #[test]
    fn test_stash_lifecycle() {
        let dir = tempdir().unwrap();
        let path = dir.path();
        let cli = GitCli::default();

        cli.exec(path, &["init", "-b", "main"], CommandOptions::default())
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

        std::fs::write(path.join("file.txt"), "committed\n").unwrap();
        stage_all(&cli, path).unwrap();
        commit(&cli, path, CommitOptions::new("initial")).unwrap();

        // Stash empty
        let list0 = stash_list(&cli, path).unwrap();
        assert!(list0.is_empty());

        // Modify file and add untracked file
        std::fs::write(path.join("file.txt"), "modified\n").unwrap();
        std::fs::write(path.join("untracked.txt"), "untracked\n").unwrap();

        // Stash push with untracked
        stash_push(
            &cli,
            path,
            StashPushOptions::new()
                .with_message("my work in progress")
                .with_untracked(true),
        )
        .unwrap();

        let list1 = stash_list(&cli, path).unwrap();
        assert_eq!(list1.len(), 1);
        assert_eq!(list1[0].message, "my work in progress");
        assert_eq!(list1[0].name, "stash@{0}");

        // Show stash patch
        let patch = stash_show(&cli, path, None).unwrap();
        assert!(patch.contains("-committed"));
        assert!(patch.contains("+modified"));

        // Pop stash
        stash_pop(&cli, path, None).unwrap();
        assert_eq!(
            std::fs::read_to_string(path.join("file.txt")).unwrap(),
            "modified\n"
        );
        assert_eq!(
            std::fs::read_to_string(path.join("untracked.txt")).unwrap(),
            "untracked\n"
        );

        let list2 = stash_list(&cli, path).unwrap();
        assert!(list2.is_empty());
    }
}
