---
phase: 23-sync-model-extension-shared-data-fan-out
reviewed: 2026-07-30T23:05:00Z
depth: standard
iteration: 3
files_reviewed: 30
files_reviewed_list:
  - crates/pv-server/migrations/0015_sync_shared_fanout.sql
  - crates/pv-server/migrations/0016_shared_direct_revision.sql
  - crates/pv-server/src/error.rs
  - crates/pv-server/src/routes/collections.rs
  - crates/pv-server/src/routes/mod.rs
  - crates/pv-server/src/routes/sync.rs
  - crates/pv-server/src/routes/vault.rs
  - crates/pv-server/tests/collections.rs
  - crates/pv-server/tests/membership_route_sweep.rs
  - crates/pv-server/tests/sync.rs
  - crates/pv-server/tests/sync_shared.rs
  - crates/pv-server/tests/vault.rs
  - packages/pv-ui/vault/types.ts
  - web/src/components/vault/DetailPanel.tsx
  - web/src/components/vault/DetailPanel.test.tsx
  - web/src/components/vault/ItemContextMenu.tsx
  - web/src/components/vault/ItemContextMenu.test.tsx
  - web/src/lib/auth/api.ts
  - web/src/lib/i18n/dictionary.ts
  - web/src/lib/vault/api.ts
  - web/src/lib/vault/store.ts
  - web/src/lib/vault/store.test.ts
  - web/src/lib/vault/sync.ts
  - web/src/lib/vault/sync.test.ts
  - web/e2e/fixtures.ts
  - web/e2e/smoke.spec.ts
  - web/e2e/shared-sync.spec.ts
  - web/e2e/global-teardown.ts
  - web/playwright.config.ts
  - .github/workflows/ci.yml
findings:
  critical: 0
  warning: 9
  info: 7
  total: 16
status: issues_found
---

# Phase 23: Code Review Report (iteration 3 — final pass)

**Reviewed:** 2026-07-30
**Depth:** standard
**Files Reviewed:** 30 (plus `routes/membership.rs`, `routes/families.rs`,
`components/vault/ItemForm.tsx`, `app/page.tsx`, `tests/common/mod.rs` read as
context)
**Status:** issues_found — **0 BLOCKER**, 9 WARNING, 7 INFO

## Summary

I re-verified the iteration-2 fix pass against the code, re-ran both suites
independently (`cargo test -p pv-server --tests` → 166 tests, all green;
`cd web && npx vitest run` → 56 files / 504 tests, all green), and traced the
paths the fix report claims to have closed.

**Headline: BL-01 is genuinely closed, on both halves, and the regression test
is real.** There are no blockers left. Everything below is recorded debt — nine
warnings, none of which is a live secret-exposure or authorization bypass, and
several of which are test-quality rather than behavior.

### BL-01 verdict: CLOSED (both halves)

- **Counter half.** `bump_direct_share_revision` is now unconditional
  (`vault.rs:1085`), placed after the `UPDATE` and **before** the
  `item_shares` `DELETE` — the ordering is required (the bump's subquery reads
  the rows the delete removes) and it is correct as written.
- **Invariant half.** `move_item` deletes `item_shares` when the destination is
  a collection (`vault.rs:1086-1100`). I grep-verified there are exactly two
  production writers that can put the system into the forbidden
  "collection-scoped item carrying a direct grant" state:
  `create_share`'s `INSERT` (guarded, now re-read inside its own tx) and
  `move_item`'s `UPDATE ... SET collection_id` (now followed by the DELETE).
  `membership.rs`'s three `INSERT INTO item_shares` are inside `#[cfg(test)]`.
  The invariant now holds regardless of which endpoint moves the item.
- **Concurrency.** A `create_share` racing a `move_item` into a collection
  cannot slip the forbidden row through: `move_item` opens `BEGIN IMMEDIATE`
  and holds the write lock, so `create_share`'s later `INSERT` fails rather
  than committing (see WR-04 — the invariant is preserved by failing, not by
  corrupting, but the failure mode is a 500).
- **The regression test is discriminating.**
  `share_then_move_into_collection_bumps_recipients_direct_revision_and_revokes_their_access`
  (`sync_shared.rs:975-1114`) replays the exact sequence and would fail against
  pre-fix code on **two** independent assertions: `assert_ne!` on the
  recipient's `direct.revision` (pre-fix: unchanged), and the post-move
  `PUT`/`DELETE` returning `404` (pre-fix: `200`/`204` via the surviving
  `item_shares` row). It also proves the grant was live before the move. This
  is a good test.

