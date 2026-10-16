use tauri::{AppHandle, Window};

use crate::commands::mod_helpers::{
    active_session, validate_and_relativize_path, validate_path_in_repo,
};
use crate::commands::types::{AppCommitOptions, AppFileRev, AppLineSelection, AppRepoStatus};
use crate::error::{AppError, ErrorKind};
use crate::git_exec::create_git_cli;

// =========================================================================
type TrashHandler = fn(&std::path::Path) -> Result<(), trash::Error>;
static TRASH_HANDLER: parking_lot::RwLock<Option<TrashHandler>> = parking_lot::RwLock::new(None);

#[doc(hidden)]
pub fn set_trash_handler_for_test(handler: Option<TrashHandler>) {
    *TRASH_HANDLER.write() = handler;
}

// Status group
// =========================================================================

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, window))]
pub fn get_status(app: AppHandle, window: Window) -> Result<AppRepoStatus, AppError> {
    let session = active_session(&app, &window)?;
    get_status_impl(&session)
}

pub fn get_status_impl(
    session: &crate::repo::session::RepoSession,
) -> Result<AppRepoStatus, AppError> {
    let cli = create_git_cli();
    let status = git_core::ops::status(&cli, &session.root)?;
    *session.status_cache.write() = Some(status.clone());
    Ok(status.into())
}

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, window))]
pub fn refresh(app: AppHandle, window: Window) -> Result<AppRepoStatus, AppError> {
    get_status(app, window)
}

// =========================================================================
// Stage group
// =========================================================================

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, window))]
pub fn stage(app: AppHandle, window: Window, paths: Vec<String>) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();

    let mut safe_paths = Vec::with_capacity(paths.len());
    for p in &paths {
        let (_, rel) = validate_and_relativize_path(&root, p)?;
        safe_paths.push(rel);
    }

    session.queue.run_blocking(move || {
        git_core::ops::stage(&cli, &root, &safe_paths)?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, window))]
pub fn unstage(app: AppHandle, window: Window, paths: Vec<String>) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();

    let mut safe_paths = Vec::with_capacity(paths.len());
    for p in &paths {
        let (_, rel) = validate_and_relativize_path(&root, p)?;
        safe_paths.push(rel);
    }

    session.queue.run_blocking(move || {
        git_core::ops::unstage(&cli, &root, &safe_paths)?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, window))]
pub fn discard(app: AppHandle, window: Window, paths: Vec<String>) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    discard_impl(&session, &paths)
}

pub fn discard_impl(
    session: &crate::repo::session::RepoSession,
    paths: &[String],
) -> Result<(), AppError> {
    let cli = create_git_cli();
    let root = session.root.clone();

    let mut safe_pairs = Vec::with_capacity(paths.len());
    for p in paths {
        let (full, rel) = validate_and_relativize_path(&root, p)?;
        safe_pairs.push((full, rel));
    }

    session.queue.run_blocking(move || {
        let current_status = git_core::ops::status(&cli, &root)?;
        let mut untracked_full_paths = Vec::new();
        let mut tracked_rel_paths = Vec::new();

        for (full, rel) in &safe_pairs {
            let is_untracked = current_status
                .entries
                .iter()
                .any(|e| e.path == *rel && matches!(e.kind, git_core::StatusEntryKind::Untracked));

            if is_untracked {
                untracked_full_paths.push(full.clone());
            } else {
                tracked_rel_paths.push(rel.clone());
            }
        }

        for full_path in untracked_full_paths {
            if full_path.exists() {
                let res = if let Some(handler) = *TRASH_HANDLER.read() {
                    handler(&full_path)
                } else {
                    trash::delete(&full_path)
                };

                res.map_err(|e| {
                    AppError::new(
                        ErrorKind::Internal,
                        format!("Failed to move '{}' to trash: {e}", full_path.display()),
                    )
                })?;
            }
        }

        if !tracked_rel_paths.is_empty() {
            git_core::ops::discard(&cli, &root, &tracked_rel_paths)?;
        }

        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, window))]
pub fn stage_all(app: AppHandle, window: Window) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();

    session.queue.run_blocking(move || {
        git_core::ops::stage_all(&cli, &root)?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, window))]
pub fn unstage_all(app: AppHandle, window: Window) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();

    session.queue.run_blocking(move || {
        git_core::ops::unstage_all(&cli, &root)?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, window))]
pub fn stage_selections(
    app: AppHandle,
    window: Window,
    path: String,
    selections: Vec<AppLineSelection>,
) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    stage_selections_impl(&session, &path, &selections)
}

