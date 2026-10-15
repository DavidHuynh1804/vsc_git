use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager};

use crate::error::AppError;

pub const MAX_RECENT_REPOS: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
pub struct RecentRepo {
    pub path: String,
    pub name: String,
    pub last_opened: i64,
}

pub fn get_recent_path(config_dir: &Path) -> PathBuf {
    config_dir.join("recent.json")
}

pub fn load_recent_from_dir(config_dir: &Path) -> Result<Vec<RecentRepo>, AppError> {
    let path = get_recent_path(config_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let contents = fs::read_to_string(&path)?;
    let repos: Vec<RecentRepo> = serde_json::from_str(&contents).unwrap_or_default();
    Ok(repos)
}

pub fn save_recent_to_dir(config_dir: &Path, repos: &[RecentRepo]) -> Result<(), AppError> {
    let path = get_recent_path(config_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let serialized = serde_json::to_string_pretty(repos)?;
    fs::write(&path, serialized)?;
    Ok(())
}

pub fn add_recent_repo(config_dir: &Path, repo_path: &str) -> Result<Vec<RecentRepo>, AppError> {
    let mut list = load_recent_from_dir(config_dir)?;
    let canonical = Path::new(repo_path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| repo_path.to_string());

    let name = Path::new(&canonical)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| canonical.clone());

    let now = Utc::now().timestamp();

    list.retain(|r| r.path != canonical);
    list.insert(
        0,
        RecentRepo {
            path: canonical,
            name,
            last_opened: now,
        },
    );

    if list.len() > MAX_RECENT_REPOS {
        list.truncate(MAX_RECENT_REPOS);
    }

    save_recent_to_dir(config_dir, &list)?;
    Ok(list)
}

#[tauri::command]
#[specta::specta]
pub fn recent_repos(app: AppHandle) -> Result<Vec<RecentRepo>, AppError> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::internal(e.to_string()))?;
    load_recent_from_dir(&config_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_recent_repos_crud() {
        let dir = std::env::temp_dir().join(format!("vsc_git_test_recent_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        let initial = load_recent_from_dir(&dir).unwrap();
        assert!(initial.is_empty());

        let list = add_recent_repo(&dir, "/tmp/repo_a").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "repo_a");

        let list = add_recent_repo(&dir, "/tmp/repo_b").unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "repo_b");
        assert_eq!(list[1].name, "repo_a");

        // Re-adding repo_a should bump it to top
        let list = add_recent_repo(&dir, "/tmp/repo_a").unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "repo_a");

        let _ = fs::remove_dir_all(&dir);
    }
}
