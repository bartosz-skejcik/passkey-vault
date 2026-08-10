---
phase: 29-a-real-settings-page-shell-migration
verified: 2026-08-10T09:13:44Z
status: passed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  previous_verified: 2026-08-10T08:46:26Z
  closed_by: "29-06-PLAN.md (gap closure), commits 583bdb4..6f03ff8"
  gaps_closed:
    - "SC2 — the deleted Import/Export CTA wiring assertion now has a real successor (SettingsSectionData.test.tsx), mutation-falsified by this verifier."
    - "SET-04 scroll-spy exactly-one-active — was PRESENT_BEHAVIOR_UNVERIFIED, now behaviorally tested and mutation-falsified twice."
    - "Jump-nav PL label backstop — was abstained (insufficient_spec), now backed by a retained, CI-wired live Chromium geometry spec, falsified by this verifier with a real clip."
    - "29-03-PLAN.md's two false verification claims corrected in place and correctly rescoped; SharingOverviewPanel.tsx left untouched."
  gaps_remaining: []
  regressions: []
---

# Phase 29: A Real Settings Page — Shell & Migration — Verification Report

**Phase Goal:** Settings stops being a fixed-right overlay and becomes a real, linkable `/settings` route with a predictable information architecture, and every existing setting survives the move unchanged.
**Verified:** 2026-08-10T09:13:44Z (re-verification after gap closure)
**Status:** passed
**Re-verification:** Yes — initial pass at 2026-08-10T08:46:26Z was `gaps_found` (4/5). Diff range now `084f53e..6f03ff8`.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `/settings` is a real route — linkable cold, survives reload, back returns to the vault; `npm run build` still emits a fully static export with no server-rendered route, proven from `web/out` | ✓ VERIFIED | Re-ran `rm -rf out && npm run build` at HEAD: 4 routes, all `○ (Static)`, zero server routes; `out/settings.html` + `out/settings.txt` + `out/settings/` emitted. Live (initial pass): `e2e/settings-route.spec.ts` 2/2 — cold `goto`, `reload`, `goBack`, `?panel=settings` → pathname `/settings` with empty search. **No regression possible:** `git diff --name-only 4783dd4..HEAD -- web/src \| grep -v '\.test\.'` is empty and `crates/` is untouched — the gap-closure commits changed test files and plan docs only. |
| 2 | Every old-overlay action reachable on the new page; existing suite green against the new location; **no test deleted or weakened** | ✓ VERIFIED | Suite: **844 tests / 83 files, 0 failed** (838/82 → +6/+1, arithmetic closes exactly). All six deleted SettingsPanel assertions now have successors — the last hold-out, the Import/Export CTA wiring test, is restored verbatim in `SettingsSectionData.test.tsx`. Live lane (initial pass): 16/16 across the four repaired specs, 0 retries. Mutation-falsified below. |
| 3 | Named, headed sections visible without interaction; no setting reachable only by discovering a tab | ✓ VERIFIED | Unchanged from initial pass; production code byte-identical. Four `<section id>` + `<h2 id>` render unconditionally in fixed order; `grep 'role="tablist"\|role="tab"\|aria-selected'` over `src/app/settings` + `src/components/settings` returns **zero** matches (re-run at HEAD). |
| 4 | Export no longer silently contradicts the hidden-password mask; the flow states its behaviour and the **bytes of a real export file** match (DEBT-02) | ✓ VERIFIED | Unchanged from initial pass; `ExportDialog.tsx`, `store.ts` and `exporters/` are byte-identical at HEAD. Initial-pass evidence stands: live `export-disclosure.spec.ts` green with count asserted **2** (direct share + item reached via a shared **folder**), confirm not-disabled, JSON+CSV bytes read from disk containing both real plaintext passwords; plus the mutation test proving the `7978605` hydration/reactivity fix genuinely discriminates. |
| 5 | Family & Sharing carried across **unchanged**, marked as awaiting Phase 33 | ✓ VERIFIED | `FamilyTab.tsx`/`FamilyTab.test.tsx` remain untouched across the whole phase range. Marking is a code comment only; no rendered WIP copy. |

