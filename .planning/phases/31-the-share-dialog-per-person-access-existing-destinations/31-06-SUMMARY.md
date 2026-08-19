---
phase: 31-the-share-dialog-per-person-access-existing-destinations
plan: 06
subsystem: ui
tags: [react, share-dialog, toctou, e2e, live-proof, atomicity, phase-acceptance]

# Dependency graph
requires:
  - phase: 31-05
    provides: "The row model, destination selector, and honest submit-CTA/hidden-password copy this plan's live tests drive through the real dialog."
  - phase: 31-03
    provides: "submitRowsForExistingDestination (the existing-destination dispatch this plan's fresh re-fetch guard wraps) and its own dispatch-count unit test (Task 1), cited by this plan's Q2 live proof instead of re-derived."
  - phase: 31-02
    provides: "The item-scope reconcileRow dispatch-count unit test (Task 1), cited alongside 31-03-T1 as Q2's dispatch-level proof half."
provides:
  - "A fresh, pre-dispatch getCollection(destinationId) re-fetch inside submitRowsForExistingDestination -- never a value cached from dialog-open/destination-select time -- that maps BOTH a sealed_key: null response and a caught getCollection exception to the SAME new DestinationUnavailableError/share.destinationUnavailable refusal."
  - "A deliberately-driven live e2e proof of SC5's TOCTOU window: a second, independent edit-holder revokes the caller's own destination access mid-session, and the refusal is proven honest (rendered while share-dialog is still mounted) AND state-preserving (destination access list read from the second edit-holder's own token, unchanged beyond the deliberate revoke itself)."
  - "Q2's end-state live proof: an in-place level edit and a brand-new grant in ONE dialog submission both land at their own chosen level, with the dispatch-level half of the atomicity claim cited (not re-derived) from 31-03-T1/31-02-T1's existing unit tests."
  - "The phase's final CI-width acceptance sweep, run from a fresh build of HEAD: cargo test --workspace (387 passed), npm run compile (clean), npm test (997 passed), npm run build (clean), and the full 4-spec live Playwright suite (26 passed)."
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "New-error-class + instanceof-catch precedent extended a second time: DestinationUnavailableError mirrors FamilyWideKeyPendingError's exact shape (a named, non-retryable cause gets its own class and its own honest dictionary string, caught specifically in handleSubmit's catch block before the generic share.createFailed fallback)."
    - "A pre-dispatch guard runs ONCE before a per-row loop, not per-row -- when the precondition it checks (caller's own access to the destination) is loop-invariant, checking it once and throwing before any row dispatches is what makes 'no partial membership' hold by construction rather than by cleanup."
    - "Deliberately-driven TOCTOU proof: a genuinely narrow race window (RESEARCH.md's own finding) is proven not by waiting for it, but by a second, independent session performing the exact concurrent action (revoking the caller's own access) between two steps of the first session's own UI flow that the harness can pause between (destination-select and submit-click are two separate Playwright actions, so the window is trivially drivable, not actually a race in test conditions)."
    - "Server-state assertions after a caller loses access must read from a DIFFERENT session's token -- the caller's own token would itself now 404, so the 'unchanged' proof needs a witness who still has access (here: the second edit-holder, who is also the one who performed the revoke)."

key-files:
  created: []
  modified:
    - web/src/components/vault/ShareDialog.tsx (DestinationUnavailableError class; submitRowsForExistingDestination's fresh pre-dispatch getCollection guard; handleSubmit's new instanceof branch)
    - web/src/components/vault/ShareDialog.test.tsx (2 new unit tests: sealed_key: null branch, getCollection-throws branch; mockGetCollection added to the api mock + beforeEach default)
    - web/src/lib/i18n/dictionary.ts (share.destinationUnavailable, NEW)
    - web/e2e/sharing.spec.ts (apiDelete helper; SC5 live TOCTOU test; Q2 live end-state test)
    - .planning/phases/31-.../31-VALIDATION.md (31-06-T1/T2 rows marked done)