pub fn stage_selections_impl(
    session: &crate::repo::session::RepoSession,
    path: &str,
    selections: &[AppLineSelection],
) -> Result<(), AppError> {
    let cli = create_git_cli();
    let root = session.root.clone();
    let (_, rel_path) = validate_and_relativize_path(&root, path)?;
    let sels: Vec<git_core::LineSelection> = selections.iter().copied().map(Into::into).collect();

    session.queue.run_blocking(move || {
        git_core::patch::apply_ranges(&cli, &root, &rel_path, &sels, git_core::ApplyMode::Stage)?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, window))]
pub fn unstage_selections(
    app: AppHandle,
    window: Window,
    path: String,
    selections: Vec<AppLineSelection>,
) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();
    let (_, rel_path) = validate_and_relativize_path(&root, &path)?;
    let sels: Vec<git_core::LineSelection> = selections.into_iter().map(Into::into).collect();

    session.queue.run_blocking(move || {
        git_core::patch::apply_ranges(&cli, &root, &rel_path, &sels, git_core::ApplyMode::Unstage)?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, window))]
pub fn revert_selections(
    app: AppHandle,
    window: Window,
    path: String,
    selections: Vec<AppLineSelection>,
) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();
    let (_, rel_path) = validate_and_relativize_path(&root, &path)?;
    let sels: Vec<git_core::LineSelection> = selections.into_iter().map(Into::into).collect();

    session.queue.run_blocking(move || {
        git_core::patch::apply_ranges(&cli, &root, &rel_path, &sels, git_core::ApplyMode::Revert)?;
        Ok(())
    })
}

// =========================================================================
// Nội dung (Content) group
// =========================================================================

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, window))]
pub fn get_file_content(
    app: AppHandle,
    window: Window,
    path: String,
    rev: AppFileRev,
) -> Result<String, AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let target_path = validate_path_in_repo(&session.root, &path)?;

    let bytes = match rev {
        AppFileRev::Worktree => {
            if target_path.exists() {
                std::fs::read(&target_path)?
            } else {
                Vec::new()
            }
        }
        AppFileRev::Head => {
            git_core::ops::file_content(&cli, &session.root, &path, git_core::FileRev::Head)?
        }
        AppFileRev::Index => {
            git_core::ops::file_content(&cli, &session.root, &path, git_core::FileRev::Index)?
        }
        AppFileRev::Commit(sha) => {
            git_core::ops::file_content(&cli, &session.root, &path, git_core::FileRev::Commit(sha))?
        }
        AppFileRev::Stage(s) => {
            git_core::ops::file_content(&cli, &session.root, &path, git_core::FileRev::Stage(s))?
        }
    };
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, window))]
pub fn save_worktree_file(
    app: AppHandle,
    window: Window,
    path: String,
    content: String,
) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    // Canonicalize check ensuring path strictly resides within repo root
    let target_path = validate_path_in_repo(&session.root, &path)?;

    if let Some(parent) = target_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }

    std::fs::write(&target_path, content.as_bytes())?;
    Ok(())
}

// =========================================================================
// Commit group
// =========================================================================

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, window))]
pub fn commit(app: AppHandle, window: Window, options: AppCommitOptions) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    commit_impl(&session, options)
}

pub fn commit_impl(
    session: &crate::repo::session::RepoSession,
    options: AppCommitOptions,
) -> Result<(), AppError> {
    let cli = create_git_cli();
    let root = session.root.clone();

    session.queue.run_blocking(move || {
        git_core::ops::commit(&cli, &root, options.into())?;
        Ok(())
    })?;

    *session.draft_message.write() = String::new();
    Ok(())
}

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, window))]
pub fn last_commit_message(app: AppHandle, window: Window) -> Result<String, AppError> {
    let session = active_session(&app, &window)?;
    last_commit_message_impl(&session)
}

pub fn last_commit_message_impl(
    session: &crate::repo::session::RepoSession,
) -> Result<String, AppError> {
    let cli = create_git_cli();
    let msg = git_core::ops::last_commit_message(&cli, &session.root)?;
    Ok(msg)
}

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, window))]
pub fn get_draft_message(app: AppHandle, window: Window) -> Result<String, AppError> {
    let session = active_session(&app, &window)?;
    let msg = session.draft_message.read().clone();
    Ok(msg)
}
#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app, window))]
pub fn set_draft_message(app: AppHandle, window: Window, message: String) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    *session.draft_message.write() = message;
    Ok(())
}
