# Phase 9 UAT — popup full flow (preliminary, orchestrator-driven; 09-07 formalizes)

**Run:** 2026-07-15, Playwright + CDP virtual authenticator (hasPrf), packaged chrome-mv3,
live pv-server @127.0.0.1:8620 (PV_EXTENSION_ORIGINS allowlisted), account uat-prf04@example.local.
Harness: scratchpad uat/popup-full-flow.js. **Result: 15/15 checks PASS, zero console errors.**

Flow observed working end-to-end in a real browser:
server-config (REAL healthz probe + persist) → sign-in variant (email+password, argon2id in SW,
real /api/auth/login) → post-unlock enrollment prompt → EXTENSION PASSKEY ENROLLED (real
navigator.credentials.create() with rpId = extension id + PRF eval via CDP virtual authenticator;
wrapped-UK blob POSTed to /api/extension-passkeys) → item list (NordPass layout verified: header
gear + Full screen, search, type icons, coral Plus FAB, footer auto-lock select) → item detail →
REAL lock (envelope cleared + SW killed) → unlock-only variant (no email field) with PRF button
(extPasskeyEnrolled gate) → PRF UNLOCK (real get() + PRF eval → unwrap → hydrate) → SW kill →
popup still unlocked (storage.session rehydration).

CORS SC#6 also proven on live HTTP: preflight from chrome-extension://bbpnp… echoes the exact
origin (PV_EXTENSION_ORIGINS allowlist, commit a5ff669).

## Five real bugs found by this UAT cycle (all invisible to green vitest/builds; all fixed)
1. manifest missing `storage` permission (phase 8) — a48a7c5
2. manifest missing `alarms` permission → SW startup abort, every message hung — e695dac
3. permissions.request() in SW throws (user gesture doesn't survive sendMessage hop); was
   mislabeled "unreachable" → grant moved to popup submit handler — d2ec8e2
4. Chrome JSON-serializes runtime messages → every Uint8Array/ArrayBuffer protocol field mangled
   (Chrome-only; Firefox structured-clones) → base64 boundary + JSON-round-trip structural gate — f2ce195/8b380e7
5. unlock/ext-passkey handlers never initialized WASM (fresh SW) → instant "unknown" on first
   sign-in → initCrypto() guards at handler entry — (this commit)

## Deferred to human / 09-07
- The permission-PROMPT click itself (browser chrome; headless cannot interact): configure a
  server in a headed browser and accept the prompt — 30 seconds.
- Firefox full pass (Phase 13; moz-extension rpId acceptance unknown).
- Web-app deep-links (?panel=settings / ?action=new-item) round-trip in a headed browser.

Screenshots: uat-screenshots/01..12 (12 views).

## SC#5 cross-client sync — real second-client proof

**Why this section exists:** an earlier orchestrator pass claimed SC#5/EXT-04 cross-client sync
was verified, but the probe (`probe-sc4567.js`) was theatre — it captured a `beforeCount` it
never read, POSTed a junk body that couldn't decrypt, and logged its "result" outside the
pass/fail array so it could not fail. The phase verifier caught this. This section replaces that
claim with a real run, in a real browser, against two genuinely separate clients.

**Run:** 2026-07-15, Playwright (chromium, headless), packaged `extension/.output/chrome-mv3`
loaded as a real MV3 extension, live pv-server @ `http://localhost:8620`
(`PV_STATIC_DIR=web/out`, `PV_ORIGIN=http://localhost:8620`,
`PV_EXTENSION_ORIGINS=chrome-extension://bbpnpamaoddpkfjnohkkepbjgbjpdbfo`), account
`uat-prf04@example.local`. Harness: `scratchpad/uat/probe-crossclient-sync.js`.

**Repro:** `cd scratchpad/uat && node probe-crossclient-sync.js <run-id>`

**Result: 7/7 checks PASS, exit code 0** (verified on three separate runs — run2 failed on a
selector bug of mine, fixed; run3 and run4 both passed cleanly):

```
✅ extension server config accepted (real healthz probe + persist) — {"ok":true}
✅ CLIENT 1 (extension popup) unlocked and listing
✅ marker item not present before the second client creates it
✅ CLIENT 2 (web app) logged in and unlocked
✅ web app (CLIENT 2) created the marker item via its own real form — XSYNC-run4
✅ SC#5: item created on the SECOND client appears in the extension popup with no manual refresh/reload
✅ extension opened a WebSocket to /api/sync/ws (observed via a real WebSocket-constructor interception in the SW) — ws://localhost:8620/api/sync/ws?token=FEQnrq2vGvR%2BPnJpy4FyeNJsHVuar3Zf4u3OSKFlVVM%3D

=== 7/7 checks passed ===
```

What the harness actually drove, end to end:
1. **CLIENT 1** — the packaged extension popup, signed in with real email+password
   (argon2id in the SW, real `/api/auth/login`), listing items.
2. **CLIENT 2** — the v0.1 web app, in a genuinely separate `BrowserContext` page (not the
   popup's own `fetch`), logged into the SAME account via its real `LoginForm` → real
   `UnlockOverlay` unlock click → real `TopBar` "New item" → real `TypePicker` "Login" tile →
   real `ItemForm` fill + submit (`createVaultItem`) — no shortcuts, no injected payloads.
3. The marker item created by CLIENT 2 **appeared in the extension popup with zero manual
   refresh/reload of the popup** — `popup.waitForSelector` on the marker text, no `popup.reload()`
   anywhere in the flow between item creation and assertion.
4. The extension's background service worker's `WebSocket` constructor was intercepted (a real
   `Proxy` around `self.WebSocket`, installed before login so it couldn't race the sync-client's
   own `connect()`) and recorded a genuine `ws://localhost:8620/api/sync/ws?token=...` connection
   — proving the "+ WebSocket" half of SC#5, not just the REST pull.

**What could NOT be observed directly:** this Playwright version (1.61.1) only supports
`context.newCDPSession(page)` for `Page | Frame`, not for `Worker`/service-worker targets, so a
CDP `Network.webSocketCreated` event on the SW target itself was not available. The
`WebSocket`-constructor-interception approach above is a real substitute (it intercepts the
actual global constructor the sync-client module calls, at the actual call site), not a
CDP-level trace — noted here for honesty rather than overclaiming a CDP-level observation.

**Selector bugs fixed along the way (mine, not product bugs):**
- The web app's password-login flow leaves the vault **locked-but-authed** behind a
  `fixed inset-0 z-50 backdrop-blur-md` `UnlockOverlay` until `[data-testid="unlock-submit"]` is
  clicked — the earlier probe never clicked it, so its later clicks landed on the overlay's
  scrim instead of the vault shell.
- The `?action=new-item&type=login` deep-link shortcut mentioned in the task exists in
  `web/src/app/page.tsx` (commit `7d56a99`, 2026-07-15 14:10) but the static export served by
  pv-server at `web/out` was built at 14:02 — **before** that commit — so the currently deployed
  build does not include it yet (confirmed: navigating with the query params lands on the
  `TypePicker` step, not directly on `ItemForm`). This is a real, currently-true fact about the
  running server, not a probe bug; it only affects which shortcut is available, not the sync
  path under test. Worked around by driving the real `TypePicker` → `type-tile-login` click
  instead — equally real, no rebuild or source change made to get the test to pass.

Screenshot: `uat-screenshots/15-crossclient-sync.png` — popup item list showing `XSYNC-run3` and
`XSYNC-run4` (both prior runs' marker items, persisted on the account), captured immediately
after the no-refresh sync assertion passed.
