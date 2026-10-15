use std::sync::Arc;

use parking_lot::RwLock;

use crate::error::{AppError, ErrorKind};

pub const KEYRING_SERVICE: &str = "vsc_git";

pub trait SecretStore: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<String>, AppError>;
    fn set(&self, key: &str, secret: &str) -> Result<(), AppError>;
    fn delete(&self, key: &str) -> Result<(), AppError>;
}

pub struct KeyringSecretStore;

impl SecretStore for KeyringSecretStore {
    fn get(&self, key: &str) -> Result<Option<String>, AppError> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, key)
            .map_err(|_| AppError::new(ErrorKind::AuthFailed, "Failed to access OS keyring"))?;
        match entry.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(AppError::new(
                ErrorKind::AuthFailed,
                "Failed to read secret from OS keyring",
            )),
        }
    }

    fn set(&self, key: &str, secret: &str) -> Result<(), AppError> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, key)
            .map_err(|_| AppError::new(ErrorKind::AuthFailed, "Failed to access OS keyring"))?;
        entry.set_password(secret).map_err(|_| {
            AppError::new(
                ErrorKind::AuthFailed,
                "Failed to store secret in OS keyring",
            )
        })?;
        Ok(())
    }

    fn delete(&self, key: &str) -> Result<(), AppError> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, key)
            .map_err(|_| AppError::new(ErrorKind::AuthFailed, "Failed to access OS keyring"))?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(AppError::new(
                ErrorKind::AuthFailed,
                "Failed to delete secret from OS keyring",
            )),
        }
    }
}

static CUSTOM_STORE: RwLock<Option<Arc<dyn SecretStore>>> = RwLock::new(None);

pub fn set_custom_secret_store(store: Option<Arc<dyn SecretStore>>) {
    *CUSTOM_STORE.write() = store;
}

fn get_active_store() -> Arc<dyn SecretStore> {
    if let Some(store) = CUSTOM_STORE.read().as_ref() {
        return Arc::clone(store);
    }
    Arc::new(KeyringSecretStore)
}

pub fn get_secret(key: &str) -> Result<Option<String>, AppError> {
    get_active_store().get(key)
}

pub fn set_secret(key: &str, secret: &str) -> Result<(), AppError> {
    get_active_store().set(key, secret)
}

pub fn delete_secret(key: &str) -> Result<(), AppError> {
    get_active_store().delete(key)
}

pub fn host_token_key(host: &str) -> String {
    format!("host/{host}")
}

pub fn ai_key_key(provider: &str) -> String {
    format!("ai/{provider}")
}

pub fn get_host_token(host: &str) -> Result<Option<String>, AppError> {
    get_secret(&host_token_key(host))
}

pub fn set_host_token(host: &str, token: &str) -> Result<(), AppError> {
    set_secret(&host_token_key(host), token)
}

pub fn delete_host_token(host: &str) -> Result<(), AppError> {
    delete_secret(&host_token_key(host))
}

pub fn get_ai_key(provider: &str) -> Result<Option<String>, AppError> {
    get_secret(&ai_key_key(provider))
}

pub fn set_ai_key(provider: &str, key: &str) -> Result<(), AppError> {
    set_secret(&ai_key_key(provider), key)
}

pub fn delete_ai_key(provider: &str) -> Result<(), AppError> {
    delete_secret(&ai_key_key(provider))
}

pub struct MockSecretStore {
    secrets: RwLock<std::collections::HashMap<String, String>>,
}

impl MockSecretStore {
    pub fn new() -> Self {
        Self {
            secrets: RwLock::new(std::collections::HashMap::new()),
        }
    }
}

impl Default for MockSecretStore {
    fn default() -> Self {
        Self::new()
    }
}

impl SecretStore for MockSecretStore {
    fn get(&self, key: &str) -> Result<Option<String>, AppError> {
        Ok(self.secrets.read().get(key).cloned())
    }

    fn set(&self, key: &str, secret: &str) -> Result<(), AppError> {
        self.secrets
            .write()
            .insert(key.to_string(), secret.to_string());
        Ok(())
    }

    fn delete(&self, key: &str) -> Result<(), AppError> {
        self.secrets.write().remove(key);
        Ok(())
    }
}
