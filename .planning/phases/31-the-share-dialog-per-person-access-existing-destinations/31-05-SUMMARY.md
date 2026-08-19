---
phase: 31-the-share-dialog-per-person-access-existing-destinations
plan: 05
subsystem: ui
tags: [react, share-dialog, i18n, honesty-copy, e2e, live-proof]

# Dependency graph
requires:
  - phase: 31-04
    provides: "The row model's `currentLevel`/`destinationId` state (31-02/31-03) and the pending-revocations summary that sits alongside the hidden-password inline note in the same scroll region"
provides:
  - "share.ctaSaveAccess: the third submit-CTA state, selected whenever the destination/item already has an existing recipient -- the dialog states honestly that it is reconciling an existing access picture, not sharing for the first time"
  - "share.hiddenPasswordInlineNote, revised in place: the always-visible copy an already-acked account sees on every REPEAT share now states directly (not merely implies) that hidden-password is an interface protection and never a cryptographic one"
  - "A live e2e pin (sharing.spec.ts) against a hardcoded, non-t()-sourced literal for the revised note's honesty clauses, plus an automated el.scrollWidth<=el.clientWidth overflow backstop"
affects: [31-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CTA selection: `(isFolder && destinationId !== null) || (!isFolder && rows.some(r => r.currentLevel !== null))` -- reads existing state directly, no new flag threaded through"
    - "Honesty-string strengthening in place (same dictionary key, not a new one) when the fact was previously only implied -- mirrors the Phase 26 'never softened/reworded, but MAY be strengthened' convention this file's own header comment documents"

key-files:
  created: []
  modified:
    - web/src/components/vault/ShareDialog.tsx (ctaKey selection logic, share.ctaSaveAccess)
    - web/src/components/vault/ShareDialog.test.tsx (4 CTA-selection tests, 1 repeat-share honesty test, 1 stale-literal fix)
    - web/src/lib/i18n/dictionary.ts (share.ctaSaveAccess NEW; share.hiddenPasswordInlineNote REVISED in place)
    - web/e2e/sharing.spec.ts (hardcoded-literal honesty pin + PL-width overflow backstop on the repeat-share branch)
    - .planning/phases/31-.../31-VALIDATION.md (31-05-T1/T2 rows marked done)

key-decisions:
  - "CTA selection reads `destinationId`/`rows[].currentLevel` directly rather than threading a new boolean through props -- both are already the row model's own source of truth (31-02/31-03), so no new state was introduced."
  - "The 31-04 test asserting the CTA label doesn't change when a revocation is queued had a stale hardcoded literal (`share.ctaItem`) for a fixture whose row already carries an existing recipient. Corrected to `share.ctaSaveAccess` -- the invariant that test actually owns (no fourth 'save-with-revocation' CTA variant; label unchanged by the revocation toggle itself) is preserved via its own `submitLabelBefore` before/after comparison; only WHICH of the three CTAs is correct for that fixture's state needed updating."
  - "The PL-width backstop for the revised hidden-password note could not be added as a NEW e2e test reusing this suite's standard fixtures, because every session created via `fixtures.ts`'s `applyE2eInitScript` forces `pv-locale=en` before first paint (so specs can assert stable English copy) -- the app's own coded default is `pl`, but this harness's convention overrides it. A committed automated backstop was added against the EN string (still exercised at the real ~400px card width via `sharing.spec.ts`'s existing repeat-share flow); the PL-specific visual check was performed via a throwaway, uncommitted Playwright script that deliberately omitted the locale-override init script, screenshotted the real rendered card at 375px and desktop widths, and was deleted before this plan's commits (see Manual PL-Width Check below)."

requirements-completed: [MOD-01, MOD-03]

coverage:
  - id: D1
    description: "The submit CTA reads share.ctaSaveAccess (not ctaFolder/ctaItem) whenever the destination/item already has an existing recipient -- all four scope x fresh/existing combinations"
    requirement: "MOD-01"
    verification:
      - kind: unit
        ref: "ShareDialog.test.tsx -- 'submit CTA text selection (31-05-PLAN.md, MOD-01)' describe block, 4 tests -- falsification-proven (see below)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The always-visible hidden-password inline note states, directly and not merely by implication, that hidden-password is an interface protection and never a cryptographic one, on a REPEAT share by an already-acked account"
    requirement: "MOD-03"
    verification:
      - kind: unit
        ref: "ShareDialog.test.tsx -- 'on a REPEAT share by an already-acked account, the always-visible inline note states the interface-only/not-cryptographic fact DIRECTLY (MOD-03/SC4)' -- falsification-proven (see below)"
        status: pass
      - kind: e2e
        ref: "sharing.spec.ts:548 -- 'owner-of-item shares a personal item directly at all three access levels...' (the createAndShare 'later' branch), hardcoded-literal pin against 'not cryptographically'/'can technically recover the password' plus el.scrollWidth<=el.clientWidth desktop+375px backstop"
        status: pass
    human_judgment: false
  - id: D3
    description: "The revised PL string wraps cleanly at real rendered card width, never clipping, never pushing the footer off-card, at 375px and desktop"
    requirement: "MOD-03"
    verification: []
    human_judgment: true
    rationale: "Automated el.scrollWidth<=el.clientWidth only catches gross overflow, not 'technically fits, reads badly' -- 31-VALIDATION.md's Manual-Only Verifications table records this as requiring visual judgment at real font metrics. Self-validated this session via a throwaway Playwright script + screenshot review (see below); not a Bartek sign-off."

# Metrics
duration: ~75min
completed: 2026-08-19
status: complete
---

# Phase 31 Plan 05: Submit CTA honesty + hidden-password repeat-share honesty (MOD-01/MOD-03) Summary

**Adds `share.ctaSaveAccess` so the submit CTA honestly distinguishes editing an already-shared destination's access picture from a fresh share, and revises `share.hiddenPasswordInlineNote` in place so the always-visible copy states directly -- not merely implies -- that hidden-password is an interface protection and never a cryptographic one, closing the checker's blocker 2 gap on a REPEAT share.**

## Performance

- **Duration:** ~75 min (includes two full fresh builds + live four-spec Playwright runs, plus a standalone PL-locale visual check)
- **Completed:** 2026-08-19
- **Tasks:** 2/2
- **Files modified:** 4 (1 component, 1 unit test file, 1 dictionary, 1 e2e spec) + 1 validation doc

## Accomplishments

- `ShareDialog.tsx`'s `ctaKey` now selects `share.ctaSaveAccess` ("Zapisz dostęp"/"Save access") whenever `(isFolder && destinationId !== null) || (!isFolder && rows.some(r => r.currentLevel !== null))` -- an existing destination selected, or an item with at least one standing recipient row. Otherwise it falls back to `share.ctaFolder`/`share.ctaItem` exactly as before. Four unit tests cover all combinations (fresh folder, existing-destination folder, fresh item, item with an existing recipient).
- `share.hiddenPasswordInlineNote` revised in place (same key): PL "Ukryte tylko w interfejsie, nie kryptograficznie — {recipient} nadal ma dostęp do klucza i technicznie może odzyskać hasło.", EN "Hidden in the interface only, not cryptographically — {recipient} still has key access and can technically recover the password." Both new clauses echo `share.hiddenPasswordDisclosureBody`'s own established phrasing verbatim.
- A new unit test proves MOD-03/SC4 specifically on a REPEAT share: pre-set localStorage ack, one-time modal does not reappear, inline note asserted to contain the direct "nie kryptograficznie"/"technicznie może odzyskać hasło" phrasing.
- `sharing.spec.ts`'s existing repeat-hidden-password branch (the `createAndShare("HiddenShareSecond", ...)` case) now pins the note against a hardcoded EN literal never sourced from `t()`, plus a self-consistency check against the real dictionary string, plus an automated `el.scrollWidth<=el.clientWidth` overflow backstop at both the current (desktop) viewport and 375px.
- Manual PL-width check performed and visually confirmed (see below).

## Task Commits

1. **Task 1:** `feat(31-05): submit CTA distinguishes editing an existing access picture from a fresh share (MOD-01)` — `dc4fb03`
2. **Task 2:** `test(31-05): hidden-password inline note states interface-only/not-cryptographic honesty directly on a repeat share (MOD-03/SC4)` — `e2a5d5b`

## Files Created/Modified

- `web/src/components/vault/ShareDialog.tsx` — `ctaKey` selection logic (`hasExistingItemRecipient` + the destination/row predicate)
- `web/src/components/vault/ShareDialog.test.tsx` — "submit CTA text selection" describe block (4 tests); "on a REPEAT share by an already-acked account..." test (MOD-03/SC4); one stale hardcoded-literal correction in the pre-existing 31-04 revocation test
- `web/src/lib/i18n/dictionary.ts` — `share.ctaSaveAccess` (NEW); `share.hiddenPasswordInlineNote` (REVISED in place)
- `web/e2e/sharing.spec.ts` — hardcoded-literal honesty pin + PL-overflow backstop on the repeat-share branch
- `.planning/phases/31-.../31-VALIDATION.md` — 31-05-T1/T2 rows marked `✅ done`

## Decisions Made

- **CTA selection reads existing row-model state directly** (`destinationId`, `rows[].currentLevel`) rather than threading a new prop/flag through the component -- both were already the single source of truth from 31-02/31-03.
- **Corrected one pre-existing 31-04 test's stale hardcoded CTA literal.** `"does NOT open RevokeShareDialog... and the submit button's own label does NOT change..."` fixtures a row that already has an existing recipient (MEMBER_A at "read"), so per this plan's new logic the CTA is now correctly `share.ctaSaveAccess` from the moment the dialog opens, not `share.ctaItem`. The invariant that test actually owns -- no fourth "save-with-revocation" CTA variant, label unchanged by the revocation toggle itself -- is unaffected and still asserted via its own `submitLabelBefore` before/after comparison; only the literal naming which of the three CTAs is correct for that fixture needed updating. This is not a weakening: the test still fails if the CTA text changes for any reason other than the documented one.
- **The PL-width backstop could not be added as a committed e2e test using this suite's standard fixtures**, because `fixtures.ts`'s `applyE2eInitScript` forces `pv-locale=en` on every session (so specs can target stable English copy), while the app's own coded default locale is `pl`. Rather than fight the harness's locale convention inside the committed suite, the automated backstop was added against the EN string (still exercised at the real ~400px card width), and the PL-specific visual check was performed via a throwaway, uncommitted Playwright script (registered two fresh accounts, deliberately omitted the locale-override init script, drove the real hidden-password flow, and captured screenshots) — deleted before any of this plan's commits. See "Manual PL-Width Check" below for what was observed.

## Deviations from Plan

**1. [Rule 1 - Bug] Corrected a stale hardcoded CTA literal in a pre-existing 31-04 test.**
- **Found during:** Task 1, first full-suite run after adding the CTA logic.
- **Issue:** `ShareDialog.test.tsx`'s revocation test (31-04) asserted `toHaveTextContent("share.ctaItem")` for a fixture whose row already has an existing recipient (`access_level: "read"`). Once Task 1's CTA logic correctly recognized that fixture as "editing an existing access picture", the literal became stale and the test failed.
- **Fix:** Updated the literal to `share.ctaSaveAccess` with a comment explaining why; the test's actual invariant (label doesn't change due to the revocation toggle) is preserved via its pre-existing `submitLabelBefore` comparison, unchanged.
- **Files modified:** `web/src/components/vault/ShareDialog.test.tsx`
- **Verification:** Full `ShareDialog.test.tsx` suite green (71/71 at that point, later 72/72 with Task 2's addition).
- **Committed in:** `dc4fb03` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug/stale assertion, directly caused by this plan's own change)
**Impact on plan:** Necessary correctness fix for a test whose fixture became stale under the new (correct) CTA logic. No scope creep; no test weakened.

## Manual PL-Width Check

Performed via a throwaway, uncommitted Playwright script (deleted before any commit in this plan): two fresh accounts registered against the already-running, freshly built server; the sharer's browser context deliberately omitted `fixtures.ts`'s `pv-locale=en` init-script override, so `LocaleContext`'s coded default (`pl`) took effect; family membership granted through the existing singleton family's owner (mirroring `sharing.spec.ts`'s own `ensureFamilyMembership` pattern); a real login item created; the recipient row set to `hidden_password` (first-ever selection on this account → the blocking ack modal → confirmed).

Observed, screenshots reviewed directly:
- **Rendered PL text:** `Ukryte tylko w interfejsie, nie kryptograficznie — {recipient} nadal ma dostęp do klucza i technicznie może odzyskać hasło.`
- **Desktop width (~400px card):** wraps cleanly across 4 lines, fully inside the card's padding, no clipping, no horizontal overflow. The "Anuluj"/CTA footer buttons remain directly below the note, not pushed off-card.
- **375px viewport:** wraps across 5 lines, same clean containment, footer still immediately visible below the note.
- `el.scrollWidth <= el.clientWidth` was `true` at both widths (also asserted programmatically in the throwaway script, matching the committed EN backstop's mechanism).

This is a self-validated visual check (screenshots reviewed by the executing agent), not a Bartek sign-off — flagged as `human_judgment: true` in this SUMMARY's `coverage` block per the "technically fits, reads badly" judgment call 31-VALIDATION.md's Manual-Only row reserves for a human.

## Issues Encountered

None beyond the stale-literal deviation documented above. The throwaway PL-width script needed two corrections before it worked (the register button's accessible name is Polish — `"Nie masz konta? Zarejestruj się"` — not the English string used elsewhere in this suite's fixtures; and the singleton family in this DB is owned by the fixed `FAMILY_OWNER_EMAIL` account, so membership had to be granted through that owner's session rather than either fresh account's own token) — both fixed in the throwaway script itself, neither affecting any committed file.

## Falsifications (mandatory, exact observed output)

**1. Task 1 — CTA selection falsification.** Temporarily inverted the existing-folder condition (`destinationId === null` instead of `!== null`), re-ran the "existing folder destination selected -> share.ctaSaveAccess" test alone:

```
FAIL  src/components/vault/ShareDialog.test.tsx > ShareDialog > submit CTA text selection (31-05-PLAN.md, MOD-01) > existing folder destination selected -> share.ctaSaveAccess
Error: expect(element).toHaveTextContent()

Expected element to have text content:
  share.ctaSaveAccess
Received:
  share.ctaFolder
 ❯ src/components/vault/ShareDialog.test.tsx:1362:50
```

Restored the correct condition (`destinationId !== null`); `git diff` confirmed byte-identical to the committed state; reran the full suite — 71/71 green.

**2. Task 2 — hidden-password honesty falsification.** Temporarily reverted `share.hiddenPasswordInlineNote` to its pre-task wording (both PL and EN), re-ran the new repeat-share test alone:

```
FAIL  src/components/vault/ShareDialog.test.tsx > ShareDialog > hidden-password disclosure (D-2/UX-03, E4, re-anchored to rows per 31-02-PLAN.md) > on a REPEAT share by an already-acked account, the always-visible inline note states the interface-only/not-cryptographic fact DIRECTLY (MOD-03/SC4)
AssertionError: expected 'Ukryte tylko w interfejsie — a@exampl…' to contain 'nie kryptograficznie'

Expected: "nie kryptograficznie"
Received: "Ukryte tylko w interfejsie — a@example.test nadal ma dostęp do klucza."
 ❯ src/components/vault/ShareDialog.test.tsx:812:32
```

Restored the revised wording; `git diff` confirmed byte-identical to the committed state; reran the full suite — 72/72 green.

**No test deleted or weakened.** Every pre-existing test in `ShareDialog.test.tsx` (72 total, up from 67 pre-plan: +4 CTA tests, +1 honesty test) and the four-spec Playwright suite (24/24, unchanged count -- the new pin/backstop assertions extend the existing repeat-hidden-password test in place rather than adding a new test) still passes.

## Verification

Exact results and exit codes of every CI-width command, run in order after both falsifications above were restored, from a fresh build of HEAD (`web/.next`, `web/out` deleted before the final run to force a genuine rebuild):

1. **`npm run compile`** — exit 0, `tsc --noEmit` clean.
2. **`npm test`** (`npx vitest run`) — exit 0, `Test Files 92 passed (92)`, `Tests 995 passed (995)` (990 pre-plan + 5 new: 4 CTA tests + 1 repeat-share honesty test).
3. **`npm run build`** — exit 0, `next build` compiled successfully, all 5 static pages generated.
4. **`npx playwright test e2e/sharing.spec.ts e2e/shared-sync.spec.ts e2e/export-disclosure.spec.ts e2e/family-wide-sharing.spec.ts --retries=0`** — exit 0, `24 passed (2.3m)`, run against a fully fresh build of HEAD (webServer's own `cargo build --release -p pv-server && next build` chain, invoked after deleting `.next`/`out`). Includes the modified `sharing.spec.ts:548` test (`owner-of-item shares a personal item directly at all three access levels...`) carrying the new hardcoded-literal pin and width backstop, passing at 2.7s.

`data/pv.db` checksum (`sha256:8e043c9d...b997c8`) identical before and after every live run in this plan, including the standalone PL-width check — the dev database was never touched; all live runs used a throwaway `PV_E2E_DB_DIR`, and port 8620 was confirmed free before the manual server start and confirmed free again after teardown.

## `state.advance-plan` — deliberately skipped

Per this plan's explicit constraint: this project's `STATE.md` uses a narrative structure `gsd-tools`'s `state advance-plan`/`state update-progress`/`state record-metric`/`state add-decision`/`state record-session` handlers cannot parse. No `STATE.md` state-update commands were run, and `STATE.md` was not hand-edited to satisfy the tool. `ROADMAP.md`/`REQUIREMENTS.md` updates were likewise skipped for the same reason — this plan's own instructions scope the skip to "state updates" generically, and none of gsd-tools's state-mutation verbs could be run against this project's narrative STATE.md.

## Next Phase Readiness

Both of Phase 31's remaining copy/CTA-level gaps are closed: the submit CTA now honestly distinguishes "editing an existing access picture" from a genuinely fresh share across both scopes, and the hidden-password disclosure's always-visible fallback copy states its honesty claim directly on every occasion an already-acked account encounters it, not just the first. 31-06 (destination-unavailable refusal + atomic level-edit live proof, per 31-VALIDATION.md) can proceed against a fully row-model-based, destination-selector-equipped dialog with no outstanding copy-honesty gaps from this plan's scope. No blockers.

## Self-Check: PASSED

Both files confirmed present with the expected changes (`git diff` reviewed against each commit). Both task commit hashes (`dc4fb03`, `e2a5d5b`) confirmed present in `git log --oneline`.

---
*Phase: 31-the-share-dialog-per-person-access-existing-destinations*
*Completed: 2026-08-19*
