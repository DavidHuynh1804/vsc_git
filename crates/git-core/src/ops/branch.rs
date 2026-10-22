use crate::cli::{CommandOptions, GitCli};
use crate::error::GitError;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// The category of a git ref.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum RefKind {
    Local,
    Remote,
    Tag,
}

/// Structured reference information from `git for-each-ref`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RefInfo {
    pub name: String,
    pub full_name: String,
    pub kind: RefKind,
    pub commit_id: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub is_head: bool,
    pub symref_target: Option<String>,
    /// Unix seconds of the tip commit (or tag) creation.
    pub date: Option<u32>,
    /// Author of the tip commit, or tagger of an annotated tag.
    pub author: Option<String>,
    pub subject: Option<String>,
}

fn parse_track(track: &str) -> (u32, u32) {
    let mut ahead = 0;
    let mut behind = 0;
    for part in track.split(',') {
        let p = part.trim();
        if let Some(rest) = p.strip_prefix("ahead ") {
            ahead = rest.parse().unwrap_or(0);
        } else if let Some(rest) = p.strip_prefix("behind ") {
            behind = rest.parse().unwrap_or(0);
        }
    }
    (ahead, behind)
}

/// List refs (local branches, remote branches, tags) using `git for-each-ref --format` with `%00` separator.
pub fn list_refs(cli: &GitCli, repo_path: &Path) -> Result<Vec<RefInfo>, GitError> {
    let format_arg = "--format=%(refname)%00%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(HEAD)%00%(symref)%00%(creatordate:unix)%00%(authorname)%(taggername)%00%(contents:subject)";
    let out = cli.exec(
        repo_path,
        &[
            "for-each-ref",
            format_arg,
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
        CommandOptions::read_only(),
    )?;

    let stdout = out.stdout_lossy();
    let mut refs = Vec::new();

    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split('\0').collect();
        if fields.len() < 7 {
            continue;
        }

        let full_name = fields[0].to_string();
        let name = fields[1].to_string();
        let commit_id = fields[2].to_string();
        let upstream = if fields[3].is_empty() {
            None
        } else {
            Some(fields[3].to_string())
        };
        let (ahead, behind) = parse_track(fields[4]);
        let is_head = fields[5].trim() == "*";
        let symref_target = if fields[6].is_empty() {
            None
        } else {
            Some(fields[6].to_string())
        };

        let non_empty = |i: usize| {
            fields
                .get(i)
                .map(|f| f.trim())
                .filter(|f| !f.is_empty())
                .map(str::to_string)
        };
        let date = non_empty(7).and_then(|d| d.parse().ok());
        let author = non_empty(8);
        let subject = non_empty(9);

        let kind = if full_name.starts_with("refs/heads/") {
            RefKind::Local
        } else if full_name.starts_with("refs/remotes/") {
            RefKind::Remote
        } else if full_name.starts_with("refs/tags/") {
            RefKind::Tag
        } else {
            continue;
        };

        refs.push(RefInfo {
            name,
            full_name,
            kind,
            commit_id,
            upstream,
            ahead,
            behind,
            is_head,
            symref_target,
            date,
            author,
            subject,
        });
    }

    Ok(refs)
}

/// Checkout an existing branch: `git switch <branch>`.
pub fn checkout(cli: &GitCli, repo_path: &Path, branch: &str) -> Result<(), GitError> {
    cli.exec(repo_path, &["switch", branch], CommandOptions::default())?;
    Ok(())
}

/// Checkout in detached HEAD mode: `git switch --detach <target>`.
pub fn checkout_detached(cli: &GitCli, repo_path: &Path, target: &str) -> Result<(), GitError> {
    cli.exec(
        repo_path,
        &["switch", "--detach", target],
        CommandOptions::default(),
    )?;
    Ok(())
}

/// Create a new branch: `git branch <name> [<start_point>]`.
pub fn create_branch(
    cli: &GitCli,
    repo_path: &Path,
    name: &str,
    start_point: Option<&str>,
) -> Result<(), GitError> {
    let mut args = vec!["branch", name];
    if let Some(start) = start_point {
        args.push(start);
    }
    cli.exec(repo_path, &args, CommandOptions::default())?;
    Ok(())
}

