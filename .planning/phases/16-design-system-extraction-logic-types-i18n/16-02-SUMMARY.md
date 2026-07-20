---
phase: 16-design-system-extraction-logic-types-i18n
plan: 02
subsystem: infra
tags: [typescript, monorepo, pv-ui, vault-types, autofill]

# Dependency graph
requires:
  - phase: 16-design-system-extraction-logic-types-i18n
    provides: "16-01's packages/pv-ui/package.json exports map (./vault/types subpath) and web/tsconfig.json paths alias (pv-ui/vault/*)"
provides:
  - "packages/pv-ui/vault/types.ts: canonical VaultItem/ItemFields/Folder/VaultFilter type shapes + normalizeItemFields(), moved byte-for-byte from web/src/lib/vault/types.ts"
  - "web/src/lib/vault/types.ts and extension/lib/vault/types.ts both reduced to 1-statement export * shims over pv-ui/vault/types.ts"
  - "extension side now consumes web's type superset (CardFields.pin/zip, IdentityFields structured address fields) for the first time, additively"
  - "proof that extension/lib/autofill/fill-dom.ts's only IdentityFields write remains the legacy flat address field, untouched by this plan"
affects: ["16-05"]

# Tech tracking
tech-stack:
  added: []
  patterns: ["export * from \"pv-ui/vault/types\" shim convention, extending the generator/password.ts precedent (D-13) to the vault/types.ts module"]

key-files:
  created:
    - packages/pv-ui/vault/types.ts
  modified:
    - web/src/lib/vault/types.ts
    - extension/lib/vault/types.ts

key-decisions:
  - "packages/pv-ui/vault/types.ts is a byte-for-byte copy of web's pre-move types.ts (verified via `diff`, zero delta) — the canonical superset now lives in pv-ui, not web"
  - "extension's shim adopts web's superset additively (CardFields.pin/zip, IdentityFields structured address fields) for the first time; extension/lib/autofill/fill-dom.ts was re-verified (fresh grep + git diff --quiet) to still write only the legacy flat address field exactly once, proving the prohibition holds"
  - "Fresh worktree required npm ci in both web/ and extension/ (node_modules absent, only package-lock.json present) plus scripts/build-wasm.sh and npx wxt prepare (Rule 3, blocking issues) before any vitest/tsc verify step could run — same environment-bootstrapping pattern 16-01 hit, none of it touching this plan's own source files"

requirements-completed: [DS-01]

coverage:
  - id: D1
    description: "packages/pv-ui/vault/types.ts created as the canonical superset (ItemType, LoginFields, CardFields, IdentityFields, NoteFields, TotpFields, PasskeyFields, ItemFields, VaultItem, Folder, VaultFilter, normalizeItemFields), byte-identical to web's pre-move file; web/src/lib/vault/types.ts reduced to a 1-statement shim"
    requirement: "DS-01"
    verification:
      - kind: unit
        ref: "diff web/src/lib/vault/types.ts(pre-move) packages/pv-ui/vault/types.ts -- zero delta, verified before overwrite"
        status: pass
      - kind: unit
        ref: "web: npx vitest run src/lib/vault/types.test.ts -- 4/4 passed"
        status: pass
      - kind: unit
        ref: "web: npx tsc --noEmit -- clean"
        status: pass
      - kind: integration
        ref: "web: npx vitest run (full suite) -- 474/474 passed, matches 16-01's pre-migration baseline"
        status: pass
    human_judgment: false
  - id: D2
    description: "extension/lib/vault/types.ts reduced to a 1-statement export * shim over pv-ui/vault/types.ts, adopting web's superset additively; extension/lib/autofill/fill-dom.ts re-verified untouched with its only IdentityFields write still the legacy flat address field"
    requirement: "DS-01"
    verification:
      - kind: unit
        ref: "extension: npx vitest run lib/vault/search.test.ts lib/vault/sort.test.ts -- 20/20 passed"
        status: pass
      - kind: unit
        ref: "extension: npx tsc --noEmit -- clean"
        status: pass
      - kind: other
        ref: "git diff --quiet -- extension/lib/autofill/fill-dom.ts (empty diff, file byte-identical to pre-plan state)"
        status: pass
      - kind: other
        ref: "grep -c 'write(targets.address, values.address);' extension/lib/autofill/fill-dom.ts == 1"
        status: pass
      - kind: integration
        ref: "extension: npx vitest run (full suite) -- 678/678 passed, matches 16-01's pre-migration baseline"
        status: pass
    human_judgment: false

# Metrics
duration: 25min
completed: 2026-07-20
status: complete
---

# Phase 16 Plan 02: Vault types.ts Reconciliation (web canonical -> pv-ui, extension adopts superset) Summary

**Moved web's `vault/types.ts` byte-for-byte into `packages/pv-ui/vault/types.ts` as the canonical type-shape source, reduced both web and extension consumers to 1-statement `export *` shims, and proved via fresh grep + `git diff --quiet` that extension's autofill DOM-write surface (`fill-dom.ts`) gained zero new fields despite the extension side now consuming web's larger type superset.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 completed
- **Files modified:** 3 (1 created, 2 reduced to shims)

