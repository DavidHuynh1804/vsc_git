use std::collections::HashMap;
use std::path::{Path, PathBuf};

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager, Window};

use crate::app::recent::add_recent_repo;
use crate::error::{AppError, ErrorKind};
use crate::git_exec::execute_git;

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
pub struct RepoInfo {
    pub root: String,
    pub head_branch: String,
}

#[derive(Debug, Clone)]
pub struct RepoSession {
    pub root: PathBuf,
    pub head_branch: String,
}

#[derive(Default)]
pub struct SessionState {
    pub sessions: RwLock<HashMap<String, RepoSession>>,
}

impl SessionState {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
        }
    }
}

pub fn parse_git_version(version_str: &str) -> Result<(u32, u32, u32), AppError> {
    for word in version_str.split_whitespace() {
        let parts: Vec<&str> = word.split('.').collect();
        if parts.len() >= 2 {
            if let (Ok(major), Ok(minor)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
                let patch = parts
                    .get(2)
                    .and_then(|p| {
                        p.chars()
                            .take_while(|c| c.is_ascii_digit())
                            .collect::<String>()
                            .parse::<u32>()
                            .ok()
                    })
                    .unwrap_or(0);
                return Ok((major, minor, patch));
            }
        }
    }

    Err(AppError::new(
        ErrorKind::GitMissing,
        format!("Unable to parse git version from: '{version_str}'"),
    ))
}

pub fn check_git_version_requirement(major: u32, minor: u32) -> Result<(), AppError> {
    if major < 2 || (major == 2 && minor < 35) {
        return Err(AppError::new(
            ErrorKind::GitTooOld,
            format!(
                "Git version {major}.{minor} is too old. vsc_git requires Git >= 2.35.0. Please update Git."
            ),
        ).with_hint("https://git-scm.com/downloads", "Download Latest Git"));
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn git_version(app: AppHandle) -> Result<String, AppError> {
    let output = execute_git(None, &["--version"], Some(&app))?;
    if !output.status.success() {
        return Err(
            AppError::new(ErrorKind::GitMissing, "Failed to run 'git --version'")
                .with_stderr(String::from_utf8_lossy(&output.stderr)),
        );
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let (major, minor, patch) = parse_git_version(&stdout)?;
    check_git_version_requirement(major, minor)?;

    Ok(format!("{major}.{minor}.{patch}"))
}

#[tauri::command]
#[specta::specta]
pub fn open_repo(app: AppHandle, window: Window, path: String) -> Result<RepoInfo, AppError> {
    let repo_path = Path::new(&path);
    if !repo_path.exists() {
        return Err(AppError::new(
            ErrorKind::NotARepo,
            format!("Path does not exist: '{path}'"),
        ));
    }

    let output = execute_git(
        Some(repo_path),
        &["rev-parse", "--show-toplevel"],
        Some(&app),
    )?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(AppError::not_a_repo(&path).with_stderr(stderr));
    }

    let root_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let root_path = PathBuf::from(&root_str);
    let canonical_root = root_path
        .canonicalize()
        .unwrap_or_else(|_| root_path.clone());
    let canonical_str = canonical_root.to_string_lossy().to_string();

    let branch_output = execute_git(
        Some(&canonical_root),
        &["symbolic-ref", "--short", "HEAD"],
        Some(&app),
    )?;

    let head_branch = if branch_output.status.success() {
        String::from_utf8_lossy(&branch_output.stdout)
            .trim()
            .to_string()
    } else {
        // Fallback to commit sha or rev-parse HEAD
        let sha_output = execute_git(
            Some(&canonical_root),
            &["rev-parse", "--short", "HEAD"],
            Some(&app),
        )?;
        if sha_output.status.success() {
            format!(
                "HEAD ({})",
                String::from_utf8_lossy(&sha_output.stdout).trim()
            )
        } else {
            "HEAD".to_string()
        }
    };

    let session = RepoSession {
        root: canonical_root.clone(),
        head_branch: head_branch.clone(),
    };

    if let Some(state) = app.try_state::<SessionState>() {
        state
            .sessions
            .write()
            .insert(window.label().to_string(), session);
    }

    if let Ok(config_dir) = app.path().app_config_dir() {
        let _ = add_recent_repo(&config_dir, &canonical_str);
    }

    Ok(RepoInfo {
        root: canonical_str,
        head_branch,
    })
}

#[tauri::command]
#[specta::specta]
pub fn get_current_repo(app: AppHandle, window: Window) -> Result<Option<RepoInfo>, AppError> {
    if let Some(state) = app.try_state::<SessionState>() {
        let lock = state.sessions.read();
        if let Some(session) = lock.get(window.label()) {
            return Ok(Some(RepoInfo {
                root: session.root.to_string_lossy().to_string(),
                head_branch: session.head_branch.clone(),
            }));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_git_version() {
        let v = parse_git_version("git version 2.55.0\n").unwrap();
        assert_eq!(v, (2, 55, 0));

        let v2 = parse_git_version("git version 2.39.2.windows.1").unwrap();
        assert_eq!(v2, (2, 39, 2));

        let v_apple = parse_git_version("git version 2.39.5 (Apple Git-154)").unwrap();
        assert_eq!(v_apple, (2, 39, 5));
    }

    #[test]
    fn test_git_version_requirements() {
        assert!(check_git_version_requirement(2, 35).is_ok());
        assert!(check_git_version_requirement(2, 55).is_ok());
        assert!(check_git_version_requirement(3, 0).is_ok());

        let too_old = check_git_version_requirement(2, 34);
        assert!(too_old.is_err());
        assert_eq!(too_old.unwrap_err().kind, ErrorKind::GitTooOld);

        let v1 = check_git_version_requirement(1, 9);
        assert!(v1.is_err());
    }
}
