use crate::error::{ErrorKind, GitError};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Cancellation token to cooperatively abort a running git process.
#[derive(Debug, Clone, Default)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Recorded metadata of a git command execution, displayed in the Git Output window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitCommandRecord {
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub stderr: String,
}

pub type CommandObserver = Arc<dyn Fn(&GitCommandRecord) + Send + Sync>;

/// Parsed git semantic version.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct GitVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    pub raw: String,
}

impl GitVersion {
    /// Parse git version string (e.g. "git version 2.55.0", "git version 2.39.3 (Apple Git-146)")
    pub fn parse(output: &str) -> Result<Self, GitError> {
        let prefix = "git version ";
        let trimmed = output.trim();
        let idx = trimmed.find(prefix).ok_or_else(|| {
            GitError::internal(format!("Unexpected git version output: {trimmed}"))
        })?;
        let rest = &trimmed[idx + prefix.len()..];

        // The version string begins immediately after "git version " and ends at the first whitespace or non-digit/dot
        let ver_part = rest
            .split_whitespace()
            .next()
            .unwrap_or("")
            .trim_end_matches(|c: char| !c.is_ascii_digit());

        let parts: Vec<&str> = ver_part.split('.').collect();
        if parts.len() < 2 {
            return Err(GitError::internal(format!(
                "Failed to parse git version numbers from: {output}"
            )));
        }

        let major: u32 = parts[0]
            .parse()
            .map_err(|_| GitError::internal(format!("Invalid major version: {}", parts[0])))?;
        let minor: u32 = parts[1]
            .parse()
            .map_err(|_| GitError::internal(format!("Invalid minor version: {}", parts[1])))?;
        let patch: u32 = parts.get(2).and_then(|p| p.parse().ok()).unwrap_or(0);

        Ok(Self {
            major,
            minor,
            patch,
            raw: trimmed.to_string(),
        })
    }

    pub fn is_supported(&self) -> bool {
        self.major > 2 || (self.major == 2 && self.minor >= 35)
    }
}

/// Options configuring git command execution.
#[derive(Debug, Clone, Default)]
pub struct CommandOptions {
    pub read_only: bool,
    pub stdin: Option<Vec<u8>>,
    pub timeout: Option<Duration>,
    pub cancel_token: Option<CancelToken>,
    pub extra_env: HashMap<String, String>,
}

impl CommandOptions {
    pub fn read_only() -> Self {
        Self {
            read_only: true,
            ..Default::default()
        }
    }

    pub fn with_stdin(mut self, stdin: impl Into<Vec<u8>>) -> Self {
        self.stdin = Some(stdin.into());
        self
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }

    pub fn with_cancel_token(mut self, token: CancelToken) -> Self {
        self.cancel_token = Some(token);
        self
    }

    pub fn with_env(mut self, key: impl Into<String>, val: impl Into<String>) -> Self {
        self.extra_env.insert(key.into(), val.into());
        self
    }
}

/// Raw output from running a git command.
#[derive(Debug, Clone)]
pub struct GitOutput {
    pub stdout: Vec<u8>,
    pub stderr: String,
    pub exit_code: i32,
}

impl GitOutput {
    pub fn stdout_str(&self) -> Result<&str, GitError> {
        std::str::from_utf8(&self.stdout)
            .map_err(|e| GitError::internal(format!("Git stdout is not valid UTF-8: {e}")))
    }

    pub fn stdout_lossy(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }
}

/// Runner for git CLI commands with standard environment, timeouts, cancellation, and logging.
#[derive(Clone)]
pub struct GitCli {
    git_path: PathBuf,
    extra_env: HashMap<String, String>,
    observer: Option<CommandObserver>,
}

impl Default for GitCli {
    fn default() -> Self {
        Self::new("git")
    }
}

impl GitCli {
    pub fn new(git_path: impl Into<PathBuf>) -> Self {
        Self {
            git_path: git_path.into(),
            extra_env: HashMap::new(),
            observer: None,
        }
    }

    pub fn with_env(mut self, key: impl Into<String>, val: impl Into<String>) -> Self {
        self.extra_env.insert(key.into(), val.into());
        self
    }

