---
phase: 06-import-export-totp-onboarding
plan: 02
subsystem: import-export
tags: [papaparse, csv-parsing, bitwarden, nordpass, 1password, lastpass, keepass, totp, otpauth]

requires:
  - phase: 02-vault-crud
    provides: "ItemFields discriminated union (LoginFields/CardFields/IdentityFields/NoteFields) MappedItemDraft mirrors field-for-field"

provides:
  - "MappedItemDraft discriminated union (login/card/identity/note/totp) -- the common intermediate shape every importer maps a source row to"
  - "detectFormat(fileName, headers, rawText) -> ImportFormat -- JSON-shape check first, then a fixed-order CSV header-detection dispatch"
  - "Six per-source mapper modules (bitwardenJson, bitwardenCsv, nordpassCsv, onePasswordCsv, lastpassCsv, keepassCsv), each a static column table + detect()/mapRow()"
  - "genericMapping.mapRowGeneric -- IMPEX-03's manual-column-mapping fallback"
  - "parseTotpValue -- shared otpauth://-vs-bare-base32 disambiguation, reused by every mapper"

affects: [06-03-import-wizard, 06-04-onboarding]

tech-stack:
  added: ["papaparse@5.5.4", "@types/papaparse@^5.5.2"]
  patterns:
    - "Per-tool CSV mapper module shape: {TOOL}_CSV_REQUIRED_COLUMNS const + detect(headers): boolean + mapRow(row): MapRowResult"
    - "Row-level fault tolerance via MapRowResult{items, skipped?} -- never throws, always a counted skip"
    - "A row's embedded TOTP secret always splits into a second, standalone totp draft -- never a hidden relation"

key-files:
  created:
    - web/src/lib/vault/importers/types.ts
    - web/src/lib/vault/importers/detect.ts
    - web/src/lib/vault/importers/bitwardenJson.ts
    - web/src/lib/vault/importers/bitwardenCsv.ts
    - web/src/lib/vault/importers/nordpassCsv.ts
    - web/src/lib/vault/importers/onePasswordCsv.ts
    - web/src/lib/vault/importers/lastpassCsv.ts
    - web/src/lib/vault/importers/keepassCsv.ts
    - web/src/lib/vault/importers/genericMapping.ts
  modified:
    - web/package.json
    - web/package-lock.json

key-decisions:
  - "papaparse@5.5.4 approved via resolved Package Legitimacy checkpoint (Task 1) -- documented [SUS]/\"too-new\" false positive confirmed against the live npm registry"
  - "detect.ts's full 5-mapper dispatch was implemented in two increments (Task 2: bitwardenCsv only; Task 3: + lastpass/keepass/nordpass/1password) so each task's own commit remains independently buildable -- deviation documented below"

patterns-established:
  - "Every mapper's detect() checks only a minimal, tool-specific required-column subset -- a false non-match degrades to genericMapping, never a false-positive misdetection"
  - "keepassCsv matches headers case-insensitively and reads its optional TOTP column defensively (absence is not an error)"

requirements-completed: [IMPEX-01, IMPEX-02, IMPEX-03]

coverage:
  - id: D1
    description: "MappedItemDraft/ParsedTotp/parseTotpValue shared types with otpauth:// vs bare-base32 disambiguation"
    requirement: "IMPEX-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/importers/types.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "detectFormat() dispatches Bitwarden JSON (shape), Bitwarden/NordPass/1Password/LastPass/KeePass CSV (header set), unknown fallback"
    requirement: "IMPEX-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/importers/detect.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "bitwardenJson.mapItem + bitwardenCsv.mapRow map all 4 Bitwarden item types, splitting an embedded login.totp into a second totp draft"
    requirement: "IMPEX-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/importers/bitwardenJson.test.ts"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/importers/bitwardenCsv.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "nordpassCsv/onePasswordCsv/lastpassCsv/keepassCsv per-tool mappers with minimal-subset detect()"
    requirement: "IMPEX-02"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/importers/nordpassCsv.test.ts"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/importers/onePasswordCsv.test.ts"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/importers/lastpassCsv.test.ts"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/importers/keepassCsv.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "genericMapping.mapRowGeneric -- IMPEX-03's manual-column-mapping fallback"
    requirement: "IMPEX-03"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/importers/genericMapping.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "papaparse@5.5.4 dependency approved via Package Legitimacy Gate checkpoint"
    verification: []
    human_judgment: true
    rationale: "Task 1 is a blocking human-verify checkpoint by protocol; the orchestrator resolved it directly (approved, 2026-07-14) rather than pausing this executor -- recorded here for audit trail, not re-verifiable by an automated test."

duration: 25min
completed: 2026-07-14
status: complete
---

# Phase 6 Plan 2: Import Mapping Layer Summary

