---
phase: 12-passkey-provider
verified: 2026-07-16T17:51:31Z
status: human_needed
score: 4/5 must-haves verified (automated); 1 partial pending product decision
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "On a real third-party site (packaged Chrome build), call navigator.credentials.create() then .get() with a vault-stored passkey"
    expected: "create() registers an ES256 passkey saved to the vault; a later get() on the same RP signs in — end-to-end, on a live RP, not just unit fixtures"
    why_human: "SC #1/#2 explicitly require a real third-party site; only packaged-extension UAT can exercise the full page->MAIN->ISOLATED->background->WASM path (playwright-uat-authorized)"
  - test: "Install a second passkey password-manager extension (or rely on the native OS authenticator) alongside this one; trigger create()/get() where the vault has no match or the user declines"
    expected: "The ceremony falls through cleanly to the native/other authenticator, never dead-ending the page's login flow (SC #3 coexistence clause)"
    why_human: "SC #3 mandates verification 'with another password-manager extension installed simultaneously' — a runtime coexistence check grep cannot perform"
  - test: "PRODUCT DECISION: is a passkey provider that registers (create()) and single-match signs-in (get()) with NO per-ceremony consent popup when the vault is already unlocked acceptable for v0.2?"
    expected: "Bartek confirms silent-on-unlocked-vault behavior is acceptable, OR the consent gate is scheduled as a follow-up/secure-phase fix"
    why_human: "A real passkey provider (1Password, native OS) prompts on create(). This is a UX/product judgment, not a code-correctness question — the mechanism works, the consent UX is the open question"
  - test: "Visual spot-check of ProviderCeremonyView.tsx (w-380px canvas, spacing, typography, teal CTA / ghost fallback) against 12-UI-SPEC.md on both browsers"
    expected: "Ceremony consent screen matches the UI spec (12-04 D5, human_judgment: true)"
    why_human: "DaisyUI spacing/color taste call — deferred to packaged UAT per every prior phase's precedent"
  - test: "/gsd-secure-phase formal security review (the gate this phase is explicitly blocked on)"
    expected: "Reviewer signs off the MAIN-world key-free RPC shim, the D-20(a)/(b) mitigations, and the base64url/zero-knowledge boundary; confirms SC #5"
    why_human: "SC #5 IS a security review; this verification supplies the automated evidence feeding that gate, but the sign-off itself is a separate human/reviewer step"
gaps: []
deferred:
  - truth: "Firefox PRF honest-degradation parity and cross-browser re-verification"
    addressed_in: "Phase 13"
    evidence: "Phase 13 SC #3: 'Wherever Firefox lacks a capability the Chromium build has (most notably PRF), the UI communicates it explicitly'; SC #1 full dual-browser UAT"
warnings:
  - "waitForUnlock() (provider-ceremony.ts:206-217) has NO cancellation/timeout: if the user closes the popup while the vault is locked with a ceremony pending, the background handler's promise + subscribeSessionLockState listener hang/leak indefinitely. NOT a page dead-end — page-bridge.content.ts's 5000ms RESPONSE_TIMEOUT_MS (line 45) makes the PAGE fall through to native regardless — but a background resource leak and a hard 5s ceiling on locked-vault unlock. Flagged for /gsd-secure-phase per 12-04-SUMMARY."
  - "ProviderCeremonyView create/single-match-get render states are built + unit-tested (ProviderCeremonyView.test.tsx) but have NO real background trigger — App.tsx only mounts the view for the multi-match get() picker. The create()/single-get consent states are unreachable in production today."
---

# Phase 12: Passkey Provider Verification Report

**Phase Goal:** On third-party sites, the extension acts as a full passkey provider — registering and authenticating with vault-stored passkeys — without ever exposing key material to the page.
**Verified:** 2026-07-16T17:51:31Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

