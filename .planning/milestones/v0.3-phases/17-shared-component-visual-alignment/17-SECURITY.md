---
phase: 17
slug: shared-component-visual-alignment
status: secured
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-21
---

# Phase 17 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| pv-ui supply-chain surface | Option A gives pv-ui its own node_modules — a new physical install location | 4 already-vetted packages, locked versions only |
| Zero-knowledge favicon rule | Shared component fetches item-domain favicons | Item domain (never via proxy/pv-server, no-referrer) |
| In-page overlay architectural line | Closed-shadow, imperative, React-free, crypto-free | CSS token values only |
| Visual harness | Test credentials + screenshots | Dedicated `@example.local` test account only |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-17-01 | Tampering | pv-ui peerDependencies/devDependencies | high | mitigate | 17-01 verify: every version byte-identical to consumer locks (react 19.2.7, lucide 1.24.0 …); CR-01 fix adds resolve.dedupe to wxt build with negative-control duplicate proof | closed |
| T-17-02 | Tampering | pv-ui node_modules supply chain | high | mitigate | No new packages — fresh local install of 4 already-vetted deps; package-lock.json committed, reviewer confirmed registry.npmjs.org + integrity hashes only | closed |
| T-17-03 | Tampering | Dockerfile web-builder stage | low | mitigate | Single additive `RUN npm ci` against the committed lock; no new network target | closed |
| T-17-04 | Tampering | inpage-overlay.ts architectural line | high | mitigate | 17-02 verify: zero react/crypto import lines; CSS-only two-declaration diff proven by scoped script | closed |
| T-17-05 | Information Disclosure | buildIconTile() favicon fetch | medium | mitigate | Code path untouched (diff-scoped); direct-fetch + no-referrer preserved | closed |
| T-17-06 | Tampering | tokens.css token placement | medium | mitigate | 2 regression tests assert tokens live inside the rewritten `[data-theme]` blocks via processed INPAGE_THEME_CSS output | closed |
| T-17-07 | Information Disclosure | shared ItemIconTile favicon fetch | high | mitigate | 17-03 verify: `referrerPolicy="no-referrer"` present, zero proxy-domain substrings; verifier independently re-confirmed post WR-04 fix | closed |
| T-17-08 | Tampering | pv-ui crypto-free boundary | high | mitigate | Import-line grep zero crypto-surface hits (component + aggregate 17-04 pass) | closed |
| T-17-09 | Tampering | consumer shim behavior drift | medium | mitigate | Pre-existing unedited tests pass through shims (popup 9/9, web ItemRow 28/28) | closed |
| T-17-10 | Tampering | aggregate gate | medium | mitigate | Full chains green (web 481 + tsc + build; ext 687 + tsc + wxt build) + both aggregate greps empty + overlay 8-literal audit exact | closed |
| T-17-11 | Information Disclosure | visual harness credentials/screenshots | low | mitigate | Dedicated per-run `@example.local` test account (WR-02 fix made email unique per run); screenshots contain only test-fixture data. NOTE: screenshots WERE committed to `.planning/.../uat-screenshots/` per the project's established UAT-evidence convention (supersedes the plan's local-only note) — reviewed: no real credentials or user data visible | closed |
| T-17-SC | Tampering | package installs | n/a | accept | No new packages anywhere in the phase; only script entries and already-vetted re-installs | closed |

*Status: open · closed · open — below high threshold (non-blocking)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-17-01 | T-17-SC | 4-package pv-ui local install reproduces existing vetted locks; no version drift possible without failing 17-01's byte-identity verify | autonomous run (plan-time disposition) | 2026-07-21 |
| R-17-02 | WR-05 | Web build's single-React guarantee rests on Next 16's internal vendored-React alias — documented as a consumer contract in packages/pv-ui/README.md with the exact guard to add if a Next upgrade breaks it; no code guard added to avoid fighting Next's own aliasing | autonomous run (review disposition) | 2026-07-21 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-21 | 12 | 12 | 0 | secure-phase orchestrator (register authored at plan time, ASVS L1; mitigations automated + code-review CR-01 hardening + verifier re-confirmation) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
