---
phase: 25-member-removal-suspension-re-key
plan: 09
subsystem: ui
tags: [react, next.js, typescript, i18n, daisyui]

# Dependency graph
requires:
  - phase: 25-member-removal-suspension-re-key
    plan: "25-06"
    provides: "DELETE /api/auth/account (owner-dissolution / plain-member re-key / no-family cascade) + GET /api/families (families::get)"
  - phase: 25-member-removal-suspension-re-key
    plan: "25-07"
    provides: "families/api.ts client (getFamilyMembers/getFamily), families/rekey.ts (buildMemberRemovalBatch), and all 45 Phase 25 i18n dictionary keys"
provides:
  - "families/api.ts: deleteAccount(collections) -> DELETE /api/auth/account"
  - "DeleteAccountDialog.tsx (new): two-step confirm, owner/member/no-family branching (E6), honest owner-dissolution warning with real family name + member count"
  - "SecurityTab.tsx: 'Delete account' section (row-neutral trigger, renders for every account type)"
affects: [25-10-live-e2e-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DeleteAccountDialog resolves the caller's own role client-side (mirrors FamilyTab.tsx's resolveOwnership pattern) purely to pick step-1 copy -- the server independently re-derives the real branch via resolve_family_role (Plan 25-06), so a client-side misclassification only changes which copy renders, never which server-side branch executes (T-25-23, carried from the plan's own threat_model)."
    - "Owner-warning family-name interpolation renders the family name in its own truncate+title span (not the whole sentence) via a local renderOwnerWarning helper, rather than the shared interpolate() -- the sentence itself must never truncate (it carries the phase's other hard honesty requirement), only the variable-length family-name substring."

key-files:
  created:
    - web/src/components/settings/DeleteAccountDialog.tsx
    - web/src/components/settings/DeleteAccountDialog.test.tsx
    - web/src/components/settings/SecurityTab.test.tsx
  modified:
    - web/src/lib/families/api.ts
    - web/src/components/settings/SecurityTab.tsx

key-decisions:
  - "Added a fail-closed 'error' top-level dialog state for the initial role-resolution fetch (Promise.all([getFamilyMembers(), me()])) failing, beyond what the plan's action text explicitly walks through. 25-UI-SPEC.md's E6 coverage table only names the deletion-submit error, not an initial-fetch error, but the plan's own internal state union literally lists \"error\" as a reachable value alongside the three step-1 branches -- leaving initial-fetch failure unhandled would either crash the component or force a guess at which branch's copy to show. Mirrors RemoveMemberDialog.tsx's 'blocked' precedent exactly (retry + cancel, no guessed branch), reusing the closest existing dictionary key (family.membersLoadFailed) rather than inventing a new one not present in the Copywriting Contract."
  - "Step 1's own 'Continue' affordance reuses member.removeStep1Continue verbatim (the plan's own text explicitly forbids inventing a new key here and directs reuse of an established sibling) -- the same key RemoveMemberDialog.tsx pairs with delete.cancel for the identical step1->step2 shape. account.deleteConfirm is reserved for step 2's FINAL confirm only, matching the Copywriting Contract's own table."
  - "renderOwnerWarning() is a small local helper, not a call to the shared interpolate() -- interpolate() returns a flat string, which cannot give the family-name substring its own truncate+title span without truncating (or risking mid-sentence truncation of) the whole safety-critical sentence. The helper also gracefully degrades under this codebase's identity-mocked t() component-test convention (no {family}/{count} tokens present), appending both values visibly rather than silently dropping them -- mirroring interpolate()'s own append-fallback philosophy."

requirements-completed: []  # FAM-10 deliberately left unmarked in this worktree,
  # per Plan 25-06's own established precedent for this same wave: requirement-
  # checkbox updates in REQUIREMENTS.md are the orchestrator's post-merge pass,
  # not an individual worktree agent's write.

coverage:
  - id: D1
    description: "account.deleteSectionHeading/deleteSectionBody/deleteTriggerCta render for every account type; the trigger button itself never branches"
    requirement: "FAM-10"
    verification:
      - kind: unit
        ref: "web/src/components/settings/SecurityTab.test.tsx -- 'Delete account section (E6)' describe block"
        status: pass
    human_judgment: false
  - id: D2
    description: "The delete-account dialog's confirm button shows disabled + a loading spinner during the request"
    requirement: "FAM-10"
    verification:
      - kind: unit
        ref: "web/src/components/settings/DeleteAccountDialog.test.tsx -- 'step 2 confirm shows disabled+spinner while deleting'"
        status: pass
    human_judgment: false
  - id: D3
    description: "account.deleteFailed renders inline on failure -- the dialog never silently closes"
    requirement: "FAM-10"
    verification:
      - kind: unit
        ref: "web/src/components/settings/DeleteAccountDialog.test.tsx -- 'on failure, renders account.deleteFailed inline, dialog stays open, sign-out never called'"
        status: pass
    human_judgment: false
  - id: D4
    description: "For an account with no family, only account.deleteStep1Body renders; account.deleteOwnerWarning never renders"
    requirement: "FAM-10"
    verification:
      - kind: unit
        ref: "web/src/components/settings/DeleteAccountDialog.test.tsx -- 'no-family branch renders step1 body but never account.deleteOwnerWarning'"
        status: pass
    human_judgment: false
  - id: D5
    description: "For a plain family member, only account.deleteStep1Body renders; account.deleteOwnerWarning never renders"
    requirement: "FAM-10"
    verification:
      - kind: unit
        ref: "web/src/components/settings/DeleteAccountDialog.test.tsx -- 'plain-member branch renders step1 body but never account.deleteOwnerWarning'"
        status: pass
    human_judgment: false
  - id: D6
    description: "For the family owner, BOTH account.deleteStep1Body and account.deleteOwnerWarning render, interpolating the REAL family name and REAL other-member count"
    requirement: "FAM-10"
    verification:
      - kind: unit
        ref: "web/src/components/settings/DeleteAccountDialog.test.tsx -- 'owner branch renders step1 body AND account.deleteOwnerWarning with the real family name and member count'"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/DeleteAccountDialog.test.tsx -- 'a long family name still renders truncate+title on the family-name span'"
        status: pass
    human_judgment: false
  - id: D7
    description: "Two-step forward-only pattern, Cancel at both steps, success signs the caller out via the exact clearSessionToken/clearStoredEmail/lockVault sequence Sidebar.tsx's handleLogout uses"
    requirement: "FAM-10"
    verification:
      - kind: unit
        ref: "web/src/components/settings/DeleteAccountDialog.test.tsx -- 'on success, calls clearSessionToken, clearStoredEmail, and lockVault in sequence'"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/DeleteAccountDialog.test.tsx -- 'step 2 Cancel returns to step 1 without re-fetching the branch', 'Cancel at step 1 closes the whole dialog'"
        status: pass
    human_judgment: false
  - id: D8
    description: "The plain-member branch builds a real batch via buildMemberRemovalBatch(ownUserId, ownUk) -- the SAME function RemoveMemberDialog uses, target = caller's own user id -- before submitting; owner/no-family submit an empty batch"
    requirement: "FAM-10"
    verification:
      - kind: unit
        ref: "web/src/components/settings/DeleteAccountDialog.test.tsx -- 'the plain-member branch builds a real batch via buildMemberRemovalBatch(ownUserId, ownUk) before submitting'"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/DeleteAccountDialog.test.tsx -- 'step 2's Confirm is the sole trigger for deleteAccount -- no-family branch submits an empty batch'"
        status: pass
    human_judgment: true
    rationale: "Per this plan's own evidentiary scope note: DeleteAccountDialog.test.tsx mocks both @/lib/crypto and @/lib/families/rekey wholesale (WR-10's documented Phase 24 structural blind spot). These tests prove branch-selection and state-machine correctness -- they are NOT proof that a real self-deletion genuinely re-keys owned collections end-to-end against a live server. That genuine evidence is Plan 25-07's rekey.real-wasm.test.ts (real crypto primitives, no mock) and Plan 25-10's live e2e (the whole real stack, not yet run at this plan's authoring time)."

# Metrics
duration: ~35min active work
completed: 2026-08-05
status: complete
---

# Phase 25 Plan 09: Delete Account (FAM-10) Summary

**`DeleteAccountDialog.tsx` gives every account a real, honest "Delete account" surface -- the owner sees an explicit warning naming their family and the real number of people who lose shared-folder access, a plain member's self-deletion silently re-keys their collections through the same `buildMemberRemovalBatch` path `RemoveMemberDialog` uses, and every branch signs the caller out via the codebase's one existing logout sequence on success.**

## Performance

- **Duration:** ~35 min active work (plus a one-time worktree bootstrap: `npm ci` for `web/` and `packages/pv-ui/`, and `scripts/build-wasm.sh` to produce `web/src/lib/crypto/wasm/pv_wasm.js` -- this worktree had no pre-built WASM artifacts or `node_modules`, same precedent Plans 25-07/25-08 documented in this same worktree)
- **Tasks:** 2/2 completed
- **Files modified:** 5 (3 new, 2 extended)

## Accomplishments

- `families/api.ts` gains `deleteAccount(collections: CollectionRekeyBatch[]): Promise<void>` -> `DELETE /api/auth/account`, matching Plan 25-06's `DeleteAccountRequest` wire shape exactly.
- `DeleteAccountDialog.tsx` (new): resolves the caller's own role client-side on mount (`Promise.all([getFamilyMembers(), me()])`, mirroring `FamilyTab.tsx`'s own `resolveOwnership` pattern) purely to select step-1 copy -- the server independently re-derives the real branch via `resolve_family_role` (Plan 25-06), so a client misclassification here can only change which copy is shown, never which server-side branch actually executes.
  - No-family and plain-member branches render `account.deleteStep1Body` alone.
  - Owner branch renders `account.deleteStep1Body` AND `account.deleteOwnerWarning` directly beneath it, interpolating the real family name (`getFamily()`, wrapped in its own `truncate`+`title` span) and the real other-member count (`members.length - 1`).
  - Step 2's Confirm is the sole trigger for the deletion call: plain-member branch builds a real re-key batch via `buildMemberRemovalBatch(ownUserId, ownUk)` (Plan 25-07's shared orchestration module, target = caller's own user id) before submitting; owner/no-family branches submit an empty batch, which the server ignores for those two cases.
  - On success: `clearSessionToken()`, `clearStoredEmail()`, `lockVault()` -- the exact sequence `Sidebar.tsx`'s `handleLogout` uses -- then `window.location.reload()` back to the unauthenticated shell. `logout()` itself is deliberately NOT called (the account and its session no longer exist server-side by the time this runs).
  - On failure: `account.deleteFailed` renders inline at step 2, dialog stays open, sign-out sequence never runs.
  - A fail-closed `error` state (not explicitly walked through in 25-UI-SPEC.md's E6 coverage table, but present in the plan's own literal internal-state union) handles the initial role-fetch failing outright -- retry + cancel, never a guessed branch.
