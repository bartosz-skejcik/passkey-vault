---
phase: 11-generate-capture
plan: 09
subsystem: ui
tags: [css, shadow-dom, daisyui, oklch, scrollbar, hover, tokens]

requires:
  - phase: 11-generate-capture (11-08)
    provides: "packages/pv-ui/tokens.css consumed by both the popup (style.css @import) and the in-page shadow-DOM surfaces (INPAGE_THEME_CSS) — this plan's token-only CSS (var(--color-base-content), color-mix()) depends on that single source of truth already being wired."
provides:
  - "extension/lib/autofill/inpage-overlay.ts: .pv-list (shared by BOTH the in-field dropdown and the prompt-window account list) now scrolls at a max-height tuned to ~4.5 rows (270px, deliberately cutting a partial row as a scroll affordance) with a token-based thin scrollbar (base-content/20 thumb, self-adapting per theme)"
  - "extension/entrypoints/popup/style.css: .pv-row-hover — the ONE shared button-style hover utility (flat at rest, inset-border + subtle shadow + translate-press on hover/active, all via var(--color-base-content)/color-mix, zero literals) applied identically to both the 'Wszystkie' rows (ItemListView.tsx) and the 'Na tej stronie' rows (AutofillItemRow.tsx)"
affects: ["11-generate-capture UAT (packaged-build screenshots in BOTH themes required before Bartek review, per this plan's own verification block)"]

tech-stack:
  added: []
  patterns:
    - "Inset box-shadow (not a real `border`) for a hover-only 'becomes a button' affordance -- avoids any box-sizing/layout math and is never clipped by an ancestor's overflow-y:auto scroll container, unlike a real border+padding change would be. Used for .pv-row-hover."
    - "var(--color-base-content) (never a literal, never a base-200/base-300 swap) as the hover-blend target for self-adapting per-theme polarity: base-content is near-white in vault-dark (blending toward it lightens) and near-black in vault-light (blending toward it darkens) -- the same mechanism web/src/components/vault/ItemRow.tsx's existing `hover:bg-base-content/[0.06]` already relies on, now formalized as a shared .pv-row-hover class instead of a one-off Tailwind arbitrary-value utility."

key-files:
  created: []
  modified:
    - extension/lib/autofill/inpage-overlay.ts
    - extension/lib/autofill/inpage-overlay.test.ts
    - extension/entrypoints/popup/style.css
    - extension/entrypoints/popup/ItemListView.tsx
    - extension/entrypoints/popup/ItemListView.test.tsx
    - extension/entrypoints/popup/autofill/AutofillItemRow.tsx

key-decisions:
  - "Reduced .pv-list's max-height from the pre-existing 320px (~5.3 rows, which let exactly 5 accounts render with zero visual hint that a 6th needed scrolling) to 270px (~4.5 rows) -- a partial row is now visibly cut off, matching the plan's explicit 'cutoff is visibly half a row = scroll affordance' spec. overflow-y:auto itself already existed pre-plan; the actual root cause of Bartek's 'can't scroll' report reads as a discoverability/affordance gap (no visible scrollbar, no cutoff hint) rather than a broken CSS mechanism -- both are now fixed via a token-based thin scrollbar plus the tighter max-height."
  - "Implemented the popup's row-hover border via `box-shadow: inset ...` rather than a real CSS `border` property -- this is what the plan's own 'use inset/transparent-border-at-rest technique' line asks for, and it sidesteps a real concern: AutofillItemRow's row sits inside OnThisPageSection's `overflow-y-auto` list, and ItemListView's row sits inside its own `overflow-y-auto` list -- a real border+padding-reservation change risked its rightmost edge getting silently clipped by the ancestor scroll container (CSS spec: setting only overflow-y to non-visible implicitly computes overflow-x to auto too). An inset shadow is contained entirely within the element's own border-box regardless of ancestor overflow, so `OnThisPageSection.tsx` (authorized in files_modified but NOT ultimately touched) needed no container/padding changes at all."
  - "Audited the popup's other hover states (footer auto-lock <select>, header settings/open-vault buttons) for the same light-theme-inversion bug pattern and found them NOT affected: they're plain daisyUI `.select`/`.btn` components using daisyUI's own hover recipe (`color-mix(in oklab, ..., #000 7%)` — see node_modules/daisyui/components/button.css), which mixes toward BLACK regardless of theme. That's already directionally correct for vault-light (darkens) and is the same convention every other button in the app (web included) already uses -- left unchanged rather than force a bespoke override that would diverge from the rest of the app's button behavior."

