---
phase: 27-extension-integration-shared-items
plan: 05
subsystem: extension-autofill
tags: [autofill, totp, playwright, live-proof, ux-3, ext-08, wasm]

requires:
  - phase: 27-04
    provides: "vault-store.ts's three-source shared-read merge (getItems() returns correctly-decrypted, correctly-tagged shared items), the live two-extension Playwright harness (fixtures-account-setup.ts, dual-extension-sharing.spec.ts), and the PV_STATIC_DIR/PV_EXTENSION_ORIGINS=chrome-extension://* live-server recipe this plan's Task 2 run reused verbatim"
  - phase: 27-01
    provides: "extContextB/extensionIdB two-context worker fixtures this plan's Task 2 run drives"
provides:
  - "AutofillMatch.isShared?/folderName? -- the popup's future UX-3 shared badge/folder-name surface"
  - "handleAutofillMatch's stable personal-then-shared partition (two arrays, populated in getItems()'s own order, concatenated once -- never a resort of the whole array)"
  - "folderNameFor() -- a synchronous, never-fabricating collection-name lookup via collections-store.ts's getCollections()"
  - "fixtures-account-setup.ts's second shared item (type: totp, RFC 6238 Appendix B's own known 160-bit secret) in the SAME collection, plus computeTotpCandidates() -- an independent Node-side real-WASM {current, previous} TOTP computation"
  - "dual-extension-sharing.spec.ts's live TOTP byte-equality proof + 'no TOTP secret -> no TOTP affordance' assertion, appended to 27-04's own live two-extension spec"
affects: [27-06, 27-07, 27-08, 27-09, 27-10, 27-11]

tech-stack:
  added: []
  patterns:
    - "Stable partition via two-array-then-concat (never Array.prototype.sort with a comparator) for a 'keep intra-group order, only reorder across groups' UI requirement"
    - "A live TOTP secret used in a Playwright fixture must satisfy totp_rs::TOTP::new's real RFC 4226 128-bit minimum-length validation -- the codebase's own mocked-crypto unit-test secret (10-byte 'JBSWY3DPEHPK3PXP') is real-crypto-invalid and only a live/real-WASM run can catch that"

key-files:
  created: []
  modified:
    - extension/lib/autofill/types.ts
    - extension/entrypoints/background/autofill-match.ts
    - extension/entrypoints/background/autofill-match.test.ts
    - extension/e2e/fixtures-account-setup.ts
    - extension/e2e/dual-extension-sharing.spec.ts

key-decisions:
  - "computeTotpCandidates() computes BOTH {current, previous} 30-second-time-step candidates (never a single value) -- pv-core's generate_code never reads the clock itself, so a live round trip (dispatch -> background's own 'now' read -> response -> this function's own independent 'now' read) can legitimately straddle a period boundary; a single-candidate assertion would be flaky by construction, not merely unlucky. Per the plan's own explicit instruction."
  - "The TOTP fixture's known secret is RFC 6238 Appendix B's own 20-byte SHA1_SECRET literal ('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), the SAME literal crates/pv-core/src/totp.rs's own test module uses -- NOT the shorter 10-byte 'JBSWY3DPEHPK3PXP' this codebase's mocked-crypto unit tests use elsewhere. A live run against real totp_rs::TOTP::new validation genuinely rejects secrets shorter than RFC 4226's 128-bit minimum ('invalid TOTP parameters'); this was found and fixed via this plan's own live proof, not predicted in advance -- exactly the class of bug a mocked-crypto unit test structurally cannot see."
  - "The 'no TOTP secret -> no TOTP affordance' truth is proven via ItemDetailView's absence of a 'Secret (base32)' row for the shared login item (the SAME item the headline 27-04 proof already displays), not via the 'Na tej stronie' TotpFillRow -- setting up a matching page origin/issuer for that surface would add unrelated harness complexity for no additional proof strength, since a login-type item can never produce a kind:'totp' match by construction. The live assertion is a positive presence-then-absence pair (item name visible, secret label absent), never a vacuous absence-only check."
  - "TOTP byte-equality is dispatched directly against the background (chrome.runtime.sendMessage({kind:'autofill.totpCode', itemId})) rather than driving the 'Na tej stronie' fill-row UI -- the plan's own explicit alternative, chosen for a deterministic single fixed-time-step round trip with no page-origin/issuer-match harness dependency."

