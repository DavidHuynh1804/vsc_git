use std::path::{Path, PathBuf};

use git_graph::RefKind;
use serde::{Deserialize, Serialize};

use crate::error::ReadError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum HeadInfo {
    Branch { name: String, target_sha: String },
    Detached { sha: String },
    Empty,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RefInfo {
    pub name: String,
    pub kind: RefKind,
    pub target_sha: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Clone)]
pub struct ReadRepo {
    path: PathBuf,
    repo: gix::Repository,
}

impl ReadRepo {
    /// Open a repository at `path`. Supports working tree root, subdirectories,
    /// linked worktrees, and bare repositories.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, ReadError> {
        let path = path.as_ref().to_path_buf();
        let repo = gix::open(&path)
            .or_else(|_| gix::discover(&path))
            .map_err(|e| {
                ReadError::Gix(format!("Failed to open repo at {}: {}", path.display(), e))
            })?;

        Ok(Self { path, repo })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn is_bare(&self) -> bool {
        self.repo.is_bare()
    }

    pub fn gix_repo(&self) -> &gix::Repository {
        &self.repo
    }

    /// Read HEAD state (current branch name + sha, or detached sha, or empty/unborn).
    pub fn head(&self) -> Result<HeadInfo, ReadError> {
        let head = self
            .repo
            .head()
            .map_err(|e| ReadError::Gix(format!("Failed to read HEAD: {e}")))?;

        if head.is_unborn() {
            return Ok(HeadInfo::Empty);
        }

        if head.is_detached() {
            let sha = head
                .id()
                .ok_or_else(|| ReadError::InvalidRef("Detached HEAD has no target commit".into()))?
                .to_string();
            return Ok(HeadInfo::Detached { sha });
        }

        let name = head
            .referent_name()
            .map(|r| r.shorten().to_string())
            .unwrap_or_else(|| "HEAD".to_string());

        let sha = head
            .id()
            .ok_or_else(|| ReadError::InvalidRef("Symbolic HEAD has no target commit".into()))?
            .to_string();

        Ok(HeadInfo::Branch {
            name,
            target_sha: sha,
        })
    }

    /// Read all references with their kind, target SHA, upstream branch, and ahead/behind counts.
    pub fn refs(&self) -> Result<Vec<RefInfo>, ReadError> {
        let config = self.repo.config_snapshot();
        let ref_platform = self
            .repo
            .references()
            .map_err(|e| ReadError::Gix(format!("Failed to list references: {e}")))?;

        let mut results = Vec::new();

        // 1. HEAD reference
        if let Ok(head) = self.repo.head() {
            if let Some(target_id) = head.id() {
                results.push(RefInfo {
                    name: "HEAD".to_string(),
                    kind: RefKind::Head,
                    target_sha: target_id.to_string(),
                    upstream: None,
                    ahead: 0,
                    behind: 0,
                });
            }
        }

        // 2. Iterate all references in git storage
        let all_refs = ref_platform
            .all()
            .map_err(|e| ReadError::Gix(format!("Failed to iterate refs: {e}")))?;

        for r in all_refs {
            let mut r = match r {
                Ok(r) => r,
                Err(_) => continue,
            };

            let full_name = r.name().as_bstr().to_string();
            // Skip HEAD as we already added it above
            if full_name == "HEAD" {
                continue;
            }

            let (kind, short_name) = classify_ref(&full_name, &r);

            let target_sha = match r.peel_to_id() {
                Ok(id) => id,
                Err(_) => continue,
            };

            let (upstream, ahead, behind) = if kind == RefKind::LocalBranch {
                compute_branch_tracking(&self.repo, &config, &short_name, target_sha.detach())
            } else {
                (None, 0, 0)
            };

            results.push(RefInfo {
                name: short_name,
                kind,
                target_sha: target_sha.to_string(),
                upstream,
                ahead,
                behind,
            });
        }

        // 3. Stashes from reflog of refs/stash if refs/stash exists
        read_stash_entries(&self.repo, &mut results);

        Ok(results)
    }
}

fn classify_ref(full_name: &str, r: &gix::Reference) -> (RefKind, String) {
    if let Some(stripped) = full_name.strip_prefix("refs/heads/") {
        (RefKind::LocalBranch, stripped.to_string())
    } else if let Some(stripped) = full_name.strip_prefix("refs/remotes/") {
        (RefKind::RemoteBranch, stripped.to_string())
    } else if let Some(stripped) = full_name.strip_prefix("refs/tags/") {
        (RefKind::Tag, stripped.to_string())
    } else if full_name == "refs/stash" {
        (RefKind::Stash, "stash".to_string())
    } else {
        (RefKind::LocalBranch, r.name().shorten().to_string())
    }
}

fn compute_branch_tracking(
    repo: &gix::Repository,
    config: &gix::config::Snapshot,
    branch_name: &str,
    local_id: gix::ObjectId,
) -> (Option<String>, u32, u32) {
    let remote_key = format!("branch.{branch_name}.remote");
    let merge_key = format!("branch.{branch_name}.merge");

    let remote = match config.string(&remote_key) {
        Some(r) => r.to_string(),
        None => return (None, 0, 0),
    };
    let merge = match config.string(&merge_key) {
        Some(m) => m.to_string(),
        None => return (None, 0, 0),
    };

    let branch_short = merge.strip_prefix("refs/heads/").unwrap_or(&merge);
    let (upstream_display, upstream_full_ref) = if remote == "." {
        (
            branch_short.to_string(),
            format!("refs/heads/{branch_short}"),
        )
    } else {
        (
            format!("{remote}/{branch_short}"),
            format!("refs/remotes/{remote}/{branch_short}"),
        )
    };

    let mut upstream_ref = match repo.find_reference(&upstream_full_ref) {
        Ok(r) => r,
        Err(_) => return (Some(upstream_display), 0, 0),
    };

    let upstream_id = match upstream_ref.peel_to_id() {
        Ok(id) => id.detach(),
        Err(_) => return (Some(upstream_display), 0, 0),
    };

    if local_id == upstream_id {
        return (Some(upstream_display), 0, 0);
    }

    let ahead = repo
        .rev_walk([local_id])
        .with_hidden([upstream_id])
        .all()
        .map(|walk| walk.count() as u32)
        .unwrap_or(0);

    let behind = repo
        .rev_walk([upstream_id])
        .with_hidden([local_id])
        .all()
        .map(|walk| walk.count() as u32)
        .unwrap_or(0);

    (Some(upstream_display), ahead, behind)
}

fn read_stash_entries(repo: &gix::Repository, results: &mut Vec<RefInfo>) {
    let stash_ref = match repo.find_reference("refs/stash") {
        Ok(r) => r,
        Err(_) => return,
    };

    let mut log_platform = stash_ref.log_iter();
    let iter = match log_platform.rev() {
        Ok(Some(iter)) => iter,
        _ => return,
    };

    for (index, entry) in iter.enumerate() {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => break,
        };
        let name = format!("stash@{{{index}}}");
        let sha = entry.new_oid.to_string();

        // Avoid duplicating if refs/stash was already added with the exact same name
        if !results.iter().any(|r| r.name == name) {
            results.push(RefInfo {
                name,
                kind: RefKind::Stash,
                target_sha: sha,
                upstream: None,
                ahead: 0,
                behind: 0,
            });
        }
    }
}