**Pure, framework-free import mapping layer for Bitwarden JSON/CSV, NordPass/1Password/LastPass/KeePass CSV, and a generic manual-mapping fallback -- all producing a shared `MappedItemDraft` intermediate shape, backed by papaparse@5.5.4 for RFC 4180-correct CSV parsing.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-14T15:XX (worktree spawn)
- **Completed:** 2026-07-14T16:14:19+02:00
- **Tasks:** 3 (1 checkpoint-approved, 2 auto/tdd)
- **Files modified:** 12 (10 created source+test pairs across importers/, plus package.json/package-lock.json)

## Accomplishments

- Shared `MappedItemDraft` discriminated union (login/card/identity/note/totp) and `parseTotpValue()` -- the single otpauth://-vs-bare-base32 disambiguation function every mapper reuses, never duplicated
- `detectFormat()` correctly dispatches Bitwarden JSON (JSON-shape detected), Bitwarden/NordPass/1Password/LastPass/KeePass CSV (header-set detected, fixed order, first match wins), and `"unknown"` as a safe fallback
- All 6 per-tool mapper modules (`bitwardenJson`, `bitwardenCsv`, `nordpassCsv`, `onePasswordCsv`, `lastpassCsv`, `keepassCsv`) implemented as static lookup tables + `detect()`/`mapRow()`, each correctly splitting an embedded TOTP secret into a standalone second draft when present
- `genericMapping.mapRowGeneric` completes IMPEX-03's manual-column-mapping fallback
- 63 unit tests across 9 test files, all green; no throws on malformed/missing-field rows anywhere in the mapping layer

## Task Commits

Each task was committed atomically:

1. **Task 1: Approve papaparse as a runtime dependency (Package Legitimacy Gate)** - resolved by orchestrator pre-approval, no separate commit (approval-only checkpoint per plan; see "Checkpoint Resolution" below)
2. **Task 2: papaparse install + shared types + format detection + Bitwarden JSON/CSV mappers** - `1668536` (feat)
3. **Task 3: NordPass/1Password/LastPass/KeePass CSV mappers + generic manual-mapping fallback** - `03f1b05` (feat)

_TDD note: both auto tasks were marked `tdd="true"`; test files were written alongside implementation in the same commit per task (RED+GREEN combined, since each function/module pair was implemented and tested together rather than as separate red/green commits) -- both tasks' `<verify>` commands were run and passed before each commit._

## Checkpoint Resolution

**Task 1 (`checkpoint:human-verify`, `gate="blocking-human"`) was resolved by the orchestrator, not paused on by this executor**, per explicit instruction in this run's prompt:

> "THIS CHECKPOINT IS RESOLVED: **approved**. The orchestrator independently verified papaparse on the npm registry (2026-07-14): first published 2014-11-19, latest 5.5.4 (2026-06-19), 9.7M downloads/week, MIT license, maintainers mholt+pokoli -- the plan's documented [SUS] auto-flag false positive is confirmed."

Verified locally as part of Task 2's install step: `npm view papaparse version` → `5.5.4`; `grep -c '"papaparse"' web/package.json` → `1`. No further human interaction was required or requested for this gate.

## Files Created/Modified

- `web/src/lib/vault/importers/types.ts` - `MappedItemDraft`/`ParsedTotp`/`SkipReason`/`MapRowResult`/`parseTotpValue()`
- `web/src/lib/vault/importers/detect.ts` - `detectFormat()`, `ImportFormat` union, fixed-order CSV dispatch table
- `web/src/lib/vault/importers/bitwardenJson.ts` - `mapItem()` for Bitwarden's JSON export (`items[]`, 4 types + totp split)
- `web/src/lib/vault/importers/bitwardenCsv.ts` - `detect()`/`mapRow()` for Bitwarden's flat CSV export
- `web/src/lib/vault/importers/nordpassCsv.ts` - `detect()`/`mapRow()`, login-vs-note heuristic for NordPass's no-TOTP export
- `web/src/lib/vault/importers/onePasswordCsv.ts` - `detect()`/`mapRow()`, minimal 3-column detect() (title/username/password) per LOW-MEDIUM confidence column table
- `web/src/lib/vault/importers/lastpassCsv.ts` - `detect()`/`mapRow()`, first-backslash-segment folder extraction from `grouping`
- `web/src/lib/vault/importers/keepassCsv.ts` - `detect()`/`mapRow()`, case-insensitive header match, optional TOTP column (stock KeePass vs KeePassXC)
- `web/src/lib/vault/importers/genericMapping.ts` - `GENERIC_TARGET_FIELDS`/`mapRowGeneric()` for IMPEX-03's manual-mapping fallback
- `web/package.json` / `web/package-lock.json` - `papaparse@5.5.4` (dependencies) + `@types/papaparse` (devDependencies)
- 9 corresponding `*.test.ts` files (one per module above except `detect.ts` which shares `detect.test.ts`) -- 63 tests total

## Decisions Made

