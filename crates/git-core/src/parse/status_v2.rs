use crate::error::GitError;
use serde::{Deserialize, Serialize};

/// Git branch metadata parsed from `# branch.*` headers.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct BranchInfo {
    pub oid: Option<String>,
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub is_detached: bool,
    pub is_initial: bool,
}

/// Status of an individual file in staged or unstaged state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum FileStatus {
    Unmodified,
    Modified,
    Added,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Untracked,
    Ignored,
    Unmerged,
}

impl FileStatus {
    pub fn from_char(c: char) -> Self {
        match c {
            '.' => Self::Unmodified,
            'M' => Self::Modified,
            'A' => Self::Added,
            'D' => Self::Deleted,
            'R' => Self::Renamed,
            'C' => Self::Copied,
            'T' => Self::TypeChanged,
            '?' => Self::Untracked,
            '!' => Self::Ignored,
            'U' => Self::Unmerged,
            _ => Self::Modified,
        }
    }
}

/// Submodule state representation.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct SubmoduleState {
    pub is_submodule: bool,
    pub commit_changed: bool,
    pub modified: bool,
    pub untracked: bool,
}

impl SubmoduleState {
    pub fn parse(s: &str) -> Self {
        if s.starts_with('S') && s.len() >= 4 {
            let bytes = s.as_bytes();
            Self {
                is_submodule: true,
                commit_changed: bytes[1] == b'C',
                modified: bytes[2] == b'M',
                untracked: bytes[3] == b'U',
            }
        } else {
            Self {
                is_submodule: false,
                commit_changed: false,
                modified: false,
                untracked: false,
            }
        }
    }
}

/// Detailed payload for each status entry kind.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum StatusEntryKind {
    Ordinary {
        staged: FileStatus,
        unstaged: FileStatus,
        submodule: SubmoduleState,
        head_mode: String,
        index_mode: String,
        worktree_mode: String,
        head_sha: String,
        index_sha: String,
    },
    RenamedOrCopied {
        staged: FileStatus,
        unstaged: FileStatus,
        submodule: SubmoduleState,
        head_mode: String,
        index_mode: String,
        worktree_mode: String,
        head_sha: String,
        index_sha: String,
        is_rename: bool,
        score: u8,
        orig_path: String,
    },
    Unmerged {
        conflict_type: String,
        submodule: SubmoduleState,
        stage1_mode: String,
        stage2_mode: String,
        stage3_mode: String,
        worktree_mode: String,
        stage1_sha: String,
        stage2_sha: String,
        stage3_sha: String,
    },
    Untracked,
    Ignored,
}

/// Single repository status entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StatusEntry {
    pub path: String,
    pub kind: StatusEntryKind,
}

impl StatusEntry {
    pub fn is_staged(&self) -> bool {
        match &self.kind {
            StatusEntryKind::Ordinary { staged, .. } => *staged != FileStatus::Unmodified,
            StatusEntryKind::RenamedOrCopied { staged, .. } => *staged != FileStatus::Unmodified,
            _ => false,
        }
    }

    pub fn is_unstaged(&self) -> bool {
        match &self.kind {
            StatusEntryKind::Ordinary { unstaged, .. } => *unstaged != FileStatus::Unmodified,
            StatusEntryKind::RenamedOrCopied { unstaged, .. } => {
                *unstaged != FileStatus::Unmodified
            }
            _ => false,
        }
    }

    pub fn is_untracked(&self) -> bool {
        matches!(self.kind, StatusEntryKind::Untracked)
    }

    pub fn is_ignored(&self) -> bool {
        matches!(self.kind, StatusEntryKind::Ignored)
    }

    pub fn is_conflict(&self) -> bool {
        matches!(self.kind, StatusEntryKind::Unmerged { .. })
    }
}

/// Overall repository status including branch info and categorized entries.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct RepoStatus {
    pub branch: BranchInfo,
    pub entries: Vec<StatusEntry>,
}

impl RepoStatus {
    pub fn staged(&self) -> Vec<&StatusEntry> {
        self.entries.iter().filter(|e| e.is_staged()).collect()
    }

