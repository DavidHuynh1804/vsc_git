use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use std::thread;

use parking_lot::RwLock;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;
use vsc_ipc::{
    create_listener, IpcListener, IpcRequest, IpcRequestKind, IpcResponse, LocalSocketStream,
};

use crate::error::AppError;

#[derive(Serialize, Deserialize, Debug, Clone, Type, tauri_specta::Event, PartialEq, Eq)]
#[tauri_specta(event_name = "prompt://request")]
pub struct PromptRequestEvent {
    pub id: String,
    pub kind: String,
    pub prompt: String,
}

struct PendingPromptEntry {
    kind: String,
    tx: Sender<Option<String>>,
}

#[derive(Default)]
pub struct PendingPrompts {
    prompts: RwLock<HashMap<String, PendingPromptEntry>>,
}

impl PendingPrompts {
    pub fn new() -> Self {
        Self {
            prompts: RwLock::new(HashMap::new()),
        }
    }

    pub fn insert(&self, id: String, kind: String, tx: Sender<Option<String>>) {
        self.prompts
            .write()
            .insert(id, PendingPromptEntry { kind, tx });
    }

    pub fn answer(&self, id: &str, val: Option<String>) -> bool {
        if let Some(entry) = self.prompts.write().remove(id) {
            let _ = entry.tx.send(val);
            true
        } else {
            false
        }
    }

    pub fn answer_by_kind(&self, kind: &str, val: Option<String>) -> bool {
        let mut map = self.prompts.write();
        let target_key = map.iter().find_map(|(k, v)| {
            if v.kind == kind {
                Some(k.clone())
            } else {
                None
            }
        });
        if let Some(key) = target_key {
            if let Some(entry) = map.remove(&key) {
                let _ = entry.tx.send(val);
                return true;
            }
        }
        false
    }
}

pub fn get_pending_prompts() -> &'static PendingPrompts {
    static PROMPTS: parking_lot::RwLock<Option<PendingPrompts>> = parking_lot::RwLock::new(None);

    if let Some(p) = PROMPTS.read().as_ref() {
        return unsafe { &*(p as *const PendingPrompts) };
    }

    let mut lock = PROMPTS.write();
    if lock.is_none() {
        *lock = Some(PendingPrompts::new());
    }
    unsafe { &*(lock.as_ref().unwrap() as *const PendingPrompts) }
}

pub fn get_or_start_ipc(app: AppHandle) -> Result<(), AppError> {
    if get_ipc_server_slot().read().is_some() {
        return Ok(());
    }
    let server = IpcServer::start(app)?;
    *get_ipc_server_slot().write() = Some(server);
    Ok(())
}

fn get_ipc_server_slot() -> &'static parking_lot::RwLock<Option<IpcServer>> {
    static SERVER: parking_lot::RwLock<Option<IpcServer>> = parking_lot::RwLock::new(None);
    &SERVER
}

pub fn get_ipc_addr_token() -> Option<(String, String)> {
    get_ipc_server_slot()
        .read()
        .as_ref()
        .map(|s| (s.addr.clone(), s.token.clone()))
}

#[tauri::command]
#[specta::specta]
pub fn answer_prompt(_app: AppHandle, id: String, value: Option<String>) -> Result<(), AppError> {
    answer_prompt_value(&id, value);
    Ok(())
}

pub fn answer_prompt_value(id: &str, value: Option<String>) -> bool {
    get_pending_prompts().answer(id, value)
}

