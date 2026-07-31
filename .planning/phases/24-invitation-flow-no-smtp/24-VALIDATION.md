---
phase: 24
slug: invitation-flow-no-smtp
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-31
---

# Phase 24 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Content below is derived from
> `24-RESEARCH.md`'s `## Validation Architecture` section, updated to match the FINAL plan set (post
> Amendment 2 proof-of-possession leg, post plan-checker fixes: `fetch_metadata` is a POST not a GET,
> the concurrency proof uses a genuinely multi-connection shared-cache pool + `tokio::spawn`/`Barrier`
> rather than `tokio::join!` on raw futures, and the e2e commands resolve via `npm --prefix web run
> test:e2e`, not a root-level `npx playwright test`).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (pv-core / pv-wasm)** | `cargo test` — native (non-wasm32) `#[cfg(test)]` unit tests |
| **Framework (pv-server)** | `cargo test` — `tests/*.rs` integration harness against the real router (`tests/common/mod.rs`) |
| **Framework (web unit)** | Vitest |
| **Framework (web e2e)** | Playwright, two real browser contexts (`web/e2e/fixtures.ts::twoSessions`) |
| **Config file** | `Cargo.toml` (workspace member configs — no per-crate override), `web/vitest.config.ts`, `web/playwright.config.ts` |
| **Quick run command** | `cargo test -p pv-core invite::` / `cargo test -p pv-server --test invitations` / `npm --prefix web run test -- invite` |
| **Full suite command** | `cargo test --workspace && npm --prefix web run test && npm --prefix web run test:e2e` |
| **Estimated runtime** | ~90 seconds (`cargo test --workspace` ~40s incl. the 20-trial concurrency test × 3 verification reruns; `npm run test` ~15s; `npm run test:e2e -- invite-flow.spec.ts` ~25s for 5 scenarios × 3 reruns) |

---

## Sampling Rate

- **After every task commit:** the task's own `<verify><automated>` command (see each PLAN.md — every
  one of this phase's 16 tasks carries a real, runnable command, no `MISSING` placeholders).
- **After every plan wave:** `cargo test --workspace` (Rust-touching waves) and/or `npm --prefix web
  run test` (web-touching waves) — see the Per-Task Verification Map below for which applies per task.
- **Before `/gsd-verify-work`:** Full suite green, including `npm --prefix web run test:e2e`, and the
  concurrency test (`24-04-01`) re-run 3 consecutive times with zero `double_wins`/`zero_wins`/`500`s.
