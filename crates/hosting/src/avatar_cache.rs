use crate::rate_limit::HostError;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::fs;

pub const DEFAULT_AVATAR_TTL: Duration = Duration::from_secs(7 * 24 * 3600); // 7 days

pub trait Clock: Send + Sync {
    fn now_sec(&self) -> u64;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_sec(&self) -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }
}

#[derive(Debug)]
pub struct FakeClock {
    current: AtomicU64,
}

impl FakeClock {
    pub fn new(initial_sec: u64) -> Self {
        FakeClock {
            current: AtomicU64::new(initial_sec),
        }
    }

    pub fn advance(&self, secs: u64) {
        self.current.fetch_add(secs, Ordering::SeqCst);
    }

    pub fn set(&self, secs: u64) {
        self.current.store(secs, Ordering::SeqCst);
    }
}

impl Clock for FakeClock {
    fn now_sec(&self) -> u64 {
        self.current.load(Ordering::SeqCst)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedAvatar {
    pub email_hash: String,
    pub avatar_url: Option<String>,
    pub fetched_at_sec: u64,
}

pub fn email_hash(email: &str) -> String {
    let normalized = email.trim().to_ascii_lowercase();
    format!("{:x}", md5::compute(normalized.as_bytes()))
}

pub fn gravatar_url_for_hash(hash: &str) -> String {
    format!("https://www.gravatar.com/avatar/{hash}?d=404")
}

#[derive(Clone)]
pub struct AvatarCache {
    dir: PathBuf,
    ttl: Duration,
    clock: Arc<dyn Clock>,
    client: reqwest::Client,
    gravatar_base_url: Option<String>,
}

impl AvatarCache {
    pub fn new(dir: impl Into<PathBuf>, client: reqwest::Client) -> Self {
        Self::with_clock(dir, client, Arc::new(SystemClock), DEFAULT_AVATAR_TTL)
    }

    pub fn with_clock(
        dir: impl Into<PathBuf>,
        client: reqwest::Client,
        clock: Arc<dyn Clock>,
        ttl: Duration,
    ) -> Self {
        AvatarCache {
            dir: dir.into(),
            ttl,
            clock,
            client,
            gravatar_base_url: None,
        }
    }

    pub fn with_gravatar_base(mut self, base: String) -> Self {
        self.gravatar_base_url = Some(base);
        self
    }

    fn cache_path(&self, hash: &str) -> PathBuf {
        self.dir.join(format!("{hash}.json"))
    }

    pub async fn get(&self, email: &str) -> Option<Option<String>> {
        let hash = email_hash(email);
        let path = self.cache_path(&hash);
        let content = fs::read(&path).await.ok()?;
        let entry: CachedAvatar = serde_json::from_slice(&content).ok()?;

        let now = self.clock.now_sec();
        let age = now.saturating_sub(entry.fetched_at_sec);
        if age <= self.ttl.as_secs() {
            Some(entry.avatar_url)
        } else {
            None
        }
    }

    pub async fn set(&self, email: &str, avatar_url: Option<String>) -> Result<(), std::io::Error> {
        if !self.dir.exists() {
            fs::create_dir_all(&self.dir).await?;
        }
        let hash = email_hash(email);
        let path = self.cache_path(&hash);
        let entry = CachedAvatar {
            email_hash: hash,
            avatar_url,
            fetched_at_sec: self.clock.now_sec(),
        };
        let data = serde_json::to_vec(&entry).unwrap_or_default();
        fs::write(&path, data).await
    }

    pub fn gravatar_url(&self, email: &str) -> String {
        let hash = email_hash(email);
        if let Some(base) = &self.gravatar_base_url {
            format!("{base}/avatar/{hash}?d=404")
        } else {
            gravatar_url_for_hash(&hash)
        }
    }

    pub async fn check_gravatar(&self, email: &str) -> Option<String> {
        let url = self.gravatar_url(email);
        let resp = self.client.get(&url).send().await.ok()?;
        if resp.status() == StatusCode::OK {
            Some(url)
        } else {
            None
        }
    }

    pub async fn resolve<F, Fut>(
        &self,
        email: &str,
        host_fetcher: F,
    ) -> Result<Option<String>, HostError>
    where
        F: FnOnce(&str) -> Fut,
        Fut: Future<Output = Result<Option<String>, HostError>>,
    {
        if let Some(cached) = self.get(email).await {
            return Ok(cached);
        }

        let host_result = host_fetcher(email).await;
        match host_result {
            Ok(Some(url)) => {
                let _ = self.set(email, Some(url.clone())).await;
                Ok(Some(url))
            }
            Ok(None) => {
                let gravatar = self.check_gravatar(email).await;
                let _ = self.set(email, gravatar.clone()).await;
                Ok(gravatar)
            }
            Err(e) => {
                let gravatar = self.check_gravatar(email).await;
                if gravatar.is_some() {
                    let _ = self.set(email, gravatar.clone()).await;
                    Ok(gravatar)
                } else {
                    Err(e)
                }
            }
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn ttl(&self) -> Duration {
        self.ttl
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn test_avatar_cache_ttl_fake_clock() {
        let tmp = tempdir().unwrap();
        let fake_clock = Arc::new(FakeClock::new(1000));
        let client = reqwest::Client::new();
        let cache =
            AvatarCache::with_clock(tmp.path(), client, fake_clock.clone(), DEFAULT_AVATAR_TTL);

        let email = "Dev.User@Example.COM";
        assert_eq!(cache.get(email).await, None);

        cache
            .set(email, Some("https://example.com/avatar.png".into()))
            .await
            .unwrap();

        assert_eq!(
            cache.get(email).await,
            Some(Some("https://example.com/avatar.png".into()))
        );

        // Advance fake clock 6 days (still valid)
        fake_clock.advance(6 * 24 * 3600);
        assert_eq!(
            cache.get(email).await,
            Some(Some("https://example.com/avatar.png".into()))
        );

        // Advance 1 day and 1 second more -> 7 days + 1 sec (expired)
        fake_clock.advance(24 * 3600 + 1);
        assert_eq!(cache.get(email).await, None);
    }

    #[tokio::test]
    async fn test_negative_caching() {
        let tmp = tempdir().unwrap();
        let fake_clock = Arc::new(FakeClock::new(5000));
        let client = reqwest::Client::new();
        let cache =
            AvatarCache::with_clock(tmp.path(), client, fake_clock.clone(), DEFAULT_AVATAR_TTL);

        let email = "no-avatar@example.com";
        cache.set(email, None).await.unwrap();

        // Cached hit with None
        assert_eq!(cache.get(email).await, Some(None));

        fake_clock.advance(8 * 24 * 3600);
        // Expired -> returns None (cache miss)
        assert_eq!(cache.get(email).await, None);
    }

    #[tokio::test]
    async fn test_gravatar_fallback_wiremock() {
        let server = MockServer::start().await;
        let tmp = tempdir().unwrap();
        let client = reqwest::Client::new();
        let cache = AvatarCache::new(tmp.path(), client).with_gravatar_base(server.uri());

        let email_with_gravatar = "found@example.com";
        let hash1 = email_hash(email_with_gravatar);
        Mock::given(method("GET"))
            .and(path(format!("/avatar/{hash1}")))
            .and(query_param("d", "404"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"avatar-bytes"))
            .mount(&server)
            .await;

        let email_no_gravatar = "notfound@example.com";
        let hash2 = email_hash(email_no_gravatar);
        Mock::given(method("GET"))
            .and(path(format!("/avatar/{hash2}")))
            .and(query_param("d", "404"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        // When host returns None, Gravatar 200 should succeed
        let res1 = cache
            .resolve(email_with_gravatar, |_| async { Ok(None) })
            .await
            .unwrap();
        assert!(res1.is_some());
        assert!(res1.unwrap().contains(&hash1));

        // When host returns None and Gravatar 404 -> None
        let res2 = cache
            .resolve(email_no_gravatar, |_| async { Ok(None) })
            .await
            .unwrap();
        assert_eq!(res2, None);
    }
}
