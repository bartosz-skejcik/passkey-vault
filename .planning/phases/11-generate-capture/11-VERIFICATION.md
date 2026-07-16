---
phase: 11-generate-capture
verified: 2026-07-16T12:45:10Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
---

# Phase 11: Generate & Capture Verification Report

**Phase Goal:** Users get proactive help creating strong passwords on signup and keeping saved logins in sync with what they actually use on sites.
**Verified:** 2026-07-16T12:45:10Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

The four ROADMAP Success Criteria (the phase contract, requirements CAP-01/02/03 + D-06) are each observably implemented, wired end-to-end from content script → messaging protocol → background handler → vault persistence, and covered by passing behavioral unit tests plus corroborating live packaged-build UAT screenshots. All four are behavior-dependent (state transitions: new/update/no-op classification; the independently-computed origin-mismatch flag) and each transition has a dedicated passing test — so they qualify as VERIFIED on behavioral evidence, not symbol presence alone.

### Observable Truths

| # | Truth (ROADMAP SC / Req) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | SC1 / CAP-01 — signup form offers generated strong password, character AND passphrase modes, reusing v0.1 generator | ✓ VERIFIED | `generate-popover.ts` has `Mode = "character" \| "passphrase"` with both mode buttons (charBtn/passBtn, l.332-340) and a charset row gated to character mode; sends `{kind:"generate-request"}` — never generates locally; `generate-handler.ts` l.17/63/74 calls `generateCharacterPassword`/`generatePassphrase` imported from the ported generator; `router.ts` l.205-210 dispatches `generate-request`→`handleGenerateRequest`. Generator logic now single-sourced in `packages/pv-ui/generator/password.ts` (crypto.getRandomValues + rejection sampling, 74 lines, real impl). UAT: `11-cap01-popover.png`, `11-cap01-passphrase.png`. |
| 2 | SC2 / CAP-02 — after successful submit, prompt to save new login attributed to correct origin | ✓ VERIFIED | `content-relay.content.ts` l.299-335: `attachSubmitWatcher`→`sendMessage({kind:"capture.propose"})`→routes `action:"new"` to `showSaveUpdateToast`; confirm re-sends `capture.confirm`→`confirmNewLogin` (`capture-handler.ts` l.149-162) which encrypts via `encryptItem`→`splitCombinedEncryptedItem`→`createItem`. Origin fed to classifier is the TRUSTED `guard.origin` from `assertContentSender` (`router.ts` l.281-291), never the content script's self-report. Tests: `capture-handler.test.ts` `action:"new"` (l.114). UAT: `11-cap02-save-toast.png`, `11-cap02-popup-item.png`. |
| 3 | SC3 / CAP-03 — password change on a site with an existing saved login is detected and offered as an update, not a duplicate | ✓ VERIFIED | `classifySubmit` (`capture-handler.ts` l.84-115) matches on origin+username, returns `action:"update"` (with itemId+currentRevision) when password differs, `action:"no-op"` when identical. `confirmUpdateLogin` l.172-208 re-verifies ownership, writes at `currentRevision+1` via `updateItem` (guards `RevisionConflictError`) — no `createItem`, so no duplicate. Tests: `capture-handler.test.ts` `"update"` (l.125), `"no-op"` unchanged-resubmit (l.132-140). UAT: `11-cap03-update-toast.png`. |
| 4 | SC4 / D-06 — save/update prompts show actual originating domain and warn explicitly on origin mismatch (cross-origin iframe) | ✓ VERIFIED | Mismatch is computed INDEPENDENTLY in the background: `classifySubmit` l.90 `mismatch = frameOrigin !== senderTopOrigin`, where both origins are browser-derived (`guard.origin` + `deriveSenderTopOrigin(sender)`), never trusting the content-script payload. `content-relay.content.ts` l.312-321 routes `mismatch:true` ALWAYS to `showMismatchModal` (never the toast); modal interpolates BOTH `frameOrigin` and `topOrigin` into the warning banner (`mismatch-modal.ts` l.264-266), keeps error-token contrast in light theme (serious). Tests: mismatch:true on new/update/no-op branches + mismatch:false same-origin (`capture-handler.test.ts` l.143-180). UAT: `11-d06-mismatch-modal.png` (both origins in full copy, real cross-origin iframe). |

**Score:** 4/4 truths verified (0 present-but-behavior-unverified)

### Supporting Plan Must-Haves (11-06..11-09 — non-CAP scope, D-11/D-12/D-13)

| Must-have | Status | Evidence |
| --- | --- | --- |
| D-11 — popup "Na tej stronie" lists origin-matched LOGIN items on form-less pages; card/identity/totp stay detection-gated | ✓ VERIFIED | `autofill-match.ts` l.229 `if (kind !== "login" && !detectResponse.detected[kind]) continue;` — login exempt from detection gate but still origin-matched (l.232); totp policy unchanged. Tests in `autofill-match.test.ts`. |
| D-13 — `packages/pv-ui` is single source of truth for tokens + generator; no byte-for-byte copies remain | ✓ VERIFIED | `extension/lib/generator/password.ts` and `web/src/lib/generator/password.ts` are both thin `export * from "pv-ui/generator/password"` shims; `web/src/app/globals.css` l.11 `@import "pv-ui/tokens.css"`; `tokens.css` carries vault-dark + vault-light OKLCH blocks. |
| D-12 — theme mirrored from web app across surfaces | ✓ VERIFIED | `theme-mirror.ts` reads `html[data-theme]` on load + MutationObserver, persists to `chrome.storage.local`, resolve chain mirror→prefers-color-scheme→vault-dark; `captureThemeFromWebApp` wired in `content-relay.content.ts` l.247. UAT theme parity screenshots (dark+light for generator/toast/mismatch/popup). |
| Docker single-container build copies packages/ | ✓ VERIFIED | `Dockerfile` l.99 `COPY packages/pv-ui/ /app/packages/pv-ui/` before the web install/build step. |
| 11-09 — in-page account lists scroll; popup rows get hover-only button affordance; vault-light darker-on-hover | ✓ VERIFIED | `inpage-overlay.ts` l.213-219 `.pv-list { max-height: 270px; overflow-y: auto }`; `popup/style.css` l.88-104 `.pv-row-hover` rest/hover/active states. UAT `scroll-dropdown.png`, `popup-row-hover.png`. |

