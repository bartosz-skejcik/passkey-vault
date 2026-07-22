# Phase 1 — UI Review

**Audited:** 2026-07-12
**Baseline:** 01-UI-SPEC.md (approved design contract) + docs/UI-DESIGN.md tokens
**Screenshots:** not captured (no dev server on :3000/:5173/:8080; Playwright unavailable) — code-level audit only
**Prior verification:** shell was human-verified live (dark default, light toggle + persistence, self-test 5/5, clean console). This audit is advisory/non-blocking.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Copy is verbatim-accurate to the contract, but "patrz błąd poniżej" misdirects — failed-step errors render *above* the summary, not below. |
| 2. Visuals | 3/4 | Strong hierarchy and a11y labeling; status-circle icon is 14px, under the spec's declared 16–20px range. |
| 3. Color | 3/4 | Dark theme is token-exact; light theme collapses `base-300 == base-200`, making the TopBar bottom border and sidebar/canvas separation invisible. |
| 4. Typography | 4/4 | All 4 declared sizes and exactly 2 weights (400/700); arbitrary px used deliberately to hit exact spec sizes. |
| 5. Spacing | 3/4 | Mostly on-token; three uses of 12px (`px-3`, `gap-3`) sit off the declared scale, which states "Exceptions: none". |
| 6. Experience Design | 3/4 | Excellent state coverage + Strict-Mode race guard + no-FOUC theme; fatal self-test error has no retry affordance. |

**Overall: 19/24**

---

## Top 3 Priority Fixes

1. **Light theme loses its 1px-border surface separation** — `globals.css` sets `--color-base-300: oklch(98.86% ...)` equal to `base-200` in `vault-light`. Since TopBar (`bg-base-200`) uses `border-b border-base-300` and the card uses `border-base-300`, the TopBar's bottom border becomes the same color as its own fill (invisible) and the sidebar/main-canvas boundary vanishes — directly breaking UI-DESIGN.md §2's "1px borders + surface steps instead of shadows" system. *Fix:* introduce a distinct warm off-white for `base-300` (or a dedicated border token) in `vault-light` so surface steps and the 1px dividers remain visible in both themes.
2. **Fatal self-test failure gives the user no way to retry** — `SelfTestCard.tsx` returns early on `kind === "fatal"` (lines 51–60) with only heading + body; the "Uruchom ponownie" button (line 92) lives solely in the results branch. Yet `initCrypto()` deliberately resets `ready = null` on failure to *enable* retry. The recovery path exists in the facade but is unreachable from the UI — the user must hard-reload. *Fix:* render the re-run button in the fatal branch too (call `run()`).
3. **Summary line misdirects to the error location** — `"…patrz błąd poniżej"` (SelfTestCard.tsx:82) tells the user to look *below*, but a failed step's error message renders inline in its `StepRow` (`step.error`), which is *above* the summary line. *Fix:* reword to point upward (e.g. `…patrz błąd przy kroku powyżej`) or relocate the error detail beneath the summary.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)
Contract copy is reproduced verbatim and correctly scoped:
- Primary CTA `+ Nowy item` — `TopBar.tsx:20`, `disabled` as specified. PASS.
- Empty-state heading `Vault jeszcze pusty` — `MainColumn.tsx:10`. PASS.
- Empty-state body with 👇 emoji in Fuzzy Bubbles — `MainColumn.tsx:11`. PASS (emoji correctly confined to empty state).
- Error heading `Self-test nie przeszedł` — `SelfTestCard.tsx:54`. PASS.
- Self-test output stays technical (DM Sans / mono, no emoji, no Fuzzy Bubbles). PASS — the playfulness-free security-UI rule holds.

**WARNING** — `SelfTestCard.tsx:82`: `"patrz błąd poniżej"` points below, but step errors render above in `StepRow` (see Top Fix 3).
**Minor** — `SelfTestCard.tsx:56`: the fatal-error body hardcodes the step name as `initCrypto` rather than the contract's templated `{step}`. Defensible for the init path, but the template shape is lost.

### Pillar 2: Visuals (3/4)
- Clear focal hierarchy: Display "Vault" (28px) → empty state → self-test card. Flat base-100 card with 1px border, no shadow — matches the design's low-elevation intent.
- Accessibility is a genuine strength: theme toggle `aria-label="Przełącz motyw"` (`Sidebar.tsx:60`), status circles carry per-step `aria-label` (`StepRow.tsx:10`), decorative icons `aria-hidden` throughout.

**WARNING** — `StepRow.tsx:16,18`: status icons are `size={14}`, below the spec's "Icon size 16–20px" for the pass/fail indicator; the 20px circle (`h-5 w-5`) is correct but the glyph inside is undersized.
**Minor** — the Display title "Vault" repeats immediately above the empty-state heading "Vault jeszcze pusty" with only 16px (`mt-4`) between two bold headings; reads slightly redundant (per-spec, but worth a glance in-browser).

