---
phase: 32-putting-things-into-shared-folders
plan: 03
subsystem: infra
tags: [clippy, rust, lint, sqlx, rustdoc]

requires: []
provides:
  - "cargo clippy --workspace --all-targets -- -D warnings exits 0, workspace-wide"
affects: [32-01, 32-02, 32-04]

tech-stack:
  added: []
  patterns:
    - "Helper functions taking `tx: &mut sqlx::SqliteConnection` are called with `&mut tx`, not `&mut *tx` — reserve the explicit deref only for direct `sqlx::query(...).fetch_*/execute(...)` calls, which clippy's explicit_auto_deref does not flag."
    - "Doc comments must never start a line with a token CommonMark reads as an ordered-list marker (`1)`, `1.`) unless a real list is intended — rustdoc's Markdown parser (via clippy::doc_lazy_continuation) treats unindented following lines as broken list continuations."

key-files:
  created: []
  modified:
    - crates/pv-server/src/routes/vault.rs
    - crates/pv-provider/src/ceremony.rs
    - crates/pv-provider/tests/response_shape.rs

key-decisions:
  - "Fixed a third doc_lazy_continuation site in crates/pv-provider/tests/response_shape.rs (not named in the plan) under deviation Rule 3 — it only became visible once the ceremony.rs fix let pv-provider's lib target compile far enough for clippy to reach its test target, exactly the 'residue hiding behind a failing lib build' scenario the plan's own measurement had ruled out for everywhere else."

requirements-completed: [DEBT-04]

coverage:
  - id: D1
    description: "cargo clippy --workspace --all-targets -- -D warnings exits 0, workspace-wide"
    requirement: "DEBT-04"
    verification:
      - kind: other
        ref: "cargo clippy --workspace --all-targets -- -D warnings (exit 0)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Zero behavior change — cargo test --workspace --no-fail-fast passes identically before and after"
    requirement: "DEBT-04"
    verification:
      - kind: other
        ref: "cargo test --workspace --no-fail-fast: 393 passed, 0 failed (stashed pre-fix baseline and post-fix run, byte-identical counts)"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-08-19
status: complete
---

# Phase 32 Plan 03: DEBT-04 clippy cleanup Summary

**Workspace-wide `cargo clippy --workspace --all-targets -- -D warnings` now exits 0 via three purely-mechanical, zero-behavior-change fixes: 19 `&mut *tx` -> `&mut tx` sites in `vault.rs`, and two `doc_lazy_continuation` reflows in `pv-provider`'s doc comments.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 1 planned task, completed with one in-scope deviation
- **Files modified:** 3

## Accomplishments

- `cargo clippy --workspace --all-targets -- -D warnings` exits 0 (was: 28 error lines — 19 `explicit_auto_deref` + 6 `doc_lazy_continuation` + 3 "could not compile" summaries).
- `vault.rs`'s 19 flagged call sites into this file's own tx-taking helpers (`resolve_recipients`, `resolve_collection_members`, `bump_collection_revision`, `bump_recipients_vault_revision`, `bump_direct_share_revision`, `claim_item_bucket_edit_in_tx`) now pass `&mut tx` instead of `&mut *tx`. The other 28 `&mut *tx` occurrences in the file (passed directly to `sqlx::query(...).fetch_*/execute(...)`, an `impl Executor`-generic method clippy does not flag) are untouched, exactly as scoped.
- `ceremony.rs`'s EXT-10 doc comment reflowed so a line-initial `1)` (originally split across two lines as "...EXT-10 Task\n/// 1) confirms...") is no longer misread by rustdoc's Markdown parser as an ordered-list marker. Content and meaning unchanged.
- **Deviation (Rule 3, in-scope):** a third `doc_lazy_continuation` site in `crates/pv-provider/tests/response_shape.rs:193-195` was fixed — a real Markdown list (`- bytes 0..32: ...`) immediately followed by a plain paragraph with no blank line, read as an unindented continuation of the list's last item. Added one blank `///` line, per clippy's own first suggested fix ("if this is supposed to be its own paragraph, add a blank line"). This site was invisible to every prior measurement (RESEARCH.md, plan-check) because `pv-provider`'s lib target failed to compile on the ceremony.rs errors, which suppressed clippy from ever reaching the crate's test target — fixing ceremony.rs unblocked the lib, which then let clippy reach and flag this test file for the first time.
- Zero behavior change confirmed directly, not just asserted: stashed the fix, ran `cargo test --workspace --no-fail-fast` on the pristine pre-fix tree (393 passed, 0 failed), popped the stash, ran it again post-fix (393 passed, 0 failed) — identical pass counts, same test names.

