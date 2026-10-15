use std::process::Command;
use tempfile::tempdir;
use vsc_ipc::{
    create_listener, handle_connection, IpcRequestKind, IpcResponse, ENV_IPC_ADDR, ENV_IPC_TOKEN,
};

#[test]
fn test_askpass_binary_success_and_cancel() {
    let dir = tempdir().unwrap();
    let sock = dir.path().join("askpass.sock");
    let addr = sock.to_str().unwrap().to_string();
    let token = "test-token-12345".to_string();

    let bin_path = env!("CARGO_BIN_EXE_vsc-git-askpass");

    // 1. Success case
    {
        let listener = create_listener(&addr).unwrap();
        let token_clone = token.clone();
        let handle = std::thread::spawn(move || {
            let conn = listener.accept().unwrap();
            handle_connection(conn, &token_clone, |kind| match kind {
                IpcRequestKind::AskPass { prompt } => {
                    assert_eq!(prompt, "Password for repo:");
                    IpcResponse::ok("secret-pass")
                }
                _ => IpcResponse::error("wrong kind"),
            })
            .unwrap();
        });

        let output = Command::new(bin_path)
            .arg("Password for repo:")
            .env(ENV_IPC_ADDR, &addr)
            .env(ENV_IPC_TOKEN, &token)
            .output()
            .expect("Failed to execute askpass");

        assert!(output.status.success());
        assert_eq!(
            String::from_utf8_lossy(&output.stdout).trim(),
            "secret-pass"
        );
        handle.join().unwrap();
    }

    // 2. User cancel case -> exit 1
    {
        let listener = create_listener(&addr).unwrap();
        let token_clone = token.clone();
        let handle = std::thread::spawn(move || {
            let conn = listener.accept().unwrap();
            handle_connection(conn, &token_clone, |_| IpcResponse::cancel()).unwrap();
        });

        let output = Command::new(bin_path)
            .arg("Password for repo:")
            .env(ENV_IPC_ADDR, &addr)
            .env(ENV_IPC_TOKEN, &token)
            .output()
            .expect("Failed to execute askpass");

        assert_eq!(output.status.code(), Some(1));
        handle.join().unwrap();
    }
}
