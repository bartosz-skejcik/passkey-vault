---
phase: 23-sync-model-extension-shared-data-fan-out
plan: 04
subsystem: testing
tags: [playwright, e2e, web, vitest, sec-08]

# Dependency graph
requires: []
provides:
  - "web/playwright.config.ts — the first Playwright config in web/, single headless chromium project, webServer boots a real release pv-server against a throwaway SQLite DB"
  - "web/e2e/fixtures.ts — twoSessions test fixture producing two independent browser.newContext() authenticated sessions via the real RegisterForm UI flow"
  - "web/e2e/smoke.spec.ts — the first proof the harness itself works (two distinct sessions, two distinct tokens, zero OS dialogs)"
affects: [23-06]

# Tech tracking
tech-stack:
  added: ["@playwright/test@1.61.1 (web/ devDependency, pinned to extension/package.json's already-vetted version)"]
  patterns:
    - "Playwright webServer builds+runs a real pv-server release binary against a throwaway per-run SQLite DB (mkdtempSync), never a manually-started dev server"
    - "Two independent browser.newContext() calls per test (never a shared context with a swapped token) for genuinely distinct bearer tokens/sessions"
    - "vitest test.exclude must list e2e/** whenever a Playwright suite lives alongside vitest specs in the same package (mirrors extension/vitest.config.ts's existing exclusion)"

key-files:
  created:
    - web/playwright.config.ts
    - web/e2e/fixtures.ts
    - web/e2e/smoke.spec.ts
    - web/.gitignore
  modified:
    - web/package.json
    - web/package-lock.json
    - web/vitest.config.ts

key-decisions:
  - "twoSessions fixture is TEST-scoped, not worker-scoped — unlike extension/e2e/fixtures.ts's cumulative single-vault-per-worker design, this harness's whole point is proving two fresh independent accounts bring up cleanly each time, so there is no cumulative state worth preserving across tests."
  - "Both sessions seed pv-locale=en and pv-onboarding-complete=true via context.addInitScript() before first paint — pure UX/test-ergonomics knobs (zero security/crypto stake per their own source doc comments), so the fixture can target stable English copy and the onboarding wizard never obscures the vault view being asserted on."
  - "No headed-mode carve-out project (unlike extension/playwright.config.ts's chromium-ceremony) — every session in this suite is password-only via RegisterForm, zero WebAuthn ceremonies ever invoked, so the headless-hangs-real-ceremonies hazard that carve-out exists for does not apply here."

patterns-established:
  - "web/playwright.config.ts's webServer command shape (npm --prefix build -> cargo build --manifest-path --release -p <pkg> -> run binary with env-scoped PV_DB_URL/PV_STATIC_DIR/PV_ADDR) for any future web/ e2e suite needing a real server."

requirements-completed: [SEC-08]

coverage:
  - id: D1
    description: "web/ gains a standing Playwright harness (config + fixtures + npm script) where none existed before"
    requirement: SEC-08
    verification:
      - kind: e2e
        ref: "web/e2e/smoke.spec.ts — cd web && npx playwright test smoke.spec.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Two independent browser.newContext() calls each hold a genuinely distinct bearer token and reach the authenticated vault view, with zero OS-level dialogs"
    requirement: SEC-08
    verification:
      - kind: e2e
        ref: "web/e2e/smoke.spec.ts#two independent sessions authenticate with distinct tokens and reach the vault"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-30
status: complete
---

# Phase 23 Plan 04: web/ Playwright Harness Scaffold Summary

**Stood up web/'s first-ever Playwright config: a single headless chromium project whose `webServer` boots a real release `pv-server` against a throwaway SQLite DB, proven by a smoke spec that brings up two genuinely independent authenticated sessions with distinct bearer tokens and zero OS-level dialogs.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-30T16:18:56+02:00 (approx, first commit reference)
- **Completed:** 2026-07-30T16:33:19+02:00
- **Tasks:** 2 (Task 2 followed the RED→GREEN TDD cycle)
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments
- `web/playwright.config.ts`: single headless `chromium` project (no persistent-context/extension-loading logic, no headed-mode carve-out), `fullyParallel: false`/`workers: 1`/`retries: 2` matching `extension/playwright.config.ts`'s precedent, and a `webServer` block with an explicit `timeout: 600_000` that builds `web/` (`NEXT_PUBLIC_API_BASE_URL=""`), builds `pv-server` scoped to `-p pv-server` in release mode, and runs it against a fresh `mkdtempSync`-generated throwaway SQLite DB.
- `web/e2e/fixtures.ts`: a test-scoped `twoSessions` fixture producing two independent `browser.newContext()` sessions, each completing a real register-then-land-on-vault flow through `RegisterForm`, each exposing a `dialogFired()` no-OS-dialog check.
- `web/e2e/smoke.spec.ts`: the first real proof the harness itself works — both sessions reach the authenticated vault view with non-empty, distinct `pv-session-token` localStorage values, act independently, and raise zero OS-level dialogs.
- Fixed a real regression the new files caused in `web/`'s existing vitest suite (vitest's default include glob was collecting the new Playwright spec and crashing `npm test`) by excluding `e2e/**`, mirroring `extension/vitest.config.ts`'s identical existing exclusion.

