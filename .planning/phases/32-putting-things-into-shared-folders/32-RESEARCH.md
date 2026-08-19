# Phase 32: Putting Things Into Shared Folders - Research

**Researched:** 2026-08-19
**Domain:** Client-side crypto composition for scope-moves (personal ↔ shared ↔ shared) on an
existing Rust/axum + SQLite server and a Next.js/WASM client; one Rust lint-debt cleanup.
**Confidence:** HIGH — every claim below is grounded in a specific file:line read this session, not
recalled from training data. The one place confidence drops to MEDIUM is the "overlapping grants
survive a move" behavior (Q4), because the code as it stands today **contradicts** the locked
CONTEXT.md decision — see that section for the exact discrepancy and the fix it implies.

**A note on provenance of this file:** `32-CONTEXT.md` was not found at its canonical path
(`.planning/phases/32-putting-things-into-shared-folders/32-CONTEXT.md`) when this research began —
that directory did not exist. It was found instead at
`web/src/components/vault/.planning/phases/32-putting-things-into-shared-folders/32-CONTEXT.md`, an
accidental nested copy apparently created by a prior `/gsd-discuss-phase` invocation whose working
directory was `web/src/components/vault` (this agent's own default `cwd`, per its env block) instead
of the repo root. Its content is used as this phase's real, locked CONTEXT.md below. **The orchestrator
should move that file to the canonical path** (`git mv` preserves history) — this research does not
touch it, being read-only outside its own output file.

## Summary

Phase 31 already built and proved the two crypto compositions Phase 32 needs — not for item *moves*,
but for adjacent operations at the same layer: `submitItemFamilyWide` and the seed-move loop inside
`submitFolderVariant` (`web/src/components/vault/ShareDialog.tsx:1546-1793`) both already do
"decrypt with the *source* key → re-encrypt with the *destination* key → `moveItemToCollection`" for
the personal→shared direction, including the load-bearing revision/AAD discipline (encrypt under
`revision + 1`, send `expected_revision` = the old value, because `move_item` bumps unconditionally).
Phase 32's job is to **generalize that composition to all four directions** (personal→shared,
shared→personal, shared→different-shared, and the create-time equivalent) into a reusable
`web/src/lib/vault/store.ts` helper, and wire it behind a new destination `<select>` in
`ItemForm.tsx`, which today has no `collectionId` concept at all (confirmed: zero matches for
`collectionId` anywhere in that 1006-line file).

Two findings need the planner's explicit attention because they are not "build this" tasks, they are
"the code and the locked decision disagree" or "the stated scope is narrower than the actual bar":

1. **`move_item` currently deletes `item_shares` unconditionally on every move INTO a collection**
   (`crates/pv-server/src/routes/vault.rs:1193-1207`), which contradicts CONTEXT.md's locked decision
   that "pre-existing per-item shares survive a move into a shared folder." This must be reconciled —
   see Q4 below for the exact fix and its scope.
2. **DEBT-04's stated criterion ("19 × `explicit_auto_deref` in `vault.rs`") is a strict subset of
   what actually blocks `cargo clippy --workspace --all-targets -- -D warnings`.** A live run of that
   exact command exits non-zero for **25** errors: the 19 in `vault.rs` plus 6 unrelated
   `doc list item without indentation` errors in `crates/pv-provider/src/ceremony.rs:154-159`. SC5's
   literal text ("the whole command exits 0... anything else in the workspace counts") already
   anticipates this — the plan must fix both, not just the named 19.

