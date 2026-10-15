use crate::cli::{CommandOptions, GitCli};
use crate::error::GitError;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Kinds of git operations that can be continued, skipped, or aborted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum OperationKind {
    Merge,
    Rebase,
    CherryPick,
    Revert,
}

/// The state of an in-progress git operation matching specification sections 4.2 and 7.1.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum OperationState {
    None,
    Merging {
        commit_id: Option<String>,
    },
    Rebasing {
        step: u32,
        total: u32,
        onto: Option<String>,
        branch: Option<String>,
    },
    CherryPicking {
        commit_id: Option<String>,
    },
    Reverting {
        commit_id: Option<String>,
    },
}

impl OperationState {
    pub fn kind(&self) -> Option<OperationKind> {
        match self {
            OperationState::Merging { .. } => Some(OperationKind::Merge),
            OperationState::Rebasing { .. } => Some(OperationKind::Rebase),
            OperationState::CherryPicking { .. } => Some(OperationKind::CherryPick),
            OperationState::Reverting { .. } => Some(OperationKind::Revert),
            OperationState::None => None,
        }
    }

    pub fn is_active(&self) -> bool {
        !matches!(self, OperationState::None)
    }
}

fn read_trimmed<P: AsRef<Path>>(path: P) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
}

/// Detect in-progress operations from `.git` paths via `git rev-parse --git-path`.
pub fn operation_state(cli: &GitCli, repo_path: &Path) -> Result<OperationState, GitError> {
    let out = cli.exec(
        repo_path,
        &[
            "rev-parse",
            "--git-path",
            "MERGE_HEAD",
            "--git-path",
            "rebase-merge",
            "--git-path",
            "rebase-apply",
            "--git-path",
            "CHERRY_PICK_HEAD",
            "--git-path",
            "REVERT_HEAD",
        ],
        CommandOptions::read_only(),
    )?;

    let stdout = out.stdout_lossy();
    let paths: Vec<PathBuf> = stdout
        .lines()
        .map(|l| {
            let p = Path::new(l.trim());
            if p.is_absolute() {
                p.to_path_buf()
            } else {
                repo_path.join(p)
            }
        })
        .collect();

    if paths.len() < 5 {
        return Ok(OperationState::None);
    }

    let merge_head = &paths[0];
    let rebase_merge = &paths[1];
    let rebase_apply = &paths[2];
    let cherry_pick_head = &paths[3];
    let revert_head = &paths[4];

    // 1. Rebasing
    if rebase_merge.is_dir() {
        let step = read_trimmed(rebase_merge.join("msgnum"))
            .and_then(|s| s.parse().ok())
            .unwrap_or(1);
        let total = read_trimmed(rebase_merge.join("end"))
            .and_then(|s| s.parse().ok())
            .unwrap_or(1);
        let onto = read_trimmed(rebase_merge.join("onto"));
        let branch = read_trimmed(rebase_merge.join("head-name"));
        return Ok(OperationState::Rebasing {
            step,
            total,
            onto,
            branch,
        });
    }

    if rebase_apply.is_dir() {
        let step = read_trimmed(rebase_apply.join("next"))
            .and_then(|s| s.parse().ok())
            .unwrap_or(1);
        let total = read_trimmed(rebase_apply.join("last"))
            .and_then(|s| s.parse().ok())
            .unwrap_or(1);
        let onto = read_trimmed(rebase_apply.join("onto"));
        let branch = read_trimmed(rebase_apply.join("head-name"));
        return Ok(OperationState::Rebasing {
            step,
            total,
            onto,
            branch,
        });
    }

    // 2. Merging
    if merge_head.is_file() {
        let commit_id = read_trimmed(merge_head);
        return Ok(OperationState::Merging { commit_id });
    }

    // 3. Cherry-Picking
    if cherry_pick_head.is_file() {
        let commit_id = read_trimmed(cherry_pick_head);
        return Ok(OperationState::CherryPicking { commit_id });
    }

    // 4. Reverting
    if revert_head.is_file() {
        let commit_id = read_trimmed(revert_head);
        return Ok(OperationState::Reverting { commit_id });
    }

    Ok(OperationState::None)
}

/// Continue the specified in-progress operation (with `GIT_EDITOR=true`).
pub fn op_continue(cli: &GitCli, repo_path: &Path, op: OperationKind) -> Result<(), GitError> {
    let subcmd = match op {
        OperationKind::Merge => "merge",
        OperationKind::Rebase => "rebase",
        OperationKind::CherryPick => "cherry-pick",
        OperationKind::Revert => "revert",
    };
    cli.exec(
        repo_path,
        &[subcmd, "--continue"],
        CommandOptions::default().with_env("GIT_EDITOR", "true"),
    )?;
    Ok(())
}

/// Skip the current commit in the specified operation.
pub fn op_skip(cli: &GitCli, repo_path: &Path, op: OperationKind) -> Result<(), GitError> {
    let subcmd = match op {
        OperationKind::Merge => "merge",
        OperationKind::Rebase => "rebase",
        OperationKind::CherryPick => "cherry-pick",
        OperationKind::Revert => "revert",
    };
    cli.exec(repo_path, &[subcmd, "--skip"], CommandOptions::default())?;
    Ok(())
}

/// Abort the specified in-progress operation and restore repository state.
pub fn op_abort(cli: &GitCli, repo_path: &Path, op: OperationKind) -> Result<(), GitError> {
    let subcmd = match op {
        OperationKind::Merge => "merge",
        OperationKind::Rebase => "rebase",
        OperationKind::CherryPick => "cherry-pick",
        OperationKind::Revert => "revert",
    };
    cli.exec(repo_path, &[subcmd, "--abort"], CommandOptions::default())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ops::{commit, stage_all, CommitOptions};
    use tempfile::tempdir;

    #[test]
    fn test_operation_state_none() {
        let dir = tempdir().unwrap();
        let path = dir.path();
        let cli = GitCli::default();

        cli.exec(path, &["init", "-b", "main"], CommandOptions::default())
            .unwrap();
        let st = operation_state(&cli, path).unwrap();
        assert_eq!(st, OperationState::None);
    }

    #[test]
    fn test_operation_state_merge_and_abort() {
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

        std::fs::write(path.join("file.txt"), "base\n").unwrap();
        stage_all(&cli, path).unwrap();
        commit(&cli, path, CommitOptions::new("base commit")).unwrap();

        // Branch feature
        cli.exec(
            path,
            &["switch", "-c", "feature"],
            CommandOptions::default(),
        )
        .unwrap();
        std::fs::write(path.join("file.txt"), "feature change\n").unwrap();
        stage_all(&cli, path).unwrap();
        commit(&cli, path, CommitOptions::new("feature commit")).unwrap();

        // Switch to main and make conflicting change
        cli.exec(path, &["switch", "main"], CommandOptions::default())
            .unwrap();
        std::fs::write(path.join("file.txt"), "main change\n").unwrap();
        stage_all(&cli, path).unwrap();
        commit(&cli, path, CommitOptions::new("main commit")).unwrap();

        // Merge feature into main (fails with conflict)
        let _ = cli.exec_raw(path, &["merge", "feature"], CommandOptions::default());

        let state = operation_state(&cli, path).unwrap();
        assert!(matches!(state, OperationState::Merging { .. }));
        assert_eq!(state.kind(), Some(OperationKind::Merge));

        // Abort merge
        op_abort(&cli, path, OperationKind::Merge).unwrap();
        let state_after = operation_state(&cli, path).unwrap();
        assert_eq!(state_after, OperationState::None);
    }
}
