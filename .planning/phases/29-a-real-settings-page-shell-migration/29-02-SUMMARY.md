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
  - "ExportDialog.tsx's DEBT-02 disclosure: states the hidden-password export exposure honestly (disclose, never mask), gated so a confirmed-zero can never be claimed against an unhydrated store, worded so the count never governs a noun in either locale (correct at every n, zero plural-selection machinery)"
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
    - .planning/phases/29-a-real-settings-page-shell-migration/29-UI-SPEC.md

key-decisions:
  - "hiddenPasswordCount is a tri-state (null | number), never collapsed to 0 while unconfirmed -- export-confirm's disabled={hiddenPasswordCount === null} is the actual correctness fix; the disclosure sentence is a byproduct of the same computation, not a separate control"
  - "Falsification test asserts BOTH the disabled confirm button AND the absent disclosure when useItemsHydrated() is false -- an absent disclosure alone is indistinguishable from a genuine n=0, so the disabled button is what proves 'unknown' rather than 'confirmed zero'"
  - "Task 3 resolution (2026-08-10, Bartek delegated the call): rewrote export.hiddenPasswordDisclosure in BOTH locales so {n} stands alone as a trailing count and never governs a noun, instead of shipping '1 wpisów' (grammatically incorrect Polish at n=1). Rejected adding a plural-selection helper -- this codebase has never had one, and introducing it here would become the precedent every future counted string gets measured against. The existing account.deleteOwnerWarning '1 member(s)' debt is explicitly NOT propagated into this security-adjacent dialog and stays as recorded, separate debt. The EN copy needed the identical fix (\"{n} such items\" would have produced \"1 such items\", the same bug in the other language) -- both locales now trail {n} as a standalone count."
  - "A genuine held-out copy-pinning test was added (not merely 'updated') -- the plan's original n=1/n=3 component tests render through a mocked useLocale().t (identity function returning the bare key), so they never actually exercised the real dictionary string; they'd have passed unchanged regardless of what the real PL/EN copy said. The new test imports the real (unmocked) dictionary + interpolate() and asserts the exact literal string at n=1 and n=2, in both locales -- this is what actually pins the wording against silent drift."

patterns-established:
  - "Second useSyncExternalStore singleton in store.ts (hydrated), directly adjacent to the existing items/listeners state -- establishes that this file's singleton-signal shape is reusable per new cross-cutting boolean, not a one-off"
  - "Held-out copy-pinning test pattern: import the real, unmocked i18n module directly (bypassing a file's own mocked useLocale) to assert an interpolated string's exact literal output -- closes a class of test that looks like it verifies copy but, under a mocked-t convention, only verifies call arguments"

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
        ref: "web/src/lib/vault/store.test.ts -- full suite (60 tests) green"
        status: pass
    human_judgment: false
  - id: D2
    description: "ExportDialog states the hidden-password export exposure honestly: n=0 renders no disclosure at all (never a placeholder), n>=1 renders the interpolated count as a second <p> inside the existing export-warning-banner alert (never a competing alert box); export-confirm is disabled while the count is unconfirmed so a confirm can never fire against an unhydrated/partial store"
    requirement: "DEBT-02"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ExportDialog.test.tsx#ExportDialog — DEBT-02 hidden-password disclosure -- n=0 absent / n=1 / n=3 / falsification (hydrated=false disables confirm AND withholds disclosure) -- 4 tests"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/ExportDialog.test.tsx -- 4 pre-existing tests (warning banner, JSON confirm, CSV confirm, cancel/backdrop) stay green with the store mock extended, not replaced"
        status: pass
      - kind: other
        ref: "grep -n \"toCsv.ts\\|toJson.ts\" web/src/components/vault/ExportDialog.tsx -- returns nothing, confirming no masking logic crept into the exporters"
        status: pass
    human_judgment: false
  - id: D3
    description: "export.hiddenPasswordDisclosure is grammatically correct in both pl and en at every n (n=1 included), with zero plural-selection machinery -- closed by construction via a reworded string where {n} never governs a noun, per Bartek's delegated Task 3 decision (option 1: reword, do not add plural-selection logic, do not ship '1 wpisów')"
    requirement: "DEBT-02"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ExportDialog.test.tsx#export.hiddenPasswordDisclosure copy (held-out, real dictionary — pins wording against silent drift) -- pl and en, each asserting the exact literal string at n=1 and n=2 -- 2 tests"
        status: pass
    human_judgment: false
