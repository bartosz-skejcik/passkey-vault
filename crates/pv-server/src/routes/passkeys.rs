//! `/api/passkeys/*` — dwuceremonialna rejestracja passkeya (AUTH-03).
//!
//! Trzy handlery, wszystkie za `SessionUser` (nigdy nie ufamy `user_id` z
//! path/body). `register_finish` osadza drugą ceremonię (autentykacja)
//! bezpośrednio w tej samej odpowiedzi (03-RESEARCH.md Open Question 1) —
//! `just-finished` `Passkey` jest już w scope, więc nie ma osobnego round
//! tripu ani re-fetchu z bazy. `prf_wrap` jest jedynym miejscem, które
//! naprawdę weryfikuje drugą ceremonię (`finish_passkey_authentication`) —
//! nigdy nie ufamy przesłanemu `prf_wrapped_uk` tylko na podstawie sesji
//! Bearer (threat_model T-03-01).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;
use webauthn_rs::prelude::{
    CreationChallengeResponse, CredentialID, Passkey, PasskeyAuthentication, PasskeyRegistration,
    PublicKeyCredential, RegisterPublicKeyCredential, RequestChallengeResponse,
};

use super::session::SessionUser;
use super::webauthn_state;
use crate::{error::ApiError, AppState};

#[derive(Deserialize)]
pub struct RegisterStartRequest {
    pub display_name: String,
}

/// What actually gets persisted in `webauthn_states.state_json` for a
/// `registration`-type row: the real ceremony state PLUS the display name
/// entered at `register/start`, since `register/finish`'s request body
/// carries only `state_id`/`credential` (see `register_start`'s doc comment
/// on `persisted`).
#[derive(Serialize, Deserialize)]
struct PersistedRegistrationState {
    reg: PasskeyRegistration,
    display_name: String,
}

#[derive(Serialize)]
pub struct RegisterStartResponse {
    pub state_id: String,
    pub challenge: CreationChallengeResponse,
    /// base64 (standard) — sól publiczna, nie sekret; patrz pv-core::prf.
    pub prf_salt: String,
}

