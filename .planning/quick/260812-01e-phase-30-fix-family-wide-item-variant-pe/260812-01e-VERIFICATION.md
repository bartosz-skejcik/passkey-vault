---
quick_id: 260812-01e
verified: 2026-08-12T02:04:27Z
head: 0c67a66519afcb6a8576f6fe69c46fe727e02c56
range_verified: 3219b16..0c67a66 (28 commits — 8 plan tasks, then 15 code-review fixes + 5 docs)
status: human_needed
score: 5/5 must-have truths verified
behavior_unverified: 0
overrides_applied: 0
ci_width_commands:
  - command: "cargo test --workspace --no-fail-fast"
    exit: 0
    result: "31 test-result blocks, 376 passed, 0 failed"
  - command: "cd web && npm run compile"
    exit: 0
    result: "tsc --noEmit, 0 errors"
  - command: "cd web && npm test"
    exit: 0
    result: "92 files / 975 tests passed"
  - command: "cd web && npm run build"
    exit: 0
    result: "next build succeeded (Compiled successfully in 1632ms)"
  - command: "cd web && npx playwright test e2e/family-wide-sharing.spec.ts --retries=0"
    exit: 0
    result: "10 passed (1.1m), fresh build of this HEAD, port 8620 free, throwaway PV_E2E_DB_DIR, data/pv.db SHA-256 identical before and after (8e043c9d…b997c8)"
falsifications_performed_by_verifier: 11
gaps: []
human_verification:
  - test: "Decide whether Task 7's disclosure copy must also name DELETION, not only editing. HI-03's destruction half was assessed and deliberately left open (a self-escalated contributor may DELETE any other member's item in the bucket); `share.familyWideItemContributorEditNote` says only \"pełna edycja\" / \"full editor\"."
    expected: "Either a recorded decision that \"full editor\" is understood to include deletion in this product's model (and the note stays as-is), or a one-clause copy addition in both locales."
    why_human: "LOCKED decision 1 says 'if any UI copy would now be false, fix the copy'. Whether 'full editor' is false-by-omission about deletion is a product/UX judgement about what a Polish- or English-reading user infers, not something the code can answer."
  - test: "Accept-or-close the HI-02 residual: a LEGACY NULL-level `item_bucket` row now fails closed at all three propagation sites, which permanently blocks invite generation for anyone holding a key on it (WINDOWS #17's exact shape, deliberately re-admitted for this one row type). Detection query: `SELECT id, family_id FROM collections WHERE family_wide_kind = 'item_bucket' AND family_wide_access_level IS NULL;`"
    expected: "Either a recorded 'unreachable, accept' (no released build can hold such a row — see the reachability analysis below) or a small backfill migration."
    why_human: "Requires knowing what was ever deployed to vault.blonie.cloud and to local dev DBs between migrations 0019 and 0020 — repository state cannot answer it."
---

# Quick Task 260812-01e Verification — the family-wide ITEM variant

**Verified:** 2026-08-12T02:04:27Z at HEAD `0c67a66`
**Range:** `3219b16..0c67a66`
**Status:** human_needed — **all five must-have truths VERIFIED**, zero gaps, two product/deployment judgement calls recorded below.

Nothing in the SUMMARY or the REVIEW's Fix Disposition was taken on trust. Every command below was re-run by me, and every guard was independently falsified by me with my own reverts, restored, and the tree verified byte-identical afterwards (`git status --short` shows the same untracked-only list it showed at the start; `git diff HEAD` is empty).

---

## The five CI-width commands, re-run by me

| # | Command | Exit | Result |
|---|---------|------|--------|
| 1 | `cargo test --workspace --no-fail-fast` | **0** | 31 test-result blocks, **376 passed, 0 failed** |
| 2 | `cd web && npm run compile` | **0** | `tsc --noEmit`, 0 errors |
| 3 | `cd web && npm test` | **0** | **92 files / 975 tests passed** |
| 4 | `cd web && npm run build` | **0** | `next build` succeeded |
| 5 | `cd web && npx playwright test e2e/family-wide-sharing.spec.ts --retries=0` | **0** | **10 passed (1.1m)** |

