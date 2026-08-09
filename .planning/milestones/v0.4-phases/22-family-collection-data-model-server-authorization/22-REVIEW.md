---
phase: 22-family-collection-data-model-server-authorization
reviewed: 2026-07-30T13:05:00Z
depth: standard
iteration: 3
files_reviewed: 7
files_reviewed_list:
  - crates/pv-server/src/routes/membership.rs
  - crates/pv-server/src/routes/collections.rs
  - crates/pv-server/src/routes/vault.rs
  - crates/pv-server/src/routes/mod.rs
  - crates/pv-server/tests/collections.rs
  - crates/pv-server/tests/membership_route_sweep.rs
  - crates/pv-server/tests/vault.rs
findings:
  critical: 2
  warning: 5
  info: 6
  total: 13
status: issues_found
---

# Phase 22: Code Review Report — Iteration 3 (final pass)

**Reviewed:** 2026-07-30T13:05:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

> Severity mapping: **Critical (CR-) = BLOCKER**, **Warning (WR-) = WARNING**, **Info (IN-) =
> observation or accepted-and-recorded property.** IDs restart at 01 for this iteration.

## Summary

`cargo test -p pv-server` is green on the current tree (exit 0). I re-traced
`Item::resolve_access` and `Collection::resolve_access` statement by statement, replayed the
revocation and #6269 sequences by hand against the current SQL, checked the new atomic `DELETE` for
a residual race, re-probed both structural-proof tests for fresh evasions, and ran the full
regression sweep the directive asked for.

**Priority 1 — the iteration-2 blocker is genuinely gone, and its removal did not re-break CR-01.
Both sides of the two-sided constraint hold.** Verified, not assumed:

- The unconditional creator fold is **removed**. The collection branch is now
  `Ok(combine_access(collection_access, item_share_access))` (`membership.rs:341`); `owner_access`
  (`:292`) is computed once and consumed **only** by the personal-item early return (`:301`).
  Revocation is absolute on every write verb: a member with no `collection_keys` row resolves to
  `None` → `gate()` → `NotFound`, for `PUT`, `DELETE`, and `move_item` — including `move_item` with
  a NULL destination, because the source gate fires in the extractor before `vault.rs:461`'s
  destination check is ever reached.
- **CR-01 stays fixed.** A personal item (`collection_id IS NULL`) still returns
  `combine_access(owner_access, item_share_access)`, so the owner still gets `Edit`
  (`membership.rs:294-301`, unit-covered at `:598-613`, `:706-707`) and a direct `item_shares` grant
  on a personal item still grants (`:659-708`, live-endpoint-covered at `tests/vault.rs:495-529`).
- **Both new regression tests genuinely exercise the creator path, not the owner path.**
  `revoked_creator_loses_edit_on_their_own_created_item_next_request`
  (`tests/collections.rs:1167-1332`) has **Marek** create the item (`:1214`, his token) and move it
  in himself (`:1228`), then asserts `404` on `PUT`, on `move_item` with `"new_collection_id": null`
  (`:1282` — the exact exfiltration step of the old blocker), and on `DELETE`, all on his
  **original still-valid token**, plus a positive control that the remaining key-holder keeps `Edit`.
  `hidden_password_creator_cannot_reassign_own_item_vaultwarden_6269_regression` (`:1345-1510`) has
  **hp_member** create the item at `:1414` and move it in at `:1428` while still `edit`, then be
  revoked and re-added at `hidden_password`, and asserts `403` (not `404` — the caller provably has
  *some* access) on the reassignment. Both would fail against the fold; the fixer's claimed
  revert-and-rerun matrix is consistent with what the tests actually assert.
- **Regression sweep clean.** `combine_access` is unchanged, still a strict maximum, still `Ord`-free,
  still called from exactly one place; `RequireEdit::satisfied_by` is still `== Edit`. The #6269
  both-source-and-destination gate holds (`vault.rs:454` + `:461-463`). `move_item`'s single
  `UPDATE` (`vault.rs:474-486`) is grep-confirmed the only production write to `collection_id`. No
  sharing path writes `enc_data`. `0014_family_sharing.sql` is untouched since `5620c0f` and still
  strictly additive. 404-vs-403 still lives only in `gate::<M>()` (`membership.rs:352-358`); the
  other `NotFound` returns are post-authorization row-not-found, not access decisions. Every handler
  still takes its id from a path capture, never a body field.

