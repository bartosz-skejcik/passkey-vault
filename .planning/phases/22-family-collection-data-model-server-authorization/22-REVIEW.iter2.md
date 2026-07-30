---
phase: 22-family-collection-data-model-server-authorization
reviewed: 2026-07-30T09:53:39Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - crates/pv-server/migrations/0014_family_sharing.sql
  - crates/pv-server/src/error.rs
  - crates/pv-server/src/routes/membership.rs
  - crates/pv-server/src/routes/families.rs
  - crates/pv-server/src/routes/collections.rs
  - crates/pv-server/src/routes/identity.rs
  - crates/pv-server/src/routes/vault.rs
  - crates/pv-server/src/routes/mod.rs
  - crates/pv-server/tests/membership_route_sweep.rs
  - crates/pv-server/tests/collections.rs
  - crates/pv-server/tests/family.rs
  - crates/pv-server/tests/identity_keypair.rs
  - crates/pv-server/tests/vault.rs
  - crates/pv-server/tests/common/mod.rs
findings:
  critical: 1
  warning: 9
  info: 10
  total: 20
status: issues_found
---

# Phase 22: Code Review Report

**Reviewed:** 2026-07-30T09:53:39Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

> Severity mapping used below: **Critical (CR-) = BLOCKER**, **Warning (WR-) = WARNING**, **Info (IN-) = observations
> I could not raise to a proven defect, or accepted design properties worth recording for Phases 23–27.**

## Summary

I attacked the authorization core specifically: every handler in `families.rs`, `collections.rs`,
`identity.rs`, `vault.rs` was traced against the `Membership<R,M>` / `FamilyMembership<M>` extractors,
every write to `collection_id` was grepped, and the two "proof" mechanisms (`tests/membership_route_sweep.rs`,
the `#[cfg(test)]` audits in `routes/mod.rs`) were probed for evasions.

**The IDOR surface holds up.** Every handler that touches a shared resource takes its resource id from the
path via `Membership`/`FamilyMembership` and binds `membership.resource_id`/`membership.family_id` in SQL —
not one takes an id from a JSON body and queries on it. `move_item`'s body-supplied `new_collection_id` is the
single exception and it is gated by `require_collection_edit()`, which funnels through the same `gate::<RequireEdit>()`.
The 404-vs-403 split lives in exactly one function. `RequireEdit::satisfied_by` is a strict `== AccessLevel::Edit`;
no ordering assumption is reintroduced anywhere; `combine_access`'s rank function is not `Ord` and is used only
in `Item::resolve_access`. The Vaultwarden #6269 fix is real, covers source AND destination, and no other code
path writes `collection_id` (only `move_item`'s single `UPDATE`, which writes `collection_id`/`enc_key`/`enc_data`
together — never a bare FK update). Sharing/unsharing/adding a member touch zero item ciphertext. The migration is
strictly additive with a nullable `vault_items.collection_id`. **That core is a meaningful clean result and I want
to say so plainly.**

**But the phase ships one non-functional security feature and its evidence is false.** `Item::resolve_access`
returns early for a personal item (`collection_id IS NULL`) *before* it ever queries `item_shares`. Every
`item_shares` row created against a personal item — which is the entire point of SHARE-02's "direct per-item
sharing, independent of any collection membership" — grants exactly nothing. And the one integration test that
claims to prove revocation on that path (`item_share_create_and_revoke_round_trip`) asserts a `404` that would
have been returned identically *before* the revocation. It passes vacuously.

Beyond that: the two "structural proof" tests have concrete, non-hypothetical evasions (`.route_service(` /
`.nest_service(` for the route scan; grouped imports of `decrypt_item` and total absence of `unwrap_user_key`
for the zero-knowledge audit), the sweep's only adversarial caller is a *non-family* user so intra-family
isolation — the actual threat model of a family-sharing feature — is entirely untested, and there is still no
endpoint through which a collection member can read a shared item's ciphertext at all.

## Critical Issues

### CR-01: `item_shares` is silently ignored for every personal item — SHARE-02's direct per-item sharing grants nothing

