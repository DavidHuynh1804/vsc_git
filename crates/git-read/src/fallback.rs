use std::path::Path;

use git_core::{CommandOptions, GitCli};
use git_graph::{CommitNode, LaneState, RefKind, RefLabel};

use crate::error::ReadError;
use crate::log::{CommitSummary, GraphFilter, GraphPage, RefFilter};
use crate::repo::RefInfo;

/// Fallback for `refs()` using `git for-each-ref` and `git rev-parse HEAD`.
pub fn refs_cli(cli: &GitCli, repo_path: &Path) -> Result<Vec<RefInfo>, ReadError> {
    let mut results = Vec::new();

    // 1. HEAD reference
    let head_out = cli.exec(
        repo_path,
        &["rev-parse", "HEAD"],
        CommandOptions::read_only(),
    );
    if let Ok(out) = head_out {
        let sha = out.stdout_lossy().trim().to_string();
        if !sha.is_empty() {
            results.push(RefInfo {
                name: "HEAD".to_string(),
                kind: RefKind::Head,
                target_sha: sha,
                upstream: None,
                ahead: 0,
                behind: 0,
            });
        }
    }

    // 2. Iterate references via git for-each-ref
    let format = "%(refname)%00%(objectname)%00%(upstream:short)%00%(upstream:track)";
    let out = cli.exec(
        repo_path,
        &["for-each-ref", &format!("--format={format}")],
        CommandOptions::read_only(),
    )?;

    let stdout = out.stdout_lossy();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\0').collect();
        if parts.len() < 2 {
            continue;
        }

        let full_name = parts[0];
        let target_sha = parts[1].to_string();
        let upstream = parts
            .get(2)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let track = parts.get(3).copied().unwrap_or("");
        let (ahead, behind) = parse_ahead_behind(track);

        let (kind, short_name) = if let Some(stripped) = full_name.strip_prefix("refs/heads/") {
            (RefKind::LocalBranch, stripped.to_string())
        } else if let Some(stripped) = full_name.strip_prefix("refs/remotes/") {
            (RefKind::RemoteBranch, stripped.to_string())
        } else if let Some(stripped) = full_name.strip_prefix("refs/tags/") {
            (RefKind::Tag, stripped.to_string())
        } else if full_name == "refs/stash" {
            (RefKind::Stash, "stash".to_string())
        } else {
            continue;
        };

        results.push(RefInfo {
            name: short_name,
            kind,
            target_sha,
            upstream,
            ahead,
            behind,
        });
    }

    Ok(results)
}

fn parse_ahead_behind(track: &str) -> (u32, u32) {
    let mut ahead = 0;
    let mut behind = 0;
    if let Some(idx) = track.find("ahead ") {
        let rest = &track[idx + 6..];
        let num_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        ahead = num_str.parse().unwrap_or(0);
    }
    if let Some(idx) = track.find("behind ") {
        let rest = &track[idx + 7..];
        let num_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        behind = num_str.parse().unwrap_or(0);
    }
    (ahead, behind)
}

