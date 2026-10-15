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
fn to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        use std::fmt::Write;
        let _ = write!(s, "{:02x}", b);
    }
    s
}
/// Compares two strings in constant time to prevent timing attacks.
pub fn constant_time_eq(a: &str, b: &str) -> bool {
    use subtle::ConstantTimeEq;
    a.as_bytes().ct_eq(b.as_bytes()).into()
}

/// Generates a cryptographically secure random token (≥ 32 bytes from CSPRNG, hex encoded).
pub fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("CSPRNG failure while generating IPC token");
    to_hex(&bytes)
}

/// Generates an unpredictable IPC address for a new session.
///
/// On Unix, creates a dedicated directory with 0700 permissions under `$TMPDIR`
/// or `$XDG_RUNTIME_DIR` and returns the path to a socket file inside it.
/// On Windows, returns a named pipe path with an unpredictable random identifier (`\\.\pipe\vsc-git-<random>`).
pub fn new_session_addr() -> String {
    let mut rand_bytes = [0u8; 16];
    getrandom::getrandom(&mut rand_bytes).expect("CSPRNG failure while generating session address");
    let rand_id = to_hex(&rand_bytes);

    #[cfg(windows)]
    {
        format!(r"\\.\pipe\vsc-git-{}", rand_id)
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        let base_dir = std::env::var_os("XDG_RUNTIME_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        let session_dir = base_dir.join(format!("vsc-git-{}", rand_id));
        let mut builder = std::fs::DirBuilder::new();
        builder.mode(0o700);
        builder
            .create(&session_dir)
            .expect("failed to create secure session directory with 0700 permissions");
        session_dir
            .join("vsc-git.sock")
            .to_string_lossy()
            .into_owned()
    }

    #[cfg(not(any(windows, unix)))]
    {
        let base_dir = std::env::temp_dir();
        let session_dir = base_dir.join(format!("vsc-git-{}", rand_id));
        std::fs::create_dir_all(&session_dir).expect("failed to create session directory");
        session_dir
            .join("vsc-git.sock")
            .to_string_lossy()
            .into_owned()
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

pub const MAX_REQUEST_SIZE: usize = 4 * 1024 * 1024; // 4 MiB
pub const DEFAULT_READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

#[derive(Debug)]
pub struct IpcListener {
    listener: Option<LocalSocketListener>,
    addr: String,
    shutdown: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl IpcListener {
    pub fn addr(&self) -> &str {
        &self.addr
    }

    pub fn shutdown(&self) {
        self.shutdown
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }

    pub fn is_shutdown(&self) -> bool {
        self.shutdown.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn accept(&self) -> std::io::Result<LocalSocketStream> {
        use interprocess::local_socket::traits::Listener;
        loop {
            if self.is_shutdown() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Interrupted,
                    "IPC listener shut down",
                ));
            }
            let l = self.listener.as_ref().ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::Interrupted, "IPC listener shut down")
            })?;
            match l.accept() {
                Ok(stream) => {
                    use interprocess::local_socket::traits::Stream;
                    stream.set_nonblocking(false)?;
                    return Ok(stream);
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(20));
                }
                Err(e) => return Err(e),
            }
        }
    }

    pub fn accept_timeout(
        &self,
        timeout: std::time::Duration,
    ) -> std::io::Result<Option<LocalSocketStream>> {
        use interprocess::local_socket::traits::Listener;
        let start = std::time::Instant::now();
        loop {
            if self.is_shutdown() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Interrupted,
                    "IPC listener shut down",
                ));
            }
            let l = self.listener.as_ref().ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::Interrupted, "IPC listener shut down")
            })?;
            match l.accept() {
                Ok(stream) => {
                    use interprocess::local_socket::traits::Stream;
                    stream.set_nonblocking(false)?;
                    return Ok(Some(stream));
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if start.elapsed() >= timeout {
                        return Ok(None);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(20));
                }
                Err(e) => return Err(e),
            }
        }
    }
}

