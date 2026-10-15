pub mod app;
pub mod commands;
pub mod error;
pub mod git_exec;
pub mod repo;

use tauri_specta::{collect_commands, collect_events, Builder};

pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            app::settings::get_settings,
            app::settings::set_settings,
            app::recent::recent_repos,
            app::logging::export_logs,
            repo::session::open_repo,
            repo::session::get_current_repo,
            repo::session::git_version,
            git_exec::get_git_output,
            commands::pick_folder,
        ])
        .events(collect_events![
            git_exec::GitOutputEvent,
            repo::watcher::StatusChangedEvent,
            repo::watcher::RefsChangedEvent,
        ])
}

pub fn export_bindings(path: &str) -> Result<(), Box<dyn std::error::Error>> {
    specta_builder().export(specta_typescript::Typescript::default(), path)?;
    Ok(())
}

pub fn run() {
    let builder = specta_builder();

    #[cfg(debug_assertions)]
    {
        let _ = export_bindings("../src/bindings.ts");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(repo::session::SessionState::new())
        .manage(repo::watcher::WatcherState::new())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_export_bindings() {
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let out_path = manifest_dir.join("../src/bindings.ts");
        export_bindings(out_path.to_str().unwrap()).expect("export bindings");
        assert!(out_path.exists());
    }
}