    pub fn unstaged(&self) -> Vec<&StatusEntry> {
        self.entries.iter().filter(|e| e.is_unstaged()).collect()
    }

    pub fn untracked(&self) -> Vec<&StatusEntry> {
        self.entries.iter().filter(|e| e.is_untracked()).collect()
    }

    pub fn merge_conflicts(&self) -> Vec<&StatusEntry> {
        self.entries.iter().filter(|e| e.is_conflict()).collect()
    }

    pub fn ignored(&self) -> Vec<&StatusEntry> {
        self.entries.iter().filter(|e| e.is_ignored()).collect()
    }
}

/// Parse `git status --porcelain=v2 -z --branch` raw stdout bytes or string.
pub fn parse_status_v2(raw: &[u8]) -> Result<RepoStatus, GitError> {
    let mut branch = BranchInfo::default();
    let mut entries = Vec::new();

    // Split on NUL bytes
    let mut chunks: Vec<&[u8]> = raw.split(|&b| b == 0).collect();
    if let Some(last) = chunks.last() {
        if last.is_empty() {
            chunks.pop();
        }
    }

    let mut i = 0;
    while i < chunks.len() {
        let chunk = chunks[i];
        if chunk.is_empty() {
            i += 1;
            continue;
        }

        let chunk_str = String::from_utf8_lossy(chunk);

        if let Some(rest) = chunk_str.strip_prefix("# branch.") {
            parse_branch_header(&mut branch, rest);
            i += 1;
            continue;
        }

        match chunk[0] {
            b'1' => {
                // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
                if let Some(entry) = parse_ordinary_entry(&chunk_str) {
                    entries.push(entry);
                }
            }
            b'2' => {
                // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\0<origPath>
                let next_chunk = if i + 1 < chunks.len() {
                    Some(String::from_utf8_lossy(chunks[i + 1]).to_string())
                } else {
                    None
                };
                if let Some(entry) = parse_renamed_entry(&chunk_str, next_chunk.as_deref()) {
                    entries.push(entry);
                    i += 1; // consumed origPath chunk
                }
            }
            b'u' => {
                // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
                if let Some(entry) = parse_unmerged_entry(&chunk_str) {
                    entries.push(entry);
                }
            }
            b'?' => {
                // ? <path>
                if let Some(path) = chunk_str.strip_prefix("? ") {
                    entries.push(StatusEntry {
                        path: path.to_string(),
                        kind: StatusEntryKind::Untracked,
                    });
                }
            }
            b'!' => {
                // ! <path>
                if let Some(path) = chunk_str.strip_prefix("! ") {
                    entries.push(StatusEntry {
                        path: path.to_string(),
                        kind: StatusEntryKind::Ignored,
                    });
                }
            }
            _ => {}
        }

        i += 1;
    }

    Ok(RepoStatus { branch, entries })
}

fn parse_branch_header(branch: &mut BranchInfo, header: &str) {
    if let Some(oid) = header.strip_prefix("oid ") {
        if oid == "(initial)" {
            branch.is_initial = true;
            branch.oid = None;
        } else {
            branch.oid = Some(oid.to_string());
        }
    } else if let Some(head) = header.strip_prefix("head ") {
        if head == "(detached)" {
            branch.is_detached = true;
            branch.head = None;
        } else {
            branch.head = Some(head.to_string());
        }
    } else if let Some(upstream) = header.strip_prefix("upstream ") {
        branch.upstream = Some(upstream.to_string());
    } else if let Some(ab) = header.strip_prefix("ab ") {
        // e.g. +1 -2
        for part in ab.split_whitespace() {
            if let Some(ahead_str) = part.strip_prefix('+') {
                branch.ahead = ahead_str.parse().unwrap_or(0);
            } else if let Some(behind_str) = part.strip_prefix('-') {
                branch.behind = behind_str.parse().unwrap_or(0);
            }
        }
    }
}

