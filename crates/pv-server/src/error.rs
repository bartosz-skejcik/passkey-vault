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
