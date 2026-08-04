# Phase 25: Member Removal, Suspension & Re-key - Research

**Researched:** 2026-08-04
**Domain:** Rust/axum/SQLx multi-recipient collection re-key (X25519 sealed-box + XChaCha20-Poly1305), Next.js/React destructive-confirmation UI, SQLite transactional atomicity
**Confidence:** HIGH for the code paths read directly this session (membership extractors, crypto primitives, cascade/FK topology, test harness patterns); MEDIUM for the exact server-side re-key wire contract (new endpoint, not yet built — designed here from first principles against the shipped schema); LOW/ASSUMED for anything requiring behavior verification this session couldn't execute (SQLite FK-enforcement default) — flagged below and in Assumptions Log.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Suspension (FAM-07, FAM-09):**
- A suspended member stays in the family, but shared data disappears from their vault, and they see an explicit "access suspended" message. Their own personal items are untouched.
- Suspension performs NO re-key — it must be reversible and immediate; un-suspending restores access by flipping state, not re-wrapping.
- Immediacy comes from Phase 22's existing per-request resolution, not from token invalidation — resolve effective access fresh from the database on every request, never cache it. **Verify this is actually true rather than assuming it**; if a cached path exists anywhere, that is the bug to fix.
- The owner cannot suspend themselves — server-side guard, not just a hidden button.

**Removal & rotate-credentials list (UX-04):**
- The confirmation lists the actual item names the removed member could see, not just counts.
- The warning is stated plainly and not softened: re-key cannot undo what they already saw. Not negotiable copy.
- No "rotate now" action in this phase — recommendation + list only.
- The removed member gets no notification.

**Account deletion (FAM-10):**
- Deleting an account runs the same re-key path as explicit removal — the same function, not a parallel implementation. The `ON DELETE CASCADE` on `users` drops `family_members` rows via FK but does NOT itself trigger a collection re-key; the deletion flow must run the re-key explicitly, before dropping the user row.
- Second confirmation, same as removal.
- Deleting an account also removes that user's own vault items, folders, passkeys, sessions and identity keypair.

**Owner self-deletion (decided, not asked):**
- An owner deleting their account dissolves the family. All members lose shared access; every collection and its wrapped keys go with it. Members keep their own personal vaults, untouched.
- Rationale: v0.4 has exactly one family per instance and no ownership-transfer endpoint. Blocking deletion traps someone in a product they want to leave; inventing ownership transfer is out of scope.
- The confirmation must say this in plain words — that deleting the account ends the family for everyone in it, and name how many members are affected.

**Re-key mechanics (technical, decided):**
- Scope must be provably narrow (KEY-06): re-key touches only the collections the removed member could actually reach — never the whole vault, never sibling collections.
- Rewrap keys only, never `enc_data` (SC 6 / KEY-02). Assert `enc_data` is byte-identical before and after, directly — not inferred from a timing measurement.
- Atomicity (KEY-07) via `BEGIN IMMEDIATE`, guarded mutations, and a genuinely fault-injected test (a deferred `BEGIN` on a read-then-write path already caused one real `SQLITE_BUSY_SNAPSHOT` production bug, commit `c94c379`).
- Nonce discipline (SEC-07): a batch rewrapping many keys must never reuse a nonce — deserves its own assertion, not a code comment.

### Claude's Discretion

Hard constraints the planner may not deviate from (everything else is discretionary):
1. Suspension never triggers a re-key; removal always does.
2. `enc_data` is byte-identical before and after any re-key — asserted directly.
3. Account deletion calls the same re-key function as removal, before dropping the user row.
4. Re-key is atomic under fault injection, and no nonce is ever reused in a rewrap batch.
5. The removal and owner-deletion confirmations state plainly what re-key cannot undo.
6. Additive migration only; an instance with no family keeps working untouched.

### Deferred Ideas (OUT OF SCOPE)

- Ownership transfer — deliberately not built; the owner-deletion decision exists to avoid needing it in v0.4.
- A "rotate this credential now" action from the removal confirmation — recommendation only this phase.
- Server-side audit log of membership changes — carried forward from Phases 22/24's deferred lists, no v0.4 requirement asks for it.
- Notifying a suspended or removed member — explicitly declined by Bartek this phase.
- Ownership transfer, sharing UI at Phase-26 visual quality, anything in the extension (Phase 27), a "rotate this credential now" action (all explicitly out of this phase's boundary per CONTEXT.md's `## Phase Boundary`).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FAM-07 | Owner can suspend a member: reversible, immediate, no re-key | Architecture Pattern 3 (fresh-per-request resolution) + new `family_members.status` column + `AND fm.status = 'active'` join extension in `Collection`/`Item::resolve_access` |
| FAM-08 | Owner can permanently remove a member: triggers re-key (KEY-06), gated behind second confirmation | System diagram + new atomic member-removal endpoint; UI-SPEC's two-step `RemoveMemberDialog` |
| FAM-09 | Suspended/removed member's existing sessions lose access immediately | Architecture Pattern 3 — `SessionUser` (token validity) and `Membership`/`FamilyMembership` (authorization) already independently resolved per-request; no token-side change needed |
| FAM-10 | Account deletion triggers the same re-key path as removal | Common Pitfalls 1–3 (FK-ordering hazard), Open Question 2 (wire shape for a self-deleting member vs. owner) |
| KEY-02 (SC 6) | Removing a member rewraps keys only; `enc_data` byte-identical before/after, asserted directly | New `rewrap_item_key_for_collection` primitive (Code Examples) — type signature never references `enc_data`; Common Pitfall 6 (direct byte-identity assertion) |
| KEY-06 | Re-key cost provably proportional to shared data + remaining members, never whole vault | Summary's shipped-schema finding (no `key_version` indirection → cost scales with members AND items in that one collection); Common Pitfall 5 (load-test design) |
| KEY-07 | Re-key atomic/safely resumable; partial failure never strands recipients | System diagram step-by-step transaction; Common Pitfall 4 (genuine fault-injection mechanism); Don't Hand-Roll (optimistic-concurrency re-check) |
| SEC-07 | Batch rewrapping never reuses a nonce | Don't Hand-Roll (reuse existing per-call `OsRng` primitives); Common Pitfall 7 (large-batch property test) |
| UX-04 | Removal UI lists actual items the member could see, recommends rotating credentials | New `GET /api/vault/collections/{id}/items` endpoint (serves both this and the re-key batch); UI-SPEC §4's already-locked copy contract |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Zero-knowledge, non-negotiable:** the server never sees a plaintext key, `CollectionKey`, `ItemKey`, or item payload. Every re-key computation (new `CollectionKey` generation, per-member reseal, per-item `enc_key` rewrap) must happen client-side; the server's role is limited to atomic, opaque storage of client-supplied blobs.
- **1-container, SQLite-on-volume:** no new external service (Redis, S3, message queue) may be introduced to solve the fault-injection, atomicity, or load-test requirements — everything must work within the existing `SqlitePool`/WAL/`BEGIN IMMEDIATE` discipline already established in this codebase.
- **Crypto primitives:** Argon2id/XChaCha20-Poly1305/HKDF-SHA256/ES256/`crypto_box =0.9.1` — no hand-rolled cryptography. The new rewrap-only function must compose EXISTING `aead_seal`/`aead_open` calls, never a new cipher construction.
- **Memory safety:** any new key-material-bearing type (e.g., a temporary buffer inside the new rewrap primitive) must use `Zeroize`/`ZeroizeOnDrop`, never a bare `String`/`Vec<u8>` for key or password material — matching every existing type in `pv-core`.
- **Design system:** security UI (suspend/remove/delete-account confirmations) must stay "czytelne" (legible/calm) — no Fuzzy Bubbles, no playful copy — already locked and detailed exhaustively in `25-UI-SPEC.md`; this research does not relitigate it.
- **Naming/module conventions:** snake_case functions, PascalCase types, versioned domain-separation constants (`b"pv:...:v1"`) for any new HKDF/AEAD context — the new rewrap primitive reuses the EXISTING `AAD_COLL_ITEM_KEY_PREFIX` constant, it must not invent a new one.
- **Additive migrations only:** `0018_*.sql` (suspension state + whatever the re-key path needs) must never rename/repurpose an existing column; an instance with no family must keep working byte-for-byte unchanged (CONTEXT.md's locked constraint #6, reused from every prior migration's own header comment convention).
- **Comments mix Polish and English:** new `pv-core`/`pv-server` code should follow the existing bilingual documentation convention observed throughout `crates/pv-core/src/items.rs`/`identity.rs`.
- **Error handling:** `CryptoError` for crypto-layer failures, `ApiError` for HTTP-layer failures (`Conflict`/`NotFound`/`BadRequest`/`Forbidden`/`Internal`) — no new error enum variant should be added without a documented reason, matching `error.rs`'s existing minimal-surface discipline.
- **GSD workflow enforcement:** all implementation work for this phase must go through `/gsd-execute-phase`, not direct ad hoc edits — noted for the orchestrator, not a code-level constraint.

