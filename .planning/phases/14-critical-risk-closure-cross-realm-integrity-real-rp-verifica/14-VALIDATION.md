---
phase: 14
slug: critical-risk-closure-cross-realm-integrity-real-rp-verifica
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-20
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (extension), cargo test (Rust workspace), selenium/geckodriver real-Firefox probes, playwright (Chrome) |
| **Config file** | extension/vitest.config.ts; Cargo.toml workspace; extension/playwright.config.ts |
| **Quick run command** | `cd extension && npx vitest run --reporter=dot` |
| **Full suite command** | `cd extension && npx vitest run && npx tsc --noEmit && cargo test --workspace` |
| **Estimated runtime** | ~60 seconds (quick ~25s; Firefox harness lanes separate, minutes each) |

---

## Sampling Rate

- **After every task commit:** `cd extension && npx vitest run --reporter=dot` (674 passing at phase close)
- **After every plan wave:** full suite + affected Firefox/Chrome harness lanes
- **Before `/gsd-verify-work`:** full suite + probe-request-xray.cjs all-PASS + run-core 17+1/0 + server-unlock 15/2/0 + chromium-ceremony 5/5 + audit-mainworld-boundary exit 0 — ALL CONFIRMED GREEN at phase close (14-03-SUMMARY)
- **Max feedback latency:** 90 seconds unit-level; harness lanes at wave boundaries

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 14-01-T2 | 01 | 1 | QA-03 | T-14-01 | independent webauthn-rs verifier accepts provider ceremony (real signature over real challenge); verifier config not weakened (signed off in 14-VERIFICATION.md) | integration | `cargo test -p pv-provider --test real_rp_verification` | ✅ | ✅ green |
| 14-02-T2 | 02 | 1 | XBR-02 | T-14-02 | MAIN-world re-materialization; no validation/nonce/origin/consent changes; D-03 preserved | unit (jsdom cross-realm) | `cd extension && npx vitest run entrypoints/__tests__/page-bridge-firefox.test.ts` | ✅ | ✅ green |
| 14-03-T1 | 03 | 2 | XBR-02 | T-14-02 | discriminating pre/post-fix regression guard (crossRealmArrayBuffer) | unit (jsdom) | `cd extension && npx vitest run entrypoints/__tests__/page-bridge-firefox.test.ts` | ✅ | ✅ green |
| 14-03-T2 | 03 | 2 | XBR-02 | T-14-02 | end-to-end delivery check on real Firefox, hard exit-1 on any FAIL row (af3f375) | e2e probe (headed) | `node extension/e2e-firefox/probe-request-xray.cjs` | ✅ | ✅ green (live run 2026-07-20, results JSON on disk) |
| 14-03-T3 | 03 | 2 | XBR-02, QA-03 | — | full 9-command gate suite green; mainworld boundary audit exit 0 | suite | see Sampling Rate "Before verify-work" line | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `crates/pv-provider/tests/real_rp_verification.rs` — created in 14-01 (webauthn-rs dev-dependency edge; `cargo check -p pv-provider --tests` de-risk passed first)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real github.com create()/get() on Bartek's Firefox profile | XBR-02 (corroboration only, NOT a phase gate) | Requires Bartek's real GitHub account/2FA; automated equivalents (probe + jsdom + webauthn-rs round-trip) are the documented closure evidence | Open item honestly preserved in `.planning/debug/resolved/firefox-request-xray-hole.md`; at Bartek's leisure |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags (probe exit-code gate added in af3f375; vitest run one-shot)
- [x] Feedback latency < 90s (unit-level)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-20 (validate-phase audit — no gaps; both requirements COVERED by green automated tests)

## Validation Audit 2026-07-20

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

Requirement coverage: XBR-02 → jsdom `page-bridge-firefox.test.ts` (discriminating) + `probe-request-xray.cjs` (end-to-end, exit-gated) — COVERED. QA-03 → `real_rp_verification.rs` (cross-vendor, signature-real) — COVERED. github.com live retest remains Manual-Only corroboration (non-blocking).
