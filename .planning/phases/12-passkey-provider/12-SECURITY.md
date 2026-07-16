---
phase: 12
slug: passkey-provider
status: secured
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-16
---

# Phase 12 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> This is the milestone's `/gsd-secure-phase`-gated phase (PROV-05 / ROADMAP SC #5 / D-15).
> Auditor: gsd-security-auditor (Opus). Verdict: **SECURED — 17/17 closed, threats_open: 0.**

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| page MAIN world ↔ ISOLATED content-relay | Page-readable channel; the phase's central risk surface | Opaque WebAuthn ceremony data only (nonce, publicKey JSON) — never keys/PRF/plaintext |
| ISOLATED content-relay ↔ background | Same-extension, still sender-verified | Validated ceremony envelopes, base64url-encoded binaries (D-21) |
| pv-wasm binding return ↔ background JS | The only place plaintext private-key material could surface | Ciphertext + public response JSON only; `new_passkey_json` stays a WASM-local |
| background ↔ chrome.storage.session | Sole reader of the unlocked User Key handle | Unlocked UK handle (re-checked fresh per invocation, D-10); ciphertext `pendingProviderItems` |
| popup (browser chrome) ↔ third-party page | Consent renders only on browser-chrome-owned popup | None — page cannot draw over or read the popup |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-12-01 | Information Disclosure | pv-wasm binding return | critical | mitigate | `new_passkey_json` consumed by `core_encrypt_item` as a local; result structs expose only ciphertext + public JSON (`pv-wasm/src/lib.rs:218-258,277,304`) | closed |
| T-12-02 | Tampering | PvCredentialStore item slot | high | mitigate | Item-level AAD (`prefix‖item_id‖revision`) via `build_item_aad`/`core_decrypt_item` rejects tampered slot before plaintext (`pv-core/src/items.rs:28-32,75`) | closed |
| T-12-03 | Spoofing | origin/RP-ID binding | high | mitigate | Delegated to `passkey_client::Client` (not hand-rolled, D-06); `origin_mismatch_rejected` test (`ceremony.rs:78-142`) | closed |
| T-12-04 | Repudiation | passkey-rs supply chain | low | accept | `passkey-*@0.5.0` VERIFIED OK (12-01-SUMMARY) | closed |
| T-12-SC | Tampering | cargo installs | high | mitigate | `pollster@1.0.1` inline crates.io legitimacy check recorded; passkey-* pre-approved | closed |
| T-12-05 | Spoofing | router message dispatch | high | mitigate | `assertContentSender` → sender-verified `guard.origin` only; content-frame channel, not `handle()` (`router.ts:263-282`) | closed |
| T-12-06 | Information Disclosure | session handling | high | mitigate | `ensureHydrated()` fresh `storage.session` re-check per handler (D-10); lock nulls handle (`provider-ceremony.ts:535,596`, `vault-session.ts:113-142,219-222`) | closed |
| T-12-07 | DoS (ceremony) | ceremony handlers | medium | mitigate | Top-level try/catch → `{failed:true}`, never uncaught (`provider-ceremony.ts:567-570,650+`) | closed |
| T-12-08 | Tampering | `pendingProviderItems` storage | low | accept | Extension-internal, already ciphertext under User Key | closed |
| T-12-09 | Spoofing/Tampering | content-relay listener | critical | mitigate | `event.source===window` + origin-pin + single-use 30s nonce ledger; silent-ignore on failure; postMessage always `location.origin` (`content-relay:687-705`) | closed |
| T-12-10 | Information Disclosure | MAIN-world files | critical | mitigate | `audit-mainworld-boundary.sh` exits 0 at source AND built bundle; page-bridge imports only WXT + type-only/zero-import modules | closed |
| T-12-11 | DoS (ceremony) | patch vs second PM | medium | mitigate | Native refs captured via `.bind()` before `defineProperty`; wrapper try/catch fails safe to native (`page-bridge.content.ts:337-342`) | closed |
| T-12-12 | Tampering | page instrumenting MAIN patch | high | mitigate | MAIN-world holds only opaque serialized data; no live crypto reference (enforced by T-12-10 audit) | closed |
| T-12-13 | Correctness/trust | Firefox build | medium | mitigate | Both `wxt build` succeed; Firefox `injectScript` gated on `import.meta.env.FIREFOX` + WAR. Live parity → Phase 13 (D-17) | closed |
| T-12-14 | Spoofing | in-page fake consent phish | high | mitigate | `ProviderCeremonyView` renders only in browser-chrome popup; never in any content/MAIN file — structurally unspoofable | closed |
| T-12-15 | Information Disclosure | consent view rendering | critical | mitigate | No monospace, no secret-shaped value display anywhere in `ProviderCeremonyView.tsx` | closed |
| T-12-16 | DoS (ceremony) | popup dismissal | medium | mitigate | `beforeunload` + unmount-while-pending → explicit decline; page promise always resolves (`ProviderCeremonyView.tsx:125-137`) | closed |