**On the choice to delete rather than reject:** deleting is defensible — it
enforces the invariant at the state transition instead of leaving a
writable-but-unreadable grant — but it is a *destructive, irreversible, silent*
product decision made inside a code-review fix pass. See WR-01. Does the
recipient learn? Server-side, yes, weakly: their `shared_direct_revision` moves,
so their next `/api/sync/shared/direct` returns a list without the item. But no
client consumes that endpoint yet (WR-07's own fix now skips the call entirely),
and they additionally get a final `Item`-typed WS frame for an item they can no
longer read (WR-02).

### The self-caught deadlock / TOCTOU re-order: PARTIALLY closed

The re-order is sound for what it covers. `current_collection` and
`owner_user_id` — the two values that actually decide which collection revision
is bumped and which member sets are notified — are now re-read on the
transaction's own connection (`vault.rs:961-973`) with Gate 0's ownership rule
re-validated against that fresher read. The pre-tx read at `vault.rs:911-923` is
demoted to a fast-fail precheck and correctly renamed (`precheck_*`), so no
stale value survives into the mutation's decisions. The `max_connections(1)`
constraint is real (`tests/common/mod.rs`) and correctly documented inline.

**But it left one gate in exactly the shape it was meant to eliminate:**
Gate 2, the destination-collection *authorization* check (`vault.rs:938-940`),
still runs `require_collection_edit(&state.db, ...)` on a pool connection, and
the mutation happens in a transaction opened afterwards. That is "authorize on
pool state, mutate on transaction state" — WR-03 below. It is narrow (requires a
concurrent `revoke_access` in a millisecond window) and it is not a privilege
escalation, but it is the same class the fix pass claims to have closed, and the
fix report does not disclose it.

### WR-05's deferred-with-documentation call: ACCEPTABLE, with one omission

The documentation is honest and load-bearing, not a comment papering over a
contradiction: `sync.rs:347-368` states plainly that a membership-change event's
`revision` is unbumped, forbids clients from gating a re-fetch on it, and names a
concrete remedy — `GET /api/vault/collections/{id}/access`, which I verified
actually exists (`routes/mod.rs:191`). Both call sites cross-reference it.
`resolve_collection_recipients` was genuinely deleted and both handlers now call
the one `resolve_collection_members` (whose `family_members` join matches
`Collection::resolve_access`), and `add_member`'s own recipient guard is
family-scoped (`collections.rs:222-231`), so a just-added member is still inside
their own event's audience. That is a real dedupe, not a rename.

The omission: the documented rule only works for a client with a live socket.
Nothing in the *polling* path can observe a membership change at all (WR-08),
and the revoked member observes nothing whatsoever (WR-07).

### Six hard invariants — all six hold

| Invariant | Status | Evidence |
|---|---|---|
| 1. `GET /api/sync` scope not widened | HOLDS | `fetch_items_for` (`vault.rs:367-390`) untouched since the review baseline; arm 1 `WHERE user_id = ? AND collection_id IS NULL`, arm 2's three membership JOINs byte-identical; only non-filtering columns + a `LEFT JOIN users` added |
| 2/3. Fan-out audience == membership | HOLDS, with one edge | `resolve_recipients`/`resolve_collection_members` split intact; `collections.rs` now shares the latter. Edge: `move_item`'s audience is resolved before the same-tx `item_shares` DELETE — WR-02 |
| 4. `SyncEvent` shape | HOLDS | exactly four fields (`sync.rs:401-406`) |
| 5. bump + mutation in one tx | HOLDS | every `bump_*` inside `tx`; every `publish*` strictly after `tx.commit()` in `move_item`, `create_share`, `revoke_share`, `add_member`, `revoke_access` |
| 6. `enc_data` bind position | HOLDS | `move_item`'s SET list is `collection_id, enc_key, enc_data, revision, updated_at, last_editor_user_id`, binds in that order then the WHERE binds (`vault.rs:981-993`) |
| 404-not-403 for non-membership | HOLDS | `membership.rs` untouched; `shared_collection_pull_rejects_non_member_with_404_never_403` green |

---

## Narrative Findings (AI reviewer)

## Critical Issues

None. No finding in this pass causes an incorrect access-control decision,
exposes plaintext the affected party did not already hold, or loses vault data.

