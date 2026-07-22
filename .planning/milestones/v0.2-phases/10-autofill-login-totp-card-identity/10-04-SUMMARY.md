---
phase: 10-autofill-login-totp-card-identity
plan: 04
subsystem: extension-autofill
tags: [webextension, typescript, vitest, wxt, totp, autofill, origin-matching, background-service-worker]

requires:
  - phase: 10-autofill-login-totp-card-identity
    provides: "10-01's extension/lib/autofill/types.ts (FillKind/DetectedFields/AutofillMatch/FillTarget/FillValues + content-relay ContentDetectRequest/Response/ContentFillRequest/Response), the extended extension/lib/messaging/ext-protocol.ts (autofill.match/fill/totpCode kinds + AutofillMatchResult), and entrypoints/background/frame-guard.ts's resolveFillTarget()/itemMatchesOrigin() origin/frame access-control gate"
provides:
  - "extension/entrypoints/background/autofill-match.ts: handleAutofillMatch/handleAutofillFill/handleAutofillTotpCode -- the background's sole decrypt/derive context for autofill, origin-gated at both match AND fill time, frame-addressed delivery, live per-request TOTP derivation"
  - "extension/lib/crypto/wasm-loader.ts gains a totpNow() re-export/wrapper (mirrors web/src/lib/crypto/index.ts's own wrapper) -- the extension's background choke-point now exposes live TOTP derivation, not just decrypt/wrap/unwrap"
  - "entrypoints/background/router.ts's autofill.match/autofill.fill/autofill.totpCode cases wired into the dispatch table, isProtocolMessage() whitelist extended, the 10-01 placeholder comment resolved"
affects: [10-05, 10-06, 10-07]

tech-stack:
  added: []
  patterns:
    - "Gate-on-ensureHydrated()-alone: every autofill handler awaits ensureHydrated() as its SOLE lock-state gate, never a hard isSessionUnlocked() pre-check -- the latter is a sync, in-memory-only read that would incorrectly report 'locked' on a freshly-woken service worker with a still-valid persisted key envelope"
    - "Fresh-resolve-per-call: resolveActiveTarget() (one browser.tabs.query() + frame-guard.ts's resolveFillTarget()) is called independently inside handleAutofillMatch AND handleAutofillFill -- fill never reuses or trusts a target/origin decision match made earlier in the same round trip (TOCTOU defense)"
    - "Items are already plaintext by the time autofill-match.ts sees them: vault-store.ts's getItems() returns the fully-decrypted in-memory VaultItem[] (Phase 9's sync client decrypts at pull time), so 'decrypt the one item' from the plan's draft action text collapses to a lookup + itemMatchesOrigin() re-check here -- the only background-choke-point crypto call this file makes directly is totpNow()"

key-files:
  created:
    - extension/entrypoints/background/autofill-match.ts
    - extension/entrypoints/background/autofill-match.test.ts
  modified:
    - extension/lib/crypto/wasm-loader.ts
    - extension/entrypoints/background/router.ts

