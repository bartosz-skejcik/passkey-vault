# Phase 31: The Share Dialog — Per-Person Access, Existing Destinations - Research

**Researched:** 2026-08-12
**Domain:** Rust/axum server-side access-control routes (`collection_keys`/`item_shares`), React/TypeScript share-dialog client orchestration, zero-knowledge collection-key re-sharing
**Confidence:** HIGH (every claim below is grounded in a read file:line; no external library research was needed — this phase introduces no new dependencies, only new routes/handlers/components inside the existing stack)

## Summary

This phase's two open technical questions (collection-scoped revocation, in-place level editing) both
resolve cleanly once the actual `collection_keys`/`item_shares` write surfaces are read end to end rather
than assumed from their names. **Q1** (revocation): `buildMemberRemovalBatch` is not a "wrong-scope"
variant of what this dialog needs — it is architecturally a different capability (family EVICTION:
`apply_member_removal_rekey` deletes the target's `family_members` row and severs every `item_shares`
grant on any item, `families.rs:757,749`), and a collection-scoped sibling would require a **brand-new
server endpoint** mirroring its three-step TOCTOU-safe verify-then-write shape
(`families.rs:611-782`) — a phase-sized undertaking, not a UI-phase afterthought. The already-shipped
`revokeCollectionAccess`/`revokeItemShare` (`collections.rs:687-825`, `vault.rs:1511-1554`) are already
scoped to exactly "this person, this collection/item," already satisfy the phase's own recorded proof bar
(access denial observable on next sync, not cryptographic key rotation), and are structurally unreachable
against a family-wide `item_bucket` because this phase's own destination selector excludes `item_bucket`
collections before a row can ever be rendered against one. **Recommendation: reuse
`revokeCollectionAccess`/`revokeItemShare`**, not `buildMemberRemovalBatch` — this is a deliberate
departure from CONTEXT.md's literal instruction, justified below and flagged for the planner to record as
a scope correction, not silently override.

**Q2** (in-place level editing): the wire gap the UI-SPEC found (`ON CONFLICT DO NOTHING` → `409`, no
UPDATE path) is real, but the "revoke-then-add, atomicity risk" framing overstates the actual cost. A
`collection_keys`/`item_shares` row's `sealed_key` is the SAME Collection Key or Item Key the recipient
already holds — an access-**level** change touches no key material at all, so the server-side fix is a
single new, narrow `PUT` route doing one `UPDATE ... SET access_level = ?` on the existing composite
primary key (`(collection_id, recipient_user_id)` / `(item_id, recipient_user_id)`,
`migrations/0014_family_sharing.sql:63-80`), gated by the exact same authorization bounds `add_member`
already enforces. This is atomic by construction (one SQL statement, no re-seal, no intermediate state),
needs zero new client-side crypto, and closes the "editable in place" gap the sixth proof obligation
depends on without ever risking the "held less access than either level, briefly" window the UI-SPEC
worried about. **Recommendation: add `PUT /api/vault/collections/{id}/access/{user_id}` and
`PUT /api/vault/items/{id}/shares/{user_id}`**, not a client-side revoke-then-add pair.

