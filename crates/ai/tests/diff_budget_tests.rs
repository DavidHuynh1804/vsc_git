use ai::{
    apply_diff_budget, estimate_tokens, parse_gitattributes_generated, DiffBudgetOptions,
    StagedFileInput,
};

#[test]
fn test_token_estimation() {
    assert_eq!(estimate_tokens(""), 0);
    // 7 characters / 3.5 = 2 tokens
    assert_eq!(estimate_tokens("1234567"), 2);
    // 8 characters / 3.5 = 2.28 -> 3 tokens
    assert_eq!(estimate_tokens("12345678"), 3);
}

#[test]
fn test_exclude_lock_and_minified_and_dist_files() {
    let diff = r#"diff --git a/Cargo.lock b/Cargo.lock
index 1111111..2222222 100644
--- a/Cargo.lock
+++ b/Cargo.lock
@@ -1,5 +1,6 @@
-old_dep = "1.0"
+new_dep = "2.0"
diff --git a/src/index.min.js b/src/index.min.js
index 3333333..4444444 100644
--- a/src/index.min.js
+++ b/src/index.min.js
@@ -1,1 +1,1 @@
-var x=1;
+var x=2;
diff --git a/dist/bundle.js b/dist/bundle.js
index 5555555..6666666 100644
--- a/dist/bundle.js
+++ b/dist/bundle.js
@@ -1,1 +1,1 @@
-console.log("old");
+console.log("new");
diff --git a/src/main.rs b/src/main.rs
index 7777777..8888888 100644
--- a/src/main.rs
+++ b/src/main.rs
@@ -1,3 +1,3 @@
-fn main() {}
+fn main() { println!("hi"); }
"#;

    let staged_files = vec![
        StagedFileInput::new("Cargo.lock"),
        StagedFileInput::new("src/index.min.js"),
        StagedFileInput::new("dist/bundle.js"),
        StagedFileInput::new("src/main.rs"),
    ];

    let options = DiffBudgetOptions::default();
    let result = apply_diff_budget(diff, &staged_files, &options);

    // Lock file content should be excluded, but header retained
    assert!(result.contains("Cargo.lock"));
    assert!(result.contains("[Cargo.lock (content excluded: lock/minified/generated/binary)]"));
    assert!(!result.contains("new_dep = \"2.0\""));

    // Minified file content should be excluded
    assert!(result.contains("src/index.min.js"));
    assert!(
        result.contains("[src/index.min.js (content excluded: lock/minified/generated/binary)]")
    );
    assert!(!result.contains("var x=2;"));

    // dist/ file content should be excluded
    assert!(result.contains("dist/bundle.js"));
    assert!(result.contains("[dist/bundle.js (content excluded: lock/minified/generated/binary)]"));
    assert!(!result.contains("console.log(\"new\");"));

    // Normal source file content retained
    assert!(result.contains("src/main.rs"));
    assert!(result.contains("println!(\"hi\");"));
}

#[test]
fn test_exclude_binary_and_linguist_generated() {
    let diff = r#"diff --git a/assets/logo.png b/assets/logo.png
index 1111111..2222222 100644
Binary files a/assets/logo.png and b/assets/logo.png differ
diff --git a/src/generated.rs b/src/generated.rs
index 3333333..4444444 100644
--- a/src/generated.rs
+++ b/src/generated.rs
@@ -1,3 +1,3 @@
-pub const V: u32 = 1;
+pub const V: u32 = 2;
"#;

    let staged_files = vec![
        StagedFileInput::binary("assets/logo.png"),
        StagedFileInput::linguist_generated("src/generated.rs"),
    ];

    let options = DiffBudgetOptions::default();
    let result = apply_diff_budget(diff, &staged_files, &options);

    assert!(result.contains("[assets/logo.png (content excluded: lock/minified/generated/binary)]"));
    assert!(
        result.contains("[src/generated.rs (content excluded: lock/minified/generated/binary)]")
    );
    assert!(!result.contains("pub const V: u32 = 2;"));
}

#[test]
fn test_parse_gitattributes_generated() {
    let gitattributes = r#"
# Sample gitattributes
*.generated.rs linguist-generated=true
schema.json linguist-generated
*.min.js linguist-generated
src/manual.rs -linguist-generated
"#;

    let generated = parse_gitattributes_generated(gitattributes);
    assert_eq!(generated, vec!["*.generated.rs", "schema.json", "*.min.js"]);
}

#[test]
fn test_diff_budget_truncation_when_exceeding_threshold() {
    let mut hunks = String::new();
    for i in 0..50 {
        hunks.push_str(&format!(
            "@@ -{0},5 +{0},5 @@\n-old line {0} content to fill tokens\n+new line {0} content to fill tokens\n",
            i * 10
        ));
    }

    let diff = format!(
        "diff --git a/src/big.rs b/src/big.rs\n--- a/src/big.rs\n+++ b/src/big.rs\n{hunks}"
    );

    let staged_files = vec![StagedFileInput::new("src/big.rs")];
    // Very tight budget: 50 tokens (~175 chars)
    let options = DiffBudgetOptions {
        max_tokens: 50,
        exclude_globs: vec![],
    };

    let result = apply_diff_budget(&diff, &staged_files, &options);
    assert!(result.contains("src/big.rs"));
    assert!(result.contains("# stats: +"));
    assert!(result.contains("(truncated)"));
}
