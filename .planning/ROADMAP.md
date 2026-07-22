# Roadmap: Passkey Vault

## Milestones

- ✅ **v0.1 MVP** — Phases 1–7 (shipped 2026-07-14) — self-hostable, zero-knowledge password manager: server + web app, PRF passkey unlock first-class, single-container Docker. Full details: [milestones/v0.1-ROADMAP.md](milestones/v0.1-ROADMAP.md)
- ✅ **v0.2 Browser Extension** — Phases 8–13 (complete 2026-07-20; phase dirs archived at v0.3 close → [milestones/v0.2-phases/](milestones/v0.2-phases/), requirements → [milestones/v0.2-REQUIREMENTS.md](milestones/v0.2-REQUIREMENTS.md)) — WXT MV3 Chrome + Firefox extension that is a full passkey provider on third-party sites (`credentials.create`/`credentials.get`) AND a complete autofill companion for the whole vault (login/TOTP/card/identity), reusing `pv-core`/`pv-wasm` via WASM, zero-knowledge preserved.
- ✅ **v0.3 Polish & Hardening** — Phases 14–20 (shipped 2026-07-22) — consolidated v0.2: one login model (Vaultwarden-style), one design-system source of truth (`packages/pv-ui`), in-page visual consistency, both Critical risks closed, server/supply-chain + CI/test-rigor hardening. Full details: [milestones/v0.3-ROADMAP.md](milestones/v0.3-ROADMAP.md)

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)
- Numbering is continuous across milestones — v0.2 continued from v0.1's last phase (7), starting at Phase 8; v0.3 continues from v0.2's last phase (13), starting at Phase 14.

Decimal phases appear between their surrounding integers in numeric order.

<details>
<summary>✅ v0.1 MVP (Phases 1–7) — SHIPPED 2026-07-14</summary>

- [x] Phase 1: WASM Crypto Bridge & Web App Shell (3/3 plans) — completed 2026-07-12
- [x] Phase 2: Password Auth & Vault Core (8/8 plans) — completed 2026-07-13
- [x] Phase 3: Passkey Enrollment & Account Security (4/4 plans) — completed 2026-07-14
- [x] Phase 4: PRF Unlock & Login Unification (3/3 plans) — completed 2026-07-14
- [x] Phase 5: Multi-Device Sync (4/4 plans) — completed 2026-07-14
- [x] Phase 6: Import/Export, TOTP & Onboarding (4/4 plans) — completed 2026-07-14
- [x] Phase 7: Self-Host Packaging & Deployment (3/3 plans) — completed 2026-07-14

Delivered: 30/30 requirements, all phases verified passed, cross-phase integration clean (5/5 E2E flows). Audit: [milestones/v0.1-MILESTONE-AUDIT.md](milestones/v0.1-MILESTONE-AUDIT.md). Known deferred: container/proxy E2E (human_needed on a Docker host — see phase-07 07-UAT.md); CSV-TOTP export fidelity.

</details>

<details>
<summary>✅ v0.2 Browser Extension (Phases 8–13) — complete 2026-07-20 (archived at v0.3 close)</summary>

- [x] Phase 8: Extension Bootstrap & WASM-in-Background Spike (3/3 plans) — completed 2026-07-15
- [x] Phase 9: Session Unlock Core, Popup & Sync Client (8/8 plans) — completed 2026-07-15
- [x] Phase 10: Autofill — Login, TOTP, Card & Identity (9/9 plans) — completed 2026-07-16
- [x] Phase 11: Generate & Capture (9/9 plans) — completed 2026-07-16
- [x] Phase 12: Passkey Provider (7/7 plans) — completed 2026-07-17
- [x] Phase 13: Dual-Browser Hardening (7/7 plans) — completed 2026-07-20

Full phase details preserved in [milestones/v0.3-ROADMAP.md](milestones/v0.3-ROADMAP.md) (pre-close snapshot) and [milestones/v0.2-phases/](milestones/v0.2-phases/).

</details>

<details>
<summary>✅ v0.3 Polish & Hardening (Phases 14–20) — SHIPPED 2026-07-22</summary>

- [x] Phase 14: Critical Risk Closure — Cross-Realm Integrity & Real-RP Verification (3/3 plans) — completed 2026-07-20
- [x] Phase 15: Login & Unlock Unification (Vaultwarden Model) (7/7 plans) — completed 2026-07-20
- [x] Phase 16: Design System Extraction — Logic, Types & i18n (6/6 plans) — completed 2026-07-21
- [x] Phase 17: Shared Component & Visual Alignment (4/4 plans) — completed 2026-07-21
- [x] Phase 18: Firefox Window & Consent Hardening (2/2 plans) — completed 2026-07-21
- [x] Phase 19: Server & Supply-Chain Hardening (3/3 plans) — completed 2026-07-21
- [x] Phase 20: Test Infrastructure & CI Gate (4/4 plans) — completed 2026-07-21

Delivered: 20/20 requirements, 7/7 phases verified + Nyquist-compliant + threat-secure, integration 5/5. Audit: [milestones/v0.3-MILESTONE-AUDIT.md](milestones/v0.3-MILESTONE-AUDIT.md). Full details: [milestones/v0.3-ROADMAP.md](milestones/v0.3-ROADMAP.md).

</details>


## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. WASM Crypto Bridge & Shell | v0.1 | 3/3 | Complete | 2026-07-12 |
| 2. Password Auth & Vault Core | v0.1 | 8/8 | Complete | 2026-07-13 |
| 3. Passkey Enrollment & Account Security | v0.1 | 4/4 | Complete | 2026-07-14 |
| 4. PRF Unlock & Login Unification | v0.1 | 3/3 | Complete | 2026-07-14 |
| 5. Multi-Device Sync | v0.1 | 4/4 | Complete | 2026-07-14 |
| 6. Import/Export, TOTP & Onboarding | v0.1 | 4/4 | Complete | 2026-07-14 |
| 7. Self-Host Packaging & Deployment | v0.1 | 3/3 | Complete | 2026-07-14 |
| 8. Extension Bootstrap & WASM-in-Background Spike | v0.2 | 3/3 | Complete    | 2026-07-15 |
| 9. Session Unlock Core, Popup & Sync Client | v0.2 | 8/8 | Complete    | 2026-07-15 |
| 10. Autofill — Login, TOTP, Card & Identity | v0.2 | 7/9 | Complete    | 2026-07-16 |
| 11. Generate & Capture | v0.2 | 9/9 | Complete    | 2026-07-16 |
| 12. Passkey Provider | v0.2 | 7/7 | Complete    | 2026-07-17 |
| 13. Dual-Browser Hardening | v0.2 | 7/7 | Complete    | 2026-07-20 |
| 14. Critical Risk Closure — Cross-Realm Integrity & Real-RP Verification | v0.3 | 3/3 | Complete    | 2026-07-20 |
| 15. Login & Unlock Unification (Vaultwarden Model) | v0.3 | 7/7 | Complete    | 2026-07-20 |
| 16. Design System Extraction — Logic, Types & i18n | v0.3 | 6/6 | Complete    | 2026-07-21 |
| 17. Shared Component & Visual Alignment | v0.3 | 4/4 | Complete    | 2026-07-21 |
| 18. Firefox Window & Consent Hardening | v0.3 | 2/2 | Complete    | 2026-07-21 |
| 19. Server & Supply-Chain Hardening | v0.3 | 3/3 | Complete    | 2026-07-21 |
| 20. Test Infrastructure & CI Gate | v0.3 | 4/4 | Complete    | 2026-07-21 |
