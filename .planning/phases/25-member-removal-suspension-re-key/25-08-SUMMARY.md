---
phase: 25-member-removal-suspension-re-key
plan: 08
subsystem: ui
tags: [react, next.js, typescript, wasm, i18n, daisyui]

# Dependency graph
requires:
  - phase: 25-member-removal-suspension-re-key
    plan: "25-04"
    provides: "families.rs suspend_member/reinstate_member/members(status) server routes"
  - phase: 25-member-removal-suspension-re-key
    plan: "25-07"
    provides: "families/api.ts client (suspendMember/reinstateMember/removeMember/getMemberAccess), families/rekey.ts (buildMemberRemovalBatch/removeFamilyMember), crypto/index.ts (unsealCollectionKey/decryptItemForCollection re-exports), and all 45 Phase 25 i18n dictionary keys"
provides:
  - "FamilyTab.tsx: real Members roster (E1) reusing the existing bootstrap/invite fetch, no new network call"
  - "FamilyTab.tsx: suspended-member banner (E5) derived from the caller's own roster row every render"
  - "ConfirmDialog.tsx: severity prop (warning/error) + inline error prop, zero behavior change for SessionsTab's two existing callers"
  - "FamilyTab.tsx: Suspend (warning ConfirmDialog) + Reinstate (no dialog, per-row disable) wiring, both patching the row in place"
  - "RemoveMemberDialog.tsx (new): two-step remove confirmation resolving REAL folder/item names via unsealCollectionKey+decryptItemForCollection, honesty warning rendered unconditionally, dual-path item de-duplication at the higher access level"
affects: [25-09-delete-account-ui, 25-10-live-e2e-uat, 26-collections-browser]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RemoveMemberDialog resolves collection-scoped plaintext (folder enc_name AND item names) via decryptItemForCollection with per-folder try/catch degrading to a count-only fallback -- never a whole-dialog failure from one bad item/folder."
    - "Dual-path item de-duplication: an item id found inside BOTH a resolved folder's item list AND access.item_shares is spliced out of the folder's list and re-emitted once in the flat list, at max(folderAccessLevel, itemShareAccessLevel) via the same rank (read=0/hidden_password=1/edit=2) membership.rs's combine_access uses server-side."
    - "FamilyTab's three pre-existing normal-mode sub-cases (generated-invite display / non-owner notice / owner's invite form) are now one IIFE-computed `invitePanel` value, letting the new suspended banner + Members section render above all three without duplicating their JSX."

key-files:
  created:
    - web/src/components/settings/RemoveMemberDialog.tsx
    - web/src/components/settings/RemoveMemberDialog.test.tsx
  modified:
    - web/src/components/settings/FamilyTab.tsx
    - web/src/components/settings/FamilyTab.test.tsx
    - web/src/components/settings/ConfirmDialog.tsx

