---
phase: 02-password-auth-vault-core
plan: 08
subsystem: vault
tags: [nextjs, react, daisyui, i18n, security-ui, gap-closure]

# Dependency graph
requires:
  - phase: 02-password-auth-vault-core (plan 06)
    provides: "DetailPanel view-mode field loop + renderCopyButton, GeneratorPopover, aria.showPassword/aria.hidePassword dictionary keys, ItemForm's Eye/EyeOff reveal-toggle convention"
provides:
  - "web/src/components/vault/DetailPanel.tsx — masked-by-default password/card-number fields with a per-field reveal toggle beside the copy button; CVV always masked, never revealable; reveal state resets on item switch"
  - "web/src/components/generator/GeneratorPopover.tsx — dropdown-end anchoring + viewport-clamped width, keeping the popover fully inside the viewport when opened from the right-docked item form"
affects: [03 (any future detail-panel secret field inherits REVEALABLE_FIELDS/MASK convention)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "REVEALABLE_FIELDS set + fixed-length MASK constant in DetailPanel — a field is masked via MONO_FIELDS membership and only gets a reveal toggle via explicit REVEALABLE_FIELDS opt-in; cvv is mono-but-not-revealable by construction"
    - "revealedKeys: Set<string> state reset via useEffect keyed on item.id — required because page.tsx renders <DetailPanel item={...}/> with no key prop, so the component instance survives item switches"
    - "DaisyUI 5 dropdown-end (--anchor-h: span-left) as the sanctioned viewport-overflow fix for dropdowns triggered near a right edge — not a custom positioning hack"
    - "w-[min(320px,calc(100vw-2rem))] Tailwind arbitrary-value clamp as a defensive width bound for popovers on very narrow viewports"

key-files:
  created: []
  modified:
    - web/src/components/vault/DetailPanel.tsx
    - web/src/components/vault/DetailPanel.test.tsx
    - web/src/components/generator/GeneratorPopover.tsx
    - web/src/components/generator/GeneratorPopover.test.tsx

key-decisions:
  - "Fixed ten-bullet MASK ('•'.repeat(10)) instead of masking per-character — the visible mask length must never leak the real secret's character count (threat T-02-29)"
  - "Reveal state keyed on item.id in a useEffect, not a key-prop remount — matches how page.tsx actually mounts DetailPanel (no key), so the reset works in the real app, not just in tests (threat T-02-30)"
  - "Reused aria.showPassword/aria.hidePassword dictionary keys from Plan 02-06's ItemForm verbatim — zero new dictionary entries needed; both PL and EN copy already existed"
  - "dropdown-end chosen over any custom absolute-positioning fix — confirmed in web/node_modules/daisyui/components/dropdown.css that it sets --anchor-h: span-left, anchoring content's right edge to the trigger"

requirements-completed: [UI-03]

coverage:
  - id: D1
    description: "A login item's password and a card item's number render as a fixed-length mask by default in the detail panel's view mode; clicking the per-field reveal toggle shows the real value and flips Eye→EyeOff; clicking again re-masks; each field toggles independently"
    requirement: "UI-03"
    verification:
      - kind: unit
        ref: "web/src/components/vault/DetailPanel.test.tsx#masks a login item's password by default and reveals it after clicking the reveal toggle"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/DetailPanel.test.tsx#masks a card item's number by default and reveals it independently from other fields"
        status: pass
      - kind: other
        ref: "grep -c 'EyeOff' web/src/components/vault/DetailPanel.tsx -> 2"
        status: pass
    human_judgment: false
  - id: D2
    description: "A card item's CVV always renders masked with no reveal toggle rendered for it at all, matching ItemForm's established no-reveal-for-CVV convention"
    requirement: "UI-03"
    verification:
      - kind: unit
        ref: "web/src/components/vault/DetailPanel.test.tsx#always renders the cvv field masked with no reveal toggle"
        status: pass
      - kind: other
        ref: "grep -c 'reveal-cvv' web/src/components/vault/DetailPanel.tsx -> 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "Re-rendering the same mounted DetailPanel instance with a different item prop resets every previously-revealed field back to masked (no cross-item reveal-state leakage)"
    requirement: "UI-03"
    verification:
      - kind: unit
        ref: "web/src/components/vault/DetailPanel.test.tsx#resets a revealed field back to masked when the item prop changes"
        status: pass
    human_judgment: false
  - id: D4
    description: "The generator popover anchors to its trigger's right edge (dropdown-end) so it grows leftward inside the right-docked 400px panel instead of overflowing past the viewport's right edge, with a viewport-clamped width as a defensive bound on narrow screens"
    requirement: "UI-03"
    verification:
      - kind: unit
        ref: "web/src/components/generator/GeneratorPopover.test.tsx#anchors the popover to the trigger's right edge so it stays inside the viewport"
        status: pass
      - kind: other
        ref: "grep -c 'dropdown-end' -> 1; grep -c 'w-\\[320px\\]' -> 0 in GeneratorPopover.tsx"
        status: pass
    human_judgment: false

duration: ~15min
completed: 2026-07-14
status: complete
---

# Phase 02 Plan 08: Detail-Panel Secret Masking & Generator Popover Overflow Summary

**Detail-panel passwords and card numbers now render as a fixed-length mask with a per-field Eye/EyeOff reveal toggle beside the copy button (CVV stays masked with no toggle, reveal state resets on item switch), and the password-generator popover anchors via dropdown-end with a viewport-clamped width so it can never overflow the viewport — closing GAP-02-01 and GAP-02-05.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2 completed
- **Files modified:** 4 (0 created, 4 modified)

## Accomplishments

- `web/src/components/vault/DetailPanel.tsx`: `REVEALABLE_FIELDS` set (`password`, `number`) + fixed ten-bullet `MASK` constant; `revealedKeys` Set state with `isRevealed`/`toggleReveal` helpers and a `useEffect` reset keyed on `item.id`; `displayValueFor()` routing — empty → `"—"` (unchanged), `cvv` → always `MASK`, revealable-but-not-revealed → `MASK`, otherwise the real value; a `reveal-${key}` toggle button rendered directly before the existing copy button, reusing Plan 02-06's `aria.showPassword`/`aria.hidePassword` dictionary keys.
- `web/src/components/generator/GeneratorPopover.tsx`: outer container gained `dropdown-end` (DaisyUI 5's `--anchor-h: span-left` — content's right edge anchors to the trigger, growing leftward inside the right-docked panel); fixed `w-[320px]` replaced with `w-[min(320px,calc(100vw-2rem))]`. All other classes and behavior untouched.
- Tests: 4 new DetailPanel tests (login/card fixtures added — the pre-existing fixture was a note item with no secret fields) + 1 new GeneratorPopover alignment test; all 6 pre-existing GeneratorPopover tests pass unmodified.

## Task Commits

1. **Task 1: Password/card-number reveal toggle in the detail panel (GAP-02-01)** — `d3d9171` (feat)
2. **Task 2: Generator popover stays within the viewport (GAP-02-05)** — `00fd4f8` (fix)

**Plan metadata:** (this commit)

## Files Created/Modified

- `web/src/components/vault/DetailPanel.tsx` - REVEALABLE_FIELDS/MASK, revealedKeys state + item.id reset, displayValueFor, reveal-toggle button
- `web/src/components/vault/DetailPanel.test.tsx` - login/card fixtures, 4 new mask/reveal/reset tests
- `web/src/components/generator/GeneratorPopover.tsx` - dropdown-end anchoring, viewport-clamped width
- `web/src/components/generator/GeneratorPopover.test.tsx` - dropdown-end alignment assertion

## Decisions Made

- Fixed-length mask (ten bullets) so the mask never leaks the real value's character count — direct mitigation for threat T-02-29.
- `useEffect(() => setRevealedKeys(new Set()), [item.id])` rather than relying on a `key`-prop remount, because `page.tsx` mounts `<DetailPanel item={selectedItem}/>` with no `key` — the same component instance survives item switches (threat T-02-30). The re-mask test exercises exactly this via `rerender()`.
- No new dictionary keys — `aria.showPassword`/`aria.hidePassword` (PL+EN) from Plan 02-06 reused verbatim per the plan's key_links directive.
- `dropdown-end` confirmed as the correct DaisyUI 5 mechanism (checked `web/node_modules/daisyui/components/dropdown.css`: sets `--anchor-h: span-left`) rather than any custom positioning hack.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None.

## Next Phase Readiness

- GAP-02-01 and GAP-02-05 from 02-VERIFICATION.md's UAT gap list are closed; the remaining phase-02 gap-closure work continues per the orchestrator's wave plan.
- Any future secret-bearing detail-panel field (e.g. Phase 3 passkey material, TOTP secrets in Phase 6) should join `REVEALABLE_FIELDS` (or deliberately stay out of it, CVV-style) rather than inventing a new masking mechanism.

---
*Phase: 02-password-auth-vault-core*
*Completed: 2026-07-14*

## Self-Check: PASSED

All 4 modified files verified present on disk. Both task commit hashes verified present in git log (`d3d9171`, `00fd4f8`). `cd web && npm test` (137/137 across 21 files) and `npx tsc --noEmit` both green immediately before this SUMMARY was written.