- **Max feedback latency:** ~30 seconds (the slowest single command, the concurrency test's 20 trials).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 24-01-01 | 01 | 1 | FAM-04/05/06 | T-24-01/02/03/21 | Migration 0017 applies additively; `pv_core::invite`'s three HKDF derivations (`invite_id`, `invite_wrap_key`, `invite_proof`) are pairwise distinct and correctly bound/unbound via AAD | unit | `cargo test -p pv-core invite:: && cargo test -p pv-server --test family -- --test-threads=1` | ❌ W0 | ⬜ pending |
| 24-01-02 | 01 | 1 | FAM-04/05/06 | — | `OptionalSessionUser` never weakens `SessionUser`; `families::add_member`/`collections::add_member` behavior-preserving after extraction | integration | `cargo test -p pv-server --test family --test collections` | ✅ (existing suites) | ⬜ pending |
| 24-02-01 (tracer) | 02 | 2 | FAM-04/05/06 | T-24-04/05/06/07/08/09 | Full family-only happy path (create → fetch_metadata → accept) works end-to-end through the real router with a correct proof; wrong proof and no-session are rejected | integration | `cargo test -p pv-server --test invitations --test membership_route_sweep -- --test-threads=1` | ❌ W0 | ⬜ pending |
| 24-02-02 | 02 | 2 | FAM-04/05/06 | T-24-06/07/08/09/22 | Collection-scoped branch, already-a-member no-op, revoke, rate-limit ceiling, Pitfall-9 re-validation, unified-failure-cause parity (incl. wrong-proof), zero `identity_verifications` writes | integration | `cargo test -p pv-server --test invitations` | ❌ W0 | ⬜ pending |
| 24-03-01 | 03 | 2 | FAM-04/06 | T-24-11/23 | `WasmInviteChannel` round-trips a Collection Key wrap/unwrap across two independently-constructed handles from the same secret; `proofHashForCreation`/`proofForRedemption` never conflated | unit | `cargo test -p pv-wasm invite_channel_tests::` | ❌ W0 | ⬜ pending |
| 24-04-01 | 04 | 3 | FAM-04 (SC 4) | T-24-05 (proof) | Two genuinely concurrent `accept` calls (real multi-connection pool, `tokio::spawn`+`Arc<Barrier>`, 20 trials) against the same invite yield exactly one winner; the loser is `404`, never `500` | integration (concurrency) | `cargo test -p pv-server --test invitations concurrent_redemption_exactly_one_wins -- --nocapture` (run 3× before sign-off) | ❌ W0 | ⬜ pending |
| 24-04-02 | 04 | 3 | FAM-04/05 (SC 2, SC 4) | T-24-07 (proof)/09 (proof)/10 | Real-WS fan-out to existing collection members; metadata never leaks `enc_name`; `invite_id` alone (no/wrong proof) is rejected on both `fetch_metadata` and `accept`; every response carries `Referrer-Policy` | integration (real WS) | `cargo test -p pv-server --test invitations --test sync_shared -- --test-threads=2 && cargo test -p pv-server routes::mod::tests` | ❌ W0 | ⬜ pending |
| 24-05-01 | 05 | 3 | FAM-04/06 | T-24-14 | `ensureOwnIdentityKeypair` idempotent under a simulated two-device race; WASM choke-point rule holds (no new `./wasm` import site) | unit | `npm --prefix web run test -- identity/ensure` | ❌ W0 | ⬜ pending |
| 24-05-02 | 05 | 3 | FAM-04/06 | T-24-12/13/24 | `generateInviteLink` sends the HASH at creation, never the raw proof; `fetchInviteMetadataFlow`/`redeemInviteFlow` send the SAME raw proof to both calls; tampered-fragment self-consistency check fires before any network call | unit | `npm --prefix web run test -- lib/invite` | ❌ W0 | ⬜ pending |
| 24-05-03 | 05 | 3 | FAM-05/06 | T-24-16 (copy) | All 41 new i18n keys exist in both `pl`/`en`; `invite.fingerprintHonesty`/`invite.honestVisibilityNote` copy matches UI-SPEC verbatim | unit + typecheck | `npm --prefix web run test -- i18n && npm --prefix web run typecheck` | ❌ W0 | ⬜ pending |
| 24-06-01 | 06 | 4 | FAM-05 (SC 2) | T-24-15 | Invite view resolves at mount before any auth branch; loading/invalid states render with zero leaked context on failure | component | `npm --prefix web run test -- InviteLandingView` | ❌ W0 | ⬜ pending |
| 24-06-02 | 06 | 4 | FAM-05/06 (SC 2, SC 3) | T-24-15/16/17 | Register-and-join, session-exists (with locked-vault gating), wrong-account escape, retry-after-register-failure, already-member notice — all 19 E1-E4 UI Considerations represented | component | `npm --prefix web run test -- InviteLandingView` | ❌ W0 | ⬜ pending |
| 24-07-01 | 07 | 4 | FAM-04 (SC 1) | — | Family bootstrap + scope/expiry form defaults are submittable immediately; zero-folder collection-scope disabling; creation-failure preserves form state | component | `npm --prefix web run test -- FamilyTab` | ❌ W0 | ⬜ pending |
| 24-07-02 | 07 | 4 | FAM-04 (SC 1) | T-24-18/19 | Generated-link display uses the auto-clearing copy pairing (never a plain clipboard write); revoke is confirmation-gated with a visible label | component | `npm --prefix web run test -- FamilyTab` | ❌ W0 | ⬜ pending |
| 24-08-01 | 08 | 5 | FAM-05/06 (SC 2, SC 3) | — | Brand-new invitee inline registration + join, existing-account direct join, and invalid-link rejection all work live in a real two-context browser session | e2e | `npm --prefix web run test:e2e -- e2e/invite-flow.spec.ts --project=chromium` (run 3× before sign-off) | ❌ W0 | ⬜ pending |
| 24-08-02 | 08 | 5 | FAM-05/06 (SC 3) | T-24-20 | Wrong-account escape genuinely clears session without reload; already-a-member redemption lands in vault with no error | e2e | `npm --prefix web run test:e2e -- e2e/invite-flow.spec.ts --project=chromium` (run 3× before sign-off) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### ROADMAP Success Criteria → discharging layer

| SC | Statement | Discharged by |
|----|-----------|----------------|
| SC 1 | Owner generates single-use, expiring link/code, no SMTP | 24-01 (crypto/schema) → 24-02-01/02 (server create/revoke/rate-limit) → 24-07-01/02 (owner UI) |
| SC 2 | Join confirmation before membership; no vault metadata pre-redemption | 24-02-01/02 (`fetch_metadata` proof-gated response shape) → 24-04-02 (adversarial leak + `invite_id`-alone proof) → 24-06-01/02 (UI unified-failure/context-header rendering) |
| SC 3 | One link works for brand-new AND existing-account, branch at redemption | 24-02-01 (`OptionalSessionUser`) → 24-05-02 (`redeemInviteFlow`) → 24-06-02 (both UI branches) → 24-08-01/02 (live two-session proof) |
| SC 4 | Expired/consumed rejected; concurrent redemption → exactly one join | 24-02-02 (guarded UPDATE, rate-limit, unified failure) → 24-04-01 (genuinely concurrent proof, real multi-connection pool) → 24-04-02 (`invite_id`-alone adversarial proof) |

---

## Wave 0 Requirements

Every task above already has a real, runnable `<automated>` command declared in its own PLAN.md — none
are `MISSING`. The files those commands exercise do not exist yet (this phase is entirely greenfield:
`crates/pv-server/tests/invitations.rs`, `crates/pv-server/src/routes/invitations.rs`,
`crates/pv-wasm/src/lib.rs`'s `invite_channel_tests` module, `web/src/lib/invite/*`,
`web/src/components/invite/*`, `web/src/components/settings/FamilyTab.tsx`,
`web/e2e/invite-flow.spec.ts`), which is why every row above is marked `❌ W0` — this is the NORMAL
"Wave 0 creates the test alongside the code it tests" shape for a new phase, not a gap. No separate
Wave 0 scaffolding task is needed: each plan's own first task creates its test file as part of
implementing the behavior (TDD-adjacent, per each plan's `tdd="true"` task markers).

- [x] No standalone Wave 0 test-scaffold task required — every plan's Task 1 creates its own test file
      alongside the implementation it verifies.

*Existing infrastructure (`tests/common/mod.rs`, `web/e2e/fixtures.ts`, `vitest.config.ts`,
`playwright.config.ts`) already covers everything this phase's new tests need — no new test
framework/dependency install.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual/taste check of the invite landing card, fingerprint chunking, and the Family tab's generated-link display against `24-UI-SPEC.md`'s Copywriting/Color/Spacing contract | FAM-05, UX-adjacent | Nyquist/automated tests cover behavior and copy-string exactness, not subjective visual polish (chunking readability, spacing rhythm) — this is the standard `human_needed` class this project's `ui-checker`/human-verify loop already covers, not a phase-specific gap | Run the app locally, generate a family-only and a collection-scoped invite, open the link in a second browser profile, and visually compare against `24-UI-SPEC.md`'s Phase-Specific Notes §1/§2 |

*All FUNCTIONAL phase behaviors have automated verification — the row above is the standard
visual-taste backstop this project's `human_needed` UAT lane already handles, not evidence of an
untested behavior.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (all 16 have one)
- [x] Wave 0 covers all MISSING references (none — see Wave 0 Requirements note above)
- [x] No watch-mode flags in any command
- [x] Feedback latency < 30s per command (concurrency test's 20-trial run is the slowest single command)
- [ ] `nyquist_compliant: true` set in frontmatter — left `false` for `/gsd-validate-phase` to flip
      after live execution confirms every command above actually runs as written

**Approval:** pending
