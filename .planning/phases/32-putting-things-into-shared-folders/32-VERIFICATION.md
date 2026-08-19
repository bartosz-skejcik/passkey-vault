---
phase: 32-putting-things-into-shared-folders
verified: 2026-08-19T13:59:06Z
status: human_needed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Decide whether CR-01's 'second variant' — an `edit`-level member relocating ANOTHER author's item from shared folder F into shared folder G — is acceptable behaviour to ship, or needs a Gate 1c."
    expected: "A disposition (accept / file as WINDOWS entry / fix in v0.6). Verified live at the server: the move returns 200, the row keeps `user_id = A` but `collection_id = G`; author A's `GET /api/vault/items` no longer contains the item and `GET /api/vault/collections/G/sync` returns 404 for A. G's members read it fine — so it is NOT an undecryptable row and SC3's literal bar holds. It IS newly reachable through the shipped editor: `personalScopeBlocked` disables only 'Bez folderu' and personal folders; every writable shared folder stays enabled for a foreign-owned item."
    why_human: "Not a criterion failure — a scope/product decision. The Fix Disposition closed it as 're-opening a locked 32-CONTEXT.md decision', and that rationale is wrong (see Findings F-2), so the decision was never actually made by a human."
  - test: "Decide whether ME-04's assertion (b) (`reloadAndUnlock` + password locator `toHaveCount(0)`) stays in `sharing.spec.ts` as decoration, is replaced with a discriminating post-reload read, or is deleted."
    expected: "A disposition. Falsified in this verification: the assertion passes unchanged on a build where the member RETAINS full access, because a fresh render never puts a password in the DOM without a row click + `reveal-password` click."
    why_human: "The test is green either way; only a human can decide whether to spend a plan on replacing it. The genuine ME-04 closure is assertion (a), which does discriminate."
  - test: "Decide whether the C-2 recovery gate's `freshRow.revision === newRevision` conjunct needs its own regression test."
    expected: "A disposition. Falsified: deleting that conjunct alone leaves the entire web suite green (626/626 across `src/lib/vault` + `src/components/vault`). Only the content-match conjunct is covered."
    why_human: "Defence-in-depth coverage judgement; the load-bearing conjunct IS covered and was falsified successfully."
---

# Phase 32: Putting Things Into Shared Folders — Verification Report

**Phase Goal:** An item can be created in, moved into, and taken back out of an existing shared
folder from the item editor, always re-encrypted under the destination scope's key or refused
outright — closing the gap that makes shared folders feel broken.
**Verified:** 2026-08-19T13:59:06Z
**Status:** human_needed (5/5 criteria verified; 3 escalations, 0 blockers)
**Re-verification:** No — initial verification, post code-review fix pass (`9ad086c..f0603fc`, 20 commits)

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria, verbatim)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | In the item editor, a shared folder is a selectable destination using the same control and mental model as choosing a personal folder, on both create and edit, and the chosen destination survives save, reload, and a sync round trip. | ✓ VERIFIED | `ItemForm.tsx:667-730` — one `item-folder-select` with `<optgroup>` "Moje foldery"/"Udostępnione foldery", `item_bucket` excluded, read-only shared folders shown-but-disabled with the reason. Live edit-mode: `sharing.spec.ts:1799` asserts `collection_id === destinationId` via the API **after** `reloadAndUnlock`. Live create-mode: `sharing.spec.ts:1914` asserts the same before AND after a real reload. Both passed in my own unfiltered run. |
| 2 | An item moved from personal into shared scope is stored encrypted under the destination collection's key with AAD bound to that collection, and a different real account with access reads the moved item's actual field values — positive recipient-side assertion in a live run. | ✓ VERIFIED | AAD binding: `moveVaultItem.real-wasm.test.ts` Tests 1/3 — genuine WASM (no `vi.mock("@/lib/crypto")` anywhere in the file; only the wire is mocked), decrypts under the destination collection key and **fails** under a different real collection key. Recipient side: `sharing.spec.ts:1799` — the member's own live session reveals the item's **real decrypted password**, not a name or an id. Passed live. |
| 3 | A move whose destination key is unavailable is refused: honest error, ciphertext and revision byte-identical, never a row nobody can decrypt, refusal deliberately driven. | ✓ VERIFIED | Two deliberately-driven live refusals, both passing: `sharing.spec.ts:2005` (PUT demotion → 403) and `sharing.spec.ts:2170` (raw DELETE of the owner's own grant → 404). Both assert the banner text while `item-form-login` is still mounted, assert `.not.toContain("Try again")`/`"Spróbuj ponownie"`, and assert `enc_key`/`enc_data`/`revision`/`collection_id` byte-identical to a pre-attempt baseline read with the owner's own token. Client-side pre-flight refusal: real-WASM Test 4 (`getCollectionKey → undefined` throws `CollectionKeyUnavailableError` **before any network call**). "Never a row nobody can decrypt": server Gate 1b — **I falsified it myself** (below). |
| 4 | An item taken out of a shared folder is re-encrypted under the owner's personal key, and a member who could read it before demonstrably cannot after — anchored positively on both sides, the same read failing after the next completed sync. | ✓ VERIFIED (1 decorative assertion, see F-1) | Re-encryption: real-WASM Test 2 (collection → personal decrypts via `decryptItem` under the caller's own UserKey). Live `sharing.spec.ts:2362`: positive anchor is a real `reveal-password` click rendering the real plaintext on a **still-open** panel; a `toHaveCount(1)` pre-check on the **same locator** drives the later `toHaveCount(0)`; the negative read runs on the member's own un-reloaded session after its next completed sync. ME-04's assertion (a) — `GET /api/vault/collections/{dest}/items` with the **member's own token**, item absent — is a genuine server-side check and IS discriminating (my ZZPROBE positive control proves it fails when the move-out is skipped). |
| 5 | `cargo clippy --workspace --all-targets -- -D warnings` exits 0 (DEBT-04). | ✓ VERIFIED | Run by me at HEAD, **after** all six fix-pass commits: `CLIPPY_EXIT=0`, zero warnings. |

