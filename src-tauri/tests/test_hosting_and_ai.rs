use std::fs;
use std::sync::Arc;

use tempfile::tempdir;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use vsc_git_lib::app::secrets::{
    delete_ai_key, delete_host_token, get_ai_key, get_host_token, set_ai_key,
    set_custom_secret_store, set_host_token, MockSecretStore,
};
use vsc_git_lib::app::settings::{HostConfig, Settings};
use vsc_git_lib::commands::ai::{
    build_llm_provider, is_remote_provider, map_ai_error, verify_consent,
};
use vsc_git_lib::commands::hosting::{check_scopes, test_host_token_impl};
use vsc_git_lib::error::ErrorKind;
static TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[tokio::test]
async fn test_github_test_host_token_wiremock_success_and_scopes() {
    let _guard = TEST_LOCK.lock().await;
    let mock_store = Arc::new(MockSecretStore::new());
    set_custom_secret_store(Some(mock_store));

    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/user"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({
                    "login": "octocat",
                    "name": "The Octocat",
                    "email": "octocat@github.com",
                    "avatar_url": "https://github.com/images/error/octocat_happy.gif"
                }))
                .insert_header("x-oauth-scopes", "repo, read:user"),
        )
        .mount(&server)
        .await;

    let host = HostConfig {
        host: "github.com".to_string(),
        kind: "github".to_string(),
        api_base_url: server.uri(),
    };

    // With explicit token
    let res = test_host_token_impl(host.clone(), Some("ghp_valid_token_12345".to_string()))
        .await
        .expect("test_host_token should succeed");

    assert_eq!(res.user.username, "octocat");
    assert_eq!(res.user.name, Some("The Octocat".to_string()));
    assert!(res.scope_check.ok);
    assert!(res.scope_check.missing_scopes.is_empty());

    // With token retrieved from secret store
    set_host_token("github.com", "ghp_saved_in_keyring").expect("save host token");
    assert_eq!(
        get_host_token("github.com").expect("read token"),
        Some("ghp_saved_in_keyring".to_string())
    );

    let res_saved = test_host_token_impl(host, None)
        .await
        .expect("test_host_token with saved token should succeed");
    assert_eq!(res_saved.user.username, "octocat");

    delete_host_token("github.com").expect("delete token");
    assert_eq!(get_host_token("github.com").expect("read token"), None);
}

#[tokio::test]
async fn test_github_missing_scopes_and_auth_error_wiremock() {
    let _guard = TEST_LOCK.lock().await;
    let mock_store = Arc::new(MockSecretStore::new());
    set_custom_secret_store(Some(mock_store));

    let server = MockServer::start().await;

    // 1. Missing scopes
    Mock::given(method("GET"))
        .and(path("/user"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({
                    "login": "octocat_limited",
                    "name": "Octocat Limited"
                }))
                .insert_header("x-oauth-scopes", "public_repo"),
        )
        .mount(&server)
        .await;

    let host = HostConfig {
        host: "github.com".to_string(),
        kind: "github".to_string(),
        api_base_url: server.uri(),
    };

    let res = test_host_token_impl(host.clone(), Some("token_limited".into()))
        .await
        .expect("connection itself succeeds");

    assert_eq!(res.user.username, "octocat_limited");
    assert!(!res.scope_check.ok);
    assert!(res.scope_check.missing_scopes.contains(&"repo".to_string()));

    // 2. 401 Unauthorized - Ensure secret does NOT leak in error
    server.reset().await;
    let secret_pat = "ghp_super_secret_pat_987654321";
    Mock::given(method("GET"))
        .and(path("/user"))
        .respond_with(ResponseTemplate::new(401).set_body_json(serde_json::json!({
            "message": "Bad credentials"
        })))
        .mount(&server)
        .await;

    let err = test_host_token_impl(host, Some(secret_pat.into()))
        .await
        .unwrap_err();

    assert_eq!(err.kind, ErrorKind::AuthFailed);
    assert!(
        !err.message.contains(secret_pat),
        "Secret PAT must never appear in error message: {}",
        err.message
    );
}