## Task Commits

1. **Task 1: DEBT-04 — cargo clippy --workspace --all-targets -- -D warnings exits 0** - `c57e9ff` (fix)

_No separate plan-metadata commit yet — this SUMMARY/STATE/ROADMAP commit is the final commit for this plan (see `<final_commit>` below)._

## Files Created/Modified

- `crates/pv-server/src/routes/vault.rs` - 19 `&mut *tx` -> `&mut tx` at helper call sites (explicit_auto_deref)
- `crates/pv-provider/src/ceremony.rs` - EXT-10 doc comment reflowed to remove an accidental line-initial `1)` list marker (doc_lazy_continuation)
- `crates/pv-provider/tests/response_shape.rs` - one blank `///` line added between a real Markdown list and the following paragraph (doc_lazy_continuation, deviation)

## Decisions Made

- Fixed the `response_shape.rs` doc_lazy_continuation site under deviation Rule 3 (auto-fix blocking issue) rather than treating it as out of scope: it directly blocks the task's `<done>` criterion ("`cargo clippy --workspace --all-targets -- -D warnings` exits 0, workspace-wide"), is the exact same mechanical lint class the plan already authorized fixing in `ceremony.rs`, and required no behavior change (doc-comment only).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Third `doc_lazy_continuation` site in `response_shape.rs`, not named by the plan**
- **Found during:** Task 1, second verification pass (after the ceremony.rs fix let `pv-provider`'s lib compile far enough for clippy to reach its test target for the first time)
- **Issue:** `crates/pv-provider/tests/response_shape.rs:193-195` — a real Markdown list (WebAuthn `authenticatorData` byte-offset bullets) is immediately followed by a plain paragraph with no blank line separating them, so rustdoc's parser reads the paragraph as an unindented (and therefore invalid) continuation of the list's last bullet.
- **Fix:** Inserted one blank `///` line between the list and the following paragraph — clippy's own first suggested remedy. Content and meaning unchanged.
- **Files modified:** `crates/pv-provider/tests/response_shape.rs`
- **Verification:** `cargo clippy --workspace --all-targets -- -D warnings` moved from erroring on this site to exit 0; `cargo test --workspace --no-fail-fast` unaffected (doc-comment-only change).
- **Committed in:** `c57e9ff` (part of the task commit)

---

**Total deviations:** 1 auto-fixed (Rule 3).
**Impact on plan:** Necessary to actually satisfy the plan's own acceptance criterion (workspace-wide clippy exit 0) — the plan's 25-error/28-line count was accurate for everything *reachable* by clippy at measurement time, but the lib-build failure it was measured against was itself masking one more site in a downstream test target. No scope creep beyond DEBT-04 itself.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

`vault.rs` is now clippy-clean and un-conflicting for 32-01 (wave 2), which per 32-VALIDATION.md's wave serialization (32-PLAN-CHECK.md B-5) was blocked from running concurrently with this plan specifically to avoid racing a half-applied clippy sweep against `web/playwright.config.ts`'s live `cargo build --release -p pv-server`. This plan's completion clears that gate. No blockers for 32-01.

---
*Phase: 32-putting-things-into-shared-folders*
*Completed: 2026-08-19*

## Self-Check: PASSED

All modified files and the task commit (`c57e9ff`) verified present on disk / in git log.