impl Drop for IpcListener {
    fn drop(&mut self) {
        self.shutdown();
        drop(self.listener.take());
        #[cfg(unix)]
        {
            let path = std::path::Path::new(&self.addr);
            if let Some(parent) = path.parent() {
                let base_dir = std::env::var_os("XDG_RUNTIME_DIR")
                    .map(std::path::PathBuf::from)
                    .unwrap_or_else(std::env::temp_dir);
                if parent.parent() == Some(&base_dir)
                    && parent
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.starts_with("vsc-git-"))
                        .unwrap_or(false)
                {
                    let _ = std::fs::remove_dir(parent);
                }
            }
        }
    }
}

/// Creates a new local socket listener at the given address with hardened permissions.
///
/// - Unix: verifies parent directory permissions restrict access (0700) or creates it with 0700,
///   sets socket file permissions to 0600, and cleans up on drop.
/// - Windows: configures named pipe with access restricted to current user (owner) only
///   and rejects remote network clients.
pub fn create_listener(addr: &str) -> Result<IpcListener, IpcError> {
    let name = to_socket_name(addr)?;
    #[allow(unused_mut)]
    let mut options = ListenerOptions::new().name(name).reclaim_name(true);

    #[cfg(windows)]
    {
        use interprocess::os::windows::local_socket::ListenerOptionsExt;
        use interprocess::os::windows::security_descriptor::SecurityDescriptor;
        let sddl = widestring::u16cstr!("D:P(A;;GA;;;OW)");
        let sd = SecurityDescriptor::deserialize(sddl).map_err(|e| {
            IpcError::Io(std::io::Error::other(format!(
                "failed to initialize security descriptor: {e}"
            )))
        })?;
        options = options.security_descriptor(sd);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let path = std::path::Path::new(addr);
        if let Some(parent) = path.parent() {
            if parent.exists() {
                let parent_meta = std::fs::metadata(parent)?;
                let mode = parent_meta.permissions().mode() & 0o777;
                if mode != 0o700 {
                    return Err(IpcError::Io(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        format!(
                            "IPC socket parent directory must have 0700 permissions (got 0{:o})",
                            mode
                        ),
                    )));
                }
            } else {
                use std::os::unix::fs::DirBuilderExt;
                let mut builder = std::fs::DirBuilder::new();
                builder.mode(0o700);
                builder.create(parent)?;
            }
        }
    }
    let listener = options.create_sync()?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let path = std::path::Path::new(addr);
        if path.exists() {
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        }
    }

    use interprocess::local_socket::traits::Listener;
    use interprocess::local_socket::ListenerNonblockingMode;
    listener.set_nonblocking(ListenerNonblockingMode::Accept)?;

    Ok(IpcListener {
        listener: Some(listener),
        addr: addr.to_string(),
        shutdown: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
    })
}

