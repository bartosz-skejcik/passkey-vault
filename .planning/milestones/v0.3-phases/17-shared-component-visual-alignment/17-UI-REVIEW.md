# Phase 17 — UI Review

**Audited:** 2026-07-21
**Baseline:** 17-UI-SPEC.md (approved design contract)
**Screenshots:** captured (10 committed PNGs in `uat-screenshots/` — 4 surfaces × 2 themes; read and visually assessed for this audit — no live dev server needed)

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 4/4 | No new copy by design; visible strings ("Log in with Passkey Vault", "Passwords", Polish i18n) clear and on-brand |
| 2. Visuals | 4/4 | Favicon-first tiles render correctly; GitHub logo legible on light tile in vault-dark; icon buttons carry aria-labels (7 found) |
| 3. Color | 4/4 | Tile bg/fg now single-sourced from `--pv-tile-bg`/`--pv-tile-fg`; accent (PV badge) reserved correctly; 60/30/10 respected |
| 4. Typography | 4/4 | DM Sans unchanged across surfaces; no regression; row/header type scale intact |
| 5. Spacing | 4/4 | No spacing/radius changes; 32px tile frame + 8px radius carried verbatim; token grid preserved |
| 6. Experience Design | 3/4 | Favicon empty/loading/error states covered; but `.pv-list` overflow scroll-cap backstop has no automated assertion, and end-of-phase human visual-taste UAT (D5) is still open |

**Overall: 23/24**

---

## Top 3 Priority Fixes

1. **`.pv-list` overflow (~4.5-row scroll-cap) has no automated regression assertion** — a future overlay CSS edit could silently break the NordPass-measured scroll affordance with nothing to catch it — add a computed `max-height: 250px` / scroll-height assertion to the `capture-tile-parity.mjs` harness or `inpage-overlay.test.ts` (currently flagged `🧪 backstop` / human_needed in the SPEC, not wired).
2. **End-of-phase human visual-taste UAT (D5) remains open** — automated checks prove numeric color equality, not that dark-logo-on-light-tile "looks right" at every render site — Bartek's held-out pixel review of the 10 committed screenshots closes this; screenshots confirm it visually but the sign-off is unrecorded.
3. **[Pre-existing, out of scope] popup "Autofill isn't available on this page" banner uses full-bleed `--color-error` (destructive red) for a non-destructive informational message** — the loud red block reads as an alarm for an informational state (visible in `popup-list-vault-dark.png`); consider a muted/warning treatment. Untouched by this phase; flag only.

---

## Detailed Findings

### Pillar 1: Copywriting (4/4)
Contract declares all copy rows N/A by design — this is a component-promotion + color-token phase, no new user-facing strings (17-UI-SPEC.md Copywriting Contract). Verified against screenshots: overlay header "Log in with Passkey Vault", section label "Passwords", masked hint "tile-parity-92185", and the detail panel's Polish i18n ("Użytkownik", "Hasło", "Brak passkeyów — enrollment dostępny wkrótce") all render cleanly and match the security-adjacent, non-playful tone required by CLAUDE.md ("playfulness never in security dialogs"). No generic "Submit/OK/Click Here" labels introduced. **No deviation.**

### Pillar 2: Visuals (4/4)
Clear focal hierarchy on every surface: item tile → label → masked hint. The flagship fix is visually confirmed — `inpage-dropdown-vault-dark.png`, `inpage-prompt-vault-dark.png`, `popup-list-vault-dark.png`, and `web-detailpanel-vault-dark.png` all show the favicon/glyph on a **light** neutral tile in vault-dark, so dark GitHub logos and fallback globe glyphs stay legible (the exact UX-01 bug). Icon-only overlay buttons (close ×, block ⃠, chevron) are backed by 7 `aria-label`/`setAttribute("aria...")` occurrences in `inpage-overlay.ts`. Header variant (`h-6 w-6`) renders correctly in the DetailPanel title bar. **No blocker.**

