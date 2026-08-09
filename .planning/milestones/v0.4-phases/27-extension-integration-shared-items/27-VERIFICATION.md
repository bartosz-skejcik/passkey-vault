---
phase: 27-extension-integration-shared-items
verified: 2026-08-09T11:43:25Z
status: human_needed
score: 14/15 must-haves verified (1 present-but-behavior-unverified)
behavior_unverified: 1
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 13/14
  gaps_closed:
    - "27-04 prohibition, DIRECT-share path: mergeDirectSnapshot's per-row catch now calls markPending(row.id, null, \"broken\") — falsification-tested twice this pass (un-corrupting the payload turns the test RED; deleting the production markPending line turns BOTH the real-WASM test and Test 22 RED)"
  gaps_remaining: []
  regressions: []
  newly_found: []
deferred: []
behavior_unverified_items:
  - truth: "27-03 backstop: a genuinely concurrent first unlock from the web app and the extension results in exactly ONE published identity keypair — the publish is conditional and the race loser re-reads and unwraps the winner's blob rather than overwriting it"
    test: "Trigger a genuine concurrent first unlock (web app and extension, account with no published identity keypair) and compare the published public key before/after both settle"
    expected: "Exactly one keypair published; both clients end up holding the same secret key; no Collection Key sealed to the loser's discarded public half"
    why_human: "Unchanged across all three passes — nothing in 27-12/27-13/27-14/27-15 touched identity-store.ts. `identity-store.ts:89`'s `adopted_existing` branch is the whole race-resolution mechanism, and every identity-store.real-wasm.test.ts fixture returns `adopted_existing: false`, so that branch is executed by no test. Presence + code-read only; the invariant is a state transition grep cannot see."
human_verification:
  - test: "Open the popup on an account with a mix of shared and personal items; inspect the shared badge on the 'Wszystkie' rows, the 'Na tej stronie' rows, the detail header, and a provider ceremony candidate row"
    expected: "The people-glyph badge reads as a shared marker at popup width without crowding the icon tile, and personal rows look untouched (ROADMAP SC 5 is a visual claim)"
    why_human: "Visual/taste judgment; component tests assert markup, not legibility"
    evidence: "extension/.playwright-mcp/uat-27/shared-badge.png — captured 2026-08-09 by 27-16, live two-extension popup at 380px width, filtered to a run showing badged shared rows directly beside unbadged personal rows. NOT self-approved — awaiting Bartek's taste call."
  - test: "Open the popup on a vault containing a genuinely broken shared row (force a wrong-key collection item, or a corrupted directly-shared item — both paths now produce this row) and read the degraded row"
    expected: "A static AlertTriangle row reading 'Failed to decrypt shared item', non-clickable, no shimmer — and its tooltip/aria text no longer claims a last known version is being shown"
    why_human: "The row's legibility and the corrected PL/EN copy are taste/wording calls; ItemListView.test.tsx Test 20 asserts markup and non-interactivity, not readability"
    evidence: "extension/.playwright-mcp/uat-27/broken-row.png — captured 2026-08-09 by 27-16, live: a real shared TOTP item's enc_data corrupted directly in data/pv.db (one AEAD ciphertext byte, same technique as vault-store.real-wasm.test.ts's corruptEncData), DB restored and verified byte-identical afterward (git diff / DB content unaffected). NOT self-approved — awaiting Bartek's taste call. A third, optional pending-skeleton screenshot (neutral, non-broken contrast) was attempted live but the real Collection-Key resolution window on this local single-machine harness proved too narrow (sub-~1s even under CDP network throttling) to reliably capture without fabricating a state — skipped rather than faked, per this task's own instruction."
---

# Phase 27: Extension Integration — Shared Items — Verification Report

**Phase Goal:** Shared items work identically to personal ones across autofill, TOTP, and the passkey provider in the extension, with the concurrent-shared-passkey signature-counter question resolved by an explicit design spike rather than assumed.
**Verified:** 2026-08-09T11:43:25Z
**Status:** human_needed
**Re-verification:** Yes — third pass, after 27-15's direct-share fix. Previous: gaps_found, 13/14.

## Verdict, stated plainly

**The phase goal is achieved. The one remaining blocker — the direct-share silent drop I raised in pass 2 — is genuinely closed, and I proved it two independent ways rather than reading the SUMMARY.** Every enumerated must-have is now VERIFIED. The status is `human_needed`, not `passed`, for one reason only: three items require a human (two taste/legibility calls and one race branch no test executes). None of the three is a code defect.

### Score accounting — read this before comparing to the previous pass

