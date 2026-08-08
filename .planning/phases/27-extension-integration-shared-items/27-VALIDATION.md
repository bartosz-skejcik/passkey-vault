---
phase: 27
slug: extension-integration-shared-items
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-08
---

# Phase 27 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded by plan-phase from `27-RESEARCH.md`'s `## Validation Architecture`. The Per-Task
> Verification Map is filled by the planner; `validate-phase` sets `status: validated`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (extension unit) + Playwright (extension e2e) + `cargo test` (Rust workspace) |
| **Config file** | `extension/vitest.config.ts`, `extension/playwright.config.ts` |
| **Quick run command** | `cd extension && npm test` |
| **Full suite command** | `cd extension && npm test && npm run compile && npm run test:e2e:chrome` + `cargo test --workspace` |
| **Estimated runtime** | ~90 s unit + ~3–6 min e2e (chromium), ceremony project is headed |

**Playwright project split (load-bearing, from Phase 13):** `extension/playwright.config.ts` defines
two projects — `chromium` (everything except Phase 12 ceremonies, headless) and `chromium-ceremony`
(Phase 12 passkey ceremonies only, **headed** — the historical `P12-SC1` headless hang). A
shared-**passkey** ceremony test (EXT-09/EXT-10) MUST live in `chromium-ceremony`; a shared-**login**
autofill/TOTP test (EXT-07/EXT-08) belongs in `chromium`. `pretest:e2e:chrome` rebuilds the extension
before every e2e run — do not bypass it (a stale `.output/chrome-mv3` caused a false failure once).

---

## Sampling Rate

- **After every task commit:** `cd extension && npm test` (vitest, fast)
- **After every plan wave:** full suite above, including `npm run compile`
- **Before `/gsd-verify-work`:** full suite green, **and** the two-extension live proof green
- **Max feedback latency:** ~90 s for the unit loop

---

## The evidence rule for this phase (non-negotiable)

The unit suite mocks `@/lib/crypto`. **Mocked-crypto tests are not evidence for any crypto-adjacent
claim in this phase.** Phase 24's live run found four real bugs no unit test could see; Phase 25's
found a wire-contract defect; Phase 26's found two — including a feature that was one-way-broken
while 700+ unit tests were green. Admissible evidence for a shared-item claim is:

1. a real-WASM test (`*.real-wasm.test.ts`), or
2. a live Playwright run against a real server and real crypto.

