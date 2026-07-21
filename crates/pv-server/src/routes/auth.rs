use std::collections::HashMap;

use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    Json,
};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use pv_core::kdf::KdfParams;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;
use webauthn_rs::prelude::{Passkey, PasskeyAuthentication, PublicKeyCredential};

use super::passkeys::handle_finish_auth_error;
use super::session::{extract_bearer_token, SessionUser};
use super::webauthn_state;
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

#[derive(Deserialize)]
pub struct PasskeyLoginStartRequest {
    pub email: String,
}

#[derive(Serialize)]
pub struct PasskeyLoginStartResponse {
    pub state_id: String,
    /// `serde_json::to_value(&RequestChallengeResponse)` on the real path,
    /// or a hand-built literal matching only its WIRE shape on the dummy
    /// path — never `webauthn-rs`'s own (opaque) internal types constructed
    /// by hand (04-RESEARCH.md "Don't Hand-Roll").
    pub challenge: serde_json::Value,
    /// KEY = `URL_SAFE_NO_PAD`-encoded credential id (matches
    /// `challenge.publicKey.allowCredentials[i].id`'s own encoding), VALUE =
    /// `STANDARD`-encoded PRF salt. Only `prf_capable` rows contribute an
    /// entry — a non-PRF credential can still complete a login, but has no
    /// salt to offer (04-RESEARCH.md Pitfall 2).
    pub prf_salts: HashMap<String, String>,
}

/// Krok 1 unauthenticated passkey-login: rozpoczyna ceremonię `get()` dla
/// WSZYSTKICH zarejestrowanych passkeyów użytkownika (nie tylko
/// `prf_capable` — AUTH-04's "any enrolled passkey can log in" wymóg,
/// niezależnie od tego czy odblokuje też vault). Nieznany email LUB znany
/// email bez żadnego passkeya trafiają w tę samą dummy gałąź poniżej —
/// kształt odpowiedzi musi być nierozróżnialny (threat_model T-04-01).
pub async fn passkey_login_start(
    State(state): State<AppState>,
    Json(req): Json<PasskeyLoginStartRequest>,
) -> Result<Json<PasskeyLoginStartResponse>, ApiError> {
    let normalized_email = req.email.trim().to_lowercase();

    let user_row = sqlx::query("SELECT id FROM users WHERE email = ?")
        .bind(&normalized_email)
        .fetch_optional(&state.db)
        .await?;

    let user_id = match user_row {
        Some(row) => row.try_get::<String, _>("id").map_err(|_| ApiError::Internal)?,
        None => {
            return Ok(Json(dummy_passkey_login_start_response(
                &state.rp_id,
                &normalized_email,
                &state.dummy_secret,
            )))
        }
    };

    let passkey_rows = sqlx::query(
        "SELECT credential_id, passkey_json, prf_salt, prf_capable FROM passkeys WHERE user_id = ?",
    )
    .bind(&user_id)
    .fetch_all(&state.db)
    .await?;

    if passkey_rows.is_empty() {
        // Same dummy branch as an unknown email — zero enrolled passkeys
        // must not distinguish a known account from an unknown one
        // (threat_model T-04-01).
        return Ok(Json(dummy_passkey_login_start_response(
            &state.rp_id,
            &normalized_email,
            &state.dummy_secret,
        )));
    }

    let mut passkeys = Vec::with_capacity(passkey_rows.len());
    let mut prf_salts = HashMap::new();
    for row in &passkey_rows {
        let passkey_json: String = row.try_get("passkey_json").map_err(|_| ApiError::Internal)?;
        let passkey: Passkey = serde_json::from_str(&passkey_json).map_err(|_| ApiError::Internal)?;
        passkeys.push(passkey);

        let prf_capable: i64 = row.try_get("prf_capable").map_err(|_| ApiError::Internal)?;
        let prf_salt: Option<Vec<u8>> = row.try_get("prf_salt").map_err(|_| ApiError::Internal)?;
        if prf_capable != 0 {
            if let Some(prf_salt) = prf_salt {
                let credential_id: Vec<u8> = row.try_get("credential_id").map_err(|_| ApiError::Internal)?;
                // KEY must be URL_SAFE_NO_PAD (matches webauthn-rs's own
                // Base64UrlSafeData wire encoding of credential ids) — this
                // codebase's usual STANDARD engine would silently never
                // match any real credential (04-RESEARCH.md Pitfall 2).
                prf_salts.insert(URL_SAFE_NO_PAD.encode(&credential_id), STANDARD.encode(&prf_salt));
            }
        }
    }

    let (challenge, auth_state) = state.webauthn.start_passkey_authentication(&passkeys).map_err(|e| {
        tracing::warn!(?e, "passkey-login start failed");
        ApiError::BadRequest("passkey ceremony failed".into())
    })?;
    let auth_state_json = serde_json::to_string(&auth_state).map_err(|_| ApiError::Internal)?;
    // Both trailing args None: there is no single prf_salt/passkey_id for a
    // multi-credential ceremony — the salts already live in this response's
    // own prf_salts field, and finish() re-derives the matched credential's
    // own prf_wrapped_uk fresh from the passkeys table after
    // auth_result.cred_id() resolves it (04-RESEARCH.md Pattern 3).
    let state_id =
        webauthn_state::persist_state(&state.db, &user_id, "authentication", &auth_state_json, None, None).await?;

    Ok(Json(PasskeyLoginStartResponse {
        state_id,
        challenge: serde_json::to_value(&challenge).map_err(|_| ApiError::Internal)?,
        prf_salts,
    }))
}

