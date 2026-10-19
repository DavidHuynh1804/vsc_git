use git_graph::RefKind;
use git_read::{GraphFilter, GraphWalker, ReadRepo, RefFilter};
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
fn test_walker_paging_and_first_parent_and_stash() {
    let dir = TempDir::new().unwrap();
    let repo_dir = dir.path();

    run_git(repo_dir, &["init", "-b", "main"]);

    // Commit 1 (root)
    std::fs::write(repo_dir.join("file.txt"), "c1\n").unwrap();
    run_git(repo_dir, &["add", "file.txt"]);
    run_git(repo_dir, &["commit", "-m", "Commit 1"]);

    // Commit 2
    std::fs::write(repo_dir.join("file.txt"), "c2\n").unwrap();
    run_git(repo_dir, &["commit", "-am", "Commit 2"]);

    // Branch feature
    run_git(repo_dir, &["checkout", "-b", "feature"]);
    std::fs::write(repo_dir.join("file.txt"), "c4 on feature\n").unwrap();
    run_git(repo_dir, &["commit", "-am", "Commit 4"]);

    std::fs::write(repo_dir.join("file.txt"), "c5 on feature\n").unwrap();
    run_git(repo_dir, &["commit", "-am", "Commit 5"]);

    // Back to main, Commit 3
    run_git(repo_dir, &["checkout", "main"]);
    std::fs::write(repo_dir.join("other.txt"), "c3 on main\n").unwrap();
    run_git(repo_dir, &["add", "other.txt"]);
    run_git(repo_dir, &["commit", "-m", "Commit 3"]);

    // Commit 6 (merge feature into main)
    run_git(
        repo_dir,
        &["merge", "feature", "-m", "Commit 6: Merge feature"],
    );

    // Commit 7 on main
    std::fs::write(repo_dir.join("other.txt"), "c7 on main\n").unwrap();
    run_git(repo_dir, &["commit", "-am", "Commit 7"]);

    // Create a stash
    std::fs::write(repo_dir.join("other.txt"), "uncommitted stash changes\n").unwrap();
    run_git(repo_dir, &["stash", "push", "-m", "My test stash"]);

    let repo = ReadRepo::open(repo_dir).unwrap();

    // 1. Test 1-page vs 3-commits/page bitwise invariance
    let mut walker_all = GraphWalker::new(repo.clone(), GraphFilter::default()).unwrap();
    let page_all = walker_all.next_page(100).unwrap();
    assert_eq!(page_all.commits.len(), 7);
    assert!(!page_all.has_more);

    let mut walker_paged = GraphWalker::new(repo.clone(), GraphFilter::default()).unwrap();
    let page1 = walker_paged.next_page(3).unwrap();
    assert_eq!(page1.commits.len(), 3);
    assert!(page1.has_more);

    let page2 = walker_paged.next_page(3).unwrap();
    assert_eq!(page2.commits.len(), 3);
    assert!(page2.has_more);

    let page3 = walker_paged.next_page(3).unwrap();
    assert_eq!(page3.commits.len(), 1);
    assert!(!page3.has_more);

    let page4 = walker_paged.next_page(3).unwrap();
    assert_eq!(page4.commits.len(), 0);
    assert!(!page4.has_more);

    let mut concatenated_commits = Vec::new();
    concatenated_commits.extend(page1.commits);
    concatenated_commits.extend(page2.commits);
    concatenated_commits.extend(page3.commits);
    assert_eq!(concatenated_commits, page_all.commits);

    let mut concatenated_rows = Vec::new();
    concatenated_rows.extend(page1.rows);
    concatenated_rows.extend(page2.rows);
    concatenated_rows.extend(page3.rows);
    assert_eq!(concatenated_rows, page_all.rows);

    // 2. Test first-parent only
    let mut walker_fp = GraphWalker::new(
        repo.clone(),
        GraphFilter {
            first_parent_only: true,
            ..Default::default()
        },
    )
    .unwrap();
    let page_fp = walker_fp.next_page(100).unwrap();
    // In first parent walk, Commit 4 and Commit 5 from feature branch must NOT be present
    assert_eq!(page_fp.commits.len(), 5);
    let subjects: Vec<&str> = page_fp.commits.iter().map(|c| c.subject.as_str()).collect();
    assert!(subjects.contains(&"Commit 7"));
    assert!(subjects.contains(&"Commit 6: Merge feature"));
    assert!(subjects.contains(&"Commit 3"));
    assert!(subjects.contains(&"Commit 2"));
    assert!(subjects.contains(&"Commit 1"));
    assert!(!subjects.contains(&"Commit 4"));
    assert!(!subjects.contains(&"Commit 5"));

    // 3. Test selected branch filter
    let mut walker_feat = GraphWalker::new(
        repo.clone(),
        GraphFilter {
            refs: RefFilter::Selected(vec!["feature".to_string()]),
            ..Default::default()
        },
    )
    .unwrap();
    let page_feat = walker_feat.next_page(100).unwrap();
    let feat_subjects: Vec<&str> = page_feat
        .commits
        .iter()
        .map(|c| c.subject.as_str())
        .collect();
    assert!(feat_subjects.contains(&"Commit 5"));
    assert!(feat_subjects.contains(&"Commit 4"));
    assert!(feat_subjects.contains(&"Commit 2"));
    assert!(feat_subjects.contains(&"Commit 1"));
    assert!(!feat_subjects.contains(&"Commit 7"));
    assert!(!feat_subjects.contains(&"Commit 6: Merge feature"));
    assert!(!feat_subjects.contains(&"Commit 3"));

    // 4. Test include_stash
    let mut walker_stash = GraphWalker::new(
        repo.clone(),
        GraphFilter {
            include_stash: true,
            ..Default::default()
        },
    )
    .unwrap();
    let page_stash = walker_stash.next_page(100).unwrap();
    let has_stash_commit = page_stash
        .commits
        .iter()
        .any(|c| c.refs.iter().any(|r| r.kind == RefKind::Stash));
    assert!(has_stash_commit);

    // 5. Test walker reset
    walker_paged.reset().unwrap();
    let reset_page1 = walker_paged.next_page(3).unwrap();
    assert_eq!(reset_page1.commits.len(), 3);
    assert!(reset_page1.has_more);
}

