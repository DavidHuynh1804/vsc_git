use tauri::{AppHandle, Window};

use crate::commands::mod_helpers::active_session;
use crate::commands::types::{AppCommitDetail, AppFileChange, AppGraphFilter, AppGraphPage};
use crate::error::AppError;
use crate::git_exec::create_git_cli;
use crate::repo::jobs::{spawn_job, JobId};

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, window))]
pub fn graph_reset(
    app: AppHandle,
    window: Window,
    filter: Option<AppGraphFilter>,
) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let read_repo = git_read::ReadRepo::open(&session.root)?;
    let core_filter = filter.map(Into::into).unwrap_or_default();
    let walker = git_read::GraphWalker::new(read_repo, core_filter)?;
    *session.graph.lock() = Some(walker);
    Ok(())
}

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, window))]
pub fn graph_page(
    app: AppHandle,
    window: Window,
    limit: Option<u32>,
) -> Result<AppGraphPage, AppError> {
    let session = active_session(&app, &window)?;
    let mut lock = session.graph.lock();

    // If walker is not yet initialized for this session, initialize with defaults
    if lock.is_none() {
        let read_repo = git_read::ReadRepo::open(&session.root)?;
        let walker = git_read::GraphWalker::new(read_repo, git_read::GraphFilter::default())?;
        *lock = Some(walker);
    }

    let walker = lock.as_mut().unwrap();
    let page = walker.next_page(limit.unwrap_or(500) as usize)?;
    Ok(page.into())
}

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, window))]
pub fn commit_detail(
    app: AppHandle,
    window: Window,
    sha: String,
) -> Result<AppCommitDetail, AppError> {
    let session = active_session(&app, &window)?;
    let read_repo = git_read::ReadRepo::open(&session.root)?;
    let detail = read_repo.commit_detail(&sha)?;
    Ok(detail.into())
}

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, window))]
pub fn compare(
    app: AppHandle,
    window: Window,
    a: String,
    b: String,
) -> Result<Vec<AppFileChange>, AppError> {
    let session = active_session(&app, &window)?;
    let read_repo = git_read::ReadRepo::open(&session.root)?;
    let changes = read_repo.compare(&a, &b)?;
    Ok(changes.into_iter().map(Into::into).collect())
}

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, window))]
pub fn graph_search(app: AppHandle, window: Window, query: String) -> Result<JobId, AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();

    let (job_id, _) = spawn_job(app, move |cancel_token, _| {
        let opts = git_core::CommandOptions::default().with_cancel_token(cancel_token);
        // Search commit messages with grep
        cli.exec(&root, &["log", "--grep", &query, "-n", "200"], opts)?;
        Ok(())
    });

    Ok(job_id)
}
