---
phase: 12-passkey-provider
verified: 2026-07-17
status: passed
score: 5/5 must-haves verified + /gsd-secure-phase SECURED (17/17) + Bartek live-UAT accepted (Chrome)
behavior_unverified: 0
overrides_applied: 0
acceptance:
  by: Bartek
  date: 2026-07-17
  surface: packaged chrome-mv3, real Chrome, third-party site (github.com)
  note: >
    Live-review found + fixed 2 issues before acceptance — (1) provider popup + Phase-10 login
    overlay showed simultaneously → Plan 12-07 passkey-priority coordination (passkey hides the
    login overlay; fallthrough re-offers login); (2) Firefox moz-extension CORS deferred to Phase 13
    per Bartek. After reload: "teraz pokazuje tylko passkey — działa. Zamykaj." Post-execution
    security path (D-03/nonce/ack/base64/forward) verified unchanged by 12-07; SECURED audit stands.
    Firefox live-UAT deferred to Phase 13 (dual-browser hardening).
re_verification:
  previous_status: human_needed
  previous_score: 4/5
  gaps_closed:
    - "Consent-gate scope decision (the material blocker): create() + single-match get() now genuinely consent-gated end-to-end (Decision A, Plan 12-05) — no silent-on-unlocked-vault path remains"
    - "ProviderCeremonyView create/single-get states were ORPHANED (no production trigger) — now reachable: App.tsx mounts the view for all three ceremony kinds off the unified storage.session payload"
    - "waitForUnlock() unbounded Promise (no timeout/cancellation) — WR-03: now bounded by CEREMONY_ABANDON_TIMEOUT_MS (120s), unsubscribes + resolves null on abandon"
    - "CR-01: content-relay now base64url-encodes extensions.prf.eval.first/second + evalByCredential before the ISOLATED->background hop (was leaking ArrayBuffer->{})"
    - "CR-02: handleCredentialsGet defaults rpId to sender-origin hostname on omitted rpId (get() no longer silently refuses RPs that omit rpId)"
    - "CR-03: no orphaned credential — WASM mint/persist happens only after explicit confirm; decline/abandon returns fallthrough before wasmCreateProviderCredential is touched"
    - "WR-04: dead boolean PENDING_CEREMONY_KEY write removed — exactly one object payload shape ever written to that key"
    - "WR-01: Firefox Permissions-Policy delegation-aware default (page-bridge-firefox.ts)"
    - "WR-02: prfUnavailableNote reworded off browser-blaming ('This site requested a PRF feature this passkey can't provide')"
    - "IN-02: audit-mainworld-boundary.sh now checks the built MAIN-world bundles too, not just source"
    - "IN-04: lossless round-trip guard for SerializablePasskey"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "On a real third-party site (packaged Chrome build), call navigator.credentials.create() then .get() with a vault-stored passkey"
    expected: "create() shows the consent popup, then on confirm registers an ES256 passkey saved to the vault; a later get() shows consent, then on confirm signs in — end-to-end on a live RP, exercising the full page->MAIN->ISOLATED->background->WASM path"
    why_human: "SC #1/#2 explicitly require a real third-party site; only packaged-extension UAT can exercise the full chain (playwright-uat-authorized)"
  - test: "Install a second passkey password-manager extension (or rely on the native OS authenticator) alongside this one; trigger create()/get() where the vault has no match or the user declines"
    expected: "The ceremony falls through cleanly to the native/other authenticator, never dead-ending the page's login flow (SC #3 coexistence clause)"
    why_human: "SC #3 mandates verification 'with another password-manager extension installed simultaneously' — a runtime coexistence check grep cannot perform"
  - test: "Visual spot-check of ProviderCeremonyView.tsx (w-380px canvas, spacing, typography, teal CTA / ghost fallback) for create / single-get / multi-get states against 12-UI-SPEC.md on both browsers"
    expected: "The three ceremony consent screens match the UI spec (12-04 D5 / 12-05 Decision A, human_judgment: true)"
    why_human: "DaisyUI spacing/color taste call — deferred to packaged UAT per every prior phase's precedent"
  - test: "/gsd-secure-phase formal security review (the gate this phase is explicitly blocked on)"
    expected: "Reviewer signs off the MAIN-world key-free RPC shim, the D-20(a)/(b) mitigations, the base64url/zero-knowledge boundary, and the CR-01..IN-04 12-REVIEW closures; confirms SC #5"
    why_human: "SC #5 IS a security review; this verification supplies the automated evidence feeding that gate, but the sign-off itself is a separate human/reviewer step"
