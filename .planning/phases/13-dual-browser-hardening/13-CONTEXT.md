# Phase 13: Dual-Browser Hardening - Context
**Gathered:** 2026-07-14
**Status:** Ready for planning

## Phase Boundary

**In scope for Phase 13:**
- A dedicated, systematic re-verification pass of every v0.2 feature built in Phases 8-12 (WASM background lifecycle, session unlock, sync, autofill login/TOTP/card/identity, generate & capture, passkey provider) against both `wxt dev -b chrome` and `wxt dev -b firefox`, and against a packaged/signed build (not just dev mode).
- Fixing genuine Chrome/Firefox divergence bugs discovered during this pass (manifest, CSP, background-lifecycle, MAIN-world content-script injection differences) — this phase owns the *fix*, not just the *finding*.
- Explicit, legible in-UI degradation wherever Firefox genuinely lacks a capability (most notably PRF) — copy, messaging, and fallback UX for those gaps.
- `browser_specific_settings.gecko` (extension ID, `strict_min_version`) deliberately pinned in `wxt.config.ts`.
- `web-ext lint` passing on the Firefox packaged build with the WASM CSP (`wasm-unsafe-eval`) intact.
- Re-confirming the Firefox MV2-vs-MV3 background target decision made in Phase 8 still holds after all features are built, and that it's the one actually shipped.

**Explicitly OUT of scope (belongs to earlier phases, not to be re-opened here):**
- Building any NEW user-facing feature (unlock, autofill, generate/capture, passkey provider) — those are Phases 9-12's job; Phase 13 verifies and hardens what already exists.
- The initial WXT scaffold / MV3-in-background WASM spike and the initial Firefox manifest-target decision — Phase 8's job (Phase 13 re-verifies it still holds under full feature load, doesn't redo it from scratch).
- passkey-rs integration and the MAIN-world RPC shim design itself — Phase 12's job; Phase 13 only re-verifies the shipped behavior cross-browser and the Phase 12 security-review gate is not repeated here (that gate already covers the zero-knowledge boundary; Phase 13 is about behavioral parity, not re-auditing the boundary).
- Safari/iOS — out of scope for the entire v0.2 milestone per PROJECT.md platform ordering (web → extension → mobile); Firefox is the only non-Chromium target this phase covers.
- AMO (Mozilla add-on store) submission/publishing itself — this phase only needs `web-ext lint` to pass, not a completed store listing.
- FIDO CXF import/export — explicitly deferred per REQUIREMENTS.md Future Requirements.

## Locked Decisions

