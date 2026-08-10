---
phase: 30-the-living-group-family-wide-sharing
plan: 05
subsystem: sharing
tags: [react, vitest, i18n, family-wide-sharing, re-key, toast]

requires:
  - phase: 30-the-living-group-family-wide-sharing
    provides: "30-01's additive schema (family_wide_kind, invitation_family_wide_keys) and FSH-02 decision record"
provides:
  - "FAM-10/FSH-04 regression proof: family-wide collections flow through buildMemberRemovalBatch unmodified"
  - "collections.ts sealed_key-change detector (onCollectionRekeyed registry)"
  - "FamilyRekeyNotice quiet toast component, mounted nowhere yet (see Deviations)"
  - "share.familyRekeyNotice i18n key (PL/EN)"
affects: [phase-33-family-surface, phase-34-visibility-inventory]

tech-stack:
  added: []
  patterns:
    - "Module-private sealed_key snapshot (lastSealedKeys Map) diffed on every refreshCollections pass, separate listener registry from the existing collections-changed subscription"
    - "Singleton toast via single boolean component state (no queue) -- simpler than CopyToast's stateful object since content is generic and event-driven, not per-copy"

key-files:
  created:
    - web/src/lib/families/rekey.test.ts
    - web/src/lib/vault/collections.test.ts
    - web/src/components/vault/FamilyRekeyNotice.tsx
    - web/src/components/vault/FamilyRekeyNotice.test.tsx
  modified:
    - web/src/lib/vault/collections.ts
    - web/src/lib/i18n/dictionary.ts

key-decisions:
  - "FamilyRekeyNotice is NOT mounted in web/src/app/page.tsx in this plan -- page.tsx is outside this plan's files_modified and the parallel-wave file-disjointness boundary; mounting is a one-line follow-up for whichever plan next touches page.tsx."
  - "collections.test.ts uses vi.resetModules() + a fresh dynamic import per test to isolate the module-private lastSealedKeys singleton between test cases (mirrors store.test.ts's own pattern) -- the singleton is intentionally NOT cleared on lock, so a re-key that happens while the vault is locked is still detected on the next unlock's refresh."

patterns-established:
  - "Rekey-notice registry: a SEPARATE Set<listener> from the existing collections-changed listeners, firing per-event (with the changed collection's id) rather than on every refresh -- reusable if a future phase needs a second per-event notification channel off this store."

requirements-completed: [FSH-04, FAM-10]

coverage:
  - id: D1
    description: "A family-wide collection flows through buildMemberRemovalBatch exactly like an ordinary shared collection, proven by a targeted regression test"
    requirement: "FAM-10"
    verification:
      - kind: unit
        ref: "web/src/lib/families/rekey.test.ts#(a) a family-wide collection produces a CollectionRekeyBatch entry..."
        status: pass
      - kind: unit
        ref: "web/src/lib/families/rekey.test.ts#(b) an ordinary and a family-wide collection both appear in the batch..."
        status: pass
    human_judgment: false
  - id: D2
    description: "collections.ts detects an already-known collection's sealed_key changing on refresh and fires a dedicated rekey-notice callback, never for a brand-new grant"
    requirement: "FSH-04"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/collections.test.ts#(1) fires exactly once, with the collection's id..."
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/collections.test.ts#(2) does NOT fire when a refresh returns a collection id not previously present..."
        status: pass
    human_judgment: false
  - id: D3
    description: "FamilyRekeyNotice renders a quiet, singleton, non-auto-hiding, accessible toast per 30-UI-SPEC.md's Re-Key Notice Contract"
    requirement: "FSH-04"
    verification:
      - kind: unit
        ref: "web/src/components/vault/FamilyRekeyNotice.test.tsx#(3) a second rekey event for a DIFFERENT collection while the notice is showing REPLACES it..."
        status: pass
      - kind: unit
        ref: "web/src/components/vault/FamilyRekeyNotice.test.tsx#never carries a warning/error DaisyUI class"
        status: pass
    human_judgment: true
    rationale: "The component is built and unit-tested but not yet mounted anywhere in the app (see Deviations) -- a human/orchestrator must confirm the eventual mount point renders it correctly in the real app shell before this is genuinely end-to-end verified."

duration: 12min
completed: 2026-08-10
status: complete
---

# Phase 30 Plan 05: Family-Wide Re-Key Proof and Quiet Notice Summary

**FAM-10 closed by regression test (not new mechanism) plus a new sealed_key-change detector and quiet FamilyRekeyNotice toast reusing CopyToast's exact shell**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-08-10T13:26:00+02:00 (approx.)
- **Completed:** 2026-08-10T13:38:00+02:00 (approx.)
- **Tasks:** 2
- **Files modified:** 6 (2 modified, 4 created)

