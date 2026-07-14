---
phase: 06-import-export-totp-onboarding
plan: 04
subsystem: ui
tags: [react, onboarding, i18n, localStorage, daisyui]

requires:
  - phase: 06-import-export-totp-onboarding
    provides: "ImportWizard { onDone, onSkip?, onCancel? } (06-03) -- mounted inline, unmodified, as Onboarding Step 1"
provides:
  - "OnboardingWizard: full-screen 3-step first-run takeover (import -> orientation -> finish), z-50, echoes UnlockOverlay's blur/scrim chrome"
  - "flag.ts: isOnboardingComplete()/markOnboardingComplete() -- per-browser localStorage gate, fail-safe-to-not-showing-again on a storage error"
  - "page.tsx wiring: RegisterForm's onAuthed (register-only) triggers the takeover when the flag is unset; LoginForm's onAuthed is untouched"
affects: []

tech-stack:
  added: []
  patterns:
    - "flag.ts's fail-safe direction is the deliberate OPPOSITE of autolock.ts's: a storage-read error means 'never force onboarding again' (onboarding is non-critical UX), not a security-control default"
    - "OnboardingWizard's own step-machine tests mock ImportWizard as a two-button test double (onSkip/onDone) per the codebase's established heavy-child shallow-mock convention (mirrors SettingsPanel.test.tsx's ImportWizard/ExportDialog mocks) -- exercises only the wizard's step transitions, not Plan 06-03's already-tested internals"
    - "page.test.tsx shallow-mocks every heavy shell/vault child (Sidebar/TopBar/MainColumn/ItemList/DetailPanel/TypePicker/ItemForm/CopyToast/ErrorToast/SettingsPanel/UnlockOverlay/LoginForm/RegisterForm/OnboardingWizard) to isolate page.tsx's own authed/mode/showOnboarding state-machine wiring"

key-files:
  created:
    - web/src/lib/onboarding/flag.ts
    - web/src/lib/onboarding/flag.test.ts
    - web/src/components/onboarding/OnboardingWizard.tsx
    - web/src/components/onboarding/OnboardingWizard.test.tsx
    - web/src/components/onboarding/OnboardingStep1Import.tsx
    - web/src/components/onboarding/OnboardingStep2MeetVault.tsx
    - web/src/components/onboarding/OnboardingStep3Finish.tsx
    - web/src/app/page.test.tsx
  modified:
    - web/src/app/page.tsx
    - web/src/lib/i18n/dictionary.ts

key-decisions:
  - "onboarding.step2PrfAnnotation added as a new dictionary key for Step 2's single hand-drawn flourish -- 06-UI-SPEC.md calls for the annotation but doesn't literally name its copy; kept it dictionary-sourced (PL 'nowość' / EN 'new') rather than hardcoding a raw string, consistent with the rest of this codebase's i18n-everything-visible discipline."
  - "Step 2's back button reuses the existing import.back key (06-UI-SPEC.md explicitly frames it as 'an import.back-equivalent') rather than minting a new onboarding.back key -- no new key needed since the copy is identical ('Wstecz'/'Back')."
  - "OnboardingStep1Import passes no onCancel to the embedded ImportWizard -- an aborted-mid-mapping exit falls back to ImportWizard's own onDone default (advances to Step 2), matching Plan 06-03's documented prop-default pattern and the plan's explicit instruction that this must behave like Skip's sibling, not a third path."

requirements-completed: [UI-04]

coverage:
  - id: D1
    description: "OnboardingWizard drives a working 3-step takeover: Step 1 mounts the real ImportWizard (onSkip -> step 3, onDone -> step 2), Step 2 is static PRF/auto-lock orientation content with next/back, Step 3's finish sets the localStorage completion flag exactly once and calls onFinish exactly once"
    requirement: "UI-04"
    verification:
      - kind: unit
        ref: "web/src/components/onboarding/OnboardingWizard.test.tsx (7 tests)"
        status: pass
      - kind: unit
        ref: "web/src/lib/onboarding/flag.test.ts (4 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A freshly registered user (RegisterForm's onAuthed, never LoginForm's) sees the onboarding takeover exactly once per browser, gated by isOnboardingComplete(); finishing reveals the normal vault shell"
    requirement: "UI-04"
    verification:
      - kind: unit
        ref: "web/src/app/page.test.tsx (4 tests)"
        status: pass
      - kind: other
        ref: "cd web && npm run build (static export)"
        status: pass
    human_judgment: false