**Score:** 5/5 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `crates/pv-server/src/routes/vault.rs` | Gate 1b (pre-tx + tx-scoped), `item_shares` DELETE untouched | ✓ VERIFIED | Gate 1b at both the pre-tx `precheck_owner_user_id` point and again on the fresh tx-scoped read inside `BEGIN IMMEDIATE`. |
| `crates/pv-server/src/routes/sync.rs` | `owned_by_caller` computed per row | ✓ VERIFIED | `owner_user_id == membership.caller_user_id`, from a `vault_items.user_id` column added to the existing SELECT. No authorization filter added (Pitfall A preserved). |
| `web/src/lib/vault/store.ts` | `moveVaultItem` ownership guard, 3-conjunct recovery, 403/404 split | ✓ VERIFIED | `NotItemOwnerError` before any encryption; recovery requires destination + revision + `tryDecryptFreshRowPlaintext(...) === plaintext`; `isForbiddenError` splits on `newCollectionId === null`; `isNotFoundError` → `CollectionKeyUnavailableError`; probe failure leaves `freshRow` undefined and falls through (no bypassing throw). |
| `web/src/components/vault/ItemForm.tsx` | grouped destination select, fail-closed unknown scope, HI-02 branch, ME-07 preset id | ✓ VERIFIED | `scopeUnknown` ORed into the locked branch with its own copy; `personalScopeBlocked`; `else if (createdItemState !== null) → updateVaultItem`; `pendingCreateIdRef` minted once per submission. |
| `web/src/components/vault/DetailPanel.tsx` | `retryFromRevision` separate from `editBaselineRevision`; `notOwner` banner | ✓ VERIFIED | `currentRevision={retryFromRevision ?? item.revision}`, `key={...editBaselineRevision}` unchanged → no remount on retry. Four-way `saveError` discriminant. |
| `web/src/lib/vault/itemCapabilities.ts` | LO-03 fail-closed | ✓ VERIFIED | `accessLevel === undefined` → `return item.collectionId == null`. |
| `web/e2e/sharing.spec.ts` | live SC1/SC2/SC3/SC4 + HI-01 | ✓ VERIFIED | 17 tests, all passing live. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `sync.rs::pull_shared_collection` | `api.ts::ItemRow.owned_by_caller` | JSON `owned_by_caller` | WIRED | Serialized on `VaultItem`, read as optional on the client. |
| `api.ts::ItemRow` | `store.ts::VaultItem.ownedByMe` | `decryptItemRow` | WIRED | `row.collection_id === null ? true : row.owned_by_caller` — an absent field on a collection row yields `undefined`, which every consumer reads as "not proven owned" (fails closed). |
| `store.ts::items` | `ItemForm` `ownedByMe` prop | `DetailPanel` `ownedByMe={item.ownedByMe ?? true}` | WIRED | `recomputeItems()` merges `collectionSharedItems` into the public `items`, so a foreign-authored row genuinely reaches the guard. |
| `ItemForm` destination select | `store.ts::moveVaultItem` | `handleSubmit` dispatch on `destinationCollectionId !== (currentCollectionId ?? null)` | WIRED | Unchanged destination routes to `updateVaultItem`, never through the move helper. |
| `store.ts::moveVaultItem` | `vault.rs::move_item` | `PUT /api/vault/items/{id}/collection` | WIRED | Proven live end-to-end in 5 e2e tests. |

