use crate::cli::{CommandOptions, GitCli};
use crate::error::GitError;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Target revision for file content queries matching specification section 4.1.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum FileRev {
    Head,
    Index,
    Commit(String),
    Stage(u8),
}

/// Retrieve raw file content bytes from git storage.
pub fn file_content<P: AsRef<Path>>(
    cli: &GitCli,
    repo_path: &Path,
    path: P,
    rev: FileRev,
) -> Result<Vec<u8>, GitError> {
    let path_str = path.as_ref().to_string_lossy().replace('\\', "/");
    let spec = match &rev {
        FileRev::Head => format!("HEAD:{path_str}"),
        FileRev::Index => format!(":{path_str}"),
        FileRev::Commit(sha) => format!("{sha}:{path_str}"),
        FileRev::Stage(stage) => format!(":{stage}:{path_str}"),
    };

    let out = cli.exec(repo_path, &["show", &spec], CommandOptions::read_only())?;
    Ok(out.stdout)
}

/// Generate unified diff text for a file or repository with configurable context lines.
pub fn unified_diff<P: AsRef<Path>>(
    cli: &GitCli,
    repo_path: &Path,
    path: Option<P>,
    staged: bool,
    context: u32,
) -> Result<String, GitError> {
    let mut args = vec!["diff".to_string(), format!("-U{context}")];
    if staged {
        args.push("--cached".to_string());
    }
    if let Some(p) = path {
        args.push("--".to_string());
        args.push(p.as_ref().to_string_lossy().into_owned());
    }

    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = cli.exec(repo_path, &arg_refs, CommandOptions::read_only())?;
    Ok(out.stdout_lossy())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ops::{commit, stage_all, CommitOptions};
    use tempfile::tempdir;

    #[test]
    fn test_file_content_and_unified_diff() {
        let dir = tempdir().unwrap();
        let path = dir.path();
        let cli = GitCli::default();

        cli.exec(path, &["init", "-b", "main"], CommandOptions::default())
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

        // 1. Initial commit
        std::fs::write(path.join("file.txt"), "line1\nline2\nline3\n").unwrap();
        stage_all(&cli, path).unwrap();
        commit(&cli, path, CommitOptions::new("initial")).unwrap();

        let head_bytes = file_content(&cli, path, "file.txt", FileRev::Head).unwrap();
        assert_eq!(head_bytes, b"line1\nline2\nline3\n");

        // 2. Modify and stage
        std::fs::write(path.join("file.txt"), "line1\nline2_staged\nline3\n").unwrap();
        stage_all(&cli, path).unwrap();

        // Index has line2_staged, HEAD has line2
        let index_bytes = file_content(&cli, path, "file.txt", FileRev::Index).unwrap();
        assert_eq!(index_bytes, b"line1\nline2_staged\nline3\n");
        let head_bytes2 = file_content(&cli, path, "file.txt", FileRev::Head).unwrap();
        assert_eq!(head_bytes2, b"line1\nline2\nline3\n");

        // Staged diff
        let staged_diff = unified_diff(&cli, path, Some("file.txt"), true, 0).unwrap();
        assert!(staged_diff.contains("-line2"));
        assert!(staged_diff.contains("+line2_staged"));

        // 3. Modify worktree again
        std::fs::write(path.join("file.txt"), "line1\nline2_unstaged\nline3\n").unwrap();
        let unstaged_diff = unified_diff(&cli, path, Some("file.txt"), false, 1).unwrap();
        assert!(unstaged_diff.contains("-line2_staged"));
        assert!(unstaged_diff.contains("+line2_unstaged"));
    }
}
