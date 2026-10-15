use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, Window};

use crate::error::{AppError, ErrorKind};
use crate::repo::session::{RepoSession, SessionState};

pub fn active_session(app: &AppHandle, window: &Window) -> Result<RepoSession, AppError> {
    if let Some(state) = app.try_state::<SessionState>() {
        if let Some(session) = RepoSession::session_for_window(&state, window) {
            return Ok(session);
        }
    }
    Err(AppError::new(
        ErrorKind::NotARepo,
        "No repository open in this window",
    ))
}

pub fn validate_path_in_repo(root: &Path, rel_or_abs_path: &str) -> Result<PathBuf, AppError> {
    let root_canon = root.canonicalize().map_err(|e| {
        AppError::new(
            ErrorKind::NotARepo,
            format!("Invalid repo root {}: {e}", root.display()),
        )
    })?;

    let p = Path::new(rel_or_abs_path);
    let full = if p.is_absolute() {
        p.to_path_buf()
    } else {
        root_canon.join(p)
    };

    if full.exists() {
        let full_canon = full.canonicalize().map_err(|e| {
            AppError::internal(format!("Cannot canonicalize path {}: {e}", full.display()))
        })?;
        if !full_canon.starts_with(&root_canon) {
            return Err(AppError::internal(format!(
                "Path escapes repository: {rel_or_abs_path}"
            )));
        }
        Ok(full_canon)
    } else {
        let mut curr = full.clone();
        while let Some(parent) = curr.parent() {
            if parent.exists() {
                let parent_canon = parent.canonicalize().map_err(|e| {
                    AppError::internal(format!(
                        "Cannot canonicalize parent {}: {e}",
                        parent.display()
                    ))
                })?;
                if !parent_canon.starts_with(&root_canon) {
                    return Err(AppError::internal(format!(
                        "Path escapes repository: {rel_or_abs_path}"
                    )));
                }
                break;
            }
            curr = parent.to_path_buf();
        }
        Ok(full)
    }
}

pub fn validate_and_relativize_path(
    root: &Path,
    rel_or_abs_path: &str,
) -> Result<(PathBuf, String), AppError> {
    let root_canon = root.canonicalize().map_err(|e| {
        AppError::new(
            ErrorKind::NotARepo,
            format!("Invalid repo root {}: {e}", root.display()),
        )
    })?;

    let full_canon = validate_path_in_repo(root, rel_or_abs_path)?;
    let rel = full_canon
        .strip_prefix(&root_canon)
        .map_err(|_| AppError::internal(format!("Path escapes repository: {rel_or_abs_path}")))?
        .to_string_lossy()
        .replace('\\', "/");

    Ok((full_canon, rel))
}