**Priority 2 — all four warning fixes verified correct.**

- **W1 is genuinely race-free.** The guard is now one statement (`collections.rs:286-297`). The outer
  `WHERE` matches at most one row (PK is `(collection_id, recipient_user_id)`), and the `EXISTS`
  subquery tests for a *different* recipient, so it cannot observe its own deletion. SQLite serialises
  write statements under an exclusive write lock and takes its read mark after acquiring it, so the
  second of two concurrent revokes evaluates `EXISTS` against the first's committed state and
  correctly yields 0 rows. `rows_affected() == 0` maps to `409` when the row still exists and `404`
  when it does not (`:299-320`). The concurrency test (`tests/collections.rs:567-708`) is real:
  dedicated multi-connection shared-cache pool, `Barrier`-released pair, 20 trials, asserts both
  `double_wins == 0` and `remaining >= 1`.
- **W2 is pinned the same way as the `collection_keys` join and introduces no IDOR.**
  `membership.rs:268-278`: `fm_o` is bound to `owner_user_id` — this resource's own
  `vault_items.user_id`, never client-controlled — and `fm_r` is bound to `caller_user_id` through
  the `WHERE`. `family_members`' PK `(family_id, user_id)` bounds each join to one row, so it can
  only ever *remove* rows, never manufacture access. New negative unit test at `:719-753`.
- **W3's new test does cover `router()`'s own body** (`mod.rs:1062-1077`) and does scan the whole
  production region for stray `.route(` (`:1082-1094`), and it is robust to a renamed binding *within
  `mod.rs`*. See WR-03 for the residual.
- **W4:** all five needles are present (`mod.rs:825-830`) and the `sealed_key` false-positive
  rejection did **not** regress — `contains_identifier`'s word-boundary logic (`:740-754`) is
  byte-identical, and `seal` inside `sealed_key` is still rejected on the trailing `e`. See WR-04 for
  the residual.

**What still blocks.** Two things, both consequences of the fix pass rather than pre-existing:

1. **The read path was never brought in line with the resolver.** `fetch_items_for` is still
   `WHERE user_id = ?` with no collection predicate, so the revoked creator whose `PUT`/`DELETE`/
   `move_item` the new tests correctly reject still receives that item's **current ciphertext** —
   including every post-revocation edit — from `GET /api/vault/items` and `GET /api/sync`. The
   iteration-2 review framed this half as a cosmetic "undecryptable row in the creator's list" and
   pre-authorised deferring it; that framing understates it. This is not the deferred Phase 23
   *read-endpoint* gap (recipients under-served) — it is the opposite direction, a revoked party
   over-served. Details in CR-01.
2. **Removing the ownership fold made the item-share blast-radius question unrecoverable.** An
   `edit` item-share recipient can move someone else's **personal** item into a collection they
   control; before this iteration the owner's ownership fold rescued them, and now nothing does — the
   owner gets `404` on every verb including `DELETE`, with no recovery path anywhere in the API.
   Details in CR-02, which is also this review's answer to Priority 3.

## Structural Findings (fallow)

No `<structural_findings>` block was supplied for this iteration. Nothing to carry.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: the list/sync read path ignores the authorization resolver — a revoked collection member keeps receiving post-revocation ciphertext for every item they created

**File:** `crates/pv-server/src/routes/vault.rs:144-164` (with `:215-218` and `routes/sync.rs:70`)

**Issue:**
`fetch_items_for` is unchanged by the whole fix pass:

```rust
"SELECT id, enc_key, enc_data, revision, updated_at, last_used_at FROM vault_items WHERE user_id = ?"
```

There is no `collection_id` predicate and no `collection_keys` join. `vault_items.user_id` is the
item's *original creator*, and — per this phase's own comment at `vault.rs:248-249` — is
"actively WRONG" as an access predicate for a collection-scoped item. Every write handler now agrees
with `Item::resolve_access`; this read path does not, and it feeds both `GET /api/vault/items` and
`sync::pull`'s snapshot arm.

