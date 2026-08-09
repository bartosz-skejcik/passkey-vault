---
phase: 29-a-real-settings-page-shell-migration
plan: 01
subsystem: ui
tags: [nextjs, react, static-export, auth, i18n, tailwind, daisyui]

requires: []
provides:
  - "Real, linkable /settings route (SET-01) — static-export-compatible, gated by a shared AuthGate component"
  - "Locked four-group settings IA (SET-02/SET-04): Konto -> Bezpieczeństwo -> Dane -> Rodzina i udostępnianie, each its own headed <section>"
  - "SettingsJumpNav: 4-link scroll-spy nav, degrading gracefully to native anchor nav without IntersectionObserver"
  - "AuthGate.tsx: standalone, reusable extraction of page.tsx's authed null/false/true 3-state contract"
  - "Delete-account trigger relocated from SecurityTab (Bezpieczeństwo) to SettingsSectionAccount (Konto)"
affects: [29-02, 29-03, 29-04, 29-05]

tech-stack:
  added: []
  patterns:
    - "Route file with no \"use client\" directive composing already-\"use client\" children (self-test/page.tsx precedent) for static-export prerendering"
    - "next/link for internal in-app navigation that must preserve client-side singleton state across navigation (vs. a bare <a> full reload)"
    - "IntersectionObserver scroll-spy as a progressive enhancement layered over real <a href> anchors, never required for base navigation"

key-files:
  created:
    - web/src/lib/auth/AuthGate.tsx
    - web/src/app/settings/page.tsx
    - web/src/app/settings/SettingsShell.tsx
    - web/src/app/settings/page.test.tsx
    - web/src/components/settings/SettingsJumpNav.tsx
    - web/src/components/settings/SettingsSectionAccount.tsx
    - web/src/components/settings/SettingsSectionAccount.test.tsx
    - web/src/components/settings/SettingsSectionSecurity.tsx
    - web/src/components/settings/SettingsSectionData.tsx
    - web/src/components/settings/SettingsSectionFamily.tsx
  modified:
    - web/src/components/settings/SecurityTab.tsx
    - web/src/components/settings/SecurityTab.test.tsx
    - web/src/lib/i18n/dictionary.ts

key-decisions:
  - "next/link (not a bare <a>) for the back-to-vault link, per 29-PATTERNS.md's navigation-primitive note: preserves the in-memory unlock singleton across navigation while keeping identical <a href=\"/\"> DOM/testing semantics"
  - "SettingsJumpNav's navItemClass drops Sidebar.tsx's unconditional w-full — only the active/inactive color pair is reused verbatim per 29-UI-SPEC.md; width is composed responsively at the call site (content-sized mobile pill vs. full-width desktop rail item)"

patterns-established:
  - "Section wrapper contract: <section id aria-labelledby data-testid=\"settings-section-{slug}\"> + <h2 id=\"{slug}-heading\" tabIndex={-1}> for focus-management on jump-nav activation"

requirements-completed: [SET-01, SET-02, SET-04]

