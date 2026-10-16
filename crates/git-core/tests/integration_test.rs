use git_core::{
    apply_ranges, checkout, checkout_detached, commit, create_branch, create_tag, delete_branch,
    delete_tag, discard, fetch, file_content, last_commit_message, list_refs, op_abort,
    operation_state, pull, push, rename_branch, set_upstream, stage, stage_all, stash_apply,
    stash_drop, stash_list, stash_pop, stash_push, stash_show, status, unified_diff, unstage,
    unstage_all, ApplyMode, CommandOptions, CommitOptions, ErrorKind, FetchTarget, FileRev,
    FileStatus, GitCli, GitOutput, LineSelection, OperationKind, OperationState, PullMode,
    PushOptions, RefKind, StashPushOptions, StatusEntryKind,
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
            &["config", "core.autocrlf", "false"],
            CommandOptions::default(),
        )
        .expect("config autocrlf");
        cli.exec(
            &path,
            &["config", "core.eol", "lf"],
            CommandOptions::default(),
        )
        .expect("config eol");
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
        &[LineSelection::modified(4, 4)],
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
        &[LineSelection::modified(4, 4)],
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
        &[LineSelection::original(2, 2), LineSelection::modified(2, 2)],
        ApplyMode::Revert,
    )
    .unwrap();

    // File in working tree should have line 2 reverted to original "line2", but still keep "line4_new"
    let current_content = repo.read_file("doc.txt");
    assert_eq!(current_content, "line1\nline2\nline3\nline4_new\n");
}

#[test]
fn test_integration_crlf_apply_ranges() {
    let repo = TestRepo::new();
    repo.git(&["config", "core.autocrlf", "false"]);

    // Initial file with CRLF line endings
    let initial_content = "line1\r\nline2\r\nline3\r\n";
    repo.write_file("crlf.txt", initial_content);

    stage_all(&repo.cli, repo.path()).unwrap();
    repo.git(&["commit", "-m", "add crlf.txt"]);

    // Modify 2 lines: line 2 modified, and add line 4
    let modified_content = "line1\r\nline2_mod\r\nline3\r\nline4_new\r\n";
    repo.write_file("crlf.txt", modified_content);

    // Stage ONLY line 4 (+line4_new)
    apply_ranges(
        &repo.cli,
        repo.path(),
        "crlf.txt",
        &[LineSelection::modified(4, 4)],
        ApplyMode::Stage,
    )
    .unwrap();

    // Check git diff --cached
    let cached_diff = repo.git(&["diff", "--cached"]).stdout_lossy();
    assert!(cached_diff.contains("+line4_new"));
    assert!(!cached_diff.contains("line2_mod"));

    // Check file in index via `git show :crlf.txt` bytes
    let index_bytes = repo.git(&["show", ":crlf.txt"]).stdout;
    assert_eq!(index_bytes, b"line1\r\nline2\r\nline3\r\nline4_new\r\n");
}

#[test]
fn test_integration_commit_amend_and_options() {
    let repo = TestRepo::new();
    repo.write_file("file.txt", "content 1\n");
    stage_all(&repo.cli, repo.path()).unwrap();

    // 1. Initial commit
    commit(
        &repo.cli,
        repo.path(),
        CommitOptions::new("feat: initial commit"),
    )
    .unwrap();
    assert_eq!(
        last_commit_message(&repo.cli, repo.path()).unwrap(),
        "feat: initial commit"
    );

    // 2. Amend commit with signoff
    repo.write_file("file.txt", "content 2\n");
    stage_all(&repo.cli, repo.path()).unwrap();
    commit(
        &repo.cli,
        repo.path(),
        CommitOptions {
            message: "feat: amended commit".into(),
            amend: true,
            signoff: true,
            no_verify: false,
            all: false,
        },
    )
    .unwrap();

    let msg = last_commit_message(&repo.cli, repo.path()).unwrap();
    assert!(msg.starts_with("feat: amended commit"));
    assert!(msg.contains("Signed-off-by: Integration Tester <integration@test.com>"));
}

