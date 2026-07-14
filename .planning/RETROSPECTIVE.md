# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v0.1 — MVP

**Shipped:** 2026-07-14
**Phases:** 7 | **Plans:** 29 | **Sessions:** multiple (incl. autonomous overnight + continuation runs)

### What Was Built
- `pv-wasm` crate bridging pv-core's Argon2id/HKDF/XChaCha20-Poly1305 crypto to WASM behind opaque-handle types, with a single grep-auditable `lib/crypto/` choke-point (Phase 1, UI-01).
- Full password-auth + zero-knowledge vault CRUD (login/card/identity/note items, folders, tags, client-side search, CSPRNG generator, clipboard auto-clear, idle-lock) over AD-bound XChaCha20-Poly1305 blobs (Phase 2).
- Two-ceremony PRF passkey enrollment + account-security Settings + server-enforced no-stranding recovery invariant (Phase 3); one-gesture PRF login+unlock with honest fallback tiers (Phase 4).
- Multi-device sync: revision-gated pull + metadata-only WS push (ciphertext never in the channel) + optimistic-concurrency 409 conflict handling (Phase 5).
- Import (Bitwarden/NordPass/1Password/LastPass/KeePass/generic) + JSON/CSV export with plaintext-warning gate + RFC-6238 TOTP item type with a live ring + 3-step import-first onboarding (Phase 6).
- Single-container Docker packaging with fail-loud `Config::validate()`, SQLite WAL, SIGTERM, and reverse-proxy reference configs that strip the WS session token from access logs (Phase 7).

### What Worked
- **Workflow-orchestrated GSD pipeline:** running review/verify/plan-check/integration as background `Workflow` fan-outs (Opus for verification-class agents, Sonnet for execution) kept the orchestrator context lean and let independent checks run in parallel with UAT.
- **Adversarial second perspectives:** pairing the goal-backward verifier with an independent requirements-traceability audit (Phase 6) and a dedicated cross-phase integration checker (milestone) caught the framing gaps a single pass misses (stale UI-04 checkbox, CSV-TOTP fidelity).
- **Self-driven Playwright UAT** with a CDP virtual authenticator closed the human_needed loop overnight; cross-checking the live TOTP code against an independent RFC-6238 computation gave real correctness evidence, not just "it rendered."
- **Sequential worktree/executor discipline:** worktree isolation for parallel same-tree waves; sequential-on-main for single-plan waves. Executor deaths mid-run (server_error / session-limit) lost zero work because commits persisted — resumed via SendMessage.

### What Was Inefficient
- **GSD "stale verification" mtime gate** bit twice (Phase 3, Phase 7) purely because SUMMARY/VERIFICATION files were committed out of order — cost re-stamp cycles for no code reason. Write SUMMARYs before VERIFICATION, or the verifier last.
- **`passed_with_concerns` is not a recognized GSD status** — the verifier emitted it and blocked phase.complete until flipped to `passed`. Verifier prompts should stick to passed/gaps_found/human_needed.
- **Executors deferred SUMMARY writes to the orchestrator**, so 07-02/07-03 SUMMARYs were missing at audit time — a documentation gap the integration verifier flagged. Executors should always emit their own SUMMARY.
- **Docker unavailable in the autonomous env** forced the whole Phase-7 container/proxy E2E to human_needed; later installed Colima (CLI, no Desktop) to actually run it.

### Patterns Established
- **Single-source domain-separation constants** verified across the enroll↔unlock seam (`pv:prf-unlock:v1`) — the highest-risk crypto seam held because one function serves both wrap and unwrap.
- **Baseline-revision capture at edit-open** (not live revision) is what makes optimistic-concurrency 409s actually fire — the CR-01 fix pattern.
- **Human-needed E2E as a first-class artifact:** when a check can't run in-env, enumerate the exact commands in a `*-UAT.md` checklist rather than silently skipping.
- **Colima for CLI-only Docker on macOS** — real daemon, no Docker Desktop.

### Key Lessons
1. Order artifact commits so verification is last (or re-stamp) — the mtime-based staleness gate is unforgiving.
2. Constrain verifier status vocabulary to the three recognized values; carry nuance in the body + a UAT.md, not the frontmatter status.
3. Independent adversarial passes (traceability audit, integration checker) find framing/wiring gaps that goal-backward verification of a single phase cannot.
4. Prove crypto correctness against an external reference (independent RFC-6238), not just against the app's own output.

### Cost Observations
- Model mix: Opus reserved for verification/review/plan-check/integration + the orchestrator's judgment; Sonnet for all execution/doc-generation subagents (per the standing model policy). Effort tuned per task (high for verify/plan-check, medium for execution/docs).
- Notable: background `Workflow` fan-outs let verification run in parallel with hands-on UAT, compressing wall-clock without inflating orchestrator context.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v0.1 | multiple | 7 | Established the GSD workflow-orchestrated pipeline (background Workflow fan-outs, Opus-verify/Sonnet-execute split, self-driven Playwright UAT). |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v0.1 | ~101 Rust workspace + 339 web vitest | all phases verified passed, 5/5 E2E flows wired | papaparse (CSV), totp-rs (TOTP), tower-http fs (static serve) |

### Top Lessons (Verified Across Milestones)

1. (v0.1) Commit verification artifacts last to avoid the staleness gate.
2. (v0.1) Independent adversarial verification catches what single-pass verification misses.
