---
phase: 12-passkey-provider
plan: 04
subsystem: extension-popup
tags: [react, daisyui, webauthn, provider-ceremony, chrome-storage-session, i18n]

requires:
  - phase: 12-passkey-provider (Plan 12-02)
    provides: "provider-ceremony.ts's handleCredentialsCreate/handleCredentialsGet, resolvePasskeyChoice/resolveProviderCredentialChoice groundwork, pv-pending-provider-ceremony chrome.storage.session signal"
provides:
  - "extension/entrypoints/popup/ProviderCeremonyView.tsx: the popup-hosted passkey ceremony consent screen per 12-UI-SPEC.md (single teal confirm CTA, ghost fallback, multi-match picker, PRF notes, dismissal-as-decline)"
  - "extension/lib/i18n/dictionary.ts: full provider.* Copywriting Contract table (PL/EN)"
  - "App.tsx's provider-ceremony ViewState: takeover-mount on a pending multi-match credentials.get() picker"
  - "extension/lib/messaging/ext-protocol.ts + router.ts: provider.resolveChoice message (popup -> background), the missing link that lets the popup actually report a picker choice back to provider-ceremony.ts"
affects: [12-05, secure-phase-12]

tech-stack:
  added: []
  patterns:
    - "ProviderCeremonyView is a pure, fully-controlled presentational component (props in, callbacks out) -- it never touches chrome.storage.session or browser.runtime.sendMessage directly; that wiring lives entirely in App.tsx, matching every other view in this popup"
    - "Dismissal-as-decline (D-11) implemented via a resolvedRef guard + both a window 'beforeunload' listener and the component's own unmount cleanup -- either one fires onDecline exactly once if no explicit confirm/decline/select-then-confirm action was taken first"

key-files:
  created:
    - extension/entrypoints/popup/ProviderCeremonyView.tsx
    - extension/entrypoints/popup/ProviderCeremonyView.test.tsx
  modified:
    - extension/lib/i18n/dictionary.ts
    - extension/entrypoints/popup/App.tsx
    - extension/entrypoints/popup/App.test.tsx
    - extension/lib/messaging/ext-protocol.ts
    - extension/lib/messaging/ext-protocol.test.ts
    - extension/entrypoints/background/router.ts
    - extension/entrypoints/background/router.test.ts
    - extension/entrypoints/background/provider-ceremony.ts

key-decisions:
  - "provider.resolveChoice added as a new popup->background message kind (ext-protocol.ts/router.ts), gated by the existing WR-01 popup-sender check -- resolveProviderCredentialChoice() is a background-only function (12-02) with no wire-level way for the popup to reach it before this plan"
  - "resolvePasskeyChoice's (provider-ceremony.ts) stored picker payload now includes rpId, not just requestId/candidates -- without it the consent screen has no way to show WHICH site is asking, defeating the anti-phishing point of an RP-scoped WebAuthn consent screen"
  - "App.tsx's provider-ceremony ViewState is driven ONLY by the multi-match picker payload shape ({requestId, rpId, candidates}), not the boolean locked-vault-awaiting-unlock flag -- see Deviations for the full reasoning on why the boolean case needs no new wiring"

requirements-completed: [PROV-01, PROV-02, PROV-03, PROV-04]

