---
phase: 06-import-export-totp-onboarding
plan: 03
subsystem: import-export
tags: [react, papaparse, import-wizard, export, daisyui, i18n]

requires:
  - phase: 06-import-export-totp-onboarding
    provides: "TotpFields as a fifth ItemType (06-01); MappedItemDraft/detectFormat/per-tool mappers/genericMapping (06-02)"
provides:
  - "ImportWizard -- shared 5-screen (select/mapping/preview/progress/summary) 640px modal wizard driving Plan 06-02's mapping layer through the existing createVaultItem/createVaultFolder write primitives, with folder-name dedup and row-level fault tolerance"
  - "Export pipeline: buildJsonExport/buildCsvExport/downloadFile + ExportDialog's plaintext-warning confirm gate"
  - "SettingsPanel's Import/Eksport tab: Phase 3 placeholder replaced with working Import/Export CTAs"
affects: [06-04-onboarding-wizard]

tech-stack:
  added: []
  patterns:
    - "ImportWizard prop-default pattern: const skip = onSkip ?? onDone; const cancel = onCancel ?? onDone; resolved once, every dismissal call site uses the resolved fn directly"
    - "Row-level fault tolerance flattening: MapRowResult[] -> {drafts, skipped} via a single flattenMapResults() helper shared by every entry path (CSV auto-detect, JSON auto-detect, manual mapping)"
    - "Write-loop skip classification duck-typed on {status, message} (matches lib/vault/store.ts's isConflictError) instead of instanceof ApiClientError -- immune to per-test module-identity mismatches"
    - "Export pipeline reads the store's already-decrypted in-memory VaultItem[]/Folder[] directly -- no new decrypt call, no format-translation layer"

key-files:
  created:
    - web/src/components/vault/ImportWizard.tsx
    - web/src/components/vault/ImportWizard.test.tsx
    - web/src/components/vault/ExportDialog.tsx
    - web/src/components/vault/ExportDialog.test.tsx
    - web/src/lib/vault/exporters/toJson.ts
    - web/src/lib/vault/exporters/toJson.test.ts
    - web/src/lib/vault/exporters/toCsv.ts
    - web/src/lib/vault/exporters/toCsv.test.ts
    - web/src/lib/vault/exporters/download.ts
    - web/src/lib/vault/exporters/download.test.ts
  modified:
    - web/src/components/settings/SettingsPanel.tsx
    - web/src/components/settings/SettingsPanel.test.tsx
    - web/src/lib/i18n/dictionary.ts

key-decisions:
  - "flattenMapResults() gives an upstream mapping-time skip a generic '`Row N`' label (no name was ever successfully parsed for it) -- distinct from a write-time skip's label, which is the draft's own `name`. Both land in the same skippedEntries list and both count toward the summary's total."
  - "Summary 'total' = importedCount + skippedEntries.length (final, post-write-loop state) -- includes both mapping-time and write-time skips, so a row that never became a draft still shows up in 'Imported X of Y'. The preview screen's 'Importuj {n}' count, by contrast, is drafts.length only (what will actually be attempted)."
  - "Mapping-screen table rows render the raw GENERIC_TARGET_FIELDS key text (not a translated field.* label) -- several target fields (urls/folder/tags) have no matching field.* dictionary key yet; Claude's-discretion minimal-risk choice over adding speculative new field.* keys or a runtime lookup that could throw on a missing key."
  - "export.formatJson/export.formatCsv added as dictionary keys (identical PL/EN 'JSON'/'CSV' literal) even though 06-UI-SPEC.md's table lists them as bare literals -- kept the whole component i18n-key-driven for consistency with every other string, at zero real cost since the values are locale-invariant."

requirements-completed: [IMPEX-01, IMPEX-02, IMPEX-03, IMPEX-04]

