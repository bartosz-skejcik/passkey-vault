# Phase 29 — UI Review

**Audited:** 2026-08-10
**Baseline:** `29-UI-SPEC.md` (design contract, section-by-section)
**Screenshots:** not captured — no dev server detected on :3000/:5173/:8080; this is a code-only audit against the implemented files.
**Advisory:** non-blocking per orchestrator instruction; phase already verified 5/5. Findings below are scored against the phase's own contract, not a gate.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 4/4 | Every new string routed through `t`/`interpolate`, PL/EN both present, DEBT-02 sentence verified correct at every `n` including `n=1`. |
| 2. Visuals | 3/4 | Focal point and jump-nav accent discipline hold, but the page-background/row-surface contrast the spec explicitly designs around never renders — see Color. |
| 3. Color | 2/4 | The declared 60% dominant token (`base-300` page background) is never applied anywhere on the route; page, header, and row surfaces all resolve to the same `base-100`, collapsing the dominant/secondary distinction the spec spent a full paragraph justifying. |
| 4. Typography | 4/4 | Exactly `28/24/16/14` declared + the inherited, untouched `20px` tier; only `font-bold`/default-400 in the two new files; zero third weight. |
| 5. Spacing | 2/4 | Group-to-group vertical rhythm is doubled against the declared scale: parent `gap-8 md:gap-16` on `<main>` stacks with each non-first `<section>`'s own `pt-8 md:pt-16`, yielding 64px (not 48px) on mobile and 128px (not 64px) on desktop. |
| 6. Experience Design | 4/4 | `role="tablist"` fully retired on `/settings` (confirmed not just half-migrated); DEBT-02's hydration-race backstop is closed correctly (`hiddenPasswordCount` stays `null`, confirm disabled, never a false zero); scroll-spy degrades gracefully without `IntersectionObserver`. |

**Overall: 19/24**

---

## Top 3 Priority Fixes

1. **Page background never becomes `base-300`.** `web/src/app/settings/SettingsShell.tsx` and every section component apply no background class to the page container — the root renders at the DaisyUI default (`base-100`), identical to the header (`bg-base-100`, `SettingsShell.tsx:28`) and to row surfaces (`bg-base-100` inside dialogs, `PasskeysTab.tsx:110`/`SessionsTab.tsx:113` which are borderless-background, inheriting the same base-100 field). User impact: none of the 60/30/10 hierarchy the spec argues for at length ("Note on hexes" + the Color table) is actually visible — the whole page is visually flat, a single background plane, with the intended dominant/secondary contrast absent. Fix: add `bg-base-300` to the SettingsShell's outer wrapper (or a new `<main className="min-h-screen bg-base-300">` at the grid level, keeping the header's `bg-base-100` and row surfaces' `bg-base-100` as the 30% layer against it).

2. **Group-to-group spacing is compounded, not the declared value.** `web/src/app/settings/SettingsShell.tsx:58` sets `<main className="flex ... gap-8 md:gap-16">` (32px/64px) as the flex gap between all four `<SettingsSection*>` children, but `SettingsSectionSecurity.tsx:18`, `SettingsSectionData.tsx:24`, and `SettingsSectionFamily.tsx:18` each independently add `pt-8 md:pt-16` (32px/64px) on top of that same gap for the border-top divider. The two stack (flex `gap` does not collapse with a child's own padding), producing an actual visual gap of 64px mobile / 128px desktop between groups — double the spec's declared `2xl` (48px) mobile / `3xl` (64px) desktop values, and on desktop double even the desktop target outright. Fix: either remove the parent's `gap-8 md:gap-16` (let each section's own `pt-*` be the sole source of group-to-group spacing, and add matching top padding to the first section for consistency) or remove `pt-8 md:pt-16` from the three sections and keep the parent gap.

3. **`SettingsSectionAccount.tsx`'s delete-account sub-block breaks the section-anatomy divider contract for the same reason.** Its inner `<h3>` block (`SettingsSectionAccount.tsx:44-56`) sits inside the Konto section's own `gap-4` flow, correctly avoiding the double-padding bug above (Konto is the first section, no `border-t`/`pt-*`), but this asymmetry — Konto alone escaping the compounding bug purely because it's first — is itself evidence the `pt-*`/`gap-*` duplication in fix #2 is unintentional rather than a deliberate first-section exception. Once #2 is fixed, re-verify Konto's total internal spacing (delete-account block vs. `PasskeysTab`/`SessionsTab`) still reads as the intended `gap-4` (16px, `md` token) rather than inheriting a stray extra gap from the same class of bug.

