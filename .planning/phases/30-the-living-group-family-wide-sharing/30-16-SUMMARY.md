---
phase: 30-the-living-group-family-wide-sharing
plan: 16
subsystem: testing
tags: [playwright, e2e, live-crypto, webauthn-free, family-sharing, websocket-push]

# Dependency graph
requires:
  - phase: 30-04
    provides: family-wide share creation UI (share-recipient-family-wide row) and multi-recipient fan-out
  - phase: 30-06
    provides: invitation_family_wide_keys table and invite-time wrap mechanism
  - phase: 30-08
    provides: recipient rules for the family-wide fan-out (published-key-only members)
  - phase: 30-09
    provides: GET /api/families/family-wide-pending discovery endpoint
  - phase: 30-12
    provides: lazy-reseal trigger scaffolding (onFamilyWidePending)
  - phase: 30-13
    provides: the reseal trigger wired into store.ts's syncCallbacks
  - phase: 30-15
    provides: the synthetic pending-family-key row and its detail-panel note
provides:
  - Live, recipient-side, positive proof (real browser + real pv-server + real ciphertext) that SC2 (current members read a family-wide share) is true
  - Live proof of SC3's invite-carried path (fresh invite issued after the share exists reads it on first sync, no reseal needed)
  - Live proof of SC3/FSH-02's gap-window path (invite issued before the share exists; an already-online keyholder's own unlock cycle triggers lazy reseal; the newcomer's own session resolves it with no reload)
  - Two new stable, reconstructible e2e identities (member C, member D) and a generalized ensureNamedFamilySession helper