**Primary recommendation:** add one `moveVaultItem(id, currentCollectionId, newCollectionId,
currentRevision)` helper to `store.ts` that dispatches on `(currentCollectionId, newCollectionId)` to
pick `encryptItem`/`decryptItem` vs `encryptItemForCollection`/`decryptItemForCollection`, mirroring
`ShareDialog.tsx`'s proven sequence exactly; wire `ItemForm.tsx`'s new destination control to call it
(and to the two-call create-then-move sequence on create, since `vault::create` — confirmed at
`crates/pv-server/src/routes/vault.rs:250-322` — never accepts a `collection_id`, so "create directly
in a shared folder" is unavoidably create-personal-then-move under this schema); fix the
`item_shares`-survival gap in `move_item`; and fix both DEBT-04 blockers.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Area 1 — The destination control**

- **One select with `<optgroup>`s**, not two controls. The existing `item-folder-select` gains groups:
  "Bez folderu" / "Moje foldery" / "Udostępnione foldery". This is the literal reading of ORG-01's
  "same control and mental model as choosing a personal folder" — the destination is one list of
  places an item can live.
- **Family-wide `item_bucket` collections are excluded** from the list. They are not folders; they are
  a side effect of the family-wide sharing mechanism, carry placeholder names, and have their own
  access rules. This matches Phase 31, which excludes them from the share dialog's destination
  selector for the same reason. Sharing with the whole family stays in the dialog, where it comes with
  its contributor-escalation disclosure.
- **Shared folders the user cannot write to are shown but disabled, with the reason.** A folder where
  the caller holds `read` or `hidden_password` renders as a disabled option saying it is read-only, so
  a folder visible in the sidebar is never mysteriously absent from the editor. Note the server gate
  this mirrors: `move_item` requires `edit` on the destination (`require_collection_edit`).

**Area 2 — What a scope move discloses, and what it touches**

- **No inline note on entry and no confirmation dialog on exit. Moving an item into or out of a shared
  folder is treated as an ordinary folder change.** Bartek's explicit decision on both questions,
  chosen over an inline disclosure and over a confirm dialog.

  Recorded tradeoff, so this reads as a decision rather than an oversight: it means a person can widen
  who can read a password with one click while editing something unrelated. The reasoning that makes
  it defensible: the "Udostępnione foldery" group label is itself the signal, ORG-01 explicitly asks
  for the *same* mental model as a personal folder rather than a heavier one, and Phase 31's dialog
  remains the surface where sharing decisions are deliberate and disclosed. **If a later review argues
  for disclosure here, it is re-opening a decision, not finding a gap.**

- **Pre-existing per-item shares (`item_shares`) survive a move into a shared folder.** They are an
  independent grant and the server already takes the maximum of the two (`combine_access`), so someone
  granted `edit` directly keeps `edit` even if the folder grants `read`. Deleting them would remove
  someone's access as a side effect of a folder change — the very thing the previous decision declined
  to even warn about, so silently doing it would be worse.

### Claude's Discretion

- All crypto and server-contract choices, per the standing rule.
- Whether the disabled read-only options carry their reason inline in the option label or adjacent.
- Ordering within each `<optgroup>`, and the empty / single-folder cases.
- How the refusal path (SC3) surfaces its error in the editor.

### Deferred Ideas (OUT OF SCOPE)

- **A disclosure note or confirmation on scope moves.** Declined deliberately (see Area 2). Revisit
  only if real use shows accidental widening, not on review preference.
- **Offering family-wide buckets as editor destinations.** Declined — that path exists in the share
  dialog with its own disclosure.
- **Collapsing per-item shares into folder membership** when an item enters a shared folder. Declined:
  it would revoke access as a side effect of a folder change.

**Phase boundary (from CONTEXT.md's `<domain>`):** In scope: `ItemForm.tsx`'s destination control, the
scope-move crypto and its refusal path, and DEBT-04's clippy cleanup in `vault.rs` (edited anyway). Out
of scope: the share dialog (Phase 31), the Family & Sharing settings surface (Phase 33), the exposure
inventory (Phase 34).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ORG-01 | An item can be moved into, or created directly in, an existing shared folder, from the item editor, same mental model as a personal folder. | Q1 below: the client composition for all four directions, and the create-time two-call sequence (`create` never accepts `collection_id`). |
| ORG-02 | Moving an item between scopes re-encrypts under the destination's key with correctly-bound AAD, refused (not silently mis-scoped) when the destination key is unavailable. | Q1 (AAD binding via `build_coll_item_aad`), Q2 (the refusal mechanism and its byte-identical-rollback proof). |
| ORG-04 | Removing an item from a shared folder returns it to personal scope with the same re-encryption discipline; previously-shared members lose access. | Q3 (which sync counter drives the member's client to drop the plaintext) and Q4 (the item_shares-survival scoping of "lose access"). |
| DEBT-04 | `cargo clippy --workspace --all-targets -- -D warnings` exits 0. | Q5: confirmed count (19) plus one undocumented additional blocker (6 errors, different crate). |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Destination selection UI (optgroups, disabled reasons) | Browser/Client (`ItemForm.tsx`) | — | Pure presentation over `useCollections()`, an existing client store. |
| Scope-move re-encryption (decrypt source, encrypt dest) | Browser/Client (`store.ts`, `pv-wasm`) | — | Zero-knowledge: the server never sees plaintext or unwrapped keys; all crypto is WASM-side, per project constraints. |
| Move authorization (Gate 0/1/2) and atomic re-encrypt-and-replace write | API/Backend (`vault.rs::move_item`) | — | Only the server can enforce ownership/edit-access gates and the single-statement optimistic-concurrency write. |
| Fan-out / "who must be told to re-pull" | API/Backend (`resolve_recipients`, `bump_collection_revision`, `bump_recipients_vault_revision`) | Database (`collections.revision`, `users.vault_revision`, `users.shared_direct_revision` columns) | Revision counters are server-owned state; the client only reads them via the sync endpoints. |
| Detecting "I lost access, drop the plaintext" | Browser/Client (`store.ts::mergeCollectionSnapshot`) | API/Backend (`GET /api/sync/shared`) | The server signals via a revision bump; the client's full-collection-replace merge is what actually purges stale plaintext. |
| DEBT-04 clippy fixes | API/Backend (Rust source, `vault.rs` + `pv-provider/src/ceremony.rs`) | — | Pure lint/style, no behavior change. |

## Standard Stack

No new external packages are introduced by this phase. Every crypto primitive, wire type, and client
store already exists and is exercised by Phase 26/30/31 code (`encryptItem`/`decryptItem`,
`encryptItemForCollection`/`decryptItemForCollection`, `moveItemToCollection`, `useCollections()`).

### Core (existing, reused — not new installs)

| Symbol | Location | Purpose | Why reused, not rebuilt |
|--------|----------|---------|--------------------------|
| `moveItemToCollection` | `web/src/lib/vault/api.ts:396-411` | Thin wire wrapper for `PUT /api/vault/items/{id}/collection` | Already correct and already called twice from `ShareDialog.tsx` — no reason to duplicate. |
| `encryptItemForCollection` / `decryptItemForCollection` | `web/src/lib/crypto/wasm/pv_wasm.d.ts:240,268` (WASM-bound, `pv-core`) | Collection-scoped item crypto, AAD bound to `collection_id` | `pv-core/src/items.rs:52-65` (`build_coll_item_aad`) — KEY-03's binding, cannot be reimplemented client-side without breaking zero-knowledge. |
| `encryptItem` / `decryptItem` | same file, `:238,266` | Personal-scope item crypto (User Key, no `collection_id` in AAD) | `pv-core/src/items.rs:28-33` (`build_item_aad`) — a genuinely different, versioned AAD prefix; this is *why* a bare `collection_id` FK reassignment is impossible (KEY-03). |
| `getCollectionKey(id)` | `web/src/lib/vault/collections.ts:126` | Returns the caller's own unwrapped `WasmCollectionKey` for a collection, or `undefined` if not cached/held | This `undefined` case IS the client-side trigger for ORG-02's refusal path — see Q2. |
| `useCollections()` | `web/src/lib/vault/collections.ts:339` | Reactive list of every collection the caller holds a `collection_keys` row for, including `accessLevel` and `familyWideKind` | Already the data source `CollectionPicker.tsx` uses; `ItemForm`'s new optgroup needs the same store, not a new one. |

### Alternatives Considered

| Instead of | Could use | Tradeoff |
|------------|-----------|----------|
| Generalizing the existing `ShareDialog.tsx` decrypt/re-encrypt/move sequence into a `store.ts` helper | Copy-pasting the sequence into `ItemForm.tsx` directly | Rejected: `ShareDialog.tsx`'s version is proven (its seed-move test coverage), but scoped to *personal→shared only*; `ItemForm.tsx` needs all four directions. A shared helper in `store.ts` (which already owns `updateVaultItem`/`createVaultItem`) is the natural single source of truth and is what `updateVaultItem`'s own existing collection-aware encrypt branch (`store.ts:1027-1042`) already sits next to. |
| A single `<select>` with `<optgroup>`s (CONTEXT.md's locked choice) | Reusing `CollectionPicker.tsx` as a second, separate control | CONTEXT.md explicitly rejected two controls. `CollectionPicker.tsx` also has no "disabled, with reason" concept and is wired for a different purpose (share-dialog folder-seeding) — its `item_bucket` exclusion filter (`familyWideKind !== "item_bucket"`, `CollectionPicker.tsx:70-77`) is the one piece of logic worth reusing/extracting, not the component. |

**Installation:** none — no new dependencies.

**Version verification:** N/A, no packages added.

## Package Legitimacy Audit

Not applicable — this phase installs no external packages. `moveItemToCollection`,
`encryptItemForCollection`/`decryptItemForCollection`, and `useCollections()` are all pre-existing
first-party code (confirmed present and imported by other files this session — see file:line
citations above), not new dependencies.

## Architecture Patterns

### System Architecture Diagram

```
                    ItemForm.tsx (Browser)
                            │
        user picks destination in the new optgroup <select>
                            │
              ┌─────────────┴──────────────┐
              │                             │
        mode === "create"             mode === "edit"
              │                             │
    ┌─────────┴─────────┐        ┌──────────┴───────────┐
    │ dest === null      │        │ dest unchanged        │ dest changed
    │ (today's path,     │        │ (today's path,        │ (NEW: Q1's
    │  unchanged)        │        │  updateVaultItem)      │  moveVaultItem)
    ▼                    ▼        ▼                        ▼
createVaultItem   dest !== null  updateVaultItem      1. read current row
(personal,             │         (content-only,        2. decrypt w/ SOURCE key
 rev 1)                 ▼          same scope,             (UserKey if
                 1. createVaultItem  re-encrypt            currentCollectionId
                    (personal,       w/ CURRENT             is null, else
                    rev 1)           scope's key,           getCollectionKey)
                 2. moveVaultItem    store.ts:1027-1042)  3. encrypt w/ DEST key
                    (rev 1→2,                                (encryptItem if
                    same "decrypt/                            newCollectionId is
                    re-encrypt/                                null, else
                    move" sequence                             encryptItemForCollection)
                    as edit's                              4. moveItemToCollection
                    "dest changed"                             (expected_revision =
                    branch)                                    OLD revision)
                                                                       │
                                                                       ▼
                                                     PUT /api/vault/items/{id}/collection
                                                     (vault.rs::move_item, Gate 0→1→2,
                                                      single UPDATE, tx-atomic)
                                                                       │
                                              ┌────────────────────────┴───────────────────────┐
                                              ▼                                                  ▼
                                bump_collection_revision(source)                  bump_collection_revision(dest)
                                + Collection-typed SyncEvent to                   + Collection-typed SyncEvent to
                                  source_collection_members                        dest_collection_members
                                              │                                                  │
                                              ▼                                                  ▼
                        member's client: GET /api/sync/shared sees            member's client: same path,
                        collections.revision bumped → refreshCollectionsNow    picks up the item newly
                        → pull_shared_collection → mergeCollectionSnapshot     visible in the destination
                        REPLACES the whole collection's item list →
                        moved-out item silently absent → plaintext dropped
                        (ORG-04's "next completed sync" bound)
```

### Recommended Project Structure

No new files/folders — this phase edits existing files:

```
web/src/lib/vault/
├── store.ts             # + moveVaultItem() helper (new), reusing existing encrypt/decrypt imports
├── api.ts               # moveItemToCollection() already exists, unchanged
└── collections.ts        # useCollections()/getCollectionKey() already exist, unchanged

web/src/components/vault/
└── ItemForm.tsx          # + collectionId destination state, + optgroup <select>, submit dispatch

crates/pv-server/src/routes/
└── vault.rs               # DEBT-04 clippy fixes; item_shares-survival fix in move_item (Q4)

crates/pv-provider/src/
└── ceremony.rs            # DEBT-04's undisclosed second blocker (Q5) — doc-comment indentation only
```

### Pattern 1: Source-key / dest-key dispatch for a scope move

**What:** A single function resolves which decrypt function and which encrypt function to use based
on whether the *current* and *new* `collection_id` are `null` or `Some`.
**When to use:** Any client-side operation that changes an item's `collection_id` — this is the one
piece of logic ORG-01/ORG-02/ORG-04 all need, in both directions.
**Example (the proven precedent, personal→shared, from `ShareDialog.tsx`):**
```typescript
// Source: web/src/components/vault/ShareDialog.tsx:1556-1567 (submitItemFamilyWide)
// and :1748-1774 (submitFolderVariant's seed-move loop) — same sequence twice already.
const combined = recombineEncryptedItem(row.enc_key, row.enc_data);
const plaintext = decryptItem(uk, combined, item.id, row.revision); // SOURCE = personal
const reEncrypted = encryptItemForCollection(
  bucket.ck,          // DEST key
  plaintext,
  bucket.id,           // DEST collection_id, bound into AAD
  item.id,
  row.revision + 1,    // move_item bumps unconditionally — AAD must match the POST-move revision
);
const { encKey, encData } = splitCombinedEncryptedItem(reEncrypted);
await moveItemToCollection(item.id, bucket.id, encKey, encData, row.revision); // expected_revision = OLD
```
The shared→personal and shared→shared directions are the same shape with `decryptItemForCollection`
substituted for the source read and/or `encryptItem` substituted for the destination write — see Q1
for the full generalization.

### Anti-Patterns to Avoid

- **Bare `UPDATE vault_items SET collection_id = ?`:** already impossible server-side —
  `move_item` (`vault.rs:916-1292`) always requires fresh `enc_key`/`enc_data` in the same statement
  — but worth stating explicitly since it is the exact bug (KEY-03) this whole phase exists to avoid
  reintroducing client-side by, e.g., calling `updateVaultItem` with an unchanged-content payload and
  hoping the server infers a scope change from somewhere. It cannot; there is no such inference path.
- **Routing an unchanged-destination edit through the new move helper anyway:** wasteful and changes
  behavior for no reason (double revision bump risk, and `updateVaultItem`'s existing collection-aware
  encrypt branch at `store.ts:1027-1042` already handles same-scope content edits correctly). Only
  route through the new move composition when `newCollectionId !== existingItem.collectionId`.
- **Assuming `create()` can place an item directly into a collection:** confirmed false —
  `vault.rs::create` (`:250-322`)'s `INSERT INTO vault_items (id, user_id, enc_key, enc_data, revision,
  last_editor_user_id)` has no `collection_id` column at all; every new row starts `collection_id
  IS NULL` unconditionally. "Created directly in a shared folder" (ORG-01) is therefore *always*
  create-personal-then-move under this schema, never a single call.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Scope-move crypto sequencing | A new decrypt/re-encrypt scheme "for the editor" | The exact sequence in `ShareDialog.tsx:1546-1793`, generalized | It is already proven against 31's real-WASM/live-e2e obligations; a second, subtly different implementation is exactly the kind of drift that produced Phase 31's F-1/F-3/F-4 gap-closure findings. |
| AAD construction | Client-side string concatenation for the associated data | `pv-core`'s `build_coll_item_aad`/`build_item_aad` (`items.rs:28-65`), only ever invoked through the WASM `encryptItem*`/`decryptItem*` bindings | AAD length-prefixing and domain-separation constants are exactly the kind of "gets it right 99% of the time" code that silently breaks decryption on a length-prefix edge case; this is precisely why `pv-core` exists as a single shared WASM crate rather than being reimplemented per-client. |
| "Which key can I use for this collection" | A parallel cache in `ItemForm.tsx` | `getCollectionKey()`/`useCollections()` (`collections.ts:126,339`) — the SAME module-singleton cache every other collection-aware read/write path already uses | Two independent caches of the same unwrapped key material is a zero-knowledge/lifecycle hazard (free-on-lock discipline, `collections.ts:66-72`) that a second cache would have to reimplement correctly or leak stale key handles. |

**Key insight:** every piece this phase needs — the crypto sequence, the AAD scheme, the key cache,
the wire endpoint — already exists and is exercised in production code paths from Phases 26/30/31.
This phase is compositional (wire an existing sequence to a new UI surface, in the other three
directions), not primitive-inventing. The risk is drift from the proven sequence, not missing
primitives.

## Common Pitfalls

### Pitfall 1: Deleting `item_shares` on every move-into-collection (the CONTEXT.md contradiction)

**What goes wrong:** `move_item`'s existing code (`vault.rs:1193-1207`) runs
`DELETE FROM item_shares WHERE item_id = ?` unconditionally whenever `req.new_collection_id.is_some()`
— i.e., on *every* move into *any* collection, not just an `item_bucket`. CONTEXT.md's locked Area-2
decision says the opposite: "Pre-existing per-item shares (`item_shares`) survive a move into a shared
folder."
**Why it happens:** The DELETE was added for WR-10's invariant ("a collection-scoped item must never
carry a direct `item_shares` grant") at a time (code-review iteration 2, before this phase) when no
product decision yet existed about whether that invariant should hold for *ordinary* shared folders —
only that stacking an unguarded `item_shares` row on a collection-scoped item left recipients
"writable but unreadable through every read path" (confirmed: `pull_shared_direct`,
`sync.rs:401-402`, filters `WHERE ... AND vault_items.collection_id IS NULL`, so a direct-share-only
recipient of a now-collection-scoped item has no read path for it at all — no singular `GET
/api/vault/items/{id}` route exists either, confirmed via `grep` on `routes/mod.rs:433`, which lists
only `PUT`/`DELETE` for that path).
**How to avoid:** Scope the DELETE to fire only when the destination is an `item_bucket`
(`dest_is_item_bucket`, already computed at `vault.rs:1020-1034` and threaded through to the
post-move claim at `:1117-1120` — reuse that same boolean here) — item_buckets are where WR-10's
original escalation concern (a contributor moving items between differently-leveled buckets) actually
applies, per CONTEXT.md's own `<code_context>` notes. For an ordinary shared folder, remove the
DELETE and let `Item::resolve_access`'s existing `combine_access(collection_access, item_share_access)`
(`membership.rs:386`) do exactly what CONTEXT.md describes — this code path is ALREADY correct and
requires no change.
**Warning signs:** A live e2e test that grants a direct item share, then moves that item into an
ordinary shared folder, then asserts the direct-share recipient's access level is unchanged — this is
the test CONTEXT.md's decision demands, and it fails against the code as it stands today.
**A residual, out-of-scope nuance to flag, not fix:** even with the DELETE scoped correctly, a direct
`item_shares` recipient who is *not also* a collection member gains no read path for the item once it
is collection-scoped (the same `pull_shared_direct` filter above). Their grant becomes authorization-
only, functionally inert until/unless they are also added to the folder — and (per `resolve_recipients`,
`vault.rs:96-142`) they will still receive a dangling `EntityType::Item` sync-event notification naming
an item id no read path can ever resolve for them. This is a pre-existing shape (not introduced by this
phase), is not covered by any of Phase 32's five success criteria, and CONTEXT.md's own deferred-ideas
list explicitly declines "collapsing per-item shares into folder membership." Recommend documenting it
as a known limitation, not fixing it here — the fix would touch `pull_shared_direct`'s query shape, a
strictly bigger surface than "the scope-move path" CONTEXT.md scoped this phase to.

### Pitfall 2: SC3's refusal path assumed unreachable without a driven race — it is, and the mechanism already has a precedent

**What goes wrong:** If the plan tries to reach "destination key unavailable" through ordinary UI
interaction, it will fail — CONTEXT.md's own locked decision makes a caller-uneditable destination
*disabled* in the dropdown, so it can never be selected and submitted in the first place.
**Why it happens:** Same shape as Phase 31's SC5, confirmed at `31-VERIFICATION.md:159`: "The TOCTOU
window is **driven** (a second real edit-holder revokes the owner's own access between destination-
select and submit)." `move_item`'s Gate 2 (`require_collection_edit`, `membership.rs:480-488`) calls
`Collection::resolve_access` fresh from the DB on every single request — no caching, confirmed by
reading the function body — so a revoke that lands between the moment `ItemForm` populated its
destination list and the moment `moveVaultItem` actually dispatches its network call WILL be observed
by the server, even though the client's own (stale, not-yet-resynced) `useCollections()` snapshot still
shows the folder as selectable.
**How to avoid:** Reuse Phase 31's exact driving mechanism: open the item editor in session A with a
shared folder destination the caller currently holds `edit` on; from a second session (session B, also
holding `edit` on that folder), revoke session A's access to it; back in session A — without reloading
— submit the move. Assert (a) the UI shows an honest refusal (never "Try again", per Phase 31's
precedent at `sharing.spec.ts:1377-1515`) and (b) the item's `enc_key`/`enc_data`/`revision`, fetched
independently (a third session/token, mirroring Phase 31's own "asserted from a third party's token" to
avoid session A's own view being vacuously trustworthy), are byte-identical to a snapshot taken before
the attempt.
**Why the byte-identical claim holds today (no code change needed for this part):** Gate 2
(`require_collection_edit`) runs at `vault.rs:1020-1034`, entirely BEFORE `state.db.begin_with(...)` at
`:1053` opens the transaction. A Gate-2 failure therefore returns `Err` before any `sqlx::query(...)`
touching `vault_items` executes — zero possibility of a partial write. If the race is instead won by the
*post-tx-open* re-read at `:1055-1067` (the fresher ownership check), the transaction is simply dropped
un-committed on the early `return`, and SQLite's transaction semantics guarantee the row is untouched.
**Warning signs:** A test that drives the refusal by simply constructing an invalid request (e.g., a
collection id the caller was never a member of at all) is NOT equivalent — that is Gate 2's ordinary,
statically-reachable-through-a-bug-report path, not the "was available, then wasn't" race this SC
actually describes, and the "unavailable" framing in ORG-02/CONTEXT.md is explicitly about the
in-flight case.

### Pitfall 3: Believing SC4 needs a new server-side counter fix (it does not — Phase 31's F-1 bug does not recur here)

**What goes wrong:** Phase 31's F-1 finding (`31-VERIFICATION.md:251-253,356-365`) was that
`update_access` bumped only `users.vault_revision` (the **personal** lane, read by `GET /api/sync`) and
never `collections.revision` (the **shared** lane, read by `GET /api/sync/shared` /
`pull_shared_revisions`, and compared client-side by `sharedRevisionsChanged()`,
`store.ts:1201-1224`) — so a demoted recipient's live session never converged. It would be easy to
assume `move_item` has the same latent bug and needs an analogous fix.
**Why it does not recur:** `move_item` already bumps `collections.revision` for the *source* collection
via `bump_collection_revision(&mut tx, cid)` (`vault.rs:1209-1212`, confirmed present since Phase 23's
SYNC-04 work — this code predates this phase) and publishes a `Collection`-typed `SyncEvent` to
`source_collection_members` (`vault.rs:1243-1253`) — i.e., the exact counter and the exact WS event
`update_access` was *missing*. On the poll side, `GET /api/sync/shared`'s per-collection cheap-check
reads `collections.revision` directly and live, so even without the WS push a subsequent poll picks up
the bump.
**The client-side consumption chain (also already correct, verified by reading it):**
`sharedRevisionsChanged()` → `refreshCollectionsNow()` → `pull_shared_collection` →
`mergeCollectionSnapshot()` (`store.ts:728-786`), which **wholesale-replaces** `collectionSharedItems`
for that collection id with the fresh server list (`store.ts:760-763`, "never a partial merge") — a
moved-out item is absent from that fresh list, so its previously-cached decrypted copy is dropped on
this exact call, with no separate "detect removal" logic needed.
**How to avoid wasted work:** Do not add a new revision-bump call for this SC. The task is proof, not
construction — a live two-session e2e (member holds real folder access, reads plaintext with the panel
open; owner moves the item out via the item editor; member's session, on its next completed sync, no
longer resolves the item) is what actually satisfies SC4, on the same "next completed sync, not
lock/unlock" bound Phase 31 re-proved for a demotion.
**Warning signs:** A test that asserts on `revision` numbers alone (a "counter comparison", the exact
anti-pattern F-1's own re-verification called out at `31-VERIFICATION.md:365`) rather than on the
member's client actually failing to read the plaintext after a real sync.

## Runtime State Inventory

Not applicable — this is not a rename/refactor/migration phase. No stored-data keys, service configs,
OS-registered state, secrets, or build artifacts carry a renamed identifier.

## Code Examples

### The AAD binding that makes a bare FK reassignment impossible (grounds ORG-02, KEY-03)

```rust
// Source: crates/pv-core/src/items.rs:28-65
fn build_item_aad(prefix: &[u8], item_id: &str, revision: u32) -> Vec<u8> {
    let mut aad = prefix.to_vec();
    aad.extend_from_slice(item_id.as_bytes());
    aad.extend_from_slice(&revision.to_be_bytes());
    aad
}

const AAD_COLL_ITEM_KEY_PREFIX: &[u8] = b"pv:coll-item-key:v1";
const AAD_COLL_ITEM_DATA_PREFIX: &[u8] = b"pv:coll-item:v1";

fn build_coll_item_aad(prefix: &[u8], collection_id: &str, item_id: &str, revision: u32) -> Vec<u8> {
    let mut aad = prefix.to_vec();
    aad.extend_from_slice(&(collection_id.len() as u32).to_be_bytes());
    aad.extend_from_slice(collection_id.as_bytes());
    aad.extend_from_slice(&(item_id.len() as u32).to_be_bytes());
    aad.extend_from_slice(item_id.as_bytes());
    aad.extend_from_slice(&revision.to_be_bytes());
    aad
}
```
Personal-scope and collection-scope ciphertexts use **independently versioned** AAD prefixes
(`pv:coll-item-key:v1` vs. whatever `AAD_ITEM_KEY_PREFIX` resolves to) — a decrypt attempt across scopes
fails closed by construction, which is why every direction of a scope move MUST go through a real
decrypt-then-re-encrypt, never a metadata-only reassignment.

### `move_item`'s server-side gate order (grounds Q2's refusal-timing claim)

```rust
// Source: crates/pv-server/src/routes/vault.rs:916-1053 (structure, not verbatim)
// Gate 0: personal item, owner-only (pre-tx, on the pool)
// Gate 1: item_bucket source, owner-only, laundering guard (pre-tx)
// Gate 2: require_collection_edit(dest) OR require_item_bucket_edit_access(dest) (pre-tx,
//         MUST complete before `tx` opens — the integration harness runs max_connections(1))
// -- only past this point does `state.db.begin_with("BEGIN IMMEDIATE")` run --
// -- the actual UPDATE (collection_id, enc_key, enc_data, revision) is the ONLY write --
```
All three gates run before any write; a Gate-2 failure driven mid-session (Pitfall 2) therefore leaves
the row provably untouched.

### The proven personal→shared composition to generalize (grounds Q1)

```typescript
// Source: web/src/components/vault/ShareDialog.tsx:1748-1774 (submitFolderVariant's seed-move loop)
const combined = recombineEncryptedItem(row.enc_key, row.enc_data);
const plaintext = decryptItem(uk, combined, item.id, row.revision);
const reEncrypted = encryptItemForCollection(newCk, plaintext, collectionId, item.id, row.revision + 1);
const { encKey, encData } = splitCombinedEncryptedItem(reEncrypted);
await moveItemToCollection(item.id, collectionId, encKey, encData, row.revision);
```

## State of the Art

Not applicable in the usual "library/framework version" sense — this phase composes existing,
recently-built (Phase 26/30/31) first-party primitives. The one relevant "old vs. new" axis is
internal: `move_item`'s `item_shares`-deletion behavior (Pitfall 1) was written under a pre-CONTEXT.md
assumption (WR-10, applied to every collection) that CONTEXT.md's Area-2 decision now narrows
(applies only to `item_bucket` destinations). That is the one piece of "existing behavior this phase
must change," everything else is additive.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `web/src/components/vault/.planning/.../32-CONTEXT.md`'s nested location is an accidental artifact of a prior agent's misconfigured `cwd`, and its content is the real, intended CONTEXT.md for this phase (not a stale/abandoned draft). | Provenance note, top of file | If wrong, the "locked decisions" this research and the eventual plan build on could be someone else's discarded draft — the planner should have the orchestrator confirm this file's authorship/timestamp (2026-08-19, same day as Phase 31's verification) before treating it as authoritative. |
| A2 | Recommending that `move_item`'s `item_shares` DELETE be scoped to `item_bucket`-only destinations (rather than removed entirely) correctly satisfies CONTEXT.md's "pre-existing shares survive" decision while preserving WR-10's original escalation concern for item_buckets specifically. | Pitfall 1 | This is a server-contract choice CONTEXT.md explicitly delegates to Claude's discretion, so it is not itself risky to decide — but if the planner instead removes the DELETE unconditionally (including for item_buckets), it re-opens the exact contributor-escalation hole 260812-01e's HI-03 fix (referenced at `vault.rs:963-989`) was built to close. |

## Open Questions

1. **Does the `item_shares`-survival fix (Pitfall 1) belong to Phase 32 at all, or is it a
   pre-existing defect Phase 32 merely surfaces?**
   - What we know: CONTEXT.md's Area-2 decision was authored *for this phase* (dated 2026-08-19,
     same session), explicitly about "a move into a shared folder" — the exact action `move_item`
     implements. The contradicting DELETE already exists in shipped code (pre-dates this phase).
   - What's unclear: whether Bartek intended this as new phase scope (a behavior to *add*) or was
     describing what he believed the code *already* did (in which case this research just found a
     bug the CONTEXT.md session didn't know about).
   - Recommendation: either reading leads to the same fix under this phase's stated boundary ("the
     scope-move path" is explicitly in scope) — treat it as in-scope regardless, but flag the
     discrepancy explicitly to Bartek in the plan's own framing, since it changes existing,
     already-shipped `move_item` behavior for shared-folder destinations (item_bucket destinations,
     which are the majority of what `move_item` currently handles via CONTEXT.md's own decision to
     exclude buckets from the editor, are unaffected).

2. **Should `ItemForm`'s destination optgroup separate "shared folders you can write to" from
   "shared folders you can't" via disabled options, or omit unwritable folders from the list
   entirely?**
   - What we know: CONTEXT.md is explicit — "shown but disabled, with the reason" — this is locked,
     not open.
   - What's unclear: nothing; listed here only so the planner does not accidentally treat "omit"
     as equally valid — it is not.
   - Recommendation: N/A, already decided.

## Environment Availability

Not applicable — this phase introduces no new external tool/service/runtime dependency. It uses the
existing Rust/Cargo toolchain, the existing Node/npm toolchain, and the existing WASM build
(`web/scripts/build-wasm.sh`, invoked by `prebuild`), all already required by every prior phase in this
milestone.

**One pre-existing environment hazard worth flagging for the plan's verify commands (Q6):**
`web/package.json`'s `"compile": "tsc --noEmit"` script (`web/package.json:9`) has no `precompile`
step, while `"build": "next build"` (`:6`) has `"prebuild": "bash ../scripts/build-wasm.sh && (cd
../packages/pv-ui && npm ci)"` (`:7`), which is what actually installs `packages/pv-ui`'s own
`node_modules` (including `react`, since `pv-ui` is a separate package `web` imports from). Running
`npm run compile` as a fresh, standalone verify step — before `npm run build` has ever populated
`packages/pv-ui/node_modules` in that checkout — fails with `TS2307 Cannot find module 'react'`,
not because of anything this phase's code does wrong. **The plan's verification commands must either
run `npm run build` (or at minimum its `prebuild` step) before `npm run compile`, or explicitly note
this ordering requirement**, so a "compile fails" result during verification is correctly attributed.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (web unit) | Vitest 3.2.4 (`web/package.json:36`, `"test": "vitest run"`) |
| Framework (web e2e) | Playwright 1.61.1 (`web/package.json:24`, `"test:e2e": "playwright test"`) |
| Framework (server) | Rust's built-in `#[test]` via `cargo test` (workspace `test_command` in `.planning/config.json`: `cargo test --workspace`) |
| Config file | `web/vitest.config.ts` / `web/playwright.config.ts` (both pre-existing, unmodified by this phase) |
| Quick run command | `cd web && npx vitest run src/components/vault/ItemForm.test.tsx src/lib/vault/store.real-wasm.test.ts` |
| Full suite command | `cd web && npm test && npm run test:e2e` (web) ; `cargo test --workspace` (server) ; `cargo clippy --workspace --all-targets -- -D warnings` (DEBT-04's own gate) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ORG-01 (SC1) | Destination survives save, reload, sync round trip; optgroup renders correctly for empty/one/many shared folders | unit + e2e | `vitest run src/components/vault/ItemForm.test.tsx`; `playwright test e2e/sharing.spec.ts -g "destination survives"` (new) | ItemForm.test.tsx ✅ exists (mocked-crypto only, per Q6 — not evidence for the crypto claim); e2e case ❌ Wave 0 |
| ORG-02 (SC2) | Moved item decrypts correctly for a real recipient (positive, recipient-side, live) | e2e (live, two sessions) + real-WASM | `playwright test e2e/sharing.spec.ts -g "moved item recipient reads"` (new); `vitest run src/lib/vault/store.real-wasm.test.ts` (extend) | ❌ Wave 0 for both — no existing test covers a scope-move-then-recipient-read cycle |
| ORG-02 (SC3) | Destination-key-unavailable refusal, deliberately driven, byte-identical rollback proof | e2e (live, two sessions, TOCTOU) | `playwright test e2e/sharing.spec.ts -g "move refused when destination access revoked mid-session"` (new) | ❌ Wave 0 — mirrors Phase 31's SC5 test at `sharing.spec.ts:1377-1515` structurally |
| ORG-04 (SC4) | Member loses access after next completed sync, positive-then-negative anchor | e2e (live, two sessions) | `playwright test e2e/sharing.spec.ts -g "removed from folder loses access on next sync"` (new) | ❌ Wave 0 |
| DEBT-04 (SC5) | `cargo clippy --workspace --all-targets -- -D warnings` exits 0 | server, direct command | `cargo clippy --workspace --all-targets -- -D warnings` (the criterion IS the command — no wrapper test needed) | N/A — this is the test |

### Sampling Rate

- **Per task commit:** `cd web && npx vitest run <touched test files>` ; `cargo clippy -p pv-server -- -D warnings` (fast, scoped)
- **Per wave merge:** `cd web && npm test` ; `cargo test --workspace`
- **Phase gate:** `cd web && npm run build && npm run test:e2e` (note the `npm run build`-before-`test:e2e`
  ordering also happens to satisfy Q6's `packages/pv-ui` install hazard for free, since e2e drives a
  built app) ; `cargo clippy --workspace --all-targets -- -D warnings` ; `cargo test --workspace`

### Wave 0 Gaps

- [ ] `web/e2e/sharing.spec.ts` — needs 3 new cases: SC1's reload/sync-round-trip destination-survival
      check, SC3's deliberately-driven TOCTOU refusal (mirrors `sharing.spec.ts:1377-1515`'s existing
      SC5 pattern almost exactly), SC4's positive-then-negative two-session anchor.
- [ ] A real-WASM test (new file, e.g. `web/src/lib/vault/moveVaultItem.real-wasm.test.ts`, mirroring
      `store.real-wasm.test.ts`'s existing shape) proving the AAD/key-selection dispatch across all
      four directions without mocking `@/lib/crypto` — required per the standing "mocked crypto is not
      evidence" rule (`REQUIREMENTS.md` Non-Negotiable 2), since `ItemForm.test.tsx` and every other
      `web/src/components/vault/*.test.tsx` file mocks `@/lib/crypto` (confirmed: `DetailPanel.test.tsx:96`,
      `ItemRow.test.tsx`, `SharingOverviewPanel.test.tsx`, `ShareDialog.test.tsx` all `vi.mock("@/lib/crypto", ...)`).
- [ ] Server-side integration test for the `item_shares`-survival fix (Pitfall 1/Q4): grant a direct
      item share, move the item into an ordinary shared folder, assert the direct-share recipient's
      resolved access level is unchanged (currently would fail — the row is deleted today).
- [ ] `crates/pv-server` tests already cover `move_item`'s existing gates; no new gate logic is being
      added by ORG-01/02/04 beyond the item_shares-survival scoping fix above.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Unchanged by this phase — session auth already covers every touched endpoint. |
| V3 Session Management | No | Unchanged. |
| V4 Access Control | Yes | `Membership<Item, RequireEdit>` (source) + `require_collection_edit`/`require_item_bucket_edit_access` (destination) — both pre-existing, unmodified by this phase's ORG-01/02/04 work. The item_shares-survival fix (Q4) changes *what data survives* a move, not *who is authorized to move it*. |
| V5 Input Validation | Yes | `validate_blob_len` on `enc_key`/`enc_data` (existing, `vault.rs:57-62`), unchanged. |
| V6 Cryptography | Yes | AEAD (XChaCha20-Poly1305, per project constraints) with AAD binding `collection_id`+`item_id`+`revision` — `pv-core`, never hand-rolled client-side (see Don't Hand-Roll). |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Bare FK reassignment producing an undecryptable-but-persisted row | Tampering (data integrity) | AAD binds `collection_id` — already enforced server-side by requiring fresh `enc_key`/`enc_data` on every move (`vault.rs:907-915`'s own doc comment names this as SHARE-04's headline fix, Vaultwarden #6269). |
| A contributor on one item_bucket escalating to a different bucket's declared level by relocating items | Elevation of Privilege | Gate 1 (`vault.rs:963-989`, the "laundering" guard, 260812-01e HI-03) — pre-existing, unmodified by this phase; CONTEXT.md's exclusion of item_buckets from the editor's destination list is an *additional*, independent mitigation (no UI path offers a bucket as a destination at all). |
| A revoked collection member retaining a stale client-side cached key past the point of a driven revoke | Information Disclosure | Not new to this phase — `getCollectionKey`'s cache is invalidated on the next completed sync (`collectionKeys` map, freed on lock and on collection-list refresh, `collections.ts:66-72`); the TOCTOU window this phase's SC3 test deliberately drives is a **timing** gap already accepted and proven-bounded by Phase 31's identical SC5 mechanism, not a new hole this phase introduces. |
| An `item_shares` recipient with authorization but no read path (the Pitfall 1 residual nuance) | Information Disclosure (of a different, inverse shape — a grant that looks live in the DB but is unreachable) | Not a vulnerability (nothing is disclosed) — flagged only because it is a UX/completeness gap, not a security gap; no mitigation needed for this phase's threat model. |

## Sources

### Primary (HIGH confidence — read directly this session)

- `crates/pv-server/src/routes/vault.rs` (full file, 1646 lines) — `create`, `update`, `delete`,
  `move_item`, `resolve_recipients`, `bump_collection_revision`, `bump_recipients_vault_revision`,
  `bump_direct_share_revision`, `create_share`.
- `crates/pv-server/src/routes/membership.rs:140-488` — `combine_access`, `Collection::resolve_access`,
  `Item::resolve_access`, `require_collection_edit`, `gate`.
- `crates/pv-server/src/routes/sync.rs:1-60,288-450` — `pull_shared_collection`/`pull_shared_direct`
  doc comments and `pull_shared_direct`'s actual query (`collection_id IS NULL` filter).
- `crates/pv-core/src/items.rs:28-65` — `build_item_aad`/`build_coll_item_aad`.
- `web/src/components/vault/ShareDialog.tsx:1500-1800` — `submitItemFamilyWide`,
  `submitFolderVariant`'s seed-move loop (the composition to generalize).
- `web/src/components/vault/ItemForm.tsx` (full file) — confirmed zero `collectionId` references;
  `handleSubmit`, `renderFolderBlock`, prop signature.
- `web/src/lib/vault/store.ts:670-1180` — `mergeCollectionSnapshot`, `createVaultItem`,
  `updateVaultItem`'s collection-aware encrypt branch.
- `web/src/lib/vault/collections.ts:1-80,339` — `Collection` interface, `getCollectionKey`,
  `useCollections`.
- `web/src/lib/vault/api.ts:200-411` — `moveItemToCollection` and its sibling wire wrappers.
- `web/src/components/vault/CollectionPicker.tsx:1-100` — the `item_bucket`-exclusion filter pattern.
- `.planning/phases/31-the-share-dialog-per-person-access-existing-destinations/31-VERIFICATION.md` —
  F-1 (wrong sync lane), SC5 (TOCTOU mechanism), gap-closure disposition.
- `.planning/WINDOWS.md` — DEBT-04 entries #1 and #3 (both open); #19 (unrelated to this phase, noted
  only for context).
- Live command run this session: `cargo clippy --workspace --all-targets -- -D warnings` (exit
  non-zero, 19 `vault.rs` errors + 6 `pv-provider/src/ceremony.rs` errors, full output captured).
- `web/package.json:1-40` — `compile`/`build`/`prebuild` script definitions.
- `crates/pv-server/src/routes/mod.rs:433,435` — confirmed route table (`PUT`/`DELETE` only on
  `/api/vault/items/{id}`, no singular `GET`; `PUT` on `/collection`).

### Secondary (MEDIUM confidence)

- The `web/src/components/vault/.planning/.../32-CONTEXT.md` file's provenance (accidental nested
  copy from a misconfigured prior-agent `cwd`) — inferred from directory structure and this agent's
  own environment block showing the identical `cwd`, not confirmed by any log or commit message.

### Tertiary (LOW confidence)

None — every claim above was either read directly from source this session or is explicitly marked
`[ASSUMED]` in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; every reused symbol was located and its call sites read.
- Architecture (the four-direction composition): HIGH for personal→shared (directly precedented,
  read verbatim); MEDIUM-HIGH for the other three directions (generalized by symmetry from the same
  primitives, not independently precedented in existing code — this is genuinely new composition
  work, just of already-proven pieces).
- Pitfalls: HIGH for Pitfalls 2 and 3 (both directly grounded in Phase 31's own verification report
  and this session's own code reads); MEDIUM for Pitfall 1's exact fix shape (the CONTEXT.md-vs-code
  contradiction itself is HIGH confidence — directly read both sides — but "scope the DELETE to
  item_bucket-only" is this research's recommendation, not a pre-existing decision, hence Claude's
  discretion per CONTEXT.md and open to the planner's own judgment).

**Research date:** 2026-08-19
**Valid until:** Should be re-checked if Phase 33 or any hotfix touches `vault.rs::move_item`,
`membership.rs::combine_access`/`Item::resolve_access`, or `store.ts`'s collection-scoped encrypt/
decrypt branches before Phase 32 is planned — otherwise stable for the milestone's remaining duration
(no fast-moving external dependency involved).
