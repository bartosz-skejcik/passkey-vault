---
phase: 28-close-v0-4-audit-gaps-client-side-consumption-of-sharing-sta
plan: 04
subsystem: ui
tags: [react, nextjs, i18n, playwright, sharing, requirements-bookkeeping]

requires:
  - phase: 28
    provides: "28-VERIFICATION.md's gaps/behavior_unverified_items/human_verification findings (the spec for this pass)"
provides:
  - "RevokeShareDialog.tsx: an already-revoked 404 resolves as a benign success, never share.revokeFailed"
  - "web/e2e/sharing.spec.ts: SHARE-06's item-share revoke leg, live-proven end-to-end for the first time"
  - "member.removeStep2Body (PL/EN): FAM-09's honest next-sync-cycle bound, not an instantaneous claim"
  - "REQUIREMENTS.md: FAM-07/08/09, KEY-06, SHARE-01, UX-03, UX-05, SEC-05 reconciled to Complete, no more checkbox-vs-traceability contradiction"
  - "STATE.md: two undocumented environment hazards recorded (playwright reuseExistingServer, extension/e2e's PV_STATIC_DIR requirement)"
  - "28-VERIFICATION.md: addendum recording this pass's results against every open gap/behavior_unverified/human_verification item it targeted"
affects: [sharing, vault-web, requirements-tracking]

tech-stack:
  added: []
  patterns:
    - "A DELETE endpoint's 404-on-already-gone response is folded into the SAME success path a 204 takes, distinct from both a genuine failure and any other expected non-2xx (409) — never surfaced as a generic failure when the caller's desired end state already holds."

key-files:
  created: []
  modified:
    - web/src/components/vault/RevokeShareDialog.tsx
    - web/src/components/vault/SharingOverviewPanel.test.tsx
    - web/e2e/sharing.spec.ts
    - web/src/lib/i18n/dictionary.ts
    - .planning/REQUIREMENTS.md
    - .planning/STATE.md
    - .planning/phases/28-close-v0-4-audit-gaps-client-side-consumption-of-sharing-sta/28-VERIFICATION.md

key-decisions:
  - "The already-revoked 404 is folded into RevokeShareDialog's existing onRevoked() success path rather than given its own distinct copy — the end state the caller wanted (grant gone) already holds, so no error message is owed; only a genuine failure or the 409 last-key-holder guard still surface inline copy."
  - "The owner's own local item list has no push notification for an outbound item share (create_share only notifies the recipient) — the new item-revoke live test uses the same reloadAndUnlock mechanism this file's header already documents for the analogous collection-membership eventual-consistency gap, rather than waiting out the 30s poll."
  - "SHARE-01/UX-03/UX-05/SEC-05 were reconciled to Complete on the strength of two independent, already-existing sources (26-VERIFICATION.md's passed/5-5 verdict and Phase 26's own plan SUMMARYs' requirements-completed lists), not re-verified from scratch against the running code in this pass — SEC-05's own client affordance (FamilyTab.tsx's fingerprint card) was spot-checked directly to confirm the claim, the other three were not re-derived independently."

requirements-completed: [SHARE-01, UX-03, UX-05, SEC-05]

