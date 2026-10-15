use crate::cli::{CommandOptions, GitCli};
use crate::error::GitError;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Operational mode for applying range patches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ApplyMode {
    Stage,
    Unstage,
    Revert,
}

/// Inclusive line range (1-based index) in file coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct LineRange {
    pub start: u32,
    pub end: u32,
}

impl LineRange {
    pub fn new(start: u32, end: u32) -> Self {
        Self { start, end }
    }

    pub fn contains(&self, line: u32) -> bool {
        self.start <= line && line <= self.end
    }
}

#[derive(Debug, Clone)]
struct HunkLine {
    raw: String,
    line_type: char,
    no_newline: bool,
}

/// Parse unified diff header `@@ -old_start[,old_count] +new_start[,new_count] @@[ suffix]`
fn parse_hunk_header(line: &str) -> Option<(u32, u32, u32, u32, String)> {
    let trimmed = line.trim_start();
    if !trimmed.starts_with("@@") {
        return None;
    }
    let rest = trimmed[2..].trim_start();
    let end_idx = rest.find("@@")?;
    let ranges_part = rest[..end_idx].trim();
    let suffix = rest[end_idx + 2..].to_string();

    let mut parts = ranges_part.split_whitespace();
    let old_part = parts.next()?.strip_prefix('-')?;
    let new_part = parts.next()?.strip_prefix('+')?;

    let (old_start, old_count) = parse_coord(old_part)?;
    let (new_start, new_count) = parse_coord(new_part)?;

    Some((old_start, old_count, new_start, new_count, suffix))
}

fn parse_coord(s: &str) -> Option<(u32, u32)> {
    if let Some((start_s, count_s)) = s.split_once(',') {
        Some((start_s.parse().ok()?, count_s.parse().ok()?))
    } else {
        Some((s.parse().ok()?, 1))
    }
}

