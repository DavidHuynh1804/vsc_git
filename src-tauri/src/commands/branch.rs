use tauri::{AppHandle, Window};

use crate::commands::mod_helpers::active_session;
use crate::commands::types::{
    AppPullMode, AppPushOptions, AppRefInfo, AppStashEntry, AppStashPushOptions,
};
use crate::error::AppError;
use crate::git_exec::create_git_cli;
use crate::repo::jobs::{spawn_job, JobId};

// =========================================================================
// Branch / ref group
// =========================================================================

#[tauri::command]
#[specta::specta]
pub fn list_refs(app: AppHandle, window: Window) -> Result<Vec<AppRefInfo>, AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let refs = git_core::ops::list_refs(&cli, &session.root)?;
    Ok(refs.into_iter().map(Into::into).collect())
}

#[tauri::command]
#[specta::specta]
pub fn checkout(app: AppHandle, window: Window, ref_name: String) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();
    let target_ref = ref_name.clone();
    session.queue.run_blocking(move || {
        // If target_ref looks like full commit sha (40 hex chars), checkout detached
        if target_ref.len() == 40 && target_ref.chars().all(|c| c.is_ascii_hexdigit()) {
            git_core::ops::checkout_detached(&cli, &root, &target_ref)?;
        } else {
            git_core::ops::checkout(&cli, &root, &target_ref)?;
        }
        Ok(())
    })?;

    // Update session head branch
    *session.head_branch.write() = ref_name;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn create_branch(
    app: AppHandle,
    window: Window,
    name: String,
    start_point: Option<String>,
) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();

    session.queue.run_blocking(move || {
        git_core::ops::create_branch(&cli, &root, &name, start_point.as_deref())?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn rename_branch(
    app: AppHandle,
    window: Window,
    old_name: Option<String>,
    new_name: String,
) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();

    session.queue.run_blocking(move || {
        git_core::ops::rename_branch(&cli, &root, old_name.as_deref(), &new_name)?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn delete_branch(
    app: AppHandle,
    window: Window,
    name: String,
    force: bool,
) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();

    session.queue.run_blocking(move || {
        git_core::ops::delete_branch(&cli, &root, &name, force)?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn delete_remote_branch(
    app: AppHandle,
    window: Window,
    remote: String,
    branch: String,
) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();

    session.queue.run_blocking(move || {
        cli.exec(
            &root,
            &["push", &remote, "--delete", &branch],
            git_core::CommandOptions::default(),
        )?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn set_upstream(
    app: AppHandle,
    window: Window,
    branch: Option<String>,
    upstream: Option<String>,
) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();
    let up = upstream.unwrap_or_default();
    session.queue.run_blocking(move || {
        git_core::ops::set_upstream(&cli, &root, branch.as_deref(), &up)?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn create_tag(
    app: AppHandle,
    window: Window,
    name: String,
    target: Option<String>,
    message: Option<String>,
) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();

    session.queue.run_blocking(move || {
        git_core::ops::create_tag(&cli, &root, &name, target.as_deref(), message.as_deref())?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn delete_tag(app: AppHandle, window: Window, name: String) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();

    session.queue.run_blocking(move || {
        git_core::ops::delete_tag(&cli, &root, &name)?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn push_tag(
    app: AppHandle,
    window: Window,
    name: String,
    remote: Option<String>,
) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();
    let r = remote.unwrap_or_else(|| "origin".to_string());

    session.queue.run_blocking(move || {
        cli.exec(
            &root,
            &["push", &r, "tag", &name],
            git_core::CommandOptions::default(),
        )?;
        Ok(())
    })
}

// =========================================================================
// Sync group (background jobs with JobId and progress)
// =========================================================================

#[tauri::command]
#[specta::specta]
pub fn fetch(app: AppHandle, window: Window, remote: Option<String>) -> Result<JobId, AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();
    let target = match remote {
        Some(r) => git_core::FetchTarget::Remote(r),
        None => git_core::FetchTarget::All,
    };

    let (job_id, _) = spawn_job(app, move |cancel_token, progress_cb| {
        git_core::ops::fetch(
            &cli,
            &root,
            target,
            false,
            Some(progress_cb),
            Some(cancel_token),
        )?;
        Ok(())
    });

    Ok(job_id)
}

#[tauri::command]
#[specta::specta]
pub fn pull(app: AppHandle, window: Window, mode: Option<AppPullMode>) -> Result<JobId, AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();
    let pull_mode = mode.map(Into::into).unwrap_or(git_core::PullMode::Default);

    let (job_id, _) = spawn_job(app, move |cancel_token, progress_cb| {
        git_core::ops::pull(
            &cli,
            &root,
            pull_mode,
            Some(progress_cb),
            Some(cancel_token),
        )?;
        Ok(())
    });

    Ok(job_id)
}

#[tauri::command]
#[specta::specta]
pub fn push(
    app: AppHandle,
    window: Window,
    options: Option<AppPushOptions>,
) -> Result<JobId, AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();
    let push_opts = options.map(Into::into).unwrap_or_default();

    let (job_id, _) = spawn_job(app, move |cancel_token, progress_cb| {
        git_core::ops::push(
            &cli,
            &root,
            push_opts,
            Some(progress_cb),
            Some(cancel_token),
        )?;
        Ok(())
    });

    Ok(job_id)
}

#[tauri::command]
#[specta::specta]
pub fn sync(app: AppHandle, window: Window) -> Result<JobId, AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();

    let (job_id, _) = spawn_job(app, move |cancel_token, progress_cb| {
        // 1. Pull
        git_core::ops::pull(
            &cli,
            &root,
            git_core::PullMode::Default,
            Some(progress_cb.clone()),
            Some(cancel_token.clone()),
        )?;

        // 2. Push
        git_core::ops::push(
            &cli,
            &root,
            git_core::PushOptions::default(),
            Some(progress_cb),
            Some(cancel_token),
        )?;

        Ok(())
    });

    Ok(job_id)
}

// =========================================================================
// Stash group
// =========================================================================

#[tauri::command]
#[specta::specta]
pub fn list_stashes(app: AppHandle, window: Window) -> Result<Vec<AppStashEntry>, AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let stashes = git_core::ops::stash_list(&cli, &session.root)?;
    Ok(stashes.into_iter().map(Into::into).collect())
}

#[tauri::command]
#[specta::specta]
pub fn stash_push(
    app: AppHandle,
    window: Window,
    options: Option<AppStashPushOptions>,
) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();
    let opts = options.map(Into::into).unwrap_or_default();

    session.queue.run_blocking(move || {
        git_core::ops::stash_push(&cli, &root, opts)?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn stash_apply(app: AppHandle, window: Window, index: u32) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();
    let stash_ref = format!("stash@{{{index}}}");

    session.queue.run_blocking(move || {
        git_core::ops::stash_apply(&cli, &root, Some(&stash_ref))?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn stash_pop(app: AppHandle, window: Window, index: u32) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();
    let stash_ref = format!("stash@{{{index}}}");

    session.queue.run_blocking(move || {
        git_core::ops::stash_pop(&cli, &root, Some(&stash_ref))?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn stash_drop(app: AppHandle, window: Window, index: u32) -> Result<(), AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let root = session.root.clone();
    let stash_ref = format!("stash@{{{index}}}");

    session.queue.run_blocking(move || {
        git_core::ops::stash_drop(&cli, &root, Some(&stash_ref))?;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn stash_diff(app: AppHandle, window: Window, index: u32) -> Result<String, AppError> {
    let session = active_session(&app, &window)?;
    let cli = create_git_cli();
    let stash_ref = format!("stash@{{{index}}}");
    let diff = git_core::ops::stash_show(&cli, &session.root, Some(&stash_ref))?;
    Ok(diff)
}
