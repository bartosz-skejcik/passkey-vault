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

use super::families::{self, CollectionRekeyBatch};
use super::membership::{self, AccessLevel};
use super::session::SessionUser;
use super::sync::{ChangeType, EntityType, SyncEvent};
use super::vault::{bump_recipients_vault_revision, resolve_collection_members};
use crate::{error::ApiError, AppState};

/// The client-precomputed removal batch, for the PLAIN-MEMBER self-deletion
/// branch only — reuses the SAME `CollectionRekeyBatch` element type
/// `remove_member` (Plan 25-03) uses, never a parallel, differently-shaped
/// struct, so the client-side orchestration (Plan 25-07) can build one wire
/// contract for both "I removed someone" and "I'm deleting my own account".
/// The owner/no-family branches never call the shared removal re-key helper
/// at all, so the client sends `{ "collections": [] }` for those cases —
/// harmless, since this field is simply ignored by both of those branches.
#[derive(Deserialize)]
pub struct DeleteAccountRequest {
    pub collections: Vec<CollectionRekeyBatch>,
}

/// `DELETE /api/auth/account` — see this module's own doc comment for the
/// full rationale. The role branch (owner/member/no-family) is derived
/// server-side from `resolve_family_role`, never trusted from a
/// client-supplied field (T-25-15).
pub async fn delete_account(
    State(state): State<AppState>,
    session: SessionUser,
    Json(req): Json<DeleteAccountRequest>,
) -> Result<StatusCode, ApiError> {
    let resolved = membership::resolve_family_role(&state.db, &session.user_id).await?;

    match resolved {
        None => {
            // No family_members row at all — every personal resource goes
            // away via the existing `ON DELETE CASCADE` chain. This branch
            // still needs a REAL transaction (CR-01): the `last_editor_user_id`
            // detach below and the `DELETE FROM users` must either both apply
            // or neither, otherwise a failure between them would leave a user
            // whose edit attributions have been silently erased but whose
            // account still exists.
            let mut tx = state.db.begin_with("BEGIN IMMEDIATE").await?;
            detach_last_editor_references(&mut tx, &session.user_id).await?;
            sqlx::query("DELETE FROM users WHERE id = ?").bind(&session.user_id).execute(&mut *tx).await?;
            tx.commit().await?;
            Ok(StatusCode::NO_CONTENT)
        }
        Some((family_id, AccessLevel::Edit)) => {
            delete_account_as_owner(&state, &session.user_id, &family_id).await
        }
        Some((family_id, AccessLevel::Read)) => {
            delete_account_as_member(&state, &family_id, &session.user_id, &req.collections).await
        }
        // `resolve_family_role` only ever maps `role='owner' -> Edit` /
        // `role='member' -> Read` (crates/pv-server/src/routes/membership.rs) —
        // `HiddenPassword` is unreachable here in practice, but the match
        // must stay exhaustive over `AccessLevel`'s full 3-variant enum.
        Some((_, AccessLevel::HiddenPassword)) => Err(ApiError::Internal),
    }
}

