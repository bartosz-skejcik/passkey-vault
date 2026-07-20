---
phase: 16-design-system-extraction-logic-types-i18n
plan: 03
subsystem: ui
tags: [pv-ui, cardBrand, clipboard, design-system, monorepo]

# Dependency graph
requires:
  - phase: 16-01
    provides: packages/pv-ui package.json exports map for vault/cardBrand and clipboard, and web tsconfig path aliases
provides:
  - "packages/pv-ui/vault/cardBrand.ts: single canonical CardBrand type + detectCardBrand()"
  - "packages/pv-ui/clipboard.ts: single canonical clipboard copy-with-auto-clear logic (single-active-timer discipline)"
  - "web and extension both consume cardBrand/clipboard via 1-statement export * shims"
affects: [17-shared-component-visual-alignment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "export * shim pattern (established by 11-07's generator/password.ts) reused for two more leaf modules with zero call-site churn"

key-files:
  created:
    - packages/pv-ui/vault/cardBrand.ts
    - packages/pv-ui/clipboard.ts
  modified:
    - web/src/lib/vault/cardBrand.ts
    - web/src/lib/clipboard.ts
    - extension/lib/vault/cardBrand.ts
    - extension/lib/clipboard.ts

key-decisions:
  - "Both cardBrand.ts and clipboard.ts moved byte-for-byte from web's originals into pv-ui, matching the plan's must_haves exactly — no logic changes, only shim reduction in both consumers."
  - "Fresh worktree required npm install (web/, extension/) plus scripts/build-wasm.sh plus npx wxt prepare before tsc --noEmit was clean in either package — none of this touched files_modified, all gitignored build/dependency artifacts."

patterns-established: []

requirements-completed: [DS-01]

coverage:
  - id: D1
    description: "packages/pv-ui/vault/cardBrand.ts and packages/pv-ui/clipboard.ts are the single canonical source for card-brand detection and clipboard auto-clear; web and extension both reduced to 1-statement export * shims"
    requirement: "DS-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/cardBrand.test.ts (9 tests, run through the shim chain)"
        status: pass
      - kind: unit
        ref: "web/src/lib/clipboard.test.ts (4 tests, run through the shim chain)"
        status: pass
      - kind: other
        ref: "web: npx tsc --noEmit (clean)"
        status: pass
      - kind: other
        ref: "extension: npx tsc --noEmit (clean)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Zero-knowledge boundary and zero-duplication proofs: neither new pv-ui file imports any crypto-surface symbol, and no non-shim detectCardBrand/copyWithAutoClear definition survives outside packages/pv-ui"
    requirement: "DS-01"
    verification:
      - kind: other
        ref: "grep import-line scan of packages/pv-ui/vault/cardBrand.ts + packages/pv-ui/clipboard.ts for wasm|argon2|chacha|hkdf|derive|decrypt|prf (empty)"
        status: pass
      - kind: other
        ref: "grep scan of web/src + extension/lib for non-shim function detectCardBrand/copyWithAutoClear (empty)"
        status: pass
    human_judgment: false

duration: 11min
completed: 2026-07-20
status: complete
---

# Phase 16 Plan 03: cardBrand + clipboard Extraction Summary

**Moved `detectCardBrand()` and the clipboard copy-with-auto-clear guarantee (`clampClipboardSeconds`/`readClipboardSeconds`/`copyWithAutoClear`) byte-for-byte into `packages/pv-ui`, replacing all 4 web/extension copies with 1-statement `export *` shims.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-07-20T22:49:00+02:00
- **Completed:** 2026-07-20T23:00:46+02:00
- **Tasks:** 2 completed
- **Files modified:** 6 (2 created, 4 shim-reduced)

## Accomplishments
- `packages/pv-ui/vault/cardBrand.ts` and `packages/pv-ui/clipboard.ts` are now the single canonical source for these two leaf modules (zero imports, zero platform-specific behavior)
- All 4 consumer copies (web ×2, extension ×2) reduced to 1-statement `export * from "pv-ui/..."` shims, following the exact shim-comment convention established by `generator/password.ts` (D-13, plan 11-07)
- Web's local `cardBrand.test.ts` (9 tests) and `clipboard.test.ts` (4 tests) both pass unchanged through the shim chain — the clipboard auto-clear guarantee (single-active-timer discipline, 30-60s clamp range) is proven intact, not merely assumed
- Zero-knowledge boundary re-verified: neither new pv-ui file imports any crypto-surface symbol (wasm/argon2/chacha/hkdf/derive/decrypt/prf)
- Zero-duplication re-verified: no non-shim `detectCardBrand`/`copyWithAutoClear` function definition survives anywhere in `web/src` or `extension/lib` outside `packages/pv-ui`

## Task Commits

1. **Task 1: pv-ui/vault/cardBrand.ts + pv-ui/clipboard.ts (canonical move) + web shims** - `72d8487` (feat)
2. **Task 2: extension shims + zero-knowledge and zero-duplication grep checks** - `5ff573a` (feat)

## Files Created/Modified
- `packages/pv-ui/vault/cardBrand.ts` - CardBrand type + detectCardBrand(), moved verbatim from web
- `packages/pv-ui/clipboard.ts` - CLIPBOARD_SECONDS_KEY/DEFAULT/MIN/MAX consts, clampClipboardSeconds(), readClipboardSeconds(), copyWithAutoClear(), moved verbatim from web (single-active-timer discipline preserved exactly)
- `web/src/lib/vault/cardBrand.ts` - reduced to `export * from "pv-ui/vault/cardBrand";` shim
- `web/src/lib/clipboard.ts` - reduced to `export * from "pv-ui/clipboard";` shim
- `extension/lib/vault/cardBrand.ts` - reduced to `export * from "pv-ui/vault/cardBrand";` shim (obsolete "mirror-not-cross-import" comment removed)
- `extension/lib/clipboard.ts` - reduced to `export * from "pv-ui/clipboard";` shim (obsolete "mirror-not-cross-import" comment removed)

## Decisions Made
- Both modules moved byte-for-byte with no logic changes — matched the plan's must_haves exactly, since both were independently verified at planning time to be byte-identical/comment-only-diff between web and extension.
- No architectural deviation: this plan's `packages/pv-ui/package.json` exports map and `web/tsconfig.json` path aliases for `pv-ui/vault/*` and `pv-ui/clipboard` were already present from an earlier plan in this phase (16-01), so no package.json/tsconfig edits were needed here.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fresh worktree missing node_modules, WASM glue, and WXT-generated types**
- **Found during:** Task 1 verification (`npx tsc --noEmit` in web failed on missing `./wasm/pv_wasm.js`)
- **Issue:** The fresh git worktree had no `node_modules` in either `web/` or `extension/`, no built WASM glue (gitignored artifacts), and a stale WXT-generated `PublicPath` type after the WASM binary appeared under `web/public/wasm/`.
- **Fix:** Ran `npm install` in `web/` and `extension/` (extension's `postinstall` also ran `wxt prepare`), then `bash scripts/build-wasm.sh` to produce both packages' WASM glue/binaries, then `npx wxt prepare` again in `extension/` to regenerate the `PublicPath` type now that `public/wasm/pv_wasm_bg.wasm` exists.
- **Files modified:** None of this plan's `files_modified` — all outputs (`node_modules/`, `web/src/lib/crypto/wasm/`, `web/public/wasm/`, `extension/lib/crypto/wasm/`, `extension/public/wasm/`, `extension/.wxt/`) are gitignored build/dependency artifacts, confirmed via `git status --short` showing no tracked changes from these commands.
- **Verification:** `web`'s `npx tsc --noEmit` and `extension`'s `npx tsc --noEmit` both clean after the fix.
- **Committed in:** N/A (no trackable file changes — gitignored artifacts only)

**2. [Rule 3 - Blocking] Environment `grep -r` on stdin reads cwd instead of the pipe**
- **Found during:** Task 2 verification (running the plan's literal `grep -riE '...'` piped-verify command)
- **Issue:** This environment's `/usr/bin/grep` (BSD grep 2.6.0), when given `-r` with no FILE operand while reading from a pipe, silently ignores stdin and recursively searches the current working directory instead — producing a massive false-positive match list unrelated to the actual pv-ui files being checked.
- **Fix:** Ran the equivalent verification logic without the redundant `-r` flag on the second (stdin-reading) grep in each pipeline (`grep -iE` instead of `grep -riE`, `grep -v` unchanged) — semantically identical check, correct in this environment.
- **Files modified:** None (verification-only, no source changes).
- **Verification:** Both re-run checks (crypto-import scan of the 2 new pv-ui files; zero-duplication scan of `web/src`/`extension/lib`) returned empty as expected, confirming the plan's stated invariants hold.
- **Committed in:** N/A (verification-only)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking issues, both environment/tooling setup, neither touched plan `files_modified`)
**Impact on plan:** No scope creep — both fixes were required to run the plan's own verification commands in this fresh worktree/environment. No source logic changed as a result.

## Issues Encountered
- See Deviations above — both were environment setup/tooling quirks (fresh worktree missing build artifacts; BSD grep `-r`-on-stdin behavior), not code defects.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `packages/pv-ui/vault/cardBrand.ts` and `packages/pv-ui/clipboard.ts` are now available as canonical shared modules for Phase 17 (shared component & visual alignment), which builds `ItemIconTile` (the brand-badge consumer) on top of this.
- No blockers identified.

---
*Phase: 16-design-system-extraction-logic-types-i18n*
*Completed: 2026-07-20*

## Self-Check: PASSED

All 6 created/modified files found on disk; both task commits (`72d8487`, `5ff573a`) found in git log.
