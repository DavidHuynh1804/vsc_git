use crate::cli::{CommandOptions, GitCli};
use crate::error::GitError;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// The distinct versions of a file involved in a merge conflict.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConflictVersions {
    pub base: Option<Vec<u8>>,
    pub ours: Option<Vec<u8>>,
    pub theirs: Option<Vec<u8>>,
    pub worktree: Option<Vec<u8>>,
}

/// The nature of a merge conflict for a given file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ConflictKind {
    BothModified,
    DeletedByUs,
    DeletedByThem,
    BothAdded,
    RenameConflict,
    BothDeleted,
    Unknown,
}

impl ConflictVersions {
    /// Determines the conflict kind based on present index stages.
    pub fn conflict_kind(&self) -> ConflictKind {
        match (
            self.base.is_some(),
            self.ours.is_some(),
            self.theirs.is_some(),
        ) {
            (true, true, true) => ConflictKind::BothModified,
            (true, false, true) => ConflictKind::DeletedByUs,
            (true, true, false) => ConflictKind::DeletedByThem,
            (false, true, true) => ConflictKind::BothAdded,
            (true, false, false) => ConflictKind::RenameConflict,
            (false, true, false) => ConflictKind::RenameConflict,
            (false, false, true) => ConflictKind::RenameConflict,
            (false, false, false) => ConflictKind::Unknown,
        }
    }
}

/// Resolution choice when resolving a conflict automatically.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Resolution {
    Ours,
    Theirs,
    Delete,
}

/// Reads the different conflict versions (`base`, `ours`, `theirs`, `worktree`) for a path.
pub fn conflict_versions<P: AsRef<Path>>(
    cli: &GitCli,
    repo_path: &Path,
    path: P,
) -> Result<ConflictVersions, GitError> {
    let path_str = path.as_ref().to_string_lossy().replace('\\', "/");
    let out = cli.exec(
        repo_path,
        &["ls-files", "-u", "-z", "--", &path_str],
        CommandOptions::read_only(),
    )?;

    let mut has_stage1 = false;
    let mut has_stage2 = false;
    let mut has_stage3 = false;

    let stdout = out.stdout_lossy();
    for entry in stdout.split('\0') {
        let entry = entry.trim();
        if entry.is_empty() {
            continue;
        }
        if let Some((meta, _entry_path)) = entry.split_once('\t') {
            let parts: Vec<&str> = meta.split_whitespace().collect();
            if parts.len() >= 3 {
                match parts[2] {
                    "1" => has_stage1 = true,
                    "2" => has_stage2 = true,
                    "3" => has_stage3 = true,
                    _ => {}
                }
            }
        }
    }

    let base = if has_stage1 {
        let res = cli.exec(
            repo_path,
            &["show", &format!(":1:{path_str}")],
            CommandOptions::read_only(),
        )?;
        Some(res.stdout)
    } else {
        None
    };

    let ours = if has_stage2 {
        let res = cli.exec(
            repo_path,
            &["show", &format!(":2:{path_str}")],
            CommandOptions::read_only(),
        )?;
        Some(res.stdout)
    } else {
        None
    };

    let theirs = if has_stage3 {
        let res = cli.exec(
            repo_path,
            &["show", &format!(":3:{path_str}")],
            CommandOptions::read_only(),
        )?;
        Some(res.stdout)
    } else {
        None
    };

    let full_path = repo_path.join(path.as_ref());
    let worktree = std::fs::read(&full_path).ok();

    Ok(ConflictVersions {
        base,
        ours,
        theirs,
        worktree,
    })
}

/// Identifies the kind of conflict for a given file.
pub fn conflict_kind<P: AsRef<Path>>(
    cli: &GitCli,
    repo_path: &Path,
    path: P,
) -> Result<ConflictKind, GitError> {
    let versions = conflict_versions(cli, repo_path, path)?;
    Ok(versions.conflict_kind())
}

/// Resolves a conflicted file by accepting ours, theirs, or deleting it.
pub fn resolve_with<P: AsRef<Path>>(
    cli: &GitCli,
    repo_path: &Path,
    path: P,
    resolution: Resolution,
) -> Result<(), GitError> {
    let path_str = path.as_ref().to_string_lossy().replace('\\', "/");
    let versions = conflict_versions(cli, repo_path, &path)?;

    match resolution {
        Resolution::Ours => {
            if versions.ours.is_some() {
                cli.exec(
                    repo_path,
                    &["checkout", "--ours", "--", &path_str],
                    CommandOptions::default(),
                )?;
                cli.exec(
                    repo_path,
                    &["add", "--", &path_str],
                    CommandOptions::default(),
                )?;
            } else {
                let full_path = repo_path.join(path.as_ref());
                if full_path.exists() {
                    let _ = std::fs::remove_file(&full_path);
                }
                cli.exec(
                    repo_path,
                    &["rm", "-f", "--", &path_str],
                    CommandOptions::default(),
                )?;
            }
        }
        Resolution::Theirs => {
            if versions.theirs.is_some() {
                cli.exec(
                    repo_path,
                    &["checkout", "--theirs", "--", &path_str],
                    CommandOptions::default(),
                )?;
                cli.exec(
                    repo_path,
                    &["add", "--", &path_str],
                    CommandOptions::default(),
                )?;
            } else {
                let full_path = repo_path.join(path.as_ref());
                if full_path.exists() {
                    let _ = std::fs::remove_file(&full_path);
                }
                cli.exec(
                    repo_path,
                    &["rm", "-f", "--", &path_str],
                    CommandOptions::default(),
                )?;
            }
        }
        Resolution::Delete => {
            let full_path = repo_path.join(path.as_ref());
            if full_path.exists() {
                let _ = std::fs::remove_file(&full_path);
            }
            let _ = cli.exec(
                repo_path,
                &["rm", "-f", "--", &path_str],
                CommandOptions::default(),
            );
        }
    }

    Ok(())
}

