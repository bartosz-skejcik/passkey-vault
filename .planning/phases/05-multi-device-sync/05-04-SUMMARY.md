---
phase: 05-multi-device-sync
plan: 04
subsystem: ui
tags: [nextjs, typescript, vitest, i18n, daisyui]

requires:
  - phase: 05-multi-device-sync (plan 03)
    provides: "web/src/lib/vault/syncStatus.ts's useSyncStatus() singleton and store.ts's live items/folders array maintained by applySyncSnapshot"
provides:
  - "web/src/lib/vault/remoteDelete.ts — wasRemotelyDeleted() pure predicate for detecting a background sync deletion of the currently-open item"
  - "web/src/lib/vault/errorToast.ts — additive variant option (\"error\"|\"info\") on showErrorToast, first real use of the info (#00B5FF) token"
  - "Sidebar.tsx's reconnecting-only sync-status dot on the account avatar"
  - "DetailPanel.tsx's second (proactive) live-edit-conflict banner trigger, independent from the existing reactive save-time one"
  - "page.tsx's remote-delete-while-viewing detection: auto-close + calm info toast"
affects: []

tech-stack:
  added: []
  patterns:
    - "editBaselineRevision captured only at edit-entry (startEditing() and the initialMode-keyed effect), never re-derived from live item.revision — the SAME reasoning the existing eslint-disable on that effect already documents"
    - "ItemForm remount-to-reset via key={`${item.id}-${editBaselineRevision}`} — Refresh bumps the baseline, forcing React to discard unsaved form state and reseed from the current item.fields, with zero imperative reset code"
    - "wasRemotelyDeleted(selectedItemId, selectedItem) derives purely from page.tsx's existing selectedItem = items.find(...) ?? null pattern — no new subscription to the sync engine"

key-files:
  created:
    - web/src/lib/vault/remoteDelete.ts
    - web/src/lib/vault/remoteDelete.test.ts
  modified:
    - web/src/lib/i18n/dictionary.ts
    - web/src/lib/vault/errorToast.ts
    - web/src/components/vault/ErrorToast.tsx
    - web/src/components/shell/Sidebar.tsx
    - web/src/components/shell/Sidebar.test.tsx
    - web/src/app/page.tsx
    - web/src/components/vault/DetailPanel.tsx
    - web/src/components/vault/DetailPanel.test.tsx

key-decisions:
  - "showErrorToast(message, options?) keeps every existing single-arg call site working unchanged — variant defaults to \"error\" inside the function, not via a separate overload"
  - "The two conflict banners (reactive `conflict` and proactive `liveConflict`) stay independently controlled booleans, never merged, per 05-UI-SPEC.md's explicit instruction that they differ only in copy/action, not underlying state"
  - "editBaselineRevision is set at BOTH startEditing() and the initialMode-keyed useEffect (not just one), covering both the manual-edit-click path and the context-menu 'Edit' request path"

patterns-established:
  - "Sidebar's presence-indicator dot (role=status, aria-live=polite, conditional render — nothing for the nominal state) is the reusable shape for any future ambient status signal"

requirements-completed: [SYNC-03]

