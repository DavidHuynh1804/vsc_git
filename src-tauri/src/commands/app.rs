use std::path::Path;
use std::process::Command;

use tauri::{AppHandle, Window};

use crate::app::settings::get_settings;
use crate::error::{AppError, ErrorKind};
use crate::git_exec::create_git_cli;
use crate::repo::jobs::{spawn_job, JobId};
use crate::repo::session::RepoInfo;

#[tauri::command]
#[specta::specta]
pub fn open_in_editor(
    app: AppHandle,
    _window: Window,
    path: String,
    line: Option<u32>,
) -> Result<(), AppError> {
    let settings = get_settings(app.clone()).unwrap_or_default();
    let editor_cmd = settings.external_editor_command;
    let editor_args = settings.external_editor_args;

    let line_str = line.unwrap_or(1).to_string();
    let processed_args: Vec<String> = editor_args
        .into_iter()
        .map(|arg| arg.replace("{file}", &path).replace("{line}", &line_str))
        .collect();

    let mut cmd = Command::new(&editor_cmd);
    cmd.args(&processed_args);

    cmd.spawn().map_err(|e| {
        AppError::new(
            ErrorKind::Internal,
            format!("Failed to open external editor '{editor_cmd}': {e}"),
        )
    })?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn reveal_in_file_manager(
    _app: AppHandle,
    _window: Window,
    path: String,
) -> Result<(), AppError> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(AppError::new(
            ErrorKind::Internal,
            format!("Path does not exist: '{path}'"),
        ));
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| AppError::internal(format!("Failed to reveal in Finder: {e}")))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,\"{path}\""))
            .spawn()
            .map_err(|e| AppError::internal(format!("Failed to reveal in Explorer: {e}")))?;
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        let parent = p.parent().unwrap_or(p);
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| AppError::internal(format!("Failed to open file manager: {e}")))?;
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn open_url(url: String) -> Result<(), AppError> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::new(
            ErrorKind::Internal,
            "Only HTTP and HTTPS URLs are allowed".to_string(),
        ));
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| AppError::internal(format!("Failed to open URL: {e}")))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", &url])
            .spawn()
            .map_err(|e| AppError::internal(format!("Failed to open URL: {e}")))?;
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| AppError::internal(format!("Failed to open URL: {e}")))?;
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn init_repo(path: String) -> Result<RepoInfo, AppError> {
    let p = Path::new(&path);
    if !p.exists() {
        std::fs::create_dir_all(p)?;
    }

    let cli = create_git_cli();
    cli.exec(p, &["init"], git_core::CommandOptions::default())?;

    let canonical = p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    Ok(RepoInfo {
        root: canonical.to_string_lossy().to_string(),
        head_branch: "main".to_string(),
    })
}

#[tauri::command]
#[specta::specta]
pub fn clone_repo(app: AppHandle, url: String, dir: String) -> Result<JobId, AppError> {
    let cli = create_git_cli();

    let (job_id, _) = spawn_job(app, move |cancel_token, progress_cb| {
        let parent = Path::new(&dir).parent().unwrap_or_else(|| Path::new("."));
        let mut opts = git_core::CommandOptions::default().with_cancel_token(cancel_token);
        opts = opts.with_stderr_callback(std::sync::Arc::new(move |line| {
            if let Some(p) = git_core::ops::parse_progress_line(line) {
                progress_cb(p);
            }
        }));

        cli.exec(parent, &["clone", "--progress", &url, &dir], opts)?;
        Ok(())
    });

    Ok(job_id)
}
