use std::collections::VecDeque;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use chrono::Utc;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, ErrorKind};

pub const MAX_RING_BUFFER_ENTRIES: usize = 5000;
static NEXT_OUTPUT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
pub struct GitOutputEntry {
    pub id: u64,
    pub timestamp: i64,
    pub cmd: String,
    pub cwd: String,
    pub exit_code: i32,
    pub duration_ms: u64,
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
        // Safe because the buffer lives for the entire application duration
        return unsafe { &*(buf as *const GitOutputBuffer) };
    }

    let mut lock = BUFFER.write();
    if lock.is_none() {
        *lock = Some(GitOutputBuffer::new());
    }
    unsafe { &*(lock.as_ref().unwrap() as *const GitOutputBuffer) }
}

pub fn execute_git(
    cwd: Option<&Path>,
    args: &[&str],
    app: Option<&AppHandle>,
) -> Result<std::process::Output, AppError> {
    let start = Instant::now();
    let cwd_str = cwd
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string());
    let cmd_str = format!("git {}", args.join(" "));

    let mut command = Command::new("git");
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    command.args(args);

    let output = command.output().map_err(|e| {
        let err = if e.kind() == std::io::ErrorKind::NotFound {
            AppError::new(
                ErrorKind::GitMissing,
                "Git executable not found in PATH. Please install Git.",
            )
        } else {
            AppError::internal(format!("Failed to execute git: {e}"))
        };
        err
    })?;

    let duration_ms = start.elapsed().as_millis() as u64;
    let exit_code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    let entry = GitOutputEntry {
        id: NEXT_OUTPUT_ID.fetch_add(1, Ordering::SeqCst),
        timestamp: Utc::now().timestamp_millis(),
        cmd: cmd_str,
        cwd: cwd_str,
        exit_code,
        duration_ms,
        stdout,
        stderr,
    };

    get_global_buffer().push(entry.clone());

    if let Some(app) = app {
        let _ = app.emit("git://output", &entry);
    }

    tracing::debug!(
        cmd = %entry.cmd,
        cwd = %entry.cwd,
        exit_code = entry.exit_code,
        ms = entry.duration_ms,
        "Executed git command"
    );

    Ok(output)
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
            timestamp: 100,
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