coverage:
  - id: D1
    description: "Sidebar's account-avatar shows an 8px animate-pulse warning dot only when useSyncStatus() returns \"reconnecting\" — nothing rendered for connected/offline"
    requirement: "SYNC-03"
    verification:
      - kind: unit
        ref: "web/src/components/shell/Sidebar.test.tsx > Sidebar sync-status dot (SYNC-03, Plan 05-04) > shows the sync-status dot only when useSyncStatus() returns reconnecting"
        status: pass
    human_judgment: false
  - id: D2
    description: "A background revision bump on the item open in edit mode shows a proactive live-edit-conflict banner (with consequence line + Refresh button) without discarding in-progress unsaved field values, until Refresh is clicked"
    requirement: "SYNC-03"
    verification:
      - kind: unit
        ref: "web/src/components/vault/DetailPanel.test.tsx > DetailPanel proactive live-edit-conflict banner (SYNC-03, Plan 05-04) > shows the proactive live-edit-conflict banner when the live item's revision changes while editing, without discarding the currently-typed field values until Refresh is clicked"
        status: pass
    human_judgment: false
  - id: D3
    description: "The proactive banner never fires for an item that was never entered into edit mode"
    requirement: "SYNC-03"
    verification:
      - kind: unit
        ref: "web/src/components/vault/DetailPanel.test.tsx > DetailPanel proactive live-edit-conflict banner (SYNC-03, Plan 05-04) > does not show the proactive banner for an item that was never in edit mode"
        status: pass
    human_judgment: false
  - id: D4
    description: "wasRemotelyDeleted(selectedItemId, selectedItem) correctly identifies a background remote deletion (id selected but no longer resolves to a live item) vs. every normal null/non-null combination"
    requirement: "SYNC-03"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/remoteDelete.test.ts (all 3 cases from the plan's <behavior> block)"
        status: pass
    human_judgment: false
  - id: D5
    description: "page.tsx auto-closes DetailPanel and shows a calm info-variant toast when the currently-open item is remotely deleted — full regression suite + build stay green"
    requirement: "SYNC-03"
    verification:
      - kind: unit
        ref: "full web suite (npm test -- --run): 220/220 passing, including all pre-existing DetailPanel/page-adjacent cases"
      - kind: other
        ref: "npm run build (Next.js production build)"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-14
status: complete
---

# Phase 5 Plan 04: Sync UI Polish (Status Dot, Live-Edit Banner, Remote-Delete Toast) Summary

**Three small, deliberately-quiet UI surfaces (a reconnecting-only presence dot, a non-destructive proactive live-edit-conflict banner, and a calm auto-close-plus-toast on remote deletion) make Plan 05-03's client sync engine visible to the user without turning it chatty.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-14
- **Tasks:** 2 completed (Task 2 was TDD: RED -> GREEN)
- **Files modified:** 10 (2 created, 8 modified)

## Accomplishments
- `Sidebar.tsx`'s account-avatar circle now shows an 8px `bg-warning` `animate-pulse` dot — but ONLY while `useSyncStatus()` returns `"reconnecting"`; renders nothing (not even an empty node beyond the `role="status"` container) for `"connected"`/`"offline"`, matching 05-UI-SPEC.md's explicit two-visible-states-only rule. `aria-live="polite"` + `aria-label` give assistive tech a single announcement on state change, not continuous chatter.
- `errorToast.ts`/`ErrorToast.tsx` gained an additive `variant?: "error" | "info"` option — every existing single-arg `showErrorToast(message)` call site keeps working unchanged (variant defaults to `"error"` inside the function body). This is the first real use of the `info` (`#00B5FF`) semantic token in the app.
- `remoteDelete.ts` exports one pure predicate, `wasRemotelyDeleted(selectedItemId, selectedItem)`, derived entirely from `page.tsx`'s existing `selectedItem = items.find(...) ?? null` pattern — no new subscription to the sync engine needed. Wired into a `page.tsx` `useEffect` that shows `t("sync.itemDeletedElsewhere")` as an info toast and clears the selection (view or edit mode both covered identically, per CONTEXT.md's instruction not to build a separate "your edits are gone" variant).
- `DetailPanel.tsx` gained a SECOND, independently-controlled conflict-banner trigger path (`liveConflict`, driven by `editBaselineRevision` vs. the live `item.revision` prop) alongside the existing reactive save-time `conflict` banner — both stay visually `alert alert-error text-sm` per 05-UI-SPEC.md's deliberate consistency choice (same underlying fact, same color, regardless of when the user learns it). The proactive banner adds a consequence line and an outlined `RefreshCw` "Odśwież"/"Refresh" button; clicking it bumps `editBaselineRevision`, which changes `ItemForm`'s `key` prop and forces a full remount — the form reseeds from the now-current `item.fields` with zero imperative reset code, discarding unsaved typing only at that explicit, warned moment.
- Full web suite: 220/220 green (207 pre-existing + 13 new: 3 remoteDelete, 2 new DetailPanel proactive-banner cases, 1 new Sidebar sync-dot case — plus pre-existing DetailPanel/Sidebar cases unaffected); `tsc --noEmit` clean; `npm run build` succeeds.

## Task Commits

Each task was committed atomically:

1. **Task 1: i18n strings + info toast variant + sync-status dot on the sidebar avatar** - `52ac23f` (feat)
2. **Task 2: Remote-delete detection + proactive live-edit-conflict banner** (TDD) - `4cd37df` (test, RED) -> `203d06c` (feat, GREEN)

**Plan metadata:** (this commit)

_TDD notes: Task 2's RED was confirmed two ways — `remoteDelete.test.ts` failed on an unresolvable `./remoteDelete` import (module didn't exist yet), and `DetailPanel.test.tsx`'s two new proactive-banner cases failed on a missing `live-edit-conflict-banner` test id. GREEN made both pass with no further RED->GREEN iteration needed. No REFACTOR commit — the implementation landed clean on the first GREEN pass._

