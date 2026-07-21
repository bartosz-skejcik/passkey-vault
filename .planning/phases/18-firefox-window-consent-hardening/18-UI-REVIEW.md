# Phase 18 — UI Review

**Audited:** 2026-07-21
**Baseline:** 18-UI-SPEC.md (behavioral formalization phase — visual dimensions declared "carried over unchanged")
**Screenshots:** not captured (no clean dev server — port 3000 returned HTTP 500, 5173/8080 down; audit is code + contract-fidelity only, which is the correct mode for a phase that ships zero visual/markup changes)

---

## Framing

This is a **behavioral formalization phase, not a visual redesign**. Per the UI-SPEC, the consent window (`ProviderCeremonyView`) and ceremony window (`ExtUnlockBridge`) visual content was built in Phases 9/12/13/15 and the centering/self-close/scroll-cap behavior already landed live in quick task 260720-16k. The UI-SPEC's center of gravity is the **Window Geometry & Lifecycle Contract**, not typography/color/spacing. The audit is scored accordingly: the standard visual pillars are verified for *non-regression* (no markup touched), and the substance is the geometry-contract fidelity and the XBR-03 verdict.

**Zero-production-change claim VERIFIED:** `provider-ceremony.ts`, `server-unlock.ts`, and `window-geometry.ts` were last touched at commit `f4a1fda` (Phase 15) — this phase's commits touch only test/probe/docs. The core prohibition of both plans holds by construction.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 4/4 | No new copy introduced; contract explicitly declares N/A across all rows — verified no string changes in scope |
| 2. Visuals | 4/4 | Geometry contract (the phase's real visual surface) formalized; probe drives genuine `windows.create()` call sites, not mock tabs |
| 3. Color | 4/4 | No color token, theme, or accent touched — non-regression baseline holds |
| 4. Typography | 4/4 | No text size/weight/family changed; DM Sans / never-Fuzzy-Bubbles security-surface rule reaffirmed, not violated |
| 5. Spacing | 4/4 | No padding/margin/gap touched; window dimensions (OS-level, not CSS tokens) match production constants exactly |
| 6. Experience Design | 3/4 | Self-close/lifecycle contract well-covered by 7 GEOM-* gates + unit test; but committed live-run evidence absent and one race left unasserted-live (both disclosed, not hidden) |

**Overall: 23/24**

---

## Top 3 Priority Fixes

1. **Live-Firefox PASS evidence is not present in the checkout (WARNING)** — `results-probe-window-geometry.json` and the 5 screenshots are gitignored (`.ff-screenshots-probe-window-geometry`, matching every sibling-probe convention), so the "7/7 GEOM-* PASS" claim in 18-01-SUMMARY cannot be independently re-verified from committed artifacts alone. UX-02's success-criterion-1 explicitly requires "verified live AND covered by a regression test." The regression test half is fully committed and re-runnable; the live half rests on the SUMMARY's assertion. **Fix:** either commit a redacted evidence snapshot (results JSON with credentials stripped) or add a short `18-EVIDENCE.md` transcribing the gate results + exit code so the live-verification claim survives a fresh clone.

2. **Double-window-open race is unasserted live (WARNING, disclosed)** — the "latest wins" concurrent-`startServerUnlock()` behavior (UI-SPEC 🧪 backstop row / zero-one-many) is unit-tested only; no live probe gate exists. This was correctly flagged (not silently dropped) in both the plan backstop and the SUMMARY. **Fix:** add an 8th GEOM gate in a future window-lifecycle phase, or file an explicit deferral in ROADMAP so it does not evaporate.

3. **Probe pollutes the shared UAT server with orphaned passkey credentials (WARNING)** — each run registers a fresh random-user-id passkey against `uat-prf04@example.local` on `:8620` with no cleanup (18-REVIEW.md IN-01). Not a UI defect, but it degrades the regression lane's repeatability and the shared dev DB over time. **Fix:** add a post-run credential-cleanup step, or point the lane at a disposable per-run account.

---

## Detailed Findings

### Pillar 1: Copywriting (4/4)
Copywriting Contract table is all-N/A by design. Verified no copy files in scope changed (production markup untouched since Phase 15). The security-surface copy rule ("playfulness never in security dialogs") is reaffirmed for both windows. No BLOCKER/WARNING.

### Pillar 2: Visuals (4/4)
The phase's genuine visual surface is window geometry. `probe-window-geometry.cjs` drives the REAL `tryOpenFallbackWindow()` and `startServerUnlock()` call sites (handle-diff technique, never a manually-opened popup tab) — measured geometry is the production call site, not a fixture. Centering formula is duplicated inline in the probe with a drift-caught-by-`window-geometry.test.ts` note (deliberate, documented duplication mirroring `probe-request-xray.cjs` precedent). Position compared with `TOLERANCE_PX=5` (WM/DPI slack) but size with exact equality — correct discipline.

### Pillar 3: Color (4/4)
No `--color-*` token, theme, or accent element touched. Contract declares carried-over-unchanged; git confirms no markup/style file in scope changed this phase.

### Pillar 4: Typography (4/4)
No size/weight/family change. DM Sans-everywhere and never-Fuzzy-Bubbles security-surface constraint documented and not regressed.

### Pillar 5: Spacing (5-of-5 non-regression) (4/4)
No CSS spacing token touched. Window *dimensions* are OS-level `windows.create()` geometry, verified to match production constants EXACTLY: probe `CONSENT_WIDTH/HEIGHT = 380/460` vs `provider-ceremony.ts:273-274`; `CEREMONY_WIDTH/HEIGHT = 480/640` vs `server-unlock.ts:77-78`. The UI-SPEC's "do not round to the 8-point grid" caveat (460 covers the multi-match worst case) is respected — no drift toward round numbers.

### Pillar 6: Experience Design (3/4)
Strong lifecycle coverage: 7 GEOM-* gates (CEREMONY/CONSENT × SIZE/POSITION/CLOSE, plus CONSENT confirm+decline closers) plus 10 unit cases including the previously-missing negative-position pass-through (`{left:-50,top:-20,w:300,h:300},380,460 → {left:-90,top:-100}` via exact `toEqual`). The critical never-clamp-to-zero invariant (13-REVIEW-3.md IN-02) is honored — grep confirms NO `>= 0` / `toBeLessThan` / non-negativity assertion in the test file. `focused:true` present at both call sites (source-verified, correctly noted as not WebDriver-readable). Deductions: (a) committed live evidence absent (Fix 1); (b) concurrency race unasserted live (Fix 2); (c) shared-server credential pollution (Fix 3). All three are honestly disclosed in the artifacts — none is a hidden gap — hence 3/4 not lower.

---

## XBR-03 Decision Gate

Not a visual deliverable but the phase's second requirement. `18-SECURITY.md` verified: `xbr03_disposition: REJECT-WITH-REASON`, `threats_open: 0`, explicit `**Disposition:** REJECT-WITH-REASON` line, four-dimension analysis (clickjacking/tapjacking, overlay/occlusion, event-timing, closed-shadow limits) each compared against the window model's structural isolation. Evidence pack (T-12-14, DEF CON 33 / Marek Toth, 1Password/Bitwarden, own `inpage-overlay.ts` caveat) cited, not summarized away. PROJECT.md Key Decisions row mirrors the disposition token. No in-page panel code scaffolded — T-12-14 baseline stands. The UI-SPEC correctly declines to design/size/token the rejected panel. No finding.

---

## Registry Safety

Skipped — no `components.json` in repo (shadcn not initialized); UI-SPEC Registry Safety table lists zero blocks (official or third-party). Not applicable.

---

## Files Audited
- `.planning/phases/18-firefox-window-consent-hardening/18-UI-SPEC.md`
- `extension/lib/window-geometry.test.ts` (10 `it()` cases, negative-position case confirmed)
- `extension/e2e-firefox/probe-window-geometry.cjs` (7 GEOM-* gates, constants confirmed)
- `extension/package.json` (test/pretest `:window-geometry` script pair confirmed)
- `extension/entrypoints/background/provider-ceremony.ts` (constants 380/460, `focused:true` — untouched since Phase 15)
- `extension/entrypoints/background/server-unlock.ts` (constants 480/640, `focused:true` — untouched since Phase 15)
- `.planning/phases/18-firefox-window-consent-hardening/18-SECURITY.md` (XBR-03 verdict)
- `.planning/PROJECT.md` (Key Decisions mirror row)