/// Fallback for `next_page()` using `git log --topo-order -z`.
pub fn next_page_cli(
    cli: &GitCli,
    repo_path: &Path,
    filter: &GraphFilter,
    lane_state: &mut LaneState,
    offset: &mut usize,
    n: usize,
) -> Result<GraphPage, ReadError> {
    let skip_arg = format!("--skip={offset}");
    let limit_arg = format!("--max-count={}", n + 1);

    let mut args = vec![
        "log",
        "--topo-order",
        "-z",
        "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%ct%x00%s%x00%D",
        &skip_arg,
        &limit_arg,
    ];
    if filter.first_parent_only {
        args.push("--first-parent");
    }

    let mut selected_args = Vec::new();
    match &filter.refs {
        RefFilter::Selected(names) => {
            for name in names {
                selected_args.push(name.as_str());
            }
            if filter.include_stash {
                selected_args.push("refs/stash");
            }
            args.extend_from_slice(&selected_args);
        }
        RefFilter::All => {
            if filter.first_parent_only {
                args.push("HEAD");
            } else {
                args.push("--all");
                if filter.include_stash {
                    args.push("refs/stash");
                }
            }
        }
    }

    let out = match cli.exec(repo_path, &args, CommandOptions::read_only()) {
        Ok(out) => out,
        Err(e) => {
            // If repository is empty or has no commits matching filter
            if e.to_string().contains("does not have any commits yet")
                || e.to_string().contains("unknown revision")
            {
                return Ok(GraphPage {
                    commits: Vec::new(),
                    rows: Vec::new(),
                    has_more: false,
                });
            }
            return Err(ReadError::Git(e));
        }
    };

    let stdout = out.stdout_lossy();
    let mut parts: Vec<&str> = stdout.split('\0').collect();
    if parts.last().is_some_and(|s| s.is_empty()) {
        parts.pop();
    }

    let total_records = parts.len() / 8;
    let take_count = total_records.min(n);
    let has_more = total_records > n;

    let mut commit_summaries = Vec::with_capacity(take_count);
    let mut commit_nodes = Vec::with_capacity(take_count);

    for i in 0..take_count {
        let chunk = &parts[i * 8..(i + 1) * 8];
        let sha = chunk[0].to_string();
        let short_sha = sha[..sha.len().min(7)].to_string();

        let mut parents: Vec<String> = chunk[1].split_whitespace().map(|s| s.to_string()).collect();
        if filter.first_parent_only {
            parents.truncate(1);
        }

        let author_name = chunk[2].to_string();
        let author_email = chunk[3].to_string();
        let author_time = chunk[4].parse::<i64>().unwrap_or(0);
        let committer_time = chunk[5].parse::<i64>().unwrap_or(0);
        let subject = chunk[6].to_string();
        let refs = parse_ref_decorations(chunk[7]);

        commit_nodes.push(CommitNode::new(sha.clone(), parents.clone(), refs.clone()));
        commit_summaries.push(CommitSummary {
            sha,
            short_sha,
            parents,
            author_name,
            author_email,
            author_time,
            committer_time,
            subject,
            refs,
        });
    }

    *offset += take_count;
    let rows = lane_state.layout_page(&commit_nodes);

    Ok(GraphPage {
        commits: commit_summaries,
        rows,
        has_more,
    })
}

fn parse_ref_decorations(dec: &str) -> Vec<RefLabel> {
    let mut labels = Vec::new();
    let trimmed = dec.trim();
    if trimmed.is_empty() {
        return labels;
    }

    for item in trimmed.split(", ") {
        let item = item.trim();
        if item.is_empty() {
            continue;
        }

        if let Some(target) = item.strip_prefix("HEAD -> ") {
            labels.push(RefLabel::new("HEAD", RefKind::Head));
            labels.push(RefLabel::new(target, RefKind::LocalBranch));
        } else if let Some(tag_name) = item.strip_prefix("tag: ") {
            labels.push(RefLabel::new(tag_name, RefKind::Tag));
        } else if item == "HEAD" {
            labels.push(RefLabel::new("HEAD", RefKind::Head));
        } else if item.contains('/') {
            labels.push(RefLabel::new(item, RefKind::RemoteBranch));
        } else if item.contains("stash") {
            labels.push(RefLabel::new(item, RefKind::Stash));
        } else {
            labels.push(RefLabel::new(item, RefKind::LocalBranch));
        }
    }

    labels
}

/// Fallback for `blob_at()` using `git show <rev>:<path>`.
pub fn blob_at_cli(
    cli: &GitCli,
    repo_path: &Path,
    rev_spec: &str,
    file_path: &Path,
) -> Result<Option<Vec<u8>>, ReadError> {
    let path_str = file_path.to_string_lossy().replace('\\', "/");
    let target = format!("{rev_spec}:{path_str}");

    let out = cli.exec(repo_path, &["show", &target], CommandOptions::read_only());

    match out {
        Ok(output) => Ok(Some(output.stdout)),
        Err(_) => Ok(None),
    }
}
