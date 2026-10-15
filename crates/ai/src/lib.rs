pub mod diff_budget;
pub mod error;
pub mod postprocess;
pub mod prompt;
pub mod provider;
pub mod redact;

pub use diff_budget::{
    apply_diff_budget, estimate_tokens, parse_gitattributes_generated, DiffBudgetOptions,
    StagedFileInput,
};
pub use error::{AiError, AiErrorKind};
pub use postprocess::{postprocess_commit_message, PostprocessResult};
pub use prompt::{
    build_commit_prompt, build_explain_commit_prompt, build_pr_prompt, extract_issue_from_branch,
    load_repo_constraints, parse_commitlint_js_regex, parse_commitlint_json, parse_commitlint_yaml,
    parse_vsc_git_json, resolve_language, CommitConstraints, CommitPromptInput,
};
pub use provider::{
    ChatMessage, ClaudeProvider, GenerateRequest, LlmProvider, OllamaProvider, OpenAICompatProvider,
};
pub use redact::{redact_diff, redact_text};
