use crate::error::AppError;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
#[specta::specta]
pub fn pick_folder(app: AppHandle) -> Result<Option<String>, AppError> {
    let picked = app.dialog().file().blocking_pick_folder();
    Ok(picked
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string()))
}