## Accomplishments
- Proved by test (not inspection) that `buildMemberRemovalBatch` needs zero modification for family-wide collections: a family-wide-flagged collection produces an identical `CollectionRekeyBatch` entry to an ordinary collection, and two collections (one ordinary, one family-wide) both appear in the same batch, in `access.collections`' own order, with no differing treatment.
- Added a sealed_key-change detector to `collections.ts`: a new `onCollectionRekeyed` registry, separate from the existing collections-changed listener set, fires only when an already-known collection's raw `sealed_key` blob changes value between two refreshes -- never for a brand-new grant (a newcomer receiving their first key is not a re-key).
- Built `FamilyRekeyNotice.tsx`, a quiet toast reusing `CopyToast.tsx`'s exact visual shell (`toast toast-end toast-bottom`, 320px, `rounded-field border border-base-300 bg-base-100 p-3 text-sm`) per 30-UI-SPEC.md's Re-Key Notice Contract: `role="status" aria-live="polite"`, no `warning`/`error` styling, no auto-hide timer, singleton replace-not-stack behavior.
- Added the `share.familyRekeyNotice` i18n key (PL/EN, 30-UI-SPEC.md copy verbatim).

## Task Commits

Each task was committed atomically:

1. **Task 1: FAM-10 regression -- family-wide collection flows through buildMemberRemovalBatch** - `ac2bde3` (test)
2. **Task 2: quiet re-key notice -- sealed_key-change detection + toast** - `753563b` (feat)

_Note: Task 2's commit (`753563b`) also contains uncommitted changes to `crates/pv-server/src/routes/families.rs`, `crates/pv-server/src/routes/mod.rs`, `crates/pv-server/tests/family.rs`, and `crates/pv-server/tests/membership_route_sweep.rs` that this executor did not author -- see "Critical: Shared-Worktree Git Contamination" under Deviations below._

## Files Created/Modified
- `web/src/lib/families/rekey.test.ts` - New FAM-10/FSH-04 regression test (mocked-crypto lane), proves `buildMemberRemovalBatch` treats a family-wide collection identically to an ordinary one
- `web/src/lib/vault/collections.ts` - New `onCollectionRekeyed` registry + `lastSealedKeys` module-private snapshot, diffed on every `refreshCollections` pass
- `web/src/lib/vault/collections.test.ts` - New mocked-lane test for the sealed_key-change detector (fires on change, never on a brand-new id, never when unchanged)
- `web/src/components/vault/FamilyRekeyNotice.tsx` - New quiet toast component
- `web/src/components/vault/FamilyRekeyNotice.test.tsx` - New test: shows on event, singleton replace-not-stack, dismiss button, no warning/error class, unsubscribes on unmount
- `web/src/lib/i18n/dictionary.ts` - Added `share.familyRekeyNotice` (PL/EN)

## Decisions Made
- **FamilyRekeyNotice is not mounted anywhere in the app yet.** 30-UI-SPEC.md's contract and the task's own `<action>` text say to mount it "near this app's existing toast-mounting root (wherever `CopyToast` itself is mounted)" -- that is `web/src/app/page.tsx`. This plan's frontmatter `files_modified` list does not include `page.tsx`, and the parallel-execution instructions for this wave explicitly bound me to my own `files_modified` and forbid editing files outside it (to preserve the wave's verified file-disjointness). No sibling 30-0x plan in this wave touches `page.tsx` either, so it remains unmounted after this plan. This is recorded as a Known Stub below, not silently shipped.
- Chose a single boolean `visible` state (not a per-event object) for `FamilyRekeyNotice`'s own local state, since the notice's content is always the same generic string regardless of which collection triggered it -- this trivially satisfies "singleton, replace-not-stack" without needing an explicit replace-vs-stack code path.
- `lastSealedKeys` (the sealed_key snapshot used for diffing) is deliberately NOT cleared on lock, unlike `collectionKeys` (the unwrapped WASM key cache). A re-key that happens while the vault is locked should still be detected and surfaced on the next unlock's refresh; only the unwrapped key material has the T-26-10 zeroize-on-lock obligation, not this plain-string bookkeeping map.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Symlinked `web/node_modules` from the main repo checkout**
- **Found during:** Task 1 (running `<verify>` for the first time)
- **Issue:** This worktree had no `node_modules` at all -- `npx vitest` failed immediately with `Cannot find module 'vitest/config'`. A fresh `npm install` was avoidable: `web/package-lock.json` in this worktree is byte-identical to the main repo checkout's.
- **Fix:** `ln -s /Users/j5on/.work/projects/passkey-vault/web/node_modules web/node_modules` (a symlink, not a copy). `node_modules/` is gitignored (`.gitignore:6`), so this never enters git history and is purely a local dev-environment convenience for running this plan's `<verify>` commands.
- **Files modified:** none tracked (symlink only, gitignored)
- **Verification:** `npx vitest run` resolved and ran successfully afterward.
- **Committed in:** not committed (gitignored, correctly)

### Not Auto-fixed -- Recorded as a Known Stub

**FamilyRekeyNotice is built and tested but not mounted in the app.** Per the Decisions section above, mounting requires editing `web/src/app/page.tsx`, which is outside this plan's `files_modified` and the parallel wave's file-disjointness boundary. A member's shared content being re-keyed will not visibly surface this notice to them until a follow-up plan (or the orchestrator, post-wave-merge) adds the one-line mount:
```tsx
import FamilyRekeyNotice from "@/components/vault/FamilyRekeyNotice";
// ...
<FamilyRekeyNotice />
```
placed alongside the existing `<CopyToast />`/`<ErrorToast />` mounts in `page.tsx`. This does not block FSH-04/FAM-10's own requirement text (the re-key mechanism itself is proven and the notice component is built and tested) but does mean the "sharer is told, quietly" user-facing promise is not yet wired end-to-end.

