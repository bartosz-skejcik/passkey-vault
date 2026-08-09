---
phase: 29-a-real-settings-page-shell-migration
plan: 02
subsystem: ui
tags: [react, useSyncExternalStore, i18n, vitest, honesty-fix]

requires:
  - phase: 29-01
    provides: "Real /settings route shell (unrelated files -- this plan is file-disjoint from 29-01/29-03 by design)"
provides:
  - "store.ts's hydrated signal (isItemsHydrated()/useItemsHydrated()) -- distinguishes a confirmed-post-unlock item count from an unknown/mid-hydration one, mirroring lib/crypto/index.ts's isUnlocked/subscribeLockState/useIsUnlocked shape exactly"
  - "ExportDialog.tsx's DEBT-02 disclosure: states the hidden-password export exposure honestly (disclose, never mask), gated so a confirmed-zero can never be claimed against an unhydrated store"
affects: [29-05]

tech-stack:
  added: []
  patterns:
    - "useSyncExternalStore singleton signal (module-level let + listener Set + hook) -- second instance of the pattern lib/crypto/index.ts established, reused verbatim for a second cross-component reactive concern (item hydration vs. lock state)"

key-files:
  created: []
  modified:
    - web/src/lib/vault/store.ts
    - web/src/lib/vault/store.test.ts
    - web/src/components/vault/ExportDialog.tsx
    - web/src/components/vault/ExportDialog.test.tsx
    - web/src/lib/i18n/dictionary.ts

key-decisions:
  - "hiddenPasswordCount is a tri-state (null | number), never collapsed to 0 while unconfirmed -- export-confirm's disabled={hiddenPasswordCount === null} is the actual correctness fix; the disclosure sentence is a byproduct of the same computation, not a separate control"
  - "Falsification test asserts BOTH the disabled confirm button AND the absent disclosure when useItemsHydrated() is false -- an absent disclosure alone is indistinguishable from a genuine n=0, so the disabled button is what proves 'unknown' rather than 'confirmed zero'"

patterns-established:
  - "Second useSyncExternalStore singleton in store.ts (hydrated), directly adjacent to the existing items/listeners state -- establishes that this file's singleton-signal shape is reusable per new cross-cutting boolean, not a one-off"

requirements-completed: []

coverage:
  - id: D1
    description: "store.ts exports isItemsHydrated()/useItemsHydrated(), mirroring isUnlocked's exact useSyncExternalStore shape; hydrated arms false on every unlock (before loadAndDecryptAll starts), flips true once loadAndDecryptAll resolves, and resets false on lock"
    requirement: "DEBT-02"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#hydration signal (isItemsHydrated/useItemsHydrated) -- 5 tests"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts -- full pre-existing suite (55 tests) stays green alongside the 5 new"
        status: pass
    human_judgment: false
  - id: D2
    description: "ExportDialog states the hidden-password export exposure honestly: n=0 renders no disclosure at all (never a placeholder), n>=1 renders the exact interpolated count as a second <p> inside the existing export-warning-banner alert (never a competing alert box); export-confirm is disabled while the count is unconfirmed so a confirm can never fire against an unhydrated/partial store"
    requirement: "DEBT-02"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ExportDialog.test.tsx#ExportDialog — DEBT-02 hidden-password disclosure -- n=0 absent / n=1 exact string / n=3 exact string / falsification (hydrated=false disables confirm AND withholds disclosure) -- 4 tests"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/ExportDialog.test.tsx -- 4 pre-existing tests (warning banner, JSON confirm, CSV confirm, cancel/backdrop) stay green with the store mock extended, not replaced"
        status: pass
      - kind: other
        ref: "grep -n \"toCsv.ts\\|toJson.ts\" web/src/components/vault/ExportDialog.tsx -- returns nothing, confirming no masking logic crept into the exporters"
        status: pass
    human_judgment: false
  - id: D3
    description: "The n=1 Polish grammar (\"1 wpisów\", matching the accepted account.deleteOwnerWarning \"1 member(s)\" no-plural-machinery convention) is acceptable to ship"
    requirement: "DEBT-02"
    verification: []
    human_judgment: true
    rationale: "Task 3's checkpoint (gate=blocking, checkpoint:human-verify) requires a live dev-server run with a real hidden_password-shared item and a human read of the rendered sentence -- this cannot be auto-approved (auto_advance/auto_chain both false in this session) and genuinely needs a human's grammar-acceptability call, not just a passing test. The exact interpolated string itself IS held-out-tested (D2's n=1 assertion proves the code renders the literal designed string); what remains is only the human sign-off on whether that string reads acceptably to ship."
