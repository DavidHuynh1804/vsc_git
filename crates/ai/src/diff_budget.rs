use globset::{Glob, GlobSet, GlobSetBuilder};

/// Options controlling diff budget and exclusion rules.
#[derive(Debug, Clone)]
pub struct DiffBudgetOptions {
    pub max_tokens: usize,
    pub exclude_globs: Vec<String>,
}

impl Default for DiffBudgetOptions {
    fn default() -> Self {
        Self {
            max_tokens: 20_000,
            exclude_globs: vec![
                "**/*.lock".to_string(),
                "**/package-lock.json".to_string(),
                "**/pnpm-lock.yaml".to_string(),
                "**/yarn.lock".to_string(),
                "**/Cargo.lock".to_string(),
                "**/go.sum".to_string(),
                "**/poetry.lock".to_string(),
                "**/*.min.*".to_string(),
                "dist/**".to_string(),
                "build/**".to_string(),
                "**/dist/**".to_string(),
                "**/build/**".to_string(),
            ],
        }
    }
}

/// Metadata for a staged file passed to diff budgeting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StagedFileInput {
    pub path: String,
    pub is_binary: bool,
    pub is_linguist_generated: bool,
}

impl StagedFileInput {
    pub fn new(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            is_binary: false,
            is_linguist_generated: false,
        }
    }

    pub fn binary(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            is_binary: true,
            is_linguist_generated: false,
        }
    }

    pub fn linguist_generated(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            is_binary: false,
            is_linguist_generated: true,
        }
    }
}

impl<T: Into<String>> From<T> for StagedFileInput {
    fn from(path: T) -> Self {
        Self::new(path)
    }
}

/// Estimate token count for a text string using characters / 3.5 heuristic.
pub fn estimate_tokens(text: &str) -> usize {
    ((text.chars().count() as f64) / 3.5).ceil() as usize
}

#[derive(Debug, Clone)]
struct ParsedHunk {
    header: String,
    lines: Vec<String>,
}

#[derive(Debug, Clone)]
struct ParsedFileDiff {
    path: String,
    header_lines: Vec<String>,
    is_binary: bool,
    hunks: Vec<ParsedHunk>,
    additions: usize,
    deletions: usize,
}

fn parse_file_diffs(raw_diff: &str) -> Vec<ParsedFileDiff> {
    let mut files = Vec::new();
    let lines: Vec<&str> = raw_diff.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        if line.starts_with("diff --git ") {
            let mut header_lines = vec![line.to_string()];
            let mut path = String::new();

            // Extract b/ path from "diff --git a/foo b/foo"
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 4 {
                if let Some(p) = parts[3].strip_prefix("b/") {
                    path = p.to_string();
                } else {
                    path = parts[3].to_string();
                }
            }

            i += 1;
            let mut is_binary = false;
            let mut hunks = Vec::new();
            let mut current_hunk: Option<ParsedHunk> = None;
            let mut additions = 0;
            let mut deletions = 0;

            while i < lines.len() && !lines[i].starts_with("diff --git ") {
                let sub_line = lines[i];

                if sub_line.starts_with("--- ") || sub_line.starts_with("+++ ") {
                    if path.is_empty() && sub_line.starts_with("+++ b/") {
                        path = sub_line["+++ b/".len()..].to_string();
                    }
                    header_lines.push(sub_line.to_string());
                    i += 1;
                    continue;
                }

                if sub_line.contains("Binary files ") || sub_line.starts_with("GIT binary patch") {
                    is_binary = true;
                    header_lines.push(sub_line.to_string());
                    i += 1;
                    continue;
                }

                if sub_line.starts_with("@@ ") {
                    if let Some(h) = current_hunk.take() {
                        hunks.push(h);
                    }
                    current_hunk = Some(ParsedHunk {
                        header: sub_line.to_string(),
                        lines: Vec::new(),
                    });
                    i += 1;
                    continue;
                }

                if let Some(ref mut hunk) = current_hunk {
                    if sub_line.starts_with('+') && !sub_line.starts_with("+++") {
                        additions += 1;
                    } else if sub_line.starts_with('-') && !sub_line.starts_with("---") {
                        deletions += 1;
                    }
                    hunk.lines.push(sub_line.to_string());
                } else {
                    header_lines.push(sub_line.to_string());
                }

                i += 1;
            }

            if let Some(h) = current_hunk {
                hunks.push(h);
            }

            files.push(ParsedFileDiff {
                path,
                header_lines,
                is_binary,
                hunks,
                additions,
                deletions,
            });
        } else {
            i += 1;
        }
    }

    files
}

fn build_glob_matcher(patterns: &[String]) -> Option<GlobSet> {
    let mut builder = GlobSetBuilder::new();
    for pat in patterns {
        if let Ok(glob) = Glob::new(pat) {
            builder.add(glob);
        }
    }
    builder.build().ok()
}

