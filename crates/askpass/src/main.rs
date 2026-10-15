use std::env;
use std::process;
use vsc_ipc::{send_request, IpcRequestKind};

fn main() {
    let prompt = env::args().nth(1).unwrap_or_default();
    match send_request(IpcRequestKind::AskPass { prompt }) {
        Ok(reply) => {
            println!("{}", reply.trim_end_matches(['\r', '\n']));
        }
        Err(_) => {
            process::exit(1);
        }
    }
}