## Task Commits

Each task was committed atomically:

1. **Task 1: package.json + playwright.config.ts** - `7442dfa` (feat)
2. **Task 2: Two-session fixtures + smoke spec** - `7b19216` (test, RED) → `a5cdcd4` (feat, GREEN) → `cf0a92e` (fix, vitest exclusion regression found while confirming the plan's scope boundary was respected)

**Plan metadata:** (this commit)

_Note: Task 2 is `tdd="true"` — RED committed the failing test (missing `use.baseURL` in the config), GREEN wired the fix and confirmed the pass._

## Files Created/Modified
- `web/playwright.config.ts` - new Playwright config: chromium project, webServer real-server bring-up
- `web/e2e/fixtures.ts` - twoSessions fixture (two independent authenticated browser.newContext() sessions)
- `web/e2e/smoke.spec.ts` - the harness's first proof-of-life spec
- `web/.gitignore` - Playwright run-artifact ignores (test-results/playwright-report/blob-report/playwright/.cache), mirroring extension/.gitignore
- `web/package.json` - `@playwright/test@1.61.1` devDependency + `test:e2e` script
- `web/package-lock.json` - lockfile update from `npm install`
- `web/vitest.config.ts` - `test.exclude` now includes `e2e/**` so vitest never collects the new Playwright spec

## Decisions Made
- twoSessions fixture is TEST-scoped (see key-decisions above) — documented inline in fixtures.ts per the plan's "your call, document the choice" instruction.
- Seeded `pv-locale=en` + `pv-onboarding-complete=true` via `addInitScript` rather than touching any product file — both are pure UX knobs with no security/crypto stake, keeping this plan's file scope to exactly the four plan-listed files (plus the vitest-exclusion fix below, which was a Rule 1 regression fix, not a scope expansion).
- `use.baseURL: "http://localhost:8620"` added to `playwright.config.ts` (GREEN-gate fix) so `page.goto("/")` resolves against the real webServer origin.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vitest picked up the new Playwright spec and crashed `npm test`**
- **Found during:** Task 2, post-GREEN verification sweep of the existing `web/` vitest suite
- **Issue:** `web/vitest.config.ts` had no `e2e/**` exclusion; vitest's default include glob (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) matched `web/e2e/smoke.spec.ts` and crashed with "Playwright Test did not expect test() to be called here."
- **Fix:** Added `test.exclude: [...configDefaults.exclude, "e2e/**"]`, mirroring `extension/vitest.config.ts`'s existing, identically-reasoned exclusion.
- **Files modified:** `web/vitest.config.ts`
- **Verification:** `npm test` (web/) — 56 test files / 481 tests, all passing. `npx playwright test smoke.spec.ts` re-confirmed still green afterward.
- **Committed in:** `cf0a92e`

---

**Total deviations:** 1 auto-fixed (Rule 1 — regression bug this plan's own new files caused in existing tooling)
**Impact on plan:** Necessary for correctness of the existing `npm test` script; no scope creep — the fix is a one-line config addition with a direct same-repo precedent.

## Issues Encountered
- The RED gate for Task 2's TDD cycle was a genuine, naturally-occurring failure (`page.goto("/")` rejected with "Cannot navigate to invalid URL" because `playwright.config.ts` had no `use.baseURL` set) rather than a manufactured stub — documented and fixed as the GREEN gate (`a5cdcd4`).
- Fresh worktree required bootstrap not itself part of this plan's file list: `npm install` in `web/`, `npm ci` in `packages/pv-ui`, and `bash scripts/build-wasm.sh` — same standing pattern noted in STATE.md from Phase 16 ("świeży worktree executora wymaga bootstrapu"). No product files were changed by this bootstrap; it only populated gitignored `node_modules/` and WASM build output directories.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The standing `web/` Playwright harness (config + fixtures + npm script) is ready for Plan 23-06 to build the actual shared-sync proof specs on top of, per this plan's own objective.
- `web/e2e/fixtures.ts`'s `twoSessions` fixture is the reusable two-account bring-up primitive Plan 23-06 needs; no further scaffolding required before that plan starts.
- No blockers identified for this specific plan's scope.

---
*Phase: 23-sync-model-extension-shared-data-fan-out*
*Completed: 2026-07-30*

## Self-Check: PASSED

All created files verified present on disk (`web/playwright.config.ts`, `web/e2e/fixtures.ts`,
`web/e2e/smoke.spec.ts`, `web/.gitignore`, this SUMMARY.md). All 4 task/deviation commit hashes
(`7442dfa`, `7b19216`, `a5cdcd4`, `cf0a92e`) confirmed present in `git log --oneline --all`.