requirements-completed: []

coverage:
  - id: D1
    description: "The in-field dropdown's and the prompt-window's account lists both scroll -- with 6+ matches, every row exists in the DOM and is reachable via the .pv-list scroll container (max-height ~4.5 rows, token-based thin scrollbar); the pinned header/close/block affordances stay outside the scroll region in both surfaces."
    verification:
      - kind: unit
        ref: "extension/lib/autofill/inpage-overlay.test.ts (Test 13/14/15: 6-match prompt panel and 6-match dropdown panel both render all 6 [data-pv-row] elements inside .pv-list with the header as a separate sibling; the injected stylesheet is asserted to contain .pv-list { max-height: 270px; overflow-y: auto; ... scrollbar-color ... var(--color-base-content) })"
        status: pass
      - kind: integration
        ref: "extension: npx wxt build (chrome-mv3) && npx wxt build -b firefox -- both green, content-relay.js bundle grepped clean of new literal oklch/hex values"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every clickable item row in the popup (the 'Wszystkie' full-vault list AND the 'Na tej stronie' autofill-suggestion list) is flat/borderless at rest and gets an identical button-style border+shadow+press affordance ONLY on hover, via one shared .pv-row-hover class -- no layout shift, no literal colors."
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ItemListView.test.tsx (Test 9: renders both an autofill-suggested row and a 'Wszystkie' row from the same vault, asserts both DOM nodes carry the pv-row-hover class)"
        status: pass
      - kind: integration
        ref: "extension: npx vitest run entrypoints/popup -- 42/42 tests pass (10 in ItemListView.test.tsx, including the new Test 9); npx tsc --noEmit clean of new errors; npx wxt build (chrome-mv3) green, packaged popup CSS bundle grepped for pv-row-hover presence"
        status: pass
    human_judgment: false
  - id: D3
    description: "vault-light's row hover is DARKER than rest (never lighter) while vault-dark stays lighter-on-hover -- the polarity swap Bartek asked for ('zamień miejscami kolor hover i zwykły'), achieved by blending toward var(--color-base-content) (self-adapting per theme) rather than a hardcoded base-200/base-300 swap or a literal color."
    verification: []
    human_judgment: true
    rationale: "Visual polarity (does a color genuinely read as 'darker' vs. 'lighter' to a human eye against the surrounding surface) is a rendering/perception claim that jsdom cannot evaluate -- OKLCH color-mix compositing over a live theme requires a real browser paint. This plan's own <verification> block explicitly calls for a packaged-build check ('hover visible in both themes; light hover darkens'), which is an orchestrator/UAT step, not something this executor can self-certify from unit tests alone. The CSS mechanism itself (color-mix toward --color-base-content, which is near-black in vault-light and near-white in vault-dark) is architecturally verified correct by construction and matches web/src/components/vault/ItemRow.tsx's existing, already-shipped reference pattern -- but the final visual confirmation needs human eyes on a real render."

duration: ~40min
completed: 2026-07-16
status: complete
---

# Phase 11 Plan 09: Popup/overlay live-review fixes — scroll, row hover, light-theme polarity Summary

