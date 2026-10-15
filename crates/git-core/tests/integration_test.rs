use git_core::{
    apply_ranges, discard, stage, stage_all, status, unstage, unstage_all, ApplyMode,
    CommandOptions, FileStatus, GitCli, GitOutput, LineRange, StatusEntryKind,
};
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::{tempdir, TempDir};

struct TestRepo {
    _dir: TempDir,
    path: PathBuf,
    cli: GitCli,
}

impl TestRepo {
    fn new() -> Self {
        let dir = tempdir().expect("create temp dir");
        let path = dir.path().to_path_buf();
        let cli = GitCli::default();

        cli.exec(&path, &["init"], CommandOptions::default())
            .expect("git init");
        cli.exec(
            &path,
            &["config", "user.email", "integration@test.com"],
            CommandOptions::default(),
        )
        .expect("config email");
        cli.exec(
            &path,
            &["config", "user.name", "Integration Tester"],
            CommandOptions::default(),
        )
        .expect("config name");

        Self {
            _dir: dir,
            path,
            cli,
        }
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn write_file(&self, rel: &str, content: &str) {
        let full = self.path.join(rel);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(full, content).unwrap();
    }

    fn read_file(&self, rel: &str) -> String {
        fs::read_to_string(self.path.join(rel)).unwrap()
    }

    fn git(&self, args: &[&str]) -> GitOutput {
        self.cli
            .exec(self.path(), args, CommandOptions::default())
            .unwrap()
    }
}

#[test]
fn test_integration_repo_status_lifecycle() {
    let repo = TestRepo::new();

    // 1. Initial empty status
    let st0 = status(&repo.cli, repo.path()).unwrap();
    assert!(st0.branch.is_initial);
    assert_eq!(st0.entries.len(), 0);

    // 2. Untracked file
    repo.write_file("hello.txt", "world\n");
    let st1 = status(&repo.cli, repo.path()).unwrap();
    assert_eq!(st1.untracked().len(), 1);
    assert_eq!(st1.untracked()[0].path, "hello.txt");

    // 3. Stage untracked file
    stage(&repo.cli, repo.path(), &[Path::new("hello.txt")]).unwrap();
    let st2 = status(&repo.cli, repo.path()).unwrap();
    assert_eq!(st2.untracked().len(), 0);
    assert_eq!(st2.staged().len(), 1);
    assert_eq!(st2.staged()[0].path, "hello.txt");
    match &st2.staged()[0].kind {
        StatusEntryKind::Ordinary { staged, .. } => assert_eq!(*staged, FileStatus::Added),
        _ => panic!("Expected ordinary added entry"),
    }

    // 4. Commit
    repo.git(&["commit", "-m", "first commit"]);
    let st3 = status(&repo.cli, repo.path()).unwrap();
    assert!(!st3.branch.is_initial);
    assert!(st3.branch.oid.is_some());
    assert_eq!(st3.entries.len(), 0);

    // 5. Modify tracked file
    repo.write_file("hello.txt", "world modified\n");
    let st4 = status(&repo.cli, repo.path()).unwrap();
    assert_eq!(st4.unstaged().len(), 1);
    assert_eq!(st4.staged().len(), 0);

    // 6. Stage modification
    stage(&repo.cli, repo.path(), &[Path::new("hello.txt")]).unwrap();
    let st5 = status(&repo.cli, repo.path()).unwrap();
    assert_eq!(st5.unstaged().len(), 0);
    assert_eq!(st5.staged().len(), 1);

    // 7. Modify in worktree while staged (two-state file: M in index, M in worktree)
    repo.write_file("hello.txt", "world modified twice\n");
    let st6 = status(&repo.cli, repo.path()).unwrap();
    assert_eq!(st6.staged().len(), 1);
    assert_eq!(st6.unstaged().len(), 1);
}

#[test]
fn test_integration_stage_unstage_and_discard() {
    let repo = TestRepo::new();
    repo.write_file("file_a.txt", "A\n");
    repo.write_file("file_b.txt", "B\n");
    repo.write_file("file_c.txt", "C\n");

    // Stage subset
    stage(
        &repo.cli,
        repo.path(),
        &[Path::new("file_a.txt"), Path::new("file_b.txt")],
    )
    .unwrap();
    let st1 = status(&repo.cli, repo.path()).unwrap();
    assert_eq!(st1.staged().len(), 2);
    assert_eq!(st1.untracked().len(), 1);

    // Unstage file_a without commit (uses git rm --cached)
    unstage(&repo.cli, repo.path(), &[Path::new("file_a.txt")]).unwrap();
    let st2 = status(&repo.cli, repo.path()).unwrap();
    assert_eq!(st2.staged().len(), 1);
    assert_eq!(st2.staged()[0].path, "file_b.txt");
    assert_eq!(st2.untracked().len(), 2);

    // Stage all
    stage_all(&repo.cli, repo.path()).unwrap();
    let st3 = status(&repo.cli, repo.path()).unwrap();
    assert_eq!(st3.staged().len(), 3);
    assert_eq!(st3.untracked().len(), 0);

    // Unstage all
    unstage_all(&repo.cli, repo.path()).unwrap();
    let st4 = status(&repo.cli, repo.path()).unwrap();
    assert_eq!(st4.staged().len(), 0);
    assert_eq!(st4.untracked().len(), 3);

    // Now commit all files
    stage_all(&repo.cli, repo.path()).unwrap();
    repo.git(&["commit", "-m", "initial commit"]);

    // Modify file_a and file_b
    repo.write_file("file_a.txt", "A modified\n");
    repo.write_file("file_b.txt", "B modified\n");
    let st5 = status(&repo.cli, repo.path()).unwrap();
    assert_eq!(st5.unstaged().len(), 2);

    // Discard file_a
    discard(&repo.cli, repo.path(), &[Path::new("file_a.txt")]).unwrap();
    assert_eq!(repo.read_file("file_a.txt"), "A\n");

    let st6 = status(&repo.cli, repo.path()).unwrap();
    assert_eq!(st6.unstaged().len(), 1);
    assert_eq!(st6.unstaged()[0].path, "file_b.txt");
}

#[test]
fn test_integration_single_line_stage_unstage_revert() {
    let repo = TestRepo::new();
    let initial_content = "line1\nline2\nline3\n";
    repo.write_file("doc.txt", initial_content);

    stage_all(&repo.cli, repo.path()).unwrap();
    repo.git(&["commit", "-m", "add doc.txt"]);

    // Modify line 2 and add line 4
    let modified_content = "line1\nline2_mod\nline3\nline4_new\n";
    repo.write_file("doc.txt", modified_content);

    // Verify unified diff -U0
    let diff = repo.git(&["diff", "-U0", "doc.txt"]).stdout_lossy();
    assert!(diff.contains("-line2"));
    assert!(diff.contains("+line2_mod"));
    assert!(diff.contains("+line4_new"));

    // Stage ONLY line 4 (+line4_new)
    apply_ranges(
        &repo.cli,
        repo.path(),
        "doc.txt",
        &[LineRange::new(4, 4)],
        ApplyMode::Stage,
    )
    .unwrap();

    // Verify git diff --cached contains ONLY line4_new, NOT line2_mod
    let cached_diff = repo.git(&["diff", "--cached"]).stdout_lossy();
    assert!(cached_diff.contains("+line4_new"));
    assert!(!cached_diff.contains("line2_mod"));

    // Verify working tree has line2_mod unstaged, but line4_new is staged
    let unstaged_diff = repo.git(&["diff", "-U0", "doc.txt"]).stdout_lossy();
    assert!(unstaged_diff.contains("line2_mod"));
    assert!(!unstaged_diff.contains("line4_new"));

    // Now unstage line 4
    apply_ranges(
        &repo.cli,
        repo.path(),
        "doc.txt",
        &[LineRange::new(4, 4)],
        ApplyMode::Unstage,
    )
    .unwrap();

    let cached_diff_empty = repo.git(&["diff", "--cached"]).stdout_lossy();
    assert!(cached_diff_empty.trim().is_empty());

    // Now revert line 2_mod in working tree
    apply_ranges(
        &repo.cli,
        repo.path(),
        "doc.txt",
        &[LineRange::new(2, 2)],
        ApplyMode::Revert,
    )
    .unwrap();

    // File in working tree should have line 2 reverted to original "line2", but still keep "line4_new"
    let current_content = repo.read_file("doc.txt");
    assert_eq!(current_content, "line1\nline2\nline3\nline4_new\n");
}
