use regex::Regex;
use std::sync::LazyLock;

static CONVENTIONAL_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^([a-zA-Z0-9_\-]+)(?:\([a-zA-Z0-9_\-\./ ]+\))?!?: (.+)$")
        .expect("valid conventional regex")
});

/// Result of post-processing a generated commit message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostprocessResult {
    pub message: String,
    pub has_warning: bool,
    pub warning: Option<String>,
}

fn strip_markdown_fences(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.starts_with("```") {
        if let Some(first_newline) = trimmed.find('\n') {
            let rest = &trimmed[first_newline + 1..];
            if let Some(last_fence) = rest.rfind("```") {
                return rest[..last_fence].trim().to_string();
            }
        }
    }
    trimmed.to_string()
}

/// Postprocess LLM output: validate conventional format on first line, prefix `chore: ` if invalid,
/// strip trailing period on subject, clamp subject length to header_max_length, and preserve body.
pub fn postprocess_commit_message(
    raw_message: &str,
    header_max_length: Option<usize>,
    allowed_types: Option<&[String]>,
) -> PostprocessResult {
    let cleaned = strip_markdown_fences(raw_message);
    if cleaned.is_empty() {
        return PostprocessResult {
            message: "chore: empty commit".to_string(),
            has_warning: true,
            warning: Some(
                "Generated message was empty, defaulted to 'chore: empty commit'".to_string(),
            ),
        };
    }

    let mut lines: Vec<String> = cleaned.lines().map(|s| s.to_string()).collect();
    let mut subject = lines.remove(0).trim().to_string();

    let mut has_warning = false;
    let mut warning = None;

    // 1. Verify Conventional Commits syntax on first line
    let matches_conventional = if let Some(caps) = CONVENTIONAL_REGEX.captures(&subject) {
        if let Some(types) = allowed_types {
            let commit_type = &caps[1];
            types.iter().any(|t| t == commit_type)
        } else {
            true
        }
    } else {
        false
    };

    if !matches_conventional {
        subject = format!("chore: {subject}");
        has_warning = true;
        warning = Some(
            "First line did not match Conventional Commits format; prefixed with 'chore:'"
                .to_string(),
        );
    }

    // 2. Strip trailing period on subject
    if subject.ends_with('.') {
        subject = subject.trim_end_matches('.').to_string();
    }

    // 3. Cut subject > header-max-length
    let max_len = header_max_length.unwrap_or(72);
    if subject.chars().count() > max_len {
        subject = subject.chars().take(max_len).collect();
        // Avoid leaving a trailing period if truncation hit one
        if subject.ends_with('.') {
            subject = subject.trim_end_matches('.').to_string();
        }
    }

    // 4. Assemble final message: subject + blank line + body/footer
    // Remove leading blank lines from remaining lines
    while !lines.is_empty() && lines[0].trim().is_empty() {
        lines.remove(0);
    }

    let mut full_message = subject;
    if !lines.is_empty() {
        full_message.push_str("\n\n");
        full_message.push_str(&lines.join("\n"));
    }

    PostprocessResult {
        message: full_message,
        has_warning,
        warning,
    }
}
