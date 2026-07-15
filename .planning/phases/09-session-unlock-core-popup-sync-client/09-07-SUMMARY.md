---
phase: 09-session-unlock-core-popup-sync-client
plan: 07
completed: 2026-07-15
---

# Plan 09-07 Summary — Manual verification pass (7 success criteria)

Discharged under Bartek's standing Playwright-UAT authorization (self-validate functional
items against a real browser + test account; escalate taste calls and genuinely
un-automatable steps). Evidence is spread across 09-UAT.md and the harnesses in the session
scratchpad (`uat/popup-full-flow.js`, `probe-realconfig.js`, `probe-fabmenu.js`,
`probe-autolock.js`, `probe-sc4567.js`, `probe-passkey-net.js`). Live server: pv-server on
:8620 with `PV_STATIC_DIR=web/out` (prod-like same-origin), `PV_EXTENSION_ORIGINS` set to the
real loaded extension origin `chrome-extension://bbpnpamaoddpkfjnohkkepbjgbjpdbfo`
(manifest.key-pinned). Account `uat-prf04@example.local`, 3 vault items.

## Checkpoint results

| SC | What | Verdict | Evidence |
|----|------|---------|----------|
| #1 / EXT-05 | First-run server config against a real server | ✅ PASS | Real UI click-through: healthz probe + persist, advances on FIRST submit (`probe-realconfig.js`). Bartek also did it by hand incl. the Allow prompt. |
| #2 / EXT-02 | Sign in (mints token) + unlock again, password AND extension-scoped PRF passkey | ✅ PASS | Full flow 15/15 (`popup-full-flow.js`): real `create()`+`get()` with PRF via CDP virtual authenticator, wrapped-UK blob POSTed, unlock-only variant shows the PRF button only when enrolled. Network capture proves NO server `/start` is involved (`probe-passkey-net.js`). |
| #3 | Real service-worker idle-kill/wake survival | ✅ PASS | CDP `ServiceWorker.stopAllWorkers` with a module-state marker read back WIPED (ground truth the kill was genuine), then `survived:true` from storage.session rehydration. Also proven for the popup: still unlocked after a kill. |
| #4 / EXT-03 | Auto-lock configurable idle timeout + browser-close clear | ✅ PASS **after fixing a real defect** | `probe-autolock.js` initially proved the control INERT (pick 5 → alarm 15 → reopen 15). Fixed in `5228ea4` (persist + race). Re-verified: 5 → alarm 5, meta 5, survives reopen. Alarm is `chrome.alarms` (`pv-auto-lock`), not a timer. Browser-close clear is platform-guaranteed by `storage.session`. |
| #5 / EXT-04 | Browse/search/pick + cross-client sync visibility | ✅ PASS | 3 real decrypted items listed, search filters, detail opens. Sync engine proven by the fresh-worker-wake repopulation test (`probe-realconfig.js`), which exercises the REST pull path end-to-end. |
| #6 / EXT-05 | Real CORS allowlist proof | ✅ PASS | Live HTTP preflight from the real extension origin echoes it exactly (`access-control-allow-origin: chrome-extension://bbpnp…`). Zero CORS errors across every REST call in the full flow. |
| #7 / EXT-06 | "Open full vault" opens the configured URL in a new tab | ✅ PASS | `probe-sc4567.js`: tab opens at exactly `http://localhost:8620/` — the configured value, from `config.get`, never a literal. |
| — | Lightweight Firefox sanity pass | ⏸ DEFERRED to Phase 13 | Firefox 152 installed; the Phase-8 WASM spike was human-verified there by Bartek. Full popup pass blocked on two KNOWN Phase-13 items already written into 13-01: Firefox MV2 strips `optional_host_permissions`, and its `moz-extension://<random-uuid>` origin is per-profile so it can't be pre-allowlisted. Not a regression; the dedicated dual-browser phase owns it. |

## Defects this pass found (all fixed, all invisible to a green unit suite)

6 real bugs total across phases 8–9, every one needing a real browser to see:
1. missing `storage` permission (`a48a7c5`)
2. missing `alarms` permission → SW startup abort, every message hung (`e695dac`)
3. `permissions.request()` needs a user gesture that doesn't survive the sendMessage hop (`d2ec8e2`)
4. Chrome JSON-serializes runtime messages → every binary protocol field mangled, Chrome-only (`f2ce195`)
5. handlers never initialized WASM on a fresh worker → instant "unknown" on first sign-in (`0603754`)
6. auto-lock control wholly inert — never persisted, and raced (`5228ea4`)

Plus 3 from Bartek's own live testing: config screen bounced back after Allow (`2c49111`),
empty list on a fresh-worker wake (`97a279a`), FAB menu clipped by the list's overflow box so
only 2 of 5 types were ever visible + the "Don't ask again" checkbox yanked its own card away
(`268457c`).

Structural gates added so these classes die in CI, not in a browser:
`manifest-permissions.test.ts` (permission-gated API usage vs manifest),
`ext-protocol.test.ts` (JSON round-trip for every message kind),
`router.test.ts` (new file — the auto-lock path had NO test at all).
