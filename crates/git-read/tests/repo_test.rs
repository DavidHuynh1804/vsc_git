use git_graph::RefKind;
use git_read::{HeadInfo, ReadRepo};
use std::process::Command;
use tempfile::TempDir;

fn run_git(cwd: &std::path::Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_AUTHOR_NAME", "Tester")
        .env("GIT_AUTHOR_EMAIL", "tester@example.com")
        .env("GIT_COMMITTER_NAME", "Tester")
        .env("GIT_COMMITTER_EMAIL", "tester@example.com")
        .output()
        .expect("git command failed");
    assert!(
        output.status.success(),
        "git command `git {}` failed: {}",
        args.join(" "),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn test_bare_and_worktree_and_refs_ahead_behind() {
    let dir = TempDir::new().unwrap();
    let remote_dir = dir.path().join("remote.git");
    let local_dir = dir.path().join("local");
    let wt_dir = dir.path().join("worktree");

    // 1. Create bare remote repository
    std::fs::create_dir_all(&remote_dir).unwrap();
    run_git(&remote_dir, &["init", "--bare"]);

    // Verify ReadRepo::open bare repo
    let bare_repo = ReadRepo::open(&remote_dir).unwrap();
    assert!(bare_repo.is_bare());

    // 2. Setup local repo
    std::fs::create_dir_all(&local_dir).unwrap();
    run_git(&local_dir, &["init", "-b", "main"]);
    run_git(
        &local_dir,
        &["remote", "add", "origin", remote_dir.to_str().unwrap()],
    );

    // Initial commit
    std::fs::write(local_dir.join("file.txt"), "hello\n").unwrap();
    run_git(&local_dir, &["add", "file.txt"]);
    run_git(&local_dir, &["commit", "-m", "Initial commit"]);
    run_git(&local_dir, &["push", "-u", "origin", "main"]);

    // Add another commit to local main (now ahead: 1, behind: 0)
    std::fs::write(local_dir.join("file.txt"), "hello world\n").unwrap();
    run_git(&local_dir, &["commit", "-am", "Second commit"]);

    // Create a tag
    run_git(&local_dir, &["tag", "v1.0.0"]);

    // Create stash
    std::fs::write(local_dir.join("file.txt"), "hello stashed\n").unwrap();
    run_git(&local_dir, &["stash", "push", "-m", "WIP stash"]);

    // Test ReadRepo on local repo
    let repo = ReadRepo::open(&local_dir).unwrap();
    assert!(!repo.is_bare());

    // Verify HEAD
    match repo.head().unwrap() {
        HeadInfo::Branch { name, target_sha } => {
            assert_eq!(name, "main");
            assert!(!target_sha.is_empty());
        }
        other => panic!("Expected HeadInfo::Branch, got {:?}", other),
    }

    // Verify refs
    let refs = repo.refs().unwrap();
    println!("Refs returned: {:#?}", refs);

    let head_ref = refs
        .iter()
        .find(|r| r.kind == RefKind::Head)
        .expect("HEAD ref found");
    assert_eq!(head_ref.name, "HEAD");

    let main_ref = refs
        .iter()
        .find(|r| r.name == "main" && r.kind == RefKind::LocalBranch)
        .expect("main branch found");
    assert_eq!(main_ref.upstream.as_deref(), Some("origin/main"));
    assert_eq!(main_ref.ahead, 1);
    assert_eq!(main_ref.behind, 0);

    let origin_main = refs
        .iter()
        .find(|r| r.name == "origin/main" && r.kind == RefKind::RemoteBranch)
        .expect("remote main found");
    assert_ne!(origin_main.target_sha, main_ref.target_sha);

    let tag_ref = refs
        .iter()
        .find(|r| r.name == "v1.0.0" && r.kind == RefKind::Tag)
        .expect("tag found");
    assert_eq!(tag_ref.target_sha, main_ref.target_sha);

    let stash_ref = refs
        .iter()
        .find(|r| r.kind == RefKind::Stash)
        .expect("stash ref found");
    assert!(stash_ref.name.contains("stash"));

    // 3. Test worktree support
    run_git(
        &local_dir,
        &["worktree", "add", "-b", "feat-wt", wt_dir.to_str().unwrap()],
    );
    let wt_repo = ReadRepo::open(&wt_dir).unwrap();
    assert!(!wt_repo.is_bare());
    match wt_repo.head().unwrap() {
        HeadInfo::Branch { name, .. } => {
            assert_eq!(name, "feat-wt");
        }
        other => panic!("Expected HeadInfo::Branch in worktree, got {:?}", other),
    }
}