/// Build a unified diff patch targeting only the specified line ranges.
///
/// Preserves CRLF line endings, handles `\ No newline at end of file`,
/// converts unselected deletions into context lines, drops unselected additions,
/// and recalculates hunk headers with cumulative line offsets.
pub fn build_range_patch(diff_content: &str, ranges: &[LineRange]) -> Option<String> {
    if diff_content.is_empty() || ranges.is_empty() {
        return None;
    }

    let mut preamble = Vec::new();
    let mut hunks_raw = Vec::new();

    let mut current_hunk: Option<Vec<String>> = None;
    for line in diff_content.lines() {
        if line.starts_with("@@") {
            if let Some(hunk) = current_hunk.take() {
                hunks_raw.push(hunk);
            }
            current_hunk = Some(vec![line.to_string()]);
        } else if let Some(hunk) = &mut current_hunk {
            hunk.push(line.to_string());
        } else {
            preamble.push(line.to_string());
        }
    }
    if let Some(hunk) = current_hunk {
        hunks_raw.push(hunk);
    }

    if hunks_raw.is_empty() {
        return None;
    }

    let mut processed_hunks = Vec::new();
    let mut cumulative_offset: i64 = 0;

    for raw_lines in hunks_raw {
        if raw_lines.is_empty() {
            continue;
        }

        let header_line = &raw_lines[0];
        let Some((old_start, old_count, new_start, _new_count, suffix)) =
            parse_hunk_header(header_line)
        else {
            continue;
        };

        // Group lines and detect \ No newline at end of file
        let mut parsed_lines: Vec<HunkLine> = Vec::new();
        for l in &raw_lines[1..] {
            if l.starts_with(r"\ No newline") {
                if let Some(prev) = parsed_lines.last_mut() {
                    prev.no_newline = true;
                }
            } else {
                let first_char = l.chars().next().unwrap_or(' ');
                parsed_lines.push(HunkLine {
                    raw: l.clone(),
                    line_type: first_char,
                    no_newline: false,
                });
            }
        }

        let total_plus = parsed_lines.iter().filter(|l| l.line_type == '+').count() as u32;

        let mut curr_plus: u32 = 0;
        let mut curr_minus: u32 = 0;

        let mut new_lines = Vec::new();
        let mut kept_old_count: u32 = 0;
        let mut kept_new_count: u32 = 0;
        let mut has_changes = false;

        for line in parsed_lines {
            match line.line_type {
                '+' => {
                    let new_line_no = new_start + curr_plus;
                    curr_plus += 1;
                    let is_selected = ranges.iter().any(|r| r.contains(new_line_no));
                    if is_selected {
                        new_lines.push(line.raw.clone());
                        if line.no_newline {
                            new_lines.push(r"\ No newline at end of file".to_string());
                        }
                        kept_new_count += 1;
                        has_changes = true;
                    }
                }
                '-' => {
                    let old_line_no = old_start + curr_minus;
                    let right_coord = if total_plus > 0 {
                        if curr_minus < total_plus {
                            new_start + curr_minus
                        } else {
                            new_start + total_plus - 1
                        }
                    } else if new_start == 0 {
                        1
                    } else {
                        new_start
                    };
                    curr_minus += 1;

                    let is_selected = ranges
                        .iter()
                        .any(|r| r.contains(old_line_no) || r.contains(right_coord));

                    if is_selected {
                        new_lines.push(line.raw.clone());
                        if line.no_newline {
                            new_lines.push(r"\ No newline at end of file".to_string());
                        }
                        kept_old_count += 1;
                        has_changes = true;
                    } else {
                        // Unselected deletion turns into context line
                        let mut ctx = line.raw.clone();
                        if ctx.starts_with('-') {
                            ctx.replace_range(0..1, " ");
                        }
                        new_lines.push(ctx);
                        if line.no_newline {
                            new_lines.push(r"\ No newline at end of file".to_string());
                        }
                        kept_old_count += 1;
                        kept_new_count += 1;
                    }
                }
                ' ' => {
                    new_lines.push(line.raw.clone());
                    if line.no_newline {
                        new_lines.push(r"\ No newline at end of file".to_string());
                    }
                    kept_old_count += 1;
                    kept_new_count += 1;
                }
                _ => {}
            }
        }

        if !has_changes {
            continue;
        }

        let new_old_start = old_start;
        let new_new_start = if kept_new_count == 0 {
            if old_start <= 1 {
                0
            } else {
                (old_start as i64 - 1 + cumulative_offset).max(0) as u32
            }
        } else if old_count == 0 {
            (old_start as i64 + 1 + cumulative_offset).max(1) as u32
        } else {
            (old_start as i64 + cumulative_offset).max(1) as u32
        };

        let new_header = format!(
            "@@ -{new_old_start},{kept_old_count} +{new_new_start},{kept_new_count} @@{suffix}"
        );
        cumulative_offset += kept_new_count as i64 - kept_old_count as i64;

        processed_hunks.push((new_header, new_lines));
    }

    if processed_hunks.is_empty() {
        return None;
    }

    let mut output = String::new();
    for p in preamble {
        output.push_str(&p);
        output.push('\n');
    }
    for (header, lines) in processed_hunks {
        output.push_str(&header);
        output.push('\n');
        for l in lines {
            output.push_str(&l);
            output.push('\n');
        }
    }

    Some(output)
}