gaps: []
deferred:
  - truth: "Firefox PRF honest-degradation parity and cross-browser re-verification"
    addressed_in: "Phase 13"
    evidence: "Phase 13 SC #3: 'Wherever Firefox lacks a capability the Chromium build has (most notably PRF), the UI communicates it explicitly'; SC #1 full dual-browser UAT"
warnings: []
---

# Phase 12: Passkey Provider Verification Report

**Phase Goal:** On third-party sites, the extension acts as a full passkey provider — registering and authenticating with vault-stored passkeys — without ever exposing key material to the page.
**Verified:** 2026-07-16T20:30:00Z
**Status:** human_needed
**Re-verification:** Yes — after 12-05 gap closure (commits 4b818f2..1aca338 on main)

## Goal Achievement

The prior verification (4/5, human_needed) carried ONE material code-level gap: create() and single-match get() proceeded IMMEDIATELY on an unlocked vault with no consent popup, and `ProviderCeremonyView`'s create/single-get render states were ORPHANED (built + unit-tested but with no production background trigger — App.tsx only mounted the view for the multi-match picker). A "full passkey provider" prompts on create(); that gap kept the phase goal only partially met.

**12-05 (Decision A) closes that gap genuinely, end-to-end.** Every ceremony — create(), single-match get(), and multi-match get() — now awaits an EXPLICIT popup confirm before any WASM mint/persist/sign. I traced the real path (not just the unit fixtures) and confirmed each hop against the code on `main`:

1. **Background writes the unified consent payload, then opens the popup, then blocks.** `awaitCeremonyConsent` (`provider-ceremony.ts:451-489`) writes ONE object shape `{requestId, kind, rpId, account?, prfRequested, candidates}` to `chrome.storage.session[PENDING_CEREMONY_KEY]` (line 455-457), opens the popup (`tryOpenPopup`/`tryOpenFallbackWindow`, 459-462), and awaits a Promise registered in `pendingConsentResolutions` keyed by `requestId` (475-485). It is called from BOTH `handleCredentialsCreate` (line 541, BEFORE `wasmCreateProviderCredential` at 554) and `handleCredentialsGet` (line 608, BEFORE `wasmGetProviderAssertion` at 638) — never bypassed for an already-unlocked vault. On `null` (decline/abandon) both return `{ fallthrough: true }` before the WASM binding is touched (548-550, 623-625).
2. **Popup reads the payload FIRST and mounts the ceremony view.** `App.tsx checkPendingCeremony()` (line 115-133) is called at the head of `refreshFromScratch()` (line 158-160) — before config/session resolution — reads `PENDING_CEREMONY_KEY`, and sets `view = { kind: "provider-ceremony", ceremonyKind: value.kind, ... }` for `create` OR `get` alike. `ProviderCeremonyView` renders at line 288-329.
3. **User choice flows back to the background.** `onConfirm` sends `CREATE_CONFIRM_SENTINEL` for create (App.tsx:321) or the selected `itemId` for get (323); `onDecline` sends `null` (326). `resolveCeremony` (146-155) dispatches `sendMessage({ kind: "provider.resolveChoice", requestId, itemId })` (line 149).
4. **Router unblocks the awaited Promise.** `router.ts:498-504` handles `provider.resolveChoice` → `resolveProviderCredentialChoice(requestId, itemId)` (`provider-ceremony.ts:497-504`), which resolves the matching `pendingConsentResolutions` entry.
5. **Only then does the background proceed** — mint+persist (create, 552-563) or sign (get, 631-654) — or `{ fallthrough: true }` on `null`.

This is a real, closed loop across `chrome.storage.session` -> App.tsx mount -> `provider.resolveChoice` -> router -> `resolveProviderCredentialChoice` -> background proceed/decline. The prior ORPHANED warning on `ProviderCeremonyView` and the `waitForUnlock` no-timeout warning are both resolved (WR-03: `CEREMONY_ABANDON_TIMEOUT_MS` = 120s bounds both `waitForUnlock` at 272-278 and `awaitCeremonyConsent` at 466-473). The dead boolean write is gone (WR-04). All CR-01/02/03 fixes verified in code (below).

