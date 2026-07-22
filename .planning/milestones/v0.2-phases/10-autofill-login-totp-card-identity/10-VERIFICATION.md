---
phase: 10-autofill-login-totp-card-identity
verified: 2026-07-16T09:30:00Z
status: passed
score: 5/5 success-criteria verified
requirements: [FILL-01, FILL-02, FILL-03, FILL-04]
verified_by: orchestrator + self-driven Playwright UAT of the packaged chrome-mv3 build; sealed on Bartek's explicit sign-off 2026-07-16
---

# Phase 10: Autofill — Login, TOTP, Card & Identity — Verification

**Status:** passed. All five success criteria verified against the PACKAGED chrome-mv3 build in
real headless Chromium (not just unit tests — every phase-8/9 bug had been mock-blind, so each SC
was exercised end-to-end), plus a full round of Bartek's live-review fixes.

## Success criteria

1. **Login form detected; username+password offered, picker when multiple** — PASS.
   Deterministic detection (10-02), origin-gated background match/fill (10-04), ISOLATED
   content-relay native-setter fill (10-05), popup "Na tej stronie" + in-page overlay surfaces.
   Wave-3 UAT (13/13) filled real fields with real input events; multi-account rows render as the
   picker. Email/username focus fixed (BUG-1) and re-proven on netbird's exact markup.
2. **Live TOTP fills/copies into a detected 2FA field** — PASS. Issuer-match + OTP-field gate
   (10-08, Bartek's policy); `probe-totp.js` 6/6: issuer-matched item surfaces, non-matching
   refused, `autofill.totpCode` returns a live 6-digit code.
3. **Card fields fill same-origin** — PASS. Scored autocomplete-first detection (10-03) +
   background fill (10-04); D-12 second-confirm; verified at protocol level (10-07) + component
   tests.
4. **Identity fields fill** — PASS. Same detection/fill path; verified alongside card.
5. **Gesture-gated; no top-level creds into a cross-origin iframe** — PASS. Adversarial
   two-origin fixture (10-07): top page fills, the embedded cross-origin iframe's fields stay
   empty (asserted on the iframe DOM, zero input events). Gesture gate verified empty-before-click
   incl. a 60s idle wait. `frame-guard.ts` origin/frame gate is pure + adversarially unit-tested.

## Security posture

Zero-knowledge held throughout: plaintext flows background→content only; popup/overlay carry
metadata (label, masked hint) — never a secret (the one sanctioned exception is the derived TOTP
code for clipboard copy). Content-frame channel (10-09) is a separate, content-sender-guarded
listener, origin-locked to the sender's own frame; the popup privilege tier stays unreachable from
any page. `activeTab`+`tabs` are the only new permissions (declared, minimal).

## Live-review round (Bartek, 2026-07-16) — all fixed + UAT'd (13/13)

BUG-3 undecryptable-item no longer aborts sync (+wasm deprecated-init gone); popup closes after
fill; in-field dropdown opens on email focus and dismisses on blur; "block this site" persists
across reload; overlay suppressed on the user's own vault origin; dropdown follows the field on
scroll/resize; import-preview table scrolls; login icon Vault→Globe app-wide; in-field "PV"
wordmark; NordPass two-section popup (suggested + all-items, dedup, single empty state, square FAB).

## Deferred (non-blocking, recorded)

- Suggested-section origin boost for pages WITHOUT a detected form (needs a shared pure mask
  module; `maskedHintFor` currently lives in background). Today "Na tej stronie" = origin+detected
  matches — correct on login pages.
- Firefox parity for the whole autofill surface → Phase 13.
- Popup locale currently follows the browser language (bilingual dict present); force-Polish is an
  open question left to Bartek.
