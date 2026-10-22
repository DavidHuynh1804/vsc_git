use serde::{Deserialize, Serialize};
#[allow(unused_imports)]
use specta::Type;

// ---------------------------------------------------------------------------
// App-facing transport types (specta-compatible) with conversions from
// git-core / git-read / git-graph crate types. Kept separated so `crates/**`
// never needs `specta::Type`.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum AppFileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Untracked,
    Ignored,
    Unmerged,
    Unmodified,
}

impl From<git_core::FileStatus> for AppFileStatus {
    fn from(s: git_core::FileStatus) -> Self {
        use git_core::FileStatus as F;
        match s {
            F::Unmodified => AppFileStatus::Unmodified,
            F::Modified => AppFileStatus::Modified,
            F::Added => AppFileStatus::Added,
            F::Deleted => AppFileStatus::Deleted,
            F::Renamed => AppFileStatus::Renamed,
            F::Copied => AppFileStatus::Copied,
            F::TypeChanged => AppFileStatus::TypeChanged,
            F::Untracked => AppFileStatus::Untracked,
            F::Ignored => AppFileStatus::Ignored,
            F::Unmerged => AppFileStatus::Unmerged,
        }
    }
}

impl From<git_read::FileStatus> for AppFileStatus {
    fn from(s: git_read::FileStatus) -> Self {
        use git_read::FileStatus as F;
        match s {
            F::A => AppFileStatus::Added,
            F::M => AppFileStatus::Modified,
            F::D => AppFileStatus::Deleted,
            F::R => AppFileStatus::Renamed,
            F::C => AppFileStatus::Copied,
            F::T => AppFileStatus::TypeChanged,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppBranchInfo {
    pub oid: Option<String>,
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

impl From<git_core::BranchInfo> for AppBranchInfo {
    fn from(b: git_core::BranchInfo) -> Self {
        Self {
            oid: b.oid,
            head: b.head,
            upstream: b.upstream,
            ahead: b.ahead,
            behind: b.behind,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppStatusEntry {
    pub path: String,
    pub staged: bool,
    pub unstaged: bool,
    pub kind: AppFileStatus,
    pub orig_path: Option<String>,
    pub conflict_type: Option<String>,
}

impl From<git_core::StatusEntry> for AppStatusEntry {
    fn from(e: git_core::StatusEntry) -> Self {
        use git_core::StatusEntryKind as K;
        let (staged, unstaged, kind, orig_path, conflict_type) = match &e.kind {
            K::Ordinary {
                staged, unstaged, ..
            } => {
                let sp = *staged != git_core::FileStatus::Unmodified;
                let up = *unstaged != git_core::FileStatus::Unmodified;
                let k = if sp { *staged } else { *unstaged };
                (sp, up, k.into(), None, None)
            }
            K::RenamedOrCopied {
                staged,
                unstaged,
                is_rename,
                orig_path,
                ..
            } => {
                let sp = *staged != git_core::FileStatus::Unmodified;
                let up = *unstaged != git_core::FileStatus::Unmodified;
                let k = if *is_rename {
                    git_core::FileStatus::Renamed
                } else {
                    git_core::FileStatus::Copied
                };
                (sp, up, k.into(), Some(orig_path.clone()), None)
            }
            K::Unmerged { conflict_type, .. } => (
                true,
                true,
                AppFileStatus::Unmerged,
                None,
                Some(conflict_type.clone()),
            ),
            K::Untracked => (false, true, AppFileStatus::Untracked, None, None),
            K::Ignored => (false, false, AppFileStatus::Ignored, None, None),
        };
        Self {
            path: e.path,
            staged,
            unstaged,
            kind,
            orig_path,
            conflict_type,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppRepoStatus {
    pub branch: AppBranchInfo,
    pub entries: Vec<AppStatusEntry>,
}

impl From<git_core::RepoStatus> for AppRepoStatus {
    fn from(s: git_core::RepoStatus) -> Self {
        Self {
            branch: s.branch.into(),
            entries: s.entries.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum AppRefKind {
    LocalBranch,
    RemoteBranch,
    Tag,
    Head,
    Stash,
}

impl From<git_graph::RefKind> for AppRefKind {
    fn from(k: git_graph::RefKind) -> Self {
        use git_graph::RefKind as K;
        match k {
            K::LocalBranch => AppRefKind::LocalBranch,
            K::RemoteBranch => AppRefKind::RemoteBranch,
            K::Tag => AppRefKind::Tag,
            K::Head => AppRefKind::Head,
            K::Stash => AppRefKind::Stash,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppRefInfo {
    pub name: String,
    pub kind: AppRefKind,
    pub target_sha: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub is_head: bool,
    pub date: Option<u32>,
    pub author: Option<String>,
    pub subject: Option<String>,
}

impl From<git_read::RefInfo> for AppRefInfo {
    fn from(r: git_read::RefInfo) -> Self {
        let is_head = r.kind == git_graph::RefKind::Head;
        Self {
            name: r.name,
            kind: r.kind.into(),
            target_sha: r.target_sha,
            upstream: r.upstream,
            ahead: r.ahead,
            behind: r.behind,
            is_head,
            date: None,
            author: None,
            subject: None,
        }
    }
}

impl From<git_core::RefInfo> for AppRefInfo {
    fn from(r: git_core::RefInfo) -> Self {
        use git_core::RefKind as K;
        let kind = match r.kind {
            K::Local => AppRefKind::LocalBranch,
            K::Remote => AppRefKind::RemoteBranch,
            K::Tag => AppRefKind::Tag,
        };
        let full_name = r.full_name.clone();
        let is_head = r.is_head || full_name == "HEAD" || r.name == "HEAD";
        Self {
            name: r.name,
            kind: if is_head { AppRefKind::Head } else { kind },
            target_sha: r.commit_id,
            upstream: r.upstream,
            ahead: r.ahead,
            behind: r.behind,
            is_head,
            date: r.date,
            author: r.author,
            subject: r.subject,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppRefLabel {
    pub name: String,
    pub kind: AppRefKind,
}

impl From<git_graph::RefLabel> for AppRefLabel {
    fn from(l: git_graph::RefLabel) -> Self {
        Self {
            name: l.name,
            kind: l.kind.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AppCommitSummary {
    pub sha: String,
    pub short_sha: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub author_time: f64,
    pub committer_time: f64,
    pub subject: String,
    pub refs: Vec<AppRefLabel>,
}

impl From<git_read::CommitSummary> for AppCommitSummary {
    fn from(c: git_read::CommitSummary) -> Self {
        Self {
            sha: c.sha,
            short_sha: c.short_sha,
            parents: c.parents,
            author_name: c.author_name,
            author_email: c.author_email,
            author_time: c.author_time as f64,
            committer_time: c.committer_time as f64,
            subject: c.subject,
            refs: c.refs.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum AppEdgeKind {
    Straight,
    MergeIn,
    BranchOut,
}

impl From<git_graph::EdgeKind> for AppEdgeKind {
    fn from(k: git_graph::EdgeKind) -> Self {
        use git_graph::EdgeKind as K;
        match k {
            K::Straight => AppEdgeKind::Straight,
            K::MergeIn => AppEdgeKind::MergeIn,
            K::BranchOut => AppEdgeKind::BranchOut,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppEdge {
    pub from_col: u16,
    pub to_col: u16,
    pub kind: AppEdgeKind,
    pub color: u8,
}

impl From<git_graph::Edge> for AppEdge {
    fn from(e: git_graph::Edge) -> Self {
        Self {
            from_col: e.from_col,
            to_col: e.to_col,
            kind: e.kind.into(),
            color: e.color,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppGraphRow {
    pub sha: String,
    pub col: u16,
    pub color: u8,
    pub edges: Vec<AppEdge>,
}

impl From<git_graph::GraphRow> for AppGraphRow {
    fn from(r: git_graph::GraphRow) -> Self {
        Self {
            sha: r.sha,
            col: r.col,
            color: r.color,
            edges: r.edges.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AppGraphPage {
    pub commits: Vec<AppCommitSummary>,
    pub rows: Vec<AppGraphRow>,
    pub has_more: bool,
}

impl From<git_read::GraphPage> for AppGraphPage {
    fn from(p: git_read::GraphPage) -> Self {
        Self {
            commits: p.commits.into_iter().map(Into::into).collect(),
            rows: p.rows.into_iter().map(Into::into).collect(),
            has_more: p.has_more,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AppCommitterInfo {
    pub name: String,
    pub email: String,
    pub time: f64,
}

impl From<git_read::CommitterInfo> for AppCommitterInfo {
    fn from(c: git_read::CommitterInfo) -> Self {
        Self {
            name: c.name,
            email: c.email,
            time: c.time as f64,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppFileChange {
    pub path: String,
    pub old_path: Option<String>,
    pub status: AppFileStatus,
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
}

impl From<git_read::FileChange> for AppFileChange {
    fn from(f: git_read::FileChange) -> Self {
        Self {
            path: f.path,
            old_path: f.old_path,
            status: f.status.into(),
            additions: f.additions as u32,
            deletions: f.deletions as u32,
            binary: f.binary,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AppCommitDetail {
    pub summary: AppCommitSummary,
    pub body: Option<String>,
    pub committer: AppCommitterInfo,
    pub signature_present: bool,
    pub files: Vec<AppFileChange>,
}

impl From<git_read::CommitDetail> for AppCommitDetail {
    fn from(d: git_read::CommitDetail) -> Self {
        Self {
            summary: d.summary.into(),
            body: d.body,
            committer: d.committer.into(),
            signature_present: d.signature_present,
            files: d.files.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AppBlameCommit {
    pub sha: String,
    pub author: String,
    pub author_mail: String,
    pub author_time: f64,
    pub summary: String,
}

impl From<git_core::BlameCommit> for AppBlameCommit {
    fn from(c: git_core::BlameCommit) -> Self {
        Self {
            sha: c.sha,
            author: c.author,
            author_mail: c.author_mail,
            author_time: c.author_time as f64,
            summary: c.summary,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AppBlameLine {
    pub line_no: u32,
    pub commit: AppBlameCommit,
}

impl From<git_core::BlameLine> for AppBlameLine {
    fn from(l: git_core::BlameLine) -> Self {
        Self {
            line_no: l.line_no,
            commit: (*l.commit).clone().into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AppFileHistoryEntry {
    pub sha: String,
    pub parents: Vec<String>,
    pub author: String,
    pub date: f64,
    pub subject: String,
}

impl From<git_core::FileHistoryEntry> for AppFileHistoryEntry {
    fn from(e: git_core::FileHistoryEntry) -> Self {
        Self {
            sha: e.sha,
            parents: e.parents,
            author: e.author,
            date: e.time as f64,
            subject: e.subject,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum AppResolution {
    Ours,
    Theirs,
    Delete,
}

impl From<git_core::Resolution> for AppResolution {
    fn from(r: git_core::Resolution) -> Self {
        use git_core::Resolution as R;
        match r {
            R::Ours => AppResolution::Ours,
            R::Theirs => AppResolution::Theirs,
            R::Delete => AppResolution::Delete,
        }
    }
}

impl From<AppResolution> for git_core::Resolution {
    fn from(r: AppResolution) -> Self {
        match r {
            AppResolution::Ours => git_core::Resolution::Ours,
            AppResolution::Theirs => git_core::Resolution::Theirs,
            AppResolution::Delete => git_core::Resolution::Delete,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppConflictVersions {
    pub base: Option<Vec<u8>>,
    pub ours: Option<Vec<u8>>,
    pub theirs: Option<Vec<u8>>,
    pub worktree: Option<Vec<u8>>,
}

impl From<git_core::ConflictVersions> for AppConflictVersions {
    fn from(c: git_core::ConflictVersions) -> Self {
        Self {
            base: c.base,
            ours: c.ours,
            theirs: c.theirs,
            worktree: c.worktree,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum AppOperationKind {
    Merge,
    Rebase,
    CherryPick,
    Revert,
}

impl From<git_core::OperationKind> for AppOperationKind {
    fn from(k: git_core::OperationKind) -> Self {
        use git_core::OperationKind as K;
        match k {
            K::Merge => AppOperationKind::Merge,
            K::Rebase => AppOperationKind::Rebase,
            K::CherryPick => AppOperationKind::CherryPick,
            K::Revert => AppOperationKind::Revert,
        }
    }
}

impl From<AppOperationKind> for git_core::OperationKind {
    fn from(k: AppOperationKind) -> Self {
        match k {
            AppOperationKind::Merge => git_core::OperationKind::Merge,
            AppOperationKind::Rebase => git_core::OperationKind::Rebase,
            AppOperationKind::CherryPick => git_core::OperationKind::CherryPick,
            AppOperationKind::Revert => git_core::OperationKind::Revert,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum AppOperationState {
    None,
    Merging {
        commit_id: Option<String>,
    },
    Rebasing {
        step: u32,
        total: u32,
        onto: Option<String>,
        branch: Option<String>,
    },
    CherryPicking {
        commit_id: Option<String>,
    },
    Reverting {
        commit_id: Option<String>,
    },
}

impl From<git_core::OperationState> for AppOperationState {
    fn from(s: git_core::OperationState) -> Self {
        use git_core::OperationState as S;
        match s {
            S::None => AppOperationState::None,
            S::Merging { commit_id } => AppOperationState::Merging { commit_id },
            S::Rebasing {
                step,
                total,
                onto,
                branch,
            } => AppOperationState::Rebasing {
                step,
                total,
                onto,
                branch,
            },
            S::CherryPicking { commit_id } => AppOperationState::CherryPicking { commit_id },
            S::Reverting { commit_id } => AppOperationState::Reverting { commit_id },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppStashEntry {
    pub index: u32,
    pub name: String,
    pub commit_id: String,
    pub subject: String,
    pub date: String,
}

impl From<git_core::StashEntry> for AppStashEntry {
    fn from(s: git_core::StashEntry) -> Self {
        Self {
            index: s.index as u32,
            name: s.name,
            commit_id: s.commit_id,
            subject: s.message,
            date: s.date,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppStashPushOptions {
    pub message: Option<String>,
    pub include_untracked: bool,
    pub paths: Vec<String>,
}

impl From<git_core::StashPushOptions> for AppStashPushOptions {
    fn from(o: git_core::StashPushOptions) -> Self {
        Self {
            message: o.message,
            include_untracked: o.include_untracked,
            paths: o
                .paths
                .into_iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect(),
        }
    }
}

impl From<AppStashPushOptions> for git_core::StashPushOptions {
    fn from(o: AppStashPushOptions) -> Self {
        git_core::StashPushOptions {
            message: o.message,
            include_untracked: o.include_untracked,
            paths: o.paths.into_iter().map(std::path::PathBuf::from).collect(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum AppPullMode {
    Default,
    Rebase,
    FastForwardOnly,
}

impl From<AppPullMode> for git_core::PullMode {
    fn from(m: AppPullMode) -> Self {
        match m {
            AppPullMode::Default => git_core::PullMode::Default,
            AppPullMode::Rebase => git_core::PullMode::Rebase,
            AppPullMode::FastForwardOnly => git_core::PullMode::FastForwardOnly,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppPushOptions {
    pub remote: Option<String>,
    pub branch: Option<String>,
    pub set_upstream: bool,
    pub force_with_lease: bool,
    pub tags: bool,
}

impl From<AppPushOptions> for git_core::PushOptions {
    fn from(o: AppPushOptions) -> Self {
        git_core::PushOptions {
            remote: o.remote,
            branch: o.branch,
            set_upstream: o.set_upstream,
            force_with_lease: o.force_with_lease,
            tags: o.tags,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppCommitOptions {
    pub message: String,
    pub amend: bool,
    pub signoff: bool,
    pub no_verify: bool,
    pub all: bool,
}

impl From<AppCommitOptions> for git_core::CommitOptions {
    fn from(o: AppCommitOptions) -> Self {
        git_core::CommitOptions {
            message: o.message,
            amend: o.amend,
            signoff: o.signoff,
            no_verify: o.no_verify,
            all: o.all,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum AppFileRev {
    Head,
    Index,
    Worktree,
    Commit(String),
    Stage(u8),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum AppSide {
    Original,
    Modified,
}

impl From<AppSide> for git_core::Side {
    fn from(s: AppSide) -> Self {
        match s {
            AppSide::Original => git_core::Side::Original,
            AppSide::Modified => git_core::Side::Modified,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppLineSelection {
    pub side: AppSide,
    pub start: u32,
    pub end: u32,
}

impl From<AppLineSelection> for git_core::LineSelection {
    fn from(s: AppLineSelection) -> Self {
        git_core::LineSelection::new(s.side.into(), s.start, s.end)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppGraphFilter {
    pub refs: Option<Vec<String>>,
    pub include_remotes: bool,
    pub include_tags: bool,
    pub include_stash: bool,
    pub first_parent_only: bool,
}

impl From<AppGraphFilter> for git_read::GraphFilter {
    fn from(f: AppGraphFilter) -> Self {
        git_read::GraphFilter {
            refs: match f.refs {
                Some(v) => git_read::RefFilter::Selected(v),
                None => git_read::RefFilter::All,
            },
            include_remotes: f.include_remotes,
            include_tags: f.include_tags,
            include_stash: f.include_stash,
            first_parent_only: f.first_parent_only,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum AppRebaseAction {
    Pick,
    Reword,
    Edit,
    Squash,
    Fixup,
    Drop,
}

impl From<AppRebaseAction> for git_core::RebaseAction {
    fn from(a: AppRebaseAction) -> Self {
        use git_core::RebaseAction as R;
        match a {
            AppRebaseAction::Pick => R::Pick,
            AppRebaseAction::Reword => R::Reword,
            AppRebaseAction::Edit => R::Edit,
            AppRebaseAction::Squash => R::Squash,
            AppRebaseAction::Fixup => R::Fixup,
            AppRebaseAction::Drop => R::Drop,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppRebaseTodoEntry {
    pub action: AppRebaseAction,
    pub sha: String,
    pub subject: String,
}

impl From<AppRebaseTodoEntry> for git_core::RebaseTodoEntry {
    fn from(e: AppRebaseTodoEntry) -> Self {
        git_core::RebaseTodoEntry {
            action: e.action.into(),
            sha: e.sha,
            subject: e.subject,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppBlameOptions {
    pub ignore_ws: bool,
    pub detect_moves: bool,
    pub detect_copies: bool,
}

impl From<AppBlameOptions> for git_core::BlameOptions {
    fn from(o: AppBlameOptions) -> Self {
        git_core::BlameOptions {
            ignore_ws: o.ignore_ws,
            detect_moves: o.detect_moves,
            detect_copies: o.detect_copies,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppCloneOptions {
    pub url: String,
    pub dir: String,
}