affects: [30-secure-phase, phase-30-uat, family-sharing-regressions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Recipient-side, positive, decrypted-content assertions only -- never a row count or presence check (assertRecipientDecrypts helper)"
    - "Reload-free lock/unlock through the real Sidebar control to re-enter subscribeLockState's unlock branch, instead of a page reload"
    - "Fixed, reconstructible test identities (ensureNamedFamilySession) for scenarios that must name the same account across multiple test() blocks in one file, distinct from twoSessions' unique-per-call identities"

key-files:
  created:
    - web/e2e/family-wide-sharing.spec.ts
  modified:
    - web/e2e/fixtures.ts

key-decisions:
  - "Locked all other keyholders (owner, B, C) before member D redeems the gap-window invite, so the lazy-reseal trigger firing is proven to be caused by member B's own subsequent unlock, not an already-online session racing ahead of the assertion"
  - "Used a real WebSocket-driven resync rather than waiting out the full 30s poll interval where possible -- the app's own sync.ts pushes a catch-up pullOnce() over its existing WebSocket connection, so the gap-window case resolved in ~3s of real wall time rather than requiring the full POLL_INTERVAL_MS bound; the 180s timeout on the disappearance assertion is a generous upper bound, not the observed behavior"
  - "Retries pinned to 0 for this file (test.describe.configure) -- the gap-window sequence is a single stateful precondition ('D is not a member and no gap-window share exists yet') that a retry would silently invalidate, producing a failure unrelated to the mechanism under test"

requirements-completed: [FSH-01, FSH-02, FSH-03]

coverage:
  - id: D1
    description: "SC2 -- every current family member reads a family-wide share, recipient-side, on real decrypted content (item name + revealed password)"
    requirement: "FSH-01"
    verification:
      - kind: e2e
        ref: "web/e2e/family-wide-sharing.spec.ts#SC2: current members read a family-wide share — recipient decrypts real content"
        status: pass
    human_judgment: false
  - id: D2
    description: "SC3 invite-carried -- a late joiner whose invite was generated after the share existed decrypts the same real content on its own first sync, with no other member acting"
    requirement: "FSH-02"
    verification:
      - kind: e2e
        ref: "web/e2e/family-wide-sharing.spec.ts#SC3 fresh invite: a late joiner reads it immediately, with no other member acting"
        status: pass
    human_judgment: false
  - id: D3
    description: "SC3/FSH-02 gap window -- a late joiner whose invite predates the share sees an honest pending row, then resolves to real decrypted content once any current keyholder's own session next runs (lazy reseal), with no reload anywhere in the sequence"
    requirement: "FSH-02"
    verification:
      - kind: e2e
        ref: "web/e2e/family-wide-sharing.spec.ts#SC3 gap window: a late joiner whose invite predates the share waits, then resolves by lazy reseal"
        status: pass
    human_judgment: false

# Metrics
duration: 5min (this session; resumes a prior session's Tasks 1-3)
completed: 2026-08-10
status: complete
---

# Phase 30 Plan 16: Family-Wide Sharing Live Proof Summary

**Real browser + real pv-server + real ciphertext proof that SC2 and both SC3 delivery paths (invite-carried and gap-window lazy-reseal) are true, asserted recipient-side on decrypted content -- never on row presence.**

## Performance

- **Duration:** 5 min (this resumed session -- ran the pre-existing suite live and wrote this SUMMARY; the coding work across Tasks 1-4 was completed and committed in a prior session)
- **Started:** 2026-08-10T21:40:00Z
- **Completed:** 2026-08-10T21:47:33Z
- **Tasks:** 4/4 (Task 1 checkpoint verification, Task 2 fixtures, Task 3 SC2+SC3, Task 4 gap window)
- **Files modified:** 2 (`web/e2e/family-wide-sharing.spec.ts` created, `web/e2e/fixtures.ts` extended)

## Accomplishments

- **SC2 proven live:** the owner shares a real folder via the "Cała rodzina" row; an already-joined member's own client (after a real, reload-free lock/unlock re-arm of the `sharedPullDisabled` latch) opens the item and reveals the real decrypted password.
- **SC3 invite-carried path proven live:** an invite generated AFTER the family-wide share already exists carries the collection's key; a third real account (member C) redeeming it decrypts the same content on its own first sync, with no other member acting and no pending placeholder ever shown.
- **SC3/FSH-02 gap-window path proven live -- the phase's single most load-bearing claim:** an invite generated BEFORE the share exists structurally cannot carry its key. A fourth real account (member D) redeeming it correctly shows the honest pending row (never a decrypt-failure banner). Every other keyholder is locked to rule out a race. Only once member B's own already-open session performs a real unlock (re-entering `subscribeLockState`'s unlock branch and firing 30-13's reseal trigger) does D's own session -- untouched, no reload, no click -- resolve the pending row and reveal the real decrypted content. A second, completely fresh client for the same account confirms the resealed key is genuinely persisted server-side, not a session artifact.
- Live suite executed against an isolated, throwaway-DB test server (`web/playwright.config.ts`'s `PV_E2E_DB_DIR`-scoped tmp directory, confirmed free of any pre-existing `pv-server` on port 8620 both before this session's run and via the prior session's Task 1 checkpoint) -- `data/pv.db` was never touched.

## Task Commits

Each task was committed atomically in the prior session that produced this plan's code (this session ran the live suite and wrote this SUMMARY):

1. **Task 1: confirm isolated test server before generating live traffic** - checkpoint verification only, no code commit (re-confirmed this session via `lsof -i :8620` returning nothing, and by `playwright.config.ts`'s own `PV_E2E_DB_DIR` tmp-dir isolation)
2. **Task 2: fixtures -- a third/fourth idempotent session helper** - `c1b4fdb` (test)
3. **Task 3: SC2 (current members read) + SC3 (fresh-invite late joiner)** - `1347c93` (test)
4. **Task 4: the gap-window case -- invite before share, lazy reseal after** - `9d83fb9` (test)

_Note: all four tasks are `test`-typed, matching this plan's pure live-proof objective -- no production code changed._

## Files Created/Modified

- `web/e2e/family-wide-sharing.spec.ts` - the three live cases (SC2, SC3 invite-carried, SC3/FSH-02 gap window), all recipient-side, positive, decrypted-content assertions, zero reloads
- `web/e2e/fixtures.ts` - `ensureNamedFamilySession` (extracted from `ensureFamilyOwnerSession`) plus the two new fixed identities `FAMILY_MEMBER_C_EMAIL`/`FAMILY_MEMBER_D_EMAIL` and their `ensureFamilyMemberCSession`/`ensureFamilyMemberDSession` helpers

## Decisions Made

- Locked owner/B/C before D's gap-window join, so the lazy-reseal trigger's cause (B's own subsequent unlock) is unambiguous rather than racing an already-online session.
- Did not force a full 30s poll wait in the gap-window resolution step; the app's real WebSocket catch-up push resolved it in ~3s, so the 180s timeout in the spec is a documented upper bound, not the observed path. Recorded here rather than left as a silent surprise for a future reader of the timeout value.
- Retries pinned to 0 for this spec file -- a retry would run the gap-window sequence against a database where D has already joined and already holds the key, producing a false failure unrelated to the mechanism.

## Deviations from Plan

None - plan executed exactly as written. All four tasks' code was already complete and committed when this session resumed; this session's only remaining work was running the live suite against a freshly confirmed isolated server and confirming all three cases pass with genuinely recipient-side, positive, decrypted-content assertions (verified by reading the full spec file rather than trusting the commit messages alone).

## Issues Encountered

None this session. The prior session's own header comment in `family-wide-sharing.spec.ts` records one real finding from ITS first live run (a session reached via the invite landing renders in `pl` rather than `en` because `layout.tsx`'s pre-paint locale script never runs for `/invite/{id}`'s SPA-fallback-served route) -- already handled in the committed code via a structural locator (`accountMenuTrigger`) and a locale-tolerant regex match, not a new issue for this session.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SC2 and both SC3 delivery paths (invite-carried, gap-window lazy-reseal) now have live, non-mocked, recipient-side evidence -- closing the gap the phase's own memory note flagged ("both suites mock crypto: a green unit test is NOT evidence for a crypto claim").
- FSH-01, FSH-02, FSH-03 are all covered by this plan's live proof; no blockers for phase completion from this plan.
- `web/e2e/family-wide-sharing.spec.ts` is now part of the standing e2e suite and will run on every future CI invocation of `web/playwright.config.ts`, guarding against regression of the living-group mechanism.

---
*Phase: 30-the-living-group-family-wide-sharing*
*Completed: 2026-08-10*

## Self-Check: PASSED

- FOUND: `.planning/phases/30-the-living-group-family-wide-sharing/30-16-SUMMARY.md`
- FOUND: `web/e2e/family-wide-sharing.spec.ts`
- FOUND: `web/e2e/fixtures.ts`
- FOUND commit: `c1b4fdb` (Task 2)
- FOUND commit: `1347c93` (Task 3)
- FOUND commit: `9d83fb9` (Task 4)
- Live run this session: `npx playwright test e2e/family-wide-sharing.spec.ts --retries=0` -> 3 passed (19.1s), against an isolated `PV_E2E_DB_DIR` tmp-DB server, port 8620 confirmed free before the run.