coverage:
  - id: D1
    description: "An already-revoked 404 on RevokeShareDialog resolves as a benign success (row splice, no error copy), distinct from the 409 last-key-holder guard and any genuine failure"
    requirement: "SHARE-06"
    verification:
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#a mocked 404 (already-revoked) resolves the SAME as a genuine 204 -- dialog closes, row is spliced, no error copy (28-04 gap fix)"
        status: pass
    human_judgment: false
  - id: D2
    description: "SHARE-06's item-share revoke leg is live-proven end-to-end for the first time: recipient reaches the item (raw request + real UI) before revoke, owner revokes through the real Sharing overview, recipient's own raw request no longer includes the item afterward"
    requirement: "SHARE-06"
    verification:
      - kind: e2e
        ref: "web/e2e/sharing.spec.ts#owner revokes a directly-shared ITEM's access via the Sharing overview's By-person tab, live (SHARE-06 item leg, 28-04 gap fix)"
        status: pass
    human_judgment: false
  - id: D3
    description: "member.removeStep2Body states FAM-09's honest sync-bound (next completed cycle, ~1 min extension / ~30s web) instead of an instantaneous device-side claim, in both PL and EN"
    requirement: "FAM-09"
    verification: []
    human_judgment: true
    rationale: "Copy honesty is a wording/tone judgment (no test asserted the old exact string, and none is added for the new one — the phase's own precedent for member.removeHonestyWarning-class strings is human review, not string-equality assertion)."
  - id: D4
    description: "REQUIREMENTS.md reconciled: FAM-07/08/09, KEY-06 checkbox/sub-bullet/traceability agree (no more [x] over a stale PARTIAL note); SHARE-01/UX-03/UX-05/SEC-05 flipped to Complete, attributed to Phase 26"
    verification: []
    human_judgment: true
    rationale: "Bookkeeping-correctness judgment over a planning artifact, not a testable code behavior — the supporting evidence (26-VERIFICATION.md's passed/5-5 verdict, grep-confirmed requirements-completed entries across Phase 26's plan SUMMARYs) is documented inline in REQUIREMENTS.md's own new sub-bullets for a human to spot-check."
  - id: D5
    description: "Two undocumented environment hazards (playwright reuseExistingServer stray-server adoption; extension/e2e's PV_STATIC_DIR requirement) recorded in STATE.md Blockers/Concerns, not fixed"
    verification: []
    human_judgment: true
    rationale: "Recording-only per the task brief; whether/how to fix either hazard is an operator decision (Bartek), not something this pass resolves."

duration: 18min
completed: 2026-08-09
status: complete
---

# Phase 28 Plan 04: Close v0.4 audit gaps — 28-VERIFICATION.md fix pass Summary

**Fixed the one falsified truth (already-revoked 404 no longer told an owner their successful revoke had failed), live-proved SHARE-06's item-share revoke end-to-end for the first time, corrected FAM-09's copy to an honest sync-bound, and reconciled REQUIREMENTS.md's self-contradictory bookkeeping — closing every gap/behavior-unverified item 28-VERIFICATION.md raised.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-08-09T18:28:40+02:00 (approx., from the phase verification commit boundary)
- **Completed:** 2026-08-09T18:46:00+02:00 (approx.)
- **Tasks:** 5 (not plan-structured — a direct fix pass against 28-VERIFICATION.md's `<work>` items)
- **Files modified:** 7 (0 created, 7 modified)

## Accomplishments

- **The falsified truth is fixed.** `RevokeShareDialog.tsx` now treats an already-revoked 404 (both `collections::revoke_access` and `vault::revoke_share` return 404 when the grant is already gone) as a benign success — the row splices exactly as a genuine 204 would, with no `share.revokeFailed` copy. An owner whose revoke actually succeeded, or was already in effect via a race/double-submit, is no longer told it failed.
- **SHARE-06's item-share revoke leg is live-proven for the first time.** `web/e2e/sharing.spec.ts` gained a new test that positively anchors the recipient's access (raw API request AND real UI) before revoking, then proves the recipient's own raw request no longer includes the item afterward — closing the "server capability with no proven client caller" gap this whole phase exists to eliminate.
- **FAM-09's copy is honest.** `member.removeStep2Body` no longer claims an instantaneous device-side access cutoff; it now states the proven bound (server denial is immediate, the device's own cache purge lands on its next completed sync — up to ~1 min extension / ~30s web).
- **REQUIREMENTS.md no longer contradicts itself.** FAM-07/08/09 and KEY-06's stale PARTIAL sub-bullets are replaced with Complete notes correctly attributing the client half to Phase 28; SHARE-01/UX-03/UX-05/SEC-05 are flipped from stale `[ ]`/Pending to Complete, independently confirmed against Phase 26's own `passed`/5-5 verification and its plan SUMMARYs.
- **Two real, previously-undocumented environment hazards are now recorded** in STATE.md (not fixed, per the task brief) so a third agent does not lose a full run to either of them again.

## Task Commits

Each fix was committed atomically:

1. **Falsified-truth fix + unit test** - `c1692b5` (fix)
2. **SHARE-06 item-leg live proof** - `ee19672` (test)
3. **FAM-09 copy honesty** - `1757ad7` (fix)
4. **REQUIREMENTS.md bookkeeping reconciliation** - `3bfe80a` (docs)
5. **STATE.md environment-hazard recording** - `ff8613a` (docs)

