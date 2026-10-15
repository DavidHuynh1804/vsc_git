use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::types::{AppOperationState, AppRepoStatus};
use crate::error::AppError;
use crate::git_exec::create_git_cli;

#[derive(Serialize, Deserialize, Debug, Clone, Type, tauri_specta::Event, PartialEq)]
#[tauri_specta(event_name = "repo://status-changed")]
pub struct StatusChangedEvent {
    pub root: String,
    pub status: Option<AppRepoStatus>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Type, tauri_specta::Event, PartialEq, Eq)]
#[tauri_specta(event_name = "repo://refs-changed")]
pub struct RefsChangedEvent {
    pub root: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Type, tauri_specta::Event, PartialEq)]
#[tauri_specta(event_name = "repo://operation-changed")]
pub struct OperationChangedEvent {
    pub root: String,
    pub state: AppOperationState,
}

pub fn should_ignore_path(path: &Path) -> bool {
    for comp in path.components() {
        let s = comp.as_os_str().to_string_lossy();
        if s == "node_modules" || s == "target" || s == "objects" || s.ends_with(".lock") {
            return true;
        }
    }
    false
}

pub fn is_refs_change(path: &Path) -> bool {
    let s = path.to_string_lossy();
    s.ends_with("HEAD")
        || s.contains("refs/heads")
        || s.contains("refs/remotes")
        || s.contains("refs/tags")
        || s.ends_with("packed-refs")
}

pub fn is_operation_change(path: &Path) -> bool {
    let s = path.to_string_lossy();
    s.contains("MERGE_HEAD")
        || s.contains("rebase-merge")
        || s.contains("rebase-apply")
        || s.contains("CHERRY_PICK_HEAD")
        || s.contains("REVERT_HEAD")
}

pub struct RepoWatcher {
    _watcher: RecommendedWatcher,
    _stop_tx: Sender<()>,
}

#[derive(Default)]
pub struct WatcherState {
    watchers: Arc<Mutex<std::collections::HashMap<String, RepoWatcher>>>,
}

fn find_session_by_root(app: &AppHandle, root: &Path) -> Option<crate::repo::session::RepoSession> {
    if let Some(state) = app.try_state::<crate::repo::session::SessionState>() {
        let lock = state.sessions.read();
        for session in lock.values() {
            if session.root == root {
                return Some(session.clone());
            }
        }
    }
    None
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watchers: Arc::new(Mutex::new(std::collections::HashMap::new())),
        }
    }

    pub fn start_watching(&self, app: AppHandle, root: PathBuf) -> Result<(), AppError> {
        let root_str = root.to_string_lossy().to_string();
        let mut lock = self.watchers.lock();
        lock.remove(&root_str);

        let (stop_tx, stop_rx) = channel::<()>();
        let (raw_tx, raw_rx) = channel::<Event>();

        let mut watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    let _ = raw_tx.send(event);
                }
            },
            Config::default(),
        )
        .map_err(|e| AppError::internal(format!("Failed to create watcher: {e}")))?;

        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| AppError::internal(format!("Failed to watch repository: {e}")))?;

        let app_clone = app.clone();
        let root_str_clone = root_str.clone();
        let root_clone = root.clone();

        thread::spawn(move || {
            let debounce_dur = Duration::from_millis(300);
            let mut status_pending = false;
            let mut refs_pending = false;

            loop {
                // Check if stopped
                if stop_rx.try_recv().is_ok() {
                    break;
                }

                // Wait for initial event
                match raw_rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(event) => {
                        for path in event.paths {
                            if should_ignore_path(&path) {
                                continue;
                            }
                            if is_refs_change(&path) {
                                refs_pending = true;
                            } else {
                                status_pending = true;
                            }
                        }

                        // Debounce drain loop
                        let deadline = std::time::Instant::now() + debounce_dur;
                        while std::time::Instant::now() < deadline {
                            if stop_rx.try_recv().is_ok() {
                                return;
                            }
                            if let Ok(event) = raw_rx.recv_timeout(Duration::from_millis(50)) {
                                for path in event.paths {
                                    if should_ignore_path(&path) {
                                        continue;
                                    }
                                    if is_refs_change(&path) {
                                        refs_pending = true;
                                    } else {
                                        status_pending = true;
                                    }
                                }
                            }
                        }

                        let cli = create_git_cli();

                        // Emit refs change event
                        if refs_pending {
                            let _ = app_clone.emit(
                                "repo://refs-changed",
                                &RefsChangedEvent {
                                    root: root_str_clone.clone(),
                                },
                            );
                            refs_pending = false;
                        }

                        // Run real status, compare against cache, emit if changed with payload
                        if status_pending {
                            if let Ok(new_status) = git_core::ops::status(&cli, &root_clone) {
                                let mut changed = true;
                                if let Some(session) = find_session_by_root(&app_clone, &root_clone)
                                {
                                    let mut cache = session.status_cache.write();
                                    if let Some(old) = &*cache {
                                        if old == &new_status {
                                            changed = false;
                                        }
                                    }
                                    if changed {
                                        *cache = Some(new_status.clone());
                                    }
                                }

                                if changed {
                                    let _ = app_clone.emit(
                                        "repo://status-changed",
                                        &StatusChangedEvent {
                                            root: root_str_clone.clone(),
                                            status: Some(new_status.into()),
                                        },
                                    );
                                }
                            }
                            status_pending = false;
                        }

                        // Check operation state change and emit if changed
                        if let Ok(new_op) = git_core::ops::operation_state(&cli, &root_clone) {
                            let mut op_changed = true;
                            if let Some(session) = find_session_by_root(&app_clone, &root_clone) {
                                let mut cache = session.operation_cache.write();
                                if let Some(old) = &*cache {
                                    if old == &new_op {
                                        op_changed = false;
                                    }
                                }
                                if op_changed {
                                    *cache = Some(new_op.clone());
                                }
                            }

                            if op_changed {
                                let _ = app_clone.emit(
                                    "repo://operation-changed",
                                    &OperationChangedEvent {
                                        root: root_str_clone.clone(),
                                        state: new_op.into(),
                                    },
                                );
                            }
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        // Regular timeout, continue loop
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        break;
                    }
                }
            }
        });

        lock.insert(
            root_str,
            RepoWatcher {
                _watcher: watcher,
                _stop_tx: stop_tx,
            },
        );

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_refs_change_detection() {
        assert!(is_refs_change(Path::new(".git/HEAD")));
        assert!(is_refs_change(Path::new(".git/refs/heads/main")));
        assert!(is_refs_change(Path::new(".git/refs/tags/v1.0.0")));
        assert!(!is_refs_change(Path::new("src/main.rs")));
    }

    #[test]
    fn test_operation_change_detection() {
        assert!(is_operation_change(Path::new(".git/MERGE_HEAD")));
        assert!(is_operation_change(Path::new(
            ".git/rebase-merge/head-name"
        )));
        assert!(is_operation_change(Path::new(".git/CHERRY_PICK_HEAD")));
        assert!(!is_operation_change(Path::new("src/main.rs")));
    }

    #[test]
    fn test_ignore_path() {
        assert!(should_ignore_path(Path::new("node_modules/package.json")));
        assert!(should_ignore_path(Path::new("target/debug/app")));
        assert!(should_ignore_path(Path::new(".git/objects/12/3456")));
        assert!(should_ignore_path(Path::new(".git/index.lock")));
        assert!(!should_ignore_path(Path::new("src/lib.rs")));
    }
}
