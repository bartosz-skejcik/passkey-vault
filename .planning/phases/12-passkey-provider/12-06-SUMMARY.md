---
phase: 12-passkey-provider
plan: 06
subsystem: extension-provider
tags: [webauthn, provider-ceremony, consent-gate, chrome-storage-session, postmessage, react-hooks]

requires:
  - phase: 12-passkey-provider (Plan 12-05)
    provides: "Decision A (every ceremony consent-gated end-to-end), unified PendingCeremonyPayload shape, CEREMONY_ABANDON_TIMEOUT_MS (WR-03), page-side RESPONSE_TIMEOUT_MS raise (CR-03 first pass)"
provides:
  - "NEW BLOCKER fix: App.tsx now reactively re-checks PENDING_CEREMONY_KEY via browser.storage.session.onChanged, so a locked-vault create()/get() ceremony's consent payload (written by provider-ceremony.ts AFTER the user unlocks) is actually shown, not silently missed"
  - "CR-03 completion: the early-ack handshake (content-relay posts {kind:'ack'} on an accepted request, page-bridge cancels its short no-ack fallthrough timer and becomes exclusively dependent on the extension's own terminal credential/fallthrough message) -- an extension-accepted ceremony can never also run native, closing the orphaned-credential race even on a slow locked-vault confirm"
  - "Adds the 'ack' discriminant to PageBridgeResponseEnvelope (lib/messaging/page-protocol.ts) -- shared, minimal, out-of-declared-scope type addition required for both page-bridge files and content-relay to type-check"
affects: [secure-phase-12]

tech-stack:
  added: []
  patterns:
    - "React ref-mirror-on-every-render pattern (viewRef.current = view, assigned in the render body, not inside an effect) to let a stable []-effect callback (storage.session.onChanged listener) read the LATEST view state without re-subscribing addListener/removeListener on every render"
    - "Two-phase relay() timeout: a SHORT no-ack window (ACK_TIMEOUT_MS) bounds 'is anyone even listening', a SEPARATE generous backstop (EXTENSION_AUTHORITY_TIMEOUT_MS) bounds 'the extension accepted but never answered' -- the ack message itself is non-terminal and never handed to the page-bridge caller, only used to transition between the two timers"

key-files:
  created: []
  modified:
    - extension/entrypoints/popup/App.tsx
    - extension/entrypoints/popup/App.test.tsx
    - extension/entrypoints/content-relay.content.ts
    - extension/entrypoints/__tests__/content-relay.test.ts
    - extension/entrypoints/page-bridge.content.ts
    - extension/entrypoints/page-bridge-firefox.ts
    - extension/entrypoints/__tests__/page-bridge.test.ts
    - extension/lib/messaging/page-protocol.ts

key-decisions:
  - "viewRef (a plain useRef synced by direct assignment in the render body, `viewRef.current = view`) is used instead of adding `view` to the onChanged effect's dependency array -- keeps the addListener/removeListener pair stable across renders (matching the existing session.locked listener's own single-registration lifecycle) while still letting the callback read fresh state; the alternative (dep-array + re-subscribe every render) would churn the listener on every keystroke-driven re-render for no benefit."
  - "The removal-case reactive listener only calls refreshSessionStatus() when viewRef.current.kind === 'provider-ceremony' -- an unrelated key removal (or a removal while the popup is on ItemDetailView/list) never disrupts the user's current screen. This matches PENDING_CEREMONY_KEY's actual write contract (only provider-ceremony.ts ever writes/removes it, always ceremony-related), so the guard is a defense-in-depth choice, not a requirement of any observed real-world race."
  - "ACK_TIMEOUT_MS = 3000ms (short: an ack is a same-tab round trip with no human in it) and EXTENSION_AUTHORITY_TIMEOUT_MS = 300000ms (generous: purely a wedged-listener backstop, documented as NOT an interaction budget since the background always sends an explicit fallthrough on decline/abandon/error) -- deliberately far apart, unlike 12-05's single 120000ms value that tried to serve both purposes at once and lost to the background's additive ~240s worst case."
  - "The 'ack' discriminant was added to PageBridgeResponseEnvelope (lib/messaging/page-protocol.ts) even though this file is not in the plan's declared files_modified list -- Rule 3 (blocking issue): both page-bridge files' onMessage handlers and content-relay's postAck() need a type-checked 'ack' kind against the SAME shared envelope union both sides already import; there was no way to implement the ack handshake without it. The change is purely additive to an existing discriminated union (a new member, zero new imports) -- the D-02/PROV-05 MAIN-world import-boundary audit is unaffected, and the audit script still passes exit 0."
  - "provider-ceremony.ts's own CEREMONY_ABANDON_TIMEOUT_MS (120s, shared by waitForUnlock and awaitCeremonyConsent) was left UNCHANGED -- Task 2's action item 4 explicitly allows this: the background's abandon path already flows into the existing fallthrough response (waitForUnlock returning null -> handleCredentialsCreate/Get returning {fallthrough:true} immediately; awaitCeremonyConsent returning null on WR-03 abandon -> the same {fallthrough:true} path), which the page-bridge's ack-gated Phase B is designed to receive as the real terminal message. No background code change was needed to close CR-03 -- only the page-side race needed fixing, since the background was already correctly bounded and correctly fallthrough-safe."