/// Rename a branch: `git branch -m [<old_name>] <new_name>`.
pub fn rename_branch(
    cli: &GitCli,
    repo_path: &Path,
    old_name: Option<&str>,
    new_name: &str,
) -> Result<(), GitError> {
    let mut args = vec!["branch", "-m"];
    if let Some(old) = old_name {
        args.push(old);
    }
    args.push(new_name);
    cli.exec(repo_path, &args, CommandOptions::default())?;
    Ok(())
}

/// Delete a branch: `git branch -d|-D <name>`.
pub fn delete_branch(
    cli: &GitCli,
    repo_path: &Path,
    name: &str,
    force: bool,
) -> Result<(), GitError> {
    let flag = if force { "-D" } else { "-d" };
    cli.exec(
        repo_path,
        &["branch", flag, name],
        CommandOptions::default(),
    )?;
    Ok(())
}

/// Set upstream tracking branch: `git branch --set-upstream-to=<upstream> [<branch>]`.
pub fn set_upstream(
    cli: &GitCli,
    repo_path: &Path,
    branch: Option<&str>,
    upstream: &str,
) -> Result<(), GitError> {
    let mut args = vec!["branch", "--set-upstream-to", upstream];
    if let Some(b) = branch {
        args.push(b);
    }
    cli.exec(repo_path, &args, CommandOptions::default())?;
    Ok(())
}

/// Create a tag (lightweight or annotated).
pub fn create_tag(
    cli: &GitCli,
    repo_path: &Path,
    name: &str,
    target: Option<&str>,
    annotation: Option<&str>,
) -> Result<(), GitError> {
    let mut args = vec!["tag"];
    if let Some(msg) = annotation {
        args.push("-a");
        args.push(name);
        args.push("-m");
        args.push(msg);
    } else {
        args.push(name);
    }
    if let Some(t) = target {
        args.push(t);
    }
    cli.exec(repo_path, &args, CommandOptions::default())?;
    Ok(())
}

/// Delete a tag: `git tag -d <name>`.
pub fn delete_tag(cli: &GitCli, repo_path: &Path, name: &str) -> Result<(), GitError> {
    cli.exec(repo_path, &["tag", "-d", name], CommandOptions::default())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ops::{commit, stage_all, CommitOptions};
    use tempfile::tempdir;

    #[test]
    fn test_branch_and_tag_lifecycle() {
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

        std::fs::write(path.join("file.txt"), "hello\n").unwrap();
        stage_all(&cli, path).unwrap();
        commit(&cli, path, CommitOptions::new("initial commit")).unwrap();

        // 1. List refs - main should be HEAD
        let refs0 = list_refs(&cli, path).unwrap();
        assert_eq!(refs0.len(), 1);
        assert_eq!(refs0[0].name, "main");
        assert!(refs0[0].is_head);
        assert_eq!(refs0[0].kind, RefKind::Local);

        // 2. Create branch feature
        create_branch(&cli, path, "feature", None).unwrap();
        let refs1 = list_refs(&cli, path).unwrap();
        assert_eq!(refs1.len(), 2);

        // 3. Checkout feature
        checkout(&cli, path, "feature").unwrap();
        let refs2 = list_refs(&cli, path).unwrap();
        let feat = refs2.iter().find(|r| r.name == "feature").unwrap();
        assert!(feat.is_head);

        // 4. Rename feature to feat-renamed
        rename_branch(&cli, path, None, "feat-renamed").unwrap();
        checkout(&cli, path, "main").unwrap();

        // 5. Delete feat-renamed
        delete_branch(&cli, path, "feat-renamed", false).unwrap();
        let refs3 = list_refs(&cli, path).unwrap();
        assert_eq!(refs3.len(), 1);

        // 6. Create lightweight and annotated tags
        create_tag(&cli, path, "v1.0.0", None, None).unwrap();
        create_tag(&cli, path, "v1.1.0", None, Some("release 1.1.0")).unwrap();
        let refs4 = list_refs(&cli, path).unwrap();
        assert_eq!(refs4.len(), 3);
        let tags: Vec<_> = refs4.iter().filter(|r| r.kind == RefKind::Tag).collect();
        assert_eq!(tags.len(), 2);

        // 7. Delete tag
        delete_tag(&cli, path, "v1.0.0").unwrap();
        let refs5 = list_refs(&cli, path).unwrap();
        assert_eq!(refs5.len(), 2);
    }
}
