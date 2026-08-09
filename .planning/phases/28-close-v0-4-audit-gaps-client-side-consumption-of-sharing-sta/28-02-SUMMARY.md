---
phase: 28-close-v0-4-audit-gaps-client-side-consumption-of-sharing-sta
plan: 02
subsystem: ui
tags: [react, nextjs, daisyui, i18n, playwright, sharing, rbac]

requires:
  - phase: 26
    provides: SharingOverviewPanel.tsx (D-1/E6), getCollectionAccessList/listItemShares wiring
provides:
  - "revokeCollectionAccess/revokeItemShare API-client wrappers (web/src/lib/vault/api.ts)"
  - "RevokeShareDialog.tsx — single-step revoke confirmation reusing DeleteConfirmDialog's shell"
  - "A per-recipient revoke row action on both SharingOverviewPanel.tsx tabs (By folder / By person)"
  - "Optimistic local-state splice with whole-row removal at zero recipients (zero-one-many)"
  - "Distinct inline copy for the 409 last-key-holder guard vs. a generic revoke failure"
affects: [sharing, vault-web]

tech-stack:
  added: []
  patterns:
    - "Revoke confirmation reuses DeleteConfirmDialog's exact shell (single-step tier) rather than RemoveMemberDialog's two-step tier — zero re-key cost, one-click undo path."
    - "Optimistic local-state splice on a 204 success, never a forced re-fetch — folderRows/personRows are spliced directly from the panel's own already-held state."

key-files:
  created:
    - web/src/components/vault/RevokeShareDialog.tsx
  modified:
    - web/src/lib/vault/api.ts
    - web/src/lib/i18n/dictionary.ts
    - web/src/components/vault/SharingOverviewPanel.tsx
    - web/src/components/vault/SharingOverviewPanel.test.tsx
    - web/e2e/sharing.spec.ts

key-decisions:
  - "Both real recipients are granted access to the same collection in ONE ShareDialog multi-select submission (selectedRecipientIds is a real Set<string>) rather than attempting WINDOWS #13's out-of-scope 'add a member to an existing collection' primitive — this needed no new crypto composition."
  - "The dialog closes / row is spliced ONLY after the DELETE's genuine 204 resolves — never optimistically ahead of the server response (T-28-11)."
  - "A found-and-fixed environment hazard: a stray local pv-server (debug build) was already listening on :8620 against the real data/pv.db. Playwright's reuseExistingServer picked it up instead of spinning up its own isolated instance, so early live-test runs briefly wrote pv-e2e-*/pv-e2e-sharing-* throwaway accounts into the real database via WAL. The stray process was stopped and the suite re-run against its own isolated instance; final results above are from the isolated run. The throwaway rows are additive-only (no existing data touched) but the user may want to clean them up."

requirements-completed: [SHARE-06]

coverage:
  - id: D1
    description: "revokeCollectionAccess/revokeItemShare API-client wrappers exist and call the correct DELETE endpoints"
    requirement: SHARE-06
    verification:
      - kind: e2e
        ref: "web/e2e/sharing.spec.ts#owner revokes one collection recipient's access from the Sharing overview while the other recipient keeps theirs, live (SHARE-06)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A revoke row action renders on both SharingOverviewPanel tabs (By folder, By person), including for suspended recipients"
    requirement: SHARE-06
    verification:
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#a suspended entry's row still renders the revoke button (suspended is never a filter)"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#the By-person tab's item-share row renders a revoke button that calls revokeItemShare with the correct item/user ids on confirm"
        status: pass
    human_judgment: false
  - id: D3
    description: "RevokeShareDialog renders distinct, honest copy for the 409 last-key-holder guard vs. a generic failure, never closing the dialog on error"
    requirement: SHARE-06
    verification:
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#a mocked 409 response renders share.revokeLastKeyHolder inline; the dialog stays open and the entry is NOT removed"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#a mocked generic-error response renders share.revokeFailed inline; the dialog stays open and the entry is NOT removed"
        status: pass
    human_judgment: false
  - id: D4
    description: "A folder/person reaching zero recipients after revoke removes the WHOLE row, not merely the recipient's <li>"
    requirement: SHARE-06
    verification:
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#revoking a folder's last-remaining recipient removes the WHOLE folder row, not merely the recipient's <li>"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#revoking a person's last-remaining entry removes the WHOLE person row"
        status: pass
    human_judgment: false
  - id: D5
    description: "A revoked recipient's server-side access is genuinely gone while a second, independent recipient's access is untouched (SHARE-06 adjacency)"
    requirement: SHARE-06
    verification:
      - kind: e2e
        ref: "web/e2e/sharing.spec.ts#owner revokes one collection recipient's access from the Sharing overview while the other recipient keeps theirs, live (SHARE-06)"
        status: pass
    human_judgment: false