### Pillar 3: Color (3/4)
- Theme tokens in `globals.css` are copied exactly from UI-DESIGN.md OKLCH values. No hardcoded hex/rgb anywhere in `.tsx` (grep: 0 hits). PASS.
- Accent discipline is correct: coral `btn-primary` appears only on `+ Nowy item` (`TopBar.tsx:19`); teal is not used anywhere (grep: 0 hits), honoring the "reserved for Phase 3/4" instruction. Success/error semantics applied only to self-test status circles.

**WARNING** — `globals.css:32`: `vault-light` sets `--color-base-300` identical to `--color-base-200` (`oklch(98.86% ...)`). Combined with `border-base-300` on the TopBar (`TopBar.tsx:5`) and card (`SelfTestCard.tsx:53,67`), the light-theme dividers and sidebar/canvas surface-step collapse to invisible (see Top Fix 1). Dark theme is unaffected (3 distinct steps #1F1F1F/#212121/#262626).
**Minor** — spec lists the brand wordmark as an accent target; the Display title is plain `base-content`, no coral wordmark mark (optional this phase).

### Pillar 4: Typography (4/4)
- Exactly the four declared roles: Display `text-[28px]`, Heading `text-[20px]`, Body `text-base` (16px), Label `text-sm`/`text-[14px]`. Arbitrary px is justified — Tailwind's scale has no 28px/20px token, so explicit px is the correct way to hit the contract precisely.
- Exactly two weights: `font-bold` (700) and default (400). No `font-medium` leakage — matches the "500 deferred" decision.
- Line heights applied per role: `leading-[1.15]` display, `leading-[1.2]` heading, `leading-[1.5]` body.

**Minor** — the 14px Label role is expressed two ways (`text-sm` in shell, `text-[14px]` in StepRow mono detail); harmless but inconsistent. Label line-height 1.4 is never explicitly set on nav rows. Neither affects the pass.

### Pillar 5: Spacing (3/4)
On-token usage dominates and the fixed dimensions are exact: sidebar `w-64` (256px), TopBar `h-16` (64px), card `p-6` (24px = spec's "24px internal padding"), main column `p-4 md:p-8` (16/32px), 48px card gap via `mt-12` (2xl), empty-state `gap-1` (4px xs).

**WARNING** — off-scale 12px values not in the declared token set {4,8,16,24,32,48,64}, which explicitly states "Exceptions: none":
- `Sidebar.tsx:45` `px-3` (12px) on nav rows
- `Sidebar.tsx:53` `gap-3` (12px) account block
- `StepRow.tsx:8` `gap-3` (12px) status-row gap
They are multiples of 4 but land between `sm` (8) and `md` (16). Snap to 8 or 16 to honor the scale.

### Pillar 6: Experience Design (3/4)
Notably thorough for a shell phase:
- **State coverage:** loading (`"Uruchamianie..."`), per-step pass/fail isolation (each step try/caught so one failure never aborts the rest), fatal error state, empty state, disabled states (search, `+ Nowy item`, re-run-while-loading). PASS.
- **No-FOUC theme:** pre-hydration inline script in `layout.tsx:27–38` resolves theme before first paint — correct, not a `useEffect`. Persistence via `localStorage('pv-theme')` with try/catch for private mode (`Sidebar.tsx:29–35`). PASS.
- **Race safety:** `runIdRef` generation counter (`SelfTestCard.tsx:24–40`) correctly guards Strict-Mode mount→cleanup→remount and superseded retry clicks. Above-standard.

**WARNING** — fatal `initCrypto()` failure renders no retry button even though the facade resets `ready=null` to permit one (see Top Fix 2). The only recovery is a page reload.
**Minor** — inert nav placeholders use `aria-disabled="true"` on plain `<div>`s (`Sidebar.tsx:44`) with no interactive role, so assistive tech won't announce a disabled state; acceptable for static placeholders but the attribute is semantically inert here.

---

## Registry Safety
Skipped — `web/components.json` absent and `shadcn_initialized: false`. UI-SPEC Registry Safety table declares no third-party registries. No vetting gate triggered.

---

## Files Audited
- `web/src/app/globals.css`
- `web/src/app/layout.tsx`
- `web/src/app/page.tsx`
- `web/src/components/shell/Sidebar.tsx`
- `web/src/components/shell/TopBar.tsx`
- `web/src/components/shell/MainColumn.tsx`
- `web/src/components/self-test/SelfTestCard.tsx`
- `web/src/components/self-test/StepRow.tsx`
- `web/src/lib/crypto/index.ts` (self-test step names / copy source)
