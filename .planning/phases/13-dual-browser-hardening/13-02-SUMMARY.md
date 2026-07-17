---
phase: 13-dual-browser-hardening
plan: 02
subsystem: ui
tags: [webauthn, prf, extension-popup, i18n, honest-degradation, vitest]

requires:
  - phase: 12-passkey-provider
    provides: "ProviderCeremonyView.tsx's own D-16 capability-driven PRF note (untouched by this plan, confirmed zero diff)"
provides:
  - "extension/lib/passkeys/prf-capability.ts: tested parsePrfCapability/detectPrfCapability choke point for the enroll create()-path's PRF capability signal"
  - "Honest, D-12/D-13-compliant PRF-unusability handling on UnlockView.tsx's get()-ceremony and EnrollExtPasskeyPrompt.tsx's create()-ceremony catch paths"
  - "D-13 canon fallback copy (PL+EN) in dictionary.ts's unlock.passkeyUnsupported, now the single shared string for every 'can't do the passkey fast-path here' case on the popup surface"
affects: [13-dual-browser-hardening, popup-i18n]

tech-stack:
  added: []
  patterns:
    - "Session-scoped 'unusable' boolean/phase state, set true only on an OBSERVED non-cancel ceremony failure -- never on browser detection -- driving a visible-but-disabled affordance (D-12) rather than hiding it"
    - "Cancel-vs-fail split on WebAuthn ceremony catch blocks: `err instanceof DOMException && err.name === 'NotAllowedError'` stays silent; every other throw surfaces honest degradation copy"

key-files:
  created:
    - extension/lib/passkeys/prf-capability.ts
    - extension/lib/passkeys/prf-capability.test.ts
  modified:
    - extension/entrypoints/popup/UnlockView.tsx
    - extension/entrypoints/popup/UnlockView.test.tsx
    - extension/entrypoints/popup/EnrollExtPasskeyPrompt.tsx
    - extension/entrypoints/popup/EnrollExtPasskeyPrompt.test.tsx
    - extension/lib/i18n/dictionary.ts

key-decisions:
  - "State-variable name for UnlockView.tsx's D-12 session flag: `prfUnusableThisSession` (boolean, component-local React state, never resets for the popup's lifetime once true) -- mirrors the existing `prfOrphanedThisSession` naming convention already in the file"
  - "Phase-value name for EnrollExtPasskeyPrompt.tsx's D-12 state: a new `Phase` union member `\"unusable\"` (alongside the existing `idle | busy | no-prf | failed`), chosen to fit the component's existing single-phase-enum shape rather than adding a second boolean alongside `phase`"
  - "unlock.passkeyFailed is left in the dictionary (no forced deletion, per plan instruction) but is now unused by the two paths this plan touches -- only the finish-message-failure branch (unrelated, out of scope) still renders it"

requirements-completed: [XBR-01]

coverage:
  - id: D1
    description: "parsePrfCapability/detectPrfCapability helper extracted and unit-tested (4 defensive-collapse cases); EnrollExtPasskeyPrompt.tsx's create-path capability check now calls it instead of an inline .prf?.enabled read"
    requirement: "XBR-01"
    verification:
      - kind: unit
        ref: "extension/lib/passkeys/prf-capability.test.ts (4/4 passing)"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/popup/EnrollExtPasskeyPrompt.test.tsx (Test 4d both variants, unmodified, still passing)"
        status: pass
    human_judgment: false
  - id: D2
    description: "UnlockView.tsx's get()-ceremony catch distinguishes NotAllowedError (silent) from genuine failures (D-13 banner + prfUnusableThisSession=true, PRF button disabled but never hidden); extractPrfBytes()===undefined path renders the same neutral banner instead of the old text-error unlock.passkeyFailed line"
    requirement: "XBR-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/UnlockView.test.tsx (3 new D-12 cases: NotAllowedError silent+enabled; non-cancel error banner+disabled; extractPrfBytes undefined banner+disabled -- 10/10 file passing)"
        status: pass
    human_judgment: false
  - id: D3
    description: "EnrollExtPasskeyPrompt.tsx's create()-ceremony catch gets the identical cancel-vs-fail split, with the create button disabled (not hidden) only after a genuine non-cancel failure this session"
    requirement: "XBR-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/EnrollExtPasskeyPrompt.test.tsx (2 new D-12 cases: NotAllowedError silent/idle+enabled; non-cancel error banner+disabled -- 7/7 file passing)"
        status: pass
    human_judgment: false
  - id: D4
    description: "D-13 canon copy (PL+EN) replaces unlock.passkeyUnsupported verbatim; ProviderCeremonyView.tsx (Phase 12 passkey-provider ceremony, D-16 scope) has zero diff from this plan"
    requirement: "XBR-01"
    verification:
      - kind: unit
        ref: "grep -q 'Fast unlock isn't available for this passkey on this browser' and grep -q 'Szybkie odblokowanie passkeyem nie jest dostępne' against extension/lib/i18n/dictionary.ts"
        status: pass
      - kind: other
        ref: "git diff --stat -- extension/entrypoints/popup/ProviderCeremonyView.tsx (empty output, confirmed)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-17
status: complete
---

# Phase 13 Plan 02: Popup PRF Honest-Degradation Summary