/// Helper to split into N fields: first N-1 whitespace tokens, and the rest as the N-th field.
fn split_n(s: &str, n: usize) -> Option<Vec<&str>> {
    let mut result = Vec::with_capacity(n);
    let mut remainder = s;
    for _ in 0..n - 1 {
        let (first, rest) = remainder.split_once(' ')?;
        result.push(first);
        remainder = rest;
    }
    result.push(remainder);
    Some(result)
}

fn parse_ordinary_entry(line: &str) -> Option<StatusEntry> {
    // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path> -> 9 tokens
    let tokens = split_n(line, 9)?;
    let xy = tokens[1];
    let sub = tokens[2];
    let m_h = tokens[3];
    let m_i = tokens[4];
    let m_w = tokens[5];
    let h_h = tokens[6];
    let h_i = tokens[7];
    let path = tokens[8];

    let mut chars = xy.chars();
    let staged = FileStatus::from_char(chars.next().unwrap_or('.'));
    let unstaged = FileStatus::from_char(chars.next().unwrap_or('.'));

    Some(StatusEntry {
        path: path.to_string(),
        kind: StatusEntryKind::Ordinary {
            staged,
            unstaged,
            submodule: SubmoduleState::parse(sub),
            head_mode: m_h.to_string(),
            index_mode: m_i.to_string(),
            worktree_mode: m_w.to_string(),
            head_sha: h_h.to_string(),
            index_sha: h_i.to_string(),
        },
    })
}

fn parse_renamed_entry(line: &str, orig_path: Option<&str>) -> Option<StatusEntry> {
    // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path> -> 10 tokens
    let tokens = split_n(line, 10)?;
    let xy = tokens[1];
    let sub = tokens[2];
    let m_h = tokens[3];
    let m_i = tokens[4];
    let m_w = tokens[5];
    let h_h = tokens[6];
    let h_i = tokens[7];
    let score_str = tokens[8];
    let path = tokens[9];

    let mut chars = xy.chars();
    let staged = FileStatus::from_char(chars.next().unwrap_or('.'));
    let unstaged = FileStatus::from_char(chars.next().unwrap_or('.'));

    let is_rename = score_str.starts_with('R');
    let score: u8 = score_str[1..].parse().unwrap_or(100);

    Some(StatusEntry {
        path: path.to_string(),
        kind: StatusEntryKind::RenamedOrCopied {
            staged,
            unstaged,
            submodule: SubmoduleState::parse(sub),
            head_mode: m_h.to_string(),
            index_mode: m_i.to_string(),
            worktree_mode: m_w.to_string(),
            head_sha: h_h.to_string(),
            index_sha: h_i.to_string(),
            is_rename,
            score,
            orig_path: orig_path.unwrap_or_default().to_string(),
        },
    })
}