duration: ~40min
completed: 2026-08-10
status: complete
---

# Phase 29 Plan 02: DEBT-02 Export Honesty Summary

**Hidden-password export disclosure (disclose, never mask), gated by a new `hydrated` signal that closes the async race where a confirmed-zero count could otherwise be silently claimed against an unhydrated store, worded so the count never governs a noun in either locale.**

## Performance

- **Duration:** ~40 min (374209a -> final commit)
- **Tasks:** 3/3 complete
- **Files modified:** 6 (5 code/test + 1 planning doc)

## Accomplishments

- `store.ts` gained a `hydrated` signal (`isItemsHydrated()`/`useItemsHydrated()`) mirroring `lib/crypto/index.ts`'s `isUnlocked`/`subscribeLockState`/`useIsUnlocked` shape byte-for-byte: module-level `let` + listener `Set` + `useSyncExternalStore(subscribe, getSnapshot, () => false)`. Every unlock now arms `hydrated=false` as its FIRST statement (before `loadAndDecryptAll()` starts), flips `true` once that promise resolves, and every lock resets it to `false`.
- `ExportDialog.tsx` computes `hiddenPasswordCount` as a genuine tri-state (`null` while unconfirmed, a real number once hydrated) via `hydrated ? getItems().filter(isPasswordHidden).length : null` -- never collapsing "don't know yet" into a premature 0.
- The DEBT-02 disclosure renders as a second `<p data-testid="export-hidden-password-disclosure">` **inside** the existing `export-warning-banner` alert (never a competing second alert box), only when the count is confirmed `> 0`. At `n===0` (hydrated, genuinely zero) the sentence is entirely absent -- no placeholder, no "0 items" text.
- `export-confirm` is `disabled={hiddenPasswordCount === null}` -- the actual correctness fix this plan exists for, not just the sentence. A confirm click can never fire against an unconfirmed count.
- A falsification test proves the honesty-preserving property directly: with `useItemsHydrated()` mocked `false`, BOTH `export-confirm` is disabled AND the disclosure is absent -- closing the exact re-entry path (an absent disclosure alone being indistinguishable from a genuine n=0) that the plan's threat model (T-29-04) called out.
- `toCsv.ts`/`toJson.ts` are untouched -- grep-confirmed no new masking/disclosure logic crept into the exporters; the dialog, not the exporter, owns the statement.
- **Task 3 resolved:** the disclosure copy was reworded in both `pl` and `en` so `{n}` stands alone as a trailing count and never governs a noun -- grammatically correct at every `n`, including `n=1`, with zero plural-selection machinery introduced. A held-out test now pins the real (unmocked) dictionary string exactly, at `n=1` and `n=2`, in both locales.

## Task Commits

Each task was committed atomically:

1. **Task 1: hydrated signal in store.ts -- mirrors isUnlocked's exact useSyncExternalStore shape** - `374209a` (feat)
2. **Task 2: ExportDialog disclosure sentence + hydration gate + falsification test** - `6eb7959` (feat)
3. **Task 3 (checkpoint:human-verify, gate="blocking"): n=1 Polish grammar** - RESOLVED. Bartek delegated the call ("you decide"); resolution was **option 1: reword so the count never governs the noun**, not option 2 (ship "1 wpisów" as accepted debt) or a new plural-selection helper. Both locales' copy reworded; held-out test added pinning the real dictionary string; `29-UI-SPEC.md`'s Copywriting Contract and UI Considerations backstop table updated to match. See commit below.

**Plan metadata:** this SUMMARY.md commit (see below).

## Files Created/Modified