The security-critical machinery of the phase is present, wired, and test-covered on `main`. The zero-knowledge MAIN-world boundary — the single highest-severity deliverable — is grep-provably enforced and passes its automated audit. All PROV mechanisms (create, get, fallthrough, PRF, zero-knowledge relay) exist and pass their Rust + TypeScript tests. The phase routes to **human_needed** (not passed) because: (a) three Success Criteria explicitly require real-third-party-site / coexistence / security-review verification that unit tests cannot supply; (b) a documented consent-gate scope decision (create()/single-get proceed with no consent popup on an unlocked vault) needs a product ruling. Nothing is missing, stub, or unwired.

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
| --- | ------- | ---------- | -------------- |
| SC1 | `create()` registers an ES256 passkey saved to the vault | ✓ VERIFIED (mechanism) / UAT-pending | `pv-provider` create ceremony (`ceremony.rs:80-95`), `wasm_create_provider_credential` (`pv-wasm/src/lib.rs:268-284`), `handleCredentialsCreate` (`provider-ceremony.ts:360-386`) + persist. Tests: `create_then_get_roundtrip`, `wasm_create_then_get_roundtrip` pass. Real-third-party-site UAT deferred to human. |
| SC2 | `get()` logs in with a saved vault passkey | ✓ VERIFIED (mechanism) / UAT-pending | `handleCredentialsGet` (`provider-ceremony.ts:402-451`), `wasm_get_provider_assertion` (`pv-wasm/src/lib.rs:294-325`). `origin_mismatch_rejected` proves passkey-client's own RpIdVerifier validates origin (D-06). Real-site UAT deferred. |
| SC3 | Declines / no-match fall through cleanly to native, never dead-ending the page | ⚠️ PARTIAL / human | Page never hangs: `page-bridge.content.ts` calls captured `original()` on timeout/fallthrough/error/exception (lines 210-223) + 5000ms timeout (45). `handleCredentialsGet` returns `{fallthrough:true}` on zero match / decline (416, 421). BUT coexistence-with-another-PM-extension is UAT-only; the "user declines" path does not exist for create()/single-get (no consent prompt). See warnings. |
| SC4 | PRF used where allowed; honest, specific fallback where not | ✓ VERIFIED | `derivePrfCapability` (`provider-ceremony.ts:248-272`) reads only `clientExtensionResults.prf.enabled` from the real passkey-rs response — never browser-sniff (D-16). `HmacSecretConfig::new_without_uv()` (`ceremony.rs:92,137`). Tests `prf_capable_credential`, PRF-note matrix pass. Firefox parity → Phase 13. |
| SC5 | Security review confirms MAIN-world is a key-free RPC shim (grep-audited: no key/PRF/plaintext crosses to MAIN world) | ✓ VERIFIED (automated) / review-pending | `scripts/audit-mainworld-boundary.sh` exit 0; MAIN-world files import only 2 typed interfaces (page-protocol.ts). `new_passkey_json` immediately encrypted, never a return field (`pv-wasm/src/lib.rs:276-282`). D-20(a) non-configurable+`writable:false` (`page-bridge.content.ts:251-253,265-266`), D-20(b) Permissions-Policy (203-207). The formal `/gsd-secure-phase` sign-off is the separate gate this evidence feeds. |

**Score:** 4/5 verified (automated); SC3 partial pending coexistence UAT + consent-gate product decision.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | ----------- | ------ | ------- |
| `crates/pv-provider/{ceremony,credential_store,lib,error}.rs` | passkey-rs soft ES256 authenticator + vault CredentialStore | ✓ VERIFIED | 3/3 tests pass; origin validation via passkey-client; hand-rolled SerializablePasskey DTO |
| `crates/pv-wasm/src/lib.rs` provider bindings | create+encrypt / get+assert, zero plaintext key returned | ✓ VERIFIED | 15/15 tests pass; `new_passkey_json` never leaves function scope |
| `extension/entrypoints/background/provider-ceremony.ts` | handlers + PRF + fallthrough + picker | ✓ VERIFIED (with warnings) | 12 tests pass; waitForUnlock no-timeout warning noted |
| `extension/entrypoints/background/credential-store.ts` | findMatchingPasskeyItems | ✓ VERIFIED | rpId-filtered vault query, tested |
| `extension/entrypoints/page-bridge.content.ts` + `page-bridge-firefox.ts` | dependency-free MAIN-world shim | ✓ VERIFIED | audit exit 0; 10 page-bridge tests pass; D-20a/b present |
| `extension/entrypoints/content-relay.content.ts` | base64url boundary (D-21) + early listener (D-22) + nonce ledger | ✓ VERIFIED | 17 tests pass; runAt document_start; single-use 30s nonce |
| `extension/entrypoints/popup/ProviderCeremonyView.tsx` | consent UI | ⚠️ ORPHANED (partial) | Built + 21 tests pass, but create/single-get states have no production background trigger; only multi-match picker reachable |
| `scripts/audit-mainworld-boundary.sh` | PROV-05 grep gate | ✓ VERIFIED | exit 0 on real tree |

### Key Link Verification

