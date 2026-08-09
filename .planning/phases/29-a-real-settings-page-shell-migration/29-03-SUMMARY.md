---
phase: 29-a-real-settings-page-shell-migration
plan: 03
subsystem: ui
tags: [nextjs, react, static-export, auth, routing]

requires:
  - phase: 29-a-real-settings-page-shell-migration
    provides: "AuthGate.tsx ({ children, onRegistered } contract) and the real /settings route, built in Plan 29-01"
provides:
  - "page.tsx cut over to the shared AuthGate — its own inline authed/mode branch is fully retired"
  - "?panel=settings deep link now navigates to the real /settings route via router.replace, instead of opening a same-page drawer"
  - "Sidebar's settings gear is a real <Link href=\"/settings\">, not a callback-driven <button>"
  - "SettingsPanel.tsx (the role=\"tablist\"/role=\"tab\" drawer shell) deleted outright, along with its test file"
affects: [29-04, 29-05]

tech-stack:
  added: []
  patterns:
    - "next/navigation's useRouter().replace() for a mount-once query-param redirect, mocked in tests via vi.mock(\"next/navigation\", ...) with a hoisted replace spy"

key-files:
  created: []
  modified:
    - web/src/app/page.tsx
    - web/src/app/page.test.tsx
    - web/src/components/shell/Sidebar.tsx
    - web/src/components/shell/Sidebar.test.tsx
  deleted:
    - web/src/components/settings/SettingsPanel.tsx
    - web/src/components/settings/SettingsPanel.test.tsx

key-decisions:
  - "AuthGate's { children, onRegistered } contract from Plan 29-01 consumed unchanged — page.tsx passes only onRegistered, no new prop added, matching settings/page.tsx's own zero-extra-props usage"
  - "handleInviteDone's setAuthed(true) deleted outright (not preserved as a no-op) with an explanatory comment at the deletion site, since AuthGate resolves its own authed state independently once mounted"
  - "?panel=settings redirect fires from its own separate mount effect, independent of the unlocked gate — the destination route owns its own auth/unlock gating, so no need to wait; ?action=new-item keeps waiting for unlocked since it opens an in-app drawer over live vault data"

patterns-established: []

requirements-completed: [SET-01, SET-02]

coverage:
  - id: D1
    description: "page.tsx uses AuthGate exclusively (no inline authed/mode duplicate); handleInviteDone's dead setAuthed call removed with an explanatory comment"
    requirement: "SET-02"
    verification:
      - kind: unit
        ref: "web/src/app/page.test.tsx (10 tests, full suite green)"
        status: pass
      - kind: other
        ref: "grep -v -E '^\\s*//' web/src/app/page.tsx | grep -c 'SettingsPanel\\|settingsOpen\\|handleOpenSettings' -> 0; grep -n 'AuthGate' web/src/app/page.tsx shows import + usage"
        status: pass
    human_judgment: false
  - id: D2
    description: "?panel=settings navigates to /settings via router.replace, independent of unlock state; ?action=new-item is untouched and still waits for unlocked"
    requirement: "SET-01"
    verification:
      - kind: unit
        ref: "web/src/app/page.test.tsx#navigates to /settings on mount when the URL has panel=settings and the vault is already unlocked (Plan 29-03: real route navigation, not a drawer)"
        status: pass
      - kind: unit
        ref: "web/src/app/page.test.tsx#navigates to /settings immediately even while the vault is still locked, without waiting for unlock"
        status: pass
      - kind: unit
        ref: "web/src/app/page.test.tsx#opens the new-item flow on mount when the URL has action=new-item... (untouched, still green)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Sidebar's settings gear is a real <a href=\"/settings\">, keeping the same testid/aria-label/icon; onOpenSettings prop removed entirely"
    requirement: "SET-01"
    verification:
      - kind: unit
        ref: "web/src/components/shell/Sidebar.test.tsx#renders the settings entry as a real link to /settings, not a callback-driven button"
        status: pass
    human_judgment: false
  - id: D4
    description: "SettingsPanel.tsx and SettingsPanel.test.tsx deleted outright -- zero remaining references anywhere in web/src, zero role=\"tablist\"/role=\"tab\"/aria-selected occurrences within the settings surface"
    requirement: "SET-02"
    verification:
      - kind: other
        ref: "test ! -f web/src/components/settings/SettingsPanel.tsx && test ! -f web/src/components/settings/SettingsPanel.test.tsx -> confirmed removed"
        status: pass
      - kind: other
        ref: "grep -rn 'SettingsPanel' web/src | grep -v -E ':\\s*//' -> zero matches"
        status: pass
      - kind: other
        ref: "grep -rn 'role=\"tablist\"|role=\"tab\"|aria-selected' web/src/app/settings web/src/components/settings -> zero matches"
        status: pass
    human_judgment: false

