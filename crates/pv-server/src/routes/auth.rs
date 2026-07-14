use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    Json,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use pv_core::kdf::KdfParams;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use super::session::{extract_bearer_token, SessionUser};
use crate::{crypto, error::ApiError, AppState};

const MIN_SALT_LEN: usize = 16;
/// `auth_hash` is always exactly `pv_core::keys::KEY_LEN` (32) bytes — it's
/// HKDF's `INFO_AUTH_HASH` output, a fixed-length value, not a
/// variable-length one. Reject anything else outright rather than tolerating
/// a wider [16, ...) range (WR-10).
const EXPECTED_AUTH_HASH_LEN: usize = pv_core::keys::KEY_LEN;

/// Fixed decoy salt/hash pair used only to burn the same CPU work (one
/// `server_rehash` + one `constant_time_eq`) on `login()`'s unknown-email
/// path as the known-email path does — otherwise the unknown-email branch
/// returns `Unauthorized` measurably faster, a timing oracle for email
/// enumeration on the exact endpoint whose doc-comment claims parity with
/// `prelogin()`'s T-02-04 mitigation. Values are arbitrary/non-secret; only
/// their fixed length matters.
const DUMMY_AUTH_HASH_SALT: [u8; 16] = [0u8; 16];
const DUMMY_STORED_AUTH_HASH: [u8; 32] = [0u8; 32];

#[derive(Deserialize)]
pub struct PreloginRequest {
    pub email: String,
}

#[derive(Serialize)]
pub struct PreloginResponse {
    pub kdf: KdfParams,
    /// Sól KDF (base64). Dla nieistniejących kont deterministyczna dummy sól
    /// (per-email), kształt odpowiedzi identyczny jak dla realnego konta —
    /// żeby sam kształt odpowiedzi nie zdradzał istnienia konta.
    pub salt: String,
}

/// Krok 1 logowania hasłem: klient pobiera parametry KDF i sól dla konta.
///
/// Dla nieistniejącego emaila zwraca `KdfParams::default()` + deterministyczną
/// (per-email) dummy sól zamiast innego statusu/kształtu odpowiedzi — patrz
/// threat_model T-02-05. Resztkowe ryzyko: atakujący z nieograniczoną mocą
/// obliczeniową lokalnie mógłby precomputować dummy sole per email; akceptowane
/// jako niska waga dla self-hostowanego produktu o niskiej liczbie kont, nie
/// SaaS-u narażonego na masową enumerację.
pub async fn prelogin(
    State(state): State<AppState>,
    Json(req): Json<PreloginRequest>,
) -> Result<Json<PreloginResponse>, ApiError> {
    let normalized_email = req.email.trim().to_lowercase();
    let row = sqlx::query("SELECT kdf_params, kdf_salt FROM users WHERE email = ?")
        .bind(&normalized_email)
        .fetch_optional(&state.db)
        .await?;

    if let Some(row) = row {
        let kdf_params_json: String = row.try_get("kdf_params").map_err(|_| ApiError::Internal)?;
        let kdf_salt: Vec<u8> = row.try_get("kdf_salt").map_err(|_| ApiError::Internal)?;
        let kdf: KdfParams = serde_json::from_str(&kdf_params_json).map_err(|_| ApiError::Internal)?;
        Ok(Json(PreloginResponse { kdf, salt: STANDARD.encode(kdf_salt) }))
    } else {
        let digest = Sha256::digest(normalized_email.as_bytes());
        let dummy_salt = &digest[..MIN_SALT_LEN];
        Ok(Json(PreloginResponse { kdf: KdfParams::default(), salt: STANDARD.encode(dummy_salt) }))
    }
}

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub kdf: KdfParams,
    /// base64
    pub salt: String,
    /// base64
    pub auth_hash: String,
    /// Opaque JSON (pv-core `WrappedKey`) — przekazywany na serwer bez
    /// parsowania jego wewnętrznej struktury.
    pub pw_wrapped_uk: String,
}

#[derive(Serialize)]
pub struct RegisterResponse {
    pub user_id: String,
}

