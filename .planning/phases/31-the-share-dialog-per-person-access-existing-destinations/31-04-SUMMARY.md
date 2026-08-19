---
phase: 31-the-share-dialog-per-person-access-existing-destinations
plan: 04
subsystem: ui
tags: [react, share-dialog, revocation-honesty, e2e, live-proof]

# Dependency graph
requires:
  - phase: 31-03
    provides: "submitRowsForExistingDestination's revoke branch (revokeCollectionAccess), the destination selector's row re-seed on switch"
provides:
  - "share-pending-revocations-summary: the honesty summary that names who loses access and how many, computed from the SAME rows state reconcileRow dispatches from, rendered as the last element inside the scroll region above the footer"
  - "Live, two-session, positive-then-negative proof of the phase's sixth (ROADMAP-unlisted) success criterion: 'brak dostępu' really revokes, and the revoked member's own client loses the ability to decrypt on its next completed sync"
affects: [31-05, 31-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "The revocation-honesty summary's {count}/{names} derive from `rows.filter(r => r.pendingLevel === \"none\" && r.currentLevel !== null)` -- the identical predicate reconcileRowAction's own revoke branch uses, never a second computation"
    - "sharing.spec.ts's own local, file-owned assertRecipientDecrypts helper (per-file-owns-its-own-tiny-helper convention), mirroring family-wide-sharing.spec.ts's identically-shaped helper without cross-importing it"

key-files:
  created: []
  modified:
    - web/src/components/vault/ShareDialog.tsx (pendingRevocationRows computation, share-pending-revocations-summary render block, AlertTriangle import)
    - web/src/components/vault/ShareDialog.test.tsx (pending-revocations honesty summary describe block: absent/pure-addition, absent/pure-edit, present/count+names, CTA-unchanged; HIDDEN_PASSWORD_HONESTY_KEYS extended)
    - web/src/lib/i18n/dictionary.ts (share.pendingRevocationsSummary, verbatim per 31-UI-SPEC.md)
    - web/e2e/sharing.spec.ts (the sixth proof obligation, live, two sessions, positive-then-negative)
    - .planning/phases/31-.../31-VALIDATION.md (31-04-T1/T2 rows marked done)

key-decisions:
  - "The summary is the LAST element inside the scroll region (after submitError/familyKeyPending/partialShareFailed/seedMoveFailureCount), never interleaved among them -- per 31-UI-SPEC.md's Focal Point note that its position immediately preceding Save is itself part of its function, the final honest statement read before committing."
  - "Gated on `!isFamilyWideSelected` (mirroring the pre-existing hidden-password inline note's own gate) since `rows` only has meaning in the per-person mode -- 'Cała rodzina' has no rows and therefore no revocation concept."
  - "Task 2's local `assertRecipientDecrypts` is a DELIBERATE duplicate of family-wide-sharing.spec.ts's own helper of the same name and shape, per this codebase's established per-file-owns-its-own-tiny-helper convention (already used throughout sharing.spec.ts for openFamilyTab/openSharingOverview/reloadAndUnlock etc.) -- never cross-imported."
  - "The positive anchor's pre-step reuses sharing.spec.ts's PRE-EXISTING `reloadAndUnlock` helper (a full page reload + real UnlockOverlay re-entry) rather than building a new lock-only 'relockAndUnlock' -- it is itself an unlock transition, which is one of the three triggers `refreshCollectionsNow()` fires on (the other two are the sharer's own submit and the pending/reseal path), satisfying the plan's discovery requirement without introducing a second, redundant helper."

requirements-completed: [MOD-01]

coverage:
  - id: D1
    description: "The pending-revocations summary renders ONLY when >=1 row is queued for a REAL revocation (pendingLevel none, currentLevel not null) -- absent for pure-addition and pure-edit pending sets"
    requirement: "MOD-01"
    verification:
      - kind: unit
        ref: "ShareDialog.test.tsx -- 'is ABSENT when the pending set is pure-addition...' / 'is ABSENT when the pending set is pure-edit...' -- both falsification-proven (see below)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The summary's {count}/{names} interpolation is correct and multi-name comma-joins, mirroring share.partialShareFailed's own convention"
    requirement: "MOD-01"
    verification:
      - kind: unit
        ref: "ShareDialog.test.tsx -- 'is PRESENT with the correct count and comma-joined name list...' -- falsification-proven (see below)"
        status: pass
    human_judgment: false
  - id: D3
    description: "No second confirm dialog opens for a queued revocation, and the submit button's own label text does not change"
    requirement: "MOD-01"
    verification:
      - kind: unit
        ref: "ShareDialog.test.tsx -- 'does NOT open RevokeShareDialog...and the submit button's own label does NOT change...'"
        status: pass
    human_judgment: false
  - id: D4
    description: "Live: setting a member with existing access to 'Brak dostępu' and saving genuinely revokes it -- the member's own client reads real decrypted content BEFORE, and loses that ability on its own next completed sync (no reload) AFTER"
    requirement: "MOD-01"
    verification:
      - kind: e2e
        ref: "sharing.spec.ts -- 'the sixth proof obligation: setting a member with existing access to Brak dostępu and saving revokes it live...' -- falsification-proven (see below)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The pending-revocations summary is visible and names the revoked member BEFORE Save is clicked, queried while share-dialog is still mounted"
    requirement: "MOD-01"
    verification:
      - kind: e2e
        ref: "sharing.spec.ts -- same test, step 3 -- assertion executes before share-submit is clicked"
        status: pass
    human_judgment: false

# Metrics
duration: ~55min
completed: 2026-08-18
status: complete
---

# Phase 31 Plan 04: Pending-revocations honesty summary + the sixth proof obligation, live Summary

**Lands `share.pendingRevocationsSummary` (rendered exactly when a real revocation is queued, honestly naming who and how many) and proves live, with two real sessions, that "brak dostępu" genuinely revokes: a positive read before, a failing read after the next completed sync — the phase's sixth, ROADMAP-unlisted success criterion CONTEXT.md recorded deliberately.**

## Performance

- **Duration:** ~55 min
- **Completed:** 2026-08-18 (single session)
- **Tasks:** 2/2
- **Files modified:** 5 (1 component, 1 unit test file, 1 dictionary, 1 e2e spec, 1 validation doc)

## Accomplishments

- `ShareDialog.tsx` computes `pendingRevocationRows` — `rows.filter(r => r.pendingLevel === "none" && r.currentLevel !== null)` — the identical predicate `reconcileRowAction`'s own revoke branch already uses, and renders `share-pending-revocations-summary` (`role="status" aria-live="polite"`, `AlertTriangle` icon + `text-error`, `text-base` paragraph mirroring `RevokeShareDialog.tsx:132`'s own weight-class) as the LAST element inside the scroll region, above the footer — exactly where 31-UI-SPEC.md's Focal Point section requires it ("the last thing seen before the footer... the final honest statement the user reads before committing"). Gated on `!isFamilyWideSelected`, matching the pre-existing hidden-password inline note's own gate.
- `share.pendingRevocationsSummary` added to the dictionary verbatim per 31-UI-SPEC.md's Copywriting Contract (`{count}`/`{names}` interpolation, comma-joined names mirroring `share.partialShareFailed`'s `.join(", ")` convention).
- No second confirm dialog opens for a queued revocation; the submit button's CTA label (`share.ctaFolder`/`share.ctaItem`) is unaffected by whether the pending set contains a revocation — both asserted directly.
- `sharing.spec.ts` gained the sixth proof obligation's live test: owner shares a real folder with a member at `read`, the member's own session (after `reloadAndUnlock` to guarantee discovery) genuinely reads the decrypted item and password (positive anchor), the owner then reopens the dialog against the SAME existing destination, sets the member's row to `none`, and the summary is asserted visible and naming the member BEFORE Save is clicked (dialog still mounted). On the member's own still-open session, with no reload, the item disappears within the next completed sync (negative anchor).