/// Enumeration-resistant dummy `passkey-login/start` response
/// (threat_model T-04-01): unknown email AND known-email-zero-passkeys
/// share this exact branch. Comparable *work* (a fresh random challenge, a
/// deterministic-but-secret-keyed per-email `allowCredentials` list — mirrors
/// `prelogin()`'s own dummy-salt precedent, hardened per WR-01 below), but NO
/// persisted `webauthn_states` row — `webauthn_states.user_id` is `NOT NULL
/// REFERENCES users(id)`, so there is no legitimate `user_id` to bind for a
/// genuinely unknown email (04-RESEARCH.md Architecture Pattern 4).
/// `finish()` then 400s against this `state_id` exactly like any other
/// unknown one via `consume_state_any_user`'s plain not-found lookup —
/// parity is automatic, not a separate branch to maintain.
///
/// WR-01 hardening: the previous version emitted exactly ONE `allowCredentials`
/// entry with a fixed 16-byte id truncated from a PUBLIC per-email hash. That
/// was a triple oracle: (1) any real account with 2+ passkeys is
/// distinguishable by count alone, (2) real credential ids are rarely
/// exactly 16 bytes, and (3) since the derivation formula is public
/// (open-source server), an attacker could precompute the exact expected
/// dummy id for any candidate email and use an exact-match test as an
/// account-existence oracle. This version emits 1-2 entries (matching a
/// realistic small-passkey-count distribution) of full 32-byte SHA-256
/// output (realistic authenticator credential-id length), both derived from
/// `dummy_secret` (server-only, never serialized) mixed with the email — so
/// the output is indistinguishable from random to anyone who doesn't hold
/// the secret, while still being STABLE across repeated probes of the same
/// email (a real account's allowCredentials list doesn't change between
/// refreshes either — see AppState::dummy_secret's doc comment).
fn dummy_passkey_login_start_response(
    rp_id: &str,
    normalized_email: &str,
    dummy_secret: &[u8; 32],
) -> PasskeyLoginStartResponse {
    // Fresh per-request randomness (NOT deterministic like the
    // allowCredentials list below) — repeated probes of the SAME unknown
    // email must not return byte-identical challenges.
    let challenge_bytes = pv_core::keys::random_bytes(32);

    let mut base_hasher = Sha256::new();
    base_hasher.update(dummy_secret);
    base_hasher.update(normalized_email.as_bytes());
    let base_digest = base_hasher.finalize();

    // 1 or 2 dummy entries — most real accounts enroll a small handful of
    // passkeys; a fixed single entry (the prior implementation) was itself a
    // tell for any account with 2+ real passkeys.
    let dummy_cred_count = 1 + (base_digest[0] % 2) as usize;
    let allow_credentials: Vec<serde_json::Value> = (0..dummy_cred_count)
        .map(|i| {
            let mut id_hasher = Sha256::new();
            id_hasher.update(dummy_secret);
            id_hasher.update(normalized_email.as_bytes());
            id_hasher.update([i as u8]);
            let cred_id: [u8; 32] = id_hasher.finalize().into();
            serde_json::json!({
                "type": "public-key",
                "id": URL_SAFE_NO_PAD.encode(cred_id),
            })
        })
        .collect();

    let challenge = serde_json::json!({
        "publicKey": {
            "challenge": URL_SAFE_NO_PAD.encode(&challenge_bytes),
            "timeout": webauthn_rs::DEFAULT_AUTHENTICATOR_TIMEOUT.as_millis() as u32,
            "rpId": rp_id,
            "allowCredentials": allow_credentials,
            // Byte-matches webauthn-rs 0.5.5's own
            // `Webauthn::start_passkey_authentication`, which hardcodes
            // `UserVerificationPolicy::Required` (serializes to "required")
            // for every passkey-authentication ceremony regardless of the
            // passed-in credential set — verified today by this module's
            // `passkey_login_start_shape_parity_...` test, which now asserts
            // value equality here, not just key-set equality (WR-01 finding
            // 3).
            "userVerification": "required",
        }
    });

    PasskeyLoginStartResponse {
        // Generated but NEVER persisted — attempting to persist a dummy row
        // is a schema dead end (no legitimate user_id), not just extra work.
        state_id: Uuid::new_v4().to_string(),
        challenge,
        prf_salts: HashMap::new(),
    }
}