## Warnings

### WR-01: `move_item` silently and irreversibly destroys the owner's direct shares, with no API signal and no decision record outside the fix report

**File:** `crates/pv-server/src/routes/vault.rs:1086-1100`

**Issue:** `DELETE FROM item_shares WHERE item_id = ?` runs unconditionally on a
move into a collection. The rows destroyed contain `sealed_key` — an item key
sealed to the recipient's identity public key, which the server cannot
reconstruct. The consequences the code does not acknowledge:

- The owner gets no indication. `MoveItemResponse` is
  `{revision, collection_id, updated_at}` — no revoked-share count, no warning,
  nothing a UI could confirm against. An owner who shares a login with their
  partner and later drags it into a "Household" collection silently revokes the
  partner, with no prompt and no undo.
- It is not reversible by moving the item back: the sealed keys are gone, and
  re-sharing requires the client to re-seal (a Phase 26 UI that does not exist).
- The alternative — reject the move with `409`/`400` ("revoke the direct shares
  first") — is *also* invariant-preserving, fails closed, and is
  non-destructive. Nothing in `23-CONTEXT.md` or any `23-0x-PLAN.md` chooses
  between the two; the choice was made inside a review-fix pass and is
  documented only in `23-REVIEW-FIX.md`.
- No test asserts the owner learns anything. The regression test asserts only
  the recipient's loss.

**Fix:** either fail closed —

```rust
if req.new_collection_id.is_some() {
    let has_direct: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM item_shares WHERE item_id = ? LIMIT 1")
        .bind(&id).fetch_optional(&mut *tx).await?;
    if has_direct.is_some() {
        return Err(ApiError::Conflict(
            "revoke this item's direct shares before moving it into a collection".into()));
    }
}
```

— or keep the delete and make it visible: return the revoked recipient ids in
`MoveItemResponse`, and record the choice in the phase's decision log so Phase
26's sharing UI can warn before issuing the move.

### WR-02: the just-revoked direct-share recipient still receives one `EntityType::Item` frame naming the item and its post-move revision

**File:** `crates/pv-server/src/routes/vault.rs:1048-1051`, `1168-1182`

**Issue:** `all_recipients` is built from `source_recipients`, resolved at
`vault.rs:1024` — *before* the same transaction's `item_shares` DELETE at line
1099. On a personal→collection move the publish at line 1168 takes the `else`
branch and sends an `Item`-typed event to
`all_recipients \ collection_member_union`, which is exactly the set of
direct-share recipients whose grant was just destroyed. They learn the item's
new `revision` for an item that, at emit time, they can no longer resolve any
access to — not via `fetch_items_for` (never returned it to them), not via
`pull_shared_direct` (now filtered out by `collection_id IS NULL`), not via
`pull_shared_collection` (404).

This contradicts the phase's own "membership resolved fresh at emit time"
constraint, which `resolve_recipients`' doc comment (`vault.rs:88-92`) gives as
the reason the query must live inside the transaction. Here the query *is*
inside the transaction — it just runs before the mutation that changes its
answer. Impact is bounded (they already knew the item id and its prior
revision), which is why this is a warning and not a blocker.

**Fix:** re-resolve after the DELETE and use that set for the *event* audience
only (the bump audience must stay the pre-delete set, so the losing recipients
still get told to re-pull):

```rust
// after the DELETE, before the publish block:
let event_recipients =
    resolve_recipients(&mut *tx, &id, req.new_collection_id.as_deref(), &owner_user_id).await?;
```

### WR-03: Gate 2 (destination authorization) still authorizes on the pool and mutates in the transaction

**File:** `crates/pv-server/src/routes/vault.rs:938-940` vs `959`

**Issue:** The iteration-2 fix moved the *source* read into `tx` and documented
why Gate 2 must release its pool connection first (the `max_connections(1)`
harness). Correct as far as it goes — but the consequence is that the one
genuinely security-relevant check in this handler ("may the caller write into
the destination collection") is decided against a snapshot the mutation never
re-validates. A concurrent `DELETE /api/vault/collections/{C}/access/{caller}`
landing between line 940 and line 959 lets the caller push an item into a
collection they no longer hold edit on. The `expected_revision` guard does not
narrow this one — a revoke does not touch `vault_items.revision`.

The fix report's WR-03 entry claims the "read at a different point in time than
the mutation" gap was closed; it was closed for the source values only. This is
the same shape as the finding it claims to fix.

**Fix:** re-run the destination authorization inside `tx`, after the pool-scoped
copy (the pool connection is released by then, so the documented deadlock
constraint is satisfied):

```rust
let mut tx = state.db.begin_with("BEGIN IMMEDIATE").await?;
if let Some(dest_id) = &req.new_collection_id {
    require_collection_edit_tx(&mut *tx, &source.caller_user_id, dest_id).await?;
}
```

(needs a `&mut SqliteConnection`-taking twin of `require_collection_edit` — the
same split `resolve_recipients` already uses.)

### WR-04: WR-04's own fix made `create_share` a read-then-write **deferred** transaction — the shape this file documents as `SQLITE_BUSY_SNAPSHOT`-prone

**File:** `crates/pv-server/src/routes/vault.rs:1237-1285`

**Issue:** Moving the three guard reads inside `tx` was right for the TOCTOU,
but `create_share` opens `state.db.begin()` (a deferred `BEGIN`) and its first
three statements are now `SELECT`s, with the `INSERT` after them. `delete()`'s
own comment at `vault.rs:686-700` documents precisely this hazard: under WAL, a
deferred transaction that reads first and writes later is rejected with
`SQLITE_BUSY_SNAPSHOT` when another writer commits in between, SQLite does
**not** invoke the busy handler for that case, so `lib.rs`'s 5 s `busy_timeout`
gives no protection and the request fails outright with a 500. `delete()` and
`move_item` both use `begin_with("BEGIN IMMEDIATE")` for exactly this reason;
`create_share` now needs it and does not have it. Correctness is preserved (the
transaction aborts rather than inserting a forbidden row) — this is an
availability/UX regression, and it is most likely to fire in exactly the race
WR-04 was introduced for (a concurrent `move_item`, which holds an IMMEDIATE
write lock).

**Fix:** `let mut tx = state.db.begin_with("BEGIN IMMEDIATE").await?;` in
`create_share`, matching the two precedents in the same file.

### WR-05: the new `create_share` guard test cannot fail — it is satisfied by a different 400

**File:** `crates/pv-server/tests/sync_shared.rs:1128-1152`

**Issue:** `create_share_on_collection_scoped_item_is_bad_request` uses an
outsider created by `register_and_login` (`tests/common/mod.rs:87`), which
registers and logs in but never joins a family. `create_share` returns
`ApiError::BadRequest` for the collection-scoped guard (`vault.rs:1247-1251`)
**and** for "recipient is not a family member" (`vault.rs:1253-1259`); the test
asserts only `StatusCode::BAD_REQUEST` and never inspects the message. Delete
the WR-10 guard entirely and this test still passes. The fix report presents it
as closing the review's "WR-10's guard has zero test coverage" gap; the gap is
still open.

**Fix:** use a recipient who passes every *other* guard, so only the
collection-scoped check can produce the 400 — and assert the message:

```rust
let fixture = setup_shared_fixture(pool).await;      // fixture.item_id IS collection-scoped
let member_id = user_id_of(&fixture.app, &fixture.member_token).await; // family member + keypair
// ... POST /api/vault/items/{item_id}/shares with member_id
assert_eq!(res.status(), StatusCode::BAD_REQUEST);
assert!(body_json(res).await["error"].as_str().unwrap().contains("collection-scoped"));
```

### WR-06: WR-01's bounded-retry behaviour change is entirely untested, and the existing test's name now overstates the guarantee

**File:** `web/src/lib/vault/store.ts:308-316`, `web/src/lib/vault/store.test.ts:466`

**Issue:** `applySyncSnapshot` now advances `lastKnownRevision` after
`MAX_FAILED_MERGE_RETRIES` (3) consecutive failing merges. Nothing asserts it —
`store.test.ts` has no test that drives three merges, and the fix report's own
verification note concedes no new `store.test.ts` cases were added. The suite's
existing guard, `"does NOT advance the revision watermark when any row fails to
decrypt"` (line 466), passes only because it performs a *single* merge; its name
now describes a guarantee the code deliberately no longer makes. A future change
to the constant, to the reset points, or to the `>=` boundary is unprotected —
and this is the sync loop's termination condition.

**Fix:** add two cases — (a) three consecutive failing merges leave the
watermark advanced on the third while the row stays flagged `undecryptable`;
(b) a clean merge between two failures resets the counter so the budget starts
over. Rename the line-466 test to name the bound it actually proves.

### WR-07: `revoke_access` moves no counter the revoked member can observe — their client keeps listing collection items until an unrelated bump

**File:** `crates/pv-server/src/routes/collections.rs:347-411`

**Issue:** Revocation deletes the `collection_keys` row and publishes a
`Collection` event to the *remaining* members. The revoked member is
deliberately not published to (`collections.rs:385-390`, a defensible call) —
but nothing bumps their `users.vault_revision` either. Their client's only
polling signal is `GET /api/sync?since=N`, which compares exactly that counter,
so it answers `UpToDate` indefinitely. `fetch_items_for`'s arm 2 has stopped
returning the collection's rows to them, but they never re-pull to find out.
Their vault view keeps listing (and their store keeps holding decrypted) the
collection items **they authored** until some unrelated mutation of theirs
happens to bump the counter.

Severity honestly scoped: this is *not* a secret exposure. `fetch_items_for`
arm 2 is `WHERE i.user_id = ?`, so the only stale rows retained are ones the
revoked member created themselves, and no post-revocation ciphertext ever
reaches them. It is a correctness/expectation failure — an owner who revokes
believes the revocation is observable, and it is not — of the same structural
class as CR-02 (a set changed; no counter moved), which this phase otherwise
fixed everywhere else.

**Fix:** one line inside the existing transaction, leaking nothing beyond "your
snapshot changed":

```rust
bump_recipients_vault_revision(&mut tx, std::slice::from_ref(&target_user_id)).await?;
```

### WR-08: WR-05's documented deferral covers the WS-connected client only; a client that misses the frame has no recovery, and the doc does not say so

**File:** `crates/pv-server/src/routes/sync.rs:347-368`

**Issue:** The contract now reads "treat receipt of ANY `Collection`-typed event
as an unconditional re-fetch trigger." That is correct and sufficient *while the
socket is up*. There is no replay: `SyncHub` is an in-process
`tokio::sync::broadcast` with no persistence, and the only polling fallback
(`web/src/lib/vault/sync.ts`'s 30 s tick) hits `GET /api/sync`, whose counter a
membership change does not move either (WR-07). A client that is offline,
reconnecting, or simply started after the change learns nothing — the
`collections.revision` cheap-check keeps answering `UpToDate`. The documented
rule therefore describes a contract with no durable half, and the doc comment
does not disclose that limitation.

**Fix:** either bump `collections.revision` on a membership change (and update
the ~4 asserting fixtures — the honest resolution), or add the sentence the
contract is missing: "a client that misses this frame has no polling-observable
signal until Phase 25; it MUST re-fetch access state on every reconnect." The
second is a one-line doc change and makes the deferral complete rather than
half-stated.

### WR-09: the Playwright global teardown `rm -rf`s whatever directory `PV_E2E_DB_DIR` names, including one the developer set

**File:** `web/e2e/global-teardown.ts:11-20`, `web/playwright.config.ts:50-51`

**Issue:** The config reads `process.env.PV_E2E_DB_DIR ?? fs.mkdtempSync(...)`,
so an externally-set value wins; the teardown then unconditionally
`fs.rmSync(dbDir, { recursive: true, force: true })`. A developer who exports
`PV_E2E_DB_DIR` to point at a directory they want to keep (a persistent test DB,
or — with a typo — anything else) has it recursively deleted at the end of the
run, with `force: true` suppressing every error that would otherwise warn them.
The variable is documented as internal; nothing enforces that.

**Fix:** only delete what this run minted:

```ts
// playwright.config.ts
const mintedHere = process.env.PV_E2E_DB_DIR === undefined;
const dbDir = process.env.PV_E2E_DB_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "pv-e2e-db-"));
process.env.PV_E2E_DB_DIR = dbDir;
if (mintedHere) process.env.PV_E2E_DB_DIR_OWNED = "1";

// global-teardown.ts
if (process.env.PV_E2E_DB_DIR_OWNED !== "1") return;
```

## Info

### IN-01: `updateVaultItem`'s `UndecryptableItemError` guard is still untested

**File:** `web/src/lib/vault/store.ts:387-389`

Carried from iteration 2 (IN-07), unchanged. `store.test.ts` covers the merge
side of CR-03 thoroughly but never asserts that a save over a flagged item
throws. With WR-02's UI fix landed, this throw is both the last line of defense
and the thing the new `item-save-error-banner` renders for — one short test
would cover both.

### IN-02: `Folder.undecryptable` is written and never read

**File:** `packages/pv-ui/vault/types.ts:171`, `web/src/lib/vault/store.ts:282-287`

Carried from iteration 2 (IN-05). Grep-confirmed: the only readers of
`undecryptable` are `DetailPanel.tsx:273/316` and `ItemContextMenu.tsx:170`,
both on `VaultItem`. A folder whose name fails to decrypt renders its stale name
in the sidebar with no indication. Either surface it or drop the field.

### IN-03: `move_item`'s four `.expect()` calls panic the request task

**File:** `crates/pv-server/src/routes/vault.rs:1138`, `1142`, `1149`, `1153`

Carried from iteration 2 (IN-06). Structurally unreachable (each `Option` is
matched on the condition that produced it), but a panic in an axum handler drops
the connection instead of returning a 500, and the invariant is spread across
four separated `match` expressions. Pairing `(collection_id, revision, members)`
in one struct would make it type-enforced.

### IN-04: `failedMergeAttempts`' own comment describes a reset that is not where it says

**File:** `web/src/lib/vault/store.ts:209-211` vs `512-531`

The comment says the counter is reset "on every `startSync()` (unlock) — see
`syncCallbacks`'s own reset". `syncCallbacks` (lines 512-515) contains no reset;
the actual reset is in the **lock** branch (line 524). Behaviourally equivalent
(a lock always precedes the next unlock, and the module initialises to 0), but
the comment sends a future reader to the wrong place.

### IN-05: a same-collection `move_item` double-bumps that collection and emits two events

**File:** `crates/pv-server/src/routes/vault.rs:1102-1109`, `1136-1157`

When `req.new_collection_id == current_collection`, `bump_collection_revision`
runs twice (revision +2) and two `Collection` events are published to the same
audience, the first carrying an already-superseded revision. Harmless for a
client following the "any Collection event = re-fetch" rule, but it is
observable noise and one
`if req.new_collection_id.as_deref() != current_collection.as_deref()` away.

### IN-06: `shared-sync.spec.ts`'s fan-out comments still describe `direct.revision` as the item's revision

**File:** `web/e2e/shared-sync.spec.ts:254-257`, `274-277`

Carried from iteration 2 (IN-03), unchanged. The assertions (1 then 2) are
correct, but for a different reason than the comments claim: post-CR-02 that
field is `users.shared_direct_revision`, a per-recipient event counter. It reads
1/2 here only because B is a fresh account bumped exactly once by `create_share`
and once by A's edit. A second shared item would make the two quantities diverge
and the comment actively wrong.

### IN-07: iteration 2's remaining test-coverage gaps are all still open

Carried verbatim; none were in the iteration-3 fix scope:
- **IN-01 (iter 2):** the CR-01 regression test's zero-WS-frames half has no
  liveness proof, unlike its sibling at `sync_shared.rs:760`; only the
  `vault_revision` assertion discriminates.
- **IN-02 (iter 2):** no test for an `item_shares` recipient receiving an
  `Item`- rather than `Collection`-typed event, nor for `move_item`'s
  destination side with a non-member owner.
- **IN-04 (iter 2):** no test (not even a `test.fixme` placeholder) for a shared
  conflict whose write *is* decryptable by the other party — architecturally
  impossible to fixture before Phase 26/27, and therefore worth marking as a
  known gap rather than leaving it looking covered.

---

## Ship judgement

**Safe to ship as recorded debt.** No blocker remains; BL-01 is genuinely and
verifiably closed, and all six hard invariants hold.

The two findings a human should weigh before merging are **WR-01** (an owner's
direct shares are destroyed silently on a move — a product decision that
deserves an explicit sign-off rather than being a fix-pass side effect) and
**WR-07** (revocation is not observable by the revoked party through any polling
path). Neither leaks plaintext the affected party did not already hold.
**WR-04** is the cheapest real fix here — one `begin_with("BEGIN IMMEDIATE")` —
and it prevents a 500 in exactly the race the iteration-2 fix was written for.
**WR-05** and **WR-06** are the two places where the fix pass's test evidence
does not support its claim; neither finding should be recorded as closed until
those tests actually discriminate.

---

_Reviewed: 2026-07-30_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Iteration: 3 (final — verification of the 9-finding iteration-2 fix pass)_
