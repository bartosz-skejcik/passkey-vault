---
phase: 27-extension-integration-shared-items
verified: 2026-08-09T09:30:00Z
status: gaps_found
score: 10/14 must-haves verified
behavior_unverified: 2
overrides_applied: 0
gaps:
  - truth: "UI-SPEC E2-error backstop: there is no code path where a pending shared row shimmers indefinitely — it must eventually resolve to real content or degrade explicitly into the genuine-failure treatment"
    status: failed
    reason: "Affirmatively disconfirmed against real code, not merely unverified. vault-store.ts never sets `undecryptable: true` on any VaultItem. Every collection-scoped decrypt failure — transient (CollectionKeyPendingError) AND genuinely broken (Collection Key resolved, AEAD integrity check failed after hasRefreshedThisSession()) — is dropped from `items` and recorded in the SAME untyped `pendingSharedItems` array. getPendingSharedItems() returns `{id, collectionId}` with no pending-vs-broken discriminant, and no `hasRefreshedThisSession()` signal reaches the popup. ItemListView.tsx renders every `pending` entry as a neutral skeleton with no exit condition. A permanently-undecryptable shared row therefore shimmers forever — precisely the 'infinite silent skeleton is itself the silent omission this state exists to avoid' the backstop forbids. The E1-error degraded-row branch (ItemListView.tsx:436) and the E3-error banner (ItemDetailView.tsx:214) that would render the honest treatment are both gated on `item.undecryptable === true` and are dead code in production — the code comments say so explicitly."
    artifacts:
      - path: "extension/entrypoints/background/vault-store.ts"
        issue: "markPending() (lines 265-269) records pending and broken into one array with no classification; `undecryptable: true` is never set anywhere in the module (decryptItemRow returns no such field, and no retain-last-known-good copy exists)"
      - path: "extension/lib/messaging/ext-protocol.ts"
        issue: "vault.list's `pending: { id: string; collectionId: string }[]` carries no pending-vs-broken discriminant across the popup boundary"
      - path: "extension/entrypoints/popup/ItemListView.tsx"
        issue: "lines 511-529 render every `pending` entry as an unbounded skeleton; lines 415-433's own comment concedes the degraded branch is 'currently dead in production'"
    missing:
      - "A pending-vs-broken discriminant on getPendingSharedItems()'s entries (hasRefreshedThisSession() is already the architectural signal UI-SPEC §4 names) plumbed through vault.list"
      - "ItemListView must route a 'broken' entry to the E1-error degraded treatment instead of the E2 skeleton — OR vault-store must retain a last-known-good VaultItem with undecryptable:true (web's shape), which would also make the already-wired E1-error/E3-error branches live"
      - "Corrected copy for sync.itemUndecryptableWarning if the drop discipline is kept: it currently claims 'Showing the last known version', which is false in the extension (no copy is retained)"
  - truth: "27-06 backstop: a provider ceremony triggered during the MV3-wake window, before Collection Keys have resolved, must not present a partial candidate list that silently omits eligible shared passkeys — it either awaits resolution or falls through, never shows an incomplete picker as if complete"
    status: failed
    reason: "Unaddressed in code, in tests, and in every SUMMARY. handleCredentialsGet (provider-ceremony.ts:747) awaits only ensureHydrated() — which resolves the User Key from chrome.storage.session and nothing more. It never awaits ensureItemsHydrated() (that gate exists and is used, but only by router.ts:412's capture.propose path) and never consults hasRefreshedThisSession() or getPendingSharedItems(). It then snapshots `findMatchingPasskeyItems(getItems(), rpId)` at t=0 of the wake, BEFORE awaitCeremonyConsent. On a cold MV3 wake where a personal passkey matches the RP but a shared one for the same RP is still pending its Collection Key, the picker renders the personal candidate alone as if the list were complete — the exact shape the backstop forbids. The zero-candidate case falls through (acceptable); the PARTIAL case does not. 27-06-SUMMARY.md's coverage block (D1-D5) does not mention this truth at all."
    artifacts:
      - path: "extension/entrypoints/background/provider-ceremony.ts"
        issue: "handleCredentialsGet (lines 736-782) gates on ensureHydrated() only; candidate snapshot at line 776 has no shared-resolution barrier"
    missing:
      - "A resolution barrier before the candidate snapshot — await ensureItemsHydrated() plus a hasRefreshedThisSession() check (or a bounded wait on refreshCollectionsNow()), then either present the complete list or fall through"
      - "A regression test for the partial case: personal candidate present + shared candidate pending -> must not render the picker as complete"