#[test]
fn test_integration_branch_and_tag_ops() {
    let repo = TestRepo::new();
    repo.write_file("file.txt", "base\n");
    stage_all(&repo.cli, repo.path()).unwrap();
    commit(&repo.cli, repo.path(), CommitOptions::new("base commit")).unwrap();

    // Create branch and list
    create_branch(&repo.cli, repo.path(), "feature", None).unwrap();
    let refs = list_refs(&repo.cli, repo.path()).unwrap();
    assert_eq!(refs.len(), 2);
    // Set upstream and checkout feature
    set_upstream(&repo.cli, repo.path(), Some("feature"), "main").unwrap();
    checkout(&repo.cli, repo.path(), "feature").unwrap();
    let cur_refs = list_refs(&repo.cli, repo.path()).unwrap();
    let cur_branch = cur_refs.iter().find(|r| r.is_head).unwrap();
    assert_eq!(cur_branch.name, "feature");

    // Checkout detached
    let commit_id = cur_branch.commit_id.clone();
    checkout_detached(&repo.cli, repo.path(), &commit_id).unwrap();

    // Rename and delete
    checkout(&repo.cli, repo.path(), "main").unwrap();
    rename_branch(&repo.cli, repo.path(), Some("feature"), "feat-new").unwrap();
    delete_branch(&repo.cli, repo.path(), "feat-new", false).unwrap();

    // Tag create & delete
    create_tag(&repo.cli, repo.path(), "v1.0", None, None).unwrap();
    create_tag(&repo.cli, repo.path(), "v2.0", None, Some("release 2.0")).unwrap();
    let refs_with_tags = list_refs(&repo.cli, repo.path()).unwrap();
    let tags: Vec<_> = refs_with_tags
        .iter()
        .filter(|r| r.kind == RefKind::Tag)
        .collect();
    assert_eq!(tags.len(), 2);

    delete_tag(&repo.cli, repo.path(), "v1.0").unwrap();
    let final_refs = list_refs(&repo.cli, repo.path()).unwrap();
    let remaining_tags: Vec<_> = final_refs
        .iter()
        .filter(|r| r.kind == RefKind::Tag)
        .collect();
    assert_eq!(remaining_tags.len(), 1);
    assert_eq!(remaining_tags[0].name, "v2.0");
}

#[test]
fn test_integration_stash_push_pop_untracked() {
    let repo = TestRepo::new();
    repo.write_file("file.txt", "v1\n");
    stage_all(&repo.cli, repo.path()).unwrap();
    commit(&repo.cli, repo.path(), CommitOptions::new("initial commit")).unwrap();

    // Modify tracked file and add untracked file
    repo.write_file("file.txt", "v2\n");
    repo.write_file("new_file.txt", "untracked content\n");

    // Stash with untracked
    stash_push(
        &repo.cli,
        repo.path(),
        StashPushOptions::new()
            .with_message("wip changes")
            .with_untracked(true),
    )
    .unwrap();

    // Working tree should be clean
    let st = status(&repo.cli, repo.path()).unwrap();
    assert_eq!(st.unstaged().len(), 0);
    assert_eq!(st.untracked().len(), 0);
    assert_eq!(repo.read_file("file.txt"), "v1\n");
    assert!(!repo.path().join("new_file.txt").exists());

    // Check stash list and show
    let stashes = stash_list(&repo.cli, repo.path()).unwrap();
    assert_eq!(stashes.len(), 1);
    assert_eq!(stashes[0].message, "wip changes");
    let patch = stash_show(&repo.cli, repo.path(), None).unwrap();
    assert!(patch.contains("-v1"));
    assert!(patch.contains("+v2"));

    // Pop stash
    stash_pop(&repo.cli, repo.path(), None).unwrap();
    assert_eq!(repo.read_file("file.txt"), "v2\n");
    assert_eq!(repo.read_file("new_file.txt"), "untracked content\n");

    // List should be empty
    let stashes_empty = stash_list(&repo.cli, repo.path()).unwrap();
    assert!(stashes_empty.is_empty());

    // Test apply and drop
    stash_push(
        &repo.cli,
        repo.path(),
        StashPushOptions::new().with_message("stash to drop"),
    )
    .unwrap();
    stash_apply(&repo.cli, repo.path(), None).unwrap();
    assert_eq!(stash_list(&repo.cli, repo.path()).unwrap().len(), 1);
    stash_drop(&repo.cli, repo.path(), None).unwrap();
    assert!(stash_list(&repo.cli, repo.path()).unwrap().is_empty());
}