## Accomplishments
- `packages/pv-ui/vault/types.ts` is now the single canonical source for `ItemType`, `LoginFields`, `CardFields`, `IdentityFields`, `NoteFields`, `TotpFields`, `PasskeyFields`, `ItemFields`, `VaultItem`, `Folder`, `VaultFilter`, and `normalizeItemFields()` — confirmed byte-identical to web's pre-move file via `diff`.
- `web/src/lib/vault/types.ts` reduced to a 1-statement `export * from "pv-ui/vault/types"` shim; its sibling `types.test.ts` (normalizeItemFields test suite) passes unchanged through the shim chain (4/4).
- `extension/lib/vault/types.ts` reduced to the same shim pattern, additively adopting web's superset (`CardFields.pin`/`zip`, `IdentityFields` structured address fields) for the extension side for the first time.
- Re-verified — via a fresh grep and `git diff --quiet`, not assumption — that `extension/lib/autofill/fill-dom.ts` is byte-identical to its pre-plan state and its only `IdentityFields`-related write remains the pre-existing legacy flat `write(targets.address, values.address);` line, exactly once. The T-16-02 threat-register mitigation holds.
- Both consumers' full test suites match the 16-01 baseline exactly (web 474/474, extension 678/678), and both `tsc --noEmit` runs are clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: pv-ui/vault/types.ts (canonical move) + web shim** - `edfe798` (feat)
2. **Task 2: extension shim (adopts superset) + fill-dom.ts re-verification** - `3ebbd51` (feat)

_Note: no plan-metadata commit in worktree mode — the orchestrator commits shared STATE.md/ROADMAP.md updates centrally after merge; this SUMMARY.md is committed separately per worktree protocol._

## Files Created/Modified
- `packages/pv-ui/vault/types.ts` - canonical vault item/folder type shapes + `normalizeItemFields()`, moved byte-for-byte from `web/src/lib/vault/types.ts`
- `web/src/lib/vault/types.ts` - reduced to a 1-statement `export * from "pv-ui/vault/types"` shim (header comment names D-13, this plan, and `types.test.ts` as the reason the file is kept, not deleted)
- `extension/lib/vault/types.ts` - reduced to a 1-statement `export * from "pv-ui/vault/types"` shim, additively adopting web's superset for the first time

## Decisions Made
- `packages/pv-ui/vault/types.ts`'s content is a verbatim copy of web's pre-move `types.ts` — verified with `diff` before overwriting web's file, so the "byte-for-byte" truth claim is proven, not assumed.
- Extension's shim header comment quotes both of its own real import paths (`"./types"` used by `search.ts`/`sort.ts`, `"../vault/types"` used by `ext-protocol.ts`) rather than a single generic reference, since (unlike the generator/password.ts precedent) this module has two distinct relative-import call sites in the same codebase worth naming.
- Fresh-worktree environment bootstrap (npm ci in web/ and extension/, `scripts/build-wasm.sh`, `npx wxt prepare`) was required before any verify step could run — same class of Rule 3 blocking-issue fix 16-01 already documented, none of it touching this plan's own three files.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Fresh worktree missing installed node_modules in web/ and extension/**
- **Found during:** Task 1 (baseline verify step)
- **Issue:** `npx vitest run src/lib/vault/types.test.ts` in `web/` failed at `vitest.config.ts` load time with `Cannot find module 'vitest/config'` — `web/node_modules` and `extension/node_modules` didn't exist in this fresh worktree checkout at all (only `package-lock.json` was present), distinct from 16-01's WASM-artifact deviation which assumed `node_modules` already existed.
- **Fix:** Ran `npm ci` in both `web/` and `extension/`.
- **Files modified:** none tracked (`node_modules/` is gitignored in both projects).
- **Verification:** Re-ran the plan's verify commands — all passed (see coverage above).
- **Committed in:** n/a (gitignored, nothing to commit).

**2. [Rule 3 - Blocking issue] Fresh worktree missing WASM build artifacts + stale WXT-generated PublicPath type**
- **Found during:** Task 1 (baseline verify step, after the `npm ci` fix above)
- **Issue:** Same class of issue 16-01 already documented — `web/src/lib/crypto/wasm/` and `extension/lib/crypto/wasm/` are gitignored WASM-bindgen outputs absent from a fresh worktree; `extension/public/wasm/pv_wasm_bg.wasm` didn't exist yet when `npm ci`'s `postinstall` ran `wxt prepare`, so WXT's generated `PublicPath` type didn't include it.
- **Fix:** Ran `./scripts/build-wasm.sh` (builds `pv-wasm` for `wasm32-unknown-unknown`, runs `wasm-bindgen` for both `web/` and `extension/` output targets), then `npx wxt prepare` in `extension/` to regenerate the WXT type declarations.
- **Files modified:** none tracked (all outputs are gitignored build artifacts / generated types in `.wxt/`).
- **Verification:** Re-ran `npx tsc --noEmit` in both `web/` and `extension/` — both clean.
- **Committed in:** n/a (gitignored, nothing to commit).

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking issues, both environment-setup-only, zero tracked-file changes beyond this plan's own three files).
**Impact on plan:** Both deviations were pure fresh-worktree environment bootstrapping (npm dependency install, gitignored build artifacts, generated types), required to even run the plan's own mandated verification commands. No scope creep, no source-code changes beyond `packages/pv-ui/vault/types.ts`, `web/src/lib/vault/types.ts`, and `extension/lib/vault/types.ts` exactly as planned.

## Issues Encountered
None beyond the environment-bootstrapping deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
Plan 16-05 (Wave 3) can now resolve its own local `./types` import inside `packages/pv-ui/vault/` against this plan's `packages/pv-ui/vault/types.ts` output. `search.ts`/`sort.ts` in both web and extension continue to import `VaultItem`/`ItemFields`/`VaultFilter` unchanged (they still resolve through their local `./types` shim, now itself re-exporting from pv-ui). No blockers for downstream plans.

---
*Phase: 16-design-system-extraction-logic-types-i18n*
*Completed: 2026-07-20*
