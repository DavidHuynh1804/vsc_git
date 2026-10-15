use git_read::{FileStatus, ReadRepo};
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
fn test_commit_detail_and_compare() {
    let dir = TempDir::new().unwrap();
    let repo_dir = dir.path();
    run_git(repo_dir, &["init", "-b", "main"]);
    // Commit 1: Root commit with text and binary file
    let initial_content = "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    std::fs::write(repo_dir.join("text.txt"), initial_content).unwrap();
    std::fs::write(repo_dir.join("image.bin"), b"\x00\x01\x02\x03\x04").unwrap();
    run_git(repo_dir, &["add", "text.txt", "image.bin"]);
    run_git(repo_dir, &["commit", "-m", "Commit 1: Add text and binary"]);
    let sha1 = git_rev_parse(repo_dir, "HEAD");

    // Commit 2: Rename text.txt to renamed.txt, append line11, and modify binary
    run_git(repo_dir, &["mv", "text.txt", "renamed.txt"]);
    let modified_content = format!("{initial_content}line11\n");
    std::fs::write(repo_dir.join("renamed.txt"), modified_content).unwrap();
    std::fs::write(repo_dir.join("image.bin"), b"\x00\xFF\xFE\xFD").unwrap();
    run_git(repo_dir, &["add", "renamed.txt", "image.bin"]);
    run_git(
        repo_dir,
        &[
            "commit",
            "-m",
            "Commit 2: Rename and modify\n\nDetailed body description here.",
        ],
    );
    let sha2 = git_rev_parse(repo_dir, "HEAD");

    let repo = ReadRepo::open(repo_dir).unwrap();

    // 1. Verify Commit 1 (root commit)
    let detail1 = repo.commit_detail(&sha1).unwrap();
    assert_eq!(detail1.summary.subject, "Commit 1: Add text and binary");
    assert_eq!(detail1.body, None);
    assert_eq!(detail1.summary.parents.len(), 0);
    assert_eq!(detail1.files.len(), 2);

    let text_file1 = detail1
        .files
        .iter()
        .find(|f| f.path == "text.txt")
        .expect("text.txt found");
    assert_eq!(text_file1.status, FileStatus::A);
    assert_eq!(text_file1.additions, 10);
    assert_eq!(text_file1.deletions, 0);
    assert!(!text_file1.binary);

    let bin_file1 = detail1
        .files
        .iter()
        .find(|f| f.path == "image.bin")
        .expect("image.bin found");
    assert_eq!(bin_file1.status, FileStatus::A);
    assert!(bin_file1.binary);
    assert_eq!(bin_file1.additions, 0);
    assert_eq!(bin_file1.deletions, 0);

    // 2. Verify Commit 2 (rename + modify)
    let detail2 = repo.commit_detail(&sha2).unwrap();
    assert_eq!(detail2.summary.subject, "Commit 2: Rename and modify");
    assert_eq!(
        detail2.body.as_deref(),
        Some("Detailed body description here.\n")
    );
    assert_eq!(detail2.summary.parents.len(), 1);
    assert_eq!(detail2.summary.parents[0], sha1);

    let renamed_file = detail2
        .files
        .iter()
        .find(|f| f.path == "renamed.txt")
        .expect("renamed.txt found");
    assert_eq!(renamed_file.status, FileStatus::R);
    assert_eq!(renamed_file.old_path.as_deref(), Some("text.txt"));
    assert_eq!(renamed_file.additions, 1);
    assert_eq!(renamed_file.deletions, 0);
    assert!(!renamed_file.binary);

    let bin_file2 = detail2
        .files
        .iter()
        .find(|f| f.path == "image.bin")
        .expect("image.bin found");
    assert_eq!(bin_file2.status, FileStatus::M);
    assert!(bin_file2.binary);

    // 3. Verify compare(sha1, sha2)
    let diff = repo.compare(&sha1, &sha2).unwrap();
    assert_eq!(diff.len(), 2);

    let cmp_renamed = diff.iter().find(|f| f.path == "renamed.txt").unwrap();
    assert_eq!(cmp_renamed.status, FileStatus::R);
    assert_eq!(cmp_renamed.old_path.as_deref(), Some("text.txt"));
}