key-decisions:
  - "The fresh re-fetch guard runs ONCE, before submitRowsForExistingDestination's dispatch loop -- not per-row. The caller's own access to a single destination is one fact, true or false for every row in that submission; checking it once and throwing before the loop starts is what makes 'no partial membership behind' a structural guarantee (nothing was ever dispatched) rather than something a cleanup path has to undo."
  - "Both refusal shapes (sealed_key: null, and the getCollection call itself throwing) collapse to the SAME DestinationUnavailableError/share.destinationUnavailable message. RESEARCH.md's own finding is that the getCollection-throws shape (a 404 from the RequireRead-gated handler) is the actually-reachable one in production -- the sealed_key: null branch is kept as a defensive check for a response shape that 'should be unreachable' through that same gate, per the existing collections.rs doc comment. Both are proven: one via a live TOCTOU-driven e2e (the reachable shape), one via a mocked-getCollection unit test (the defensive shape)."
  - "SC5's live test captures its BEFORE snapshot ON MEMBER A'S TOKEN before the deliberate revoke (matching the plan's own literal step ordering), which means the revoke itself changes state between the BEFORE and AFTER snapshots (the owner's own row disappears -- that is the deliberate setup action, not evidence of anything the failed submit did). The 'no partial membership from the failed attempt' assertion is therefore expressed as accessAfter === accessBefore.filter(row => row.user_id !== ownerUserId) -- isolating exactly what the deliberate revoke changed from what the doomed submit might have added, rather than a naive whole-snapshot equality that would conflate the two."
  - "Q2's live test uses THREE real accounts (owner + two independent recipients from twoSessions) so the single submission genuinely exercises both an UPDATE (memberA's existing read row edited to edit) and a GRANT (memberB's brand-new hidden_password row) in the same dispatch -- the shape the plan's own action text specifies, not a narrower single-op variant."
  - "Q2's live test deliberately does NOT attempt to assert dispatch call-shape (call counts, which client function fired) -- that is genuinely unobservable at the e2e layer, which only sees network requests/responses, not which JS function produced them. The dispatch-level half of Q2's claim is cited by name (31-03-T1's 'dispatch-count against an EXISTING destination' describe block, 31-02-T1's 'item-scope reconcileRow dispatch-count' test) in this test's own header comment, per the plan's explicit instruction not to re-derive it."

requirements-completed: [MOD-01, MOD-02, ORG-03]

coverage:
  - id: D1
    description: "A share that cannot complete because the destination's key became unavailable mid-session (caller's own access revoked in a concurrent session) is refused with an honest, non-retry-worded message, rendered while the dialog is still mounted, with server state provably unchanged beyond the deliberate revoke itself -- and the refusal is proven via a deliberately-driven TOCTOU window, not an untriggered branch"
    requirement: "ORG-03"
    verification:
      - kind: unit
        ref: "ShareDialog.test.tsx -- 'destination unavailable (31-06-PLAN.md, SC5, T-31-16)' describe block, 2 tests (sealed_key: null branch, getCollection-throws branch) -- falsification-proven (see below)"
        status: pass
      - kind: e2e
        ref: "sharing.spec.ts:1370 -- 'SC5: a concurrent revoke of the caller's OWN access to an existing destination, driven mid-session between destination-select and submit, refuses honestly with NO partial membership behind (T-31-16)' -- falsification-proven (see below)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Changing an existing recipient's level and granting a brand-new recipient in the same submission both land through exactly the correct single dispatch call each (dispatch-level, proven in 31-02/31-03), and the resulting server state reflects both changes atomically (end-state, proven live here) -- a final-state-only read cannot by itself distinguish an atomic update from a client-side revoke-then-re-add, so both halves are load-bearing"
    requirement: "MOD-01"
    verification:
      - kind: e2e
        ref: "sharing.spec.ts:1533 -- 'Q2: an in-place level EDIT and a brand-new GRANT in ONE submission both land correctly...' -- falsification-proven (see below)"
        status: pass
      - kind: unit
        ref: "ShareDialog.test.tsx -- '31-03-PLAN.md dispatch-count against an EXISTING destination (Blocker 7, T-31-06)' and 31-02-PLAN.md's item-scope 'reconcileRow dispatch-count' test -- pre-existing, cited not re-derived (this plan added no new dispatch-count assertion; see key-decisions)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The whole phase is green at CI width from a fresh build of HEAD: cargo test --workspace, npm run compile, npm test, npm run build, and the full 4-spec live Playwright suite"
    requirement: "MOD-02"
    verification:
      - kind: integration
        ref: "cargo test --workspace --no-fail-fast -- 387 passed, 0 failed, exit 0"
        status: pass
      - kind: other
        ref: "npm run compile (tsc --noEmit) -- exit 0, clean"
        status: pass
      - kind: unit
        ref: "npm test (vitest run) -- 92 files, 997 tests passed, exit 0"
        status: pass
      - kind: other
        ref: "npm run build (next build) -- exit 0, 5/5 static pages generated"
        status: pass
      - kind: e2e
        ref: "npx playwright test e2e/sharing.spec.ts e2e/shared-sync.spec.ts e2e/export-disclosure.spec.ts e2e/family-wide-sharing.spec.ts --retries=0 -- 26 passed, exit 0"
        status: pass
    human_judgment: false