The phase remains **human_needed** — but for the RIGHT reasons now. The prior blocking product decision ("is silent-on-unlocked-vault acceptable?") is RESOLVED by Bartek's Decision A and its implementation, so that item is removed. What remains are the four legitimately-human items: live third-party-site create/get UAT, coexistence with a second PM, visual spot-check, and the `/gsd-secure-phase` sign-off. The CODE now delivers the full-provider goal; those items are UAT/review by construction.

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
| --- | ------- | ---------- | -------------- |
| SC1 | `create()` registers an ES256 passkey saved to the vault | ✓ VERIFIED (mechanism) / UAT-pending | Full consent-gated chain: `handleCredentialsCreate` (`provider-ceremony.ts:527-568`) awaits `awaitCeremonyConsent` (541) BEFORE `wasmCreateProviderCredential` (554) + `writePendingProviderItem`/`persistPendingProviderItem` (560-561). Tests: `credentials.create is consent-gated end-to-end` (provider-ceremony.test.ts:294-347) proves payload-written-then-confirm-then-mint, decline-never-mints. Live-site UAT deferred. |
| SC2 | `get()` logs in with a saved vault passkey | ✓ VERIFIED (mechanism) / UAT-pending | `handleCredentialsGet` (`provider-ceremony.ts:588-659`): zero-match short-circuits to fallthrough BEFORE consent (604-606); 1+ match awaits `awaitCeremonyConsent` (608) BEFORE `wasmGetProviderAssertion` (638). CR-02 rpId default (extractGetRpId, 370-372). Tests: single-match + multi-match consent-gated (test.ts:350-455). Live-site UAT deferred. |
| SC3 | Declines / no-match fall through cleanly to native, never dead-ending the page | ✓ VERIFIED (mechanism) / coexistence-UAT-pending | Page never hangs: page-bridge 120s `RESPONSE_TIMEOUT_MS` backstop + captured `original()` fallthrough. Background: zero-match -> `{fallthrough:true}` (605); explicit decline -> `{fallthrough:true}` (549, 624); abandon/timeout -> `null` -> fallthrough (WR-03). The "user declines" path now EXISTS for create()/single-get (was absent). Coexistence-with-another-PM remains UAT-only. |
| SC4 | PRF used where allowed; honest, specific fallback where not | ✓ VERIFIED | `derivePrfCapability` (`provider-ceremony.ts:316-340`) reads only `clientExtensionResults.prf.enabled` from the real passkey-rs response — never browser-sniff (D-16). CR-01: content-relay base64url-encodes `extensions.prf.eval.first/second` + `evalByCredential` (content-relay.content.ts:513-534) before the background hop. WR-02: `prfUnavailableNote` reworded off browser-blaming (dictionary.ts:227-230). Firefox parity -> Phase 13. |
| SC5 | Security review confirms MAIN-world is a key-free RPC shim (grep-audited: no key/PRF/plaintext crosses to MAIN world) | ✓ VERIFIED (automated) / review-pending | `scripts/audit-mainworld-boundary.sh` exit 0 — now checks BUILT bundles too (IN-02): `page-bridge.js`, `page-bridge-firefox.js` (chrome-mv3 + firefox-mv2). D-20(b) Permissions-Policy delegation-aware on both browsers (page-bridge-firefox.ts:91-117; WR-01). Formal `/gsd-secure-phase` sign-off is the separate gate this feeds. |

**Score:** 5/5 verified (mechanism, automated). Every SC now has its code-level machinery present, wired, and test-covered; every remaining open item is live-browser UAT or the formal security review — not a code gap.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | ----------- | ------ | ------- |
| `crates/pv-provider/*.rs` | passkey-rs soft ES256 authenticator + vault CredentialStore | ✓ VERIFIED | 4/4 tests pass; IN-04 lossless SerializablePasskey round-trip added |
| `crates/pv-wasm/src/lib.rs` provider bindings | create+encrypt / get+assert, zero plaintext key returned | ✓ VERIFIED | 15/15 tests pass; new_passkey_json never a return field |
| `extension/entrypoints/background/provider-ceremony.ts` | consent-gated handlers + PRF + fallthrough + picker | ✓ VERIFIED | 22 tests pass (was 12); awaitCeremonyConsent gate + WR-03 bounded timeout; no orphan warning |
| `extension/entrypoints/background/credential-store.ts` | findMatchingPasskeyItems | ✓ VERIFIED | rpId-filtered vault query, tested |
| `extension/entrypoints/page-bridge.content.ts` + `page-bridge-firefox.ts` | dependency-free MAIN-world shim | ✓ VERIFIED | audit exit 0 (source + bundle); D-20a/b present; WR-01 delegation-aware |
| `extension/entrypoints/content-relay.content.ts` | base64url boundary (D-21/CR-01) + early listener + nonce ledger | ✓ VERIFIED | CR-01 prf eval encoding (513-534); tests pass |
| `extension/entrypoints/popup/ProviderCeremonyView.tsx` | consent UI (create/single-get/multi-get) | ✓ VERIFIED | No longer orphaned — App.tsx mounts it for all three kinds; unit tests pass |
| `extension/entrypoints/popup/App.tsx` | mounts ceremony view off unified payload | ✓ VERIFIED | checkPendingCeremony (115-133) reads key FIRST; onConfirm/onDecline -> provider.resolveChoice |
| `scripts/audit-mainworld-boundary.sh` | PROV-05 grep gate (source + bundle) | ✓ VERIFIED | exit 0; IN-02 bundle-level checks confirmed in my own run |