## Task Commits

1. **Task 1:** `feat(31-04): pending-revocations honesty summary (MOD-01 sixth proof obligation)` — `c9b9dd3`
2. **Task 2:** `test(31-04): live e2e — the sixth proof obligation, positive-then-negative revocation` — `fdfbbdd`

## Files Created/Modified

- `web/src/components/vault/ShareDialog.tsx` — `AlertTriangle` import, `pendingRevocationRows` computation (next to `rowsAtHiddenPassword`), the `share-pending-revocations-summary` render block at the end of the scroll region
- `web/src/components/vault/ShareDialog.test.tsx` — `HIDDEN_PASSWORD_HONESTY_KEYS` extended with `share.pendingRevocationsSummary` (real dictionary text, not literal-key passthrough, so the interpolation tests catch a real reword), the "pending-revocations honesty summary (31-04-PLAN.md, MOD-01's sixth proof obligation)" describe block (4 tests)
- `web/src/lib/i18n/dictionary.ts` — `share.pendingRevocationsSummary` (PL/EN verbatim)
- `web/e2e/sharing.spec.ts` — local `assertRecipientDecrypts` helper, the sixth proof obligation's live test
- `.planning/phases/31-.../31-VALIDATION.md` — 31-04-T1/T2 rows marked `✅ done`