**In-page account lists (dropdown + prompt window) now scroll with a visible cutoff affordance and a token-styled scrollbar; popup item rows (both "Wszystkie" and "Na tej stronie") share one flat-at-rest, button-style hover-only affordance whose color direction self-adapts per theme via `var(--color-base-content)`, fixing vault-light's inverted hover polarity.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-07-16T13:55:00Z (approx, first Read)
- **Completed:** 2026-07-16T14:37:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- `extension/lib/autofill/inpage-overlay.ts`'s `.pv-list` (the one row-list factory shared by both `renderFormPrompt`'s prompt-window list and `renderFieldDropdown`'s in-field list) now scrolls at a tighter, deliberately-cut max-height (~4.5 rows, 270px) instead of the previous 320px, which let exactly 5 accounts render with zero visual hint that scrolling existed. A token-based thin scrollbar (`--color-base-content` at 20% via `color-mix`, both `scrollbar-color` and WebKit `::-webkit-scrollbar` pseudo-elements) makes the scroll affordance actually discoverable in both themes — the real fix for Bartek's "more than 4 accounts and I can't scroll to see them" live bug.
- `extension/entrypoints/popup/style.css` gained one shared `.pv-row-hover` utility class: flat/borderless at rest, an inset-box-shadow border + subtle two-layer drop shadow on hover, and a translate-down/shadow-removed press on `:active` — the same shape daisyUI's own `.btn` component uses (verified against `node_modules/daisyui/components/button.css`). Applied identically to `ItemListView.tsx`'s "Wszystkie" rows and `AutofillItemRow.tsx`'s "Na tej stronie" rows (the latter previously had ZERO hover styling at all — the "nearly invisible" bug Bartek flagged).
- The hover/press color always blends toward `var(--color-base-content)` (never a literal, never a hardcoded base-200/base-300 swap) — this is the actual fix for the vault-light polarity inversion: `base-content` is near-white in vault-dark (blending toward it lightens the row) and near-black in vault-light (blending toward it darkens the row), so the correct per-theme direction falls out of the token itself, matching `web/src/components/vault/ItemRow.tsx`'s already-shipped `hover:bg-base-content/[0.06]` pattern.
- Audited the popup's other hover-bearing controls (footer auto-lock select, header settings/open-vault buttons) — both are plain daisyUI `.select`/`.btn` components whose own recipe mixes toward black on hover, which is already directionally correct for vault-light and consistent with every other button in the app; left unchanged rather than introduce a bespoke override.
- Both `npx wxt build` (chrome-mv3) and `npx wxt build -b firefox` (firefox-mv2) are green; the packaged popup CSS bundle and content-relay bundle were grepped to confirm `pv-row-hover` shipped and no new literal color values were introduced by this plan's own edits.

## Task Commits

Each task was committed atomically:

1. **Task 1: Scroll for in-page account lists (dropdown + prompt window)** - `0631b6d` (fix)
2. **Task 2: Popup row hover affordance + light-theme hover polarity** - `f5f9122` (fix)

## Files Created/Modified

- `extension/lib/autofill/inpage-overlay.ts` - `.pv-list` max-height tuned to ~4.5 rows + token-based thin scrollbar (shared by both surfaces)
- `extension/lib/autofill/inpage-overlay.test.ts` - 3 new tests (Test 13/14/15): 6-match prompt/dropdown lists render all rows, stylesheet asserted to carry the max-height/overflow-y/scrollbar-color rules
- `extension/entrypoints/popup/style.css` - new shared `.pv-row-hover` utility class (rest/hover/active states, token-only)
- `extension/entrypoints/popup/ItemListView.tsx` - "Wszystkie" row switched from the one-off `hover:bg-base-content/[0.06]` to the shared `pv-row-hover` class
- `extension/entrypoints/popup/ItemListView.test.tsx` - 1 new test (Test 9): asserts both an autofill-suggested row and a "Wszystkie" row carry `pv-row-hover`
- `extension/entrypoints/popup/autofill/AutofillItemRow.tsx` - row div gained `pv-row-hover` (previously had zero hover styling)

## Decisions Made

