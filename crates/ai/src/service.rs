use crate::diff_budget::{apply_diff_budget, DiffBudgetOptions, StagedFileInput};
use crate::error::AiError;
use crate::postprocess::{postprocess_commit_message, PostprocessResult};
use crate::prompt::{build_commit_prompt, load_repo_constraints, CommitPromptInput};
use crate::provider::{ChatMessage, GenerateRequest, LlmProvider};
use crate::redact::redact_diff;
use futures_util::StreamExt;
use git_core::cli::{CommandOptions, GitCli};
use globset::{Glob, GlobSetBuilder};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Instant;
use tokio_util::sync::CancellationToken;

fn default_true() -> bool {
    true
}

fn default_provider() -> String {
    "claude".to_string()
}

fn default_model() -> String {
    "claude-haiku-5-5".to_string()
}

fn default_language() -> String {
    "auto".to_string()
}

fn default_max_diff_tokens() -> usize {
    20_000
}

/// Configuration settings for AI features matching spec section 10.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiSettings {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_max_diff_tokens")]
    pub max_diff_tokens: usize,
    #[serde(default)]
    pub exclude_globs: Vec<String>,
    #[serde(default)]
    pub disabled_repos: Vec<String>,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            provider: default_provider(),
            model: default_model(),
            base_url: None,
            language: default_language(),
            max_diff_tokens: default_max_diff_tokens(),
            exclude_globs: DiffBudgetOptions::default().exclude_globs,
            disabled_repos: Vec::new(),
        }
    }
}

fn is_repo_disabled(
    repo_path: &Path,
    disabled_patterns: &[String],
    cli: &GitCli,
) -> Result<bool, AiError> {
    // 1. Check .vsc-git.json for repo-level disable flag
    let vsc_path = repo_path.join(".vsc-git.json");
    if vsc_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&vsc_path) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(disabled) = val.get("ai.disabled").and_then(|v| v.as_bool()) {
                    if disabled {
                        return Ok(true);
                    }
                }
                if let Some(ai_obj) = val.get("ai").and_then(|v| v.as_object()) {
                    if let Some(disabled) = ai_obj.get("disabled").and_then(|v| v.as_bool()) {
                        if disabled {
                            return Ok(true);
                        }
                    }
                }
            }
        }
    }

    if disabled_patterns.is_empty() {
        return Ok(false);
    }

    let mut glob_builder = GlobSetBuilder::new();
    for pat in disabled_patterns {
        if let Ok(g) = Glob::new(pat) {
            glob_builder.add(g);
        }
    }
    let glob_matcher = glob_builder.build().ok();

    // 2. Check repo path against disabled globs/patterns
    let path_str = repo_path.to_string_lossy();
    if let Some(ref m) = glob_matcher {
        if m.is_match(repo_path) || m.is_match(path_str.as_ref()) {
            return Ok(true);
        }
    }
    for pat in disabled_patterns {
        if path_str.contains(pat) {
            return Ok(true);
        }
    }

    // 3. Check remote URL (origin)
    if let Ok(out) = cli.exec(
        repo_path,
        &["config", "--get", "remote.origin.url"],
        CommandOptions::read_only(),
    ) {
        let remote_url = out.stdout_lossy().trim().to_string();
        if !remote_url.is_empty() {
            if let Some(ref m) = glob_matcher {
                if m.is_match(&remote_url) {
                    return Ok(true);
                }
            }
            for pat in disabled_patterns {
                if remote_url.contains(pat) {
                    return Ok(true);
                }
            }
        }
    }

    Ok(false)
}

