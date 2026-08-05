//! `DELETE /api/auth/account` — the account-deletion endpoint (FAM-10). This
//! module is the FIRST code path in this repository to ever delete a
//! `families` or `collections` row, so it works out the FK-ordering hazard
//! directly against the schema (`crates/pv-server/migrations/0014_family_sharing.sql`:
//! `families.owner_user_id REFERENCES users(id)` carries NO `ON DELETE`
//! action, and `vault_items.collection_id` — added by that same migration's
//! trailing `ALTER TABLE` — carries none either) — there is no prior handler
//! to copy this discipline from.
//!
//! `SessionUser`-gated, never `Membership`/`FamilyMembership`-gated: this
//! works identically for a caller with no family, a plain member, or the
//! family owner, branching internally on `membership::resolve_family_role`
//! rather than exposing three separate endpoints — a caller's own account is
//! never a shared family/collection/item resource, the same category as
//! `/api/auth/me`.

use axum::{extract::State, http::StatusCode, Json};
use serde::Deserialize;
use sqlx::Row;

use super::families::CollectionRekeyBatch;
use super::membership::{self, AccessLevel};
use super::session::SessionUser;
use super::vault::bump_recipients_vault_revision;
use crate::{error::ApiError, AppState};

/// The client-precomputed removal batch, for the PLAIN-MEMBER self-deletion
/// branch only — reuses the SAME `CollectionRekeyBatch` element type
/// `remove_member` (Plan 25-03) uses, never a parallel, differently-shaped
/// struct, so the client-side orchestration (Plan 25-07) can build one wire
/// contract for both "I removed someone" and "I'm deleting my own account".
/// The owner/no-family branches never call `apply_member_removal_rekey` at
/// all, so the client sends `{ "collections": [] }` for those cases —
/// harmless, since this field is simply ignored by both of those branches.
/// Task 2 wires the plain-member branch that actually reads this field.
#[derive(Deserialize)]
pub struct DeleteAccountRequest {
    pub collections: Vec<CollectionRekeyBatch>,
}

/// `DELETE /api/auth/account` — see this module's own doc comment for the
/// full rationale. The role branch (owner/member/no-family) is derived
/// server-side from `resolve_family_role`, never trusted from a
/// client-supplied field (T-25-15).
///
/// Task 1 wires the owner-dissolution and no-family branches; the
/// plain-member self-deletion branch is `Task 2`'s own deliverable (currently
/// returns `ApiError::Internal` as a compiling, always-erroring placeholder —
/// no test in this task's own verification exercises that branch).
pub async fn delete_account(
    State(state): State<AppState>,
    session: SessionUser,
    Json(req): Json<DeleteAccountRequest>,
) -> Result<StatusCode, ApiError> {
    let resolved = membership::resolve_family_role(&state.db, &session.user_id).await?;

    match resolved {
        None => {
            // No family_members row at all — a single DELETE FROM users,
            // cascading every personal resource (existing ON DELETE CASCADE
            // handles everything). No explicit transaction needed for one
            // statement.
            sqlx::query("DELETE FROM users WHERE id = ?")
                .bind(&session.user_id)
                .execute(&state.db)
                .await?;
            Ok(StatusCode::NO_CONTENT)
        }
        Some((family_id, AccessLevel::Edit)) => {
            delete_account_as_owner(&state, &session.user_id, &family_id).await
        }
        // Task 2 replaces this placeholder with a call to
        // `delete_account_as_member`, which calls the SAME
        // `apply_member_removal_rekey` helper `remove_member` uses.
        Some((_family_id, AccessLevel::Read)) => {
            let _ = &req.collections;
            Err(ApiError::Internal)
        }
        // `resolve_family_role` only ever maps `role='owner' -> Edit` /
        // `role='member' -> Read` (crates/pv-server/src/routes/membership.rs) —
        // `HiddenPassword` is unreachable here in practice, but the match
        // must stay exhaustive over `AccessLevel`'s full 3-variant enum.
        Some((_, AccessLevel::HiddenPassword)) => Err(ApiError::Internal),
    }
}

/// The owner-dissolution branch (CONTEXT.md's locked decision: the whole
/// family ends, not a re-key). Deletes every `vault_items` row scoped to any
/// of the family's collections, then the `families` row (cascading
/// `family_members`/`collections`/`collection_keys`), then the owner's own
/// `users` row, in this exact order inside one `BEGIN IMMEDIATE` transaction
/// — closing RESEARCH.md's Pitfalls 1-2 with a real transaction, not a
/// hoped-for cascade. No re-key is attempted: there is no surviving
/// collection for one, since every collection this family owned is gone.
async fn delete_account_as_owner(
    state: &AppState,
    owner_user_id: &str,
    family_id: &str,
) -> Result<StatusCode, ApiError> {
    // BEGIN IMMEDIATE: acquires the write lock up front, mirroring
    // `remove_member`'s own WR-04-derived rationale — this handler's first
    // statement is a read, and only the later statements mutate.
    let mut tx = state.db.begin_with("BEGIN IMMEDIATE").await?;

    // Resolve the OTHER family members (excluding self) BEFORE any delete —
    // their `family_members` rows are about to cascade away via step 2
    // below, so this is the only point their ids are still cheaply
    // queryable.
    let other_member_rows = sqlx::query("SELECT user_id FROM family_members WHERE family_id = ? AND user_id != ?")
        .bind(family_id)
        .bind(owner_user_id)
        .fetch_all(&mut *tx)
        .await?;
    let other_member_ids: Vec<String> = other_member_rows
        .into_iter()
        .map(|row| row.try_get("user_id").map_err(|_| ApiError::Internal))
        .collect::<Result<Vec<_>, ApiError>>()?;

    // Step 1 (closes Pitfall 2): delete every vault_items row scoped to any
    // of this family's collections. `vault_items.collection_id` carries NO
    // `ON DELETE` action (migration 0014's trailing `ALTER TABLE`), so a
    // `families` cascade alone would either leave these rows dangling, or —
    // given Plan 25-01's empirical proof that FK enforcement is genuinely ON
    // in the real pool — raise `SQLITE_CONSTRAINT_FOREIGNKEY` on step 2
    // below if this step were skipped or reordered after it.
    sqlx::query("DELETE FROM vault_items WHERE collection_id IN (SELECT id FROM collections WHERE family_id = ?)")
        .bind(family_id)
        .execute(&mut *tx)
        .await?;

    // Step 2: delete the families row — cascades family_members/collections/
    // collection_keys (all three carry ON DELETE CASCADE per migration 0014).
    sqlx::query("DELETE FROM families WHERE id = ?").bind(family_id).execute(&mut *tx).await?;

    // Step 3: notify each remaining member their access just ended — a
    // cascade does not run application-level notification logic, so without
    // this bump their own next GET /api/sync would never learn the family
    // (and their access through it) is gone.
    bump_recipients_vault_revision(&mut tx, &other_member_ids).await?;

    // Step 4: delete the owner's own row — now unblocked by step 2 (nothing
    // still references `families.owner_user_id`), cascades the owner's own
    // remaining personal vault_items/folders/passkeys/sessions/user_keypairs.
    sqlx::query("DELETE FROM users WHERE id = ?").bind(owner_user_id).execute(&mut *tx).await?;

    tx.commit().await?;

    Ok(StatusCode::NO_CONTENT)
}
