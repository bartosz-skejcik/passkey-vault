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
    // Pinned dev-build public key (09-08, 09-CONTEXT AMENDMENT 2026-07-15):
    //
    // (1) WHY: the extension-scoped PRF passkey (Plan 09-08) binds its
    //     credential to `rpId = <this extension's own id>` -- the ONLY rpId
    //     `navigator.credentials.get()` accepts from a `chrome-extension://`
    //     popup page. Without a pinned `key`, Chrome derives a NEW random
    //     extension id on every unpacked reload/different machine
    //     (09-RESEARCH Pitfall 2, upgraded from a CORS-nuisance to a hard
    //     requirement by the AMENDMENT) -- silently orphaning every
    //     previously-enrolled extension passkey the instant the id changes.
    //     This `key` is the base64 DER-encoded PUBLIC half of a keypair
    //     generated solely to make Chrome compute a deterministic id for
    //     unpacked/dev loads; committing it is safe (it's a public key, not
    //     a secret) -- the PRIVATE half was discarded immediately after
    //     generation and is not needed for unpacked loads.
    // (2) STORE BUILD DIVERGES (expected, by design): this pin only affects
    //     unpacked/dev loads. The Chrome Web Store assigns its OWN key (and
    //     therefore its own, different, store-stable id) at first upload,
    //     stripping/replacing this field for the published build.
    //     Credentials enrolled against a dev build do NOT carry over to a
    //     store build -- that's an accepted, expected divergence, not a bug.
    // (3) FIREFOX UNAFFECTED: this field is Chrome/MV3-only.
    //     `browser_specific_settings.gecko.id` below already pins the
    //     Firefox add-on id -- but `moz-extension://` origins use a
    //     per-INSTALL internal UUID at runtime, so whether rpId validity
    //     even works there at all is an OPEN QUESTION the AMENDMENT
    //     explicitly defers to Phase 13 (expected outcome: honest
    //     degradation to password unlock on Firefox until proven otherwise).
    //
    // Resulting stable dev Chrome extension id (visible in
    // chrome://extensions after one load of the rebuilt output, needed for
    // PV_EXTENSION_ORIGINS/09-07's UAT): bbpnpamaoddpkfjnohkkepbjgbjpdbfo
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0jLFyYzoV6yS7N+6/YdetllenktSlcgGYFXB6qorXTrfJzT507l2LyaMniofG49kabxHcELfnes0NWqVXaae/y+qV9LwsRSITYgp8b1shFZCKYNbp0X/GIx9nG6f0lE7AKPrbM1z7CJtZW39dQbe+r/txjUmexHCaDWIwT7tJTcafqZ6mHncOIrhG3ihEKgxoqOZUKFkyQFbjoMDYJtFkrskOTelfhDP5BWrYCud3Ijmtfn/cHnGvxu8UMAtFSV951JySCqkzf05PMCitf1I7LFR3zwLI0iNbvygGYXMYonExEeNxaNRU/jrDfMu8UgB2bNzQOKnia0SEg1NuYhEjQIDAQAB',
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