    pub fn with_observer(mut self, observer: CommandObserver) -> Self {
        self.observer = Some(observer);
        self
    }

    pub fn git_path(&self) -> &Path {
        &self.git_path
    }

    /// Check git presence and verify version >= 2.35.
    pub fn version(&self) -> Result<GitVersion, GitError> {
        let output =
            match self.exec_raw(Path::new("."), &["--version"], CommandOptions::read_only()) {
                Ok(out) => out,
                Err(e) => {
                    if e.kind == ErrorKind::GitMissing {
                        return Err(e);
                    }
                    return Err(GitError::git_missing(format!(
                        "Failed to execute git at {:?}: {}",
                        self.git_path, e.message
                    )));
                }
            };

        if output.exit_code != 0 {
            return Err(GitError::from_stderr(
                Some(output.exit_code),
                &output.stderr,
            ));
        }

        let ver = GitVersion::parse(&output.stdout_lossy())?;
        if !ver.is_supported() {
            return Err(GitError::git_too_old(&ver.raw, "2.35.0"));
        }

        Ok(ver)
    }

    /// Execute a git command and return `GitOutput` on success (exit_code == 0),
    /// or `GitError` on failure (exit_code != 0, missing binary, or cancellation).
    pub fn exec(
        &self,
        cwd: &Path,
        args: &[&str],
        options: CommandOptions,
    ) -> Result<GitOutput, GitError> {
        let output = self.exec_raw(cwd, args, options)?;
        if output.exit_code != 0 {
            return Err(GitError::from_stderr(
                Some(output.exit_code),
                &output.stderr,
            ));
        }
        Ok(output)
    }

    /// Execute a git command and return `GitOutput` without failing on non-zero exit code.
    pub fn exec_raw(
        &self,
        cwd: &Path,
        args: &[&str],
        options: CommandOptions,
    ) -> Result<GitOutput, GitError> {
        let mut cmd = std::process::Command::new(&self.git_path);
        cmd.args(args);
        cmd.current_dir(cwd);

        // Fixed environment variables according to spec 4.3
        cmd.env("LC_ALL", "C");
        cmd.env("GIT_TERMINAL_PROMPT", "0");
        if options.read_only {
            cmd.env("GIT_OPTIONAL_LOCKS", "0");
        }

        for (k, v) in &self.extra_env {
            cmd.env(k, v);
        }
        for (k, v) in &options.extra_env {
            cmd.env(k, v);
        }

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        if options.stdin.is_some() {
            cmd.stdin(Stdio::piped());
        } else {
            cmd.stdin(Stdio::null());
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let start = Instant::now();
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let kind = if e.kind() == std::io::ErrorKind::NotFound {
                    ErrorKind::GitMissing
                } else {
                    ErrorKind::Internal
                };
                return Err(GitError::new(kind, format!("Failed to spawn git: {e}")));
            }
        };

        // Write stdin in background thread if supplied
        if let Some(stdin_data) = options.stdin {
            if let Some(mut stdin) = child.stdin.take() {
                std::thread::spawn(move || {
                    let _ = stdin.write_all(&stdin_data);
                    let _ = stdin.flush();
                });
            }
        }