## Summary

This phase's central technical fact, discovered by reading the actual shipped schema rather than the original v0.4 design sketch: **there is no `key_version` indirection in `collections`/`collection_keys`.** `crates/pv-core/src/items.rs::encrypt_item_for_collection` seals each item's per-item `ItemKey` directly under the raw bytes of the collection's *current* `CollectionKey` (`aead_seal(ck.expose(), &item_key.0, ...)`), and `collection_keys.sealed_key` seals that same raw `CollectionKey` per recipient. `.planning/research/v0.4/PITFALLS.md` §3 (Pitfall 11) sketched an idealized design where rotating the Collection Key would touch nothing but the per-member wraps ("O(members), not O(items)") via a version pointer — that pointer was never built. Given the shipped schema, rotating the `CollectionKey` on removal **does** require rewrapping every affected item's `enc_key` (the item's own Cipher Key rewrapped under the new `CollectionKey`) in addition to resealing the `CollectionKey` for every remaining recipient. This reconciles SC 2's literal wording ("cost proportional to that collection's members **and items**") with SC 6's "rewrap-only" guarantee: the rewrap touches `collection_keys.sealed_key` (per remaining member) and `vault_items.enc_key` (per item in that one collection) — `vault_items.enc_data` (the actual payload ciphertext) is never touched, because the per-item `ItemKey` itself never changes, only its wrap.

The crypto primitives this rewrap needs (`identity::seal`/`unseal_collection_key`, `items::encrypt_item_for_collection`/`decrypt_item_for_collection`) already exist in `pv-core` and are already bound through `pv-wasm` (`WasmCollectionKey`, `sealCollectionKey`, `unsealCollectionKey`). **What does not exist yet, and this phase must add**, is a "rewrap only" primitive: unwrap `enc_key` under the OLD `CollectionKey` and reseal under the NEW `CollectionKey`, using the identical AAD (`build_coll_item_aad(AAD_COLL_ITEM_KEY_PREFIX, collection_id, item_id, 0)`), never touching `enc_data`. This is new `pv-core`/`pv-wasm` surface, not a reuse of an existing function.

Server-side, this phase needs a **new endpoint** (there is no "remove member" or "list a collection's items" endpoint today) that accepts a client-computed rewrap batch and applies it atomically: delete the removed member's `collection_keys` row(s) across every collection they could reach, replace every remaining recipient's `sealed_key`, and replace every affected item's `enc_key` — one transaction, `BEGIN IMMEDIATE` (this codebase's established discipline for read-then-write handlers, per `vault.rs`'s documented `SQLITE_BUSY_SNAPSHOT` production bug, commit `c94c379`). Because the client must enumerate "every item in the collection" to build the batch, and no such listing endpoint exists (`fetch_items_for` in `vault.rs` only returns items the CALLER personally created — confirmed by reading its SQL, `WHERE i.user_id = ?` on the collection-scoped arm), this phase must also add a `GET /api/vault/collections/{id}/items` endpoint. This is the same endpoint UI-SPEC §4 already flags as owed for the real-item-names disclosure list — one endpoint serves both needs.

Account deletion (FAM-10) has a second, distinct hazard beyond the missing re-key call: **the owner-self-deletion path can violate live foreign-key constraints** if statements run in the wrong order. `families.owner_user_id REFERENCES users(id)` has no `ON DELETE` action, and `vault_items.collection_id REFERENCES collections(id)` also has no `ON DELETE` action (confirmed by reading `0014_family_sharing.sql`'s literal `ALTER TABLE`). SQLx enables SQLite foreign-key enforcement by default [CITED: general SQLx behavior, not empirically re-verified in this exact pool this session — see Assumptions Log]. Deleting the owner's family therefore requires, in one transaction, in this exact order: (1) delete every `vault_items` row scoped to any collection under that family (there is no cascade for this edge), (2) delete the `families` row (cascades `family_members`/`collections`/`collection_keys`), (3) delete the `users` row (cascades the owner's own personal `vault_items`/`folders`/`passkeys`/`sessions`/`user_keypairs`). Getting this order wrong produces a live `SQLITE_CONSTRAINT_FOREIGNKEY` in production, not a test failure — there is no existing "delete a collection" code path anywhere in this codebase to copy from; this phase is first to exercise it.

Finally, this phase inherits a live, already-diagnosed bug pattern (WR-07) with an exact fix precedent already shipped for a sibling code path: `vault.rs::revoke_share` bumps the revoked recipient's own `users.shared_direct_revision` counter in the same transaction as the `DELETE`, specifically so the revoked user's *own* next sync poll detects the change and prunes the item locally, even though they can no longer read it. `collections.rs::revoke_access` never got the equivalent fix — it only bumps `collections.revision`, which the just-revoked recipient can no longer even query (`Membership<Collection, _>` now 404s them). The fix is the same pattern applied to the correct counter: bump the revoked recipient's own `users.vault_revision` (not `shared_direct_revision` — that counter is for the *direct item_shares* bucket; collection-scoped items surface through `GET /api/vault/items`'s collection-scoped arm, which is gated by `vault_revision` via `GET /api/sync`).

**Primary recommendation:** Build one new `pv-core` rewrap-only primitive, one new `GET /api/vault/collections/{id}/items` endpoint (serves both UX-04's disclosure list and the re-key batch construction), and one new atomic member-removal endpoint that accepts a client-precomputed batch (new sealed `CollectionKey` per remaining member + new `enc_key` per item) and applies it as a single `BEGIN IMMEDIATE` transaction, closing over the FK-ordering hazard for account deletion and the WR-07 counter gap in the same pass.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Suspend/reinstate a member (state flip) | API / Backend | Database | Pure state mutation, no crypto — a `family_members.status` column flip, gated by the existing `FamilyMembership<RequireEdit>` owner-only extractor. |
| Immediate access loss on suspend/remove | API / Backend | — | Falls out of the existing per-request `resolve_access`/`resolve_family_role` queries (never cached) once the `status`/row-existence check is added to their joins — this is a pure server-side authorization property, not a token/session concern. |
| Re-key computation (new CollectionKey, per-member reseal, per-item enc_key rewrap) | Browser / Client | — | Zero-knowledge invariant: the server never sees a CollectionKey or ItemKey in plaintext. All rewrap math happens in `pv-core`/`pv-wasm`, invoked from the owner's browser tab. |
| Re-key persistence (atomic batch write) | API / Backend | Database | The server's only role is storing client-supplied opaque blobs atomically — it never computes or validates crypto content, only transactional shape (row-set completeness, nonce non-collision is a client-side property it cannot verify). |
| Access-disclosure list (real item names) | Browser / Client | API / Backend | Decryption happens client-side (owner already holds every relevant CollectionKey); the API's only job is serving the encrypted rows via the new items-listing endpoint. |
| Suspend/remove/delete confirmation UI | Browser / Client | — | Pure presentation — DaisyUI/React, no crypto of its own beyond invoking the client-side re-key computation above. |
| Session/token invalidation on next request | API / Backend | — | `SessionUser` (bearer-token validity) and `Membership`/`FamilyMembership` (resource authorization) are deliberately two separate, independently-resolved facts in this codebase already — no token-side change needed, only the authorization-resolution queries. |
| Account deletion (cascade + re-key + FK ordering) | API / Backend | Database | Multi-statement transactional orchestration is inherently server-side; the re-key sub-step still delegates its crypto to the client per the pattern above (deleting an OWNER's account additionally needs no client rewrap — the whole family is destroyed, not re-keyed). |

## Standard Stack

No new external packages this phase. Every crypto primitive needed (X25519 sealed-box via `crypto_box =0.9.1`, XChaCha20-Poly1305 via `chacha20poly1305`, HKDF-SHA256) is already a pinned workspace dependency from Phase 21, and every UI primitive (DaisyUI 5, `lucide-react`, `packages/pv-ui`) is already pinned per `docs/UI-DESIGN.md`/`25-UI-SPEC.md`. This phase extends existing modules (`pv-core::items`, `pv-core::identity`, `pv-wasm`, `pv-server::routes::{collections,families,membership}`, `web/src/lib/{crypto,families,vault}`) rather than introducing new crates.

### Core (existing, reused — no version changes)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `crypto_box` | `=0.9.1` (exact-pinned, KEY-05 decision) | X25519 sealed-box for `CollectionKey` resealing per remaining member | Already the locked KEY-05 decision; ChaChaBox rejects non-empty AAD, confirmed in `identity.rs`'s own regression test `chachabox_rejects_nonempty_aad` |
| `chacha20poly1305` | workspace-pinned | XChaCha20-Poly1305 AEAD for the new rewrap-only `enc_key` primitive | Same primitive `aead_seal`/`aead_open` already use throughout `pv-core` |
| `sqlx` | `0.8`, workspace-pinned | The new atomic re-key/removal transaction, `BEGIN IMMEDIATE` | Established discipline (`vault.rs`, `invitations.rs`) for read-then-write handlers under SQLite WAL |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Client-computed rewrap batch, server stores opaquely | Server-side re-encryption | Rejected outright — violates zero-knowledge; the server can never see a `CollectionKey` or `ItemKey` in plaintext. Not a real option for this codebase. |
| New `GET /api/vault/collections/{id}/items` endpoint | Reuse `GET /api/vault/items` | Rejected — that endpoint's collection-scoped arm is `WHERE i.user_id = ?` (caller-authored only, confirmed by reading `fetch_items_for`'s SQL), so it structurally cannot return a collection's FULL item set from every author, which both UX-04's disclosure list and the re-key batch need. |

**Installation:** none — no new dependencies.

## Package Legitimacy Audit

**Not applicable this phase.** No new external packages are installed by any planned change — every crate and npm package this phase touches (`crypto_box`, `chacha20poly1305`, `sqlx`, `lucide-react`, `daisyui`) is already a pinned, previously-audited dependency from Phases 21–24. If the planner discovers a genuine new-package need while implementing (unlikely given the above), the Package Legitimacy Gate protocol must be run before adding it to the plan.

## Architecture Patterns

### System Architecture Diagram

```
Owner's browser (React/Next.js)                      pv-server (axum)                         SQLite
─────────────────────────────────                    ──────────────────                       ──────
[Remove-member dialog opens]
        │
        ▼
GET /api/families/members/{uid}/access ─────────────► member_access() [existing, FAM-03]
        │  (collections[], item_shares[])
        ▼
GET /api/vault/collections/{cid}/items ─────────────► NEW: collection_items() [Membership<Collection,RequireRead>]
        │  (per-collection: [{id, enc_key, enc_data}])
        ▼
[client-side, per collection the target member could reach:]
  unsealCollectionKey(my_sk, my_sealed_key)  ── OLD CollectionKey, already held by caller
  WasmCollectionKey.generate()               ── NEW CollectionKey
  for each remaining recipient:
    sealCollectionKey(new_ck, recipient_pk)  ── new sealed_key per remaining member
  for each item in the collection:
    rewrapItemKeyForCollection(old_ck, new_ck,   ── NEW pv-core/pv-wasm primitive
                                enc_key, cid, item_id)  (enc_data untouched)
        │
        ▼  (batch payload: target_user_id, per-collection {new sealed_keys[], new item enc_keys[]})
POST /api/families/members/{uid}/remove ────────────► NEW: remove_member() [FamilyMembership<RequireEdit>, owner-only]
                                                              │
                                                              ▼
                                                       BEGIN IMMEDIATE tx:
                                                         1. verify item-set completeness
                                                            (server-side re-SELECT item ids
                                                             per collection; reject 409 on
                                                             mismatch — race guard)
                                                         2. DELETE collection_keys WHERE
                                                            recipient_user_id = target
                                                            (every collection)
                                                         3. UPDATE collection_keys.sealed_key
                                                            for every remaining recipient
                                                         4. UPDATE vault_items.enc_key
                                                            for every affected item
                                                            (enc_data column never referenced)
                                                         5. DELETE family_members WHERE
                                                            user_id = target
                                                         6. UPDATE users SET vault_revision =
                                                            vault_revision + 1 WHERE id = target
                                                            (WR-07 fix, own-counter bump)
                                                       COMMIT
                                                              │
                                                              ▼
                                                       resolve_collection_members() fresh,
                                                       per remaining collection → SyncEvent
                                                       fan-out (SYNC-05, membership at emit time)
        │
        ▼
[Removed member's NEXT request to any Membership/
 FamilyMembership-gated route: 404 — family_members
 row is gone, Collection::resolve_access's join
 finds nothing]
```

### Recommended Project Structure

```
crates/pv-core/src/items.rs        # + rewrap_item_key_for_collection(old_ck, new_ck, enc_key, collection_id, item_id)
crates/pv-wasm/src/lib.rs          # + rewrapItemKeyForCollection wasm-bindgen export
crates/pv-server/migrations/0018_member_suspension_and_status.sql
                                    # family_members.status; additive-only
crates/pv-server/src/routes/
  membership.rs                    # Collection/Item::resolve_access: join `AND fm.status = 'active'`
  families.rs                      # + suspend/reinstate/remove/member-access-items handlers
  collections.rs                   # + collection_items() (GET .../{id}/items)
  vault.rs                         # unchanged — re-key never touches enc_data
  auth.rs (or a new delete_account.rs) # + account-deletion handler (FK-ordered transaction)
web/src/lib/
  families/api.ts                  # + suspendMember/reinstateMember/removeMember/getMemberAccessItems
  vault/api.ts                     # + getCollectionItems(collectionId)
  crypto/index.ts                  # + re-export rewrapItemKeyForCollection
  families/rekey.ts (new)          # client-side batch-building orchestration (crypto + API glue)
web/src/components/settings/
  FamilyTab.tsx                    # + Members section, suspended banner
  SecurityTab.tsx                  # + Delete-account section
  RemoveMemberDialog.tsx (new)
  DeleteAccountDialog.tsx (new)
  ConfirmDialog.tsx                # + severity?: "error" | "warning" prop (suspend reuses this)
```

### Pattern 1: Guarded-DELETE-in-WHERE atomicity (reuse, not new)
**What:** Fold an invariant check into the DELETE's own `WHERE ... AND EXISTS(...)` clause so a single SQL statement is the enforcement mechanism, rather than a separate SELECT-then-DELETE that a concurrent request can race.
**When to use:** Any guard that must survive concurrent requests without a second lock primitive. `collections.rs::revoke_access`'s "never orphan the last key-holder" guard is the direct precedent — this phase's removal path doesn't need this exact guard (removal always leaves the owner as a key-holder, since the owner cannot remove themselves — no ownership-transfer concept per CONTEXT.md), but the SAME transactional discipline (guard folded into the statement, not a separate round trip) applies to the item-set-completeness check in the re-key transaction (step 1 in the diagram above).
**Example:**
```rust
// Source: crates/pv-server/src/routes/collections.rs:383-394 (existing, shipped)
let result = sqlx::query(
    "DELETE FROM collection_keys \
      WHERE collection_id = ? AND recipient_user_id = ? \
        AND EXISTS (SELECT 1 FROM collection_keys \
                     WHERE collection_id = ? AND recipient_user_id <> ?)",
)
```

### Pattern 2: Own-counter bump on revocation (WR-07's fix, precedent already shipped for the sibling path)
**What:** When a recipient's access is revoked, bump THAT recipient's own personal sync counter (not the resource's counter, which they can no longer query) in the SAME transaction as the DELETE — so their own next poll detects the change and locally prunes what they can no longer see.
**When to use:** Any revocation of collection-scoped OR direct-share access. `vault.rs::revoke_share` already does this correctly for the `item_shares`/`shared_direct_revision` pair; `collections.rs::revoke_access` and the new member-removal path both need the equivalent for `collection_keys`/`vault_revision`.
**Example:**
```rust
// Source: crates/pv-server/src/routes/vault.rs:1373-1376 (existing, shipped — revoke_share)
sqlx::query("UPDATE users SET shared_direct_revision = shared_direct_revision + 1 WHERE id = ?")
    .bind(&target_user_id)
    .execute(&mut *tx)
    .await?;
// This phase's fix (collections.rs::revoke_access AND the new member-removal path):
// same shape, but bumps `vault_revision`, not `shared_direct_revision` — collection-
// scoped items surface via GET /api/vault/items (vault_revision-gated), never via
// the direct-share bucket.
sqlx::query("UPDATE users SET vault_revision = vault_revision + 1 WHERE id = ?")
    .bind(&target_user_id)
    .execute(&mut *tx)
    .await?;
```

### Pattern 3: Fresh-per-request access resolution (already the load-bearing property FAM-09 needs)
**What:** `Membership<R, M>`/`FamilyMembership<M>` (`crates/pv-server/src/routes/membership.rs`) resolve access via a fresh DB query on EVERY request — never cached in `AppState`, the session, or the token.
**When to use:** This is already universal in this codebase (documented in `membership.rs`'s own module doc comment as the property SHARE-06 and FAM-09 both depend on). This phase's ONLY job is making sure the new `status` column (suspension) and the row-deletion (removal) are visible to these SAME queries — i.e., extend `Collection::resolve_access`'s and `Item::resolve_access`'s existing `family_members` join with `AND fm.status = 'active'`, and confirm (don't assume) that no other code path caches a resolved `AccessLevel`.
**Verification obligation:** CONTEXT.md explicitly instructs "verify this is actually true rather than assuming it." Grep every route handler for any `AccessLevel`/membership value stored on `AppState`, in a session field, or in a token claim — none should exist. This session's reading of `membership.rs`, `session.rs`, and every route file confirms no such cache exists today; the plan should still include this as an explicit negative-test acceptance criterion (a suspended/removed member's cached-nothing property, proven by a live 404/empty-response on the very next request after suspend/remove, not merely asserted by code inspection).

### Anti-Patterns to Avoid
- **Re-encrypting `enc_data` on removal:** SC 6 and KEY-02 are explicit — only `enc_key` (the wrap) and `collection_keys.sealed_key` change. Any code path that calls `encrypt_item_for_collection` (which re-encrypts the payload) during removal, instead of a dedicated rewrap-only primitive, violates this phase's core guarantee and must fail the byte-identity test.
- **Server-side batch construction:** The server must never attempt to compute a rewrap itself (it cannot — it has no key material). Every plan task involving "the server computes new sealed keys" is a zero-knowledge violation.
- **Multiple transactions for one logical removal:** PITFALLS.md Pitfall 13's exact warning sign — "any re-key implementation issuing more than one `sqlx` transaction for a single logical removal event." The removal endpoint must be ONE `tx.begin()...tx.commit()`, covering every collection the member could reach, not one transaction per collection.
- **Deleting the `users` row before dissolving an owned family:** Violates the `families.owner_user_id` FK. See Common Pitfalls below.
- **`.await` inside a `for member in members` loop that's also inside a `sqlx::Transaction`** (Pitfall 12's literal warning sign) — construct every `WrappedKey`/`SealedKey` blob client-side in memory first (cheap, no I/O), then issue the DB write as a small, fixed number of batched statements (a multi-row `INSERT ... VALUES (?,?),(?,?),...` or a small loop of prepared statements issued back-to-back without intervening awaited I/O other than the query itself).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| X25519 sealed-box reseal | A hand-assembled ECDH+HKDF wrap | `pv_core::identity::seal`/`unseal_collection_key` (already shipped, KEY-05's decision) | Already reviewed, tested (small-order-point rejection, CR-01), and exact-pinned. |
| Item-key rewrap-only (new this phase) | Ad hoc re-derivation of the AAD scheme | Mirror `build_coll_item_aad`'s EXACT prefix/length-prefixed construction from `items.rs`, reusing the SAME `AAD_COLL_ITEM_KEY_PREFIX` constant (never a new prefix) | The new rewrap function must produce an `enc_key` blob that `decrypt_item_for_collection` can still open under the SAME AAD scheme — only the raw key BYTES underneath change, not the AAD derivation. Inventing a parallel AAD scheme breaks every existing decrypt call site silently. |
| Nonce generation for the batch rewrap | A "batch-optimized" cipher/nonce reuse shortcut | Call `aead_seal`/`crypto_box`'s existing per-call `OsRng`-sourced nonce generation once per recipient/item, exactly like every existing single-recipient call site | PITFALLS.md Pitfall 3 names this exact anti-pattern by number; the existing primitives already do this correctly — the ONLY way to introduce a bug here is writing a new "optimized" loop instead of calling the existing per-call functions N times. |
| Optimistic-concurrency guard for the re-key batch | A new locking primitive / distributed lock | Re-`SELECT` the collection's current item-id set INSIDE the same transaction and compare against the client-submitted batch's item-id set; reject (409) on any mismatch | Matches this codebase's existing `expected_revision`-style optimistic-concurrency pattern (`vault.rs::update`) — SQLite is single-writer, `BEGIN IMMEDIATE` already serializes concurrent writers, so a fresh in-transaction re-read is sufficient; no new primitive needed. |
| Fault-injection mechanism for KEY-07 | A crash-simulation framework / process-kill harness | A deliberately-malformed row inside the batch (e.g., an `item_id` that doesn't exist in the collection, or a duplicate `recipient_user_id` triggering the `collection_keys` composite PK conflict) positioned mid-batch, forcing a real SQL error partway through the transaction's statement sequence | See Common Pitfall "Fault-injection mechanism" below — this codebase has no existing crash-simulation harness, and building one is disproportionate; a genuine, deterministic SQL-level fault achieves the same proof (transaction rolled back atomically) without new test infrastructure. |

**Key insight:** Every crypto primitive this phase needs beyond the one new rewrap function already exists and is already tested. The risk in this phase is almost entirely in the SERVER-SIDE transactional orchestration (atomicity, FK ordering, race-safety) and the CLIENT-SIDE batch-construction glue (a new, one-off orchestration module) — not in inventing new cryptography.

## Common Pitfalls

### Pitfall 1: Deleting the owner's `users` row before dissolving the family
**What goes wrong:** `DELETE FROM users WHERE id = <owner_id>` is attempted while `families.owner_user_id` still references that row (no `ON DELETE` action on that FK) — SQLite (with SQLx's foreign-key enforcement, see Assumptions Log) rejects the DELETE with `SQLITE_CONSTRAINT_FOREIGNKEY`.
**Why it happens:** Every OTHER `users`-referencing table in this schema (`vault_items`, `folders`, `passkeys`, `sessions`, `user_keypairs`, `family_members`, `collection_keys`, `item_shares`, `identity_verifications`) is `ON DELETE CASCADE` — it's natural to assume deleting the user row is always sufficient and self-cascading. `families.owner_user_id` is the one exception, because there was never a prior code path that deleted a family.
**How to avoid:** In the owner-self-deletion transaction, delete in this exact order: (1) `DELETE FROM vault_items WHERE collection_id IN (SELECT id FROM collections WHERE family_id = ?)` (closes Pitfall 2 below first), (2) `DELETE FROM families WHERE id = ?` (cascades `family_members`/`collections`/`collection_keys`), (3) `DELETE FROM users WHERE id = ?` (now unblocked, cascades everything else).
**Warning signs:** Any account-deletion code path that issues `DELETE FROM users` as its first or only statement for an owner account.

### Pitfall 2: Deleting a `collections` row while `vault_items` still reference it
**What goes wrong:** `vault_items.collection_id REFERENCES collections(id)` has no `ON DELETE` action either (confirmed by reading `0014_family_sharing.sql`'s literal `ALTER TABLE ... ADD COLUMN collection_id TEXT REFERENCES collections(id);` — no cascade clause). Deleting a `collections` row (only ever needed by owner-account-deletion in this milestone — there is no other "delete a collection" endpoint) while any item still points at it raises the same FK violation as Pitfall 1.
**Why it happens:** This codebase has never exercised collection deletion before this phase; there is no existing code to copy the ordering from.
**How to avoid:** Delete every `vault_items` row scoped to the doomed family's collections BEFORE deleting the `collections` rows (see Pitfall 1's step 1) — in the SAME transaction. Do not attempt to "convert" those items back to personal scope (`collection_id = NULL`) instead of deleting them — KEY-03's AAD binds `collection_id` into both `enc_key` and `enc_data`'s associated data (`build_coll_item_aad`), so flipping the column without re-encrypting under a personal-scope AAD would make the item permanently undecryptable (proven directly by `items.rs`'s own test `collection_blob_rejected_under_personal_scope`). CONTEXT.md's decision ("every collection and its wrapped keys go with it") is consistent with deletion, not conversion.
**Warning signs:** Any migration or handler that sets `vault_items.collection_id = NULL` as part of a collection-teardown path, or that deletes `collections` before `vault_items`.

### Pitfall 3: Treating "SQLite FK enforcement" as a given without verifying it in THIS pool
**What goes wrong:** Pitfalls 1 and 2 above are only load-bearing if foreign keys are actually enforced on the live connection pool. If they are NOT enforced, the same wrong-order deletes would silently leave dangling rows instead of erroring — arguably worse (silent data corruption vs. a loud failure).
**Why it happens:** SQLite defaults foreign-key enforcement to OFF at the C-library level; SQLx's `SqliteConnectOptions` is documented to override this default to ON [CITED, not empirically re-verified against `pv-server`'s actual `build_pool()` this session]. `crates/pv-server/src/lib.rs::build_pool` does not explicitly call `.foreign_keys(...)` — it relies entirely on SQLx's own default.
**How to avoid:** Add a direct `PRAGMA foreign_keys` assertion test, mirroring the existing `build_pool_enables_wal_journal_mode` test in `crates/pv-server/src/lib.rs` (same file, same pattern — `PRAGMA journal_mode` is already asserted there for WAL; add the FK-enforcement equivalent). This closes the Assumptions Log entry below with real evidence before the account-deletion ordering logic is trusted.
**Warning signs:** Any test asserting cascade/FK behavior indirectly (e.g., "row X is gone after deleting Y") without ever directly querying `PRAGMA foreign_keys`.

### Pitfall 4: Fault-injection mechanism for KEY-07 that can't actually fail
**What goes wrong:** A test that starts a transaction, does the first write, then unconditionally returns `Err(...)` before committing "proves" atomicity by construction — every transaction in `sqlx` already rolls back on drop-without-commit, so this test cannot fail even against a broken implementation (e.g., one that accidentally commits partial work via a stray early `tx.commit()`).
**Why it happens:** This is the easiest test to write and looks like it satisfies "fault-injection," but CONTEXT.md is explicit: "the fault-injection test for KEY-07 is the phase's sharpest deliverable... prefer one that has been shown to fail against a deliberately broken implementation."
**How to avoid:** Construct a batch where ONE statement, positioned in the MIDDLE of the multi-row rewrap sequence, is guaranteed to violate a real constraint the server cannot pre-validate away — e.g., submit a rewrap batch naming an `item_id` that was deleted between the client's `GET /api/vault/collections/{id}/items` fetch and the removal request (a genuine, reachable race, not a synthetic one), or a duplicate `recipient_user_id` in the new-sealed-keys list that collides with `collection_keys`'s composite PK on the `UPDATE`/`INSERT`. Run this against the REAL handler (not a mock), then assert via a SEPARATE, freshly-opened connection that: (a) every `collection_keys.sealed_key` in the collection is byte-identical to its pre-transaction value, (b) every `vault_items.enc_key` in the collection is byte-identical to its pre-transaction value, (c) the removed member's `collection_keys` row is UNCHANGED (still present) — proving the whole batch rolled back, not just the failing statement. To prove the mechanism can actually catch a real bug, temporarily break the implementation (e.g., comment out the `BEGIN IMMEDIATE` mid-development, or split the transaction into two) and confirm the test goes red — then revert and confirm it goes green. This "kill-and-revert" proof belongs in the plan's own verification notes, not necessarily as a permanently-committed test.
**Warning signs:** A fault-injection test with no SEPARATE-connection verification step, or one whose only assertion is "the handler returned an error status."

### Pitfall 5: Cost-proportionality test that doesn't actually measure cost
**What goes wrong:** A test that merely asserts "the SQL touches the right ROWS" (by inspecting the query text or row counts) doesn't prove SC 2's actual claim — that wall-clock/transaction cost scales with THIS collection's member+item count, not the whole vault.
**Why it happens:** Measuring wall-clock time in a unit test is flaky by nature (CI variance); it's tempting to substitute a structural proxy instead.
**How to avoid:** Follow PITFALLS.md Pitfall 12's own recommended shape: build a load test with a REALISTIC family size (e.g., 10 members, 5 shared collections, dozens of items across them) and assert two things directly: (1) the removal transaction's duration for a SPECIFIC collection does not measurably grow when UNRELATED collections/vaults in the same database have orders of magnitude more data (proves "not O(whole vault)"); (2) a direct row-count assertion inside the transaction — via `sqlx::query_scalar` — that EXACTLY the affected collection's `collection_keys` rows (member count) and `vault_items` rows (item count) were touched, and a control collection's rows are provably untouched (byte-identical `enc_key`/`sealed_key` before/after). This combines a structural completeness proof with a genuine scaling proof, rather than relying on wall-clock alone.
**Warning signs:** A load test asserting only "N rows were touched" without a companion assertion that an unrelated, much-larger dataset in the same DB is provably untouched.

### Pitfall 6: `enc_data` byte-identity asserted indirectly
**What goes wrong:** Inferring "payload wasn't touched" from the cost measurement (SC 2's test) instead of a direct byte comparison is explicitly called out as insufficient by SC 6's own wording ("asserted DIRECTLY rather than inferred from the cost measurement").
**How to avoid:** Before the removal transaction runs, snapshot every affected item's `enc_data` column value via a direct `SELECT enc_data FROM vault_items WHERE collection_id = ?` (raw bytes, not decrypted — no key material needed for this assertion). After the transaction commits, re-`SELECT` the same rows and assert `assert_eq!` on the raw ciphertext strings, one row at a time, by `id`. This is a pure DB-level assertion requiring no crypto material at all — the cheapest, most direct proof available.
**Warning signs:** A test that decrypts before/after and compares plaintext (proves less — plaintext equality doesn't prove ciphertext bytes are identical, since AEAD is non-deterministic and a "successful re-encrypt to the same plaintext" would pass a plaintext-only check while still violating SC 6).

### Pitfall 7: Nonce-safety test that doesn't actually generate a realistic batch
**What goes wrong:** A property test asserting "no two nonces collide" over a TINY batch (e.g., 3 items) has near-zero statistical power to catch a real reuse bug (a deterministic/hoisted-nonce bug would still very likely produce distinct-looking output at N=3, especially with XChaCha20's 24-byte nonce space).
**How to avoid:** PITFALLS.md Pitfall 3 already names the exact mitigation: "Add a property test asserting no two nonces collide across a batch re-wrap of a synthetic large membership list." Use a synthetically large batch (e.g., 200+ items/members, well beyond any realistic family size) purely to give the collision-detection test statistical teeth, and assert EVERY nonce in the batch (both the `collection_keys.sealed_key` reseals' `SealedKey.nonce` fields AND the `vault_items.enc_key` rewraps' `WrappedKey.nonce` fields) is pairwise-distinct.
**Warning signs:** A nonce-uniqueness test using the same small member/item count as the phase's other functional tests.

### Pitfall 8: WR-07's fix applied to the wrong counter
**What goes wrong:** Copying `revoke_share`'s exact bump (`shared_direct_revision`) for the collection-scoped removal/revocation path instead of `vault_revision` — the two counters gate two DIFFERENT client-visible surfaces (`GET /api/sync/shared/direct` vs. `GET /api/sync`), and bumping the wrong one leaves the actual staleness bug (collection-scoped items the revoked member authored) unfixed while looking like a fix.
**How to avoid:** See Architecture Pattern 2 above — bump `users.vault_revision`, not `shared_direct_revision`, for the collection-keys deletion case. Write the regression test as: revoked/removed member has authored an item inside the collection before revocation, their client has already synced it locally (simulate via a prior successful `GET /api/sync` at `since=0`), then after revocation their next `GET /api/sync?since=<their-last-revision>` must return a fresh snapshot (not `UpToDate`), proving the local prune path is reachable.

## Code Examples

### New pv-core primitive: rewrap-only for a collection-scoped item's key
```rust
// New function, crates/pv-core/src/items.rs — sibling to encrypt_item_for_collection/
// decrypt_item_for_collection above it. Reuses the SAME AAD_COLL_ITEM_KEY_PREFIX
// constant and build_coll_item_aad() helper already defined in this file — this is
// NOT a new AAD scheme, only a new operation (unwrap-then-reseal) over the existing one.
pub fn rewrap_item_key_for_collection(
    old_ck: &CollectionKey,
    new_ck: &CollectionKey,
    old_enc_key: &WrappedKey,
    collection_id: &str,
    item_id: &str,
) -> Result<WrappedKey, CryptoError> {
    let aad = build_coll_item_aad(AAD_COLL_ITEM_KEY_PREFIX, collection_id, item_id, 0);
    let mut key_bytes = aead_open(old_ck.expose(), old_enc_key, &aad)?;
    if key_bytes.len() != KEY_LEN {
        key_bytes.zeroize();
        return Err(CryptoError::Decrypt);
    }
    let new_enc_key = aead_seal(new_ck.expose(), &key_bytes, &aad)?;
    key_bytes.zeroize();
    Ok(new_enc_key)
    // Note: enc_data is never referenced by this function's signature at all —
    // that is itself part of SC 6's proof: the type signature makes touching
    // enc_data a compile-time impossibility, not merely a runtime discipline.
}
```

### `BEGIN IMMEDIATE` discipline (reuse verbatim, this codebase's established pattern)
```rust
// Source: crates/pv-server/src/routes/vault.rs:701 (existing, shipped) — the exact
// documented fix for a REAL production bug (SQLITE_BUSY_SNAPSHOT, commit c94c379):
// a deferred BEGIN reads a snapshot at first STATEMENT, not at BEGIN itself, so a
// read-then-write handler racing a concurrent writer can be rejected under WAL.
let mut tx = state.db.begin_with("BEGIN IMMEDIATE").await?;
```

### Real-WASM regression pattern for the new rewrap primitive (test-authoring analog)
```typescript
// Analog: web/src/lib/invite/crypto.real-wasm.test.ts (existing, shipped, WR-10's fix
// for the "unit suite mocks @/lib/crypto wholesale" structural blind spot). This
// phase's rewrap-only primitive needs the SAME treatment — a test file with NO
// `vi.mock("@/lib/crypto", ...)`, loading the real compiled wasm binary, proving
// `rewrapItemKeyForCollection`'s output actually decrypts via the REAL
// `decryptItemForCollection` under the NEW CollectionKey, and — separately — that
// the OLD CollectionKey can no longer open the NEW enc_key (negative case).
// Structure to copy verbatim (stub only `global.fetch` for the wasm binary path,
// never the crypto module itself):
const wasmPath = path.join(process.cwd(), "public", "wasm", "pv_wasm_bg.wasm");
// ...(rest of the beforeAll wiring is byte-identical to the cited file)
```

## State of the Art

| Old Approach (original v0.4 research sketch) | Current Approach (this session, verified against shipped schema) | When Changed | Impact |
|--------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| `collections.key_version` pointer; items reference "the collection's current key" indirectly, removal touches ONLY `collection_keys` (O(members)) | No `key_version` column exists; `vault_items.enc_key` directly wraps under the collection's raw `CollectionKey` bytes — removal must rewrap `enc_key` per item too (O(members + items in that one collection)) | Never explicitly decided — the indirection was described in `.planning/research/v0.4/PITFALLS.md` (pre-Phase-21) but Phase 21's actual `items.rs` implementation (`encrypt_item_for_collection`) was built without it | The planner must NOT assume O(members)-only cost; SC 2's own wording ("members and items") already anticipated this, but a plan written against the OLD research doc alone would under-scope the rewrap work. |
| — | This phase adds the first-ever "delete a collection" code path (only reachable via owner-account-deletion) | This phase | No prior precedent to copy FK-ordering discipline from — must be worked out from the schema directly (done above, Pitfalls 1–2). |

**Deprecated/outdated:** The `key_version`-pointer design in `.planning/research/v0.4/PITFALLS.md` §3.3/§3.4/§4.1 (the `collections.key_version` column, `collection_key_recipients`/`collection_key_history` table names) does not match the shipped schema (`collections` has no `key_version`; the actual table is `collection_keys`, singular per-collection, not per-key-generation). Treat that document's SPECIFIC table/column names as historical design exploration, not as the implementation contract — the actual contract is the schema in `0014_family_sharing.sql` plus the crypto primitives in `pv-core` as they exist today.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | SQLx's `SqliteConnectOptions` enables `PRAGMA foreign_keys = ON` by default, and `pv-server`'s `build_pool()` (which never explicitly calls `.foreign_keys(...)`) therefore has FK enforcement active | Summary, Common Pitfalls 1–3 | If FK enforcement is actually OFF in this pool, Pitfalls 1–2's "loud failure, easy to catch in testing" framing is wrong — the real risk becomes SILENT dangling rows (a `families` row deleted while `vault_items` still reference its collections, with no error raised), which is harder to detect and must still be prevented by explicit ordering regardless. The recommended fix (Pitfall 3: add a direct `PRAGMA foreign_keys` test) resolves this before the account-deletion logic ships either way — but the plan's own tests must not assume "FK violation" is the failure mode without first confirming it via that test. |
| A2 | The new member-removal endpoint should be `FamilyMembership<RequireEdit>`-gated (owner-only, family-pathless) rather than `Membership<Collection, _>`-gated per-collection, since FAM-08 removes a member from the FAMILY (deleting their `family_members` row), which then needs to re-key EVERY collection they had access to in one call | Architecture Patterns, System Diagram | If the planner instead builds N per-collection removal calls (one per affected collection), Pitfall 13/PITFALLS.md's "more than one transaction for one logical removal" anti-pattern is directly violated — this is a design recommendation from first principles (following the existing `family_routes()` pathless-owner-only convention for `POST /api/families/members`), not a verified fact about code that doesn't exist yet, so flagging it as an assumption for the planner to confirm during design, not blindly copy. |

## Open Questions

1. **Does the removal endpoint need to handle a member who has ZERO collection/item access (a plain family member who was never shared anything)?**
   - What we know: `family_members` row deletion alone (no collections touched) is a valid, common case — CONTEXT.md's flat model doesn't require every member to hold any collection access.
   - What's unclear: Whether the SAME endpoint handles "family-only removal, zero re-key needed" as a degenerate zero-collection case of the general batch, or whether the plan should special-case it (skip the whole rewrap machinery when the member has no `collection_keys` rows at all).
   - Recommendation: Treat it as the natural zero-length case of the general batch (an empty per-collection rewrap list) — no special-casing needed, and this is exactly the case SC 2's "cost proportional to... never the whole vault" wants to be trivially true for.

2. **Exact wire shape of the account-deletion endpoint's request body for the re-key sub-step, when the deleting user is a plain MEMBER (not the owner) of a family**
   - What we know: FAM-10 says account deletion "runs the same re-key path as removal" — for a plain member, this is architecturally identical to an owner removing that member, just self-initiated. For an OWNER deleting their own account, no re-key happens at all (the family dissolves instead — CONTEXT.md's explicit decision).
   - What's unclear: Whether "runs the same re-key path" literally means the account-deletion handler internally calls the SAME Rust function the member-removal handler calls (recommended — DRY, matches CONTEXT.md's explicit "the same function, not a parallel implementation" instruction), and whether the CLIENT-SIDE batch computation for a self-deleting member is triggered automatically (client must compute the rewrap batch for every collection it can currently see, using its own already-unsealed CollectionKeys, then submit alongside the deletion request) or requires a confirm-then-fetch-then-compute round trip mirroring the remove-member dialog's own two-step shape.
   - Recommendation: Mirror the remove-member dialog's client-side flow exactly (fetch own access list via `GET /api/families/members/{own_user_id}/access`, fetch each collection's items, compute the batch, submit alongside the deletion confirmation) — this reuses the SAME client-side orchestration module (`families/rekey.ts`) for both "I removed someone" and "I'm deleting my own account as a member," differing only in WHOSE `user_id` is the target and which session's tokens are used.

## Environment Availability

Not applicable — this phase introduces no new external tool/service/runtime dependency. Every dependency (Rust/Cargo, SQLite, Node/npm, Playwright) is already required and verified by prior phases; this phase adds code within the existing toolchain only.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (server) | `cargo test --workspace` (built-in `#[tokio::test]`, no external framework) |
| Framework (web unit) | Vitest, `web/vitest.config.ts` |
| Framework (web e2e) | Playwright, `web/playwright.config.ts` |
| Config file | `crates/pv-server/Cargo.toml` (no separate test config); `web/vitest.config.ts`; `web/playwright.config.ts` |
| Quick run command | `cargo test -p pv-server --test collections` (or the new `tests/family_removal.rs`/`tests/account_deletion.rs` this phase adds) |
| Full suite command | `cargo build --workspace && cargo build -p pv-wasm --target wasm32-unknown-unknown --release && cargo test --workspace` (per `.planning/config.json`'s `test_command`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FAM-07 | Suspend is reversible, immediate, no re-key | integration | `cargo test -p pv-server --test families -- suspend` | ❌ Wave 0 |
| FAM-08 | Removal triggers scoped, atomic re-key behind 2nd confirmation | integration + e2e | `cargo test -p pv-server --test families -- remove_member` / `npx playwright test remove-member` | ❌ Wave 0 |
| FAM-09 | Suspended/removed member loses access on very next request | integration | `cargo test -p pv-server --test families -- immediate_access_loss` | ❌ Wave 0 |
| FAM-10 | Account deletion runs the same re-key path before dropping the user row | integration | `cargo test -p pv-server --test account_deletion` | ❌ Wave 0 |
| KEY-06 | Re-key cost proportional to that collection's members+items, never whole vault | load test | `cargo test -p pv-server --test families -- rekey_cost_proportional --ignored` (load tests conventionally `#[ignore]`d, run explicitly) | ❌ Wave 0 |
| KEY-07 | Re-key atomic under fault injection; no nonce reuse in batch | integration (fault injection) + property | `cargo test -p pv-server --test families -- rekey_atomic_under_fault` / `cargo test -p pv-core -- nonce_uniqueness_large_batch` | ❌ Wave 0 |
| SEC-07 | Batch rewrap never reuses a nonce | property test | `cargo test -p pv-core -- nonce_uniqueness_large_batch` | ❌ Wave 0 |
| UX-04 | Removal confirmation lists real item names, honesty copy | e2e (Playwright, real WASM) + component | `npx playwright test remove-member-dialog` / `npm run test -- RemoveMemberDialog` | ❌ Wave 0 |
| KEY-02 (SC 6) | `enc_data` byte-identical before/after re-key, asserted directly | integration | `cargo test -p pv-server --test families -- rekey_enc_data_byte_identical` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cargo test -p pv-server --test <relevant file>` (or `npm run test -- <relevant component>` for web changes)
- **Per wave merge:** `cargo test --workspace` + `npm run test` + `npm run test:e2e` (relevant specs)
- **Phase gate:** Full suite green (`cargo build --workspace && cargo build -p pv-wasm ... && cargo test --workspace`, plus `npm run test`/`npm run test:e2e` for web) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `crates/pv-server/tests/family_removal.rs` — covers FAM-07/08/09, KEY-06/07, SEC-07, KEY-02(SC6)
- [ ] `crates/pv-server/tests/account_deletion.rs` — covers FAM-10, the FK-ordering hazard (Pitfalls 1–2)
- [ ] `crates/pv-core/src/items.rs` new `#[cfg(test)] mod tests` cases for `rewrap_item_key_for_collection` (roundtrip, wrong-old-key rejection, AAD collision resistance with the existing key-wrap/data-wrap prefix separation test)
- [ ] `web/src/lib/families/rekey.real-wasm.test.ts` (new file, mirrors `crypto.real-wasm.test.ts`'s no-mock pattern) — covers the client-side batch-computation half of UX-04/KEY-02
- [ ] `web/e2e/remove-member.spec.ts` / `web/e2e/delete-account.spec.ts` (new, reusing `twoSessions`/`ensureFamilyOwnerSession` fixtures from `web/e2e/fixtures.ts`)
- [ ] `crates/pv-server/src/lib.rs` new test: direct `PRAGMA foreign_keys` assertion (closes Assumption A1 / Pitfall 3) — small, high-leverage addition to the EXISTING `build_pool_enables_wal_journal_mode`-style test block
- [ ] Route-sweep/cardinality tripwire updates: `crates/pv-server/src/routes/mod.rs`'s `family_routes()`/`membership_routes()` tables gain new entries (suspend/reinstate/remove/account-delete/collection-items) — the existing `membership_routes_table_has_expected_cardinality`/`family_routes_table_has_expected_cardinality` tests (currently asserting `.len() == 10`/`.len() == 6`) MUST be updated in the same commit that adds routes, or they fail by design (this is the intended tripwire behavior, not a bug to work around).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (unchanged) | `SessionUser` bearer-token validation, unmodified by this phase |
| V3 Session Management | yes | FAM-09's "no already-issued token carries access" property — enforced by keeping resource authorization (`Membership`/`FamilyMembership`) strictly separate from token validity (`SessionUser`), never folding a resolved access level into the token/session record |
| V4 Access Control | yes | Owner-only gating (`FamilyMembership<RequireEdit>`) on suspend/reinstate/remove; "owner cannot suspend/remove themselves" as an explicit server-side guard, not merely a hidden UI affordance |
| V5 Input Validation | yes | The re-key batch's completeness/shape must be server-validated (item-id set matches the live collection, no orphaned/foreign item ids injected) before any write — never trust the client's enumerated set blindly, even though the CONTENT (sealed keys) is opaque and inherently trusted by zero-knowledge design |
| V6 Cryptography | yes — never hand-roll | Reuse `pv_core::identity::seal`/`unseal_collection_key` and the existing `aead_seal`/`aead_open` primitives for the new rewrap function; no new cryptographic construction, only a new composition of existing ones |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Confused-deputy: attacker-supplied `target_user_id` in a removal/suspend request names someone outside the caller's own family | Elevation of Privilege | `FamilyMembership<RequireEdit>` already scopes the caller's OWN `family_id`; the new handler must additionally verify the target `user_id` actually has a `family_members` row in THAT SAME `family_id` before acting — mirrors `collections::add_member`'s existing confused-deputy guard pattern (verify family membership before any write) |
| Partial re-key leaves some recipients on old key, others on new (Pitfall 13) | Denial of Service / Tampering | Single `BEGIN IMMEDIATE` transaction covering the full batch, verified via the fault-injection test (Common Pitfall 4) |
| Nonce reuse in the batch rewrap (SEC-07) | Tampering / Information Disclosure | Per-call `OsRng` nonce generation (existing `aead_seal`/`crypto_box` primitives), proven via a large-batch property test (Common Pitfall 7) |
| Ex-member's cached local vault state (browser IndexedDB/localStorage, or extension `chrome.storage.session` in a LATER phase) retains decrypted shared content after removal | Information Disclosure | Out of THIS phase's mitigation scope for the extension (Phase 27), but the WEB client should clear/prune any locally-cached shared-collection state on the NEXT sync detecting the access loss — this is the client-side consequence of the WR-07 counter-bump fix (Common Pitfall 8), not a new mechanism |
| Removed member races the removal transaction by creating a new item in the collection between the client's item-list fetch and the removal request | Tampering (data loss / inconsistent state) | The server-side item-set completeness re-check inside the transaction (Architecture diagram step 1) rejects the whole batch (409) on any mismatch, forcing the owner's client to re-fetch and retry — never silently drops the race-created item nor silently strands it under the old key |

## Sources

### Primary (HIGH confidence — read directly this session)
- `crates/pv-server/src/routes/membership.rs` — `Membership<R,M>`/`FamilyMembership<M>` extractors, `Collection`/`Item::resolve_access`, fresh-per-request discipline
- `crates/pv-server/src/routes/collections.rs` — `revoke_access`'s guarded-DELETE pattern, `add_member`'s confused-deputy guard, `resolve_collection_members`
- `crates/pv-server/src/routes/families.rs` — `member_access`, `insert_family_member`, `resolve_family_role`'s owner/member → AccessLevel mapping
- `crates/pv-server/src/routes/vault.rs` — `fetch_items_for`'s caller-scoped SQL (confirms no existing "list a collection's full item set" endpoint), `revoke_share`'s own-counter-bump precedent, `BEGIN IMMEDIATE` discipline and its `c94c379` production-bug rationale
- `crates/pv-server/src/routes/mod.rs` — `family_routes()`/`membership_routes()` registration convention, cardinality tripwire tests
- `crates/pv-server/src/error.rs` — `ApiError` variants and their HTTP mapping
- `crates/pv-server/src/lib.rs` — `build_pool`'s `SqliteConnectOptions` (no explicit `.foreign_keys(...)` call), existing `PRAGMA`-assertion test pattern
- `crates/pv-core/src/items.rs`, `crates/pv-core/src/identity.rs`, `crates/pv-core/src/keys.rs` — every crypto primitive this phase reuses or extends
- `crates/pv-wasm/src/lib.rs` — `WasmCollectionKey`, `sealCollectionKey`/`unsealCollectionKey`, `encrypt_item_for_collection`/`decrypt_item_for_collection` bindings
- `crates/pv-server/migrations/0014_family_sharing.sql` through `0017_invitations.sql` — full current schema, FK topology, absence of `key_version`
- `crates/pv-server/tests/collections.rs` — `revoke_access_last_key_holder_guard_is_atomic_under_concurrency` (the codebase's own concurrency-proof reference pattern)
- `crates/pv-server/tests/common/mod.rs` — `register_second_family_member`, `create_family` test helpers
- `web/src/lib/crypto/index.ts`, `web/src/lib/vault/api.ts`, `web/src/lib/families/api.ts` — client-side API surface, confirms no existing collection-items listing client
- `web/src/lib/invite/crypto.real-wasm.test.ts` — the real-WASM regression test pattern this phase's new crypto must copy
- `web/src/components/vault/DeleteConfirmDialog.tsx`, `web/src/components/shell/Sidebar.tsx` — existing destructive-confirm and logout-sequence patterns
- `.planning/research/v0.4/PITFALLS.md` — Pitfalls 6–15 (the entire "Sharing/Removal/Re-key" and "Session/Access Control" sections), read in full this session
- `.planning/phases/25-member-removal-suspension-re-key/25-CONTEXT.md`, `25-UI-SPEC.md`
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md`

### Secondary (MEDIUM confidence)
- `.planning/research/v0.4/ARCHITECTURE.md` §4.3 (referenced in STATE.md, describing the account-deletion cascade gap) — content paraphrased from STATE.md's own quotation, not independently re-read in full this session (grep for "4.3"/"re-key" against the actual file returned no output, suggesting the STATE.md citation may reference a differently-numbered or since-edited section; the underlying CLAIM — cascade drops membership but not keys — was independently confirmed by reading the actual schema/code directly, so the finding itself is HIGH confidence even though the specific §4.3 citation could not be re-verified)

### Tertiary (LOW confidence, flagged in Assumptions Log)
- SQLx default foreign-key enforcement behavior — confirmed via general web search of SQLx documentation/community sources, NOT empirically re-verified against this exact `pv-server` connection pool this session (see Assumption A1, Common Pitfall 3)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, every primitive read directly from source this session
- Architecture (re-key mechanics, FK ordering): HIGH for the diagnostic findings (shipped-schema divergence from original research, FK topology), MEDIUM for the exact new-endpoint wire contract (designed from first principles, not yet reviewed against a plan)
- Pitfalls: HIGH — five of eight pitfalls are direct extensions of ALREADY-shipped, ALREADY-tested precedent in this exact codebase (guarded-DELETE, own-counter-bump, `BEGIN IMMEDIATE`); the FK-ordering pitfalls are new but grounded in a direct schema read

**Research date:** 2026-08-04
**Valid until:** 30 days (stable domain — no external API/library version drift risk; the one time-sensitive claim, SQLx FK-enforcement default, should be re-verified empirically at plan/execution time regardless of this validity window, per Pitfall 3)