#[tokio::test]
async fn test_gitlab_test_host_token_wiremock() {
    let _guard = TEST_LOCK.lock().await;
    let mock_store = Arc::new(MockSecretStore::new());
    set_custom_secret_store(Some(mock_store));

    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/api/v4/user"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({
                    "username": "gitlab_dev",
                    "name": "GitLab Developer",
                    "email": "dev@gitlab.com",
                    "avatar_url": "https://gitlab.com/uploads/user/avatar/dev.png"
                }))
                .insert_header("scope", "api, read_user"),
        )
        .mount(&server)
        .await;

    Mock::given(method("GET"))
        .and(path("/api/v4/personal_access_tokens/self"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "scopes": ["api"]
        })))
        .mount(&server)
        .await;

    let host = HostConfig {
        host: "gitlab.com".to_string(),
        kind: "gitlab".to_string(),
        api_base_url: format!("{}/api/v4", server.uri()),
    };

    let res = test_host_token_impl(host, Some("glpat_secret_pat".into()))
        .await
        .expect("gitlab connection should succeed");

    assert_eq!(res.user.username, "gitlab_dev");
    assert!(res.scope_check.ok);
    assert_eq!(res.scope_check.required_scopes, vec!["api".to_string()]);
}

#[tokio::test]
async fn test_ai_provider_wiremock_and_secret_redaction() {
    let _guard = TEST_LOCK.lock().await;
    let mock_store = Arc::new(MockSecretStore::new());
    set_custom_secret_store(Some(mock_store));

    let server = MockServer::start().await;

    // 1. Successful model list
    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [
                { "id": "gpt-4o" },
                { "id": "gpt-4o-mini" }
            ]
        })))
        .mount(&server)
        .await;

    let secret_ai_key = "sk-proj-super-confidential-openai-key-99999";
    set_ai_key("openai", secret_ai_key).expect("save ai key");
    assert_eq!(
        get_ai_key("openai").expect("read ai key"),
        Some(secret_ai_key.to_string())
    );

    let provider =
        build_llm_provider("openai", Some(format!("{}/v1", server.uri()))).expect("build provider");
    let models = provider.list_models().await.expect("list models");
    assert!(models.contains(&"gpt-4o".to_string()));
    assert!(models.contains(&"gpt-4o-mini".to_string()));

    // 2. 401 Authentication Failure: Ensure key is redacted from error
    server.reset().await;
    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(ResponseTemplate::new(401).set_body_json(serde_json::json!({
            "error": {
                "message": format!("Invalid API key: {secret_ai_key}"),
                "type": "invalid_request_error"
            }
        })))
        .mount(&server)
        .await;

    let err = provider.list_models().await.unwrap_err();
    let app_err = map_ai_error(err, Some(secret_ai_key));

    assert_eq!(app_err.kind, ErrorKind::AuthFailed);
    assert!(
        !app_err.message.contains(secret_ai_key),
        "Secret API key must never be exposed in error message: {}",
        app_err.message
    );
    assert!(
        app_err.message.contains("[REDACTED]"),
        "Secret API key must be redacted in error: {}",
        app_err.message
    );

    delete_ai_key("openai").expect("delete ai key");
    assert_eq!(get_ai_key("openai").expect("read ai key"), None);
}

