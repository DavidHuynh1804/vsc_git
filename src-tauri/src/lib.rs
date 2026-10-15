pub mod app;
pub mod error;
pub mod git_exec;
pub mod repo;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(repo::session::SessionState::new())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