coverage:
  - id: D1
    description: "ProviderCeremonyView renders per 12-UI-SPEC.md for create/single-match-get/multi-match-get/busy/failed states, with no coral, no favicon, no empty-state screen"
    requirement: "PROV-02"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ProviderCeremonyView.test.tsx#Task 1: core layout, states, single/multi-match"
        status: pass
    human_judgment: false
  - id: D2
    description: "PRF-capable/PRF-unavailable notes render only when the RP's request included prf, driven exclusively by the prfCapable prop (D-16) -- no browser/user-agent detection anywhere in the component"
    requirement: "PROV-04"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ProviderCeremonyView.test.tsx#Task 2: PRF notes (D-16)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Dismissing the ceremony (unmount or window beforeunload) while pending sends an explicit decline, never a double-fire on an already-explicit confirm/decline"
    requirement: "PROV-03"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ProviderCeremonyView.test.tsx#Task 2: dismissal-as-decline (D-11)"
        status: pass
    human_judgment: false
  - id: D4
    description: "App.tsx mounts the provider-ceremony ViewState immediately on init when a multi-match picker is pending, taking over focus from any other view; confirm/select/decline report back via provider.resolveChoice and return to the ordinary flow"
    requirement: "PROV-01, PROV-02"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/App.test.tsx#Phase 12: provider-ceremony ViewState takeover"
        status: pass
    human_judgment: false
  - id: D5
    description: "Real Chrome/Firefox visual spot-check of the ceremony screen (w-380px canvas, spacing, typography) against 12-UI-SPEC.md"
    verification: []
    human_judgment: true
    rationale: "Visual/taste verification requires a real packaged-extension UAT pass (Plan 12-05/secure-phase-12), not achievable from unit tests alone -- consistent with every prior phase's precedent for DaisyUI spacing/color spot-checks."

duration: ~30min
completed: 2026-07-16
status: complete
---

# Phase 12 Plan 04: Passkey Provider Ceremony Consent UI Summary