**File:** `crates/pv-server/src/routes/membership.rs:220-225` (with `crates/pv-server/src/routes/vault.rs:538-581`)

**Issue:**
`Item::resolve_access` early-returns on the personal branch **before** the `item_shares` query at line 241:

```rust
let Some(collection_id) = collection_id else {
    // Personal item — byte-for-byte the existing `WHERE id=? AND user_id=?` rule
    return Ok(if owner_user_id == caller_user_id { Some(AccessLevel::Edit) } else { None });
};
```

`item_shares` is therefore consulted **only** when `collection_id IS NOT NULL`. Grep confirms this is the sole
authorization read of the table (`membership.rs:241`); the only other reader is `families::member_access`, which
merely displays it.

Meanwhile `vault::create_share` explicitly advertises the personal case in its own doc comment ("a PERSONAL item
(`collection_id IS NULL`) being shared directly has no collection to derive a family from in the first place"),
validates the recipient, validates the blob, and inserts the row — with `201 CREATED`.

Two concrete failure scenarios:

1. **The feature is dead.** Anna owns personal item `I`. She shares it with Piotr at `edit`:
   `POST /api/vault/items/I/shares {"recipient_user_id": piotr, "sealed_key": "...", "access_level": "edit"}`
   → `201`. Piotr then calls `POST /api/vault/items/I/touch` (needs only `RequireRead`) → **404**.
   `PUT /api/vault/items/I` → **404**. There is no request Piotr can send that uses the grant.
   SHARE-02's server half is a no-op for the case it was written for.

2. **The server misreports access as granted.** `GET /api/families/members/{piotr}/access` (families.rs:255-261)
   returns `item_shares: [{item_id: I, access_level: "edit"}]`. The FAM-03 breakdown — the endpoint whose whole
   job is telling the owner who can reach what — asserts Piotr has `edit` on `I` when the server will in fact
   deny him. Phase 26's UI will render a lie, and a family owner reviewing access will draw the wrong conclusion
   about their exposure.

Note the direction of the flaw is fail-closed for confidentiality (nobody gains access they shouldn't), which is
why this is a correctness/integrity blocker rather than a disclosure one — but Phases 23–27 build on top of an
`item_shares` table that the resolver half-ignores, and the FAM-03 misreport is itself a security-UI defect.

**Fix:** Consult `item_shares` on both branches. The personal branch's ownership rule becomes one of the two
grants fed to `combine_access`, exactly like the collection branch:

```rust
// membership.rs — Item::resolve_access
let item_share_access = {
    let row = sqlx::query("SELECT access_level FROM item_shares WHERE item_id = ? AND recipient_user_id = ?")
        .bind(resource_id)
        .bind(caller_user_id)
        .fetch_optional(db)
        .await?;
    match row {
        None => None,
        Some(row) => {
            let s: String = row.try_get("access_level").map_err(|_| ApiError::Internal)?;
            Some(parse_access_level(&s)?)
        }
    }
};

let Some(collection_id) = collection_id else {
    // Personal item: owner keeps Edit; a direct share is the second, independent grant.
    let owner_access = (owner_user_id == caller_user_id).then_some(AccessLevel::Edit);
    return Ok(combine_access(owner_access, item_share_access));
};

// ... collection_keys lookup unchanged ...
Ok(combine_access(collection_access, item_share_access))
```

Then add the missing positive assertion described in WR-01 so the path is actually covered.

## Warnings

### WR-01: `item_share_create_and_revoke_round_trip`'s "live-endpoint proof" is vacuous

**File:** `crates/pv-server/tests/vault.rs:404-517` (specifically 506-516)

**Issue:** The test creates a share on a **personal** item, revokes it, then asserts
`POST /api/vault/items/{id}/touch` returns `404` "proving the revoked recipient must lose access on the very next
request." Because of CR-01, that request returns `404` *before* the revocation too. The assertion cannot
distinguish "revocation worked" from "the grant never existed" — it is the direct reason CR-01 shipped.

The SQL-count assertions around it (`count_after_create == 1`, `count_after_revoke == 0`) are real, but they only
prove a row was inserted and deleted; they say nothing about whether the row has any authorization effect.

Contrast with `collections.rs::revoked_share_loses_access_on_next_request_same_session`, which does it correctly:
it asserts `200` **before** the revoke and `404` after, on the same bearer token. That is the shape this test needs.

**Fix:** Add the before-assertion, and (once CR-01 is fixed) it will fail loudly if the grant is inert:

```rust
// AFTER create_share succeeds, BEFORE the revoke:
let touch_before_revoke =
    req(&app, "POST", &format!("/api/vault/items/{item_id}/touch"), &member_token, None).await;
assert_eq!(
    touch_before_revoke.status(), StatusCode::OK,
    "a `read` item_shares grant must actually confer access — otherwise the post-revoke 404 proves nothing"
);
```

### WR-02: the literal-route scan is evadable by `.route_service(` / `.nest_service(` / a router-taking helper

**File:** `crates/pv-server/src/routes/mod.rs:863-920`

**Issue:** `router_literal_routes_match_documented_allowlist` guards against hidden sub-routers with:

```rust
assert!(!body.contains(".nest("),  ...);
assert!(!body.contains(".merge("), ...);
```

and then scans for the literal substring `".route("`. Three registrations escape all of it, without touching
either allowlist constant (so the "visible, reviewable act" carve-out does not apply):

1. `.nest_service("/api", secret_router)` — the string `.nest_service(` does **not** contain `.nest(` (the next
   byte after `nest` is `_`), so the guard misses it, and `.route(` never appears.
2. `.route_service("/api/secret", svc)` — `.route_service(` does **not** contain `.route(` for the same reason.
   It registers a real path and is invisible to the scan.
3. `let api = extra_routes(api);` where `fn extra_routes(r: Router<AppState>) -> Router<AppState> { r.route("/api/secret", post(h)) }`
   — the `.route(` lives in the helper's body, which is outside `extract_fn_body`'s extracted region.

The scan is asserted to be the "structural backstop" for the route sweep's admitted blind spot, and the sweep's
own module doc points at it as such. With these holes, a mutating endpoint can be added with no membership gate,
no sweep coverage, and a fully green test suite.

**Fix:** Match on the method-name boundary rather than the raw substring, and forbid the `_service` variants
explicitly:

```rust
for forbidden in [".nest(", ".nest_service(", ".merge(", ".route_service(", ".fallback_service("] {
    assert!(
        !body.contains(forbidden),
        "router_with_cors must not use {forbidden} — would hide routes from this scan"
    );
}
```

(`.fallback_service(` is applied *outside* the extracted body today, so adding it here is free; keep it out of
the extracted region.) For the helper-function escape, additionally assert that the only non-`.route(` router
rebinding in the body is the documented `.fold(...)` — e.g. assert the body contains exactly one occurrence of
`let api =` beyond the initial `Router::new()` chain, or scan the whole file for `.route(` and require every hit
to live in `router_with_cors`, `family_routes`, or `membership_routes`.

### WR-03: the zero-knowledge audit has two evadable needle sets

**File:** `crates/pv-server/src/routes/mod.rs:762-815`

**Issue:** The audit checks two lists:

```rust
let fq_needles   = ["pv_core::identity::seal", "pv_core::identity::unseal",
                    "pv_core::items::encrypt_item", "pv_core::items::decrypt_item"];
let bare_needles = ["seal", "unseal", "unseal_collection_key", "unwrap_identity_secret_key"];
```

The `seal`/`unseal` family is covered both fully-qualified and bare, so a grouped import or module alias for
those is caught (the comment's claim holds there). But:

- **`encrypt_item` / `decrypt_item` / `encrypt_item_for_collection` / `decrypt_item_for_collection` are checked
  ONLY as fully-qualified paths.** `use pv_core::items::decrypt_item;` followed by `decrypt_item(&key, ...)`
  produces no line containing `pv_core::items::decrypt_item`, and neither identifier is in `bare_needles`.
  The audit passes while the server decrypts an item.
- **`pv_core::keys::unwrap_user_key` is not in either list.** It is `pub` (`crates/pv-core/src/keys.rs:118`) and
  is the single most direct zero-knowledge violation available — server-side unwrapping of the User Key — and the
  audit would not notice it in any form, qualified or not.
- `wrap_identity_secret_key` / `wrap_user_key` are likewise absent (less severe: wrapping does not require
  plaintext key recovery, but a server that can wrap has plaintext in hand).

The self-exclusion of `src/routes/mod.rs` is fine as documented — `mod.rs` is route wiring only. That is not the
blind spot; the needle lists are.

**Fix:** Put every plaintext-touching `pv_core` entry point in `bare_needles` (word-boundary matched, which
already rejects prefix matches like `seal` inside `sealed_key`):

```rust
let bare_needles = [
    "seal", "unseal", "unseal_collection_key",
    "unwrap_identity_secret_key", "wrap_identity_secret_key",
    "unwrap_user_key", "wrap_user_key",
    "encrypt_item", "decrypt_item",
    "encrypt_item_for_collection", "decrypt_item_for_collection",
];
```

Add a comment requiring this list to be extended whenever `pv-core` gains a new plaintext-handling `pub fn`.

### WR-04: no endpoint returns a shared item's ciphertext — a collection member can authenticate, resolve access, and still never read the item

**File:** `crates/pv-server/src/routes/vault.rs:144-150` and `crates/pv-server/src/routes/sync.rs:pull`

**Issue:** `fetch_items_for` is `SELECT ... FROM vault_items WHERE user_id = ?` — strictly the creator's own
rows. It backs both `GET /api/vault/items` and `sync::pull`'s snapshot arm. There is no `GET /api/vault/items/{id}`.
Consequently `Membership<Item, RequireRead>` is used by exactly one handler in the codebase (`touch`), and a
`read`/`hidden_password` collection member's only exercisable capability on a shared item is marking it "used."

Failure scenario: Anna creates item `I`, moves it into shared collection `C`, grants Piotr `read` on `C` with a
correctly sealed Collection Key. Piotr's client calls `GET /api/vault/items` → `[]`. `GET /api/sync?since=0` →
snapshot containing none of `C`'s items. Piotr holds a valid Collection Key he can never apply to anything.

This may be scoped to Phase 23, but this phase is what fixes the data model and the extractor contract, and the
asymmetry (write paths are collection-aware, read paths are not) is the exact class of bug `membership.rs`'s own
module doc cites as the reason the extractor exists ("Bitwarden's asymmetric GET-checks-membership-but-POST-doesn't
defect"). It should at minimum be recorded as a known gap with an owning phase.

**Fix:** Either add a collection-aware list arm, or record the gap explicitly. Minimal shape:

```rust
// fetch_items_for -> add a UNION arm for collection/item-share reachable rows
"SELECT i.id, i.enc_key, i.enc_data, i.revision, i.updated_at, i.last_used_at \
   FROM vault_items i WHERE i.user_id = ? \
 UNION \
 SELECT i.id, ... FROM vault_items i \
   JOIN collection_keys ck ON ck.collection_id = i.collection_id AND ck.recipient_user_id = ? \
 UNION \
 SELECT i.id, ... FROM vault_items i \
   JOIN item_shares s ON s.item_id = i.id AND s.recipient_user_id = ?"
```

### WR-05: a cross-collection move can permanently lock the item's creator out of their own row, which still appears in their list

**File:** `crates/pv-server/src/routes/membership.rs:227-255` and `crates/pv-server/src/routes/vault.rs:434-515`

**Issue:** `Item::resolve_access`'s collection branch ignores `owner_user_id` entirely — once `collection_id IS NOT NULL`,
access is `collection_keys ∪ item_shares` only. `move_item` never updates `vault_items.user_id`. `fetch_items_for`
still selects by `user_id`.

Attack/failure sequence (two edit-capable co-members, no malice required — a misclick suffices):

1. Anna creates item `I` (`user_id = anna`) and moves it into collection `C`. Anna and Marek both hold `edit` on `C`.
2. Marek creates collection `D` (any family member may, `collections::create` is `FamilyMembership<RequireRead>`).
   Anna has no `collection_keys` row for `D`.
3. `PUT /api/vault/items/I/collection {"new_collection_id": D, "enc_key": <sealed to D's key>, "enc_data": <re-encrypted under D>, "expected_revision": N}`
   → `200`. Both gates pass: Marek has `edit` on source `C` and `edit` on destination `D`.
4. Anna now gets `404` from `PUT /api/vault/items/I`, `DELETE /api/vault/items/I`, and `POST /api/vault/items/I/touch`
   — she cannot even delete her own row. Yet `GET /api/vault/items` **still returns `I`** (it is `user_id`-scoped),
   now carrying ciphertext encrypted under a Collection Key Anna does not hold. Her client renders an
   undecryptable entry it cannot remove.

The item is unrecoverable for Anna without another `D` editor moving it back or direct DB surgery.

**Fix:** Two options, either is defensible; pick one and state it:
(a) treat the creator as always retaining a grant — `combine_access(owner_access, collection_access, item_share_access)`
in the collection branch too (simplest, matches "you can always delete what you created"); or
(b) require `require_collection_edit()` on the **source** collection for the move to be legal *and* transfer
`vault_items.user_id` to the mover so `list` stays consistent with `resolve_access`.
Whichever is chosen, `fetch_items_for`'s `WHERE user_id = ?` and `Item::resolve_access` must agree on who "owns"
a collection-scoped item — today they disagree, and that disagreement is what strands the row.

### WR-06: `revoke_access` can delete the last `collection_keys` row, orphaning the collection and every item in it

**File:** `crates/pv-server/src/routes/collections.rs:256-272`

**Issue:** `collections::create`'s doc comment states the invariant explicitly — "a collection never exists with
zero key-holders, even for an instant" — and enforces it transactionally at creation. `revoke_access` has no
corresponding guard: it deletes any `(collection_id, recipient_user_id)` row an `edit` holder names, including
the caller's own, including the last one.

Failure scenario (no attacker needed): Anna is the sole key-holder of collection `C` containing 40 items. She
calls `DELETE /api/vault/collections/C/access/{anna}` — perhaps intending to "leave" the collection —
→ `204 NO CONTENT`. `C` now has zero `collection_keys` rows. Every item in it resolves to `None` for every user
(`Item::resolve_access` collection branch), so nobody can read, edit, move, or delete them; the rows persist
forever, encrypted under a Collection Key no surviving `sealed_key` wraps. Nothing in the API can recover them.

An `edit` holder can also do this to *someone else's* collection by revoking every other recipient first — but the
single-user footgun above is the one that will actually bite, and it is a silent, unconfirmed, irreversible
destruction of encrypted data.

**Fix:** Refuse the revocation that would empty the collection, and require an explicit delete-collection flow
instead:

```rust
let remaining: i64 = sqlx::query_scalar(
    "SELECT COUNT(*) FROM collection_keys WHERE collection_id = ? AND recipient_user_id <> ?",
)
.bind(&membership.resource_id)
.bind(&target_user_id)
.fetch_one(&state.db)
.await?;
if remaining == 0 {
    return Err(ApiError::Conflict(
        "cannot revoke the last key-holder — the collection's contents would become permanently unreadable".into(),
    ));
}
```

Add a test asserting `409` on last-key-holder self-revocation.

### WR-07: access resolution never re-checks family membership, so `collection_keys`/`item_shares` survive family removal

**File:** `crates/pv-server/src/routes/membership.rs:174-256`

**Issue:** Family membership is checked **only at grant time** (`collections::add_member:207-216`,
`vault::create_share:548-554`). `Collection::resolve_access` and `Item::resolve_access` query
`collection_keys`/`item_shares` alone; neither joins `family_members`, and the schema has no FK from
`collection_keys` to `family_members` (the composite PK is `(collection_id, recipient_user_id)` and the only FKs
are to `collections`/`users`).

Not exploitable today — no member-removal endpoint exists (Phase 25 owns it). But this phase is where the
resolution rule is fixed, and Phase 25 will inherit it: the moment `DELETE /api/families/members/{user_id}` lands,
a removed member keeps every `collection_keys` and `item_shares` row they were ever granted and continues to pass
`Membership<Collection|Item, *>` on their existing session. "Removed from the family" will silently mean
"removed from the roster listing only."

**Fix:** Either join family membership into resolution now (cheap and self-documenting):

```sql
SELECT ck.access_level FROM collection_keys ck
  JOIN collections c ON c.id = ck.collection_id
  JOIN family_members fm ON fm.family_id = c.family_id AND fm.user_id = ck.recipient_user_id
 WHERE ck.collection_id = ? AND ck.recipient_user_id = ?
```

or record an explicit, tested contract that Phase 25's removal handler MUST cascade-delete the removed user's
`collection_keys` and `item_shares` rows in the same transaction. Do not leave it implicit.

### WR-08: the route sweep's only adversarial caller is a non-family user — intra-family isolation is untested

**File:** `crates/pv-server/tests/membership_route_sweep.rs:176-237`

**Issue:** Caller `U` is described in the fixture as "registered, logged in, belongs to NO family." For every
`family_routes()` entry, `U` is rejected by `FamilyMembership` before any collection logic runs; for every
`membership_routes()` entry against a collection, `U` fails `Collection::resolve_access` for the same trivial
reason it fails for any random stranger. The sweep therefore proves "an outsider cannot reach family resources" —
which was never the hard case.

The hard case for a family-sharing feature is **member-vs-member**: family member `B`, who legitimately passes
`FamilyMembership`, holding no `collection_keys` row for collection `X`. No test in this phase exercises that
against `GET /api/vault/collections/{id}`, `POST /api/vault/collections/{id}/members`,
`GET /api/vault/collections/{id}/access`, `DELETE /api/vault/collections/{id}/access/{user_id}`, or any
`/api/vault/items/{id}/*` route. (`collections.rs:142-155` covers exactly one such assertion — that
`GET /api/vault/collections` returns an empty list — and nothing else.)

I traced the code and believe it is correct (`Collection::resolve_access` filters on `recipient_user_id`, and
`Item::resolve_access` never widens to family scope). This is a coverage defect, not a proven bug — but it is the
coverage that matters most, and Phases 23–27 will be written against a sweep that is trusted to have checked it.

**Fix:** Add a second sweep caller. `common::register_second_family_member` already exists:

```rust
// alongside u_token:
let b_token = common::register_second_family_member(&app, &owner_token, "sweep-family-member@example.com").await;
// then run the same loop for b_token, asserting 404 on every collection/item entry
// (B is a family member, so /api/families/members correctly returns 200/403 and belongs in
// INSUFFICIENT_LEVEL_EXCEPTIONS or a small per-caller expectation table).
```

This also finally gives `INSUFFICIENT_LEVEL_EXCEPTIONS` a real entry instead of being permanently empty.

### WR-09: `move_item` bumps only the caller's `vault_revision`, so co-holders of a shared item never learn it changed

**File:** `crates/pv-server/src/routes/vault.rs:296-301, 349-354, 493-498`

**Issue:** `update`, `delete`, and `move_item` all run
`UPDATE users SET vault_revision = vault_revision + 1 WHERE id = ?` bound to `membership.caller_user_id`, and
publish the `SyncEvent` to `state.sync_hub.publish(&membership.caller_user_id, ...)`.

Before this phase the caller was always the owner, so this was correct by construction. Now that
`Membership<Item, RequireEdit>` admits non-owners, editing a shared item bumps the *editor's* counter and leaves
every other holder's counter untouched. Their `GET /api/sync?since=N` returns `UpToDate` and their clients keep
serving a cached copy of a row that has changed — and, for a `delete`, a row that no longer exists.

For a password manager this is a stale-credential / lost-update hazard, not a cosmetic sync lag: two members can
each hold `expected_revision = 2` and the second save will 409 with no prior indication anything moved.

The comment at vault.rs:291-295 defers "broadcasting a shared item's change to every co-recipient's own sync
channel" to Phase 23, which I accept as a scoping decision — but the deferral needs to be a tracked item, not a
code comment, because until it lands every shared-item edit is invisible to everyone but the editor.

**Fix:** Either bump every holder's counter in the same transaction:

```sql
UPDATE users SET vault_revision = vault_revision + 1 WHERE id IN (
  SELECT ? UNION
  SELECT ck.recipient_user_id FROM collection_keys ck
    JOIN vault_items i ON i.collection_id = ck.collection_id WHERE i.id = ? UNION
  SELECT s.recipient_user_id FROM item_shares s WHERE s.item_id = ?
)
```

or file an explicit Phase 23 requirement and add a `// TODO(phase-23):` marker at each of the three call sites so
it cannot be lost.

## Info

### IN-01: `hidden_password` is an accidental-exposure guard only, and the server hands the holder the full Collection Key

**File:** `crates/pv-server/src/routes/collections.rs:115-148`

`GET /api/vault/collections/{id}` is `Membership<Collection, RequireRead>` and returns the caller's own
`sealed_key` — the wrapped Collection Key — regardless of whether their level is `read`, `edit`, or
`hidden_password`. A `hidden_password` holder can therefore decrypt every item in the collection, password
included, entirely client-side.

`move_item`'s doc comment states this correctly ("an ACCIDENTAL-EXPOSURE guard, never a cryptographic boundary").
Recording it here so Phase 26's UI copy is written against the true property: the server enforces *what the API
will do*, not *what the holder can compute*. Any UI string implying the password is cryptographically withheld
would be false.

### IN-02: `combine_access` is a strict maximum, so an `item_shares` grant can never restrict

**File:** `crates/pv-server/src/routes/membership.rs:134-148`

`rank(Read)=0, rank(HiddenPassword)=1, rank(Edit)=2`, and the result is the higher of the two grants. This is the
documented intent and it correctly prevents a weaker grant from escalating. The consequence worth recording: a
per-item `hidden_password` share issued to a member who already holds `edit` on the containing collection
resolves to `Edit` — the "hide this one item's password from Marek" gesture is a no-op. If Phase 23/26 exposes
per-item `hidden_password` as a restriction in the UI, it will not behave as users expect. Either document
`item_shares` as additive-only, or introduce an explicit per-item override that is allowed to reduce.

### IN-03: three endpoints are user-existence / family-membership oracles for any authenticated caller

**Files:** `crates/pv-server/src/routes/identity.rs:163-169`, `crates/pv-server/src/routes/collections.rs:207-224`,
`crates/pv-server/src/routes/vault.rs:548-562`

- `POST /api/identity/verify/{user_id}` returns `404` for a non-existent user and `204` for an existing one, to
  any authenticated caller. Direct existence probe.
- `collections::add_member` / `vault::create_share` return distinguishable `400` bodies for "recipient is not a
  family member" vs "recipient has not published an identity keypair yet".

Impact is low: ids are UUIDv4 (not enumerable), and any family member can already read the full roster via
`GET /api/families/members`. But `create_share` requires only `Edit` on *any* item — which every user has on
their own personal items — so any registered user can probe arbitrary ids for family membership. I could not
construct a meaningful attack from this and am not raising it above Info.

### IN-04: `families::create` does not bound the `name` field

**File:** `crates/pv-server/src/routes/families.rs:44-47`

`name` is trimmed and rejected when empty, but never length-checked, while every other client-supplied string in
this phase goes through `validate_blob_len` (`collections::create`, `identity::upsert`, `vault::create`/`update`/
`move_item`/`create_share`). A single 100 MB `name` is storable. Bounded blast radius (one row per instance,
authenticated caller), but it is an inconsistency with the codebase's own established guard.
Fix: `validate_blob_len("name", name)?`.

### IN-05: `families::member_access` queries `collection_keys`/`item_shares` globally, not scoped to the caller's family

**File:** `crates/pv-server/src/routes/families.rs:237-261`

Both queries filter on `recipient_user_id` alone; neither joins through `collections.family_id` to
`membership.family_id`. Inert at v0.4 (FAM-01 singleton — every collection belongs to the one family), which is
why this is Info. It becomes a cross-family disclosure the moment multi-family lands. Add the join now while the
fix is one `JOIN collections c ON c.id = ck.collection_id AND c.family_id = ?`.

### IN-06: `vault_items.collection_id` has no `ON DELETE` action — a future delete-collection will hard-fail

**File:** `crates/pv-server/migrations/0014_family_sharing.sql:94`

`ALTER TABLE vault_items ADD COLUMN collection_id TEXT REFERENCES collections(id);` defaults to `NO ACTION`,
while `collections.family_id` is `ON DELETE CASCADE` from `families`. sqlx enables `PRAGMA foreign_keys` by
default, so deleting a family (or a collection) that still has items in it will raise a FK violation and abort
rather than doing anything sensible. No endpoint deletes either today, so this is not reachable — but Phase 25's
family/collection deletion needs an explicit item-disposition decision (`SET NULL` back to personal scope,
`CASCADE` delete, or a pre-flight move). Decide it before writing the handler.

### IN-07: unreachable `None` branches in `collections::get` / `CollectionResponse`

**File:** `crates/pv-server/src/routes/collections.rs:46-56, 131-139`

`Membership<Collection, RequireRead>` has already proven a `collection_keys` row exists for `(resource_id, caller)`,
so `key_row` is never `None` and `access_level`/`sealed_key` are never `None` on this path. The `Option` shape is
documented as "kept for response-shape reuse across `create`/`get`", but both call sites always populate it, so
the wire contract advertises a nullability that never occurs. Clients will write dead null-handling. Consider
non-`Option` fields, or keep them and note the invariant in the API docs.

### IN-08: `identity::upsert` provides no keypair rotation or replacement path

**File:** `crates/pv-server/src/routes/identity.rs:85-88`

`ON CONFLICT(user_id) DO NOTHING` makes the first published keypair permanent for the account's lifetime. This is
the correct race-resolution behavior (KEY-01's self-healing design, and the test at `identity_keypair.rs:85-105`
proves the loser adopts the winner). Recording the consequence: if `wrapped_secret_key` is ever stored corrupt,
or the identity key must be rotated after a compromise, there is no API to do it — the account's entire sharing
capability is permanently broken. A future rotation endpoint must also re-seal every `collection_keys` and
`item_shares` row addressed to that user.

### IN-09: `move_item` to `new_collection_id: null` bypasses the destination gate

**File:** `crates/pv-server/src/routes/vault.rs:443-445`

`require_collection_edit` runs only `if let Some(dest_id)`. Moving an item *out* of a collection to personal
scope has no second check — an `edit`-capable non-creator can unilaterally pull a shared item out from under
every other member. The blast radius is bounded (the same caller could `DELETE` the item outright, and post-move
access reverts to the creator's `user_id`, so it is not theft), which is why this is Info rather than a warning.
It interacts with WR-05: the resulting state is coherent only because the personal branch honors `user_id`.

### IN-10: the parsed `AccessLevel` is discarded and the raw request string is bound to SQL

**File:** `crates/pv-server/src/routes/collections.rs:205, 235` and `crates/pv-server/src/routes/vault.rs:546, 573`

`parse_access_level_from_request(&req.access_level)?` is called for its `Result` only; the subsequent `INSERT`
binds `&req.access_level`, the un-normalized caller string. This is safe today — parameter binding rules out
injection, the prior validation restricts the value to exactly the three literals, and the `CHECK` constraint is
a third backstop — but it makes the DB's stored value depend on client bytes rather than on the server's own
canonical vocabulary. Binding `parse_access_level_from_request(&req.access_level)?.as_str()` costs nothing and
makes `AccessLevel::as_str` the single writer, matching the "sole trusted decoder" framing in `membership.rs:58-71`.

---

_Reviewed: 2026-07-30T09:53:39Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
