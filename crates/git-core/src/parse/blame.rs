use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

/// A parsed commit referenced by a blame line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlameCommit {
    pub sha: String,
    pub author: String,
    pub author_mail: String,
    pub author_time: i64,
    pub summary: String,
    pub previous: Option<String>,
}

/// A line in a file with its 1-based line number and associated commit metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlameLine {
    pub line_no: u32,
    pub commit: Arc<BlameCommit>,
}

#[derive(Default)]
struct CommitBuilder {
    author: Option<String>,
    author_mail: Option<String>,
    author_time: Option<i64>,
    summary: Option<String>,
    previous: Option<String>,
}

/// Parses the output of `git blame --porcelain` into deduplicated `BlameLine` entries.
pub fn parse_blame(output: &str) -> Vec<BlameLine> {
    let mut commits: HashMap<String, Arc<BlameCommit>> = HashMap::new();
    let mut builders: HashMap<String, CommitBuilder> = HashMap::new();
    let mut lines = Vec::new();

    let mut current_sha = String::new();
    let mut current_final_line = 0u32;

    for line in output.lines() {
        if line.starts_with('\t') {
            let commit = if let Some(c) = commits.get(&current_sha) {
                Arc::clone(c)
            } else {
                let builder = builders.remove(&current_sha).unwrap_or_default();
                let c = Arc::new(BlameCommit {
                    sha: current_sha.clone(),
                    author: builder.author.unwrap_or_default(),
                    author_mail: builder.author_mail.unwrap_or_default(),
                    author_time: builder.author_time.unwrap_or(0),
                    summary: builder.summary.unwrap_or_default(),
                    previous: builder.previous,
                });
                commits.insert(current_sha.clone(), Arc::clone(&c));
                c
            };

            lines.push(BlameLine {
                line_no: current_final_line,
                commit,
            });
            continue;
        }

        if let Some(rest) = line.strip_prefix("author ") {
            builders.entry(current_sha.clone()).or_default().author = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("author-mail ") {
            let email = rest
                .trim()
                .trim_start_matches('<')
                .trim_end_matches('>')
                .to_string();
            builders.entry(current_sha.clone()).or_default().author_mail = Some(email);
        } else if let Some(rest) = line.strip_prefix("author-time ") {
            builders.entry(current_sha.clone()).or_default().author_time = rest.trim().parse().ok();
        } else if let Some(rest) = line.strip_prefix("summary ") {
            builders.entry(current_sha.clone()).or_default().summary = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("previous ") {
            let prev_sha = rest.split_whitespace().next().unwrap_or(rest).to_string();
            builders.entry(current_sha.clone()).or_default().previous = Some(prev_sha);
        } else {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 && parts[0].len() >= 8 {
                if let (Ok(_orig), Ok(final_line)) =
                    (parts[1].parse::<u32>(), parts[2].parse::<u32>())
                {
                    current_sha = parts[0].to_string();
                    current_final_line = final_line;
                    builders.entry(current_sha.clone()).or_default();
                }
            }
        }
    }

    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_blame_basic() {
        let input = "\
476d637dddfab8edcad12c02a7b1d74a5ac7a698 1 1 2
author Alice
author-mail <alice@example.com>
author-time 1700000000
summary First commit
filename foo.rs
\tline 1
476d637dddfab8edcad12c02a7b1d74a5ac7a698 2 2
\tline 2
b09a1234dddfab8edcad12c02a7b1d74a5ac7a698 1 3 1
author Bob
author-mail <bob@example.com>
author-time 1700001000
summary Second commit
previous 476d637dddfab8edcad12c02a7b1d74a5ac7a698 foo.rs
filename foo.rs
\tline 3
";
        let lines = parse_blame(input);
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].line_no, 1);
        assert_eq!(
            lines[0].commit.sha,
            "476d637dddfab8edcad12c02a7b1d74a5ac7a698"
        );
        assert_eq!(lines[0].commit.author, "Alice");
        assert_eq!(lines[0].commit.author_mail, "alice@example.com");
        assert_eq!(lines[0].commit.author_time, 1700000000);
        assert_eq!(lines[0].commit.summary, "First commit");
        assert_eq!(lines[0].commit.previous, None);

        assert_eq!(lines[1].line_no, 2);
        assert!(Arc::ptr_eq(&lines[0].commit, &lines[1].commit));

        assert_eq!(lines[2].line_no, 3);
        assert_eq!(
            lines[2].commit.sha,
            "b09a1234dddfab8edcad12c02a7b1d74a5ac7a698"
        );
        assert_eq!(lines[2].commit.author, "Bob");
        assert_eq!(
            lines[2].commit.previous,
            Some("476d637dddfab8edcad12c02a7b1d74a5ac7a698".to_string())
        );
    }
}