        // Read stdout and stderr concurrently to prevent pipe buffer deadlocks
        let mut stdout_handle = child.stdout.take().expect("stdout piped");
        let stdout_thread = std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = stdout_handle.read_to_end(&mut buf);
            buf
        });

        let mut stderr_handle = child.stderr.take().expect("stderr piped");
        let stderr_thread = std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = stderr_handle.read_to_end(&mut buf);
            buf
        });

        // Wait loop checking cancellation and timeout
        let mut killed = false;
        let mut cancelled = false;

        let status = loop {
            if let Some(token) = &options.cancel_token {
                if token.is_cancelled() {
                    let _ = child.kill();
                    killed = true;
                    cancelled = true;
                    break child.wait();
                }
            }

            if let Some(timeout) = options.timeout {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    killed = true;
                    cancelled = true;
                    break child.wait();
                }
            }

            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => std::thread::sleep(Duration::from_millis(5)),
                Err(e) => break Err(e),
            }
        };

        let stdout = stdout_thread.join().unwrap_or_default();
        let stderr_bytes = stderr_thread.join().unwrap_or_default();
        let stderr = String::from_utf8_lossy(&stderr_bytes).into_owned();
        let duration_ms = start.elapsed().as_millis() as u64;

        let exit_code = match status {
            Ok(s) => s.code(),
            Err(_) => None,
        };

        let record = GitCommandRecord {
            args: args.iter().map(|s| s.to_string()).collect(),
            cwd: cwd.to_path_buf(),
            exit_code,
            duration_ms,
            stderr: stderr.clone(),
        };

        if let Some(obs) = &self.observer {
            obs(&record);
        }

        if cancelled || killed {
            return Err(GitError::cancelled().with_stderr(stderr));
        }

        match status {
            Ok(s) => Ok(GitOutput {
                stdout,
                stderr,
                exit_code: s.code().unwrap_or(-1),
            }),
            Err(e) => Err(GitError::internal(format!("Process wait error: {e}"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use parking_lot::Mutex;

    #[test]
    fn test_git_version_parsing() {
        let v1 = GitVersion::parse("git version 2.55.0\n").unwrap();
        assert_eq!(v1.major, 2);
        assert_eq!(v1.minor, 55);
        assert_eq!(v1.patch, 0);
        assert!(v1.is_supported());

        let v2 = GitVersion::parse("git version 2.39.3 (Apple Git-146)").unwrap();
        assert_eq!(v2.major, 2);
        assert_eq!(v2.minor, 39);
        assert_eq!(v2.patch, 3);
        assert!(v2.is_supported());

        let v3 = GitVersion::parse("git version 2.40.1.windows.1").unwrap();
        assert_eq!(v3.major, 2);
        assert_eq!(v3.minor, 40);
        assert_eq!(v3.patch, 1);
        assert!(v3.is_supported());

        let old = GitVersion::parse("git version 2.34.1").unwrap();
        assert_eq!(old.major, 2);
        assert_eq!(old.minor, 34);
        assert!(!old.is_supported());
    }

    #[test]
    fn test_git_cli_version_check() {
        let cli = GitCli::default();
        let ver = cli.version().expect("system git should be >= 2.35");
        assert!(ver.is_supported());
    }

    #[test]
    fn test_git_cli_observer() {
        let records = Arc::new(Mutex::new(Vec::new()));
        let records_clone = Arc::clone(&records);

        let cli = GitCli::default().with_observer(Arc::new(move |rec| {
            records_clone.lock().push(rec.clone());
        }));

        let out = cli
            .exec(Path::new("."), &["--version"], CommandOptions::read_only())
            .unwrap();
        assert!(out.stdout_lossy().contains("git version"));

        let recs = records.lock();
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].args, vec!["--version"]);
        assert_eq!(recs[0].exit_code, Some(0));
    }

    #[test]
    fn test_git_cli_stdin() {
        let cli = GitCli::default();
        // hash-object --stdin computes hash of piped content
        let out = cli
            .exec(
                Path::new("."),
                &["hash-object", "--stdin"],
                CommandOptions::read_only().with_stdin(b"hello world\n"),
            )
            .unwrap();
        // 3b18e512dba79e4c8300dd08aeb37f8e728b8dad is SHA1 of "hello world\n"
        assert_eq!(
            out.stdout_str().unwrap().trim(),
            "3b18e512dba79e4c8300dd08aeb37f8e728b8dad"
        );
    }

    #[test]
    fn test_git_cli_cancel() {
        let cli = GitCli::default();
        let token = CancelToken::new();
        let token_clone = token.clone();

        // Cancel after 20ms
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            token_clone.cancel();
        });

        // Running a command with cancel token
        let res = cli.exec(
            Path::new("."),
            &["log", "-n", "100000"],
            CommandOptions::read_only().with_cancel_token(token),
        );
        // Either finishes very fast or gets cancelled
        if let Err(err) = res {
            assert_eq!(err.kind, ErrorKind::Cancelled);
        }
    }
}
