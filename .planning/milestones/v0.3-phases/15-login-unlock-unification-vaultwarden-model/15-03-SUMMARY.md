---
phase: 15-login-unlock-unification-vaultwarden-model
plan: 03
subsystem: auth
tags: [react, extension, wxt, vitest, i18n, ui]

# Dependency graph
requires:
  - phase: 15-login-unlock-unification-vaultwarden-model
    provides: "Plan 15-01's password-relay sign-in through the ceremony window (proves the window carries full sign-in via EITHER password or passkey, so removing the popup's own form doesn't strand passkey-less accounts)"
provides:
  - "SignInView.tsx: new minimal signed-out hero component (wordmark + one primary CTA + Server icon-button), zero input elements"
  - "App.tsx routes session.status 'no-session' -> SignInView, 'locked' -> UnlockView, from the same 'unlock' ViewState kind; handleUnlocked narrowed to zero-arg; EnrollExtPasskeyPrompt render slot removed"
  - "UnlockView.tsx rewritten unlock-only/password-first: autofocused password field, unconditional btn-accent passkey button (D-12 disabled-forever machinery retired), Server icon-button replaces the old bottom text link"
  - "dictionary.ts: unlock.serverCeremonySigninFailed copy no longer references a password fallback"
affects: [15-04, 15-05, 15-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SignInView.tsx composes UnlockView.tsx's proven server-ceremony dispatch + broadcast-listener shape (mode hardcoded to 'signin') rather than inventing a new dispatch pattern"
    - "Server icon-button (lucide-react, aria-label config.changeServer) is now the ONE consistent reconfigure affordance across both signed-out and locked auth surfaces, same top-right position on both"

key-files:
  created:
    - extension/entrypoints/popup/SignInView.tsx
    - extension/entrypoints/popup/SignInView.test.tsx
  modified:
    - extension/entrypoints/popup/App.tsx
    - extension/entrypoints/popup/UnlockView.tsx
    - extension/entrypoints/popup/UnlockView.test.tsx
    - extension/lib/i18n/dictionary.ts

key-decisions:
  - "Removed UnlockView.tsx's hasServerConfig state/effect entirely (UI-SPEC flagged it 'arguably removable, executor's call') -- the passkey button no longer gates on it since D-12's unusable-this-session machinery is retired and App.tsx's routing already guarantees a server is configured by the time this view can render, mirroring the identical rationale already applied to SignInView.tsx's own 'no hasServerConfig gate needed' note"
  - "handleServerCeremonyUnlock narrowed to zero-arg in UnlockView.tsx (mode hardcoded to 'unlock' internally) rather than keeping the mode parameter for a minimal diff -- there is no reachable 'signin' call site left in this file, and the plan explicitly allowed either choice"

patterns-established:
  - "A view-container's own reconfigure affordance is a fixed-position (absolute top-right) icon-button, not a bottom text link -- first use of this exact placement in the popup, now shared verbatim between SignInView.tsx and UnlockView.tsx"

requirements-completed: [AUTH-01, AUTH-02]

coverage:
  - id: D1
    description: "SignInView.tsx renders a minimal hero (wordmark + one primary CTA + Server icon-button) with zero input elements; clicking the CTA dispatches unlock.serverCeremony.start mode:signin exactly once; a subsequent ok:true broadcast calls onSignedIn(), ok:false sets an inline retry-able failure line"
    requirement: AUTH-01
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/SignInView.test.tsx (Plan 15-03)"
        status: pass
    human_judgment: false
  - id: D2
    description: "App.tsx routes session.status 'no-session' to SignInView and 'locked' to UnlockView from the same ViewState kind; the enroll-prompt render slot/state is gone"
    requirement: AUTH-01
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/App.test.tsx (existing suite, unaffected routing paths re-verified)"
        status: pass
    human_judgment: false
  - id: D3
    description: "UnlockView.tsx renders exactly one autofocused password input and one unconditional btn-accent passkey button (no D-12 gating), zero email input, zero sign-in button; password submit dispatches unlock.password and calls onUnlocked() with no arguments; the passkey button dispatches unlock.serverCeremony.start mode:unlock and a failure broadcast never permanently disables it"
    requirement: AUTH-02
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/UnlockView.test.tsx (Plan 15-03 rewrite)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Full visual/live-browser confirmation that the re-laid-out popup surfaces match 15-UI-SPEC.md exactly (spacing, color, icon placement) in a real Chrome/Firefox popup"
    verification: []
    human_judgment: true
    rationale: "This plan is unit/component-test level by design (jsdom via vitest, no real browser popup chrome/rendering); a live-browser visual pass is the appropriate follow-on verification, not reproducible from this plan's own test suite."

# Metrics
duration: ~50min
completed: 2026-07-20
status: complete
---

# Phase 15 Plan 03: Popup Auth Re-layout (SignInView + UnlockView Rewrite) Summary

**New minimal signed-out hero (`SignInView.tsx`) replaces the popup's own sign-in form entirely, and `UnlockView.tsx` is rewritten unlock-only/password-first with the passkey button promoted to `btn-accent` and the D-12 disabled-forever machinery retired — the popup's total auth surface is now exactly "unlock (locked state) + server URL config", matching 15-UI-SPEC.md and Bartek's "auth w popupie = TYLKO odblokowanie i URL serwera" mandate.**

## Performance

- **Duration:** ~50 min
- **Tasks:** 2
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- `SignInView.tsx` (new): wordmark (Heading role, 20px) + one `btn btn-primary` "Zaloguj się" CTA + a top-right `Server` icon-button, zero input elements — dispatches `unlock.serverCeremony.start` mode:signin, resolves via the existing `unlock.serverCeremony.state` broadcast
- `App.tsx`: the `unlock` ViewState kind now branches on `status.kind` — `no-session` renders `SignInView`, `locked` renders `UnlockView` — both driven by the same `handleUnlocked()` zero-arg callback; `EnrollExtPasskeyPrompt` import/render slot and `showEnrollPrompt` state deleted outright (AUTH-03's "no UI, pure deletion" mandate, App.tsx's own slice)
- `UnlockView.tsx` rewritten in place: `status`/`onUnlocked` props narrowed to locked-only/zero-arg; the entire ext-scoped PRF surface (`buildExtGetOptions`/`extractPrfBytes` imports, `randomChallengeB64()`, `handlePrfUnlock()`, `PrfNotice` type, every `prf*`/D-12/`import.meta.env.FIREFOX` state and JSX branch) deleted; markup reordered per UI-SPEC — `Server` icon-button top-right (replaces the old bottom `btn-link`) → session notice → autofocused password field (new behavior) → error → "Odblokuj" submit → divider → unconditional "Odblokuj passkeyem" (`btn-accent`, promoted from `btn-outline`) → busy/failure lines
- `dictionary.ts`: `unlock.serverCeremonySigninFailed`'s stale "or use your password" clause fixed (the sign-in hero has no password field to fall back to)

## Task Commits

Each task was committed atomically:

1. **Task 1: SignInView.tsx (new) + App.tsx wiring** - `964a16e` (feat)
2. **Task 2: UnlockView.tsx password-first rewrite** - `7dabd84` (feat)

_Both tasks were TDD-flagged (`tdd="true"`); tests were written and run alongside the implementation edits in the same commit per this codebase's established single-commit-per-task convention._

## Files Created/Modified
- `extension/entrypoints/popup/SignInView.tsx` - New minimal signed-out hero component
- `extension/entrypoints/popup/SignInView.test.tsx` - 7 new test cases (zero-input assertion, wordmark, dispatch, ok:true/ok:false/synchronous-failure resolution, Server icon-button click)
- `extension/entrypoints/popup/App.tsx` - Routes `no-session`/`locked` to `SignInView`/`UnlockView`; `handleUnlocked()` narrowed to zero-arg; `EnrollExtPasskeyPrompt` import/render slot/state deleted
- `extension/entrypoints/popup/UnlockView.tsx` - Password-first rewrite, ext-scoped PRF surface deleted, passkey button promoted to `btn-accent` and unconditional
- `extension/entrypoints/popup/UnlockView.test.tsx` - Rewritten: sign-in-variant/PRF test blocks removed (coverage moved to `SignInView.test.tsx`), server-ceremony tests updated for unconditional rendering (no more `config.get`-based gating setup)
- `extension/lib/i18n/dictionary.ts` - `unlock.serverCeremonySigninFailed` copy fix (this plan's only dictionary edit, per the plan's explicit sequencing note vs. Plan 15-02's AUTH-04 keys)

## Decisions Made
- Removed `UnlockView.tsx`'s `hasServerConfig` state/effect entirely rather than keeping it as inert state — the UI-SPEC flagged it "arguably removable, executor's call", and since the passkey button no longer gates on any "unusable" signal and App.tsx's routing already guarantees a configured server by the time this view renders, keeping unused state would have been dead weight (mirrors the identical rationale the UI-SPEC already applied to `SignInView.tsx`'s own button).
- `handleServerCeremonyUnlock` narrowed to zero-arg (mode hardcoded to `"unlock"` internally) rather than keeping the `mode` parameter for a smaller diff — the plan explicitly allowed either choice, and there is no reachable `"signin"` call site left in this file after the rewrite, so the narrower signature is more honest about what the function actually does.

## Deviations from Plan

None - plan executed exactly as written. All state/function/JSX deletions the UI-SPEC and PATTERNS.md called out were applied; the two decisions above are within the plan's own explicitly stated "executor's call" latitude, not corrections to unplanned discoveries.

## Issues Encountered
- **Fresh worktree, no built WASM artifacts (documented, expected):** per this plan's `environment_notes`, ran `npm install` (extension/), `bash scripts/build-wasm.sh`, and `npx wxt prepare` before any test/tsc invocation — resolved cleanly, no deviation.
- **Pre-existing flaky test, out of scope:** `entrypoints/background/generate-handler.test.ts`'s "passphrase mode returns a password with the requested word count" test intermittently failed once under a full-suite `npx vitest run` (unseeded RNG producing 6 words instead of 5), but passed consistently (3/3) in isolation and on every subsequent full-suite rerun. Not in this plan's `files_modified`, unrelated to popup auth surfaces — logged to `deferred-items.md` per the SCOPE BOUNDARY rule, not fixed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 15-04 (Wave 3, depends on this plan) can now proceed: this plan stopped CALLING the ext-scoped PRF files/router.ts kinds but deliberately left the underlying files/message kinds in place (per this plan's own scope note) — 15-04 deletes them and narrows `SessionStatus`.
- Plan 15-05 (AUTH-04 confirm dialog) is unblocked on the dictionary side: this plan's only `dictionary.ts` edit (`unlock.serverCeremonySigninFailed`) never touched the 3 `config.changeServer*` keys 15-02 already landed in wave 1.
- Plan 15-07 (e2e rework) now has a stable, tested popup surface to drive: `SignInView`'s `data-testid="server-ceremony-signin-button"` and `UnlockView`'s `data-testid="server-ceremony-unlock-button"`/`pv-unlock-password` selectors are unchanged from their prior values, so any existing e2e selectors targeting them keep working.
- No blockers introduced by this plan.

---
*Phase: 15-login-unlock-unification-vaultwarden-model*
*Completed: 2026-07-20*

## Self-Check: PASSED

All 6 created/modified source files plus this SUMMARY confirmed present on disk; both task commits (`964a16e`, `7dabd84`) confirmed present in `git log --oneline --all`.