/// Orchestrate commit message generation for a git repository:
/// Fetch staged diff -> Budget diff -> Redact secrets -> Build prompt -> Stream response -> Postprocess.
pub async fn generate_commit_message<F>(
    repo_path: &Path,
    settings: &AiSettings,
    provider: &dyn LlmProvider,
    mut on_chunk: F,
    cancel: CancellationToken,
) -> Result<PostprocessResult, AiError>
where
    F: FnMut(String) + Send + 'static,
{
    if !settings.enabled {
        return Err(AiError::disabled("AI is disabled in settings"));
    }

    let cli = GitCli::default();

    if is_repo_disabled(repo_path, &settings.disabled_repos, &cli)? {
        return Err(AiError::disabled(
            "AI is disabled for this repository by configuration",
        ));
    }

    // 1. Fetch staged unified diff
    let diff_out = cli
        .exec(
            repo_path,
            &["diff", "--cached", "--no-color", "--no-ext-diff", "-M"],
            CommandOptions::read_only(),
        )
        .map_err(|e| AiError::internal(format!("Failed to retrieve staged diff: {e}")))?;

    let raw_diff = diff_out.stdout_lossy();
    if raw_diff.trim().is_empty() {
        return Err(AiError::bad_response(
            "No staged changes found in repository",
        ));
    }

    // 2. Fetch repository status to identify staged files
    let status = git_core::ops::status(&cli, repo_path)
        .map_err(|e| AiError::internal(format!("Failed to get repo status: {e}")))?;

    let mut staged_file_inputs = Vec::new();
    let mut staged_display_files = Vec::new();

    for entry in &status.entries {
        if entry.is_staged() {
            staged_file_inputs.push(StagedFileInput::new(&entry.path));
            let staged_desc = match &entry.kind {
                git_core::StatusEntryKind::Ordinary { staged, .. } => format!("{staged:?}"),
                git_core::StatusEntryKind::RenamedOrCopied { staged, .. } => format!("{staged:?}"),
                _ => "Staged".to_string(),
            };
            staged_display_files.push(format!("{staged_desc} {}", entry.path));
        }
    }

    let branch_name = status.branch.head.clone();

    // 3. Fetch up to 10 recent commit subjects
    let log_out = cli.exec(
        repo_path,
        &["log", "-n", "10", "--format=%s"],
        CommandOptions::read_only(),
    );
    let recent_commits: Vec<String> = match log_out {
        Ok(out) => out
            .stdout_lossy()
            .lines()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        Err(_) => Vec::new(),
    };

    // 4. Load repository commitlint and .vsc-git.json constraints
    let constraints = load_repo_constraints(repo_path);

    // 5. Apply diff budgeting
    let budget_options = DiffBudgetOptions {
        max_tokens: settings.max_diff_tokens,
        exclude_globs: if settings.exclude_globs.is_empty() {
            DiffBudgetOptions::default().exclude_globs
        } else {
            settings.exclude_globs.clone()
        },
    };
    let budgeted_diff = apply_diff_budget(&raw_diff, &staged_file_inputs, &budget_options);

    // 6. Redact sensitive secrets
    let redacted_diff = redact_diff(&budgeted_diff);

    // 7. Build prompt
    let prompt_input = CommitPromptInput {
        staged_diff: &redacted_diff,
        staged_files: &staged_display_files,
        branch_name: branch_name.as_deref(),
        recent_commits: &recent_commits,
        constraints: &constraints,
        language: &settings.language,
    };
    let (system_prompt, user_prompt) = build_commit_prompt(prompt_input);

    let start_time = Instant::now();
    tracing::info!(
        model = %settings.model,
        prompt_len = user_prompt.len(),
        "Starting LLM commit message generation"
    );

    // 8. Stream from LLM provider
    let req = GenerateRequest {
        model: settings.model.clone(),
        messages: vec![ChatMessage::user(user_prompt)],
        system: Some(system_prompt),
        max_tokens: Some(1024),
        temperature: Some(0.2),
    };

    let mut stream = provider.generate(req, cancel);
    let mut full_response = String::new();

    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res?;
        on_chunk(chunk.clone());
        full_response.push_str(&chunk);
    }

    let elapsed = start_time.elapsed();
    tracing::info!(
        response_len = full_response.len(),
        duration_ms = elapsed.as_millis(),
        "Finished LLM commit message streaming"
    );

    // 9. Postprocess output
    let result = postprocess_commit_message(
        &full_response,
        constraints.header_max_length,
        constraints.types.as_deref(),
    );

    Ok(result)
}