fn read_request_line(
    conn: &mut LocalSocketStream,
    timeout: std::time::Duration,
    max_size: usize,
) -> Result<String, IpcError> {
    let start = std::time::Instant::now();
    let deadline = start + timeout;

    #[cfg(unix)]
    {
        use interprocess::local_socket::traits::Stream;
        use std::io::Read;

        let _ = conn.set_nonblocking(false);
        let mut buf = Vec::new();
        let mut chunk = [0u8; 1024];

        loop {
            let now = std::time::Instant::now();
            if now >= deadline {
                return Err(IpcError::Io(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "request read timed out",
                )));
            }
            let remaining = deadline.saturating_duration_since(now);
            conn.set_recv_timeout(Some(remaining))?;

            let read_limit = (max_size + 1).saturating_sub(buf.len()) as u64;
            match (&mut *conn).take(read_limit).read(&mut chunk) {
                Ok(0) => {
                    if buf.is_empty() {
                        return Err(IpcError::Io(std::io::Error::new(
                            std::io::ErrorKind::UnexpectedEof,
                            "connection closed before request was received",
                        )));
                    }
                    break;
                }
                Ok(n) => {
                    buf.extend_from_slice(&chunk[..n]);
                    if buf.len() > max_size {
                        return Err(IpcError::CancelledOrFailed(
                            "request payload exceeds maximum size".to_string(),
                        ));
                    }
                    if buf.contains(&b'\n') {
                        break;
                    }
                }
                Err(e)
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut =>
                {
                    return Err(IpcError::Io(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "request read timed out",
                    )));
                }
                Err(e) => return Err(IpcError::Io(e)),
            }
        }

        String::from_utf8(buf)
            .map_err(|e| IpcError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e)))
    }

    #[cfg(windows)]
    {
        use interprocess::local_socket::traits::Stream;
        use std::io::Read;

        conn.set_nonblocking(true)?;
        let mut buf = Vec::new();
        let mut chunk = [0u8; 1024];

        let result = loop {
            if std::time::Instant::now() >= deadline {
                break Err(IpcError::Io(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "request read timed out",
                )));
            }

            let read_limit = (max_size + 1).saturating_sub(buf.len()) as u64;
            match (&mut *conn).take(read_limit).read(&mut chunk) {
                Ok(0) => {
                    if buf.is_empty() {
                        break Err(IpcError::Io(std::io::Error::new(
                            std::io::ErrorKind::UnexpectedEof,
                            "connection closed before request was received",
                        )));
                    }
                    break Ok(());
                }
                Ok(n) => {
                    buf.extend_from_slice(&chunk[..n]);
                    if buf.len() > max_size {
                        break Err(IpcError::CancelledOrFailed(
                            "request payload exceeds maximum size".to_string(),
                        ));
                    }
                    if buf.contains(&b'\n') {
                        break Ok(());
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
                Err(e) => break Err(IpcError::Io(e)),
            }
        };

        let _ = conn.set_nonblocking(false);
        result?;
        String::from_utf8(buf)
            .map_err(|e| IpcError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e)))
    }

    #[cfg(not(any(unix, windows)))]
    {
        use std::io::Read;
        let mut reader = BufReader::new((&mut *conn).take(max_size as u64 + 1));
        let mut line = String::new();
        let n = reader.read_line(&mut line)?;
        if n == 0 {
            return Err(IpcError::Io(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "connection closed before request was received",
            )));
        }
        if n > max_size || (!line.ends_with('\n') && n >= max_size) {
            return Err(IpcError::CancelledOrFailed(
                "request payload exceeds maximum size".to_string(),
            ));
        }
        Ok(line)
    }
}