*Status: open · closed · open — below high threshold (non-blocking)*

### D-20 / D-21 / D-22 / review-fix verification (all present)

- **D-20(a)** accessor `configurable:false, writable:false`, defineProperty failure fails safe — `page-bridge.content.ts:349-365` + firefox twin `:277-293`.
- **D-20(b)** Permissions-Policy respected before brokering, incl. **Firefox delegation-aware fallback (WR-01)** where both policy APIs are absent — `isPermissionsPolicyBlocked` in both bridges.
- **D-21 / CR-01** base64url boundary incl. `prf.eval.first/second` + `evalByCredential` before `sendMessage` — `content-relay.content.ts:494-533`.
- **D-22** early ISOLATED listener at `document_start` — `content-relay.content.ts:754-774`.
- **CR-02** omitted-rpId → sender-origin host fallback — `provider-ceremony.ts:365-390`.
- **CR-03** consent gates the WASM call; `postAck` after validation; two-phase timers with enforced invariant `EXTENSION_AUTHORITY_TIMEOUT_MS(300s) > 2×CEREMONY_ABANDON_TIMEOUT_MS(240s)` (`ceremony-timeouts.ts` + guard test) — no orphaned credential.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-12-01 | T-12-04 | passkey-rs (1Password) crates @0.5.0 vetted OK; standard supply-chain acceptance | Bartek (project owner) | 2026-07-16 |
| AR-12-02 | T-12-08 | `pendingProviderItems` is extension-internal and already ciphertext; tampering only causes a decrypt failure, never disclosure | Bartek (project owner) | 2026-07-16 |
| AR-12-03 | IN-01 / D-20(a)↔D-12 | Non-configurable accessor means "first-installed PM wins" coexistence; most PMs behave identically. Documented; two-PM install-order case tracked for UAT | Bartek (project owner) | 2026-07-16 |
| AR-12-04 | IN-03 | A same-page script can spoof a MAIN-world *response* for a ceremony it already fully controls — self-harm only, no cross-origin/secret path (no key material on that channel) | gsd-security-auditor (Opus) | 2026-07-16 |

---

## Deferred UAT-by-construction Items (tracked verification, NOT gate-blocking threats)

1. Live third-party-site `create()`/`get()` ceremony on packaged Chrome (SC #1/#2), incl. the locked-vault post-unlock consent path and a human-paced slow confirm proving native is never also invoked.
2. Second password-manager coexistence UAT (D-12/AR-12-03) — two-PM install-order case.
3. Visual spot-check of the now-reachable create()/single-get consent screens.
4. Firefox parity smoke-test (T-12-13 residual) — best-effort per D-17; dedicated pass belongs to Phase 13.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-16 | 17 | 17 | 0 | gsd-security-auditor (Opus) |

Preceding evidence chain: Opus code review (12-REVIEW.md, 3C/4W/4I) → gap-closure 12-05 (Decision A consent + CR-01/02/03 + WR-01..04 + IN) → adversarial re-review found 2 locked-path defects → 12-06 (reactive consent listener + ack handshake) → adversarial re-confirm (both closed, no new blocker) → timeout-invariant hardening → this SECURED audit.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
