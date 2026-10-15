use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::error::AppError;

pub type JobId = String;

#[derive(Serialize, Deserialize, Debug, Clone, Type, tauri_specta::Event, PartialEq)]
#[tauri_specta(event_name = "job://progress")]
pub struct JobProgressEvent {
    pub id: String,
    pub percent: Option<f32>,
    pub message: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Type, tauri_specta::Event, PartialEq, Eq)]
#[tauri_specta(event_name = "job://done")]
pub struct JobDoneEvent {
    pub id: String,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Type, tauri_specta::Event, PartialEq, Eq)]
#[tauri_specta(event_name = "job://chunk")]
pub struct JobChunkEvent {
    pub id: String,
    pub chunk: String,
}

#[derive(Default)]
pub struct JobRegistry {
    jobs: RwLock<HashMap<JobId, git_core::CancelToken>>,
}

impl JobRegistry {
    pub fn new() -> Self {
        Self {
            jobs: RwLock::new(HashMap::new()),
        }
    }

    pub fn create_job(&self) -> (JobId, git_core::CancelToken) {
        let id = Uuid::new_v4().to_string();
        let token = git_core::CancelToken::default();
        self.jobs.write().insert(id.clone(), token.clone());
        (id, token)
    }

    pub fn remove_job(&self, id: &str) -> Option<git_core::CancelToken> {
        self.jobs.write().remove(id)
    }

    pub fn cancel(&self, id: &str) -> bool {
        if let Some(token) = self.jobs.read().get(id) {
            token.cancel();
            true
        } else {
            false
        }
    }
}

pub fn get_global_jobs() -> &'static JobRegistry {
    static REGISTRY: parking_lot::RwLock<Option<JobRegistry>> = parking_lot::RwLock::new(None);

    if let Some(reg) = REGISTRY.read().as_ref() {
        return unsafe { &*(reg as *const JobRegistry) };
    }

    let mut lock = REGISTRY.write();
    if lock.is_none() {
        *lock = Some(JobRegistry::new());
    }
    unsafe { &*(lock.as_ref().unwrap() as *const JobRegistry) }
}

#[tauri::command]
#[specta::specta]
pub fn cancel_job(_app: AppHandle, id: String) -> Result<(), AppError> {
    get_global_jobs().cancel(&id);
    Ok(())
}

pub fn spawn_job<F>(app: AppHandle, f: F) -> (JobId, tokio::task::JoinHandle<()>)
where
    F: FnOnce(
            git_core::CancelToken,
            Arc<dyn Fn(git_core::ops::Progress) + Send + Sync>,
        ) -> Result<(), AppError>
        + Send
        + 'static,
{
    let (job_id, cancel_token) = get_global_jobs().create_job();
    let id_for_progress = job_id.clone();
    let app_for_progress = app.clone();

    let progress_cb = Arc::new(move |p: git_core::ops::Progress| {
        let _ = app_for_progress.emit(
            "job://progress",
            &JobProgressEvent {
                id: id_for_progress.clone(),
                percent: Some(p.percent as f32),
                message: p.phase,
            },
        );
    });

    let id_for_done = job_id.clone();
    let app_for_done = app.clone();
    let cancel_for_task = cancel_token.clone();

    let handle = tokio::task::spawn_blocking(move || {
        let res = f(cancel_for_task, progress_cb);
        get_global_jobs().remove_job(&id_for_done);

        let (success, error) = match res {
            Ok(()) => (true, None),
            Err(e) => (false, Some(e.message)),
        };

        let _ = app_for_done.emit(
            "job://done",
            &JobDoneEvent {
                id: id_for_done,
                success,
                error,
            },
        );
    });

    (job_id, handle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_job_registry_cancel() {
        let registry = JobRegistry::new();
        let (id, token) = registry.create_job();
        assert!(!token.is_cancelled());

        assert!(registry.cancel(&id));
        assert!(token.is_cancelled());

        registry.remove_job(&id);
        assert!(!registry.cancel(&id));
    }
}
