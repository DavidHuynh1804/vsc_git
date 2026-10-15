use git_graph::RefKind;
use git_read::{GraphFilter, GraphWalker, ReadRepo};
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
fn test_cli_fallback_when_forced() {
    let dir = TempDir::new().unwrap();
    let remote_dir = dir.path().join("remote.git");
    let local_dir = dir.path().join("local");

    // Remote
    std::fs::create_dir_all(&remote_dir).unwrap();
    run_git(&remote_dir, &["init", "--bare"]);

    // Local
    std::fs::create_dir_all(&local_dir).unwrap();
    run_git(&local_dir, &["init", "-b", "main"]);
    run_git(
        &local_dir,
        &["remote", "add", "origin", remote_dir.to_str().unwrap()],
    );

    std::fs::write(local_dir.join("test.txt"), "hello from fallback\n").unwrap();
    run_git(&local_dir, &["add", "test.txt"]);
    run_git(&local_dir, &["commit", "-m", "Commit 1"]);
    run_git(&local_dir, &["push", "-u", "origin", "main"]);

    // Commit 2
    std::fs::write(local_dir.join("test.txt"), "hello 2\n").unwrap();
    run_git(&local_dir, &["commit", "-am", "Commit 2"]);
    run_git(&local_dir, &["tag", "v1.0"]);

    let repo_normal = ReadRepo::open(&local_dir).unwrap();
    let repo_fallback = repo_normal.clone().with_forced_fallback(true);
    assert!(repo_fallback.force_fallback());

    // 1. Test refs() with forced fallback
    let refs_normal = repo_normal.refs().unwrap();
    let refs_fallback = repo_fallback.refs().unwrap();

    let main_fb = refs_fallback
        .iter()
        .find(|r| r.name == "main" && r.kind == RefKind::LocalBranch)
        .expect("main branch in fallback");
    let main_norm = refs_normal
        .iter()
        .find(|r| r.name == "main" && r.kind == RefKind::LocalBranch)
        .expect("main branch in normal");

    assert_eq!(main_fb.target_sha, main_norm.target_sha);
    assert_eq!(main_fb.upstream, main_norm.upstream);
    assert_eq!(main_fb.ahead, main_norm.ahead);
    assert_eq!(main_fb.behind, main_norm.behind);

    // 2. Test next_page() with forced fallback
    let mut walker_fb = GraphWalker::new(repo_fallback.clone(), GraphFilter::default()).unwrap();
    assert!(walker_fb.force_fallback());

    let page1 = walker_fb.next_page(1).unwrap();
    assert_eq!(page1.commits.len(), 1);
    assert_eq!(page1.commits[0].subject, "Commit 2");
    assert!(page1.has_more);

    let page2 = walker_fb.next_page(1).unwrap();
    assert_eq!(page2.commits.len(), 1);
    assert_eq!(page2.commits[0].subject, "Commit 1");
    assert!(!page2.has_more);

    // 3. Test blob_at with forced fallback
    let blob = repo_fallback.blob_at("HEAD", "test.txt").unwrap();
    assert_eq!(blob.as_deref(), Some(b"hello 2\n" as &[u8]));
}
