---
phase: 18-firefox-window-consent-hardening
verified: 2026-07-21T13:15:00Z
status: passed
score: 11/11 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 18: Firefox Window & Consent Hardening Verification Report

**Phase Goal:** The Firefox ceremony/consent window's centering and self-close behavior is formalized and protected by a regression check, and a fresh security review makes an explicit, documented decision on whether an in-page consent alternative can safely replace it.
**Verified:** 2026-07-21T13:15:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Consent (380x460) + ceremony (480x640) windows open centered per `centeredWindowPosition()` formula, verified live against real Firefox | ✓ VERIFIED | Live probe run `results-probe-window-geometry.json`: GEOM-CEREMONY-SIZE + GEOM-CEREMONY-POSITION + GEOM-CONSENT-SIZE + GEOM-CONSENT-POSITION all PASS (observed exactly matches expected, delta 0,0) |
| 2 | Null/partial geometry → `centeredWindowPosition()` returns `{}`, default placement, never crash (unit-covered) | ✓ VERIFIED | `lib/window-geometry.test.ts` — 13/13 pass incl. isFinite-guard + per-field presence cases (WR-02 commit 3d8edeb, test-file only) |
| 3 | `browser.windows.create()` throw on consent open swallowed; ceremony resolves via abandon-timeout | ✓ VERIFIED (source) | Existing `tryOpenFallbackWindow()` catch unchanged; production files byte-for-byte untouched by phase |
| 4 | `browser.windows.create()` throw on ceremony open caught by `startServerUnlock()`, returns `{ok:false,error:'unknown'}`, no orphan | ✓ VERIFIED (source) | Existing `startServerUnlock()` behavior unchanged; production untouched |
| 5 | Both windows open at fixed size + focused:true unconditionally, verified live for size | ✓ VERIFIED | GEOM-CEREMONY-SIZE (480x640) + GEOM-CONSENT-SIZE (380x460) PASS live |
| 6 | Consent window self-closes on confirm AND decline (verified live); multi-match scroll cap unmodified | ✓ VERIFIED | GEOM-CONSENT-CLOSE-CONFIRM + GEOM-CONSENT-CLOSE-DECLINE PASS (handle absent after action); no production UI change |
| 7 | Ceremony window self-closes on password sign-in (live); negative computed left/top passes through unclamped, asserted as exact pair | ✓ VERIFIED | GEOM-CEREMONY-CLOSE PASS live; unit test `toEqual({left:-90,top:-100})` for `{-50,-20,300,300},380,460` (exact, not bound) |
| 8 | (backstop) concurrent `startServerUnlock()` latest-wins — deferred, already unit-tested in server-unlock.test.ts, not re-asserted live | ✓ VERIFIED (deferral documented) | Explicitly deferred in plan + probe header per RESEARCH Open Question 1; existing unit coverage stands |
| 9 | 18-SECURITY.md records explicit XBR-03 disposition citing T-12-14 + DEF CON 33 (Marek Toth); resolves either way | ✓ VERIFIED | `**Disposition:** REJECT-WITH-REASON`; T-12-14, DEF CON 33, 1Password, Bitwarden all cited; threats_open: 0 |
| 10 | REJECT case → window model (T-12-14) stands unchanged, no in-page panel code added/scaffolded | ✓ VERIFIED | Baseline-preserved line explicit; `NO_PANEL_CODE` (no panel files in phase commits); T-12-14 unchanged |
| 11 | Review evaluates clickjacking, overlay/occlusion, event-timing, closed-shadow limits — each vs window model's structural isolation, not "closed shadow is closed" | ✓ VERIFIED | Four-dimension `### Analysis` section, each dimension reasons from cited evidence and compares to structural isolation |

**Score:** 11/11 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `extension/lib/window-geometry.test.ts` | negative-position case | ✓ VERIFIED | Exact `toEqual({left:-90,top:-100})`; suite 13/13 pass |
| `extension/e2e-firefox/probe-window-geometry.cjs` | live-Firefox probe, 7 GEOM gates | ✓ VERIFIED | node --check OK; all 7 GEOM-* gate IDs present; drives real create() call sites |
| `extension/package.json` | test + pretest script pair | ✓ VERIFIED | Both `test:e2e:firefox:window-geometry` + `pretest:...` present |
| `18-SECURITY.md` | XBR-03 verdict artifact | ✓ VERIFIED | Full structure, four-dim analysis, REJECT-WITH-REASON, Sign-Off, threats_open: 0 |
| `.planning/PROJECT.md` | Key Decisions row | ✓ VERIFIED | XBR-03 row, Outcome `✓ REJECT-WITH-REASON (Phase 18)` matches SECURITY.md token verbatim |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| probe-window-geometry.cjs | tryOpenFallbackWindow() / startServerUnlock() | real browser.windows.create() call sites driven; live PASS | ✓ WIRED |
| 18-SECURITY.md Verdict | PROJECT.md Key Decisions | disposition token mirrored verbatim (REJECT-WITH-REASON) | ✓ WIRED |

### Prohibitions

| Prohibition | Verification tier | Status |
|-------------|-------------------|--------|
| MUST NOT modify production window-lifecycle code (window-geometry.ts / provider-ceremony.ts / server-unlock.ts) | test | ✓ VERIFIED — git log filtered on all 3 files empty for phase commits; WR-02 touched test file only |
| MUST NOT render XBR-03 as pre-determined copied conclusion | judgment | ✓ Satisfied (judgment) — Analysis reasons per-dimension from T-12-14 + DEF CON 33 + inpage-overlay.ts evidence |
| MUST NOT build/scaffold in-page consent panel this phase | test | ✓ VERIFIED — NO_PANEL_CODE; only test/probe/security-doc files in phase commits |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Unit suite passes | `npx vitest run lib/window-geometry` | 13 passed (13) | ✓ PASS |
| Probe syntactically valid | `node --check probe-window-geometry.cjs` | SYNTAX_OK | ✓ PASS |
| Live 7-gate probe | results-probe-window-geometry.json | 7/7 GEOM-* PASS | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| UX-02 | 18-01 | Firefox consent+ceremony windows centered/sized/self-close, regression-guarded | ✓ SATISFIED | Unit case + live 7/7 GEOM probe |
| XBR-03 | 18-02 | Decision-gated in-page consent review; window model stands or ships with reason | ✓ SATISFIED | REJECT-WITH-REASON verdict, PROJECT.md mirror |

Note: REQUIREMENTS.md status table still lists both as "Pending" — this is orchestrator tracking state updated post-verification, not a phase deliverable gap.

### Anti-Patterns Found

None. No debt markers (TODO/FIXME/XXX/TBD/HACK) in modified code files.

### Human Verification Required

None. Self-close/centering behaviors were verified live via headed-Firefox probe (results JSON with all-PASS gates) under the standing browser-automation UAT authorization.

### Gaps Summary

No gaps. All three success criteria met: (1) centering/sizing/self-close is both regression-covered (unit + probe) and live-verified (7/7 GEOM gates PASS); (2) a genuine four-dimension security review is written down in 18-SECURITY.md; (3) XBR-03 resolves as REJECT-WITH-REASON with the window model retained and the decision mirrored in PROJECT.md.

Minor non-blocking note: 18-01-SUMMARY.md states the live probe ran against shared :8620, while the orchestrator's post-execution note records the authoritative green run on an isolated :8621 server. This is a documentation-of-record discrepancy only; the technical evidence (results JSON, 7/7 PASS, production code untouched) is intact regardless of which server instance produced it.

---

_Verified: 2026-07-21T13:15:00Z_
_Verifier: Claude (gsd-verifier)_
