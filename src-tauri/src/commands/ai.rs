use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use git_core::cli::CommandOptions;
use tauri::{AppHandle, Emitter, Manager, Window};
use tokio_util::sync::CancellationToken;

use crate::app::secrets::{
    delete_ai_key as del_ai_key, get_ai_key as read_ai_key, set_ai_key as save_ai_key,
};
use crate::app::settings::{get_settings, save_settings_to_dir, Settings};
use crate::commands::mod_helpers::active_session;
use crate::error::{AppError, ErrorKind};
use crate::git_exec::create_git_cli;
use crate::repo::jobs::{get_global_jobs, JobChunkEvent, JobDoneEvent, JobId};

pub fn is_remote_provider(provider: &str, base_url: Option<&str>) -> bool {
    let p = provider.to_lowercase();
    if p == "ollama" {
        return false;
    }
    if let Some(url) = base_url {
        let lower = url.to_lowercase();
        if lower.contains("localhost") || lower.contains("127.0.0.1") || lower.contains("::1") {
            return false;
        }
    }
    true
}

pub fn verify_consent(
    repo_path: &Path,
    provider: &str,
    base_url: Option<&str>,
    settings: &Settings,
) -> Result<(), AppError> {
    let vsc_file = repo_path.join(".vsc-git.json");
    if vsc_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&vsc_file) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(true) = val.get("ai.disabled").and_then(|v| v.as_bool()) {
                    return Err(AppError::new(
                        ErrorKind::AiProvider,
                        "AI is disabled for this repository by .vsc-git.json configuration",
                    ));
                }
            }
        }
    }

    if !is_remote_provider(provider, base_url) {
        return Ok(());
    }

    let repo_str = repo_path.to_string_lossy();
    if settings.has_ai_consent(&repo_str, provider) {
        return Ok(());
    }

    Err(AppError::new(
        ErrorKind::AiProvider,
        format!(
            "AI consent not granted: staged diff cannot be sent to remote provider '{provider}' without user consent for this repository"
        ),
    ))
}

pub fn build_llm_provider(
    provider_name: &str,
    base_url: Option<String>,
) -> Result<Arc<dyn ai::LlmProvider>, AppError> {
    let p = provider_name.to_lowercase();
    if p == "ollama" {
        let ollama = ai::OllamaProvider::new(base_url);
        return Ok(Arc::new(ollama));
    }

    let key = match read_ai_key(&p)? {
        Some(k) if !k.trim().is_empty() => k,
        _ => {
            return Err(AppError::new(
                ErrorKind::AuthFailed,
                format!("API key for AI provider '{provider_name}' not found in OS keyring"),
            ))
        }
    };

    if p == "claude" {
        let mut claude = ai::ClaudeProvider::new(key);
        if let Some(url) = base_url {
            claude = claude.with_base_url(url);
        }
        Ok(Arc::new(claude))
    } else {
        Ok(Arc::new(ai::OpenAICompatProvider::new(base_url, Some(key))))
    }
}

pub fn map_ai_error(err: ai::AiError, key_to_redact: Option<&str>) -> AppError {
    let kind = match err.kind {
        ai::AiErrorKind::Auth => ErrorKind::AuthFailed,
        ai::AiErrorKind::RateLimited => ErrorKind::AiProvider,
        ai::AiErrorKind::Network => ErrorKind::Network,
        ai::AiErrorKind::Cancelled => ErrorKind::Cancelled,
        ai::AiErrorKind::Disabled => ErrorKind::AiProvider,
        _ => ErrorKind::AiProvider,
    };
    let mut msg = err.to_string();
    if let Some(key) = key_to_redact {
        if !key.is_empty() {
            msg = msg.replace(key, "[REDACTED]");
        }
    }
    let msg = ai::redact_text(&msg);
    AppError::new(kind, msg)
}

#[tauri::command]
#[specta::specta]
pub fn set_ai_key(_app: AppHandle, provider: String, key: String) -> Result<(), AppError> {
    save_ai_key(&provider, &key)
}

#[tauri::command]
#[specta::specta]
pub fn delete_ai_key(_app: AppHandle, provider: String) -> Result<(), AppError> {
    del_ai_key(&provider)
}

