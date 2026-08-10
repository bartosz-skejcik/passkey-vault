---
phase: 30
slug: the-living-group-family-wide-sharing
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: true
created: 2026-08-10
---

# Phase 30 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `30-RESEARCH.md` § Validation Architecture, reconciled against the 17 plans this
> phase actually produced (`30-01`..`30-17`).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (web unit + `*.real-wasm.test.ts`) + `cargo test` (Rust, `crates/pv-server`) + Playwright (`web/e2e/`, live browser, multi-session) |
| **Config file** | `web/vitest.config.ts`, `web/playwright.config.ts`, workspace `Cargo.toml` |
| **Quick run command** | `cd web && npx vitest run <touched-file(s)>` / `cd crates/pv-server && cargo test --lib <module>::` |
| **Full suite command** | `cargo test --workspace && cd web && npm test && npx playwright test` |
| **Estimated runtime** | Unit/real-WASM: seconds. `cargo test --workspace`: low tens of seconds. Full `web/e2e/` including `family-wide-sharing.spec.ts`: several minutes (multi-account, multi-session, real sync-cycle waits). |

> **Hard project standard (REQUIREMENTS.md Non-Negotiable #2, restated for this phase
> specifically).** Both `web`'s vitest suite and `extension`'s mock `@/lib/crypto` wholesale. **A
> green vitest run is not evidence** for SC2, SC3, SC4, or SC6 — all four are explicitly live or
> real-WASM claims (ROADMAP.md's own wording). Concretely:
> - SC2/SC3/SC6 require a live, multi-session Playwright run (`30-16`/`30-17`) asserting on
>   RECIPIENT-SIDE decrypted content, never row presence.
> - SC4 requires BOTH a real-WASM unit test (`30-04` Task 2, mechanism-level) AND a Rust
>   integration test that inspects real rows/request bodies (`30-14`), never a mocked-crypto
>   assertion standing in for either.
> - SC1 has NO automated evidence at all — it is a git commit-order fact, verified manually (see
>   Manual-Only Verifications below), matching the KEY-05/EXT-10 precedent (both also verified
>   manually, never by an automated commit-order gate).

---

## Sampling Rate

- **After every task commit:** targeted `npx vitest run <path>` or `cargo test --lib <module>::` for the file(s) that task touched.
- **After every plan wave:** `cargo test --workspace` (server) + `cd web && npm run test` (mocked AND real-WASM lanes) + `npx tsc --noEmit` (`web/`).
- **Before `/gsd-verify-work`:** full suite green (`cargo test --workspace`, full web vitest including every `*.real-wasm.test.ts`, `npx playwright test e2e/family-wide-sharing.spec.ts` plus the existing `remove-member.spec.ts`/`invite-flow.spec.ts`/`shared-sync.spec.ts` to confirm no regression) — **and** SC1's manual commit-order check performed and recorded.
- **Max feedback latency:** ~10s (quick unit/real-WASM), ~60s (wave, cargo+vitest), several minutes (the live e2e waves, 6 and 7, which include real sync-poll-interval waits by design — never watch-mode, never skipped).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 30-01-01 | 01 | 1 | SC1 (decision record) | T-30-01 | Decision record commits alone, before any dependent code | manual (commit-order) | `git log --oneline -- .planning/phases/30-the-living-group-family-wide-sharing/30-DECISION-FSH-02.md` | ❌ new file | ⬜ pending |
| 30-01-02 | 01 | 1 | FSH-03 (schema) | T-30-01/T-30-02 | Migration additive-only; `idx_one_item_bucket_per_family` enforces at-most-one bucket per family | integration (existing suite as migration canary) | `cargo test --lib membership::` | ✅ (existing tests exercise `sqlx::migrate!`) | ⬜ pending |
| 30-02-02 | 02 | 2 | FSH-01/FSH-03 (family_wide_kind + bare ON CONFLICT) | T-30-06 | 409 (never 500) on a second `item_bucket` create for the same family | integration | `cargo test --lib collections::` | ❌ W0 (folded into task) | ⬜ pending |
| 30-02-03 | 02 | 2 | FSH-03/FSH-05 (discovery endpoint) | T-30-03/T-30-04/T-30-05 | ids/kind only, `ActiveFamilyMembership<RequireRead>`-gated, family-scoped | integration | `cargo test --lib families:: && cargo test --test membership_route_sweep` | ❌ W0 (folded into task) | ⬜ pending |
| 30-03-01/02 | 03 | 2 | FSH-02/FSH-03 (invite wire widening) | T-30-07/T-30-08/T-30-09 | Additive `invitation_family_wide_keys`; atomic multi-grant accept() | integration | `cargo test --lib invitations::` | ❌ W0 (folded into task) | ⬜ pending |
| 30-04-01 | 04 | 2 | FSH-02/FSH-03 (reseal logic) | T-30-10/T-30-11 | No rotation; T-25-16 no-silent-drop; 409-as-success idempotency | unit (mocked crypto — logic only) | `cd web && npx vitest run src/lib/families/reseal.test.ts` | ❌ W0 (folded into task) | ⬜ pending |
| 30-04-02 | 04 | 2 | **SC4 (mechanism, real-WASM)** | T-30-10 | Key preserved byte-for-byte through real unseal/seal, never mocked | **real-WASM** | `cd web && npx vitest run src/lib/families/reseal.real-wasm.test.ts` | ❌ W0 (folded into task) | ⬜ pending |
| 30-05-01 | 05 | 2 | **FAM-10 (regression)** | — | A family-wide collection flows through `buildMemberRemovalBatch` with zero special-casing | unit (mocked crypto acceptable — pure batch logic, RESEARCH.md's own call) | `cd web && npx vitest run src/lib/families/rekey.test.ts` | ❌ W0 (folded into task) | ⬜ pending |
| 30-05-02 | 05 | 2 | FSH-04 (quiet notice) | T-30-12 | Fires only on a sealed_key CHANGE for an already-known collection, never a new grant | unit | `cd web && npx vitest run src/lib/vault/collections.test.ts src/components/vault/FamilyRekeyNotice.test.tsx` | ❌ W0 (folded into task) | ⬜ pending |
| 30-06-01/02 | 06 | 3 | FSH-02/FSH-05 (discovery client + pull wiring) | T-30-13 | Fail-safe empty on error; short-circuited for no-family accounts | unit | `cd web && npx vitest run src/lib/families/familyWidePending.test.ts src/lib/vault/sync.test.ts` | ❌ W0 (folded into task) | ⬜ pending |
| 30-07-01/02 | 07 | 3 | FSH-02 (invite folding) | T-30-14 | Opaque wraps only; zero regression to single-collection invite path | unit | `cd web && npx vitest run src/lib/invite/crypto.test.ts` | ✅ (extend existing) | ⬜ pending |
| 30-08-01/02 | 08 | 3 | FSH-01/FSH-05 (ShareDialog row + folder variant) | T-30-15 | Mutual exclusivity; recipient set = server roster, never client-fabricated | unit | `cd web && npx vitest run src/components/vault/ShareDialog.test.tsx -t "family-wide"` | ✅ (extend existing) | ⬜ pending |
| 30-09-01 | 09 | 2 | (wire-type mirror) | T-30-16 | Omits key entirely when absent — no behavior change for existing callers | unit + typecheck | `cd web && npx vitest run src/lib/vault/api.test.ts -t "createCollection" && npx tsc --noEmit -p web/tsconfig.json` | ✅ (extend existing) | ⬜ pending |
| 30-10-01 | 10 | 3 | FSH-05 (SharingOverviewPanel block) | T-30-17 | Renders caller's own decrypted names only; degrades safely on partial fetch failure | unit | `cd web && npx vitest run src/components/vault/SharingOverviewPanel.test.tsx -t "family-wide"` | ✅ (extend existing) | ⬜ pending |
| 30-11-01/02 | 11 | 4 | FSH-01 (family badge) | T-30-18 | No fetch of its own; never renders alongside AvatarStack/sharedToMe | unit | `cd web && npx vitest run src/lib/vault/collections.test.ts -t "familyWide" src/components/vault/ItemRow.test.tsx -t "family badge"` | ✅ (extend existing) | ⬜ pending |
| 30-12-01 | 12 | 4 | FSH-01 (item bucket) | T-30-20 | Race-loser recovers via re-list on 409, never a duplicate bucket, never a user-visible error | unit | `cd web && npx vitest run src/components/vault/ShareDialog.test.tsx -t "family-wide item"` | ✅ (extend existing) | ⬜ pending |
| 30-13-01/02 | 13 | 4 | FSH-02 (reseal trigger) | T-30-21 | Per-session dedup; one failure never blocks other pairs; fire-and-forget, never blocks sync loop | unit | `cd web && npx vitest run src/lib/families/resealTrigger.test.ts src/lib/vault/store.test.ts -t "familyWide"` | ❌ W0 (folded into task) | ⬜ pending |
| 30-14-01 | 14 | 3 | **SC4 (adversarial, server-side)** | T-30-19 | Every row/body inspected; falsification-proven (a reintroduced leak makes the test fail) | **integration, adversarial** | `cargo test --test family_wide_sharing` | ❌ W0 (folded into task) | ⬜ pending |
| 30-15-01/02 | 15 | 5 | FSH-02/FSH-05 (pending row) | T-30-22 | Discriminant sourced ONLY from discovery endpoint, never a decrypt-exception catch-all | unit | `cd web && npx vitest run src/lib/vault/store.test.ts src/components/vault/ItemRow.test.tsx -t "pending" src/components/vault/DetailPanel.test.tsx -t "pending"` | ❌ W0 (folded into task) | ⬜ pending |
| 30-16-02 | 16 | 6 | **SC2** (current members read) | — | Recipient-side positive read on real decrypted content | **e2e, live** | `npx playwright test e2e/family-wide-sharing.spec.ts -g "current members read"` | ❌ W0 (folded into task) | ⬜ pending |
| 30-16-02 | 16 | 6 | **SC3** (fresh-invite late joiner) | — | Third real account decrypts real ciphertext via its own client | **e2e, live** | `npx playwright test e2e/family-wide-sharing.spec.ts -g "fresh invite"` | ❌ W0 (folded into task) | ⬜ pending |
| 30-16-03 | 16 | 6 | **FSH-02 gap-window / adjacency backstop** | — | Fourth account's key delivered via lazy reseal, no reload anywhere | **e2e, live, backstop** | `npx playwright test e2e/family-wide-sharing.spec.ts -g "gap window"` | ❌ W0 (folded into task) | ⬜ pending |
| 30-17-01 | 17 | 7 | **SC5 / FSH-05 precision backstop** | — | Both timing-caveat clauses checked against THIS suite's own measured sequences | **e2e, live, backstop** | `npx playwright test e2e/family-wide-sharing.spec.ts -g "timing copy matches measurement"` | ❌ W0 (folded into task) | ⬜ pending |
| 30-17-02 | 17 | 7 | **SC6** (revocation) | — | Positive-then-negative anchor, next completed sync, never lock/unlock | **e2e, live** | `npx playwright test e2e/family-wide-sharing.spec.ts -g "revocation"` | ❌ W0 (folded into task) | ⬜ pending |
| 30-17-03 | 17 | 7 | Long-text + decrypt-failure backstops | — | Live overflow measurement; live falsification of the pending discriminant | **e2e, live, backstop** | `npx playwright test e2e/family-wide-sharing.spec.ts -g "wraps cleanly\|decrypt failure"` | ❌ W0 (folded into task) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

None — every new test file this phase needs (`reseal.test.ts`, `reseal.real-wasm.test.ts`,
`familyWidePending.test.ts`, `resealTrigger.test.ts`, `family_wide_sharing.rs`,
`family-wide-sharing.spec.ts`, and the `rekey.test.ts` mocked-lane regression) is created INSIDE
the plan task that needs it (see the "File Exists" column above, marked "folded into task"), not
deferred to a separate Wave 0 step. This phase's own tracer-first task ordering (`30-01`'s decision
record + schema landing before any implementation task in any plan) already provides the
sequencing discipline a conventional Wave 0 would otherwise exist to enforce.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|--------------------|
| Decision record commits before any dependent code | SC1 | No automated commit-order gate exists in this repo (KEY-05/EXT-10 precedent, both verified manually) | Run `git log --oneline -- .planning/phases/30-the-living-group-family-wide-sharing/30-DECISION-FSH-02.md` and confirm it is the FIRST commit touching this phase's paths; re-check at `/gsd-verify-work` against the full phase commit history. |
| Isolated test server before generating live e2e traffic | — (environment hazard, STATE.md-recorded) | `web/playwright.config.ts:128`'s `reuseExistingServer: !process.env.CI` can silently adopt a stray local `pv-server` and write throwaway accounts into a real `data/pv.db` | `lsof -i :8620` before any live run in `30-16`/`30-17`; this is `30-16` Task 1's own blocking `checkpoint:human-verify`. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or are folded into a Wave-0-equivalent task creating their own test file (see table above — no task lacks either)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references — N/A, see Wave 0 Requirements above
- [ ] No watch-mode flags
- [ ] Every `<automated>` block uses `set -o pipefail` so a piped/tail'd command cannot mask a real failure (fixed phase-wide during revision — see plan-checker BLOCKER A)
- [ ] Feedback latency < 60s for unit/integration; live e2e waves (6, 7) are allowed to run several minutes by design (real sync-poll-interval waits), never skipped or reduced to a reload
- [ ] SC1 confirmed by commit-order, not configuration intent
- [ ] SC2/SC3/SC6 proven from live, recipient-side, positive decrypted-content assertions
- [ ] SC4 proven from BOTH a real-WASM unit test AND a falsification-tested adversarial Rust integration test
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
