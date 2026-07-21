---
phase: 18-firefox-window-consent-hardening
reviewed: 2026-07-21T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - extension/lib/window-geometry.test.ts
  - extension/e2e-firefox/probe-window-geometry.cjs
  - extension/package.json
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 18: Code Review Report

**Reviewed:** 2026-07-21T00:00:00Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Phase 18 is a verify-only hardening phase: one regression test case added to
`window-geometry.test.ts`, a new live-Firefox probe (`probe-window-geometry.cjs`)
with 7 GEOM gates and an exit-1 hard gate, and the matching npm script pair in
`package.json`.

Verified positives:
- **Verify-only constraint held.** `git log` confirms the three production
  window-lifecycle files (`window-geometry.ts`, `provider-ceremony.ts`,
  `server-unlock.ts`) were last touched in the earlier `quick-260720-16k` task,
  not by any `18-*` commit. Nothing production changed.
- **Formula parity is correct.** The probe's duplicated `expectedPosition()`
  (lines 149-154) matches `centeredWindowPosition()` exactly, and the new
  negative-position test math (`{left:-90, top:-100}`) is arithmetically correct
  and deliberately uses `toEqual` (not `>=0`) per IN-02 multi-monitor intent.
- **npm script pair** (`test:e2e:firefox:window-geometry` +
  `pretest:e2e:firefox:window-geometry`) matches the sibling-lane convention,
  including the pre-build hook.

No BLOCKER-tier defects: this is test/probe code with no production surface, no
injection/secret/crypto exposure (the `Math.random()` WebAuthn challenge at
lines 315-316 is throwaway test data, not security-relevant), and no data-loss
risk to production. Findings below are robustness and test-reliability concerns.

Note on the "isolated :8621 server" premise from the phase brief: the probe does
**not** stand up its own server on `:8621`. It reuses `localhost:8620`
(line 80), identical to `probe-request-xray.cjs` (line 107). This is the
established sibling convention, so it is not treated as a regression — but the
brief's claim is unfulfilled (see IN-01).

## Warnings

### WR-01: Un-awaited `driver.executeScript(...)` floats a promise (unhandled-rejection risk)

**File:** `extension/e2e-firefox/probe-window-geometry.cjs:317` and `:375`
**Issue:** Both `navigator.credentials.create()` / `.get()` injections call
`driver.executeScript(\`...\`)` without `await`. The injected script returns
`true` synchronously (the credential ceremony runs fire-and-forget in-page), so
functionally the command serializes ahead of the subsequent
`waitForNewHandle()` on the geckodriver wire. But the returned WebDriver promise
is never awaited or `.catch()`-ed. If it rejects (page context torn down, session
hiccup), modern Node (>=15) treats the unhandled rejection as fatal and exits
non-zero — turning an unrelated transport error into a spurious probe crash
rather than a clean per-gate FAIL. Every other `executeScript` call in the file
(e.g. lines 245, 366) is awaited; these two are the outliers.
**Fix:**
```js
await driver.executeScript(`
  window.__pv_geom_create_result = null;
  navigator.credentials.create({ /* ... */ })
    .then((cred) => { window.__pv_geom_create_result = { ok: true, id: cred && cred.id }; })
    .catch((e) => { window.__pv_geom_create_result = { ok: false, error: String(e && e.message || e) }; });
  return true;
`);
```
Apply the same `await` at line 375.

### WR-02: Test coverage does not exercise the documented `Number.isFinite` guards or per-field absence

**File:** `extension/lib/window-geometry.test.ts:27-33`
**Issue:** `centeredWindowPosition()`'s doc contract explicitly guards against
`NaN`/`Infinity` via `Number.isFinite` on all four fields (see
`window-geometry.ts:47-58`), yet **no test passes a `NaN` or `Infinity` input**.
Separately, the case at line 31 is titled "every one of left/top/width/height
must be present" but only omits `height`; missing-`left`, missing-`top`, and
missing-`width` in isolation are never exercised (only the all-empty `{}` case
at line 27 covers total absence). A regression that deleted the `Number.isFinite`
checks, or narrowed the presence check to `height` only, would pass the entire
suite green. The test name overstates what it verifies.
**Fix:** Add cases:
```ts
it("returns {} when width is NaN (isFinite guard)", () => {
  expect(centeredWindowPosition({ left: 0, top: 0, width: NaN, height: 800 }, 380, 420)).toEqual({});
});
it("returns {} when left is Infinity (isFinite guard)", () => {
  expect(centeredWindowPosition({ left: Infinity, top: 0, width: 1200, height: 800 }, 380, 420)).toEqual({});
});
it.each(["left", "top", "width"])("returns {} when %s is missing", (k) => {
  const full = { left: 100, top: 50, width: 1200, height: 800 };
  delete (full as any)[k];
  expect(centeredWindowPosition(full, 380, 420)).toEqual({});
});
```