behavior_unverified_items:
  - truth: "ROADMAP SC 1 (first clause): a shared login autofills in the extension exactly like a personal one through the existing fill pipeline unchanged"
    test: "In a live two-extension run, navigate member B to a page whose origin matches the shared login, open the popup's 'Na tej stronie' section, click Fill on the SHARED row, and read the page's own input values"
    expected: "The page's username/password inputs carry member A's shared plaintext — an observed DOM fill, not merely a popup row rendering"
    why_human: "27-04-PLAN.md flagged this as an unresolved probe edge and refused to treat it as closed. The structural chain is strong and independently confirmed here (fill-dom.ts is absent from the phase diff; handleAutofillFill does getItems().find() with zero collectionId/accessLevel narrowing; the live spec proves shared items are present in getItems()), but no live proof exercises the fill event itself. dual-extension-sharing.spec.ts's TOTP proof dispatches autofill.totpCode directly rather than driving a fill, and 27-11's write proof drives capture, not fill."
  - truth: "27-03 backstop: a genuinely concurrent first unlock from the web app and the extension results in exactly ONE published identity keypair — the publish is conditional and the race loser re-reads and unwraps the winner's blob rather than overwriting it"
    test: "Trigger a genuine concurrent first unlock (web app and extension, account with no published identity keypair) and compare the published public key before/after both settle"
    expected: "Exactly one keypair published; both clients end up holding the same secret key; no Collection Key sealed to the loser's discarded public half"
    why_human: "identity-store.ts's `adopted_existing` branch (line 89) is the whole race-resolution mechanism, and all three identity-store.real-wasm.test.ts fixtures return `adopted_existing: false` — the branch is never executed by any test. The extension is, by this phase's own framing, the second concurrent device that makes this race real for the first time. Presence + code-read only."
human_verification:
  - test: "Open the popup on an account with a mix of shared and personal items; inspect the shared badge on the 'Wszystkie' rows, the 'Na tej stronie' rows, the detail header, and a provider ceremony candidate row"
    expected: "The people-glyph badge reads as a shared marker at popup width without crowding the icon tile, and personal rows look untouched (ROADMAP SC 5 is a visual claim)"
    why_human: "Visual/taste judgment; component tests assert markup, not legibility"
  - test: "Live two-extension run where member A grants member B `hidden_password` (not `edit`) on a shared login; open that item in B's popup detail view, then autofill it on a matching page"
    expected: "Password renders as the 10-dot mask with no reveal and no copy affordance, the three-claim honesty note renders beneath it, and autofill on the page still fills the real password"
    why_human: "Zero live coverage exists: both e2e fixtures (fixtures-account-setup.ts:471, :809) grant `access_level: \"edit\"` only, and no e2e file mentions hidden_password. UX-4's mask is proven only by ItemDetailView.test.tsx, which hand-supplies accessLevel. This is the exact shape of Phase 26's second shipped-but-broken feature (hidden_password protected nothing while the UI claimed it did). Partially mitigated: the live write proof implicitly confirms getCollectionAccessLevel() returns the server's exact `\"edit\"` string, so the vocabulary plumbing is live-correct for at least one level."
  - test: "Live run where member B holds `read` access on a shared login, then submits a changed password on that origin and confirms the save toast"
    expected: "The write is refused with an honest message before any encrypt call (ReadOnlyAccessError), and member A's copy is unchanged"
    why_human: "Same fixture gap — 27-07's read-only refusal is proven only by capture-handler.test.ts, which vi.mock()s lib/crypto/wasm-loader and can assert control flow only"
---

# Phase 27: Extension Integration — Shared Items — Verification Report

