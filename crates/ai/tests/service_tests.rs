use ai::provider::ReceiverStream;
use ai::{generate_commit_message, AiError, AiErrorKind, AiSettings, GenerateRequest, LlmProvider};
use futures_util::stream::BoxStream;
use futures_util::StreamExt;
use git_core::cli::{CommandOptions, GitCli};
use parking_lot::Mutex;
use std::sync::Arc;
use tempfile::tempdir;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

struct MockProvider {
    chunks: Vec<String>,
}

#[async_trait::async_trait]
impl LlmProvider for MockProvider {
    fn id(&self) -> &str {
        "mock"
    }

    async fn list_models(&self) -> Result<Vec<String>, AiError> {
        Ok(vec!["mock-model".to_string()])
    }

    fn generate(
        &self,
        _req: GenerateRequest,
        _cancel: CancellationToken,
    ) -> BoxStream<'static, Result<String, AiError>> {
        let (tx, rx) = mpsc::channel(16);
        let chunks = self.chunks.clone();

        tokio::spawn(async move {
            for c in chunks {
                let _ = tx.send(Ok(c)).await;
            }
        });

        ReceiverStream::new(rx).boxed()
    }
}

fn setup_test_repo() -> (tempfile::TempDir, GitCli) {
    let dir = tempdir().unwrap();
    let cli = GitCli::default();

    cli.exec(dir.path(), &["init"], CommandOptions::default())
        .unwrap();
    cli.exec(
        dir.path(),
        &["config", "user.email", "test@example.com"],
        CommandOptions::default(),
    )
    .unwrap();
    cli.exec(
        dir.path(),
        &["config", "user.name", "Tester"],
        CommandOptions::default(),
    )
    .unwrap();

    // Initial commit
    std::fs::write(dir.path().join("README.md"), "# Test Repo").unwrap();
    cli.exec(dir.path(), &["add", "README.md"], CommandOptions::default())
        .unwrap();
    cli.exec(
        dir.path(),
        &["commit", "-m", "feat: initial commit"],
        CommandOptions::default(),
    )
    .unwrap();

    (dir, cli)
}

#[tokio::test]
async fn test_generate_commit_message_success() {
    let (dir, cli) = setup_test_repo();

    // Create branch feat/PROJ-77-ui
    cli.exec(
        dir.path(),
        &["checkout", "-b", "feat/PROJ-77-ui"],
        CommandOptions::default(),
    )
    .unwrap();

    // Stage changes
    std::fs::write(dir.path().join("app.rs"), "pub fn run() {}").unwrap();
    cli.exec(dir.path(), &["add", "app.rs"], CommandOptions::default())
        .unwrap();

    let provider = MockProvider {
        chunks: vec![
            "feat(ui): ".to_string(),
            "add app component\n\n".to_string(),
            "Introduce run entrypoint.\n\n".to_string(),
            "Refs: PROJ-77".to_string(),
        ],
    };

    let settings = AiSettings::default();
    let streamed_chunks = Arc::new(Mutex::new(Vec::new()));
    let chunks_clone = streamed_chunks.clone();

    let on_chunk = move |chunk: String| {
        chunks_clone.lock().push(chunk);
    };

    let cancel = CancellationToken::new();
    let res = generate_commit_message(dir.path(), &settings, &provider, on_chunk, cancel)
        .await
        .expect("generation should succeed");

    assert_eq!(
        res.message,
        "feat(ui): add app component\n\nIntroduce run entrypoint.\n\nRefs: PROJ-77"
    );
    assert!(!res.has_warning);

    let collected = streamed_chunks.lock().join("");
    assert_eq!(
        collected,
        "feat(ui): add app component\n\nIntroduce run entrypoint.\n\nRefs: PROJ-77"
    );
}

#[tokio::test]
async fn test_generate_commit_message_disabled_repo() {
    let (dir, cli) = setup_test_repo();

    std::fs::write(dir.path().join("app.rs"), "pub fn test() {}").unwrap();
    cli.exec(dir.path(), &["add", "app.rs"], CommandOptions::default())
        .unwrap();

    let provider = MockProvider { chunks: vec![] };

    let mut settings = AiSettings::default();
    let dir_name = dir.path().file_name().unwrap().to_string_lossy();
    settings.disabled_repos = vec![format!("*{dir_name}*")];

    let cancel = CancellationToken::new();
    let err = generate_commit_message(dir.path(), &settings, &provider, |_| {}, cancel)
        .await
        .expect_err("should be disabled");

    assert_eq!(err.kind, AiErrorKind::Disabled);
}

#[tokio::test]
async fn test_generate_commit_message_disabled_vsc_git_json() {
    let (dir, cli) = setup_test_repo();

    std::fs::write(dir.path().join(".vsc-git.json"), "{\"ai.disabled\": true}").unwrap();
    std::fs::write(dir.path().join("app.rs"), "pub fn test() {}").unwrap();
    cli.exec(
        dir.path(),
        &["add", "app.rs", ".vsc-git.json"],
        CommandOptions::default(),
    )
    .unwrap();

    let provider = MockProvider { chunks: vec![] };
    let settings = AiSettings::default();

    let cancel = CancellationToken::new();
    let err = generate_commit_message(dir.path(), &settings, &provider, |_| {}, cancel)
        .await
        .expect_err("should be disabled via .vsc-git.json");

    assert_eq!(err.kind, AiErrorKind::Disabled);
}

#[tokio::test]
async fn test_generate_commit_message_no_staged_changes() {
    let (dir, _cli) = setup_test_repo();

    let provider = MockProvider { chunks: vec![] };
    let settings = AiSettings::default();

    let cancel = CancellationToken::new();
    let err = generate_commit_message(dir.path(), &settings, &provider, |_| {}, cancel)
        .await
        .expect_err("should fail when nothing is staged");

    assert_eq!(err.kind, AiErrorKind::BadResponse);
}
