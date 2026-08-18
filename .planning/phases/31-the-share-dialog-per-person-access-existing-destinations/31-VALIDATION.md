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
| 31-01-T1 | 31-01 | 1 | MOD-01 (Q2) | T-31-01..05 | update_access/update_share round-trip + 404-not-upsert | server integration (TDD) | `cargo test --workspace --no-fail-fast` | ✅ new | ✅ done |
| 31-01-T2 | 31-01 | 1 | MOD-01 (Q2) | T-31-01, T-31-02 | Full 9-pair matrix + item_bucket bound + self-escalation regression | server integration (TDD) + falsification | `cargo test --workspace --no-fail-fast` | ✅ new | ✅ done |
| 31-02-T1 | 31-02 | 2 | MOD-01, MOD-03 | T-31-06, T-31-07, T-31-08 | Family-wide isolated to its own control; BOTH scopes migrated to the row model in one step (folder mint-new grant + item grant/update/revoke); hidden-password re-anchored to rows; single-scroll-region shell | unit + e2e (TDD) + falsification (dispatch-count) | `cd web && npm run compile && npm test && npm run build && npx playwright test e2e/sharing.spec.ts e2e/shared-sync.spec.ts e2e/export-disclosure.spec.ts e2e/family-wide-sharing.spec.ts --retries=0` | ✅ new markup | ✅ done |
| 31-03-T1 | 31-03 | 3 | MOD-01, MOD-02 | T-31-09, T-31-10 | Destination selector + row re-seed on switch; folder-branch update/revoke reachability + dispatch-count proof | unit (TDD) + falsification | `cd web && npm run compile && npm test && npm run build && npx playwright test e2e/sharing.spec.ts e2e/shared-sync.spec.ts e2e/export-disclosure.spec.ts e2e/family-wide-sharing.spec.ts --retries=0` | ✅ new | ✅ done |
| 31-03-T2 | 31-03 | 3 | ORG-03 (SC3) | T-31-11 | New recipient on existing destination decrypts pre-existing item | real-WASM + falsification | `cd web && npm run compile && npm test` (unit lane is correct here — this task extends a real-WASM test and changes no dialog markup, so no e2e spec can observe it) | ✅ extend | ✅ done |
| 31-03-T3 | 31-03 | 3 | MOD-01 (SC1), MOD-02 (SC2) | — | Per-recipient level + collection-count/destination-id live proof | live e2e (server state) | `cd web && npm run build && npx playwright test e2e/sharing.spec.ts e2e/shared-sync.spec.ts e2e/export-disclosure.spec.ts e2e/family-wide-sharing.spec.ts --retries=0` | ✅ extend | ✅ done |
| 31-04-T1 | 31-04 | 4 | MOD-01 | T-31-13 | Pending-revocations honesty summary | unit (TDD) + falsification | `cd web && npm run compile && npm test && npm run build && npx playwright test e2e/sharing.spec.ts e2e/shared-sync.spec.ts e2e/export-disclosure.spec.ts e2e/family-wide-sharing.spec.ts --retries=0` | ✅ new | ✅ done |
| 31-04-T2 | 31-04 | 4 | MOD-01 | T-31-12, T-31-14 | Positive read before revoke, failing read after next sync (2 real sessions, relock-before-anchor) | live e2e (2 sessions) + falsification | `cd web && npm run build && npx playwright test e2e/sharing.spec.ts e2e/shared-sync.spec.ts e2e/export-disclosure.spec.ts e2e/family-wide-sharing.spec.ts --retries=0` | ✅ new | ✅ done |
| 31-05-T1 | 31-05 | 5 | MOD-01 | — | Submit CTA distinguishes editing an existing access picture from a fresh share | unit (TDD) + falsification | `cd web && npm run compile && npm test && npm run build && npx playwright test e2e/sharing.spec.ts e2e/shared-sync.spec.ts e2e/export-disclosure.spec.ts e2e/family-wide-sharing.spec.ts --retries=0` | ❌ new | ⬜ pending |
| 31-05-T2 | 31-05 | 5 | MOD-03 (SC4) | T-31-15 | Hidden-password honesty on a repeat share (revised wording) | unit (TDD) + falsification + manual PL-width | `cd web && npm run compile && npm test && npm run build && npx playwright test e2e/sharing.spec.ts e2e/shared-sync.spec.ts e2e/export-disclosure.spec.ts e2e/family-wide-sharing.spec.ts --retries=0` + human-check | ❌ new | ⬜ pending |
| 31-06-T1 | 31-06 | 6 | MOD-01, MOD-02, ORG-03 (SC5) | T-31-16 | Destination-unavailable refusal, deliberately driven, named session + before/after baseline | unit + live e2e (TDD) + falsification | `cd web && npm run compile && npm test && npm run build && npx playwright test e2e/sharing.spec.ts e2e/shared-sync.spec.ts e2e/export-disclosure.spec.ts e2e/family-wide-sharing.spec.ts --retries=0` | ❌ new | ⬜ pending |
| 31-06-T2 | 31-06 | 6 | MOD-01, MOD-02 (Q2) | T-31-17 | Atomic level-edit + fresh-grant live proof (end-state); full CI-width sweep | live e2e + full CI sweep | `cargo test --workspace --no-fail-fast && cd web && npm run compile && npm test && npm run build && npx playwright test e2e/sharing.spec.ts e2e/shared-sync.spec.ts e2e/export-disclosure.spec.ts e2e/family-wide-sharing.spec.ts --retries=0` | ❌ new | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> **Four e2e specs drive this dialog, not one** (plan-check iteration 2, verified by `grep -rl` over
> `web/e2e/`): `sharing.spec.ts`, `shared-sync.spec.ts`, `export-disclosure.spec.ts`, and
> `family-wide-sharing.spec.ts`. Every live acceptance command above runs all four. Running only
> `sharing.spec.ts` would have let the row migration silently break two specs, and would have left
> `family-wide-sharing.spec.ts:373-376`'s mutual-exclusivity assertion passing vacuously against zero
> elements once the list holds `<select>`s instead of checkboxes.