duration: ~25min (Tasks 1-2; Task 3 checkpoint not yet run)
completed: 2026-08-10
status: blocked-on-checkpoint
---

# Phase 29 Plan 02: DEBT-02 Export Honesty Summary

**Hidden-password export disclosure (disclose, never mask) gated by a new `hydrated` signal that closes the async race where a confirmed-zero count could otherwise be silently claimed against an unhydrated store.**

## Performance

- **Duration:** ~25 min for Tasks 1-2 (374209a -> 6eb7959)
- **Tasks:** 2/3 complete (Task 3 is a `checkpoint:human-verify`, `gate="blocking"` -- not run in this session)
- **Files modified:** 5

## Accomplishments

- `store.ts` gained a `hydrated` signal (`isItemsHydrated()`/`useItemsHydrated()`) mirroring `lib/crypto/index.ts`'s `isUnlocked`/`subscribeLockState`/`useIsUnlocked` shape byte-for-byte: module-level `let` + listener `Set` + `useSyncExternalStore(subscribe, getSnapshot, () => false)`. Every unlock now arms `hydrated=false` as its FIRST statement (before `loadAndDecryptAll()` starts), flips `true` once that promise resolves, and every lock resets it to `false`.
- `ExportDialog.tsx` computes `hiddenPasswordCount` as a genuine tri-state (`null` while unconfirmed, a real number once hydrated) via `hydrated ? getItems().filter(isPasswordHidden).length : null` -- never collapsing "don't know yet" into a premature 0.
- The DEBT-02 disclosure renders as a second `<p data-testid="export-hidden-password-disclosure">` **inside** the existing `export-warning-banner` alert (never a competing second alert box), only when the count is confirmed `> 0`. At `n===0` (hydrated, genuinely zero) the sentence is entirely absent -- no placeholder, no "0 items" text.
- `export-confirm` is `disabled={hiddenPasswordCount === null}` -- the actual correctness fix this plan exists for, not just the sentence. A confirm click can never fire against an unconfirmed count.
- A falsification test proves the honesty-preserving property directly: with `useItemsHydrated()` mocked `false`, BOTH `export-confirm` is disabled AND the disclosure is absent -- closing the exact re-entry path (an absent disclosure alone being indistinguishable from a genuine n=0) that the plan's threat model (T-29-04) called out.
- `toCsv.ts`/`toJson.ts` are untouched -- grep-confirmed no new masking/disclosure logic crept into the exporters; the dialog, not the exporter, owns the statement.

## Task Commits

Each task was committed atomically:

1. **Task 1: hydrated signal in store.ts -- mirrors isUnlocked's exact useSyncExternalStore shape** - `374209a` (feat)
2. **Task 2: ExportDialog disclosure sentence + hydration gate + falsification test** - `6eb7959` (feat)
3. **Task 3 (checkpoint:human-verify, gate="blocking"): n=1 Polish grammar acceptable to ship** - NOT RUN. `auto_advance`/`_auto_chain_active` are both `false` in this session's `.planning/config.json`, so this checkpoint cannot be auto-approved. It requires a live `npm run dev` session with a real `hidden_password`-shared item and a human read of the rendered sentence -- genuinely needs a human grammar-acceptability call, not an automatable check. Deferred to the orchestrator/next session per the plan's own instruction, matching Plan 29-01's Task 3 precedent (also a `gate` checkpoint, signed off by the coordinator after the code was already committed).

**Plan metadata:** this SUMMARY.md commit itself (see below).

## Files Created/Modified