---

**Total deviations:** 1 auto-fixed (Rule 3, environment-only), 1 recorded stub (mount point out of this plan's scope)
**Impact on plan:** The environment fix was necessary to run any test in this worktree at all and has zero footprint on tracked files. The unmounted notice is a genuine scope boundary, not an oversight -- documented so a human/orchestrator can close it without re-deriving why it's missing.

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| `FamilyRekeyNotice` not mounted in the app shell | `web/src/app/page.tsx` (not modified by this plan) | Outside this plan's `files_modified`/parallel-wave file-disjointness boundary; no sibling 30-0x plan touches `page.tsx` either. One-line follow-up: `<FamilyRekeyNotice />` next to the existing `<CopyToast />`/`<ErrorToast />` mounts. |

## Issues Encountered

**Critical: Shared-worktree git contamination during Task 2's commit.** This worktree (`worktree-agent-af58c128a4dade4ae`) showed clear evidence of a concurrently-running process performing its own `git add`/`git commit` cycles in the SAME working directory and git index while this plan executed:
- The worktree-branch-check at the start of this run confirmed `HEAD == 4e668fc86642ab5b0e9c44abe0a16d0d1ba9ea18` (the expected base).
- Partway through this plan's Task 1, `git log` showed a NEW commit, `6d5c1b3 feat(30-02): family_wide_kind on collection create/get/list`, had landed on top of that base -- on this exact branch -- without this executor creating it.
- Through Task 2, `git status --short` repeatedly showed unstaged modifications accumulating to `crates/pv-server/src/routes/families.rs`, `crates/pv-server/src/routes/mod.rs`, `crates/pv-server/tests/family.rs`, and `crates/pv-server/tests/membership_route_sweep.rs` -- files this executor never touched and that are not in this plan's `files_modified`.
- This executor staged ONLY its own 5 intended files (`git add web/src/lib/vault/collections.ts web/src/lib/vault/collections.test.ts web/src/components/vault/FamilyRekeyNotice.tsx web/src/components/vault/FamilyRekeyNotice.test.tsx web/src/lib/i18n/dictionary.ts`) and confirmed via `git status --short` immediately afterward that only those 5 were staged. Between that `git add` and the subsequent `git commit`, the other process's changes to the four Rust files apparently got staged too (by that other process), and `git commit` -- which commits the full index, not merely the paths named in the preceding `git add` -- absorbed them into `753563b` alongside this plan's own Task 2 work.

**Resolution taken:** None destructive. Per the destructive-git-prohibition (`git reset --hard`, interactive rebase, and amending a non-hook-failed commit are all out of bounds), and because the other process appeared to still be actively running, this executor did NOT attempt to split, revert, or amend `753563b`. The code itself is not lost -- it is fully present in git history -- but commit `753563b`'s message and authorship narrative (`feat(30-05): ...`) does not accurately describe roughly half its diff (the four Rust files belong to plan 30-02, not 30-05). **The orchestrator should verify, after this wave completes, that plan 30-02's own executor's final commit set is not now empty/redundant for those four files, and reconcile attribution if needed** (e.g. via a follow-up commit-message note, or accepting that the code is correctly present just under the wrong commit's narrative). This executor's own two commits (`ac2bde3`, `753563b`) are otherwise complete and correct for this plan's own scope.

For all subsequent commits, if any, this executor switched to re-verifying `git status --short` and the current branch immediately before each `git commit` invocation to minimize (though not eliminate, given the underlying tooling behavior) further contamination risk.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- FAM-10/FSH-04's re-key path and quiet-notice mechanism are both proven and built. The only remaining wiring gap is the one-line `<FamilyRekeyNotice />` mount in `page.tsx` (see Known Stubs) -- any subsequent plan touching `page.tsx` (or a dedicated small follow-up) can close this immediately.
- **Flag for the orchestrator:** this worktree exhibited live concurrent git activity from what appears to be another wave-2 executor (30-02) sharing the same directory. If this recurs across waves, per-plan commit attribution and the "verified file-disjoint" wave guarantee cannot be trusted from git history alone -- worth investigating at the orchestrator/harness level before the next parallel wave.

---
*Phase: 30-the-living-group-family-wide-sharing*
*Completed: 2026-08-10*

## Self-Check: PASSED

- FOUND: web/src/lib/families/rekey.test.ts
- FOUND: web/src/lib/vault/collections.ts
- FOUND: web/src/lib/vault/collections.test.ts
- FOUND: web/src/components/vault/FamilyRekeyNotice.tsx
- FOUND: web/src/components/vault/FamilyRekeyNotice.test.tsx
- FOUND: web/src/lib/i18n/dictionary.ts
- FOUND commit: ac2bde3
- FOUND commit: 753563b
