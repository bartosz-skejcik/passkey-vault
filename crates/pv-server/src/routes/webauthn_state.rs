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