## Files Created/Modified
- `web/src/lib/vault/remoteDelete.ts` - new: `wasRemotelyDeleted()` pure predicate + doc comment explaining the unambiguity argument
- `web/src/lib/vault/remoteDelete.test.ts` - new: 3 cases covering the `<behavior>` contract
- `web/src/lib/i18n/dictionary.ts` - 5 new `sync.*` PL/EN keys copied verbatim from 05-UI-SPEC.md's Copywriting Contract
- `web/src/lib/vault/errorToast.ts` - additive `variant` field/option on `ErrorToastState`/`showErrorToast`
- `web/src/components/vault/ErrorToast.tsx` - conditional `alert-error`/`alert-info` class swap, zero other layout changes
- `web/src/components/shell/Sidebar.tsx` - reconnecting-only presence dot on the account avatar, driven by `useSyncStatus()`
- `web/src/components/shell/Sidebar.test.tsx` - new describe block + `useSyncStatus` mock, 1 new case covering all 3 status values
- `web/src/app/page.tsx` - `wasRemotelyDeleted` + `showErrorToast` wiring in a new `useEffect`
- `web/src/components/vault/DetailPanel.tsx` - `editBaselineRevision` state, `liveConflict` derivation, proactive banner render, `ItemForm` `key` bump
- `web/src/components/vault/DetailPanel.test.tsx` - new describe block, 2 new cases (banner shown + non-destructive until Refresh; banner absent for view-mode-only items)

## Decisions Made
- `showErrorToast`'s additive-options-object signature (`showErrorToast(message, options?)`) rather than a second exported function (e.g. `showInfoToast`) — keeps the module's single-state-slot convention and every existing call site's exact source text unchanged.
- The proactive banner is set at edit-entry in TWO places (`startEditing()` and the `initialMode`-keyed `useEffect`) to cover both the manual-Pencil-click path and the context-menu "Edit" request path (which can re-enter edit mode on an already-selected item without the effect's `item.id` dependency changing).
- `editBaselineRevision` is deliberately excluded from the `initialMode`-keyed effect's dependency array (matching that effect's existing `eslint-disable` precedent) — it must capture the baseline only at entry, never re-fire on every live `item` prop update.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed web dependencies in the fresh worktree**
- **Found during:** Task 1 verification (`npm test` reported `vitest: command not found`)
- **Issue:** The parallel-execution worktree had no `node_modules`
- **Fix:** `npm ci` from the existing `package-lock.json` (lockfile install only; no new packages added)
- **Files modified:** none (gitignored install)
- **Verification:** Test runner operational

**2. [Rule 3 - Blocking] Regenerated gitignored WASM bindings for whole-suite verification**
- **Found during:** Full-suite verification after Task 2's GREEN implementation
- **Issue:** `src/lib/crypto/wasm/` (generated by the `prebuild`/manual build-wasm.sh, gitignored) didn't exist in the fresh worktree — 8 pre-existing crypto/PasskeysTab tests failed on an unresolvable import, same known issue documented in Plan 05-03's SUMMARY
- **Fix:** Ran `scripts/build-wasm.sh` (the exact script the `prebuild` hook runs)
- **Files modified:** none (generated output is gitignored)
- **Verification:** Full suite 220/220 green; `tsc --noEmit` clean; `npm run build` succeeds

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking, both worktree-environment setup, zero source-code scope creep)
**Impact on plan:** None on plan substance — both were required to run the plan's own specified verification commands in an isolated worktree.

## Issues Encountered
None beyond the environment items above.

## Known Stubs
None — all three UI surfaces are wired to real, already-live data: `useSyncStatus()` (Plan 05-03's real WS/poll-driven singleton), `item.revision` (the already-live prop `page.tsx` re-derives from `useVaultItems()` on every store change), and `selectedItem`/`items` (the same live array `applySyncSnapshot` maintains).

## Threat Flags
None — no new trust boundary. Per the plan's own threat model: T-05-12 (repudiation risk on the Refresh action silently discarding unsaved work) is mitigated by the consequence line always rendering alongside the Refresh button (proven by the DetailPanel test asserting both banner text and button coexist); T-05-13 (low-severity self-information-disclosure via the remote-delete toast) is accepted as planned, consistent with every other toast already in this codebase.

## User Setup Required
None.

## Next Phase Readiness
- All three of SYNC-03's user-facing behaviors are reachable through the real UI, backed by component/unit tests from this plan plus the transport tests from Plans 05-01 through 05-03.
- REQUIREMENTS.md checkbox updates and STATE.md/ROADMAP.md progress deliberately left to the orchestrator (shared-artifact write in parallel-wave mode) — this plan does not touch those files.
- Full web suite green (220/220), `tsc --noEmit` clean, `npm run build` succeeds.

---
*Phase: 05-multi-device-sync*
*Completed: 2026-07-14*
