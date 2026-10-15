use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tempfile::tempdir;
use vsc_git_lib::commands::branch::{fetch_impl, push_impl};
use vsc_git_lib::commands::status::{
    commit_impl, discard_impl, get_status_impl, last_commit_message_impl, stage_selections_impl,
};
use vsc_git_lib::commands::types::{AppCommitOptions, AppLineSelection, AppPushOptions, AppSide};
use vsc_git_lib::repo::ipc::{answer_prompt_value, IpcServer};
use vsc_git_lib::repo::session::RepoSession;

fn init_git_repo(path: &Path) {
    Command::new("git")
        .args(["init", "-b", "main"])
        .current_dir(path)
        .output()
        .expect("git init");

    Command::new("git")
        .args(["config", "user.name", "Test User"])
        .current_dir(path)
        .output()
        .expect("git config user.name");

    Command::new("git")
        .args(["config", "user.email", "test@example.com"])
        .current_dir(path)
        .output()
        .expect("git config user.email");
}

#[test]
fn test_status_stage_selections_commit() {
    let dir = tempdir().expect("tempdir");
    let repo_path = dir.path();
    init_git_repo(repo_path);

    // Initial commit
    let file_path = repo_path.join("file.txt");
    fs::write(&file_path, "line 1\nline 2\nline 3\n").expect("write file");
    Command::new("git")
        .args(["add", "file.txt"])
        .current_dir(repo_path)
        .output()
        .unwrap();
    Command::new("git")
        .args(["commit", "-m", "initial commit"])
        .current_dir(repo_path)
        .output()
        .unwrap();

    let session = RepoSession::new(repo_path.to_path_buf(), "main".to_string());

    // Modify file
    fs::write(
        &file_path,
        "line 1\nmodified line 2\nline 3\nadded line 4\n",
    )
    .expect("modify file");

    // 1. Check status
    let status = get_status_impl(&session).expect("get_status_impl");
    assert!(!status.entries.is_empty());
    assert!(status
        .entries
        .iter()
        .any(|e| e.path == "file.txt" && e.unstaged));

    // 2. Stage only line 2 modification using stage_selections_impl
    stage_selections_impl(
        &session,
        "file.txt",
        &[AppLineSelection {
            side: AppSide::Modified,
            start: 2,
            end: 2,
        }],
    )
    .expect("stage_selections_impl");

    // 3. Commit staged selection using commit_impl
    commit_impl(
        &session,
        AppCommitOptions {
            message: "commit selected lines".to_string(),
            amend: false,
            signoff: false,
            no_verify: false,
            all: false,
        },
    )
    .expect("commit_impl");

    // Verify last commit message
    let last_msg = last_commit_message_impl(&session).expect("last_commit_message_impl");
    assert!(last_msg.contains("commit selected lines"));
}

#[test]
fn test_discard_untracked() {
    let dir = tempdir().expect("tempdir");
    let repo_path = dir.path();
    init_git_repo(repo_path);

    // Initial commit
    let f1 = repo_path.join("tracked.txt");
    fs::write(&f1, "tracked content\n").unwrap();
    Command::new("git")
        .args(["add", "tracked.txt"])
        .current_dir(repo_path)
        .output()
        .unwrap();
    Command::new("git")
        .args(["commit", "-m", "init"])
        .current_dir(repo_path)
        .output()
        .unwrap();

    let session = RepoSession::new(repo_path.to_path_buf(), "main".to_string());

    // Configure test trash handler to avoid headless AppleScript timeout
    vsc_git_lib::commands::status::set_trash_handler_for_test(Some(|p| {
        let _ = std::fs::remove_file(p);
        Ok(())
    }));

    // Create an untracked file
    let untracked_file = repo_path.join("untracked_file.txt");
    fs::write(&untracked_file, "discard me please\n").unwrap();
    assert!(untracked_file.exists());

    // Discard untracked file via discard_impl (moves to trash)
    discard_impl(&session, &["untracked_file.txt".to_string()]).expect("discard_impl");

    // Reset test trash handler
    vsc_git_lib::commands::status::set_trash_handler_for_test(None);
    // Verify file is gone from repo working tree (moved to trash)
    assert!(!untracked_file.exists());
}

