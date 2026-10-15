use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager};

use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostConfig {
    pub host: String,
    pub kind: String,
    pub api_base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
pub struct Settings {
    #[serde(rename = "git.path", default)]
    pub git_path: Option<String>,

    #[serde(rename = "git.autoFetch", default = "default_true")]
    pub git_auto_fetch: bool,

    #[serde(rename = "git.autoFetchPeriodSec", default = "default_180")]
    pub git_auto_fetch_period_sec: u32,

    #[serde(rename = "git.confirmSync", default = "default_true")]
    pub git_confirm_sync: bool,

    #[serde(rename = "git.enableSmartCommit", default = "default_ask")]
    pub git_enable_smart_commit: String,

    #[serde(rename = "git.untrackedChanges", default = "default_mixed")]
    pub git_untracked_changes: String,

    #[serde(rename = "git.pruneOnFetch", default = "default_true")]
    pub git_prune_on_fetch: bool,

    #[serde(rename = "git.defaultCloneDir", default)]
    pub git_default_clone_dir: Option<String>,

    #[serde(rename = "scm.viewMode", default = "default_list")]
    pub scm_view_mode: String,

    #[serde(rename = "diff.renderSideBySide", default = "default_true")]
    pub diff_render_side_by_side: bool,

    #[serde(rename = "diff.ignoreTrimWhitespace", default = "default_false")]
    pub diff_ignore_trim_whitespace: bool,

    #[serde(rename = "graph.showRemoteBranches", default = "default_true")]
    pub graph_show_remote_branches: bool,

    #[serde(rename = "graph.showTags", default = "default_true")]
    pub graph_show_tags: bool,

    #[serde(rename = "graph.showStashes", default = "default_true")]
    pub graph_show_stashes: bool,

    #[serde(rename = "graph.dateFormat", default = "default_relative")]
    pub graph_date_format: String,

    #[serde(rename = "graph.pageSize", default = "default_500")]
    pub graph_page_size: u32,

    #[serde(rename = "externalEditor.command", default = "default_code")]
    pub external_editor_command: String,

    #[serde(rename = "externalEditor.args", default = "default_editor_args")]
    pub external_editor_args: Vec<String>,

    #[serde(rename = "ai.enabled", default = "default_true")]
    pub ai_enabled: bool,

    #[serde(rename = "ai.provider", default = "default_claude")]
    pub ai_provider: String,

    #[serde(rename = "ai.model", default = "default_model")]
    pub ai_model: String,

    #[serde(rename = "ai.baseUrl", default)]
    pub ai_base_url: Option<String>,

    #[serde(rename = "ai.language", default = "default_auto")]
    pub ai_language: String,

    #[serde(rename = "ai.maxDiffTokens", default = "default_20000")]
    pub ai_max_diff_tokens: u32,

    #[serde(rename = "ai.excludeGlobs", default = "default_exclude_globs")]
    pub ai_exclude_globs: Vec<String>,

    #[serde(rename = "ai.disabledRepos", default)]
    pub ai_disabled_repos: Vec<String>,

    #[serde(rename = "ai.consents", default)]
    pub ai_consents: HashMap<String, Vec<String>>,

    #[serde(rename = "hosts", default = "default_hosts")]
    pub hosts: Vec<HostConfig>,

    #[serde(rename = "ui.theme", default = "default_system")]
    pub ui_theme: String,

    #[serde(rename = "update.channel", default = "default_stable")]
    pub update_channel: String,
}

fn default_true() -> bool {
    true
}
fn default_false() -> bool {
    false
}
fn default_180() -> u32 {
    180
}
fn default_500() -> u32 {
    500
}
fn default_20000() -> u32 {
    20000
}
fn default_ask() -> String {
    "ask".to_string()
}
fn default_mixed() -> String {
    "mixed".to_string()
}
fn default_list() -> String {
    "list".to_string()
}
fn default_relative() -> String {
    "relative".to_string()
}
fn default_code() -> String {
    "code".to_string()
}
fn default_editor_args() -> Vec<String> {
    vec!["--goto".to_string(), "{file}:{line}".to_string()]
}
fn default_claude() -> String {
    "claude".to_string()
}
fn default_model() -> String {
    "claude-haiku-5-5".to_string()
}
fn default_auto() -> String {
    "auto".to_string()
}
fn default_system() -> String {
    "system".to_string()
}
fn default_stable() -> String {
    "stable".to_string()
}
fn default_exclude_globs() -> Vec<String> {
    vec![
        "**/*.lock".to_string(),
        "**/package-lock.json".to_string(),
        "**/pnpm-lock.yaml".to_string(),
        "**/*.min.*".to_string(),
        "dist/**".to_string(),
        "build/**".to_string(),
    ]
}
fn default_hosts() -> Vec<HostConfig> {
    vec![
        HostConfig {
            host: "github.com".to_string(),
            kind: "github".to_string(),
            api_base_url: "https://api.github.com".to_string(),
        },
        HostConfig {
            host: "gitlab.com".to_string(),
            kind: "gitlab".to_string(),
            api_base_url: "https://gitlab.com/api/v4".to_string(),
        },
    ]
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            git_path: None,
            git_auto_fetch: default_true(),
            git_auto_fetch_period_sec: default_180(),
            git_confirm_sync: default_true(),
            git_enable_smart_commit: default_ask(),
            git_untracked_changes: default_mixed(),
            git_prune_on_fetch: default_true(),
            git_default_clone_dir: None,
            scm_view_mode: default_list(),
            diff_render_side_by_side: default_true(),
            diff_ignore_trim_whitespace: default_false(),
            graph_show_remote_branches: default_true(),
            graph_show_tags: default_true(),
            graph_show_stashes: default_true(),
            graph_date_format: default_relative(),
            graph_page_size: default_500(),
            external_editor_command: default_code(),
            external_editor_args: default_editor_args(),
            ai_enabled: default_true(),
            ai_provider: default_claude(),
            ai_model: default_model(),
            ai_base_url: None,
            ai_language: default_auto(),
            ai_max_diff_tokens: default_20000(),
            ai_exclude_globs: default_exclude_globs(),
            ai_disabled_repos: Vec::new(),
            ai_consents: HashMap::new(),
            hosts: default_hosts(),
            ui_theme: default_system(),
            update_channel: default_stable(),
        }
    }
}
pub fn normalize_repo_path(path: &str) -> String {
    let p = Path::new(path);
    if let Ok(canon) = p.canonicalize() {
        canon.to_string_lossy().replace('\\', "/")
    } else {
        path.trim_end_matches(['/', '\\']).replace('\\', "/")
    }
}

