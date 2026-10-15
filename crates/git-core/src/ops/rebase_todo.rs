use crate::error::GitError;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

/// Rebase action instruction for `git rebase -i`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum RebaseAction {
    Pick,
    Reword,
    Edit,
    Squash,
    Fixup,
    Drop,
    Exec,
    Break,
}

impl RebaseAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pick => "pick",
            Self::Reword => "reword",
            Self::Edit => "edit",
            Self::Squash => "squash",
            Self::Fixup => "fixup",
            Self::Drop => "drop",
            Self::Exec => "exec",
            Self::Break => "break",
        }
    }
}

impl FromStr for RebaseAction {
    type Err = GitError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "p" | "pick" => Ok(Self::Pick),
            "r" | "reword" => Ok(Self::Reword),
            "e" | "edit" => Ok(Self::Edit),
            "s" | "squash" => Ok(Self::Squash),
            "f" | "fixup" => Ok(Self::Fixup),
            "d" | "drop" => Ok(Self::Drop),
            "x" | "exec" => Ok(Self::Exec),
            "b" | "break" => Ok(Self::Break),
            other => Err(GitError::internal(format!(
                "Unknown rebase action: {other}"
            ))),
        }
    }
}

/// An entry in a `git rebase -i` todo file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RebaseTodoEntry {
    pub action: RebaseAction,
    pub sha: String,
    pub subject: String,
}

/// Parses a `git rebase -i` todo file, skipping comments and blank lines.
pub fn parse_rebase_todo(content: &str) -> Vec<RebaseTodoEntry> {
    let mut entries = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let mut parts = trimmed.split_whitespace();
        let action_str = match parts.next() {
            Some(a) => a,
            None => continue,
        };

        let action = match action_str.parse::<RebaseAction>() {
            Ok(a) => a,
            Err(_) => continue,
        };

        match action {
            RebaseAction::Break => {
                entries.push(RebaseTodoEntry {
                    action,
                    sha: String::new(),
                    subject: String::new(),
                });
            }
            RebaseAction::Exec => {
                let rest = trimmed
                    .strip_prefix(action_str)
                    .unwrap_or("")
                    .trim()
                    .to_string();
                entries.push(RebaseTodoEntry {
                    action,
                    sha: String::new(),
                    subject: rest,
                });
            }
            _ => {
                let sha = parts.next().unwrap_or("").to_string();
                let remainder = parts.collect::<Vec<_>>().join(" ");
                entries.push(RebaseTodoEntry {
                    action,
                    sha,
                    subject: remainder,
                });
            }
        }
    }

    entries
}

/// Serializes a list of rebase todo entries into standard git rebase todo file format.
pub fn serialize_rebase_todo(entries: &[RebaseTodoEntry]) -> String {
    let mut out = String::new();
    for entry in entries {
        match entry.action {
            RebaseAction::Break => {
                out.push_str("break\n");
            }
            RebaseAction::Exec => {
                if entry.subject.is_empty() {
                    out.push_str("exec\n");
                } else {
                    out.push_str(&format!("exec {}\n", entry.subject));
                }
            }
            _ => {
                if entry.subject.is_empty() {
                    out.push_str(&format!("{} {}\n", entry.action.as_str(), entry.sha));
                } else {
                    out.push_str(&format!(
                        "{} {} {}\n",
                        entry.action.as_str(),
                        entry.sha,
                        entry.subject
                    ));
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rebase_todo_parse_and_serialize_round_trip() {
        let input = "\
# Rebase 12345..67890 onto 12345
# Commands:
# p, pick <commit> = use commit
# r, reword <commit> = use commit but edit the commit message
# e, edit <commit> = use commit, but stop for amending
# s, squash <commit> = use commit, but meld into previous commit
# f, fixup <commit> = like \"squash\", but discard this commit's log message
# x, exec <command> = run command (the rest of the line) using shell
# b, break = stop here (continue rebase later with 'git rebase --continue')
# d, drop <commit> = remove commit

pick 1a2b3c4 initial commit
r 2b3c4d5 change message
edit 3c4d5e6 stop to edit
s 4d5e6f7 squash into previous
f 5e6f7a8 fixup previous
exec make test
break
d 6f7a8b9 dropped commit
";

        let entries = parse_rebase_todo(input);
        assert_eq!(entries.len(), 8);

        assert_eq!(entries[0].action, RebaseAction::Pick);
        assert_eq!(entries[0].sha, "1a2b3c4");
        assert_eq!(entries[0].subject, "initial commit");

        assert_eq!(entries[1].action, RebaseAction::Reword);
        assert_eq!(entries[1].sha, "2b3c4d5");

        assert_eq!(entries[2].action, RebaseAction::Edit);
        assert_eq!(entries[3].action, RebaseAction::Squash);
        assert_eq!(entries[4].action, RebaseAction::Fixup);

        assert_eq!(entries[5].action, RebaseAction::Exec);
        assert_eq!(entries[5].subject, "make test");

        assert_eq!(entries[6].action, RebaseAction::Break);

        assert_eq!(entries[7].action, RebaseAction::Drop);
        assert_eq!(entries[7].sha, "6f7a8b9");

        // Serialize and re-parse
        let serialized = serialize_rebase_todo(&entries);
        let round_tripped = parse_rebase_todo(&serialized);

        assert_eq!(entries, round_tripped);
    }
}
