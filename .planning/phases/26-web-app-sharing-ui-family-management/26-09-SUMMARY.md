---
phase: 26-web-app-sharing-ui-family-management
plan: 09
subsystem: ui
tags: [typescript, react, vitest, sharing, share-entry-point, avatar-stack]

# Dependency graph
requires:
  - phase: 26-web-app-sharing-ui-family-management
    provides: "Plan 26-06's AvatarStack.tsx/useShareRecipients data source + accessLevel.ts + full i18n dictionary pass"
  - phase: 26-web-app-sharing-ui-family-management
    provides: "Plan 26-08's ShareDialog.tsx — the dialog both entry points open"
  - phase: 26-web-app-sharing-ui-family-management
    provides: "Plan 26-05a's updateVaultItem encrypt-scope dispatch + CollectionKeyUnavailableError (the failure mode this plan's surfaces must not swallow)"
provides:
  - "web/src/components/vault/ItemContextMenu.tsx — 'Share…' kebab entry (E1), opens ShareDialog with scope: {kind: 'item', item}"
  - "web/src/components/vault/DetailPanel.tsx — Share2 header icon button (E1) + AvatarStack in the header metadata area (D-3/E5)"
  - "web/src/components/vault/ItemRow.tsx — AvatarStack rendered inline for shared items (D-3/E5)"