### Required Artifacts

| Artifact | Status | Details |
| --- | --- | --- |
| `extension/lib/messaging/ext-protocol.ts` | ✓ VERIFIED | Discriminated-union members for generate-request / capture.propose / capture.confirm + response map |
| `extension/entrypoints/background/generate-handler.ts` | ✓ VERIFIED | `handleGenerateRequest` wired into router, calls ported generator |
| `extension/entrypoints/background/capture-handler.ts` | ✓ VERIFIED | `classifySubmit`/`confirmNewLogin`/`confirmUpdateLogin` — real encrypt-then-persist via v0.1 shape |
| `extension/lib/autofill/generate-popover.ts` | ✓ VERIFIED | Both modes, click-triggered, closed shadow root, sends generate-request |
| `extension/lib/autofill/save-update-toast.ts` | ✓ VERIFIED | new/update render, no-op silent (Pitfall B) |
| `extension/lib/autofill/mismatch-modal.ts` | ✓ VERIFIED | Blocking modal, both origins in full |
| `extension/lib/theme/theme-mirror.ts` | ✓ VERIFIED | Mirror chain capture/resolve/watch |
| `packages/pv-ui/{generator,tokens.css}` | ✓ VERIFIED | Single-source generator + both theme token blocks |
| `extension/e2e-fixtures/adversarial-iframe/{top,attacker-frame}.html` | ✓ VERIFIED | Cross-origin two-origin fixture present |

### Key Link Verification

| From | To | Status |
| --- | --- | --- |
| generate-handler.ts → pv-ui generator | `generateCharacterPassword`/`generatePassphrase` | ✓ WIRED |
| router.ts → generate/capture handlers | `generate-request`/`capture.propose`/`capture.confirm` dispatch, sender-guarded | ✓ WIRED |
| content-relay → capture.propose → modal/toast | routes on independently-computed `mismatch` | ✓ WIRED |
| capture-handler → vault-store | `encryptItem`/`splitCombinedEncryptedItem`/`createItem`/`updateItem` | ✓ WIRED |
| router.ts frameOrigin ← trusted sender | `guard.origin`, payload field discarded for security decision (CR-01 fix) | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Extension unit suite (incl. capture new/update/no-op/mismatch transitions) | `npx vitest run` | 401/401 pass, 40 files | ✓ PASS |
| Web unit suite (generator shared source unchanged) | `npx vitest run` (web) | 345/345 pass, 49 files | ✓ PASS |
| Extension type-check | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| WASM crypto artifact present | `ls lib/crypto/wasm/` | present | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
| --- | --- | --- | --- |
| CAP-01 | 11-01, 11-02, 11-04 | ✓ SATISFIED | Truth 1 |
| CAP-02 | 11-02, 11-03, 11-05 | ✓ SATISFIED | Truth 2 |
| CAP-03 | 11-02, 11-03, 11-05 | ✓ SATISFIED | Truth 3 |

REQUIREMENTS.md maps exactly CAP-01/02/03 to Phase 11 — all three accounted for, no orphaned requirements. Plans 11-06..11-09 carry empty `requirements` (D-11/D-12/D-13 UI/theme additions, correctly not tied to CAP IDs).

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
| --- | --- | --- | --- |
| (none) — phase-11 source files | TBD/FIXME/XXX/TODO/placeholder | — | Clean: no debt markers in any phase-11 modified source |
| `entrypoints/popup/ServerConfigView.tsx` (Phase 9, NOT modified in 11) | Unhandled rejection in App.test.tsx during run | ℹ️ Info | Pre-existing async-cleanup race documented in `deferred-items.md`; all 401 tests still pass; out of phase-11 scope |

### Human Verification Required

None outstanding. All four behavior-dependent truths have passing behavioral unit tests for their state transitions, and live packaged-build UAT (28/28 capture harness + 12/12 theme-parity + scroll/hover visual probes, screenshots in `uat-screenshots/`) plus two documented Bartek live-review rounds (11-REVIEW.md / 11-REVIEW-FIX.md, with the WR-03 cosmetic-fix regression caught and corrected to the real `ensureItemsHydrated` gate, commit 7b48ba7) already exercised the runtime UI flows and taste calls.

### Gaps Summary

No gaps. Every ROADMAP Success Criterion is implemented at code truth (verified by grep/read, not SUMMARY claims), correctly wired end-to-end with the zero-knowledge invariant intact (generator + encryption run only in the background; the security-critical origin is derived from the trusted browser-supplied sender, never the content script's self-report — the historical Bitwarden CVE-class cross-origin-iframe bug is closed by design and tested on all classification branches). Requirements CAP-01/02/03 fully covered; supporting D-11/D-12/D-13 additions verified. All gates pass independently: extension 401/401, web 345/345, tsc clean, WASM present.

---

_Verified: 2026-07-16T12:45:10Z_
_Verifier: Claude (gsd-verifier)_