duration: 24min
completed: 2026-08-09
status: complete
---

# Phase 28 Plan 02: Revoke wrappers, dialog, row wiring Summary

**Two new DELETE API wrappers (`revokeCollectionAccess`/`revokeItemShare`), a `RevokeShareDialog.tsx` confirmation reusing `DeleteConfirmDialog`'s shell, and a `UserMinus` row action on both `SharingOverviewPanel.tsx` tabs — closing v0.4 audit Blocker 1 (SHARE-06), live-proven against a real second recipient.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-08-09T16:37:00Z (approx., from prior phase commit boundary)
- **Completed:** 2026-08-09T17:01:00Z
- **Tasks:** 2 completed
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments

- `collections::revoke_access`/`vault::revoke_share` — server-complete, authorized, and tested since Phase 22/26 with **zero client callers outside a test fixture** — now have real UI callers: an owner can revoke a single collection share or a direct item share from the Sharing overview.
- The revoke confirmation is a genuine single-step destructive tier (reusing `DeleteConfirmDialog`'s exact shell) carrying the same non-negotiable honesty string class as `member.removeHonestyWarning`: revoking access does not undo what a recipient already saw.
- The 409 last-key-holder guard (collection-only) renders its own distinct, honest inline copy — never folded into the generic failure message.
- Zero-recipient rows (folder or person) are removed entirely from the panel's local state, never leaving a rendered `AvatarStack` next to a meaningless "Shared with 0" label.
- Live-proven end to end: a real owner shares a real folder with two real, independently-authenticated recipients in one `ShareDialog` multi-select submission, revokes one recipient's access through the real UI, and the OTHER recipient's own raw authenticated request is asserted completely untouched.

## Task Commits

Each task was committed atomically:

1. **Task 1: Revoke wrappers, dialog, row wiring — live-proven against a real second recipient** - `97164d1` (feat)
2. **Task 2: Item-share revoke path, error-state and zero-recipient coverage (component tests)** - `4a286a2` (test)

**Plan metadata:** (this commit)

_Note: Task 2 is intentionally test-only (no production files in its own `<files>` list) — see "TDD Gate Compliance" below._

## Files Created/Modified

- `web/src/lib/vault/api.ts` - `revokeCollectionAccess(collectionId, userId)`/`revokeItemShare(itemId, userId)`, thin DELETE wrappers mirroring `deleteItem`'s shape.
- `web/src/components/vault/RevokeShareDialog.tsx` (new) - Single-step revoke confirmation: `DeleteConfirmDialog`'s exact shell, dispatches to the correct wrapper by `kind`, distinct inline copy for 409 vs. generic failure, closes only on a genuine 204.
- `web/src/lib/i18n/dictionary.ts` - 9 new `share.revoke*` keys (PL/EN), verbatim from 28-UI-SPEC.md's Copywriting Contract; reuses `delete.cancel` for Cancel.
- `web/src/components/vault/SharingOverviewPanel.tsx` - `UserMinus` row action on both tabs' expanded rows; `revokeTarget` state; `handleRevoked` splices `folderRows`/`personRows` from the panel's own local state (never a forced re-fetch); `removeFolderRecipient`/`removePersonEntry` helpers implement the zero-one-many whole-row removal.
- `web/src/components/vault/SharingOverviewPanel.test.tsx` - 6 new/extended component tests: item-share revoke call correctness, suspended-row rendering, 409 inline copy, generic-error inline copy, folder zero-one-many, person zero-one-many.
- `web/e2e/sharing.spec.ts` - New live proof: owner shares one folder with two real recipients (`twoSessions` member + a fresh third session via a new `registerFreshSession` helper), revokes one recipient through the real Sharing overview UI, asserts the revoked recipient's own raw request 404s while the other recipient's own raw request still succeeds, with the row updating in the UI with no reload. Also adds `shareExistingFolderWithMembers` (multi-recipient variant of `shareExistingFolderWithMember`) and `openSharingOverview`.

## Decisions Made

- **Multi-select at collection creation, not WINDOWS #13's out-of-scope "add to existing collection."** The live proof needed TWO real recipients on the same collection. Rather than building the genuinely-new "unwrap my own sealed_key, reseal to a new recipient" crypto composition WINDOWS #13 would require (explicitly excluded by this phase's UI-SPEC/RESEARCH), both recipients are added in ONE `ShareDialog` submission — `selectedRecipientIds` is already a real `Set<string>` multi-select, so this needed zero new code.
- **Splice both aggregations on a folder-kind revoke.** `handleRevoked` updates BOTH `folderRows` (by folder+user_id) AND `personRows` (by user_id + the `folder:{id}` dedup key) for a collection revoke, since the same grant is reachable from both tabs' independent aggregations — an item-kind revoke only ever touches `personRows`.
- **Task 2 stays test-only, not RED→GREEN.** Task 2's own `<files>` list names only the test file; the behavior under test was already fully implemented in Task 1 (per the plan's own task ordering). Writing these tests against Task 1's already-landed code means they pass on first run — this is the plan's intended structure (a dedicated coverage-completion task), not a violated TDD gate. See "TDD Gate Compliance" below.

