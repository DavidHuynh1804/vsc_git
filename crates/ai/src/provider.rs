use crate::error::AiError;
use futures_util::stream::BoxStream;
use futures_util::Stream;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

/// Stream wrapper over a Tokio mpsc receiver.
pub struct ReceiverStream<T> {
    rx: mpsc::Receiver<T>,
}

impl<T> ReceiverStream<T> {
    pub fn new(rx: mpsc::Receiver<T>) -> Self {
        Self { rx }
    }
}

impl<T> Stream for ReceiverStream<T> {
    type Item = T;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.rx.poll_recv(cx)
    }
}

/// Message role and content for LLM requests.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

impl ChatMessage {
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".to_string(),
            content: content.into(),
        }
    }

    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system".to_string(),
            content: content.into(),
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: "assistant".to_string(),
            content: content.into(),
        }
    }
}

/// Generation request payload passed to LLM providers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GenerateRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
}

/// Abstract LLM provider trait for streaming and model listing.
#[async_trait::async_trait]
pub trait LlmProvider: Send + Sync {
    fn id(&self) -> &str;
    async fn list_models(&self) -> Result<Vec<String>, AiError>;
    fn generate(
        &self,
        req: GenerateRequest,
        cancel: CancellationToken,
    ) -> BoxStream<'static, Result<String, AiError>>;
}

fn create_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

fn sanitize(text: &str, key: Option<&str>) -> String {
    if let Some(k) = key {
        if !k.is_empty() {
            return text.replace(k, "[REDACTED]");
        }
    }
    text.to_string()
}

fn map_http_status(status: reqwest::StatusCode, body: &str, key: Option<&str>) -> AiError {
    let sanitized_body = sanitize(body, key);
    let preview = if sanitized_body.len() > 300 {
        format!("{}...", &sanitized_body[..300])
    } else {
        sanitized_body
    };

    let code = status.as_u16();
    if code == 401 || code == 403 {
        AiError::auth(format!("Authentication failed ({status}): {preview}"))
    } else if code == 429 {
        AiError::rate_limited(format!("Rate limited ({status}): {preview}"))
    } else {
        AiError::bad_response(format!("HTTP error ({status}): {preview}"))
    }
}

// ---------------------------------------------------------------------------
// Claude Provider (Anthropic Messages API)
// ---------------------------------------------------------------------------

pub struct ClaudeProvider {
    base_url: String,
    api_key: String,
    client: reqwest::Client,
}

impl ClaudeProvider {
    pub const DEFAULT_BASE: &'static str = "https://api.anthropic.com";
    pub const DEFAULT_MODEL: &'static str = "claude-haiku-5-5";
    pub const OPTIONAL_SONNET: &'static str = "claude-sonnet-5-5";

    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            base_url: Self::DEFAULT_BASE.to_string(),
            api_key: api_key.into(),
            client: create_client(),
        }
    }

    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into();
        self
    }
}

#[derive(Serialize)]
struct ClaudeRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    messages: &'a [ChatMessage],
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<&'a str>,
    stream: bool,
}

#[derive(Deserialize)]
struct ClaudeStreamEvent {
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    delta: Option<ClaudeDelta>,
    #[serde(default)]
    error: Option<ClaudeErrorPayload>,
}

#[derive(Deserialize)]
struct ClaudeDelta {
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Deserialize)]
struct ClaudeErrorPayload {
    #[serde(default)]
    message: String,
}

#[async_trait::async_trait]
impl LlmProvider for ClaudeProvider {
    fn id(&self) -> &str {
        "claude"
    }

    async fn list_models(&self) -> Result<Vec<String>, AiError> {
        Ok(vec![
            Self::DEFAULT_MODEL.to_string(),
            Self::OPTIONAL_SONNET.to_string(),
        ])
    }

    fn generate(
        &self,
        req: GenerateRequest,
        cancel: CancellationToken,
    ) -> BoxStream<'static, Result<String, AiError>> {
        let (tx, rx) = mpsc::channel(32);
        let client = self.client.clone();
        let url = format!("{}/v1/messages", self.base_url.trim_end_matches('/'));
        let api_key = self.api_key.clone();

