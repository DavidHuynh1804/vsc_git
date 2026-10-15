use serde::{Deserialize, Serialize};

/// Categories of errors occurring in git operations matching specification section 12.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, thiserror::Error)]
pub enum ErrorKind {
    #[error("not a git repository")]
    NotARepo,
    #[error("git is missing")]
    GitMissing,
    #[error("git version is too old")]
    GitTooOld,
    #[error("git index is locked")]
    IndexLocked,
    #[error("git conflict")]
    Conflict,
    #[error("working tree is dirty")]
    DirtyWorktree,
    #[error("authentication failed")]
    AuthFailed,
    #[error("non-fast-forward")]
    NonFastForward,
    #[error("hook failed")]
    HookFailed,
    #[error("nothing to commit")]
    NothingToCommit,
    #[error("network error")]
    Network,
    #[error("patch failed")]
    PatchFailed,
    #[error("operation cancelled")]
    Cancelled,
    #[error("internal error")]
    Internal,
}

/// Structured error returned by git-core operations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[error("{message}")]
pub struct GitError {
    pub kind: ErrorKind,
    pub message: String,
    pub git_stderr: Option<String>,
    pub hint: Option<String>,
}

impl GitError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            git_stderr: None,
            hint: default_hint(kind).map(str::to_string),
        }
    }

    pub fn with_stderr(mut self, stderr: impl Into<String>) -> Self {
        self.git_stderr = Some(stderr.into());
        self
    }

    pub fn with_hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    pub fn not_a_repo(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::NotARepo, message)
    }

    pub fn git_missing(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::GitMissing, message)
    }

    pub fn git_too_old(found: &str, required: &str) -> Self {
        Self::new(
            ErrorKind::GitTooOld,
            format!("Git version {found} is too old. Required: >={required}"),
        )
    }

    pub fn cancelled() -> Self {
        Self::new(ErrorKind::Cancelled, "Git operation was cancelled")
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Internal, message)
    }

    pub fn patch_failed(message: impl Into<String>, stderr: Option<String>) -> Self {
        let mut err = Self::new(ErrorKind::PatchFailed, message);
        err.git_stderr = stderr;
        err
    }

    /// Classify git CLI output into structured `GitError`.
    pub fn from_stderr(exit_code: Option<i32>, stderr: &str) -> Self {
        let trimmed_stderr = stderr.trim();
        let kind = classify_error_kind(exit_code, trimmed_stderr);
        let hint = default_hint(kind).map(str::to_string);
        let message = if trimmed_stderr.is_empty() {
            format!("Git command failed with exit code {:?}", exit_code)
        } else {
            // First non-empty line of stderr is usually the core error message
            trimmed_stderr
                .lines()
                .find(|l| !l.trim().is_empty())
                .unwrap_or(trimmed_stderr)
                .to_string()
        };

        Self {
            kind,
            message,
            git_stderr: Some(trimmed_stderr.to_string()),
            hint,
        }
    }
}

/// Classify git stderr and exit code into an `ErrorKind`.
pub fn classify_error_kind(exit_code: Option<i32>, stderr: &str) -> ErrorKind {
    let lower = stderr.to_ascii_lowercase();

    // Index locked
    if lower.contains("index.lock")
        || lower.contains("another git process seems to be running")
        || lower.contains("unable to create") && lower.contains(".git/index.lock")
    {
        return ErrorKind::IndexLocked;
    }

    // Not a repo
    if lower.contains("not a git repository") {
        return ErrorKind::NotARepo;
    }

    // Authentication
    if lower.contains("authentication failed")
        || lower.contains("permission denied (publickey")
        || lower.contains("could not read username")
        || lower.contains("terminal prompts disabled")
        || lower.contains("invalid username or password")
        || lower.contains("http basic: access denied")
    {
        return ErrorKind::AuthFailed;
    }

    // Non-fast-forward / rejected push
    if lower.contains("non-fast-forward")
        || lower.contains("[rejected]")
        || lower.contains("updates were rejected because the remote contains work")
        || lower.contains("updates were rejected because the tip of your current branch is behind")
        || lower.contains("fetch first")
    {
        return ErrorKind::NonFastForward;
    }

    // Hook failed
    if lower.contains("hook declined")
        || lower.contains("pre-commit hook failed")
        || lower.contains("commit-msg hook failed")
        || lower.contains("pre-push hook failed")
        || lower.contains("hook failed to verify")
        || (lower.contains("hook") && exit_code == Some(1))
    {
        return ErrorKind::HookFailed;
    }

    // Conflict
    if lower.contains("automatic merge failed; fix conflicts")
        || lower.contains("conflict (content):")
        || lower.contains("conflict (modify/delete):")
        || lower.contains("conflict (rename/delete):")
        || lower.contains("conflict (rename/rename):")
        || lower.contains("you have unmerged files")
        || lower.contains("fix conflicts and then commit")
        || lower.contains("needs merge")
    {
        return ErrorKind::Conflict;
    }

    // Dirty worktree
    if lower.contains("your local changes to the following files would be overwritten")
        || lower.contains("commit your changes or stash them before you switch branches")
        || lower.contains("commit your changes or stash them before you merge")
        || lower.contains("cannot be done while you have unmerged files")
    {
        return ErrorKind::DirtyWorktree;
    }

    // Nothing to commit
    if lower.contains("nothing to commit")
        || lower.contains("no changes added to commit")
        || lower.contains("nothing added to commit but untracked files present")
    {
        return ErrorKind::NothingToCommit;
    }

    // Patch failed
    if lower.contains("patch does not apply")
        || lower.contains("corrupt patch at line")
        || lower.contains("error: patch failed")
        || lower.contains("does not match current")
        || lower.contains("cannot apply binary patch")
    {
        return ErrorKind::PatchFailed;
    }

    // Network
    if lower.contains("could not resolve host")
        || lower.contains("failed to connect to")
        || lower.contains("connection refused")
        || lower.contains("network is unreachable")
        || lower.contains("operation timed out")
        || lower.contains("the remote end hung up unexpectedly")
        || lower.contains("unable to access")
        || lower.contains("ssl certificate problem")
    {
        return ErrorKind::Network;
    }

    ErrorKind::Internal
}

