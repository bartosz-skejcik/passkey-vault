---
phase: 22-family-collection-data-model-server-authorization
reviewed: 2026-07-30T11:40:00Z
depth: standard
iteration: 2
files_reviewed: 8
files_reviewed_list:
  - crates/pv-server/src/routes/membership.rs
  - crates/pv-server/src/routes/collections.rs
  - crates/pv-server/src/routes/vault.rs
  - crates/pv-server/src/routes/families.rs
  - crates/pv-server/src/routes/mod.rs
  - crates/pv-server/tests/membership_route_sweep.rs
  - crates/pv-server/tests/vault.rs
  - crates/pv-server/tests/collections.rs
findings:
  critical: 1
  warning: 6
  info: 12
  total: 19
status: issues_found
---

# Phase 22: Code Review Report — Iteration 2 (fix verification)

**Reviewed:** 2026-07-30T11:40:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

> Severity mapping: **Critical (CR-) = BLOCKER**, **Warning (WR-) = WARNING**, **Info (IN-) =
> observation or accepted-and-recorded property.** Finding IDs restart at 01 for this iteration;
> iteration-1 IDs are referenced by name where relevant.

## Summary

I re-attacked the authorization core after the six fix commits (`c2e54b7`, `454017c`, `a7b8541`,
`b1de31c`, `d8586ec`, `992d62f`), tracing `Item::resolve_access` and `Collection::resolve_access`
statement-by-statement, walking the new `family_members` join for widening, and re-probing both
"structural proof" tests for fresh evasions. `cargo test -p pv-server` is green (exit 0) on the
current tree.

**Most of the fix pass holds, and several fixes are genuinely good.** Specifically verified as
correct, not merely present:

- **CR-01 (personal-item `item_shares`) is really fixed.** The `item_shares` query at
  `membership.rs:244-255` now runs before the branch split; the personal branch returns
  `combine_access(owner_access, item_share_access)`. The owner of a personal item still resolves to
  `Some(Edit)` (`membership.rs:260`, unit-covered at `membership.rs:652-653`), and a direct share
  now genuinely grants (`membership.rs:621-654`).
- **No privilege escalation *inside* `combine_access`.** `rank` is unchanged, the result is a strict
  maximum, `Ord` is still absent, and `RequireEdit::satisfied_by` is still an exact `== Edit`. A
  `hidden_password` grant alone can never satisfy `RequireEdit`. `combine_access` is still called
  from nowhere but `Item::resolve_access`.
- **No IDOR in the new `family_members` join.** `fm.user_id = ck.recipient_user_id` is pinned to the
  caller by the `WHERE ck.recipient_user_id = ?` bind, and `fm.family_id = c.family_id` is pinned to
  the *requested* collection's own family. `family_members`' PK is `(family_id, user_id)`
  (`0014_family_sharing.sql`), so the join can yield at most one row and cannot fan out. The join can
  only ever *remove* rows — it cannot manufacture access. A non-member still resolves to `None` →
  `gate()` → `NotFound`. 404-vs-403 still lives only in `gate::<M>()` (`membership.rs:315-321`).
- **WR-01 is really fixed.** `tests/vault.rs:497-511` asserts `200` on `POST .../touch` *before* the
  revoke and `404` after, on the same non-owner session. It would have failed against pre-CR-01 code.
- **WR-06's guard is correct in the single-request case** (`collections.rs:272-284`) and its test
  (`tests/collections.rs:492-545`) is real — but see WR-01 below for the concurrency hole.
- **WR-08's new caller is genuinely adversarial.** `common::register_second_family_member`
  (`tests/common/mod.rs:146-182`) really registers B *and* has the owner `POST /api/families/members`
  them, so B passes `FamilyMembership` and is rejected only by the per-resource check. The B loop
  (`membership_route_sweep.rs:269-302`) runs against every `membership_routes()` entry and its
  assertions execute (405-skips are the only continue).