key-decisions:
  - "Real Phase 9 accessor confirmed: getItems() (entrypoints/background/vault-store.ts), NOT the plan's placeholder getDecryptedItems(). It returns the FULLY DECRYPTED VaultItem[] already held in memory (Phase 9's sync client decrypts every item at pull time and clears the cache the instant the vault locks) -- there is no per-fill ciphertext-blob decrypt step in this file; buildFillValues() maps already-plaintext fields, and totpNow() is the only background-crypto-choke-point call made directly here."
  - "Gate redesigned from the plan's literal Task 1 draft (Rule 1 bug fix): the plan's draft gate was 'if (!isSessionUnlocked()) return locked; then const uk = await ensureHydrated()'. isSessionUnlocked() is vault-session.ts's own sync, in-memory-only fast-path check (its doc comment: 'may be null on a fresh SW instance') -- using it as a HARD pre-gate would incorrectly report 'locked' on a freshly-woken service worker that still has a valid persisted key envelope, which is exactly the scenario Test 7 requires to succeed. Every handler now gates on ensureHydrated() alone, which is both the fast path (returns the in-memory handle immediately when already hydrated) and the correct single source of truth."
  - "handleAutofillMatch's locked-fail-closed branch returns { pageState: 'ok', origin: null, detected: <all-false>, matches: [] } rather than inventing a new pageState value. AutofillMatchResult's pageState union ('ok'|'restricted'|'unreachable') is frozen by plan 10-01 and has no dedicated 'locked' member; extending it would touch ext-protocol.ts and its JSON-round-trip fixture-exhaustiveness test, outside this plan's files_modified. The popup already has its own session.status-driven locked UI, so this branch is defense-in-depth only, not expected to be user-visible -- documented inline and here rather than silently picked."
  - "TOTP-kind autofill.fill requests are architecturally unreachable by design, not a gap: frame-guard.ts's itemMatchesOrigin() (10-01, unmodified) always returns false for a totp item (TotpFields has no stored URL to compare). handleAutofillFill runs the SAME general gate → resolve → itemMatchesOrigin path for every FillKind including totp, so a totp fill naturally fails closed with origin-mismatch/no-match -- exactly matching frame-guard.ts's own documented policy that TOTP codes reach the popup exclusively via the separate, origin-check-free autofill.totpCode message. buildFillValues() still implements a totp branch (calling totpNow()) for type-completeness/future-proofing even though it is currently unreachable through handleAutofillFill."
  - "wasm-loader.ts gained a totpNow() re-export/wrapper (not in the plan's files_modified) -- the extension's background choke-point had decrypt/wrap/unwrap/deriveAuthMaterial re-exported by prior plans but never totpNow, which this plan's TOTP path genuinely needs. Mirrors web/src/lib/crypto/index.ts's own totpNow wrapper exactly (JSON.parse of the wasm export's JSON string, BigInt conversion for period/unixTimeSeconds)."
  - "manifest-permissions.test.ts's PERMISSION_GATED_APIS list deliberately does NOT include 'tabs' (its own comment: usage without the permission still returns a Tab, just without url/title -- not undefined). browser.tabs.query({active,currentWindow})'s ability to see tab.url in this file relies on 'activeTab', granted implicitly whenever the user opens the popup (activeTab's classic trigger) -- no manifest change was needed or made; verified by reading wxt.config.ts's current permissions list (['storage','alarms']) and Chrome's activeTab semantics rather than assumed. Flagged here per this plan's project_invariants instruction to record what was verified and why it suffices."
  - "Test file mocks wxt/browser + vault-session + vault-store + the crypto choke-point directly (vi.mock, following frame-guard.test.ts/router.test.ts/vault-store.test.ts's established convention) rather than pulling in wxt/testing's fakeBrowser as the plan's action text suggested as an option -- this codebase has zero prior fakeBrowser usage, and the direct-mock pattern gives per-test control over tabs.query/sendMessage return shapes (needed for Test 3's TOCTOU navigation and Test 5's frameId assertion) with no new test-only dependency."

requirements-completed: []