# Metrics
duration: ~55min
completed: 2026-08-19
status: complete
---

# Phase 31 Plan 06: SC5's destination-unavailable refusal + Q2's atomicity end-state proof + phase-wide CI-width acceptance (final wave) Summary

**Closes SC5's second refusal case (a fresh pre-dispatch getCollection re-fetch, deliberately proven via a TOCTOU window a second edit-holder drives), closes Q2's end-state atomicity claim (an in-place edit and a fresh grant in one submission both land correctly, cited alongside two pre-existing dispatch-level unit tests), and closes Phase 31 with a green CI-width sweep from a fresh build of HEAD (387 Rust tests, 997 web unit tests, 26 live e2e tests).**

## Performance

- **Duration:** ~55 min (includes three separate live Playwright runs -- two falsification drives plus the final fresh-build sweep -- and a full `cargo test --workspace` run)
- **Completed:** 2026-08-19
- **Tasks:** 2/2
- **Files modified:** 5 (1 component, 1 unit test file, 1 dictionary, 1 e2e spec, 1 validation doc)

## Accomplishments

- `submitRowsForExistingDestination` now re-fetches `getCollection(destinationId)` fresh, immediately before dispatching the FIRST grant/update/revoke call of a submission against an existing destination -- never a value cached from dialog-open or destination-select time. Both a resolved `sealed_key: null` and the `getCollection` call itself throwing (the actually-reachable 404 shape, per `Membership<Collection, RequireRead>`'s own gate) collapse to a new `DestinationUnavailableError`, caught by `handleSubmit` and rendered as the new `share.destinationUnavailable` string -- deliberately not `share.createFailed`'s retry-inviting copy.
- The guard runs ONCE before the dispatch loop, not per-row, so "no partial membership behind" holds by construction: if the caller's own access is gone, nothing in the loop below ever reaches the network.
- A live e2e test drives SC5's narrow TOCTOU window deliberately: a second, independent edit-holder (co-manager of the destination) revokes the owner's own access mid-dialog-session, between the owner's destination-select and submit click. The refusal is asserted while `share-dialog` is still mounted, against a hardcoded EN literal, and the destination's access list (read from the second edit-holder's own token -- the owner's own token would itself now 404) is proven unchanged beyond that deliberate revoke.
- A second live e2e test proves Q2's end-state atomicity claim: in ONE submission, an existing recipient's row is edited from `read` to `edit` AND a brand-new second recipient's row is granted at `hidden_password`; both land correctly and no other row is touched. The test's own header comment cites 31-03-T1's and 31-02-T1's pre-existing dispatch-count unit tests for the dispatch-level half of the claim, explicitly declining to re-derive call-shape assertions at the e2e layer (genuinely unobservable there).
- The phase's final CI-width acceptance sweep ran from a genuinely fresh build of HEAD (both `.next`/`out` deleted before the web build, port 8620 confirmed free before the live run so Playwright's own `webServer` rebuilt the release binary and static export from scratch): all five commands green.

## Task Commits

1. **Task 1:** `feat(31-06): SC5's destination-unavailable refusal, deliberately driven via TOCTOU (T-31-16)` -- `421b460`
2. **Task 2:** `test(31-06): Q2's end-state live proof -- in-place level edit + fresh grant in one submission (T-31-17)` -- `cec2a41`

## Files Created/Modified