**`ProviderCeremonyView.tsx` — the single teal-CTA / ghost-fallback popup consent screen for the passkey provider, with a capability-driven PRF note (D-16), dismissal-as-decline (D-11), and an App.tsx `provider-ceremony` ViewState wired to the real multi-match `credentials.get()` picker via a new `provider.resolveChoice` message this plan had to add.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-07-16
- **Tasks:** 3 (Task 1 and Task 2 both `tdd="true"`, each with a RED test commit + GREEN feat commit; Task 3 `type="auto"`, single commit)
- **Files modified:** 10 (2 created, 8 modified — 5 of the 8 are a documented deviation outside this plan's declared file list, see Deviations)

## Accomplishments

- `extension/entrypoints/popup/ProviderCeremonyView.tsx`: pure, fully-controlled consent screen — `btn btn-accent` teal CTA (`KeyRound`), `btn btn-ghost` "use something else" fallback (no icon, no accent), 56px multi-match credential rows (32px `KeyRound` slot, radio-style selection) rendered only when there's more than one match, `Fingerprint`+`Loader2 animate-spin` busy composition matching `EnrollExtPasskeyPrompt.tsx`'s existing grammar, plain `text-sm text-error` failure line, no favicon fetch, no coral anywhere
- `extension/lib/i18n/dictionary.ts`: full `provider.*` Copywriting Contract table added additively (PL/EN, byte-for-byte from 12-UI-SPEC.md)
- PRF-capable/PRF-unavailable notes gated purely by `prfRequested`/`prfCapable` props (D-16) — no `navigator.userAgent`/browser-sniffing code path anywhere in the file, verified by an explicit test that renders identically under two different spoofed user-agent strings
- Dismissal-as-decline (D-11): a `resolvedRef` guard + `beforeunload` listener + unmount cleanup fire `onDecline` exactly once on an unresolved dismissal, never double-firing after an explicit confirm/decline
- `App.tsx`: new `provider-ceremony` ViewState, checked first in `refreshFromScratch()`, mounted from the real `pv-pending-provider-ceremony` `chrome.storage.session` picker payload; confirm/select/decline report back via the new `provider.resolveChoice` message and return to the popup's ordinary flow
- All 3 tasks' automated verification commands pass; full suite (`npm --prefix extension test`) 474/474 green (1 pre-existing, unrelated unhandled rejection, see Issues Encountered), `tsc --noEmit` clean

## Task Commits

1. **Task 1: ProviderCeremonyView — core layout, states, single/multi-match** (TDD gate)
   - `5f7f58d` (test) — 21 behavior tests against a not-yet-existing component (RED: module-resolution failure)
   - `e1e2f08` (feat) — real component + full `provider.*` dictionary; all 21 pass (GREEN)

2. **Task 2: PRF notes, dismissal-as-decline, i18n entries** (folded into the same file/commit pair as Task 1 — see Decisions)
   - Same `5f7f58d`/`e1e2f08` pair above covers the PRF-note matrix and dismissal tests too (the plan's own `files_modified` overlaps Task 1 and Task 2 on `ProviderCeremonyView.tsx`/`.test.tsx`)

3. **Task 3: App.tsx ViewState takeover-mount** (`type="auto"`, plus a required deviation)
   - `a785a75` (feat) — deviation: `provider.resolveChoice` message + `router.ts` dispatch + `rpId` added to `provider-ceremony.ts`'s stored picker payload (see Deviations)
   - `069a1b9` (feat) — `App.tsx`'s `provider-ceremony` ViewState + `App.test.tsx`'s 5 new tests

**Plan metadata:** (this commit)

## Files Created/Modified

- `extension/entrypoints/popup/ProviderCeremonyView.tsx` (new) — the consent screen
- `extension/entrypoints/popup/ProviderCeremonyView.test.tsx` (new) — 21 tests
- `extension/lib/i18n/dictionary.ts` — `provider.*` entries
- `extension/entrypoints/popup/App.tsx` — `provider-ceremony` ViewState
- `extension/entrypoints/popup/App.test.tsx` — 5 new tests + `storage.session` mock
- `extension/lib/messaging/ext-protocol.ts` / `.test.ts` — `provider.resolveChoice` message
- `extension/entrypoints/background/router.ts` / `.test.ts` — dispatch for `provider.resolveChoice`
- `extension/entrypoints/background/provider-ceremony.ts` — `rpId` added to the stored picker payload

## Decisions Made

- **Task 1 and Task 2 share one RED/GREEN commit pair, not two.** Both tasks declare the SAME files (`ProviderCeremonyView.tsx`/`.test.tsx`); writing the component's layout logic and its PRF/dismissal logic as two truly separate TDD cycles inside one file would have meant reverting/re-adding code mid-stream for no real benefit. The single test commit (`5f7f58d`) contains every behavior test from both tasks' `<behavior>` blocks; the single feat commit (`e1e2f08`) makes all of them pass together. This is a process-level deviation from "one RED/GREEN pair per task," not a scope or correctness gap — both tasks' full behavior lists are covered.
- **`App.tsx`'s `provider-ceremony` ViewState is driven exclusively by the multi-match picker payload, not the locked-vault boolean flag.** See Deviations below for the full reasoning — this was the single most consequential scoping decision in this plan.
- **`ProviderCeremonyView`'s multi-match rows use a `role="radio"` button, not a native `<input type="radio">`**, matching 12-UI-SPEC.md's "radio-style selection affordance" language without needing a `<form>`/native radio-group's implicit submit semantics inside a popup.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added `provider.resolveChoice` message (ext-protocol.ts, router.ts) — the popup had no way to reach `resolveProviderCredentialChoice`**
- **Found during:** Task 3, wiring `App.tsx`'s confirm/decline handlers
- **Issue:** Plan 12-02's `resolveProviderCredentialChoice(requestId, itemId)` is a background-service-worker-only function. The plan's `key_links` described the popup->background link with `pattern: credentials\.(create|get)`, but those two message kinds are dispatched on the CONTENT-FRAME channel (`registerAutofillFrameChannel()`), which is content-script-only by construction (`assertContentSender` rejects a popup sender). There was no message kind anywhere that let the popup call `resolveProviderCredentialChoice` at all — without one, the multi-match picker UI this plan builds would be permanently unreachable from the popup, and D-11's dismissal-as-decline for that picker would have nothing to send.
- **Fix:** Added `{ kind: "provider.resolveChoice"; requestId: string; itemId: string | null }` to `ext-protocol.ts`'s `Message` union (popup-facing, dispatched via the existing WR-01-gated `handle()` channel, NOT the content-frame channel `credentials.create`/`credentials.get` use) + a `router.ts` case calling `resolveProviderCredentialChoice(message.requestId, message.itemId)`.
- **Files modified:** `extension/lib/messaging/ext-protocol.ts`, `extension/lib/messaging/ext-protocol.test.ts`, `extension/entrypoints/background/router.ts`, `extension/entrypoints/background/router.test.ts` (none in this plan's declared `files_modified` list)
- **Verification:** `router.test.ts`'s 2 new tests (dispatches for a popup sender; refused for a content-script sender, same WR-01 discipline as `session.status`); `ext-protocol.test.ts`'s JSON-round-trip structural gate updated with the new fixture; full suite green.
- **Commit:** `a785a75`

**2. [Rule 2 - Missing Critical Functionality] Added `rpId` to `resolvePasskeyChoice`'s stored picker payload (`provider-ceremony.ts`)**
- **Found during:** Task 3, wiring `App.tsx`'s render of `ProviderCeremonyView`'s `site` prop
- **Issue:** 12-02's stored picker payload was `{requestId, candidates: [{itemId, label}]}` — no site/RP identifier anywhere. `12-UI-SPEC.md`'s `signinBodyMultiple` copy is "Choose the account to sign in to `{site}` with" — omitting the site name from a WebAuthn RP-scoped consent screen defeats the entire anti-phishing property such a screen exists to provide (this phase's own T-12-14 threat entry). `candidates[*].label` falls back to `username ?? rpId` per-candidate, which is not reliably a site identifier (most candidates have a username, so `rpId` is usually absent from the payload entirely).
- **Fix:** Added `rpId: candidates[0]?.fields.rpId ?? ""` to the stored payload — additive, minimal (all candidates share the same rpId by construction, since `findMatchingPasskeyItems` filters on a single rpId), no shape change to the existing `requestId`/`candidates` fields.
- **Files modified:** `extension/entrypoints/background/provider-ceremony.ts` (not in this plan's declared `files_modified` list)
- **Verification:** No existing test asserted the exact stored payload shape (12-02-SUMMARY documented the multi-match path as untested groundwork), so this is a pure additive change; full suite green, `tsc --noEmit` clean.
- **Commit:** `a785a75`

### Scope Clarification (not a Rule 1-3 auto-fix — documented for transparency)

**3. `App.tsx`'s `provider-ceremony` ViewState wiring covers only the multi-match `credentials.get()` picker, not every ceremony state `ProviderCeremonyView` can render.**
- **Reasoning:** 12-02's actual background implementation gates the popup with `chrome.storage.session`'s `pv-pending-provider-ceremony` key in exactly two places: (a) `openPopupAndAwaitUnlock()` (locked vault) writes the BOOLEAN `true` — this happens BEFORE the RP's request is even parsed, so no ceremony kind/site/account data exists to render a meaningful consent screen for it; and (b) `resolvePasskeyChoice()` (multi-match `get()`, more than one candidate) writes `{requestId, rpId, candidates}` — the only payload with enough real data to drive `ProviderCeremonyView`.
- For (a): since `resolvePasskeyChoice`/`openPopupAndAwaitUnlock` are only reached AFTER `ensureHydrated()` is checked, the boolean-flag case ALWAYS means the vault is locked — meaning `session.status` already reports `"locked"` and the EXISTING `UnlockView` already renders and takes over focus, with no additional wiring needed. Once the user unlocks, `provider-ceremony.ts`'s own `waitForUnlock()` auto-proceeds the ceremony (no additional consent gate exists in 12-02's create/single-get paths). App.tsx therefore correctly leaves this path untouched.
- For single-match `create()`/`get()` when the vault is ALREADY unlocked: 12-02's `handleCredentialsCreate`/`handleCredentialsGet` never write to `PENDING_CEREMONY_KEY` or open the popup at all in this case — they proceed immediately without any consent gate. `ProviderCeremonyView` fully supports rendering `kind: "create"` and single-match `kind: "get"` states (Task 1/2's unit tests exercise them directly via props), but there is currently NO real background signal that would ever cause `App.tsx` to mount the view in those states. Making every ceremony wait for an explicit popup confirmation (not just the locked/multi-match cases) would require changing `provider-ceremony.ts`'s core `handleCredentialsCreate`/`handleCredentialsGet` gating logic — a genuinely architectural change to already-tested 12-02 code, out of this plan's scope (Rule 4 territory), and not attempted here.
- **Known gap for a future plan:** D-11's dismissal-as-decline is only reachable end-to-end for the multi-match picker in this plan. The locked-vault-awaiting-unlock path's `waitForUnlock()` has no cancellation mechanism at all — if a user closes the popup/window while the vault is locked and a ceremony is pending, `openPopupAndAwaitUnlock()`'s returned promise never resolves, meaning `handleCredentialsCreate`/`handleCredentialsGet` hang indefinitely rather than falling through. This is a pre-existing gap in 12-02 (not introduced by this plan), and fixing it would require a new background-level cancellation/timeout mechanism (`browser.windows.onRemoved` listener or similar) — architectural, out of this plan's declared scope. Flagged here for `/gsd-secure-phase`'s D-11/D-15 review and for a follow-up plan.

---

**Total deviations:** 2 auto-fixed (Rule 2, both required for the multi-match picker to be reachable/honest at all) + 1 scope clarification (documented, not a code change).
**Impact on plan:** No feature scope creep — the two auto-fixes are the minimum plumbing needed for the plan's own `key_links` requirement ("ProviderCeremonyView -> provider-ceremony.ts... confirm/decline/selection messages") to be true at all. The scope clarification narrows what's END-TO-END reachable today versus what `ProviderCeremonyView` is capable of rendering; nothing was silently skipped, and the gap is explicitly flagged for follow-up.

## Issues Encountered

- **Pre-existing, unrelated unhandled rejection in `App.test.tsx`'s "EXT-05: Change server re-entry" suite** (`ServerConfigView.tsx:95`, `Cannot read properties of undefined (reading 'request')` — a `browser.permissions.request` call with no mock in that test's `wxt/browser` factory). Confirmed pre-existing via `git show HEAD:extension/entrypoints/popup/App.test.tsx` — present before any of this plan's edits, unrelated to the provider-ceremony changes, and out of this plan's scope per the deviation rules' scope boundary (pre-existing failures in unrelated test code are logged, not fixed). All 474 tests still pass; this is an unhandled-rejection warning, not a test failure.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `ProviderCeremonyView.tsx` is fully built and tested for all three ceremony states (`create`, single-match `get`, multi-match `get`) per 12-UI-SPEC.md — ready for a future plan to wire `create()`/single-match `get()` consent gating in `provider-ceremony.ts`, if that's decided to be in scope for v0.2.
- `/gsd-secure-phase`'s D-15 grep-audit for this phase should additionally check: (a) `provider.resolveChoice`'s WR-01 gate (popup-only, mirrors every other popup-facing kind); (b) the known `waitForUnlock()` cancellation gap documented above (D-11 mitigation is incomplete for the locked-vault path).
- The real-browser visual spot-check (w-380px canvas, spacing, typography per 12-UI-SPEC.md) is deferred to a packaged-extension UAT pass (human_judgment: true, D5 above) — consistent with every prior phase's precedent for this kind of check.
- No blockers.

## Self-Check: PASSED

All 10 created/modified files verified present on disk; all 6 commit hashes
(`5f7f58d`, `e1e2f08`, `a785a75`, `069a1b9`) verified present in
`git log --oneline --all`.

---
*Phase: 12-passkey-provider*
*Completed: 2026-07-16*
