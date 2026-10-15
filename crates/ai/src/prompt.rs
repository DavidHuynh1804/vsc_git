use regex::Regex;
use serde::Deserialize;
use std::path::Path;
use std::sync::LazyLock;

static BRANCH_ISSUE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:^|/)(?:feat(?:ure)?|fix|bugfix|chore|refactor|hotfix)?(?:/|-)?([A-Za-z]+-\d+|\d+)(?:[/-]|$)")
        .expect("valid branch issue regex")
});

static TYPE_ENUM_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?s)['"]type-enum['"]\s*:\s*\[\s*\d+\s*,\s*['"][^'"]+['"]\s*,\s*\[([^\]]+)\]"#)
        .expect("valid type-enum regex")
});

static SCOPE_ENUM_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?s)['"]scope-enum['"]\s*:\s*\[\s*\d+\s*,\s*['"][^'"]+['"]\s*,\s*\[([^\]]+)\]"#)
        .expect("valid scope-enum regex")
});

static HEADER_MAX_LENGTH_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"['"]header-max-length['"]\s*:\s*\[\s*\d+\s*,\s*['"][^'"]+['"]\s*,\s*(\d+)\s*\]"#)
        .expect("valid header-max-length regex")
});

static STRING_LITERAL_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"['"]([^'"]+)['"]"#).expect("valid string literal regex"));

/// Constraints parsed from commitlint config or .vsc-git.json.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CommitConstraints {
    pub types: Option<Vec<String>>,
    pub scopes: Option<Vec<String>>,
    pub header_max_length: Option<usize>,
}

/// Extract issue tracking ID from branch name (e.g. `feat/ABC-123-foo` -> `ABC-123`, `fix/42` -> `42`).
pub fn extract_issue_from_branch(branch: &str) -> Option<String> {
    if let Some(caps) = BRANCH_ISSUE_REGEX.captures(branch) {
        if let Some(m) = caps.get(1) {
            let val = m.as_str().trim();
            if !val.is_empty() {
                return Some(val.to_string());
            }
        }
    }
    None
}

fn extract_string_array(block: &str) -> Vec<String> {
    STRING_LITERAL_REGEX
        .captures_iter(block)
        .filter_map(|c| c.get(1).map(|m| m.as_str().trim().to_string()))
        .filter(|s| !s.is_empty())
        .collect()
}

/// Parse commitlint constraints using regex for JS/CJS/MJS/TS files.
pub fn parse_commitlint_js_regex(content: &str) -> CommitConstraints {
    let mut constraints = CommitConstraints::default();

    if let Some(caps) = TYPE_ENUM_REGEX.captures(content) {
        if let Some(m) = caps.get(1) {
            let types = extract_string_array(m.as_str());
            if !types.is_empty() {
                constraints.types = Some(types);
            }
        }
    }

    if let Some(caps) = SCOPE_ENUM_REGEX.captures(content) {
        if let Some(m) = caps.get(1) {
            let scopes = extract_string_array(m.as_str());
            if !scopes.is_empty() {
                constraints.scopes = Some(scopes);
            }
        }
    }

    if let Some(caps) = HEADER_MAX_LENGTH_REGEX.captures(content) {
        if let Some(m) = caps.get(1) {
            if let Ok(len) = m.as_str().parse::<usize>() {
                constraints.header_max_length = Some(len);
            }
        }
    }

    constraints
}

/// Parse commitlint constraints from JSON content (.commitlintrc, .commitlintrc.json).
pub fn parse_commitlint_json(content: &str) -> CommitConstraints {
    let mut constraints = CommitConstraints::default();
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(content) {
        if let Some(rules) = val.get("rules").and_then(|r| r.as_object()) {
            if let Some(types) = rules
                .get("type-enum")
                .and_then(|arr| arr.get(2))
                .and_then(|v| v.as_array())
            {
                let list: Vec<String> = types
                    .iter()
                    .filter_map(|t| t.as_str().map(|s| s.to_string()))
                    .collect();
                if !list.is_empty() {
                    constraints.types = Some(list);
                }
            }
            if let Some(scopes) = rules
                .get("scope-enum")
                .and_then(|arr| arr.get(2))
                .and_then(|v| v.as_array())
            {
                let list: Vec<String> = scopes
                    .iter()
                    .filter_map(|t| t.as_str().map(|s| s.to_string()))
                    .collect();
                if !list.is_empty() {
                    constraints.scopes = Some(list);
                }
            }
            if let Some(max_len) = rules
                .get("header-max-length")
                .and_then(|arr| arr.get(2))
                .and_then(|v| v.as_u64())
            {
                constraints.header_max_length = Some(max_len as usize);
            }
        }
    }
    constraints
}

/// Parse commitlint constraints from YAML content (.commitlintrc.yaml, .commitlintrc.yml).
pub fn parse_commitlint_yaml(content: &str) -> CommitConstraints {
    let mut constraints = CommitConstraints::default();
    if let Ok(val) = serde_yaml::from_str::<serde_yaml::Value>(content) {
        if let Some(rules) = val.get("rules").and_then(|r| r.as_mapping()) {
            let type_key = serde_yaml::Value::String("type-enum".to_string());
            if let Some(arr) = rules.get(&type_key).and_then(|v| v.as_sequence()) {
                if let Some(types) = arr.get(2).and_then(|v| v.as_sequence()) {
                    let list: Vec<String> = types
                        .iter()
                        .filter_map(|t| t.as_str().map(|s| s.to_string()))
                        .collect();
                    if !list.is_empty() {
                        constraints.types = Some(list);
                    }
                }
            }
            let scope_key = serde_yaml::Value::String("scope-enum".to_string());
            if let Some(arr) = rules.get(&scope_key).and_then(|v| v.as_sequence()) {
                if let Some(scopes) = arr.get(2).and_then(|v| v.as_sequence()) {
                    let list: Vec<String> = scopes
                        .iter()
                        .filter_map(|t| t.as_str().map(|s| s.to_string()))
                        .collect();
                    if !list.is_empty() {
                        constraints.scopes = Some(list);
                    }
                }
            }
            let len_key = serde_yaml::Value::String("header-max-length".to_string());
            if let Some(arr) = rules.get(&len_key).and_then(|v| v.as_sequence()) {
                if let Some(max_len) = arr.get(2).and_then(|v| v.as_u64()) {
                    constraints.header_max_length = Some(max_len as usize);
                }
            }
        }
    }
    constraints
}

#[derive(Deserialize)]
struct VscGitConfig {
    #[serde(default)]
    commit: Option<VscGitCommitConfig>,
}

#[derive(Deserialize)]
struct VscGitCommitConfig {
    #[serde(default)]
    types: Option<Vec<String>>,
    #[serde(default)]
    scopes: Option<Vec<String>>,
}

/// Parse .vsc-git.json config file.
pub fn parse_vsc_git_json(content: &str) -> CommitConstraints {
    let mut constraints = CommitConstraints::default();
    if let Ok(cfg) = serde_json::from_str::<VscGitConfig>(content) {
        if let Some(commit) = cfg.commit {
            constraints.types = commit.types;
            constraints.scopes = commit.scopes;
        }
    }
    constraints
}

/// Load and merge repo constraints from commitlint configs and .vsc-git.json.
pub fn load_repo_constraints(repo_root: &Path) -> CommitConstraints {
    let mut merged = CommitConstraints::default();

    // 1. Check JS/TS commitlint files
    for name in &[
        "commitlint.config.js",
        "commitlint.config.cjs",
        "commitlint.config.mjs",
        "commitlint.config.ts",
    ] {
        let p = repo_root.join(name);
        if let Ok(content) = std::fs::read_to_string(p) {
            let c = parse_commitlint_js_regex(&content);
            merge_constraints(&mut merged, c);
            break;
        }
    }

    // 2. Check JSON commitlint files
    for name in &[".commitlintrc", ".commitlintrc.json"] {
        let p = repo_root.join(name);
        if let Ok(content) = std::fs::read_to_string(p) {
            let c = parse_commitlint_json(&content);
            merge_constraints(&mut merged, c);
            break;
        }
    }

    // 3. Check YAML commitlint files
    for name in &[".commitlintrc.yaml", ".commitlintrc.yml"] {
        let p = repo_root.join(name);
        if let Ok(content) = std::fs::read_to_string(p) {
            let c = parse_commitlint_yaml(&content);
            merge_constraints(&mut merged, c);
            break;
        }
    }

    // 4. Check .vsc-git.json
    let vsc_path = repo_root.join(".vsc-git.json");
    if let Ok(content) = std::fs::read_to_string(vsc_path) {
        let c = parse_vsc_git_json(&content);
        merge_constraints(&mut merged, c);
    }

    merged
}

fn merge_constraints(dest: &mut CommitConstraints, src: CommitConstraints) {
    if dest.types.is_none() && src.types.is_some() {
        dest.types = src.types;
    }
    if dest.scopes.is_none() && src.scopes.is_some() {
        dest.scopes = src.scopes;
    }
    if dest.header_max_length.is_none() && src.header_max_length.is_some() {
        dest.header_max_length = src.header_max_length;
    }
}

/// Detect language: if "auto", check last 10 commit subjects for Vietnamese text/diacritics.
pub fn resolve_language(configured_lang: &str, recent_commits: &[String]) -> &'static str {
    match configured_lang {
        "en" => "en",
        "vi" => "vi",
        _ => {
            // "auto" detection
            for commit in recent_commits.iter().take(10) {
                if has_vietnamese_diacritics(commit) {
                    return "vi";
                }
            }
            "en"
        }
    }
}

