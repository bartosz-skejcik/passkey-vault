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
  // Plan 09-06: the real popup (React + DaisyUI + Tailwind v4, reusing
  // web/'s exact theme) replaces Phase 8's vanilla-TS debug harness.
  // RESEARCH.md's Assumption A2 ("no framework") branch held through
  // Phase 8 -- this module is added HERE, not earlier, confirmed against
  // 08-03-PLAN.md's actual output before assuming.
  modules: ['@wxt-dev/module-react'],
  // CR-01 fix (17-REVIEW.md): packages/pv-ui/components/*.tsx is consumed
  // via a symlinked (not workspace-hoisted) `file:` dependency
  // (extension/node_modules/pv-ui -> ../../packages/pv-ui), and pv-ui
  // physically installs its OWN React copy under its own node_modules
  // (needed for tsc/standalone typechecking per 17-01). Vite/rollup
  // resolves the symlink's realpath before Node module resolution, so a
  // bare `import "react"` from inside packages/pv-ui/ can resolve to
  // pv-ui's own React instance instead of this extension's -- two
  // separate React module instances loaded in the same bundle break every
  // hook (`useContext` on a `null` dispatcher, "Invalid hook call").
  // `extension/vitest.config.ts` already applies this exact dedupe for the
  // test build; `wxt build`'s production Vite/rollup pass needs the same
  // guard, since @wxt-dev/module-react sets no `resolve.dedupe` itself.
  vite: () => ({
    resolve: { dedupe: ['react', 'react-dom', 'lucide-react'] },
  }),
  // Per-browser FUNCTION form (not a plain object): the pinned `key` below
  // is Chrome-only and must NEVER reach the Firefox manifest -- Firefox's
  // manifest parser rejects unknown top-level keys with a loud warning
  // ("Reading manifest: Warning processing key: An unexpected property was
  // found in the WebExtension manifest"), confirmed by Bartek's manual
  // `about:debugging` load of the firefox-mv2 build. Every other field
  // below is IDENTICAL across browsers -- only `key`'s presence diverges,
  // via the `browser === 'chrome'` conditional spread.
  manifest: ({ browser }) => ({
    // Store-facing identity (publication 2026-07-22). Version comes from
    // package.json; name/description are set here so the packaged manifest
    // never ships the package.json's internal "extension" placeholder.
    name: 'Passkey Vault',
    description:
      'Self-hosted, zero-knowledge password manager & passkey provider: autofill, TOTP and passkey login on every site.',
    homepage_url: 'https://github.com/bartosz-skejcik/passkey-vault',
    // Pinned dev-build public key (09-08, 09-CONTEXT AMENDMENT 2026-07-15),
    // Chrome-only (see the per-browser-function comment above):
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
    // (3) FIREFOX MUST NOT RECEIVE THIS FIELD (upgraded from "unaffected"
    //     to "actively excluded" after Bartek's manual load caught the
    //     Firefox manifest-warning regression): `browser_specific_settings
    //     .gecko.id` below already pins the Firefox add-on id -- but
    //     `moz-extension://` origins use a per-INSTALL internal UUID at
    //     runtime. QUESTION CLOSED (Phase 13, 2026-07-17, verified by
    //     research — 13-FF-WEBAUTHN-RESEARCH.md): `rpId = extension-id` is
    //     PERMANENTLY impossible on Firefox (moz-extension is not a
    //     registrable domain; spec origin validation — SecurityError,
    //     confirmed empirically on FF152). Since FF150 an extension MAY run
    //     WebAuthn for host-permitted WEB-domain rpIds, but bug 2026687
    //     closes the action popup on the OS prompt (tab/window required).
    //     v0.2 ships honest degradation to password unlock on Firefox
    //     (D-12 disabled+explainer); the v0.2.x backlog path is a
    //     server-origin PRF ceremony (rpId = server domain, FF135+ PRF).
    //
    // Resulting stable dev Chrome extension id (visible in
    // chrome://extensions after one load of the rebuilt output, needed for
    // PV_EXTENSION_ORIGINS/09-07's UAT): bbpnpamaoddpkfjnohkkepbjgbjpdbfo
    ...(browser === 'chrome'
      ? {
          key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0jLFyYzoV6yS7N+6/YdetllenktSlcgGYFXB6qorXTrfJzT507l2LyaMniofG49kabxHcELfnes0NWqVXaae/y+qV9LwsRSITYgp8b1shFZCKYNbp0X/GIx9nG6f0lE7AKPrbM1z7CJtZW39dQbe+r/txjUmexHCaDWIwT7tJTcafqZ6mHncOIrhG3ihEKgxoqOZUKFkyQFbjoMDYJtFkrskOTelfhDP5BWrYCud3Ijmtfn/cHnGvxu8UMAtFSV951JySCqkzf05PMCitf1I7LFR3zwLI0iNbvygGYXMYonExEeNxaNRU/jrDfMu8UgB2bNzQOKnia0SEg1NuYhEjQIDAQAB',
        }
      : {}),
    // `chrome.storage.session` (the ONLY sanctioned home for the unlocked
    // User Key, per the v0.2 session-key rule) is undefined at runtime
    // without this permission -- unit tests missed it because they inject a
    // fake storage; the real-browser Phase 8 UAT caught it.
    // `alarms`: chrome.alarms drives the auto-lock timer (09-02, EXT-03).
    // Same failure mode as storage: undefined API at runtime without the
    // permission -- registerAutoLockAlarmListener() then throws during
    // main(), aborting service-worker startup so EVERY message hangs.
    // Caught by the real-browser Phase 9 UAT, invisible to mocked tests.
    //
    // `activeTab`: WITHOUT it, `tabs.query({active:true,currentWindow:true})`
    // returns the active tab with `url` STRIPPED, so autofill-match.ts's
    // resolveFillTarget() sees `tabUrl: undefined` and every match resolves
    // "restricted" -- autofill dead on arrival (Phase 10, caught by the
    // packaged-build UAT in real Chrome; 10-04's SUMMARY claimed activeTab
    // was "implicit", but activeTab has no effect unless DECLARED here).
    // Opening the action popup is activeTab's classic trigger, which grants
    // temporary host access to exactly the tab the user is filling into --
    // the minimal, gesture-bound grant matching FILL's "explicit user
    // gesture" requirement.
    //
    // `tabs`: origin VISIBILITY (tab.url in tabs.query) independent of
    // activeTab's gesture timing. Industry-standard for password managers
    // (Bitwarden and 1Password both declare it), and it adds ZERO new
    // install-warning surface here: the content-relay's `<all_urls>`
    // content script already triggers Chrome's broadest "read and change
    // all your data on all websites" warning, which subsumes tabs'. It
    // also makes the packaged build honestly UAT-able under automation
    // (Playwright cannot click the real toolbar action, so activeTab never
    // fires there) -- and this project's standing rule is that every phase
    // UATs the exact shipping artifact. NOTE for the phase-10 security
    // review: `tabs` grants URL visibility only; frame-guard.ts still
    // derives fill targets exclusively from platform data and re-verifies
    // origin at fill time.
    permissions: ['storage', 'alarms', 'activeTab', 'tabs'],
    // EXT-05: deliberately `optional_host_permissions`, NOT `host_permissions`
    // -- the extension is ONE public build with no origin known at compile
    // time (each user self-hosts pv-server at their own URL).
    // `server-config.ts`'s `configureServer()` requests the single concrete
    // origin at runtime via `browser.permissions.request()`, never a
    // blanket grant. Verified against the generated Chrome manifest.json in
    // plan 09-03's Task 2 acceptance criteria.
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    // Phase 13 (Plan 13-01) -- carried-over blocker flagged by
    // 09-03-SUMMARY.md for Phase 13: Firefox MV2 strips
    // `optional_host_permissions` from the manifest entirely (WXT's
    // manifest.mjs `mv3OnlyKeys` list treats it as an MV3-only key), so
    // EXT-05's runtime `browser.permissions.request()` grant for the
    // user's self-hosted server origin has NO manifest pre-declaration on
    // Firefox and the request fails. Firefox MV2 instead reads host
    // match-patterns from the shared `optional_permissions` array. Scoped
    // to `browser === 'firefox'` only -- Chrome keeps using
    // `optional_host_permissions` above, unchanged.
    ...(browser === 'firefox'
      ? {
          optional_permissions: ['http://*/*', 'https://*/*'],
        }
      : {}),
    // D-07: explicit MV3 CSP permitting WASM compilation in the extension
    // background/pages context. Declared literally so it is never left to
    // an implicit/permissive default -- plan 08-03 grep-verifies the
    // *generated, packaged* manifest.json (not just `wxt dev` output)
    // contains this string unmodified.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    // D-09: fixed literal Firefox add-on id, not left to an ephemeral
    // dev-mode default that changes across sessions.
    browser_specific_settings: {
      gecko: {
        id: 'passkey-vault@extension.local',
        // Phase 13 (Plan 13-01), D-04: version floor pinned at 115.0 --
        // the extension reads/writes `browser.storage.session` (the D-05
        // sole sanctioned home for the unlocked User Key) in 9 non-test
        // files, and `storage.session` did not ship in Firefox until
        // version 115. A lower floor (e.g. 91 ESR, previously considered)
        // would assert compatibility with versions where the extension
        // cannot function at all. 115 happens to also be an ESR release.
        // NEVER set this below 115.
        strict_min_version: '115.0',
        // AMO data-collection consent (mandatory for new submissions since
        // 2025-11-03; hard submission blocker without it). Honest
        // declaration: vault sync transmits CLIENT-SIDE-ENCRYPTED credential
        // blobs to the user's own configured pv-server — that is still a
        // "transmission" of authenticationInfo under Mozilla's taxonomy,
        // even though the server never sees plaintext or keys
        // (zero-knowledge). Native consent UI needs Firefox 140+; users on
        // 115–139 see the AMO listing disclosure instead.
        data_collection_permissions: {
          required: ['authenticationInfo'],
        },
      },
    },
    // Phase 12 (Plan 12-03), D-17: Firefox-only. `page-bridge-firefox.ts`
    // is an unlisted-script asset (Chrome instead uses the declarative
    // `world:'MAIN'` content-script field on page-bridge.content.ts, which
    // needs no web_accessible_resources entry) --
    // `injectPageBridgeFirefoxScript()` (content-relay.content.ts's
    // Firefox-only branch; debug session .planning/debug/resolved/
    // firefox-injection-csp-blocked.md replaced WXT's own `injectScript()`
    // helper with this local, always-`.src` equivalent -- see that
    // function's own header comment) REQUIRES the injected script to be
    // listed here or the page-context `<script src>` load is blocked by
    // the extension's own CSP. Always
    // defined using the MV3 object-array shape (`{resources, matches}`),
    // never a bare string array -- WXT's own manifest post-processing
    // (core/utils/manifest.mjs) throws "Non-MV3 web_accessible_resources
    // detected" on a bare-string entry and otherwise auto-converts this
    // shape to Firefox's MV2 flat-array format at build time; verified
    // against the pinned WXT 0.20.27 source at execution time, not
    // guessed. Scoped to `browser === 'firefox'` only, mirroring this
    // file's own `key` field precedent above -- Chrome's build carries no
    // reference to `page-bridge-firefox.js` at all.
    ...(browser === 'firefox'
      ? {
          web_accessible_resources: [
            {
              resources: ['page-bridge-firefox.js'],
              matches: ['*://*/*'],
            },
          ],
        }
      : {}),
  }),
});