patterns-established:
  - "AutofillMatch.isShared/folderName: optional fields set only when true/resolved, never explicit `false`/fabricated -- toEqual-safe (undefined-valued keys are equivalent to absent keys) and matches the UI-SPEC's documented fallback for an unresolved folder name."

requirements-completed: [EXT-07, EXT-08]

coverage:
  - id: D1
    description: "UX-3: personal-before-shared stable partition in 'Na tej stronie' autofill matches -- shared matches move after ALL personal matches, each group keeping its own relative order, even when getItems() interleaves them; a no-op for all-personal or all-shared match sets"
    requirement: "EXT-07"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/autofill-match.test.ts#Test 9: UX-3 -- personal-before-shared stable partition (3 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "AutofillMatch gains isShared?/folderName? -- set only for a genuinely shared item, folderName only when the owning collection's cached name is resolvable (never fabricated)"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/autofill-match.test.ts#Test 9 (isShared/folderName presence and absence assertions)"
        status: pass
    human_judgment: false
  - id: D3
    description: "EXT-08 byte-equality: a shared item's TOTP code, generated via the UNCHANGED handleAutofillTotpCode path (Collection-Key decrypt), byte-equals an independently-computed expected code from the same known secret for the current or previous 30-second time step"
    requirement: "EXT-08"
    verification:
      - kind: e2e
        ref: "extension/e2e/dual-extension-sharing.spec.ts#member B's extension displays the exact plaintext name of the item member A shared (TOTP byte-equality assertion appended by this plan) -- 3/3 consecutive green runs against a real pv-server"
        status: pass
    human_judgment: false
  - id: D4
    description: "A shared item with no TOTP secret exposes no TOTP affordance (no 'Secret (base32)' row) in the popup's item detail view -- identical to a personal item with no TOTP secret"
    requirement: "EXT-08"
    verification:
      - kind: e2e
        ref: "extension/e2e/dual-extension-sharing.spec.ts#member B's extension displays the exact plaintext name of the item member A shared (no-affordance assertion appended by this plan)"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-08-08
status: complete
---

# Phase 27 Plan 05: Autofill/TOTP Parity for Shared Items -- UX-3 Ordering + Live TOTP Byte-Equality Proof Summary

**Proves EXT-07/EXT-08's "identical to personal" claim by construction (autofill-match.ts's decrypt/fill/TOTP call sites needed zero gating-logic changes) while adding UX-3's genuine behavior change -- a stable personal-before-shared partition in "Na tej stronie" -- and a live, real-crypto TOTP byte-equality proof against a real pv-server that caught a genuine RFC 4226 secret-length validation bug no mocked-crypto unit test could see.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-08T18:29:00+02:00 (immediately after 27-04's completion commit)
- **Completed:** 2026-08-08T18:38:27+02:00
- **Tasks:** 2 (Task 1 TDD: RED then GREEN; Task 2 live e2e extension)
- **Files modified:** 5

## Accomplishments