fn has_vietnamese_diacritics(text: &str) -> bool {
    let lower = text.to_lowercase();
    const VI_CHARS: &str = "àáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ";
    lower.chars().any(|c| VI_CHARS.contains(c))
}

/// Prompt input data for commit message generation.
#[derive(Debug, Clone)]
pub struct CommitPromptInput<'a> {
    pub staged_diff: &'a str,
    pub staged_files: &'a [String],
    pub branch_name: Option<&'a str>,
    pub recent_commits: &'a [String],
    pub constraints: &'a CommitConstraints,
    pub language: &'a str,
}

/// Build system and user prompt for generating a Conventional Commit message.
pub fn build_commit_prompt(input: CommitPromptInput<'_>) -> (String, String) {
    let lang = resolve_language(input.language, input.recent_commits);
    let max_len = input.constraints.header_max_length.unwrap_or(72);

    let mut rules = Vec::new();
    rules.push(
        "Format: Conventional Commits '<type>(<scope>): <subject>' or '<type>: <subject>'"
            .to_string(),
    );
    rules.push(format!(
        "Header max length: {max_len} characters, imperative mood, lowercase, NO trailing period"
    ));
    rules.push("Blank line between subject and body".to_string());
    rules.push(
        "Body explains what and why with concise bullet points if multiple changes".to_string(),
    );
    rules.push("If breaking change, include 'BREAKING CHANGE: <reason>' in footer".to_string());

    if let Some(branch) = input.branch_name {
        if let Some(issue) = extract_issue_from_branch(branch) {
            rules.push(format!("Include footer 'Refs: {issue}'"));
        }
    }

    if let Some(types) = &input.constraints.types {
        rules.push(format!("Allowed types: {}", types.join(", ")));
    }
    if let Some(scopes) = &input.constraints.scopes {
        rules.push(format!("Allowed scopes: {}", scopes.join(", ")));
    }

    let lang_instruction = if lang == "vi" {
        "Ngôn ngữ: Viết subject và body bằng tiếng Việt."
    } else {
        "Language: Write subject and body in English."
    };

    let system_prompt = format!(
        "You are an expert Git commit generator.\n{}\n{}\nStrictly output ONLY the commit message text. No markdown fences, no greetings, no conversational commentary.",
        rules.iter().map(|r| format!("- {r}")).collect::<Vec<_>>().join("\n"),
        lang_instruction
    );

    let mut user_content = String::new();
    if let Some(branch) = input.branch_name {
        user_content.push_str(&format!("Branch: {branch}\n"));
    }
    if !input.staged_files.is_empty() {
        user_content.push_str("Staged files:\n");
        for f in input.staged_files {
            user_content.push_str(&format!("- {f}\n"));
        }
    }
    if !input.recent_commits.is_empty() {
        user_content.push_str("Recent commit style:\n");
        for c in input.recent_commits.iter().take(10) {
            user_content.push_str(&format!("- {c}\n"));
        }
    }
    user_content.push_str("\nStaged diff:\n");
    user_content.push_str(input.staged_diff);

    (system_prompt, user_content)
}