- `SecurityTab.tsx` gains a "Delete account" section: `account.deleteSectionHeading`/`Body` + a row-neutral (`btn btn-ghost`, no error color at the row level) trigger button that mounts `DeleteAccountDialog` -- renders unconditionally for every account type, per the row-neutrality decision in 25-UI-SPEC.md's Color section.

## Task Commits

Each task was committed atomically:

1. **Task 1: DeleteAccountDialog -- two-step, owner/member/no-family branching (E6)** - `f070c68` (feat)
2. **Task 2: SecurityTab "Delete account" section** - `4d205d0` (feat)

**Plan metadata:** this commit (SUMMARY.md only, per worktree parallel-executor protocol -- STATE.md/ROADMAP.md/REQUIREMENTS.md are the orchestrator's own post-merge writes)

## Files Created/Modified

- `web/src/lib/families/api.ts` (extended) -- `deleteAccount(collections)`
- `web/src/components/settings/DeleteAccountDialog.tsx` (new) -- two-step confirm, owner/member/no-family branching
- `web/src/components/settings/DeleteAccountDialog.test.tsx` (new) -- 14 tests
- `web/src/components/settings/SecurityTab.tsx` (extended) -- "Delete account" section
- `web/src/components/settings/SecurityTab.test.tsx` (new -- no prior file existed for this component; its autolock/clipboard coverage previously lived only inside `SettingsPanel.test.tsx`'s migration-regression test) -- 5 tests

## Decisions Made

See `key-decisions` in frontmatter above for the full list. Highlights:
- Added a fail-closed `error` state for the initial role-resolution fetch failing, beyond what 25-UI-SPEC.md's E6 coverage table explicitly walks through -- required by the plan's own literal internal-state union already naming `"error"` as a reachable value, and consistent with `RemoveMemberDialog.tsx`'s identical fail-closed precedent.
- Step 1's "Continue" button reuses `member.removeStep1Continue` verbatim, per the plan's own explicit instruction not to invent a new key.
- `renderOwnerWarning()` is a small local helper (not the shared `interpolate()`) so the family name gets its own `truncate`+`title` span without truncating the surrounding safety-critical sentence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 -- blocking issue] `SecurityTab.test.tsx` did not exist in this codebase, though the plan's acceptance criteria assumed one did ("Existing `SecurityTab.test.tsx` suite... stays green")**
- **Found during:** Task 2, before writing any test code
- **Issue:** The plan's Task 2 acceptance criteria reads "Existing `SecurityTab.test.tsx` suite (autolock/clipboard assertions) stays green" -- but no such file exists anywhere in this repository. The component's autolock/clipboard persistence coverage lives instead inside `SettingsPanel.test.tsx`'s own migration-regression test (`"persists the autolock minutes under AUTOLOCK_MINUTES_KEY from the Security tab"`).
- **Fix:** Created `SecurityTab.test.tsx` fresh, covering both the pre-existing autolock/clipboard persistence behavior (adapted to test `SecurityTab` directly, in isolation) and the new Delete-account trigger/mount wiring this plan adds. `SettingsPanel.test.tsx`'s own coverage was left untouched (still passes, still exercises the same behavior through the full panel).
- **Files modified:** `web/src/components/settings/SecurityTab.test.tsx` (new)
- **Verification:** `npx vitest run src/components/settings/SecurityTab.test.tsx` (5/5 pass); `npx vitest run src/components/settings/SettingsPanel.test.tsx` (6/6 pass, unmodified); full `web` suite (65 files / 610 tests) green.
- **Committed in:** `4d205d0` (Task 2)

---

**Total deviations:** 1 auto-fixed (Rule 3 -- blocking issue: the plan's acceptance criteria referenced a test file that did not exist)
**Impact on plan:** No scope creep. The new file fills exactly the gap the plan's own acceptance criteria assumed was already closed, plus this plan's own new assertions -- nothing beyond what `must_haves` already require.

## Issues Encountered

**Worktree had no pre-built WASM artifacts or `node_modules`.** Same precedent as Plans 25-07/25-08 in this same worktree. Ran `scripts/build-wasm.sh` (with `PATH="/opt/homebrew/opt/rustup/bin:$PATH"` prepended, per this plan's own environment note) and `npm ci` in both `web/` and `packages/pv-ui/` before `npx tsc --noEmit` could resolve `./wasm/pv_wasm.js` cleanly. No source files touched by this bootstrap; only gitignored build/dependency artifacts generated.

## Known Stubs

None. Every branch (no-family, plain-member, owner) is a real, wired implementation calling real API functions -- no hardcoded empty values, no placeholder copy, no unwired data source.

## Evidentiary Scope Note (carried from this plan's own acceptance criteria)

This codebase's Vitest component tests mock `@/lib/crypto` and `@/lib/families/rekey` wholesale (WR-10's documented Phase 24 structural blind spot: a wholesale-mocked test file previously let a 100%-failure control ship green). `DeleteAccountDialog.test.tsx`'s 14 tests prove branch-selection logic, the honesty-copy interpolation (real family name + real member count rendered correctly), and the state-machine transitions -- they are **not** proof that a real self-deletion genuinely re-keys owned collections end-to-end against a live server, nor that `DELETE /api/auth/account` genuinely dissolves a family or re-keys collections server-side (that server-side proof is Plan 25-06's own `account_deletion.rs` integration tests, already passing). That real crypto-primitive evidence is Plan 25-07's `rekey.real-wasm.test.ts` (real WASM, no mock); the genuine whole-stack end-to-end proof is Plan 25-10's live e2e UAT, not yet run at this plan's authoring time. A verifier must not credit this plan's own component tests as standalone proof of FAM-10's real re-key behavior for the plain-member branch.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: mitigated-as-designed | `web/src/components/settings/DeleteAccountDialog.tsx` | T-25-22 (Repudiation, `account.deleteOwnerWarning` branch logic) closed exactly as specified: client-side branch resolution mirrors `FamilyTab.tsx`'s own established `resolveOwnership` pattern; component tests assert the warning never renders for the no-family or plain-member branches and always renders with the real interpolated family name + member count for the owner branch (`DeleteAccountDialog.test.tsx`'s "trigger visibility / branch resolution" describe block, 4 tests). |
| threat_flag: mitigated-as-designed | `web/src/components/settings/DeleteAccountDialog.tsx` | T-25-23 (Elevation of Privilege, client-declared branch vs. server-derived branch) closed exactly as specified: this dialog's client-side role resolution is used ONLY to select which copy renders (step 1's body/warning text) and which client-side batch-building path runs (`buildMemberRemovalBatch` vs. an empty array) -- the server (Plan 25-06's `account::delete_account`) independently re-derives the real branch via `membership::resolve_family_role`, keyed on the caller's own session, never a client-supplied field. A client-side misclassification (e.g. the initial fetch racing a role change) could at most cause this dialog to submit a needlessly-built (but harmless) batch to a branch that ignores it, or submit an empty batch to the member branch -- which the server-side `apply_member_removal_rekey` call would then reject or no-op on, never silently accept a wrong re-key. |
| threat_flag: mitigated-as-designed | `web/src/components/settings/DeleteAccountDialog.tsx` | T-25-SC (Tampering, npm/pip/cargo installs) -- accepted, carried from the plan's own threat_model: no new package-manager installs in this plan. |
| threat_flag: new-surface | `web/src/lib/families/api.ts` | `deleteAccount()` is a new, unauthenticated-on-the-client thin wrapper over an already-server-authorized route (`DELETE /api/auth/account`, `SessionUser`-gated, Plan 25-06) -- matching every other client function this phase added (Plan 25-07's `suspendMember`/`reinstateMember`/`removeMember`/etc.). This plan introduces no new client-side trust boundary; the server remains the sole enforcement point, per this codebase's standing zero-knowledge/server-authorizes-everything architecture. |
| threat_flag: new-surface | `web/src/components/settings/DeleteAccountDialog.tsx` | The `error` (initial role-fetch-failure) dialog state is new surface not named in the plan's own `<threat_model>` register -- added defensively (see Deviations/key-decisions) to avoid guessing a branch's copy when the underlying fetch fails. Fail-closed by construction (retry + cancel only, no submit path reachable from this state), so it introduces no new attack surface -- it is strictly more conservative than proceeding with an unresolved branch would have been. |

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- Every account type (owner, plain member, standalone) now has a real, wired "Delete account" surface -- FAM-10's client-side deliverable is complete, resting on Plan 25-06's already-proven server-side implementation.
- Plan 25-10's live e2e is the genuine end-to-end evidence for the plain-member branch's real re-key behavior through this specific UI surface (this plan's own component tests mock `@/lib/crypto`/`@/lib/families/rekey` wholesale, per the Evidentiary Scope Note above) -- not yet run at this plan's authoring time.
- No blockers. No stubs. Full `web` vitest suite (65 files / 610 tests) and `npx tsc --noEmit` both green after every task.

## Self-Check: PASSED

- `web/src/lib/families/api.ts` (deleteAccount) -- FOUND
- `web/src/components/settings/DeleteAccountDialog.tsx` -- FOUND
- `web/src/components/settings/DeleteAccountDialog.test.tsx` -- FOUND
- `web/src/components/settings/SecurityTab.tsx` ("Delete account" section) -- FOUND
- `web/src/components/settings/SecurityTab.test.tsx` -- FOUND
- Commit `f070c68` (feat: Task 1) -- FOUND in git log
- Commit `4d205d0` (feat: Task 2) -- FOUND in git log
- `cd web && npx tsc --noEmit` -- clean, zero errors
- `cd web && npx vitest run src/components/settings/DeleteAccountDialog.test.tsx src/components/settings/SecurityTab.test.tsx` -- 19/19 pass
- `cd web && npx vitest run` (full suite) -- 65 files / 610 tests, all green

---
*Phase: 25-member-removal-suspension-re-key*
*Plan: 09*
*Completed: 2026-08-05*
