---
phase: 31
slug: the-share-dialog-per-person-access-existing-destinations
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-12
---

# Phase 31 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `31-RESEARCH.md`'s `## Validation Architecture`. The planner fills the
> Per-Task Verification Map.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.4 (unit + real-WASM) / Playwright 1.61.1 (live e2e) — both already configured |
| **Config file** | `web/vitest.config.ts`, `web/playwright.config.ts` (pre-existing, unchanged by this phase) |
| **Quick run command** | `cd web && npm test -- ShareDialog` |
| **Full suite command** | `cargo test --workspace --no-fail-fast && cd web && npm run compile && npm test && npm run build` |
| **Estimated runtime** | ~90 s quick lane; ~6 min full CI-width set; +~2 min per live Playwright spec |

---

## Sampling Rate

- **After every task commit:** `cd web && npm test -- ShareDialog` **and** `cargo test -p pv-server`
- **After every plan wave:** `cargo test --workspace --no-fail-fast` **and** `cd web && npm run compile && npm test`
- **Before `/gsd-verify-work`:** the full CI-width set green, plus the live Playwright spec **from a
  fresh build of HEAD** — mirroring Phase 30's own gate.
- **Max feedback latency:** 90 seconds

> ⚠ **Verify at CI width.** `-p pv-server` and bare `vitest run` are the two narrower commands that let
> Phase 30 ship two blockers — `--workspace` catches feature-unification differences, and `npm run
> compile` is the only lane that typechecks. Narrow commands are fine for the per-task sampling above;
> they are **not** acceptable as a task's `verify` field or as phase acceptance.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _(planner fills)_ | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Requirement → proof obligations (from RESEARCH.md, binding on the planner)

| Req | Behaviour that must be proven | Test type | Wave 0? |
|-----|------------------------------|-----------|---------|
| MOD-01 / SC1 | Two people, two different levels, one submission — each recipient's **server-stored** level matches their own row | live e2e | ❌ new |
| MOD-02 / SC2 | Existing-folder destination: collection count **equal before and after**, membership rows carry the chosen folder's id | live e2e (server state) | ❌ new |
| MOD-03 / SC4 | The hidden-password inline note states "interface protection, never cryptographic" with no hover and no second click, **on a repeat share by an already-acked account** — the common case the UI checker found unproven | unit (rendered text) + PL-width backstop | ❌ new copy |
| ORG-03 / SC3 | A person added to an existing folder decrypts the items **already in it** — recipient-side, real crypto | real-WASM | ❌ extend |
| 6th obligation | "brak dostępu" revokes: positive "was readable" anchor before, the same read failing after the next completed sync | live e2e, 2 real sessions | ❌ new |
| Q2 (level edit) | Changing an existing recipient's level updates server state with no intermediate under/over-access window, bounded by the same `may_grant_access_level` matrix and the item_bucket declared-level bound | server integration + live | ❌ new routes |
| SC5 | Destination key unavailable / recipient with no published identity key: refused honestly, **server state asserted unchanged**, failure branch **deliberately driven** (concurrent revoke mid-session), never incidental | live e2e | ❌ new |

---

## Wave 0 Requirements

- [ ] `crates/pv-server/tests/collections.rs` — `update_access` route tests: the full 9-pair
      `may_grant_access_level` matrix (mirror `b1_hidden_password_...`'s shape),
      `enforce_item_bucket_declared_level_bound` coverage, 404 when no existing row
- [ ] `crates/pv-server/tests/vault.rs` — the equivalent for the item-share `PUT` route
- [ ] `web/src/components/vault/ShareDialog.real-wasm.test.ts` — extend with an existing-destination
      case: reshare into a collection that already holds items, assert the new recipient's client
      decrypts a **pre-existing** item
- [ ] `web/e2e/sharing.spec.ts` — SC1 per-recipient level, SC2 collection count, the revocation anchor,
      and SC5's deliberately-driven destination-unavailable case
- [ ] Framework install: none — Vitest and Playwright are already configured

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PL string width in the real rendered dialog card | MOD-03 / UI-SPEC G3 | Overflow is a layout property of the shipped card at real font metrics; the automated backstop catches gross overflow but not "technically fits, reads badly" | Open the share dialog at 375 px and at desktop width with a row set to `hidden_password`; confirm the revised `share.hiddenPasswordInlineNote` PL string wraps without clipping and without pushing the footer off-screen |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90 s
- [ ] Every new test **falsification-proven** — reverted, observed red with its exact output recorded, restored
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