#[derive(Deserialize)]
pub struct PasskeyLoginFinishRequest {
    pub state_id: String,
    pub credential: PublicKeyCredential,
}

#[derive(Serialize)]
pub struct PasskeyLoginFinishResponse {
    pub session_token: String,
    pub pw_wrapped_uk: String,
    /// `None` when the matched credential isn't `prf_capable` — the exact
    /// server-side signal AUTH-09's client fallback keys off.
    pub prf_wrapped_uk: Option<String>,
}

/// Krok 2 unauthenticated passkey-login: weryfikuje `get()` ceremonię
/// naprawdę (`finish_passkey_authentication`), rozwiązuje `user_id` z
/// wiersza stanu (`consume_state_any_user` — nie ma tu jeszcze
/// `SessionUser`), po czym wydaje sesję identycznie jak `login()`.
pub async fn passkey_login_finish(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<PasskeyLoginFinishRequest>,
) -> Result<Json<PasskeyLoginFinishResponse>, ApiError> {
    // A not-found/expired/dummy state_id returns the SAME ApiError::BadRequest
    // here as consume_state's own not-found branch — no special-casing
    // needed, since the dummy path above never persists a row in the first
    // place (parity is automatic, not a separate code path to maintain).
    let (auth_state_json, _prf_salt, _passkey_id, resolved_user_id) =
        webauthn_state::consume_state_any_user(&state.db, &req.state_id, "authentication").await?;

    let auth_state: PasskeyAuthentication =
        serde_json::from_str(&auth_state_json).map_err(|_| ApiError::Internal)?;

    // The real ceremony-verification gate — never trust the uploaded
    // credential blob on state_id presence alone (threat_model T-04-02).
    //
    // Deviation from a literal "passkey ceremony failed" message here (Rule 1
    // auto-fix): unlike register_finish/prf_wrap (both SessionUser-gated,
    // zero enumeration surface), this endpoint is UNAUTHENTICATED. A real,
    // freshly-persisted state_id (from a known account) that fails
    // cryptographic verification must be indistinguishable from a dummy,
    // never-persisted state_id (from an unknown/zero-passkey account) —
    // otherwise an attacker could enumerate accounts by diffing finish()'s
    // error message alone, without ever needing a real credential
    // (04-RESEARCH.md Pitfall 1 / Architecture Pattern 4's parity
    // requirement). Reusing the SAME message string
    // consume_state_any_user's not-found branch already returns closes this
    // without inventing a new distinguishable variant.
    const ENUMERATION_SAFE_FINISH_ERROR: &str = "passkey ceremony expired or not found";
    let auth_result = match state.webauthn.finish_passkey_authentication(&req.credential, &auth_state) {
        Ok(r) => r,
        Err(e) => {
            return Err(handle_finish_auth_error(
                &state.db,
                &resolved_user_id,
                req.credential.get_credential_id(),
                "passkey-login finish",
                ENUMERATION_SAFE_FINISH_ERROR,
                e,
            )
            .await)
        }
    };

    // Resolves WHICH of the user's several passkeys actually answered — only
    // known after the ceremony verifies (04-RESEARCH.md Pattern 3). Bound to
    // resolved_user_id (learned from the state row), never a client-asserted
    // value. Same enumeration-safe message as above for the same reason.
    let row = sqlx::query(
        "SELECT id, passkey_json, prf_wrapped_uk FROM passkeys WHERE credential_id = ? AND user_id = ?",
    )
    .bind(auth_result.cred_id().as_ref())
    .bind(&resolved_user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::BadRequest(ENUMERATION_SAFE_FINISH_ERROR.into()))?;

    let passkey_row_id: String = row.try_get("id").map_err(|_| ApiError::Internal)?;
    let passkey_json: String = row.try_get("passkey_json").map_err(|_| ApiError::Internal)?;
    let prf_wrapped_uk: Option<String> = row.try_get("prf_wrapped_uk").map_err(|_| ApiError::Internal)?;

    let mut passkey: Passkey = serde_json::from_str(&passkey_json).map_err(|_| ApiError::Internal)?;
    let _ = passkey.update_credential(&auth_result);
    let updated_passkey_json = serde_json::to_string(&passkey).map_err(|_| ApiError::Internal)?;

    sqlx::query("UPDATE passkeys SET passkey_json = ?, last_used_at = datetime('now') WHERE id = ?")
        .bind(&updated_passkey_json)
        .bind(&passkey_row_id)
        .execute(&state.db)
        .await?;

    // Session issuance — copies login()'s block verbatim.
    let token = pv_core::keys::random_bytes(32);
    let token_b64 = STANDARD.encode(&token);
    let token_hash = crypto::hash_token(token_b64.as_bytes());
    let session_id = Uuid::new_v4().to_string();
    let user_agent = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok());

    sqlx::query(
        "INSERT INTO sessions (id, user_id, token_hash, user_agent, expires_at) \
         VALUES (?,?,?,?, datetime('now', '+' || ? || ' hours'))",
    )
    .bind(&session_id)
    .bind(&resolved_user_id)
    .bind(token_hash.as_slice())
    .bind(user_agent)
    .bind(state.session_ttl_hours as i64)
    .execute(&state.db)
    .await?;

    let user_row = sqlx::query("SELECT pw_wrapped_uk FROM users WHERE id = ?")
        .bind(&resolved_user_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::Internal)?;
    let pw_wrapped_uk: String = user_row.try_get("pw_wrapped_uk").map_err(|_| ApiError::Internal)?;

    Ok(Json(PasskeyLoginFinishResponse { session_token: token_b64, pw_wrapped_uk, prf_wrapped_uk }))
}