**Score:** 5/5 truths verified. `behavior_unverified: 0`. No abstentions outstanding.

### Gap Closure Verification (plan 29-06)

Every claim below was checked by reverting or mutating production code and observing the test go **red**, then restoring (`git status --porcelain web/src` clean after each). Executor claims were not taken on trust.

| Gap / abstention | Closure artifact | Falsification performed by this verifier | Verdict |
|---|---|---|---|
| **Gap 1 — SC2 lost Import CTA assertion** | `web/src/components/settings/SettingsSectionData.test.tsx` (3 tests) | Stubbed `onClick={() => setShowImportWizard(true)}` → `onClick={() => {}}` in `SettingsSectionData.tsx`. Result: **1 failed / 2 passed** — precisely the import test went red; the export test stayed green (correct isolation, no over-broad assertion). | ✓ CLOSED — a real successor, not a render-only assertion. It proves the full click → mount → `onDone` → unmount transition for `settings-import-cta`, and the same for `settings-export-cta` (which previously had only heavy live coverage). |
| **Abstention 2 — SET-04 scroll-spy exactly-one-active** | `SettingsJumpNav.test.tsx` new `describe("scroll-spy adjacency (SET-04)")` (3 tests) | Two independent mutations of `SettingsJumpNav.tsx`'s observer callback: (a) `setActiveSlug(visible ? visible.target.id : "")` → **1 failed** (the "never zero mid-scroll" test); (b) `entries.forEach((e) => setActiveSlug(e.target.id))` → **2 failed** (both the exactly-one and never-zero tests). | ✓ CLOSED — the test captures the component's **own** IntersectionObserver constructor callback and drives it with synthetic entries inside `act()`, then reads the active-state class off the rendered links. It asserts `activeSlug` transitions, not merely which elements are observed. This is genuine behavioral evidence; the truth is no longer `PRESENT_BEHAVIOR_UNVERIFIED`. |
| **Abstention 1 — jump-nav PL label fit (was `backstop` / `insufficient_spec`)** | `web/e2e/settings-jumpnav-labels.spec.ts` | (a) **Re-runnable + CI-wired:** confirmed — `playwright.config.ts` `testDir: "./e2e"` picks the spec up with no allow-list; `package.json` `test:e2e` = bare `playwright test`; `.github/workflows/ci.yml`'s `web-e2e` job runs `npm run test:e2e` as a **blocking** step. (b) **Green:** ran it live — 1/1 passed (696ms). (c) **Falsifiable:** added `max-w-[40px] truncate` to the link className → **✘ failed on all 3 attempts** with `scrollWidth (62) must equal clientWidth (40)`. | ✓ CLOSED — the abstention resolves to VERIFIED on explicit evidence (a retained, CI-gated, falsifiable observation of real Chromium geometry at both 1280px and 375px, with the locale forced to `pl`). Upgrading the must_have from `{ statement, verification: backstop }` to a plain truth is now justified; had the spec not been reachable by `npm run test:e2e` it would have stayed a backstop. |
| **Gap 4 — false plan verification claims** | `29-03-PLAN.md` (2 frontmatter corrections + 1 acceptance-criterion correction) | Re-ran the corrected grep: `grep -rn 'role="tablist"\|role="tab"\|aria-selected' src/app/settings src/components/settings` → **zero matches**. `git diff --stat 4783dd4..HEAD -- SharingOverviewPanel.tsx` → **empty**. | ✓ CLOSED — both claims are now accurate and correctly scoped, each labelled `CORRECTED 2026-08-10` with the reason and the out-of-scope file named by line. No prohibition was weakened to make it true: the statement is unchanged, only its (previously false) verification note was narrowed to what actually holds. `SharingOverviewPanel.tsx` was left alone, as it should be — its tabs are Phase 28 code and SET-03/Phase 33 territory. |

### Test-Count Reconciliation (SC2, updated)