**Vacuous-assertion trap (documented in `web/e2e/sharing.spec.ts`'s own header):** a `toHaveCount(0)`
guard survived a total feature regression, because an absence-assertion cannot fail when the thing it
guards stops existing. Every EXT-07/08/09 live proof must assert a **positive recipient-side
observation** (B's extension fills the item A shared / generates its TOTP / completes its ceremony),
never merely the absence of an error.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 27-01-T1 | 27-01 | 1 | EXT-07 | T-27-02 | Two persistent-context profiles are genuinely isolated (no shared chrome.storage.local) | e2e (playwright) | `cd extension && npm run pretest:e2e:chrome && npx playwright test --project=chromium e2e/two-context-spike.spec.ts` | New | ⬜ pending |
| 27-01-T2 | 27-01 | 1 | EXT-07 | T-27-01 | extContextB/extensionIdB fixtures typecheck, mirror extContext/extensionId's launch shape | typecheck | `cd extension && npx tsc --noEmit` | New | ⬜ pending |
| 27-02-T1 | 27-02 | 1 | EXT-10 | — | signCount decodes to 0 from a real create-then-get ceremony's raw wire bytes (in-process fixture, permanent fast regression) | cargo test | `cargo test -p pv-provider response_shape` | New | ⬜ pending |
| 27-02-T2 | 27-02 | 1 | EXT-10 | T-27-03, T-27-04 | EXT-10 decision record + SEC-04 classifier-unreachability finding (file:line evidence) + permanent regression | cargo test | `cargo test -p pv-provider sign_count_is_always_zero_for_a_provider_ceremony_assertion` | New | ⬜ pending |
| 27-03-T1 | 27-03 | 1 | EXT-11, KEY-01 | — | 11 WASM bindings resolve as defined exports, real WASM (this repo's first extension-side real-WASM test) | real-wasm | `cd extension && npm run test -- wasm-loader && npx tsc --noEmit` | New | ⬜ pending |
| 27-03-T2 | 27-03 | 1 | EXT-11, KEY-01 | T-27-05, T-27-06 | Collection Key cache: empty no-op, real seal/decrypt round trip, lock-triggered free, stale-key eviction | real-wasm | `npm --prefix extension run test -- collections-store` | New | ⬜ pending |
| 27-03-T3 | 27-03 | 1 | EXT-11, KEY-01 | T-27-05, T-27-07 | Identity keypair: generate-and-publish, unwrap-existing, memory-cache fast path, lock-triggered free | real-wasm | `npm --prefix extension run test -- identity-store` | New | ⬜ pending |
| 27-04-T1 | 27-04 | 2 | EXT-07, EXT-11, KEY-01 | T-27-08, T-27-09, T-27-10 | 3-source merge, pending/broken decrypt classification, extended lock-order clearing, KEY-01 trigger | real-wasm | `npm --prefix extension run test -- vault-store collections-store identity-store` | New | ⬜ pending |
| 27-04-T2 | 27-04 | 2 | EXT-07, EXT-11, KEY-01 | — | onSharedRevisions fires alongside every personal pull, independent try/catch, 404-latch | unit (tdd) | `npm --prefix extension run test -- sync-client` | New | ⬜ pending |
| 27-04-T3 | 27-04 | 2 | EXT-07 | T-27-08..11 | Member B's extension displays the exact shared item name member A shared (live, 2 extensions) | e2e (live) | `cd extension && npm run pretest:e2e:chrome && npx playwright test --project=chromium e2e/dual-extension-sharing.spec.ts` | New | ⬜ pending |
| 27-05-T1 | 27-05 | 3 | EXT-07, EXT-08 | T-27-13 | Personal-before-shared stable partition, intra-group order preserved | unit (tdd) | `npm --prefix extension run test -- autofill-match` | New | ⬜ pending |
| 27-05-T2 | 27-05 | 3 | EXT-07, EXT-08 | T-27-12 | Live TOTP byte-equality ({current, previous} window) + no-affordance-without-secret | e2e (live) | `cd extension && npm run pretest:e2e:chrome && npx playwright test --project=chromium e2e/dual-extension-sharing.spec.ts` | New | ⬜ pending |
| 27-06-T1 | 27-06 | 3 | EXT-09, EXT-10 | T-27-14 | persistUpdatedProviderItem's collection-aware dispatch; personal path + ephemeral round trip unchanged | unit (tdd) | `npm --prefix extension run test -- provider-ceremony` | New | ⬜ pending |
| 27-06-T2 | 27-06 | 3 | EXT-09, EXT-10 | T-27-15, T-27-16 | Live headed passkey ceremony for a shared passkey + live signCount==0 wire measurement (real browser) | e2e-headed (live) | `cd extension && npm run pretest:e2e:chrome && npx playwright test --project=chromium-ceremony e2e/dual-extension-ceremony.spec.ts` | New | ⬜ pending |
| 27-07-T1 | 27-07 | 3 | EXT-07 | T-27-17, T-27-18 | confirmUpdateLogin collection-aware dispatch + read-only refusal (mocked-crypto unit tier only — see 27-11-T3) | unit (tdd) | `npm --prefix extension run test -- capture-handler` | New | ⬜ pending |
| 27-08-T1 | 27-08 | 3 | EXT-07, EXT-12 | — | i18n keys byte-identical to UI-SPEC, SharedBadge aria-label correct (typecheck-gated, exercised transitively by 27-08-T2/T3) | typecheck | `cd extension && npx tsc --noEmit` | New | ⬜ pending |
| 27-08-T2 | 27-08 | 3 | EXT-07, EXT-12 | T-27-21 | ItemListView E1/E2: badge/subtitle, pending-decrypt skeleton, degraded-row treatment | component | `npm --prefix extension run test -- ItemListView` | New | ⬜ pending |
| 27-08-T3 | 27-08 | 3 | EXT-07, EXT-12 | T-27-19, T-27-20 | ItemDetailView E3: hidden-password mask/honesty note, folder note, undecryptable banner | component | `npm --prefix extension run test -- ItemDetailView` | New | ⬜ pending |
| 27-09-T1 | 27-09 | 4 | EXT-12 | T-27-22 | AutofillItemRow/TotpFillRow carry SharedBadge, personal rows unchanged | component | `npm --prefix extension run test -- AutofillItemRow TotpFillRow` | New | ⬜ pending |
| 27-10-T1 | 27-10 | 4 | EXT-09, EXT-12 | — | ProviderCeremonyView badge/subtitle on both candidate presentations, personal-before-shared ordering | component | `npm --prefix extension run test -- ProviderCeremonyView` | New | ⬜ pending |
| 27-10-T2 | 27-10 | 4 | EXT-09, EXT-12 | T-27-23 | Empty-shared-candidates fallthrough confirmed against real code (not inferred) | unit | `npm --prefix extension run test -- provider-ceremony credential-store` | New | ⬜ pending |
| 27-11-T1 | 27-11 | 5 | EXT-07, EXT-11 | — | chrome.storage.session key set (live, post-unlock) contains no identity/collection/sealed-named key | e2e (live) | `cd extension && npm run pretest:e2e:chrome && npx playwright test --project=chromium e2e/dual-extension-sharing.spec.ts` | New | ⬜ pending |
| 27-11-T2 | 27-11 | 5 | EXT-07, EXT-11 | T-27-24 | A mid-session revoked member loses the shared item on the next sync poll (presence-then-absence) | e2e (live) | `cd extension && npm run pretest:e2e:chrome && npx playwright test --project=chromium e2e/dual-extension-revocation.spec.ts` | New | ⬜ pending |
| 27-11-T3 | 27-11 | 5 | EXT-07 | T-27-25 | Member B's capture-confirm write, member A's read-back — the phase's only real-crypto shared-item WRITE-path evidence | e2e (live) | `cd extension && npm run pretest:e2e:chrome && npx playwright test --project=chromium e2e/dual-extension-sharing.spec.ts` | New | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Continuity check:** every task above carries its own `<automated>` command — there is no 3-task run without one, and the two Wave 0 gaps (two-extension harness feasibility, extension-side real-WASM scaffolding) are discharged in-plan by 27-01 (Task 1/Task 2) and 27-03 (Task 1) respectively, both in Wave 1, before any later plan depends on either.

---

## Wave 0 Requirements

- [ ] A two-extension Playwright harness (two `launchPersistentContext` profiles, each loading the
      built extension, one server) — **new infrastructure**, not a reuse of Phase 23's `twoSessions`
      (which is two web `BrowserContext`s in one browser). Research rates this MEDIUM confidence;
      it needs a throwaway spike proving two persistent contexts yield genuinely independent
      profiles before the full harness is built on it.
- [ ] Extension-side real-WASM test scaffolding for the collection decrypt path, mirroring web's
      `*.real-wasm.test.ts` convention.

*Per STATE.md's inherited Phase 26 obligation, the live proof lands EARLY enough to steer the phase,
not late enough to only audit it. A plan ordering that defers it to the final wave is a planning
defect.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| _None_ | — | This phase has zero `checkpoint:human-verify` tasks across all 11 plans — every `must_haves` truth is discharged by an `<automated>` command in the Per-Task Verification Map above (unit, real-WASM, cargo, or live Playwright). | — |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every single task carries its own automated command)
- [x] Wave 0 covers all MISSING references (two-extension harness: 27-01; extension-side real-WASM scaffolding: 27-03-T1)
- [x] No watch-mode flags (no `--watch` in any Automated Command above)
- [x] Feedback latency < 90 s (the unit/real-WASM/cargo loop; e2e commands run at wave-merge/phase-gate cadence per the Sampling Rate section above, not per-task)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
