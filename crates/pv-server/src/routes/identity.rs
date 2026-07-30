//! `/api/identity/*` — an account's X25519 identity keypair, KEY-01's server
//! half (the crypto itself is `pv_core::identity`, Phase 21). Generowanie
//! jest wyłącznie client-side (patrz `pv-core/src/identity.rs`'s own doc
//! comment) — serwer nigdy nie widzi `UserKey`, więc nie może samodzielnie
//! wygenerować ani odpieczętować klucza prywatnego.
//!
//! **This module MUST NEVER call `pv_core::identity`'s asymmetric
//! sealed-box helpers (the `seal`/`unseal`/`unseal_collection_key` trio), nor
//! its secret-key-unwrap helper (the fn that takes a `UserKey` and a wrapped
//! blob and hands back the caller's plaintext identity secret key)** — it
//! only stores/serves opaque `public_key BLOB` / `wrapped_secret_key TEXT`
//! columns (zero-knowledge boundary; SEC-06/KEY-01, CONTEXT.md's Claude's
//! Discretion #1). The one `pv_core::identity` call this module DOES make
//! (`IdentityPublicKey::from_bytes` in `upsert` below) validates only the
//! public ENCODING of client-submitted bytes (length + small-order
//! rejection) — it never touches, unwraps, or unseals anything, so it does
//! not cross the line this doc comment draws.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sqlx::Row;

use super::session::SessionUser;
use super::vault::validate_blob_len;
use crate::{error::ApiError, AppState};

#[derive(Deserialize)]
pub struct KeypairRequest {
    /// base64-`STANDARD`-encoded 32-byte X25519 public key.
    pub public_key: String,
    /// Opaque `WrappedKey`-shaped JSON, produced client-side under the
    /// caller's own `UserKey` — never parsed or unwrapped server-side.
    pub wrapped_secret_key: String,
}

#[derive(Serialize)]
pub struct KeypairResponse {
    pub public_key: String,
    pub wrapped_secret_key: String,
    /// `true` when the values in this response are NOT what the caller just
    /// submitted — signaling "a different device already published a
    /// keypair; discard what you just generated locally and adopt this one
    /// instead." Always `false` on a plain `GET` (included only for
    /// response-shape consistency with `PUT` — meaningless there since there
    /// is no submission to compare against).
    pub adopted_existing: bool,
}