### Key Link Verification

| From | To | Via | Status |
| ---- | --- | --- | ------ |
| handleCredentialsCreate/Get | awaitCeremonyConsent | storage.session write + pendingConsentResolutions await, BEFORE any WASM call | ✓ WIRED (provider-ceremony.ts:541,608) |
| awaitCeremonyConsent | App.tsx ProviderCeremonyView | PENDING_CEREMONY_KEY payload -> checkPendingCeremony mount | ✓ WIRED (App.tsx:116-133) |
| ProviderCeremonyView | resolveCeremony | onConfirm(sentinel/itemId) / onDecline(null) | ✓ WIRED (App.tsx:319-326) |
| resolveCeremony | router | sendMessage provider.resolveChoice | ✓ WIRED (App.tsx:149) |
| router | resolveProviderCredentialChoice | unblocks awaited Promise | ✓ WIRED (router.ts:498-504 -> provider-ceremony.ts:497-504) |
| background proceed | WASM mint/sign | only after confirm resolution !== null | ✓ WIRED (create 552-563, get 631-654) |
| page-bridge (MAIN) | content-relay (ISOLATED) | window.postMessage, base64url prf eval (CR-01) | ✓ WIRED |

### Requirements Coverage

| Requirement | Status | Evidence |
| ----------- | ------ | -------- |
| PROV-01 (create -> vault passkey) | ✓ VERIFIED (mechanism) | SC1 consent-gated chain, tests pass |
| PROV-02 (get -> sign-in) | ✓ VERIFIED (mechanism) | SC2 chain + CR-02 rpId default + origin validation |
| PROV-03 (clean fall-through) | ✓ VERIFIED (mechanism) | Page 120s backstop; background decline/abandon/zero-match -> fallthrough; coexistence UAT-only |
| PROV-04 (capability-driven PRF) | ✓ VERIFIED | derivePrfCapability, CR-01 eval encoding, WR-02 honest note |
| PROV-05 (key-free MAIN-world shim) | ✓ VERIFIED (automated) | audit exit 0 source + bundle (IN-02), D-20a/b, WR-01 |

### Behavioral Spot-Checks (run in this verification)

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| PROV-05 grep audit (source + built bundles) | `bash scripts/audit-mainworld-boundary.sh` | PASS, exit 0 | ✓ PASS |
| Consent-gate handlers (create/get gated, decline never mints/signs, WASM-failure caught) | `vitest run provider-ceremony.test.ts` | 22 passed | ✓ PASS |
| Popup mount + content-relay boundary + ceremony view | `vitest run content-relay App ProviderCeremonyView` | 57 passed (1 pre-existing unrelated ServerConfigView unhandled rejection in App.test.tsx) | ✓ PASS |

### Anti-Patterns Found

None outstanding. The two prior warnings are resolved: `waitForUnlock` unbounded Promise (now WR-03-bounded), and `ProviderCeremonyView` create/single-get orphaned states (now production-reachable via App.tsx). No debt markers (TBD/FIXME/XXX) introduced. No stub returns in the ceremony paths.

### Human Verification Required

See frontmatter `human_verification` — 4 items, all legitimately human/UAT: (1) live third-party-site create+get with the consent popup; (2) coexistence-with-another-PM fall-through; (3) visual spot-check of the three ceremony states; (4) the `/gsd-secure-phase` formal review this phase is gated on. The prior product-decision item (silent-on-unlocked-vault) is RESOLVED by Decision A and removed.

### Gaps Summary

No code-level gaps. The material blocker from the prior verification — the missing consent gate on create()/single-match get() — is genuinely closed end-to-end (traced above, file:line). All CR-01/02/03 + WR-01/02/03/04 + IN-02/IN-04 findings from 12-REVIEW.md are verified in the code on `main`. Every automated gate I re-ran is green (audit exit 0 incl. bundle; 22 + 57 vitest passing). The phase stays `human_needed` solely for live-browser UAT and the formal security review — which is expected and correct for a passkey provider phase.

---

_Verified: 2026-07-16T20:30:00Z_
_Verifier: Claude (gsd-verifier)_