- **270px (~4.5 rows) max-height, not a round number** — computed from `.pv-row`'s actual box model (20px vertical padding + ~39px two-line label/sub stack + 1px border), deliberately chosen so a partial row is visibly cut off as a "there's more, scroll" cue, per the plan's explicit spec.
- **Inset box-shadow instead of a real `border` for the row hover ring** — avoids any box-sizing/layout math (true zero-layout-shift) and, critically, is never clipped by the row's own ancestor `overflow-y:auto` scroll container the way a real border could be. This is why `OnThisPageSection.tsx` (authorized in `files_modified`) ultimately needed no changes — the technique made container-level adjustments unnecessary.
- **`var(--color-base-content)` as the sole hover-blend target, no per-theme branching** — this single choice is what fixes the light-theme polarity bug; no `[data-theme="vault-light"]` override or conditional logic was needed anywhere.
- **Left daisyUI-native hover states (select, ghost buttons) unchanged** — they already darken toward black on hover (correct for light, consistent with the rest of the app), so "aligning" them to the row's own base-content-blend recipe would have been an unnecessary divergence from daisyUI's own convention used everywhere else.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fresh worktree had no `node_modules` in `extension/`**
- **Found during:** Pre-Task-1 setup (attempting to read daisyUI's compiled button CSS to confirm the "web button recipe" the plan references)
- **Issue:** `extension/node_modules` did not exist — a fresh worktree checkout, matching the orchestrator's own reinforcement note ("Fresh worktree: npm install in extension/ ... before tests/builds").
- **Fix:** Ran `npm install` inside `extension/` (531 packages, `file:../packages/pv-ui` dependency resolved correctly).
- **Files modified:** none (dependency install only; `package-lock.json` was already committed and unchanged by this install)
- **Verification:** `npx vitest run`, `npx tsc --noEmit`, `npx wxt build` all runnable afterward.
- **Committed in:** n/a (no code change, `node_modules` is gitignored)

**2. [Rule 3 - Blocking] Missing WASM build artifact blocked the plan's own required `npx wxt build` verification**
- **Found during:** Pre-Task-2-verification (`npx wxt build`)
- **Issue:** Same pre-existing environment gap `11-01-SUMMARY.md`/`11-08-SUMMARY.md` both documented — `extension/lib/crypto/wasm/` and `extension/public/wasm/pv_wasm_bg.wasm` don't exist until `scripts/build-wasm.sh` runs (fresh worktree, `wasm-bindgen-cli` not pre-installed).
- **Fix:** Ran `bash scripts/build-wasm.sh` (cargo + rustup already available; `wasm-bindgen-cli` installed via `cargo install`, matching 11-08's own precedent for this exact gap). ~15s build.
- **Files modified:** none (build output only, gitignored — confirmed via `git status --short` showing no new untracked files after the build)
- **Verification:** `npx wxt build` and `npx wxt build -b firefox` both green afterward.
- **Committed in:** n/a (no code change — build artifact only, gitignored)

---

**Total deviations:** 2 auto-fixed (both Rule 3 environment-setup gaps, both with direct precedent from earlier plans in this phase). No scope creep — nothing outside this plan's own file list was touched.

## Issues Encountered

None beyond the deviations documented above — no auth gates, no checkpoints, no architectural decisions requiring a stop.

One pre-existing, unrelated test-run artifact was observed and logged (not fixed, out of scope): `npx vitest run` reports one "Unhandled Rejection" (`TypeError: Cannot read properties of undefined (reading 'request')` at `ServerConfigView.tsx:95:32`, surfacing during `App.test.tsx`). Neither file is in this plan's `files_modified`; the full suite still reports 395/395 tests passing (42/42 in the popup subset) — the rejection does not fail any test. Logged to `.planning/phases/11-generate-capture/deferred-items.md`.

## Known Stubs

None. Every change is real, token-driven CSS wired to real DOM state (row counts, scroll containers, hover classes) — no placeholder values or "coming soon" states.

## Threat Flags

None beyond this plan's own pre-declared threat register entry (T-11-40, disposition: mitigate, verified — the scroll-container change touches only `.pv-list`'s CSS box model; closed-shadow isolation, metadata-only row content (`[data-pv-row]`'s `data-item-id`/`data-kind` attributes, no value ever), and the existing fill-gating/confirm-flow logic are all byte-identical, confirmed via the full `npx vitest run lib/autofill/inpage-overlay` pass, 18/18 including the 10 pre-existing behavioral tests this plan did not touch). No new network endpoints, auth paths, file-access patterns, or schema changes were introduced; this plan is presentation-only.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Packaged-build UAT with BOTH-theme screenshots is required before Bartek's review**, per this plan's own `<verification>` block: "6 accounts on one site → all reachable in dropdown and prompt; hover visible in both themes; light hover darkens." This is explicitly an orchestrator/human-judgment step (see coverage D3's rationale) — the CSS mechanism is architecturally verified correct (token-only, self-adapting polarity by construction), but final visual confirmation needs a real browser render.
- All existing Phase 10/11 overlay/popup behavior (safeRemove teardown races, reposition-on-scroll, fill/copy/navigation handlers, gating, dismiss/blockSite state) is confirmed byte-identical — full `npx vitest run` reports 395/395 tests passing across all 40 test files, zero regressions from this plan's presentation-only changes.
- The WASM artifact this plan built to unblock its own verification is gitignored and worktree-local; a fresh checkout/worktree will need `bash scripts/build-wasm.sh` run again before `npx wxt build`/`router.test.ts` will pass there — expected, pre-existing behavior, not introduced by this plan.
- With this plan, Bartek's 2026-07-16 live-review punch list (scroll, hover visibility, light-theme polarity) is functionally complete pending the human visual UAT pass noted above.

---
*Phase: 11-generate-capture*
*Completed: 2026-07-16*

## Self-Check: PASSED

All 6 modified files + this SUMMARY.md exist on disk; both task commit hashes (0631b6d, f5f9122) verified present in git log.

## Addendum (2026-07-16, live-review follow-up fix): missed-scope catch — the popup's own nested scroll

Bartek's live-review scroll complaint that prompted this plan's Task 1 (`.pv-list` scroll affordance for the in-page dropdown/prompt-window account lists) was interpreted narrowly — it turned out to ALSO describe the popup itself: the whole popup page scrolled (header, search box, and the auto-lock footer all scrolling away with it) stacked on top of `ItemListView`'s own "Wszystkie" list scroll, i.e. genuine scroll-in-scroll. That surface was not in this plan's original scope and was caught and fixed in a follow-up commit (`a08e9b2`, `fix(11-09): popup single-scroll shell`), not this plan's own two task commits.

**Root cause:** `index.html`'s `body` had `width: 380px` but no fixed height or `overflow: hidden` — so once `ItemListView`'s natural content height (top bar + search + "Na tej stronie" + "Wszystkie" header + the "Wszystkie" list's own hand-guessed `min-h-[220px] max-h-[440px]` + footer) exceeded Chrome's ~600px popup ceiling, the outer document itself grew a scrollbar on top of the inner list's own `overflow-y-auto` — two scroll containers nested inside one popup.

**Fix:** gave the popup a real fixed-height (600px) shell — `index.html`'s `body` (`height: 600px; overflow: hidden`) plus `style.css`'s `html { overflow: hidden }` / `#root { height: 100% }` — and restructured every view's root to fill that shell via Tailwind `h-full`/`flex-1 min-h-0` so each view has exactly ONE scrollable region: `ItemListView`'s "Wszystkie" row list (now `flex-1 min-h-0 overflow-y-auto`, replacing the old `min-h-[220px] max-h-[440px]` guess, with a new `.pv-scroll-thin` utility matching this plan's own `.pv-list` token-based scrollbar recipe) is the ONE scroll region for the list view; `ServerConfigView`, `UnlockView`, and `ItemDetailView` each get a single whole-view `overflow-y-auto` fallback since they have no pinned-header/footer split to preserve. Presentation-only — 401/401 vitest tests, `tsc --noEmit`, and both `wxt build` targets (chrome-mv3 + firefox-mv2) green, zero behavioral changes.

**Files touched:** `extension/entrypoints/popup/index.html`, `extension/entrypoints/popup/style.css`, `extension/entrypoints/popup/App.tsx`, `extension/entrypoints/popup/ItemListView.tsx`, `extension/entrypoints/popup/ServerConfigView.tsx`, `extension/entrypoints/popup/UnlockView.tsx`, `extension/entrypoints/popup/ItemDetailView.tsx`.

**Lesson for future live-review triage:** "scroll-in-scroll" or "can't scroll" reports from Bartek should be checked against BOTH the in-page/shadow-DOM surfaces AND the popup's own outer document — a fix scoped to only one of the two can leave the other genuinely broken even when the reported symptom sounds identical.