## Decisions Made

- **Summary position: last element inside the scroll region, not interleaved with error/partial-error slots.** Per 31-UI-SPEC.md's Focal Point note, its immediate-precedes-Save position is part of its function — it is the final honest statement read before committing, not merely "somewhere below the row list".
- **Reused `reloadAndUnlock` (pre-existing in `sharing.spec.ts`) as the "relockAndUnlock" the plan asked for**, rather than building a separate lock-only helper. `reloadAndUnlock` is itself a genuine unlock transition (one of the three triggers `refreshCollectionsNow()` fires on, per `family-wide-sharing.spec.ts:1264-1274`'s documented reasoning, which this file's own header comment independently corroborates for the same mechanism), so it discharges the plan's "without this the member may never discover the collection" requirement without introducing a redundant second helper.
- **`assertRecipientDecrypts` is a deliberate local duplicate**, not a cross-import from `family-wide-sharing.spec.ts` — matches this file's own established per-file-owns-its-own-tiny-helper convention (already true of `openFamilyTab`, `openSharingOverview`, `reloadAndUnlock`, etc.).

## Deviations from Plan

None. Every code path matches the plan's `<action>` text: the summary's render-guard predicate, dictionary key, icon/color/text-base treatment, and position are all verbatim per 31-UI-SPEC.md; the live e2e test follows `family-wide-sharing.spec.ts`'s cited precedent shape (positive anchor after a discovery-guaranteeing reload/unlock, negative anchor on the same still-open session with no reload, summary asserted visible-and-naming before Save); both mandatory falsifications were performed exactly as specified and both produced genuine, exact-output-recorded red before being restored.

**No test deleted or weakened.** Every pre-existing test in `ShareDialog.test.tsx` (63 → 67), `sharing.spec.ts`/`shared-sync.spec.ts`/`export-disclosure.spec.ts`/`family-wide-sharing.spec.ts` (23 → 24) still passes unmodified.

## Falsifications (mandatory, exact observed output)

**1. Task 1 — absence-guard falsification.** Temporarily rendered the summary UNCONDITIONALLY (`{true ? (...) : null}` in place of `{!isFamilyWideSelected && pendingRevocationRows.length > 0 ? (...) : null}`), re-ran the "is ABSENT when the pending set is pure-addition" test alone:

```
FAIL  src/components/vault/ShareDialog.test.tsx > ShareDialog > pending-revocations honesty summary (31-04-PLAN.md, MOD-01's sixth proof obligation) > is ABSENT when the pending set is pure-addition (a fresh grant, no prior access)
Error: expect(element).not.toBeInTheDocument()
expected document not to contain element, found <div aria-live="polite" class="flex items-center gap-3" data-testid="share-pending-revocations-summary" role="status">...
  <p class="text-base">Zapisanie cofnie dostęp 0 os.: . Cofnięcie dostępu nie cofa tego, co już zobaczyli.</p>
</div> instead
 ❯ src/components/vault/ShareDialog.test.tsx:1010:77
```

Restored the correct guard; reran the full `ShareDialog.test.tsx` suite — 67/67 green again.

**2. Task 1 — interpolation-correctness falsification.** Temporarily hard-coded `{count}` to `pendingRevocationRows.length + 1` (a deliberately wrong value), re-ran the "is PRESENT with the correct count and comma-joined name list" test alone:

```
FAIL  src/components/vault/ShareDialog.test.tsx > ShareDialog > pending-revocations honesty summary (31-04-PLAN.md, MOD-01's sixth proof obligation) > is PRESENT with the correct count and comma-joined name list...
Expected: "Zapisanie cofnie dostęp 1 os.: a@example.test. Cofnięcie dostępu nie cofa tego, co już zobaczyli."
Received: "Zapisanie cofnie dostęp 2 os.: a@example.test. Cofnięcie dostępu nie cofa tego, co już zobaczyli."
 ❯ src/components/vault/ShareDialog.test.tsx:1044:37
```

Restored the correct interpolation; reran the full suite — 67/67 green again. `git diff` confirmed byte-identical to the committed state after both restores.

