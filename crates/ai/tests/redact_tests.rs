use ai::{redact_diff, redact_text};

#[test]
fn test_redact_aws_key() {
    let input = "export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
    let output = redact_text(input);
    assert_eq!(output, "export AWS_ACCESS_KEY_ID=[REDACTED]");
    assert!(!output.contains("AKIAIOSFODNN7EXAMPLE"));
}

#[test]
fn test_redact_github_token() {
    let input = "ghp_123456789012345678901234567890123456";
    let output = redact_text(input);
    assert_eq!(output, "[REDACTED]");

    let fine_grained =
        "github_pat_11ABCD_123456789012345678901234567890123456789012345678901234567890";
    let fine_output = redact_text(fine_grained);
    assert_eq!(fine_output, "[REDACTED]");
}

#[test]
fn test_redact_gitlab_token() {
    let input = "glpat-abcdefghijklmnopqrst12";
    let output = redact_text(input);
    assert_eq!(output, "[REDACTED]");
}

#[test]
fn test_redact_slack_token() {
    let input = "xoxb-123456789012-123456789012-abcdef123456";
    let output = redact_text(input);
    assert_eq!(output, "[REDACTED]");

    let input_p = "xoxp-9876543210-abcdef-12345";
    let output_p = redact_text(input_p);
    assert_eq!(output_p, "[REDACTED]");
}

#[test]
fn test_redact_private_key_block() {
    let input = "Some text before\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----\nSome text after";
    let output = redact_text(input);
    assert!(output.contains("[REDACTED]"));
    assert!(!output.contains("MIIEowIBAAKCAQEA0..."));
    assert!(output.contains("Some text before"));
    assert!(output.contains("Some text after"));
}

#[test]
fn test_redact_jwt() {
    let input = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c in auth header";
    let output = redact_text(input);
    assert_eq!(output, "Bearer [REDACTED] in auth header");
}

#[test]
fn test_redact_env_file_secrets_in_diff() {
    let diff = r#"diff --git a/.env b/.env
index 1111111..2222222 100644
--- a/.env
+++ b/.env
@@ -1,4 +1,4 @@
+PASSWORD="super_secret_pw"
+DATABASE_SECRET=my_secret_token
+API_KEY='secret_api_key'
+PUBLIC_APP_NAME="GitGraph"
diff --git a/src/main.rs b/src/main.rs
index 3333333..4444444 100644
--- a/src/main.rs
+++ b/src/main.rs
@@ -1,1 +1,1 @@
+let password = get_user_password();
"#;

    let redacted = redact_diff(diff);

    // .env lines with secrets must be redacted
    assert!(redacted.contains("+PASSWORD=\"[REDACTED]\""));
    assert!(redacted.contains("+DATABASE_SECRET=[REDACTED]"));
    assert!(redacted.contains("+API_KEY='[REDACTED]'"));
    assert!(!redacted.contains("super_secret_pw"));
    assert!(!redacted.contains("my_secret_token"));
    assert!(!redacted.contains("secret_api_key"));

    // Non-secret in .env is kept
    assert!(redacted.contains("+PUBLIC_APP_NAME=\"GitGraph\""));

    // Normal Rust code in src/main.rs must NOT be falsely redacted
    assert!(redacted.contains("+let password = get_user_password();"));
}

#[test]
fn test_negative_no_false_positives_on_normal_code() {
    let normal_code = r#"
fn verify_password(password: &str) -> bool {
    !password.is_empty()
}

pub fn configure(api_key: Option<String>) {
    let endpoint = "https://api.github.com/repos";
    let version = "1.2.3";
    let aws_region = "us-east-1";
    println!("{endpoint} {version} {aws_region}");
}
"#;

    let output = redact_text(normal_code);
    assert_eq!(output, normal_code);
}