Replay the phase's **own new regression test** and add one request it does not make:

1. Marek (family member, `edit` on collection `C`) creates item `I` and moves it into `C` —
   `tests/collections.rs:1214-1241`, both gates pass, `vault_items.user_id = marek`.
2. The owner revokes Marek: `DELETE /api/vault/collections/{C}/access/{marek}` → `204` (`:1245-1253`).
3. `PUT`/`DELETE`/`move_item` on `I` → `404`. Correct, and now tested (`:1258-1300`).
4. **`GET /api/vault/items` with the same still-valid token → `200`, and `I` is in the body with its
   current `enc_key`/`enc_data`.** `WHERE user_id = marek` still matches.
5. The owner then edits `I` (the test does exactly this at `:1315-1331`, `200 OK`). Marek's next
   `GET /api/vault/items` — or `GET /api/sync` — returns the **new** ciphertext.

Marek held `C`'s `CollectionKey` while he was a member; the server cannot make him forget it and does
not re-key on revocation (there is no re-key path in this phase). So step 5 is a genuine
confidentiality failure past revocation: the server keeps handing a revoked member fresh ciphertext
it knows they can decrypt. Phase 22 **SC#4** is *"revocation is enforced on the very next request"* —
it is enforced on every request except the one that actually returns data.

This is also, precisely, the CVE-2026-43639 shape `membership.rs`'s own module doc (`:1-8`) says this
phase exists to close, inverted: mutating verbs check membership, the GET does not.

**Explicitly not a re-flag of the deferred Phase 23 read path.** That deferral is about a *share
recipient* being unable to read a shared item (under-served, fails closed, defensible against all six
success criteria — I re-confirmed and am not reopening it). This is the opposite direction: a party
the resolver denies is over-served. The two are independent, and only this one is a security defect.

**Fix (non-widening — deliberately does not add the Phase 23 read path):** keep the result set
byte-identical to today's except for rows the caller can no longer resolve.

```rust
// vault.rs — fetch_items_for
"SELECT id, enc_key, enc_data, revision, updated_at, last_used_at \
   FROM vault_items WHERE user_id = ? AND collection_id IS NULL \
 UNION ALL \
 SELECT i.id, i.enc_key, i.enc_data, i.revision, i.updated_at, i.last_used_at \
   FROM vault_items i \
   JOIN collection_keys ck ON ck.collection_id = i.collection_id AND ck.recipient_user_id = ? \
   JOIN collections c      ON c.id = i.collection_id \
   JOIN family_members fm  ON fm.family_id = c.family_id AND fm.user_id = ck.recipient_user_id \
  WHERE i.user_id = ?"
```

(The `i.user_id = ?` in the second arm is what keeps this strictly non-widening; dropping it is the
Phase 23 read path and is a separate decision.) Then extend
`revoked_creator_loses_edit_on_their_own_created_item_next_request` with a fourth assertion —
`GET /api/vault/items` must not contain `item_id` after the revoke — and the same for
`GET /api/sync?since=0`. That assertion is the one that fails today.

As a side effect this also closes WR-05's original symptom (the creator's stranded, undecryptable row)
without touching authorization, exactly as the iteration-2 finding intended.

### CR-02: an `edit` item-share recipient can move someone else's personal item into a collection they control, permanently locking the owner out of their own item

**File:** `crates/pv-server/src/routes/vault.rs:452-463` (with `membership.rs:294-341`)

**Issue — this is the item the fixer skipped, and iteration 3's own (correct) blocker fix is what
made it unrecoverable.**

`move_item`'s source gate is `Membership<Item, RequireEdit>`. On a **personal** item that now resolves
to `Edit` for two parties: the owner, and any `edit`-level `item_shares` recipient (the surface CR-01
of iteration 1 made live two commits ago). Sequence, entirely through this phase's API:

1. Anna owns personal item `I` (`collection_id IS NULL`, `user_id = anna`).
2. Anna shares `I` with family member R at `access_level: "edit"` — `POST /api/vault/items/{I}/shares`
   → `201` (`vault.rs:563-606`).