- **D-01**: Every v0.2 feature (unlock/session, autofill, generate & capture, passkey provider) must be manually re-verified on both `wxt dev -b chrome` and `wxt dev -b firefox` (or a signed `web-ext` build) before this phase is considered done. (ROADMAP Phase 13 Success Criterion #1)
- **D-02**: The Firefox packaged/signed build must pass `web-ext lint` with the WASM CSP (`wasm-unsafe-eval`) configuration intact. (ROADMAP SC #2; PITFALLS.md Pitfall 4 & 8)
- **D-03**: Wherever Firefox lacks a capability the Chromium build has (most notably PRF), the UI must communicate it explicitly — never silently fail or silently degrade. Message must be specific ("fast unlock isn't available for this passkey on this browser — use your password"), not a generic error. (ROADMAP SC #3; PITFALLS.md Pitfall 2 remediation, already cited verbatim in PITFALLS.md)
- **D-04**: `browser_specific_settings.gecko` (extension ID, `strict_min_version`) must be pinned deliberately in `wxt.config.ts`, not left to a WXT/dev-mode default — an ephemeral dev-mode extension ID breaks persisted `chrome.storage.session` state across dev sessions. (ROADMAP SC #4; PITFALLS.md Pitfall 8)
- **D-05 (INVARIANT, re-verified not re-decided)**: The unlocked User Key lives ONLY in `chrome.storage.session` on both browsers — never `storage.local`, never a module-level JS variable. Phase 13 must confirm this invariant holds identically on Firefox's event-page background model, which tolerates longer-lived state but must not be relied upon for parity. (Global INVARIANTS; STACK.md line 66, 85-86)
- **D-06 (INVARIANT, re-verified not re-decided)**: PRF is Chromium-first; the password-unlock path must remain fully functional as the universal fallback on Firefox — PRF must never become a hard requirement anywhere in the extension UX. (Global INVARIANTS; PITFALLS.md Pitfall 2)
- **D-07**: The Firefox MV2-vs-MV3 background target decision is made and pinned in Phase 8 (`wxt.config.ts`); Phase 13 re-verifies it still holds under the full feature set built in Phases 9-12, rather than re-deciding it. (ROADMAP Phase 8 SC #4, cross-referenced by Phase 13 SC #4)
- **D-08** (RECONCILED 2026-07-15 against Phase 12's actual architecture — the original wording here described a unified manual `document.createElement('script')` mechanism that 12-03-PLAN.md deliberately does NOT build): Phase 12 ships a **per-browser** MAIN-world injection: Chrome uses WXT's declarative `world: 'MAIN'` content script (stronger document_start guarantee against the patch race), Firefox uses `injectScript()` from an ISOLATED-world content script (Firefox lacks declarative MAIN-world support). Phase 13 verifies the OUTCOME is identical on both browsers, mechanism notwithstanding: (1) `navigator.credentials.create/get` are patched before page scripts can observe the unpatched originals, (2) no key material is reachable from MAIN-world JS, (3) fallthrough to native works. Verify whichever mechanism 12 actually shipped per 12-03-SUMMARY.md — never assert a mechanism the builder phase didn't use. (Supersedes STACK.md line 68's older unified-createElement recommendation.)
- **D-09**: Target the strictest common-denominator CSP (`script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`) for extension pages on both browsers rather than branching CSP per browser. (STACK.md line 68, 95; PITFALLS.md Pitfall 4)

## Discretion Areas

- Exact wording/placement of the Firefox PRF-unavailable messaging (banner vs. inline copy vs. tooltip) — UX detail left to the planner/UI-researcher, as long as it's explicit and specific per D-03.
- Whether the Firefox hardening pass is organized as one comprehensive UAT checklist plan or split into per-feature-area sub-plans (session/unlock, autofill, capture, provider) — an execution-organization choice for the planner.
- Whether to script/automate the dual-browser UAT re-run (e.g., a checklist doc, a Playwright pass per browser) vs. a fully manual pass — left to executor discretion given "solo indie" budget constraints; manual is acceptable but must be systematic (every SC from Phases 9-12 re-checked, not spot-checked).
- Any minor Firefox-specific copy/icon/UI tweaks needed purely for visual parity (not functional parity) are discretionary polish, not blocking.
- Whether `web-ext lint` is run via WXT's built-in invocation or a separate CLI step — tooling detail for planner/executor.

## Open Questions for the human

- None identified. This phase's scope, decisions, and acceptance bar are already fully specified by ROADMAP Phase 13's four success criteria and the v0.2 research findings (Pitfalls 2, 4, 8); no open product/UX judgment call currently requires Bartek's input. If the hardening pass surfaces an unexpected Firefox capability gap beyond PRF (e.g., an autofill or provider API that behaves materially differently), that should be raised to Bartek as a new question at that time rather than speculated on here.

## Deferred Ideas

- AMO (Mozilla Add-ons) store submission and listing — `web-ext lint` passing is the bar for this phase; actual publishing is a future, non-blocking milestone step.
- Automated CI matrix running both `wxt build -b chrome` and `wxt build -b firefox` on every push (STACK.md recommends this) — valuable but not required by any Phase 13 success criterion; candidate for a future infra/tooling pass.
- Safari extension support — explicitly out of scope per PROJECT.md's platform ordering (web → extension → Android → iOS → Windows); no Safari-specific hardening belongs in this phase.
- Cross-origin iframe autofill parity nuances beyond what Phase 10/11 already built — tracked separately in REQUIREMENTS.md's "Extension polish (v0.2.x)" future requirements, not this phase's job.
