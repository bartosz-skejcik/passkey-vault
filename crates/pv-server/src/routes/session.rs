//! `SessionUser` — axum `FromRequestParts` ekstraktor walidujący opaque
//! bearer token przeciw `sessions.token_hash`. Jedyna granica między
//! anonimowym a uwierzytelnionym żądaniem (patrz threat_model T-02-07).

use axum::{
    extract::FromRequestParts,
    http::{header, request::Parts, HeaderMap},
};
use sqlx::Row;

use crate::{crypto, error::ApiError, AppState};

pub struct SessionUser {
    pub user_id: String,
}

impl FromRequestParts<AppState> for SessionUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token = extract_bearer_token(&parts.headers)?;
        let user_id = validate_token(&state.db, &token).await?;
        Ok(SessionUser { user_id })
    }
}

/// Additive sibling of `SessionUser` — an invite-redemption route (Plan
/// 24-02) must behave identically whether the caller has a session or not,
/// without weakening `SessionUser` itself (every other authenticated route
/// depends on it staying strictly required). Wraps `SessionUser::
/// from_request_parts`'s own call and converts its `Err` into `Ok(None)`;
/// never modifies `SessionUser`. Safe to extract a second time on the same
/// request: `SessionUser::from_request_parts` only reads `parts.headers` and
/// queries the DB, it never consumes/mutates `parts` in a way a second
/// extraction couldn't repeat (verified against axum 0.8.9 — RESEARCH.md
/// Pattern 3).
pub struct OptionalSessionUser(pub Option<SessionUser>);

impl FromRequestParts<AppState> for OptionalSessionUser {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        match SessionUser::from_request_parts(parts, state).await {
            Ok(session) => Ok(OptionalSessionUser(Some(session))),
            Err(_) => Ok(OptionalSessionUser(None)),
        }
    }
}

/// Hash-then-lookup-with-expiry logic shared by `SessionUser`'s REST auth
/// path and `sync::ws_handler`'s `?token=` query-param auth path (05-02-PLAN
/// Task 1) — exactly one place session-token validation lives, so the WS
/// upgrade handshake can never drift from the REST `Authorization` header
/// path's semantics (expiry, hash algorithm, rejection code).
pub(crate) async fn validate_token(db: &sqlx::SqlitePool, token: &str) -> Result<String, ApiError> {
    let token_hash = crypto::hash_token(token.as_bytes());

    let row = sqlx::query("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')")
        .bind(token_hash.as_slice())
        .fetch_optional(db)
        .await?;

    let row = row.ok_or(ApiError::Unauthorized)?;
    let user_id: String = row.try_get("user_id").map_err(|_| ApiError::Internal)?;
    Ok(user_id)
}

/// Wyciąga surowy token z nagłówka `Authorization: Bearer <token>`. Wydzielone
/// jako helper przyjmujący `&HeaderMap` (nie `&Parts`), żeby `logout` — który
/// potrzebuje samego tokenu do skasowania wiersza sesji, nie tylko `user_id`,
/// a więc bierze `SessionUser` I osobno `HeaderMap` w tym samym handlerze —
/// nie musiał duplikować parsowania nagłówka.
pub fn extract_bearer_token(headers: &HeaderMap) -> Result<String, ApiError> {
    let auth = headers.get(header::AUTHORIZATION).ok_or(ApiError::Unauthorized)?;
    let token = auth.to_str().ok().and_then(|s| s.strip_prefix("Bearer ")).ok_or(ApiError::Unauthorized)?;
    Ok(token.to_string())
}