fn parse_unmerged_entry(line: &str) -> Option<StatusEntry> {
    // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path> -> 11 tokens
    let tokens = split_n(line, 11)?;
    let xy = tokens[1];
    let sub = tokens[2];
    let m1 = tokens[3];
    let m2 = tokens[4];
    let m3 = tokens[5];
    let mw = tokens[6];
    let h1 = tokens[7];
    let h2 = tokens[8];
    let h3 = tokens[9];
    let path = tokens[10];

    Some(StatusEntry {
        path: path.to_string(),
        kind: StatusEntryKind::Unmerged {
            conflict_type: xy.to_string(),
            submodule: SubmoduleState::parse(sub),
            stage1_mode: m1.to_string(),
            stage2_mode: m2.to_string(),
            stage3_mode: m3.to_string(),
            worktree_mode: mw.to_string(),
            stage1_sha: h1.to_string(),
            stage2_sha: h2.to_string(),
            stage3_sha: h3.to_string(),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_empty_repo_status() {
        let raw = b"# branch.oid (initial)\x00# branch.head main\x00";
        let status = parse_status_v2(raw).unwrap();
        assert!(status.branch.is_initial);
        assert_eq!(status.branch.head.as_deref(), Some("main"));
        assert_eq!(status.branch.oid, None);
        assert!(status.entries.is_empty());
    }

    #[test]
    fn test_parse_branch_with_upstream() {
        let raw = b"# branch.oid 1234567890abcdef1234567890abcdef12345678\x00# branch.head feat/test\x00# branch.upstream origin/feat/test\x00# branch.ab +3 -1\x00";
        let status = parse_status_v2(raw).unwrap();
        assert_eq!(
            status.branch.oid.as_deref(),
            Some("1234567890abcdef1234567890abcdef12345678")
        );
        assert_eq!(status.branch.head.as_deref(), Some("feat/test"));
        assert_eq!(status.branch.upstream.as_deref(), Some("origin/feat/test"));
        assert_eq!(status.branch.ahead, 3);
        assert_eq!(status.branch.behind, 1);
        assert!(!status.branch.is_detached);
    }

    #[test]
    fn test_parse_detached_head() {
        let raw = b"# branch.oid 1234567890abcdef1234567890abcdef12345678\x00# branch.head (detached)\x00";
        let status = parse_status_v2(raw).unwrap();
        assert!(status.branch.is_detached);
        assert_eq!(status.branch.head, None);
    }

    #[test]
    fn test_parse_table_of_entries() {
        let mut raw = Vec::new();
        // 1. Ordinary modified
        raw.extend_from_slice(b"1 .M N... 100644 100644 100644 deadbeef deadbeef file1.txt\x00");
        // 2. Ordinary added
        raw.extend_from_slice(
            b"1 A. N... 000000 100644 100644 00000000 deadbeef file2 with spaces.txt\x00",
        );
        // 3. Rename
        raw.extend_from_slice(
            b"2 R. N... 100644 100644 100644 deadbeef deadbeef R100 new_name.rs\x00old_name.rs\x00",
        );
        // 4. Conflict
        raw.extend_from_slice(
            b"u UU N... 100644 100644 100644 100644 sha1 sha2 sha3 conflict.txt\x00",
        );
        // 5. Untracked
        raw.extend_from_slice(b"? untracked_unicode_\xc3\xa9.txt\x00");
        // 6. Ignored
        raw.extend_from_slice(b"! ignored.log\x00");

        let status = parse_status_v2(&raw).unwrap();
        assert_eq!(status.entries.len(), 6);

        // Grouping assertions
        assert_eq!(status.unstaged().len(), 1);
        assert_eq!(status.unstaged()[0].path, "file1.txt");

        assert_eq!(status.staged().len(), 2);
        assert_eq!(status.staged()[0].path, "file2 with spaces.txt");
        assert_eq!(status.staged()[1].path, "new_name.rs");

        assert_eq!(status.merge_conflicts().len(), 1);
        assert_eq!(status.merge_conflicts()[0].path, "conflict.txt");

        assert_eq!(status.untracked().len(), 1);
        assert_eq!(status.untracked()[0].path, "untracked_unicode_é.txt");

        assert_eq!(status.ignored().len(), 1);
        assert_eq!(status.ignored()[0].path, "ignored.log");
    }

    #[test]
    fn test_status_v2_insta_snapshot() {
        let mut raw = Vec::new();
        raw.extend_from_slice(b"# branch.oid abcdef1234567890abcdef1234567890abcdef12\x00");
        raw.extend_from_slice(b"# branch.head feat/git-core\x00");
        raw.extend_from_slice(b"# branch.upstream origin/feat/git-core\x00");
        raw.extend_from_slice(b"# branch.ab +2 -0\x00");
        raw.extend_from_slice(b"1 M. N... 100644 100644 100644 abc1234 def5678 src/lib.rs\x00");
        raw.extend_from_slice(
            b"2 R. N... 100644 100644 100644 1111222 3333444 R095 src/new.rs\x00src/old.rs\x00",
        );
        raw.extend_from_slice(b"u UU N... 100644 100644 100644 100644 a b c merge.txt\x00");
        raw.extend_from_slice(b"? untracked.rs\x00");

        let status = parse_status_v2(&raw).unwrap();
        insta::assert_yaml_snapshot!(status);
    }
}
