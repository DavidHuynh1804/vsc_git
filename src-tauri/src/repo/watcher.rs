use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Emitter};

use crate::error::AppError;

#[derive(Serialize, Deserialize, Debug, Clone, Type, tauri_specta::Event, PartialEq, Eq)]
#[tauri_specta(event_name = "repo://status-changed")]
pub struct StatusChangedEvent {
    pub root: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Type, tauri_specta::Event, PartialEq, Eq)]
#[tauri_specta(event_name = "repo://refs-changed")]
pub struct RefsChangedEvent {
    pub root: String,
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

pub struct RepoWatcher {
    _watcher: RecommendedWatcher,
    _stop_tx: Sender<()>,
}

#[derive(Default)]
pub struct WatcherState {
    watchers: Arc<Mutex<std::collections::HashMap<String, RepoWatcher>>>,
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

                        // Emit events
                        if refs_pending {
                            let _ = app_clone.emit(
                                "repo://refs-changed",
                                &RefsChangedEvent {
                                    root: root_str_clone.clone(),
                                },
                            );
                            refs_pending = false;
                        }
                        if status_pending {
                            let _ = app_clone.emit(
                                "repo://status-changed",
                                &StatusChangedEvent {
                                    root: root_str_clone.clone(),
                                },
                            );
                            status_pending = false;
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
    fn test_path_filter() {
        assert!(should_ignore_path(Path::new(
            "/repo/node_modules/foo/bar.js"
        )));
        assert!(should_ignore_path(Path::new("/repo/target/debug/app")));
        assert!(should_ignore_path(Path::new("/repo/.git/objects/4b/825dc")));
        assert!(should_ignore_path(Path::new("/repo/.git/index.lock")));

        assert!(!should_ignore_path(Path::new("/repo/src/App.tsx")));
        assert!(!should_ignore_path(Path::new("/repo/.git/HEAD")));
    }

    #[test]
    fn test_refs_change_detection() {
        assert!(is_refs_change(Path::new("/repo/.git/HEAD")));
        assert!(is_refs_change(Path::new("/repo/.git/refs/heads/main")));
        assert!(is_refs_change(Path::new(
            "/repo/.git/refs/remotes/origin/main"
        )));
        assert!(is_refs_change(Path::new("/repo/.git/packed-refs")));

        assert!(!is_refs_change(Path::new("/repo/src/main.rs")));
    }
}
