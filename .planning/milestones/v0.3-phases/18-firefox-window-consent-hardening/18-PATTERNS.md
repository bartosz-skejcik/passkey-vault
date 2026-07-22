# Phase 18: Firefox Window & Consent Hardening - Pattern Map

**Mapped:** 2026-07-21
**Files analyzed:** 3 (1 test-file extension, 1 new probe script, 1 new decision-gate artifact)
**Analogs found:** 3 / 3

This phase touches no production code (window-geometry.ts, provider-ceremony.ts, server-unlock.ts, App.tsx are all confirmed-unchanged per RESEARCH/UI-SPEC). Every file in scope is either a test extension, a new test/probe script, or a docs artifact.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `extension/lib/window-geometry.test.ts` (extend, +1 case) | test (unit) | transform (pure function assertions) | itself — extend existing file in place | exact |
| `extension/e2e-firefox/probe-window-geometry.cjs` (new) | test (live e2e probe) | request-response (Selenium drives real Firefox, reads window state) | `extension/e2e-firefox/probe-request-xray.cjs` (bootstrap/header/exit-code shape) + `extension/e2e-firefox/run-core.cjs` (switchTo/stale-handle discipline) | exact (role) / role-match (specific mechanics split across two analogs) |
| `extension/package.json` (edit — add 2 script entries) | config | — | existing `test:e2e:firefox:*` / `pretest:e2e:firefox:*` entries (lines 19-29) | exact |
| `.planning/phases/18-firefox-window-consent-hardening/18-SECURITY.md` (new) | config/docs (security verdict artifact) | — | `.planning/phases/12-passkey-provider/12-SECURITY.md` (structure) + `.planning/phases/14-critical-risk-closure-cross-realm-integrity-real-rp-verifica/14-SECURITY.md` (closure-pattern precedent cited in CONTEXT.md) | role-match (this is a decision-gate verdict, not a shipped-code threat register — frame threats as hypothetical per RESEARCH's Open Question #2) |

## Pattern Assignments

### `extension/lib/window-geometry.test.ts` (test, transform)

**Analog:** itself (`extension/lib/window-geometry.test.ts`, all 40 lines already read — no re-read needed)

**Full existing pattern** (lines 1-40): plain `describe`/`it` blocks, zero mocks (module has no I/O), each test calls `centeredWindowPosition(current, newWidth, newHeight)` and asserts on the returned `{left, top}` or `{}`.

**Exact style to copy for the new case** (mirrors lines 19-29's "returns {}" cases and lines 7-11/13-16's "full geometry" cases):
```typescript
it("passes a negative computed left/top through unclamped (multi-monitor edge case, 13-REVIEW-3.md IN-02)", () => {
  // A current window positioned left of/above the primary display can
  // legitimately produce a negative left/top when centering a WIDER new
  // window over it -- this must NOT be clamped to 0 (see UI-SPEC assertion #6).
  expect(
    centeredWindowPosition({ left: -50, top: -20, width: 300, height: 300 }, 380, 460),
  ).toEqual({ left: -90, top: -90 });
});
```
(Values: `left = round(-50 + (300-380)/2) = round(-90) = -90`; `top = round(-20 + (300-460)/2) = round(-100) = -100` — recompute precisely before inserting; the point is to pick inputs that force a negative result and assert the exact negative number, not just `toBeLessThan(0)`.)

**Insertion point:** append as a new `it(...)` inside the existing `describe("centeredWindowPosition", ...)` block (after line 39, before closing `});` at line 40) — do not create a new `describe` block.

---

### `extension/e2e-firefox/probe-window-geometry.cjs` (test, live e2e probe)

**Primary analog (bootstrap, header comment, results/exit-code shape):** `extension/e2e-firefox/probe-request-xray.cjs`

**Secondary analog (switchTo/stale-handle discipline, window-open trigger flow):** `extension/e2e-firefox/run-core.cjs`

**Header-comment pattern** (probe-request-xray.cjs lines 1-33): every permanent probe opens with a `//`-comment block explaining (a) what regression this closes, (b) why it's kept permanently (mirrors "prior precedent" language), (c) prerequisites. Copy this shape:
```javascript
// extension/e2e-firefox/probe-window-geometry.cjs — permanent live-Firefox
// regression probe for the consent/ceremony window centering, sizing, and
// self-close lifecycle contract (18-UI-SPEC.md's "Window Geometry &
// Lifecycle Contract" section, UX-02). Formalizes behavior that landed in
// quick task 260720-16k (commit 40d1965) and is already unit-covered
// (window-geometry.test.ts) but had no live-Firefox verification.
//
// Asserts (per 18-UI-SPEC.md's numbered list):
//  1. full-geometry case -> exact centering formula, live
//  2. missing/partial geometry -> default placement (no crash)
//  3. fixed size (380x460 / 480x640) + focused, unconditionally
//  4. consent window closes on confirm/decline, stays open on failed send
//  5. ceremony window closes on success/timeout, stays open on
//     forbidden-origin/ceremony-failed
//  6. negative left/top passes through unclamped (NEVER assert >= 0 --
//     13-REVIEW-3.md IN-02, see window-geometry.test.ts's own comment)
//
// Prerequisites: identical to run-core.cjs (see README.md) -- pv-server
// already running on localhost:8620, `npm run build:firefox` already run.
'use strict';
const path = require('path');
const fs = require('fs');

const EXT_ROOT = path.resolve(__dirname, '..');
const { Builder, By, until } = require(path.join(EXT_ROOT, 'node_modules/selenium-webdriver'));
const firefox = require(path.join(EXT_ROOT, 'node_modules/selenium-webdriver/firefox'));

const EXT_DIR = path.join(EXT_ROOT, '.output/firefox-mv2');
const PROFILE_DIR = process.env.PV_FF_PROFILE_DIR || path.join(__dirname, '.ff-profile-probe-window-geometry');
const SHOTS = process.env.PV_FF_SHOTS_DIR || path.join(__dirname, '.ff-screenshots-probe-window-geometry');
const RESULTS_FILE = path.join(SHOTS, 'results-probe-window-geometry.json');
const SERVER = process.env.PV_SERVER || 'http://localhost:8620';
const FIREFOX_BINARY = process.env.PV_FIREFOX_BINARY || '/Applications/Firefox.app/Contents/MacOS/firefox';
```

**Results-tracking + exit-code pattern** (probe-request-xray.cjs tail, last ~40 lines): a `results` object keyed by gate ID, a `record(gateId, 'PASS'|'FAIL', detail)` helper (referenced but defined earlier in that file — grep for `function record` if the full helper body is needed), and this exact bootstrap/exit shape:
```javascript
if (require.main === module) {
  main().then(async ({ driver, formServer }) => {
    console.log('probe-window-geometry.cjs done. Quitting.');
    await sleep(1000);
    try { await driver.quit(); } catch {}
    formServer.close();
    const failed = Object.entries(results).filter(([, r]) => r.status === 'FAIL');
    if (failed.length) {
      console.error('FAILED gates:', failed.map(([k]) => k).join(', '));
      process.exit(1);
    }
    process.exit(0);
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
```
Use gate IDs like `GEOM-CONSENT-SIZE`, `GEOM-CONSENT-CLOSE`, `GEOM-CEREMONY-SIZE`, `GEOM-CEREMONY-CLOSE`, `GEOM-NEGATIVE` — one per UI-SPEC numbered assertion.

**switchTo(handle) + stale-handle guard pattern** (`run-core.cjs` lines 155-174, 518-521, 583): capture handles before/after triggering the window open, switch only to a genuinely new handle, and NEVER call `switchTo().window(popupHandle)` after a confirm/decline action without first checking `handles.includes(popupHandle)`:
```javascript
// mirrors run-core.cjs:155-174's newTabTo()/ensurePopup() discipline
const handlesBefore = await driver.getAllWindowHandles();
// ... trigger the consent/ceremony window open (e.g. click provider-confirm
// on a page that forces the fallback-window path, or hit the sign-in link) ...
const handlesAfter = await driver.getAllWindowHandles();
const newHandle = handlesAfter.find((h) => !handlesBefore.includes(h));
await driver.switchTo().window(newHandle);
const rect = await driver.manage().window().getRect(); // { x, y, width, height } -- see RESEARCH.md Assumption A1
// assert rect.width === 380 && rect.height === 460 (consent) or 480x640 (ceremony)
// assert Number.isFinite(rect.x) && Number.isFinite(rect.y) -- NEVER assert >= 0

// after triggering close (confirm/decline click):
await sleep(500);
const handlesNow = await driver.getAllWindowHandles();
if (handlesNow.includes(newHandle)) {
  // FAIL this gate -- window did not self-close as contracted
} else {
  // PASS -- switching back to the RP tab is safe; do NOT switchTo(newHandle) again
}
await driver.switchTo().window(rpTabHandle);
```

**Anti-pattern to avoid (explicit, from RESEARCH.md Pitfall 2 + 3):** never call `getRect()` without an immediately-preceding `switchTo().window(newHandle)`, and never call `switchTo().window(popupHandle)` post-close without the `handles.includes(...)` guard shown above.

---

### `extension/package.json` (config)

**Analog:** existing `scripts` block, lines 19-29 (already read via grep — exact existing lines):
```json
"test:e2e:firefox:core": "node e2e-firefox/run-core.cjs",
"test:e2e:firefox:autofill": "node e2e-firefox/run-autofill-capture.cjs",
"test:e2e:firefox:server-unlock": "node e2e-firefox/run-server-unlock.cjs",
...
"pretest:e2e:firefox:core": "wxt build -b firefox",
"pretest:e2e:firefox:autofill": "wxt build -b firefox",
"pretest:e2e:firefox:server-unlock": "wxt build -b firefox",
```
**Pattern to add** (RESEARCH.md's suggested naming, confirmed against actual file convention):
```json
"test:e2e:firefox:window-geometry": "node e2e-firefox/probe-window-geometry.cjs",
"pretest:e2e:firefox:window-geometry": "wxt build -b firefox",
```
Insert `test:e2e:firefox:window-geometry` alphabetically/contextually near the other `test:e2e:firefox:*` entries (after `server-unlock`, matching existing ordering), and its `pretest:` twin in the corresponding `pretest:e2e:firefox:*` block.

---

### `.planning/phases/18-firefox-window-consent-hardening/18-SECURITY.md` (docs, security verdict)

**Analog:** `.planning/phases/12-passkey-provider/12-SECURITY.md` (structure — Trust Boundaries / Threat Register / Accepted Risks Log / Audit Trail / Sign-Off) + `.planning/phases/14-critical-risk-closure-cross-realm-integrity-real-rp-verifica/14-SECURITY.md` (closure-pattern precedent, referenced by CONTEXT.md's "14-03 XBR-02 closure pattern")

**Frontmatter pattern** (12-SECURITY.md lines 1-9):
```yaml
---
phase: 18
slug: firefox-window-consent-hardening
status: secured   # or the project's equivalent terminal status for a decision-gate verdict
threats_open: 0
asvs_level: 1
created: 2026-07-21
---
```

**Trust Boundaries table pattern** (12-SECURITY.md lines 19-27) — reuse this exact table shape but scope rows to the boundary XBR-03 actually evaluates:
```markdown
## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|----------------|
| popup (browser chrome) ↔ third-party page | Consent renders only on browser-chrome-owned popup — the boundary XBR-03 asks whether to weaken | None — page cannot draw over or read the popup |
```

**Threat Register pattern** (12-SECURITY.md lines 31-51) — CRITICAL deviation from the analog per RESEARCH.md's Open Question #2 resolution: this phase ships no code, so every row must be framed hypothetically ("would apply IF the in-page panel were built"), not as a finding against shipped code:
```markdown
| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-18-01 (hypothetical) | Spoofing/Tampering | proposed in-page closed-shadow consent panel (NOT built) | high | [reject / mitigate — reviewer's call] | DOM-based Extension Clickjacking (Aug 2025, Marek Toth/DEF CON 33) shows closed shadow-root gives only partial protection; compare against T-12-14's structural immunity (window model) | [open pending reviewer / closed-as-rejected] |
```
Reference `T-12-14` (`12-SECURITY.md` line 49) directly by ID as "the threat this proposal reopens" — do not restate it, cite it.

**Accepted Risks Log / Sign-Off pattern** (12-SECURITY.md lines 66-96) — if the verdict is rejected-with-reason (the conservative-policy default outcome per CONTEXT.md), record it as an Accepted Risk entry pointing at the retained window-model mitigation, styled like:
```markdown
| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|-----------|-----------|--------------|------|
| AR-18-01 | T-18-01 | In-page panel rejected per conservative XBR-03 policy — window model (T-12-14) retained, no unambiguous clear obtained | gsd-security-auditor (Opus) | 2026-07-21 |
```

**Audit Trail table pattern** (12-SECURITY.md lines 86-90):
```markdown
| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-21 | [N] | [N] | 0 | gsd-security-auditor (Opus) |
```

## Shared Patterns

### Live-Firefox probe bootstrap (Selenium + geckodriver)
**Source:** `extension/e2e-firefox/probe-request-xray.cjs` lines 34-58 (imports, EXT_DIR/PROFILE_DIR/SHOTS/RESULTS_FILE constants, Builder/firefox require pattern)
**Apply to:** `probe-window-geometry.cjs` — copy the constant-naming convention (`PV_FF_PROFILE_DIR`/`PV_FF_SHOTS_DIR` env overrides, per-probe-unique default dir names) verbatim; only the SHOTS/PROFILE_DIR/RESULTS_FILE suffix string changes (`-probe-window-geometry` instead of `-probe-request-xray`).

### switchTo(handle)-before-any-read discipline
**Source:** `extension/e2e-firefox/run-core.cjs` (used throughout, e.g. lines 234, 247, 373-378) — this project's own 14-03-established rule: never read window/DOM state without first switching context to the exact handle you mean to read.
**Apply to:** every `getRect()` call in the new probe script (RESEARCH.md Pitfall 2 makes this explicit for window geometry specifically).

### Stale-handle guard after self-close
**Source:** `extension/e2e-firefox/run-core.cjs` lines 518-521, 583 (comments) + line 166 (`if (!handles.includes(popupHandle))` check pattern)
**Apply to:** every post-confirm/post-decline `switchTo()` call in the new probe — this is also directly load-bearing for UI-SPEC assertion #4/#5 (proving the window handle is genuinely gone, not just assumed gone).

### PASS/FAIL results object + hard-gate exit code
**Source:** `extension/e2e-firefox/probe-request-xray.cjs` tail (results object, `record()` calls, `process.exit(1)` on any FAIL) — CONTEXT.md explicitly names this "14-03's probe hard-gate exit-1-on-FAIL pattern."
**Apply to:** `probe-window-geometry.cjs`'s top-level `main().then(...)` block — must exit 1 if any UI-SPEC assertion gate fails, exit 0 only on all-PASS.

### Negative-position non-assertion (anti-pattern guard, not a copy-pattern)
**Source:** `extension/lib/window-geometry.ts` doc comment (lines 27-37) + `18-UI-SPEC.md`'s explicit "must not assert `left >= 0`/`top >= 0`" instruction, corroborated by `13-REVIEW-3.md` finding IN-02 (not re-read this session — cited in both CONTEXT.md and RESEARCH.md).
**Apply to:** both the new unit test case and the new probe script — this is the one invariant that must NOT be encoded, called out here because it inverts the usual "add an assertion" pattern.

### Security-verdict register shape for a decision-gate (not shipped-code) phase
**Source:** `.planning/phases/12-passkey-provider/12-SECURITY.md` (table structures) + `.planning/phases/14-critical-risk-closure-cross-realm-integrity-real-rp-verifica/14-SECURITY.md` (closure-pattern precedent, not re-read this session — CONTEXT.md cites its XBR-02 closure as the model for XBR-03's own closure regardless of outcome)
**Apply to:** `18-SECURITY.md` — reuse every table shape from 12-SECURITY.md, but every Threat Register row must carry "(hypothetical)" framing since no code ships pending the verdict (RESEARCH.md Open Question #2's resolution, adopted here as the concrete instruction).

## No Analog Found

None — every file in this phase's scope has a strong existing analog (all role-match-or-better). No file requires falling back to RESEARCH.md's Code Examples in place of a real codebase analog.

## Metadata

**Analog search scope:** `extension/lib/`, `extension/e2e-firefox/`, `extension/package.json`, `.planning/phases/12-passkey-provider/`, `.planning/phases/14-critical-risk-closure-cross-realm-integrity-real-rp-verifica/`
**Files scanned:** `window-geometry.ts`, `window-geometry.test.ts`, `probe-request-xray.cjs` (full), `run-core.cjs` (targeted grep + line ranges), `extension/package.json` (targeted grep), `12-SECURITY.md` (full)
**Pattern extraction date:** 2026-07-21
