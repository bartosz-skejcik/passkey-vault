---
phase: 15
slug: login-unlock-unification-vaultwarden-model
status: verified
threats_open: 0
asvs_level: 1
created: 2026-07-20
---

# Phase 15 — Security

Plan-time STRIDE registers existed in all 7 plans (register_authored_at_plan_time: true, ASVS L1, block on high). All threats CLOSED; short-circuit write per secure-phase §3 with the opus code review (15-REVIEW.md) as verification evidence.

## Threat Register (consolidated)

| Threat | Component | Severity | Disposition | Status | Evidence |
|--------|-----------|----------|-------------|--------|----------|
| Password-relay interception/misuse | ExtUnlockBridge → relay → handleUnlockPassword | high | mitigate | closed | Review traced end-to-end: password never logged/persisted, zeroized at source + finally; mode-pinned nonce guard rejects passwordB64 on unlock-mode; D-03 origin-pinned postMessage |
| Widened session-mutating surface | router.ts new kinds (session.signOut, config.probe) | medium | mitigate | closed | WR-01 assertPopupSender byte-intact (verified twice: 15-04 diff review + verifier); new kinds inherit popup-sender gate |
| Stranded/orphaned auth state | AUTH-04 migration | medium | mitigate | closed | grant→signOut→persist→revoke ordering; live two-server proof; unmount-race + permission-timeout fixes (cdf742d) |
| Ext-scoped PRF residue | deleted surface | low | mitigate | closed | 9 files deleted; permanent structural guard test; grep-clean |
| Teardown DoS (logout unreachable) | signOutVaultSession | low | mitigate | closed | best-effort logout, unconditional local clearSessionMeta |

## Accepted Risks Log

| Risk | Rationale | Date |
|------|-----------|------|
| 3 Info review findings unfixed | comment mismatch, message copy, error labeling — no security impact; tracked in 15-REVIEW.md | 2026-07-20 |

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-20 | 5 (consolidated) | 5 | 0 | secure-phase short-circuit; evidence: 15-REVIEW (opus, 0 security findings), 15-VERIFICATION |

**Approval:** verified 2026-07-20