Note: Q2's "no intermediate under/over-access window" claim is proven jointly by two task-level assertions, not one — the dispatch-level half (exactly one `updateCollectionAccess` call, zero revoke/grant calls, for the edited recipient) is a unit assertion in 31-03-T1 (folder branch) and 31-02-T1 (item branch); the end-state half (server reflects both changes correctly) is 31-06-T2's live e2e. A final-state-only read cannot distinguish an atomic update from a client-side revoke-then-re-add that converges on the same state, so the dispatch-level assertions are load-bearing, not redundant.

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

- [x] `crates/pv-server/tests/collections.rs` — `update_access` route tests: the full 9-pair
      `may_grant_access_level` matrix (mirror `b1_hidden_password_...`'s shape),
      `enforce_item_bucket_declared_level_bound` coverage, 404 when no existing row
      — covered by 31-01-T2
- [x] `crates/pv-server/tests/vault.rs` — the equivalent for the item-share `PUT` route
      — covered by 31-01-T2
- [x] `web/src/components/vault/ShareDialog.real-wasm.test.ts` — extend with an existing-destination
      case: reshare into a collection that already holds items, assert the new recipient's client
      decrypts a **pre-existing** item
      — covered by 31-03-T2
- [x] `web/e2e/sharing.spec.ts` — SC1 per-recipient level, SC2 collection count, the revocation anchor,
      and SC5's deliberately-driven destination-unavailable case
      — SC1/SC2 covered by 31-03-T3, revocation anchor by 31-04-T2, SC5 by 31-06-T1, Q2 live proof by 31-06-T2
- [x] Framework install: none — Vitest and Playwright are already configured

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
