---
phase: 25
slug: member-removal-suspension-re-key
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-04
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded by plan-phase from `25-RESEARCH.md` § Validation Architecture. The Per-Task
> Verification Map is filled in once PLAN.md task IDs exist (`/gsd-validate-phase 25`).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (server)** | `cargo test --workspace` — built-in `#[tokio::test]`, no external framework |
| **Framework (web unit)** | Vitest — `web/vitest.config.ts` |
| **Framework (web e2e)** | Playwright — `web/playwright.config.ts` |
| **Config file** | `crates/pv-server/Cargo.toml` (no separate test config); `web/vitest.config.ts`; `web/playwright.config.ts` |
| **Quick run command** | `cargo test -p pv-server --test family_removal` |
| **Full suite command** | `cargo build --workspace && cargo build -p pv-wasm --target wasm32-unknown-unknown --release && cargo test --workspace` |
| **Estimated runtime** | ~90 seconds (server full suite); e2e adds ~2–3 min |

---

## Sampling Rate

- **After every task commit:** `cargo test -p pv-server --test <relevant file>` (or `npm run test -- <relevant component>` for web changes)
- **After every plan wave:** `cargo test --workspace` + `npm run test` + relevant `npm run test:e2e` specs
- **Before `/gsd-verify-work`:** Full suite green — `cargo build --workspace && cargo build -p pv-wasm --target wasm32-unknown-unknown --release && cargo test --workspace`, plus `npm run test` / `npm run test:e2e` for web
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

> Seeded at plan time — task IDs are assigned when PLAN.md files are written.
> Populate via `/gsd-validate-phase 25` after planning completes.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _pending_ | — | — | FAM-07 | — | Suspend is reversible, immediate, triggers no re-key | integration | `cargo test -p pv-server --test family_removal -- suspend` | ❌ W0 | ⬜ pending |
| _pending_ | — | — | FAM-08 | T-25-rekey | Removal triggers scoped, atomic re-key behind 2nd confirmation | integration + e2e | `cargo test -p pv-server --test family_removal -- remove_member` | ❌ W0 | ⬜ pending |
| _pending_ | — | — | FAM-09 | T-25-session | Suspended/removed member loses access on very next request; no already-issued token carries access | integration | `cargo test -p pv-server --test family_removal -- immediate_access_loss` | ❌ W0 | ⬜ pending |
| _pending_ | — | — | FAM-10 | T-25-fk | Account deletion runs the same re-key path before dropping the user row | integration | `cargo test -p pv-server --test account_deletion` | ❌ W0 | ⬜ pending |
| _pending_ | — | — | KEY-06 | — | Re-key cost proportional to that collection's members+items, never the whole vault | load | `cargo test -p pv-server --test family_removal -- rekey_cost_proportional --ignored` | ❌ W0 | ⬜ pending |
| _pending_ | — | — | KEY-07 | T-25-atomic | Re-key atomic under injected mid-transaction fault | integration (fault injection) | `cargo test -p pv-server --test family_removal -- rekey_atomic_under_fault` | ❌ W0 | ⬜ pending |
| _pending_ | — | — | SEC-07 | T-25-nonce | Batch rewrap never reuses a nonce | property | `cargo test -p pv-core -- nonce_uniqueness_large_batch` | ❌ W0 | ⬜ pending |
| _pending_ | — | — | UX-04 | — | Removal confirmation lists real item names + honesty copy | e2e (real WASM) + component | `npx playwright test remove-member-dialog` | ❌ W0 | ⬜ pending |
| _pending_ | — | — | KEY-02 (SC 6) | — | `enc_data` byte-identical before/after re-key, asserted directly | integration | `cargo test -p pv-server --test family_removal -- rekey_enc_data_byte_identical` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `crates/pv-server/tests/family_removal.rs` — FAM-07/08/09, KEY-06/07, SEC-07, KEY-02 (SC 6)
- [ ] `crates/pv-server/tests/account_deletion.rs` — FAM-10 plus the FK-ordering hazard (Research Pitfalls 1–2)
- [ ] `crates/pv-core/src/items.rs` — new `#[cfg(test)] mod tests` cases for `rewrap_item_key_for_collection` (roundtrip, wrong-old-key rejection, AAD prefix-separation)
- [ ] `web/src/lib/families/rekey.real-wasm.test.ts` — new, mirrors `web/src/lib/invite/crypto.real-wasm.test.ts`'s no-mock pattern; covers the client-side batch-computation half of UX-04 / KEY-02
- [ ] `web/e2e/remove-member.spec.ts` and `web/e2e/delete-account.spec.ts` — new, reusing `twoSessions` / `ensureFamilyOwnerSession` fixtures from `web/e2e/fixtures.ts`
- [ ] `crates/pv-server/src/lib.rs` — direct `PRAGMA foreign_keys` assertion (closes Research Assumption A1 / Pitfall 3), alongside the existing `build_pool_enables_wal_journal_mode` test
- [ ] Route-sweep tripwire update: `crates/pv-server/src/routes/mod.rs`'s `family_routes()` / `membership_routes()` cardinality tests (currently `.len() == 6` / `.len() == 10`) MUST be updated in the same commit that adds routes — failing by design is the intended tripwire, not a bug to route around

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Honesty copy reads as truthful to a human — the remove dialog must not leave the impression that removal is retroactive | UX-04 | Truthfulness of security copy is a human judgment; no assertion can prove a sentence does not mislead | Open the remove dialog against a member with at least one shared folder and one directly-shared item. Read the disclosure and warning aloud. Confirm it names what they could see, recommends rotation, and never implies past access is undone. |

*Everything else in this phase has automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
