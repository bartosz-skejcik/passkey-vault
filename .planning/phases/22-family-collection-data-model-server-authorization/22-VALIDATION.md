---
phase: 22
slug: family-collection-data-model-server-authorization
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-30
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `22-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `cargo test` (native Rust, `#[tokio::test]` for async integration tests) — no config file; matches the existing `crates/pv-server/tests/*.rs` convention |
| **Config file** | none — `tests/common/mod.rs` provides the shared harness (`test_pool()`, `test_app()`, `register_and_login()`) |
| **Quick run command** | `cargo test -p pv-server` |
| **Full suite command** | `cargo test --workspace` |
| **Estimated runtime** | ~30s workspace (v0.3 baseline ~153 tests; Phase 21 left it at 196) |

---

## Sampling Rate

- **After every task commit:** `cargo test -p pv-server` (plus `cargo test -p pv-core` for any task that touches `identity.rs`/`items.rs`)
- **After every plan wave:** `cargo test --workspace`
- **Before `/gsd-verify-work`:** full workspace suite green **and** `bash scripts/check-supply-chain.sh` exit 0
- **Max feedback latency:** 30 seconds

> Note: this phase touches no web/extension source, so the JS suites are not part of the per-wave
> gate. They were run at Phase 21 close as a bridge-change regression check (481 web / 693 ext) and
> are only needed again if a plan unexpectedly touches `web/` or `extension/`.

---

## Per-Task Verification Map

> Task IDs are assigned by the planner; filled in during `/gsd-validate-phase`. The
> requirement→test mapping those tasks must satisfy is fixed below.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 22-01-01 | 01 | 1 | SEC-06 | CVE-2026-43639 | Non-member reaches no mutating endpoint | integration | `cargo test -p pv-server membership_route_sweep_rejects_non_member_on_every_route` | ❌ W0 | ⬜ pending |

---

## Requirement → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| FAM-01 | Family create + sole member with join timestamp | integration | `cargo test -p pv-server family_create_creates_sole_member_with_join_timestamp` | ❌ W0 — `tests/family.rs` |
| FAM-01 | Second create attempt returns `Conflict` (single family per instance) | integration | `cargo test -p pv-server second_family_create_returns_conflict` | ❌ W0 — `tests/family.rs` |
| FAM-02 | Member list shows join timestamp | integration | `cargo test -p pv-server member_list_includes_joined_at` | ❌ W0 — `tests/family.rs` |
| FAM-03 | Owner queries per-member collections + item shares | integration | `cargo test -p pv-server owner_sees_per_member_access_breakdown` | ❌ W0 — `tests/family.rs` |
| SHARE-04 | Hidden-password holder cannot reassign item (Vaultwarden #6269) | integration, dedicated regression | `cargo test -p pv-server hidden_password_holder_cannot_reassign_item_vaultwarden_6269_regression` | ❌ W0 — `tests/collections.rs` |
| SHARE-05 / SEC-06 | Every mutating membership route rejects a non-member | integration, route sweep | `cargo test -p pv-server membership_route_sweep_rejects_non_member_on_every_route` | ❌ W0 — `tests/membership_route_sweep.rs` |
| SHARE-06 | Revoking a share is enforced on the very next request, same session | integration | `cargo test -p pv-server revoked_share_loses_access_on_next_request_same_session` | ❌ W0 — `tests/collections.rs` |
| KEY-01 (server half) | Keypair upsert idempotent under concurrent first-unlock | integration | `cargo test -p pv-server keypair_upsert_concurrent_race_self_heals_to_canonical` | ❌ W0 — `tests/identity_keypair.rs` |
| KEY-01 (server half) | Keypair generation rewrites no `enc_data` byte | integration, byte-level DB comparison | `cargo test -p pv-server keypair_generation_does_not_rewrite_enc_data_bytes` | ❌ W0 — `tests/identity_keypair.rs` |
| KEY-02 (fan-out) | 3+ members, N distinct `SealedKey` rows, each opens only under own key | integration, uses `pv_core::identity` client-side | `cargo test -p pv-server collection_key_fan_out_three_members_each_opens_only_own_seal` | ❌ W0 — `tests/collections.rs` |
| KEY-02 (fan-out) | Adding a member creates exactly one wrap row, rewrites no `enc_data` | integration, byte-level DB comparison | `cargo test -p pv-server adding_member_creates_one_wrap_row_no_ciphertext_rewrite` | ❌ W0 — `tests/collections.rs` |

### Additional checks derived from decisions (not requirement-mapped but gate-relevant)

| Property | Why it matters | Automated check |
|----------|----------------|-----------------|
| Non-member gets **404**, not 403 | 403 confirms existence — metadata leak (SYNC-07 precursor) | assertion inside the route-sweep test |
| Insufficient-level gets **403** on a reachable resource | `read` holder attempting edit; existence is not secret here | assertion in `tests/collections.rs` |
| Cross-collection move requires `edit` on **both** source and destination | otherwise items can be pushed into a read-only collection | dedicated test beside the #6269 regression |
| `GET /api/sync` authorization scope unchanged (`session.user_id` only) | v0.3 hardening + Phase 23 SC#5 depends on it | existing sync tests must stay green, unmodified |
| Server never calls `unseal` | zero-knowledge boundary | `grep`-style source assertion / review gate |

---

## Wave 0 Requirements

- [ ] `crates/pv-server/src/routes/membership.rs` — the authorization extractor + resource-kind / min-access traits
- [ ] `crates/pv-server/src/routes/families.rs`, `collections.rs`, `identity.rs` — new handler modules
- [ ] `crates/pv-server/src/error.rs` — add `ApiError::Forbidden` (403); keep `NotFound` for no-access
- [ ] `crates/pv-server/migrations/0014_family_sharing.sql` — 7 new tables **plus `ALTER TABLE vault_items ADD COLUMN collection_id`** (research found the column does not exist today)
- [ ] `crates/pv-server/src/routes/mod.rs` — table-driven route registration the sweep test iterates
- [ ] `crates/pv-server/tests/membership_route_sweep.rs`, `family.rs`, `collections.rs`, `identity_keypair.rs` — all new
- [ ] `crates/pv-server/tests/common/mod.rs` — multi-user setup helper (mirrors the existing `register_and_login` precedent)
- [ ] Framework install: **none** — `cargo test` already wired; `pv-server` already depends on `pv-core` (verified), so the fan-out test can unseal client-side

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | All Phase 22 behaviors are server-side and automatable. No UI ships in this phase, so nothing needs human validation. |

*Recorded explicitly: this phase should reach `passed` with zero `human_needed` items. If verification returns `human_needed`, that is a signal something drifted out of scope into a surface that needs eyes.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
