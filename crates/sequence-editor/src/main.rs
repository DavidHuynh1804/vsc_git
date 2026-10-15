use std::env;
use std::fs;
use std::path::Path;
use std::process;
use vsc_ipc::{send_request, IpcRequestKind};

fn main() {
    let path_arg = match env::args().nth(1) {
        Some(p) => p,
        None => process::exit(1),
    };

    let file_path = Path::new(&path_arg);
    let content = match fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(_) => process::exit(1),
    };

    let is_commit_msg = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|name| name == "COMMIT_EDITMSG")
        .unwrap_or(false);

    let kind = if is_commit_msg {
        IpcRequestKind::EditMessage { text: content }
    } else {
        IpcRequestKind::SequenceEdit { todo: content }
    };

    match send_request(kind) {
        Ok(new_content) => {
            if fs::write(file_path, new_content).is_err() {
                process::exit(1);
            }
        }
        Err(_) => {
            process::exit(1);
        }
    }
}
