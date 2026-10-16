use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use chrono::Utc;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Emitter};

use crate::error::AppError;

pub const MAX_RING_BUFFER_ENTRIES: usize = 5000;
static NEXT_OUTPUT_ID: AtomicU64 = AtomicU64::new(1);
static APP_HANDLE: RwLock<Option<AppHandle>> = RwLock::new(None);

pub fn set_global_app_handle(handle: AppHandle) {
    *APP_HANDLE.write() = Some(handle);
}

pub fn get_global_app_handle() -> Option<AppHandle> {
    APP_HANDLE.read().clone()
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
pub struct GitOutputEntry {
    pub id: u32,
    pub timestamp: f64,
    pub cmd: String,
    pub cwd: String,
    pub exit_code: i32,
    pub duration_ms: u32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Type, tauri_specta::Event)]
#[tauri_specta(event_name = "git://output")]
pub struct GitOutputEvent(pub GitOutputEntry);

pub struct GitOutputBuffer {
    entries: RwLock<VecDeque<GitOutputEntry>>,
}

impl Default for GitOutputBuffer {
    fn default() -> Self {
        Self::new()
    }
}

impl GitOutputBuffer {
    pub fn new() -> Self {
        Self {
            entries: RwLock::new(VecDeque::with_capacity(MAX_RING_BUFFER_ENTRIES)),
        }
    }

    pub fn push(&self, entry: GitOutputEntry) {
        let mut lock = self.entries.write();
        if lock.len() >= MAX_RING_BUFFER_ENTRIES {
            lock.pop_front();
        }
        lock.push_back(entry);
    }

    pub fn get_entries(&self) -> Vec<GitOutputEntry> {
        self.entries.read().iter().cloned().collect()
    }
}

pub fn get_global_buffer() -> &'static GitOutputBuffer {
    static BUFFER: parking_lot::RwLock<Option<GitOutputBuffer>> = parking_lot::RwLock::new(None);

    if let Some(buf) = BUFFER.read().as_ref() {
        return unsafe { &*(buf as *const GitOutputBuffer) };
    }

    let mut lock = BUFFER.write();
    if lock.is_none() {
        *lock = Some(GitOutputBuffer::new());
    }
    unsafe { &*(lock.as_ref().unwrap() as *const GitOutputBuffer) }
}

pub fn create_git_observer() -> git_core::CommandObserver {
    Arc::new(|record: &git_core::GitCommandRecord| {
        let entry = GitOutputEntry {
            id: NEXT_OUTPUT_ID.fetch_add(1, Ordering::SeqCst) as u32,
            timestamp: Utc::now().timestamp_millis() as f64,
            cmd: format!("git {}", record.args.join(" ")),
            cwd: record.cwd.to_string_lossy().to_string(),
            exit_code: record.exit_code.unwrap_or(-1),
            duration_ms: record.duration_ms as u32,
            stdout: String::new(),
            stderr: record.stderr.clone(),
        };

        get_global_buffer().push(entry.clone());

        tracing::info!(
            cmd = %entry.cmd,
            duration_ms = entry.duration_ms,
            exit_code = entry.exit_code,
            "git command executed"
        );
        if let Some(app) = get_global_app_handle() {
            let _ = app.emit("git://output", &entry);
        }
    })
}

pub fn create_git_cli() -> git_core::GitCli {
    let mut cli = git_core::GitCli::default().with_observer(create_git_observer());
    if let Some((addr, token)) = crate::repo::ipc::get_ipc_addr_token() {
        cli = crate::repo::ipc::setup_git_env(cli, &addr, &token);
    }
    cli
}

pub fn execute_git(
    cwd: Option<&Path>,
    args: &[&str],
    app: Option<&AppHandle>,
) -> Result<std::process::Output, AppError> {
    if let Some(app) = app {
        if get_global_app_handle().is_none() {
            set_global_app_handle(app.clone());
        }
    }

    let cli = create_git_cli();
    let dir = cwd.unwrap_or_else(|| Path::new("."));
    let opts = git_core::CommandOptions {
        timeout: Some(std::time::Duration::from_secs(120)),
        ..Default::default()
    };

    let raw = cli.exec_raw(dir, args, opts)?;
    let output = std::process::Output {
        status: exit_status_from_code(raw.exit_code),
        stdout: raw.stdout,
        stderr: raw.stderr.into_bytes(),
    };
    Ok(output)
}

#[cfg(unix)]
fn exit_status_from_code(code: i32) -> std::process::ExitStatus {
    use std::os::unix::process::ExitStatusExt;
    std::process::ExitStatus::from_raw(code << 8)
}

#[cfg(windows)]
fn exit_status_from_code(code: i32) -> std::process::ExitStatus {
    use std::os::windows::process::ExitStatusExt;
    std::process::ExitStatus::from_raw(code as u32)
}

#[tauri::command]
#[specta::specta]
pub fn get_git_output() -> Result<Vec<GitOutputEntry>, AppError> {
    Ok(get_global_buffer().get_entries())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_git_output_buffer() {
        let buf = GitOutputBuffer::new();
        assert!(buf.get_entries().is_empty());

        buf.push(GitOutputEntry {
            id: 1,
            timestamp: 100.0,
            cmd: "git status".to_string(),
            cwd: "/".to_string(),
            exit_code: 0,
            duration_ms: 12,
            stdout: "clean".to_string(),
            stderr: String::new(),
        });

        let entries = buf.get_entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].cmd, "git status");
    }

    #[test]
    fn test_execute_git_status() {
        let output = execute_git(None, &["--version"], None).expect("git --version");
        assert!(output.status.success());
        let version_str = String::from_utf8_lossy(&output.stdout);
        assert!(version_str.contains("git version"));
    }
}