key-decisions:
  - "Added an optional `error?: string | null` prop to ConfirmDialog (Rule 2 auto-fix, beyond the plan's literal 'severity is the ONLY conditional change' framing): without it, there was no way for Suspend's failure message to render visibly INSIDE the dialog's own card -- a caller-thrown onConfirm only kept the dialog mounted with zero visible text, which technically satisfies 'never silently closes' but not 'renders inline in the Suspend dialog' (the must_have's actual, stronger requirement). Zero behavior change for SessionsTab's two existing callers, which never pass it."
  - "Dropped a personal-vault-store (`getItems()`) lookup for standalone (non-folder) `item_shares` entries that I had initially implemented -- importing `@/lib/vault/store` pulls in a module-level `subscribeLockState(...)` side effect that requires FAR more of `@/lib/crypto` mocked than this dialog's own test scope needs, and broke the existing FamilyTab.test.tsx's `@/lib/crypto` mock immediately on import. A standalone item_shares entry not reachable via any folder this dialog resolved is now always rendered with the honest `member.removeAccessItemsUnresolvedNote` fallback rather than attempting a resolution path the plan's action text never specified. See Known Limitations below."
  - "Collection name (`collection.enc_name`) decryption convention is my own inference, not established anywhere else in this codebase: `decryptItemForCollection(ck, collection.enc_name, collectionId, collectionId, 1)` -- self-referential item_id=collection_id, revision=1 fixed, mirroring `lib/vault/store.ts`'s `decryptFolderRow`'s exact `decryptItem(uk, row.enc_name, row.id, 1)` precedent for a personal folder's own never-revised name. No client-side code creates a collection's `enc_name` anywhere yet (Phase 26 owns collection authoring) so this convention is unverified against a real write path -- flagged for Phase 26 alignment."
  - "Collection ITEM decrypt revision defaults to 1 (the value every item is created at, per `vault.rs::create_item`'s 'always at revision 1' contract) since `GET /api/vault/collections/{id}/items` (Plan 25-03's `CollectionItemRow`) carries no per-item revision. An edited item (revision > 1) will fail this dialog's decrypt attempt and gracefully degrade to that ONE folder's unresolved-note fallback -- an accepted, honest limitation, not a crash."
  - "Split the plan's 3 tasks into 3 commits by FILE OWNERSHIP rather than strict task-number order (ConfirmDialog.tsx alone; RemoveMemberDialog.tsx+test alone; FamilyTab.tsx+test last), since Tasks 1/2/3's FamilyTab.tsx state/handlers/render were written as one coherent, interdependent edit sequence and Task 2/3 both require FamilyTab.tsx to import components from the other two commits. Each commit is independently buildable in the chosen order (ConfirmDialog and RemoveMemberDialog have no dependency on FamilyTab; FamilyTab depends on both already existing)."

requirements-completed: [FAM-07, FAM-08, FAM-09, UX-04]