/// Constant-time string equality check to prevent timing attacks on IPC token.
pub fn constant_time_eq(a: &str, b: &str) -> bool {
    let a_bytes = a.as_bytes();
    let b_bytes = b.as_bytes();
    if a_bytes.len() != b_bytes.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a_bytes.iter().zip(b_bytes.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Generates a cryptographically random 32-byte (64 hex characters) token.
pub fn generate_ipc_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let mut hex = String::with_capacity(64);
    for b in bytes {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{b:02x}");
    }
    hex
}

pub struct IpcServer {
    pub addr: String,
    pub token: String,
    running: Arc<AtomicBool>,
    _temp_dir: Option<tempfile::TempDir>,
}

pub type PromptEmitter = Arc<dyn Fn(&PromptRequestEvent) + Send + Sync>;

impl IpcServer {
    pub fn start_with_emitter(emitter: PromptEmitter) -> Result<Self, AppError> {
        let token = generate_ipc_token();

        #[cfg(unix)]
        let (temp_dir, addr) = {
            use std::os::unix::fs::PermissionsExt;
            let dir = tempfile::Builder::new()
                .prefix("vsc_git_ipc_")
                .tempdir()
                .map_err(|e| AppError::internal(format!("Failed to create IPC temp dir: {e}")))?;
            let _ = std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700));
            let sock_path = dir.path().join("ipc.sock");
            let addr = sock_path.to_string_lossy().to_string();
            (Some(dir), addr)
        };

        #[cfg(windows)]
        let (temp_dir, addr) = {
            let pipe_name = format!("vsc_git_ipc_{}", Uuid::new_v4().simple());
            (None, pipe_name)
        };

        let listener = create_listener(&addr)
            .map_err(|e| AppError::internal(format!("Failed to create IPC listener: {e}")))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(
                std::path::Path::new(&addr),
                std::fs::Permissions::from_mode(0o600),
            );
        }

        let running = Arc::new(AtomicBool::new(true));
        let running_clone = running.clone();
        let expected_token = token.clone();

        thread::Builder::new()
            .name("ipc-server".into())
            .spawn(move || {
                let _ = run_listener_loop(listener, expected_token, emitter, running_clone);
            })
            .map_err(|e| AppError::internal(format!("Failed to spawn IPC listener thread: {e}")))?;

        Ok(Self {
            addr,
            token,
            running,
            _temp_dir: temp_dir,
        })
    }

    pub fn start(app: AppHandle) -> Result<Self, AppError> {
        Self::start_with_emitter(Arc::new(move |evt| {
            let _ = app.emit("prompt://request", evt);
        }))
    }

    pub fn start_standalone() -> Result<Self, AppError> {
        Self::start_with_emitter(Arc::new(|_| {}))
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }
}

fn run_listener_loop(
    listener: IpcListener,
    expected_token: String,
    emitter: PromptEmitter,
    running: Arc<AtomicBool>,
) -> std::io::Result<()> {
    while running.load(Ordering::SeqCst) {
        let conn = match listener.accept() {
            Ok(c) => c,
            Err(_) => {
                if !running.load(Ordering::SeqCst) {
                    break;
                }
                thread::sleep(std::time::Duration::from_millis(10));
                continue;
            }
        };

        let expected_token_clone = expected_token.clone();
        let emitter_clone = emitter.clone();

        thread::spawn(move || {
            let _ = handle_single_connection(conn, &expected_token_clone, emitter_clone);
        });
    }
    Ok(())
}

fn handle_single_connection(
    mut conn: LocalSocketStream,
    expected_token: &str,
    emitter: PromptEmitter,
) -> Result<(), AppError> {
    let mut line = String::new();
    {
        let mut reader = BufReader::new(&mut conn);
        reader
            .read_line(&mut line)
            .map_err(|e| AppError::internal(format!("IPC read failed: {e}")))?;
    }

    let req: IpcRequest = match serde_json::from_str(&line) {
        Ok(r) => r,
        Err(e) => {
            let resp = IpcResponse::error(format!("invalid request JSON: {e}"));
            let mut out = serde_json::to_string(&resp)?;
            out.push('\n');
            let _ = conn.write_all(out.as_bytes());
            let _ = conn.flush();
            return Ok(());
        }
    };

    if !constant_time_eq(&req.token, expected_token) {
        let resp = IpcResponse::error("unauthorized");
        let mut out = serde_json::to_string(&resp)?;
        out.push('\n');
        let _ = conn.write_all(out.as_bytes());
        let _ = conn.flush();
        return Ok(());
    }

    let prompt_id = Uuid::new_v4().to_string();
    let (kind_str, prompt_str) = match &req.kind {
        IpcRequestKind::AskPass { prompt } => ("askpass".to_string(), prompt.clone()),
        IpcRequestKind::SequenceEdit { todo } => ("sequence_editor".to_string(), todo.clone()),
        IpcRequestKind::EditMessage { text } => ("edit_message".to_string(), text.clone()),
    };

    let (tx, rx) = channel::<Option<String>>();
    get_pending_prompts().insert(prompt_id.clone(), kind_str.clone(), tx);

    emitter(&PromptRequestEvent {
        id: prompt_id.clone(),
        kind: kind_str,
        prompt: prompt_str,
    });

    let answer = rx.recv().ok().flatten();
    let resp = match answer {
        Some(val) => IpcResponse::ok(val),
        None => IpcResponse::cancel(),
    };

    let mut out = serde_json::to_string(&resp)?;
    out.push('\n');
    conn.write_all(out.as_bytes())
        .map_err(|e| AppError::internal(format!("IPC write failed: {e}")))?;
    conn.flush()
        .map_err(|e| AppError::internal(format!("IPC flush failed: {e}")))?;

    Ok(())
}