requirements-completed: [PROV-01, PROV-02, PROV-03]

coverage:
  - id: D1
    description: "NEW BLOCKER fix: a consent payload written to chrome.storage.session AFTER the popup has already mounted (the locked-vault sequence -- UnlockView shown first, background writes the real payload only post-unlock) reactively mounts ProviderCeremonyView via a new storage.session.onChanged listener, for both create() and single-match get() ceremonies -- taking over focus with no remount required."
    requirement: "PROV-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/App.test.tsx#Phase 12: provider-ceremony ViewState takeover > NEW BLOCKER fix (12-06): storage.session.onChanged reactive re-check > locked-vault sequence: a 'create' consent payload written AFTER mount (post-unlock) reactively mounts ProviderCeremonyView"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/popup/App.test.tsx#Phase 12: provider-ceremony ViewState takeover > NEW BLOCKER fix (12-06): storage.session.onChanged reactive re-check > locked-vault sequence: a single-match 'get' consent payload written AFTER mount reactively mounts ProviderCeremonyView, pre-selected"
        status: pass
    human_judgment: false
  - id: D2
    description: "The reactive listener ignores onChanged events for any session key other than PENDING_CEREMONY_KEY -- no spurious storage.session.get() re-check or remount on unrelated storage traffic."
    requirement: "PROV-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/App.test.tsx#Phase 12: provider-ceremony ViewState takeover > NEW BLOCKER fix (12-06): storage.session.onChanged reactive re-check > an onChanged event for an UNRELATED session key does not trigger a ceremony re-check or remount"
        status: pass
    human_judgment: false
  - id: D3
    description: "Removing PENDING_CEREMONY_KEY (ceremony resolved/abandoned elsewhere, e.g. WR-03's background abandon-timeout firing while this popup instance stayed open) while ProviderCeremonyView is showing returns the popup to the prior/list view -- no dangling ceremony view."
    requirement: "PROV-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/App.test.tsx#Phase 12: provider-ceremony ViewState takeover > NEW BLOCKER fix (12-06): storage.session.onChanged reactive re-check > removing PENDING_CEREMONY_KEY while ProviderCeremonyView is shown returns to the prior/list view"
        status: pass
    human_judgment: false
  - id: D4
    description: "CR-03 completion: content-relay acks a VALID provider request (all validation gates passed) BEFORE forwarding to the background, and posts no ack for an INVALID/replayed request -- identical to today's silent-ignore behavior for those."
    requirement: "PROV-03"
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts#passkey-provider bridge: window message validation (D-03/ASVS V5) > CR-03 completion: a VALID request is acked immediately, before the background is ever called"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts#passkey-provider bridge: window message validation (D-03/ASVS V5) > CR-03 completion: an INVALID request (replayed nonce) gets no ack -- same as no forward"
        status: pass
    human_judgment: false
  - id: D5
    description: "CR-03 completion: once page-bridge receives a matching-nonce ack, it cancels its short no-ack fallthrough timer and waits on the extension's own terminal credential/fallthrough message as the sole authority -- a resolution arriving well after the OLD 120s interaction-budget window still returns the extension's result, never a native fallthrough. An explicit fallthrough after ack also resolves via that real message, never the backstop."
    requirement: "PROV-03"
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/page-bridge.test.ts#CR-03 completion (Plan 12-06): early-ack handshake > an ack cancels the short no-ack fallthrough timer -- a credential resolution arriving well after the OLD 120s interaction-budget window still returns the extension's result, never a native fallthrough"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/__tests__/page-bridge.test.ts#CR-03 completion (Plan 12-06): early-ack handshake > an ack followed by an explicit fallthrough resolves via that real message, never the extension-authority backstop"
        status: pass
    human_judgment: false
  - id: D6
    description: "CR-03 completion: if NO ack arrives within the short no-ack window (relay absent / non-provider context), page-bridge falls through to native promptly -- bounded by ACK_TIMEOUT_MS (3s), not the old 120s ceiling -- so the native path is never dead-ended (PROV-03, D-11)."
    requirement: "PROV-03"
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/page-bridge.test.ts#D-11 fallthrough: three required cases > Case 1 (no ack): falls through to the native original when content-relay never even acks the request"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/__tests__/page-bridge.test.ts#CR-03 completion (Plan 12-06): early-ack handshake > no ack arrives within the short window (relay absent / non-provider context): falls through to native promptly, not after the old 120s ceiling"
        status: pass
    human_judgment: false
  - id: D7
    description: "A duplicate/late ack for an already-acked nonce is ignored (does not throw, does not corrupt the settled/backstop-timer state)."
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/page-bridge.test.ts#CR-03 completion (Plan 12-06): early-ack handshake > a duplicate/late ack for an already-acked nonce is ignored -- does not throw, does not re-arm past the already-armed backstop"
        status: pass
    human_judgment: false
  - id: D8
    description: "Full gate checklist: extension vitest suite (504/504), tsc --noEmit clean, audit-mainworld-boundary.sh exits 0 (source + freshly rebuilt bundle), wxt build -b chrome and -b firefox both succeed."
    verification:
      - kind: other
        ref: "npm --prefix extension test -- --run (504/504); npx --prefix extension tsc --noEmit; bash scripts/audit-mainworld-boundary.sh (after npx wxt build -b chrome && -b firefox)"
        status: pass
    human_judgment: false
  - id: D9
    description: "Real-browser visual/functional confirmation that a locked-vault create()/get() against a live third-party site now genuinely shows the consent screen post-unlock, and that a slow (>3s ack, human-paced) confirm never double-fires native -- exercising the ack handshake and the reactive listener together outside vitest's fake timers/jsdom."
    verification: []
    human_judgment: true
    rationale: "Real Chrome/Firefox packaged-extension UAT against a live third-party site is required to observe the actual popup-focus takeover and the real postMessage/runtime.sendMessage round trips under real (not fake) timers -- consistent with every prior phase's precedent for this class of check, not achievable from unit tests alone. This is exactly the /gsd-secure-phase checklist item 12-05-SUMMARY already flagged as outstanding (real third-party site create()/get() UAT); this plan does not add a new open item, it just re-confirms the same one now that BOTH re-review defects are closed."