- `web/src/lib/vault/store.ts` - `hydrated`/`hydrationListeners` state + `isItemsHydrated()`/`useItemsHydrated()` exports; `subscribeLockState` callback now arms/resolves/resets the signal around the existing fire-and-forget `loadAndDecryptAll()` call
- `web/src/lib/vault/store.test.ts` - 5 new hydration-lifecycle tests (renderHook-based, mirrors `crypto/index.test.ts`'s own `useIsUnlocked()` coverage); full 60-test suite green
- `web/src/components/vault/ExportDialog.tsx` - `hiddenPasswordCount` tri-state computation, disclosure `<p>` inside the existing warning alert, `export-confirm`'s new `disabled` prop
- `web/src/components/vault/ExportDialog.test.tsx` - store mock extended with `useItemsHydrated` (defaults `true`, not replacing `getItems`/`getFolders`); 4 new tests (n=0/n=1/n=3/falsification) + 4 pre-existing tests, all green
- `web/src/lib/i18n/dictionary.ts` - `export.hiddenPasswordDisclosure` key, literal copy from 29-UI-SPEC.md's Copywriting Contract (pl/en)

## Decisions Made

- `hiddenPasswordCount` is `number | null`, never `0` while unconfirmed -- the disabled-confirm gate reads this tri-state directly (`=== null`), so the disclosure-render condition (`!== null && > 0`) and the gate condition (`=== null`) are two views of the same one computation, not two independently-maintained checks that could drift.
- The falsification test (Task 2's `behavior` spec) asserts both the disabled button and the absent disclosure in one test, per the plan's own reasoning: an absent disclosure alone is indistinguishable from a genuine `n===0`, so only the disabled-confirm assertion actually proves "unknown" rather than "confirmed zero" was reached.
- `interpolate(t("export.hiddenPasswordDisclosure"), { n: String(hiddenPasswordCount) })` -- matches this codebase's established convention (`OnboardingWizard.tsx`, `ImportWizard.tsx`) of passing `n` as a string; `interpolate`'s own `hasAnyToken` fallback (pv-ui `engine.ts`) makes the mocked-`t`-returns-bare-key test convention (`"export.hiddenPasswordDisclosure 1"`) work identically to every other interpolated string in this test suite.

## Deviations from Plan

None - plan executed exactly as written for Tasks 1-2.

## Issues Encountered

- **Fresh worktree bootstrap required** (same standing lesson as Plan 29-01). `web/node_modules`, `packages/pv-ui/node_modules`, `web/src/lib/crypto/wasm/*` (gitignored TS bindings), and `web/public/wasm/pv_wasm_bg.wasm` (gitignored real WASM binary) were all absent in this fresh git worktree. Resolved via `rsync` from the main checkout before any `vitest`/`tsc` command could run -- not a code change, no commit. Without the WASM-binary bootstrap specifically, the 8 `*.real-wasm.test.ts` files fail with `ENOENT`; without it the plan's own scoped test files (which mock `@/lib/vault/store`'s crypto dependencies) still pass, but the plan's `<verification>` section explicitly requires a full `npm test` run, which needed the complete bootstrap.
- No other issues -- both tasks' `<verify>` commands (`npx vitest run` on each file) passed on the first implementation attempt; no auto-fix iterations were needed.

## Known Stubs

None -- no data source was stubbed. `hiddenPasswordCount`'s `null` state is a genuine tri-state signal, not a stub value.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **This plan is NOT fully complete.** Tasks 1-2 (the code + the falsification test that is the actual honesty fix) are committed and verified. Task 3 -- a `checkpoint:human-verify` with `gate="blocking"` -- requires a live `npm run dev` session, a real `hidden_password`-shared item, and a human judgment call on whether "1 wpisów" reads acceptably to ship. `auto_advance`/`_auto_chain_active` are both `false` in this session's config, so this checkpoint cannot be auto-approved per the standard checkpoint protocol; it must be surfaced to the orchestrator/user.
- Per 29-01-SUMMARY.md's own note: "VALIDATION.md's second manual-only item (accepting '1 wpisów' grammar) is explicitly deferred to close together with Plan 29-02's disclosure work" -- this checkpoint is that closure point. It also closes 29-UI-SPEC.md's two open backstops (E5 loading/partial -- closed by Tasks 1-2's code + falsification test; E5 grammar -- pending this checkpoint).
- Plan 29-05 (live e2e run) is the next consumer: 29-UI-SPEC.md's SC4 requires a byte-level proof that a real generated export file contains the `password` field for every `hidden_password`-level item, matching what this plan's dialog states -- that live/file-byte assertion was explicitly out of scope for this plan (unit-test-only claims are not sufficient per Non-Negotiable #2) and is Plan 29-05's job.
- This plan is file-disjoint from Plan 29-03 (`page.tsx`, `Sidebar.tsx`, `SettingsPanel.*`) by design -- no interaction expected, no scope overlap found during execution.

---
*Phase: 29-a-real-settings-page-shell-migration*
*Completed: 2026-08-10 (Tasks 1-2; Task 3 checkpoint pending)*

## Self-Check: PASSED

- All 5 modified files confirmed present on disk (`ls`, batch-verified): `web/src/lib/vault/store.ts`, `web/src/lib/vault/store.test.ts`, `web/src/components/vault/ExportDialog.tsx`, `web/src/components/vault/ExportDialog.test.tsx`, `web/src/lib/i18n/dictionary.ts`.
- Both task commit hashes (`374209a`, `6eb7959`) confirmed present in `git log --oneline`.
- Scoped test run: `web/src/lib/vault/store.test.ts` + `web/src/components/vault/ExportDialog.test.tsx` -- 68/68 green (60 + 8).
- Full web vitest suite: 836/836 green (81 test files), after WASM-binary bootstrap.
- `npx tsc --noEmit`: clean, zero errors, after the same bootstrap.
