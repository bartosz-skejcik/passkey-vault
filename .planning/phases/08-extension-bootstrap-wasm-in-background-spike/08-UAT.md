# Phase 8 UAT — Extension Bootstrap & WASM-in-Background Spike

**Run:** 2026-07-15, self-driven via Playwright (per standing authorization for functional UAT)
**Harness:** scratchpad `uat/chrome-idle-kill.js` — Playwright 1.61.1, Chromium channel, packaged `extension/.output/chrome-mv3` loaded via `--load-extension`

## Results

### ✅ SC #1 (Chrome half) + SC #2 — WASM under MV3 CSP in the packaged build

Loaded the packaged (not `wxt dev`) chrome-mv3 build. First click of "Run round-trip spike"
returned `{"survived":false,"ok":true}` — `pv_wasm` fetched + instantiated inside the real
service worker under the declared `wasm-unsafe-eval` CSP, full derive → wrap → unwrap ran,
and the spike envelope persisted to `chrome.storage.session`. Zero console/page errors.

### ✅ SC #3 — round-trip survives a REAL service-worker kill/wake

Method (stronger than the human checklist — includes a module-state ground truth):

1. Planted `globalThis.__uatKillMarker = 'set-before-kill'` in the live worker.
2. Forced termination via CDP `ServiceWorker.stopAllWorkers` (programmatic equivalent of
   chrome://serviceworker-internals "Stop"; NOT a reload/disable-enable).
3. Clicked "Check again" → worker respawned → returned `{"survived":true,"ok":true}`.
4. Marker read back as **WIPED** in the woken worker — proof the kill genuinely destroyed
   module state and the `survived:true` came from re-derivation out of
   `chrome.storage.session`, not from a still-warm module.

Zero console/page errors across the whole cycle.

### ✅ SC #4 — Firefox manifest pin (static verification)

Verified in the *generated* `extension/.output/firefox-mv2/manifest.json`:
`manifest_version: 2`, `background.persistent: true`, `background.scripts: ["background.js"]`
(no `service_worker` key), `gecko.id: "passkey-vault@extension.local"`. Note: `persistent: true`
was missing until plan 08-03's executor traced WXT's handling and fixed it in
`defineBackground()` (commit e97b420).

### ⏸ Deferred (human / Phase 13): Firefox runtime single-click round-trip

Firefox is not installed on this machine and Playwright's Firefox build does not support
extensions. Risk is low: MV2 persistent background page has no idle-kill problem, and the
build + manifest are verified. Exact repro (from 08-03-SUMMARY.md): load
`extension/.output/firefox-mv2/manifest.json` as a temporary add-on via `about:debugging`,
single click "Run round-trip spike", expect `{ok:true}` with zero console errors.
Phase 13 (plan 13-01/13-04) installs Firefox and re-verifies every feature there.

## Bug found by this UAT (would have shipped otherwise)

**Missing `storage` permission in the manifest.** `chrome.storage.session` — the ONLY
sanctioned home for the unlocked User Key in all of v0.2 — was `undefined` at runtime:
`Uncaught TypeError: Cannot read properties of undefined (reading 'session')`. All 3 vitest
cases were green (they inject a fake `SessionStorage`) and both builds compiled clean; only
running the packaged build in a real browser surfaced it. Fixed by adding
`permissions: ['storage']` in `wxt.config.ts`; verified present in BOTH packaged manifests
after rebuild.

Lesson (again, per AUTONOMOUS-MILESTONE-PLAYBOOK §4): permission-manifest correctness is
invisible to unit tests with injected fakes — every future phase that adds a `chrome.*` API
must verify against the packaged build in a real browser.

## Addendum — post-review-fix re-run (2026-07-15)

After the code-review fixes (a1c304b, 2523a2a) the harness was re-run against the rebuilt
packaged chrome-mv3 build: **PASS** — `{ok:true,survived:false}` → CDP kill (marker WIPED) →
`{ok:true,survived:true}`, zero console errors. Bonus finding: the review's originally
suggested `sender.tab` check silently broke popup-in-tab messaging — only this re-run caught
it; the shipped check discriminates on sender.url own-origin instead.