/// Locates a helper binary (such as `vsc-git-askpass` or `vsc-git-sequence-editor`)
/// in target directories or next to current executable.
pub fn find_helper_binary(name: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    let bin_name = format!("{name}.exe");
    #[cfg(not(windows))]
    let bin_name = name.to_string();

    // 1. Next to current executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidate = parent.join(&bin_name);
            if candidate.exists() {
                return candidate.canonicalize().ok().or(Some(candidate));
            }
        }
    }

    // 2. In workspace target/debug or target/release
    let candidates = [
        Path::new("target/debug").join(&bin_name),
        Path::new("target/release").join(&bin_name),
        Path::new("../target/debug").join(&bin_name),
        Path::new("../target/release").join(&bin_name),
    ];
    for c in &candidates {
        if c.exists() {
            return c.canonicalize().ok().or_else(|| Some(c.clone()));
        }
    }

    // 3. Check sidecar names with target triple
    let triples = [
        "aarch64-apple-darwin",
        "x86_64-apple-darwin",
        "x86_64-pc-windows-msvc",
    ];
    for t in triples {
        #[cfg(windows)]
        let sname = format!("{name}-{t}.exe");
        #[cfg(not(windows))]
        let sname = format!("{name}-{t}");

        let sidecar_candidates = [
            Path::new("src-tauri/binaries").join(&sname),
            Path::new("binaries").join(&sname),
            Path::new("../src-tauri/binaries").join(&sname),
        ];
        for sc in &sidecar_candidates {
            if sc.exists() {
                return sc.canonicalize().ok().or_else(|| Some(sc.clone()));
            }
        }
    }

    None
}

/// Injects environment variables for askpass and sequence-editor into `GitCli`.
pub fn setup_git_env(
    mut cli: git_core::GitCli,
    ipc_addr: &str,
    ipc_token: &str,
) -> git_core::GitCli {
    cli = cli
        .with_env(vsc_ipc::ENV_IPC_ADDR, ipc_addr)
        .with_env(vsc_ipc::ENV_IPC_TOKEN, ipc_token);

    if let Some(askpass_path) = find_helper_binary("vsc-git-askpass") {
        let p_str = askpass_path.to_string_lossy().to_string();
        cli = cli
            .with_env("GIT_ASKPASS", &p_str)
            .with_env("SSH_ASKPASS", &p_str)
            .with_env("SSH_ASKPASS_REQUIRE", "force");
    }

    if let Some(seq_path) = find_helper_binary("vsc-git-sequence-editor") {
        let cmd_str = vsc_ipc::git_editor_command(&seq_path);
        cli = cli
            .with_env("GIT_SEQUENCE_EDITOR", &cmd_str)
            .with_env("GIT_EDITOR", &cmd_str);
    }

    cli
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_constant_time_eq() {
        assert!(constant_time_eq("token123", "token123"));
        assert!(!constant_time_eq("token123", "token124"));
        assert!(!constant_time_eq("token123", "short"));
        assert!(!constant_time_eq("", "nonempty"));
        assert!(constant_time_eq("", ""));
    }

    #[test]
    fn test_generate_ipc_token() {
        let t1 = generate_ipc_token();
        let t2 = generate_ipc_token();
        assert_eq!(t1.len(), 64);
        assert_eq!(t2.len(), 64);
        assert_ne!(t1, t2);
    }

    #[test]
    fn test_pending_prompts() {
        let prompts = PendingPrompts::new();
        let (tx, rx) = channel::<Option<String>>();
        prompts.insert("p1".to_string(), "askpass".to_string(), tx);

        // Answering for sequence_editor does not answer an askpass prompt
        assert!(!prompts.answer_by_kind("sequence_editor", Some("rebase".to_string())));

        assert!(prompts.answer("p1", Some("secret".to_string())));
        assert_eq!(rx.recv().unwrap(), Some("secret".to_string()));

        assert!(!prompts.answer("p1", None));
    }
}
