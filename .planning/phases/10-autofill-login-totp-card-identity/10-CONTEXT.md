# Phase 10: Autofill — Login, TOTP, Card & Identity - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning
**Mode:** Autonomous synthesis (no human review loop) — decisions below are derived from ROADMAP success criteria, project INVARIANTS, and v0.2 research (ARCHITECTURE/PITFALLS/FEATURES.md), not invented UX preference.

## Phase Boundary

**In scope (per ROADMAP Phase 10 + FILL-01..04):**
- Detecting login forms on the current page/origin and offering to fill saved username+password, with a picker when multiple accounts match the origin.
- Filling/copying the live TOTP code into a detected 2FA field for the current origin (RFC 6238 code generation already exists in pv-core/WASM from v0.1 Phase 6 — reused, not reimplemented).
- Detecting credit-card fields (number, expiry, CVV, cardholder) on a same-origin form and filling from a saved card item.
- Detecting identity fields (name, address, email, phone) and filling from a saved identity item.
- The ISOLATED-world content-relay script that owns DOM field-detection, and its message contract to the background service worker (which alone decrypts and returns fill values).
- Gesture-gating (no autofill without an explicit user click) and same-origin/top-frame verification (no cross-origin-iframe leakage), verified against a deliberately constructed adversarial iframe test page.