#[test]
fn test_walker_with_submodule() {
    let sub_dir = TempDir::new().unwrap();
    let sub_path = sub_dir.path();
    run_git(sub_path, &["init", "-b", "main"]);
    std::fs::write(sub_path.join("sub.txt"), "sub content\n").unwrap();
    run_git(sub_path, &["add", "sub.txt"]);
    run_git(sub_path, &["commit", "-m", "sub init"]);

    let parent_dir = TempDir::new().unwrap();
    let parent_path = parent_dir.path();
    run_git(parent_path, &["init", "-b", "main"]);
    std::fs::write(parent_path.join("root.txt"), "root content\n").unwrap();
    run_git(parent_path, &["add", "root.txt"]);
    run_git(parent_path, &["commit", "-m", "parent init"]);

    let sub_str = sub_path.to_str().unwrap();
    run_git(
        parent_path,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            sub_str,
            "my-sub",
        ],
    );
    run_git(parent_path, &["commit", "-am", "add submodule"]);

    let repo = ReadRepo::open(parent_path).expect("open repo with submodule");
    let mut walker = GraphWalker::new(repo, GraphFilter::default()).expect("create walker");
    let page = walker.next_page(10).expect("read graph page");
    assert_eq!(page.commits.len(), 2);
    assert_eq!(page.commits[0].subject, "add submodule");
    assert_eq!(page.commits[1].subject, "parent init");
}

#[test]
fn test_walker_skips_refs_pointing_to_non_commits() {
    let dir = TempDir::new().unwrap();
    let repo_dir = dir.path();

    run_git(repo_dir, &["init", "-b", "main"]);
    std::fs::write(repo_dir.join("file.txt"), "c1\n").unwrap();
    run_git(repo_dir, &["add", "file.txt"]);
    run_git(repo_dir, &["commit", "-m", "Commit 1"]);
    std::fs::write(repo_dir.join("file.txt"), "c2\n").unwrap();
    run_git(repo_dir, &["commit", "-am", "Commit 2"]);

    // Lightweight and annotated tags that point at a tree and a blob, not a commit.
    run_git(repo_dir, &["tag", "tree-tag", "HEAD^{tree}"]);
    run_git(
        repo_dir,
        &[
            "tag",
            "-a",
            "annotated-tree-tag",
            "-m",
            "tree",
            "HEAD^{tree}",
        ],
    );
    run_git(repo_dir, &["tag", "blob-tag", "HEAD:file.txt"]);

    let repo = ReadRepo::open(repo_dir).unwrap();

    for force_fallback in [false, true] {
        let mut walker = GraphWalker::new(repo.clone(), GraphFilter::default())
            .unwrap()
            .with_forced_fallback(force_fallback);
        let page = walker.next_page(100).unwrap();
        let subjects: Vec<_> = page.commits.iter().map(|c| c.subject.as_str()).collect();
        assert_eq!(
            subjects,
            vec!["Commit 2", "Commit 1"],
            "fallback={force_fallback}"
        );
    }
}
