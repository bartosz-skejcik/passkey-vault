---
phase: 27
slug: extension-integration-shared-items
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
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
| _filled by gsd-planner_ | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

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
| _filled by gsd-planner_ | | | |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90 s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