#[tauri::command]
#[specta::specta]
pub fn ai_has_consent(
    app: AppHandle,
    repo_path: String,
    provider: String,
) -> Result<bool, AppError> {
    let settings = get_settings(app).unwrap_or_default();
    let p = Path::new(&repo_path);
    if !is_remote_provider(&provider, settings.ai_base_url.as_deref()) {
        return Ok(true);
    }
    match verify_consent(p, &provider, settings.ai_base_url.as_deref(), &settings) {
        Ok(()) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
#[specta::specta]
pub fn ai_set_consent(
    app: AppHandle,
    repo_path: String,
    provider: String,
    granted: bool,
) -> Result<(), AppError> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::internal(e.to_string()))?;
    let mut current = get_settings(app).unwrap_or_default();
    current.set_ai_consent(&repo_path, &provider, granted);
    save_settings_to_dir(&config_dir, &current)?;
    Ok(())
}

pub async fn test_ai_provider_impl(
    provider: String,
    model: Option<String>,
    base_url: Option<String>,
) -> Result<String, AppError> {
    let provider_client = build_llm_provider(&provider, base_url)?;
    let models = provider_client.list_models().await.map_err(|e| {
        let key = read_ai_key(&provider).ok().flatten();
        map_ai_error(e, key.as_deref())
    })?;

    let selected_model = model.unwrap_or_else(|| {
        models
            .first()
            .cloned()
            .unwrap_or_else(|| "default".to_string())
    });

    Ok(format!(
        "Successfully connected to {} (available models: {})",
        provider,
        if models.is_empty() {
            selected_model
        } else {
            models.join(", ")
        }
    ))
}

#[tauri::command]
#[specta::specta]
pub async fn test_ai_provider(
    _app: AppHandle,
    provider: String,
    model: Option<String>,
    base_url: Option<String>,
) -> Result<String, AppError> {
    test_ai_provider_impl(provider, model, base_url).await
}

pub async fn ai_list_models_impl(
    provider: String,
    base_url: Option<String>,
) -> Result<Vec<String>, AppError> {
    let provider_client = build_llm_provider(&provider, base_url)?;
    provider_client.list_models().await.map_err(|e| {
        let key = read_ai_key(&provider).ok().flatten();
        map_ai_error(e, key.as_deref())
    })
}

#[tauri::command]
#[specta::specta]
pub async fn ai_list_models(
    _app: AppHandle,
    provider: String,
    base_url: Option<String>,
) -> Result<Vec<String>, AppError> {
    ai_list_models_impl(provider, base_url).await
}