/// `PUT /api/identity/keypair` — idempotent, self-healing upsert
/// (22-RESEARCH.md "KEY-01 idempotent-upsert-with-self-healing pattern"). Two
/// devices of the same account racing to generate a keypair resolve
/// deterministically: the loser's response carries the winner's canonical
/// values with `adopted_existing: true`, and the loser can locally unseal the
/// winner's `wrapped_secret_key` (it's wrapped under this account's own
/// `UserKey`, identical across every device of the account — see module doc
/// comment) rather than needing any coordination protocol.
pub async fn upsert(
    State(state): State<AppState>,
    session: SessionUser,
    Json(req): Json<KeypairRequest>,
) -> Result<Json<KeypairResponse>, ApiError> {
    let decoded = STANDARD
        .decode(&req.public_key)
        .map_err(|_| ApiError::BadRequest("public_key must be valid base64".into()))?;
    let raw_public_key_bytes: [u8; 32] = decoded
        .try_into()
        .map_err(|_| ApiError::BadRequest("public_key must decode to exactly 32 bytes".into()))?;

    // Server-side sanity check only (defense in depth per 22-RESEARCH.md) —
    // validates the public ENCODING (length already checked above,
    // small-order rejection here), never provenance. Does NOT unwrap or
    // unseal anything — see this module's doc comment.
    pv_core::identity::IdentityPublicKey::from_bytes(raw_public_key_bytes)
        .map_err(|_| ApiError::BadRequest("invalid public key".into()))?;

    validate_blob_len("wrapped_secret_key", &req.wrapped_secret_key)?;

    let mut tx = state.db.begin().await?;

    let inserted = sqlx::query(
        "INSERT INTO user_keypairs (user_id, public_key, wrapped_secret_key) VALUES (?, ?, ?) \
         ON CONFLICT(user_id) DO NOTHING \
         RETURNING public_key, wrapped_secret_key",
    )
    .bind(&session.user_id)
    .bind(raw_public_key_bytes.as_slice())
    .bind(&req.wrapped_secret_key)
    .fetch_optional(&mut *tx)
    .await?;

    let (canonical_public_key, canonical_wrapped_secret_key, adopted_existing) = match inserted {
        // The caller's own submission won the race (or there was no race at
        // all) — nothing to adopt.
        Some(row) => {
            let public_key: Vec<u8> = row.try_get("public_key").map_err(|_| ApiError::Internal)?;
            let wrapped_secret_key: String =
                row.try_get("wrapped_secret_key").map_err(|_| ApiError::Internal)?;
            (public_key, wrapped_secret_key, false)
        }
        // Lost the race (or resubmitting after an earlier winning call): a
        // keypair for this account already exists. Fetch and return THAT
        // one — see this fn's doc comment for why any device can unwrap it.
        None => {
            let row = sqlx::query("SELECT public_key, wrapped_secret_key FROM user_keypairs WHERE user_id = ?")
                .bind(&session.user_id)
                .fetch_one(&mut *tx)
                .await?;
            let public_key: Vec<u8> = row.try_get("public_key").map_err(|_| ApiError::Internal)?;
            let wrapped_secret_key: String =
                row.try_get("wrapped_secret_key").map_err(|_| ApiError::Internal)?;
            let adopted_existing = public_key != raw_public_key_bytes.as_slice();
            (public_key, wrapped_secret_key, adopted_existing)
        }
    };

    tx.commit().await?;

    Ok(Json(KeypairResponse {
        public_key: STANDARD.encode(&canonical_public_key),
        wrapped_secret_key: canonical_wrapped_secret_key,
        adopted_existing,
    }))
}

/// `GET /api/identity/keypair` — `404` when the caller has not published a
/// keypair yet.
pub async fn get(State(state): State<AppState>, session: SessionUser) -> Result<Json<KeypairResponse>, ApiError> {
    let row = sqlx::query("SELECT public_key, wrapped_secret_key FROM user_keypairs WHERE user_id = ?")
        .bind(&session.user_id)
        .fetch_optional(&state.db)
        .await?;

    let row = row.ok_or(ApiError::NotFound)?;
    let public_key: Vec<u8> = row.try_get("public_key").map_err(|_| ApiError::Internal)?;
    let wrapped_secret_key: String = row.try_get("wrapped_secret_key").map_err(|_| ApiError::Internal)?;

    Ok(Json(KeypairResponse {
        public_key: STANDARD.encode(&public_key),
        wrapped_secret_key,
        adopted_existing: false,
    }))
}

/// `POST /api/identity/verify/{user_id}` — the CALLER (viewer) marks
/// `user_id` (the subject) as verified. Idempotent: a repeat call refreshes
/// `verified_at` on the same `(viewer_user_id, subject_user_id)` row rather
/// than erroring or duplicating. Intentionally scoped to "any registered
/// user", not gated by family membership — CONTEXT.md's Carried Product
/// Decision only requires the data to exist and be per-viewer, and v0.4 has
/// exactly one family anyway (FAM-01), so an out-of-family verification is
/// inert (no route ever surfaces a non-family member's fingerprint to
/// compare against) rather than a real widening of scope.
pub async fn verify(
    State(state): State<AppState>,
    session: SessionUser,
    Path(subject_user_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let target_exists = sqlx::query("SELECT 1 FROM users WHERE id = ?")
        .bind(&subject_user_id)
        .fetch_optional(&state.db)
        .await?;
    if target_exists.is_none() {
        return Err(ApiError::NotFound);
    }

    sqlx::query(
        "INSERT INTO identity_verifications (viewer_user_id, subject_user_id) VALUES (?, ?) \
         ON CONFLICT(viewer_user_id, subject_user_id) DO UPDATE SET verified_at = datetime('now')",
    )
    .bind(&session.user_id)
    .bind(&subject_user_id)
    .execute(&state.db)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}
