use interprocess::local_socket::{
    prelude::*, GenericFilePath, Listener, ListenerOptions, Stream, ToFsName,
};
#[cfg(windows)]
use interprocess::local_socket::{GenericNamespaced, ToNsName};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};

pub const ENV_IPC_TOKEN: &str = "VSC_GIT_IPC_TOKEN";
pub const ENV_IPC_ADDR: &str = "VSC_GIT_IPC_ADDR";

pub type LocalSocketListener = Listener;
pub type LocalSocketStream = Stream;

#[derive(Debug, thiserror::Error)]
pub enum IpcError {
    #[error("Missing environment variable: {0}")]
    MissingEnv(&'static str),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Operation cancelled or failed: {0}")]
    CancelledOrFailed(String),
}

/// Request payload from helper binaries to the app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IpcRequest {
    pub token: String,
    pub kind: IpcRequestKind,
}

/// The specific IPC operation being requested.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum IpcRequestKind {
    AskPass { prompt: String },
    SequenceEdit { todo: String },
    EditMessage { text: String },
}

/// Response payload sent back from the app to the helper binary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IpcResponse {
    pub success: bool,
    #[serde(default)]
    pub data: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

impl IpcResponse {
    pub fn ok(data: impl Into<String>) -> Self {
        Self {
            success: true,
            data: Some(data.into()),
            error: None,
        }
    }

    pub fn cancel() -> Self {
        Self {
            success: false,
            data: None,
            error: Some("cancelled".to_string()),
        }
    }

    pub fn error(msg: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(msg.into()),
        }
    }
}

/// Converts an address string into a platform-appropriate local socket name.
pub fn to_socket_name(addr: &str) -> std::io::Result<interprocess::local_socket::Name<'_>> {
    #[cfg(windows)]
    {
        if addr.starts_with(r"\\.\pipe\") {
            addr.to_fs_name::<GenericFilePath>()
        } else {
            addr.to_ns_name::<GenericNamespaced>()
        }
    }
    #[cfg(unix)]
    {
        addr.to_fs_name::<GenericFilePath>()
    }
}