- `AutofillMatch` (`lib/autofill/types.ts`) gains optional `isShared`/`folderName` fields -- set only for a genuinely shared item, `folderName` only when the owning collection's cached decrypted name is already resolvable via `collections-store.ts`'s synchronous `getCollections()` getter, never fabricated.
- `handleAutofillMatch` (`autofill-match.ts`) builds two arrays -- `personalMatches`/`sharedMatches` -- in `getItems()`'s own iteration order, then concatenates them once at the end. This is a deterministic, by-construction stable partition (never `Array.prototype.sort` with a comparator): personal matches always precede shared matches, and each group's own relative order is preserved exactly, even when `getItems()` interleaves shared items before personal ones. No gating logic (`detected[kind]`, `itemMatchesOrigin`) was touched -- proving EXT-07's "reuse the fill pipeline unchanged" claim negatively as well as positively.
- `folderNameFor()` -- a new, synchronous, never-fabricating collection-name lookup: returns `undefined` (never a placeholder) when `collectionId` is null (a direct share) or not yet cached.
- **The live TOTP byte-equality proof (EXT-08)**: `fixtures-account-setup.ts` adds a SECOND real shared item (`type: "totp"`, RFC 6238 Appendix B's own known 160-bit secret, `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ`) to the same collection member B already has `edit` access to, plus `computeTotpCandidates()` -- an independent Node-side real-WASM computation of the `{current, previous}` 30-second-time-step candidates. `dual-extension-sharing.spec.ts` dispatches the SAME `autofill.totpCode` message the real "Na tej stronie" TOTP fill row uses directly against member B's background (a deterministic, single fixed-time-step round trip), and asserts the returned code is a member of the independently-computed 2-candidate set -- a real, positive byte-equality assertion, never a mere "a code appeared" pass.
- **The "no TOTP secret -> no TOTP affordance" proof**: opening the ORIGINAL shared login item's (no `totp` field) detail view in member B's popup renders no "Secret (base32)" row -- a positive presence-then-absence pair (the item's own name is confirmed visible first, so this is never a vacuous "nothing rendered because nothing loaded" pass).
- **Found and fixed a genuine live-crypto bug the plan's own live run caught, not a hypothesis**: the codebase's usual mocked-unit-test TOTP secret (`JBSWY3DPEHPK3PXP`, 10 bytes/80 bits) is REJECTED by `totp_rs::TOTP::new`'s real RFC 4226 128-bit-minimum validation (`CryptoError::InvalidInput("invalid TOTP parameters")`) -- discovered only because this plan ran against real WASM crypto, not a mock. Fixed by using RFC 6238 Appendix B's own 20-byte secret instead, the exact literal `crates/pv-core/src/totp.rs`'s own test module already uses.

## Task Commits

Each task was committed atomically:

1. **Task 1: UX-3 -- personal-before-shared ordering in "Na tej stronie" matches**
   - RED: `e3e0970` (test)
   - GREEN: `f32878f` (feat)
2. **Task 2: LIVE proof -- TOTP byte-equality for a shared item** - `6b557f8` (test)

**Plan metadata:** (this commit)

## Files Created/Modified

- `extension/lib/autofill/types.ts` - `AutofillMatch` gains `isShared?`/`folderName?`
- `extension/entrypoints/background/autofill-match.ts` - stable personal-then-shared partition in `handleAutofillMatch`; new `folderNameFor()` helper; imports `getCollections` from `./collections-store`
- `extension/entrypoints/background/autofill-match.test.ts` - Test 9 (3 tests): interleaved-order partition, all-personal no-op, all-shared no-op (with `folderName` resolution + fallback assertions)
- `extension/e2e/fixtures-account-setup.ts` - `SharedFixtureResult` gains `sharedTotpItemId`/`sharedTotpItemName`/`sharedTotpSecret`/`sharedTotpAlgorithm`/`sharedTotpDigits`/`sharedTotpPeriod`; `setupSharedFixture()` creates and moves a second `type: "totp"` item into the same collection; new exported `computeTotpCandidates()`
- `extension/e2e/dual-extension-sharing.spec.ts` - appends the TOTP-item-visible assertion, the byte-equality dispatch+assertion, and the no-affordance assertion to 27-04's own live two-extension test

## Decisions Made

See `key-decisions` in frontmatter above (4 decisions, each with full rationale).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, found live] Fixed the fixture's TOTP secret to satisfy real RFC 4226 length validation**
- **Found during:** Task 2 (first live run)
- **Issue:** The plan's own action text did not specify a secret; the codebase's existing mocked-unit-test convention (`JBSWY3DPEHPK3PXP`, 10 bytes) is what a naive implementation would reach for -- but `totp_rs::TOTP::new` (the REAL crypto behind `pv-core`'s `generate_code`) genuinely rejects secrets shorter than RFC 4226's 128-bit minimum, returning `CryptoError::InvalidInput("invalid TOTP parameters")`. `handleAutofillTotpCode` threw, surfaced as `{ok:false, error:"unknown"}` at the router's catch-all.
- **Fix:** Used RFC 6238 Appendix B's own 20-byte `SHA1_SECRET` literal (`GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ`) -- the exact same literal `crates/pv-core/src/totp.rs`'s own test module already uses, so this fixture's real-crypto validity is anchored to an already-proven-valid value, not a fresh guess.
- **Files modified:** `extension/e2e/fixtures-account-setup.ts`
- **Verification:** Live run went from `{ok:false, error:"unknown"}` to `{ok:true, code:"627314", secondsRemaining:20}`; 3/3 consecutive green runs after the fix.
- **Committed in:** `6b557f8` (Task 2 commit -- found and fixed before the first commit of this task's code, no separate commit needed)

---

**Total deviations:** 1 auto-fixed (Rule 1 -- a genuine live-crypto bug this plan's own real-WASM run caught, exactly the class of defect this phase's "no mocked-crypto TOTP proof" evidence rule exists to prevent)
**Impact on plan:** No scope creep. This is precisely why the plan mandated a live/real-WASM TOTP proof rather than a mocked unit test -- the bug was invisible to `autofill-match.test.ts`'s existing mocked `totpNow()` and would have shipped undetected without this task's real-crypto round trip.

## Issues Encountered

- pv-server for the live run required the SAME recipe 27-04-SUMMARY.md already documented (`PV_STATIC_DIR` pointed at `web/out`), plus `PV_EXTENSION_ORIGINS="chrome-extension://*"` (the scheme-scoped wildcard pattern `crates/pv-server/src/routes/mod.rs::parse_extension_origins` already supports) since no server was left running from 27-04's own session. Not a defect in this plan's deliverables -- routine live-harness setup, now doubly confirmed as this phase's standing recipe.

## User Setup Required

None - no external service configuration required. (The live e2e proof requires a running `pv-server` with `PV_STATIC_DIR` set to the built web app and `PV_EXTENSION_ORIGINS=chrome-extension://*` for local runs, matching 27-04's own precedent.)

## Next Phase Readiness

- `AutofillMatch.isShared`/`folderName` are live and populated correctly -- 27-08 (popup UI) can consume them directly for a shared badge/folder-name label without touching `autofill-match.ts` again.
- EXT-07 and EXT-08 are both genuinely complete: EXT-07's "reuse unchanged" claim is proven both negatively (no gating-logic diff) and positively (live recipient-side fill/match already proven by 27-04, this plan adds the ordering behavior on top without regressing it); EXT-08's TOTP byte-equality is a real, live, bounded-window assertion against real crypto, not a mocked stand-in.
- Full extension test suite: 724/724 green (721 pre-existing + 3 new UX-3 tests). `npx tsc --noEmit` clean. Live two-extension proof (login-name display + TOTP byte-equality + no-affordance): 3/3 consecutive green runs.
- No blockers for 27-06 onward.

---
*Phase: 27-extension-integration-shared-items*
*Completed: 2026-08-08*

## Self-Check: PASSED

- FOUND: extension/lib/autofill/types.ts
- FOUND: extension/entrypoints/background/autofill-match.ts
- FOUND: extension/entrypoints/background/autofill-match.test.ts
- FOUND: extension/e2e/fixtures-account-setup.ts
- FOUND: extension/e2e/dual-extension-sharing.spec.ts
- FOUND: .planning/phases/27-extension-integration-shared-items/27-05-SUMMARY.md
- FOUND commit: e3e0970
- FOUND commit: f32878f
- FOUND commit: 6b557f8
