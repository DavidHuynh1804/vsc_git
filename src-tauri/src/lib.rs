pub mod app;
pub mod commands;
pub mod error;
pub mod git_exec;
pub mod repo;

use tauri_specta::{collect_commands, collect_events, Builder};

pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            // App / Settings / Session
            app::settings::get_settings,
            app::settings::set_settings,
            app::recent::recent_repos,
            app::logging::export_logs,
            repo::session::open_repo,
            repo::session::get_current_repo,
            repo::session::git_version,
            git_exec::get_git_output,
            commands::pick_folder,
            repo::jobs::cancel_job,
            repo::ipc::answer_prompt,
            commands::app::open_in_editor,
            commands::app::reveal_in_file_manager,
            commands::app::open_url,
            commands::app::init_repo,
            commands::app::clone_repo,
            // Status & Stage & Content & Commit
            commands::status::get_status,
            commands::status::refresh,
            commands::status::stage,
            commands::status::unstage,
            commands::status::discard,
            commands::status::stage_all,
            commands::status::unstage_all,
            commands::status::stage_selections,
            commands::status::unstage_selections,
            commands::status::revert_selections,
            commands::status::get_file_content,
            commands::status::save_worktree_file,
            commands::status::commit,
            commands::status::last_commit_message,
            commands::status::get_draft_message,
            commands::status::set_draft_message,
            // Branch & Sync & Stash
            commands::branch::list_refs,
            commands::branch::checkout,
            commands::branch::create_branch,
            commands::branch::rename_branch,
            commands::branch::delete_branch,
            commands::branch::delete_remote_branch,
            commands::branch::set_upstream,
            commands::branch::create_tag,
            commands::branch::delete_tag,
            commands::branch::push_tag,
            commands::branch::fetch,
            commands::branch::pull,
            commands::branch::push,
            commands::branch::sync,
            commands::branch::list_stashes,
            commands::branch::stash_push,
            commands::branch::stash_apply,
            commands::branch::stash_pop,
            commands::branch::stash_drop,
            commands::branch::stash_diff,
            // History & Conflict & Blame
            commands::history::cherry_pick,
            commands::history::revert,
            commands::history::reset,
            commands::history::merge,
            commands::history::rebase,
            commands::history::rebase_interactive,
            commands::history::submit_rebase_todo,
            commands::history::op_continue,
            commands::history::op_skip,
            commands::history::op_abort,
            commands::history::get_operation_state,
            commands::history::get_conflict,
            commands::history::resolve_conflict,
            commands::history::resolve_with,
            commands::history::blame,
            commands::history::file_history,
            // Graph
            commands::graph::graph_reset,
            commands::graph::graph_page,
            commands::graph::commit_detail,
            commands::graph::compare,
            commands::graph::graph_search,
        ])
        .events(collect_events![
            git_exec::GitOutputEvent,
            repo::watcher::StatusChangedEvent,
            repo::watcher::RefsChangedEvent,
            repo::watcher::OperationChangedEvent,
            repo::jobs::JobProgressEvent,
            repo::jobs::JobDoneEvent,
            repo::jobs::JobChunkEvent,
            repo::ipc::PromptRequestEvent,
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
            crate::git_exec::set_global_app_handle(app.handle().clone());
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
