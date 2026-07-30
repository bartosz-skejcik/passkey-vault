//! Typowany błąd granicy API — mirror `pv_core::CryptoError`'s thiserror
//! shape, ale mapowany na kody HTTP zamiast propagowany przez `anyhow`.

use axum::{http::StatusCode, response::IntoResponse, Json};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ApiError {
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("unauthorized")]
    Unauthorized,
    #[error("not found")]
    NotFound,
    /// Caller is authenticated AND provably has SOME access to this exact
    /// resource, but not enough for the operation attempted (e.g. a `read`
    /// holder attempting `edit`). No-access-at-all stays `NotFound` — see
    /// `routes/membership.rs`'s `gate::<M>()`, the ONE place this 404-vs-403
    /// split is decided (SEC-06/SHARE-05). Deliberately no payload: existence
    /// must never leak via a caller-supplied message on this variant.
    #[error("forbidden")]
    Forbidden,
    #[error("conflict: {0}")]
    Conflict(String),
    /// Phase 23 (SYNC-06): a stale-revision 409 on a SHARED item
    /// (collection-scoped, or carrying an `item_shares` row) — attributes
    /// the conflict to the other member's email (D-03, Bartek's decision:
    /// the member's FULL email, never a local-part-only or anonymous
    /// rendering), or `None` when `vault_items.last_editor_user_id` is still
    /// NULL (never edited since Migration 0015). A NEW variant, never a
    /// mutation of `Conflict` above: `Conflict`'s wire shape
    /// (`{"error": message}`) is depended on by 15+ other call sites and
    /// must stay byte-identical for a PERSONAL item's conflict (CONTEXT.md's
    /// locked decision — "personal items keep today's exact generic copy").
    /// See this variant's own `IntoResponse` arm below, which deviates from
    /// the uniform `(status, message)` tuple every other arm shares
    /// specifically so it can carry the extra `last_editor_email` key
    /// (RESEARCH.md Pitfall B).
    #[error("conflict: {message}")]
    StaleRevisionShared { message: String, last_editor_email: Option<String> },
    #[error("internal error")]
    Internal,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let (status, message) = match &self {
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, self.to_string()),
            ApiError::NotFound => (StatusCode::NOT_FOUND, self.to_string()),
            ApiError::Forbidden => (StatusCode::FORBIDDEN, self.to_string()),
            ApiError::Conflict(msg) => (StatusCode::CONFLICT, msg.clone()),
            // Deviates from the uniform (status, message) tuple every other
            // arm above shares: this variant's JSON body carries an extra
            // `last_editor_email` key the tuple shape cannot express, so it
            // returns EARLY from the whole function instead of falling
            // through to the shared `Json(json!({ "error": message }))`
            // construction below (Phase 23 SYNC-06; RESEARCH.md Pitfall B —
            // `ApiError::Conflict`'s own wire shape must stay byte-identical
            // for the 15+ other call sites that depend on it).
            ApiError::StaleRevisionShared { message, last_editor_email } => {
                return (
                    StatusCode::CONFLICT,
                    Json(serde_json::json!({ "error": message, "last_editor_email": last_editor_email })),
                )
                    .into_response();
            }
            ApiError::Internal => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
        };
        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        tracing::error!(?err, "db error");
        ApiError::Internal
    }
}
