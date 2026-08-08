---
phase: 27-extension-integration-shared-items
plan: 10
subsystem: extension-popup-ui
tags: [react, provider-ceremony, webauthn, shared-items, ext-09, ext-12, ui-spec-e4]

requires:
  - phase: 27-06
    provides: "ProviderCredentialCandidate/PendingCeremonyCandidate's isShared?/folderName? fields, populated from real VaultItem data via folderNameFor() — this plan's sole data source, never fabricated"
  - phase: 27-08
    provides: "SharedBadge.tsx — the one reusable 12px shared-item corner-badge component, imported here unchanged, never re-derived"
provides:
  - "ProviderCeremonyView.tsx's E4 treatment: multi-match candidate rows gain the SharedBadge corner marker + a resolved-folder-or-folder-free subtitle line for shared candidates, personal candidates rendered byte-for-byte as before; single-match layout renders the same note beneath the accountLabel line's own treatment when the sole candidate is shared; candidates ordered personal-before-shared (stable partition)"
  - "handleCredentialsGet's confirmed-not-inferred empty-candidates fallthrough: a shared-but-undecryptable item can never reach findMatchingPasskeyItems in the first place (vault-store.ts never retains it in getItems()) — a defensive filter is wired anyway as dead-code defense-in-depth, matching 27-08's own precedent"
affects: [27-11]

tech-stack:
  added: []
  patterns:
    - "App.tsx now passes ProviderCeremonyView's `matches` prop for EVERY get() ceremony regardless of candidate count (previously only length>1) — isMultiMatch still gates the picker list on matches.length>1; the single-length array is how the sole candidate's isShared/folderName reach the single-match note, without adding a new prop."
    - "Per-row structural branching (not a shared wrapper always rendered) keeps a personal multi-match row's JSX literally identical to its pre-27-10 shape — only a candidate.isShared===true row gets the relative-wrapper+SharedBadge / flex-col+subtitle treatment."

key-files:
  created: []
  modified:
    - extension/entrypoints/popup/ProviderCeremonyView.tsx
    - extension/entrypoints/popup/ProviderCeremonyView.test.tsx
    - extension/entrypoints/popup/App.tsx
    - extension/entrypoints/background/provider-ceremony.ts
    - extension/entrypoints/background/provider-ceremony.test.ts

key-decisions:
  - "[Rule 2 - missing critical functionality] App.tsx's ProviderCeremonyView call site was NOT in the plan's files_modified list, but the single-match note literally cannot render without it: App.tsx only ever passed the single candidate's `.label` via the `account` string prop, never the candidate object carrying `isShared`/`folderName`. Widened `matches={!isCreate && view.candidates.length > 1 ? view.candidates : undefined}` to `matches={!isCreate ? view.candidates : undefined}` — ProviderCeremonyView's own `isMultiMatch` (matches.length>1) still gates the picker list unchanged, so this is additive-only: it gives the component access to data it didn't have, with zero behavior change to what already rendered from that data."
  - "Task 2's confirmed answer: findMatchingPasskeyItems(getItems(), rpId) can never see a shared-but-undecryptable item today. Direct read of vault-store.ts's applySyncSnapshot/mergeCollectionSnapshot confirms every per-row decrypt-failure catch branch (pending OR genuinely broken) either `continue`s past the push into the decrypted array or never reaches it — recorded ONLY via markPending/getPendingSharedItems(). Unlike web's store, this extension never retains a last-known-good VaultItem with undecryptable:true set, so the 'stale-but-cryptographically-valid candidate reaches the picker' scenario the plan's task text raised is structurally impossible in the current architecture."
  - "Despite that, wired a defensive one-line filter (`.filter((c) => c.item.undecryptable !== true)`) at handleCredentialsGet's own call site — currently dead code, landed anyway per 27-08's own established 'no live path today, wire it as defense-in-depth' discipline for the E1-error/E3-error backstops. Rationale: a future architecture change that starts retaining stale items (mirroring web) inherits a ceremony that already excludes them from this SECURITY surface, rather than a silent gap; presenting a candidate the popup elsewhere flags with an integrity warning inside a ceremony would be confusing even though signing with it remains cryptographically safe."
  - "Multi-match personal-candidate rows use per-row structural branching (a separate JSX arm, not a single wrapper unconditionally rendered) so a personal row's markup is literally the same shape as before this plan touched the file — only rows with candidate.isShared===true get the relative-wrapper+SharedBadge icon frame and the flex-col+subtitle label treatment."

patterns-established:
  - "ProviderCeremonyView.tsx completes the set of three badge-host files this phase's UI-SPEC named (ItemListView.tsx/AutofillItemRow.tsx+TotpFillRow.tsx in 27-08/27-09, this file in 27-10) — every icon-frame row in the popup now carries the identical SharedBadge treatment for a shared item."

