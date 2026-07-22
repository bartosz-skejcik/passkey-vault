---
phase: 14
slug: critical-risk-closure-cross-realm-integrity-real-rp-verifica
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-20
---

# Phase 14 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Test process ↔ two independent WebAuthn crate families | In-process representational boundary: passkey-types (1Password) output verified by webauthn-rs-proto (kanidm) | Public ceremony JSON (attestation/assertion) |
| Test output ↔ CI/developer logs | `new_passkey_json` carries a private key — must never print | Private key material (never logged) |
| RP page (MAIN world, untrusted) ↔ page-bridge-firefox.ts (MAIN world, key-free) | credentialJson re-decode reads data the page already receives per spec | Public credential-response fields only |
| page-bridge-firefox.ts ↔ content-relay.content.ts (ISOLATED world) | Unchanged: postMessage envelope, nonce, D-03 origin discipline byte-for-byte preserved (SECURED) | Ceremony envelopes (no key material) |
| jsdom test realm ↔ hidden-iframe realm | Test-only deterministic reproduction of the Xray hazard | Test fixtures only |
| Live-Firefox probe ↔ real extension build | Probe drives the real `.output/firefox-mv2`; production-identical boundary | Fixture-account ceremony data |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-14-01 | Spoofing/Tampering | real_rp_verification.rs webauthn-rs verifier config | medium | mitigate | Real `finish_passkey_registration`/`finish_passkey_authentication` calls, zero lax/danger builder flags, non-localhost origin; prohibition signed off in 14-VERIFICATION.md (direct file read) | closed |
| T-14-02 | Information Disclosure | test assertions / println output | low | mitigate | No println of key-bearing fields; explicit code comment (real_rp_verification.rs:103-105) marks `new_passkey_json`/`updated_passkey_json` never-logged | closed |
| T-14-03 | Tampering/DoS | page-bridge-firefox.ts b64UrlToArrayBuffer/shapeCredential | medium | mitigate | Malformed credentialJson throws are caught by broker()'s outer try/catch → native fallthrough; confirmed in 14-REVIEW (truth #11 in 14-VERIFICATION.md) | closed |
| T-14-04 | Information Disclosure | credentialJson fields re-decoded in MAIN world | low | accept | Same public fields the page already receives from `navigator.credentials.*` per spec — nothing new disclosed | closed |
| T-14-05 | Elevation of Privilege | handleProviderPageMessage validation gates | n/a | mitigate | SECURED scope fence held: content-relay diff comment-only (14-REVIEW re-check), `audit-mainworld-boundary.sh` exit 0, validation/nonce/origin/consent untouched | closed |
| T-14-06 | Tampering | page-bridge-firefox.test.ts / probe-request-xray.cjs | low | accept | Test/harness code only — never in the shipped extension bundle | closed |
| T-14-07 | Tampering | throwaway differential-probe artifacts (14-02 T1) | low | mitigate | 14-02's `git status --porcelain` gate + files_modified as source of truth; working tree confirmed clean at phase close | closed |
| T-14-SC | Tampering | dev-dependency edges (webauthn-rs, uuid) | low | accept | No new packages — both already pinned in workspace Cargo.lock (pv-server prod dep / workspace dep); dev-dependency edge only | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-14-01 | T-14-04 | Re-decoding public spec-mandated response fields in the page's own realm discloses nothing the page lacks | Plan 14-02 threat model (plan-time) | 2026-07-20 |
| AR-14-02 | T-14-06 | Harness/test code excluded from shipped bundle by build | Plan 14-03 threat model (plan-time) | 2026-07-20 |
| AR-14-03 | T-14-SC | Dev-dependency edges to already-locked, already-vetted workspace crates | Plan 14-01 threat model + RESEARCH.md package-legitimacy audit | 2026-07-20 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-20 | 8 | 8 | 0 | secure-phase short-circuit (plan-time register, ASVS L1; evidence: 14-REVIEW 0C/0W, 14-VERIFICATION 14/14 + sign_off, audit-mainworld exit 0) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-20