**Primary recommendation:** Reuse the shipped, correctly-scoped revocation endpoints for Q1; add two small,
metadata-only `PUT` update routes for Q2. Neither choice requires new client-side crypto composition beyond
what Phase 30 already built and proved (`reshareCollectionToNewMember`), and neither touches a Collection
Key or Item Key's sealed bytes.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-person access-level selection UI (MOD-01) | Browser / Client (`ShareDialog.tsx`) | — | Pure presentation + local pending-state reducer; no server concept of "a row" exists |
| Destination selection (existing folder vs. new) (MOD-02, ORG-03) | Browser / Client (new small selector) | API / Backend (`GET /api/vault/collections`) | Client fetches the caller's own editable collections and renders the choice; server already exposes the list, no new read endpoint needed |
| Granting a new recipient on an existing destination (ORG-03) | API / Backend (`collections::add_member`) | Browser / Client (`reshareCollectionToNewMember`) | Authorization + persistence is server-side; the crypto composition (unwrap-own-key, reseal-to-recipient) is client-side and already built (Phase 30) |
| Changing an existing recipient's level in place (MOD-01's 4th state) | API / Backend (**new** `PUT` routes) | Browser / Client (new thin wrapper) | Purely a metadata write against an already-existing row; no crypto touches the server, but the authorization bound (`may_grant_access_level`) must live server-side, matching every other grant-shaped decision in this codebase |
| Revoking a recipient from one destination (the phase's 6th proof obligation) | API / Backend (`collections::revoke_access` / `vault::revoke_share`) | Browser / Client (cache purge on next sync, DEBT-03/VIS-01) | Server owns the authoritative "does this row still exist" fact; client-observable revocation is a downstream effect of the server's DELETE, proven via the next completed sync |
| Decrypting items already in a newly-joined destination (SC3, ORG-03) | Browser / Client (`decrypt_item_for_collection` via WASM) | API / Backend (`GET /api/vault/collections/{id}/items`) | Server only ever serves opaque ciphertext; decryption is 100% client-side, the server's only role is authorizing the read via `Membership<Collection, RequireRead>` |
| Honest access-level copy (MOD-03) | Browser / Client (i18n dictionary) | — | Server has no concept of "hidden password is an interface protection" — this is pure client-side vocabulary, already shipped and reused verbatim |

## Package Legitimacy Audit

**Not applicable — this phase introduces no new external dependencies.** Every capability above is built
from code already present in `crates/pv-server`/`web/src` (new routes/handlers/components reusing the
existing `axum`, `sqlx`, `React`, `packages/pv-ui` stack). No `npm install`/`cargo add` is required by
anything recommended in this document.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Area 1 — The dialog's shape (per-person rows)**

- The global access-level control disappears for per-person shares. Level lives only in each person's own
  row — one place of truth, no "which one wins" question. "Cała rodzina" has no rows, so it keeps a single
  control for the whole share (unchanged from Phase 30).
- Every family member is a standing row with a level control that includes a "brak dostępu" option —
  *not* today's checkbox-then-reveal pattern. This overrides the recommendation, which was to keep
  checkboxes as the smaller change. The consequence Bartek accepted: the dialog stops being a share form
  and becomes the access picture for the chosen destination. Plan for a family large enough that the list
  scrolls, and make "who has what" readable at a glance.
- "Cała rodzina" and per-person rows stay mutually exclusive, exactly as Phase 30 shipped and tested. One
  share carries one intent. (Combining them was considered and rejected as its own phase.)
- A member who already has access to the chosen destination shows their real current level, and it is
  editable in place. The dialog shows the true state, and changing it is done where you see it.

**Area 2 — Destination, revocation, honest copy**

- A destination selector sits at the top of the dialog, above the person list: "new folder…" or one of the
  existing shared folders. It must come first because the destination is what determines the levels the
  rows display.
- "Brak dostępu" really revokes (the phase's sixth, unrecorded proof obligation, see below).
- The hidden-password disclosure renders once, below the list, conditionally — the moment *any* row is set
  to `hidden_password`. It must satisfy MOD-03's bar: visible without a hover and without a second click,
  and it must say that hidden-password is an interface protection and never a cryptographic one. Repeating
  it per row was rejected as text flooding.
- Reuse the shipped `access.readOnly` / `access.fullEdit` / `access.hiddenPassword` vocabulary verbatim
  (MOD-03). Do **not** reword those three shared strings.

### The sixth proof obligation (scope addition beyond ROADMAP's five SCs)

> Setting a member with existing access to "brak dostępu" and saving revokes it through the same
> correctly-scoped, atomic re-key path v0.4 established, and that member's own client loses the ability to
> decrypt on the next completed sync — live-proven with a positive "was readable" anchor before and the
> same read failing after.

CONTEXT.md instructs: "Reuse `buildMemberRemovalBatch` / `removeFamilyMember`
(`web/src/lib/families/rekey.ts`) rather than inventing a second revocation path." **This research finds
that instruction cannot be honored as literally written — see Q1 below.** CONTEXT.md also names the hard
constraint quick task 260812-01e introduced: `collections::revoke_access` now refuses outright on
`item_bucket` collections — the dialog must never offer per-person revocation against a family-wide item
bucket, and must surface that honestly rather than letting the call 403.

### Claude's Discretion

- The row control's exact form (select vs segmented control), scroll/virtualisation strategy, and how the
  destination selector renders an existing folder's name. (Resolved by 31-UI-SPEC.md: native `<select>`,
  single-scroll-region card with a pinned footer.)
- Whether the destination selector reuses `CollectionPicker` or gets its own component — note
  `CollectionPicker` was just changed by quick task 260812-01e to exclude `item_bucket` collections, and
  that exclusion must hold here too. (Resolved by 31-UI-SPEC.md: a new, narrower selector filtered to
  `access_level === "edit" && family_wide_kind !== "item_bucket"`, not `CollectionPicker` reused as-is.)
- All crypto and server-contract choices, per the standing rule that these are not Bartek's questions. —
  **This is exactly what Q1/Q2 below resolve.**
- Ordering of members in the list, and the empty/one-member cases. (Resolved by 31-UI-SPEC.md.)

### Deferred Ideas (OUT OF SCOPE)

- Combining "Cała rodzina" with per-person exceptions ("everyone at read, but Ania at edit"). Rejected for
  this phase: needs a rule for what a late joiner inherits when they were an exception, and a separate
  bucket for the exception set. Its own phase if ever wanted.
- A search/add-person control instead of a full member list. Rejected as cost without benefit at family
  scale.
- A "set for everyone" bulk control seeding the rows. Rejected to avoid two places that both claim to say
  what the level is.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MOD-01 | One row per selected person, access-level select on the right, per-person levels in one submission | `ShareDialog.tsx`'s existing single-`accessLevel` state (`ShareDialog.tsx:602`) confirmed as the exact defect to replace; row anatomy fully specified in 31-UI-SPEC.md; `grantCollectionToRecipients` (`ShareDialog.tsx:272-309`) already loops per-recipient and is the natural place to widen from "one level for all" to "one level per row" |
| MOD-02 | Target an existing shared folder, mint no new collection | Confirmed falsifiable today: `submitFolderVariant` (`ShareDialog.tsx:882-1023`) always calls `createCollection` when `createdCollectionRef.current === null`, which is always true at dialog-open regardless of `scope.existingFolderId` (that field only seeds items from a *personal* folder conversion, `ShareDialog.tsx:640-648`) — no code path skips creation today |
| MOD-03 | Honest access-level copy, hidden-password = interface-only, never cryptographic | Vocabulary already shipped (`dictionary.ts:1174-1176`, `1197-1223`); reuse verbatim per CONTEXT.md; 31-UI-SPEC.md's revised `share.hiddenPasswordInlineNote` strengthens the always-visible fallback copy to state the fact directly, closing checker blocker 2 |
| ORG-03 | An existing shared folder gains a new member without creating a second folder (v0.4 WINDOWS #13) | `reshareCollectionToNewMember` (`web/src/lib/families/reseal.ts:67-119`) is the exact composition needed — unwrap-own-key, reseal-to-one-recipient, grant via `addCollectionMember` — already built and real-WASM-proven in Phase 30 (`reseal.real-wasm.test.ts`); this phase is its second consumer as the ROADMAP predicted |
</phase_requirements>

## Q1 — Collection-Scoped Revocation

### What `buildMemberRemovalBatch` / `apply_member_removal_rekey` actually does

`buildMemberRemovalBatch(targetUserId, ownUk, isSelf)` (`web/src/lib/families/rekey.ts:96-176`) resolves
**every** collection the target currently holds a `collection_keys` row for
(`resolveTargetCollectionIds`, `rekey.ts:70-77`, backed by `getMemberAccess`/`listCollections` — both
return the target's **full** access set, never a single collection), then builds one re-key batch entry
per collection: a **freshly generated** Collection Key, resealed to every remaining recipient, every
item's `enc_key` rewrapped (`rekey.ts:109-164`). This batch is submitted via `removeFamilyMember` →
`removeMember` → the server's `apply_member_removal_rekey` (`crates/pv-server/src/routes/families.rs:611-782`).

That server function is not a generic "re-key N collections" primitive — it is **family-eviction shaped**,
by construction:

- Step 1 (`families.rs:632-657`): the **submitted collection SET must exactly equal** the target's full
  `collection_keys` set (KEY-06 guard) — submitting a subset (one collection) is a hard `409 Conflict`,
  not a partial success. There is no way to call this endpoint for "just this one folder."
- Step 4 (`families.rs:745-752`): unconditionally severs **every** `item_shares` row the target holds, on
  **any item, not scoped to `batch`'s collections**.
- Step 5 (`families.rs:754-761`): `DELETE FROM family_members WHERE family_id = ? AND user_id = ?` — the
  target is **removed from the family itself**.

Calling this path from a per-collection "brak dostępu" toggle would (a) 409 immediately unless the caller
happens to submit the target's entire access surface, and if that guard were somehow bypassed by widening
the endpoint, (b) evict the target from every other shared folder and every direct item share they hold,
and (c) remove them from the family. This is not "the right mechanism at the wrong scope" — it is a
different capability entirely (`FSH-04`/`FAM-10`'s job, not MOD-01's).

**Building a genuinely collection-scoped sibling is a new server capability, not a client-side
adjustment.** It would need its own transaction-scoped, TOCTOU-safe verify-then-write handler mirroring
`apply_member_removal_rekey`'s shape (steps 0-3: re-verify membership, verify submitted item-id set matches
actual, verify submitted remaining-recipient set matches actual, `families.rs:619-696`) but WITHOUT steps
4-6 (item_shares severance, family_members deletion) — a new route, a new request/response wire contract, a
new client batch-builder variant, and a parallel test suite proving the same fault-injection/atomicity
guarantees `families.rs:561-563`'s `FAULT_INJECT_AFTER_COLLECTION_INDEX` machinery already proves for the
existing path. This is realistically its own phase-sized unit of work, not something to build inside a
UI-ownership phase whose named risk (per the ROADMAP) is the dialog's shape.

### The already-shipped, already-scoped alternative

`collections::revoke_access` (`crates/pv-server/src/routes/collections.rs:687-825`,
`DELETE /api/vault/collections/{id}/access/{user_id}`) and `vault::revoke_share`
(`crates/pv-server/src/routes/vault.rs:1511-1554`, `DELETE /api/vault/items/{id}/shares/{user_id}`) are
**already exactly scoped** to "this one person, this one collection/item":

- `revoke_access`'s own doc comment (client-side mirror, `web/src/lib/vault/api.ts:292-299`): "No re-key:
  only the `collection_keys` row is deleted, item ciphertext is untouched."
- It carries a last-key-holder guard (`collections.rs:709-777`, atomic `DELETE ... WHERE ... AND EXISTS
  (SELECT 1 ... recipient_user_id <> ?)`) refusing to orphan a collection.
- It already bumps the revoked recipient's own `vault_revision` in the same transaction
  (`collections.rs:791-794`) — this is what makes the client's next `GET /api/sync` detect the change and
  prune the now-undecryptable collection (DEBT-03/VIS-01's cache-purge discipline is the client-side half
  of this same bound).
- **It already refuses on `item_bucket` collections** (`collections.rs:705-707`, quick task 260812-01e) —
  exactly the constraint CONTEXT.md calls out.

### Precisely how "weaker" cashes out, and why it does not matter here

The doc comment's "weaker, by design" claim is real but narrow: `revoke_access` does not rotate the
underlying Collection Key, so a revoked member who already held the raw (unwrapped) key in memory retains
the *cryptographic* ability to decrypt ciphertext of that collection **if they can obtain it through any
channel the server's own ACL does not gate** — e.g. a remaining member forwarding raw ciphertext bytes
out-of-band. `buildMemberRemovalBatch`'s full re-key forecloses that even in a channel-leak scenario. What
`revoke_access` DOES guarantee, transactionally, is the property this phase's sixth proof obligation
actually asks for: **the revoked recipient's own client, through the server's own authorized channels
(`GET /api/sync`, `GET /api/vault/collections/{id}`, `GET /api/vault/collections/{id}/items`, the WS
push), loses the ability to decrypt on the next completed sync** — every one of those routes is
`Membership<Collection, _>`-gated and resolves to `None`/404 the instant the `collection_keys` row is
gone (`membership.rs:196-230`). Nothing in Phase 31's five ROADMAP success criteria, nor the sixth proof
obligation's own wording ("loses the ability to decrypt on the next completed sync"), asks for the
stronger cryptographic-rotation bound. Re-litigating that trade-off was explicitly judged sufficient for
SHARE-06 in v0.4 and is out of this phase's stated boundary.

### The item_bucket constraint is structurally unreachable from this dialog, by construction

31-UI-SPEC.md's Destination Selector Contract already filters the folder-destination `<select>` to
`access_level === "edit" && family_wide_kind !== "item_bucket"` (mirroring
`SharingOverviewPanel.tsx:315`'s own "collections I manage" predicate) — an `item_bucket` collection can
never even be selected as a destination in this dialog, so its per-person rows can never target one. For
`scope.kind === "item"`, per-person rows resolve to direct `item_shares` grants (`createItemShare`/
`revokeItemShare`) — a structurally different table with no `item_bucket` concept at all; the family-wide
ITEM path (which DOES use an `item_bucket` collection) stays on its separate, mutually-exclusive "Cała
rodzina" toggle with no per-person rows. **The constraint still needs a defensive check** (never trust
client-side exclusion alone — a stale `destinationId` mid-session is a realistic TOCTOU window if a second
device deletes/recreates collections concurrently), but the server's own unconditional refusal
(`collections.rs:705-707`) is the enforcement backstop regardless.

### Recommendation

**Use `revokeCollectionAccess`/`revokeItemShare`.** Reject `buildMemberRemovalBatch` reuse as CONTEXT.md
literally states it — the code does not support the scoped variant that instruction assumes, and building
one is an out-of-proportion new server capability for this phase. This is a deliberate, evidence-backed
departure from a locked decision; the planner should record it as a scope correction (citing this
research) rather than silently reinterpreting CONTEXT.md.

**Rejected alternative:** a new `collectionId`-scoped sibling of `apply_member_removal_rekey`. Named and
rejected for cost (new endpoint + new TOCTOU-safe verify shape + new tests, phase-sized) relative to
benefit (a stronger cryptographic-rotation guarantee nothing in this phase's success criteria requires).

## Q2 — Changing an Existing Recipient's Level In Place

### The wire gap, confirmed

`collections::add_member` (`collections.rs:532-674`) and `vault::create_share` (`vault.rs:1381-1501`)
both insert via `ON CONFLICT DO NOTHING RETURNING ... ` + `fetch_optional`
(`collections.rs:495-504`/`vault.rs:1458-1467`) — a duplicate grant returns `None`, mapped to
`ApiError::Conflict` (`collections.rs:640-642`/`vault.rs:1469-1471`), a `409`. **No server route updates
an existing row's `access_level`.** Confirmed by direct grep across `crates/pv-server/src/routes/` — the
only `UPDATE ... access_level` statement anywhere in the codebase is
`membership::claim_item_bucket_edit_in_tx` (`membership.rs:687-703`), which is narrowly scoped to the
260812-01e contributor-edit-claim mechanism (promotes a contributor to `edit` on an `item_bucket`
collection only) — not a general level-change primitive, and not reusable here.

### Why "revoke-then-add" is more expensive than it needs to be

A `collection_keys`/`item_shares` row's `sealed_key` is the **same underlying Collection Key or Item
Key** the recipient already holds — access level is a separate column on the same row
(`migrations/0014_family_sharing.sql:63-80`), not encoded in the key material at all. Nothing about
`hidden_password` vs `read` vs `edit` changes what bytes are sealed; `hidden_password` is enforced
entirely client-side (MOD-03's own "interface protection, never cryptographic" framing — confirmed nowhere
server-side does the string `hidden_password` gate any crypto operation, only `RequireEdit`'s exact-match
`== AccessLevel::Edit`, `membership.rs:118-126`, and `may_grant_access_level`'s propagation matrix,
`membership.rs:553-574`). **A level EDIT for an already-granted recipient therefore needs zero new key
material and zero re-sealing** — it is a pure metadata write. Treating it as "revoke, then re-add with a
fresh seal" (the UI-SPEC's flagged risk) manufactures an intermediate window (and a client-side re-seal
call) that the actual data model does not require.

### Recommendation: two new, narrow `PUT` routes

Add `PUT /api/vault/collections/{id}/access/{user_id}` and `PUT /api/vault/items/{id}/shares/{user_id}` —
same URL shape as the existing `DELETE` siblings already registered at those exact paths
(`crates/pv-server/src/routes/mod.rs:413-414,423-424`; axum supports chaining `.delete(...).put(...)` on
one `.route()` entry, so this is an additive method on an existing route registration, not a new path).

**Collection variant** (mirrors `add_member`'s exact authorization shape, `collections.rs:532-599`, minus
the parts that only make sense for a brand-new grant):

1. Parse/validate `access_level` from the request body (`parse_access_level_from_request`, existing
   helper) — fail closed on malformed input, before any DB work, matching every other handler in this
   file.
2. Apply the **same** two-layer authorization bound `add_member` already applies:
   `resolve_family_wide_declared_level` → `may_grant_access_level(membership.access, requested_level)`
   for the family-wide/legacy-unknown branch, `RequireEdit::satisfied_by` for the ordinary branch
   (`collections.rs:579-590`), **plus** `enforce_item_bucket_declared_level_bound`
   (`collections.rs:599`) unchanged — a level EDIT is authorization-equivalent to a level GRANT (same "may
   this caller hand this level to this person" question), so it must be bounded identically, closing off a
   would-be fourth propagation surface rather than opening one.
3. `UPDATE collection_keys SET access_level = ? WHERE collection_id = ? AND recipient_user_id = ?` — one
   statement, atomic by SQLite's own single-statement guarantee, no transaction needed beyond what the
   revision-bump/fan-out already requires. `rows_affected() == 0` → `404` (this is an EDIT of an existing
   row, never an upsert — a caller targeting a non-member is a not-found, not silently create-on-write).
4. Bump `collections.revision`-adjacent bookkeeping and fan out a `SyncEvent` exactly as `add_member`
   already does (`collections.rs:644-671`), so the newly-leveled recipient's next sync reflects it.
5. **No `sealed_key` field in the request body at all** — nothing for the server to receive, store, or (as
   ever) unwrap. Zero-knowledge holds trivially: the server sees a plaintext level string, exactly as it
   already does for every existing grant/revoke route.

**Item variant**: the identical shape against `item_shares`, gated by `Membership<Item, RequireEdit>`
(matching `create_share`'s existing gate, `vault.rs:1381-1385`) — items have no family-wide/propagation
concept, so no `enforce_item_bucket_declared_level_bound`-equivalent applies; the ordinary `RequireEdit`
gate alone suffices.

### Enumerating every write/change surface to `collection_keys`/`item_shares` access levels

The "fourth propagation surface" risk CONTEXT.md/UI-SPEC name (260812-01e found the *third* one two prior
passes missed) requires an explicit list. Confirmed by grep across `crates/pv-server/src/routes/`:

| # | Site | Operation | Bounded by |
|---|------|-----------|------------|
| 1 | `collections::create` (`collections.rs:289-297`) | `INSERT`, hard-coded `'edit'` for the creator's own row | N/A — always the creator's own row, deliberate (do not "fix" per 30-VERIFICATION.md) |
| 2 | `collections::add_member` / `insert_collection_key` (`collections.rs:488-674`) | `INSERT ... ON CONFLICT DO NOTHING` | `may_grant_access_level` + `enforce_item_bucket_declared_level_bound` |
| 3 | `invitations::accept`'s two call sites of `insert_collection_key` (`invitations.rs:617,701`) | `INSERT ... ON CONFLICT DO NOTHING` (self-seal + `family_wide_keys` fold-in) | `enforce_item_bucket_declared_level_bound` at both call sites (260812-01e Task 2, LO-05) |
| 4 | `membership::claim_item_bucket_edit_in_tx` (`membership.rs:687-703`) | `UPDATE ... SET access_level = 'edit'` | Structural `EXISTS` sub-select scoped to `item_bucket` only (ME-04) — the escalation mechanism itself, not a grant |
| 5 | `families::apply_member_removal_rekey` (`families.rs:708-712`) | `DELETE` (target's row) | The KEY-06/KEY-07 verify-then-write guards, `families.rs:632-696` |
| 6 | `collections::revoke_access` (`collections.rs:687-825`) | `DELETE` | `RequireEdit` + item_bucket refusal + last-key-holder guard |
| 7 | `vault::create_share` (`vault.rs:1381-1501`) | `INSERT ... ON CONFLICT DO NOTHING` | `RequireEdit` (items have no family-wide propagation concept) |
| 8 | `vault::revoke_share` (`vault.rs:1511-1554`) | `DELETE` | `RequireEdit`, no last-key-holder guard (an item can always lose its only share) |
| **9 (new)** | **This phase's `PUT .../access/{user_id}` / `PUT .../shares/{user_id}`** | `UPDATE ... SET access_level = ?` | Same bound as #2 (collections) / #7 (items) |

Surface #9 is the only one this phase adds. It reuses, byte-for-byte, the exact bound already proven
correct for surface #2 (the full 9-pair `may_grant_access_level` matrix re-verified by 30-VERIFICATION.md's
B1 fix) — it does not introduce a new authorization decision, only a new SQL statement shape gated by an
existing one.

### Recommendation

**Add the two `PUT` routes above.** Reject a client-side revoke-then-add pair: it is strictly more
expensive (an unnecessary re-seal round trip, a real intermediate window `SC5`'s "no partial membership"
bar would have to specifically test for) to solve a problem the data model does not actually have.

## ORG-03 — Composing `reshareCollectionToNewMember` For This Dialog

`reshareCollectionToNewMember(collectionId, newRecipientUserId, accessLevel, ownUk)`
(`web/src/lib/families/reseal.ts:67-119`) is exactly the missing composition: unwraps the caller's own
sealed Collection Key (`unsealCollectionKey`), reseals the **same, never-rotated** key to the new
recipient's published public key, grants via `addCollectionMember` (`collections::add_member`), and
resolves a `409` as success (idempotent by construction, matching the server's `ON CONFLICT DO NOTHING`).
It already has T-25-16 discipline (throws before any network call if the recipient has no published public
key) and a real-WASM proof (`reseal.real-wasm.test.ts`).

**What composes as-is:** granting a brand-new recipient on an existing destination (a row whose
`currentLevel === null`) — this dialog calls `reshareCollectionToNewMember` per such row, exactly as Phase
30's family-wide item variant already does.

**What is still missing, concretely:**

1. **The destination's own sealed key for the caller.** `reshareCollectionToNewMember` reads
   `getCollection(collectionId).sealed_key` (`reseal.ts:90-95`) — the CALLER's own sealed copy. For the
   "new folder…" path this is trivially available (the caller just created it and holds it in memory,
   `ShareDialog.tsx:919`). For the **existing-destination** path, the caller must already hold a
   `collection_keys` row (which `getCollection` returns for them, since the destination selector's own
   filter — `access_level === "edit"` — already proves this), so no new fetch is needed beyond the
   existing `getCollection` call the composition already makes. **This is the "destination unavailable"
   refusal case (SC5):** `getCollection(id).sealed_key` is documented as "should be unreachable" through a
   `Membership<Collection, RequireRead>`-gated handler (`collections.rs:328-332`) — in practice it can only
   go `null` if the caller's own access was revoked in a concurrent session between the destination list
   loading and submit. This is a genuine, if narrow, TOCTOU window and needs a **deliberately driven**
   test (revoke the caller's own access to the destination in a second session between dialog-open and
   submit) to prove the refusal fires, per the phase's "driven deliberately" bar.
2. **What happens when the caller holds only `read`.** `reshareCollectionToNewMember` performs no
   authorization check client-side beyond "do I have a `sealed_key`" — the server's `add_member` gate
   (`RequireEdit` for an ordinary collection, `may_grant_access_level` for family-wide) is what actually
   refuses a `read`-holding caller. But per the Destination Selector Contract, the selector is **already
   filtered to `access_level === "edit"`** — a `read`-holding caller cannot select an existing folder as a
   destination at all, so this case is structurally excluded from reachability through the redesigned
   dialog. (It remains reachable through the family-wide propagation paths Phase 30 built, which is a
   different, already-tested surface — not this phase's concern.)
3. **Existing recipients on the destination.** `reshareCollectionToNewMember`'s own doc comment states it
   is for adding a reader, "deliberately never calling `WasmCollectionKey.generate()`" — it must NOT be
   called for a row whose `currentLevel !== null` (an edit, handled by Q2's new `PUT` route instead). The
   dialog's submit logic must dispatch each row to exactly one of three operations based on
   `(currentLevel, pendingLevel)`: `(null, level)` → grant (`reshareCollectionToNewMember` for a folder
   destination, `createItemShare` for an item), `(level, "none")` → revoke (Q1's answer), `(oldLevel,
   newLevel)` with both non-null and different → update (Q2's new route). A row where
   `pendingLevel === currentLevel` needs no network call at all.

## SC2's Falsifiable Assertion — "Collection Count Equal Before and After"

Confirmed the assertion is falsifiable against current code exactly as CONTEXT.md/UI-SPEC state:
`submitFolderVariant` (`ShareDialog.tsx:904-963`) checks `createdCollectionRef.current === null` — a
per-session ref that starts `null` on every dialog mount regardless of `scope.existingFolderId` — and
unconditionally calls `createCollection` the first time any submit runs. There is no branch today that
skips creation for an "existing folder" scope, because no such scope concept exists yet (`existingFolderId`
only seeds items from a personal-folder conversion).

**How to observe collection count reliably:** `GET /api/vault/collections` (`collections::list`,
`collections.rs:364-407`) returns exactly the caller's own `collection_keys`-joined rows — a direct
`SELECT COUNT(*) FROM collections` server-side (integration test) or `listCollections().length` client-side
(live/e2e) both work, since every collection this phase's dialog could possibly create or reuse is scoped
to the single family (`idx_families_singleton`). The test shape: call the count **before** opening the
dialog against an existing destination, submit a share naming two people at two different levels, call the
count **after**, assert equality, AND assert the resulting `collection_keys` rows' `collection_id` equals
the **pre-chosen** destination id (never a fresh `crypto.randomUUID()`). This directly falsifies today's
code (which would show `count_after === count_before + 1` and a fresh id).

## The Refusal Path (SC5)

**No published identity key:** detected in two places today, proactively client-side
(`assertRecipientsHavePublicKeys`, `ShareDialog.tsx:178-186`, throws before any network call) and
defensively server-side (`has_keypair` check, `collections.rs:612-618`/`vault.rs:1443-1449`, `400
Bad Request`, checked **before** the transaction begins in both handlers — so a failure here leaves
literally nothing written). 31-UI-SPEC.md's Row Anatomy makes this proactive at the row level
(`share.rowNoPublishedKey`, disabled `<select>` locked to `access.none`) — the correct place given MOD-01's
per-row granularity; the existing throw-before-network guard should stay as defense-in-depth for any row
the UI-level guard somehow missed (per UI-SPEC's own note).

**Destination key unavailable:** see ORG-03 point 1 above — this is a genuinely new refusal case for the
"target an existing folder" path (the fresh-create path can never hit it, since the caller always seals
their own copy at creation time). No partial state risk: `getCollection`'s `sealed_key === null` check
happens client-side before any grant/update/revoke call is dispatched for the destination.

**No partial state after a mixed-outcome submit:** the existing `failedRecipientLabels`/
`share-partial-error` shape (`ShareDialog.tsx`, consumed by `share.partialShareFailed`) already reports
per-recipient failures without rolling back what succeeded — this pattern extends naturally to a mixed
grant/update/revoke submission (each row's own network call either lands or is reported failed
independently; there is no cross-row transaction to roll back, since each row's operation is already its
own atomic server-side unit per Q1/Q2's recommendations above).

## Test Seams — Real-WASM vs. Live Playwright

This codebase's standing rule (REQUIREMENTS.md Non-Negotiable 2): "A green unit suite is not evidence.
Both suites mock crypto." Confirmed: `web/src/**/*.test.tsx` mocks `@/lib/crypto` in 34 files (grep count).
The existing, established escape hatch is the `*.real-wasm.test.ts` naming convention — NOT mocked,
constructs two locally-generated identity keypairs and exercises the actual WASM crypto in-process, no live
server (`ShareDialog.real-wasm.test.ts`, `reseal.real-wasm.test.ts`, `rekey.real-wasm.test.ts` are the
direct precedents for this phase). Both run under `npm test` (`vitest run`, `web/package.json:11`) — no
separate command needed, they are ordinary Vitest files that simply import real (not mocked) crypto
bindings.

**What a real-WASM test can prove:** the crypto composition itself — e.g. that
`reshareCollectionToNewMember` against an existing destination produces a `sealed_key` the new recipient's
own identity key can unwrap, and that an item already in that collection (encrypted under the SAME,
unrotated key before the share) decrypts correctly afterward. This is sufficient for SC3's "recipient-side
proof through real crypto" bar **as long as the test asserts on the decrypted plaintext**, not on the
grant call succeeding.

**What genuinely needs a live Playwright run (`npm run test:e2e`, `web/package.json:12`):** anything
crossing the actual HTTP boundary and requiring server-side authorization decisions to actually fire —
SC1's "each recipient's server-stored access level matching their own row, asserted per recipient against
real server state, live," SC2's collection-count assertion against a real running server's SQLite database,
and the sixth proof obligation's "was readable before, same read fails after" revocation anchor (this needs
a second real account's own session observing state change across a completed sync, which real-WASM alone
cannot simulate — no live server, no real sync endpoint). `family-wide-sharing.spec.ts` is the direct
precedent for this shape (positive-anchor-before, revoke, negative-anchor-after, from a real second
account's own Playwright context).

## Architecture Patterns

### System Architecture Diagram

```
Browser (ShareDialog.tsx, per-person rows)
    |
    | 1. GET /api/vault/collections                  -> populate destination selector
    |    (filtered client-side: access_level==edit && family_wide_kind != item_bucket)
    v
Destination chosen
    |
    | 2. GET /api/vault/collections/{id}/access       -> populate row currentLevel per member
    v
User edits per-row pending level (none/read/edit/hidden_password)
    |
    | 3. Submit: for each row, dispatch by (currentLevel, pendingLevel):
    |
    +--> (null, X)      --> reshareCollectionToNewMember()
    |                        unseal own CK -> reseal to recipient -> POST .../members
    |                        (Q: ORG-03, Phase 30 composition, real-WASM proven)
    |
    +--> (X, "none")    --> revokeCollectionAccess()
    |                        DELETE .../access/{user_id}
    |                        (Q1 recommendation: no re-key, ACL-only, already shipped)
    |
    +--> (X, Y), X!=Y   --> updateCollectionAccess()  [NEW]
    |                        PUT .../access/{user_id}, { access_level: Y }
    |                        (Q2 recommendation: pure metadata UPDATE, no crypto)
    |
    +--> (X, X)         --> no network call
    |
    v
Server (collections.rs) applies bound (may_grant_access_level / RequireEdit / item_bucket bound)
    |
    | On success: bump collections.revision-adjacent counters, fan out SyncEvent
    v
Recipient's own client: next GET /api/sync detects the change
    |
    +--> grant/update: decrypts (or re-authorizes) using its own sealed_key, unchanged by an UPDATE
    +--> revoke: 404s on every Membership<Collection,_>-gated route, prunes local cache (DEBT-03/VIS-01)
```

### Recommended Project Structure

No new top-level directories. New code lands in existing files:

```
crates/pv-server/src/routes/
├── collections.rs      # + update_access handler, + PUT on existing /access/{user_id} route
├── vault.rs             # + update_share handler, + PUT on existing /items/{id}/shares/{user_id} route
└── mod.rs               # + .put(...) chained onto the two existing .route() entries

web/src/
├── lib/vault/api.ts      # + updateCollectionAccess(), + updateItemShare() thin wrappers
├── lib/families/reseal.ts  # unchanged — reused as-is for the (null, X) grant case
├── lib/vault/api.ts       # revokeCollectionAccess/revokeItemShare — unchanged, reused as-is
└── components/vault/
    ├── ShareDialog.tsx         # per-row state, dispatch-by-(current,pending), destination selector
    └── ShareDestinationSelect.tsx  # NEW small component (per 31-UI-SPEC.md's discretion call)
```

### Pattern 1: Grant/Update/Revoke dispatch by (currentLevel, pendingLevel)

**What:** A per-row reducer comparing a row's fetched `currentLevel` against its locally-edited
`pendingLevel`, dispatching to exactly one of three network operations (or none).
**When to use:** Any time a UI surface must reconcile "the access picture as it should be" against "the
access picture as it currently is" in one submission spanning N independent rows.
**Example:**
```typescript
// Source: this research's synthesis of ShareDialog.tsx's existing grantCollectionToRecipients
// shape (ShareDialog.tsx:272-309) widened to a 3-way dispatch per MOD-01's per-row model.
async function reconcileRow(
  collectionId: string,
  row: { userId: string; currentLevel: string | null; pendingLevel: string; publicKey: string | null },
  ck: WasmCollectionKey,
  ownUk: WasmUserKey,
): Promise<{ ok: true } | { ok: false; label: string }> {
  if (row.currentLevel === row.pendingLevel) return { ok: true }; // no-op row
  try {
    if (row.currentLevel === null) {
      await reshareCollectionToNewMember(collectionId, row.userId, row.pendingLevel, ownUk);
    } else if (row.pendingLevel === "none") {
      await revokeCollectionAccess(collectionId, row.userId);
    } else {
      await updateCollectionAccess(collectionId, row.userId, row.pendingLevel); // NEW wrapper
    }
    return { ok: true };
  } catch {
    return { ok: false, label: row.userId };
  }
}
```

### Anti-Patterns to Avoid

- **Revoke-then-add for a level edit:** manufactures an intermediate window and an unnecessary re-seal call
  for a change that touches no key material — see Q2.
- **Reusing `buildMemberRemovalBatch` for per-collection revocation:** silently evicts the target from
  every other shared surface and from the family itself — see Q1.
- **Letting `CollectionPicker`'s existing `item_bucket` filter stand in for this dialog's stricter filter:**
  `CollectionPicker` only excludes `item_bucket`; this dialog additionally needs `access_level === "edit"`
  (a `read`-holder cannot grant here) — reusing `CollectionPicker` unfiltered would let a user pick a
  destination they cannot actually manage and fail at submit.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Unwrap-own-key + reseal-to-recipient | A second copy of this composition inside `ShareDialog.tsx` | `reshareCollectionToNewMember` (`reseal.ts:67-119`) | Already built, already real-WASM-proven, already handles the T-25-16 no-public-key guard and 409-as-idempotent-success |
| "Is this caller allowed to hand out this level" | A new ad-hoc comparison in the new `PUT` handlers | `may_grant_access_level` (`membership.rs:553-574`) | The full 9-pair matrix was re-verified pair-by-pair in 30-VERIFICATION.md's B1 fix; a second, parallel comparison risks drifting the exact way CR-01 found the third of three copies had |
| item_bucket declared-level bound | A fourth inline copy of the equality check | `enforce_item_bucket_declared_level_bound` (`membership.rs:792-811`) | Already extracted to one shared definition specifically to prevent a fourth site from drifting (LO-05) |

**Key insight:** every crypto and authorization primitive this phase needs already exists in the codebase.
The actual engineering surface is composition and dispatch (which existing call to make for which row
state), not new cryptography or new authorization logic.

## Common Pitfalls

### Pitfall 1: Treating a level EDIT as authorization-equivalent to a fresh GRANT in the client but not the server (or vice versa)
**What goes wrong:** The new `PUT` routes must apply `may_grant_access_level`/
`enforce_item_bucket_declared_level_bound` identically to `add_member`, or a caller could use the update
route to bypass the grant route's bound (e.g. grant `read` via `add_member`, then use `PUT` to silently
escalate to `edit` without the bound ever checking it).
**Why it happens:** The two routes look superficially different (INSERT vs UPDATE) and it is tempting to
gate the new one more loosely "since the row already exists."
**How to avoid:** Reuse the exact same bound-checking call sequence `add_member` already uses, verbatim.
**Warning signs:** A test that grants at `read` then updates to `edit` for a caller who only holds `read`
themselves succeeding when it should 403.

### Pitfall 2: Asserting SC5's "no partial membership" post-detach
**What goes wrong:** 260812-01e's ME-05 finding (referenced in 31-CONTEXT.md) already documents this exact
trap: an assertion evaluated after the dialog has unmounted is trivially true regardless of what actually
happened.
**Why it happens:** The natural place to check "did the error render" is after `onShared`/`onClose` fires,
but by then the DOM node is gone.
**How to avoid:** Assert `share-error`/`share-partial-error` while the dialog is still mounted, per
CONTEXT.md's own instruction.
**Warning signs:** A test that never actually queries the dialog's error slot, only checks a downstream
state change.

### Pitfall 3: Forgetting the destination-switch reset rule breaks the (currentLevel, pendingLevel) dispatch
**What goes wrong:** 31-UI-SPEC.md's Destination Selector Contract requires every row to re-fetch and
re-render from scratch on a destination change. If the dispatch logic (Pattern 1 above) is wired against
stale `currentLevel`s from a previous destination, a row could be dispatched as an "update" against a
destination it was never actually granted on, producing a 404 instead of a grant.
**Why it happens:** `currentLevel`/`pendingLevel` state living in the same component as the destination
selector invites forgetting to re-derive both together.
**How to avoid:** Treat `(destinationId, rows)` as one atomic piece of state, re-fetched together via
`getCollectionAccessList` on every destination change.
**Warning signs:** Switching destinations mid-session and submitting produces unexpected 404s on rows that
were never touched by the user.

## Code Examples

### Server: the new update-access handler shape (collections)

```rust
// Source: this research's synthesis, mirroring collections.rs:532-674's
// existing add_member authorization sequence exactly, replacing the INSERT
// with a single UPDATE against the existing composite PK.
pub async fn update_access(
    State(state): State<AppState>,
    membership: Membership<Collection, RequireRead>,
    Path((_collection_id, target_user_id)): Path<(String, String)>,
    Json(req): Json<UpdateAccessRequest>, // { access_level: String }
) -> Result<StatusCode, ApiError> {
    let requested_level = parse_access_level_from_request(&req.access_level)?;

    match membership::resolve_family_wide_declared_level(&state.db, &membership.resource_id).await? {
        membership::FamilyWideDeclaredLevel::Declared(_) | membership::FamilyWideDeclaredLevel::LegacyUnknown => {
            if !may_grant_access_level(membership.access, requested_level) {
                return Err(ApiError::Forbidden);
            }
        }
        membership::FamilyWideDeclaredLevel::NotFamilyWide => {
            if !RequireEdit::satisfied_by(membership.access) {
                return Err(ApiError::Forbidden);
            }
        }
    }
    membership::enforce_item_bucket_declared_level_bound(&state.db, &membership.resource_id, requested_level).await?;

    let mut tx = state.db.begin().await?;
    let result = sqlx::query(
        "UPDATE collection_keys SET access_level = ? WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(req.access_level)
    .bind(&membership.resource_id)
    .bind(&target_user_id)
    .execute(&mut *tx)
    .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }
    // ... fan-out SyncEvent, mirroring add_member's own recipients-resolve + publish shape
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
```

### Client: dispatch-by-state wrapper

```typescript
// Source: this research's synthesis, matching vault/api.ts's existing
// thin-wrapper discipline (addCollectionMember, revokeCollectionAccess).
export function updateCollectionAccess(
  collectionId: string,
  userId: string,
  accessLevel: string,
): Promise<void> {
  return apiJson(
    `/api/vault/collections/${encodeURIComponent(collectionId)}/access/${encodeURIComponent(userId)}`,
    { method: "PUT", body: JSON.stringify({ access_level: accessLevel }) },
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| One global `accessLevel` applied to every selected recipient | Per-row `pendingLevel` compared against per-row `currentLevel`, dispatched to grant/update/revoke | This phase (MOD-01) | Every submit call site (`grantCollectionToRecipients`, the item-share loop) must widen from a single shared level to a per-row value |
| Every `ShareDialogScope` folder submission mints a new collection | A destination selector chooses mint-new vs. an existing, edit-held, non-item_bucket collection | This phase (MOD-02) | `submitFolderVariant`'s `createdCollectionRef` logic needs a third branch: "reuse an already-known collection id, skip `createCollection` entirely" |
| No route updates an existing grant's level (`409` on any duplicate INSERT) | Two new `PUT` routes, pure metadata UPDATE | This phase (MOD-01's "editable in place") | `add_member`/`create_share` stay byte-for-byte unchanged — this is additive, not a replacement |

**Deprecated/outdated:** none — this phase's recommendations are all additive to the existing v0.4/v0.5
sharing stack, nothing existing needs to be removed or reworked.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | axum supports chaining `.put(...)` onto an existing `.route(path, delete(...))` entry without touching the path string | Q2, Recommended Project Structure | Low — this is documented axum `MethodRouter` behavior and the codebase already does this exact chaining elsewhere (`vault.rs:1326` chains `.get(...).post(...)` on `/api/vault/items/{id}/shares`) — effectively `[VERIFIED: codebase precedent]`, listed here only because I did not independently re-derive it from the axum crate source |
| A2 | The `access_list`/`getCollectionAccessList` read cost (one extra round trip per destination switch) is acceptable UX-wise at ~15 members | Destination Selector Contract loading state | Low — 31-UI-SPEC.md already specifies this exact loading sub-state; not a new risk this research introduces |

**If this table is empty:** N/A — two low-risk items above, neither touches zero-knowledge, security, or a
locked product decision.

## Open Questions

1. **Should the new `PUT` routes also accept a `sealed_key` field, unused, purely to keep the request
   shape symmetric with `add_member`/`create_share`?**
   - What we know: no crypto data needs to change for a level edit.
   - What's unclear: whether a symmetric wire shape is worth the (small) extra unused field for
     consistency, vs. a deliberately minimal `{ access_level }` body that makes the "no crypto touched"
     property visible in the wire contract itself.
   - Recommendation: keep the body minimal (`{ access_level }` only) — the absence of a `sealed_key` field
     is itself documentation that this route cannot leak or require key material, matching this
     codebase's pattern of using the wire shape to make an invariant visible (e.g. `family_wide_access_level`
     being `REQUIRED`-when-`Some(kind)` in `CreateCollectionRequest`).

2. **Does the sixth proof obligation's "atomic re-key path" language require the planner to record that
   `revokeCollectionAccess` does NOT re-key, or is the access-denial bound alone sufficient framing?**
   - What we know: CONTEXT.md's own wording says "the same correctly-scoped, atomic re-key path v0.4
     established" — which, taken completely literally, still names re-keying.
   - What's unclear: whether this is a load-bearing requirement (the recorded proof text) or descriptive
     shorthand for "the same rigor v0.4 established" (access-control correctness, not necessarily key
     rotation).
   - Recommendation: the planner should re-word the sixth proof obligation's own text (in the plan, not
     retroactively in CONTEXT.md) to say "the same correctly-scoped access-revocation path v0.4 established
     for SHARE-06" rather than "re-key," since this research's Q1 finding is that the re-key path is the
     wrong mechanism entirely — carrying the word "re-key" forward into the plan's own success-criterion
     text would misdescribe what actually ships.

## Environment Availability

Not applicable — this phase adds no new external tool/service/runtime dependency. Every capability is built
against the already-running `pv-server`/`web` dev stack this project already uses for every prior phase's
live/e2e proofs.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.4 (unit + real-WASM) / Playwright 1.61.1 (live e2e), both already configured |
| Config file | `web/vitest.config.ts`, `web/playwright.config.ts` (pre-existing, unchanged by this phase) |
| Quick run command | `npm test -- ShareDialog` (scoped Vitest run, mocked-crypto unit tests) |
| Full suite command | `cd web && npm test && npm run test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MOD-01 | Two people, two different levels, one submission, each recipient's server-stored level matches their own row | live e2e | `playwright test e2e/sharing.spec.ts -g "per-person levels"` | ❌ Wave 0 (new spec/case) |
| MOD-02 | Existing folder destination: collection count equal before/after, membership rows carry the chosen folder's id | live e2e (server-state count) | `playwright test e2e/sharing.spec.ts -g "existing destination"` | ❌ Wave 0 |
| MOD-03 | Hidden-password inline note states "interface protection, never cryptographic" without hover/click, on a repeat share (already-acked account) | unit (rendered-text assertion) + backstop visual | `npm test -- ShareDialog.test.tsx -t "hidden password inline"` | ❌ Wave 0 (revised copy per UI-SPEC checker blocker 2) |
| ORG-03 | A person added to an existing folder decrypts items already in it | real-WASM | `npm test -- ShareDialog.real-wasm.test.ts -t "existing destination"` | ❌ Wave 0 (extend existing real-WASM file) |
| Sixth proof obligation | "brak dostępu" revokes; positive read before, failing read after next sync | live e2e (2 real sessions) | `playwright test e2e/sharing.spec.ts -g "per-row revocation"` | ❌ Wave 0 |
| Q2 (level edit) | Changing an existing recipient's level updates server state atomically, no intermediate under/over-access window | live e2e + unit (fault-injection-shaped, mirroring `FAULT_INJECT_AFTER_COLLECTION_INDEX`'s precedent if a comparable seam is added) | `cargo test -p pv-server update_access` | ❌ Wave 0 |
| SC5 refusal | Destination key unavailable (deliberately driven via a concurrent revoke) | live e2e | `playwright test e2e/sharing.spec.ts -g "destination unavailable"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- ShareDialog` (fast, mocked-crypto unit lane) + `cargo test -p
  pv-server` (server-side route tests)
- **Per wave merge:** `npm test && cargo test --workspace` (full mocked + real-WASM lane, no live server)
- **Phase gate:** `npm run build && npm run test:e2e` (full live Playwright suite) green before
  `/gsd-verify-work`, mirroring Phase 30's own gate shape (`30-VERIFICATION.md`'s four CI-width commands)

### Wave 0 Gaps

- [ ] `crates/pv-server/tests/collections.rs` — new `update_access` route tests: the full 9-pair
  `may_grant_access_level` matrix (mirroring the existing `b1_hidden_password_...` test's shape),
  `enforce_item_bucket_declared_level_bound` coverage, 404-on-no-existing-row
- [ ] `crates/pv-server/tests/vault.rs` — equivalent for the item-share `PUT` route
- [ ] `web/src/components/vault/ShareDialog.real-wasm.test.ts` — extend with an existing-destination case:
  reshare into a collection that already has items, assert the new recipient's client decrypts a
  pre-existing item
- [ ] `web/e2e/sharing.spec.ts` (new or extended existing spec) — SC1 per-recipient level assertion, SC2
  collection-count assertion, sixth-proof-obligation revocation anchor, SC5 destination-unavailable
  deliberately-driven case
- [ ] Framework install: none — Vitest/Playwright already configured project-wide

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Unaffected — this phase touches no auth/session code |
| V3 Session Management | no | Unaffected |
| V4 Access Control | yes | `Membership<Collection/Item, RequireRead/RequireEdit>` extractors (existing, `membership.rs:196-380`) gate every route this phase adds/reuses; the two new `PUT` routes must apply `may_grant_access_level` + `enforce_item_bucket_declared_level_bound` identically to `add_member`, never a looser bound |
| V5 Input Validation | yes | `parse_access_level_from_request` (existing closed-set validator) on the new routes' request bodies, before any DB work — matching every existing handler in this file |
| V6 Cryptography | yes (by exclusion) | The new routes must never accept or touch `sealed_key`/key material — the whole point of Q2's recommendation is that a level change is provably free of any crypto operation; a future change that adds a `sealed_key` field to these routes should be treated as a regression against this phase's own stated invariant |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A caller with `read`-only access using the new update route to self-escalate another recipient (or themselves via a second account) beyond what they hold | Elevation of Privilege | `may_grant_access_level`'s full 9-pair matrix, reused verbatim from `add_member` — never a new, parallel comparison |
| Bypassing the item_bucket declared-level bound via the new update route (a "fourth propagation surface" in CONTEXT.md's own naming) | Elevation of Privilege | `enforce_item_bucket_declared_level_bound`, the ONE shared definition (LO-05), called from the new route exactly as it is from `add_member` and both `invitations::create` call sites |
| Revoking through a per-person row against an `item_bucket` collection, bypassing the family-removal-only path | Elevation of Privilege / Tampering | Structural: destination selector excludes `item_bucket` from selectable destinations; server-side `revoke_access`'s own unconditional refusal (`collections.rs:705-707`) is the backstop |
| A confused-deputy grant to a non-family-member or a member with no published keypair via the update route | Spoofing | Not applicable to an UPDATE (the row's existence already proves these checks passed at grant time) — but the planner should confirm the target row's mere existence is the correct proxy, since a member removed-then-somehow-still-holding-a-stale-row scenario would need the same `family_members` re-check `apply_member_removal_rekey` performs; existing `collection_keys`/`family_members` cascade-delete (`ON DELETE CASCADE`, migration 0014) makes this scenario structurally impossible — a removed member's row is gone, not stale |

## Sources

### Primary (HIGH confidence — direct file reads, this session)
- `crates/pv-server/src/routes/collections.rs` (full file, 893 lines) — `create`/`get`/`list`/`add_member`/`revoke_access`/`access_list`
- `crates/pv-server/src/routes/vault.rs:1300-1554` — `list_item_shares`/`create_share`/`revoke_share`
- `crates/pv-server/src/routes/membership.rs:70-380,540-820` — `AccessLevel`, `RequireRead`/`RequireEdit`, `may_grant_access_level`, `FamilyWideDeclaredLevel`, `enforce_item_bucket_declared_level_bound`, `is_item_bucket_collection`, `claim_item_bucket_edit_in_tx`
- `crates/pv-server/src/routes/families.rs:560-782` — `apply_member_removal_rekey`
- `crates/pv-server/src/routes/invitations.rs:600-710` — `insert_collection_key` call sites
- `crates/pv-server/src/routes/mod.rs:413-424` — existing route registrations
- `crates/pv-server/migrations/0014_family_sharing.sql:63-81` — `collection_keys`/`item_shares` schema
- `web/src/lib/families/rekey.ts` (full file, 190 lines) — `buildMemberRemovalBatch`/`resolveTargetCollectionIds`
- `web/src/lib/families/reseal.ts` (full file, 119 lines) — `reshareCollectionToNewMember`
- `web/src/components/vault/ShareDialog.tsx:1-330,580-1180` — current state shape, `submitFolderVariant`, `grantCollectionToRecipients`, `assertRecipientsHavePublicKeys`, `recipientAlreadyHoldsIntendedLevel`
- `web/src/components/vault/CollectionPicker.tsx` (full file, 127 lines)
- `web/src/lib/vault/api.ts:194-461` — `CollectionRow`, `getCollectionAccessList`, `revokeCollectionAccess`/`revokeItemShare`, `createCollection`, `addCollectionMember`, `createItemShare`
- `web/src/components/vault/SharingOverviewPanel.tsx:1-40,300-320` — the `access_level === "edit" && family_wide_kind !== "item_bucket"` filter this dialog's destination selector mirrors
- `.planning/phases/31-.../31-CONTEXT.md`, `31-UI-SPEC.md` — locked decisions and the design contract's own flagged code-reality gaps
- `.planning/phases/30-.../30-VERIFICATION.md`, `.planning/STATE.md` (lines 1-160) — Phase 30 closure state, the 260812-01e fix disposition
- `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md` — phase boundary and requirement text
- `.planning/config.json` — `nyquist_validation: true`, `security_enforcement: true`, no external search providers configured (no external doc lookup performed for this research — none needed, no new dependencies)

### Secondary (MEDIUM confidence)
- None — no external documentation was consulted for this research; the domain is entirely internal to this codebase's own established patterns.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, every recommendation reuses existing crates/packages already pinned in this repo
- Architecture: HIGH — every claim traced to a specific file:line read in this session; the two open questions were resolved by reading the actual write paths, not inferred from names
- Pitfalls: HIGH — all three named pitfalls are grounded in this codebase's own documented prior incidents (260812-01e's ME-05, CR-01's third-copy drift, the destination-switch reset rule from 31-UI-SPEC.md itself)

**Research date:** 2026-08-12
**Valid until:** Effectively indefinite for the architectural findings (they describe the current, committed
shape of `crates/pv-server`/`web/src`, not an external moving target) — re-verify only if a plan-time
`git log` shows further commits to `collections.rs`/`vault.rs`/`membership.rs`/`ShareDialog.tsx`/
`rekey.ts`/`reseal.ts` between this research and plan execution.