### Behavioural Spot-Checks / Independent Falsification

Everything below I drove myself; none of it is quoted from a SUMMARY or the Fix Disposition.

| # | What I falsified | How | Result |
|---|------------------|-----|--------|
| 1 | **Server Gate 1b (CR-01)** | Disabled BOTH the pre-tx and the tx-scoped check (`if false && ...`), rebuilt, ran `edit_folder_member_cannot_move_owners_item_out_to_personal_scope_cr01_regression` | ✗ RED — `left: 200, right: 403`. Restored → green. The test drives raw HTTP with the member's own token, so the refusal is proven **independent of any client**. |
| 2 | **The C-2 rule (ME-05's coverage hole)** | Deleted both the revision and the content-match conjuncts from `moveVaultItem`'s recovery gate, ran the **full** web suite | ✗ RED — 1 failed / 1046 passed. The failure returns the caller's own submitted fields as a success over a foreign prior attempt's content — the exact CR-02 shape. ME-05's hole is genuinely closed. |
| 3 | **The C-2 revision conjunct ALONE** | Deleted only `freshRow.revision === newRevision`, ran `src/lib/vault` + `src/components/vault` | ✓ GREEN, 626/626 — **not covered**. See F-3. |
| 4 | **The `throw`-inside-`catch` bug (HI-01's side-catch)** | Re-introduced `throw err` inside the recovery probe's inner `catch` | ✗ RED — 2 tests, both live-E2E-caught shapes (`404 → CollectionKeyUnavailableError` and `403/null → NotItemOwnerError` when the probe also fails). Genuinely covered. |
| 5 | **CR-01's client halves** | Set `personalScopeBlocked = false` and deleted the `NotItemOwnerError` guard | ✗ RED — 2 tests (`ItemForm.test.tsx` offer-guard, `moveVaultItem.real-wasm.test.ts` perform-guard). |
| 6 | **`item_shares` DELETE byte-identity** | Extracted the `if req.new_collection_id.is_some() { ... DELETE ... }` block plus its whole comment from `git show 2f6e8e6:...vault.rs` and from HEAD, compared byte-for-byte in Python | ✓ **IDENTICAL**. Only the two surrounding `bump_*(&mut *tx)` → `(&mut tx)` deref forms differ — the DEBT-04 sweep. Bartek's 2026-08-19 reversal is honoured. |
| 7 | **CR-01 "second variant"** (the sibling the fixer left open) | Wrote a throwaway Rust integration test: B (edit on F **and** owner of G) moves A's item F → G | **200 OK.** Row: `user_id = A`, `collection_id = G`. A's `GET /api/vault/items` no longer contains it; A's `GET /collections/G/sync` → **404**; B's → 200. See F-2. |
| 8 | **ME-04's assertion (b)** | Throwaway Playwright test: SC4 setup + positive anchor, **move-out skipped**, then ME-04's (b) verbatim, plus a positive control asserting the member still has access | (b) **PASSED** with access fully retained, positive control confirming access. **(b) is vacuous.** See F-1. |
| 9 | **The pre-existing test the fixer says went red** | `git diff 2f6e8e6..HEAD -- DetailPanel.test.tsx` on "shows a revision-conflict banner and keeps the in-progress edit on RevisionConflictError" | **Untouched** — zero `-` lines. Still asserts `item-body` retains the typed value. Not adjusted to fit. |

### CR-02: the premise, traced end to end

The task's sequence, traced against the shipped code and confirmed by falsification #2:

1. Item at rev 5. Save #1 sends content **A** at `currentRevision = 5` → `newRevision = 6`; server commits A@6; the response and the recovery probe both fail → `throw err` → generic banner. `DetailPanel.onError` sets `retryFromRevision = getItems()…revision`, which is **still 5** here (no successful write, no `loadAndDecryptAll` on a generic error) — so the re-baseline alone does **not** save this case, exactly as the review argued.
2. User edits to **B**. Save #2 sends B at 5 → `newRevision = 6` again. Server `WHERE revision = 5` matches nothing → **409**.
3. Recovery probes `getCollectionSync(F)`: destination ✓, revision `6 === 6` ✓ — **the revision conjunct does not discriminate, exactly as CR-02 said** — and then `tryDecryptFreshRowPlaintext(freshRow, uk)` yields A ≠ B → **declines**.
4. Falls through to `isConflictError` → `RevisionConflictError` → conflict banner, in-progress edit kept.

**The UI does not report success over A.** The premise now holds because of the content-match conjunct, not because of the re-baseline; `retryFromRevision` is a genuine second fix (it advances the prediction whenever the store *has* moved on, without remounting the form — proven by the new `DetailPanel.test.tsx:402` test, which asserts the second call carries revision 3 and the typed body survives).

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| ORG-01 | Item movable into / creatable in an existing shared folder from the editor, same mental model | ✓ SATISFIED | SC1 (both halves live) |
| ORG-02 | Re-encrypt under destination key with bound AAD; refuse rather than mis-scope; never an undecryptable row | ✓ SATISFIED | SC2 + SC3 + Gate 1b (falsified) |
| ORG-04 | Move-out returns to personal scope with the same discipline; previously-shared members lose access | ✓ SATISFIED | SC4 live, with the caveat in F-1 |
| DEBT-04 | Workspace clippy `-D warnings` exits 0 | ✓ SATISFIED | Run at HEAD, exit 0 |

**Doc inconsistency (F-4):** `.planning/REQUIREMENTS.md` lines 131-132 still read `ORG-02 | Phase 32 | In progress` and `ORG-04 | Phase 32 | In progress` — left over from commit `671b741`'s deliberate re-open. 32-04 closed both (lines 43/45 carry `[x]`). The table needs restoring to `Complete` before the phase is filed.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No `TBD`/`FIXME`/`XXX`/`HACK`/`PLACEHOLDER` in any file this phase touched | ℹ️ Info | The three `TODO` hits in `vault.rs` (644, 806, 1185) are historical references inside prose comments ("this TODO used to leave in place"), not open markers. |
| `web/e2e/sharing.spec.ts` | SC4, ME-04 (b) | Assertion that cannot fail | ⚠️ Warning | See F-1 — falsified empirically. |
| `web/src/components/vault/ItemForm.tsx` | ~497 | Revision-only recovery conjunct (create-mode B-3 mirror) | ℹ️ Info | See F-5. |

---

## Findings

### F-1 (WARNING) — ME-04's assertion (b) is vacuous, and the Fix Disposition's claim about it is false

The Disposition states for ME-04: *"both new checks are assertions that would fail against a build
where the member retained genuine access, and they did not fail here."*

That is true for (a) and **false for (b)**. Assertion (b) is:

```ts
await reloadAndUnlock(member.page, SESSION_PASSWORD);
await expect(member.page.getByText(itemPassword, { exact: true })).toHaveCount(0);
```

The positive anchor requires `row.click()` → panel visible → `reveal-password` click before the
plaintext is anywhere in the DOM. After a reload nothing does that, so the plaintext is never
rendered regardless of access. I ran a throwaway Playwright test that reproduces SC4 up to and
including the positive anchor, **skips the move-out entirely**, and then runs (b) verbatim: it
**passed**, while a positive control in the same test confirmed the item was still in the
destination collection and readable with the member's own token.

This is the same "evidence that measures the wrong thing" shape the executor already hit once in
this phase. **SC4 still holds** — it is carried by the pre-checked same-read negative and by
assertion (a), both of which discriminate. (b) is decoration presented as proof.

### F-2 (WARNING, human decision requested) — CR-01's "second variant" is real, newly UI-reachable, and was closed on a rationale that does not hold

Independently driven at the server (throwaway Rust integration test, output above): B, holding
`edit` on shared folder F and owning shared folder G, moves author A's item F → G. Server returns
**200**. The row keeps `user_id = A` but `collection_id = G`; A's own `GET /api/vault/items` no
longer returns it and `GET /api/vault/collections/G/sync` gives A a **404**. G's members read it
fine.

It is reachable through the shipped UI: `personalScopeBlocked` disables only `"Bez folderu"` and
personal folders; the entire `writableShared` optgroup stays enabled for a foreign-owned item.

**Why this is not a criterion failure:** it does not produce an undecryptable row, so SC3's literal
bar and ORG-02's wording both hold. **Why it still needs a human:** the Fix Disposition closed it
with *"extending Gate 1b to this case would re-open [32-CONTEXT.md Area 2's] locked decision, not
fix a correctness bug."* 32-CONTEXT.md Area 2 locks whether the **mover** gets an inline note or a
confirm dialog when changing **their own** item's scope. It says nothing about whether one member
may relocate **another author's** item out of that author's reach. The two are different questions,
so this was never actually dispositioned by Bartek — it was dispositioned by an agent citing his
decision about something else.

### F-3 (WARNING) — the C-2 revision conjunct has no independent coverage

Deleting `freshRow.revision === newRevision` alone leaves the entire `src/lib/vault` +
`src/components/vault` suite green (626/626). The Disposition's ME-05 entry lists
"decline-on-foreign-revision" among its 17 new tests; enumerating the file's `it(...)` titles shows
no such test. The load-bearing content-match conjunct **is** covered and I falsified it
successfully, so the risk is defence-in-depth only: without the revision conjunct, a fresh row whose
content matches but whose revision differs would be recovered and written into the store at the
wrong revision (a subsequent 409, not a false success).

### F-4 (INFO) — REQUIREMENTS.md table left mid-flight

Lines 131-132 still say ORG-02 / ORG-04 are "In progress"; 32-04 closed both.

### F-5 (INFO) — `ItemForm`'s create-mode B-3 backstop is still revision-only

`ItemForm.tsx`'s create-then-move backstop recovers on
`fresh?.collectionId === destinationCollectionId && fresh.revision === created.revision + 1` with no
content match — the weaker mirror CR-02 named and the fix pass did not extend. Residual shape: if a
background sync lands a prior attempt's content into the store between two Saves, the form closes
reporting success for a save that did not include the user's latest edit. The store and the server
agree afterwards, so the user is never shown content that isn't stored — this is edit loss, not a
false-state lie. Below every SC's bar; noted so it is on the record.

---

## Deferred Items

None. No criterion is deferred to a later phase.

## Gaps Summary

**No gaps.** All five ROADMAP success criteria are verified against the codebase, with the
load-bearing mechanisms falsified independently rather than accepted from the SUMMARYs or the Fix
Disposition. Gate 1b, the C-2 content-match conjunct, the `throw`-inside-`catch` fix and both CR-01
client halves all go red when removed. The `item_shares` DELETE is byte-identical to `2f6e8e6`.

What is outstanding is three items that need a human's disposition, none of which blocks the phase
goal: the CR-01 second variant's product decision (F-2), a vacuous test assertion (F-1), and one
uncovered defence-in-depth conjunct (F-3) — plus a one-line REQUIREMENTS.md table correction (F-4).

## CI-Width Results (all run by me at HEAD)

| Check | Command | Exit | Counts |
|---|---|---|---|
| Rust workspace tests | `cargo test --workspace --no-fail-fast` | **0** | 31 test binaries, **394 passed, 0 failed** |
| Clippy gate (SC5 / DEBT-04) | `cargo clippy --workspace --all-targets -- -D warnings` | **0** | zero warnings |
| Web build | `cd web && npm run build` | **0** | Next.js 16.2.10 static export, 5/5 pages |
| Web typecheck | `cd web && npm run compile` | **0** | `tsc --noEmit`, run **after** build (the CONTEXT.md ordering constraint) |
| Web unit/component | `cd web && npm test` | **0** | 93 files, **1047 passed, 0 failed** |
| Playwright, **unfiltered** | `CI=1 npx playwright test e2e/sharing.spec.ts` | **0** | **17/17 passed** in 1.6 min, **zero retries** |

**Live-run hygiene:** `CI=1` (so `reuseExistingServer: false`); port 8620 confirmed free before the
run; Playwright's own `webServer` performed a genuinely fresh `cargo build --release -p pv-server`
(log shows `Compiling pv-server ... Finished release profile in 13.77s` — my Gate-1b
falsification/restore had invalidated the binary, so this was a real rebuild of this HEAD) plus a
fresh `next build`; throwaway `PV_E2E_DB_DIR` via `mkdtempSync`, removed by `globalTeardown`.
`data/pv.db` SHA-256 `8e043c9d…b997c8` **before and after**, `-shm` and `-wal` likewise unchanged.

**Tree state:** `git status --short` at the end is byte-identical to the start — only the
pre-existing untracked `.planning/.../32-REVIEW.md`, `.playwright-mcp/*` and `*.zip` entries.
`git diff` against HEAD is empty. Every probe (Gate 1b disable, C-2 rule deletion, revision-conjunct
deletion, `throw`-in-`catch` re-introduction, CR-01 client-guard removal, the variant-2 Rust probe,
the ME-04 vacuity Playwright probe) was reverted from a byte-level backup. Nothing was committed.
The sibling `ios/spike` worktree was not touched.

---

_Verified: 2026-08-19T13:59:06Z_
_Verifier: Claude (gsd-verifier)_

---

## Gap Closure (2026-08-19, post-verification)

**Closed by:** Claude (gsd-code-fixer), working directly on `main` (the phase's own checkout, per
explicit instruction — not an isolated worktree; the four commits below are already on `main`,
not pushed).
**Source:** this file's own F-1/F-2/F-3 findings, plus F-4. All four closed. No finding was found
wrong on investigation.
**Non-negotiables honored:** every new/changed test falsification-proven with the exact observed
red output recorded below; CI run at full width after all four fixes; live runs from a genuinely
fresh build (`CI=1`, port 8620 confirmed free, throwaway `PV_E2E_DB_DIR`, `data/pv.db` checksummed
before and after every live run); `move_item`'s `item_shares` DELETE, `may_grant_access_level`'s
nine arms, `collections::create`'s creator-`edit` INSERT, and `hidden_password` availability were
not touched (confirmed by re-reading each after all edits); atomic commit per finding.

### F-2 — fixed

**Disposition (Bartek, via the coordinator):** the Fix Disposition's original closure ("re-opening
32-CONTEXT.md Area 2's locked decision") was wrong — Area 2 locks what the *mover* is told about
their *own* item's scope change, not whether one member may relocate *another author's* item beyond
that author's reach. Fixed, not deferred.

**Commit:** `f115fba` — `fix(32): F-2 Gate 1b forbids non-owner collection-to-collection moves`

**Fix:** `crates/pv-server/src/routes/vault.rs`'s Gate 1b (both the pre-tx precheck and the
tx-scoped TOCTOU re-check) is extended from `req.new_collection_id.is_none()` to
`precheck_collection.is_some()` / `current_collection.is_some()` — destination-independent. Only
the item's actual owner may re-scope a collection-sourced item now, whether the destination is
personal or a different shared folder. Client-side: `ItemForm.tsx`'s `writableShared` options are
disabled (with the owner-only reason, shown-but-disabled per 32-CONTEXT.md's own discipline) for
any destination other than the item's own current folder, when the caller does not own the item —
renamed `personalScopeBlocked` → `nonOwnerScopeBlocked` throughout to match. `store.ts`'s
`moveVaultItem` pre-flight guard and its 403-classification catch block are broadened the same way.
A pre-existing test (`move_item_rejected_when_caller_lacks_edit_on_destination_collection`) that
asserted the now-corrected behavior ("edit on both source and destination succeeds" for a
*non-owner* mover) was updated: that case now asserts 403, with a new case proving the item's
*actual owner*, holding the identical access, still succeeds — so the destination gate isn't
blanket-closed, only ownership-gated.

**Proof:** a new Rust integration test,
`edit_folder_member_cannot_move_owners_item_between_shared_folders_f2_regression`
(`crates/pv-server/tests/collections.rs`), drives the verifier's exact probe — B holds `edit` on
folder F and separately owns folder G, B moves author A's item F → G — and asserts 403 plus
byte-identical rollback of `user_id`/`collection_id`/`enc_key`/`enc_data`/`revision`, plus that A's
own `GET /api/vault/items` still contains the item afterward. Two new vitest tests
(`moveVaultItem.real-wasm.test.ts`) prove the client pre-flight guard fires on a genuinely different
destination and does NOT fire when reselecting the item's own current folder. A new ItemForm test
proves the offer-guard disables a second, distinct shared folder while leaving the item's own
current folder enabled.

**Falsification (server, both Gate 1b conditions disabled via `if false && ...`):**
```
thread 'edit_folder_member_cannot_move_owners_item_between_shared_folders_f2_regression' panicked at
crates/pv-server/tests/collections.rs:4153:5:
assertion `left == right` failed: Gate 1b: an edit-level folder member must never be able to move
another author's item into a DIFFERENT shared folder either -- only the item's actual owner may
re-scope it, regardless of destination
  left: 200
 right: 403
```
Restored → green (37/37 `crates/pv-server/tests/collections.rs`).

**Falsification (client pre-flight guard reverted to null-destination-only):**
```
F-2 (32-VERIFICATION.md gap closure): refuses (NotItemOwnerError) a move BETWEEN two shared
folders...
 → expected CollectionKeyUnavailableError: cannot sav… to be an instance of NotItemOwnerError
```
Restored → green (20/20 `moveVaultItem.real-wasm.test.ts`).

**Falsification (ItemForm offer-guard's `blocked` forced to `false`):**
```
CR-01/F-2: an item in a shared folder the caller does NOT own disables every personal-scope option
AND every OTHER shared folder...
 → expected false to be true
```
Restored → green (35/35 `ItemForm.test.tsx`).

### F-1 — fixed

**Commit:** `569feb5` — `test(32): F-1 make SC4's post-reload assertion (b) discriminate`

**Fix:** assertion (b) (`sharing.spec.ts`, SC4) is replaced. The old form re-asserted the
positive-anchor's password-TEXT locator after a bare `reloadAndUnlock` — vacuous, since nothing
renders that plaintext without an explicit row-click + reveal-password click that step never
performs. The new form checks list membership (`item-row-{itemId}`) on the same fresh reload, using
an active `waitFor({ state: "visible", timeout: 20000 })` rather than a bare `toHaveCount(0)` —
the latter would reintroduce a narrower timing-shaped vacuity (checked immediately after reload,
before the post-unlock fetch resolves, the row's count is genuinely 0 regardless of access, and a
Playwright web-first assertion returns on its first successful poll). Waiting for visibility means
a build where access is retained gets the full window to prove it; a build where access is
genuinely lost exhausts the window before the check can pass.

Also corrects 32-REVIEW.md's ME-04 disposition text (see the inline correction added there), which
claimed both new checks "would fail against a build where the member retained genuine access" —
true for (a), false for (b).

**Falsification:** a throwaway Playwright test (SC4's setup + the positive anchor, move-out
**skipped**, then assertion (b) verbatim) was added to `sharing.spec.ts`, run live, then removed —
never part of the committed suite. Reproducibly RED across all 3 attempts (initial run + 2
Playwright-config retries):
```
1) [chromium] › F1-FALSIFY: assertion (b) must fail when the member's access is retained
   (move-out skipped)
Error: F1-FALSIFY: this must FAIL -- the row must still be present since access was never removed
expect(received).toBe(expected) // Object.is equality
Expected: false
Received: true
  at web/e2e/sharing.spec.ts:2602:5
(identical failure on retry #1 and retry #2)
```
Throwaway test removed (`git diff` against the committed file is a clean 42-insertion/8-deletion
change, confirmed by re-reading after removal). The real, fixed SC4 test then passed live:
`CI=1 npx playwright test e2e/sharing.spec.ts -g "SC4:"` → 1 passed (23.3s; the near-20s duration is
expected — SC4's own real scenario has access genuinely lost, so the new wait exhausts its full
20-second window before resolving false, exactly as designed).

### F-3 — fixed

**Commit:** `960854c` — `test(32): F-3 add the missing decline-on-foreign-revision coverage`

**Fix:** a new test in `moveVaultItem.real-wasm.test.ts` isolates the C-2 recovery gate's
`freshRow.revision === newRevision` conjunct from its content-match conjunct — a fresh row whose
decrypted content matches this attempt's own submission, but whose revision is NOT this attempt's
predicted `newRevision` (simulating a foreign write that coincidentally holds identical content).
Content-match alone cannot discriminate this case; the earlier ME-05 test suite's other cases all
vary content alongside revision, which is exactly why deleting the revision conjunct alone left the
whole suite green.

**Falsification:** removed only `freshRow.revision === newRevision` from
`store.ts::moveVaultItem`'s recovery gate:
```
AssertionError: promise resolved "{ id: 'item-foreign-owner', …(9) }" instead of rejecting
- Expected: Error { "message": "rejected promise" }
+ Received: {
+   accessLevel: "edit",
+   collectionId: "collection-foreign-owner",
+   fields: { body: "identical content -- content-match ALONE cannot tell this apart from a
             genuine recovery", ... },
+   id: "item-foreign-owner",
+   revision: 4,
+   ...
+ }
 at web/src/lib/vault/moveVaultItem.real-wasm.test.ts:748:77
```
i.e. without the revision conjunct, recovery falsely "succeeds" and reports `revision: 4` while the
server's fresh row is actually at revision 6 — the exact mis-filed-at-the-wrong-revision risk F-3
described. Restored → green (18/18 in this file at the time; 20/20 after F-2's two additional tests
landed).

### F-4 — fixed

**Commit:** `878a718` — `docs(32): F-4 mark ORG-02/ORG-04 complete in REQUIREMENTS.md`

**Fix:** `.planning/REQUIREMENTS.md` lines 131-132 restored from "In progress" to "Complete", citing
32-04's closure and this file's own live verification as evidence. Documentation-only; Tier 1
re-read confirmed the two lines and no other content changed.

### Full CI-width verification, after all four fixes (run by the fixer at HEAD `569feb5`)

| Check | Command | Exit | Counts |
|---|---|---|---|
| Rust workspace tests | `cargo test --workspace --no-fail-fast` | **0** | 31 binaries, **395 passed, 0 failed** (394 baseline + the new F-2 Rust regression) |
| Clippy gate (DEBT-04) | `cargo clippy --workspace --all-targets -- -D warnings` | **0** | zero warnings |
| Web build | `cd web && npm run build` | **0** | Next.js 16.2.10 static export, 5/5 pages, TypeScript passed inline |
| Web typecheck | `cd web && npm run compile` | **0** | `tsc --noEmit`, run after `build` (CONTEXT.md's ordering constraint) |
| Web unit/component | `cd web && npm test` | **0** | 93 files, **1050 passed, 0 failed** (1047 baseline + 1 F-3 + 2 F-2 client tests) |
| Playwright, **unfiltered** | `CI=1 npx playwright test e2e/sharing.spec.ts` | **0** | **17/17 passed** in 1.7 min, zero retries |

**Live-run hygiene:** `CI=1` throughout (`reuseExistingServer: false`); port 8620 confirmed free
before both the falsification run and the final unfiltered run; Playwright's own `webServer`
performed genuinely fresh `cargo build --release -p pv-server` + `next build` cycles each time
(the Gate 1b falsification/restore and the F-1 throwaway-test cycle each invalidated the release
binary, forcing real rebuilds); throwaway `PV_E2E_DB_DIR` via `mkdtempSync`, removed by
`globalTeardown` each run. `data/pv.db` SHA-256 `8e043c9d…b997c8` — checksummed before and after
the F-1 falsification run AND before and after the final unfiltered run; `-shm`/`-wal` likewise
unchanged both times.

**Untouched, re-confirmed:** `move_item`'s `item_shares` DELETE block (the `if
req.new_collection_id.is_some() { ... DELETE ... }` region), `may_grant_access_level`'s nine arms,
`collections::create`'s creator-`edit` INSERT, and `hidden_password` availability — none appear in
any diff across the four gap-closure commits (`git diff 878a718~1..569feb5 -- crates/pv-server/src/routes/vault.rs`
touches only Gate 1b's two conditions and their comments; `collections.rs` route handlers,
`membership.rs`, and the DB access-level matrix are untouched).

**Tree state:** `git status --short` at the end shows only the pre-existing untracked
`.planning/.../32-REVIEW.md` (this file's sibling, left untracked per instruction), `.playwright-mcp/*`
and `*.zip` entries. `git diff` against HEAD is empty. The `ios/spike` sibling worktree was not
touched. Nothing was pushed.

### What remains open

Nothing from this file's four findings. `32-REVIEW.md`'s ME-04 disposition text was corrected
inline (see that file) rather than rewritten, so the historical record shows both the original
(now-known-false) claim and the correction, with the reasoning for each.

---

_Gap closure completed: 2026-08-19_
_Fixer: Claude (gsd-code-fixer)_