affects: [26-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A component that opens a full-screen-overlay dialog (ShareDialog) from inside an ephemeral dropdown menu (ItemContextMenu) owns the dialog's open/close state itself and does NOT call the menu's own onClose on open — onClose would unmount the component (and the dialog with it) before the user ever sees it, since the parent only renders the menu while its own menuOpen state is true."
    - "itemSharedOnCollectionNote REPLACES the Share action entirely (never merely disables it) for a collection-scoped item, in both entry points — mirrors WR-10's server-side 400 exactly, so the UI never offers a button that structurally always fails."

key-files:
  created: []
  modified:
    - web/src/components/vault/ItemContextMenu.tsx
    - web/src/components/vault/ItemContextMenu.test.tsx
    - web/src/components/vault/DetailPanel.tsx
    - web/src/components/vault/DetailPanel.test.tsx
    - web/src/components/vault/ItemRow.tsx
    - web/src/components/vault/ItemRow.test.tsx

key-decisions:
  - "ItemContextMenu.tsx and DetailPanel.tsx each own their own local ShareDialog open/close state (not delegated to a parent callback like Delete's onDeleteRequest pattern) — ItemContextMenu specifically because it unmounts as soon as its parent's menuOpen flips false, which would tear the dialog down before render if opening it also closed the menu."
  - "Reused the existing share.ctaItem dictionary key ('Udostępnij item'/'Share item') for both the kebab 'Share…' label text and DetailPanel's Share icon aria-label — dictionary.ts is 26-12's exclusive file this wave (parallel_execution constraint), and no dedicated action.share/menu-label key exists yet in the Phase 26 dictionary pass. Reported here per the parallel_execution instruction ('if you need a string that doesn't exist yet, report it') rather than inventing or adding one."
  - "item.isShared (not collectionId alone) gates AvatarStack's render in both ItemRow and DetailPanel — the server's own is_shared column already covers BOTH a collection-scoped item and a direct item_shares grant, and AvatarStack's own useShareRecipients hook dispatches the correct fetch internally."
  - "AvatarStack is rendered for REAL (never mocked) in ItemRow.test.tsx/DetailPanel.test.tsx's own new coverage — only the underlying @/lib/vault/api fetch is mocked, matching AvatarStack.test.tsx/shareRecipients.test.ts's established convention, so the N+1-avoidance and loading-backstop behaviors are proven at the real call site, not merely assumed from Plan 26-06's own unit coverage."

requirements-completed: [SHARE-02, UX-05]

coverage:
  - id: D1
    description: "A personal, non-collection-scoped item (including a passkey item) has a real, working Share… entry in ItemContextMenu, opening ShareDialog with scope: {kind: 'item', item}"
    requirement: "SHARE-02"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ItemContextMenu.test.tsx#shows a Share… entry for a personal item, opening ShareDialog with scope: {kind: 'item', item}"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/ItemContextMenu.test.tsx#shows Share… for a passkey item exactly like a login item — no suppression (distinct from Edit's passkey suppression)"
        status: pass
    human_judgment: false
  - id: D2
    description: "An undecryptable item shows no Share action at all (button or note), in both surfaces"
    requirement: "SHARE-02"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ItemContextMenu.test.tsx#does not show Share… (button or note) for an item flagged undecryptable"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/DetailPanel.test.tsx#hides the Share button for an item flagged undecryptable (mirrors Edit's guard)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A collection-scoped item shows share.itemSharedOnCollectionNote instead of a Share button, in BOTH ItemContextMenu and DetailPanel — never a clickable action that would 400 server-side"
    requirement: "SHARE-02"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ItemContextMenu.test.tsx#shows share.itemSharedOnCollectionNote instead of a Share button for a collection-scoped item"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/DetailPanel.test.tsx#shows share.itemSharedOnCollectionNote instead of a Share button for a collection-scoped item"
        status: pass
    human_judgment: false
  - id: D4
    description: "DetailPanel's header renders a Share2 icon button before Edit, opening the same ShareDialog"
    requirement: "SHARE-02"
    verification:
      - kind: unit
        ref: "web/src/components/vault/DetailPanel.test.tsx#renders a Share2 icon button before Edit, opening ShareDialog with scope: {kind: 'item', item}"
        status: pass
    human_judgment: false
  - id: D5
    description: "AvatarStack renders for a shared item's row/detail panel and not for a non-shared one, without blocking on a per-item fetch, and reuses one fetch per collection across a mixed list"
    requirement: "UX-05"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ItemRow.test.tsx#renders AvatarStack for a shared item's row"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/ItemRow.test.tsx#renders no AvatarStack for a non-shared item's row"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/ItemRow.test.tsx#renders zero avatar circles while a shared item's recipient data has not yet resolved"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/ItemRow.test.tsx#does not trigger a per-item fetch for non-shared items in a list, and reuses one fetch across items sharing a collection"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/DetailPanel.test.tsx#renders AvatarStack in the header for a shared item's open detail panel"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/DetailPanel.test.tsx#renders no AvatarStack for a non-shared item's detail panel"
        status: pass
    human_judgment: false

# Metrics
duration: ~50min
completed: 2026-08-06
status: complete
---

# Phase 26 Plan 09: Item Share Entry Point + AvatarStack Wiring Summary

**Wires D-1's item-level Share entry point into `ItemContextMenu`'s kebab menu and `DetailPanel`'s header — both opening the real `ShareDialog` (Plan 26-08) — plus the E1 collection-scope backstop (`share.itemSharedOnCollectionNote` replaces the button entirely, never merely disables it), and renders D-3's `AvatarStack` in `ItemRow`/`DetailPanel` for any item whose `isShared` flag is true, reusing Plan 26-06's proven N+1-avoiding data source unchanged.**

## Performance

- **Duration:** ~50 min
- **Completed:** 2026-08-06
- **Tasks:** 2
- **Files modified:** 6 (0 created, 6 modified)

## Accomplishments

- **A real, working Share entry point exists in both places a member acts on an item.** `ItemContextMenu.tsx` gets a "Share…" `<li>` (mirrors Move's list position/testid convention, `data-testid="context-menu-share"`), and `DetailPanel.tsx` gets a `Share2` icon button positioned before Edit in the header's icon-button row — both open the real `ShareDialog` with `scope: {kind: "item", item}`. Neither follows Edit's passkey suppression (SHARE-02 covers passkey items exactly like any other type); both DO follow the `item.undecryptable` suppression (nothing safe to share from a failed-integrity item).
- **The E1 collection-scope backstop is honest, not merely disabled.** A `collectionId !== null` item shows `share.itemSharedOnCollectionNote` (folder name resolved via `useCollections()`) in place of the Share action entirely, in BOTH surfaces — WR-10's server-side 400 on a direct `item_shares` grant against a collection-scoped item would make a clickable button here a UI lie.
- **`AvatarStack` (D-3) now renders where a member actually sees it.** `ItemRow.tsx` renders it inline with the row's existing metadata slot; `DetailPanel.tsx` renders it in the header next to the item name — both gated strictly on `item.isShared` (covers both a collection-scoped item and a direct grant, per the server's own `is_shared` column), reusing `useShareRecipients`/`AvatarStack.tsx` from Plan 26-06 unmodified.
- **The N+1-avoidance and loading-backstop behaviors are re-proven at the real call site**, not merely assumed from Plan 26-06's own unit coverage: a fetch-call-count spy across a 4-item mixed list (2 shared sharing one collection, 2 personal) proves exactly ONE `getCollectionAccessList` call and ZERO calls for the non-shared items; a never-resolving fetch proves the row renders zero avatar circles, never a skeleton.
- **A live regression from Task 1's own change was caught and fixed before it could ship.** `ItemContextMenu.tsx`'s new `useCollections`/`ShareDialog` imports pulled in `collections.ts`'s module-load-time `subscribeLockState(...)` side effect and `ShareDialog.tsx`'s own dependency chain, both of which broke `ItemRow.test.tsx` (which transitively renders `ItemContextMenu`) under its pre-existing minimal `@/lib/crypto` mock — fixed by mocking `@/lib/vault/collections` and `./ShareDialog` in that file (documented as a Rule 3 deviation below).

## Task Commits

Each task was committed atomically:

1. **Task 1: Share entry points (ItemContextMenu + DetailPanel) + itemSharedOnCollectionNote** — `66ff347` (feat)
2. **Task 2: AvatarStack wiring in ItemRow and DetailPanel** — `a9c4d79` (feat)

## RED Proof

Both tasks' RED was demonstrated via genuine temporary-regression injection (this plan's implementation and its own tests were built together, then verified against the pre-fix source — mirrors 26-01/26-05/26-08's own documented precedent for this same situation) rather than strict historical RED-then-GREEN commit ordering:

**Task 1:** Temporarily restored `ItemContextMenu.tsx`/`DetailPanel.tsx` to their pre-plan (`HEAD~1`) content and ran the new tests. 6 of 8 new tests failed genuinely (`Unable to find an element by: [data-testid="context-menu-share"]` etc.); the 2 "suppressed for `undecryptable`" tests passed vacuously (expected — the Share affordance didn't exist at all yet, so "not present" was trivially true). Restored the fix — all 55 tests (16 + 39) pass.

**Task 2:** Temporarily restored `ItemRow.tsx`/`DetailPanel.tsx` to their post-Task-1 (`HEAD~1`) content and ran the new tests. 3 of 6 new tests failed genuinely (`waitFor` timeout — `avatar-stack` testid never appeared); the "renders zero avatar circles while unresolved" and "renders no AvatarStack for non-shared" tests passed vacuously (expected — no AvatarStack wiring existed at all yet). Restored the fix — all 73 tests (32 + 41) pass.

## Files Created/Modified

- `web/src/components/vault/ItemContextMenu.tsx` — "Share…" entry, `itemSharedOnCollectionNote` substitution, owns local `ShareDialog` open state
- `web/src/components/vault/ItemContextMenu.test.tsx` — 4 new tests
- `web/src/components/vault/DetailPanel.tsx` — `Share2` header icon button, `itemSharedOnCollectionNote` substitution, `AvatarStack` in the header, owns local `ShareDialog` open state
- `web/src/components/vault/DetailPanel.test.tsx` — 6 new tests (4 for the Share entry point, 2 for AvatarStack)
- `web/src/components/vault/ItemRow.tsx` — `AvatarStack` rendered inline for `item.isShared`
- `web/src/components/vault/ItemRow.test.tsx` — 4 new tests + the Rule 3 mock fix (see Deviations)

## Decisions Made

See `key-decisions` in frontmatter. The two worth restating: (1) both entry points own their `ShareDialog` open/close state locally rather than delegating to a parent callback, because `ItemContextMenu` unmounts the instant its parent's `menuOpen` flips false — calling that same `onClose` to "close the menu" on Share-click would tear the dialog down before it ever renders; (2) `item.isShared` alone (not `collectionId`) gates `AvatarStack`'s render, since the server's `is_shared` column already covers both scopes and `useShareRecipients` dispatches internally.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] `ItemContextMenu.tsx`'s new imports broke `ItemRow.test.tsx`'s existing minimal crypto mock**
- **Found during:** Task 1, running the full `vitest run` suite after committing
- **Issue:** `ItemContextMenu.tsx`'s new `useCollections` import (real `@/lib/vault/collections`) calls `subscribeLockState(...)` at module load time; `ItemRow.test.tsx` (which transitively renders `ItemContextMenu`) only mocked `@/lib/crypto` with `totpNow`, so the real module crashed with `No "subscribeLockState" export is defined on the "@/lib/crypto" mock`. The new `ShareDialog` import similarly would have pulled in ShareDialog's own heavy dependency chain (`@/lib/families/api`, `@/lib/vault/api`, `@/lib/identity/ensure`, `@/lib/auth/api`) into every ItemRow test.
- **Fix:** Mocked `@/lib/vault/collections` (whole module, `useCollections: mockUseCollections`) and `./ShareDialog` (`default: () => null`) in `ItemRow.test.tsx`, mirroring the exact mocking pattern this plan's own `ItemContextMenu.test.tsx`/`DetailPanel.test.tsx` already use for the same components.
- **Files modified:** `web/src/components/vault/ItemRow.test.tsx`
- **Verification:** Full `npx vitest run` — 77 files, 715 tests passing (before Task 2's own additions) — and re-verified again after Task 2 at 77 files, 721 tests.
- **Committed in:** `66ff347` (bundled with Task 1's own commit, since it's a direct consequence of Task 1's change)

**2. [Rule 3 — Blocking issue, reported per parallel_execution constraint] No dedicated dictionary key exists for the "Share…" label/aria-label text**
- **Found during:** Task 1, implementing the kebab entry's button text and the DetailPanel icon's `aria-label`
- **Issue:** Neither an `action.share` key (parallel to `action.move`) nor a dedicated menu-label/aria-label key exists in the Phase 26 dictionary pass (Plan 26-06). This plan's parallel_execution constraint forbids touching `dictionary.ts` this wave (26-12 owns it) and explicitly says to report a missing string rather than add one.
- **Fix:** Reused the existing `share.ctaItem` key (`"Udostępnij item"`/`"Share item"`) for both the kebab entry's button text and DetailPanel's Share icon `aria-label`. This is the closest existing key semantically (already means "share [this] item") and does not collide with its other use (`ShareDialog`'s own submit CTA, item variant) since the two render in entirely different components/contexts.
- **Files modified:** none beyond the already-declared `ItemContextMenu.tsx`/`DetailPanel.tsx` — no dictionary edit
- **Reported for follow-up:** a future dictionary pass (or Plan 26-12, if in scope) may want to add a dedicated `action.share`-style key so the entry-point label and the dialog's submit CTA aren't coupled to the same string going forward. Not blocking — the reused copy is accurate and both PL/EN values already exist.
- **Committed in:** `66ff347`

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking issues directly caused by this plan's own changes, neither scope creep).
**Impact on plan:** Both are small, contained fixes; neither required touching `dictionary.ts` or any file outside this plan's own declared scope plus the one test-file mock fix.

## Issues Encountered

- A fresh worktree had no `node_modules` in `web/`/`packages/pv-ui/` and no WASM artifacts — resolved via `npm ci` in both plus `bash scripts/build-wasm.sh`, per the environment note.
- No other issues.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Both real Share entry points (kebab + detail panel header) and the AvatarStack wiring are live for every item surface in the vault list — Plan 26-13 (or any later UAT/e2e plan) can now exercise the full item-share flow end-to-end starting from either entry point.
- `dictionary.ts` was NOT touched — Plan 26-12 (`FamilyTab.tsx`/`Sidebar.tsx`, this same wave) retains exclusive ownership with zero conflict risk.
- The reused `share.ctaItem` key for the entry-point label (see Deviation 2) is a candidate for a future dedicated key if a later plan wants the entry-point label and the dialog CTA to diverge in wording — not currently required.
- No blockers for downstream plans in this phase.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: mitigate | `web/src/components/vault/ItemContextMenu.tsx`, `web/src/components/vault/DetailPanel.tsx` | T-26-20 (this plan's own threat register, Tampering/UX-level): a clickable Share action on a collection-scoped item that would always 400 server-side. Implemented exactly as required — `share.itemSharedOnCollectionNote` REPLACES the Share action entirely for `item.collectionId !== null`, never merely disables a present-but-inert button, in both entry points. Verified by 2 tests (one per surface) asserting the button is absent and the note is present. |
| threat_flag: reuse (no new surface) | `web/src/components/vault/ItemRow.tsx`, `web/src/components/vault/DetailPanel.tsx` | Consumes `AvatarStack.tsx`/`useShareRecipients` (Plan 26-06) at two new call sites — no new crypto/network surface introduced. Plan 26-06's own T-26-13 (accepted, Information Disclosure, low severity: a cached recipient entry can go stale after a revocation until the next store re-render) carries over unchanged; this plan does not add a second cache or invalidation path. Reviewer should check: neither call site filters or re-derives the recipient list before handing it to `AvatarStack` — both pass `item` directly, letting the shared component's own data source and rendering logic own the full contract (including A-7's suspended-recipient disclosure). |
| threat_flag: reuse (no new surface) | `web/src/components/vault/ItemContextMenu.tsx`, `web/src/components/vault/DetailPanel.tsx` | Opens `ShareDialog` (Plan 26-08) with real, live item data at two new entry points — the dialog's own threat register (T-26-15 confused-deputy defense-in-depth, T-26-16 hidden-password honesty, T-26-17 accepted partial-failure risk) is unchanged by this plan; this plan only supplies the trigger and the `scope: {kind: "item", item}` argument, never a second construction path for that scope value. |

## Self-Check: PASSED

- FOUND: web/src/components/vault/ItemContextMenu.tsx (Share entry + note + local ShareDialog wiring)
- FOUND: web/src/components/vault/ItemContextMenu.test.tsx (4 new tests)
- FOUND: web/src/components/vault/DetailPanel.tsx (Share icon + note + AvatarStack + local ShareDialog wiring)
- FOUND: web/src/components/vault/DetailPanel.test.tsx (6 new tests)
- FOUND: web/src/components/vault/ItemRow.tsx (AvatarStack wiring)
- FOUND: web/src/components/vault/ItemRow.test.tsx (4 new tests + Rule 3 mock fix)
- FOUND commit 66ff347 in git log
- FOUND commit a9c4d79 in git log
- cd web && npx tsc --noEmit: clean, 0 errors
- cd web && npx vitest run src/components/vault/ItemContextMenu.test.tsx src/components/vault/DetailPanel.test.tsx src/components/vault/ItemRow.test.tsx: 3 files, 89 tests passing
- cd web && npx vitest run (full suite): 77 files, 721 tests passing, zero regressions
- dictionary.ts: confirmed untouched (`git status --short` shows no changes to that file across either commit)

---
*Phase: 26-web-app-sharing-ui-family-management*
*Plan: 09*
*Completed: 2026-08-06*
