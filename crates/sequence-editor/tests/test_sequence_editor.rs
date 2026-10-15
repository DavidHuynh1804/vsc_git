use git_core::{parse_rebase_todo, serialize_rebase_todo, RebaseAction};
use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::Duration;
use tempfile::tempdir;
use vsc_ipc::{
    create_listener, git_editor_command, handle_connection, IpcRequestKind, IpcResponse,
    ENV_IPC_ADDR, ENV_IPC_TOKEN,
};

/// Waits for the IPC server thread, failing instead of hanging if the editor never connected.
fn join_server(handle: JoinHandle<()>, done: mpsc::Receiver<()>) {
    done.recv_timeout(Duration::from_secs(30))
        .expect("sequence editor never connected to the IPC server");
    handle.join().unwrap();
}

fn run_git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .expect("git command failed");
    assert!(
        output.status.success(),
        "git {:?} failed: {:?}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn test_git_rebase_interactive_with_sequence_editor() {
    let dir = tempdir().unwrap();
    let repo_path = dir.path();

    run_git(repo_path, &["init"]);
    run_git(repo_path, &["config", "user.name", "Rebase Tester"]);
    run_git(repo_path, &["config", "user.email", "rebase@example.com"]);

    // C1: initial commit
    let f1 = repo_path.join("file1.txt");
    fs::write(&f1, "file 1 content\n").unwrap();
    run_git(repo_path, &["add", "."]);
    run_git(repo_path, &["commit", "-m", "commit 1"]);

    // C2: second commit
    let f2 = repo_path.join("file2.txt");
    fs::write(&f2, "file 2 content\n").unwrap();
    run_git(repo_path, &["add", "."]);
    run_git(repo_path, &["commit", "-m", "commit 2 to drop"]);

    // C3: third commit
    let f3 = repo_path.join("file3.txt");
    fs::write(&f3, "file 3 content\n").unwrap();
    run_git(repo_path, &["add", "."]);
    run_git(repo_path, &["commit", "-m", "commit 3 to keep"]);
    let sock_dir = tempdir().unwrap();
    let sock = sock_dir.path().join("rebase.sock");
    let addr = sock.to_str().unwrap().to_string();
    let token = "rebase-token-xyz".to_string();

    let listener = create_listener(&addr).unwrap();
    let token_clone = token.clone();

    // In background, handle the sequence editor request: drop commit 2
    let (done_tx, done_rx) = mpsc::channel();
    let server_handle = std::thread::spawn(move || {
        let conn = listener.accept().unwrap();
        handle_connection(conn, &token_clone, |kind| match kind {
            IpcRequestKind::SequenceEdit { todo } => {
                let mut entries = parse_rebase_todo(&todo);
                assert_eq!(entries.len(), 2);
                assert!(entries[0].subject.contains("commit 2"));
                assert!(entries[1].subject.contains("commit 3"));

                // Drop commit 2
                entries[0].action = RebaseAction::Drop;

                let new_todo = serialize_rebase_todo(&entries);
                IpcResponse::ok(new_todo)
            }
            other => panic!("Unexpected request kind: {:?}", other),
        })
        .unwrap();
        let _ = done_tx.send(());
    });

    let bin_path = env!("CARGO_BIN_EXE_vsc-git-sequence-editor");

    // Execute git rebase -i HEAD~2
    let output = Command::new("git")
        .args(["rebase", "-i", "HEAD~2"])
        .current_dir(repo_path)
        .env(
            "GIT_SEQUENCE_EDITOR",
            git_editor_command(Path::new(bin_path)),
        )
        .env(ENV_IPC_ADDR, &addr)
        .env(ENV_IPC_TOKEN, &token)
        .output()
        .expect("git rebase failed to spawn");

    assert!(
        output.status.success(),
        "rebase failed: {:?}",
        String::from_utf8_lossy(&output.stderr)
    );
    join_server(server_handle, done_rx);

    // Verify commit history: "commit 2 to drop" should not be in git log
    let log_output = Command::new("git")
        .args(["log", "--oneline"])
        .current_dir(repo_path)
        .output()
        .unwrap();
    let log = String::from_utf8_lossy(&log_output.stdout);
    assert!(!log.contains("commit 2 to drop"));
    assert!(log.contains("commit 3 to keep"));
    assert!(log.contains("commit 1"));
}

#[test]
fn test_sequence_editor_commit_editmsg() {
    let dir = tempdir().unwrap();
    let sock = dir.path().join("commit_msg.sock");
    let addr = sock.to_str().unwrap().to_string();
    let token = "msg-token".to_string();

    let listener = create_listener(&addr).unwrap();
    let token_clone = token.clone();

    let (done_tx, done_rx) = mpsc::channel();
    let server_handle = std::thread::spawn(move || {
        let conn = listener.accept().unwrap();
        handle_connection(conn, &token_clone, |kind| match kind {
            IpcRequestKind::EditMessage { text } => {
                assert_eq!(text, "Old Message\n");
                IpcResponse::ok("New Message Edited\n")
            }
            other => panic!("Unexpected kind: {:?}", other),
        })
        .unwrap();
        let _ = done_tx.send(());
    });

    let msg_file = dir.path().join("COMMIT_EDITMSG");
    fs::write(&msg_file, "Old Message\n").unwrap();

    let bin_path = env!("CARGO_BIN_EXE_vsc-git-sequence-editor");
    let output = Command::new(bin_path)
        .arg(&msg_file)
        .env(ENV_IPC_ADDR, &addr)
        .env(ENV_IPC_TOKEN, &token)
        .output()
        .unwrap();

    assert!(output.status.success());
    let new_content = fs::read_to_string(&msg_file).unwrap();
    assert_eq!(new_content, "New Message Edited\n");
    join_server(server_handle, done_rx);
}
#[test]
fn test_git_rebase_cancelled_by_user() {
    let dir = tempdir().unwrap();
    let repo_path = dir.path();

    run_git(repo_path, &["init"]);
    run_git(repo_path, &["config", "user.name", "Cancel Tester"]);
    run_git(repo_path, &["config", "user.email", "cancel@example.com"]);

    let f = repo_path.join("file.txt");
    fs::write(&f, "commit 1\n").unwrap();
    run_git(repo_path, &["add", "."]);
    run_git(repo_path, &["commit", "-m", "commit 1"]);

    fs::write(&f, "commit 2\n").unwrap();
    run_git(repo_path, &["commit", "-am", "commit 2"]);

    let sock_dir = tempdir().unwrap();
    let sock = sock_dir.path().join("cancel.sock");
    let addr = sock.to_str().unwrap().to_string();
    let token = "cancel-token".to_string();

    let listener = create_listener(&addr).unwrap();
    let token_clone = token.clone();

    // Return cancel from user
    let (done_tx, done_rx) = mpsc::channel();
    let server_handle = std::thread::spawn(move || {
        let conn = listener.accept().unwrap();
        handle_connection(conn, &token_clone, |_| IpcResponse::cancel()).unwrap();
        let _ = done_tx.send(());
    });

    let bin_path = env!("CARGO_BIN_EXE_vsc-git-sequence-editor");
    let output = Command::new("git")
        .args(["rebase", "-i", "HEAD~1"])
        .current_dir(repo_path)
        .env(
            "GIT_SEQUENCE_EDITOR",
            git_editor_command(Path::new(bin_path)),
        )
        .env(ENV_IPC_ADDR, &addr)
        .env(ENV_IPC_TOKEN, &token)
        .output()
        .expect("git rebase execution failed");

    // Rebase should fail/abort because editor returned exit 1
    assert!(!output.status.success());
    join_server(server_handle, done_rx);
}