Previous passes scored `13/14`, keeping the 27-03 concurrent-identity race *outside* the truth list as a separate "behavior-unverified" note. That understated the denominator. This pass counts it as truth #15, marked ⚠️ PRESENT_BEHAVIOR_UNVERIFIED, which is where the presence-vs-behavior rule says it belongs. So:

- `14/14` of the enumerated must-haves are VERIFIED (up from 13/14).
- `14/15` counting the 27-03 backstop as the truth it is.

This is a bookkeeping correction, not a regression. A clean `15/15` is not claimable, and I am not claiming it.

## Method note

Third pass, same doctrine, applied to the new fix. No 27-15-SUMMARY.md claim was accepted on trust. Every load-bearing assertion in the summary was independently re-derived from source, and both new tests were falsified — twice, from two different directions.

### Falsification probes run in-session (all reverted; `git diff` on `extension/` empty afterward)

| # | Probe | Change made | Result |
|---|---|---|---|
| 1 | Is the direct-share "broken" classification a REAL AEAD failure, or a malformed fixture / mocked rejection? | `buildRealDirectSharedRow(..., true)` → `..., false)` in the *corrupted* test (i.e. feed it the UNCORRUPTED payload) | Test went **RED** — `expected [ {…(10)} ] to deeply equal []`, the full decrypted `VaultItem` (`sharedToMe: true`, `isShared: true`, `revision: 1`, real `updatedAt`) materialized in `getItems()`. The row genuinely decrypts when un-tampered. The failure is corruption-dependent. |
| 2 | Does the test guard the PRODUCTION line, or just the fixture? | Deleted `markPending(row.id, null, "broken");` from `mergeDirectSnapshot`'s catch | **BOTH** guards went RED — the real-WASM corrupted test and `vault-store.test.ts` Test 22, `2 failed | 31 passed`. Genuine regression guards on the exact production statement. |

Probe 1 is the summary's own claimed falsification, reproduced independently. Probe 2 is mine, and it is the one that actually matters: probe 1 alone would pass even if the test asserted against a fixture rather than the fix.