coverage:
  - id: D1
    description: "FamilyTab's Members section (E1): real roster reusing the existing fetch, action-icon visibility gated to isOwner && not-self && not-owner-role, status badge only when suspended, youBadge for the caller's own row, email truncate+title"
    requirement: "FAM-07"
    verification:
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx -- 'Members section (E1, Task 1)' describe block (6 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Suspended-member banner (E5): alert-warning alert-soft above the member list, renders only when the caller's own row is suspended"
    requirement: "FAM-09"
    verification:
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx -- 'Suspended-member banner (E5, Task 1)' describe block (2 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "ConfirmDialog severity prop (warning-vs-error visual split) with zero behavior change for SessionsTab's two existing callers"
    verification:
      - kind: unit
        ref: "web/src/components/settings/SessionsTab.test.tsx (3/3 pass, unmodified)"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx -- 'Suspend opens a warning-severity ConfirmDialog'"
        status: pass
    human_judgment: false
  - id: D4
    description: "Suspend (E2): warning ConfirmDialog, busy spinner, success patches the row in place with no reload, failure renders member.suspendFailed inline without closing"
    requirement: "FAM-09"
    verification:
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx -- 'Suspend/Reinstate (E2/E3, Task 2)' describe block, Suspend tests"
        status: pass
    human_judgment: false
  - id: D5
    description: "Reinstate (E3): no confirmation dialog, per-row disable for request duration, success clears the badge immediately, failure surfaces member.reinstateFailed without stale state"
    requirement: "FAM-09"
    verification:
      - kind: unit
        ref: "web/src/components/settings/FamilyTab.test.tsx -- 'Suspend/Reinstate (E2/E3, Task 2)' describe block, Reinstate tests"
        status: pass
    human_judgment: false
  - id: D6
    description: "RemoveMemberDialog (E4): two-step state machine, fail-closed access-fetch error (no Continue), empty-list honesty warning, populated list with real resolved names, per-folder partial-resolution fallback without error styling, dual-path item de-duplication at the higher access level, step 2 Confirm as sole removal trigger"
    requirement: "FAM-08"
    verification:
      - kind: unit
        ref: "web/src/components/settings/RemoveMemberDialog.test.tsx (12/12 pass)"
        status: pass
    human_judgment: false
  - id: D7
    description: "member.removeHonestyWarning renders verbatim beneath the access list in every non-blocked state (empty and populated), never implying removal is retroactive"
    requirement: "UX-04"
    verification:
      - kind: unit
        ref: "web/src/components/settings/RemoveMemberDialog.test.tsx -- honesty-warning assertions in the empty-state and populated-state describe blocks"
        status: pass
    human_judgment: true
    rationale: "Automated tests confirm the exact dictionary string renders in the DOM in every reachable non-blocked state. Whether the copy itself reads as non-retroactive to a real user is a copywriting/UX judgment already locked by 25-UI-SPEC.md's Copywriting Contract (this plan consumed the string verbatim, did not author it) -- flagged human_judgment for completeness, not because the rendering is unproven."
  - id: D8
    description: "Real item-name resolution end-to-end (crypto layer) is NOT proven by this plan's own component tests -- they mock @/lib/crypto wholesale (the same WR-10 structural blind spot Phase 24 documented)"
    requirement: "UX-04"
    verification:
      - kind: integration
        ref: "web/src/lib/families/rekey.real-wasm.test.ts (Plan 25-07, 2/2 pass, zero vi.mock of @/lib/crypto) -- proves the underlying rewrap/unseal/decrypt primitives with real WASM, no mock"
        status: pass
    human_judgment: true
    rationale: "Per this plan's own acceptance-criteria evidentiary scope note: RemoveMemberDialog.test.tsx's resolved-name assertions run against a MOCKED unsealCollectionKey/decryptItemForCollection and prove the component's state machine + rendering logic, not that real decryption resolves real names against a live server. Plan 25-10's live e2e is the genuine end-to-end evidence; not yet run at authoring time."

# Metrics
duration: ~45min active work (plus a one-time worktree bootstrap: cargo build -p pv-wasm + wasm-bindgen, npm ci for web/ and packages/pv-ui, not part of plan execution -- this worktree had no pre-built WASM artifacts or node_modules)
completed: 2026-08-05
status: complete
---

# Phase 25 Plan 08: Member Removal/Suspension UI Summary

**`FamilyTab.tsx` gains a real Members roster with working Suspend/Reinstate actions and a suspended-member banner; a new `RemoveMemberDialog.tsx` delivers the two-step remove confirmation that discloses REAL folder/item names (decrypted client-side via unsealed CollectionKeys) and the non-negotiable UX-04 honesty warning, never a count-only placeholder.**

## Performance

- **Duration:** ~45 min active work (task execution) — plus a one-time worktree bootstrap (`scripts/build-wasm.sh` + `npm ci` for `web/` and `packages/pv-ui/`) required because this parallel-executor worktree had no pre-built WASM artifacts or `node_modules`
- **Tasks:** 3/3 completed
- **Files modified:** 5 (2 new, 3 extended)

## Accomplishments

- `FamilyTab.tsx`'s Members section (E1) renders every roster row from the SAME fetch `loadFamilyState` already performs (no new network call): email (truncate+title), role badge, joined date, status badge (suspended only), `family.youBadge` for the caller's own row, and action icons gated to `isOwner && not-self && not-owner-role`.
- `FamilyTab.tsx`'s suspended-member banner (E5) renders a persistent `alert alert-warning alert-soft` above the member list whenever the caller's own roster row is suspended, re-derived every render (no one-time toast).
- `ConfirmDialog.tsx` gains a `severity?: "error" | "warning"` prop (zero behavior change for `SessionsTab.tsx`'s two existing callers) and an `error?: string | null` prop (Rule 2 auto-fix) so Suspend's failure copy renders visibly inside the dialog rather than only preventing an unmount.
- Suspend opens the warning-severity `ConfirmDialog`; success patches the target row's status in place (no reload); failure surfaces `member.suspendFailed` inline without closing.
- Reinstate has no confirmation dialog (per `25-CONTEXT.md`'s "reversible, low-friction" framing), disables its own row button for the request duration, and patches the row on success; failure surfaces `member.reinstateFailed` without leaving the badge stale.
- `RemoveMemberDialog.tsx` (new): a two-step, fail-closed state machine (`loading-access → blocked | step1 → step2 → removing`). Step 1 fetches `getMemberAccess`, then for each reachable collection unseals its `CollectionKey` and decrypts REAL folder + item names via `decryptItemForCollection` (Plan 25-07's primitives, reused directly). Per-folder failures degrade gracefully to `member.removeAccessItemsUnresolvedNote` without blocking the rest of the dialog. `item_shares` entries merge into a folder's item map (max-of-two-grants access level, mirroring `membership.rs`'s `combine_access` rank) so a dual-path item appears exactly once, at its higher level. `member.removeHonestyWarning` renders unconditionally beneath the access list in every non-blocked state, including empty. Step 2's Confirm is the only trigger for `removeFamilyMember`.

## Task Commits

Each task was committed atomically:

1. **Task 2 (ConfirmDialog part): severity + inline error prop** - `75cd1c1` (feat)
2. **Task 3: RemoveMemberDialog — two-step confirm with real item-name disclosure** - `a1c7e0c` (feat)
3. **Tasks 1+2 (FamilyTab wiring): Members section, suspended banner, suspend/reinstate/remove wiring** - `c7a4fdf` (feat)

**Plan metadata:** SUMMARY.md commit (this file) — see below

_Note: commits are grouped by file ownership, not strict task-number order — see key-decisions above for why._

## Files Created/Modified

- `web/src/components/settings/ConfirmDialog.tsx` — `severity`/`error` props
- `web/src/components/settings/RemoveMemberDialog.tsx` (new) — two-step remove confirmation, real item-name resolution
- `web/src/components/settings/RemoveMemberDialog.test.tsx` (new) — 12 tests
- `web/src/components/settings/FamilyTab.tsx` — Members section, suspended banner, suspend/reinstate/remove wiring
- `web/src/components/settings/FamilyTab.test.tsx` — 17 new tests (40 total, all passing) + extended `FamilyMemberRecord` fixtures

## Decisions Made

See `key-decisions` in frontmatter above for the full list. Highlights:
- Added `ConfirmDialog`'s `error` prop beyond the plan's literal "severity is the ONLY conditional change" wording (Rule 2) — the must_have's actual requirement ("renders inline in the Suspend dialog") needed a visible mechanism that didn't exist.
- Dropped a `getItems()` (personal vault store) lookup I had initially written for standalone `item_shares` name resolution, after discovering it imports `@/lib/vault/store`'s module-level `subscribeLockState(...)` side effect and breaks existing test mocks. Standalone item_shares entries now always render the honest unresolved-note fallback.
- Inferred (unverified elsewhere in the codebase) that `collection.enc_name` decrypts via `decryptItemForCollection(ck, enc_name, collectionId, collectionId, 1)`, mirroring `decryptFolderRow`'s personal-folder precedent — flagged for Phase 26 alignment when real collection authoring lands.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] ConfirmDialog needed a visible error-rendering mechanism**
- **Found during:** Task 2
- **Issue:** The plan's action text describes ONLY a `severity` prop change to `ConfirmDialog.tsx` ("the ONLY conditional change"). But the must_have requires `member.suspendFailed` to "render inline in the Suspend dialog on failure — it never silently closes." Without any error-display capability, a caller-thrown `onConfirm` only prevented the dialog from unmounting (satisfying "never silently closes" in the weakest technical sense) with zero visible failure text — which fails the actual security-UX intent of a visible, non-silent failure.
- **Fix:** Added an optional `error?: string | null` prop, rendered as a `role="alert"` paragraph between the body and button row, defaulting to `null`/unused for existing callers.
- **Files modified:** `web/src/components/settings/ConfirmDialog.tsx`, `web/src/components/settings/FamilyTab.tsx`
- **Verification:** `SessionsTab.test.tsx` (3/3, unmodified assertions) stays green; new `FamilyTab.test.tsx` test asserts `confirm-dialog-error` renders `member.suspendFailed` and the dialog stays mounted.
- **Committed in:** `75cd1c1` (ConfirmDialog commit)

**2. [Rule 1 - Bug avoidance] Dropped a personal-vault-store lookup for item_shares resolution**
- **Found during:** Task 3, after first implementation attempt
- **Issue:** My initial implementation attempted to resolve a standalone (non-folder) `item_shares` entry's real name by looking it up in `@/lib/vault/store`'s `getItems()` (the caller's own decrypted personal vault). Importing that module pulls in its module-level `subscribeLockState(...)` side effect, which requires far more of `@/lib/crypto` to be mocked than either this dialog's own test scope or the EXISTING `FamilyTab.test.tsx` suite's `@/lib/crypto` mock provides — running the existing suite immediately failed with `No "subscribeLockState" export is defined on the "@/lib/crypto" mock`.
- **Fix:** Removed the `getItems()` import/lookup entirely. A standalone `item_shares` entry not reachable via any resolved folder is always rendered with the approved `member.removeAccessItemsUnresolvedNote` fallback (same string the per-folder partial-resolution case already uses) rather than attempting a resolution path the plan's action text never actually specified for this sub-case.
- **Files modified:** `web/src/components/settings/RemoveMemberDialog.tsx`
- **Verification:** Full `web` vitest suite (63 files / 591 tests) green after the fix; `npx tsc --noEmit` clean.
- **Committed in:** `a1c7e0c` (RemoveMemberDialog commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 2 — missing critical functionality, 1 Rule 1 — bug avoidance / scope correction)
**Impact on plan:** Both changes were necessary to ship a working, non-crash-prone dialog inside this plan's own declared file scope. No functionality beyond what the plan's `must_haves` already require; the second deviation is a scope NARROWING (removing an over-reach I introduced myself), not an addition.

## Known Limitations

- **Standalone `item_shares` entries never resolve a real name.** Per Deviation #2 above, an item reachable ONLY via a direct `item_shares` grant (not also inside a folder this dialog resolved) always shows the `member.removeAccessItemsUnresolvedNote` fallback, even in cases where the caller could theoretically decrypt it (e.g. it's their own personal item). This is an honest degrade (never a fabricated name, never a silently-omitted row), but it is a narrower resolution surface than the folder-nested case. Not flagged as a Known Stub because the fallback copy is the approved, locked dictionary string used exactly as the UI-SPEC's "genuine runtime resolution failure" framing describes it — but a future plan (likely Phase 26, once a client-side personal-item lookup exists that doesn't drag in `lib/vault/store.ts`'s sync side effects) could close this gap for real.
- **Collection item decrypt assumes revision=1.** `GET /api/vault/collections/{id}/items` carries no per-item revision (Plan 25-03's `CollectionItemRow`). An item edited since creation (revision > 1) will fail this dialog's decrypt attempt for that ONE item, degrading that item's whole folder to the count-only fallback — an accepted, honest limitation given the wire contract, not a crash.
- **Collection-name decryption convention is unverified against a real write path.** No client-side code anywhere in this repo creates a collection's `enc_name` yet (Phase 26 owns collection authoring) — the convention this plan infers (`decryptItemForCollection(ck, enc_name, collectionId, collectionId, 1)`, self-referential item_id=collection_id) should be confirmed or adjusted once Phase 26 ships the real creation path.

## Issues Encountered

**Worktree had no pre-built WASM artifacts or `node_modules`.** Same precedent as Plan 25-07 in this same worktree. Ran `scripts/build-wasm.sh` and `npm ci` in both `web/` and `packages/pv-ui/` before any task work could typecheck or run tests. No source files touched by this bootstrap; only gitignored build/dependency artifacts generated.

**Commit granularity note.** Tasks 1, 2, and 3's `FamilyTab.tsx` changes (state, handlers, render) were written as one coherent, interdependent edit pass rather than three separable diffs, since the Members section (Task 1), Suspend/Reinstate wiring (Task 2), and Remove-dialog mounting (Task 3) all live inside the same component's state machine. Committed as 3 commits split by FILE ownership instead (ConfirmDialog.tsx alone, RemoveMemberDialog.tsx+test alone, FamilyTab.tsx+test last) so each commit remains independently buildable in sequence — not a loss of atomicity, just a different split axis than "one commit per task number."

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: mitigated-as-designed | `web/src/components/settings/RemoveMemberDialog.tsx` | T-25-19 (Information Disclosure, disclosure list) closed exactly as specified: every item/folder name shown is resolved via the CALLER's own already-authorized decrypt path (their own unsealed CollectionKey for a collection they are a member of) — no new server data is exposed beyond what the owner could already decrypt via the existing collections API. `access.item_shares`' standalone (non-folder) entries never attempt a decrypt this dialog has no authorized key for; they render the honest unresolved fallback instead of ever attempting an unauthorized read. |
| threat_flag: mitigated-as-designed | `web/src/components/settings/RemoveMemberDialog.tsx` | T-25-20 (Repudiation, honesty-warning omission) closed: `member.removeHonestyWarning` renders unconditionally beneath the access list in every non-blocked state (empty included) — component tests assert its literal presence in both the empty-list and populated-list cases, closing the risk of a future refactor silently dropping it. |
| threat_flag: mitigated-as-designed | `web/src/components/settings/RemoveMemberDialog.tsx` | T-25-21 (Denial of Service (UI), per-folder name-resolution failure) closed: every folder's name decrypt and every item's decrypt is wrapped in its own try/catch, degrading that ONE folder to the count-only fallback without throwing past `resolveFolder` — proven by a component test asserting a resolved folder (col-A) and an unresolved folder (col-B) render adjacent in the same dialog render, with Continue staying enabled. |
| threat_flag: accepted | `web/src/components/settings/RemoveMemberDialog.tsx` | T-25-SC (Tampering, npm/pip/cargo installs) — no new package-manager installs in this plan; only existing dependencies imported. |
| threat_flag: new-surface | `web/src/components/settings/ConfirmDialog.tsx` | The new `error` prop (Deviation #1) is a purely presentational addition — it renders a caller-supplied string with no new data flow, no new fetch, and no new trust boundary. `SessionsTab.tsx`'s two existing callers never pass it (verified: their test suite's assertions are unmodified and still pass). |
| threat_flag: new-surface | `web/src/components/settings/RemoveMemberDialog.tsx` | This dialog is the FIRST client-side call site in this codebase (besides Plan 25-07's own test) that decrypts a `collections`-scoped `enc_name` at all — see Known Limitations' "unverified convention" note. Not a NEW cryptographic primitive (Phase 21 already shipped `decryptItemForCollection`), but a new, previously-untested USE of it. No server-side surface changes; purely a client-side read of already-authorized ciphertext. |

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `FamilyTab.tsx` now has a fully functional Members roster, Suspend/Reinstate actions, and Remove-member trigger wired to `RemoveMemberDialog.tsx` — Plan 25-09's `DeleteAccountDialog` (owned by `SecurityTab.tsx`) can follow the same two-step-dialog shape and reuse `buildMemberRemovalBatch` directly (target = caller's own user id), per `25-07-SUMMARY.md`'s "Next Phase Readiness" note.
- `ConfirmDialog.tsx`'s new `severity`/`error` props are available for any future dialog needing the same warning-vs-error split or inline failure text.
- Plan 25-10's live e2e is the genuine end-to-end evidence for UX-04's real-item-name resolution (this plan's own component tests mock `@/lib/crypto` wholesale, per the evidentiary scope note in coverage D8 above) — not yet run at this plan's authoring time.
- Known Limitations above (standalone item_shares resolution, revision=1 assumption, unverified collection-name convention) are candidates for Plan 25-10's live UAT to surface concretely, and for Phase 26 to close properly once real collection authoring exists.
- No blockers. Full `web` vitest suite (63 files / 591 tests) and `npx tsc --noEmit` both green after every task.

## Self-Check: PASSED

- `web/src/components/settings/FamilyTab.tsx` — FOUND
- `web/src/components/settings/ConfirmDialog.tsx` — FOUND
- `web/src/components/settings/RemoveMemberDialog.tsx` — FOUND
- `web/src/components/settings/FamilyTab.test.tsx` — FOUND
- `web/src/components/settings/RemoveMemberDialog.test.tsx` — FOUND
- Commit `75cd1c1` (feat: ConfirmDialog) — FOUND in git log
- Commit `a1c7e0c` (feat: RemoveMemberDialog) — FOUND in git log
- Commit `c7a4fdf` (feat: FamilyTab wiring) — FOUND in git log

---
*Phase: 25-member-removal-suspension-re-key*
*Plan: 08*
*Completed: 2026-08-05*