3. R creates their own collection `C_r` — `collections::create` hard-codes R to `'edit'`.
4. R calls `PUT /api/vault/items/{I}/collection {"new_collection_id": "C_r", ...}`. Source gate: R has
   `Edit` via `item_shares` ✔. Destination gate (`vault.rs:461-462`): R has `edit` on `C_r` ✔. The
   `UPDATE` sets `collection_id = C_r` and replaces `enc_key`/`enc_data` with blobs R supplies.
5. **Anna now resolves `None` on her own item.** `Item::resolve_access` takes the collection branch;
   she has no `collection_keys` row on `C_r` and no `item_shares` row (she is the owner, not a
   recipient), and ownership deliberately confers nothing on this branch (`membership.rs:327-341`).
   `PUT` → 404. `DELETE` → 404. `PUT .../collection` back to `null` → 404. `POST .../shares/...` → 404.
6. There is no recovery: no delete-collection endpoint, no admin override, and R can revoke Anna's
   share and add other family members to `C_r` at will. Anna's only remaining relationship to `I` is
   that `GET /api/vault/items` still lists it as an undecryptable blob she cannot remove (CR-01).

Before iteration 3, the withdrawn ownership fold accidentally masked this (Anna kept `Edit`). The fold
had to go — CR-01 of iteration 2 is right and I am not reopening it — but its removal turned a
reversible nuisance into permanent, silent data loss for the owner of a *personal* item, triggered by
a counterparty the owner authorised only to **edit**. Nothing in the codebase says `edit` on an item
share includes "may re-scope this item out of your control", and nothing tests it.