**28-VERIFICATION.md addendum:** appended in this same working session (see "Files Created/Modified" below) — recorded alongside this SUMMARY's own commit per the sequential-executor's write-then-commit order; see the addendum section at the bottom of `28-VERIFICATION.md` for the full closure record against each gap/behavior-unverified/human-verification item this pass targeted.

## Files Created/Modified

- `web/src/components/vault/RevokeShareDialog.tsx` - `handleConfirm`'s catch branches a `404` into the same success path as a genuine 204, distinct from 409 (last-key-holder) and any other failure.
- `web/src/components/vault/SharingOverviewPanel.test.tsx` - New unit test covering the 404-as-success path distinctly from the existing 409/generic-error tests.
- `web/e2e/sharing.spec.ts` - New live test proving SHARE-06's item-share revoke leg end-to-end (recipient reaches item before revoke, owner revokes via real UI, recipient can't reach it after).
- `web/src/lib/i18n/dictionary.ts` - `member.removeStep2Body` (PL/EN) reworded to state the honest next-sync-cycle bound instead of an instantaneous claim.
- `.planning/REQUIREMENTS.md` - FAM-07/08/09, KEY-06 sub-bullets and traceability rows reconciled; SHARE-01/UX-03/UX-05/SEC-05 checkboxes and traceability rows flipped to Complete.
- `.planning/STATE.md` - Two `[Phase 28]`-tagged Blockers/Concerns entries recording the playwright `reuseExistingServer` hazard and the extension/e2e `PV_STATIC_DIR` requirement.
- `.planning/phases/28-close-v0-4-audit-gaps-client-side-consumption-of-sharing-sta/28-VERIFICATION.md` - Addendum appended (not rewritten) recording this pass's closure of every targeted gap/behavior-unverified/human-verification item.

## Decisions Made

- The already-revoked 404 is folded into `RevokeShareDialog`'s existing `onRevoked()` success path rather than given its own distinct copy — the caller's desired end state (grant gone) already holds, so no error message is owed. Only the 409 last-key-holder guard and genuine failures still surface inline copy.
- The item-leg live test uses `reloadAndUnlock` for the OWNER's own session (not just the recipient's, which the file's existing pattern already covers) — `create_share` publishes no sync event to the owner, so the owner's local `isShared` flag needs a fresh full snapshot before `SharingOverviewPanel`'s By-person tab has anything to render for that item.
- SHARE-01/UX-03/UX-05/SEC-05 were reconciled to Complete on the strength of two independent, pre-existing sources (`26-VERIFICATION.md`'s `passed`/5-5 verdict and Phase 26's own plan SUMMARYs' `requirements-completed` lists, `grep`-confirmed) rather than re-derived from the running code from scratch in this pass. SEC-05's own client affordance (`FamilyTab.tsx`'s fingerprint card) was spot-checked directly; the other three were not independently re-verified beyond the two sources above.

## Deviations from Plan

None — this pass follows the `<work>` items in the executor's own instructions directly (there is no separate PLAN.md; 28-VERIFICATION.md's gap findings ARE the spec, as stated in the objective).

## Issues Encountered

None. The one non-obvious wrinkle — the owner's own item list not reflecting a just-created outbound share without a reload/poll — was diagnosed and resolved with `reloadAndUnlock`, the same honest mechanism this test file already uses for the analogous collection-membership gap; not treated as a new bug (see Decisions above).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- 28-VERIFICATION.md's score moves from 4/5 (1 present, behavior-unverified) to 5/5 verified — the item-share revoke leg is now live-proven, matching the collection leg.
- REQUIREMENTS.md is internally consistent: no `[x]` checkbox sits above a contradicting traceability row or a stale "Do not mark Complete until…" note anywhere this pass touched.
- Two environment hazards are documented in STATE.md for whoever picks up web/extension e2e work next; neither is fixed, both are cheap to fix when someone has the time.
- UX-04 and FAM-10 remain genuinely unimplemented and were deliberately left untouched — out of this pass's scope, not overlooked.
- No blockers for milestone close from this pass's own scope.

---
*Phase: 28-close-v0-4-audit-gaps-client-side-consumption-of-sharing-sta*
*Completed: 2026-08-09*
