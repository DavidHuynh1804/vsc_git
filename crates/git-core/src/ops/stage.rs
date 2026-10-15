use crate::cli::{CommandOptions, GitCli};
use crate::error::GitError;
use std::path::Path;

/// Check whether the repository has at least one commit (HEAD resolves).
pub fn repo_has_commits(cli: &GitCli, repo_path: &Path) -> bool {
    let res = cli.exec_raw(
        repo_path,
        &["rev-parse", "--verify", "HEAD"],
        CommandOptions::read_only(),
    );
    matches!(res, Ok(out) if out.exit_code == 0)
}

/// Stage specific file paths into git index: `git add -- <paths>`.
pub fn stage<P: AsRef<Path>>(cli: &GitCli, repo_path: &Path, paths: &[P]) -> Result<(), GitError> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args: Vec<String> = vec!["add".into(), "--".into()];
    for p in paths {
        args.push(p.as_ref().to_string_lossy().into_owned());
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    cli.exec(repo_path, &arg_refs, CommandOptions::default())?;
    Ok(())
}

/// Stage all changes in repository: `git add -A`.
pub fn stage_all(cli: &GitCli, repo_path: &Path) -> Result<(), GitError> {
    cli.exec(repo_path, &["add", "-A"], CommandOptions::default())?;
    Ok(())
}

/// Unstage specific file paths from git index.
/// - If the repo has commits: `git restore --staged -- <paths>`
/// - If the repo has no commits yet: `git rm --cached -- <paths>`
pub fn unstage<P: AsRef<Path>>(
    cli: &GitCli,
    repo_path: &Path,
    paths: &[P],
) -> Result<(), GitError> {
    if paths.is_empty() {
        return Ok(());
    }
    let has_commits = repo_has_commits(cli, repo_path);
    let mut args: Vec<String> = if has_commits {
        vec!["restore".into(), "--staged".into(), "--".into()]
    } else {
        vec!["rm".into(), "--cached".into(), "--".into()]
    };

    for p in paths {
        args.push(p.as_ref().to_string_lossy().into_owned());
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    cli.exec(repo_path, &arg_refs, CommandOptions::default())?;
    Ok(())
}

/// Unstage all staged changes.
/// - If the repo has commits: `git restore --staged :`
/// - If the repo has no commits yet: `git rm -r --cached .`
pub fn unstage_all(cli: &GitCli, repo_path: &Path) -> Result<(), GitError> {
    let has_commits = repo_has_commits(cli, repo_path);
    if has_commits {
        cli.exec(
            repo_path,
            &["restore", "--staged", ":"],
            CommandOptions::default(),
        )?;
    } else {
        cli.exec(
            repo_path,
            &["rm", "-r", "--cached", "."],
            CommandOptions::default(),
        )?;
    }
    Ok(())
}

/// Discard local working tree changes for tracked files: `git restore --worktree -- <paths>`.
pub fn discard<P: AsRef<Path>>(
    cli: &GitCli,
    repo_path: &Path,
    paths: &[P],
) -> Result<(), GitError> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args: Vec<String> = vec!["restore".into(), "--worktree".into(), "--".into()];
    for p in paths {
        args.push(p.as_ref().to_string_lossy().into_owned());
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    cli.exec(repo_path, &arg_refs, CommandOptions::default())?;
    Ok(())
}

/// Discard all local working tree changes for tracked files: `git restore --worktree .`.
pub fn discard_all(cli: &GitCli, repo_path: &Path) -> Result<(), GitError> {
    cli.exec(
        repo_path,
        &["restore", "--worktree", "."],
        CommandOptions::default(),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ops::status::status;
    use std::fs;
    use tempfile::tempdir;

    fn init_temp_repo() -> tempfile::TempDir {
        let dir = tempdir().unwrap();
        let cli = GitCli::default();
        cli.exec(dir.path(), &["init"], CommandOptions::default())
            .unwrap();
        cli.exec(
            dir.path(),
            &["config", "core.autocrlf", "false"],
            CommandOptions::default(),
        )
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
    fn test_stage_and_unstage_without_commits() {
        let dir = init_temp_repo();
        let cli = GitCli::default();
        let file_path = dir.path().join("first.txt");
        fs::write(&file_path, "initial content").unwrap();

        // Initially untracked
        let st = status(&cli, dir.path()).unwrap();
        assert_eq!(st.untracked().len(), 1);
        assert_eq!(st.staged().len(), 0);

        // Stage file
        stage(&cli, dir.path(), &[Path::new("first.txt")]).unwrap();
        let st = status(&cli, dir.path()).unwrap();
        assert_eq!(st.staged().len(), 1);
        assert_eq!(st.untracked().len(), 0);

        // Unstage file (initial commit case uses `git rm --cached`)
        unstage(&cli, dir.path(), &[Path::new("first.txt")]).unwrap();
        let st = status(&cli, dir.path()).unwrap();
        assert_eq!(st.staged().len(), 0);
        assert_eq!(st.untracked().len(), 1);
        assert!(file_path.exists());
    }

    #[test]
    fn test_stage_unstage_and_discard_with_commits() {
        let dir = init_temp_repo();
        let cli = GitCli::default();
        let file_path = dir.path().join("tracked.txt");
        fs::write(&file_path, "base content\n").unwrap();

        stage(&cli, dir.path(), &[Path::new("tracked.txt")]).unwrap();
        cli.exec(
            dir.path(),
            &["commit", "-m", "initial commit"],
            CommandOptions::default(),
        )
        .unwrap();

        // Modify tracked file
        fs::write(&file_path, "modified content\n").unwrap();
        let st = status(&cli, dir.path()).unwrap();
        assert_eq!(st.unstaged().len(), 1);

        // Stage modification
        stage(&cli, dir.path(), &[Path::new("tracked.txt")]).unwrap();
        let st = status(&cli, dir.path()).unwrap();
        assert_eq!(st.staged().len(), 1);
        assert_eq!(st.unstaged().len(), 0);

        // Unstage modification
        unstage(&cli, dir.path(), &[Path::new("tracked.txt")]).unwrap();
        let st = status(&cli, dir.path()).unwrap();
        assert_eq!(st.staged().len(), 0);
        assert_eq!(st.unstaged().len(), 1);

        // Discard modification in worktree
        discard(&cli, dir.path(), &[Path::new("tracked.txt")]).unwrap();
        let st = status(&cli, dir.path()).unwrap();
        assert_eq!(st.staged().len(), 0);
        assert_eq!(st.unstaged().len(), 0);
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "base content\n");
    }
}
