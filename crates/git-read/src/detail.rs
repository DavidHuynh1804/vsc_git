use gix::bstr::ByteSlice;
use serde::{Deserialize, Serialize};

use crate::error::ReadError;
use crate::log::CommitSummary;
use crate::repo::ReadRepo;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileStatus {
    A,
    M,
    D,
    R,
    C,
    T,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub additions: usize,
    pub deletions: usize,
    pub binary: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommitterInfo {
    pub name: String,
    pub email: String,
    pub time: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommitDetail {
    pub summary: CommitSummary,
    pub body: Option<String>,
    pub committer: CommitterInfo,
    pub signature_present: bool,
    pub files: Vec<FileChange>,
}

impl ReadRepo {
    /// Return the detailed commit information, including tree diff against its first parent
    /// (or against the empty tree for a root commit), rename detection, additions/deletions/binary stats.
    pub fn commit_detail(&self, sha: &str) -> Result<CommitDetail, ReadError> {
        let oid = gix::ObjectId::from_hex(sha.as_bytes())
            .map_err(|e| ReadError::InvalidRef(format!("Invalid commit sha {sha}: {e}")))?;

        let obj = self
            .gix_repo()
            .find_object(oid)
            .map_err(|e| ReadError::NotFound(format!("Commit {sha} not found: {e}")))?;
        let commit = obj
            .try_into_commit()
            .map_err(|_| ReadError::NotFound(format!("Object {sha} is not a commit")))?;

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

        let committer_name = committer.name.to_str_lossy().into_owned();
        let committer_email = committer.email.to_str_lossy().into_owned();
        let committer_time = committer.time().map(|t| t.seconds).unwrap_or(0);

        let subject = message.title.to_str_lossy().into_owned();
        let body = message.body.map(|b| b.to_str_lossy().into_owned());

        let signature_present = commit.signature().map(|s| s.is_some()).unwrap_or(false);

        let parents: Vec<String> = commit.parent_ids().map(|p| p.to_string()).collect();
        let short_sha = sha[..sha.len().min(7)].to_string();

        let refs = self
            .refs()
            .unwrap_or_default()
            .into_iter()
            .filter(|r| r.target_sha == sha)
            .map(|r| git_graph::RefLabel::new(r.name, r.kind))
            .collect();

        let summary = CommitSummary {
            sha: sha.to_string(),
            short_sha,
            parents,
            author_name,
            author_email,
            author_time,
            committer_time,
            subject,
            refs,
        };

        let new_tree = commit.tree().map_err(|e| ReadError::Gix(e.to_string()))?;

        let old_tree_opt = if let Some(parent_id) = commit.parent_ids().next() {
            let parent_obj = self
                .gix_repo()
                .find_object(parent_id)
                .map_err(|e| ReadError::Gix(e.to_string()))?;
            let parent_commit = parent_obj
                .try_into_commit()
                .map_err(|_| ReadError::Gix("Parent is not a commit".into()))?;
            Some(
                parent_commit
                    .tree()
                    .map_err(|e| ReadError::Gix(e.to_string()))?,
            )
        } else {
            None
        };

        let files = self.diff_trees(old_tree_opt.as_ref(), &new_tree)?;

        Ok(CommitDetail {
            summary,
            body,
            committer: CommitterInfo {
                name: committer_name,
                email: committer_email,
                time: committer_time,
            },
            signature_present,
            files,
        })
    }

    /// Compare two commits or revisions (a and b), producing the list of file changes between them.
    pub fn compare(&self, a: &str, b: &str) -> Result<Vec<FileChange>, ReadError> {
        let tree_a = self.resolve_tree(a)?;
        let tree_b = self.resolve_tree(b)?;

        self.diff_trees(Some(&tree_a), &tree_b)
    }

    pub(crate) fn resolve_tree<'a>(&'a self, rev: &str) -> Result<gix::Tree<'a>, ReadError> {
        let obj = if let Ok(oid) = gix::ObjectId::from_hex(rev.as_bytes()) {
            self.gix_repo()
                .find_object(oid)
                .map_err(|e| ReadError::NotFound(format!("Object {rev} not found: {e}")))?
        } else {
            let rev_spec = self
                .gix_repo()
                .rev_parse_single(rev)
                .map_err(|e| ReadError::InvalidRef(format!("Invalid rev {rev}: {e}")))?;
            self.gix_repo()
                .find_object(rev_spec)
                .map_err(|e| ReadError::NotFound(format!("Object {rev} not found: {e}")))?
        };

        if let Ok(commit) = obj.clone().try_into_commit() {
            commit.tree().map_err(|e| ReadError::Gix(e.to_string()))
        } else if let Ok(tree) = obj.try_into_tree() {
            Ok(tree)
        } else {
            Err(ReadError::InvalidRef(format!(
                "Rev {rev} is neither commit nor tree"
            )))
        }
    }

    fn diff_trees(
        &self,
        old_tree: Option<&gix::Tree>,
        new_tree: &gix::Tree,
    ) -> Result<Vec<FileChange>, ReadError> {
        let changes = self
            .gix_repo()
            .diff_tree_to_tree(old_tree, Some(new_tree), None)
            .map_err(|e| ReadError::Gix(format!("Tree diff error: {e}")))?;

        let mut files = Vec::with_capacity(changes.len());

        for change in changes {
            match change {
                gix::object::tree::diff::ChangeDetached::Addition {
                    location,
                    entry_mode,
                    id,
                    ..
                } => {
                    if entry_mode.is_tree() {
                        continue;
                    }
                    let path = location.to_str_lossy().into_owned();
                    let blob_data = load_blob_data(self.gix_repo(), id);
                    let (binary, additions, deletions) = match blob_data {
                        Some(data) => {
                            if is_binary(&data) {
                                (true, 0, 0)
                            } else {
                                (false, count_lines(&data), 0)
                            }
                        }
                        None => (false, 0, 0),
                    };

                    files.push(FileChange {
                        path,
                        old_path: None,
                        status: FileStatus::A,
                        additions,
                        deletions,
                        binary,
                    });
                }
                gix::object::tree::diff::ChangeDetached::Deletion {
                    location,
                    entry_mode,
                    id,
                    ..
                } => {
                    if entry_mode.is_tree() {
                        continue;
                    }
                    let path = location.to_str_lossy().into_owned();
                    let blob_data = load_blob_data(self.gix_repo(), id);
                    let (binary, additions, deletions) = match blob_data {
                        Some(data) => {
                            if is_binary(&data) {
                                (true, 0, 0)
                            } else {
                                (false, 0, count_lines(&data))
                            }
                        }
                        None => (false, 0, 0),
                    };

                    files.push(FileChange {
                        path,
                        old_path: None,
                        status: FileStatus::D,
                        additions,
                        deletions,
                        binary,
                    });
                }
                gix::object::tree::diff::ChangeDetached::Modification {
                    location,
                    previous_entry_mode,
                    previous_id,
                    entry_mode,
                    id,
                } => {
                    if entry_mode.is_tree() || previous_entry_mode.is_tree() {
                        continue;
                    }
                    let path = location.to_str_lossy().into_owned();
                    let status = if (previous_entry_mode.is_link() != entry_mode.is_link())
                        || (previous_entry_mode.is_commit() != entry_mode.is_commit())
                    {
                        FileStatus::T
                    } else {
                        FileStatus::M
                    };

                    let old_data = load_blob_data(self.gix_repo(), previous_id).unwrap_or_default();
                    let new_data = load_blob_data(self.gix_repo(), id).unwrap_or_default();

                    let (binary, additions, deletions) =
                        if is_binary(&old_data) || is_binary(&new_data) {
                            (true, 0, 0)
                        } else {
                            let input = gix::diff::blob::InternedInput::new(
                                old_data.as_slice(),
                                new_data.as_slice(),
                            );
                            let diff = gix::diff::blob::Diff::compute(
                                gix::diff::blob::Algorithm::Histogram,
                                &input,
                            );
                            (
                                false,
                                diff.count_additions() as usize,
                                diff.count_removals() as usize,
                            )
                        };

                    files.push(FileChange {
                        path,
                        old_path: None,
                        status,
                        additions,
                        deletions,
                        binary,
                    });
                }
                gix::object::tree::diff::ChangeDetached::Rewrite {
                    source_location,
                    source_id,
                    location,
                    id,
                    copy,
                    entry_mode,
                    ..
                } => {
                    if entry_mode.is_tree() {
                        continue;
                    }
                    let old_path = Some(source_location.to_str_lossy().into_owned());
                    let path = location.to_str_lossy().into_owned();
                    let status = if copy { FileStatus::C } else { FileStatus::R };

                    let old_data = load_blob_data(self.gix_repo(), source_id).unwrap_or_default();
                    let new_data = load_blob_data(self.gix_repo(), id).unwrap_or_default();

                    let (binary, additions, deletions) =
                        if is_binary(&old_data) || is_binary(&new_data) {
                            (true, 0, 0)
                        } else if source_id == id {
                            (false, 0, 0)
                        } else {
                            let input = gix::diff::blob::InternedInput::new(
                                old_data.as_slice(),
                                new_data.as_slice(),
                            );
                            let diff = gix::diff::blob::Diff::compute(
                                gix::diff::blob::Algorithm::Histogram,
                                &input,
                            );
                            (
                                false,
                                diff.count_additions() as usize,
                                diff.count_removals() as usize,
                            )
                        };

                    files.push(FileChange {
                        path,
                        old_path,
                        status,
                        additions,
                        deletions,
                        binary,
                    });
                }
            }
        }

        Ok(files)
    }
}

fn load_blob_data(repo: &gix::Repository, id: gix::ObjectId) -> Option<Vec<u8>> {
    if id.is_null() {
        return Some(Vec::new());
    }
    let obj = repo.find_object(id).ok()?;
    if obj.kind == gix::object::Kind::Blob {
        Some(obj.data.to_vec())
    } else {
        None
    }
}

fn is_binary(data: &[u8]) -> bool {
    let check_len = data.len().min(8000);
    data[..check_len].contains(&0)
}

fn count_lines(data: &[u8]) -> usize {
    if data.is_empty() {
        return 0;
    }
    let mut count = data.iter().filter(|&&b| b == b'\n').count();
    if !data.ends_with(b"\n") {
        count += 1;
    }
    count
}
