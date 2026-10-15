use crate::cli::{CancelToken, CommandOptions, GitCli};
use crate::error::GitError;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;

/// Progress reported by network operations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Progress {
    pub phase: String,
    pub percent: u8,
}

pub type ProgressCallback = Arc<dyn Fn(Progress) + Send + Sync>;

/// Target for git fetch operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum FetchTarget {
    Remote(String),
    All,
}

impl From<&str> for FetchTarget {
    fn from(s: &str) -> Self {
        if s == "--all" {
            FetchTarget::All
        } else {
            FetchTarget::Remote(s.to_string())
        }
    }
}

/// Strategy for git pull operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum PullMode {
    #[default]
    Default,
    Rebase,
    FastForwardOnly,
}

/// Options for git push operation.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct PushOptions {
    pub remote: Option<String>,
    pub branch: Option<String>,
    #[serde(default)]
    pub set_upstream: bool,
    #[serde(default)]
    pub force_with_lease: bool,
    #[serde(default)]
    pub tags: bool,
}

impl PushOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_remote(mut self, remote: impl Into<String>) -> Self {
        self.remote = Some(remote.into());
        self
    }

    pub fn with_branch(mut self, branch: impl Into<String>) -> Self {
        self.branch = Some(branch.into());
        self
    }

    pub fn with_upstream(mut self, set_upstream: bool) -> Self {
        self.set_upstream = set_upstream;
        self
    }

    pub fn with_force_with_lease(mut self, force: bool) -> Self {
        self.force_with_lease = force;
        self
    }

    pub fn with_tags(mut self, tags: bool) -> Self {
        self.tags = tags;
        self
    }
}

/// Parse a single line from git progress output into a structured Progress.
pub fn parse_progress_line(line: &str) -> Option<Progress> {
    let trimmed = line.trim();
    let (phase, rest) = trimmed.split_once(':')?;
    let (percent_str, _) = rest.split_once('%')?;
    let num_str = percent_str.split_whitespace().last()?;
    let percent: u8 = num_str.parse().ok()?;
    if percent > 100 {
        return None;
    }
    Some(Progress {
        phase: phase.trim().to_string(),
        percent,
    })
}

/// Parse all progress lines from a multiline or carriage-return-delimited stderr stream.
pub fn parse_progress_stream(stderr: &str) -> Vec<Progress> {
    stderr
        .split(['\r', '\n'])
        .filter_map(parse_progress_line)
        .collect()
}

/// Fetch from remote repository with `--progress` and optional pruning.
pub fn fetch(
    cli: &GitCli,
    repo_path: &Path,
    target: FetchTarget,
    prune: bool,
    progress: Option<ProgressCallback>,
    cancel: Option<CancelToken>,
) -> Result<(), GitError> {
    let mut args = vec!["fetch", "--progress"];
    if prune {
        args.push("--prune");
    }
    let remote_holder;
    match &target {
        FetchTarget::All => args.push("--all"),
        FetchTarget::Remote(r) => {
            remote_holder = r.clone();
            args.push(&remote_holder);
        }
    }

    let mut opts = CommandOptions::default();
    if let Some(t) = cancel {
        opts = opts.with_cancel_token(t);
    }
    if let Some(cb) = progress {
        opts = opts.with_stderr_callback(Arc::new(move |line| {
            if let Some(p) = parse_progress_line(line) {
                cb(p);
            }
        }));
    }

    cli.exec(repo_path, &args, opts)?;
    Ok(())
}

/// Pull changes from tracking remote with specified merge/rebase mode.
pub fn pull(
    cli: &GitCli,
    repo_path: &Path,
    mode: PullMode,
    progress: Option<ProgressCallback>,
    cancel: Option<CancelToken>,
) -> Result<(), GitError> {
    let mut args = vec!["pull", "--progress"];
    match mode {
        PullMode::Default => {}
        PullMode::Rebase => args.push("--rebase"),
        PullMode::FastForwardOnly => args.push("--ff-only"),
    }

    let mut opts = CommandOptions::default();
    if let Some(t) = cancel {
        opts = opts.with_cancel_token(t);
    }
    if let Some(cb) = progress {
        opts = opts.with_stderr_callback(Arc::new(move |line| {
            if let Some(p) = parse_progress_line(line) {
                cb(p);
            }
        }));
    }

    cli.exec(repo_path, &args, opts)?;
    Ok(())
}

/// Push changes to remote repository.
pub fn push(
    cli: &GitCli,
    repo_path: &Path,
    options: PushOptions,
    progress: Option<ProgressCallback>,
    cancel: Option<CancelToken>,
) -> Result<(), GitError> {
    let mut args = vec!["push", "--progress"];
    if options.set_upstream {
        args.push("-u");
    }
    if options.force_with_lease {
        args.push("--force-with-lease");
    }
    if options.tags {
        args.push("--tags");
    }
    if let Some(r) = &options.remote {
        args.push(r);
    }
    if let Some(b) = &options.branch {
        args.push(b);
    }

    let mut opts = CommandOptions::default();
    if let Some(t) = cancel {
        opts = opts.with_cancel_token(t);
    }
    if let Some(cb) = progress {
        opts = opts.with_stderr_callback(Arc::new(move |line| {
            if let Some(p) = parse_progress_line(line) {
                cb(p);
            }
        }));
    }

    cli.exec(repo_path, &args, opts)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_progress_line_samples() {
        assert_eq!(
            parse_progress_line("Receiving objects:  45% (45/100)"),
            Some(Progress {
                phase: "Receiving objects".into(),
                percent: 45
            })
        );
        assert_eq!(
            parse_progress_line("Writing objects: 100% (5/5), done."),
            Some(Progress {
                phase: "Writing objects".into(),
                percent: 100
            })
        );
        assert_eq!(
            parse_progress_line("Compressing objects: 80% (4/5)"),
            Some(Progress {
                phase: "Compressing objects".into(),
                percent: 80
            })
        );
        assert_eq!(parse_progress_line("Total 5 (delta 1)"), None);
    }

    #[test]
    fn test_parse_progress_stream() {
        let stream = "Counting objects: 100% (5/5)\rCompressing objects:  50% (2/4)\rWriting objects: 100% (5/5), done.\n";
        let parsed = parse_progress_stream(stream);
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].phase, "Counting objects");
        assert_eq!(parsed[0].percent, 100);
        assert_eq!(parsed[1].phase, "Compressing objects");
        assert_eq!(parsed[1].percent, 50);
        assert_eq!(parsed[2].phase, "Writing objects");
        assert_eq!(parsed[2].percent, 100);
    }
}