duration: ~25min
completed: 2026-07-16
status: complete
---

# Phase 12 Plan 06: Locked-Vault Consent Blocker + CR-03 Ack Handshake Summary

**Reactive `storage.session.onChanged` listener makes the popup actually show the consent screen on the locked-vault path, and an early-ack handshake between content-relay and page-bridge makes the extension the sole fallthrough authority so an accepted ceremony can never also run native.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-16
- **Tasks:** 2 (both `type="auto"`, `tdd="true"`)
- **Files modified:** 8 (0 created, 8 modified)

## Accomplishments

- **NEW BLOCKER closed.** `App.tsx` previously read `PENDING_CEREMONY_KEY` exactly once, at mount (`refreshFromScratch()`'s `checkPendingCeremony()`). On the locked-vault sequence -- popup opens on `UnlockView` because `ensureHydrated()` found the vault locked, the user unlocks, `provider-ceremony.ts`'s `awaitCeremonyConsent()` writes the REAL consent payload only AFTER that unlock resolves -- that one-shot check had already run and returned before the payload existed, so the consent screen silently never appeared and the ceremony fell straight through to native, defeating Decision A on exactly the path CR-03/WR-03 exist to protect. A new `browser.storage.session.onChanged` listener (mirrors the existing `session.locked` listener's add/removeListener cleanup shape) re-runs `checkPendingCeremony()` reactively whenever the key changes: a new valid payload mounts `ProviderCeremonyView` immediately (verified for both `create` and single-match `get`); an unrelated key change is ignored; the key being removed while the ceremony view is showing returns the popup to the prior/list view via `refreshSessionStatus()`.
- **CR-03 completion (early-ack handshake).** 12-05's page-side `RESPONSE_TIMEOUT_MS` (120000ms) and the background's `waitForUnlock`+`awaitCeremonyConsent` ceilings (also 120000ms EACH, ADDITIVE, ~240s worst case) were never actually synchronized -- the stale header comment in `page-bridge.content.ts` claimed a "shared backstop ceiling" and explicitly rejected an ack as "unnecessary complexity," both of which the re-review found factually wrong. `content-relay.content.ts` now posts a non-terminal `{source:"pv-content-relay", nonce, kind:"ack"}` message (origin-pinned to `location.origin`, never `"*"`) the instant a request passes ALL validation gates (source/origin/shape/non-replay), BEFORE forwarding to the background; no ack for a rejected/invalid request. `page-bridge.content.ts`/`page-bridge-firefox.ts` replace the single fixed race with two phases: Phase A (`ACK_TIMEOUT_MS`, 3000ms) falls through to native promptly if no ack arrives (relay unreachable / non-provider context); Phase B, entered once a matching-nonce ack arrives, cancels the Phase A timer and waits exclusively on the extension's own terminal `credential`/`fallthrough` message, bounded only by a generous `EXTENSION_AUTHORITY_TIMEOUT_MS` (300000ms) backstop against a genuinely wedged listener -- explicitly documented as NOT an interaction budget, since the background always emits an explicit `fallthrough` on decline/no-match/abandon/error. An extension-accepted ceremony can now never also run native, closing the orphaned-credential race even on a slow locked-vault confirm.
- **`lib/messaging/page-protocol.ts` gained the `"ack"` discriminant** on `PageBridgeResponseEnvelope` -- required for both page-bridge files' `onMessage` handlers and content-relay's `postAck()` to type-check against the one shared envelope union both sides already import. Not in the plan's declared `files_modified` list (Rule 3 deviation, see below) but purely additive (a new union member, zero new imports) -- the D-02/PROV-05 MAIN-world import-boundary audit is unaffected.
- **`provider-ceremony.ts` left unchanged**, per the plan's own allowance (Task 2, action item 4): its abandon path already flows into the existing `{fallthrough: true}` response on every code path (`waitForUnlock` returning `null`, `awaitCeremonyConsent` returning `null` via WR-03's abandon timeout), which is exactly the real terminal message page-bridge's new Phase B is designed to receive. No background code change was needed to close CR-03 -- only the page-side race needed fixing.
- Full verification suite green: `npm --prefix extension test` (504/504 across 44 files, +10 from this plan's new tests), `tsc --noEmit` clean, `scripts/audit-mainworld-boundary.sh` exits 0 (source AND a freshly rebuilt bundle check), `wxt build -b chrome` and `-b firefox` both succeed.

## Task Commits

1. **Task 1: NEW BLOCKER — reactive consent-payload listener in the popup**
   - `7c56380` (fix) — `App.tsx`'s `storage.session.onChanged` listener + `viewRef` ref-mirror pattern; 4 new `App.test.tsx` tests

2. **Task 2: CR-03 completion — early-ack makes the extension the sole fallthrough authority**
   - `a0a69b0` (fix) — `content-relay.content.ts`'s `postAck()`, `page-bridge.content.ts`/`page-bridge-firefox.ts`'s two-phase `relay()`, `page-protocol.ts`'s `"ack"` discriminant; 2 new `content-relay.test.ts` tests + 4 new `page-bridge.test.ts` tests (1 existing test updated for the extra ack message, 3 existing timer-advance tests updated to the new short window)

**Plan metadata:** (this commit)

## Files Created/Modified

- `extension/entrypoints/popup/App.tsx` — reactive `storage.session.onChanged` listener, `viewRef` ref-mirror
- `extension/entrypoints/popup/App.test.tsx` — 4 new tests (locked-vault create/get reactive mount, unrelated-key ignore, removal-returns-to-list)
- `extension/entrypoints/content-relay.content.ts` — `postAck()`, called on every validation-gate-passing request before forwarding
- `extension/entrypoints/__tests__/content-relay.test.ts` — 2 new ack tests + 1 existing test updated (extra ack message in `received`)
- `extension/entrypoints/page-bridge.content.ts` — two-phase `relay()` (`ACK_TIMEOUT_MS`/`EXTENSION_AUTHORITY_TIMEOUT_MS`), rewritten header comment
- `extension/entrypoints/page-bridge-firefox.ts` — identical twin changes
- `extension/entrypoints/__tests__/page-bridge.test.ts` — 4 new CR-03-completion tests, 3 existing timer-advance tests updated to the new short window, 1 test renamed for clarity
- `extension/lib/messaging/page-protocol.ts` — `"ack"` added to `PageBridgeResponseEnvelope` (Rule 3, out-of-declared-scope but required)

## Decisions Made

- `viewRef` ref-mirror pattern (assigned in render body, not an effect) over adding `view` to the onChanged effect's dependency array — see key-decisions in frontmatter.
- Removal-case reactive re-check only fires `refreshSessionStatus()` when `viewRef.current.kind === "provider-ceremony"` — defense-in-depth, not a requirement of an observed race (see key-decisions).
- `ACK_TIMEOUT_MS = 3000ms` / `EXTENSION_AUTHORITY_TIMEOUT_MS = 300000ms`, deliberately far apart (see key-decisions).
- `"ack"` discriminant added to `page-protocol.ts` despite not being in the plan's declared file list — Rule 3, blocking type-safety necessity (see key-decisions).
- `provider-ceremony.ts`'s `CEREMONY_ABANDON_TIMEOUT_MS` left unchanged, confirmed (not re-derived) to already flow correctly into the fallthrough response the ack-gated Phase B relies on (see key-decisions).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added the `"ack"` discriminant to `lib/messaging/page-protocol.ts`, a file not in the plan's declared `files_modified` list**
- **Found during:** Task 2
- **Issue:** `page-bridge.content.ts`/`page-bridge-firefox.ts`'s `onMessage` handler and `content-relay.content.ts`'s new `postAck()` both need to construct/inspect a `PageBridgeResponseEnvelope` value with `kind: "ack"` — the type this file exports is the ONLY shared contract both sides import (D-02's own "imports NOTHING beyond the two typed envelope interfaces from `lib/messaging/page-protocol.ts`" constraint), so the ack handshake could not type-check without adding this member to the existing discriminated union.
- **Fix:** Added a fourth union member `{ source: "pv-content-relay"; nonce: string; kind: "ack" }` to `PageBridgeResponseEnvelope`, documented with the same rationale inline. Purely additive — no existing member changed, no new imports anywhere in the file (it remains zero-import, per its own header comment's invariant).
- **Files modified:** `extension/lib/messaging/page-protocol.ts`
- **Verification:** `npx tsc --noEmit` clean; `bash scripts/audit-mainworld-boundary.sh` still exits 0 against a freshly rebuilt bundle (the audit greps for forbidden IMPORTS, not type-only additions, so this change is invisible to it by design).
- **Commit:** `a0a69b0`

**2. [Rule 1 - Bug] Updated an existing content-relay.test.ts assertion that counted exactly 1 posted-back message, now that an ack always precedes the real response**
- **Found during:** Task 2
- **Issue:** `"posts the credential response back to the page..."` collected every `window` message with `source: "pv-content-relay"` into a `received` array and asserted `received` has length 1. With the ack now posted first, this test would see 2 messages and fail on the length assertion (a correct regression catch, not a false positive).
- **Fix:** Updated the test to expect `received.length === 2`, assert `received[0]` is the `ack` envelope, and check the credential response fields against `received[1]` instead of `received[0]`. Renamed the test to reflect the new two-message sequence.
- **Files modified:** `extension/entrypoints/__tests__/content-relay.test.ts`
- **Verification:** `npm --prefix extension test -- --run __tests__/content-relay.test.ts` — 22/22 pass.
- **Commit:** `a0a69b0`

**3. [Rule 1 - Bug] Updated 4 pre-existing `page-bridge.test.ts` timer-advance calls from the old 120000ms window to the new short no-ack window**
- **Found during:** Task 2
- **Issue:** `"Case 1 (timeout)"`, both `"D-03: request envelope discipline"` tests, and (implicitly) any test relying on the old single-timeout semantics advanced fake timers by exactly `120_000` to trigger the fallthrough path. Functionally these still passed unmodified after the fix (the new `finish(null)` fires earlier, at `ACK_TIMEOUT_MS`, and `vi.advanceTimersByTimeAsync(120_000)` simply advances past that point too), but leaving the old value would misrepresent the actual timing behavior being exercised and mask a regression if `ACK_TIMEOUT_MS` were ever accidentally widened back toward 120s.
- **Fix:** Updated all 3 call sites to `vi.advanceTimersByTimeAsync(3_000)` (`ACK_TIMEOUT_MS`'s value), renamed "Case 1" to "Case 1 (no ack)" to reflect the new semantics, and added a comment pointing to the dedicated "CR-03 completion" describe block for the ack-arrives/no-ack-arrives pair the plan's behavior spec explicitly requires.
- **Files modified:** `extension/entrypoints/__tests__/page-bridge.test.ts`
- **Verification:** `npm --prefix extension test -- --run __tests__/page-bridge.test.ts` — 18/18 pass (14 pre-existing, updated where needed + 4 new).
- **Commit:** `a0a69b0`

---

**Total deviations:** 3 auto-fixed (1 Rule 3 — a minimal, additive, out-of-declared-scope type change that was structurally unavoidable; 2 Rule 1 — adapting pre-existing tests to the new, correct ack-aware behavior this plan intentionally introduces). No scope creep: every deviation was strictly necessary to implement the ack handshake correctly and keep the existing test suite honest about the new behavior.

## Issues Encountered

None beyond the deviations above — no blocking issues, no auth gates, no architectural surprises. The pre-existing `ServerConfigView.tsx` unhandled rejection (documented in `deferred-items.md` since Plan 12-03, unrelated to this plan) remains present in the test run output and out of scope.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Both re-review defects (NEW BLOCKER and CR-03 completion) are closed at the automated-evidence level: the locked-vault consent screen now reactively appears, and an extension-accepted ceremony can never also run natively even on a slow confirm.
- Decision A (12-05) now genuinely holds on BOTH the unlocked AND locked vault paths — no known silent-fallthrough gap remains in the consent-gate story.
- `/gsd-secure-phase` can now proceed. It should specifically re-exercise (carried over from 12-05-SUMMARY's Next Phase Readiness, not a new item — this plan closes the defects that item was written against):
  1. Real third-party site create()/get() UAT on packaged Chrome (and best-effort Firefox), now including an explicit locked-vault run (close the extension popup, lock the vault, trigger a ceremony, confirm the consent screen actually appears post-unlock).
  2. A deliberately slow (multi-second, human-paced) confirm on a locked-vault ceremony, watching devtools/network for evidence that native was NEVER also invoked (no duplicate credential, no "handled by both" symptom).
  3. The two-password-manager coexistence UAT case already spelled out in `deferred-items.md` (IN-01, unaffected by this plan).
- No blockers.

## Self-Check: PASSED

Both modified-file sets verified present on disk with the expected changes
(`extension/entrypoints/popup/App.tsx`, `extension/entrypoints/popup/App.test.tsx`,
`extension/entrypoints/content-relay.content.ts`, `extension/entrypoints/__tests__/content-relay.test.ts`,
`extension/entrypoints/page-bridge.content.ts`, `extension/entrypoints/page-bridge-firefox.ts`,
`extension/entrypoints/__tests__/page-bridge.test.ts`, `extension/lib/messaging/page-protocol.ts`);
both commit hashes (`7c56380`, `a0a69b0`) verified present in `git log --oneline --all`.

---
*Phase: 12-passkey-provider*
*Completed: 2026-07-16*