**Explicitly OUT of scope for Phase 10 (belongs to neighbouring phases):**
- Passkey provider (`navigator.credentials` MAIN-world patch, `credentials.create()`/`.get()`) — Phase 12. Phase 10 does not touch MAIN world at all; it is entirely an ISOLATED-content-script + background feature.
- Generated-password suggestion on signup forms, save-new-login prompt after submit, password-change detection — Phase 11 (CAP-01/02/03). Phase 10 is fill-only; it does not capture or write back to the vault.
- Auto-submitting forms after fill — permanently out of scope per REQUIREMENTS.md "Out of Scope" table (anti-feature).
- Icon-in-field indicator polish and right-click context-menu quick actions — deferred to v0.2.x per REQUIREMENTS.md "Future Requirements."
- Cross-origin iframe *card-field* autofill parity with 1Password — deferred to v1+ per REQUIREMENTS.md; Phase 10 only needs to correctly **refuse** cross-origin iframe fills, not achieve iframe-aware parity.
- Session unlock, popup shell, and the REST/WS sync client that supplies real vault data — Phase 9 (a hard dependency; Phase 10 assumes an already-unlocked session exists).
- The background message-passing protocol's *foundational* wiring is a Phase 9 deliverable, but Phase 10 is where it's first exercised end-to-end on a read-heavy, non-security-critical operation (per ARCHITECTURE.md's explicit build-order rationale — autofill before the passkey-provider patch, deliberately, to de-risk the messaging pipeline on lower-stakes operations first).

## Locked Decisions

- **D-01: No MAIN-world code in this phase.** Autofill is implemented entirely in an ISOLATED-world content script (`content-relay`) that owns DOM field-detection and fill, talking to the background service worker over `browser.runtime.sendMessage`/`Port`. (ARCHITECTURE.md: MAIN-world is reserved for the passkey-provider patch in Phase 12; autofill needs no page-context override.)
- **D-02: Background is the sole decrypt/crypto boundary.** The content-relay never imports `pv-wasm` or touches key material; it sends `{kind: 'autofill.match', origin}`-style requests and receives only the minimal plaintext fill values needed for the matched item(s) — never the whole vault. (INVARIANT: zero-knowledge / no key material outside background; ARCHITECTURE.md Anti-Pattern 1.)
- **D-03: Every fill requires an explicit user gesture.** No autofill on page load, no silent fill. (ROADMAP SC #5; PITFALLS.md Pitfall 7 mitigation; REQUIREMENTS.md "Out of Scope" — auto-submit is the sibling anti-feature already forbidden.)
- **D-04: Cross-origin iframe fills are refused by default.** Top-level-page credentials/card/identity data must never fill into a cross-origin iframe; a subframe only gets fills if its own origin independently matches a stored item. This must be verified against a deliberately constructed adversarial iframe test page before the phase is considered done. (ROADMAP SC #5 — explicit acceptance criterion; PITFALLS.md Pitfall 7, citing the real historical Bitwarden CVE-class bug and Mozilla Bugzilla #786276.)
- **D-05: `autocomplete`-attribute-first, score-thresholded field detection for card/identity.** Prioritize standardized `autocomplete` values (`cc-number`, `cc-exp`, `cc-csc`, `given-name`, `family-name`, `street-address`, etc.) as the primary signal; fall back to name/id/label-text pattern matching only when `autocomplete` is absent; require a minimum confidence score before showing any fill affordance. Never fill card/identity data without an explicit click (higher stakes than login). (PITFALLS.md Pitfall 6 — this is the documented mitigation for the "false positive / erodes trust" failure mode, not a discretionary choice.)
- **D-06: Login fields use the well-established `type="password"`/`autocomplete="username|current-password"` signal**, not heuristic scoring — login detection is lower-risk and standardized (per FEATURES.md, login autofill complexity is MEDIUM vs. card/identity's MEDIUM-HIGH specifically because of this).
- **D-07: Multi-account picker when more than one saved login matches the current origin** — explicit ROADMAP SC #1 requirement, not a nice-to-have.
- **D-08: TOTP fill reuses the existing RFC 6238 code generator from pv-core/WASM (v0.1 Phase 6)** — no new TOTP math is written in this phase; the extension only reads the live code from background and fills/copies it. (PROJECT.md validated requirement; CLAUDE.md "reuse pv-core, do not reimplement crypto.")
- **D-09: Message protocol lives in a typed contract layer** (e.g. `lib/messaging/`), distinct message kinds for page↔content (not used this phase) vs. content↔background (used this phase) — avoids ad-hoc `if (msg.type === ...)` sprawl as later phases (11, 12) add more message kinds to the same channel. (ARCHITECTURE.md's explicit scaling-risk callout.)
- **D-10: Content-relay must recompute frame/origin context on every fill request** — never trust a cached assumption that a frame's origin equals the top-level page's origin, since content scripts run per-frame including nested iframes. (PITFALLS.md Pitfall 7's root cause.)
- **D-11: Depends on Phase 9's session core** — Phase 10 assumes an unlocked `chrome.storage.session` key already exists; it does not implement unlock, lock, or auto-lock timeout itself (that's Phase 9 / EXT-02/03). If Phase 9 isn't complete when Phase 10 plans, the plan must treat "vault unlocked" as a precondition/fixture, not something this phase builds.
- **D-12: No autofill of card/identity data without an explicit click, ever** (stricter than login) — explicitly separate from D-03 because PITFALLS.md calls out card/identity as needing an even higher confirmation bar than login/password fill.

## Discretion Areas

(Left to the planner / UI-researcher / executor — genuine implementation choices, not locked by ROADMAP/research.)

- Exact visual affordance for "a fillable field was detected" (icon-in-field overlay vs. browser-native-looking dropdown vs. extension-popup-driven picker) — FEATURES.md flags icon-in-field polish as v0.2.x, so Phase 10's MVP affordance can be minimal (e.g., trigger fill from the popup's item list rather than an in-page overlay) as long as D-03/D-12 (gesture-gated) hold. UI-hint is set on this phase in ROADMAP, so a UI-researcher pass is expected to resolve this.
- Whether the multi-account picker (D-07) renders in-page (overlay) or in the popup.
- Exact score thresholds/weights for the card/identity detection heuristic (D-05) — PITFALLS.md prescribes the *approach* (autocomplete-first, scored, thresholded) but not exact numeric weights; executor may tune based on a curated set of real-world test forms.
- Whether TOTP "fill" writes into the field directly or falls back to clipboard-copy-with-toast when no OTP-shaped field is detected (ROADMAP SC #2 explicitly allows either: "fills or copies").
- Internal message-kind naming/shape within the `lib/messaging/` contract layer (D-09) — implementation detail, not a product decision.
- How the content-relay decides "current origin" for MutationObserver-driven SPA re-detection (debounce/throttle strategy) — PITFALLS.md's technical-debt table flags naive whole-document MutationObservers as a performance anti-pattern; the specific debounce approach is an executor call.

## Open Questions for the human

(Real product/UX calls a human should weigh in on at review — kept short since this phase runs autonomously; surface these to Bartek before/at UAT rather than deciding silently.)

- Should the in-page fill affordance (icon overlay vs. popup-driven) be decided now, or explicitly deferred to a follow-up UI pass once basic detection is proven on real sites? (Research suggests MVP can be popup-driven only, deferring in-page icon overlay to v0.2.x per FEATURES.md — recommend confirming that's acceptable for Phase 10's "done" bar before planning locks it in.)
- For the adversarial cross-origin iframe UAT case (D-04): should this be a hand-built throwaway test page (two localhost origins), or is there an existing test-fixture convention from v0.1 phases to reuse/extend?

## Deferred Ideas

(Not for this phase; captured so they aren't silently lost, per REQUIREMENTS.md "Future Requirements" and FEATURES.md "Add After Validation"/"Future Consideration.")

- Icon-in-field indicator polish (v0.2.x, FEATURES.md).
- Right-click context-menu quick actions (v0.2.x, FEATURES.md).
- Cross-origin iframe card-field autofill *parity* with 1Password (v1+, explicitly out of v0.2 per REQUIREMENTS.md "Future Requirements").
- Password-change detection and save/update prompts — these are Phase 11 (CAP-02/03), not Phase 10, but share the same content-relay DOM instrumentation this phase builds; Phase 11's planner should reuse Phase 10's form-detection plumbing rather than rebuilding it.
- Conditional-mediation-aware autofill (`signal.mediation === 'conditional'`) — mentioned in FEATURES.md as an alternative to icon+click for future refinement, not required for Phase 10's gesture-gating bar.