/// Marks a conflict as resolved by writing new file content and staging it with `git add`.
pub fn mark_resolved<P: AsRef<Path>>(
    cli: &GitCli,
    repo_path: &Path,
    path: P,
    content: &[u8],
) -> Result<(), GitError> {
    let full_path = repo_path.join(path.as_ref());
    if let Some(parent) = full_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| GitError::internal(e.to_string()))?;
    }
    std::fs::write(&full_path, content).map_err(|e| GitError::internal(e.to_string()))?;
    let path_str = path.as_ref().to_string_lossy().replace('\\', "/");
    cli.exec(
        repo_path,
        &["add", "--", &path_str],
        CommandOptions::default(),
    )?;
    Ok(())
}

/// Counts the number of conflict marker blocks (lines starting with `<<<<<<<`) in raw content.
pub fn count_markers(bytes: &[u8]) -> usize {
    bytes
        .split(|&b| b == b'\n')
        .filter(|line| {
            let line = if line.ends_with(b"\r") {
                &line[..line.len() - 1]
            } else {
                line
            };
            line.starts_with(b"<<<<<<<")
        })
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn run_git(dir: &Path, args: &[&str]) {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .expect("git command failed");
        assert!(
            output.status.success(),
            "git {:?} failed: {:?}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn test_count_markers() {
        let text = b"start\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\nmiddle\n<<<<<<< HEAD\nours2\n=======\ntheirs2\n>>>>>>> other\n";
        assert_eq!(count_markers(text), 2);

        let clean = b"no markers here\n";
        assert_eq!(count_markers(clean), 0);
    }

    #[test]
    fn test_conflict_both_modified_and_resolve() {
        let dir = tempdir().unwrap();
        let path = dir.path();
        run_git(path, &["init"]);
        run_git(path, &["config", "user.name", "Conflict Tester"]);
        run_git(path, &["config", "user.email", "conflict@example.com"]);

        let file = path.join("conflict.txt");
        fs::write(&file, "base line\n").unwrap();
        run_git(path, &["add", "."]);
        run_git(path, &["commit", "-m", "base"]);
        run_git(path, &["branch", "feature"]);

        fs::write(&file, "ours line\n").unwrap();
        run_git(path, &["commit", "-am", "ours"]);

        run_git(path, &["checkout", "feature"]);
        fs::write(&file, "theirs line\n").unwrap();
        run_git(path, &["commit", "-am", "theirs"]);

        run_git(path, &["checkout", "main"]);
        let _ = std::process::Command::new("git")
            .args(["merge", "feature"])
            .current_dir(path)
            .output();

        let cli = GitCli::new("git");
        let versions = conflict_versions(&cli, path, "conflict.txt").unwrap();
        assert_eq!(versions.base.as_deref(), Some(b"base line\n".as_slice()));
        assert_eq!(versions.ours.as_deref(), Some(b"ours line\n".as_slice()));
        assert_eq!(
            versions.theirs.as_deref(),
            Some(b"theirs line\n".as_slice())
        );
        assert!(versions.worktree.is_some());

        let kind = conflict_kind(&cli, path, "conflict.txt").unwrap();
        assert_eq!(kind, ConflictKind::BothModified);

        // Resolve with Ours
        resolve_with(&cli, path, "conflict.txt", Resolution::Ours).unwrap();
        let content = fs::read(&file).unwrap();
        assert_eq!(content, b"ours line\n");

        // Mark resolved manually
        mark_resolved(&cli, path, "conflict.txt", b"custom resolution\n").unwrap();
        let resolved_content = fs::read(&file).unwrap();
        assert_eq!(resolved_content, b"custom resolution\n");
    }

    #[test]
    fn test_conflict_delete_modify() {
        let dir = tempdir().unwrap();
        let path = dir.path();
        run_git(path, &["init"]);
        run_git(path, &["config", "user.name", "Conflict Tester"]);
        run_git(path, &["config", "user.email", "conflict@example.com"]);

        let file = path.join("del_mod.txt");
        fs::write(&file, "base line\n").unwrap();
        run_git(path, &["add", "."]);
        run_git(path, &["commit", "-m", "base"]);
        run_git(path, &["branch", "del_branch"]);

        // On main: delete
        run_git(path, &["rm", "del_mod.txt"]);
        run_git(path, &["commit", "-m", "delete on main"]);

        // On branch: modify
        run_git(path, &["checkout", "del_branch"]);
        fs::write(&file, "modified on branch\n").unwrap();
        run_git(path, &["commit", "-am", "modify on branch"]);

        // Merge del_branch into main
        run_git(path, &["checkout", "main"]);
        let _ = std::process::Command::new("git")
            .args(["merge", "del_branch"])
            .current_dir(path)
            .output();

        let cli = GitCli::new("git");
        let versions = conflict_versions(&cli, path, "del_mod.txt").unwrap();
        assert_eq!(versions.base.as_deref(), Some(b"base line\n".as_slice()));
        assert_eq!(versions.ours, None);
        assert_eq!(
            versions.theirs.as_deref(),
            Some(b"modified on branch\n".as_slice())
        );

        let kind = conflict_kind(&cli, path, "del_mod.txt").unwrap();
        assert_eq!(kind, ConflictKind::DeletedByUs);

        // Resolve with Delete
        resolve_with(&cli, path, "del_mod.txt", Resolution::Delete).unwrap();
        assert!(!file.exists());
    }
}