**Verdict on Priority 3, plainly:** the fixer was right that the *general* blast-radius question
(delete / re-share / revoke-others'-shares) is a product decision and can ship documented — see WR-05.
It was **not** right to defer this specific path. Unrecoverable owner lockout is not a
capability-scope preference; it is data loss, and closing it requires no product decision at all.

**Fix (decision-free, preserves every collection semantic):** a *personal* item may only be re-scoped
by its owner. Collection-to-collection moves are untouched, so SHARE-04/#6269 behaviour and both
existing regression tests are unaffected.

```rust
// vault.rs — move_item, immediately before the destination gate
let row = sqlx::query("SELECT user_id, collection_id FROM vault_items WHERE id = ?")
    .bind(&source.resource_id)
    .fetch_one(&state.db)
    .await?;
let current_collection: Option<String> = row.try_get("collection_id").map_err(|_| ApiError::Internal)?;
let owner_user_id: String = row.try_get("user_id").map_err(|_| ApiError::Internal)?;
if current_collection.is_none() && owner_user_id != source.caller_user_id {
    // Personal item: only its owner may change its scope. An `edit` item share
    // grants content edit, never re-scoping — re-scoping into a collection the
    // owner holds no grant on is a one-way lockout with no recovery path.
    return Err(ApiError::Forbidden);
}
```

Add a test: R holds an `edit` share on Anna's personal item, `PUT .../collection` → `403`, and Anna's
own `PUT .../collection` on the same item still `200`.

**Decision needed, in one sentence (for WR-05, not for this fix):** does `access_level: "edit"` on an
`item_shares` grant mean "may modify this item's contents" or "may also delegate, re-scope, and
destroy it"?

## Warnings

### WR-01: `create_share`'s family-membership guard and the new W2 resolver join disagree — a `201 Created` share that grants nothing

**File:** `crates/pv-server/src/routes/vault.rs:573-579` (vs. `membership.rs:268-278`)

**Issue:** W2 pinned resolution to the **item owner's** family (`fm_o.user_id = owner_user_id`), but
`create_share`'s grant-time guard is still family-**wide**:

```rust
"SELECT 1 FROM family_members WHERE user_id = ?"   // recipient is in SOME family
```

The two predicates now differ. If the item's owner holds **no** `family_members` row — entirely
reachable: register, skip family creation, create an item, share it to someone who *is* in the
instance's singleton family — `create_share` returns `201`, the row is inserted, and
`Item::resolve_access`'s `fm_o` join yields nothing, so the recipient resolves to `None` forever. That
is the exact bug class iteration-1 CR-01 existed to kill (a silently-void grant the API reports as
success), reintroduced in a narrower shape by the fix for it. It fails closed, so it is not an
exposure — but it is a lie to the client and it will be indistinguishable from a bug report about
"sharing doesn't work".

**Fix:** make the guard mirror the resolver — scope the recipient check through the item owner's
family, the same way `collections::add_member` (`collections.rs:207-216`) already scopes through the
collection's family:

```rust
let is_family_member = sqlx::query(
    "SELECT 1 FROM family_members fm_r \
       JOIN family_members fm_o ON fm_o.family_id = fm_r.family_id \
      WHERE fm_r.user_id = ? \
        AND fm_o.user_id = (SELECT user_id FROM vault_items WHERE id = ?)",
)
.bind(&req.recipient_user_id)
.bind(&membership.resource_id)
```

and update `create_share`'s doc comment (`vault.rs:557-562`), whose "any family member is the only
well-defined guard" rationale is no longer true now that the resolver derives a family from the item.

### WR-02: `collections::list` and `access_list` never got the `family_members` join the resolver did — a removed member would still be served their `sealed_key`

**File:** `crates/pv-server/src/routes/collections.rs:157-164` (with `:344-351`)

**Issue:** WR-07 (iteration 1) and W2 (iteration 2) joined `family_members` into both resolver
queries. `collections::list` is still a bare `collections JOIN collection_keys WHERE
ck.recipient_user_id = ?`, and it returns `sealed_key` for every row (`:174`). Once Phase 25 ships
member removal, a removed user whose `collection_keys` rows survive gets `404` from
`GET /api/vault/collections/{id}` (resolver joins) but a full listing — **including the sealed
Collection Key** — from `GET /api/vault/collections` (no join). `access_list` has the same asymmetry
in the other direction: it reports co-recipients the resolver would reject, so the FAM-03 breakdown
and the resolver disagree (the same second-order effect iteration 2 recorded for
`families::member_access` in IN-05).

Not exploitable today — no removal endpoint exists — but the whole point of the W2/WR-07 work was that
this is the phase that fixes the *resolution rule*, and Phase 25 inherits it. Leaving two of the four
`collection_keys` readers unjoined guarantees the inconsistency is rediscovered under time pressure.

**Fix:** add the same join to both queries:

```sql
FROM collections c
  JOIN collection_keys ck ON ck.collection_id = c.id
  JOIN family_members fm  ON fm.family_id = c.family_id AND fm.user_id = ck.recipient_user_id
 WHERE ck.recipient_user_id = ?
```

or, if that is judged Phase 25 scope, record it as an explicit Phase 25 requirement ("member removal
MUST cascade-delete `collection_keys` and `item_shares` in the same transaction"), not as a comment.

### WR-03: the whole-file route scan is file-local — a helper defined in another `routes/*.rs` module still evades both structural guards

**File:** `crates/pv-server/src/routes/mod.rs:1082-1094`

**Issue:** The W3 test's two halves are both correct as written, and the `router()`-wrapper half
(`:1062-1077`) genuinely closes the evasion it targets. But the doc comment claims a `.route(` call
"added via ANY helper function, under ANY binding name, **anywhere else in the production source**,
fails this test immediately" (`:1040-1042`), and that is true only for `src/routes/mod.rs`:

```rust
// vault.rs
pub fn extra_routes(r: Router<AppState>) -> Router<AppState> {
    r.route("/api/secret", post(secret_handler))     // lives in vault.rs
}
// mod.rs, inside router_with_cors
let app = vault::extra_routes(api);                  // not "let api =" — counter stays 2
```

`total_in_production` and `accounted` are both computed over `mod.rs` only, so they stay equal; the
`let api =` counter (`:955-962`) sees a different binding name; the literal-route set is unchanged;
and the sweep iterates the two tables, not the router. All four guards pass on a live, ungated,
mutating path. Narrower than the blind spot W3 closed, but the test's own stated contract does not
hold, and a stated-but-false contract on a proof artifact is worse than a stated limitation.

**Fix:** widen the scan to the whole `src/routes/` tree — `collect_rs_files` already exists three
functions above:

```rust
// every `.route(` in src/routes/**.rs must live in mod.rs's three registrar fns
for file in &files {                       // reuse collect_rs_files(src/routes)
    if file == &mod_rs_path { continue; }
    let production = non_comment_lines(file).join(" ");
    assert_eq!(production.matches(".route(").count(), 0,
        "{}: route registration may only live in routes/mod.rs's router_with_cors/\
         family_routes/membership_routes", file.display());
}
```

Not blocking: this is test-hardening, and the live route table is correct today.

### WR-04: the ZK needle list is still hand-maintained, and `UserKey::expose`/`from_bytes` remain invisible to it

**File:** `crates/pv-server/src/routes/mod.rs:811-831`

**Issue:** The five names iteration 2 called for are present and correct. Two things the finding also
asked for were not done, and the comment still says "Extend this list whenever `pv-core` gains a new
plaintext-handling `pub fn`" (`:811-812`) — i.e. the drift risk is unchanged, only the current
snapshot improved:

1. **No mechanical cross-check.** Iteration 2 asked for a second test that greps
   `crates/pv-core/src/**.rs` for `pub fn` and asserts every name is either in `bare_needles` or in a
   justified `SERVER_SAFE_PV_CORE_FNS` allowlist. Without it the list silently desynchronises the next
   time `pv-core` grows — which is exactly how it got here twice (WR-03, then W4).
2. **The key-material accessors are still absent.** `grep 'pub fn' crates/pv-core/src/` shows
   `UserKey::expose` (`keys.rs:52`), `UserKey::from_bytes` (`keys.rs:46`), `ItemKey::expose`
   (`items.rs:175`), `ItemKey::from_bytes` (`items.rs:169`), `IdentitySecretKey::generate`
   (`identity.rs:132`). `expose()` on a key type is the single most direct signal that server-side
   code is holding plaintext key material, and the audit cannot see it in any form. `expose`/`generate`
   are generic enough to need a receiver-aware check or a targeted needle set
   (`UserKey::`, `ItemKey::`, `IdentitySecretKey::`) rather than a bare identifier.

**Fix:** add the mechanical cross-check test, and either add the three key-type paths as
fully-qualified needles or assert that `pv-server`'s `src/` never names `UserKey`, `ItemKey`, or
`IdentitySecretKey` at all (verified true today — `pv_core` appears in `src/` only as
`keys::random_bytes`, `kdf::KdfParams`, `keys::KEY_LEN`, and
`identity::IdentityPublicKey::from_bytes`, all legitimately server-side).

Not blocking: the boundary itself is intact today; this is about keeping the proof honest.

### WR-05: the rest of the item-share blast radius is still unpinned — and the product decision is now overdue

**File:** `crates/pv-server/src/routes/vault.rs:342-345, 563-566, 616-619`

**Issue:** With CR-02's move path closed, an `edit` `item_shares` recipient on someone else's
**personal** item can still:

- `DELETE /api/vault/items/{id}` — permanently destroy the owner's item, no revision token needed
  (`:342`, `:351-355`);
- `POST /api/vault/items/{id}/shares` — re-share it to any other family member with no owner consent
  (`:563`);
- `DELETE /api/vault/items/{id}/shares/{user_id}` — revoke *other* recipients' shares, including
  ones the owner created (`:616`).

The fixer's stated reason for skipping — "requires a product decision on intended blast radius before
it can be safely pinned" — is correct for these three, and I agree they can ship. What cannot ship is
shipping them *unstated and untested*: this surface only became live in commit `c2e54b7`, and no test
in the suite exercises any of the three. A later phase can then narrow or widen it by accident with a
green suite either way.

**Fix:** make the decision (one sentence, restated from CR-02: does `edit` on an item share mean
"modify contents" or "full lifecycle including delegation and destruction"?), write the answer into
`create_share`'s doc comment, and add one test per capability asserting the chosen behaviour. If the
answer is "modify contents only", the guard is the same shape as CR-02's — compare
`membership.caller_user_id` against `vault_items.user_id` in `delete`/`create_share`/`revoke_share`
when `collection_id IS NULL`.

## Info

Iteration-1 IN-01…IN-10 and iteration-2 IN-11/IN-12 are carried forward unchanged; each was
re-verified present in this tree and none is restated in full. Briefly: IN-01 `hidden_password` is an
accidental-exposure guard only (`collections.rs:131-139` still serves the caller's own `sealed_key` at
every level); IN-02 `combine_access` is additive-only; IN-03 three endpoints are user-existence
oracles; IN-04 `families::create` does not bound `name`; IN-05 `families::member_access` is not
family-scoped; IN-06 `vault_items.collection_id` has no `ON DELETE` action; IN-07 unreachable `None`
branches in `collections::get`; IN-08 `identity::upsert` has no rotation path; IN-09 `move_item` to
`null` bypasses the destination gate (**now correctly benign** — the source gate rejects the revoked
creator first, proven at `tests/collections.rs:1276-1293`); IN-10 the parsed `AccessLevel` is
discarded and the raw request string is bound to SQL; IN-11 handlers read `Path(id)` where
`membership.resource_id` is available; IN-12 `create_share` permits a self-share.

New this iteration:

### IN-13: a collection is now immortal, and any `edit` holder can become its sole key-holder

`collections.rs:286-320` correctly refuses to remove the last key-holder, and there is no
delete-collection endpoint (IN-06) — so a collection, once created, can never be removed or emptied.
Separately, nothing stops an `edit` member from revoking every *other* recipient one at a time and
ending as the sole holder of a family collection. Both follow from CONTEXT.md's flat model and neither
is a defect today; both need an answer before Phase 25 writes a removal handler.

### IN-14: the 409-vs-404 disambiguation `SELECT` is not atomic with its `DELETE`

`collections.rs:306-319`. A concurrent insert/delete between the two statements can flip a `409` into
a `404` or vice versa. Status-code cosmetics only — the authorization decision itself is entirely
inside the single atomic `DELETE`, which is what W1 required.

### IN-15: the `item_shares` resolver's `fm_o` join is an unconstrained cross join

`membership.rs:270`. `JOIN family_members fm_o ON fm_o.user_id = ?` relates to nothing in `s`; if the
item owner ever belongs to more than one family the join fans out and `fetch_optional` silently takes
whichever row SQLite returns first. Harmless today (the `idx_families_singleton` unique index makes a
second family impossible, and every fanned-out row carries the same `s.access_level`), but it is the
one place in the resolver where the family is not derived from a resource relationship. Worth pinning
with a comment before multi-family lands.

---

## Verdict

The **authorization resolver itself is now sound.** `Item::resolve_access` and
`Collection::resolve_access` are correct on every path I could construct: revocation is absolute,
personal ownership is preserved exactly where it belongs and nowhere else, `combine_access` cannot
escalate, both `family_members` joins are pinned to a server-derived family, the #6269 gate holds for
creators and non-creators alike, and 404-vs-403 lives in one function. The oscillation between CR-01
and its iteration-2 regression has genuinely converged.

What remains is not in the resolver — it is in the two places that **do not consult** it:

- **CR-01 (`fetch_items_for`) should block.** The fix is six lines of SQL and one test assertion, it
  widens nothing, and without it SC#4 is only half true: the phase ships a revocation that stops
  writes and keeps streaming reads. Serving fresh ciphertext to a revoked member is the one failure
  mode a sharing feature must not have on day one.
- **CR-02 (`move_item` on a personal item) should block.** Unrecoverable owner lockout is data loss,
  the guard is decision-free, and iteration 3's own (correct) fix is what removed the accidental
  mitigation. Deferring it means shipping a path where one family member can take another's
  credential away permanently.
- **WR-01…WR-05 should not block.** WR-01/WR-02 fail closed and are Phase 25 pre-conditions;
  WR-03/WR-04 are proof-artifact hardening on guards that are correct today; WR-05 needs the product
  decision the fixer correctly identified and can ship documented + tested.

_Reviewed: 2026-07-30T13:05:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard — iteration 3 (final pass)_