coverage:
  - id: D1
    description: "/settings is a real, linkable static-export route; a zero-session mount shows the login/register AuthCard and renders no settings content (Pitfall 1 closure)"
    requirement: "SET-01"
    verification:
      - kind: unit
        ref: "web/src/app/settings/page.test.tsx#shows the login AuthCard and renders NO settings content for a zero-session mount (Pitfall 1)"
        status: pass
      - kind: other
        ref: "cd web && npm run build; test -f out/settings.html && test -f out/settings.txt && test -d out/settings"
        status: pass
    human_judgment: false
  - id: D2
    description: "All four locked-order headed sections (Konto/Bezpieczeństwo/Dane/Rodzina i udostępnianie) render with zero interaction for an authed session; jump-nav has exactly 4 links matching section order"
    requirement: "SET-02"
    verification:
      - kind: unit
        ref: "web/src/app/settings/page.test.tsx#renders all four headed sections with zero interaction for a session mount"
        status: pass
      - kind: unit
        ref: "web/src/app/settings/page.test.tsx#renders the four <h2> group headings in DOM order Konto -> Bezpieczeństwo -> Dane -> Rodzina i udostępnianie"
        status: pass
      - kind: unit
        ref: "web/src/app/settings/page.test.tsx#renders the jump-nav landmark with exactly four links in order konto/bezpieczenstwo/dane/rodzina"
        status: pass
    human_judgment: false
  - id: D3
    description: "Delete-account trigger relocated from SecurityTab (Bezpieczeństwo) into SettingsSectionAccount (Konto), verbatim behavior, 3 moved tests intact at their new home"
    requirement: "SET-02"
    verification:
      - kind: unit
        ref: "web/src/components/settings/SettingsSectionAccount.test.tsx#Delete account section (E6)"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/SecurityTab.test.tsx (exactly 2 tests remain, zero account-delete-trigger references)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Polish jump-nav labels (\"Rodzina i udostępnianie\", 23 chars) render without clipping/wrapping at the 200px desktop rail and as content-sized pills in the 375px mobile horizontal row"
    requirement: "SET-04"
    verification:
      - kind: automated_ui
        ref: "Playwright headless measurement (chromium, served build/out/ statically, pl locale, fake localStorage session token): desktop 1280px -- all 4 links exactly 200x44px, scrollWidth===clientWidth (200===200) for every link, uniform height (no wrap); mobile 375px -- content-sized pills (62px..178px wide), all 44px tall, scrollWidth===clientWidth for every pill (no internal clipping), combined row width (~453px) exceeds viewport and scrolls via overflow-x-auto as designed. Screenshots: jumpnav-desktop-1280.png / jumpnav-mobile-375.png (scratchpad, not committed)."
        status: pass
    human_judgment: true
    rationale: "Signed off 2026-08-10 by the coordinator. The sign-off rests entirely on the headless geometry proof, not on visual inspection: both captured screenshots were dominated by UnlockOverlay's backdrop blur (the fake localStorage session token satisfies AuthGate but does not actually unlock the vault) and contributed no usable visual evidence -- the desktop shot shows an illegible four-row rail, the mobile shot shows no nav at all. The geometry measurement conclusively answers the checkpoint's literal question on the real built output, at both widths, in pl: scrollWidth===clientWidth per link excludes truncation, and uniform 44px height across all four links excludes wrapping. A clean *visual* confirmation (not just geometry) is deliberately carried forward into Plan 29-05's live e2e run, where a real unlocked session will exist."

duration: ~19min
completed: 2026-08-10
status: complete
---

# Phase 29 Plan 01: Real /settings Route Shell & Migration Summary

**Real, linkable `/settings` static-export route with AuthGate session-gating, a 4-group scroll-spy IA hosting all migrated surfaces, and the delete-account trigger relocated from Bezpieczeństwo to Konto.**

## Performance

- **Duration:** ~19 min (084f53e -> 8ef5f3e)
- **Tasks:** 3/3 complete (2 code tasks + 1 deviation fix; Task 3's human-verify checkpoint signed off 2026-08-10)
- **Files modified:** 13 (10 created, 3 modified)

## Accomplishments

- `/settings` is a real, linkable, `output: "export"`-compatible route (mirrors `self-test/page.tsx`'s shape) that survives `npm run build` and produces `out/settings.html` / `out/settings.txt` / `out/settings/`, proving no server-rendered route was introduced.
- `AuthGate.tsx` extracts `page.tsx`'s `authed` null/false/true 3-state contract into a standalone, reusable component — closes Pitfall 1: a zero-session mount to `/settings` shows the real `LoginForm`/`AuthCard`, never settings content.
- The locked 4-group IA (Konto -> Bezpieczeństwo -> Dane -> Rodzina i udostępnianie) is built as four independent `<section>` components, each with its own focusable `<h2>`, wired into a scroll-spy `SettingsJumpNav` that degrades gracefully to plain anchor navigation without `IntersectionObserver`.
- Delete-account moved byte-for-byte from `SecurityTab.tsx` (Bezpieczeństwo) into `SettingsSectionAccount.tsx` (Konto), per the locked group definition — its 3 tests moved with it, verbatim assertions, to a new home.
- `role="tab"`/`role="tablist"`/DaisyUI `tabs`/`tab-active` fully retired on this surface (0 occurrences, grep-verified).
- `SettingsSectionFamily.tsx` wraps `FamilyTab` verbatim with a required Phase 33/SET-03 code-comment marking and zero on-screen "coming soon" copy (grep-verified both ways).

## Task Commits

Each task was committed atomically:

1. **Task 1 (tracer): End-to-end /settings shell** - `19d24d2` (feat)
2. **Task 2: Relocate delete-account from SecurityTab into Konto** - `0f2bd24` (feat)
3. **Deviation fix, found during Task 3 pre-checkpoint verification: jump-nav mobile pill width** - `8ef5f3e` (fix)

**Task 3 (checkpoint:human-verify):** signed off by the coordinator 2026-08-10, on the headless geometry proof (see Deviations + coverage D4 above) — the captured screenshots were unusable (blurred by `UnlockOverlay`, no real unlock in this isolated environment) and contributed no visual evidence; a clean visual confirmation is deliberately carried into Plan 29-05's live e2e run.

## Files Created/Modified

- `web/src/lib/auth/AuthGate.tsx` - standalone auth-gate component (extracted from `page.tsx`)
- `web/src/app/settings/page.tsx` - the route file (no `"use client"`, composes `AuthGate` + `SettingsShell`)
- `web/src/app/settings/SettingsShell.tsx` - client component: header, back-link, grid, jump-nav + sections, `UnlockOverlay`
- `web/src/app/settings/page.test.tsx` - 5 tests: zero-session gate, full-session render, heading order, jump-nav links, back-link
- `web/src/components/settings/SettingsJumpNav.tsx` - 4-link scroll-spy nav
- `web/src/components/settings/SettingsSectionAccount.tsx` - Konto: PasskeysTab + SessionsTab + delete-account trigger
- `web/src/components/settings/SettingsSectionAccount.test.tsx` - container presence + moved delete-account tests
- `web/src/components/settings/SettingsSectionSecurity.tsx` - Bezpieczeństwo: thin `SecurityTab` wrap
- `web/src/components/settings/SettingsSectionData.tsx` - Dane: import/export CTAs moved from `SettingsPanel.tsx`
- `web/src/components/settings/SettingsSectionFamily.tsx` - Rodzina i udostępnianie: verbatim `FamilyTab` wrap
- `web/src/components/settings/SecurityTab.tsx` - delete-account block removed; owns only autolock + clipboard controls
- `web/src/components/settings/SecurityTab.test.tsx` - reduced to its own 2 tests
- `web/src/lib/i18n/dictionary.ts` - 8 new `settings.*` keys (backToVault/jumpNavLabel/group*(Description))

## Decisions Made

- `next/link`, not a bare `<a>`, for the back-to-vault link — preserves the in-memory unlock singleton across navigation (SPA transition on plain click) while remaining an identical `<a href="/">` in the DOM for every literal UI-SPEC assertion. Same reasoning applies to Plan 29-03's sidebar gear.
- `SettingsJumpNav`'s `navItemClass` helper reuses Sidebar.tsx's active/inactive color pair verbatim (the actual UI-SPEC contract) but does NOT copy its unconditional `w-full` — width is composed responsively per-context instead (see Deviations).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Jump-nav mobile pills were full-row-width, not content-sized**
- **Found during:** Pre-Task-3 headless verification (Playwright measurement requested by coordinator, ahead of the human-verify checkpoint)
- **Issue:** `SettingsJumpNav`'s `navItemClass` reused Sidebar.tsx's helper including its unconditional `w-full`. In the horizontal mobile flex row, this stretched every pill to the full nav row width (measured: ~343px each at a 375px viewport) instead of sizing to content — defeating the intended compact pill-row design and making `overflow-x-auto` scroll unnecessarily far.
- **Fix:** `navItemClass` no longer hardcodes `w-full` (only the active/inactive color pair is reused verbatim, per 29-UI-SPEC.md's actual instruction); width is composed responsively at the call site — no width class on mobile (content-sized) + `md:w-full` (fills the 200px desktop rail). Added `whitespace-nowrap` on mobile so a pill's own label never wraps internally.
- **Files modified:** `web/src/components/settings/SettingsJumpNav.tsx`
- **Verification:** Re-measured post-fix with the same Playwright script — desktop 1280px: all 4 links exactly 200x44px, `scrollWidth===clientWidth`; mobile 375px: content-sized pills (62px-178px), all 44px tall, `scrollWidth===clientWidth` for every pill, combined row exceeds the viewport and scrolls as designed. Full web suite re-run: 827/827 green. `npm run build` re-run: settings artifact triple intact.
- **Committed in:** `8ef5f3e`

---

**Total deviations:** 1 auto-fixed (1 Rule-1 bug, found via headless measurement, not via test suite — the mocked-away CSS class strings gave no signal here).
**Impact on plan:** Necessary correctness fix for exactly the surface Task 3's checkpoint exists to verify. No scope creep — same file, same task's own concern.

## Issues Encountered

- **Fresh worktree bootstrap required.** `web/node_modules`, `packages/pv-ui/node_modules` were absent in this git worktree (per the standing 16-04 lesson: a fresh executor worktree needs its own bootstrap). Resolved via `rsync` from the main checkout's `node_modules` before any `vitest`/`next build` command could run. Not a code change, no commit.
- **Headless checkpoint evidence required a workaround for the real backend.** `PasskeysTab`/`SessionsTab` fetch from a real `pv-server` that isn't running in this isolated verification; the Playwright measurement bypassed this by setting a fake `pv-session-token` in `localStorage` before navigation (enough to satisfy `AuthGate`, not enough to actually unlock the vault — `UnlockOverlay` still renders and blurs the shell underneath, visible in the captured screenshots). This does not affect the jump-nav geometry measurement (computed via `getBoundingClientRect`/`scrollWidth`/`clientWidth`, independent of the blur/overlay), but the screenshots themselves show a blurred background — expected pre-unlock behavior (T-02-14), not a defect.

## Known Stubs

None — no data source was stubbed; `PasskeysTab`/`SessionsTab`/`SecurityTab`/`FamilyTab` render with their real, already-tested empty/loading/error states, all carried across unmodified.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 29-02 (Dane's DEBT-02 export disclosure) and Plan 29-03 (retiring `SettingsPanel.tsx`, wiring `page.tsx`'s sidebar gear to `<a href="/settings">`, wiring `page.tsx` itself to use `AuthGate`) can both proceed — this plan deliberately left `page.tsx`'s own inline `authed` branch and `SettingsPanel.tsx` untouched (both plans' own scope, not duplicated here).
- **Plan 29-01 is fully complete.** Task 3's checkpoint (Polish jump-nav label fit at 375px and in the 200px rail) was signed off by the coordinator 2026-08-10 on the basis of the headless geometry proof (coverage D4) — the screenshots themselves were unusable evidence (blurred by `UnlockOverlay`, no real unlock available in this isolated environment). A clean *visual* confirmation of the jump-nav (not just geometry) is deliberately carried forward into **Plan 29-05's live e2e run**, where a real unlocked session exists — noted here so that plan doesn't have to rediscover why it's still owed.
- VALIDATION.md's second manual-only item (accepting "1 wpisów" grammar) is explicitly deferred to close together with Plan 29-02's disclosure work, per the plan's own Task 3 text — not evaluated in this plan.

---
*Phase: 29-a-real-settings-page-shell-migration*
*Completed: 2026-08-10*

## Self-Check: PASSED

- All 13 files listed under "Files Created/Modified" confirmed present on disk (`ls -la`, batch-verified).
- All 3 task/deviation commit hashes (`19d24d2`, `0f2bd24`, `8ef5f3e`) confirmed present in `git log --oneline`.
- Full web vitest suite: 827/827 green (821 baseline + 6 net new).
- `cd web && npm run build`: exits 0, TypeScript clean, produces `out/settings.html` / `out/settings.txt` / `out/settings/`.
