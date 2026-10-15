use regex::Regex;
use std::sync::LazyLock;

static AWS_KEY_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b").expect("valid aws regex"));

static GITHUB_PAT_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bghp_[A-Za-z0-9_]{36,255}\b").expect("valid ghp regex"));

static GITHUB_FINE_PAT_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\bgithub_pat_[A-Za-z0-9_]{22,255}\b").expect("valid github_pat regex")
});

static GITLAB_PAT_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bglpat-[A-Za-z0-9_\-]{20,255}\b").expect("valid glpat regex"));

static SLACK_TOKEN_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\bxox[abpr]-[0-9A-Za-z\-]{10,255}\b").expect("valid slack regex")
});

static PRIVATE_KEY_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?s)-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----.*?-----END[ A-Z0-9_-]*PRIVATE KEY-----")
        .expect("valid private key regex")
});

static JWT_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")
        .expect("valid jwt regex")
});

static ENV_SECRET_LINE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)^([+-]?\s*(?:export\s+)?(?:[a-zA-Z0-9_]*(?:password|secret|api_key)[a-zA-Z0-9_]*)\s*=\s*)(.*)$"#,
    )
    .expect("valid env secret regex")
});

/// Redact known secrets (AWS keys, GitHub/GitLab tokens, Slack tokens, private keys, JWTs) from arbitrary text.
pub fn redact_text(input: &str) -> String {
    let mut out = PRIVATE_KEY_REGEX
        .replace_all(input, "[REDACTED]")
        .into_owned();
    out = AWS_KEY_REGEX.replace_all(&out, "[REDACTED]").into_owned();
    out = GITHUB_PAT_REGEX
        .replace_all(&out, "[REDACTED]")
        .into_owned();
    out = GITHUB_FINE_PAT_REGEX
        .replace_all(&out, "[REDACTED]")
        .into_owned();
    out = GITLAB_PAT_REGEX
        .replace_all(&out, "[REDACTED]")
        .into_owned();
    out = SLACK_TOKEN_REGEX
        .replace_all(&out, "[REDACTED]")
        .into_owned();
    out = JWT_REGEX.replace_all(&out, "[REDACTED]").into_owned();
    out
}

fn is_env_file_path(path: &str) -> bool {
    let p = path.trim();
    if let Some(file_name) = p.rsplit('/').next() {
        file_name.starts_with(".env")
    } else {
        p.starts_with(".env")
    }
}

/// Redact secrets from a unified git diff, including .env* sensitive keys (`password=`, `secret=`, `api_key=`).
pub fn redact_diff(diff: &str) -> String {
    // First, perform line-by-line check for .env files
    let mut lines = Vec::new();
    let mut in_env_file = false;

    for line in diff.lines() {
        if line.starts_with("diff --git ") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            let mut file_path = "";
            if parts.len() >= 4 {
                file_path = parts[3].strip_prefix("b/").unwrap_or(parts[3]);
            }
            in_env_file = is_env_file_path(file_path);
            lines.push(line.to_string());
            continue;
        }

        if in_env_file
            && (line.starts_with('+') || line.starts_with('-'))
            && !line.starts_with("+++")
            && !line.starts_with("---")
        {
            if let Some(caps) = ENV_SECRET_LINE_REGEX.captures(line) {
                let prefix = &caps[1];
                let val = caps[2].trim();
                let redacted_val = if (val.starts_with('"') && val.ends_with('"'))
                    || (val.starts_with('\'') && val.ends_with('\''))
                {
                    let quote = &val[..1];
                    format!("{quote}[REDACTED]{quote}")
                } else {
                    "[REDACTED]".to_string()
                };
                let redacted_line = format!("{prefix}{redacted_val}");
                lines.push(redacted_line);
                continue;
            }
        }

        lines.push(line.to_string());
    }

    let joined = lines.join("\n");
    // Apply global text redaction rules for tokens, keys, private keys, and JWTs
    redact_text(&joined)
}