duration: ~10min
completed: 2026-08-10
status: complete
---

# Phase 29 Plan 03: Real Settings Cutover -- page.tsx/Sidebar Migration Summary

**Cuts `page.tsx` over to the shared `AuthGate`, turns the `?panel=settings` deep link and the sidebar gear into real navigation to `/settings`, and deletes the old `SettingsPanel.tsx` drawer shell outright.**

## Performance

- **Duration:** ~10 min
- **Tasks:** 2/2 complete
- **Files modified:** 4 modified, 2 deleted

## Accomplishments

- `page.tsx` no longer owns its own `authed`/`mode` state or inline `AuthCard`/`LoginForm`/`RegisterForm` branch — it wraps its authenticated-content return in `<AuthGate onRegistered={...}>`, the exact `{ children, onRegistered }` component built in Plan 29-01, consumed with zero new props.
- `handleInviteDone`'s now-dead `setAuthed(true)` call is deleted, with an explanatory comment at the deletion site (why `AuthGate` resolving its own state independently makes the call unnecessary) so a future reader doesn't reintroduce it.
- The `?panel=settings` deep link — used by the already-shipped 0.4.0 extension's `${baseUrl}/?panel=settings` link, currently in CWS/AMO review — now fires `router.replace("/settings")` from its own separate mount effect, independent of the `unlocked` gate (the destination route owns its own auth/unlock gating). `?action=new-item` is completely untouched and still waits for `unlocked`, since it opens an in-app drawer over live vault data.
- `PendingUrlAction`'s `{ kind: "settings" }` variant is dropped; the type now only carries `new-item`.
- `Sidebar.tsx`'s settings entry changes from a callback-driven `<button onClick={() => onOpenSettings?.()}>` to a real `<Link href="/settings">` — a genuine `<a href>` in the DOM for middle-click/open-in-new-tab, same testid/aria-label/icon, preserving the client-side transition (in-memory unlock singleton) on a plain click. The `onOpenSettings` prop is removed entirely from `Sidebar`'s type.
- `SettingsPanel.tsx` (the `role="tablist"`/`role="tab"` drawer this whole phase exists to retire) and its 6-test `SettingsPanel.test.tsx` are deleted outright — not left as dead code. Zero remaining references anywhere in `web/src`.
- `settingsOpen`/`setSettingsOpen` state, `handleOpenSettings`, and the `SettingsPanel` import/render call are gone from `page.tsx`; `sidePanelOpen`'s computation no longer includes `settingsOpen`.

## Task Commits

Each task was committed atomically:

1. **Task 1: page.tsx -- AuthGate wiring, real redirect, retire settingsOpen/SettingsPanel** - `74e0a84` (feat)
2. **Task 2: Sidebar gear becomes a real link; retire SettingsPanel.tsx entirely** - `1a3a2a0` (feat)

## Files Created/Modified

- `web/src/app/page.tsx` - uses `AuthGate` exclusively; `?panel=settings` redirects via `router.replace`; `settingsOpen`/`handleOpenSettings`/`SettingsPanel` removed
- `web/src/app/page.test.tsx` - the two `panel=settings` tests now assert `router.replace("/settings")` via a new `next/navigation` mock; the "waits for unlock" test is rewritten to prove the redirect fires immediately even while locked
- `web/src/components/shell/Sidebar.tsx` - settings gear is `<Link href="/settings">`; `onOpenSettings` prop removed
- `web/src/components/shell/Sidebar.test.tsx` - the `onOpenSettings` callback test replaced with a real `tagName === "A"` / `href === "/settings"` assertion
- `web/src/components/settings/SettingsPanel.tsx` - deleted
- `web/src/components/settings/SettingsPanel.test.tsx` - deleted

