use std::fs;
use std::path::Path;
use std::sync::Once;
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Manager};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter, Layer};

use crate::error::AppError;

static INIT_LOGGING: Once = Once::new();
static mut LOG_GUARD: Option<WorkerGuard> = None;

pub const LOG_PREFIX: &str = "vsc_git.log";
pub const MAX_LOG_AGE_DAYS: u64 = 7;

#[derive(Debug, Clone, specta::Type, serde::Serialize, serde::Deserialize)]
pub struct ExportedLogs {
    pub path: String,
    pub line_count: u32,
}

pub fn prune_old_logs(log_dir: &Path, max_age_days: u64) -> Result<usize, AppError> {
    if !log_dir.exists() {
        return Ok(0);
    }

    let mut deleted_count = 0;
    let max_age = Duration::from_secs(max_age_days * 24 * 60 * 60);
    let now = SystemTime::now();

    for entry in fs::read_dir(log_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let file_name = path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();

        if file_name.starts_with("vsc_git") {
            if let Ok(metadata) = entry.metadata() {
                if let Ok(modified) = metadata.modified() {
                    if let Ok(age) = now.duration_since(modified) {
                        if age > max_age {
                            let _ = fs::remove_file(&path);
                            deleted_count += 1;
                        }
                    }
                }
            }
        }
    }

    Ok(deleted_count)
}

pub fn init_logging(log_dir: &Path) -> Result<(), AppError> {
    fs::create_dir_all(log_dir)?;
    let _ = prune_old_logs(log_dir, MAX_LOG_AGE_DAYS);

    INIT_LOGGING.call_once(|| {
        let file_appender = tracing_appender::rolling::daily(log_dir, LOG_PREFIX);
        let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

        unsafe {
            LOG_GUARD = Some(guard);
        }

        let env_filter = EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| EnvFilter::new("info,vsc_git=debug"));

        let file_layer = tracing_subscriber::fmt::layer()
            .with_writer(non_blocking)
            .with_ansi(false)
            .with_target(true)
            .with_thread_ids(true);

        let stdout_layer = tracing_subscriber::fmt::layer()
            .with_writer(std::io::stdout)
            .with_ansi(true)
            .with_filter(EnvFilter::new("info"));

        tracing_subscriber::registry()
            .with(env_filter)
            .with(file_layer)
            .with(stdout_layer)
            .init();

        tracing::info!("Logging initialized in {}", log_dir.display());
    });

    Ok(())
}

pub fn export_logs_from_dir(log_dir: &Path) -> Result<ExportedLogs, AppError> {
    if !log_dir.exists() {
        return Err(AppError::internal(format!(
            "Log directory does not exist: {}",
            log_dir.display()
        )));
    }

    let mut log_files = Vec::new();
    for entry in fs::read_dir(log_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
            let file_name = path
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default();
            if file_name.starts_with("vsc_git") && !file_name.contains("export") {
                log_files.push(path);
            }
        }
    }

    log_files.sort();

    let mut combined = String::new();
    let mut total_lines = 0;

    for path in log_files {
        if let Ok(content) = fs::read_to_string(&path) {
            combined.push_str(&format!("--- Log file: {} ---\n", path.display()));
            total_lines += content.lines().count();
            combined.push_str(&content);
            combined.push('\n');
        }
    }

    let export_path = log_dir.join("vsc_git_logs_export.txt");
    fs::write(&export_path, combined)?;

    Ok(ExportedLogs {
        path: export_path.to_string_lossy().to_string(),
        line_count: total_lines as u32,
    })
}

#[tauri::command]
#[specta::specta]
pub fn export_logs(app: AppHandle) -> Result<ExportedLogs, AppError> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| AppError::internal(e.to_string()))?;
    export_logs_from_dir(&log_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prune_and_export_logs() {
        let test_dir =
            std::env::temp_dir().join(format!("vsc_git_test_logs_{}", std::process::id()));
        let _ = fs::remove_dir_all(&test_dir);
        fs::create_dir_all(&test_dir).unwrap();

        let log_file1 = test_dir.join("vsc_git.log.2026-10-14");
        fs::write(&log_file1, "line 1\nline 2\n").unwrap();

        let log_file2 = test_dir.join("vsc_git.log.2026-10-15");
        fs::write(&log_file2, "line 3\nline 4\nline 5\n").unwrap();

        let exported = export_logs_from_dir(&test_dir).unwrap();
        assert_eq!(exported.line_count, 5);
        assert!(Path::new(&exported.path).exists());

        let pruned = prune_old_logs(&test_dir, 7).unwrap();
        assert_eq!(pruned, 0);

        let _ = fs::remove_dir_all(&test_dir);
    }
}
