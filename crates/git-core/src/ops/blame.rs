use crate::cli::{CommandOptions, GitCli};
use crate::error::GitError;
use crate::parse::{parse_blame, BlameLine};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Options for configuring blame execution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct BlameOptions {
    pub ignore_ws: bool,
    pub detect_moves: bool,
    pub detect_copies: bool,
}

/// Runs `git blame --porcelain` on a file and parses the result into blame lines.
pub fn blame<P: AsRef<Path>>(
    cli: &GitCli,
    repo_path: &Path,
    path: P,
    rev: Option<&str>,
    opts: BlameOptions,
) -> Result<Vec<BlameLine>, GitError> {
    let mut args = vec!["blame".to_string(), "--porcelain".to_string()];
    if opts.ignore_ws {
        args.push("-w".to_string());
    }
    if opts.detect_moves {
        args.push("-M".to_string());
    }
    if opts.detect_copies {
        args.push("-C".to_string());
    }
    if let Some(r) = rev {
        args.push(r.to_string());
    }
    args.push("--".to_string());
    args.push(path.as_ref().to_string_lossy().replace('\\', "/"));

    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = cli.exec(repo_path, &arg_refs, CommandOptions::read_only())?;
    Ok(parse_blame(&out.stdout_lossy()))
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
    fn test_blame_real_repo_multiple_authors() {
        let dir = tempdir().unwrap();
        let path = dir.path();
        run_git(path, &["init"]);
        run_git(path, &["config", "core.autocrlf", "false"]);
        run_git(path, &["config", "user.name", "Author One"]);
        run_git(path, &["config", "user.email", "author1@example.com"]);

        let file = path.join("blame_test.txt");
        fs::write(&file, "first line\nsecond line\n").unwrap();
        run_git(path, &["add", "blame_test.txt"]);
        run_git(path, &["commit", "-m", "initial commit"]);

        run_git(path, &["config", "user.name", "Author Two"]);
        run_git(path, &["config", "user.email", "author2@example.com"]);
        fs::write(&file, "first line\nsecond line modified\nthird line\n").unwrap();
        run_git(path, &["add", "blame_test.txt"]);
        run_git(path, &["commit", "-m", "second commit"]);

        let cli = GitCli::new("git");
        let result = blame(&cli, path, "blame_test.txt", None, BlameOptions::default()).unwrap();

        assert_eq!(result.len(), 3);
        assert_eq!(result[0].line_no, 1);
        assert_eq!(result[0].commit.author, "Author One");
        assert_eq!(result[0].commit.author_mail, "author1@example.com");

        assert_eq!(result[1].line_no, 2);
        assert_eq!(result[1].commit.author, "Author Two");
        assert_eq!(result[1].commit.author_mail, "author2@example.com");

        assert_eq!(result[2].line_no, 3);
        assert_eq!(result[2].commit.author, "Author Two");
        assert!(std::sync::Arc::ptr_eq(&result[1].commit, &result[2].commit));
    }
    #[test]
    fn test_blame_options_and_rev() {
        let dir = tempdir().unwrap();
        let path = dir.path();
        run_git(path, &["init"]);
        run_git(path, &["config", "core.autocrlf", "false"]);
        run_git(path, &["config", "user.name", "Tester"]);
        run_git(path, &["config", "user.email", "tester@example.com"]);

        let file = path.join("options_test.txt");
        fs::write(&file, "hello world\n").unwrap();
        run_git(path, &["add", "options_test.txt"]);
        run_git(path, &["commit", "-m", "c1"]);

        fs::write(&file, "hello   world\n").unwrap();
        run_git(path, &["add", "options_test.txt"]);
        run_git(path, &["commit", "-m", "c2 whitespace only"]);

        let cli = GitCli::new("git");
        // With ignore_ws, the line should be attributed to c1
        let opts = BlameOptions {
            ignore_ws: true,
            detect_moves: true,
            detect_copies: true,
        };
        let res = blame(&cli, path, "options_test.txt", None, opts).unwrap();
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].commit.summary, "c1");

        // Without ignore_ws, it should be attributed to c2
        let res_no_ignore = blame(
            &cli,
            path,
            "options_test.txt",
            None,
            BlameOptions::default(),
        )
        .unwrap();
        assert_eq!(res_no_ignore[0].commit.summary, "c2 whitespace only");

        // Blaming at HEAD~1
        let res_rev = blame(
            &cli,
            path,
            "options_test.txt",
            Some("HEAD~1"),
            BlameOptions::default(),
        )
        .unwrap();
        assert_eq!(res_rev[0].commit.summary, "c1");
    }
}