        tokio::spawn(async move {
            let body = ClaudeRequest {
                model: &req.model,
                max_tokens: req.max_tokens.unwrap_or(1024),
                messages: &req.messages,
                system: req.system.as_deref(),
                stream: true,
            };

            let send_future = client
                .post(&url)
                .header("x-api-key", &api_key)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .json(&body)
                .send();

            let resp = tokio::select! {
                _ = cancel.cancelled() => {
                    let _ = tx.send(Err(AiError::cancelled())).await;
                    return;
                }
                res = send_future => match res {
                    Ok(r) => r,
                    Err(e) => {
                        let _ = tx.send(Err(AiError::network(sanitize(&e.to_string(), Some(&api_key))))).await;
                        return;
                    }
                }
            };

            let status = resp.status();
            if !status.is_success() {
                let err_text = resp.text().await.unwrap_or_default();
                let _ = tx
                    .send(Err(map_http_status(status, &err_text, Some(&api_key))))
                    .await;
                return;
            }

            let mut byte_stream = resp.bytes_stream();
            let mut buffer = String::new();

            loop {
                let next_chunk = tokio::select! {
                    _ = cancel.cancelled() => {
                        let _ = tx.send(Err(AiError::cancelled())).await;
                        return;
                    }
                    chunk = byte_stream.next() => chunk,
                };

                match next_chunk {
                    Some(Ok(bytes)) => {
                        let text = String::from_utf8_lossy(&bytes);
                        buffer.push_str(&text);

                        while let Some(pos) = buffer.find('\n') {
                            let line = buffer[..pos].trim_end_matches('\r').to_string();
                            buffer = buffer[pos + 1..].to_string();

                            if let Some(data) = line.strip_prefix("data: ") {
                                let trimmed = data.trim();
                                if trimmed == "[DONE]" {
                                    return;
                                }
                                if let Ok(event) =
                                    serde_json::from_str::<ClaudeStreamEvent>(trimmed)
                                {
                                    if let Some(err) = event.error {
                                        let _ =
                                            tx.send(Err(AiError::bad_response(err.message))).await;
                                        return;
                                    }
                                    if event.r#type == "content_block_delta" {
                                        if let Some(delta) = event.delta {
                                            if delta.r#type == "text_delta" {
                                                if let Some(t) = delta.text {
                                                    if !t.is_empty()
                                                        && tx.send(Ok(t)).await.is_err()
                                                    {
                                                        return;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Some(Err(e)) => {
                        let _ = tx
                            .send(Err(AiError::network(sanitize(
                                &e.to_string(),
                                Some(&api_key),
                            ))))
                            .await;
                        return;
                    }
                    None => break,
                }
            }
        });

        ReceiverStream::new(rx).boxed()
    }
}

// ---------------------------------------------------------------------------
// OpenAI-Compatible Provider
// ---------------------------------------------------------------------------

pub struct OpenAICompatProvider {
    base_url: String,
    api_key: Option<String>,
    client: reqwest::Client,
}

impl OpenAICompatProvider {
    pub const DEFAULT_BASE: &'static str = "https://api.openai.com/v1";

    pub fn new(base_url: Option<String>, api_key: Option<String>) -> Self {
        Self {
            base_url: base_url.unwrap_or_else(|| Self::DEFAULT_BASE.to_string()),
            api_key,
            client: create_client(),
        }
    }
}

#[derive(Serialize)]
struct OpenAIChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

#[derive(Deserialize)]
struct OpenAIChatChunk {
    #[serde(default)]
    choices: Vec<OpenAIChoice>,
    #[serde(default)]
    error: Option<OpenAIErrorPayload>,
}

#[derive(Deserialize)]
struct OpenAIChoice {
    #[serde(default)]
    delta: OpenAIDelta,
}

#[derive(Default, Deserialize)]
struct OpenAIDelta {
    #[serde(default)]
    content: Option<String>,
}

#[derive(Deserialize)]
struct OpenAIErrorPayload {
    #[serde(default)]
    message: String,
}

#[derive(Deserialize)]
struct OpenAIModelListResponse {
    #[serde(default)]
    data: Vec<OpenAIModelItem>,
}

#[derive(Deserialize)]
struct OpenAIModelItem {
    id: String,
}

#[async_trait::async_trait]
impl LlmProvider for OpenAICompatProvider {
    fn id(&self) -> &str {
        "openai"
    }

    async fn list_models(&self) -> Result<Vec<String>, AiError> {
        let url = format!("{}/models", self.base_url.trim_end_matches('/'));
        let mut req = self.client.get(&url);
        if let Some(key) = &self.api_key {
            req = req.header("authorization", format!("Bearer {key}"));
        }

        let resp = req
            .send()
            .await
            .map_err(|e| AiError::network(sanitize(&e.to_string(), self.api_key.as_deref())))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(map_http_status(status, &body, self.api_key.as_deref()));
        }

        let models_resp: OpenAIModelListResponse = resp
            .json()
            .await
            .map_err(|e| AiError::bad_response(format!("Invalid models JSON: {e}")))?;

        Ok(models_resp.data.into_iter().map(|m| m.id).collect())
    }

    fn generate(
        &self,
        req: GenerateRequest,
        cancel: CancellationToken,
    ) -> BoxStream<'static, Result<String, AiError>> {
        let (tx, rx) = mpsc::channel(32);
        let client = self.client.clone();
        let url = format!("{}/chat/completions", self.base_url.trim_end_matches('/'));
        let api_key = self.api_key.clone();

        tokio::spawn(async move {
            let mut messages = Vec::new();
            if let Some(sys) = req.system {
                messages.push(ChatMessage::system(sys));
            }
            messages.extend(req.messages);

            let body = OpenAIChatRequest {
                model: &req.model,
                messages,
                stream: true,
                temperature: req.temperature,
                max_tokens: req.max_tokens,
            };

            let mut req_builder = client.post(&url).header("content-type", "application/json");
            if let Some(key) = &api_key {
                req_builder = req_builder.header("authorization", format!("Bearer {key}"));
            }

            let resp = tokio::select! {
                _ = cancel.cancelled() => {
                    let _ = tx.send(Err(AiError::cancelled())).await;
                    return;
                }
                res = req_builder.json(&body).send() => match res {
                    Ok(r) => r,
                    Err(e) => {
                        let _ = tx.send(Err(AiError::network(sanitize(&e.to_string(), api_key.as_deref())))).await;
                        return;
                    }
                }
            };

            let status = resp.status();
            if !status.is_success() {
                let err_text = resp.text().await.unwrap_or_default();
                let _ = tx
                    .send(Err(map_http_status(status, &err_text, api_key.as_deref())))
                    .await;
                return;
            }

            let mut byte_stream = resp.bytes_stream();
            let mut buffer = String::new();

            loop {
                let next_chunk = tokio::select! {
                    _ = cancel.cancelled() => {
                        let _ = tx.send(Err(AiError::cancelled())).await;
                        return;
                    }
                    chunk = byte_stream.next() => chunk,
                };

                match next_chunk {
                    Some(Ok(bytes)) => {
                        let text = String::from_utf8_lossy(&bytes);
                        buffer.push_str(&text);

                        while let Some(pos) = buffer.find('\n') {
                            let line = buffer[..pos].trim_end_matches('\r').to_string();
                            buffer = buffer[pos + 1..].to_string();

                            if let Some(data) = line.strip_prefix("data: ") {
                                let trimmed = data.trim();
                                if trimmed == "[DONE]" {
                                    return;
                                }
                                if let Ok(chunk_data) =
                                    serde_json::from_str::<OpenAIChatChunk>(trimmed)
                                {
                                    if let Some(err) = chunk_data.error {
                                        let _ =
                                            tx.send(Err(AiError::bad_response(err.message))).await;
                                        return;
                                    }
                                    for choice in chunk_data.choices {
                                        if let Some(content) = choice.delta.content {
                                            if !content.is_empty()
                                                && tx.send(Ok(content)).await.is_err()
                                            {
                                                return;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Some(Err(e)) => {
                        let _ = tx
                            .send(Err(AiError::network(sanitize(
                                &e.to_string(),
                                api_key.as_deref(),
                            ))))
                            .await;
                        return;
                    }
                    None => break,
                }
            }
        });

        ReceiverStream::new(rx).boxed()
    }
}

// ---------------------------------------------------------------------------
// Ollama Provider
// ---------------------------------------------------------------------------

pub struct OllamaProvider {
    base_url: String,
    client: reqwest::Client,
}

impl OllamaProvider {
    pub const DEFAULT_BASE: &'static str = "http://localhost:11434";

    pub fn new(base_url: Option<String>) -> Self {
        Self {
            base_url: base_url.unwrap_or_else(|| Self::DEFAULT_BASE.to_string()),
            client: create_client(),
        }
    }
}

#[derive(Serialize)]
struct OllamaChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage>,
    stream: bool,
}

#[derive(Deserialize)]
struct OllamaChatResponse {
    #[serde(default)]
    message: Option<ChatMessage>,
    #[serde(default)]
    done: bool,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Deserialize)]
struct OllamaTagsResponse {
    #[serde(default)]
    models: Vec<OllamaModelItem>,
}

#[derive(Deserialize)]
struct OllamaModelItem {
    name: String,
}

#[async_trait::async_trait]
impl LlmProvider for OllamaProvider {
    fn id(&self) -> &str {
        "ollama"
    }

    async fn list_models(&self) -> Result<Vec<String>, AiError> {
        let url = format!("{}/api/tags", self.base_url.trim_end_matches('/'));
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| AiError::network(format!("Ollama connection failed: {e}")))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(map_http_status(status, &body, None));
        }

        let tags_resp: OllamaTagsResponse = resp
            .json()
            .await
            .map_err(|e| AiError::bad_response(format!("Invalid tags response: {e}")))?;

        Ok(tags_resp.models.into_iter().map(|m| m.name).collect())
    }

    fn generate(
        &self,
        req: GenerateRequest,
        cancel: CancellationToken,
    ) -> BoxStream<'static, Result<String, AiError>> {
        let (tx, rx) = mpsc::channel(32);
        let client = self.client.clone();
        let url = format!("{}/api/chat", self.base_url.trim_end_matches('/'));

        tokio::spawn(async move {
            let mut messages = Vec::new();
            if let Some(sys) = req.system {
                messages.push(ChatMessage::system(sys));
            }
            messages.extend(req.messages);

            let body = OllamaChatRequest {
                model: &req.model,
                messages,
                stream: true,
            };

            let resp = tokio::select! {
                _ = cancel.cancelled() => {
                    let _ = tx.send(Err(AiError::cancelled())).await;
                    return;
                }
                res = client.post(&url).json(&body).send() => match res {
                    Ok(r) => r,
                    Err(e) => {
                        let _ = tx.send(Err(AiError::network(e.to_string()))).await;
                        return;
                    }
                }
            };

            let status = resp.status();
            if !status.is_success() {
                let err_text = resp.text().await.unwrap_or_default();
                let _ = tx.send(Err(map_http_status(status, &err_text, None))).await;
                return;
            }

            let mut byte_stream = resp.bytes_stream();
            let mut buffer = String::new();

            loop {
                let next_chunk = tokio::select! {
                    _ = cancel.cancelled() => {
                        let _ = tx.send(Err(AiError::cancelled())).await;
                        return;
                    }
                    chunk = byte_stream.next() => chunk,
                };

                match next_chunk {
                    Some(Ok(bytes)) => {
                        let text = String::from_utf8_lossy(&bytes);
                        buffer.push_str(&text);

                        while let Some(pos) = buffer.find('\n') {
                            let line = buffer[..pos].trim_end_matches('\r').to_string();
                            buffer = buffer[pos + 1..].to_string();

                            let trimmed = line.trim();
                            if trimmed.is_empty() {
                                continue;
                            }

                            if let Ok(chunk_data) =
                                serde_json::from_str::<OllamaChatResponse>(trimmed)
                            {
                                if let Some(err) = chunk_data.error {
                                    let _ = tx.send(Err(AiError::bad_response(err))).await;
                                    return;
                                }
                                if let Some(msg) = chunk_data.message {
                                    if !msg.content.is_empty()
                                        && tx.send(Ok(msg.content)).await.is_err()
                                    {
                                        return;
                                    }
                                }
                                if chunk_data.done {
                                    return;
                                }
                            }
                        }
                    }
                    Some(Err(e)) => {
                        let _ = tx.send(Err(AiError::network(e.to_string()))).await;
                        return;
                    }
                    None => break,
                }
            }
        });

        ReceiverStream::new(rx).boxed()
    }
}