/// Apply line ranges for a file using git apply.
pub fn apply_ranges<P: AsRef<Path>>(
    cli: &GitCli,
    repo_path: &Path,
    path: P,
    ranges: &[LineRange],
    mode: ApplyMode,
) -> Result<(), GitError> {
    if ranges.is_empty() {
        return Ok(());
    }

    let path_ref = path.as_ref();
    let path_str = path_ref.to_string_lossy();

    // 1. Obtain unified diff with -U0
    let diff_output = match mode {
        ApplyMode::Unstage => {
            let out = cli.exec(
                repo_path,
                &["diff", "--cached", "-U0", "--", &path_str],
                CommandOptions::read_only(),
            )?;
            out.stdout_lossy()
        }
        ApplyMode::Stage | ApplyMode::Revert => {
            let out = cli.exec(
                repo_path,
                &["diff", "-U0", "--", &path_str],
                CommandOptions::read_only(),
            )?;
            let stdout = out.stdout_lossy();
            if stdout.trim().is_empty() {
                // If diff is empty, check if intent-to-add is needed for untracked file
                let _ = cli.exec_raw(
                    repo_path,
                    &["add", "-N", "--", &path_str],
                    CommandOptions::default(),
                );
                let out_retry = cli.exec(
                    repo_path,
                    &["diff", "-U0", "--", &path_str],
                    CommandOptions::read_only(),
                )?;
                out_retry.stdout_lossy()
            } else {
                stdout
            }
        }
    };

    if diff_output.trim().is_empty() {
        return Ok(());
    }

    // 2. Build filtered patch for selected ranges
    let Some(patch) = build_range_patch(&diff_output, ranges) else {
        return Ok(());
    };

    // 3. Execute git apply
    let apply_args: Vec<&str> = match mode {
        ApplyMode::Stage => vec![
            "apply",
            "--cached",
            "--unidiff-zero",
            "--whitespace=nowarn",
            "-",
        ],
        ApplyMode::Unstage => vec!["apply", "--cached", "-R", "--unidiff-zero", "-"],
        ApplyMode::Revert => vec!["apply", "-R", "--unidiff-zero", "-"],
    };

    let result = cli.exec_raw(
        repo_path,
        &apply_args,
        CommandOptions::default().with_stdin(patch.into_bytes()),
    )?;

    if result.exit_code != 0 {
        return Err(GitError::patch_failed(
            format!("Failed to apply patch ranges for {}", path_str),
            Some(result.stderr),
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_patch_single_line_addition() {
        let diff = r#"diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,0 +2,2 @@
+line2
+line3
"#;
        // Select only line 2 (line2)
        let patch = build_range_patch(diff, &[LineRange::new(2, 2)]).unwrap();
        assert!(patch.contains("+line2"));
        assert!(!patch.contains("+line3"));
        assert!(patch.contains("@@ -1,0 +2,1 @@"));
    }

    #[test]
    fn test_patch_single_line_deletion() {
        let diff = r#"diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -2,2 +1,0 @@
-del1
-del2
"#;
        // Select only deletion of del1 (line 2 in old file)
        let patch = build_range_patch(diff, &[LineRange::new(2, 2)]).unwrap();
        assert!(patch.contains("-del1"));
        assert!(patch.contains(" del2")); // del2 turned to context
        assert!(patch.contains("@@ -2,2 +2,1 @@"));
    }

    #[test]
    fn test_patch_adjacent_hunks() {
        let diff = r#"diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -2,1 +2,2 @@
-old2
+new2_a
+new2_b
@@ -4,1 +5,1 @@
-old4
+new4
"#;
        // Select only hunk 2 (line 5 in new file coordinates)
        let patch = build_range_patch(diff, &[LineRange::new(5, 5)]).unwrap();
        assert!(!patch.contains("new2_a"));
        assert!(patch.contains("-old4"));
        assert!(patch.contains("+new4"));
        // Since hunk 1 was skipped, cumulative offset is 0, so old 4 maps to new 4
        assert!(patch.contains("@@ -4,1 +4,1 @@"));
    }

    #[test]
    fn test_patch_crlf_preservation() {
        let diff = "diff --git a/file.txt b/file.txt\r\n--- a/file.txt\r\n+++ b/file.txt\r\n@@ -1,0 +2,1 @@\r\n+crlf_line\r\n";
        let patch = build_range_patch(diff, &[LineRange::new(2, 2)]).unwrap();
        assert!(patch.contains("+crlf_line"));
    }

    #[test]
    fn test_patch_no_newline_at_eof() {
        let diff = "diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1,1 +1,2 @@\n-old_eof\n\\ No newline at end of file\n+new_eof\n\\ No newline at end of file\n+extra\n";
        // Select only new_eof (line 1)
        let patch = build_range_patch(diff, &[LineRange::new(1, 1)]).unwrap();
        assert!(patch.contains("-old_eof"));
        assert!(patch.contains("+new_eof"));
        assert!(patch.contains("\\ No newline at end of file"));
        assert!(!patch.contains("+extra"));
    }

    #[test]
    fn test_patch_partial_modified_hunk() {
        let diff = r#"diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -5,2 +5,2 @@
-mod1_old
-mod2_old
+mod1_new
+mod2_new
"#;
        // Select only mod2_new (line 6 in new file)
        let patch = build_range_patch(diff, &[LineRange::new(6, 6)]).unwrap();
        // mod1_old should become context
        assert!(patch.contains(" mod1_old"));
        // mod1_new dropped
        assert!(!patch.contains("+mod1_new"));
        // mod2_old deleted
        assert!(patch.contains("-mod2_old"));
        // mod2_new added
        assert!(patch.contains("+mod2_new"));
    }
}