- **`detect.ts`'s full 5-mapper dispatch was built incrementally across the two auto tasks rather than all at once in Task 2**, even though the plan's Task 2 `<action>` describes the complete fixed-order dispatch list (including `lastpassCsv`/`keepassCsv`/`nordpassCsv`/`onePasswordCsv`, which are Task 3 deliverables). Task 2's commit wires in only `bitwardenCsv` (matching what exists at that commit boundary); Task 3's commit extends `detect.ts` to add the remaining four dispatchers once those modules exist. This keeps every individual commit independently buildable/testable — checking out either commit in isolation never references a file that doesn't exist in that commit's tree. Both tasks' own `<verify>` commands (scoped to their own test file lists) were run and passed at their respective commit boundaries. Documented as a Rule 3 (blocking-issue) style sequencing fix, not a scope change — the final `detect.ts` state after Task 3 matches the plan's full specification exactly.
- Bitwarden CSV's `card_*`/`identity_*` column names (e.g. `card_cardholder_name`, `identity_first_name`) are a best-effort guess, per 06-RESEARCH.md's own LOW-MEDIUM confidence note that only the `login_*` columns are documented/stable — these are read defensively (`row.card_number ?? ""`) and are not part of `detect()`'s required set, so a wrong guess degrades to an empty field rather than a misdetection, matching every other per-tool mapper's graceful-degradation design.
- Unrecognized `type` values in `bitwardenJson.mapItem`/`bitwardenCsv.mapRow` (i.e. not one of the 4 known Bitwarden item types) return `{items: [], skipped: "unparseableRow"}` rather than `"missingField"` — not explicitly specified in `<behavior>`, chosen as the more semantically accurate `SkipReason` for "recognized shape, unrecognized type value" vs. "required field literally absent".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `npm ci` required before `npm install papaparse`**
- **Found during:** Task 2 (pre-install step)
- **Issue:** Fresh worktree checkout had no `web/node_modules` — `npm install papaparse@5.5.4` would have failed/behaved unpredictably against a partially-installed tree.
- **Fix:** Ran `npm ci` in `web/` first (210 packages installed cleanly), then proceeded with the papaparse install.
- **Files modified:** None (node_modules is gitignored; no package.json/lock changes from this step alone).
- **Verification:** `npm ci` exit 0; subsequent `npm install papaparse@5.5.4` succeeded.
- **Committed in:** N/A (node_modules not tracked in git)

**2. [Rule 3 - Sequencing] `detect.ts` full-dispatch wiring split across Task 2/Task 3 commits**
- See "Decisions Made" above for full rationale — this is a commit-atomicity fix, not a scope or behavior change. The plan's final specified `detect.ts` behavior (5-mapper fixed-order dispatch) is fully realized by the end of Task 3's commit.
- **Files modified:** `web/src/lib/vault/importers/detect.ts`, `web/src/lib/vault/importers/detect.test.ts` (touched in both commits)
- **Verification:** Both tasks' own `<verify>` vitest commands passed at their respective commit boundaries; full `npx vitest run src/lib/vault/importers/` (63 tests) passes at the end of Task 3.
- **Committed in:** `1668536` (Task 2, partial dispatch) and `03f1b05` (Task 3, full dispatch)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking/sequencing, no scope creep)
**Impact on plan:** Both fixes were necessary to keep the fresh worktree buildable and each task commit independently self-consistent. No behavior, requirement, or test-case scope was altered from the plan's specification.

## Issues Encountered

- `npx tsc --noEmit` reports pre-existing errors in `web/src/lib/crypto/index.ts`/`index.test.ts` (missing `./wasm/pv_wasm.js` — the WASM bindings were not built in this fresh worktree, per the known `scripts/build-wasm.sh` requirement noted in this plan's extra-context). These are entirely outside this plan's `files_modified` scope (no file in `web/src/lib/crypto/` was touched) and are unrelated to the import mapping layer — confirmed via `npx tsc --noEmit 2>&1 | grep -i importers` returning zero matches. Not fixed, per the Scope Boundary rule (pre-existing issue in unrelated files). The importers subsystem itself has zero typecheck errors.

## User Setup Required

None - no external service configuration required. `papaparse` is a build-time npm dependency only, no API keys or infra changes.

## Next Phase Readiness

- The full import mapping layer (`web/src/lib/vault/importers/*.ts`) is ready for Plan 06-03's `ImportWizard` to drive: `detectFormat()` → per-tool `detect()`/`mapRow()` (or `genericMapping.mapRowGeneric()` as the manual-mapping fallback) → `MappedItemDraft[]` → (06-03's concern) folder-name resolution + `createVaultItem()` write loop.
- No blockers for 06-03 or 06-04 (onboarding) — this plan has zero UI/React dependency and zero dependency on Plan 06-01's `TotpFields`/`ItemType` changes, as designed.
- `MappedItemDraft`'s `folder: string`/`tags: string[]` (raw source values, not resolved IDs) are the exact shape 06-03 needs to build its folder-name → `folderId` resolution step against the existing `Folder[]` store state.

---
*Phase: 06-import-export-totp-onboarding*
*Completed: 2026-07-14*

## Self-Check: PASSED

All 9 created source files + SUMMARY.md verified present on disk; all 3 commit hashes (`1668536`, `03f1b05`, `233ca8b`) verified present in `git log --oneline --all`.