- `web/src/components/vault/ShareDialog.tsx` -- `DestinationUnavailableError` class; `submitRowsForExistingDestination`'s fresh pre-dispatch `getCollection` guard; `handleSubmit`'s new `instanceof DestinationUnavailableError` catch branch; `getCollection` added to the `@/lib/vault/api` import list
- `web/src/components/vault/ShareDialog.test.tsx` -- `mockGetCollection` added to the hoisted mocks, the `@/lib/vault/api` mock, and `beforeEach`'s default; new `"destination unavailable (31-06-PLAN.md, SC5, T-31-16)"` describe block (2 tests)
- `web/src/lib/i18n/dictionary.ts` -- `share.destinationUnavailable` (NEW): pl "Nie można udostępnić — brak dostępu do klucza tego miejsca docelowego.", en "Can't share — no access to this destination's key."
- `web/e2e/sharing.spec.ts` -- `apiDelete` helper (NEW, no prior raw-DELETE helper existed in this file); SC5 live TOCTOU test; Q2 live end-state test
- `.planning/phases/31-.../31-VALIDATION.md` -- 31-06-T1/T2 rows marked `✅ done`

## Decisions Made

- **The fresh re-fetch guard runs once, before the dispatch loop, not per-row.** The caller's own access to a single destination is one fact for the whole submission -- checking it once and throwing before any row dispatches makes "no partial membership behind" a structural guarantee, not a cleanup obligation.
- **Both refusal shapes (`sealed_key: null`, and `getCollection` itself throwing) map to the SAME error/message.** Per `collections.rs`'s own doc comment, a `null` `sealed_key` "should be unreachable" through the `RequireRead`-gated handler -- the throw (404) shape is what actually happens in production. Both are proven: the reachable shape via the live TOCTOU-driven e2e test, the defensive shape via a mocked unit test.
- **SC5's BEFORE snapshot is captured before the deliberate revoke** (matching the plan's own literal step ordering), so the "no partial membership" assertion is expressed as `accessAfter === accessBefore.filter(row => row.user_id !== ownerUserId)` rather than a naive whole-snapshot equality -- this isolates the deliberate setup action (the revoke itself, which legitimately changes state) from anything the doomed submit might have added.
- **Q2's live test uses three real accounts** so the one submission genuinely exercises both an UPDATE and a GRANT together, per the plan's own action text.
- **Q2's live test does not attempt to assert dispatch call-shape.** That is genuinely unobservable at the e2e layer (which sees network requests, not which client function produced them); the dispatch-level half of the claim is cited by name from 31-03-T1/31-02-T1's existing unit tests, per the plan's explicit instruction.

## Deviations from Plan

None -- plan executed exactly as written. No architectural changes, no missing-package situations, no auth gates encountered.

## Falsifications (mandatory, exact observed output)

**1. Task 1 -- SC5's live e2e test.** Temporarily removed the fresh `getCollection` re-fetch from `submitRowsForExistingDestination` (fell back to no pre-dispatch check at all, i.e. the pre-this-plan behavior), re-ran the SC5 test alone:

```
Error: expect(locator).toHaveText(expected) failed

Locator:  getByTestId('share-error')
Expected: "Can't share — no access to this destination's key."
Received: "Couldn't share. Try again."
Timeout:  15000ms
```

Without the guard, the submit instead dispatched against a destination the owner no longer had access to; `reshareCollectionToNewMember`'s own internal `getCollection` call threw inside the per-row `try/catch`, producing the generic, retry-inviting `share.createFailed` instead of the honest refusal -- exactly the "different, unhandled failure" the plan anticipated. Restored the guard; `diff` confirmed byte-identical to the committed state; reran the full `sharing.spec.ts` file -- 10/10 green again.

**2. Task 1 -- the two new unit tests.** Same guard removed, ran the `"destination unavailable (31-06-PLAN.md, SC5, T-31-16)"` describe block alone:

```
× ShareDialog > destination selector (...) > destination unavailable (...) > a fresh getCollection re-fetch resolving with sealed_key: null refuses honestly and dispatches NOTHING 1055ms
  → Unable to find an element by: [data-testid="share-error"]
× ShareDialog > destination selector (...) > destination unavailable (...) > a fresh getCollection re-fetch that itself throws (the 404 shape) refuses with the SAME honest message and dispatches NOTHING 1024ms
  → Unable to find an element by: [data-testid="share-error"]
```

Both new tests failed red (the mocked `reshareCollectionToNewMember` resolved normally and `onShared()` fired instead, so no `share-error` ever appeared). Restored the guard; `diff` confirmed byte-identical; reran the full `ShareDialog.test.tsx` suite -- 74/74 green.

**3. Task 2 -- Q2's live e2e test.** Temporarily replaced the `update` dispatch inside `submitRowsForExistingDestination` with a no-op (`async () => undefined`, in place of `updateCollectionAccess`), re-ran the Q2 test alone:

```
Error: memberA's in-place edit must land at edit, not read

expect(received).toBe(expected) // Object.is equality

Expected: "edit"
Received: "read"
```

Restored the real `updateCollectionAccess` dispatch; `git diff` confirmed the file byte-identical to the committed state; reran the Q2 test alone -- green again.

**No test deleted or weakened.** `ShareDialog.test.tsx` grew from 72 to 74 tests (both new, both falsification-proven). `sharing.spec.ts` grew from 24 to 26 live tests (both new: SC5, Q2 -- both falsification-proven).

## Final CI-Width Acceptance Sweep (phase-wide, from a fresh build of HEAD at commit `cec2a41`)

Run in order, after both falsifications above were restored and Task 2 was committed. `.next`/`out` deleted before the web build to force a genuine rebuild; port 8620 confirmed free before the live run so Playwright's own `webServer` rebuilt the release binary and static export from scratch rather than reusing a running server.

1. **`cargo test --workspace --no-fail-fast`** -- exit 0. **387 tests passed, 0 failed** across 27 test binaries (pv-core unit + backward_compat; pv-provider unit + real_rp_verification + response_shape; pv-server unit + 20 integration files; pv-wasm unit; 4 doc-test crates, 0 doc tests). Full per-binary counts captured in this session's own log.
2. **`cd web && npm run compile`** (`tsc --noEmit`) -- exit 0, clean, no output.
3. **`npm test`** (`npx vitest run`) -- exit 0. **`Test Files 92 passed (92)`, `Tests 997 passed (997)`** (995 pre-plan + 2 new: the two `DestinationUnavailableError` unit tests).
4. **`npm run build`** (`next build`) -- exit 0. Compiled successfully, TypeScript pass clean, **5/5 static pages generated** (`/`, `/_not-found`, `/self-test`, `/settings`).
5. **`npx playwright test e2e/sharing.spec.ts e2e/shared-sync.spec.ts e2e/export-disclosure.spec.ts e2e/family-wide-sharing.spec.ts --retries=0`** -- exit 0. **26 passed** (2.2m) -- 24 pre-plan (unchanged, still green) + 2 new (SC5, Q2), run against a genuinely fresh `cargo build --release -p pv-server` + `next build` chain triggered by Playwright's own `webServer` config (no server was already listening on port 8620 when the run started).

`data/pv.db` checksum (`sha256:8e043c9d...b997c8`) identical before and after every live run in this plan (three separate live Playwright invocations across both tasks plus the final sweep) -- the dev database was never touched; every live run used a fresh, throwaway `PV_E2E_DB_DIR`, and port 8620 was confirmed free before each live invocation and confirmed free again after teardown.

## `state.advance-plan` -- deliberately skipped

Per this plan's explicit constraint (matching 31-05's own precedent): this project's `STATE.md` uses a narrative structure `gsd-tools`'s `state advance-plan`/`state update-progress`/`state record-metric`/`state add-decision`/`state record-session` handlers cannot parse. No `STATE.md` state-update commands were run, and `STATE.md` was not hand-edited to satisfy the tool. `ROADMAP.md`/`REQUIREMENTS.md` updates were likewise skipped for the same reason.

## Issues Encountered

None beyond the falsification-drive iterations documented above (all expected, all restored cleanly, all confirmed byte-identical via `diff`/`git diff` before the next step). No architectural surprises, no auth gates, no missing packages.

## Phase 31 Readiness

This was the phase's final wave. Every plan (31-01 through 31-06) is complete: the destination selector, per-person row model, honest submit CTA, both revocation and update paths, SC5's deliberately-driven refusal case, and Q2's atomicity claim (dispatch-level, proven in 31-02/31-03; end-state, proven here) are all live-proven. The phase-wide CI-width sweep is green from a fresh build of HEAD. No outstanding blockers, no deferred items introduced by this plan.

## Self-Check: PASSED

Both modified source files (`ShareDialog.tsx`, `sharing.spec.ts`) confirmed present with the expected diffs (`git show --stat` reviewed against each commit). Both task commit hashes (`421b460`, `cec2a41`) confirmed present in `git log --oneline`.

---
*Phase: 31-the-share-dialog-per-person-access-existing-destinations*
*Completed: 2026-08-19*