/// Rejestracja konta: serwer nigdy nie widzi hasła ani klienckiego
/// `auth_hash` w postaci jawnej — przechowuje wyłącznie jego serwerowy
/// re-hash (`crate::crypto::server_rehash`), patrz threat_model T-02-06.
pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<RegisterResponse>), ApiError> {
    let normalized_email = req.email.trim().to_lowercase();
    if normalized_email.is_empty() || !normalized_email.contains('@') {
        return Err(ApiError::BadRequest("invalid email".into()));
    }
    let salt = STANDARD.decode(&req.salt).map_err(|_| ApiError::BadRequest("invalid salt encoding".into()))?;
    let client_auth_hash = STANDARD
        .decode(&req.auth_hash)
        .map_err(|_| ApiError::BadRequest("invalid auth_hash encoding".into()))?;
    if salt.len() < MIN_SALT_LEN || client_auth_hash.len() != EXPECTED_AUTH_HASH_LEN {
        return Err(ApiError::BadRequest("salt too short or auth_hash has wrong length".into()));
    }

    let id = Uuid::new_v4().to_string();
    let auth_hash_salt = pv_core::keys::random_bytes(16);
    let stored_auth_hash = crypto::server_rehash(&client_auth_hash, &auth_hash_salt);
    let kdf_params_json = serde_json::to_string(&req.kdf).map_err(|_| ApiError::Internal)?;

    // Atomowy, wolny-od-wyścigu insert: brak osobnego SELECT-then-INSERT.
    let result = sqlx::query(
        "INSERT INTO users (id, email, kdf_params, kdf_salt, pw_wrapped_uk, auth_hash, auth_hash_salt) \
         VALUES (?,?,?,?,?,?,?) ON CONFLICT(email) DO NOTHING",
    )
    .bind(&id)
    .bind(&normalized_email)
    .bind(&kdf_params_json)
    .bind(&salt)
    .bind(&req.pw_wrapped_uk)
    .bind(stored_auth_hash.as_slice())
    .bind(auth_hash_salt.as_slice())
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(ApiError::Conflict("email already registered".into()));
    }

    Ok((StatusCode::CREATED, Json(RegisterResponse { user_id: id })))
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub email: String,
    /// base64
    pub auth_hash: String,
}

#[derive(Serialize)]
pub struct LoginResponse {
    pub session_token: String,
    pub pw_wrapped_uk: String,
}

/// Weryfikacja auth_hash + wydanie sesji. Ten sam wariant `ApiError::Unauthorized`
/// (identyczny kształt odpowiedzi) dla nieistniejącego emaila i błędnego
/// auth_hash — patrz threat_model T-02-04 (brak oracle po kształcie odpowiedzi).
pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, ApiError> {
    let normalized_email = req.email.trim().to_lowercase();
    let row = sqlx::query("SELECT id, auth_hash, auth_hash_salt, pw_wrapped_uk FROM users WHERE email = ?")
        .bind(&normalized_email)
        .fetch_optional(&state.db)
        .await?;

    let row = match row {
        Some(row) => row,
        None => {
            // Unknown email: still perform a decode + rehash + constant-time
            // compare against fixed decoy values so this branch costs the
            // same as the known-email/wrong-password branch below (WR-07).
            let decoded = STANDARD.decode(&req.auth_hash).unwrap_or_default();
            let dummy_expected = crypto::server_rehash(&decoded, &DUMMY_AUTH_HASH_SALT);
            let _ = crypto::constant_time_eq(&dummy_expected, &DUMMY_STORED_AUTH_HASH);
            return Err(ApiError::Unauthorized);
        }
    };
    let user_id: String = row.try_get("id").map_err(|_| ApiError::Internal)?;
    let stored_hash: Vec<u8> = row.try_get("auth_hash").map_err(|_| ApiError::Internal)?;
    let stored_salt: Vec<u8> = row.try_get("auth_hash_salt").map_err(|_| ApiError::Internal)?;
    let pw_wrapped_uk: String = row.try_get("pw_wrapped_uk").map_err(|_| ApiError::Internal)?;

    // Malformed base64 is treated the same as a wrong hash — no distinct
    // error/status that would leak which failure mode occurred.
    let client_auth_hash = STANDARD.decode(&req.auth_hash).map_err(|_| ApiError::Unauthorized)?;
    let expected = crypto::server_rehash(&client_auth_hash, &stored_salt);

    if !crypto::constant_time_eq(&expected, &stored_hash) {
        return Err(ApiError::Unauthorized);
    }

    let token = pv_core::keys::random_bytes(32);
    let token_b64 = STANDARD.encode(&token);
    // Hash the same on-the-wire (base64) representation the bearer-token
    // extractor sees, not the raw pre-encoding bytes — otherwise every
    // session lookup would mismatch (session.rs's SessionUser extractor
    // hashes the header's base64 string, since it never decodes it).
    let token_hash = crypto::hash_token(token_b64.as_bytes());
    let session_id = Uuid::new_v4().to_string();

    // Captures the request's User-Agent for AUTH-07's per-device display
    // (`sessions.rs::list` already selects/returns this column — it was
    // simply never written, so it was always NULL). Missing/non-UTF-8
    // headers fall back to NULL rather than failing the login (WR-02).
    let user_agent = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok());

    sqlx::query(
        "INSERT INTO sessions (id, user_id, token_hash, user_agent, expires_at) \
         VALUES (?,?,?,?, datetime('now', '+' || ? || ' hours'))",
    )
    .bind(&session_id)
    .bind(&user_id)
    .bind(token_hash.as_slice())
    .bind(user_agent)
    .bind(state.session_ttl_hours as i64)
    .execute(&state.db)
    .await?;

    Ok(Json(LoginResponse { session_token: token_b64, pw_wrapped_uk }))
}