#[test]
fn test_integration_file_content_and_diff() {
    let repo = TestRepo::new();
    repo.write_file("doc.txt", "v1 content\n");
    stage_all(&repo.cli, repo.path()).unwrap();
    commit(&repo.cli, repo.path(), CommitOptions::new("initial commit")).unwrap();

    // Modify and stage
    repo.write_file("doc.txt", "v2 staged\n");
    stage_all(&repo.cli, repo.path()).unwrap();

    // Modify in worktree again
    repo.write_file("doc.txt", "v3 worktree\n");

    let head_bytes = file_content(&repo.cli, repo.path(), "doc.txt", FileRev::Head).unwrap();
    assert_eq!(head_bytes, b"v1 content\n");

    let index_bytes = file_content(&repo.cli, repo.path(), "doc.txt", FileRev::Index).unwrap();
    assert_eq!(index_bytes, b"v2 staged\n");

    let staged_diff = unified_diff(&repo.cli, repo.path(), Some("doc.txt"), true, 0).unwrap();
    assert!(staged_diff.contains("-v1 content"));
    assert!(staged_diff.contains("+v2 staged"));

    let unstaged_diff = unified_diff(&repo.cli, repo.path(), Some("doc.txt"), false, 0).unwrap();
    assert!(unstaged_diff.contains("-v2 staged"));
    assert!(unstaged_diff.contains("+v3 worktree"));
}

#[test]
fn test_integration_operation_state_merge_and_rebase_abort() {
    let repo = TestRepo::new();
    repo.write_file("file.txt", "base content\n");
    stage_all(&repo.cli, repo.path()).unwrap();
    commit(&repo.cli, repo.path(), CommitOptions::new("base commit")).unwrap();

    // Feature branch
    create_branch(&repo.cli, repo.path(), "feature", None).unwrap();
    checkout(&repo.cli, repo.path(), "feature").unwrap();
    repo.write_file("file.txt", "feature content\n");
    stage_all(&repo.cli, repo.path()).unwrap();
    commit(&repo.cli, repo.path(), CommitOptions::new("feat commit")).unwrap();

    // Main branch conflicting commit
    checkout(&repo.cli, repo.path(), "main").unwrap();
    repo.write_file("file.txt", "main content\n");
    stage_all(&repo.cli, repo.path()).unwrap();
    commit(&repo.cli, repo.path(), CommitOptions::new("main commit")).unwrap();

    // 1. Merge conflict
    let _ = repo.cli.exec_raw(
        repo.path(),
        &["merge", "feature"],
        CommandOptions::default(),
    );
    let merge_state = operation_state(&repo.cli, repo.path()).unwrap();
    assert!(matches!(merge_state, OperationState::Merging { .. }));
    assert_eq!(merge_state.kind(), Some(OperationKind::Merge));

    // Abort merge
    op_abort(&repo.cli, repo.path(), OperationKind::Merge).unwrap();
    assert_eq!(
        operation_state(&repo.cli, repo.path()).unwrap(),
        OperationState::None
    );

    // 2. Rebase conflict
    checkout(&repo.cli, repo.path(), "feature").unwrap();
    let _ = repo
        .cli
        .exec_raw(repo.path(), &["rebase", "main"], CommandOptions::default());
    let rebase_state = operation_state(&repo.cli, repo.path()).unwrap();
    assert!(matches!(rebase_state, OperationState::Rebasing { .. }));
    assert_eq!(rebase_state.kind(), Some(OperationKind::Rebase));
    if let OperationState::Rebasing { step, total, .. } = rebase_state {
        assert!(step >= 1);
        assert!(total >= 1);
    }

    // Abort rebase
    op_abort(&repo.cli, repo.path(), OperationKind::Rebase).unwrap();
    assert_eq!(
        operation_state(&repo.cli, repo.path()).unwrap(),
        OperationState::None
    );
}