- **Regression sweep clean.** Every handler still takes its id from the path via the extractor;
  `create_share`/`revoke_share`/`add_member`/`revoke_access` all bind `membership.resource_id`, never
  a body id. The #6269 both-source-and-destination gate still holds (`vault.rs:461-463`).
  `move_item`'s single `UPDATE` (`vault.rs:474-486`) is still the only production write to
  `collection_id` — grep-confirmed. No sharing path writes `enc_data`. `0014_family_sharing.sql` is
  unchanged and still strictly additive. The `sealed_key` false-positive rejection in
  `contains_identifier` did NOT regress (`seal` at index 0 of `sealed_key` is rejected on the
  trailing `e`).

**But the WR-05 fix introduced a new blocker.** Folding the creator's implicit `Edit` into the
*collection* branch (`membership.rs:295-304`) means a member whose collection access has been
revoked keeps full `Edit` on every item they created in that collection. That directly contradicts
Phase 22 **SC#4** ("revocation is enforced on the very next request") and CONTEXT.md's recorded
SHARE-04 decision ("a `hidden_password` holder is rejected server-side" from reassignment). The
existing revocation test and the #6269 regression test both use a *non-creator* as the adversary, so
neither catches it. Details in CR-01 — including why the reviewer-suggested option (a) cannot be
patched into correctness and what to do instead.

Beyond that: WR-07's `family_members` join was applied to `collection_keys` only, leaving
`item_shares` unjoined on a surface that CR-01 just widened to every item; the WR-06 guard is a
non-transactional TOCTOU; and both structural proofs still have concrete, non-hypothetical evasions
(one of them in the very guard added to close WR-02).

## Structural Findings (fallow)

No `<structural_findings>` block was supplied for this iteration. Nothing to carry.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: the creator's implicit `Edit` survives collection-access revocation — SC#4's "enforced on the very next request" is false for any item the revoked member created

**File:** `crates/pv-server/src/routes/membership.rs:257-260, 295-304`
(with `crates/pv-server/src/routes/collections.rs:256-297` and `crates/pv-server/src/routes/vault.rs:452-540`)

**Issue:**
The WR-05 fix computes an unconditional ownership grant and folds it into the collection branch:

```rust
let owner_access = (owner_user_id == caller_user_id).then_some(AccessLevel::Edit);   // :260
...
Ok(combine_access(combine_access(owner_access, collection_access), item_share_access)) // :304
```

`combine_access` is a maximum, so for any item where `vault_items.user_id == caller`, the result is
`Some(Edit)` **regardless of `collection_keys`** — including when there is deliberately no
`collection_keys` row because the grant was *revoked*.

Concrete sequence, entirely through this phase's own API, no DB surgery:

1. Marek (family member) creates collection `C` — `collections::create` hard-codes his level to
   `'edit'`.
2. Marek creates item `I` (`vault_items.user_id = marek`) and moves it into `C`. Both gates pass.
3. Marek adds Anna to `C` at `edit`. Both now hold keys; `C` holds the family's shared logins.
4. Anna revokes Marek: `DELETE /api/vault/collections/{C}/access/{marek}` → `204`. Marek's
   `collection_keys` row is gone (`collections.rs:286-290`), and the WR-06 guard is satisfied because
   Anna remains.
5. **Marek's session, unchanged, still resolves `Some(Edit)` on `I`:**
   - `PUT /api/vault/items/I` → succeeds (overwrites the shared ciphertext).
   - `DELETE /api/vault/items/I` → `204`. The item is gone for Anna too.
   - `PUT /api/vault/items/I/collection {"new_collection_id": null, ...}` → `200`. `I` becomes
     Marek's personal item, re-encrypted under his own key; Anna resolves `None` on it forever
     (`collection_id IS NULL`, she is not `user_id`, no `item_shares` row). The destination gate does
     not fire on a `null` destination (`vault.rs:461`, iteration-1 IN-09).