coverage:
  - id: D1
    description: "handleAutofillMatch/handleAutofillFill/handleAutofillTotpCode implementing origin-gated match, fill-time re-verification, frame-addressed delivery, and live per-request TOTP derivation, with every path failing closed when locked"
    requirement: "FILL-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/autofill-match.test.ts (9 tests covering the plan's 7 required behaviors: locked fail-closed x3, metadata-only match, TOCTOU re-verification, itemId origin ownership, frame-addressed dispatch, TOTP freshness x2 assertions, idle-kill rehydration)"
        status: pass
      - kind: other
        ref: "cd extension && npx tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D2
    description: "The three autofill.* cases wired into router.ts's dispatch table and isProtocolMessage() whitelist, dispatching to the new handlers without weakening the assertPopupSender() tier guard on session.*/vault.*"
    requirement: "FILL-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/router.test.ts (11 tests, unchanged -- no new router.ts tests were added since the autofill.* cases are pure additive dispatch with no new branching logic to pin; router.ts's own acceptance criteria were verified via grep + tsc, not a new test)"
        status: pass
      - kind: other
        ref: "cd extension && npx vitest run (full suite, 173/173 across 18 files) && npx tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D3
    description: "T-10-13..T-10-17 threat mitigations (value-free match/fill responses, itemId-origin-ownership refusal, fill-time re-resolution against caching a stale match, frame-addressed non-broadcast delivery, no-plaintext-logging discipline) hold as implemented"
    requirement: "FILL-01"
    verification:
      - kind: unit
        ref: "autofill-match.test.ts Test 2 (no password in serialized match response), Test 3 (TOCTOU navigation refused), Test 4 (cross-origin itemId refused), Test 5 (frameId-addressed sendMessage), Test 6 (secret never in totpCode response)"
        status: pass
      - kind: other
        ref: "grep -n \"console\\.\" extension/entrypoints/background/autofill-match.ts (empty -- no console call in the file, so no possible plaintext/secret log)"
        status: pass
    human_judgment: true
    rationale: "The plan's own flagged prohibition (frontmatter, unchanged from 10-01) records this as unverified-by-a-wired-test for a FUTURE stray log -- the grep above is a point-in-time manual read-back, not a standing regression gate. The full in-browser adversarial proof of frame-addressed delivery (a real cross-origin iframe never receiving a fill) remains 10-07's UAT job, as 10-01's own SUMMARY already recorded for its half of this gate."

duration: 40min
completed: 2026-07-15
status: complete
---

# Phase 10 Plan 04: Background Autofill Handlers -- Origin-Gated Match, Fill, Live TOTP Summary

**Three background service-worker handlers (`handleAutofillMatch`/`handleAutofillFill`/`handleAutofillTotpCode`) that are the sole decrypt/derive context for autofill: origin-gated at both match AND fill time, frame-addressed plaintext delivery, and TOTP codes derived fresh via a new `totpNow()` choke-point re-export -- wired into the router's existing dispatch table.**

## Performance

