pub mod ai;
pub mod app;
pub mod branch;
pub mod graph;
pub mod history;
pub mod hosting;
pub mod mod_helpers;
pub mod status;
pub mod types;

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::error::AppError;

#[tauri::command]
#[specta::specta]
pub fn pick_folder(app: AppHandle) -> Result<Option<String>, AppError> {
    let picked = app.dialog().file().blocking_pick_folder();
    Ok(picked
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string()))
}
