---
phase: 11-generate-capture
fixed_at: 2026-07-16T14:24:00Z
review_path: .planning/phases/11-generate-capture/11-REVIEW.md
iteration: 2
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 11: Code Review Fix Report (Iteration 2)

**Fixed at:** 2026-07-16T14:24:00Z
**Source review:** .planning/phases/11-generate-capture/11-REVIEW.md
**Iteration:** 2

**Summary:**
- Findings in scope: 1 (WR-01 — critical_warning scope; 0 Critical findings this iteration; IN-01..IN-04 were out of scope)
- Fixed: 1
- Skipped: 0

## Fixed Issues

### WR-01: WR-03 fix is cosmetic — `ensureHydrated()` does not hydrate the item cache, so the duplicate-item window remains open

**Files modified:** `extension/entrypoints/background/vault-store.ts`, `extension/entrypoints/background/router.ts`, `extension/entrypoints/background/vault-store.test.ts`, `extension/entrypoints/background/router-capture.test.ts`
**Commit:** `7b48ba7`
**Applied fix:** The iteration-1 WR-03 fix added `await ensureHydrated()` before `getItems()`/`classifySubmit` in `handleCaptureProposeMessage`, but `ensureHydrated()` only re-derives the User Key — it never touches `vault-store`'s `items` array, which is populated exclusively and asynchronously by `applySyncSnapshot()` via `ensureVaultSyncStarted()`'s `getSyncSnapshot(0)` pull. On a freshly-woken/idle-killed service worker, this left a real window where `capture.propose` could classify an already-saved credential as `'new'` while the initial pull was still in flight, and `confirmNewLogin` (which does not re-classify) would then persist a duplicate item.

Implemented option (a) from the review's Fix section: `vault-store.ts` now exposes `ensureItemsHydrated(): Promise<{ ok: true } | { ok: false; error: unknown }>`, built on a new `initialPullSettled` promise that `ensureVaultSyncStarted()` populates from its `getSyncSnapshot(0)` call. `ensureItemsHydrated()` is single-flight and idempotent (concurrent callers share the same in-flight promise; a burst of `capture.propose` calls during a wake window triggers exactly one pull) and is reset to `null` on every lock so a re-unlock always awaits a fresh pull, never a stale prior-session promise. `router.ts`'s `handleCaptureProposeMessage` now calls `await ensureItemsHydrated()` after `ensureHydrated()` and, per the review's explicit ask to think through the failure path: **fails closed** (`{ action: "no-op", mismatch: true }`) when the pull itself failed, on the reasoning that a failed pull leaves the cache state genuinely *unknown* — treating it as "confirmed empty" would reproduce the exact bug this fix closes. This mirrors the existing locked-branch and rejected-sender fail-closed shapes already used in this handler, so it introduces no new response variant.

`confirmNewLogin`/`confirmUpdateLogin` (`capture-handler.ts`) were deliberately left unchanged — with propose now correctly gated, the classification `confirm` trusts is already correct by the time the user acts on it; adding a second, redundant hydration re-check at confirm time (the review's option (c)) was assessed as unnecessary duplication once option (a) closes the gap at its source.

**Residual (documented, not fixed this pass):** `handleAutofillMatch`/`handleMatchFrame` (`autofill-match.ts`/`autofill-frame.ts`) have the structurally identical `ensureHydrated()`-then-`getItems()` pattern and the same empty-cache window on a freshly-woken SW. Per the review's own severity note, their failure mode is read-only (missing autofill suggestions, user retries) — not a persisted duplicate item — so it was intentionally left unfixed this pass rather than widening this single-finding commit's blast radius across two more production files and their two test suites (`autofill-match.test.ts`, `autofill-frame.test.ts`), which do not currently mock `vault-store`'s new `ensureItemsHydrated` export. Recommended as a small, low-risk follow-up (add the same `await ensureItemsHydrated()` call plus the corresponding mock/test updates) rather than bundling it into this fix.

**Regression tests (non-vacuous):**
- `router-capture.test.ts`: two new tests — one simulates the exact race (a mid-flight `ensureItemsHydrated()` resolving to a populated cache after `getItems()` would otherwise have been called against an empty one) and asserts `classifySubmit` receives the settled items array (`action: "update"`, not `"new"`); the other asserts the typed pull-failure path fails closed to `no-op` without calling `classifySubmit`. Both **verified to fail** against the pre-fix `router.ts` (temporarily reverted the `ensureItemsHydrated()` call, re-ran the suite, confirmed both new tests failed with the expected assertion errors), then restored and re-confirmed green.
- `vault-store.test.ts`: four new tests for `ensureItemsHydrated()` itself — resolves only after the pull settles with items populated by then, single-flight (concurrent callers share one `getSyncSnapshot(0)` call), typed `{ok:false}` on pull failure, and a re-unlock after lock awaits a fresh pull rather than a stale settled promise.
- Existing CR-01/WR-03(iteration-1)/rejected-sender tests in `router-capture.test.ts` were updated to account for the new `ensureItemsHydrated` call in the happy path and to assert it is *not* called on the already-covered locked/rejected-sender fail-closed branches.

## Skipped Issues

None — the single in-scope finding was fixed.

## Verification

Run inside an isolated git worktree (`gsd-reviewfix/11-*`), with `node_modules` (rebuilt as per-package symlinks into the main working tree rather than one wholesale symlink, so the `pv-ui` workspace package resolves to the worktree's own copy instead of the main tree's — needed to avoid a Vite `fs.deny` false failure on 6 unrelated test files that import `packages/pv-ui/tokens.css`), `.wxt/` (generated types), and `lib/crypto/wasm/` (gitignored WASM build artifacts) copied/symlinked in so the suite/build could run unmodified:

- `npx vitest run` — **397/397 tests passed** (40 test files), up from the iteration-1 exit state (362 tests) plus 6 new regression tests across `router-capture.test.ts` (+2) and `vault-store.test.ts` (+4). One pre-existing, unrelated unhandled rejection in `App.test.tsx`/`ServerConfigView.tsx` (confirmed present identically on the unmodified main working tree) — out of this review's scope, not introduced by this change.
- `npx tsc --noEmit` — **clean**, no errors in any modified or new file (two pre-existing, unrelated errors from the initial `.wxt`/wasm-artifact-missing worktree state were resolved by copying in those gitignored build outputs from the main tree, not by any source change).
- `npx wxt build -b chrome` and `npx wxt build -b firefox` — **both succeeded**, producing valid `chrome-mv3` and `firefox-mv2` packaged builds.

The fix was regression-tested by temporarily reverting the `router.ts` change (removing the `ensureItemsHydrated()` await and its no-op-on-failure branch) and confirming both new `router-capture.test.ts` tests failed with the exact assertion mismatches the bug predicts, then restoring the fix and confirming the full suite returned to green — not just "test exists," but "test actually catches the bug."

---

_Fixed: 2026-07-16T14:24:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