**3. Task 2 — revocation-dispatch falsification.** Temporarily replaced `submitRowsForExistingDestination`'s `revoke` op with a no-op (`revoke: () => Promise.resolve()` in place of `revoke: () => revokeCollectionAccess(destinationId, row.userId)`), rebuilt, re-ran the sixth-obligation test alone:

```
✘  1 [chromium] › e2e/sharing.spec.ts:1201:5 › the sixth proof obligation: ... (1.1m)

  Error: negative anchor: the revoked member's own still-open session must lose the ability to see the shared item on its own NEXT COMPLETED SYNC, no reload

  expect(locator).toHaveCount(expected) failed

  Locator:  getByTestId('item-row-daa96df6-728b-424b-9294-ddfebc0f60c4')
  Expected: 0
  Received: 1
  Timeout:  60000ms

  Call log:
    - 123 × locator resolved to 1 element
        - unexpected value "1"
```

A genuine timeout — the item never disappeared because the server-side revocation never ran, exactly the failure mode this test exists to rule out. Restored the real `revokeCollectionAccess(destinationId, row.userId)` call; `git diff` confirmed byte-identical to the committed state; rebuilt and reran the full four-spec suite — 24/24 green again.

## Issues Encountered

None. The `t()` mock's key-passthrough convention (`HIDDEN_PASSWORD_HONESTY_KEYS` — everything else renders as its bare key literal) initially made the two content-interpolation tests fail against the literal string `"share.pendingRevocationsSummary 1 a@example.test"` instead of real Polish copy; adding `share.pendingRevocationsSummary` to that set (matching the existing hidden-password honesty strings' own treatment, since this is the same weight-class of honesty text) fixed it, and the CTA-unchanged assertion was corrected to compare against the same literal-key passthrough (`"share.ctaItem"`) every other CTA-label test in the file already uses, rather than the real dictionary string. Both are pre-existing-convention alignments, not deviations from the plan's substance.

## Verification

Exact results and exit codes of every CI-width command, run in order after all three falsifications above were restored:

1. **Task 1's `<verify>`:** `cd web && npm run compile && npm test && npm run build && npx playwright test e2e/sharing.spec.ts e2e/shared-sync.spec.ts e2e/export-disclosure.spec.ts e2e/family-wide-sharing.spec.ts --retries=0`
   - `npm run compile` — exit 0, `tsc --noEmit` clean.
   - `npm test` — exit 0, `Test Files 92 passed (92)`, `Tests 990 passed (990)`.
   - `npm run build` — exit 0, `next build` compiled successfully, all 5 static pages generated.
   - `npx playwright test` (four specs) — exit 0, `23 passed (2.3m)` (pre-Task-2 baseline; Task 2 adds the 24th).
2. **Task 2's `<verify>`:** `cd web && npm run build && npx playwright test e2e/sharing.spec.ts e2e/shared-sync.spec.ts e2e/export-disclosure.spec.ts e2e/family-wide-sharing.spec.ts --retries=0`
   - `npm run build` — exit 0.
   - `npx playwright test` (four specs) — exit 0, `24 passed (2.3m)`, including the new sixth-obligation test (32.9s).
3. **Plan-level `<verification>`** (superset, run after falsification #3's restore): `npm run compile` (exit 0), `npm test` (990/990), `npm run build` (exit 0), four-spec Playwright run — `24 passed (2.1m)`.

`data/pv.db` checksum (`sha256:8e043c9d...b997c8`) identical before and after every live run in this plan — the dev database was never touched; the e2e harness uses its own throwaway `PV_E2E_DB_DIR` per `playwright.config.ts`.

Port 8620 was free before the first live run; Playwright's `webServer` built and ran `target/release/pv-server` itself from a fresh build of HEAD each time.

## Next Phase Readiness

The phase's sixth, deliberately-unrecorded proof obligation is now closed: the honesty summary is real, falsification-proven, and correctly positioned; the live revocation claim is proven with two real sessions and a genuine positive-then-negative anchor, falsification-proven against the actual dispatch. 31-05 (submit-CTA distinction between editing an existing access picture and a fresh share, plus the hidden-password repeat-share honesty revision) can build directly on the row model and destination selector, both stable through this plan. No blockers.

## Self-Check: PASSED

All 5 modified files verified present on disk with the expected changes. Both task commit hashes (`c9b9dd3`, `fdfbbdd`) verified present in `git log`.

---
*Phase: 31-the-share-dialog-per-person-access-existing-destinations*
*Completed: 2026-08-18*