#[test]
fn test_ai_consent_backend_enforcement() {
    let dir = tempdir().expect("tempdir");
    let repo_path = dir.path();

    let mut settings = Settings::default();

    // Remote provider without consent -> Rejected
    assert!(is_remote_provider("claude", None));
    assert!(is_remote_provider(
        "openai",
        Some("https://api.openai.com/v1")
    ));
    assert!(!is_remote_provider(
        "ollama",
        Some("http://localhost:11434")
    ));
    assert!(!is_remote_provider(
        "openai",
        Some("http://127.0.0.1:8080/v1")
    ));

    let repo_str = repo_path.to_string_lossy().to_string();
    assert!(!settings.has_ai_consent(&repo_str, "claude"));

    let consent_err = verify_consent(repo_path, "claude", None, &settings).unwrap_err();
    assert_eq!(consent_err.kind, ErrorKind::AiProvider);
    assert!(consent_err.message.contains("AI consent not granted"));

    // Local provider requires no consent
    assert!(verify_consent(repo_path, "ollama", None, &settings).is_ok());
    assert!(verify_consent(
        repo_path,
        "openai",
        Some("http://localhost:8000/v1"),
        &settings
    )
    .is_ok());

    // Grant consent in settings -> Accepted
    settings.set_ai_consent(&repo_str, "claude", true);
    assert!(settings.has_ai_consent(&repo_str, "claude"));
    assert!(verify_consent(repo_path, "claude", None, &settings).is_ok());

    // Different provider still rejected
    assert!(verify_consent(repo_path, "openai", None, &settings).is_err());

    // Revoke consent
    settings.set_ai_consent(&repo_str, "claude", false);
    assert!(!settings.has_ai_consent(&repo_str, "claude"));
    assert!(verify_consent(repo_path, "claude", None, &settings).is_err());

    // .vsc-git.json with ai.disabled = true -> Strict rejection
    let vsc_file = repo_path.join(".vsc-git.json");
    fs::write(
        &vsc_file,
        serde_json::json!({
            "ai.disabled": true
        })
        .to_string(),
    )
    .expect("write .vsc-git.json");
    // Even if settings has consent, ai.disabled overrides
    settings.set_ai_consent(&repo_str, "claude", true);
    let disabled_err = verify_consent(repo_path, "claude", None, &settings).unwrap_err();
    assert!(disabled_err
        .message
        .contains("AI is disabled for this repository"));

    // Untrusted cloned repo trying to self-authorize with ai.consents must be REJECTED
    settings.set_ai_consent(&repo_str, "claude", false);
    fs::write(
        &vsc_file,
        serde_json::json!({
            "ai.consents": ["claude"]
        })
        .to_string(),
    )
    .expect("write untrusted .vsc-git.json");
    let untrusted_err = verify_consent(repo_path, "claude", None, &settings).unwrap_err();
    assert_eq!(untrusted_err.kind, ErrorKind::AiProvider);
    assert!(untrusted_err.message.contains("AI consent not granted"));
}
#[test]
fn test_ai_prompt_redaction_before_remote_request() {
    let raw_commit = "fix: update token ghp_1234567890abcdefghijklmnopqrstuvwxyzAB";
    let redacted_commit = ai::redact_text(raw_commit);
    assert!(!redacted_commit.contains("ghp_1234567890abcdefghijklmnopqrstuvwxyzAB"));
    assert!(redacted_commit.contains("[REDACTED]"));

    let raw_diff =
        "diff --git a/config.txt b/config.txt\n+GITLAB_TOKEN=glpat-abcdefghijklmnopqrst12";
    let redacted_diff = ai::redact_text(raw_diff);
    assert!(!redacted_diff.contains("glpat-abcdefghijklmnopqrst12"));
    assert!(redacted_diff.contains("[REDACTED]"));

    let (_sys, user) =
        ai::prompt::build_pr_prompt("main", "feature", &[redacted_commit], &redacted_diff, "en");
    assert!(!user.contains("ghp_1234567890abcdefghijklmnopqrstuvwxyzAB"));
    assert!(!user.contains("glpat-abcdefghijklmnopqrst12"));
}

#[test]
fn test_check_scopes_logic() {
    // GitHub
    let gh_ok = check_scopes("github", &["repo".into(), "read:user".into()]);
    assert!(gh_ok.ok);
    assert!(gh_ok.missing_scopes.is_empty());

    let gh_missing = check_scopes("github", &["read:user".into()]);
    assert!(!gh_missing.ok);
    assert_eq!(gh_missing.missing_scopes, vec!["repo".to_string()]);

    // GitLab
    let gl_ok = check_scopes("gitlab", &["api".into()]);
    assert!(gl_ok.ok);

    let gl_missing = check_scopes("gitlab", &["read_user".into()]);
    assert!(!gl_missing.ok);
    assert_eq!(gl_missing.missing_scopes, vec!["api".to_string()]);
}
