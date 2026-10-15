use std::collections::{HashMap, HashSet};

use crate::error::ReadError;
use crate::repo::ReadRepo;
use git_graph::{CommitNode, LaneState, RefKind, RefLabel};
use gix::bstr::ByteSlice;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RefFilter {
    All,
    Selected(Vec<String>),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GraphFilter {
    pub refs: RefFilter,
    pub include_remotes: bool,
    pub include_tags: bool,
    pub include_stash: bool,
    pub first_parent_only: bool,
}

impl Default for GraphFilter {
    fn default() -> Self {
        Self {
            refs: RefFilter::All,
            include_remotes: true,
            include_tags: true,
            include_stash: false,
            first_parent_only: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommitSummary {
    pub sha: String,
    pub short_sha: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub author_time: i64,
    pub committer_time: i64,
    pub subject: String,
    pub refs: Vec<RefLabel>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GraphPage {
    pub commits: Vec<CommitSummary>,
    pub rows: Vec<git_graph::GraphRow>,
    pub has_more: bool,
}

pub struct GraphWalker {
    repo: ReadRepo,
    filter: GraphFilter,
    ref_map: HashMap<gix::ObjectId, Vec<RefLabel>>,
    lane_state: LaneState,
    iter: Box<dyn Iterator<Item = Result<gix::traverse::commit::Info, ReadError>> + Send>,
    peeked: Option<gix::traverse::commit::Info>,
    cli_offset: usize,
    force_fallback: bool,
}

impl GraphWalker {
    pub fn new(repo: ReadRepo, filter: GraphFilter) -> Result<Self, ReadError> {
        let all_refs = repo.refs()?;
        let mut ref_map: HashMap<gix::ObjectId, Vec<RefLabel>> = HashMap::new();
        let mut tips: Vec<gix::ObjectId> = Vec::new();
        let mut seen_tips: HashSet<gix::ObjectId> = HashSet::new();

        for r in all_refs {
            let include_ref = match r.kind {
                RefKind::Head => true,
                RefKind::LocalBranch => true,
                RefKind::RemoteBranch => filter.include_remotes,
                RefKind::Tag => filter.include_tags,
                RefKind::Stash => filter.include_stash,
            };

            if !include_ref {
                continue;
            }

            if let Ok(oid) = gix::ObjectId::from_hex(r.target_sha.as_bytes()) {
                ref_map
                    .entry(oid)
                    .or_default()
                    .push(RefLabel::new(r.name.clone(), r.kind.clone()));

                let is_tip = match &filter.refs {
                    RefFilter::Selected(names) => {
                        names.iter().any(|n| {
                            n == &r.name
                                || n == &format!("refs/heads/{}", r.name)
                                || n == &format!("refs/remotes/{}", r.name)
                                || n == &format!("refs/tags/{}", r.name)
                        }) || (filter.include_stash && r.kind == RefKind::Stash)
                    }
                    RefFilter::All => {
                        if filter.first_parent_only {
                            r.kind == RefKind::Head
                        } else {
                            true
                        }
                    }
                };

                if is_tip && seen_tips.insert(oid) {
                    tips.push(oid);
                }
            }
        }

        let lane_state = LaneState::new();

        if tips.is_empty() {
            let force_fallback = repo.force_fallback();
            return Ok(Self {
                repo,
                filter,
                ref_map,
                lane_state,
                iter: Box::new(std::iter::empty()),
                peeked: None,
                cli_offset: 0,
                force_fallback,
            });
        }

        let topo = gix::traverse::commit::topo::Builder::new(repo.gix_repo().objects.clone())
            .with_tips(tips)
            .sorting(gix::traverse::commit::topo::Sorting::DateOrder)
            .parents(if filter.first_parent_only {
                gix::traverse::commit::Parents::First
            } else {
                gix::traverse::commit::Parents::All
            })
            .build()
            .map_err(|e| ReadError::Gix(format!("Failed to build topo commit walker: {e}")))?;

        let mut iter = Box::new(topo.map(|res| res.map_err(|e| ReadError::Gix(e.to_string()))));
        let peeked = match iter.next() {
            Some(Ok(info)) => Some(info),
            Some(Err(e)) => return Err(e),
            None => None,
        };

        let force_fallback = repo.force_fallback();
        Ok(Self {
            repo,
            filter,
            ref_map,
            lane_state,
            iter,
            peeked,
            cli_offset: 0,
            force_fallback,
        })
    }

    pub fn reset(&mut self) -> Result<(), ReadError> {
        let fresh = Self::new(self.repo.clone(), self.filter.clone())?;
        self.ref_map = fresh.ref_map;
        self.lane_state = fresh.lane_state;
        self.iter = fresh.iter;
        self.peeked = fresh.peeked;
        self.cli_offset = 0;
        self.force_fallback = fresh.force_fallback;
        Ok(())
    }

    pub fn set_force_fallback(&mut self, force: bool) {
        self.force_fallback = force;
    }

    pub fn with_forced_fallback(mut self, force: bool) -> Self {
        self.force_fallback = force;
        self
    }

    pub fn force_fallback(&self) -> bool {
        self.force_fallback
    }

    pub fn lane_state(&self) -> &LaneState {
        &self.lane_state
    }

    pub fn lane_state_mut(&mut self) -> &mut LaneState {
        &mut self.lane_state
    }

    /// Read the next page of `n` commits and their graph rows.
    pub fn next_page(&mut self, n: usize) -> Result<GraphPage, ReadError> {
        if self.force_fallback {
            tracing::warn!("gix failed for next_page (forced), falling back to git CLI");
            return crate::fallback::next_page_cli(
                self.repo.git_cli(),
                self.repo.path(),
                &self.filter,
                &mut self.lane_state,
                &mut self.cli_offset,
                n,
            );
        }

        match self.next_page_gix(n) {
            Ok(page) => Ok(page),
            Err(e) => {
                tracing::warn!("gix failed for next_page ({e}), falling back to git CLI");
                crate::fallback::next_page_cli(
                    self.repo.git_cli(),
                    self.repo.path(),
                    &self.filter,
                    &mut self.lane_state,
                    &mut self.cli_offset,
                    n,
                )
            }
        }
    }

    fn next_page_gix(&mut self, n: usize) -> Result<GraphPage, ReadError> {
        let mut commit_summaries = Vec::with_capacity(n);
        let mut commit_nodes = Vec::with_capacity(n);

        while commit_summaries.len() < n {
            let info = match self.peeked.take() {
                Some(info) => info,
                None => match self.iter.next() {
                    Some(Ok(info)) => info,
                    Some(Err(e)) => return Err(e),
                    None => break,
                },
            };

            let obj = match self.repo.gix_repo().find_object(info.id) {
                Ok(obj) => obj,
                Err(e) => {
                    return Err(ReadError::Gix(format!(
                        "Failed to find commit object {}: {e}",
                        info.id
                    )))
                }
            };
            let commit = match obj.try_into_commit() {
                Ok(c) => c,
                Err(_) => continue,
            };

            let sha = info.id.to_string();
            let short_sha = sha[..sha.len().min(7)].to_string();

            let mut parents: Vec<String> = info.parent_ids.iter().map(|p| p.to_string()).collect();
            if self.filter.first_parent_only {
                parents.truncate(1);
            }

            let author = commit.author().map_err(|e| ReadError::Gix(e.to_string()))?;
            let committer = commit
                .committer()
                .map_err(|e| ReadError::Gix(e.to_string()))?;
            let message = commit
                .message()
                .map_err(|e| ReadError::Gix(e.to_string()))?;
            let author_name = author.name.to_str_lossy().into_owned();
            let author_email = author.email.to_str_lossy().into_owned();
            let author_time = author.time().map(|t| t.seconds).unwrap_or(0);
            let committer_time = committer.time().map(|t| t.seconds).unwrap_or(0);
            let subject = message.title.to_str_lossy().into_owned();

            let refs = self.ref_map.get(&info.id).cloned().unwrap_or_default();

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

        // Peek one commit ahead to accurately determine has_more
        let has_more = match self.iter.next() {
            Some(Ok(next_info)) => {
                self.peeked = Some(next_info);
                true
            }
            Some(Err(e)) => return Err(e),
            None => false,
        };

        let rows = self.lane_state.layout_page(&commit_nodes);

        Ok(GraphPage {
            commits: commit_summaries,
            rows,
            has_more,
        })
    }
}