#[test]
fn test_fetch_push_bare_remote_and_cancel() {
    let dir = tempdir().expect("tempdir");
    let repo_path = dir.path().join("repo");
    let remote_path = dir.path().join("remote.git");
    fs::create_dir_all(&repo_path).unwrap();

    init_git_repo(&repo_path);

    // Initialize bare remote
    Command::new("git")
        .args(["init", "--bare", remote_path.to_str().unwrap()])
        .output()
        .expect("git init --bare");

    // Add remote
    Command::new("git")
        .args(["remote", "add", "origin", remote_path.to_str().unwrap()])
        .current_dir(&repo_path)
        .output()
        .expect("git remote add");

    // Initial commit
    fs::write(repo_path.join("hello.txt"), "hello\n").unwrap();
    Command::new("git")
        .args(["add", "hello.txt"])
        .current_dir(&repo_path)
        .output()
        .unwrap();
    Command::new("git")
        .args(["commit", "-m", "initial commit"])
        .current_dir(&repo_path)
        .output()
        .unwrap();

    let session = RepoSession::new(repo_path, "main".to_string());

    // 1. Push with progress callback tracking
    let progress_seen = Arc::new(AtomicBool::new(false));
    let progress_seen_clone = progress_seen.clone();
    let cb = Arc::new(move |_p: git_core::ops::Progress| {
        progress_seen_clone.store(true, Ordering::SeqCst);
    });

    let cancel_token = git_core::CancelToken::default();
    push_impl(
        &session,
        Some(AppPushOptions {
            remote: Some("origin".to_string()),
            branch: Some("main".to_string()),
            set_upstream: true,
            force_with_lease: false,
            tags: false,
        }),
        Some(cb),
        Some(cancel_token),
    )
    .expect("push_impl");

    // 2. Fetch with cancellation token
    let cancel_token_fetch = git_core::CancelToken::default();
    cancel_token_fetch.cancel(); // Pre-cancel to verify cancel handling
    let res = fetch_impl(
        &session,
        Some("origin".to_string()),
        None,
        Some(cancel_token_fetch),
    );

    // Cancelled fetch should return Cancelled error or error indicating cancellation
    assert!(res.is_err());
    let err = res.unwrap_err();
    assert_eq!(err.kind, vsc_git_lib::error::ErrorKind::Cancelled);
}

#[test]
fn test_askpass_ipc_roundtrip_with_real_binary() {
    // Build askpass binary first per requirement: `cargo build -p askpass`
    let status = Command::new("cargo")
        .args(["build", "-p", "askpass"])
        .status()
        .expect("cargo build -p askpass");
    assert!(status.success());

    let (prompt_tx, prompt_rx) = std::sync::mpsc::channel::<String>();

    // Start IPC server with callback emitter
    let server = IpcServer::start_with_emitter(Arc::new(move |evt| {
        let _ = prompt_tx.send(evt.id.clone());
    }))
    .expect("start ipc server");

    let ipc_addr = server.addr.clone();
    let ipc_token = server.token.clone();

    // Find the askpass binary
    let candidates = [
        PathBuf::from("target/debug/vsc-git-askpass"),
        PathBuf::from("../target/debug/vsc-git-askpass"),
    ];
    let bin_path = candidates
        .iter()
        .find(|p| p.exists())
        .expect("vsc-git-askpass binary exists");

    // Spawn a thread to answer the prompt as soon as it arrives
    thread::spawn(move || {
        if let Ok(prompt_id) = prompt_rx.recv_timeout(Duration::from_secs(5)) {
            answer_prompt_value(&prompt_id, Some("secret_password_123".to_string()));
        }
    });

    // Run the actual askpass binary with IPC environment
    let output = Command::new(bin_path)
        .arg("Password for 'https://github.com':")
        .env(vsc_ipc::ENV_IPC_ADDR, &ipc_addr)
        .env(vsc_ipc::ENV_IPC_TOKEN, &ipc_token)
        .output()
        .expect("run askpass binary");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert_eq!(stdout.trim(), "secret_password_123");
}