requirements-completed: [EXT-09, EXT-12]

coverage:
  - id: D1
    description: "Multi-match candidate list: shared rows gain the SharedBadge corner marker + resolved-folder-or-folder-free subtitle; personal rows render single-line with no badge; candidates ordered personal-before-shared"
    requirement: "EXT-12"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ProviderCeremonyView.test.tsx#Task 1 (27-10): multi-match orders personal before shared / multi-match subtitle truncate / clicking a shared row still confirms"
        status: pass
    human_judgment: false
  - id: D2
    description: "Single-match layout: no candidate row exists; a shared sole candidate renders provider.sharedPasskeyFolderNote/sharedPasskeyNote beneath the accountLabel line's own text-sm text-base-content/70 treatment; a personal sole candidate is unchanged"
    requirement: "EXT-12"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ProviderCeremonyView.test.tsx#Task 1 (27-10): single-match personal unchanged / single-match folder note / single-match folder-free note"
        status: pass
    human_judgment: false
  - id: D3
    description: "The empty-shared-candidates fallthrough (E4 empty backstop) is confirmed against real vault-store.ts code, not merely inferred, and pinned by a new test"
    requirement: "EXT-09"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/provider-ceremony.test.ts#credentials.get: no matching credential — a stale-but-otherwise-matching item.undecryptable:true candidate is excluded / excluded even when a healthy candidate also matches"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-08-08
status: complete
---

# Phase 27 Plan 10: ProviderCeremonyView Shared-Passkey Badge/Note (E4) Summary