/// CR-01 (code review, Phase 25). `vault_items.last_editor_user_id` is a
/// `REFERENCES users(id)` column with NO `ON DELETE` action (migration
/// `0015_sync_shared_fanout.sql`), and every write path (`vault::create`,
/// `vault::update`, `vault::move_item`) sets it to the CALLER's id — including
/// an edit by a non-author on someone else's shared item. `vault_items.user_id`
/// cascades, so the departing user's OWN rows go away; a row authored by
/// someone else that they merely last EDITED survives the cascade and still
/// references them, so `DELETE FROM users` aborts the whole transaction with
/// `SQLITE_CONSTRAINT_FOREIGNKEY` (FK enforcement is genuinely ON — see
/// `lib.rs`'s `build_pool_enables_foreign_key_enforcement`) and the account
/// becomes permanently undeletable.
///
/// This is the ONE place that hazard is handled, called immediately before
/// `DELETE FROM users` in all three branches, inside their own transaction —
/// so the ordering discipline lives in a single function rather than being
/// re-derived per branch.
///
/// Why not a migration adding `ON DELETE SET NULL`? SQLite cannot `ALTER` a
/// constraint, and the standard 12-step table rebuild is genuinely unsafe
/// here: `item_shares.item_id REFERENCES vault_items(id) ON DELETE CASCADE`
/// (migration 0014) means the rebuild's `DROP TABLE vault_items` would cascade
/// away every existing direct share on a shipped, self-hosted deployment, and
/// `PRAGMA foreign_keys` is a documented no-op inside a transaction — which is
/// exactly what sqlx runs each migration in — so the toggle that normally
/// makes such a rebuild safe is not available to us. An explicit NULL-out is
/// the smaller, reversible change.
///
/// Setting NULL (rather than preserving the id) is the same value every
/// pre-0015 row already carries, and every read path already tolerates it:
/// `vault.rs`'s 409-attribution `LEFT JOIN` yields `None` and
/// `pull_shared_collection`/`pull_shared_direct` return
/// `last_editor_email: null` — never a panic or a 500.
async fn detach_last_editor_references(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    user_id: &str,
) -> Result<(), ApiError> {
    sqlx::query("UPDATE vault_items SET last_editor_user_id = NULL WHERE last_editor_user_id = ?")
        .bind(user_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
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

    // Step 4 (CR-01): clear every dangling `last_editor_user_id` reference to
    // the departing owner. Step 1 above only removed items scoped to this
    // family's COLLECTIONS — a plain member's PERSONAL item that the owner
    // edited through an `item_shares` grant survives the dissolution and
    // still references them.
    detach_last_editor_references(&mut tx, owner_user_id).await?;

    // Step 5: delete the owner's own row — now unblocked by step 2 (nothing
    // still references `families.owner_user_id`), cascades the owner's own
    // remaining personal vault_items/folders/passkeys/sessions/user_keypairs.
    sqlx::query("DELETE FROM users WHERE id = ?").bind(owner_user_id).execute(&mut *tx).await?;

    tx.commit().await?;

    Ok(StatusCode::NO_CONTENT)
}

/// WINDOWS.md #16 (found live, Plan 30-17). `vault_items.user_id REFERENCES
/// users(id) ON DELETE CASCADE` (migration `0001_init.sql`) is unconditional
/// — it applies to a collection-scoped item exactly like a personal one.
/// `apply_member_removal_rekey` (called just above this in
/// `delete_account_as_member`) correctly re-keys every collection the
/// departing member could reach — including rewrapping each item's `enc_key`
/// under the collection's fresh post-removal key for every remaining
/// recipient — but never touches `vault_items.user_id` itself, so the
/// departing member's OWN `DELETE FROM users` a few statements later still
/// cascades away every item THEY created inside a collection that survives
/// them.
///
/// Bartek's product decision (30-CONTEXT.md's locked "leaving is not
/// deletion… you keep your own originals", applied to the collection-scoped
/// case): a family-wide (or otherwise collection-scoped) item a departing
/// plain member created STAYS in that collection, readable by every
/// remaining member. Ownership transfers to the collection's owner before
/// the cascade — this schema has no separate per-collection owner column
/// (`collections` belongs to a `families` row, and `families.owner_user_id`
/// is the only owner concept in reach), so "the collection's owner" is the
/// family owner.
///
/// Scoped to `touched_collections` — exactly the set `apply_member_removal_
/// rekey` just re-keyed. That scope is provably exhaustive: any
/// `vault_items` row with `collection_id = X AND user_id = member_user_id`
/// implies the member held a `collection_keys` row in `X` (nothing else
/// could have produced the row), and `apply_member_removal_rekey`'s own
/// Step 1 guard already proved the submitted collection set is EXACTLY the
/// member's actual reachable set — so `X` is necessarily a member of
/// `touched_collections`.
///
/// Deliberately the opposite of `delete_account_as_owner`'s Step 1 (which
/// pre-deletes every collection-scoped item on purpose, because there the
/// whole family dissolves and no "remaining owner" exists to transfer to) —
/// that precedent stays untouched; this is a different, deliberate decision
/// for the different case where the family survives.
///
/// A plain `UPDATE ... SET user_id`, run BEFORE the cascading `DELETE FROM
/// users` — never touches `enc_key`/`enc_data` or any key material, so
/// zero-knowledge holds: the server has not decrypted or re-encrypted
/// anything, only repointed a foreign key on an already-correctly-rewrapped
/// row. `membership::Collection::resolve_access`'s collection-scoped item
/// branch already grants access purely via `collection_keys`, never via
/// `vault_items.user_id` (confirmed by reading it) — so this reassignment
/// changes nothing about who can read the item today; it only keeps the row
/// alive for the read path that already works.
async fn reassign_departing_member_collection_items(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    family_id: &str,
    member_user_id: &str,
    touched_collections: &[String],
) -> Result<(), ApiError> {
    if touched_collections.is_empty() {
        return Ok(());
    }

    let new_owner_user_id: String = sqlx::query_scalar("SELECT owner_user_id FROM families WHERE id = ?")
        .bind(family_id)
        .fetch_one(&mut **tx)
        .await?;

    for collection_id in touched_collections {
        sqlx::query("UPDATE vault_items SET user_id = ? WHERE user_id = ? AND collection_id = ?")
            .bind(&new_owner_user_id)
            .bind(member_user_id)
            .bind(collection_id)
            .execute(&mut **tx)
            .await?;
    }

    Ok(())
}

/// The plain-member self-deletion branch: calls the SAME shared removal
/// re-key helper `remove_member` (Plan 25-03) uses — target = the caller's
/// own id — before their own personal data cascades away via `DELETE FROM
/// users`. Never a parallel, second implementation of this write sequence
/// (CONTEXT.md's locked FAM-10 instruction).
async fn delete_account_as_member(
    state: &AppState,
    family_id: &str,
    member_user_id: &str,
    batch: &[CollectionRekeyBatch],
) -> Result<StatusCode, ApiError> {
    let mut tx = state.db.begin_with("BEGIN IMMEDIATE").await?;

    // WR-03: `family_id` is the caller's OWN resolved family (from
    // `resolve_family_role`, keyed on their own session), never a
    // client-supplied value — so every write the helper performs is scoped,
    // and the helper's in-transaction membership re-check applies here too.
    let touched_collections =
        families::apply_member_removal_rekey(&mut tx, family_id, member_user_id, batch).await?;

    // WINDOWS.md #16: reassign ownership of any collection-scoped item the
    // departing member created, to the family owner, BEFORE the cascade —
    // see this function's own doc comment above for the full rationale.
    reassign_departing_member_collection_items(&mut tx, family_id, member_user_id, &touched_collections).await?;

    // CR-01: clear every dangling `last_editor_user_id` reference before the
    // delete — the ordinary collaboration case (this member edited an item
    // the OWNER authored in a shared collection) leaves exactly such a
    // reference on a row that survives their deletion.
    detach_last_editor_references(&mut tx, member_user_id).await?;

    // Cascades the caller's own remaining personal data — their
    // `family_members` row is already gone via the helper call above.
    sqlx::query("DELETE FROM users WHERE id = ?").bind(member_user_id).execute(&mut *tx).await?;

    tx.commit().await?;

    // Fan out AFTER commit, over a FRESH pool-bound connection (not the
    // consumed `tx`) — same discipline as `remove_member`'s own post-commit
    // fan-out: recipients resolved fresh now naturally exclude the deleted
    // caller.
    let mut conn = state.db.acquire().await?;
    for collection_id in &touched_collections {
        let recipients = resolve_collection_members(&mut conn, collection_id).await?;
        let current_revision: i64 = sqlx::query_scalar("SELECT revision FROM collections WHERE id = ?")
            .bind(collection_id)
            .fetch_one(&mut *conn)
            .await?;
        state.sync_hub.publish_to_recipients(
            &recipients,
            SyncEvent {
                entity_type: EntityType::Collection,
                id: collection_id.clone(),
                revision: current_revision,
                change_type: ChangeType::Update,
            },
        );
    }

    Ok(StatusCode::NO_CONTENT)
}