The real-WASM failure message is Rust-side, not a JS throw: `[passkey-vault] failed to decrypt directly-shared item item-real-wasm-direct-1 decryption failed (wrong key or corrupted data)` — i.e. the WASM AEAD integrity check itself, exactly as claimed. `vault-store.real-wasm.test.ts` carries no `vi.mock` of `wasm-loader` (confirmed by reading the mock list at lines 51-95, and the file's own comment at line 95 says so deliberately).

## Task 1 — Is the direct-share fix real?

**Yes, on all three sub-checks.**

**(a) `markPending` is on the actual failure path.** `vault-store.ts:693-728`: the per-row `for (const row of response.items)` loop wraps `decryptDirectSharedRow(row, identityKey)` in its own `try`. The `catch` at 697 sets `anyRowFailed = true`, logs, and calls `markPending(row.id, null, "broken")` at **line 726** — inside the catch, before the loop continues. The success branch calls `clearPending(row.id)` at line 696. Both are on the real paths, not adjacent to them.

**(b) The real-WASM test genuinely corrupts ciphertext.** `corruptEncData` (lines 278-283) parses wasm-bindgen's own `{nonce: number[], ciphertext: number[]}` wire shape and mutates `ciphertext[0] = (ciphertext[0] + 1) % 256` — one byte, ciphertext only, nonce and JSON shape untouched. `buildRealDirectSharedRow` (293-313) uses real `WasmUserKey.generate()`, real `WasmIdentityKey.generate()`, real `encryptItem`, real `sealItemKeyForRecipient` against a real `WasmIdentityPublicKey.fromBytes(bob.publicKeyBytes())`, and corrupts **after** sealing — so the seal/unseal handshake is genuine even in the failing case, and only the payload is bad. `hoisted.mockDecryptItemWithSharedKey` is *not* used in this describe block; the production crypto runs. Probe 1 confirms the corruption is what causes the failure.

**(c) The stated discriminant reasoning is TRUE of the code.** This was the premise most worth attacking, because if it is false the "always broken, never pending" classification is wrong. It holds:

- `const identityKey = await ensureOwnIdentityKeypair(uk);` is at **line 684**. The per-row loop opens at **line 693**. The `await` genuinely precedes the loop, unconditionally, once per call, for every row in the pull. Not inside a branch, not lazily.
- The contrast with the collection path is accurate. `getCollectionKey()` is a *synchronous* read of a cache whose first refresh may not have completed, which is exactly why `CollectionKeyPendingError` exists and why `applySyncSnapshot` (line 511) and `mergeCollectionSnapshot` (line 607) compute a `pending` vs `broken` split gated on `hasRefreshedThisSession()`. There is no such lazily-populated cache on the direct path.
- Therefore a failure reaching the direct-share catch was already attempted with a fully-resolved identity key in hand — either a `sealed_key` that does not unseal under this recipient's key, or an `enc_data` whose AEAD check fails. Both terminal. Classifying `"broken"` immediately is correct, and classifying `"pending"` would be *wrong* (it would shimmer forever — the very UI-SPEC E2-error bug 27-12 fixed). I checked the inverse failure mode too: if `ensureOwnIdentityKeypair` itself rejects, the rejection propagates out of `mergeDirectSnapshot` to `doHandleSharedRevisions`'s `catch` at line 851, which sets `anyStepFailed = true` and withholds the watermark for retry — the transient case is handled at the correct level, above the loop, not misclassified inside it.

**(d) Widened type is coherent end-to-end.** `PendingSharedItemEntry.collectionId: string | null` (line 208). The single consumer that reads `collectionId` is `doHandleSharedRevisions`'s revoked-collection purge at line 817, `pendingSharedItems.filter((p) => p.collectionId !== knownId)` — `null !== knownId` is always true for a real collection id, so a direct-share stub is correctly never purged by collection revocation. Verified by reading the line, not the summary's claim about it. `ItemListView.tsx:524-560` renders the broken branch from `p.status` and `p.id` only (`key`, `role`, `aria-label`, icon, label) — no `collectionId` read anywhere in that branch, so the summary's "no popup change needed" is true rather than convenient. `npx tsc --noEmit` exits 0, so the widening did not silently break a consumer.

## Task 2 — Did `deferRealFree()` mask a production lifetime bug?

**No. It is a genuine test-cleanup collision. I checked the production ownership contract directly rather than taking the summary's word.**

`ensureOwnIdentityKeypair` (`identity-store.ts:65-104`) returns a **fresh, caller-owned handle on every path**:

- existing keypair → `unwrapIdentitySecretKey(uk, existing.wrapped_secret_key)` — new handle;
- `adopted_existing` race → `unwrapIdentitySecretKey(uk, response.wrapped_secret_key)` — new handle, and `freeOnError` deliberately stays `true` so the discarded local `isk` *is* freed by the `finally` (the comment at 92-94 states this, and the logic matches);
- fresh publish → `isk`, with `freeOnError = false` transferring ownership.

Every production consumer frees exactly one handle it owns:

| Consumer | Handle discipline | Verdict |
|---|---|---|
| `vault-store.ts:684` (`mergeDirectSnapshot`) | `finally { identityKey.free?.(); }` at 746 | ✓ frees its own fresh handle once |
| `collections-store.ts:161` | `finally` free, one resolution per refresh | ✓ same shape |
| `identity-store.ts:157` (`publishOnUnlock`) | `.then((isk) => isk.free?.())`; on rejection the inner `finally` already freed | ✓ documented and correct |
| `ensureIdentityKeypairHydrated` / `freeIdentityKey` | caches one handle, freed on lock | ✓ and it has **no production caller** today (grep across `extension/` excluding tests returns only its own definition), so it cannot collide with anything |

The double-free arose only because the *test's* mock (`mockEnsureOwnIdentityKeypair.mockResolvedValue(bob)`) returns the **same** `WasmIdentityKey` instance on every call — violating production's fresh-handle-per-call contract — so production's legitimate `free()` deallocated the handle the test's own `finally` then freed again. `deferRealFree` (lines 261-271) makes production's call a no-op and defers the single real free to a test-owned `.dispose()`. That is the correct fix for a fixture that shares one real handle across two owners, and it is the identical helper `web/src/lib/vault/store.real-wasm.test.ts` already uses at four call sites for the same shape — a pre-existing, documented pattern, not an invention to make a red test go green. Production's `finally { identityKey.free?.(); }` is correct and stays.

## Task 3 — Defect-class sweep

I enumerated **every** failure branch in `vault-store.ts` that handles a decrypt, plus the sibling merge/decrypt sites in `collections-store.ts` and `provider-ceremony.ts`. **No third instance.** Both shared read paths now record; the two remaining silent drops are non-shared surfaces with a stated reason.

| # | Site | What happens on failure | Records the row? | Verdict |
|---|---|---|---|---|
| 1 | `applySyncSnapshot` items catch, `CollectionKeyPendingError` branch (511-518) | `markPending(row.id, row.collection_id, "pending")` | ✓ | ✓ recorded |
| 2 | `applySyncSnapshot` items catch, generic branch (520-534) | `markPending(..., "broken")` **when `collection_id !== null`**; a personal row is dropped with a counted `console.warn` | ✓ for shared; ✗ for personal | ✓ **stated reason, and out of scope.** The prohibition names *shared* items. I confirmed the scope claim against the server rather than assuming: `fetch_items_for` (`vault.rs:402-421`) is `WHERE user_id = ?` on both UNION arms, so `/api/sync` returns only the caller's OWN items — a directly-shared-to-me row can never arrive here. The un-recorded drop is therefore genuinely personal-only, and the code says so in-comment (529-530). |
| 3 | `applySyncSnapshot` folders catch (547-551) | `skipped += 1`, console.warn, no stub | ✗ | ℹ️ Out of scope — folders are personal-only (`decryptFolderRow` takes `uk` only; there are no shared folders in this model). No inline reason given, unlike the item branch. Noted, not a gap. |
| 4 | `mergeCollectionSnapshot` catch (591-609) | `markPending(row.id, collectionId, pending\|broken)` | ✓ | ✓ recorded (27-12) |
| 5 | `mergeDirectSnapshot` catch (697-727) | `markPending(row.id, null, "broken")` | ✓ | ✓ recorded (27-15 — this pass's subject) |
| 6 | `collections-store.ts:200` — `sealed_key` fails to unseal | Collection Key stays unresolved; every item in that collection falls through to sites 1/4 above | ✓ indirectly | ✓ stated reason in-comment; the items are recorded downstream |
| 7 | `collections-store.ts:195` — collection NAME fails to decrypt | Falls back to the raw collection id | n/a — nothing is dropped | ✓ honest fallback, still visible |
| 8 | `doHandleSharedRevisions` step catches (801, 837, 851) | `anyStepFailed = true` → watermark withheld, bounded retry | n/a — no per-row drop | ✓ correct level for a transient failure |
| 9 | `provider-ceremony.ts:797-799` | Filters `undecryptable !== true` off the already-decrypted cache | n/a — does not decrypt | ✓ no drop of its own |

**Conclusion: no third instance.** Both shared-item read paths — collection-scoped (27-12) and direct (27-15) — now honor 27-04's prohibition identically.

## Task 4 — Regression pass

Every command run by me in this session, on a tree byte-identical to `HEAD` (`8c29be3`) after probe reverts.

| Check | Command | Result | Status |
|---|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0, no output | ✓ PASS |
| Full unit suite (run **once**) | `npm test` | **60 files, 767 tests passed** (was 764) | ✓ PASS |
| Real-WASM tier | `npx vitest run entrypoints/background/vault-store.real-wasm.test.ts` | 4 passed (was 2) | ✓ PASS |
| Rust workspace | `cargo test --workspace` | **0 failed** across all binaries (33/66/59/24/20/19/17/12/10/… + 4 doc-test targets) | ✓ PASS |
| Falsification probe 1 (fixture) | un-corrupt the payload | RED for the right reason | ✓ PASS |
| Falsification probe 2 (production) | delete `markPending` from the catch | 2 tests RED | ✓ PASS |
| Live: recipient read + TOTP + storage audit + write + fill event | `playwright --project=chromium e2e/dual-extension-sharing.spec.ts --retries=0` ×2 | 2/2 passed (9.6s, 9.4s) | ✓ PASS |
| Live: hidden_password + read-only | `playwright --project=chromium e2e/dual-extension-access-levels.spec.ts --retries=0` | 1 passed (6.9s) | ✓ PASS |
| Live: post-revocation staleness | `playwright ... e2e/dual-extension-revocation.spec.ts --retries=0` | 1 passed (55.2s) | ✓ PASS |
| Live headed shared-passkey ceremony | `playwright --project=chromium-ceremony e2e/dual-extension-ceremony.spec.ts --retries=0` | 1 passed (4.2s) | ✓ PASS |
| Tree clean after probes | `git diff --stat -- extension/` | empty | ✓ PASS |

Nothing from the earlier passes regressed. The Gap-5 flake did not reappear (2/2 this session on top of the previous pass's 8/8, so 10/10 cumulative at `--retries=0`).

*(Note: `--project=chromium-ceremony` without a file argument also picks up `e2e/store-screenshots.spec.ts`, which hard-throws unless `PV_DEMO_PASSWORD` is set. Not a phase defect — a publishing-asset spec — but worth knowing before someone runs the project bare and reads it as a failure.)*

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | **SC 1** — a shared login autofills exactly like a personal one through the existing fill pipeline unchanged, and TOTP codes generate correctly for shared items | ✓ VERIFIED | Re-run this session, 2/2 `--retries=0`. Positive byte-equality of the real DOM fill against fixture plaintext (`filledValues.u`/`.p`), plus `expect(candidates).toContain(returnedCode)` for TOTP. |
| 2 | **SC 2** — a shared passkey works through the passkey provider using the same item-wrap mechanism as any other item type | ✓ VERIFIED | Re-run this session: headed real `credentials.create()` + `credentials.get()` across two profiles, 1 passed (4.2s). |
| 3 | **SC 3** — signature-counter handling resolved by a documented spike, implemented so concurrent shared use does not trip SEC-04 | ✓ VERIFIED | `cargo test --workspace` re-run, 0 failed, incl. `pv-provider`'s wire-byte `signCount` regression; the live spec decodes `authenticatorData[33..37]` off a real assertion and asserts 0. |
| 4 | **SC 3 sub-claim** — a provider assertion structurally cannot reach the Phase 19 SEC-04 classifier (`verification: backstop`) | ✓ VERIFIED | Carried from pass 2's independent re-derivation (3 `handle_finish_auth_error` call sites, all pv-server vault ceremonies; `pv-provider` depends on neither `webauthn-rs` nor `sqlx` nor `pv-server`). Unchanged by 27-15 — no Rust touched. |
| 5 | **SC 4** — the background worker holds no newly-persisted secret types | ✓ VERIFIED | The live in-worker `chrome.storage.session.get(null)` enumeration passed again this session. |
| 6 | **SC 5** — the popup visually distinguishes shared items from personal ones | ✓ VERIFIED (visual quality → human) | One `SharedBadge.tsx` at 6 call sites. The broken row correctly *replaces* the badge with the AlertTriangle treatment rather than inventing a second visual language. |
| 7 | **27-04 prohibition** — a shared item the user has access to is never silently dropped with no trace | ✓ VERIFIED (was ✗ FAILED) | **Closed on the last remaining path, and falsification-tested from both directions.** `mergeDirectSnapshot`'s catch calls `markPending(row.id, null, "broken")` (line 726) with `clearPending` on success (696). Deleting that one line turns two independent tests RED. The classification reasoning is verified true of the code (`await` at 684 genuinely precedes the loop at 693), not merely asserted. Sweep of all 9 decrypt/merge failure branches finds no third instance. |
| 8 | **27-07 prohibition** — capture-handler never falls back to the personal User Key for a collection-scoped write | ✓ VERIFIED | Code unchanged; re-run live this session — member B's write on a `read`-level item is refused and member A's old password is still byte-identical. |
| 9 | **27-11 truth** — a member revoked mid-session loses shared items on the NEXT sync poll | ✓ VERIFIED | Re-run this session, `--retries=0`, first attempt (55.2s). |
| 10 | **27-11 truth** — member B's capture-confirmed write is collection-scoped and member A reads back the exact new plaintext | ✓ VERIFIED | Re-run 2/2 as part of the sharing spec. |
| 11 | **UI-SPEC E1-error backstop** — the retain-vs-drop decision is made explicitly, not inherited | ✓ VERIFIED | The decision is restated and now extended a third time in place (`getPendingSharedItems()` doc comment, 310-353, incl. the new 27-15 paragraph). |
| 12 | **UI-SPEC E2 backstop** — pending row shape unchanged for a genuinely pending entry | ✓ VERIFIED | The `status !== "broken"` sub-branch (ItemListView.tsx:549-559) is byte-identical to the previously-verified markup — skeleton, `SharedBadge` retained, `role="status"`, no alert styling. |
| 13 | **UI-SPEC E2-error backstop** — no code path where a pending row shimmers indefinitely | ✓ VERIFIED | Carried from pass 2 (upsert `markPending`, discriminant crosses the boundary via `ext-protocol.ts:396`, terminal AlertTriangle render, false "last known version" copy removed PL+EN) — and now **strengthened**: the direct path can no longer produce a shimmering-forever row either, because it never emits `"pending"` at all. |
| 14 | **27-06 backstop** — an MV3-wake ceremony must not present a partial candidate list as complete | ✓ VERIFIED | Carried from pass 2, falsification-tested there (deleting the two awaits turned both guards RED). Untouched by 27-15; `provider-ceremony.ts:773-774` re-read this session, unchanged. |
| 15 | **27-03 backstop** — a genuinely concurrent first unlock yields exactly ONE published identity keypair; the race loser adopts the winner's blob | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Present and wired — `identity-store.ts:89`'s `adopted_existing` branch exists, correctly re-unwraps the server's canonical blob, and its `freeOnError`-stays-true comment is accurate (I re-read it this pass while checking the free contract, so this is a fresh read, not a carry-forward). But it is a **state-transition invariant executed by no test**: all three `identity-store.real-wasm.test.ts` fixtures return `adopted_existing: false`. Presence is not behavior. → human verification. |

**Score:** 14/15 truths verified (0 failed, 1 present-but-behavior-unverified). Of the 14 enumerated must-haves, 14/14.

### Deferred Items

None. Phase 27 is the final phase of the v0.4 milestone — there is no later phase to defer to, which is precisely why the direct-share gap had to be closed rather than scheduled.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `extension/entrypoints/background/vault-store.ts` | 3-source merge, scope dispatch, pending/broken discriminant on **both** shared paths, shared hydration barrier | ✓ VERIFIED (was ⚠️) | 1136 lines. `PendingSharedItemEntry.collectionId: string \| null`, upsert `markPending`, `clearPending` on both success branches, `ensureSharedItemsHydrated`, `initialSharedSettled` all present and wired. `mergeDirectSnapshot` is no longer un-instrumented. |
| `extension/entrypoints/background/vault-store.real-wasm.test.ts` | Real-crypto proof for **both** broken classifications | ✓ VERIFIED | 388 lines, 4 tests, no `wasm-loader` mock; loads real WASM. Collection path proven with a genuinely WRONG key, direct path with a genuinely CORRUPTED ciphertext byte — the two distinct ways an AEAD check fails, deliberately not the same shape twice. |
| `extension/entrypoints/background/vault-store.test.ts` | Mocked-dispatch mirror for the direct path | ✓ VERIFIED | Test 22 (742-777) asserts `{id, collectionId: null, status: "broken"}` and explicitly asserts the status is never `"pending"` — the discriminant claim is pinned by an assertion, not only by a comment. |
| `extension/entrypoints/background/identity-store.ts` | Fresh-handle-per-call ownership contract | ✓ VERIFIED | Re-read in full this pass for Task 2. All three return paths hand back a fresh owned handle; every consumer frees exactly once. |
| `extension/entrypoints/background/provider-ceremony.ts` | Resolution barrier before the candidate snapshot | ✓ VERIFIED | Two awaits at 773-774, unchanged. |
| `extension/lib/messaging/ext-protocol.ts` | `pending` carries the discriminant | ✓ VERIFIED | Type-only import of `PendingSharedItemEntry` (D-05 boundary honored); the widened `collectionId` propagates with no consumer break (`tsc` exit 0). |
| `extension/entrypoints/popup/ItemListView.tsx` | Broken row degrades instead of shimmering | ✓ VERIFIED | 524-560; renders from `{id, status}` only — genuinely no change needed for the direct path, as predicted. `pending.length` still widens the empty-state gate, so a broken-only vault never renders "empty". |
| `extension/lib/i18n/dictionary.ts` | Honest copy | ✓ VERIFIED | `sharing.sharedItemBrokenLabel` present; false "last known version" clause removed PL+EN. |
| `extension/e2e/*.spec.ts` (sharing, access-levels, revocation, ceremony) | Live proofs | ✓ VERIFIED | All re-run green this session at `--retries=0`. Now tracked in git (the working-tree modifications present at the start of pass 2 are committed). |
| `crates/pv-provider/src/ceremony.rs` / `tests/response_shape.rs` | EXT-10 record + regression | ✓ VERIFIED | Unchanged; `cargo test --workspace` 0 failed. |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `mergeDirectSnapshot` failure | `getPendingSharedItems()` | `markPending(row.id, null, "broken")` at vault-store.ts:726 | ✓ **WIRED (was ✗ NOT_WIRED — this was the blocker)** |
| `mergeDirectSnapshot` success | pending-stub cleanup | `clearPending(row.id)` at vault-store.ts:696 | ✓ WIRED (new) |
| `markPending` | `ItemListView.tsx` broken row | `getPendingSharedItems()` → `router.ts` → `vault.list.pending[].status` → `p.status === "broken"` branch | ✓ WIRED — now fed by **both** shared paths |
| `PendingSharedItemEntry.collectionId: null` | revoked-collection purge | `p.collectionId !== knownId` at vault-store.ts:817 — `null` never matches, so direct stubs survive collection revocation | ✓ WIRED (correct by construction, verified by reading the predicate) |
| `handleCredentialsGet` candidate snapshot | shared-key resolution barrier | `await ensureItemsHydrated()` + `await ensureSharedItemsHydrated()` at provider-ceremony.ts:773-774 | ✓ WIRED |
| `ensureVaultSyncStarted` → `initialSharedSettled`; lock → `initialSharedSettled = null` | | vault-store.ts:1111 | ✓ WIRED |
| All previously-verified links (unlock→publishOnUnlock, sync→handleSharedRevisions, lock→freeAllCollectionKeys/freeIdentityKey, vault.list.collections→popup, confirmUpdateLogin→live write proof) | | | ✓ WIRED — regression-checked, unchanged |

### Behavioral Spot-Checks

See Task 4's table above — all 12 checks PASS, all run by me in this session.

### Probe Execution

No `scripts/*/tests/probe-*.sh` exist in this repo and no PLAN/SUMMARY for this phase declares one. Verification for this phase runs through the Vitest / Cargo / Playwright tiers exercised above. **Step 7c: SKIPPED (no probes declared or discoverable).**

### Requirements Coverage

| Requirement | Status in REQUIREMENTS.md | Verifier assessment | Evidence |
|-------------|---------------------------|---------------------|----------|
| EXT-07 | Complete | ✓ Supported | Live fill event, positive byte-equality, re-run 2/2 (truth 1) |
| EXT-08 | Complete | ✓ Supported | Live TOTP byte-equality (truth 1) |
| EXT-09 | Complete | ✓ Supported | Verifier-run headed ceremony (truth 2) |
| EXT-10 | Complete | ✓ Supported | Spike record + Rust wire-byte regression + live measurement + re-derived SEC-04 unreachability (truths 3, 4) |
| EXT-11 | Complete | ✓ Supported | Live in-worker `chrome.storage.session` enumeration (truth 5) |
| EXT-12 | Complete | ✓ Supported (visual quality → human) | One `SharedBadge` at 6 call sites (truth 6) |
| KEY-01 | `[x]`, **Complete** in traceability table (line 134) | ✓ Supported | `publishOnUnlock` wired at the single `setUnlockedUserKey` choke point; `ensureOwnIdentityKeypair` real-WASM tested and its handle contract re-verified in full this pass. The `adopted_existing` race branch remains behavior-unverified (truth 15) — that is a *coverage* gap, not a correctness claim I am disputing. |

**Orphan check:** the only requirements the traceability table maps to Phase 27 are EXT-07…EXT-12 (plus KEY-01, shared with Phases 21/22/26). Every one is claimed by a Phase 27 plan. **No orphaned requirements.** `SHARE-01/02/03` remain `[ ]`/Pending but are mapped to **Phase 26**, not 27 — outside this phase's contract, and I am not asserting anything about them here.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `vault-store.ts`, `vault-store.test.ts`, `vault-store.real-wasm.test.ts` | — | `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` | — | **None found.** Debt-marker gate: clean on all three files modified by 27-15. |
| `vault-store.ts` | 296, 817, 1125 | Stale pending stub is never pruned when a shared row *disappears* from a later snapshot | ⚠️ Warning | **New observation this pass, and I want it on the record even though it does not change the verdict.** `pendingSharedItems` is mutated in exactly 5 places: `markPending` (296/298), `clearPending` by id (306), the revoked-**collection** purge (817), and the lock reset (1125). `clearPending` only fires for a row *present* in the current snapshot. So a row that was recorded `"broken"` and is then **unshared/revoked individually** (a direct share revoked, or an item removed from a collection the user still belongs to) leaves its stub behind — the popup renders a phantom "Failed to decrypt shared item" row until the next lock. This is the *inverse* of the prohibition (a phantom, not a silent drop), so it does not falsify truth 7. It leaks nothing: the entry is `{id, collectionId, status}` with no plaintext and no name. It is **pre-existing from 27-04/27-12, not introduced by 27-15** — 27-15 merely extends the same array to a second path. Suggested follow-up for the next milestone: prune `pendingSharedItems` of ids absent from the merged snapshot, in the same place `directSharedItems`/`collectionSharedItems` are replaced. |
| `vault-store.ts` | 547-551 | Folder decrypt failure drops with a counter + `console.warn` and no stated reason | ℹ️ Info | Folders are personal-only (`decryptFolderRow` takes `uk` alone); outside the shared-item prohibition. Unlike the sibling item branch, this one carries no inline rationale. Cosmetic. |
| `provider-ceremony.ts` | 785 | Comment enumerates "`applySyncSnapshot`/`mergeCollectionSnapshot`" as the exhaustive set of per-row catch branches | ℹ️ Info | Stale since 27-15 added a third (`mergeDirectSnapshot`). The comment's actual *claim* — that no undecryptable row ever reaches `getItems()` — remains true of all three. Comment-only. |
| `.planning/ROADMAP.md` | 327, 396 | Phase 27 reads `14/14 plans executed` and `In Progress` while `STATE.md` records 27-15 as complete | ℹ️ Info | Bookkeeping only — 27-15 was a direct fix with a SUMMARY and no PLAN, so the plan count is arguably correct; the `In Progress` status is the stale part. Not a goal-achievement issue. |

### Human Verification Required

**Update (27-16, 2026-08-09):** Item 3 below (`adopted_existing` race) is now CLOSED — real-WASM automated coverage added (`identity-store.real-wasm.test.ts`, falsification-tested), removed from this report's `human_verification` frontmatter array accordingly. Items 1 and 2 remain genuinely open: they are visual/taste judgments, not something an executor can self-approve. Live screenshots were captured for both (see each item's `evidence` field above and the `Evidence` line below) so Bartek can judge in seconds rather than reproduce the live state himself.

Two items remain. Neither is a code defect; both are carried forward deliberately so Bartek knows exactly what is left.

#### 1. Shared-badge visual quality

**Test:** Open the popup on an account with a mix of shared and personal items. Inspect the shared badge on the "Wszystkie" rows, the "Na tej stronie" rows, the item detail header, and a provider-ceremony candidate row.
**Expected:** The people-glyph badge reads as a shared marker at popup width without crowding the icon tile; personal rows look untouched.
**Why human:** ROADMAP SC 5 ("visually distinguishes") is a visual claim. Component tests assert markup, not legibility. Code-side this is as good as it gets — one component, six call sites, zero re-derivation.
**Evidence:** `extension/.playwright-mcp/uat-27/shared-badge.png` (380px popup width, live two-extension harness, badged shared rows directly beside unbadged personal rows for direct comparison). Not self-approved.

#### 2. Broken-row legibility and copy

**Test:** Open the popup on a vault containing a genuinely broken shared row. Both paths now produce one: a wrong-key collection item, or a corrupted directly-shared item (new since 27-15). Read the degraded row.
**Expected:** A static AlertTriangle row reading "Failed to decrypt shared item", non-clickable, no shimmer; its tooltip/aria text no longer claims a last known version is being shown.
**Why human:** The row's legibility and the corrected PL/EN wording are taste calls. `ItemListView.test.tsx` Test 20 asserts markup and non-interactivity (it fires a click and proves `onSelectItem` is never called), not readability.
**Evidence:** `extension/.playwright-mcp/uat-27/broken-row.png` (380px popup width, live two-extension harness — a real shared item's ciphertext corrupted directly in `data/pv.db`, one AEAD byte, restored and verified byte-identical afterward). Not self-approved. A third, optional neutral-pending-skeleton screenshot was attempted for side-by-side contrast but the real Collection-Key resolution window proved too narrow to reliably capture live on this single-machine harness (sub-~1s, even under CDP-throttled network) — skipped rather than faked.

#### 3. Concurrent first-unlock identity race (`adopted_existing`) — CLOSED by 27-16

**Test:** Trigger a genuinely concurrent first unlock — web app and extension, on an account with no published identity keypair — and compare the published public key before and after both settle.
**Expected:** Exactly one keypair published; both clients end up holding the same secret key; no Collection Key ever sealed to the loser's discarded public half.
**Resolution:** `extension/entrypoints/background/identity-store.real-wasm.test.ts` now has a real-WASM test ("concurrent first-unlock race: adopts the server's already-published keypair instead of overwriting it") that simulates the server already holding a published keypair at publish time and asserts the loser's `ensureOwnIdentityKeypair` call adopts the winner's blob: byte-identical public key before/after, the discarded local candidate freed exactly once, no second publish. Falsification-tested — disabling the adopt branch (`if (response.adopted_existing)` short-circuited to `false`) turned the test RED for the right reason (public key mismatch: the losing client's own overwritten candidate, not the winner's), confirmed clean revert via `git diff`, re-verified green. This is no longer a human-verification item.

### Gaps Summary

**None.** The single blocker from pass 2 — `mergeDirectSnapshot`'s trace-free silent drop of an undecryptable directly-shared row — is closed, and closed properly: the fix is on the real failure path, the discriminant reasoning is true of the code rather than merely asserted in a comment, the proof uses real WASM against a genuinely tampered ciphertext byte, and deleting the one production line turns two independent tests red. The `deferRealFree` port fixes a test fixture that violated production's fresh-handle-per-call contract; production's own free discipline is correct and unchanged. A sweep of all nine decrypt/merge failure branches across `vault-store.ts`, `collections-store.ts`, and `provider-ceremony.ts` finds no third instance of the defect class — both shared read paths now record, and the two remaining un-recorded drops are personal-only surfaces outside the prohibition's scope, one of which states its reason in-comment and the other of which I confirmed against the server's own query scope rather than assuming.

What remains is one ⚠️ warning worth a follow-up ticket (stale pending stubs are never pruned on individual unshare/revoke — a phantom row, not a drop, leaking nothing, pre-existing) and three human items: two taste calls and one race branch that no test executes. The phase goal is achieved.

---

_Verified: 2026-08-09T11:43:25Z_
_Verifier: Claude (gsd-verifier) — third pass_