/// Kasuje bieżącą sesję po `token_hash`. Kolejne żądanie tym samym tokenem
/// (np. `/me`) dostanie 401 — patrz threat_model T-02-07.
pub async fn logout(
    State(state): State<AppState>,
    _session: SessionUser,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    let token = extract_bearer_token(&headers)?;
    let token_hash = crypto::hash_token(token.as_bytes());

    sqlx::query("DELETE FROM sessions WHERE token_hash = ?")
        .bind(token_hash.as_slice())
        .execute(&state.db)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
pub struct MeResponse {
    pub user_id: String,
    pub email: String,
    pub pw_wrapped_uk: String,
}

/// Zwraca `pw_wrapped_uk` już-uwierzytelnionej sesji — bezpieczne, bo
/// wywołujący już udowodnił posiadanie sesji przez bearer token; pozwala
/// klientowi ponownie wyprowadzić własny materiał odblokowania po reload/
/// auto-locku bez wywoływania `login` (co utworzyłoby zbędny wiersz sesji).
///
/// Dodatkowo: throttlowany (co 5 minut) update `sessions.last_used_at` dla
/// BIEŻĄCEJ sesji — 03-RESEARCH.md Pitfall 6's mitigation. Update na KAŻDYM
/// uwierzytelnionym żądaniu (np. wewnątrz ekstraktora `SessionUser`) mnożyłby
/// kontencję zapisu SQLite na każde wywołanie vault-item/folder; robienie
/// tego wyłącznie z `/me` (już wołanego przy unlock/reload w istniejącym
/// flow Fazy 2) i tylko gdy stale o 5+ minut, utrzymuje to tanio. Błąd tego
/// update'u NIE może zawalić całego żądania `/me` — loguje i kontynuuje,
/// podstawowy kontrakt `me()` (zwrócenie `pw_wrapped_uk`) jest best-effort
/// niezależny od tego pobocznego zapisu.
pub async fn me(
    State(state): State<AppState>,
    session: SessionUser,
    headers: HeaderMap,
) -> Result<Json<MeResponse>, ApiError> {
    let row = sqlx::query("SELECT email, pw_wrapped_uk FROM users WHERE id = ?")
        .bind(&session.user_id)
        .fetch_optional(&state.db)
        .await?;

    let row = row.ok_or(ApiError::Unauthorized)?;
    let email: String = row.try_get("email").map_err(|_| ApiError::Internal)?;
    let pw_wrapped_uk: String = row.try_get("pw_wrapped_uk").map_err(|_| ApiError::Internal)?;

    if let Ok(token) = extract_bearer_token(&headers) {
        let token_hash = crypto::hash_token(token.as_bytes());
        let update_result = sqlx::query(
            "UPDATE sessions SET last_used_at = datetime('now') \
             WHERE token_hash = ? AND (last_used_at IS NULL OR last_used_at < datetime('now', '-5 minutes'))",
        )
        .bind(token_hash.as_slice())
        .execute(&state.db)
        .await;
        if let Err(err) = update_result {
            tracing::warn!(?err, "failed to update session last_used_at (best-effort, non-fatal)");
        }
    }

    Ok(Json(MeResponse { user_id: session.user_id, email, pw_wrapped_uk }))
}
