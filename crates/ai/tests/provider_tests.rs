use ai::{
    AiErrorKind, ChatMessage, ClaudeProvider, GenerateRequest, LlmProvider, OllamaProvider,
    OpenAICompatProvider,
};
use futures_util::StreamExt;
use tokio_util::sync::CancellationToken;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn test_claude_provider_sse() {
    let mock_server = MockServer::start().await;

    let sse_body = "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"feat: \"}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"initial commit\"}}\n\ndata: [DONE]\n\n";

    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .and(header("x-api-key", "my-secret-key"))
        .and(header("anthropic-version", "2023-06-01"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_string(sse_body)
                .append_header("content-type", "text/event-stream"),
        )
        .mount(&mock_server)
        .await;

    let provider = ClaudeProvider::new("my-secret-key").with_base_url(mock_server.uri());

    let req = GenerateRequest {
        model: "claude-haiku-5-5".to_string(),
        messages: vec![ChatMessage::user("generate commit")],
        system: Some("You are a commit generator".to_string()),
        max_tokens: Some(100),
        temperature: None,
    };

    let cancel = CancellationToken::new();
    let mut stream = provider.generate(req, cancel);

    let mut chunks = Vec::new();
    while let Some(res) = stream.next().await {
        chunks.push(res.expect("chunk should succeed"));
    }

    assert_eq!(chunks, vec!["feat: ", "initial commit"]);
}

#[tokio::test]
async fn test_claude_provider_list_models() {
    let provider = ClaudeProvider::new("my-secret-key");
    let models = provider.list_models().await.expect("models");
    assert!(models.contains(&"claude-haiku-5-5".to_string()));
    assert!(models.contains(&"claude-sonnet-5-5".to_string()));
}

#[tokio::test]
async fn test_openai_provider_sse() {
    let mock_server = MockServer::start().await;

    let sse_body = "data: {\"choices\":[{\"delta\":{\"content\":\"fix: \"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"resolve panic\"}}]}\n\ndata: [DONE]\n\n";

    Mock::given(method("POST"))
        .and(path("/chat/completions"))
        .and(header("authorization", "Bearer test-openai-key"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_string(sse_body)
                .append_header("content-type", "text/event-stream"),
        )
        .mount(&mock_server)
        .await;

    let provider =
        OpenAICompatProvider::new(Some(mock_server.uri()), Some("test-openai-key".to_string()));

    let req = GenerateRequest {
        model: "gpt-4o-mini".to_string(),
        messages: vec![ChatMessage::user("generate commit")],
        system: None,
        max_tokens: Some(50),
        temperature: Some(0.2),
    };

    let cancel = CancellationToken::new();
    let mut stream = provider.generate(req, cancel);

    let mut chunks = Vec::new();
    while let Some(res) = stream.next().await {
        chunks.push(res.expect("chunk should succeed"));
    }

    assert_eq!(chunks, vec!["fix: ", "resolve panic"]);
}

#[tokio::test]
async fn test_openai_provider_list_models() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/models"))
        .and(header("authorization", "Bearer test-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [
                {"id": "gpt-4o"},
                {"id": "gpt-4o-mini"}
            ]
        })))
        .mount(&mock_server)
        .await;

    let provider = OpenAICompatProvider::new(Some(mock_server.uri()), Some("test-key".to_string()));
    let models = provider.list_models().await.expect("models list");
    assert_eq!(models, vec!["gpt-4o", "gpt-4o-mini"]);
}

#[tokio::test]
async fn test_ollama_provider_ndjson() {
    let mock_server = MockServer::start().await;

    let ndjson_body = "{\"message\":{\"role\":\"assistant\",\"content\":\"refactor\"},\"done\":false}\n{\"message\":{\"role\":\"assistant\",\"content\":\"(ai): clean\"},\"done\":false}\n{\"message\":{\"role\":\"assistant\",\"content\":\"\"},\"done\":true}\n";

    Mock::given(method("POST"))
        .and(path("/api/chat"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_string(ndjson_body)
                .append_header("content-type", "application/x-ndjson"),
        )
        .mount(&mock_server)
        .await;

    let provider = OllamaProvider::new(Some(mock_server.uri()));

    let req = GenerateRequest {
        model: "llama3".to_string(),
        messages: vec![ChatMessage::user("generate commit")],
        system: None,
        max_tokens: None,
        temperature: None,
    };

    let cancel = CancellationToken::new();
    let mut stream = provider.generate(req, cancel);

    let mut chunks = Vec::new();
    while let Some(res) = stream.next().await {
        chunks.push(res.expect("chunk should succeed"));
    }

    assert_eq!(chunks, vec!["refactor", "(ai): clean"]);
}

#[tokio::test]
async fn test_ollama_provider_list_models() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/api/tags"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "models": [
                {"name": "llama3:latest"},
                {"name": "mistral:latest"}
            ]
        })))
        .mount(&mock_server)
        .await;

    let provider = OllamaProvider::new(Some(mock_server.uri()));
    let models = provider.list_models().await.expect("ollama tags");
    assert_eq!(models, vec!["llama3:latest", "mistral:latest"]);
}

#[tokio::test]
async fn test_provider_auth_error_401() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(
            ResponseTemplate::new(401)
                .set_body_string("Invalid API key provided: secret_key_12345"),
        )
        .mount(&mock_server)
        .await;

    let provider = ClaudeProvider::new("secret_key_12345").with_base_url(mock_server.uri());

    let req = GenerateRequest {
        model: "claude-haiku-5-5".to_string(),
        messages: vec![ChatMessage::user("prompt")],
        system: None,
        max_tokens: None,
        temperature: None,
    };

    let cancel = CancellationToken::new();
    let mut stream = provider.generate(req, cancel);

    let res = stream.next().await.expect("stream item expected");
    let err = res.expect_err("should return error");
    assert_eq!(err.kind, AiErrorKind::Auth);
    assert!(!err.message.contains("secret_key_12345"));
}

#[tokio::test]
async fn test_provider_rate_limited_429() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/chat/completions"))
        .respond_with(ResponseTemplate::new(429).set_body_string("Rate limit exceeded"))
        .mount(&mock_server)
        .await;

    let provider = OpenAICompatProvider::new(Some(mock_server.uri()), None);

    let req = GenerateRequest {
        model: "gpt-4o".to_string(),
        messages: vec![ChatMessage::user("prompt")],
        system: None,
        max_tokens: None,
        temperature: None,
    };

    let cancel = CancellationToken::new();
    let mut stream = provider.generate(req, cancel);

    let res = stream.next().await.expect("stream item expected");
    let err = res.expect_err("should be rate limited");
    assert_eq!(err.kind, AiErrorKind::RateLimited);
}

#[tokio::test]
async fn test_provider_cancellation() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/api/chat"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_delay(std::time::Duration::from_millis(500))
                .set_body_string("{\"message\":{\"content\":\"test\"},\"done\":false}\n"),
        )
        .mount(&mock_server)
        .await;

    let provider = OllamaProvider::new(Some(mock_server.uri()));

    let req = GenerateRequest {
        model: "llama3".to_string(),
        messages: vec![ChatMessage::user("prompt")],
        system: None,
        max_tokens: None,
        temperature: None,
    };

    let cancel = CancellationToken::new();
    cancel.cancel(); // cancel immediately
    let mut stream = provider.generate(req, cancel);

    let res = stream.next().await.expect("stream item expected");
    let err = res.expect_err("should be cancelled");
    assert_eq!(err.kind, AiErrorKind::Cancelled);
}