impl Settings {
    pub fn has_ai_consent(&self, repo_path: &str, provider: &str) -> bool {
        let norm = normalize_repo_path(repo_path);
        let prov = provider.to_lowercase();
        if let Some(list) = self.ai_consents.get(&norm) {
            if list.iter().any(|p| p.eq_ignore_ascii_case(&prov)) {
                return true;
            }
        }
        if let Some(list) = self.ai_consents.get(repo_path) {
            if list.iter().any(|p| p.eq_ignore_ascii_case(&prov)) {
                return true;
            }
        }
        false
    }

    pub fn set_ai_consent(&mut self, repo_path: &str, provider: &str, granted: bool) {
        let norm = normalize_repo_path(repo_path);
        let prov = provider.to_lowercase();
        let list = self.ai_consents.entry(norm).or_default();
        if granted {
            if !list.iter().any(|p| p.eq_ignore_ascii_case(&prov)) {
                list.push(prov);
            }
        } else {
            list.retain(|p| !p.eq_ignore_ascii_case(&prov));
        }
    }
}

pub fn get_settings_path(config_dir: &Path) -> PathBuf {
    config_dir.join("settings.json")
}

pub fn load_settings_from_dir(config_dir: &Path) -> Result<Settings, AppError> {
    let path = get_settings_path(config_dir);
    if !path.exists() {
        let default_settings = Settings::default();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let serialized = serde_json::to_string_pretty(&default_settings)?;
        fs::write(&path, serialized)?;
        return Ok(default_settings);
    }

    let contents = fs::read_to_string(&path)?;
    let settings: Settings =
        serde_json::from_str(&contents).unwrap_or_else(|_| Settings::default());
    Ok(settings)
}

pub fn save_settings_to_dir(config_dir: &Path, settings: &Settings) -> Result<(), AppError> {
    let path = get_settings_path(config_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let serialized = serde_json::to_string_pretty(settings)?;
    fs::write(&path, serialized)?;
    Ok(())
}

pub fn patch_settings_value(
    current: &Settings,
    patch: &serde_json::Value,
) -> Result<Settings, AppError> {
    let mut current_val = serde_json::to_value(current)?;
    if let (Some(cur_obj), Some(patch_obj)) = (current_val.as_object_mut(), patch.as_object()) {
        for (k, v) in patch_obj {
            cur_obj.insert(k.clone(), v.clone());
        }
    }
    let updated: Settings = serde_json::from_value(current_val)?;
    Ok(updated)
}

#[tauri::command]
#[specta::specta]
pub fn get_settings(app: AppHandle) -> Result<Settings, AppError> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::internal(e.to_string()))?;
    load_settings_from_dir(&config_dir)
}

#[tauri::command]
#[specta::specta]
pub fn set_settings(app: AppHandle, patch_json: String) -> Result<Settings, AppError> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::internal(e.to_string()))?;
    let current = load_settings_from_dir(&config_dir)?;
    let patch_val: serde_json::Value = serde_json::from_str(&patch_json)?;
    let updated = patch_settings_value(&current, &patch_val)?;
    save_settings_to_dir(&config_dir, &updated)?;
    Ok(updated)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_settings_default_and_roundtrip() {
        let dir =
            std::env::temp_dir().join(format!("vsc_git_test_settings_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        let s = load_settings_from_dir(&dir).expect("load defaults");
        assert_eq!(s.ui_theme, "system");
        assert!(s.git_auto_fetch);
        assert_eq!(s.graph_page_size, 500);

        let patch = serde_json::json!({
            "ui.theme": "dark",
            "graph.pageSize": 200
        });
        let updated = patch_settings_value(&s, &patch).expect("patch");
        assert_eq!(updated.ui_theme, "dark");
        assert_eq!(updated.graph_page_size, 200);

        save_settings_to_dir(&dir, &updated).expect("save");
        let reloaded = load_settings_from_dir(&dir).expect("reload");
        assert_eq!(reloaded.ui_theme, "dark");
        assert_eq!(reloaded.graph_page_size, 200);

        let _ = fs::remove_dir_all(&dir);
    }
}