Phase 22 **SC#4** is *"The owner of a share can revoke that single share without removing the
recipient from the family, and revocation is enforced on the very next request."* For every item the
revoked recipient contributed, it is not.

The same fold also punches through the **SHARE-04 / Vaultwarden #6269 gate**, which CONTEXT.md
records as a hard decision: *"Moving an item between collections requires `edit` on the item's
current collection. A `hidden_password` holder is rejected server-side."* A member downgraded to
`hidden_password` on `C` (revoke + re-`add_member`, both endpoints this phase ships) resolves to
`Edit` on any item they created in `C` and can move it out or delete it. `move_item`'s own doc
comment at `vault.rs:422-426` — *"A `HiddenPassword` holder on the current collection fails
`RequireEdit::satisfied_by` right here, in the extractor"* — is now false for that case.

**Why the tests do not catch it:** `revoked_share_loses_access_on_next_request_same_session`
(`tests/collections.rs:404-483`) only re-`GET`s the *collection*; the revoked member never created an
item in it. `hidden_password_holder_cannot_reassign_item_vaultwarden_6269_regression`
(`tests/collections.rs:676-801`) has the **owner** create the item at `:746-758`, so `hp_member` is
never the creator. Both pass with the hole wide open.

**Why this cannot be patched inside `resolve_access`:** "the creator keeps access with no
`collection_keys` row" and "a revoked member has no `collection_keys` row" are the *same predicate*.
Neither ordering the fold differently nor `explicit.or(owner_access)` distinguishes them — WR-05's
stranded state and the post-revocation state are byte-identical in the DB. Option (a) from
iteration 1 is therefore not implementable without this hole; I was wrong to offer it as
interchangeable with (b), and I am withdrawing it.

**Fix (recommended):** drop the ownership fold from the collection branch, and fix WR-05's actual
symptom — an undecryptable, unremovable row in the creator's list — at the list layer where it
belongs:

```rust
// membership.rs — Item::resolve_access, collection branch: authority is the
// collection grant (+ any direct item share). Ownership of a collection-scoped
// item confers nothing; revocation must be absolute (SC#4 / SHARE-06).
Ok(combine_access(collection_access, item_share_access))
```

```rust
// vault.rs — fetch_items_for: stop listing collection-scoped rows the caller
// cannot resolve, which is what actually stranded Anna in WR-05.
"SELECT id, enc_key, enc_data, revision, updated_at, last_used_at \
   FROM vault_items WHERE user_id = ? AND collection_id IS NULL \
 UNION \
 SELECT i.id, i.enc_key, i.enc_data, i.revision, i.updated_at, i.last_used_at \
   FROM vault_items i \
   JOIN collection_keys ck ON ck.collection_id = i.collection_id AND ck.recipient_user_id = ?"
```

If the `fetch_items_for` half is judged Phase 23 scope (it overlaps WR-05 below), the
`resolve_access` half must still land now: a creator getting `404` on an item that a co-editor moved
away from them is strictly safer than a revoked member retaining `Edit` on shared data.

Then add the two tests that would have caught this:
1. revoke a *creator's* collection access, assert `404` on `PUT`/`DELETE`/`PUT .../collection` for
   the item they created — the SC#4 case;
2. the #6269 regression, replayed with `hp_member` as the item's **creator** — the SHARE-04 case.

## Warnings

### WR-01: the WR-06 last-key-holder guard is a non-transactional TOCTOU — two concurrent revokes still orphan the collection

**File:** `crates/pv-server/src/routes/collections.rs:272-290`

