---
created: 2026-07-12
source: 01-UI-REVIEW.md (Phase 1 UI audit, score 19/24)
resolves_phase: 2
---

# Apply Phase 1 UI-review priority fixes during Phase 2 shell work

Three WARNING-class findings from the Phase 1 UI audit, to fold into Phase 2 (which builds vault-list UI on these surfaces):

1. **Light theme surface separation** — `vault-light` sets `base-300` equal to `base-200`, so TopBar bottom border and sidebar/canvas divider vanish (`web/src/app/globals.css`). Give light theme a distinct `base-300`/border token per UI-DESIGN.md's "1px borders + surface steps" elevation model.
2. **Fatal self-test error lacks retry** — fatal branch in `SelfTestCard.tsx` omits "Uruchom ponownie" even though `initCrypto()` supports retry after failure.
3. **"patrz błąd poniżej" copy misdirects** — failed-step error detail renders above the summary line; reword or relocate.

Minor (optional): 14px status icons vs 16–20px spec, off-scale 12px spacing (`px-3`/`gap-3`), `aria-disabled` on non-interactive divs, coral wordmark accent missing.