### Pillar 3: Color (4/4)
`packages/pv-ui/tokens.css:52-53,67-68` declares `--pv-tile-bg`/`--pv-tile-fg` per-theme; `inpage-overlay.ts:270,273` consumes them via `var(--pv-tile-bg)`/`var(--pv-tile-fg)` with **zero** remaining `var(--color-base-200)` on the tile (grep-confirmed empty). Post-review commit 378d0fb correctly went further than the plan: `ItemIconTile.tsx:105-106` now reads `bg-[var(--pv-tile-bg)]`/`text-[var(--pv-tile-fg)]` directly instead of re-deriving zinc-100/zinc-600 via a separate `[data-theme=vault-dark]` variant — making tokens.css the genuine single source of truth for both the React and shadow-DOM paths (this closes a real latent divergence the SPEC's original TILE_BG-literal approach would have left in place). Accent `--color-primary` (PV badge) used only on the brand mark, per contract. The 7 hardcoded hex values in `ItemIconTile.tsx` are all legitimate card-brand colors (VISA #1434CB, Mastercard circles, AMEX, Discover) — documented, carried verbatim, not a token violation. results.json confirms 16/16 computed-color parity checks pass with identical normalized `rgba(244,244,245)` (dark) / `rgba(252,251,250)` (light). **No deviation.**

### Pillar 4: Typography (4/4)
Phase explicitly does not touch typography. DM Sans present across all shadow-DOM and React surfaces; the serif "tile-parity 92185" heading in the in-page screenshots is the **host test-fixture page**, not PV UI. Row label 14px/500, sub-hint 12px, header 14px/600 scale intact. No Fuzzy Bubbles on any security-adjacent surface. **No regression.**

### Pillar 5: Spacing (4/4)
No spacing or radius values changed (DS-03/DS-04 are color/component-source only). Tile frame stays 32px / 8px radius in-page (`inpage-overlay.ts:262-264`) and `h-8 w-8 rounded-[8px]` (row) / `h-6 w-6 rounded-[6px]` (header) in the shared component (`ItemIconTile.tsx:76-79`). Pre-existing NordPass-measured exceptions (`.pv-list max-height:250px`, `.pv-row height:52px`) left byte-unchanged per contract. Overlay literal audit (plan 17-04) confirms only the 8 documented approved exceptions (4 rgba elevation + 4 `border-radius:999px` pill) remain, zero undocumented hits. **No deviation.**

### Pillar 6: Experience Design (3/4)
Strong state coverage on the `ItemIconTile` media element: empty (neutral type-glyph fallback), loading (tile bg paints synchronously before `<img>` resolves — no transparent flash), and error (`onError` swaps to glyph + caches in module-level `FAILED_FAVICON_HOSTS` so it never re-flashes — `ItemIconTile.tsx:153-156`) are all handled and preserved through the promotion. Zero-knowledge favicon invariant intact (direct-to-hostname, `referrerPolicy="no-referrer"`, never a proxy — `ItemIconTile.tsx:147-151`). No destructive action introduced. **Deductions:** (1) the `.pv-list` overflow scroll-cap is a `🧪 backstop` in the SPEC with **no wired automated assertion** — verification is held-out UAT only, an honest gap not a silent pass; (2) the D5 human visual-taste sign-off is still open. Neither breaks task completion, so WARNING not BLOCKER — hence 3/4, not lower.

---

## Registry Safety
Not applicable. No `components.json` anywhere in repo (shadcn explicitly skipped with documented reason — 17-UI-SPEC.md Design System). No third-party registries consumed this phase. Registry audit skipped entirely.

---

## Files Audited
- `packages/pv-ui/components/ItemIconTile.tsx` (shared component, post-378d0fb token wiring)
- `packages/pv-ui/tokens.css` (--pv-tile-bg/--pv-tile-fg declarations)
- `extension/lib/autofill/inpage-overlay.ts` (tile CSS + aria-labels)
- `web/src/components/vault/ItemIconTile.tsx` (re-export shim)
- `extension/entrypoints/popup/ItemIconTile.tsx` (variant="row" shim)
- `uat-screenshots/*.png` (10 screenshots, 4 surfaces × 2 themes — visually assessed)
- `uat-screenshots/results.json` (16 computed-color parity checks, all pass)
- 17-UI-SPEC.md, 17-CONTEXT.md, 17-01..04 SUMMARY.md (baseline + intent)