| From | To | Via | Status |
| ---- | --- | --- | ------ |
| page-bridge (MAIN) | content-relay (ISOLATED) | window.postMessage, nonce+origin pinned | ✓ WIRED |
| content-relay | background | runtime.sendMessage credentials.create/get, base64url-encoded | ✓ WIRED |
| router.ts | handleCredentialsCreate/Get | content-frame channel + assertContentSender guard.origin | ✓ WIRED (router.ts:245-282) |
| popup | resolveProviderCredentialChoice | provider.resolveChoice, WR-01 popup-gated | ✓ WIRED (router.ts:498-504) |
| App.tsx | ProviderCeremonyView | multi-match picker payload only | ⚠️ PARTIAL — create/single-get states not mounted |

### Requirements Coverage

| Requirement | Status | Evidence |
| ----------- | ------ | -------- |
| PROV-01 (create → vault passkey) | ✓ VERIFIED (mechanism) | SC1 chain, tests pass |
| PROV-02 (get → sign-in) | ✓ VERIFIED (mechanism) | SC2 chain + origin validation |
| PROV-03 (clean fall-through) | ⚠️ PARTIAL | Page-level fallthrough verified; coexistence UAT + waitForUnlock warning |
| PROV-04 (capability-driven PRF) | ✓ VERIFIED | derivePrfCapability, no browser-sniff |
| PROV-05 (key-free MAIN-world shim) | ✓ VERIFIED (automated) | audit exit 0, D-20a/b, zero-knowledge WASM boundary |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Rust provider create/get/origin/prf | `cargo test -p pv-provider` | 3 passed | ✓ PASS |
| WASM bindings roundtrip + zero-knowledge | `cargo test -p pv-wasm` | 15 passed | ✓ PASS |
| Background handlers (fallthrough/locked/PRF) | `vitest provider-ceremony.test.ts` | 12 passed | ✓ PASS |
| MAIN-world patch (D-20a/b, fallthrough) | `vitest page-bridge.test.ts` | 10 passed | ✓ PASS |
| Content-relay boundary + nonce validation | `vitest content-relay.test.ts` | 17 passed | ✓ PASS |
| PROV-05 grep audit | `bash scripts/audit-mainworld-boundary.sh` | PASS, exit 0 | ✓ PASS |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
| ---- | ------- | -------- | ------ |
| provider-ceremony.ts:206-217 | `waitForUnlock()` unbounded Promise (no timeout/cancellation) | ⚠️ Warning | Background handler hangs/leaks listener if popup closed while locked; page itself falls through via 5s timeout so not a page dead-end |
| ProviderCeremonyView.tsx | create/single-get states unreachable (no background trigger) | ⚠️ Warning | Built + tested but orphaned in production; consent UI only serves multi-match |

No debt markers (TBD/FIXME/XXX) introduced. No stub returns in the ceremony paths.

### Human Verification Required

See frontmatter `human_verification` — 5 items: (1) real third-party site create+get UAT; (2) coexistence-with-another-PM fall-through; (3) **product decision on the no-consent-on-unlocked-vault behavior**; (4) visual spot-check; (5) the `/gsd-secure-phase` formal review this phase is gated on.

### Gaps Summary

No hard code-level gaps: every artifact exists, is substantive, and is wired; all automated gates (grep audit, tsc, 474/474 vitest, cargo, wxt build ×2) are green; the zero-knowledge boundary is grep-provably enforced. The phase does not reach `passed` for two reasons, both requiring a human:

1. **Consent-gate scope decision (the material one).** `handleCredentialsCreate` (unlocked vault) and single-match `handleCredentialsGet` proceed IMMEDIATELY with no consent popup. A real passkey provider prompts the user on `create()`. This is transparently documented (12-04-SUMMARY Scope Clarification #3) and does NOT weaken zero-knowledge — but "acts as a *full* passkey provider" is only partially met until Bartek rules whether silent-on-unlocked-vault is acceptable for v0.2 or the consent gate is a required follow-up.

2. **Real-browser UAT (SC #1/#2/#3/#5 clauses).** Third-party-site registration/authentication, coexistence with another PM extension, visual spot-check, and the formal security review are all human/packaged-UAT steps by construction.

The `waitForUnlock()` no-timeout hang and the orphaned create/single-get consent states are warnings for `/gsd-secure-phase`, not blockers (the page never dead-ends due to page-bridge's 5s timeout).

---

_Verified: 2026-07-16T17:51:31Z_
_Verifier: Claude (gsd-verifier)_
