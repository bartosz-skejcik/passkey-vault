//! `/api/extension-passkeys` — CRUD dla opaque blobu extension-scoped
//! passkeya (09-CONTEXT AMENDMENT 2026-07-15). Wszystkie handlery za
//! `SessionUser`. Serwer NIE weryfikuje żadnej ceremonii uwierzytelniania —
//! rejestracja używa attestation 'none' po stronie klienta, a asercje
//! odblokowania nigdy nie są wysyłane do serwera do weryfikacji (wynik PRF
//! JEST sekretem; serwer tylko przechowuje/serwuje nieprzezroczysty
//! wrapped-UK blob per credential). Brak zależności od crate'a ceremonii
//! FIDO2 przez zamysł — nie ma tu żadnej ceremonii do przeprowadzenia.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use super::session::SessionUser;
use crate::{error::ApiError, AppState};

#[derive(Deserialize)]
pub struct CreateExtensionPasskeyRequest {
    /// base64url (URL_SAFE_NO_PAD) — the credential's raw id.
    pub credential_id: String,
    /// base64 (STANDARD) — public PRF salt, not secret.
    pub prf_salt: String,
    /// Opaque `WrappedKey`-shaped JSON — server never parses its contents
    /// (zero-knowledge boundary, same as passkeys.rs's prf_wrapped_uk).
    pub prf_wrapped_uk: String,
}

#[derive(Serialize)]
pub struct CreateExtensionPasskeyResponse {
    pub id: String,
}

/// `POST /api/extension-passkeys` — insert a new opaque recipient blob.
/// Trim-then-check validation (mirrors passkeys.rs::rename's style — no
/// regex). `ON CONFLICT(credential_id) DO NOTHING RETURNING id` makes
/// duplicate-credential detection race-free (mirrors
/// passkeys.rs::register_finish's exact pattern).
pub async fn create(
    State(state): State<AppState>,
    session: SessionUser,
    Json(req): Json<CreateExtensionPasskeyRequest>,
) -> Result<Json<CreateExtensionPasskeyResponse>, ApiError> {
    let credential_id_trimmed = req.credential_id.trim();
    let prf_wrapped_uk_trimmed = req.prf_wrapped_uk.trim();
    if credential_id_trimmed.is_empty() || prf_wrapped_uk_trimmed.is_empty() {
        return Err(ApiError::BadRequest("credential_id and prf_wrapped_uk must be non-empty".into()));
    }

    let credential_id = URL_SAFE_NO_PAD
        .decode(credential_id_trimmed)
        .map_err(|_| ApiError::BadRequest("credential_id must be valid base64url".into()))?;
    let prf_salt = STANDARD
        .decode(req.prf_salt.trim())
        .map_err(|_| ApiError::BadRequest("prf_salt must be valid base64".into()))?;

    let id = Uuid::new_v4().to_string();

    // Race-free atomic insert — mirrors vault.rs::create's/
    // passkeys.rs::register_finish's ON-CONFLICT-RETURNING pattern. A `None`
    // result means this credential_id already exists for SOME user (BLOB
    // UNIQUE is global, not per-user — mirrors passkeys.rs's own
    // credential_id UNIQUE constraint, since a real hardware credential id
    // collision across users is astronomically unlikely and would indicate
    // something wrong regardless of which user).
    let result = sqlx::query(
        "INSERT INTO extension_passkeys (id, user_id, credential_id, prf_salt, prf_wrapped_uk, created_at) \
         VALUES (?, ?, ?, ?, ?, datetime('now')) \
         ON CONFLICT(credential_id) DO NOTHING \
         RETURNING id",
    )
    .bind(&id)
    .bind(&session.user_id)
    .bind(&credential_id)
    .bind(&prf_salt)
    .bind(prf_wrapped_uk_trimmed)
    .fetch_optional(&state.db)
    .await?;

    if result.is_none() {
        return Err(ApiError::Conflict("credential already registered".into()));
    }

    Ok(Json(CreateExtensionPasskeyResponse { id }))
}

#[derive(Serialize)]
pub struct ExtensionPasskeyRow {
    /// base64url (URL_SAFE_NO_PAD).
    pub credential_id: String,
    /// base64 (STANDARD).
    pub prf_salt: String,
    /// Opaque `WrappedKey`-shaped JSON, byte-identical to what was POSTed.
    pub prf_wrapped_uk: String,
    pub created_at: String,
}

/// `GET /api/extension-passkeys` — only the authenticated user's own rows,
/// never a client-supplied user id (mirrors vault.rs::list).
pub async fn list(
    State(state): State<AppState>,
    session: SessionUser,
) -> Result<Json<Vec<ExtensionPasskeyRow>>, ApiError> {
    let rows = sqlx::query(
        "SELECT credential_id, prf_salt, prf_wrapped_uk, created_at FROM extension_passkeys WHERE user_id = ? ORDER BY created_at",
    )
    .bind(&session.user_id)
    .fetch_all(&state.db)
    .await?;

    let passkeys = rows
        .into_iter()
        .map(|row| {
            let credential_id: Vec<u8> = row.try_get("credential_id").map_err(|_| ApiError::Internal)?;
            let prf_salt: Vec<u8> = row.try_get("prf_salt").map_err(|_| ApiError::Internal)?;
            Ok(ExtensionPasskeyRow {
                credential_id: URL_SAFE_NO_PAD.encode(&credential_id),
                prf_salt: STANDARD.encode(&prf_salt),
                prf_wrapped_uk: row.try_get("prf_wrapped_uk").map_err(|_| ApiError::Internal)?,
                created_at: row.try_get("created_at").map_err(|_| ApiError::Internal)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(passkeys))
}

/// `DELETE /api/extension-passkeys/{credential_id}` — `credential_id` path
/// param is base64url-encoded. No pw_wrapped_uk stranding guard needed here
/// (unlike passkeys.rs::delete_passkey): the extension passkey is never the
/// only recipient — enrollment structurally requires an already-unlocked
/// (hence password-wrapped) vault.
pub async fn delete_credential(
    State(state): State<AppState>,
    session: SessionUser,
    Path(credential_id_b64): Path<String>,
) -> Result<StatusCode, ApiError> {
    let credential_id = URL_SAFE_NO_PAD
        .decode(credential_id_b64.trim())
        .map_err(|_| ApiError::BadRequest("credential_id must be valid base64url".into()))?;

    let result = sqlx::query("DELETE FROM extension_passkeys WHERE credential_id = ? AND user_id = ?")
        .bind(&credential_id)
        .bind(&session.user_id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    Ok(StatusCode::NO_CONTENT)
}
