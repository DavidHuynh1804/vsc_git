use crate::cli::{CommandOptions, GitCli};
use crate::error::GitError;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// A commit entry representing a change to a specific file in its history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileHistoryEntry {
    pub sha: String,
    pub parents: Vec<String>,
    pub author: String,
    pub time: i64,
    pub subject: String,
    pub path_at_commit: String,
    pub status: String,
}

/// Retrieve the commit history of a single file across renames.
pub fn file_history<P: AsRef<Path>>(
    cli: &GitCli,
    repo_path: &Path,
    path: P,
    skip: usize,
    limit: usize,
) -> Result<Vec<FileHistoryEntry>, GitError> {
    let mut args = vec![
        "log".to_string(),
        "--follow".to_string(),
        "-z".to_string(),
        "--format=%H%x00%P%x00%an%x00%at%x00%s".to_string(),
        "--name-status".to_string(),
    ];

    if skip > 0 {
        args.push(format!("--skip={skip}"));
    }
    if limit > 0 {
        args.push(format!("-n{limit}"));
    }

    args.push("--".to_string());
    args.push(path.as_ref().to_string_lossy().replace('\\', "/"));

    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = cli.exec(repo_path, &arg_refs, CommandOptions::read_only())?;
    Ok(parse_file_history(&out.stdout_lossy()))
}

/// Parses the output of `git log --follow -z --format=%H%x00%P%x00%an%x00%at%x00%s --name-status`.
pub fn parse_file_history(output: &str) -> Vec<FileHistoryEntry> {
    let tokens: Vec<&str> = output.split('\0').collect();
    let mut entries = Vec::new();
    let mut i = 0;

    while i < tokens.len() {
        let token = tokens[i].trim();
        if token.is_empty() {
            i += 1;
            continue;
        }

        if i + 6 > tokens.len() {
            break;
        }

        let sha = token.to_string();
        let parents = tokens[i + 1]
            .split_whitespace()
            .map(ToString::to_string)
            .collect();
        let author = tokens[i + 2].to_string();
        let time = tokens[i + 3].trim().parse::<i64>().unwrap_or(0);
        let subject = tokens[i + 4].to_string();
        let status_raw = tokens[i + 5].trim().to_string();
        i += 6;

        let path_at_commit = if status_raw.starts_with('R') || status_raw.starts_with('C') {
            if i + 1 < tokens.len() {
                let _old_path = tokens[i];
                let new_path = tokens[i + 1];
                i += 2;
                new_path.to_string()
            } else if i < tokens.len() {
                let path = tokens[i].to_string();
                i += 1;
                path
            } else {
                String::new()
            }
        } else if i < tokens.len() {
            let path = tokens[i].to_string();
            i += 1;
            path
        } else {
            String::new()
        };

        entries.push(FileHistoryEntry {
            sha,
            parents,
            author,
            time,
            subject,
            path_at_commit,
            status: status_raw,
        });
    }

    entries
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
    fn test_file_history_with_rename() {
        let dir = tempdir().unwrap();
        let path = dir.path();
        run_git(path, &["init"]);
        run_git(path, &["config", "core.autocrlf", "false"]);
        run_git(path, &["config", "user.name", "History Tester"]);
        run_git(path, &["config", "user.email", "history@example.com"]);

        // 1. Initial commit with old_name.txt
        let old_file = path.join("old_name.txt");
        fs::write(&old_file, "initial content\n").unwrap();
        run_git(path, &["add", "."]);
        run_git(path, &["commit", "-m", "initial commit for old file"]);

        // 2. Modify old_name.txt
        fs::write(&old_file, "modified content\n").unwrap();
        run_git(path, &["commit", "-am", "modify old file"]);

        // 3. Rename old_name.txt -> new_name.txt
        run_git(path, &["mv", "old_name.txt", "new_name.txt"]);
        run_git(path, &["commit", "-m", "rename old to new"]);

        // 4. Modify new_name.txt
        let new_file = path.join("new_name.txt");
        fs::write(&new_file, "modified new content\n").unwrap();
        run_git(path, &["commit", "-am", "modify new file"]);

        let cli = GitCli::new("git");
        let history = file_history(&cli, path, "new_name.txt", 0, 0).unwrap();

        assert_eq!(history.len(), 4);

        // Commit 4: modify new_name.txt
        assert_eq!(history[0].subject, "modify new file");
        assert_eq!(history[0].status, "M");
        assert_eq!(history[0].path_at_commit, "new_name.txt");
        assert_eq!(history[0].parents.len(), 1);

        // Commit 3: rename
        assert_eq!(history[1].subject, "rename old to new");
        assert!(history[1].status.starts_with('R'));
        assert_eq!(history[1].path_at_commit, "new_name.txt");

        // Commit 2: modify old_name.txt
        assert_eq!(history[2].subject, "modify old file");
        assert_eq!(history[2].status, "M");
        assert_eq!(history[2].path_at_commit, "old_name.txt");

        // Commit 1: initial
        assert_eq!(history[3].subject, "initial commit for old file");
        assert_eq!(history[3].status, "A");
        assert_eq!(history[3].path_at_commit, "old_name.txt");
        assert_eq!(history[3].parents.len(), 0);

        // Test pagination: skip = 1, limit = 2
        let paged = file_history(&cli, path, "new_name.txt", 1, 2).unwrap();
        assert_eq!(paged.len(), 2);
        assert_eq!(paged[0].subject, "rename old to new");
        assert_eq!(paged[1].subject, "modify old file");
    }
}
