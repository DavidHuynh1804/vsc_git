use ai::{
    build_commit_prompt, build_explain_commit_prompt, build_pr_prompt, extract_issue_from_branch,
    load_repo_constraints, parse_commitlint_js_regex, parse_commitlint_json, parse_commitlint_yaml,
    parse_vsc_git_json, resolve_language, CommitConstraints, CommitPromptInput,
};
use tempfile::tempdir;

#[test]
fn test_extract_issue_from_branch() {
    assert_eq!(
        extract_issue_from_branch("feat/ABC-123-login-form"),
        Some("ABC-123".to_string())
    );
    assert_eq!(
        extract_issue_from_branch("fix/42-crash-on-boot"),
        Some("42".to_string())
    );
    assert_eq!(
        extract_issue_from_branch("feature/CORE-999"),
        Some("CORE-999".to_string())
    );
    assert_eq!(extract_issue_from_branch("main"), None);
    assert_eq!(extract_issue_from_branch("feat/no-issue-number"), None);
}

#[test]
fn test_parse_commitlint_js_regex() {
    let js_content = r#"
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'docs', 'chore']],
    'scope-enum': [2, 'always', ['core', 'ui', 'ai']],
    'header-max-length': [2, 'always', 64],
  },
};
"#;

    let c = parse_commitlint_js_regex(js_content);
    assert_eq!(
        c.types,
        Some(vec![
            "feat".to_string(),
            "fix".to_string(),
            "docs".to_string(),
            "chore".to_string()
        ])
    );
    assert_eq!(
        c.scopes,
        Some(vec!["core".to_string(), "ui".to_string(), "ai".to_string()])
    );
    assert_eq!(c.header_max_length, Some(64));
}

#[test]
fn test_parse_commitlint_json() {
    let json_content = r#"{
  "rules": {
    "type-enum": [2, "always", ["feat", "fix", "refactor"]],
    "scope-enum": [2, "always", ["api", "cli"]],
    "header-max-length": [2, "always", 80]
  }
}"#;

    let c = parse_commitlint_json(json_content);
    assert_eq!(
        c.types,
        Some(vec![
            "feat".to_string(),
            "fix".to_string(),
            "refactor".to_string()
        ])
    );
    assert_eq!(c.scopes, Some(vec!["api".to_string(), "cli".to_string()]));
    assert_eq!(c.header_max_length, Some(80));
}

#[test]
fn test_parse_commitlint_yaml() {
    let yaml_content = r#"
rules:
  type-enum:
    - 2
    - always
    - - feat
      - fix
      - test
  scope-enum:
    - 2
    - always
    - - auth
      - db
  header-max-length:
    - 2
    - always
    - 90
"#;

    let c = parse_commitlint_yaml(yaml_content);
    assert_eq!(
        c.types,
        Some(vec![
            "feat".to_string(),
            "fix".to_string(),
            "test".to_string()
        ])
    );
    assert_eq!(c.scopes, Some(vec!["auth".to_string(), "db".to_string()]));
    assert_eq!(c.header_max_length, Some(90));
}

#[test]
fn test_parse_vsc_git_json() {
    let vsc_content = r#"{
  "commit": {
    "types": ["feat", "fix", "perf"],
    "scopes": ["graph", "core"]
  }
}"#;

    let c = parse_vsc_git_json(vsc_content);
    assert_eq!(
        c.types,
        Some(vec![
            "feat".to_string(),
            "fix".to_string(),
            "perf".to_string()
        ])
    );
    assert_eq!(
        c.scopes,
        Some(vec!["graph".to_string(), "core".to_string()])
    );
}

#[test]
fn test_load_repo_constraints_hierarchy() {
    let dir = tempdir().unwrap();
    let p = dir.path();

    std::fs::write(
        p.join("commitlint.config.js"),
        r#"module.exports = { rules: { 'type-enum': [2, 'always', ['feat', 'fix']], 'header-max-length': [2, 'always', 70] } };"#,
    )
    .unwrap();

    std::fs::write(
        p.join(".vsc-git.json"),
        r#"{"commit": {"scopes": ["ui", "engine"]}}"#,
    )
    .unwrap();

    let merged = load_repo_constraints(p);
    assert_eq!(
        merged.types,
        Some(vec!["feat".to_string(), "fix".to_string()])
    );
    assert_eq!(
        merged.scopes,
        Some(vec!["ui".to_string(), "engine".to_string()])
    );
    assert_eq!(merged.header_max_length, Some(70));
}

#[test]
fn test_resolve_language() {
    // Explicit settings
    assert_eq!(resolve_language("en", &[]), "en");
    assert_eq!(resolve_language("vi", &[]), "vi");

    // Auto detection with English commit history
    let en_commits = vec![
        "feat(core): add new walker".to_string(),
        "fix(ui): resolve layout shift".to_string(),
    ];
    assert_eq!(resolve_language("auto", &en_commits), "en");

    // Auto detection with Vietnamese commit history
    let vi_commits = vec![
        "feat(core): thêm bộ phân tích cú pháp".to_string(),
        "fix(ui): sửa lỗi hiển thị giao diện".to_string(),
    ];
    assert_eq!(resolve_language("auto", &vi_commits), "vi");
}

#[test]
fn test_build_commit_prompt() {
    let files = vec!["M src/lib.rs".to_string()];
    let commits = vec!["feat(ai): initial".to_string()];
    let constraints = CommitConstraints {
        types: Some(vec!["feat".to_string(), "fix".to_string()]),
        scopes: Some(vec!["ai".to_string(), "core".to_string()]),
        header_max_length: Some(72),
    };

    let (sys, user) = build_commit_prompt(CommitPromptInput {
        staged_diff: "diff --git a/src/lib.rs b/src/lib.rs...",
        staged_files: &files,
        branch_name: Some("feat/PROJ-123-ai-provider"),
        recent_commits: &commits,
        constraints: &constraints,
        language: "auto",
    });

    assert!(sys.contains("Conventional Commits"));
    assert!(sys.contains("Refs: PROJ-123"));
    assert!(sys.contains("Allowed types: feat, fix"));
    assert!(sys.contains("Allowed scopes: ai, core"));
    assert!(sys.contains("Header max length: 72"));
    assert!(user.contains("Branch: feat/PROJ-123-ai-provider"));
    assert!(user.contains("Staged files:\n- M src/lib.rs"));
}

#[test]
fn test_build_pr_and_explain_prompts() {
    let commit_log = vec!["feat: one".to_string(), "fix: two".to_string()];
    let (sys_pr, user_pr) = build_pr_prompt("main", "feat/ai", &commit_log, "summary diff", "en");
    assert!(sys_pr.contains("pull request"));
    assert!(user_pr.contains("Base: main\nHead: feat/ai"));

    let (sys_exp, user_exp) = build_explain_commit_prompt(
        "abc1234",
        "feat: new feature",
        Some("Detailed body text"),
        "diff contents",
        "en",
    );
    assert!(sys_exp.contains("explaining git commits"));
    assert!(user_exp.contains("Commit: abc1234"));
    assert!(user_exp.contains("Subject: feat: new feature"));
}