#[tauri::command]
#[specta::specta]
pub fn ai_generate_commit(app: AppHandle, window: Window) -> Result<JobId, AppError> {
    let session = active_session(&app, &window)?;
    let settings = get_settings(app.clone()).unwrap_or_default();

    if !settings.ai_enabled {
        return Err(AppError::new(
            ErrorKind::AiProvider,
            "AI features are disabled in application settings",
        ));
    }

    verify_consent(
        &session.root,
        &settings.ai_provider,
        settings.ai_base_url.as_deref(),
        &settings,
    )?;

    let provider = build_llm_provider(&settings.ai_provider, settings.ai_base_url.clone())?;

    let ai_settings = ai::AiSettings {
        enabled: settings.ai_enabled,
        provider: settings.ai_provider.clone(),
        model: settings.ai_model.clone(),
        base_url: settings.ai_base_url.clone(),
        language: settings.ai_language.clone(),
        max_diff_tokens: settings.ai_max_diff_tokens as usize,
        exclude_globs: settings.ai_exclude_globs.clone(),
        disabled_repos: settings.ai_disabled_repos.clone(),
    };

    let (job_id, cancel_token) = get_global_jobs().create_job();
    let job_id_for_task = job_id.clone();
    let app_for_task = app.clone();
    let repo_root = session.root.clone();

    tauri::async_runtime::spawn(async move {
        let tokio_cancel = CancellationToken::new();
        let tokio_cancel_for_monitor = tokio_cancel.clone();
        let cancel_token_clone = cancel_token.clone();

        // Monitor cancellation
        tokio::spawn(async move {
            while !tokio_cancel_for_monitor.is_cancelled() {
                if cancel_token_clone.is_cancelled() {
                    tokio_cancel_for_monitor.cancel();
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        });

        let app_for_chunk = app_for_task.clone();
        let job_id_for_chunk = job_id_for_task.clone();
        let on_chunk = move |chunk: String| {
            let _ = app_for_chunk.emit(
                "job://chunk",
                &JobChunkEvent {
                    id: job_id_for_chunk.clone(),
                    chunk,
                },
            );
        };

        let result = ai::service::generate_commit_message(
            &repo_root,
            &ai_settings,
            provider.as_ref(),
            on_chunk,
            tokio_cancel,
        )
        .await;

        get_global_jobs().remove_job(&job_id_for_task);

        let (success, error) = match result {
            Ok(postprocessed) => {
                let _ = app_for_task.emit(
                    "job://chunk",
                    &JobChunkEvent {
                        id: job_id_for_task.clone(),
                        chunk: postprocessed.message,
                    },
                );
                (true, None)
            }
            Err(e) => {
                let key = read_ai_key(&ai_settings.provider).ok().flatten();
                let app_err = map_ai_error(e, key.as_deref());
                (false, Some(app_err.message))
            }
        };

        let _ = app_for_task.emit(
            "job://done",
            &JobDoneEvent {
                id: job_id_for_task,
                success,
                error,
            },
        );
    });

    Ok(job_id)
}

#[tauri::command]
#[specta::specta]
pub fn ai_generate_pr(
    app: AppHandle,
    window: Window,
    base: String,
    head: String,
) -> Result<JobId, AppError> {
    let session = active_session(&app, &window)?;
    let settings = get_settings(app.clone()).unwrap_or_default();

    if !settings.ai_enabled {
        return Err(AppError::new(
            ErrorKind::AiProvider,
            "AI features are disabled in application settings",
        ));
    }

    verify_consent(
        &session.root,
        &settings.ai_provider,
        settings.ai_base_url.as_deref(),
        &settings,
    )?;

    let provider = build_llm_provider(&settings.ai_provider, settings.ai_base_url.clone())?;
    let (job_id, cancel_token) = get_global_jobs().create_job();
    let job_id_for_task = job_id.clone();
    let app_for_task = app.clone();
    let repo_root = session.root.clone();

    tauri::async_runtime::spawn(async move {
        let tokio_cancel = CancellationToken::new();
        let tokio_cancel_for_monitor = tokio_cancel.clone();
        let cancel_token_clone = cancel_token.clone();

        tokio::spawn(async move {
            while !tokio_cancel_for_monitor.is_cancelled() {
                if cancel_token_clone.is_cancelled() {
                    tokio_cancel_for_monitor.cancel();
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        });

        let cli = create_git_cli();

        // Retrieve commit log between base and head
        let log_rev = format!("{base}..{head}");
        let commit_logs: Vec<String> = match cli.exec(
            &repo_root,
            &["log", &log_rev, "--format=%s"],
            CommandOptions::read_only(),
        ) {
            Ok(out) => out
                .stdout_lossy()
                .lines()
                .map(|s| ai::redact_text(s.trim()))
                .filter(|s| !s.is_empty())
                .collect(),
            Err(_) => Vec::new(),
        };

        // Retrieve diff summary
        let diff_summary: String = match cli.exec(
            &repo_root,
            &["diff", "--stat", &base, &head],
            CommandOptions::read_only(),
        ) {
            Ok(out) => ai::redact_text(&out.stdout_lossy()),
            Err(_) => String::new(),
        };

        let (system_prompt, user_prompt) = ai::prompt::build_pr_prompt(
            &base,
            &head,
            &commit_logs,
            &diff_summary,
            &settings.ai_language,
        );

        let req = ai::GenerateRequest {
            model: settings.ai_model.clone(),
            messages: vec![ai::ChatMessage::user(user_prompt)],
            system: Some(system_prompt),
            max_tokens: Some(1024),
            temperature: Some(0.2),
        };

        let mut stream = provider.generate(req, tokio_cancel);
        let mut full_output = String::new();
        let mut failure_error: Option<String> = None;

        while let Some(chunk_res) = stream.next().await {
            match chunk_res {
                Ok(chunk) => {
                    full_output.push_str(&chunk);
                    let _ = app_for_task.emit(
                        "job://chunk",
                        &JobChunkEvent {
                            id: job_id_for_task.clone(),
                            chunk,
                        },
                    );
                }
                Err(e) => {
                    let key = read_ai_key(&settings.ai_provider).ok().flatten();
                    let mapped = map_ai_error(e, key.as_deref());
                    failure_error = Some(mapped.message);
                    break;
                }
            }
        }

        get_global_jobs().remove_job(&job_id_for_task);

        let success = failure_error.is_none();
        let _ = app_for_task.emit(
            "job://done",
            &JobDoneEvent {
                id: job_id_for_task,
                success,
                error: failure_error,
            },
        );
    });

    Ok(job_id)
}

#[tauri::command]
#[specta::specta]
pub fn ai_explain_commit(app: AppHandle, window: Window, sha: String) -> Result<JobId, AppError> {
    let session = active_session(&app, &window)?;
    let settings = get_settings(app.clone()).unwrap_or_default();

    if !settings.ai_enabled {
        return Err(AppError::new(
            ErrorKind::AiProvider,
            "AI features are disabled in application settings",
        ));
    }

    verify_consent(
        &session.root,
        &settings.ai_provider,
        settings.ai_base_url.as_deref(),
        &settings,
    )?;

    let provider = build_llm_provider(&settings.ai_provider, settings.ai_base_url.clone())?;
    let (job_id, cancel_token) = get_global_jobs().create_job();
    let job_id_for_task = job_id.clone();
    let app_for_task = app.clone();
    let repo_root = session.root.clone();

    tauri::async_runtime::spawn(async move {
        let tokio_cancel = CancellationToken::new();
        let tokio_cancel_for_monitor = tokio_cancel.clone();
        let cancel_token_clone = cancel_token.clone();

        tokio::spawn(async move {
            while !tokio_cancel_for_monitor.is_cancelled() {
                if cancel_token_clone.is_cancelled() {
                    tokio_cancel_for_monitor.cancel();
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        });

        let cli = create_git_cli();

        let subject = cli
            .exec(
                &repo_root,
                &["show", "-s", "--format=%s", &sha],
                CommandOptions::read_only(),
            )
            .map(|o| ai::redact_text(o.stdout_lossy().trim()))
            .unwrap_or_default();

        let body = cli
            .exec(
                &repo_root,
                &["show", "-s", "--format=%b", &sha],
                CommandOptions::read_only(),
            )
            .map(|o| ai::redact_text(o.stdout_lossy().trim()))
            .ok()
            .filter(|s| !s.is_empty());

        let diff = cli
            .exec(
                &repo_root,
                &["show", "--format=", "--stat", &sha],
                CommandOptions::read_only(),
            )
            .map(|o| ai::redact_text(&o.stdout_lossy()))
            .unwrap_or_default();
        let (system_prompt, user_prompt) = ai::prompt::build_explain_commit_prompt(
            &sha,
            &subject,
            body.as_deref(),
            &diff,
            &settings.ai_language,
        );

        let req = ai::GenerateRequest {
            model: settings.ai_model.clone(),
            messages: vec![ai::ChatMessage::user(user_prompt)],
            system: Some(system_prompt),
            max_tokens: Some(1024),
            temperature: Some(0.2),
        };

        let mut stream = provider.generate(req, tokio_cancel);
        let mut failure_error: Option<String> = None;

        while let Some(chunk_res) = stream.next().await {
            match chunk_res {
                Ok(chunk) => {
                    let _ = app_for_task.emit(
                        "job://chunk",
                        &JobChunkEvent {
                            id: job_id_for_task.clone(),
                            chunk,
                        },
                    );
                }
                Err(e) => {
                    let key = read_ai_key(&settings.ai_provider).ok().flatten();
                    let mapped = map_ai_error(e, key.as_deref());
                    failure_error = Some(mapped.message);
                    break;
                }
            }
        }

        get_global_jobs().remove_job(&job_id_for_task);

        let success = failure_error.is_none();
        let _ = app_for_task.emit(
            "job://done",
            &JobDoneEvent {
                id: job_id_for_task,
                success,
                error: failure_error,
            },
        );
    });

    Ok(job_id)
}