#[test]
fn test_integration_sync_fetch_pull_push_non_fast_forward() {
    let bare_dir = tempdir().unwrap();
    let bare_path = bare_dir.path();
    let cli = GitCli::default();
    cli.exec(bare_path, &["init", "--bare"], CommandOptions::default())
        .unwrap();

    let bare_url = bare_path.to_string_lossy().to_string();

    // Repo 1
    let repo1 = TestRepo::new();
    repo1
        .cli
        .exec(
            repo1.path(),
            &["remote", "add", "origin", &bare_url],
            CommandOptions::default(),
        )
        .unwrap();
    repo1.write_file("file.txt", "v1\n");
    stage_all(&repo1.cli, repo1.path()).unwrap();
    commit(&repo1.cli, repo1.path(), CommitOptions::new("c1")).unwrap();

    // Push from repo 1 with set_upstream
    push(
        &repo1.cli,
        repo1.path(),
        PushOptions::new()
            .with_remote("origin")
            .with_branch("main")
            .with_upstream(true),
        None,
        None,
    )
    .unwrap();

    // Repo 2
    let repo2 = TestRepo::new();
    repo2
        .cli
        .exec(
            repo2.path(),
            &["remote", "add", "origin", &bare_url],
            CommandOptions::default(),
        )
        .unwrap();

    // Fetch in repo 2 with progress callback
    let progress_events = std::sync::Arc::new(parking_lot::Mutex::new(Vec::new()));
    let p_clone = progress_events.clone();
    fetch(
        &repo2.cli,
        repo2.path(),
        FetchTarget::Remote("origin".into()),
        true,
        Some(std::sync::Arc::new(move |p| {
            p_clone.lock().push(p);
        })),
        None,
    )
    .unwrap();

    // Pull into repo 2
    checkout(&repo2.cli, repo2.path(), "main").unwrap();
    pull(&repo2.cli, repo2.path(), PullMode::Default, None, None).unwrap();
    assert_eq!(repo2.read_file("file.txt"), "v1\n");

    // Repo 1 makes another commit and pushes
    repo1.write_file("file.txt", "v2 from repo1\n");
    stage_all(&repo1.cli, repo1.path()).unwrap();
    commit(&repo1.cli, repo1.path(), CommitOptions::new("c2")).unwrap();
    push(
        &repo1.cli,
        repo1.path(),
        PushOptions::new().with_remote("origin").with_branch("main"),
        None,
        None,
    )
    .unwrap();

    // Repo 2 makes a conflicting commit without pulling
    repo2.write_file("file.txt", "v2 conflicting from repo2\n");
    stage_all(&repo2.cli, repo2.path()).unwrap();
    commit(&repo2.cli, repo2.path(), CommitOptions::new("c2 conflict")).unwrap();

    // Repo 2 tries to push -> fails with NonFastForward
    let push_res = push(
        &repo2.cli,
        repo2.path(),
        PushOptions::new().with_remote("origin").with_branch("main"),
        None,
        None,
    );
    assert!(push_res.is_err());
    let err = push_res.unwrap_err();
    assert_eq!(err.kind, ErrorKind::NonFastForward);
}