/// Provides user-friendly hints corresponding to each error kind.
pub fn default_hint(kind: ErrorKind) -> Option<&'static str> {
    match kind {
        ErrorKind::NotARepo => Some("Thư mục hiện tại không phải là git repository."),
        ErrorKind::GitMissing => Some("Màn hình hướng dẫn cài/cập nhật git, link tải."),
        ErrorKind::GitTooOld => Some("Cần cập nhật git lên phiên bản >= 2.35."),
        ErrorKind::IndexLocked => {
            Some("Có tiến trình git khác đang chạy? Thử lại hoặc xoá index.lock sau khi xác nhận.")
        }
        ErrorKind::Conflict => Some("Xung đột xảy ra. Hãy giải quyết xung đột trước khi commit."),
        ErrorKind::DirtyWorktree => Some("Stash thay đổi hiện tại và tiếp tục, hoặc huỷ thao tác."),
        ErrorKind::AuthFailed => {
            Some("Kiểm tra SSH key, credential helper hoặc Personal Access Token (PAT).")
        }
        ErrorKind::NonFastForward => {
            Some("Remote có commit mới. Hãy Pull rồi Push, hoặc Force (with lease).")
        }
        ErrorKind::HookFailed => {
            Some("Hook thất bại. Xem chi tiết output hoặc chọn Commit với --no-verify.")
        }
        ErrorKind::NothingToCommit => Some("Không có thay đổi nào được stage để commit."),
        ErrorKind::Network => {
            Some("Lỗi kết nối mạng đến remote. Kiểm tra đường truyền hoặc URL remote.")
        }
        ErrorKind::PatchFailed => Some("Diff đã thay đổi, refresh và thử lại."),
        ErrorKind::Cancelled => Some("Thao tác đã bị huỷ bởi người dùng."),
        ErrorKind::Internal => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_index_locked() {
        let stderr = "fatal: Unable to create '/path/.git/index.lock': File exists.\nAnother git process seems to be running in this repository";
        let err = GitError::from_stderr(Some(128), stderr);
        assert_eq!(err.kind, ErrorKind::IndexLocked);
        assert!(err.hint.is_some());
    }

    #[test]
    fn test_classify_non_fast_forward() {
        let stderr = "To https://github.com/repo\n ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs";
        let err = GitError::from_stderr(Some(1), stderr);
        assert_eq!(err.kind, ErrorKind::NonFastForward);
    }

    #[test]
    fn test_classify_auth_failed() {
        let stderr = "fatal: Authentication failed for 'https://github.com/repo.git/'";
        let err = GitError::from_stderr(Some(128), stderr);
        assert_eq!(err.kind, ErrorKind::AuthFailed);

        let stderr_ssh = "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.";
        let err_ssh = GitError::from_stderr(Some(255), stderr_ssh);
        assert_eq!(err_ssh.kind, ErrorKind::AuthFailed);
    }

    #[test]
    fn test_classify_hook_failed() {
        let stderr = "pre-commit hook failed (exit code 1)";
        let err = GitError::from_stderr(Some(1), stderr);
        assert_eq!(err.kind, ErrorKind::HookFailed);
    }

    #[test]
    fn test_classify_not_a_repo() {
        let stderr = "fatal: not a git repository (or any of the parent directories): .git";
        let err = GitError::from_stderr(Some(128), stderr);
        assert_eq!(err.kind, ErrorKind::NotARepo);
    }

    #[test]
    fn test_classify_conflict() {
        let stderr = "CONFLICT (content): Merge conflict in src/main.rs\nAutomatic merge failed; fix conflicts and then commit the result.";
        let err = GitError::from_stderr(Some(1), stderr);
        assert_eq!(err.kind, ErrorKind::Conflict);
    }

    #[test]
    fn test_classify_dirty_worktree() {
        let stderr = "error: Your local changes to the following files would be overwritten by checkout:\n\tfile.txt\nPlease commit your changes or stash them before you switch branches.";
        let err = GitError::from_stderr(Some(1), stderr);
        assert_eq!(err.kind, ErrorKind::DirtyWorktree);
    }

    #[test]
    fn test_classify_patch_failed() {
        let stderr =
            "error: patch failed: src/main.rs:10\nerror: src/main.rs: patch does not apply";
        let err = GitError::from_stderr(Some(1), stderr);
        assert_eq!(err.kind, ErrorKind::PatchFailed);
    }

    #[test]
    fn test_classify_network() {
        let stderr =
            "fatal: unable to access 'https://github.com/...': Could not resolve host: github.com";
        let err = GitError::from_stderr(Some(128), stderr);
        assert_eq!(err.kind, ErrorKind::Network);
    }

    #[test]
    fn test_classify_nothing_to_commit() {
        let stderr = "nothing to commit, working tree clean";
        let err = GitError::from_stderr(Some(1), stderr);
        assert_eq!(err.kind, ErrorKind::NothingToCommit);
    }
}
