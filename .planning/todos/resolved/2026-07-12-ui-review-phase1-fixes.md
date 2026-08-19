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

---

**RESOLVED 2026-08-19 (backlog sweep): all three findings were stale — already fixed in earlier phases.**
Finding 1 (light-theme base-300==base-200): distinct tokens since Phase 11's pv-ui extraction (`83f3165`),
`tokens.css` vault-light block. Finding 2 (SelfTestCard retry): shipped in Phase 2 (`076fef8`) with the
"Carried-forward Phase 1 UI-REVIEW fix" comment. Finding 3 (copy misdirection): same commit — the string
already reads "przy kroku powyżej" and matches the real DOM order. The sweep added the missing regression
test (`SelfTestCard.test.tsx`, retry-button render + click path, falsification-proven).
