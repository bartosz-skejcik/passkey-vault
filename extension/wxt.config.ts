import { defineConfig } from 'wxt';

// Firefox MV2 background (D-08): WXT's own per-browser default already
// produces Chrome -> MV3 service worker, Firefox -> MV2 persistent
// background page, and that split is exactly the deliberate choice this
// project makes for Phase 8. MV2 sidesteps the idle-kill/wake problem
// entirely on Firefox (per PITFALLS.md #8), rather than taking on an MV3
// event-page implementation there too. Do NOT set a top-level
// `manifestVersion` override here -- that would force both browsers onto
// the same manifest version, defeating the point of proving Chrome's MV3
// service-worker survival independently of Firefox's MV2 path. This pin is
// verified in plan 08-03 by inspecting the generated Firefox manifest.json
// for `background.persistent === true` and a `background.scripts` array
// (Firefox's own field name -- never `background.service_worker`, which is
// Chrome-only).
//
// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    // `chrome.storage.session` (the ONLY sanctioned home for the unlocked
    // User Key, per the v0.2 session-key rule) is undefined at runtime
    // without this permission -- unit tests missed it because they inject a
    // fake storage; the real-browser Phase 8 UAT caught it.
    // `alarms`: chrome.alarms drives the auto-lock timer (09-02, EXT-03).
    // Same failure mode as storage: undefined API at runtime without the
    // permission -- registerAutoLockAlarmListener() then throws during
    // main(), aborting service-worker startup so EVERY message hangs.
    // Caught by the real-browser Phase 9 UAT, invisible to mocked tests.
    permissions: ['storage', 'alarms'],
    // EXT-05: deliberately `optional_host_permissions`, NOT `host_permissions`
    // -- the extension is ONE public build with no origin known at compile
    // time (each user self-hosts pv-server at their own URL).
    // `server-config.ts`'s `configureServer()` requests the single concrete
    // origin at runtime via `browser.permissions.request()`, never a
    // blanket grant. Verified against the generated Chrome manifest.json in
    // plan 09-03's Task 2 acceptance criteria.
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    // D-07: explicit MV3 CSP permitting WASM compilation in the extension
    // background/pages context. Declared literally so it is never left to
    // an implicit/permissive default -- plan 08-03 grep-verifies the
    // *generated, packaged* manifest.json (not just `wxt dev` output)
    // contains this string unmodified.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    // D-09: fixed literal Firefox add-on id, not left to an ephemeral
    // dev-mode default that changes across sessions. `strict_min_version`
    // is deliberately NOT set here -- deferred to Phase 13.
    browser_specific_settings: {
      gecko: {
        id: 'passkey-vault@extension.local',
      },
    },
  },
});