## Deviations from Plan

**1. [Rule 3 - Blocking issue] Stray local `pv-server` on :8620 hijacked early live-test runs into the real `data/pv.db`**

- **Found during:** Task 1, first live-test run of the new revoke spec.
- **Issue:** `web/playwright.config.ts`'s `webServer.reuseExistingServer: !process.env.CI` reuses ANY server already listening on `localhost:8620`. A pre-existing local dev `pv-server` (debug build, `PV_DB_URL=sqlite://data/pv.db` — the real, non-isolated vault database) was already running from an earlier, unrelated session. The e2e harness silently reused it instead of building `web/out` fresh and starting its own isolated-tmp-DB instance, so (a) the test ran against a STALE static build lacking the new revoke UI (the revoke button never rendered — confirmed via a debug DOM dump), causing the first two attempts to hang waiting for a locator that could never appear, and (b) several `pv-e2e-*`/`pv-e2e-sharing-*` throwaway test accounts were written into the REAL `data/pv.db` via WAL before this was diagnosed.
- **Fix:** Identified the stray process (`ps`/`lsof` on port 8620, confirmed `PV_DB_URL=sqlite://data/pv.db` via its environment), stopped it, freed the port, and re-ran the suite — Playwright's `webServer` command then built `web/out` fresh and started its own isolated instance (its own `dbDir` logic, per the config's own documented isolation guarantee). All live-test results reported above are from this isolated re-run.
- **Files modified:** None (environment-only; no source change).
- **Verification:** `web/e2e/sharing.spec.ts` (all 5 tests, including the new revoke live proof) passes cleanly against the isolated instance.
- **Note for the user:** a handful of harmless `pv-e2e-*` throwaway accounts were written into your real `data/pv.db` before this was caught (additive only — nothing existing was touched or deleted). You may want to clean these up, and you'll need to restart your local dev `pv-server` if you were using it (it was stopped, not restarted, to avoid re-polluting the same database on a subsequent run).

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking issue, environment-only)
**Impact on plan:** No scope creep; the fix was diagnosing and working around a pre-existing local-environment hazard, not a plan or code change.

## Issues Encountered

None beyond the environment hazard documented above.

## TDD Gate Compliance

Task 2 carries `tdd="true"` but its own `<files>` list names only a test file (`SharingOverviewPanel.test.tsx`) — no production code changes belong to this task. The behavior under test (revoke row wiring, error-state rendering, zero-one-many removal) was implemented in Task 1, one commit earlier in this same plan. Writing Task 2's tests therefore exercises already-correct, already-landed code and passes on first run — there is no RED phase because there is no new implementation for this task to drive. This is the plan's own declared structure (an implementation task followed by a dedicated coverage-completion task), not a skipped or violated TDD gate. `git log` shows `feat(28-02): ...` (`97164d1`) then `test(28-02): ...` (`4a286a2`) — a GREEN-then-additional-coverage sequence, not RED→GREEN.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- SHARE-06 is now genuinely end-to-end: server enforcement (Phase 22/26) + client wiring + live UI proof, all in one plan.
- REQUIREMENTS.md's SHARE-06 traceability row was corrected from "Phase 22" to "Phase 28" — it was previously recorded against the server-only implementation (a phase-scoped truth mis-recorded as an end-to-end one); this plan is what actually closed the client-side gap.
- No blockers for the phase's remaining work (28-01 already landed the extension-side write-refusal fixes independently).
- The stray local dev `pv-server` mentioned above is stopped, not restarted — the user should restart it manually if their own local workflow needs it.

---
*Phase: 28-close-v0-4-audit-gaps-client-side-consumption-of-sharing-sta*
*Completed: 2026-08-09*

## Self-Check: PASSED

All created/modified files and both task commits verified present.