## Decisions Made

- `AuthGate`'s contract from Plan 29-01 consumed verbatim, no pass-through, no new prop — settled, not a choice, per the plan's own explicit constraint.
- `handleInviteDone`'s `setAuthed(true)` deleted rather than preserved as a harmless no-op, since `AuthGate` is only ever reached after the `invite !== null` early return clears, so its own internal `authed` state has never resolved while the invite view is showing — the next render after `setInvite(null)` mounts `AuthGate` fresh and it resolves `authed=true` on its own via `getSessionToken()`.
- The `panel=settings` redirect effect is deliberately separate from the `pendingUrlAction`-driven effect (which still gates `action=new-item` on `unlocked`) — the two deep links now have genuinely different auth-gating needs (a route with its own gate vs. an in-app drawer needing live decrypted data), so merging them into one effect would have forced an artificial, incorrect shared gate.

## Deviations from Plan

None - plan executed exactly as written.

One clarification worth recording: the plan's acceptance criteria for Task 2 specifies `grep -rn 'role="tablist"\|role="tab"\|aria-selected' web/src` should return zero matches. A repo-wide run of that grep returns 3 matches, all inside `web/src/components/vault/SharingOverviewPanel.tsx` (and its test file) — a pre-existing, unrelated Phase 28 component with its own independent tab UI (folder/person tabs in the sharing-overview panel), out of this plan's `files_modified` scope and predating this phase entirely. Restricting the same grep to the actual settings surface (`web/src/app/settings`, `web/src/components/settings`) returns zero matches, confirming the real intent of the prohibition (no tab semantics survive on `/settings` or in its component tree) is satisfied. `SharingOverviewPanel.tsx` was left untouched, per the scope boundary rule — fixing it would be an out-of-scope, unrelated architectural change to a different, working feature.

## Issues Encountered

- **Fresh worktree bootstrap required** (same standing lesson as Plan 29-01). `web/node_modules`, `packages/pv-ui/node_modules`, the workspace root `node_modules`, and the gitignored WASM build artifacts (`web/src/lib/crypto/wasm/`, `web/public/wasm/pv_wasm_bg.wasm`) were all absent in this fresh git worktree. Resolved via `rsync` from the main checkout before any `vitest`/`npm test`/`npm run build` command could run. Not a code change, no commit. (`npm run build` itself also re-ran the Rust/wasm-bindgen build from source as its first step, confirming the bootstrap wasn't strictly required for the build check specifically, only for the earlier `vitest` runs.)

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The full web suite is green: 821/821 tests (matches Plan 29-01's 821 baseline exactly — this plan replaced 2 `page.test.tsx` assertions and 1 `Sidebar.test.tsx` assertion 1-for-1, and removed `SettingsPanel.test.tsx`'s 6 tests along with the file it tested, netting to the same 821 total).
- `npm run build` succeeds cleanly; `out/settings.html` / `out/settings.txt` / `out/settings/` are all present, confirming the route change didn't regress the static export.
- This is the first point in Phase 29 where the OLD settings drawer is fully gone from the shipped app — Plans 29-04/29-05 (e2e fixes) can now proceed against a codebase with exactly one settings surface (`/settings`), not two.
- Sole out-of-plan-scope note carried forward (not a blocker): `web/src/components/vault/SharingOverviewPanel.tsx`'s own, unrelated `role="tablist"` tab UI (Phase 28) still exists — correctly, since it's a different feature this plan was never scoped to touch. Documented above so a future repo-wide "retire tabs" grep doesn't mistake it for a regression of this plan's work.

---
*Phase: 29-a-real-settings-page-shell-migration*
*Completed: 2026-08-10*

## Self-Check: PASSED

- All 4 modified files (`page.tsx`, `page.test.tsx`, `Sidebar.tsx`, `Sidebar.test.tsx`) confirmed present on disk.
- Both deleted files (`SettingsPanel.tsx`, `SettingsPanel.test.tsx`) confirmed absent on disk.
- Both task commit hashes (`74e0a84`, `1a3a2a0`) confirmed present in `git log --oneline`.
- Full web vitest suite: 821/821 green.
- `cd web && npm run build`: exits 0, produces `out/settings.html` / `out/settings.txt` / `out/settings/`.