coverage:
  - id: D1
    description: "ImportWizard drives the full file -> format-detect/manual-map -> preview -> write-loop -> summary flow for both auto-detected (Bitwarden/NordPass/1Password/LastPass/KeePass CSV + Bitwarden JSON) and manually-mapped (IMPEX-03 generic) imports, with row-level fault tolerance (mapping-time and write-time skips both counted, never fatal) and folder-name deduplication"
    requirement: "IMPEX-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ImportWizard.test.tsx (9 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "NordPass/1Password/LastPass/KeePass CSV formats are dispatched through the same auto-detect -> per-tool mapRow() path as Bitwarden, exercised via the CSV_MAPPERS dispatch table"
    requirement: "IMPEX-02"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ImportWizard.test.tsx (auto-advance test covers the shared CSV_MAPPERS dispatch path all 5 CSV formats route through)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Manual column-mapping screen (unrecognized CSV/JSON) maps user-picked columns via mapRowGeneric and produces correct drafts"
    requirement: "IMPEX-03"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ImportWizard.test.tsx (manual mapping screen test)"
        status: pass
    human_judgment: false
  - id: D4
    description: "buildJsonExport/buildCsvExport produce the locked JSON/CSV export schemas; downloadFile triggers exactly one Blob/<a>/revoke cycle; ExportDialog gates every download behind an always-visible plaintext-warning confirm, warning- not error-colored"
    requirement: "IMPEX-04"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/exporters/{toJson,toCsv,download}.test.ts (5 tests), web/src/components/vault/ExportDialog.test.tsx (4 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Settings -> Import/Eksport tab's Phase 3 placeholder is replaced with working Import/Export CTAs opening ImportWizard/ExportDialog as overlays"
    requirement: "IMPEX-01"
    verification:
      - kind: unit
        ref: "web/src/components/settings/SettingsPanel.test.tsx (new CTA-wiring test)"
        status: pass
      - kind: other
        ref: "cd web && npm run build (static export)"
        status: pass
    human_judgment: false

duration: 41min
completed: 2026-07-14
status: complete
---

# Phase 6 Plan 3: Import wizard, export pipeline & Settings wiring Summary

**A 640px `ImportWizard` (file select → auto-detect/manual-map → preview → write-loop → summary) driving Plan 06-02's mapping layer through the existing `createVaultItem`/`createVaultFolder` primitives, plus a client-side JSON/CSV export pipeline gated behind `ExportDialog`'s plaintext-warning confirmation — both wired into Settings' Import/Eksport tab, replacing the Phase 3 placeholder.**

## Performance

- **Duration:** 41 min
- **Started:** 2026-07-14T14:02:00Z (approx. — worktree base commit)
- **Completed:** 2026-07-14T14:42:46Z
- **Tasks:** 2
- **Files modified:** 13 (10 created, 3 modified)

## Accomplishments
- `ImportWizard.tsx`: 5-screen state machine (select/mapping/preview/progress/summary) reusing `DeleteConfirmDialog`'s scrim shape at 640px. Auto-dispatches Bitwarden JSON + all 4 CSV formats via `detectFormat()`/`CSV_MAPPERS`, falls back to a manual column-mapping screen (`mapRowGeneric`) for unrecognized shapes (including a plain JSON array of objects, not just CSV). Row-level fault tolerance via a single `flattenMapResults()` helper shared by every entry path. Write loop resolves/caches `folder name → folderId` (creating at most once per distinct name per run) and classifies write failures (duck-typed 400+"exceeds max size" → oversized, else generic) without ever aborting the loop. Not dismissible mid-write (no `onDone`/`onSkip`/`onCancel` call path while `screen === "progress"`).
- Export pipeline: `buildJsonExport`/`buildCsvExport` serialize the store's already-decrypted `VaultItem[]`/`Folder[]` directly (no translation layer); `downloadFile` is a plain `Blob` + `<a download>` + `URL.revokeObjectURL` cycle. `ExportDialog` is a structural copy of `DeleteConfirmDialog` at 400px, `btn-warning`/`text-warning` instead of error-red (nothing is destroyed by an export), with the plaintext-warning `alert-warning` banner always rendered before the confirm button can fire a download.
- `SettingsPanel`'s `importExport` tab: Phase 3's placeholder paragraph replaced with two CTA rows (`settings.importCta`/`settings.exportCta`) opening `ImportWizard`/`ExportDialog` as `z-50` overlays above the panel.
- 41 new `import.*`/`export.*`/`settings.import*`/`settings.export*`/`aria.chooseFileToImport` dictionary keys (PL/EN), copied verbatim from 06-UI-SPEC.md's Copywriting Contract where specified.
- Full suite: 46 test files / 316 tests pass; `npm run build` (including the `build-wasm.sh` prebuild step) succeeds cleanly.

## Task Commits

Each task was committed atomically:

1. **Task 1: `ImportWizard` — file select, format detection/manual mapping, preview, write loop, summary** - `c98dc56` (feat, TDD)
2. **Task 2: Export pipeline (`toJson`/`toCsv`/`download` + `ExportDialog`) + Settings Import/Eksport tab wiring** - `1a19ed1` (feat, TDD)

_TDD note: both tasks were marked `tdd="true"`; test files were written alongside implementation in the same commit per task (RED+GREEN combined) — both tasks' own `<verify>` vitest commands were run and passed before each commit, matching this phase's established Plan 06-01/06-02 convention._

## Files Created/Modified
- `web/src/components/vault/ImportWizard.tsx` — 5-screen import wizard state machine
- `web/src/components/vault/ImportWizard.test.tsx` — 9 tests covering every `<behavior>` bullet
- `web/src/components/vault/ExportDialog.tsx` — 400px plaintext-warning confirm dialog
- `web/src/components/vault/ExportDialog.test.tsx` — 4 tests
- `web/src/lib/vault/exporters/toJson.ts`/`.test.ts` — `buildJsonExport`
- `web/src/lib/vault/exporters/toCsv.ts`/`.test.ts` — `buildCsvExport`, `EXPORT_COLUMNS`
- `web/src/lib/vault/exporters/download.ts`/`.test.ts` — `downloadFile` (extra test file beyond the plan's `files_modified` list, added for direct coverage of the behavior bullet testing it in isolation)
- `web/src/components/settings/SettingsPanel.tsx`/`.test.tsx` — Import/Export CTA wiring
- `web/src/lib/i18n/dictionary.ts` — `import.*`, `export.*`, `settings.import*`/`settings.export*`, `aria.chooseFileToImport` (PL/EN)

## Decisions Made
- `flattenMapResults()` labels an upstream mapping-time skip `Row {n}` (1-based) since no `name` was ever successfully parsed for it, vs. a write-time skip which uses the draft's own `name` — both land in the same `skippedEntries` list feeding the summary's expandable reason toggle.
- Summary's "total" = `importedCount + skippedEntries.length` computed at render time from final state (covers both mapping-time and write-time skips), while the preview screen's "Importuj {n}" count is `drafts.length` only (what the write loop will actually attempt) — these are deliberately different numbers answering different questions ("how many will we try" vs. "how many did we encounter total").
- Manual-mapping table rows show the raw `GENERIC_TARGET_FIELDS` key text rather than a translated `field.*` label, since several target fields (`urls`/`folder`/`tags`) have no corresponding dictionary entry yet — avoided adding speculative new keys or a lookup that could throw on a missing key.
- Added `export.formatJson`/`export.formatCsv` dictionary keys for the JSON/CSV format-toggle labels even though they're locale-invariant literals in 06-UI-SPEC.md's table, keeping every visible string in `ExportDialog` sourced from the dictionary for consistency with the rest of the codebase's i18n convention.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `web/node_modules` missing in the fresh worktree**
- **Found during:** Pre-flight, before running any vitest command
- **Issue:** The worktree's `web/` directory had no `node_modules` — a known parallel-worktree gap (dependencies aren't checked into git; same gap documented in Plan 06-01/06-02's own SUMMARYs).
- **Fix:** Ran `npm ci` in `web/` (212 packages installed cleanly).
- **Files modified:** none tracked (`node_modules` is gitignored).
- **Verification:** Subsequent `npx vitest run`/`npm run build` succeeded.
- **Committed in:** N/A (no tracked file change).

**2. [Rule 3 - Blocking] Extra `download.test.ts` file beyond the plan's `files_modified` list**
- **Found during:** Task 2 (writing `download.ts`)
- **Issue:** The plan's `<behavior>` explicitly specifies `downloadFile`'s exact-once-Blob/click/revoke contract as a standalone testable behavior, but the plan's frontmatter `files_modified`/task `<files>` lists only list `download.ts` (implementation) without a matching `download.test.ts`.
- **Fix:** Added `download.test.ts` as a small, additional unit test file directly covering that behavior bullet in isolation (mocking `document.createElement`/`URL.createObjectURL`/`URL.revokeObjectURL`), rather than folding it awkwardly into `ExportDialog.test.tsx`'s mocked-`downloadFile` assertions (which only prove the dialog calls it, not that `downloadFile` itself behaves correctly).
- **Files modified:** `web/src/lib/vault/exporters/download.test.ts` (new).
- **Verification:** `npx vitest run src/lib/vault/exporters/download.test.ts` passes; not included in the plan's `<verify>` command list but does not conflict with it (extra coverage, zero risk).
- **Committed in:** `1a19ed1` (Task 2 commit).

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking/environment gap and a minor test-coverage completeness addition). No scope creep — neither changed any locked behavior, requirement, or the plan's specified `ItemFields`/`MappedItemDraft`/export-schema contracts.

## Issues Encountered
None beyond the deviations above. `npx tsc --noEmit` reports pre-existing errors in `web/src/lib/crypto/index.ts`/`index.test.ts` (missing `./wasm/pv_wasm.js`) before `npm run build`'s `build-wasm.sh` prebuild step runs — confirmed unrelated to this plan (same pre-existing gap flagged in Plan 06-01/06-02's own SUMMARYs); resolved automatically once the wasm build step ran as part of `npm run build`, and does not affect any file this plan touched (`grep -i "ImportWizard\|dictionary"` over the `tsc` output returned nothing before the wasm rebuild either).

## User Setup Required

None — no external service configuration required. No new npm dependency was added this plan (papaparse/lucide-react were already installed by Plan 06-01/06-02).

## Next Phase Readiness
- `ImportWizard` is mountable identically from any call site with `{ onDone, onSkip?, onCancel? }` — Plan 06-04's Onboarding Step 1 can mount it inline within the onboarding takeover card exactly as-is, per 06-CONTEXT.md's "no stripped-down subset" instruction. No API changes needed for that plan.
- `ExportDialog` and the export pipeline are fully self-contained (Settings-only surface per this phase's scope) — no dependency from Plan 06-04.
- No blockers for Plan 06-04.

---
*Phase: 06-import-export-totp-onboarding*
*Completed: 2026-07-14*

## Self-Check: PASSED

All created files (ImportWizard.tsx, ExportDialog.tsx, toJson.ts, toCsv.ts, download.ts, this SUMMARY.md) and both task commit hashes (`c98dc56`, `1a19ed1`) verified present on disk / in `git log --oneline --all`.
