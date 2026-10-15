pub mod avatar_cache;
pub mod host;
pub mod rate_limit;
pub mod remote_url;

pub use avatar_cache::{
    email_hash, gravatar_url_for_hash, AvatarCache, CachedAvatar, Clock, FakeClock, SystemClock,
    DEFAULT_AVATAR_TTL,
};
pub use host::{
    Check, CiState, CiStatus, CreatePr, CurrentUser, Host, PullRequest, Reviewer, Target,
};
pub use rate_limit::{sanitize_text, HostError, HostErrorKind, RateLimitInfo};
pub use remote_url::{HostConfig, HostKind, RemoteRef, RemoteUrlError};
