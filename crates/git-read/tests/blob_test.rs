use git_read::ReadRepo;
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

fn git_rev_parse(cwd: &std::path::Path, rev: &str) -> String {
    let output = Command::new("git")
        .args(["rev-parse", rev])
        .current_dir(cwd)
        .output()
        .expect("git rev-parse failed");
    assert!(output.status.success());
    String::from_utf8(output.stdout).unwrap().trim().to_string()
}

#[test]
fn test_blob_at_and_index_blob_stages() {
    let dir = TempDir::new().unwrap();
    let repo_dir = dir.path();

    run_git(repo_dir, &["init", "-b", "main"]);

    // Base commit
    std::fs::create_dir_all(repo_dir.join("sub")).unwrap();
    std::fs::write(repo_dir.join("sub/nested.txt"), "nested content\n").unwrap();
    std::fs::write(repo_dir.join("conflict.txt"), "base content\n").unwrap();
    run_git(repo_dir, &["add", "sub/nested.txt", "conflict.txt"]);
    run_git(repo_dir, &["commit", "-m", "Base commit"]);
    let base_sha = git_rev_parse(repo_dir, "HEAD");

    // Branch "feature"
    run_git(repo_dir, &["checkout", "-b", "feature"]);
    std::fs::write(repo_dir.join("conflict.txt"), "theirs content\n").unwrap();
    run_git(repo_dir, &["commit", "-am", "Feature commit"]);

    // On "main"
    run_git(repo_dir, &["checkout", "main"]);
    std::fs::write(repo_dir.join("conflict.txt"), "ours content\n").unwrap();
    run_git(repo_dir, &["commit", "-am", "Main commit"]);
    let main_sha = git_rev_parse(repo_dir, "HEAD");

    let repo = ReadRepo::open(repo_dir).unwrap();

    // 1. Test blob_at
    let head_blob = repo.blob_at("HEAD", "sub/nested.txt").unwrap();
    assert_eq!(head_blob.as_deref(), Some(b"nested content\n" as &[u8]));

    let base_blob = repo.blob_at(&base_sha, "conflict.txt").unwrap();
    assert_eq!(base_blob.as_deref(), Some(b"base content\n" as &[u8]));

    let main_blob = repo.blob_at(&main_sha, "conflict.txt").unwrap();
    assert_eq!(main_blob.as_deref(), Some(b"ours content\n" as &[u8]));

    let non_existent = repo.blob_at("HEAD", "missing.txt").unwrap();
    assert_eq!(non_existent, None);

    // 2. Test index_blob stage 0 before conflict
    let idx_staged = repo.index_blob("sub/nested.txt", 0).unwrap();
    assert_eq!(idx_staged.as_deref(), Some(b"nested content\n" as &[u8]));

    // 3. Cause merge conflict
    let merge_res = Command::new("git")
        .args(["merge", "feature"])
        .current_dir(repo_dir)
        .output()
        .unwrap();
    assert!(!merge_res.status.success(), "Merge should conflict");

    // Test conflict stages
    let stage1 = repo.index_blob("conflict.txt", 1).unwrap();
    assert_eq!(stage1.as_deref(), Some(b"base content\n" as &[u8]));

    let stage2 = repo.index_blob("conflict.txt", 2).unwrap();
    assert_eq!(stage2.as_deref(), Some(b"ours content\n" as &[u8]));

    let stage3 = repo.index_blob("conflict.txt", 3).unwrap();
    assert_eq!(stage3.as_deref(), Some(b"theirs content\n" as &[u8]));

    let stage0 = repo.index_blob("conflict.txt", 0).unwrap();
    assert_eq!(stage0, None);
}