**Issue:** The `COUNT(*)` and the `DELETE` are two independent statements, each acquiring its own
pooled connection (`&state.db`, not a `tx`). Collection `C` has exactly two key-holders, A and B. Two
`DELETE /api/vault/collections/{C}/access/{...}` requests in flight — one targeting A, one targeting
B (a double-submit from one edit-holder's UI is enough; no second actor required):

| t | request 1 (revoke A) | request 2 (revoke B) |
|---|---|---|
| 1 | `COUNT(... <> A)` → 1 (B present) | |
| 2 | | `COUNT(... <> B)` → 1 (A present) |
| 3 | `DELETE A` → 204 | |
| 4 | | `DELETE B` → 204 |

Both pass the guard, both commit, and `C` ends with zero `collection_keys` rows — precisely the state
the guard's own comment says "nothing in this API can ever recover" from. Pool size does not save it:
even at `max_connections = 1` the two statements of request 1 are not atomic with respect to request
2's statements.

**Fix:** make the guard part of the write, so SQLite's write lock enforces it:

```rust
let result = sqlx::query(
    "DELETE FROM collection_keys \
      WHERE collection_id = ? AND recipient_user_id = ? \
        AND EXISTS (SELECT 1 FROM collection_keys \
                     WHERE collection_id = ? AND recipient_user_id <> ?)",
)
.bind(&membership.resource_id).bind(&target_user_id)
.bind(&membership.resource_id).bind(&target_user_id)
.execute(&state.db).await?;
```
then disambiguate `rows_affected() == 0` into 409 (row exists but is the last holder) vs 404 (no such
row) with one follow-up `SELECT`, mirroring `vault::update`'s existing shape. A `begin()` +
`BEGIN IMMEDIATE` transaction around the current two statements is equally acceptable.

### WR-02: WR-07's `family_members` join was applied to `collection_keys` only — `item_shares` is still unjoined, on a surface CR-01 just widened to every item

**File:** `crates/pv-server/src/routes/membership.rs:244-255` (vs. `:188-197` and `:277-286`)

**Issue:** Iteration-1 WR-07 named both tables: *"a removed member keeps every `collection_keys`
**and `item_shares`** row they were ever granted."* The fix joins `family_members` into
`Collection::resolve_access` and into `Item::resolve_access`'s **collection** query, but the
`item_shares` query is a bare

```sql
SELECT access_level FROM item_shares WHERE item_id = ? AND recipient_user_id = ?
```

with no membership predicate at all. `vault::create_share` enforces family membership only at grant
time (`vault.rs:573-579`), exactly the pattern WR-07 rejected.

This is *more* exposed than before the fix pass, not less: pre-CR-01 the `item_shares` query ran only
for collection-scoped items; it now runs for **every** item, so a stale grant survives on personal
items too. Not exploitable today (Phase 25 owns member removal), but Phase 25 will inherit a resolver
that is half-consistent, and the asymmetry is invisible — both queries sit six lines apart and look
alike.

**Fix:** join through the sharer's family, which is well-defined for both branches in the v0.4
singleton model and stays correct when multi-family lands:

```sql
SELECT s.access_level FROM item_shares s
  JOIN vault_items i        ON i.id = s.item_id
  JOIN family_members fm_o  ON fm_o.user_id = i.user_id            -- item owner's family
  JOIN family_members fm_r  ON fm_r.family_id = fm_o.family_id
                           AND fm_r.user_id = s.recipient_user_id  -- recipient still in it
 WHERE s.item_id = ? AND s.recipient_user_id = ?
```

If that is judged too much for this pass, state the alternative explicitly and testably: Phase 25's
removal handler MUST cascade-delete the removed user's `item_shares` rows in the same transaction,
recorded as a requirement — not as a comment.

### WR-03: the route-scan's two new guards are both bypassable — a `.route(` in `router()` is invisible, and the `let api =` counter checks a variable name

**File:** `crates/pv-server/src/routes/mod.rs:885-939` (with `:41-43`)

**Issue:** The forbidden-substring loop now correctly rejects `.nest(`, `.nest_service(`, `.merge(`,
`.route_service(` — that part of WR-02 is genuinely closed, and the `.fallback_service(` carve-out is
correctly reasoned (it registers no named path). Two evasions survive, one of them created by the fix:

1. **Only `router_with_cors`'s body is scanned.** `extract_fn_body(&joined, "pub fn router_with_cors(")`
   anchors on the *definition*, so the wrapper at `:41-43` is outside the scanned region entirely:
   ```rust
   pub fn router(state: AppState, static_dir: Option<PathBuf>) -> Router {
       router_with_cors(state, static_dir, cors_layer())
           .route("/api/secret", post(secret_handler))   // live, ungated, unscanned
   }
   ```
   This registers a real, membership-free path. It is invisible to the literal-route set comparison,
   invisible to the `let api =` counter, and invisible to the sweep (which iterates the two tables).
   It is also live in every test: `tests/common/mod.rs:34` builds the app via `routes::router(...)`,
   not `router_with_cors`. This is the most natural place a future author would add a route.
2. **The `let api =` counter is a name check, not a structural one.** The guard added for the
   helper-fn escape asserts exactly two occurrences of the literal `let api =` in the body. Renaming
   the third binding defeats it verbatim:
   ```rust
   let api = /* Router::new()... */;                    // 1
   let api = family_routes()...fold(api, ...)...;       // 2
   let app = extra_routes(api);                         // not "let api =" — count stays 2
   match static_dir { Some(dir) => app.fallback_service(serve), None => app }
   ```
   `extra_routes`' internal `.route("/api/secret", ...)` is outside the extracted body. It also fails
   *closed but wrongly* in a benign case: annotating the second binding as
   `let api: Router<AppState> = ...` drops the count to 1 and fails the test for no security reason.

**Fix:** stop scanning one function's text and scan the file instead — every `.route(` in
`src/routes/mod.rs` must live in `router_with_cors`, `family_routes`, or `membership_routes`:

```rust
// count `.route(` occurrences across the whole non-comment file, and assert it equals
// (occurrences inside the three extracted bodies). Any hit outside them fails.
let whole = non_comment_lines(&mod_rs_path).join(" ");
let accounted: usize = ["pub fn router_with_cors(", "pub fn family_routes(", "pub fn membership_routes("]
    .iter().map(|m| extract_fn_body(&whole, m).matches(".route(").count()).sum();
assert_eq!(whole.matches(".route(").count(), accounted,
    "a `.route(` call exists outside router_with_cors/family_routes/membership_routes");
```
and additionally extract `pub fn router(` and assert its body contains only the single
`router_with_cors(` call (no `.route`/`.nest`/`.merge`/`_service` forms). Keep or drop the
`let api =` counter as taste — with the file-wide scan it stops being load-bearing.

### WR-04: the zero-knowledge audit's needle list still does not match its own stated contract

**File:** `crates/pv-server/src/routes/mod.rs:779-808`

**Issue:** The WR-03 additions are all present and correct — `unwrap_user_key`, `wrap_user_key`,
`encrypt_item`, `decrypt_item`, `*_for_collection`, `wrap_identity_secret_key` are now bare-matched,
and the `sealed_key` false positive is still rejected. But the comment says *"Extend this list
whenever `pv-core` gains a new plaintext-handling `pub fn`"*, and the list already omits several that
exist today (`grep 'pub fn' crates/pv-core/src/`):

| Missing needle | Why it is a zero-knowledge violation if called server-side |
|---|---|
| `pv_core::totp::generate_code` (`totp.rs:36`) | requires the plaintext TOTP seed |
| `pv_core::kdf::derive_master_key` (`kdf.rs:27`) | requires the plaintext master password |
| `pv_core::kdf::wrapping_key_from_password` (`kdf.rs:50`) | same |
| `pv_core::prf::wrapping_key_from_prf` / `wrapping_key_from_ext_prf` (`prf.rs:24,42`) | requires the raw WebAuthn PRF output — CONTEXT.md's "server never sees PRF output" |
| `pv_core::keys::hkdf_expand_key` (`keys.rs:74`) | derives key material from an IKM the server must not hold |

`pv_core::keys::random_bytes` is correctly absent (it is legitimately server-side —
`auth.rs:123,202`), as is `auth_hash_from_password` (deliberate: the server compares stored hashes).
The audit reads as exhaustive and is cited as the permanent ZK boundary proof; today it is a
five-name subset of the real surface.

**Fix:** add the five names above to `bare_needles`, and convert the "extend this list" comment into
a mechanical check — e.g. a second test that greps `crates/pv-core/src/**.rs` for `pub fn` and asserts
every name is either in `bare_needles` or in a small, justified `SERVER_SAFE_PV_CORE_FNS` allowlist.
Without that, the list drifts silently the next time `pv-core` grows.

### WR-05: iteration-1 WR-04 remains unresolved — the deferral is defensible against Phase 22's success criteria, but it is now stranger than before

**File:** `crates/pv-server/src/routes/vault.rs:144-150` (with `routes/sync.rs::pull`)

**Assessment as requested — Phase 22 IS self-consistent without it.** I checked all six ROADMAP
success criteria: SC#1 (family + per-member breakdown), SC#2 (route sweep), SC#3 (#6269), SC#4
(revocation on next request), SC#5 (KEY-01 server half), SC#6 (KEY-02 fan-out, `enc_data` unchanged).
None requires reading a shared item's *ciphertext* back. SC#6's per-member fan-out is proven from
`collection_keys` rows and `GET /api/vault/collections/{id}`'s own `sealed_key`; SC#4 is proven
against the collection `GET`. So the deferral does not silently break a criterion, and Phase 23
(sync fan-out) is the right owner. The fixer's rationale stands on that point.

**But CR-01's fix changed the shape of the gap in a way worth recording.** `fetch_items_for` is still
`WHERE user_id = ?`, so an `item_shares` recipient can now do everything to an item *except read it*:

- `read` grant → the only exercisable capability is `POST .../touch`. That is the entire feature.
- `edit` grant → `DELETE /api/vault/items/{id}` succeeds (no revision needed) on an item the caller
  has never been able to fetch. `PUT` is effectively unusable (`expected_revision` is unknowable
  without a read path, short of guessing small integers), so the reachable capability set is
  "destroy, but not modify" — an odd and hazardous asymmetry to ship even temporarily.

**Fix:** keep the deferral, but record it as a Phase 23 input with the above capability profile
spelled out, and consider gating `create_share` to `read` only until the read path exists — an `edit`
share whose only working verb is `DELETE` has no legitimate use in v0.4.

### WR-06: an `edit` item-share recipient inherits full lifecycle control over someone else's personal item, with no test pinning the intended blast radius

**File:** `crates/pv-server/src/routes/vault.rs:563-566, 616-619, 452-456, 342-345`

**Issue:** Now that CR-01 made `item_shares` live on personal items, every handler gated by
`Membership<Item, RequireEdit>` admits an `edit`-level share recipient. On Anna's **personal** item
`I`, recipient R can therefore:

- `DELETE /api/vault/items/I` — permanently destroy Anna's own item (`vault.rs:342`);
- `POST /api/vault/items/I/shares` — re-share `I` to any other family member (`vault.rs:563`), with
  no owner consent and no record Anna can act on beyond `member_access`;
- `DELETE /api/vault/items/I/shares/{user_id}` — revoke *other* recipients' shares (`vault.rs:616`);
- `PUT /api/vault/items/I/collection` — move Anna's personal item into a collection R controls
  (`vault.rs:452`), re-encrypted under that collection's key.

Anna herself is unharmed on the access side (her `owner_access` is preserved on the personal branch —
correct), so this is a capability-scope question, not a lockout. It may well be the intended reading
of "edit"; the problem is that nothing says so and nothing tests it. Before this fix pass the grant
was inert, so the question never arose; it now ships live with the phase.

**Fix:** decide and pin it. Either restrict re-share/revoke-share to the item's `user_id`:

```rust
// vault.rs — create_share / revoke_share
if membership.caller_user_id != owner_of(&state.db, &membership.resource_id).await? {
    return Err(ApiError::Forbidden);
}
```
or document "edit == full lifecycle, including delegation" in `create_share`'s doc comment and add a
test asserting each of the four capabilities above, so a later phase cannot narrow it by accident.

## Info

Iteration-1 IN-01…IN-10 are carried forward unchanged and are not restated in full; each was verified
still present in this tree.

### IN-01 — `hidden_password` is an accidental-exposure guard only
`collections.rs:115-148` still returns the caller's own `sealed_key` at every level. Unchanged, and
correctly framed in `move_item`'s doc comment. Phase 26 UI copy must match.

### IN-02 — `combine_access` is additive-only
`membership.rs:134-148`. A per-item `hidden_password` share can never *restrict* a stronger
collection grant. Unchanged; document `item_shares` as additive-only before Phase 26 exposes it.

### IN-03 — three endpoints are user-existence / family-membership oracles
`identity.rs:163-169`, `collections.rs:207-224`, `vault.rs:573-587`. Unchanged.

### IN-04 — `families::create` does not bound `name`
`families.rs:44-47`. Still the only client-supplied string in the phase without `validate_blob_len`.

### IN-05 — `families::member_access` queries globally, not scoped to the caller's family
`families.rs:237-261`. Inert under FAM-01's singleton. Note the new second-order effect: the WR-07
join means this endpoint can now report a `collection_keys` row that the resolver would *reject* —
the FAM-03 breakdown and the resolver no longer agree in the (currently unreachable) removed-member
case. Add the `JOIN collections c ON c.id = ck.collection_id AND c.family_id = ?` before Phase 25.

### IN-06 — `vault_items.collection_id` has no `ON DELETE` action
`0014_family_sharing.sql:94`. Unchanged; Phase 25 must decide item disposition before writing a
delete-collection handler.

### IN-07 — unreachable `None` branches in `collections::get` / `CollectionResponse`
`collections.rs:46-56, 131-139`. Unchanged.

### IN-08 — `identity::upsert` provides no rotation path
`identity.rs:85-88`. Unchanged.

### IN-09 — `move_item` to `new_collection_id: null` bypasses the destination gate
`vault.rs:461-463`. Unchanged — and now load-bearing for CR-01's exfiltration step, so its severity
is contingent on CR-01's fix. Re-evaluate it once CR-01 lands.

### IN-10 — the parsed `AccessLevel` is discarded and the raw request string is bound to SQL
`collections.rs:205, 235`, `vault.rs:571, 598`. Unchanged.

### IN-11: handlers read `Path(id)` where `membership.resource_id` is already available

**File:** `crates/pv-server/src/routes/vault.rs:194, 253, 345` (contrast `:595`, `:622`)

`touch`/`update`/`delete` bind their SQL to the handler's own `Path<String>` while
`create_share`/`revoke_share` bind `membership.resource_id`. Both resolve to the same `{id}` capture
today, so there is no bug — but the extractor's value is the *authorized* one, and two sources for
one id is exactly the divergence `membership.rs`'s own module doc exists to prevent. Prefer
`membership.resource_id` uniformly; `touch` can then drop its `Path` extractor entirely.

### IN-12: `create_share` permits a self-share

**File:** `crates/pv-server/src/routes/vault.rs:563-606`

Nothing rejects `recipient_user_id == membership.caller_user_id`. The owner of a personal item can
insert an `item_shares` row addressed to themselves; it resolves harmlessly through `combine_access`
(already `Edit`), but it pollutes `families::member_access`'s FAM-03 breakdown with a self-referential
entry Phase 26 will have to render. One-line guard.

---

_Reviewed: 2026-07-30T11:40:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard — iteration 2 (fix verification)_