| Change | Δ files | Δ tests |
|---|---|---|
| Baseline (pre-phase) | 79 | 821 |
| Phase 29-01…29-05 net (per initial pass table) | +3 | +17 |
| `SettingsSectionData.test.tsx` (29-06 Task 1, new) | +1 | +3 |
| `SettingsJumpNav.test.tsx` adjacency block (29-06 Task 2) | 0 | +3 |
| **Current** | **83** | **844** |

No test was deleted or weakened at any point in the phase. The one previously-unaccounted deletion is now restored; the `Sidebar.test.tsx` swap remains a strengthening (`tagName === "A"` + `href`).

### Required Artifacts (delta since initial pass)

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `web/src/components/settings/SettingsSectionData.test.tsx` | Successor to the deleted CTA wiring test | ✓ VERIFIED | 92 lines, 3 tests, shallow-mocks ImportWizard/ExportDialog on the same precedent `SettingsSectionAccount.test.tsx` uses for DeleteAccountDialog; mutation-falsified |
| `web/src/components/settings/SettingsJumpNav.test.tsx` | Scroll-spy adjacency proof | ✓ VERIFIED | 199 lines (was 75), 4 tests; drives the real callback; mutation-falsified twice |
| `web/e2e/settings-jumpnav-labels.spec.ts` | Retained live PL-label geometry proof | ✓ VERIFIED | 105 lines; CI-wired via `npm run test:e2e`; green live; falsified with a real clip |
| `web/src/components/settings/SettingsSectionData.tsx` | Import/export CTAs | ✓ VERIFIED (upgraded from ⚠️ WIRED, UNTESTED) | Now covered at unit level; production code unchanged |
| All Phase 29-01…29-05 artifacts | — | ✓ VERIFIED, unchanged | Byte-identical at HEAD; no regression surface |

### Behavioral Spot-Checks (run by this verifier at HEAD)

| Behavior | Command | Result | Status |
|---|---|---|---|
| Unit suite | `cd web && npm test` | 83 files, 844 tests, 0 failed | ✓ PASS |
| Static export, no server route | `cd web && rm -rf out && npm run build` | 4 routes all `○ (Static)`; `out/settings.html`/`.txt`/`settings/` emitted | ✓ PASS |
| Live PL label geometry | `npx playwright test e2e/settings-jumpnav-labels.spec.ts` | 1 passed (11.4s incl. server bring-up) | ✓ PASS |
| Import CTA wiring falsification | stub `onClick` → `npx vitest run SettingsSectionData.test.tsx` | 1 failed / 2 passed (import test only) | ✓ DISCRIMINATING |
| Scroll-spy falsification (a) | clear-on-no-intersection → `npx vitest run SettingsJumpNav.test.tsx` | 1 failed / 3 passed | ✓ DISCRIMINATING |
| Scroll-spy falsification (b) | activate-every-entry → `npx vitest run SettingsJumpNav.test.tsx` | 2 failed / 2 passed | ✓ DISCRIMINATING |
| PL label spec falsification | `max-w-[40px] truncate` → live run | ✘ failed ×3 (`scrollWidth 62 ≠ clientWidth 40`) | ✓ DISCRIMINATING |
| Rust workspace (initial pass, code unchanged since) | `cargo test --workspace` | all `ok`, 0 failed; `router_static_fallback` 11/11 | ✓ PASS |
| Live e2e regression lane (initial pass, specs unchanged since) | `npx playwright test e2e/{sharing,invite-flow,remove-member,delete-account}.spec.ts` | 16 passed, 0 retries | ✓ PASS |
| SC1/SC4 live proofs (initial pass, specs and production code unchanged since) | `npx playwright test e2e/{settings-route,export-disclosure}.spec.ts` | 3 passed | ✓ PASS |

All mutations were reverted; `git status --porcelain web/src` is clean and `crates/` was never touched.

### Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| SET-01 | ✓ SATISFIED | Real static route; cold entry / reload / back live-proven; sidebar gear is a real link; shipped-extension `?panel=settings` deep link redirects with the query stripped, `ExtUnlockBridge.tsx` href untouched |
| SET-02 | ✓ SATISFIED (upgraded from ⚠️ PARTIAL) | All five surfaces reachable; 844/844 unit + 16/16 live green against the new location; every deleted assertion now has a successor, the last one mutation-falsified |
| SET-04 | ✓ SATISFIED | Four named `<h2>` groups visible with zero interaction, order asserted; scroll-spy exactly-one-active now behaviorally proven; PL labels proven to fit at both viewports in real Chromium |
| DEBT-02 | ✓ SATISFIED | Disclose-not-mask; exporters untouched; count covers folder-shared items; live byte proof; fix mutation-falsified |
| SET-03 | ✓ CORRECTLY DEFERRED | Phase 33; Family surface carried verbatim, no redesign attempted, no on-screen WIP copy |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| — | — | `TBD`/`FIXME`/`XXX`/`TODO`/`HACK` in any file changed by this phase (all 46 now) | — | None found |
| `web/src/components/vault/SharingOverviewPanel.tsx` | 419, 422-423, 432-433 | `role="tablist"`/`role="tab"`/`aria-selected` still present in the app | ℹ️ Info (downgraded from ⚠️ Warning) | No longer a false claim — `29-03-PLAN.md` now scopes its prohibition to the settings tree and names this file explicitly as pre-existing, out-of-scope Phase 28 code. It remains a real tab-hunting surface, but it is SET-03/Phase 33 territory, not this phase's. Worth carrying into Phase 33's scope note. |
| `web/src/lib/i18n/dictionary.ts` | 624 | `settings.importExportPlaceholder` has zero call sites | ℹ️ Info | Orphan key, orphaned since Phase 6 — not introduced here. Trivial cleanup for a future pass. |
| `web/src/lib/vault/store.ts` | 1385-1400 | A persistently failing (non-404) shared pipeline leaves `sharedConfirmed` false → `hydrated` never true → `export-confirm` disabled for the session | ℹ️ Info | Deliberate fail-closed choice and clearly the right one (better than a false zero-count). The claimed recovery-on-a-later-poll is asserted in comments only, with no test. Not a phase must_have and not a gate — noted as a follow-up hardening opportunity. |

### Human Verification Required

None. Both items from the initial pass resolved with explicit, re-runnable, falsified evidence:

1. Jump-nav Polish label fit — was a declared `backstop` abstained as `insufficient_spec`. Now backed by `web/e2e/settings-jumpnav-labels.spec.ts`, which this verifier confirmed is CI-gated (blocking `web-e2e` job), green live, and red under a real clip. The honest-verifier contract is satisfied by observation, not inference.
2. Scroll-spy exactly-one-active — was `PRESENT_BEHAVIOR_UNVERIFIED`. Now exercised by a test that drives the component's own observer callback and asserts the rendered active state, proven discriminating under two distinct regressions.

### Summary

The phase goal is achieved. `/settings` is a genuinely static, linkable, reload- and back-survivable route proven from both the built `web/out` output and a real browser; the information architecture is four named, always-visible headed sections; DEBT-02 is resolved by honest disclosure whose count provably includes folder-shared items and whose export bytes were read off disk; and Family & Sharing is byte-untouched with its Phase-33 marking confined to a code comment.

The single gap from the initial pass — a quietly lost Import-CTA assertion covered by a false "already re-proven" claim — is closed with a successor test that goes red when the handler is stubbed, and the plan's inaccurate verification notes are corrected in place rather than the prohibition being weakened. Both abstentions are resolved on evidence rather than argument: the scroll-spy invariant now has a test that drives the real callback and fails under two separate mutations, and the PL-label backstop now has a retained, CI-blocking Chromium geometry spec that fails under a real clip. Nothing remains outstanding for a human.

Three informational follow-ups are recorded above (SharingOverviewPanel's remaining tabs for Phase 33's scope, an orphan i18n key, and the untested hydration-recovery path in `store.ts`). None gate this phase.

---

_Verified: 2026-08-10T09:13:44Z (re-verification)_
_Verifier: Claude (gsd-verifier)_
