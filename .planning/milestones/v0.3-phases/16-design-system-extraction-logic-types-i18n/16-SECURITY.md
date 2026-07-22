---
phase: 16
slug: design-system-extraction-logic-types-i18n
status: secured
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-21
---

# Phase 16 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| pv-ui zero-knowledge boundary | Code entering `packages/pv-ui` is shared by web and extension — a crypto/key import would widen the zero-knowledge attack surface to two client surfaces at once | None permitted (enforced by grep gate) |
| Vault item type shapes → extension autofill DOM-write surface | Reconciled type superset describes data `fill-dom.ts` writes into third-party pages | Decrypted vault item fields (PII) |
| OS clipboard | `copyWithAutoClear()` writes sensitive values to the shared OS clipboard | Passwords, card numbers, TOTP codes |
| i18n → security-critical UI copy | Shared engine renders unlock/ceremony/PRF-error screens | UI copy legibility (no key-lookup artifacts) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-16-01 | Tampering | pv-ui package.json exports map | low | mitigate | 16-01 verify: all 4 pre-existing entries byte-identical alongside 7 new; both tsc chains green | closed |
| T-16-02 | Information Disclosure | extension/lib/autofill/fill-dom.ts | medium | mitigate | `git diff --quiet` gate in 16-02 + verifier re-ran independently: file untouched since Phase 10, exactly 1 legacy flat-address write, zero structured-field reads | closed |
| T-16-03 | Tampering | pv-ui/vault/types.ts crypto-free | low | mitigate | Zero imports before/after move (grep-verified); superseded by T-16-11 aggregate pass | closed |
| T-16-04 | Information Disclosure | pv-ui/clipboard.ts auto-clear regression | high | mitigate | Byte-for-byte move; `clipboard.test.ts` (4 tests) passes unchanged through shim chain; single-active-timer + 30–60s clamp preserved | closed |
| T-16-05 | Tampering | pv-ui cardBrand/clipboard crypto-free | low | mitigate | 16-03 grep zero crypto-surface keywords; superseded by T-16-11 | closed |
| T-16-06 | Tampering | pv-ui/i18n engine.ts + common.ts crypto-free | low | mitigate | Pure string lookup/substitution, zero I/O, zero crypto imports; superseded by T-16-11 | closed |
| T-16-07 | Tampering (UI behavior) | consumer dictionary.ts thin wrappers | high | mitigate | `keyof typeof DICTIONARY` narrowing preserved per-consumer (verifier: web:702, ext:243); both tsc clean; runtime render validated via UAT (web unlock screenshot + 7/7 P9 e2e — see 16-VERIFICATION.md Validation Evidence) | closed |
| T-16-08 | Tampering (copy drift) | pv-ui/i18n/common.ts key selection | high | mitigate | Fresh key-by-key re-diff at execution confirmed 34 identical / 4 divergent; divergent keys verified local-only (verifier re-checked); both suites pass unchanged | closed |
| T-16-09 | Spoofing/Tampering | extension frame-guard.ts origin gate | high | mitigate | 16-05 verify: `git diff --quiet` + zero import of `vault/search`'s domainFromUrl — fail-closed origin gate byte-identical to pre-phase state | closed |
| T-16-10 | Tampering | pv-ui/vault/search.ts, sort.ts crypto-free | low | mitigate | Pure functions over decrypted in-memory items; superseded by T-16-11 | closed |
| T-16-11 | Tampering/Info Disclosure | pv-ui aggregate (all migrated modules) | high | mitigate | 16-06 aggregate grep across pv-ui/{vault,i18n} + clipboard.ts for wasm/argon2/chacha/hkdf/derive/decrypt/prf import lines: empty — final zero-knowledge boundary proof | closed |
| T-16-12 | Tampering (behavior drift) | web/ + extension/ aggregate | medium | mitigate | Full chains green post-phase: web 481/481 + tsc + next build; ext 685/685 + tsc + wxt chrome/firefox builds; zero-duplication grep empty | closed |
| T-16-SC | Tampering | package installs (supply chain) | n/a | accept | No package-manager installs anywhere in the phase — only first-party file moves and config edits (RESEARCH.md Package Legitimacy Audit: N/A) | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-16-01 | T-16-SC | No installs occurred; executor worktree bootstraps (npm ci / rsync node_modules) reproduced existing lockfiles only, no lockfile changes committed | autonomous run (plan-time disposition) | 2026-07-21 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-21 | 13 | 13 | 0 | secure-phase orchestrator (short-circuit: register authored at plan time, ASVS L1, all mitigations automated + verifier-confirmed) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
