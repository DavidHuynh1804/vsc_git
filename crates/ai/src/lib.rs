pub mod diff_budget;
pub mod error;
pub mod provider;

pub use diff_budget::{
    apply_diff_budget, estimate_tokens, parse_gitattributes_generated, DiffBudgetOptions,
    StagedFileInput,
};
pub use error::{AiError, AiErrorKind};
pub use provider::{
    ChatMessage, ClaudeProvider, GenerateRequest, LlmProvider, OllamaProvider, OpenAICompatProvider,
};