/// Handles a single incoming connection with configurable timeout and max payload size.
pub fn handle_connection_with_timeout<F>(
    mut conn: LocalSocketStream,
    expected_token: &str,
    timeout: std::time::Duration,
    max_size: usize,
    handler: F,
) -> Result<(), IpcError>
where
    F: FnOnce(IpcRequestKind) -> IpcResponse,
{
    let line = match read_request_line(&mut conn, timeout, max_size) {
        Ok(l) => l,
        Err(IpcError::CancelledOrFailed(msg)) => {
            let resp = IpcResponse::error(&msg);
            if let Ok(mut out) = serde_json::to_string(&resp) {
                out.push('\n');
                let _ = conn.write_all(out.as_bytes());
                let _ = conn.flush();
            }
            return Err(IpcError::CancelledOrFailed(msg));
        }
        Err(e) => return Err(e),
    };

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

    let resp = if !constant_time_eq(&req.token, expected_token) {
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

/// Handles a single incoming connection: validates the auth token and executes the handler.
pub fn handle_connection<F>(
    conn: LocalSocketStream,
    expected_token: &str,
    handler: F,
) -> Result<(), IpcError>
where
    F: FnOnce(IpcRequestKind) -> IpcResponse,
{
    handle_connection_with_timeout(
        conn,
        expected_token,
        DEFAULT_READ_TIMEOUT,
        MAX_REQUEST_SIZE,
        handler,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use tempfile::tempdir;

    #[test]
    fn test_git_editor_command_quotes_path() {
        let cmd = git_editor_command(std::path::Path::new("/opt/my app/it's-editor"));
        assert_eq!(cmd, r"'/opt/my app/it'\''s-editor'");
    }

    #[test]
    fn test_ipc_echo_server() {
        let addr = new_session_addr();
        let token = "test-secret-token";

        let listener = create_listener(&addr).unwrap();
        let token_clone = token.to_string();
        let addr_clone = addr.clone();

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
            &addr_clone,
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
        let addr = new_session_addr();
        let listener = create_listener(&addr).unwrap();
        let server_thread = std::thread::spawn(move || {
            let conn = listener.accept().unwrap();
            handle_connection(conn, "correct-token", |_| IpcResponse::ok("ok")).unwrap();
        });

        let err = send_request_to(
            &addr,
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
    #[test]
    fn test_constant_time_eq() {
        assert!(constant_time_eq("secret_token_123", "secret_token_123"));
        assert!(constant_time_eq("", ""));
        assert!(!constant_time_eq("secret_token_123", "secret_token_124"));
        assert!(!constant_time_eq("secret_token_123", "secret_token_12"));
        assert!(!constant_time_eq("secret_token_12", "secret_token_123"));
        assert!(!constant_time_eq("", "secret"));
        assert!(!constant_time_eq("secret", ""));
    }

    #[test]
    fn test_generate_token_length_and_uniqueness() {
        let token1 = generate_token();
        let token2 = generate_token();
        assert_eq!(token1.len(), 64);
        assert_eq!(token2.len(), 64);
        assert_ne!(token1, token2);
        assert!(token1.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_new_session_addr() {
        let addr1 = new_session_addr();
        let addr2 = new_session_addr();
        assert_ne!(addr1, addr2);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let path = std::path::Path::new(&addr1);
            assert!(path.ends_with("vsc-git.sock"));
            let parent = path.parent().expect("parent directory must exist");
            assert!(parent.exists());
            let meta = std::fs::metadata(parent).expect("metadata must succeed");
            assert_eq!(meta.permissions().mode() & 0o777, 0o700);
            let _ = std::fs::remove_dir(parent);
            let p2 = std::path::Path::new(&addr2);
            if let Some(parent2) = p2.parent() {
                let _ = std::fs::remove_dir(parent2);
            }
        }

        #[cfg(windows)]
        {
            assert!(addr1.starts_with(r"\\.\pipe\vsc-git-"));
            assert!(addr2.starts_with(r"\\.\pipe\vsc-git-"));
        }
    }
    #[test]
    fn test_socket_permissions_and_cleanup_on_drop() {
        let addr = new_session_addr();
        let listener = create_listener(&addr).expect("create_listener failed");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let path = std::path::Path::new(&addr);
            assert!(path.exists());
            let meta = std::fs::metadata(path).expect("socket metadata");
            assert_eq!(meta.permissions().mode() & 0o777, 0o600);

            let parent = path.parent().expect("parent dir");
            let parent_meta = std::fs::metadata(parent).expect("parent metadata");
            assert_eq!(parent_meta.permissions().mode() & 0o777, 0o700);

            drop(listener);
            assert!(!path.exists());
        }

        #[cfg(not(unix))]
        {
            drop(listener);
        }
    }

    #[test]
    fn test_ipc_request_too_large() {
        let addr = new_session_addr();
        let listener = create_listener(&addr).unwrap();
        let addr_clone = addr.clone();

        let server_thread = std::thread::spawn(move || {
            let conn = listener.accept().unwrap();
            let res = handle_connection_with_timeout(
                conn,
                "test-tok",
                std::time::Duration::from_secs(2),
                64,
                |_| IpcResponse::ok("ok"),
            );
            assert!(res.is_err());
        });

        let name = to_socket_name(&addr_clone).unwrap();
        let mut client = Stream::connect(name).unwrap();
        let huge = "x".repeat(200);
        let req = format!(
            "{{\"token\":\"test-tok\",\"kind\":{{\"AskPass\":{{\"prompt\":\"{}\"}}}}}}\n",
            huge
        );
        client.write_all(req.as_bytes()).unwrap();
        client.flush().unwrap();

        server_thread.join().unwrap();
    }

    #[test]
    fn test_ipc_read_timeout() {
        let addr = new_session_addr();
        let listener = create_listener(&addr).unwrap();
        let addr_clone = addr.clone();

        let server_thread = std::thread::spawn(move || {
            let conn = listener.accept().unwrap();
            let res = handle_connection_with_timeout(
                conn,
                "test-tok",
                std::time::Duration::from_millis(100),
                1024,
                |_| IpcResponse::ok("ok"),
            );
            assert!(res.is_err());
        });

        let name = to_socket_name(&addr_clone).unwrap();
        let _client = Stream::connect(name).unwrap();
        server_thread.join().unwrap();
    }
    #[test]
    fn test_ipc_slow_trickle_timeout() {
        let addr = new_session_addr();
        let listener = create_listener(&addr).unwrap();
        let addr_clone = addr.clone();

        let server_thread = std::thread::spawn(move || {
            let conn = listener.accept().unwrap();
            let start = std::time::Instant::now();
            let res = handle_connection_with_timeout(
                conn,
                "test-tok",
                std::time::Duration::from_millis(150),
                1024,
                |_| IpcResponse::ok("ok"),
            );
            let elapsed = start.elapsed();
            assert!(res.is_err());
            // Overall deadline must terminate in ~150ms despite each read taking only 30ms (well before 30 * 30ms = 900ms)
            assert!(
                elapsed >= std::time::Duration::from_millis(140)
                    && elapsed < std::time::Duration::from_millis(600),
                "Elapsed {elapsed:?} outside expected deadline window"
            );
        });

        let name = to_socket_name(&addr_clone).unwrap();
        let mut client = Stream::connect(name).unwrap();
        // Client trickles 1 byte every 30ms without newline for 30 iterations (900ms total)
        for _ in 0..30 {
            if client.write_all(b"a").is_err() || client.flush().is_err() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        server_thread.join().unwrap();
    }

    #[test]
    fn test_insecure_parent_dir_rejected() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let dir = tempdir().unwrap();
            let insecure_dir = dir.path().join("insecure");
            std::fs::create_dir(&insecure_dir).unwrap();
            std::fs::set_permissions(&insecure_dir, std::fs::Permissions::from_mode(0o755))
                .unwrap();

            let sock_path = insecure_dir.join("test.sock");
            let res = create_listener(sock_path.to_str().unwrap());
            assert!(res.is_err());
            match res.unwrap_err() {
                IpcError::Io(e) => assert_eq!(e.kind(), std::io::ErrorKind::PermissionDenied),
                other => panic!("Expected PermissionDenied IO error, got: {:?}", other),
            }
        }
    }

    #[test]
    fn test_ipc_listener_shutdown_and_cancellation() {
        let addr = new_session_addr();
        let listener = std::sync::Arc::new(create_listener(&addr).unwrap());
        let listener_clone = std::sync::Arc::clone(&listener);

        let server_thread = std::thread::spawn(move || listener_clone.accept());

        std::thread::sleep(std::time::Duration::from_millis(60));
        listener.shutdown();

        let res = server_thread.join().unwrap();
        assert!(res.is_err());
        assert_eq!(res.unwrap_err().kind(), std::io::ErrorKind::Interrupted);
    }

    #[test]
    fn test_ipc_listener_accept_timeout() {
        let addr = new_session_addr();
        let listener = create_listener(&addr).unwrap();

        let res = listener
            .accept_timeout(std::time::Duration::from_millis(50))
            .unwrap();
        assert!(res.is_none());
    }
}