### WR-03: FATAL path leaks the Firefox/geckodriver process tree (no `driver.quit()`)

**File:** `extension/e2e-firefox/probe-window-geometry.cjs:407-411, 426-429`
**Issue:** On any thrown error, `main()`'s catch (407) writes results and
re-throws; the top-level `.catch` (426) logs and calls `process.exit(1)` — but
`driver` is out of scope there, so `driver.quit()` is never called and
`formServer` never `.close()`-ed. `process.exit` tears down the in-process HTTP
socket, but the geckodriver-spawned Firefox is a separate process tree that can
survive as an orphan (a real cost given the persistent `PROFILE_DIR` and a
visible OS window). The happy path (lines 415-425) quits cleanly; the failure
path — the one that fires exactly when a gate breaks and cleanup matters most —
does not. This mirrors `probe-request-xray.cjs:551-553`, so it is a systemic
harness pattern, not a Phase-18 regression, but the new lane inherits the leak.
**Fix:** Hoist `driver`/`formServer` so cleanup runs on both paths, e.g. return
them from `main()` even on failure, or wrap in a `finally`:
```js
if (require.main === module) {
  let ctx;
  main()
    .then((c) => { ctx = c; })
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(async () => {
      try { await ctx?.driver?.quit(); } catch {}
      try { ctx?.formServer?.close(); } catch {}
      const failed = Object.values(results).some((r) => r.status === 'FAIL');
      process.exit(failed || process.exitCode ? 1 : 0);
    });
}
```

## Info

### IN-01: Probe pollutes the shared `:8620` dev server / uat account with per-run passkey credentials

**File:** `extension/e2e-firefox/probe-window-geometry.cjs:80-82, 315-330`
**Issue:** The probe targets `localhost:8620` — the same default as Bartek's dev
server (`PV_ADDR` default `127.0.0.1:8620`) — and the shared
`uat-prf04@example.local` account, and each run registers a **fresh** passkey
credential (random 16-byte user id, line 315) via `navigator.credentials.create()`
with no cleanup. Across repeated runs this accumulates orphaned credentials in
whatever pv-server DB is listening on `:8620`. The phase brief's "own isolated
pv-server on :8621" is not implemented; the code follows the sibling convention
of reusing `:8620` instead. Extension `storage.local`/`session` are cleared
(lines 245-250), but server-side state is not.
**Fix:** Either document the required disposable server explicitly (a dedicated
`PV_SERVER=http://localhost:8621` throwaway instance, matching the brief), or
add a post-run cleanup that deletes the credentials this probe registered. At
minimum, keep `SERVER`/`EMAIL` overridable (already done) and note in the header
that this MUST NOT run against a personal vault.

### IN-02: GEOM-CONSENT-CLOSE-DECLINE is coupled to the prior create()/confirm succeeding

**File:** `extension/e2e-firefox/probe-window-geometry.cjs:370-401`
**Issue:** The decline gate runs `navigator.credentials.get({ rpId: 'localhost' })`
which relies on the credential registered earlier by the confirm flow. If the
earlier create()/confirm did not actually persist a credential (e.g. a
server-side hiccup that still let the window self-close), `get()` may surface a
zero-candidate consent view — or none — and GEOM-CONSENT-CLOSE-DECLINE can FAIL
for a reason unrelated to close behavior, producing a misleading gate result.
**Fix:** Assert `createResult.ok === true` (line 366 already reads it but only
`console.log`s it) before proceeding to the decline row, so a failed
registration is attributed to the create flow rather than masquerading as a
decline-close failure.

### IN-03: Over-broad `'select, button'` selector for the post-sign-in advance check

**File:** `extension/e2e-firefox/probe-window-geometry.cjs:306`
**Issue:** `tryFind(driver, 'select, button', 60000)` is used to confirm the
popup "advanced past unlock," but virtually any post-unlock view contains a
`<button>` or `<select>`, so this can pass even if the popup is on an unexpected
screen — weakening the precondition it is meant to enforce.
**Fix:** Target a stable `data-testid` for the unlocked/vault view (as the rest
of the probe does, e.g. `[data-testid="ext-unlock-password-submit"]`) instead of
a generic tag selector.

---

_Reviewed: 2026-07-21T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