/// `POST /api/passkeys/register/start` — rozpoczyna pierwszą ceremonię
/// (`create()`). Persystuje `PasskeyRegistration` w `webauthn_states`
/// (nigdy w pamięci procesu — 03-CONTEXT.md).
pub async fn register_start(
    State(state): State<AppState>,
    session: SessionUser,
    Json(req): Json<RegisterStartRequest>,
) -> Result<Json<RegisterStartResponse>, ApiError> {
    let user_row = sqlx::query("SELECT email FROM users WHERE id = ?")
        .bind(&session.user_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::Internal)?;
    let email: String = user_row.try_get("email").map_err(|_| ApiError::Internal)?;

    let existing_rows = sqlx::query("SELECT credential_id FROM passkeys WHERE user_id = ?")
        .bind(&session.user_id)
        .fetch_all(&state.db)
        .await?;
    let exclude: Vec<CredentialID> = existing_rows
        .into_iter()
        .map(|row| {
            let bytes: Vec<u8> = row.try_get("credential_id").map_err(|_| ApiError::Internal)?;
            Ok(CredentialID::from(bytes))
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    let user_uuid = Uuid::parse_str(&session.user_id).map_err(|_| ApiError::Internal)?;
    let (challenge, reg_state) = state
        .webauthn
        .start_passkey_registration(user_uuid, &email, &req.display_name, Some(exclude))
        .map_err(|e| {
            tracing::warn!(?e, "passkey registration start failed");
            ApiError::BadRequest("passkey ceremony failed".into())
        })?;

    // Public metadata (not secret) — server is the single source of truth
    // future PRF evals must reuse; never trust a client-supplied salt.
    let prf_salt = pv_core::keys::random_bytes(32);
    // Wrap the display name entered here alongside `PasskeyRegistration` —
    // `register/finish` never re-receives `display_name` from the client
    // (only `state_id`/`credential`), so it must round-trip through the
    // persisted `webauthn_states.state_json` blob to reach the INSERT and
    // the response's `name` field.
    let persisted = PersistedRegistrationState { reg: reg_state, display_name: req.display_name.clone() };
    let reg_state_json = serde_json::to_string(&persisted).map_err(|_| ApiError::Internal)?;
    let state_id = webauthn_state::persist_state(
        &state.db,
        &session.user_id,
        "registration",
        &reg_state_json,
        Some(&prf_salt),
        None,
    )
    .await?;

    Ok(Json(RegisterStartResponse {
        state_id,
        challenge,
        prf_salt: STANDARD.encode(&prf_salt),
    }))
}

#[derive(Deserialize)]
pub struct RegisterFinishRequest {
    pub state_id: String,
    pub credential: RegisterPublicKeyCredential,
}

#[derive(Serialize)]
pub struct RegisterFinishResponse {
    pub passkey_id: String,
    pub name: String,
    pub prf_challenge: RequestChallengeResponse,
    pub prf_state_id: String,
    /// base64 (standard)
    pub prf_salt: String,
}

/// `POST /api/passkeys/register/finish` — verifies the `create()` response,
/// inserts one `passkeys` row (`prf_capable = 0`), then immediately starts
/// (and persists) the second-ceremony authentication challenge in the SAME
/// response — no separate round trip (03-RESEARCH.md Open Question 1).
pub async fn register_finish(
    State(state): State<AppState>,
    session: SessionUser,
    Json(req): Json<RegisterFinishRequest>,
) -> Result<Json<RegisterFinishResponse>, ApiError> {
    let (reg_state_json, prf_salt, _) =
        webauthn_state::consume_state(&state.db, &session.user_id, &req.state_id, "registration").await?;
    let persisted: PersistedRegistrationState =
        serde_json::from_str(&reg_state_json).map_err(|_| ApiError::Internal)?;

    let passkey = state
        .webauthn
        .finish_passkey_registration(&req.credential, &persisted.reg)
        .map_err(|e| {
            // Log the crate's own error enum only — never the raw request
            // body, which may contain attestation material (threat_model
            // T-03-05).
            tracing::warn!(?e, "passkey registration finish failed");
            ApiError::BadRequest("passkey ceremony failed".into())
        })?;

    let passkey_id = Uuid::new_v4().to_string();
    let passkey_json = serde_json::to_string(&passkey).map_err(|_| ApiError::Internal)?;

    // Race-free atomic insert (mirrors vault.rs::create's ON-CONFLICT-
    // RETURNING pattern) — a `None` result means a real hardware credential
    // id collision (astronomically unlikely).
    let result = sqlx::query(
        "INSERT INTO passkeys (id, user_id, credential_id, passkey_json, name, prf_salt, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, datetime('now')) \
         ON CONFLICT(credential_id) DO NOTHING \
         RETURNING id",
    )
    .bind(&passkey_id)
    .bind(&session.user_id)
    .bind(passkey.cred_id().as_ref())
    .bind(&passkey_json)
    .bind(&persisted.display_name)
    .bind(prf_salt.as_deref())
    .fetch_optional(&state.db)
    .await?;

    if result.is_none() {
        return Err(ApiError::Conflict("credential already registered".into()));
    }

    // Second ceremony, in-process, no re-read from DB — the just-finished
    // `Passkey` value is already in scope (03-RESEARCH.md Open Question 1).
    let (prf_challenge, auth_state) = state
        .webauthn
        .start_passkey_authentication(std::slice::from_ref(&passkey))
        .map_err(|e| {
            tracing::warn!(?e, "second-ceremony authentication start failed");
            ApiError::BadRequest("passkey ceremony failed".into())
        })?;
    let auth_state_json = serde_json::to_string(&auth_state).map_err(|_| ApiError::Internal)?;
    let prf_state_id = webauthn_state::persist_state(
        &state.db,
        &session.user_id,
        "authentication",
        &auth_state_json,
        prf_salt.as_deref(),
        Some(&passkey_id),
    )
    .await?;

    Ok(Json(RegisterFinishResponse {
        passkey_id,
        name: persisted.display_name,
        prf_challenge,
        prf_state_id,
        prf_salt: STANDARD.encode(prf_salt.unwrap_or_default()),
    }))
}

#[derive(Deserialize)]
pub struct PrfWrapRequest {
    pub state_id: String,
    pub credential: PublicKeyCredential,
    /// Opaque `WrappedKey`-shaped JSON — server never parses its contents
    /// (zero-knowledge boundary, same as vault.rs's enc_key/enc_data).
    pub prf_wrapped_uk: String,
}

#[derive(Serialize)]
pub struct PrfWrapResponse {
    pub prf_capable: bool,
}

/// `POST /api/passkeys/:id/prf-wrap` — the real assertion-verification gate
/// (threat_model T-03-01 / 03-RESEARCH.md Pitfall 4). A stolen bearer token
/// alone cannot flip `prf_capable`/`prf_wrapped_uk` without a genuine signed
/// assertion from the actual enrolled credential.
pub async fn prf_wrap(
    State(state): State<AppState>,
    session: SessionUser,
    Path(id): Path<String>,
    Json(req): Json<PrfWrapRequest>,
) -> Result<Json<PrfWrapResponse>, ApiError> {
    let (auth_state_json, _, passkey_id_opt) =
        webauthn_state::consume_state(&state.db, &session.user_id, &req.state_id, "authentication").await?;

    // The state row's OWN passkey_id (not just the path param) must match —
    // this is what actually scopes the second ceremony to the specific
    // credential rather than trusting the path alone.
    if passkey_id_opt.as_deref() != Some(id.as_str()) {
        return Err(ApiError::BadRequest("passkey ceremony state does not match credential".into()));
    }

    let auth_state: PasskeyAuthentication =
        serde_json::from_str(&auth_state_json).map_err(|_| ApiError::Internal)?;

    let row = sqlx::query("SELECT passkey_json FROM passkeys WHERE id = ? AND user_id = ?")
        .bind(&id)
        .bind(&session.user_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::NotFound)?;
    let passkey_json: String = row.try_get("passkey_json").map_err(|_| ApiError::Internal)?;
    let mut passkey: Passkey = serde_json::from_str(&passkey_json).map_err(|_| ApiError::Internal)?;

    // The real ceremony-verification gate — cryptographically proves the
    // request came from a browser that completed a valid assertion with
    // this specific enrolled credential.
    let auth_result = state
        .webauthn
        .finish_passkey_authentication(&req.credential, &auth_state)
        .map_err(|e| {
            tracing::warn!(?e, "prf-wrap assertion verification failed");
            ApiError::BadRequest("passkey ceremony failed".into())
        })?;

    // Updates counter/backup flags per the crate's own recommendation.
    let _ = passkey.update_credential(&auth_result);
    let updated_passkey_json = serde_json::to_string(&passkey).map_err(|_| ApiError::Internal)?;

    sqlx::query(
        "UPDATE passkeys SET prf_wrapped_uk = ?, prf_capable = 1, passkey_json = ?, last_used_at = datetime('now') \
         WHERE id = ? AND user_id = ?",
    )
    .bind(&req.prf_wrapped_uk)
    .bind(&updated_passkey_json)
    .bind(&id)
    .bind(&session.user_id)
    .execute(&state.db)
    .await?;

    Ok(Json(PrfWrapResponse { prf_capable: true }))
}

#[derive(Serialize)]
pub struct PasskeyRow {
    pub id: String,
    pub name: String,
    pub prf_capable: bool,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

/// `GET /api/passkeys` — only the authenticated user's own enrolled
/// passkeys, never a client-supplied user id (mirrors `vault.rs::list`).
pub async fn list(State(state): State<AppState>, session: SessionUser) -> Result<Json<Vec<PasskeyRow>>, ApiError> {
    let rows = sqlx::query(
        "SELECT id, name, prf_capable, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at",
    )
    .bind(&session.user_id)
    .fetch_all(&state.db)
    .await?;

    let passkeys = rows
        .into_iter()
        .map(|row| {
            let prf_capable: i64 = row.try_get("prf_capable").map_err(|_| ApiError::Internal)?;
            Ok(PasskeyRow {
                id: row.try_get("id").map_err(|_| ApiError::Internal)?,
                name: row.try_get("name").map_err(|_| ApiError::Internal)?,
                prf_capable: prf_capable != 0,
                created_at: row.try_get("created_at").map_err(|_| ApiError::Internal)?,
                last_used_at: row.try_get("last_used_at").map_err(|_| ApiError::Internal)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(passkeys))
}

#[derive(Deserialize)]
pub struct RenameRequest {
    pub name: String,
}

/// `PATCH /api/passkeys/{id}` — rename a passkey. Trim-then-check (mirrors
/// `auth.rs::register`'s email-validation style, not a regex).
pub async fn rename(
    State(state): State<AppState>,
    session: SessionUser,
    Path(id): Path<String>,
    Json(req): Json<RenameRequest>,
) -> Result<StatusCode, ApiError> {
    let trimmed = req.name.trim();
    if trimmed.is_empty() || trimmed.len() > 100 {
        return Err(ApiError::BadRequest("name must be 1-100 characters".into()));
    }

    let result = sqlx::query("UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?")
        .bind(trimmed)
        .bind(&id)
        .bind(&session.user_id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    Ok(StatusCode::NO_CONTENT)
}

/// `DELETE /api/passkeys/{id}` — AUTH-05's server-enforced no-stranding
/// guard: re-verifies the CALLER's own `pw_wrapped_uk` exists BEFORE issuing
/// any DELETE (03-RESEARCH.md Architecture Pattern 3, defense-in-depth on
/// top of the schema's `NOT NULL` constraint). In v0.1 this branch is
/// unreachable through any real user flow — registration always sets
/// `pw_wrapped_uk` and no endpoint ever clears it — but the guard exists and
/// must be independently testable anyway, per AUTH-05.
pub async fn delete_passkey(
    State(state): State<AppState>,
    session: SessionUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let row = sqlx::query("SELECT pw_wrapped_uk FROM users WHERE id = ?")
        .bind(&session.user_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::Internal)?;
    let pw_wrapped_uk: String = row.try_get("pw_wrapped_uk").map_err(|_| ApiError::Internal)?;
    if pw_wrapped_uk.is_empty() {
        return Err(ApiError::Conflict("would strand vault: no password recovery wrap".into()));
    }

    let result = sqlx::query("DELETE FROM passkeys WHERE id = ? AND user_id = ?")
        .bind(&id)
        .bind(&session.user_id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    Ok(StatusCode::NO_CONTENT)
}