- **Duration:** ~40 min (includes environment setup: `npm install`, copying the gitignored `pv-wasm` build artifacts from the main checkout into this worktree since the wasm binary isn't built by this plan's own tasks, and re-running `wxt prepare` so its generated `PublicPath` type recognized the newly-present `/wasm/pv_wasm_bg.wasm` static asset)
- **Completed:** 2026-07-15T19:28:00Z
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `extension/entrypoints/background/autofill-match.ts` created: `handleAutofillMatch()` (metadata-only match, gated on `ensureHydrated()`, queries the active tab, asks the content-relay for detected fields via `content.detect`, filters `getItems()` through `itemMatchesOrigin()`), `handleAutofillFill()` (re-resolves the target frame and re-runs `itemMatchesOrigin()` from scratch -- never trusts the earlier match decision -- then delivers plaintext to the content-relay addressed to the exact resolved `{frameId}`), `handleAutofillTotpCode()` (derives the code fresh via `totpNow()` every call, no origin check by design, secret never crosses into the response).
- `extension/lib/crypto/wasm-loader.ts` extended with a `totpNow()` wrapper (mirrors `web/src/lib/crypto/index.ts`'s own wrapper exactly) -- the extension's background choke-point can now derive live TOTP codes, which no prior plan needed.
- `extension/entrypoints/background/router.ts`'s three `autofill.*` cases wired into `handle()`'s switch and `isProtocolMessage()`'s whitelist, resolving the `// Plan 10-04 adds:` placeholder comment 10-01 left; the `assertPopupSender()` tier guard (scoped to `session.*`/`vault.*`) is confirmed untouched and unaffected.
- 9 unit tests in `autofill-match.test.ts` covering the plan's 7 required behaviors, with `frame-guard.ts` left real/unmocked so the tests exercise the actual origin/frame gate rather than a stand-in for it.

## Task Commits

1. **Task 1: autofill-match.ts -- the three background handlers (TDD)** - `a249bbb` (feat)
2. **Task 2: Wire the three autofill.* cases into the router** - `cc07629` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `extension/entrypoints/background/autofill-match.ts` -- the three handlers (new)
- `extension/entrypoints/background/autofill-match.test.ts` -- 9 tests covering the plan's 7 required behaviors (new)
- `extension/lib/crypto/wasm-loader.ts` -- `totpNow()` re-export/wrapper added
- `extension/entrypoints/background/router.ts` -- three `autofill.*` cases wired, placeholder comment resolved, header comment updated to past tense

## Decisions Made

See frontmatter `key-decisions` for the full record. Summary:

- **`getItems()` (not `getDecryptedItems()`) is Phase 9's real accessor**, and it returns already-decrypted items -- this plan's "decrypt the one item" step collapses to a lookup + re-check, not a WASM decrypt call (only `totpNow()` is a direct crypto-choke-point call here).
- **Gate redesigned to `ensureHydrated()` alone** (Rule 1 bug fix against the plan's literal draft gate, which would have broken the woken-service-worker fast path Test 7 requires).
- **Locked-match response reuses the existing `pageState: "ok"` value** rather than inventing a new contract member outside this plan's `files_modified`.
- **TOTP-kind fills are architecturally unreachable through `autofill.fill`** by 10-01's own `itemMatchesOrigin()` design (always `false` for totp) -- confirmed as intentional, not patched around.
- **`wasm-loader.ts` gained `totpNow()`** -- a genuinely missing choke-point export this plan's TOTP path needs (not in the plan's stated `files_modified`, added per Rule 3).
- **`activeTab` permission (already implicit via popup-open) suffices for `tabs.query`'s `tab.url` visibility** -- verified against `wxt.config.ts`'s current permissions and Chrome's `activeTab` semantics; no manifest change made or needed.
- **Test mocking follows the established `vi.mock("wxt/browser", ...)` direct-mock convention**, not `wxt/testing`'s `fakeBrowser` (unused anywhere else in this codebase).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Copied gitignored `pv-wasm` build artifacts into the worktree and re-ran `wxt prepare`**
- **Found during:** Task 1, before writing any code
- **Issue:** `extension/lib/crypto/wasm/` and `extension/public/wasm/` (the wasm-bindgen-generated JS glue + compiled `.wasm` binary) are gitignored build outputs, not present in a fresh worktree checkout. `npx tsc --noEmit` failed with `Cannot find module './wasm/pv_wasm.js'` and a `PublicPath` type error for `/wasm/pv_wasm_bg.wasm` (WXT's generated public-asset type only recognizes files that existed at `wxt prepare` time).
- **Fix:** Copied the already-built artifacts from the main repo checkout (confirmed present and gitignored, not tracked, via `git status --short` in the main checkout) into this worktree's identical paths, then re-ran `npx wxt prepare` so the generated `PublicPath` type picked up the now-present wasm asset. This is an environment-setup step (mirrors `npm install`), not a code change -- no source file was touched to work around the missing artifacts.
- **Files modified:** none (gitignored generated files only)
- **Verification:** `npx tsc --noEmit` exits 0 afterward; confirmed the copied `pv_wasm.d.ts`/`pv_wasm.js` already export `totpNow` (pv-wasm's own `#[wasm_bindgen(js_name = totpNow)]`, unrelated to this plan -- the crate already had it from an earlier phase).
- **Committed in:** N/A (gitignored, not committed)

**2. [Rule 3 - Blocking] Added `totpNow()` to `extension/lib/crypto/wasm-loader.ts`**
- **Found during:** Task 1
- **Issue:** The extension's background choke-point (`wasm-loader.ts`) re-exports `decryptItem`/`deriveAuthMaterial`/`wrapUserKey`/etc. but never `totpNow` -- no prior plan needed live TOTP derivation in the extension background. Without it, `handleAutofillTotpCode`/the TOTP branch of `buildFillValues` cannot exist.
- **Fix:** Added a `totpNow()` wrapper mirroring `web/src/lib/crypto/index.ts`'s existing wrapper exactly (same JSON.parse-once, same `BigInt` conversion for `period`/`unixTimeSeconds`).
- **Files modified:** `extension/lib/crypto/wasm-loader.ts`
- **Verification:** `npx tsc --noEmit` exits 0; `autofill-match.test.ts` Test 6 exercises the mocked call signature end-to-end.
- **Committed in:** `a249bbb` (Task 1 commit)

**3. [Rule 3 - Blocking] Extended `router.ts`'s `isProtocolMessage()` whitelist with the three `autofill.*` kinds**
- **Found during:** Task 2
- **Issue:** The plan's Task 2 action text only mentions adding `switch` cases inside `handle()`; it doesn't mention `isProtocolMessage()`'s separate kind whitelist earlier in the same file. Without adding the three kinds there too, `registerMessageRouter()`'s `addListener` callback would return `undefined` for every `autofill.*` message (treating it as "not one of this router's kinds") and `handle()` would never run -- the feature would silently not dispatch at all despite the switch cases existing.
- **Fix:** Added `kind === "autofill.match" || kind === "autofill.fill" || kind === "autofill.totpCode"` to the existing whitelist disjunction.
- **Files modified:** `extension/entrypoints/background/router.ts`
- **Verification:** `npx vitest run` (173/173); `grep -q "handleAutofillMatch" entrypoints/background/router.ts` (plan's own acceptance criterion).
- **Committed in:** `cc07629` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 3/blocking -- necessary for the feature to type-check and actually dispatch at all). No scope creep: no source file changes beyond what each blocking issue required, and item #1 touched no tracked files.

## Issues Encountered

- The extension's `node_modules` was not installed in this fresh worktree (`npx tsc` initially resolved the wrong `tsc` binary via `npx`'s "did you mean" prompt). Ran `npm install` inside `extension/` before any verification -- standard environment bootstrap, not a plan deviation.
- Pre-existing, unrelated unhandled rejection in `entrypoints/popup/App.test.tsx` (`ServerConfigView.tsx:95:32`) persists across this plan's changes -- already documented in `.planning/phases/10-autofill-login-totp-card-identity/deferred-items.md` by 10-01 as confirmed-present-on-clean-`HEAD`, out of scope for this plan's `files_modified`.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- `extension/entrypoints/background/autofill-match.ts`'s three handlers are ready to be driven by Plan 10-06's popup UI (`sendMessage<"autofill.match">`/`"autofill.fill"`/`"autofill.totpCode"`, already typed in `ext-protocol.ts` since 10-01) and Plan 10-05's content-relay (which must implement the `content.detect`/`content.fill` LISTENER side this file already calls via `browser.tabs.sendMessage`).
- End-to-end autofill still does not work yet: no content-relay exists to answer `content.detect`/receive `content.fill` (10-05), and no popup UI triggers `autofill.match`/`autofill.fill`/`autofill.totpCode` (10-06) -- matching 10-01's own precedent, `requirements-completed` is left empty for FILL-01..04 in this SUMMARY; user-facing autofill functionality is not yet demonstrable.
- `totpNow()` is now available at both the web app's (`web/src/lib/crypto/index.ts`) and the extension's (`extension/lib/crypto/wasm-loader.ts`) background choke-points with an identical wrapper shape -- any future plan needing extension-side TOTP derivation does not need to re-add this.
- No blockers. The full in-browser adversarial proof of frame-addressed delivery (T-10-16) and the flagged no-future-stray-log prohibition (T-10-17) remain Plan 10-07's UAT job, as recorded in `coverage` D3's `rationale` above.

---
*Phase: 10-autofill-login-totp-card-identity*
*Completed: 2026-07-15*

## Self-Check: PASSED

All claimed files (extension/entrypoints/background/autofill-match.ts,
extension/entrypoints/background/autofill-match.test.ts,
extension/lib/crypto/wasm-loader.ts, extension/entrypoints/background/router.ts,
this SUMMARY) confirmed present on disk. Both commit hashes (a249bbb, cc07629)
confirmed present in git log.
