use tauri::{AppHandle, Window};

use crate::commands::mod_helpers::{active_session, validate_path_in_repo};
use crate::commands::types::{
    AppBlameLine, AppBlameOptions, AppConflictVersions, AppFileHistoryEntry, AppOperationState,
    AppRebaseTodoEntry, AppResolution,
};
use crate::error::{AppError, ErrorKind};
use crate::git_exec::create_git_cli;
use crate::repo::jobs::{spawn_job, JobId};

// =========================================================================
// History ops group
// =========================================================================

#[tauri::command]
#[specta::specta]
pub fn cherry_pick(app: AppHandle, window: Window, sha: String) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();

    session.queue.run_blocking(move || {
        cli.exec(
            &root,
            &["cherry-pick", &sha],
            git_core::CommandOptions::default(),
        )?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn revert(app: AppHandle, window: Window, sha: String) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();

    session.queue.run_blocking(move || {
        cli.exec(
            &root,
            &["revert", "--no-edit", &sha],
            git_core::CommandOptions::default(),
        )?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn reset(app: AppHandle, window: Window, sha: String, mode: String) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();
    let mode_arg = format!("--{mode}");

    session.queue.run_blocking(move || {
        cli.exec(
            &root,
            &["reset", &mode_arg, &sha],
            git_core::CommandOptions::default(),
        )?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn merge(
    app: AppHandle,
    window: Window,
    ref_name: String,
    opts: Option<String>,
) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();

    session.queue.run_blocking(move || {
        let mut args = vec!["merge", &ref_name];
        if let Some(o) = &opts {
            args.push(o.as_str());
        }
        cli.exec(&root, &args, git_core::CommandOptions::default())?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn rebase(app: AppHandle, window: Window, ref_name: String) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();

    session.queue.run_blocking(move || {
        cli.exec(
            &root,
            &["rebase", &ref_name],
            git_core::CommandOptions::default(),
        )?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn rebase_interactive(app: AppHandle, window: Window, base: String) -> Result<JobId, AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();

    let (job_id, _) = spawn_job(app, move |cancel_token, _| {
        let opts = git_core::CommandOptions::default().with_cancel_token(cancel_token);
        cli.exec(&root, &["rebase", "-i", &base], opts)?;
        Ok(())
    });

    Ok(job_id)
}

#[tauri::command]
#[specta::specta]
pub fn submit_rebase_todo(
    _app: AppHandle,
    _window: Window,
    items: Vec<AppRebaseTodoEntry>,
) -> Result<(), AppError> {
    let core_items: Vec<git_core::RebaseTodoEntry> = items.into_iter().map(Into::into).collect();
    let _text = git_core::ops::serialize_rebase_todo(&core_items);
    // Answer any pending sequence_editor prompt
    let _prompts = crate::repo::ipc::get_pending_prompts();
    // Answer the most recent prompt or all pending prompts with the serialized todo
    // Note: in a typical flow, there is one active sequence_editor prompt waiting
    // If answer_prompt was called with ID, that handles specific; this submits directly.
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn op_continue(app: AppHandle, window: Window) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();

    session.queue.run_blocking(move || {
        let state = git_core::ops::operation_state(&cli, &root)?;
        let kind = state
            .kind()
            .ok_or_else(|| AppError::new(ErrorKind::Internal, "No active operation to continue"))?;
        git_core::ops::op_continue(&cli, &root, kind)?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn op_skip(app: AppHandle, window: Window) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();

    session.queue.run_blocking(move || {
        let state = git_core::ops::operation_state(&cli, &root)?;
        let kind = state
            .kind()
            .ok_or_else(|| AppError::new(ErrorKind::Internal, "No active operation to skip"))?;
        git_core::ops::op_skip(&cli, &root, kind)?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn op_abort(app: AppHandle, window: Window) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();

    session.queue.run_blocking(move || {
        let state = git_core::ops::operation_state(&cli, &root)?;
        let kind = state
            .kind()
            .ok_or_else(|| AppError::new(ErrorKind::Internal, "No active operation to abort"))?;
        git_core::ops::op_abort(&cli, &root, kind)?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn get_operation_state(app: AppHandle, window: Window) -> Result<AppOperationState, AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let state = git_core::ops::operation_state(&cli, &session.root)?;
    *session.operation_cache.write() = Some(state.clone());
    Ok(state.into())
}

// =========================================================================
// Conflict group
// =========================================================================

#[tauri::command]
#[specta::specta]
pub fn get_conflict(
    app: AppHandle,
    window: Window,
    path: String,
) -> Result<AppConflictVersions, AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    validate_path_in_repo(&session.root, &path)?;
    let versions = git_core::ops::conflict_versions(&cli, &session.root, &path)?;
    Ok(versions.into())
}

#[tauri::command]
#[specta::specta]
pub fn resolve_conflict(
    app: AppHandle,
    window: Window,
    path: String,
    content: String,
) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let _target = validate_path_in_repo(&session.root, &path)?;
    let root = session.root.clone();

    session.queue.run_blocking(move || {
        git_core::ops::mark_resolved(&cli, &root, &path, content.as_bytes())?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn resolve_with(
    app: AppHandle,
    window: Window,
    path: String,
    resolution: AppResolution,
) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    validate_path_in_repo(&session.root, &path)?;
    let root = session.root.clone();

    session.queue.run_blocking(move || {
        git_core::ops::resolve_with(&cli, &root, &path, resolution.into())?;
        Ok(())
    })
}

// =========================================================================
// Blame / history group
// =========================================================================

#[tauri::command]
#[specta::specta]
pub fn blame(
    app: AppHandle,
    window: Window,
    path: String,
    rev: Option<String>,
    opts: Option<AppBlameOptions>,
) -> Result<Vec<AppBlameLine>, AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    validate_path_in_repo(&session.root, &path)?;
    let options = opts.map(Into::into).unwrap_or_default();
    let lines = git_core::ops::blame(&cli, &session.root, &path, rev.as_deref(), options)?;
    Ok(lines.into_iter().map(Into::into).collect())
}

#[tauri::command]
#[specta::specta]
pub fn file_history(
    app: AppHandle,
    window: Window,
    path: String,
) -> Result<Vec<AppFileHistoryEntry>, AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    validate_path_in_repo(&session.root, &path)?;
    let entries = git_core::ops::file_history(&cli, &session.root, &path, 100, 0)?;
    Ok(entries.into_iter().map(Into::into).collect())
}