---

## Detailed Findings

### Pillar 1: Copywriting (4/4)
- `web/src/lib/i18n/dictionary.ts:398-401` — `export.hiddenPasswordDisclosure` matches the UI-SPEC's reworded (Task 3 checkpoint) copy verbatim in both `pl`/`en`, with `{n}` trailing as a standalone count exactly as specified — confirmed grammatically correct shape at any `n` (no noun governed).
- `dictionary.ts:645-663` — all six new `settings.*` keys (`backToVault`, `jumpNavLabel`, four `group*`/`group*Description` pairs) present in both locales, matching the spec's copy table exactly.
- No generic `Submit`/`Click Here`/`OK` labels found in any of the audited files; existing CTAs (`settings.exportCta`/`importCta`) are unchanged per the migration mapping's "container only" instruction.

### Pillar 2: Visuals (3/4)
- Focal point: `<h1>` (28px/700) is the largest text, sticky at top, first-rendered — matches the "Visual focal point" contract (`SettingsShell.tsx:48`).
- Jump-nav is the only other accent-bearing element (`SettingsJumpNav.tsx:33-35`, `bg-primary/[0.08] text-primary` reused verbatim from `Sidebar.tsx`'s pattern) — confirmed no other `text-primary`/`bg-primary` usage in the audited files besides the two existing CTA buttons (`btn-primary` in `SettingsSectionData.tsx:37,49`), which the spec explicitly allows.
- Icon-only elements: back-link's `ArrowLeft` carries `aria-hidden="true"` alongside visible text label (not icon-only, no aria-label needed) — correct.
- Deduction: the background/surface layering that should reinforce this hierarchy (see Color pillar) is absent, so the "visual hierarchy through... color differentiation" half of the pillar is only partially delivered — typography and accent-discipline carry the whole hierarchy alone.

### Pillar 3: Color (2/4)
- `packages/pv-ui/tokens.css:40,58` confirms `base-100`/`base-300` are genuinely distinct tokens per theme (dark: `oklch(26.86%..)` vs `oklch(23.93%..)`; light: `oklch(100%..)` vs `oklch(93%..)`).
- Grep across `web/src/app/settings/` and `web/src/components/settings/SettingsSection*.tsx`/`SettingsJumpNav.tsx`/`SettingsShell.tsx` finds **zero** occurrences of `bg-base-300` (or any page-level background utility) outside pre-existing dialog scrims (`bg-base-300/70` in `ConfirmDialog.tsx`/`DeleteAccountDialog.tsx`/etc., which are unrelated overlay scrims, not the page fill). The spec's Color table names `base-300` as the 60% dominant "page background — set explicitly by this new route" and specifically calls out that this is the first time the token would be used for that role on a real page. That never happens; the shipped page inherits the DaisyUI default background instead (effectively `base-100`, same value as the header and row surfaces).
- Accent budget itself is respected — no accent bleed onto group headings, jump-nav inactive items, or the back-link (all confirmed `text-base-content/70`).
- No hardcoded hex/`rgb()` found in any audited file (`grep` clean).
- Score reflects a genuine, checkable divergence from the contract's central color claim, not a stylistic nitpick — the spec devotes an entire "Note on hexes" paragraph to justifying exactly this token choice, and it was not wired up.

### Pillar 4: Typography (4/4)
- Sizes in use across the four section components + `SettingsShell.tsx`: `text-[28px]` (h1), `text-[24px]` (h2 ×4), `text-[20px]` (inherited, `SettingsSectionAccount.tsx:46` delete-account `<h3>`, unchanged from pre-existing `account.deleteSectionHeading`), `text-base`/`text-sm` (body/label) — exactly `28/24/16/14` declared plus the one documented inherited 20px tier, nothing else.
- Weights: only `font-bold` appears in the new files (headings) with everything else at default 400 — no `font-medium`/`font-semibold` introduced.
- Hierarchy reads correctly as `28 > 24 > 20 > 16` in document order (h1 → each group h2 → the inherited `account.deleteSectionHeading` h3 inside Konto → body text) — SC3's "point at the heading that owns any setting" test holds structurally.

### Pillar 5: Spacing (2/4)
- `xs`/`sm`/`md`/`lg`/`xl` tokens check out: icon gaps (`gap-1`, back-link), header padding (`px-4 md:px-6` = md/lg), header→content gap (`py-8` = 32px = xl), jump-nav↔content gap (`gap-6` = 24px = lg, `SettingsShell.tsx:51`) all match the declared scale.
- The `2xl`/`3xl` group-to-group tier is broken by compounding — see Priority Fix #2 above for the exact mechanism and line references. This is not a rounding difference; it is a structural double-application of two independent spacing declarations that were each individually correct in isolation.
- Mobile jump-nav `min-h-11` (44px) tap target confirmed present (`SettingsJumpNav.tsx:33`).
- No arbitrary/non-4px-multiple spacing values found (`grep` for `\[.*px\]`/`\[.*rem\]` in spacing-relevant contexts returns only the (permitted, typography-declared) `text-[28px]`/`text-[24px]`/`text-[20px]` and the jump-nav's declared `w-[200px]` rail width, all spec-sanctioned).

### Pillar 6: Experience Design (4/4)
- `role="tablist"`/`role="tab"`/`aria-selected`/`tabs-bordered`/`tab-active` grepped across `web/src/app/` and `web/src/components/settings/`: zero matches on the settings surface. The only remaining hits are in `components/vault/SharingOverviewPanel.tsx`, a pre-existing, unrelated Phase 28 surface explicitly out of this phase's scope (confirmed by `29-06-SUMMARY.md`'s documented correction of a prior plan's false claim about this exact grep). Retirement is genuinely complete, not half-migrated.
- `ExportDialog.tsx:43-51` correctly implements the E5 loading/partial backstop: `hiddenPasswordCount` is `null` (never a false `0`) until `useItemsHydrated()` confirms hydration, and `export-confirm` stays `disabled` while `null` (`ExportDialog.tsx:121`) — the exact "correctness, not decoration" obligation the spec's backstop table calls out.
- Focus management: every group `<h2>` carries `tabIndex={-1}` (`SettingsSectionAccount.tsx:32`, and matching in the other three sections) with `.focus()` invoked from `SettingsJumpNav.tsx:70-78` after native anchor scroll — matches the accessibility contract's replacement for retired tab semantics.
- Scroll-spy degrades gracefully: `SettingsJumpNav.tsx:42-46` early-returns when `IntersectionObserver` is undefined, leaving native `<a href="#slug">` behavior as the sole navigation path — matches E2's error/partial coverage.
- Sidebar gear correctly migrated to a real `<a>`/`Link` (`Sidebar.tsx:575-582`), keeping `aria-label`.

---

## Files Audited

- `web/src/app/settings/page.tsx`
- `web/src/app/settings/SettingsShell.tsx`
- `web/src/components/settings/SettingsJumpNav.tsx`
- `web/src/components/settings/SettingsSectionAccount.tsx`
- `web/src/components/settings/SettingsSectionSecurity.tsx`
- `web/src/components/settings/SettingsSectionData.tsx`
- `web/src/components/settings/SettingsSectionFamily.tsx`
- `web/src/components/vault/ExportDialog.tsx`
- `web/src/components/shell/Sidebar.tsx` (gear link)
- `web/src/lib/i18n/dictionary.ts` (new keys)
- `packages/pv-ui/tokens.css` (token source, cross-checked against Color pillar)
- `web/src/app/globals.css` (body-level background check)
- `web/src/app/page.tsx` (`?panel=settings` redirect, out-of-scope confirmation only)
- `.planning/phases/29-a-real-settings-page-shell-migration/29-06-SUMMARY.md` (verification evidence for `role="tablist"` retirement and DEBT-02 grammar backstop)

---

## Fix Disposition (2026-08-10)

Both `fix_these_two` findings applied via `gsd-code-fixer`, verified live (real WASM, real
`pv-server`, no mocks), each committed atomically.

| Finding | Disposition | Reason |
|---------|--------------|--------|
| Priority Fix #1 / Pillar 5 (Spacing): group-to-group gap doubled (64/128px vs declared 48/64px) | **fixed** | `commit fd80321`. Removed `SettingsShell.tsx`'s `<main>` flex `gap-8 md:gap-16` (the compounding source); kept each non-first section's own `border-t` + top padding as the sole spacing mechanism, adjusted `pt-8` → `pt-12` (32px→48px) so mobile hits the declared 2xl token — `md:pt-16` (64px, 3xl) was already correct. Live measurement (`getComputedStyle` on all three `border-t` sections, both viewports): `borderTopWidth 1px + paddingTop` = 49px total (1px divider + 48px token) at 375px, 65px total (1px + 64px) at 1280px — uniform across Konto→Bezpieczeństwo, Bezpieczeństwo→Dane, Dane→Rodzina. `e2e/settings-jumpnav-labels.spec.ts` (live Playwright, real WASM/server) passed post-fix, confirming the layout change didn't regress jump-nav geometry. |
| Priority Fix #2 / Pillar 3 (Color): declared `base-300` dominant token never applied | **fixed** | `commit a0827db`. Added `bg-base-300` to `SettingsShell.tsx`'s outer wrapper (page ground). Discovered during fix application that `PasskeysTab.tsx`/`SessionsTab.tsx`'s row `<li>` elements (`rounded-box border border-base-300`) had **no explicit background** — they were implicitly relying on inheriting whatever the page background was, which is exactly the "borderless-background" pattern this review's own Color section flagged. Without an explicit fill, switching the page to `base-300` would have made those rows blend back into the new ground, reproducing the same invisible-hierarchy bug one layer down. Added `bg-base-100` to both rows' `className` so the declared 30% secondary layer is real. Verified live in both shipped themes via `getComputedStyle().backgroundColor`: vault-dark page `lab(11.76 0 0)` vs header/row `lab(15.16 0 0)` (distinct, page darker); vault-light page `lab(91.88 0.5 1.42)` vs header/row `lab(100 0 0)` (distinct, page a light gray against white surfaces). Legible in both themes, no worse-looking regression — did not need to invoke the "stop and report" escape hatch. |
| Priority Fix #3 / Pillar 5 note (re-verify Konto's internal spacing after #2) | **no_change_needed** | Konto (`SettingsSectionAccount.tsx`) has no `border-t`/`pt-*` (first section, unaffected by the fix) and its internal `gap-4` flow (delete-account sub-block vs. `PasskeysTab`/`SessionsTab`) is untouched by either commit above — confirmed by diff (`SettingsSectionAccount.tsx` not in either commit's file list). Its total internal spacing still reads as the intended 16px `gap-4` token. |

**Known side effect, not fixed (out of scope):** `FamilyTab.tsx:869`'s member-row (`rounded-box border border-base-300`, same borderless-background pattern as the two rows above) is **not** wrapped in this fix per this task's explicit instruction ("Do NOT touch `FamilyTab.tsx` — Phase 33 owns its redesign"). It will now inherit the new `base-300` page ground the same way the Passkeys/Sessions rows would have before this fix — its border remains visible but the row no longer reads as a distinct filled surface against the page. This does not break legibility (member email/role text stays fully readable against `base-300`), so it does not trigger the "stop and report a worse-looking page" clause, but it is a real, visible regression in that one row's depth that Phase 33's FamilyTab redesign should account for.

**Verification summary:**
- `npm test` (worktree, real WASM/`public/wasm` artifacts, no symlink across `next build`'s Turbopack — real `npm install` + `bash scripts/build-wasm.sh`): **844 tests / 83 files, all green** — matches the stated baseline exactly, before and after both fixes.
- `npm run build`: succeeded, emitted `out/settings.html`, `out/settings.txt`, `out/settings/`, all four routes (`/`, `/_not-found`, `/self-test`, `/settings`) marked `○ (Static)`.
- `npx playwright test e2e/settings-jumpnav-labels.spec.ts`: **1 passed** (real `pv-server` release build + registered account, no mocks) — jump-nav label geometry unaffected by the spacing change.
- Live computed-gap and computed-color measurements (ad hoc Playwright script against the built app + release `pv-server`, real registered account, not committed) reported above verbatim, not inferred from class names.

_Fixed: 2026-08-10_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