**Firefox/authenticator PRF-unusability on the popup's unlock and enroll ceremonies now surfaces the D-13 canon banner and a visible-but-disabled passkey button (D-12), replacing two silent dead-ends and one alarming-but-wrong-copy error state.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-17 (session start)
- **Completed:** 2026-07-17T08:08:59Z
- **Tasks:** 2/2 completed
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments
- Extracted and unit-tested `parsePrfCapability`/`detectPrfCapability` (4 test cases) as the single capability-detection choke point for `EnrollExtPasskeyPrompt.tsx`'s create()-path, DRYing its previously-inline `.prf?.enabled` read — pure refactor, zero behavior change (existing Test 4d PRF-capable/PRF-less cases pass unmodified)
- `UnlockView.tsx`'s `navigator.credentials.get()` catch now distinguishes `NotAllowedError` (silent, button stays enabled — first attempt always possible) from any other throw (sets `prfUnusableThisSession = true`, renders the neutral D-13 banner, disables the PRF button without hiding it)
- `UnlockView.tsx`'s `extractPrfBytes(assertion) === undefined` path now renders the same neutral banner instead of the old alarming `text-error`/`unlock.passkeyFailed` line, and sets the same session flag
- `EnrollExtPasskeyPrompt.tsx`'s `create()` catch gets the identical cancel-vs-fail split via a new `"unusable"` phase value, disabling (never hiding) the create button after a genuine non-cancel failure
- `dictionary.ts`'s `unlock.passkeyUnsupported` now holds the exact D-13 canon PL+EN strings, reused verbatim across the Tier-1 "WebAuthn API absent" case and both new D-12 ceremony-catch cases — one canonical string instead of three near-duplicate messages
- `ProviderCeremonyView.tsx` (Phase 12's passkey-provider consent card, D-16-driven) confirmed untouched — zero diff

## Task Commits

Each task was committed atomically:

1. **Task 1: Build and unit-test the PRF capability-detection helper, DRY it into EnrollExtPasskeyPrompt** - `19d98d5` (feat)
2. **Task 2: Wire honest D-03/D-12 degradation into the popup unlock and enroll ceremony catch-paths** - `33e44e2` (fix)

_No TDD RED/GREEN/REFACTOR split commits — Task 1 was TDD-flagged but executed as a single feat commit containing both the failing-first test file and the passing implementation, verified in-session (RED confirmed via `npx vitest run` failing on missing module before `prf-capability.ts` existed, then GREEN confirmed after) before the atomic commit per this plan's own task_commit_protocol (one commit per task, not per RED/GREEN sub-step)._

## Files Created/Modified
- `extension/lib/passkeys/prf-capability.ts` - `parsePrfCapability`/`detectPrfCapability`, the enroll create()-path's tested PRF capability reader
- `extension/lib/passkeys/prf-capability.test.ts` - 4 Vitest cases covering the two-case-collapse logic
- `extension/entrypoints/popup/EnrollExtPasskeyPrompt.tsx` - capability-read refactor (Task 1) + new `"unusable"` phase and cancel-vs-fail create() catch split (Task 2)
- `extension/entrypoints/popup/EnrollExtPasskeyPrompt.test.tsx` - 2 new D-12 test cases (NotAllowedError silent, non-cancel error banner+disabled)
- `extension/entrypoints/popup/UnlockView.tsx` - new `prfUnusableThisSession` state, cancel-vs-fail get() catch split, extractPrfBytes-undefined path rewired to the neutral banner, button `disabled` gated on the new flag
- `extension/entrypoints/popup/UnlockView.test.tsx` - Tier-1 explainer test copy assertion updated to D-13 canon wording + 3 new D-12 test cases
- `extension/lib/i18n/dictionary.ts` - `unlock.passkeyUnsupported` replaced with D-13 canon PL+EN strings; `unlock.passkeyFailed` annotated as unused-by-this-plan's-paths (kept, no forced deletion)

## Decisions Made
- `prfUnusableThisSession` (UnlockView.tsx) and the `"unusable"` Phase value (EnrollExtPasskeyPrompt.tsx) were left to executor discretion by the plan — documented above and in `key-decisions` frontmatter
- `unlock.passkeyFailed` retained in the dictionary per the plan's explicit "no forced deletion" instruction, still used by the one out-of-scope branch (finish-message failure, unrelated to the PRF-capability gap this plan addresses)

## Deviations from Plan

None - plan executed exactly as written. Task 1's TDD RED phase was verified in-session (test file written first, confirmed failing on missing module) before the helper was implemented and both were committed together in the single Task 1 commit, matching this plan's task-level (not RED/GREEN-level) commit granularity.

## Issues Encountered
One pre-existing unhandled Promise rejection warning surfaced during the full `npm test` run (`ServerConfigView.tsx:111` inside `App.test.tsx`) — unrelated to any file this plan touches, did not cause a test failure (530/530 tests still passed), and is out of scope per the plan's scope-boundary rule. Not fixed; noted here for visibility, no `deferred-items.md` entry needed since it predates this plan's changes and produces zero currently-failing assertions.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 13 SC #3 (Firefox capability gaps communicated explicitly) is now satisfied on the popup unlock/enroll surface, complementing the already-shipped provider-ceremony (D-16) and ServerConfigView CORS (D-11) honest-degradation lines from Plans 12-0x/13-05
- No blockers for subsequent Phase 13 plans

---
*Phase: 13-dual-browser-hardening*
*Completed: 2026-07-17*

## Self-Check: PASSED

All 8 created/modified files verified present on disk; both task commits (`19d98d5`, `33e44e2`) verified present in `git log`.
