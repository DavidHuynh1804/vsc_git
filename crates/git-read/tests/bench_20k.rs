use std::io::Write;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use git_read::{GraphFilter, GraphWalker, ReadRepo};
use tempfile::TempDir;

fn create_20k_repo(dir: &std::path::Path) {
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

        for i in 1..=20_000 {
            let msg = format!("Commit {i}");
            let content = format!("Content {i}\n");

            let commit_header = format!(
                "commit refs/heads/main\nmark :{i}\ncommitter Tester <tester@example.com> {} +0000\ndata {}\n{}\n",
                base_time + i,
                msg.len(),
                msg
            );
            buffer.extend_from_slice(commit_header.as_bytes());

            if i > 1 {
                let from_line = format!("from :{}\n", i - 1);
                buffer.extend_from_slice(from_line.as_bytes());
            }

            let file_data = format!(
                "M 644 inline file.txt\ndata {}\n{}\n",
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

    // Point HEAD to refs/heads/main
    let reset = Command::new("git")
        .args(["reset", "--hard", "refs/heads/main"])
        .current_dir(dir)
        .output()
        .expect("git reset failed");
    assert!(reset.status.success());
}

#[test]
#[ignore]
fn bench_20k_commits_first_page_500() {
    let dir = TempDir::new().unwrap();
    let repo_path = dir.path();

    println!("Creating 20k commits repo with git fast-import...");
    let t_create = Instant::now();
    create_20k_repo(repo_path);
    println!("Repo creation took: {:?}", t_create.elapsed());

    let repo = ReadRepo::open(repo_path).expect("Failed to open repo");

    let t_start = Instant::now();
    let mut walker =
        GraphWalker::new(repo, GraphFilter::default()).expect("Failed to create walker");
    let page = walker.next_page(500).expect("Failed to read next page");
    let duration = t_start.elapsed();

    println!(
        "BENCHMARK RESULT: First page 500 commits in 20k repo took: {:?}",
        duration
    );

    assert_eq!(page.commits.len(), 500);
    assert_eq!(page.rows.len(), 500);
    assert!(page.has_more);

    let threshold = if cfg!(debug_assertions) {
        Duration::from_millis(2000)
    } else {
        Duration::from_millis(300)
    };
    assert!(
        duration < threshold,
        "Expected first page of 500 commits < {:?}, took {:?}",
        threshold,
        duration
    );
}