/// Build prompt for PR / MR title and description.
pub fn build_pr_prompt(
    base_branch: &str,
    head_branch: &str,
    commit_log: &[String],
    diff_summary: &str,
    language: &str,
) -> (String, String) {
    let lang = resolve_language(language, commit_log);
    let lang_instruction = if lang == "vi" {
        "Viết bằng tiếng Việt."
    } else {
        "Write in English."
    };

    let system_prompt = format!(
        "You are an expert GitHub/GitLab pull request author.\n\
        Output format:\n\
        Line 1: PR Title (Conventional Commits)\n\
        Line 2: (blank)\n\
        Line 3+: PR Description (Summary, Changes, Verification notes)\n\
        {}\n\
        Strictly output only title and description without markdown wrapper fences.",
        lang_instruction
    );

    let mut user_prompt = format!("Base: {base_branch}\nHead: {head_branch}\n\nCommits:\n");
    for c in commit_log {
        user_prompt.push_str(&format!("- {c}\n"));
    }
    user_prompt.push_str("\nDiff summary:\n");
    user_prompt.push_str(diff_summary);

    (system_prompt, user_prompt)
}

/// Build prompt for "Explain commit" feature in git graph.
pub fn build_explain_commit_prompt(
    commit_sha: &str,
    subject: &str,
    body: Option<&str>,
    diff: &str,
    language: &str,
) -> (String, String) {
    let recent = vec![subject.to_string()];
    let lang = resolve_language(language, &recent);
    let lang_instruction = if lang == "vi" {
        "Giải thích bằng tiếng Việt dễ hiểu."
    } else {
        "Explain in clear English."
    };

    let system_prompt = format!(
        "You are an expert software engineer explaining git commits.\n\
        Explain clearly what changes this commit introduces, why they were made, and potential impacts.\n\
        {}",
        lang_instruction
    );

    let mut user_prompt = format!("Commit: {commit_sha}\nSubject: {subject}\n");
    if let Some(b) = body {
        user_prompt.push_str(&format!("Body:\n{b}\n"));
    }
    user_prompt.push_str("\nDiff:\n");
    user_prompt.push_str(diff);

    (system_prompt, user_prompt)
}
