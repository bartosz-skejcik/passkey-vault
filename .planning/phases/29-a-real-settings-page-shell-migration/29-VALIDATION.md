---
phase: 29
slug: a-real-settings-page-shell-migration
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-09
---

# Phase 29 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `29-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.4 (unit/component) + Playwright 1.61.1 (`web/e2e/`, live browser) |
| **Config file** | `web/vitest.config.ts` (jsdom, `./vitest.setup.ts`); `web/playwright.config.ts` (`testDir: "./e2e"`, `baseURL: http://localhost:8620`, real `webServer`) |
| **Quick run command** | `cd web && npx vitest run <path>` |
| **Full suite command** | `cd web && npm test` |
| **Estimated runtime** | ~10 seconds (821 tests / 79 files, confirmed green by a live run during research) |

> **Hard project standard (REQUIREMENTS.md Non-Negotiable #2).** The vitest suite mocks
> `@/lib/crypto` and, transitively, `@/lib/vault/store` in most component tests. **A green vitest
> run is not evidence** for any claim that depends on real decryption, real hydration timing, or
> real file bytes. Three of this phase's claims are exactly that shape and cannot be closed by
> vitest alone: SC1 (built output), SC4 (export file bytes), and the DEBT-02 hydration-race
> backstop (live timing).

---

## Sampling Rate

- **After every task commit:** `cd web && npx vitest run <touched-file(s)>`
- **After every plan wave:** `cd web && npm test` (full suite) **and** `cd web && npm run build` (SC1 artifact check)
- **Before `/gsd-verify-work`:** full vitest suite green + a real `npm run build` producing `out/settings.html` + at least one live Playwright run proving SC4's byte claim
- **Max feedback latency:** ~10 seconds (quick), ~60 seconds (wave, incl. build)

---

## Per-Task Verification Map

> Task IDs are assigned at planning time; rows below are requirement-level and MUST be mapped onto
> concrete task IDs by the planner. `validate-phase` fills the Task ID / Status columns.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | SET-01 (route) | — | Authenticated settings content never renders without a verified session (research Pitfall 1 — `page.tsx`'s `authed` gate is inline JSX and is NOT reused by a bare new route) | unit (mount) | `cd web && npx vitest run src/app/settings/page.test.tsx` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SET-01 (static export) | — | N/A | **artifact** | `cd web && npm run build && test -f out/settings.html` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SET-01 (ext deep-link) | — | Shipped 0.4.0 extension's `/?panel=settings` still lands users on settings | unit | `cd web && npx vitest run src/app/page.test.tsx -t "panel=settings"` | ✅ (edit) | ⬜ pending |
| TBD | TBD | TBD | SET-02 (no regression) | — | N/A | full suite | `cd web && npm test` (baseline **821**; expect ≥821 net) | ✅ | ⬜ pending |
| TBD | TBD | TBD | SET-04 (visible headed IA) | — | N/A | unit (assert all 4 `<h2>` present with **no** interaction) | `cd web && npx vitest run src/app/settings/page.test.tsx` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | DEBT-02 (disclosure copy) | — | Dialog states N affected items; `n === 0` → sentence absent entirely | unit (mocked store, several counts) | `cd web && npx vitest run src/components/vault/ExportDialog.test.tsx` | ✅ (extend) | ⬜ pending |
| TBD | TBD | TBD | DEBT-02 (**file bytes**) | — | A real generated export file contains exactly what the dialog disclosed | **e2e / live** | `cd web && npx playwright test e2e/<spec>.spec.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | DEBT-02 (**hydration-race falsification**) | — | Opening export against an unhydrated/partial store NEVER presents an absent (zero-count) disclosure | unit **falsification** | `cd web && npx vitest run src/components/vault/ExportDialog.test.tsx -t "hydrat"` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | DEBT-02 (`hydrated` signal lifecycle) | — | unlock → false → true; lock → false | unit | `cd web && npx vitest run src/lib/vault/store.test.ts` | ❌ W0 (likely net-new) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `web/src/app/settings/page.test.tsx` — new file; covers SET-01 (mount, auth gate) and SET-04 (all four headings present without interaction)
- [ ] A new or extended `web/e2e/` spec covering DEBT-02's **file-byte** claim (SC4). No existing spec handles Playwright downloads — needs a `download` event handler pattern added to `web/e2e/fixtures.ts` or inline.
- [ ] `ExportDialog.test.tsx` — a genuine **falsification** test: render against a mocked mid-hydration state and assert the confirm action is disabled or the dialog shows a pending state. **Never** a silently-absent disclosure. This is the single test in this phase that defends against DEBT-02 reopening itself.
- [ ] `web/src/lib/vault/store.test.ts` — confirm at plan time (direct file read) whether it exists; the new `hydrated` signal needs its own set/reset lifecycle test. Research did not find this file, so treat as likely net-new.

---

## Test Migration Map (SET-02's literal proof — six touched files)

> "No test deleted or weakened to get there" is SC2's own wording. Each row states the *correct*
> migration, so a required assertion change is not mistaken for a weakened test.

| File | Current count | Disposition | Reason |
|------|---------------|-------------|--------|
| `SettingsPanel.test.tsx` | 6 | **Replace** with `settings/page.test.tsx` assertions | Tests a `role="tablist"` mechanism the UI-SPEC mandates removing entirely |
| `page.test.tsx` | 4 of 10 | **Edit** the 2 `panel=settings` tests to assert navigation, not a mocked mount; leave the 2 `action=new-item` tests untouched | Redirect replaces the mount branch |
| `Sidebar.test.tsx` | 1 of 25 | **Replace** the `onOpenSettings` callback test with a real `<a>`/`href` assertion | A real link no longer fires a JS callback — the callback test is structurally invalid, and the replacement is *stronger*, not weaker |
| `ExtUnlockBridge.test.tsx` | 2 of 37 | **No change — verify still green** | Its link target is a literal string, unaffected by the redirect mechanism |
| `SecurityTab.test.tsx` | 3 of 5 | **Move** the `Delete account section (E6)` describe to the relocated content's test file; leave autolock/clipboard in place | Genuine content relocation (delete-account moves to Konto), not a container swap |
| `ExportDialog.test.tsx` | 4 | **Extend** (disclosure + hydration-race); 4 existing unaffected | DEBT-02's own surface |
| `PasskeysTab` / `SessionsTab` / `FamilyTab` / `ImportWizard` `.test.tsx` | 5 / 3 / 53 / 11 | **No change expected — verify still green** | Container-only migrations |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Polish jump-nav labels do not clip at 375px or in the 200px desktop rail | SET-04 / UI-SPEC backstop | Visual fit; PL strings are materially longer than EN (`Rodzina i udostępnianie` = 23 chars) and no assertion captures "looks clipped" | Load `/settings` at 375px and at desktop width with locale `pl`; confirm all four labels render fully in both the pill row and the rail |
| Polish grammar of the disclosure at `n === 1` | DEBT-02 / UI-SPEC backstop | "1 wpisów" is grammatically wrong but matches the codebase's accepted no-plural-machinery convention | A held-out test asserts the exact interpolated string at `n = 1`; a human confirms the wording is acceptable to ship |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] SC1 proven from built `web/out` output, not configuration
- [ ] SC4 proven from the bytes of a real generated export file
- [ ] DEBT-02 hydration race closed by a falsification test, not a happy-path assertion
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