/// Parse `.gitattributes` content to find files marked `linguist-generated`.
pub fn parse_gitattributes_generated(gitattributes_content: &str) -> Vec<String> {
    let mut patterns = Vec::new();
    for line in gitattributes_content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() >= 2 {
            for attr in &parts[1..] {
                if *attr == "linguist-generated" || *attr == "linguist-generated=true" {
                    patterns.push(parts[0].to_string());
                    break;
                }
            }
        }
    }
    patterns
}

/// Budget a staged unified diff by filtering excluded files and truncating to token budget.
pub fn apply_diff_budget(
    unified_diff: &str,
    staged_files: &[StagedFileInput],
    options: &DiffBudgetOptions,
) -> String {
    let file_diffs = parse_file_diffs(unified_diff);
    let glob_matcher = build_glob_matcher(&options.exclude_globs);

    let max_chars = (options.max_tokens as f64 * 3.5).floor() as usize;

    let mut staged_map: std::collections::HashMap<&str, &StagedFileInput> =
        std::collections::HashMap::new();
    for f in staged_files {
        staged_map.insert(&f.path, f);
    }

    // Step 1: Render each file diff, stripping content of excluded files
    let mut processed_files = Vec::new();

    for file in &file_diffs {
        let is_excluded_glob = glob_matcher
            .as_ref()
            .map(|m| m.is_match(&file.path))
            .unwrap_or(false);

        let input_meta = staged_map.get(file.path.as_str());
        let is_binary = file.is_binary || input_meta.map(|m| m.is_binary).unwrap_or(false);
        let is_generated = input_meta.map(|m| m.is_linguist_generated).unwrap_or(false);

        let is_excluded = is_excluded_glob || is_binary || is_generated;

        processed_files.push((file, is_excluded));
    }

    // Build the full filtered diff text to see if it fits within token budget
    let mut full_output = String::new();
    for (file, is_excluded) in &processed_files {
        if !full_output.is_empty() {
            full_output.push('\n');
        }
        full_output.push_str(&file.header_lines.join("\n"));
        full_output.push('\n');

        if *is_excluded {
            full_output.push_str(&format!(
                "[{} (content excluded: lock/minified/generated/binary)]\n",
                file.path
            ));
        } else {
            for hunk in &file.hunks {
                full_output.push_str(&hunk.header);
                full_output.push('\n');
                for line in &hunk.lines {
                    full_output.push_str(line);
                    full_output.push('\n');
                }
            }
        }
    }

    if estimate_tokens(&full_output) <= options.max_tokens {
        return full_output;
    }

    // Step 2: Diff exceeds budget -> for each file keep header + stats +/- + initial hunks
    let mut truncated_output = String::new();
    let mut is_truncated = false;

    for (file, is_excluded) in &processed_files {
        let mut file_buf = String::new();
        if !truncated_output.is_empty() {
            file_buf.push('\n');
        }
        file_buf.push_str(&file.header_lines.join("\n"));
        file_buf.push('\n');
        file_buf.push_str(&format!(
            "# stats: +{} -{} lines\n",
            file.additions, file.deletions
        ));

        if *is_excluded {
            file_buf.push_str(&format!(
                "[{} (content excluded: lock/minified/generated/binary)]\n",
                file.path
            ));
            if truncated_output.len() + file_buf.len() <= max_chars {
                truncated_output.push_str(&file_buf);
            } else {
                is_truncated = true;
                break;
            }
        } else {
            let mut file_hunk_omitted = false;
            for (idx, hunk) in file.hunks.iter().enumerate() {
                let mut hunk_str = String::new();
                hunk_str.push_str(&hunk.header);
                hunk_str.push('\n');
                for line in &hunk.lines {
                    hunk_str.push_str(line);
                    hunk_str.push('\n');
                }

                if idx == 0 || truncated_output.len() + file_buf.len() + hunk_str.len() <= max_chars
                {
                    file_buf.push_str(&hunk_str);
                } else {
                    file_hunk_omitted = true;
                    is_truncated = true;
                    break;
                }
            }

            if file_hunk_omitted {
                file_buf.push_str("(truncated)\n");
            }

            if truncated_output.len() + file_buf.len() <= max_chars {
                truncated_output.push_str(&file_buf);
            } else {
                // If even adding this file exceeds max_chars, take as much as possible
                let remaining = max_chars.saturating_sub(truncated_output.len());
                if remaining > 50 {
                    let slice = &file_buf[..remaining.min(file_buf.len())];
                    truncated_output.push_str(slice);
                    truncated_output.push_str("\n(truncated)\n");
                }
                is_truncated = true;
                break;
            }
        }
    }

    if is_truncated && !truncated_output.ends_with("(truncated)\n") {
        truncated_output.push_str("\n(truncated)\n");
    }

    truncated_output
}