Live-run hygiene: `playwright.config.ts` rebuilt `cargo build --release -p pv-server` **and** `next build` from this HEAD immediately before the run; port 8620 confirmed free beforehand; the suite mints its own throwaway `PV_E2E_DB_DIR` under `os.tmpdir()`; `data/pv.db`'s SHA-256 is `8e043c9dcbf46bccc534451acc8b4b575007242c0042589df8a96f3b4ab997c8` both before and after every run in this session.

---

## Observable truths (the plan's `must_haves.truths`)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A non-creator holding only `read` (or `hidden_password`) on a family-wide item_bucket can share their own item into it — no 403 | ✓ VERIFIED | Server: `task1_…` and `task4_non_creator_…`. **My falsification:** disabled `move_item` Gate 2's item_bucket branch (one condition) → *both* went red at exactly VERIFICATION.md's original probe values (`left: 403 / right: 200`). Restored, green. Live: e2e step 2 — the member (non-creator, `read`) shares item Y and the dialog cleanly detaches with neither `share-error` nor `share-partial-error`. |
| 2 | A second family-wide item share at a DIFFERENT level resolves/creates a SEPARATE bucket with its own correctly-persisted `family_wide_access_level` | ✓ VERIFIED (guard-strength caveat, W1) | Live and positive at this HEAD: item Z's `collection_id` ≠ item X/Y's, and `GET /api/vault/collections/{id}` returns exactly `"read"` for one and `"edit"` for the other. Server: `task4_face2_…`, `tests/collections.rs`'s renamed test. Client: 1 sole-guard unit test, falsified by me (below). |
| 3 | The contributor-edit asymmetry is real, BOUNDED (cannot revoke another member; cannot hand anyone more than the bucket's declared level), and honestly disclosed | ✓ VERIFIED (two residuals, W2/W3) | All four bounds independently falsified by me — see the falsification table. Copy carries all three required facts in PL **and** EN, pinned in the live test against a hardcoded literal from the *strengthened* clause. |
| 4 | LOCKED decision 2 untouched byte-for-byte | ✓ VERIFIED | Real extraction-and-diff, not a grep that can pass vacuously — see below. |
| 5 | Recipient-side, live, real crypto: a non-creator's family-wide item share at a non-edit level decrypts to real name and password on **another real account's** client | ✓ VERIFIED | e2e step 3: the OWNER's own page opens the member's item Y, the row carries the real decrypted name, and `reveal-password` shows the real password. Recipient identity independently confirmed (below). |

**Score: 5/5.**

---

## Falsifications I performed myself

Each is a single, minimal revert of production code, one named test, restore, checksum-verified.

| # | Guard reverted | Test run | Observed |
|---|---|---|---|
| F1 | Re-added the pre-HI-01 pool-bound (autocommit) claim before the tx | `hi01_escalation_claim_is_atomic_with_the_move` | RED — `assertion left == right failed: HI-01: the claim must NOT persist when the move itself fails on stale revision / left: "edit" / right: "read"` |
| F2 | `move_item` Gate 1 (HI-03 laundering) disabled | `hi03_…_cannot_launder_…` | RED — `left: 200 / right: 403` |
| F3 | CR-01's explicit collection-scope bound removed (`invitations.rs`) | `cr01_self_escalated_owner_cannot_bypass_declared_level_via_explicit_collection_scope` | RED — `left: 201 / right: 403` |
| F4 | HI-02 fail-closed on legacy NULL-level item_bucket removed | `hi02_legacy_null_level_item_bucket_invite_fold_in_is_refused` | RED — `left: 201 / right: 403` |
| F5 | HI-02's refusal over-broadened to legacy FOLDERS too | `task2_legacy_null_level_family_wide_folder_invite_fold_in_still_succeeds` | RED — `left: 403 / right: 201` (the item_bucket-only scoping is genuinely load-bearing, not incidental) |
| F6 | The shared `Declared` equality bound removed (one helper, all three sites) | `task2_self_escalated*` | 2 RED (`add_member` and the invite fold-in, both `left: 201 / right: 403`), 1 unaffected — proves the bound is wired into each site independently |
| F7 | `revoke_access`'s item_bucket refusal disabled | `task2_self_escalated_contributor_cannot_revoke_the_creator` | RED — `left: 204 / right: 403` |
| F8 | `move_item` Gate 2's item_bucket branch disabled | `task1_…` | RED — `left: 403 / right: 200` |
| F9 | same revert | `task4_non_creator_…hidden_password…` | RED — `left: 403 / right: 200` |
| F10 | Migration 0021 restored to the old single-column index | `task4_face2_…` | RED, **but at line 2979** (`creating the SECOND item_bucket … must succeed`, `left: 409 / right: 201`) — *never* at the test's own Face-2 discriminator |
| F11 | `familyItemBucketRow`'s level filter removed, full rebuild, **full spec file**, live | `npx playwright test e2e/family-wide-sharing.spec.ts --retries=0` | RED, 9 passed / 1 failed — `TimeoutError: locator.waitFor … waiting for getByTestId('share-dialog') to be detached … at shareItemFamilyWide (…:1667:44) / at …:1825:5`. **Never reaches** the distinct-collection-id assertion at ~:1861 |
| F12 | `familyItemBucketRow`'s level filter removed (unit layer) | `vitest run ShareDialog.test.tsx` | RED — **exactly 1 of 53** — `does NOT reuse an existing bucket declared at a DIFFERENT level … AssertionError: expected "spy" to be called 1 times, but got 0 times` |
| F13 | `grantCollectionToRecipients`'s 409 verification reverted to unconditional-success | `vitest run ShareDialog.test.tsx` | RED — **exactly 3 of 53**, all three Face-2-defense tests including the ME-02 hidden_password one |

All reverts restored; `shasum -a 256` matched the pre-probe value for every touched file; `git status --short` and `git diff HEAD` confirm the tree is exactly as found.

---

## W1 — ME-01: what Face 2's live discriminator actually discriminates

The brief was right to be suspicious of "three simultaneous reverts", and the answer is more interesting than either the SUMMARY or the REVIEW records.

**There is no single-revert falsification of Face 2's discriminating assertion at *either* the server or the live layer.** I proved both directly:

- Server (`task4_face2_…`): the strongest available single production revert — restoring migration 0021's old single-column index — fails at line **2979** (`creating the SECOND item_bucket … must succeed`), not at the level-comparison assertions at 3018–3035. No other production revert touches that test at all: it grants each bucket exactly its own declared level, so Task 2's bound is a no-op for it. Its final assertion is near-structural (two distinct collections trivially resolve distinct `collection_keys` rows) and is best read as a backstop, not an instrument. The genuinely falsifiable content of that test is its *creation* assertion, which duplicates `tests/collections.rs`.
- Live (F11): reverting only the level filter fails at `shareItemFamilyWide(…, itemZId, "edit")` — the dialog never detaches — at spec line 1825. The distinct-collection-id assertion is never evaluated.

So the fixer's account is accurate, and the live discriminator is weaker as an instrument than "genuinely falsified" implies.

**But both reports also understate the other side.** Face 2's *actual two halves* are each single-revert falsifiable, with tightly pinned sole-guard tests:

- Half 1 (level-ignoring resolution): F12 — reverting the level filter turns exactly **1 of 53** ShareDialog tests red.
- Half 2 (409 swallowed as success): F13 — reverting the 409 verification turns exactly **3 of 53** red.

And a third, *server-side* defense now makes Face 2's original signature — "silently reports success while delivering the wrong level" — structurally unreachable: `enforce_item_bucket_declared_level_bound` refuses a mismatched grant at all three propagation surfaces (F3/F6), converting a silent wrong-level delivery into a loud, user-visible failure. That is why the live discriminator can only be reached with all three disabled.

**Verdict on Face 2:** the truth is VERIFIED — asserted positively, live, at this HEAD. Its *guarding* is genuinely three-deep and each layer is individually falsifiable. What is not true is the framing that the live distinct-bucket assertion is a pinned instrument for Face 2; it is a backstop that only speaks when three defenses regress together. Recorded as a Warning, not a gap. Note also that the two single-revert-falsifiable guards are mocked-crypto unit tests — fine as *regression guards* for resolution logic, but under this project's standing rule they are not the evidence for the access-control claim; the live positive assertion and the server-side bound are.

---

## HI-01 — atomicity, and the pool-ordering constraint

Re-checked against `vault.rs`'s documented Gate 2 constraint, not against the report:

- `is_item_bucket_collection` (`:1025`) and `require_item_bucket_edit_access` (`:1026`) are the only pre-tx calls; both take `&state.db`, run sequentially, release their connection, and complete before `state.db.begin_with("BEGIN IMMEDIATE")` at `:1053`. No second connection is ever requested while the tx is open.
- The claim itself (`claim_item_bucket_edit_in_tx`, `:1119`) runs on `&mut *tx` — the transaction's own connection — strictly after the move's `UPDATE vault_items` has matched a row (`:1090`'s `None` arm already returned). No `max_connections(1)` self-deadlock is possible by construction, and 376 tests pass against a `max_connections(1)` harness (`tests/common/mod.rs:21`).
- I drove the failing move myself, exactly as asked: `hi01_escalation_claim_is_atomic_with_the_move` sends `expected_revision: 999` → `409`, then reads `collection_keys.access_level` directly and asserts `"read"`. Under F1 (pre-tx claim re-introduced) that assertion goes red with `left: "edit" / right: "read"`. It also covers the oversized-blob 400 path, and a third correctly-formed attempt that *does* claim edit — so the fix does not simply break the working case.
- ME-04 is genuinely structural, not call-site-dependent: the `item_bucket` predicate lives inside the `UPDATE`'s own `WHERE … AND EXISTS (SELECT 1 FROM collections … AND family_wide_kind = 'item_bucket')`.

---

## CR-01 — every path that can write a `collection_keys` row

I enumerated all of them rather than checking the three the report names. `grep`ed every mutating statement against `collection_keys` in `crates/pv-server/src/` and cross-checked the route table in `routes/mod.rs`.

| # | Writer | Effect | Bound? |
|---|--------|--------|--------|
| 1 | `collections::create` (`:290`) | inserts the CREATOR's own row, hard-coded `'edit'` | Self only. LOCKED decision 1's own basis; per-(family, level) uniqueness caps it at 3 buckets |
| 2 | `collections::add_member` (via `insert_collection_key`, `:631`) | grants another member | ✓ `may_grant_access_level` + `enforce_item_bucket_declared_level_bound` (F6) |
| 3 | `invitations::create` explicit `collection_id`/`access_level` scope (`:226-241`) | grants an invitee | ✓ `require_collection_edit` + the same shared bound (F3) — **this was CR-01, now closed** |
| 4 | `invitations::create` `family_wide_keys` fold-in (`:290-306`) | grants an invitee | ✓ `require_collection_access_for_propagation` + the same shared bound (F6) |
| 5 | `membership::claim_item_bucket_edit_in_tx` (`:693`) | UPDATE, own row only | ✓ caller's own row, item_bucket-only in the SQL, atomic with the move |
| 6 | `families::apply_member_removal_rekey` (`:708`, `:716`) | DELETE the departing member's row; UPDATE `sealed_key` only | Never writes `access_level` |
| 7 | `collections::revoke_access` (`:744`) | DELETE | ✓ refuses outright on item_bucket (F7) |
| 8 | `account::delete_account` | FK cascade | n/a |

Nos. 1052/1103/1283/1314/1352 in `membership.rs` are all inside `#[cfg(test)] mod tests` (module starts at `:964`) — not production writers.

**No fourth unbounded propagation path exists.** Two structural facts make the enumeration closed: there is no `PATCH`/`PUT` route on `/api/vault/collections/{id}` (route table lines 353, 411–430), and no statement anywhere in `src/` updates `family_wide_kind` or `family_wide_access_level` — so a collection's kind and declared level are immutable after creation, and a create-time bound cannot be outrun by a later mutation. Accept-time (`invitations.rs:617`, `:701`) therefore inherits a level that was already bounded at create time.

All three bound sites now call one shared definition (`membership::enforce_item_bucket_declared_level_bound`), and F6 confirms it is genuinely wired into each — reverting the helper alone broke tests at all three sites.

Ordering re-checked: all three bound calls, and `revoke_access`'s refusal, run on `&state.db` strictly **before** their handler's `begin()` (`collections.rs:599` before `:629`; `:705` before `:741`; `invitations.rs:241`/`:305` before `:313`). No new deadlock surface.

---

## W2 — HI-02: does failing closed re-create WINDOWS #17?

**For any reachable released state: no. For one narrow dev-only state: yes, and it is not recorded anywhere.**

- The refusal is scoped to `item_bucket` only, and that scoping is load-bearing, not incidental — F5 proves that over-broadening it to legacy FOLDERS breaks `task2_legacy_null_level_family_wide_folder_invite_fold_in_still_succeeds` with exactly WINDOWS #17's `403`-where-`201`-is-required shape. C-1's original concern is genuinely still protected.
- A NULL-level `item_bucket` cannot be created through the API: `validate_family_wide_access_level` (`collections.rs:113`) rejects `(Some(kind), None)` with a 400 before any DB work, and migration 0020's `CHECK` sits behind it.
- Such a row can therefore only exist as a pre-0020 leftover. Migrations 0019, 0020 and 0021 all land inside the **unreleased** v0.5 milestone; v0.4 (what the hosted instance runs) has no `family_wide_kind` column at all. So no released deployment can hold one.
- The one state that *can*: a local dev database that ran an intermediate build carrying 30-12's item-bucket client but not yet 0020 (0020 came out of 30-REVIEW.md, after the phase's code). In such a DB, any member holding a key on that bucket now gets the **whole** invite request refused — because `generateInviteLink` folds in every family-wide collection the caller holds a key for, unconditionally. That member can never generate an invite again. That is WINDOWS #17's exact failure shape, deliberately re-admitted for this one row type in exchange for closing a real escalation.

Not a blocker (unreachable in production, detectable in one query), but it is a residual the disposition should have recorded and did not. Escalated as a human decision item, with the detection query in this file's frontmatter.

---

## HI-03 — laundering, driven and refused

I drove the attempt myself via `hi03_…`: a self-escalated contributor creates a SECOND item_bucket declared `"edit"` (legal — they are its creator) and attempts to move the OWNER's item X out of the `"read"` bucket into it. Result: **403**, and `SELECT collection_id FROM vault_items WHERE id = X` still returns the original bucket — state unchanged. Under F2 (Gate 1 disabled) the same call returns **200** and the item moves. The bound is real and single-revert falsifiable.

Gate 1 is correctly scoped: it fires only for an `item_bucket` SOURCE and only when the caller is not the item's `user_id`. It does not restrict a family-wide FOLDER source, does not restrict in-place `update()`, and breaks no shipped UI — `SharingOverviewPanel`'s pinned family-wide block is display-only (`FamilyWideEntry` renders `id`/`kind`/`name`; there is no revoke or move affordance on a family-wide item entry).

**W3 (residual, escalated):** the destruction half was assessed and left open — a self-escalated contributor may `DELETE` any other member's item in the bucket. The disposition's reasoning (this is `edit`'s pre-existing meaning for shared collections) is defensible. But Task 7's disclosure copy says only "pełna edycja" / "full editor", and LOCKED decision 1 requires that no UI copy be left false. Whether "full editor" adequately conveys "can delete your item" is a product call, not a code call.

---

## SC6 has not regressed

`revoke_access`'s new refusal cannot touch the departure path: `families::apply_member_removal_rekey` (`:708`) issues its own `DELETE FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?` inside its own transaction, for every entry in the batch — it never routes through `revoke_access`. The batch itself is built client-side from `getMemberAccess(target).collections` (`rekey.ts:76`), which is kind-agnostic, so item_buckets are included. Live confirmation at this HEAD: e2e tests **5 (leave), 6 (removed), 7 (account deletion) all passed** in my clean run, each with its positive "was readable" anchor before the revocation.

---

## LOCKED decision 2 — byte-for-byte (extraction diff, not a grep)

My first attempt at this check produced a vacuous "IDENTICAL" from two empty files (a `git show` quoting error). Redone properly:

- `may_grant_access_level`'s whole function body extracted at `3219b16` and at `HEAD`: **22 lines each, `diff` empty.** All nine arms untouched, no wildcard.
- `collections::create` extracted whole at both revisions: the only difference is the LO-01 409 message text. The creator-edit hunk itself — `INSERT INTO collection_keys (…) VALUES (?, ?, ?, 'edit')` plus its four binds and `.execute(&mut *tx)` — **diffs empty**.
- `ShareDialog`'s access-level control still renders `ACCESS_LEVEL_VALUES = ["read", "edit", "hidden_password"]` unconditionally (`:122`, `:1330`); the only `hidden_password` additions in the diff are Task 7's comment and ME-02's `contributorCeilingApplies` scoping. No family-wide guard, no narrowing.

---

## The live recipient's identity — confirmed independently

`memberCtx` authenticates as `pv-e2e-item-bucket-member-${uniqueSuffix()}@example.test` through `ensureNamedFamilySession`, which drives the app's own **register** form (falling back to a real login only if the address already exists — impossible here, the suffix is unique per run) and then joins through the real `/invite/{id}#{secret}` UI. The owner side is `FAMILY_OWNER_EMAIL` on a genuinely fresh browser context. The two decrypt steps that carry the claim are cross-account in both directions: the member decrypts the owner's X and Z, and the **owner decrypts the member's Y**. `assertRecipientDecrypts` asserts the real decrypted name in the row *and* the real password after `reveal-password` — never a row's presence. Only the *family* is reused, which `idx_families_singleton` genuinely forces. **The proof is not vacuous.**

---

## Anti-patterns

`TBD` / `FIXME` / `XXX` across all 21 source files changed in `3219b16..HEAD`: **none**. The three `TODO` hits in `vault.rs` (`:622`, `:784`, `:1125`) are prose references to a historical TODO that was closed, not open markers.

---

## Verdict

The quick task's work is **sound**. All five must-have truths hold at this HEAD, every guard the plan and the review claim is real and individually falsifiable, LOCKED decisions 1–4 are honoured, and the tree is clean. Two judgement calls (W2, W3) are escalated rather than silently absorbed; neither blocks Phase 30.

Two things the fix pass got *more* right than it claimed, and one it got less right, are recorded above under W1 — the net is that Face 2 is defended three-deep, not that its proof is hollow.

---

_Verified: 2026-08-12T02:04:27Z at HEAD `0c67a66`_
_Verifier: Claude (gsd-verifier), adversarial goal-backward pass_
_11 production-code reverts performed and restored by the verifier; tree confirmed byte-identical afterwards_