duration: 9min
completed: 2026-07-14
status: complete
---

# Phase 6 Plan 4: Onboarding wizard (UI-04) Summary

**A full-screen 3-step first-run onboarding takeover (`OnboardingWizard`) that embeds Plan 06-03's real `ImportWizard` as Step 1, offers static PRF/auto-lock orientation as Step 2, and a calm finish screen as Step 3 — triggered once, only after registration, gated by a per-browser `localStorage` flag.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-07-14T16:45:32+02:00 (worktree base commit)
- **Completed:** 2026-07-14T16:53:47+02:00
- **Tasks:** 2
- **Files modified:** 10 (8 created, 2 modified)

## Accomplishments
- `flag.ts`: `isOnboardingComplete()`/`markOnboardingComplete()`, localStorage-backed, deliberately fail-safe toward "never show onboarding again" on a storage error (the opposite fail-safe direction from `autolock.ts`'s security-critical default).
- `OnboardingWizard.tsx`: internal `step: 1|2|3` state machine, full-screen `z-50` takeover echoing `UnlockOverlay`'s exact `fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md bg-base-300/70` chrome, `aria-hidden` step-dot row paired with an `sr-only` live region announcing `onboarding.stepIndicator`. No dismiss-via-backdrop/Esc — exits only via its own step buttons.
- `OnboardingStep1Import.tsx`: thin wrapper mounting the real `ImportWizard` (Plan 06-03) unmodified — `onSkip` jumps to Step 3 (bypassing Step 2 entirely, per 06-CONTEXT.md's "a real skip should feel like one click out"), `onDone` advances to Step 2.
- `OnboardingStep2MeetVault.tsx`: static PRF-unlock (teal `KeyRound`) + auto-lock/clipboard (`Lock`) highlight cards with one hand-drawn annotation flourish; `onboarding.next`/back.
- `OnboardingStep3Finish.tsx`: `CircleCheck` completion screen; `onboarding.finish` calls `markOnboardingComplete()` then `onFinish` — each exactly once, only reachable by confirming Step 3 (Skip alone never completes onboarding).
- `page.tsx`: new `showOnboarding` state, set only from `RegisterForm`'s `onAuthed` when `isOnboardingComplete()` is false; `LoginForm`'s `onAuthed` is byte-for-byte unchanged. `OnboardingWizard` renders as a `z-50` sibling of `UnlockOverlay`.
- 22 new `onboarding.*` dictionary keys (PL/EN), copied verbatim from 06-UI-SPEC.md's Copywriting Contract where specified.
- Full suite: 49 test files / 331 tests pass; `npx tsc --noEmit` clean; `npm run build` (including the `build-wasm.sh` prebuild step) succeeds.

## Task Commits

Each task was committed atomically:

1. **Task 1: Onboarding flag + `OnboardingWizard` shell + 3 step components** - `a523b3f` (feat, TDD)
2. **Task 2: Wire `OnboardingWizard` into `page.tsx` after registration** - `05b5b11` (feat)

_TDD note: Task 1 was marked `tdd="true"`; test files were written alongside implementation in the same commit (RED+GREEN combined) — the task's own `<verify>` vitest command was run and passed before the commit, matching this phase's established Plan 06-01/06-02/06-03 convention._

## Files Created/Modified
- `web/src/lib/onboarding/flag.ts`/`.test.ts` — localStorage completion flag, 4 tests
- `web/src/components/onboarding/OnboardingWizard.tsx`/`.test.tsx` — step-machine shell, 7 tests
- `web/src/components/onboarding/OnboardingStep1Import.tsx` — real `ImportWizard` wrapper
- `web/src/components/onboarding/OnboardingStep2MeetVault.tsx` — static orientation content
- `web/src/components/onboarding/OnboardingStep3Finish.tsx` — completion screen
- `web/src/app/page.tsx` — `showOnboarding` state + register-only wiring
- `web/src/app/page.test.tsx` (new) — 4 tests covering all `<behavior>` cases
- `web/src/lib/i18n/dictionary.ts` — `onboarding.*` PL/EN keys

## Decisions Made
- `onboarding.step2PrfAnnotation` added as a new dictionary key (PL "nowość" / EN "new") for Step 2's single hand-drawn flourish, rather than a hardcoded raw string — 06-UI-SPEC.md names the annotation's existence but not its literal copy.
- Step 2's back button reuses `import.back` (06-UI-SPEC.md explicitly frames it as "an `import.back`-equivalent") instead of minting a new key.
- `OnboardingStep1Import` passes no `onCancel` to `ImportWizard` — relies on `ImportWizard`'s own `onDone` fallback for an aborted-mid-mapping exit, per the plan's explicit instruction that this should behave like Skip's sibling.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `web/node_modules` missing in the fresh worktree**
- **Found during:** Pre-flight, before running any vitest command
- **Issue:** The worktree's `web/` directory had no `node_modules` — the same known parallel-worktree gap documented in every prior Phase 6 plan's SUMMARY.
- **Fix:** Ran `npm ci` in `web/` (212 packages installed cleanly).
- **Files modified:** none tracked (`node_modules` is gitignored).
- **Verification:** Subsequent `npx vitest run`/`npm run build` succeeded.
- **Committed in:** N/A (no tracked file change).

**2. [Rule 3 - Blocking] `web/src/lib/crypto/wasm/pv_wasm.js` missing in the fresh worktree**
- **Found during:** First full-suite `npx vitest run` (after Task 2), which showed 8 unrelated failures across `src/lib/crypto/index.test.ts`, `PasskeysTab.test.tsx`, and `ItemList.test.tsx` — all with the identical `Failed to resolve import "./wasm/pv_wasm.js"` error.
- **Issue:** The WASM glue/binary artifacts (gitignored build output) hadn't been generated yet in this fresh worktree.
- **Fix:** Ran `bash scripts/build-wasm.sh` (also this project's own `npm run build`'s `prebuild` step, so this is not a new build step, just running it once ahead of the full-suite check).
- **Files modified:** none tracked (`web/src/lib/crypto/wasm/`, `web/public/wasm/` are gitignored build outputs).
- **Verification:** Full suite went from 8 failing / 46 passing test files to 49/49 passing (331 tests) after the rebuild; confirmed unrelated to any file this plan touched.
- **Committed in:** N/A (no tracked file change).

---

**Total deviations:** 2 auto-fixed (both Rule 3 — pre-existing fresh-worktree environment gaps, same class already documented in every prior Plan 06-01/02/03 SUMMARY). No scope creep — neither changed any locked behavior, requirement, or the plan's specified component contracts.

## Issues Encountered
None beyond the deviations above.

## User Setup Required

None — no external service configuration required. No new npm dependency was added this plan.

## Next Phase Readiness
- Phase 6 (import-export-totp-onboarding) is now fully executed across all 4 plans: TOTP item type (06-01), import/export mapping layer (06-02), ImportWizard/ExportDialog/Settings wiring (06-03), and this plan's onboarding wizard (06-04).
- No blockers for subsequent phases. The onboarding takeover's `pv-onboarding-complete` localStorage flag is per-browser only, by design (06-CONTEXT.md) — no server-side migration or account-state change is needed if a future phase revisits this.

---
*Phase: 06-import-export-totp-onboarding*
*Completed: 2026-07-14*

## Self-Check: PASSED

All created files (`flag.ts`, `flag.test.ts`, `OnboardingWizard.tsx`, `OnboardingWizard.test.tsx`, `OnboardingStep1Import.tsx`, `OnboardingStep2MeetVault.tsx`, `OnboardingStep3Finish.tsx`, `page.test.tsx`, this SUMMARY.md) and both task commit hashes (`a523b3f`, `05b5b11`) verified present on disk / in `git log --oneline --all`.
