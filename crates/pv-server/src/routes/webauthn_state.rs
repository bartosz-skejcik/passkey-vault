//! Trwały magazyn efemerycznego stanu ceremonii WebAuthn (`webauthn_states`
//! table) — NIE handler tras (brak axum route exports), tylko reużywalna
//! warstwa persystencji wołana przez `passkeys.rs`. Mirroruje
//! `session.rs`'s hash-then-lookup-with-expiry shape: krótkie TTL +
//! single-use (delete-on-consume) egzekwują T-03-04 (anti-replay).

use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::error::ApiError;

/// Persystuje jeden wiersz stanu ceremonii z 5-minutowym TTL. Zwraca
/// wygenerowany `state_id`, który klient musi zwrócić przy `finish`/
/// `prf-wrap`.
pub async fn persist_state(
    db: &SqlitePool,
    user_id: &str,
    state_type: &str,
    state_json: &str,
    prf_salt: Option<&[u8]>,
    passkey_id: Option<&str>,
) -> Result<String, ApiError> {
    // Opportunistic cleanup (WR-05): rows are only ever removed by
    // `consume_state` on a successful ceremony — any ceremony a user starts
    // but abandons (closes the prompt, network drop, no-PRF authenticator,
    // or just never finishes) leaves a permanent row, since expiry is only
    // enforced at query time, not by any sweep. Piggybacking a cheap
    // range-delete on `idx_webauthn_states_expiry` here (instead of a
    // separate background task) bounds table growth without adding a new
    // dependency. Best-effort: a failure here must not block issuing the
    // new state.
    if let Err(err) = sqlx::query("DELETE FROM webauthn_states WHERE expires_at <= datetime('now')")
        .execute(db)
        .await
    {
        tracing::warn!(?err, "failed to sweep expired webauthn_states rows (best-effort, non-fatal)");
    }

    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO webauthn_states (id, user_id, state_type, state_json, prf_salt, passkey_id, expires_at) \
         VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+5 minutes'))",
    )
    .bind(&id)
    .bind(user_id)
    .bind(state_type)
    .bind(state_json)
    .bind(prf_salt)
    .bind(passkey_id)
    .execute(db)
    .await?;
    Ok(id)
}

/// Konsumuje dokładnie jeden nieprzeterminowany wiersz stanu dla danego
/// użytkownika/typu ceremonii w POJEDYNCZYM atomowym `DELETE ... RETURNING` —
/// jednorazowe użycie, patrz threat_model T-03-04. Wcześniejszy SELECT-then-
/// DELETE (dwa oddzielne statementy) dopuszczał TOCTOU pod SQLite WAL: dwa
/// równoległe żądania z tym samym `state_id` mogły oba przejść SELECT (wiersz
/// wciąż obecny, `expires_at > now`) zanim którykolwiek DELETE zacommitował,
/// więc oba kontynuowałyby z tym samym one-time state (WR-01). `DELETE ...
/// RETURNING` jest pojedynczym atomowym statementem — dokładnie jeden
/// równoległy wywołujący może "wygrać" ten wiersz. Brak dopasowanego wiersza
/// (nieznany `state_id`, złe `state_type`, przeterminowany, lub już
/// skonsumowany — w tym przez przegranego w wyścigu) zwraca
/// `ApiError::BadRequest`, nigdy panic/500.
pub async fn consume_state(
    db: &SqlitePool,
    user_id: &str,
    state_id: &str,
    expected_type: &str,
) -> Result<(String, Option<Vec<u8>>, Option<String>), ApiError> {
    let row = sqlx::query(
        "DELETE FROM webauthn_states \
         WHERE id = ? AND user_id = ? AND state_type = ? AND expires_at > datetime('now') \
         RETURNING state_json, prf_salt, passkey_id",
    )
    .bind(state_id)
    .bind(user_id)
    .bind(expected_type)
    .fetch_optional(db)
    .await?;

    let row = row.ok_or_else(|| ApiError::BadRequest("passkey ceremony expired or not found".into()))?;

    let state_json: String = row.try_get("state_json").map_err(|_| ApiError::Internal)?;
    let prf_salt: Option<Vec<u8>> = row.try_get("prf_salt").map_err(|_| ApiError::Internal)?;
    let passkey_id: Option<String> = row.try_get("passkey_id").map_err(|_| ApiError::Internal)?;

    Ok((state_json, prf_salt, passkey_id))
}

/// Sibling of `consume_state` for the ONE call site that structurally cannot
/// supply a `user_id` ahead of time: the unauthenticated
/// `passkey_login_finish` handler (Phase 4, AUTH-04). Same atomic
/// `DELETE ... RETURNING` shape and the SAME not-found error message as
/// `consume_state` — this string must stay shared, not diverge into a second
/// message, or the dummy-path/real-path enumeration-resistance parity
/// (04-RESEARCH.md Architecture Pattern 4) would break. The only differences:
/// no `user_id` filter on `WHERE` (there is no caller-supplied value to
/// filter by yet), and `user_id` is additionally read out via `RETURNING` so
/// the caller can LEARN it from the row itself — the row was written by
/// `passkey_login_start` using the real, resolved user_id at persist time.
pub async fn consume_state_any_user(
    db: &SqlitePool,
    state_id: &str,
    expected_type: &str,
) -> Result<(String, Option<Vec<u8>>, Option<String>, String), ApiError> {
    let row = sqlx::query(
        "DELETE FROM webauthn_states \
         WHERE id = ? AND state_type = ? AND expires_at > datetime('now') \
         RETURNING state_json, prf_salt, passkey_id, user_id",
    )
    .bind(state_id)
    .bind(expected_type)
    .fetch_optional(db)
    .await?;

    let row = row.ok_or_else(|| ApiError::BadRequest("passkey ceremony expired or not found".into()))?;

    let state_json: String = row.try_get("state_json").map_err(|_| ApiError::Internal)?;
    let prf_salt: Option<Vec<u8>> = row.try_get("prf_salt").map_err(|_| ApiError::Internal)?;
    let passkey_id: Option<String> = row.try_get("passkey_id").map_err(|_| ApiError::Internal)?;
    let user_id: String = row.try_get("user_id").map_err(|_| ApiError::Internal)?;

    Ok((state_json, prf_salt, passkey_id, user_id))
}