**Applied the shared-item badge/subtitle contract to both of the popup passkey ceremony's candidate presentations — multi-match rows gain SharedBadge + a folder/folder-free subtitle for shared candidates, personal rows unchanged, personal-before-shared ordering; the single-match layout (which has no candidate row at all) gets the same note beneath the accountLabel line — and confirmed, by direct read of vault-store.ts rather than inference, that a shared-but-undecryptable would-be candidate can never reach the ceremony's picker in the first place.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-08T19:27:00+02:00 (immediately after 27-09's completion commit)
- **Completed:** 2026-08-08T19:36:00+02:00
- **Tasks:** 2/2 completed
- **Files modified:** 5 (0 created, 5 modified)

## Accomplishments

- `ProviderCeremonyView.tsx`'s multi-match candidate list: each shared candidate's `h-8 w-8` `KeyRound` frame gains the identical `SharedBadge` corner marker E1/27-08 defines, and the row grows a second, muted, truncating subtitle line showing `provider.sharedPasskeyFolderNote` (interpolated `{folder}`) when the candidate's folder is resolved, or `provider.sharedPasskeyNote` (folder-free) otherwise. Personal candidates render exactly as they did before this plan — single line, no badge, via a dedicated JSX branch rather than a shared wrapper conditionally hiding content.
- Candidates are ordered personal-first-then-shared before rendering — a local stable partition (`orderCandidatesPersonalFirst`), mirroring `autofill-match.ts`'s identical UX-3 precedent without importing it (this is a resolved background-message-response array, not a live `getItems()` consumer).
- Single-match layout (no candidate row exists there by design): when the ceremony's sole candidate is shared, the same note renders beneath the `provider.accountLabel` line, in that line's own `text-sm text-base-content/70` treatment. A personal single-match candidate's layout is unchanged.
- `App.tsx` now threads `matches` through to `ProviderCeremonyView` for every `get()` ceremony (not only when there are 2+ candidates) — `isMultiMatch` still gates the actual picker list on `matches.length > 1`, so this is purely how the single-match note's data (`isShared`/`folderName`) reaches the component; documented as a Rule 2 deviation since it wasn't in the plan's own file list but is load-bearing for the acceptance criteria.
- `provider-ceremony.ts`'s `handleCredentialsGet`: confirmed by direct read of `vault-store.ts`'s `applySyncSnapshot`/`mergeCollectionSnapshot` that a shared-but-undecryptable item (pending or genuinely broken) is recorded only via `markPending`/`getPendingSharedItems()` and never enters the decrypted array `getItems()` returns — so it can never reach `findMatchingPasskeyItems` at all in this extension's current architecture (unlike web, which retains a last-known-good copy). A defensive one-line filter (`item.undecryptable !== true`) is wired at the call site anyway, as dead-code defense-in-depth matching 27-08's own precedent, with a full explanatory comment and two new regression tests.
- Full extension test suite: 757/758 green (the one failure, `lib/generator/password.test.ts`'s word-count assertion, is a pre-existing flaky randomness-based test in a file this plan never touches — passed twice in isolation immediately after, confirmed unrelated). `npx tsc --noEmit` clean. All plan-scoped tests (`ProviderCeremonyView`, `provider-ceremony`, `credential-store`, `App.test`) green: 88/88.

## Task Commits

Each task was committed atomically:

1. **Task 1: ProviderCeremonyView.tsx — badge + subtitle/note on both candidate presentations** - `e0a4609` (feat)
2. **Task 2: Confirm the empty-shared-candidates fallthrough against real code** - `6f7112d` (test)

**Plan metadata:** (this commit)

## Files Created/Modified

- `extension/entrypoints/popup/ProviderCeremonyView.tsx` - multi-match badge/subtitle + personal-before-shared ordering, single-match shared note, `orderCandidatesPersonalFirst`/`sharedNoteKeyFor` helpers, `SharedBadge` import
- `extension/entrypoints/popup/ProviderCeremonyView.test.tsx` - 7 new tests (Task 1 (27-10) describe block) covering personal-unchanged, folder note, folder-free note, ordering, badge-scoping, truncate treatment, click-still-confirms, and create-never-renders-a-note
- `extension/entrypoints/popup/App.tsx` - `matches` prop now threaded for every `get()` ceremony, not only length>1
- `extension/entrypoints/background/provider-ceremony.ts` - defensive `undecryptable !== true` filter + confirmed-decision comment at `handleCredentialsGet`'s `findMatchingPasskeyItems` call site
- `extension/entrypoints/background/provider-ceremony.test.ts` - `passkeyItem()` helper gains an optional `undecryptable` param, 2 new tests confirming the fallthrough

## Decisions Made

See `key-decisions` in frontmatter above (4 decisions, each with full rationale).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - missing critical functionality] Widened App.tsx's `matches` prop to cover every get() ceremony, not just multi-match**
- **Found during:** Task 1
- **Issue:** The plan's own file list scoped Task 1 to `ProviderCeremonyView.tsx` only, but App.tsx's existing call site only ever passed the single-match candidate's bare `.label` string via the `account` prop — never the full candidate object carrying `isShared`/`folderName`. Without touching App.tsx, the single-match note (an explicit must_have) had no data to render from.
- **Fix:** Changed `matches={!isCreate && view.candidates.length > 1 ? view.candidates : undefined}` to `matches={!isCreate ? view.candidates : undefined}`. `ProviderCeremonyView`'s own `isMultiMatch` (`matches.length > 1`) is unchanged and still the sole gate on the picker list rendering, so this is additive-only — it gives the component access to data it previously lacked, with zero change to what was already rendered from `matches` when populated.
- **Files modified:** `extension/entrypoints/popup/App.tsx`
- **Verification:** Full `App.test.tsx` suite green (21/21, including 4 pre-existing single-candidate scenarios); `npx tsc --noEmit` clean.
- **Committed in:** `e0a4609` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 2, missing critical functionality — the plan's file list didn't include the one file needed to supply data the plan's own acceptance criteria required)
**Impact on plan:** Additive-only, no scope creep beyond closing a data-plumbing gap the plan's own single-match requirement implied but its file list didn't name.

## Known Stubs

None. Both new render branches (multi-match subtitle, single-match note) are exercised by real props flowing from `provider-ceremony.ts`'s real `folderNameFor()`/`isShared` data (wired since 27-06) — no fabricated or mocked-only data path.

## Issues Encountered

- Full extension test suite run showed one pre-existing, unrelated flaky test (`lib/generator/password.test.ts`'s `generatePassphrase` word-count assertion) — a randomness-based test in a file this plan never touches. Re-ran in isolation twice immediately after and it passed both times, confirming it is not a regression from this plan's changes. Out of this plan's scope per the SCOPE BOUNDARY rule (pre-existing failure unrelated to current task's files) — not fixed, noted here for visibility.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- E4's badge/subtitle contract for `ProviderCeremonyView.tsx` is complete, matching 27-08/27-09's identical treatment of `ItemListView.tsx`/`AutofillItemRow.tsx`/`TotpFillRow.tsx` — every icon-frame row in the popup now carries the shared-item badge consistently.
- The empty-candidates fallthrough claim (27-UI-SPEC.md's E4-empty backstop) is confirmed against real code and pinned by a regression test, not left as an inference.
- No blockers for 27-11.

---
*Phase: 27-extension-integration-shared-items*
*Completed: 2026-08-08*

## Self-Check: PASSED

- FOUND: extension/entrypoints/popup/ProviderCeremonyView.tsx
- FOUND: extension/entrypoints/popup/ProviderCeremonyView.test.tsx
- FOUND: extension/entrypoints/popup/App.tsx
- FOUND: extension/entrypoints/background/provider-ceremony.ts
- FOUND: extension/entrypoints/background/provider-ceremony.test.ts
- FOUND: .planning/phases/27-extension-integration-shared-items/27-10-SUMMARY.md
- FOUND commit: e0a4609
- FOUND commit: 6f7112d
- FOUND commit: ccab23d