- `web/src/lib/vault/store.ts` - `hydrated`/`hydrationListeners` state + `isItemsHydrated()`/`useItemsHydrated()` exports; `subscribeLockState` callback now arms/resolves/resets the signal around the existing fire-and-forget `loadAndDecryptAll()` call
- `web/src/lib/vault/store.test.ts` - 5 new hydration-lifecycle tests (renderHook-based, mirrors `crypto/index.test.ts`'s own `useIsUnlocked()` coverage); full 60-test suite green
- `web/src/components/vault/ExportDialog.tsx` - `hiddenPasswordCount` tri-state computation, disclosure `<p>` inside the existing warning alert, `export-confirm`'s new `disabled` prop
- `web/src/components/vault/ExportDialog.test.tsx` - store mock extended with `useItemsHydrated` (defaults `true`, not replacing `getItems`/`getFolders`); 4 gating/render tests (n=0/n=1/n=3/falsification) + 2 held-out real-dictionary copy tests (pl/en, n=1 and n=2 each) + 4 pre-existing tests, all green
- `web/src/lib/i18n/dictionary.ts` - `export.hiddenPasswordDisclosure` key, reworded copy (Task 3 resolution) where `{n}` never governs a noun in either locale
- `.planning/phases/29-a-real-settings-page-shell-migration/29-UI-SPEC.md` - Copywriting Contract row updated to the shipped copy; the E5 grammar-at-every-`n` UI Considerations row moved from `🧪 backstop` to `✅ covered`; aggregate backstop/covered counts and the "Planner note" updated to match (38 covered / 2 backstop, was 37/3)

## Decisions Made

- `hiddenPasswordCount` is `number | null`, never `0` while unconfirmed -- the disabled-confirm gate reads this tri-state directly (`=== null`), so the disclosure-render condition (`!== null && > 0`) and the gate condition (`=== null`) are two views of the same one computation, not two independently-maintained checks that could drift.
- The falsification test (Task 2's `behavior` spec) asserts both the disabled button and the absent disclosure in one test, per the plan's own reasoning: an absent disclosure alone is indistinguishable from a genuine `n===0`, so only the disabled-confirm assertion actually proves "unknown" rather than "confirmed zero" was reached.
- `interpolate(t("export.hiddenPasswordDisclosure"), { n: String(hiddenPasswordCount) })` -- matches this codebase's established convention (`OnboardingWizard.tsx`, `ImportWizard.tsx`) of passing `n` as a string.
- **Task 3: rewording over plural-selection logic.** Bartek delegated the n=1 grammar call. Decision: reword `export.hiddenPasswordDisclosure` in both locales so `{n}` trails as a standalone count clause ("liczba takich wpisów: {n}" / "{n} in total") rather than governing a noun ("{n} wpisów" / "{n} items"). Rationale recorded: this is correct at every `n` with zero machinery, and avoids introducing the codebase's first plural-selection helper -- a precedent every future counted string would then be measured against. `account.deleteOwnerWarning`'s existing "1 member(s)" debt is deliberately left as-is, not propagated into this security-adjacent dialog. The EN copy got the identical fix, since "{n} such items" would reproduce the same bug in English.
- **Held-out test gap closed.** The plan's original design called for "a held-out test asserting the exact interpolated string at n=1" as a backstop-closing proof. The component-level tests (which render through a mocked `useLocale().t` identity stub) never actually exercised the real dictionary string -- they'd pass unchanged regardless of the real copy. A new test block imports the real, unmocked `@/lib/i18n/dictionary` module directly and asserts the exact literal output of `interpolate(t(locale, key), {n})` at `n=1`/`n=2` in both `pl`/`en` -- this is what genuinely pins the wording against silent drift, closing the backstop by construction rather than by human read.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's own held-out copy test, as originally implemented, didn't test the real copy**
- **Found during:** Addressing Task 3's coordinator message (the rewording work surfaced that the existing n=1/n=3 assertions render through a mocked `t` identity stub, so they verify call arguments, not the actual dictionary string)
- **Issue:** `ExportDialog.test.tsx`'s `vi.mock("@/lib/i18n/LocaleContext", ...)` stubs `t` as `(key) => key`; `interpolate()`'s own fallback (append value when the template has no `{token}`) means the component-level n=1/n=3 assertions (`"export.hiddenPasswordDisclosure 1"`) would pass identically no matter what the real `pl`/`en` copy said -- they never actually pinned the shipped wording, contradicting the plan's own stated purpose for that test ("asserted by a held-out test").
- **Fix:** Added a new, separate test block that imports the real (unmocked) `@/lib/i18n/dictionary` module's `t`/`interpolate` directly and asserts the exact literal interpolated string at `n=1` and `n=2`, in both locales -- 2 new tests. The original mocked-component tests were left unchanged (they still validate the render-gating logic correctly: absence at n=0, presence/testid at n>=1, falsification), since that's a genuinely different and still-needed concern from copy-pinning.
- **Files modified:** `web/src/components/vault/ExportDialog.test.tsx`
- **Verification:** New tests pass against the real dictionary; a manual sanity check confirmed they would fail if the dictionary string were reverted to the old "{n} wpisów" shape (the interpolated "1" would land mid-word instead of trailing the sentence).
- **Committed in:** (this plan's Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 Rule-1 bug, found while executing the coordinator's Task 3 instructions -- a test that looked like it verified copy but, under the file's own mocked-t convention, only verified call arguments).
**Impact on plan:** Necessary correctness fix for exactly the guarantee the backstop was supposed to provide. No scope creep -- same file, same concern (DEBT-02 grammar/copy correctness).

## Issues Encountered

- **Fresh worktree bootstrap required** (same standing lesson as Plan 29-01). `web/node_modules`, `packages/pv-ui/node_modules`, `web/src/lib/crypto/wasm/*` (gitignored TS bindings), and `web/public/wasm/pv_wasm_bg.wasm` (gitignored real WASM binary) were all absent in this fresh git worktree. Resolved via `rsync` from the main checkout before any `vitest`/`tsc` command could run -- not a code change, no commit.
- No other issues -- both code tasks' `<verify>` commands passed on the first implementation attempt; no other auto-fix iterations were needed.

## Known Stubs

None -- no data source was stubbed. `hiddenPasswordCount`'s `null` state is a genuine tri-state signal, not a stub value.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **This plan is fully complete.** All 3 tasks resolved: Tasks 1-2's code + falsification test, and Task 3's grammar rework + held-out copy proof, per Bartek's delegated decision.
- Plan 29-05 (live e2e run) is the next consumer: 29-UI-SPEC.md's SC4 requires a byte-level proof that a real generated export file contains the `password` field for every `hidden_password`-level item, matching what this plan's dialog states -- that live/file-byte assertion was explicitly out of scope for this plan (unit-test-only claims are not sufficient per Non-Negotiable #2) and is Plan 29-05's job. Plan 29-05 will also render the actual disclosure sentence in a real browser for the first genuine visual confirmation of the reworded copy (this plan's proof was unit-test-level: the exact literal string, not a rendered screenshot).
- This plan is file-disjoint from Plan 29-03 (`page.tsx`, `Sidebar.tsx`, `SettingsPanel.*`) by design -- no interaction expected, no scope overlap found during execution.

---
*Phase: 29-a-real-settings-page-shell-migration*
*Completed: 2026-08-10*

## Self-Check: PASSED

- All 6 modified files confirmed present on disk (`ls`, batch-verified): `web/src/lib/vault/store.ts`, `web/src/lib/vault/store.test.ts`, `web/src/components/vault/ExportDialog.tsx`, `web/src/components/vault/ExportDialog.test.tsx`, `web/src/lib/i18n/dictionary.ts`, `.planning/phases/29-a-real-settings-page-shell-migration/29-UI-SPEC.md`.
- All task commit hashes confirmed present in `git log --oneline` (see Task Commits above).
- Scoped test run: `web/src/lib/vault/store.test.ts` + `web/src/components/vault/ExportDialog.test.tsx` -- 70/70 green (60 + 10).
- Full web vitest suite: 838/838 green (81 test files), after WASM-binary bootstrap.
- `npx tsc --noEmit`: clean, zero errors.
