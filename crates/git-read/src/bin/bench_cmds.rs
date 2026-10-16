use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Instant;

use git_core::GitCli;
use git_read::{GraphFilter, GraphWalker, HeadInfo, ReadRepo};

fn create_repo_fast_import(dir: &Path, num_commits: usize, num_files: usize) {
    let _ = std::fs::create_dir_all(dir);

    let output = Command::new("git")
        .args(["init", "-b", "main"])
        .current_dir(dir)
        .output()
        .expect("git init failed");
    assert!(output.status.success());

    let mut child = Command::new("git")
        .args(["fast-import", "--quiet"])
        .current_dir(dir)
        .stdin(Stdio::piped())
        .spawn()
        .expect("git fast-import failed to spawn");

    {
        let mut stdin = child.stdin.take().expect("Failed to open stdin");
        let base_time = 1_700_000_000i64;
        let mut buffer = Vec::with_capacity(64 * 1024);

        for i in 1..=num_commits {
            let file_id = (i % num_files) + 1;
            let filename = format!("file_{file_id}.txt");
            let msg = format!("Commit {i}");
            let content = format!("Content {i} for file {file_id}\n");

            let commit_header = format!(
                "commit refs/heads/main\nmark :{i}\ncommitter Bench Tester <bench@example.com> {} +0000\ndata {}\n{}\n",
                base_time + i as i64,
                msg.len(),
                msg
            );
            buffer.extend_from_slice(commit_header.as_bytes());

            if i > 1 {
                let from_line = format!("from :{}\n", i - 1);
                buffer.extend_from_slice(from_line.as_bytes());
            }

            let file_data = format!(
                "M 644 inline {}\ndata {}\n{}\n",
                filename,
                content.len(),
                content
            );
            buffer.extend_from_slice(file_data.as_bytes());

            if buffer.len() >= 64 * 1024 {
                stdin
                    .write_all(&buffer)
                    .expect("Failed to write to fast-import");
                buffer.clear();
            }
        }

        if !buffer.is_empty() {
            stdin
                .write_all(&buffer)
                .expect("Failed to write remaining fast-import");
        }
    }

    let status = child.wait().expect("fast-import failed");
    assert!(status.success());

    let reset = Command::new("git")
        .args(["reset", "--hard", "refs/heads/main"])
        .current_dir(dir)
        .output()
        .expect("git reset failed");
    assert!(reset.status.success());
}

fn run_benchmarks(repo_dir: &Path) -> (f64, f64, f64, f64) {
    let cli = GitCli::default();

    // 1. Status
    let t0 = Instant::now();
    let _status = git_core::ops::status(&cli, repo_dir).expect("status failed");
    let status_ms = t0.elapsed().as_secs_f64() * 1000.0;

    // 2. Graph First Page (up to 500 commits)
    let t1 = Instant::now();
    let read_repo = ReadRepo::open(repo_dir).expect("open repo failed");
    let mut walker =
        GraphWalker::new(read_repo, GraphFilter::default()).expect("walker creation failed");
    let _page = walker.next_page(500).expect("next_page failed");
    let graph_ms = t1.elapsed().as_secs_f64() * 1000.0;

    // 3. Log (first 100 commits)
    let t2 = Instant::now();
    let _log = cli
        .exec(
            repo_dir,
            &["log", "-n", "100", "--oneline"],
            git_core::CommandOptions::default(),
        )
        .expect("log failed");
    let log_ms = t2.elapsed().as_secs_f64() * 1000.0;

    // 4. Diff (HEAD commit details & diff)
    let t3 = Instant::now();
    let read_repo2 = ReadRepo::open(repo_dir).expect("open repo failed");
    let head = read_repo2.head().expect("head failed");
    let head_sha = match head {
        HeadInfo::Branch { target_sha, .. } => Some(target_sha),
        HeadInfo::Detached { sha } => Some(sha),
        HeadInfo::Empty => None,
    };
    if let Some(sha) = head_sha {
        let _detail = read_repo2
            .commit_detail(&sha)
            .expect("commit_detail failed");
    }
    let diff_ms = t3.elapsed().as_secs_f64() * 1000.0;

    (status_ms, graph_ms, log_ms, diff_ms)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut repo_path: Option<PathBuf> = None;
    let mut create_size: Option<String> = None;
    let mut json_output = false;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--repo" if i + 1 < args.len() => {
                repo_path = Some(PathBuf::from(&args[i + 1]));
                i += 1;
            }
            "--create" if i + 1 < args.len() => {
                create_size = Some(args[i + 1].clone());
                i += 1;
            }
            "--json" => {
                json_output = true;
            }
            "--help" | "-h" => {
                println!("Usage: bench_cmds [--repo <PATH>] [--create <small|large>] [--json]");
                return;
            }
            _ => {}
        }
        i += 1;
    }

    let is_temp;
    let target_dir = if let Some(p) = repo_path {
        is_temp = false;
        p
    } else {
        is_temp = true;
        let random_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let dir = std::env::temp_dir().join(format!(
            "vsc_git_bench_{}_{}",
            std::process::id(),
            random_id
        ));
        let size = create_size.as_deref().unwrap_or("small");
        let (commits, files) = match size {
            "large" | "medium" => (20_000, 5_000),
            _ => (100, 10),
        };
        create_repo_fast_import(&dir, commits, files);
        dir
    };

    let (status_ms, graph_ms, log_ms, diff_ms) = run_benchmarks(&target_dir);

    if json_output {
        println!(
            r#"{{"status_ms":{:.2},"graph_ms":{:.2},"log_ms":{:.2},"diff_ms":{:.2}}}"#,
            status_ms, graph_ms, log_ms, diff_ms
        );
    } else {
        println!("Benchmark results for {}:", target_dir.display());
        println!("  - status:             {:.2} ms", status_ms);
        println!("  - graph (first page): {:.2} ms", graph_ms);
        println!("  - log (100 commits):  {:.2} ms", log_ms);
        println!("  - diff (HEAD):        {:.2} ms", diff_ms);
    }

    if is_temp {
        let _ = std::fs::remove_dir_all(&target_dir);
    }
}