/// Formats a helper binary path as a `GIT_EDITOR` / `GIT_SEQUENCE_EDITOR` value.
///
/// Git runs editor commands through `sh`, which treats backslashes as escapes,
/// so Windows paths are converted to forward slashes and the path is quoted.
pub fn git_editor_command(path: &std::path::Path) -> String {
    #[allow(unused_mut)]
    let mut s = path.to_string_lossy().into_owned();
    #[cfg(windows)]
    {
        s = s.replace('\\', "/");
    }
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// Sends a request using `VSC_GIT_IPC_ADDR` and `VSC_GIT_IPC_TOKEN` from the environment.
pub fn send_request(kind: IpcRequestKind) -> Result<String, IpcError> {
    let addr = std::env::var(ENV_IPC_ADDR).map_err(|_| IpcError::MissingEnv(ENV_IPC_ADDR))?;
    let token = std::env::var(ENV_IPC_TOKEN).map_err(|_| IpcError::MissingEnv(ENV_IPC_TOKEN))?;
    send_request_to(&addr, &token, kind)
}

/// Sends a request to a specified socket address with a token and returns the reply string.
pub fn send_request_to(addr: &str, token: &str, kind: IpcRequestKind) -> Result<String, IpcError> {
    let name = to_socket_name(addr)?;
    let mut client = Stream::connect(name)?;

    let req = IpcRequest {
        token: token.to_string(),
        kind,
    };
    let mut json = serde_json::to_string(&req)?;
    json.push('\n');
    client.write_all(json.as_bytes())?;
    client.flush()?;

    let mut line = String::new();
    let mut reader = BufReader::new(&mut client);
    reader.read_line(&mut line)?;

    let resp: IpcResponse = serde_json::from_str(&line)?;
    if resp.success {
        Ok(resp.data.unwrap_or_default())
    } else {
        Err(IpcError::CancelledOrFailed(
            resp.error.unwrap_or_else(|| "operation failed".to_string()),
        ))
    }
}

pub struct IpcListener(pub LocalSocketListener);

impl IpcListener {
    pub fn accept(&self) -> std::io::Result<LocalSocketStream> {
        use interprocess::local_socket::traits::Listener;
        self.0.accept()
    }
}

/// Creates a new local socket listener at the given address.
pub fn create_listener(addr: &str) -> Result<IpcListener, IpcError> {
    let name = to_socket_name(addr)?;
    let listener = ListenerOptions::new().name(name).create_sync()?;
    Ok(IpcListener(listener))
}

/// Handles a single incoming connection: validates the auth token and executes the handler.
pub fn handle_connection<F>(
    mut conn: LocalSocketStream,
    expected_token: &str,
    handler: F,
) -> Result<(), IpcError>
where
    F: FnOnce(IpcRequestKind) -> IpcResponse,
{
    let mut line = String::new();
    {
        let mut reader = BufReader::new(&mut conn);
        reader.read_line(&mut line)?;
    }

    let req: IpcRequest = match serde_json::from_str(&line) {
        Ok(r) => r,
        Err(e) => {
            let resp = IpcResponse::error(format!("invalid request JSON: {e}"));
            let mut out = serde_json::to_string(&resp)?;
            out.push('\n');
            conn.write_all(out.as_bytes())?;
            conn.flush()?;
            return Ok(());
        }
    };

    let resp = if req.token != expected_token {
        IpcResponse::error("unauthorized")
    } else {
        handler(req.kind)
    };

    let mut out = serde_json::to_string(&resp)?;
    out.push('\n');
    conn.write_all(out.as_bytes())?;
    conn.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_git_editor_command_quotes_path() {
        let cmd = git_editor_command(std::path::Path::new("/opt/my app/it's-editor"));
        assert_eq!(cmd, r"'/opt/my app/it'\''s-editor'");
    }

    #[test]
    fn test_ipc_echo_server() {
        let dir = tempdir().unwrap();
        let sock_path = dir.path().join("test.sock");
        let addr = sock_path.to_str().unwrap();
        let token = "test-secret-token";

        let listener = create_listener(addr).unwrap();
        let token_clone = token.to_string();

        let server_thread = std::thread::spawn(move || {
            let conn = listener.accept().unwrap();
            handle_connection(conn, &token_clone, |kind| match kind {
                IpcRequestKind::AskPass { prompt } => {
                    assert_eq!(prompt, "Password:");
                    IpcResponse::ok("supersecret")
                }
                _ => IpcResponse::error("unexpected kind"),
            })
            .unwrap();
        });

        let resp = send_request_to(
            addr,
            token,
            IpcRequestKind::AskPass {
                prompt: "Password:".to_string(),
            },
        )
        .unwrap();

        assert_eq!(resp, "supersecret");
        server_thread.join().unwrap();
    }

    #[test]
    fn test_ipc_unauthorized_token() {
        let dir = tempdir().unwrap();
        let sock_path = dir.path().join("unauth.sock");
        let addr = sock_path.to_str().unwrap();

        let listener = create_listener(addr).unwrap();
        let server_thread = std::thread::spawn(move || {
            let conn = listener.accept().unwrap();
            handle_connection(conn, "correct-token", |_| IpcResponse::ok("ok")).unwrap();
        });

        let err = send_request_to(
            addr,
            "wrong-token",
            IpcRequestKind::AskPass {
                prompt: "test".to_string(),
            },
        )
        .unwrap_err();

        match err {
            IpcError::CancelledOrFailed(msg) => assert_eq!(msg, "unauthorized"),
            other => panic!("Expected CancelledOrFailed, got: {:?}", other),
        }
        server_thread.join().unwrap();
    }
}