#[test]
fn test_integration_repo_submodule_lifecycle() {
    let sub_repo = TestRepo::new();
    sub_repo.write_file("sub_file.txt", "submodule v1\n");
    stage_all(&sub_repo.cli, sub_repo.path()).unwrap();
    commit(
        &sub_repo.cli,
        sub_repo.path(),
        CommitOptions::new("submodule initial"),
    )
    .unwrap();

    let parent_repo = TestRepo::new();
    parent_repo.write_file("parent_file.txt", "parent v1\n");
    stage_all(&parent_repo.cli, parent_repo.path()).unwrap();
    commit(
        &parent_repo.cli,
        parent_repo.path(),
        CommitOptions::new("parent initial"),
    )
    .unwrap();

    // Add submodule with protocol.file.allow=always
    let sub_path_str = sub_repo.path().to_str().unwrap();
    parent_repo
        .cli
        .exec(
            parent_repo.path(),
            &[
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                sub_path_str,
                "my-submodule",
            ],
            CommandOptions::default(),
        )
        .expect("git submodule add");

    // Verify status shows submodule changes
    let st1 = status(&parent_repo.cli, parent_repo.path()).unwrap();
    let sub_entry = st1.entries.iter().find(|e| e.path == "my-submodule");
    assert!(
        sub_entry.is_some(),
        "Expected my-submodule in status entries"
    );
    let sub_e = sub_entry.unwrap();
    if let StatusEntryKind::Ordinary { submodule, .. } = &sub_e.kind {
        assert!(submodule.is_submodule, "Expected is_submodule to be true");
    } else {
        panic!("Expected Ordinary status entry for submodule");
    }

    // Stage and commit submodule in parent repo
    stage(
        &parent_repo.cli,
        parent_repo.path(),
        &[Path::new(".gitmodules"), Path::new("my-submodule")],
    )
    .unwrap();
    commit(
        &parent_repo.cli,
        parent_repo.path(),
        CommitOptions::new("add submodule pointer"),
    )
    .unwrap();

    // Check status is clean
    let st2 = status(&parent_repo.cli, parent_repo.path()).unwrap();
    assert_eq!(st2.staged().len(), 0);
    assert_eq!(st2.unstaged().len(), 0);

    // Make a new commit inside the submodule in parent repo
    let inner_sub_dir = parent_repo.path().join("my-submodule");
    fs::write(inner_sub_dir.join("sub_file.txt"), "submodule v2\n").unwrap();
    parent_repo
        .cli
        .exec(&inner_sub_dir, &["add", "."], CommandOptions::default())
        .expect("git add in submodule");
    parent_repo
        .cli
        .exec(
            &inner_sub_dir,
            &["commit", "-m", "submodule second commit"],
            CommandOptions::default(),
        )
        .expect("git commit in submodule");

    // Parent repo status now shows submodule modified (commit changed)
    let st3 = status(&parent_repo.cli, parent_repo.path()).unwrap();
    let modified_sub = st3.entries.iter().find(|e| e.path == "my-submodule");
    assert!(
        modified_sub.is_some(),
        "Expected my-submodule modified in status"
    );
    if let StatusEntryKind::Ordinary {
        unstaged,
        submodule,
        ..
    } = &modified_sub.unwrap().kind
    {
        assert_eq!(*unstaged, FileStatus::Modified);
        assert!(submodule.is_submodule);
        assert!(submodule.commit_changed || submodule.modified);
    } else {
        panic!("Expected Ordinary status entry with modified submodule");
    }

    // Stage updated submodule pointer and commit
    stage(
        &parent_repo.cli,
        parent_repo.path(),
        &[Path::new("my-submodule")],
    )
    .unwrap();
    let st4 = status(&parent_repo.cli, parent_repo.path()).unwrap();
    assert_eq!(st4.staged().len(), 1);
    assert_eq!(st4.staged()[0].path, "my-submodule");

    commit(
        &parent_repo.cli,
        parent_repo.path(),
        CommitOptions::new("update submodule to v2"),
    )
    .unwrap();

    // Status is clean again
    let st5 = status(&parent_repo.cli, parent_repo.path()).unwrap();
    assert_eq!(st5.staged().len(), 0);
    assert_eq!(st5.unstaged().len(), 0);

    // Verify git log works without error
    let log_out = parent_repo
        .cli
        .exec(
            parent_repo.path(),
            &["log", "--oneline", "-n", "5"],
            CommandOptions::default(),
        )
        .expect("git log on repo with submodule");
    assert_eq!(log_out.exit_code, 0);
    let stdout_str = String::from_utf8_lossy(&log_out.stdout);
    assert!(stdout_str.contains("update submodule to v2"));
    assert!(stdout_str.contains("add submodule pointer"));
}