**Phase Goal:** Shared items work identically to personal ones across autofill, TOTP, and the passkey provider in the extension, with the concurrent-shared-passkey signature-counter question resolved by an explicit design spike rather than assumed.
**Verified:** 2026-08-09
**Status:** gaps_found
**Re-verification:** No — initial verification

## Method note

Per 27-VALIDATION.md's non-negotiable evidence rule, no green unit result was accepted as evidence for a crypto-adjacent claim. Every live proof below was **executed by the verifier in this session** against the already-running `pv-server` on `127.0.0.1:8620` and the already-built `.output/chrome-mv3` — SUMMARY-reported pass status was not taken on trust.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | **SC 1** — a shared login autofills exactly like a personal one through the existing fill pipeline unchanged, and TOTP codes generate correctly for shared items | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | **TOTP half VERIFIED live** (verifier-run): `dual-extension-sharing.spec.ts` dispatches `autofill.totpCode` for member B's *shared* TOTP item and asserts the returned code is in an independently-computed bounded `{current, previous}` window — `expect(candidates).toContain(returnedCode)`, a positive byte-equality assertion, not an absence guard. **Autofill half not observed:** `fill-dom.ts` is confirmed absent from the phase diff and `handleAutofillFill` (autofill-match.ts:299) does `getItems().find()` with zero scope narrowing, but no live proof exercises an actual DOM fill of a shared item. 27-04-PLAN.md flagged exactly this as an unresolved probe edge. |
| 2 | **SC 2** — a shared passkey works through the passkey provider on third-party sites using the same item-wrap mechanism as any other item type | ✓ VERIFIED | `dual-extension-ceremony.spec.ts` **run by verifier, headed, 2/2 green** (`--retries=0`). Member A creates a passkey via a real `credentials.create()`; it is moved into a collection member B has access to; member B — who never registered it — completes a real `credentials.get()` and `expect(getResult.id).toBe(createdCredentialId)`. Corroborated independently: `data/pv.db` `vault_items` gained collection-scoped rows at 09:14:32 and 09:15:08 UTC matching the two runs, so the ceremony genuinely created and moved a real item. |
| 3 | **SC 3** — signature-counter handling resolved by a documented spike, implemented so concurrent shared use does not trip SEC-04 — verified live with two members' extensions | ✓ VERIFIED | Three independent tiers, all confirmed by the verifier: (a) **decision record** — `crates/pv-provider/src/ceremony.rs:137-200` + a Key Decisions row in `.planning/PROJECT.md:150`, committed at `8f5a228` *before* any dependent code; (b) **permanent regression** — `cargo test -p pv-provider --test response_shape` → `sign_count_is_always_zero_for_a_provider_ceremony_assertion ... ok` (3/3 in file); (c) **live wire measurement** — the headed spec decodes `authenticatorData` bytes 33-36 big-endian off member B's *real* browser-returned assertion and asserts `signCount === 0`. Anti-goal honored: no per-item counter anywhere in the phase diff. |
| 4 | **SC 3 sub-claim** — a provider assertion structurally cannot reach the Phase 19 SEC-04 classifier (`verification: backstop`) | ✓ VERIFIED | **Independently confirmed, not accepted from the record.** `grep -rn handle_finish_auth_error crates/` returns exactly 3 call sites — `passkeys.rs:269`, `passkeys.rs:552`, `auth.rs:575` — all inside pv-server's own vault login/unlock ceremonies against the `passkeys` table. `crates/pv-provider/Cargo.toml` `[dependencies]` contains no `webauthn-rs`, `sqlx`, or `pv-server`; `webauthn-rs = "0.5"` appears only under `[dev-dependencies]`. The paths cannot meet. |
| 5 | **SC 4** — the background worker holds no newly-persisted secret types; identity key and Collection Keys are re-derived from the User Key on every MV3 wake | ✓ VERIFIED | **Live enumeration**, not inference: the sharing spec dumps member B's real `chrome.storage.session.get(null)` from inside the service worker *after* identity unwrap, Collection Key unseal, shared merge and a reveal, and asserts the observed key set contains nothing outside the pre-Phase-27 allow-list and nothing matching `/identity\|collection\|sealed/i`. Corroborated structurally: `collections-store.ts:82` (`Map` in module scope) and `identity-store.ts:109` (`cachedIdentityKey`) are memory-only with no `chrome.storage.*` write anywhere; `vault-store.test.ts` Test 4 asserts the literal call order `["stopSync", "freeAllCollectionKeys", "freeIdentityKey"]`, closing A-3/Pitfall 4. |
| 6 | **SC 5** — the popup visually distinguishes shared items from personal ones | ✓ VERIFIED | One `SharedBadge.tsx` (47 lines, real geometry per UI-SPEC) consumed at all five surfaces without re-derivation: `ItemListView.tsx:484`, `ItemListView.tsx:521`, `ItemDetailView.tsx:196`, `AutofillItemRow.tsx:92`, `TotpFillRow.tsx:141`, `ProviderCeremonyView.tsx:302`. Shared rows also carry the folder-name subtitle with an honest per-type fallback (never a raw UUID, never blank). Visual quality routed to human verification. |
| 7 | **27-04 prohibition** — a shared item the user has access to is never silently dropped with no trace | ✓ VERIFIED | Every collection-scoped decrypt failure calls `markPending()` (`vault-store.ts:468, 482, 549`), `getPendingSharedItems()` is exposed through `router.ts:560` into `vault.list`, and `ItemListView.tsx:133/349/511` consumes it — including widening the empty-state gate so a pending-only vault does not render "empty". *(The row is surfaced; that it can never leave the skeleton state is gap #1, tracked separately.)* |
| 8 | **27-07 prohibition** — capture-handler never falls back to the personal User Key for a collection-scoped write | ✓ VERIFIED | `capture-handler.ts:246-256`: `collectionId == null` → `encryptItem(uk, ...)`; otherwise `getCollectionKey()` and a hard `throw new CollectionKeyUnavailableError(...)` on `undefined` — no fallback branch exists. The read-only gate (`:233-239`) runs *before* plaintext is built, fails closed on any level other than `edit`/`hidden_password`. |
| 9 | **27-11 truth** — a member revoked mid-session loses the shared items on the NEXT sync poll, not on the next lock/unlock | ✓ VERIFIED | `dual-extension-revocation.spec.ts` **run by verifier: 1 passed (1.1m)**, first attempt, no retry. Presence asserted first (both shared item names visible), then revocation via the real `DELETE .../access/{user_id}`, then absence — the correct presence-then-absence discipline, not a vacuous absence-only guard. Mechanism confirmed in code: `collections-store.ts:214-220` (WR-02 eviction) + `vault-store.ts:725-732` (watermark/item/pending purge). |
| 10 | **27-11 truth** — member B's capture-confirmed write is collection-scoped, and member A reads back the exact new plaintext with zero read-side changes | ✓ VERIFIED | The phase's only real-crypto WRITE-path evidence, and it is a positive assertion: the live spec drives the genuine content-script capture → toast-confirm → `confirmUpdateLogin` path, then reopens member A's popup and asserts `getByText(newCapturePassword, { exact: true })` is visible. Real `encryptItemForCollection` → real `decryptItemForCollection` across two independent browser profiles. |
| 11 | **UI-SPEC E1-error backstop** — the retain-vs-drop decision for a shared row that never decrypted is made explicitly, not inherited | ✓ VERIFIED | Stated, not defaulted: `vault-store.ts:279-304` (`getPendingSharedItems()`'s doc comment) and `ItemListView.tsx:415-433` both record the decision and its reasoning in place. The backstop's own wording permits keeping the drop provided it is a stated decision. |
| 12 | **UI-SPEC E2 backstop** — pending row shape: fixed-footprint skeleton, badge retained, non-interactive, `role="status"`, neutral shimmer never alert styling | ✓ VERIFIED | `ItemListView.tsx:511-529` matches the spec exactly — non-interactive `<div>` (never a `<button>`), `role="status"` with `sharing.sharedItemLoadingAria`, `skeleton h-8 w-8` icon + two stacked bars, `SharedBadge` retained, sorted last, no warning classes. Pinned by `ItemListView.test.tsx`. |
| 13 | **UI-SPEC E2-error backstop** — no code path where a pending row shimmers indefinitely | ✗ FAILED | See gap #1. Disconfirmed against real code. |
| 14 | **27-06 backstop** — an MV3-wake ceremony must not present a partial candidate list as complete | ✗ FAILED | See gap #2. Unaddressed in code and evidence. |

**Score:** 10/14 truths verified (2 present, behavior-unverified; 2 failed)

### Deferred Items

None. Phase 27 is the final phase of the v0.4 milestone (ROADMAP.md ends at Phase 27), so no later phase can absorb these gaps.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `extension/entrypoints/background/collections-store.ts` | Collection Key cache, WR-02 eviction, memory-only | ✓ VERIFIED | 253 lines, real port; no lock listener of its own (Pitfall 4 honored) |
| `extension/entrypoints/background/identity-store.ts` | Idempotent KEY-01 primitive + MV3 wake cache | ✓ VERIFIED | 166 lines; wired at the single choke point `vault-session.ts:192` |
| `extension/entrypoints/background/vault-store.ts` | 3-source merge + scope dispatch | ✓ VERIFIED | 358 → 988 lines; `recomputeItems()` merges all three sources; `decryptItemRow` dispatches on `collection_id` and fails loud |
| `extension/entrypoints/background/vault-api.ts` | Shared-fetch wire types/functions | ✓ VERIFIED | +148 lines; `getCollectionSync` / `getSharedDirectSync` / `getSharedRevisions` / identity keypair endpoints |
| `extension/entrypoints/popup/SharedBadge.tsx` | Single badge component | ✓ VERIFIED | 47 lines, 6 call sites, zero re-derivation |
| `crates/pv-provider/src/ceremony.rs` (EXT-10 record) | Doc-comment decision record | ✓ VERIFIED | Lines 137-200, committed before dependent code |
| `crates/pv-provider/tests/response_shape.rs` | Permanent signCount invariant test | ✓ VERIFIED | Runs green; decodes raw wire bytes, not the Rust `Option<u32>` |
| `extension/e2e/two-context-spike.spec.ts` | Two-profile isolation proof | ✓ VERIFIED | Verifier-run: 1 passed (2.0s) |
| `extension/e2e/dual-extension-sharing.spec.ts` | Recipient-side read + TOTP + storage audit + write round trip | ⚠️ VERIFIED (flaky) | Passes, but see WARNING below |
| `extension/e2e/dual-extension-ceremony.spec.ts` | Live headed shared-passkey ceremony + signCount | ✓ VERIFIED | Verifier-run 2/2 green |
| `extension/e2e/dual-extension-revocation.spec.ts` | Live post-revocation staleness | ✓ VERIFIED | Verifier-run, first attempt |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `vault-session.ts::setUnlockedUserKey` | `identity-store.ts::publishOnUnlock` | fire-and-forget at line 192, the single unlock choke point (A-4) | ✓ WIRED |
| `vault-store.ts::ensureVaultSyncStarted` | `refreshCollectionsNow()` + `refreshSharedItemsNow()` | same `syncStarted` gate, lines 902-903 | ✓ WIRED |
| `sync-client.ts` poll/WS tick | `vault-store.ts::handleSharedRevisions` | `onSharedRevisions` callback (`sync-client.ts:129` ← `vault-store.ts:875`) | ✓ WIRED — closes STATE.md's [Phase 23] "`/api/sync/shared` has no client consumer" |
| lock handler | `freeAllCollectionKeys` + `freeIdentityKey` | inside the EXISTING `subscribeSessionLockState`, after `stopSync()` (`vault-store.ts:959-988`) | ✓ WIRED, call order test-pinned |
| `vault.list.collections` | ItemListView/ItemDetailView folder lookup | `router.ts:560` → popup state; no direct background/WASM import from a popup component (D-05) | ✓ WIRED |
| `capture-handler.ts::confirmUpdateLogin` | live cross-member write-then-read proof | `dual-extension-sharing.spec.ts` (T-27-25) | ✓ WIRED |
| `handleCredentialsGet` candidate snapshot | shared-key resolution barrier | — | ✗ NOT_WIRED (gap #2) |
| `getPendingSharedItems()` broken entries | E1-error degraded row / E3-error banner | — | ✗ NOT_WIRED (gap #1) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Typecheck clean | `npx tsc --noEmit` | exit 0, no output | ✓ PASS |
| Unit + real-WASM suite | `npm test` (run once) | 59 files, 758 tests passed | ✓ PASS |
| Real-WASM tier genuinely present | `npm test \| grep real-wasm` | 4 files / 12 tests green (`wasm-loader`, `collections-store`, `identity-store`, `provider-ceremony`); spot-read of `collections-store.real-wasm.test.ts` confirms it loads `public/wasm/pv_wasm_bg.wasm` and does not `vi.mock` the crypto loader | ✓ PASS |
| EXT-10 permanent regression | `cargo test -p pv-provider --test response_shape` | `sign_count_is_always_zero_for_a_provider_ceremony_assertion ... ok` (3 passed) | ✓ PASS |
| Two-context isolation | `playwright --project=chromium e2e/two-context-spike.spec.ts` | 1 passed (2.0s) | ✓ PASS |
| Live recipient-side read + TOTP + storage audit + write round trip | `playwright --project=chromium e2e/dual-extension-sharing.spec.ts` | passed; flaky across attempts (see WARNING) | ⚠️ PASS (flaky) |
| Live post-revocation staleness | `playwright --project=chromium e2e/dual-extension-revocation.spec.ts` | 1 passed (1.1m), no retry | ✓ PASS |
| Live headed shared-passkey ceremony + signCount | `playwright --project=chromium-ceremony e2e/dual-extension-ceremony.spec.ts --retries=0` | 1 passed, twice | ✓ PASS |
| Ceremony spec really did the work (implausible 4.1s runtime challenged) | `sqlite3 data/pv.db "SELECT id, collection_id ... ORDER BY rowid DESC"` | two collection-scoped `vault_items` rows at 09:14:32 and 09:15:08 UTC, matching the two runs | ✓ PASS |

### Vacuous-Assertion Audit (27-VALIDATION.md's explicit requirement)

Every live spec was read line by line for the `toHaveCount(0)` trap that survived a total feature regression in `web/e2e/sharing.spec.ts`.

| Spec | Assertion shape | Verdict |
|------|-----------------|---------|
| `dual-extension-sharing.spec.ts` headline | `getByText(sharedItemName, {exact:true})).toBeVisible()` | ✓ Positive recipient-side observation |
| " TOTP | `expect(candidates).toContain(returnedCode)` against an independently computed bounded window | ✓ Positive byte-equality |
| " no-TOTP-affordance | `toHaveCount(0)` — but **anchored** by first asserting the item's own name *and* the "Password" row are visible | ✓ Non-vacuous by construction |
| " storage audit | `expect(unexpectedKeys).toEqual([])` | ⚠️ Absence-shaped; weakly anchored (it does not positively assert the two baseline keys are present). Mitigated because the preceding unlock/decrypt could not have succeeded with an empty session store. Minor. |
| " write round trip | `getByText(newCapturePassword, {exact:true})).toBeVisible()` | ✓ Positive byte-equality |
| `dual-extension-ceremony.spec.ts` | `expect(getResult.id).toBe(createdCredentialId)` and `expect(signCount).toBe(0)` | ✓ Positive identity + positive measurement |
| `dual-extension-revocation.spec.ts` | presence asserted first on both items, then absence | ✓ Correct presence-then-absence discipline, explicitly documented in the file header |

### Requirements Coverage

| Requirement | Status in REQUIREMENTS.md | Verifier assessment | Evidence |
|-------------|---------------------------|---------------------|----------|
| EXT-07 | Complete | ⚠️ **Overstated on the literal wording.** Decryption, display, ordering (UX-3 stable partition, `autofill-match.ts:218-269`) and the write path are all live-proven. The *fill event itself* is not. Marked Complete on a source-level non-modification argument plus a display proof — the plan's own frontmatter says so. | see truth 1 |
| EXT-08 | Complete | ✓ Supported by evidence | live byte-equality TOTP proof |
| EXT-09 | Complete | ✓ Supported by evidence | verifier-run headed ceremony |
| EXT-10 | Complete | ✓ Supported by evidence — and this is the phase's best-evidenced requirement | decision record + Rust wire-byte regression + live wire measurement + independently re-verified SEC-04 unreachability |
| EXT-11 | Complete | ✓ Supported by evidence | live `chrome.storage.session` enumeration + memory-only code + call-order test |
| EXT-12 | Complete | ✓ Supported by evidence (visual quality → human) | 6 call sites of one component |
| KEY-01 | `[x]` in the list, **"Partial" in the traceability table (line 134)** | ⚠️ **Bookkeeping inconsistency.** 27-04-SUMMARY declares `requirements-completed: [KEY-01, EXT-11]`; the requirement's own note says "Do not mark Complete until a client actually triggers generation", and the extension now does (`vault-session.ts:192`). The table was never updated. This is an *under*-claim, but it leaves the milestone record contradictory. | `publishOnUnlock` wired; `ensureOwnIdentityKeypair` real-WASM tested |

No orphaned requirements: every ID REQUIREMENTS.md maps to Phase 27 is claimed by at least one plan.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | `TBD` / `FIXME` / `XXX` / `TODO` / `HACK` / `PLACEHOLDER` across all 40 phase-modified `.ts`/`.tsx`/`.rs` files | — | **None found.** Debt-marker gate passes cleanly. |
| `extension/entrypoints/popup/ItemListView.tsx` | 436-485 | Dead branch (`item.undecryptable === true`) — documented as deliberate defense-in-depth | ⚠️ Warning | Not a stub, but it is the branch that *should* have been reachable; see gap #1 |
| `extension/entrypoints/popup/ItemDetailView.tsx` | 214-217 | Same dead branch | ⚠️ Warning | Same |
| `extension/entrypoints/background/provider-ceremony.ts` | 776-778 | Same dead filter, documented | ℹ️ Info | Correct as defense-in-depth; the *fallthrough* claim it guards is separately test-pinned |
| `extension/lib/i18n/dictionary.ts` | 272-275 | `sync.itemUndecryptableWarning` claims "Showing the last known version" | ⚠️ Warning | Ported byte-identical from web, but **false in the extension**, which retains no last-known copy. Currently unreachable; becomes an honesty defect the moment gap #1 is closed by making the branch live. |

## Additional Warnings (not gaps, but they qualify the evidence)

1. **The headline live proof is intermittently flaky.** `dual-extension-sharing.spec.ts` failed 2 of 6 attempts across three verifier runs, always at `signInAndUnlock`'s 20 s `waitForSelector` for the popup's initial view — a harness/service-worker startup race, never an assertion failure. It passes clean (8.5 s) with `--retries=0` sometimes and needs a retry other times. `playwright.config.ts`'s `retries: 2` masks this entirely, reporting "flaky" rather than red. For a phase whose entire evidence doctrine rests on live proofs, a headline proof that fails a third of the time is a durable liability — a green CI run does not distinguish "passed" from "passed on attempt 3". Worth a bounded wait on the service worker before the first `waitForSelector`.

2. **No live coverage of any access level except `edit`.** Both fixtures (`fixtures-account-setup.ts:471`, `:809`) grant `access_level: "edit"`, and no e2e file anywhere mentions `hidden_password`. UX-4's mask and 27-07's read-only refusal — the two surfaces most exposed to Phase 26's exact repeat failure — carry only component-tier and mocked-crypto-tier evidence. Partially mitigated by inference: the live write proof only succeeds because `getCollectionAccessLevel()` returns the server's literal `"edit"` string past `confirmUpdateLogin`'s gate, so the access-level plumbing *is* live-correct for one level; the residual risk is that `hidden_password` specifically never round-trips. Routed to human verification rather than failed.

3. **Out-of-scope finding, recorded per instruction, and it does *not* undermine any Phase 27 claim — but its severity is amplified here.** `capture-handler.ts::buildLoginFields()` (Phase 11) unconditionally derives `name` from the submitting page's hostname on *every* capture-confirm, update included, discarding the item's custom name. Correctly out of this phase's scope, and the live spec documents the behavior in-place (lines 417-434) and works around it via the popup's search box rather than hiding it. The amplification: for a *shared* item, one member's silent capture now renames the item for every other member. No Phase 27 claim depends on the name being stable — the write proof asserts on the *password* value, and the renaming is symmetric between personal and shared items, so EXT-07's "identically to a personal one" is unaffected. Recommend filing against Phase 11 behavior for v0.5.

4. **A VALIDATION.md command is wrong.** 27-02-T1's listed command `cargo test -p pv-provider response_shape` filters by *test name* and matches 0 tests (`response_shape` is a filename). The correct invocations are `--test response_shape` or 27-02-T2's already-correct `cargo test -p pv-provider sign_count_is_always_zero_for_a_provider_ceremony_assertion`. Cosmetic, but a "green" run of the listed command proves nothing.

5. **The environment gap does NOT materially weaken the phase's evidence.** `npm run test:e2e:chrome` cannot complete end-to-end because `dual-browser.spec.ts` and `store-screenshots.spec.ts` need `PV_UAT_PASSWORD`/`PV_DEMO_PASSWORD`. Both are pre-existing and unrelated to shared items. I ran all four Phase 27 specs individually and independently in this session; the phase's own evidence is complete and reproduced. Judged non-material.

## Gaps Summary

The phase is substantially achieved. Four of five ROADMAP success criteria are verified with genuine live, non-mocked, positive-assertion evidence that I reproduced myself rather than taking from SUMMARY prose — and the two hardest claims (SC 2 and SC 3) are the best-evidenced things in the phase. The EXT-10 spike in particular did what a spike is supposed to do: it falsified the requirement's own premise ("no shipped product precedent exists" is simply wrong) and said so plainly, with file:line evidence for the SEC-04 unreachability finding that I re-derived independently and found correct. The inherited Phase 26 obligation — budget the live proof from the start — was genuinely discharged: the two-extension harness landed in Wave 1, and the recipient-side proof in Wave 2, early enough to steer.

What fails is narrower and specific, and both failures are of the same kind: a state the phase deliberately designed for, wired the *destination* of, and then never connected the *source* to.

**Gap 1 (E2-error) is a real gap, not a technicality, and I am saying so plainly as instructed.** The phase built the degraded-row treatment, built the warning banner, built the ceremony filter — three consumers of `undecryptable: true` — and never built a producer. Meanwhile the one channel that *does* carry failures, `pendingSharedItems`, is deliberately untyped: pending and permanently-broken share one array precisely so that "never silently absent" holds for both. That decision is well-reasoned and well-documented, and it discharges 27-04's prohibition. But it is exactly what makes E2-error's backstop fail, because the popup then has no way to tell the two apart and renders both as a skeleton with no exit. A row whose Collection Key resolved but whose ciphertext failed its integrity check shimmers forever. The backstop's own text names this outcome and forbids it. The fix is small — `hasRefreshedThisSession()` is already the architectural discriminant UI-SPEC §4 specifies; it just needs to reach the popup — and it would light up three already-written, already-tested branches at once. To the phase's credit, 27-11-SUMMARY.md flagged this itself and escalated it here rather than burying it.

**Gap 2 (MV3-wake partial picker) was never looked at.** Unlike gap 1 it appears in no SUMMARY at all: 27-06 lifted it into `must_haves` as a backstop, then shipped a coverage block (D1–D5) that does not mention it. `handleCredentialsGet` gates on the User Key only and snapshots candidates at t=0 of the wake. The zero-candidate case falls through correctly and is test-pinned (27-10 did that work well, confirming it against real code rather than inferring it). The *partial* case — a personal passkey matching while a shared one is still pending — silently presents an incomplete picker inside a security ceremony. `ensureItemsHydrated()` already exists as the right shape of gate and is already used by the capture path; it is simply not applied here, and would need pairing with a collections-refresh check since it only awaits the personal pull.

Neither gap can be deferred: Phase 27 is the last phase of v0.4.

---

_Verified: 2026-08-09_
_Verifier: Claude (gsd-verifier) — all live proofs executed in-session, not accepted from SUMMARY_
