---
phase: 09-session-unlock-core-popup-sync-client
plan: 03
subsystem: infra
tags: [wxt, browser-extension, chrome, firefox, manifest, permissions, healthz, chrome.storage.local]

# Dependency graph
requires:
  - phase: 08-extension-bootstrap-wasm-in-background-spike
    provides: "extension/ as a working WXT project (Chrome MV3 + Firefox MV2), wxt.config.ts's confirmed manifest shape, background.ts's `import { browser } from 'wxt/browser'` convention"
provides:
  - "extension/entrypoints/background/server-config.ts — the sole, tested source of the extension's pv-server base URL (normalizeServerUrl, probeServerHealth, configureServer, readServerConfig, wsUrlFromBase)"
  - "extension/wxt.config.ts's optional_host_permissions declaration, enabling a per-user runtime permission grant instead of a compile-time host list"
  - "A standing grep-based invariant test guarding against any future extension/ file hard-coding a server URL"
affects: ["09-04", "09-05", "09-06", "09-07", "13-dual-browser-hardening"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "server-config.ts imports `browser` from 'wxt/browser' directly (matching background.ts's Phase 8 convention) and calls browser.storage.local.get/set + browser.permissions.request inline — tests mock the 'wxt/browser' module itself (vi.mock with a Map-backed storage.local fake + a vi.fn() for permissions.request) rather than injecting storage as a constructor parameter, since the acceptance criteria require the literal chrome.storage.local/browser.storage.local call site to live in this file"
    - "normalizeServerUrl rebuilds the URL from `${protocol}//${host}` only, discarding path/query — the extension only ever needs the origin, and this also naturally strips a trailing slash and lowercases the host (URL's own host normalization)"
    - "wsUrlFromBase is a single-leading-scheme regex replace (baseUrl.replace(/^http/, 'ws')), identical to web/src/lib/vault/sync.ts's wsUrl() helper — extracted here so Plan 09-05's sync-client.ts never re-implements it"

key-files:
  created:
    - extension/entrypoints/background/server-config.ts
    - extension/entrypoints/background/server-config.test.ts
  modified:
    - extension/wxt.config.ts

key-decisions:
  - "EXT-05's server-URL invariant test scoped its no-hard-coded-URL grep to exclude any matched literal containing a `*` wildcard, since wxt.config.ts's own optional_host_permissions manifest values (http://*/*, https://*/*) are match-patterns, not concrete server origins, and would otherwise self-trigger the invariant test"
  - "Did not mark EXT-05 complete in REQUIREMENTS.md — its full acceptance text (all REST+WS traffic targets the configured URL; server allowlists the extension origin via CORS) spans Plans 09-04/09-05 and a server-side CORS change not yet landed; 09-07 (this phase's closing plan) also declares EXT-05 in its frontmatter, confirming it is the intended completion point, not this plan"

patterns-established:
  - "server-config.ts is the ONE place extension/ reads/writes the pv-server base URL — enforced by a standing grep test (no_other_extension_file_hard_codes_a_server_url), not just a code comment"

requirements-completed: []  # EXT-05 partially delivered here; full completion deferred to 09-07 (see key-decisions)

coverage:
  - id: D1
    description: "normalizeServerUrl validates scheme (http/https only), lowercases host, strips trailing slash, and rejects javascript:/file:/chrome-extension:/malformed inputs as InvalidServerUrlError"
    requirement: "EXT-05"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/server-config.test.ts#normalizeServerUrl"
        status: pass
    human_judgment: false
  - id: D2
    description: "probeServerHealth requires an exact {status:\"ok\"} JSON body on an ok fetch response, resolving false (never throwing) for unrelated bodies, wrong status values, non-JSON bodies, or network-level rejections"
    requirement: "EXT-05"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/server-config.test.ts#probeServerHealth"
        status: pass
    human_judgment: false
  - id: D3
    description: "configureServer validates before any I/O, probes before persisting, requests browser.permissions.request({origins:[baseUrl+\"/*\"]}) for exactly the configured origin, then persists to chrome.storage.local and returns the normalized ServerConfig"
    requirement: "EXT-05"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/server-config.test.ts#configureServer"
        status: pass
    human_judgment: false
  - id: D4
    description: "readServerConfig round-trips through the same persisted storage (null when unset, the config once configureServer has succeeded)"
    requirement: "EXT-05"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/server-config.test.ts#readServerConfig"
        status: pass
    human_judgment: false
  - id: D5
    description: "wsUrlFromBase converts http(s) base URLs to ws(s) equivalents, matching web/src/lib/vault/sync.ts's existing wsUrl() convention"
    requirement: "EXT-05"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/server-config.test.ts#wsUrlFromBase"
        status: pass
    human_judgment: false
  - id: D6
    description: "wxt.config.ts declares optional_host_permissions (not host_permissions); the generated Chrome MV3 manifest.json contains it"
    requirement: "EXT-05"
    verification:
      - kind: other
        ref: "cd extension && npx wxt build -b chrome && grep -c optional_host_permissions .output/chrome-mv3/manifest.json (returned 1)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Standing invariant test fails the moment any future extension/*.ts or *.tsx file hard-codes an http(s) server-origin string literal instead of reading server-config.ts"
    requirement: "EXT-05"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/server-config.test.ts#no_other_extension_file_hard_codes_a_server_url"
        status: pass
    human_judgment: false

# Metrics
duration: ~20min
completed: 2026-07-15
status: complete
---

# Phase 9 Plan 3: Server URL Configuration Summary

**`server-config.ts` — the extension's single, healthz-validated, `chrome.storage.local`-backed source of the user's self-hosted pv-server base URL, with a runtime-scoped `browser.permissions.request` grant (backed by `wxt.config.ts`'s `optional_host_permissions`) and a standing grep-based test that fails the moment any future file hard-codes a server origin instead of reading this module.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2 completed
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- `extension/entrypoints/background/server-config.ts` exports `normalizeServerUrl`, `probeServerHealth`, `configureServer`, `readServerConfig`, `wsUrlFromBase`, `InvalidServerUrlError`, `ServerUnreachableError`, and the `ServerConfig` interface — the sole place any later extension code (auth in 09-04, REST/WS sync in 09-05, "open full vault" `tabs.create` in 09-06) reads or writes the pv-server base URL
- Scheme allow-list (`http:`/`https:` only) enforced before any I/O, protecting the downstream `browser.tabs.create` call site (Plan 09-06/EXT-06) from `javascript:`/`file:`/`chrome-extension:`/`data:` injection
- `probeServerHealth` requires the exact `{"status":"ok"}` body from `crates/pv-server/src/routes/mod.rs`'s real `healthz` handler — not merely `response.ok` — rejecting captive portals, misdirected DNS, or unrelated servers that happen to answer HTTP 200
- `configureServer` requests exactly the single newly-configured origin via `browser.permissions.request({ origins: [baseUrl + "/*"] })`, never a standing `<all_urls>` grant, backed by `wxt.config.ts`'s new `optional_host_permissions: ['http://*/*', 'https://*/*']` declaration (verified present in the generated Chrome MV3 `manifest.json`)
- A standing invariant test (`no_other_extension_file_hard_codes_a_server_url`) walks the entire `extension/` tree (both `.ts` and `.tsx`) for quoted `http(s)://` literals, excluding this module and wildcard manifest match-patterns — it will fail the instant Plan 09-04/09-05/09-06 hard-codes a URL instead of importing this module
- 21/21 vitest tests pass, `tsc --noEmit` is clean, and both `wxt build -b chrome` and `wxt build -b firefox` succeed

## Task Commits

1. **Task 1: server-config.ts — normalize, validate, probe, persist** - `1d0eaba` (feat)
2. **Task 2: Runtime host-permission grant + hard-coded-URL invariant test** - `00f8f12` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `extension/entrypoints/background/server-config.ts` - normalizeServerUrl, probeServerHealth, configureServer, readServerConfig, wsUrlFromBase; the sole `chrome.storage.local`-backed base-URL module
- `extension/entrypoints/background/server-config.test.ts` - 21 tests: 6 plan-specified behaviors (split into 18 granular `it()` cases for clearer failure isolation) + the grep-based hard-coded-URL invariant test
- `extension/wxt.config.ts` - added `manifest.optional_host_permissions: ['http://*/*', 'https://*/*']`, alongside (not replacing) the existing `permissions`, `content_security_policy`, and `browser_specific_settings` fields Phase 8 already declared

## Decisions Made

- **Phase 8's `extension/entrypoints/background.ts` is a single file, not yet a directory.** This plan created `extension/entrypoints/background/server-config.ts` as a sibling directory alongside the existing `background.ts` file (different filesystem names — no conflict). WXT only registers `background/index.ts` as an entrypoint if one exists; since it does not yet, `background/server-config.ts` is correctly treated as a plain helper module, not a duplicate entrypoint. Confirmed via a clean `wxt build -b chrome`/`-b firefox` (no duplicate-entrypoint warnings). Plan 09-02 is expected to later convert `background.ts` into `background/index.ts` — this plan does not touch that file.
- **Direct `browser.*` calls over dependency injection.** Unlike `lib/crypto/vault-session.ts` (Phase 8's pattern, storage injected as a parameter), this module imports `browser` from `'wxt/browser'` directly and calls `browser.storage.local`/`browser.permissions.request` inline, per the acceptance criteria's literal requirement that the file contain the string `chrome.storage.local`/`browser.storage.local`. Tests mock the `'wxt/browser'` module itself (`vi.mock` with a `vi.hoisted()` Map-backed storage fake + a `vi.fn()` for `permissions.request`) rather than injecting a fake storage object.
- **Invariant-test grep excludes wildcard match-patterns.** The first invariant-test run failed on its own file: `wxt.config.ts`'s `optional_host_permissions: ['http://*/*', 'https://*/*']` matched the raw URL-literal regex. Refined the test to exclude any matched literal containing a `*` — a manifest match-pattern with a wildcard host can never resolve to a concrete server origin and is not the injection risk the test guards against.
- **`grep -n "storage.session"` literal check.** The plan's own `<verification>` checklist requires this exact grep against `server-config.ts` to return nothing. My first draft's explanatory comment ("chrome.storage.LOCAL — NOT chrome.storage.session") itself contained that substring and would have failed the check. Reworded the comment to describe the distinction without using the literal `storage.session` string together.
- **EXT-05 requirement left unmarked in REQUIREMENTS.md.** EXT-05's full text also requires "all REST + WebSocket traffic targets that URL" and "the self-hosted server allowlists the single fixed published extension origin via CORS" — neither is delivered by this plan. `09-01-PLAN.md` and `09-07-PLAN.md` both also declare `EXT-05` in their frontmatter; `09-07` is this phase's closing/verification plan, confirming EXT-05 completion is intended there, not here. Marking it complete now would be a false signal to the tracker.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Invariant test self-triggered on wxt.config.ts's manifest wildcard patterns**
- **Found during:** Task 2 (running the full test suite after adding `optional_host_permissions`)
- **Issue:** The grep-based `no_other_extension_file_hard_codes_a_server_url` test's URL-literal regex matched `'http://*/*'` and `'https://*/*'` in `wxt.config.ts` — these are WXT manifest match-patterns (wildcard host), not concrete server-origin literals, but the naive regex couldn't tell the difference.
- **Fix:** Captured the matched literal and excluded any match containing a `*` character from the offenders list.
- **Files modified:** `extension/entrypoints/background/server-config.test.ts`
- **Verification:** `npx vitest run` — 21/21 pass, invariant test green with `wxt.config.ts`'s wildcard permissions present.
- **Committed in:** `00f8f12` (Task 2 commit)

**2. [Rule 1 - Bug] server-config.ts's own comment failed the plan's literal grep check**
- **Found during:** Task 2 (running the plan's `<verification>` checklist commands before final commit)
- **Issue:** `grep -n "storage.session" extension/entrypoints/background/server-config.ts` is required to return nothing, but the module's explanatory comment ("chrome.storage.LOCAL — NOT chrome.storage.session") contained that exact substring.
- **Fix:** Reworded the comment to convey the same chrome.storage.local-vs-session-storage distinction without the literal joined substring.
- **Files modified:** `extension/entrypoints/background/server-config.ts`
- **Verification:** `grep -n "storage.session" extension/entrypoints/background/server-config.ts` now returns nothing (exit 1).
- **Committed in:** `00f8f12` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs in the test/verification tooling itself, not the shipped module's behavior)
**Impact on plan:** Both fixes were necessary for the plan's own stated verification commands to pass. No scope creep; no change to `server-config.ts`'s public behavior.

## Issues Encountered

- **Firefox MV2 manifest strips `optional_host_permissions` entirely** — confirmed by inspecting WXT's own `manifest.mjs` (`mv3OnlyKeys` includes `optional_host_permissions`, stripped for any non-MV3 build target). The generated `extension/.output/firefox-mv2/manifest.json` has no equivalent field at all. Firefox MV2's model would instead need a *concrete* host pattern inside `optional_permissions` (mixed with API permissions) rather than a separate MV3-only key — WXT does not auto-translate one to the other. This plan's own acceptance criteria and `<verification>` checklist only require the **Chrome** manifest to contain `optional_host_permissions` (confirmed present), so this is not a blocking gap for this plan, but it means `configureServer()`'s `browser.permissions.request({ origins: [...] })` call has no corresponding manifest pre-declaration on Firefox today. Flagging for Phase 13 (dual-browser-hardening), the roadmap phase explicitly scoped to close Chrome/Firefox parity gaps like this one — not silently patched here since verifying the correct Firefox-side fix needs a real Firefox `about:debugging` load, which is out of scope for this plan's automated verification.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `server-config.ts`'s five-function export surface is ready for Plan 09-04 (`auth-api.ts`), Plan 09-05 (`vault-api.ts`/`sync-client.ts`), and Plan 09-06 (popup "open full vault" `tabs.create`) to import directly — no re-derivation of the base URL needed anywhere else.
- The standing invariant test will catch any of those plans accidentally hard-coding a URL instead of using this module.
- **Known gap for Phase 13:** Firefox MV2's `optional_permissions`-based equivalent of Chrome's `optional_host_permissions` is not yet declared — `configureServer()`'s runtime permission request has no matching manifest pre-declaration on Firefox. Needs a real Firefox UAT pass in Phase 13 (dual-browser-hardening) to confirm the correct fix (likely moving the host match-patterns into a shared `optional_permissions` array).
- **EXT-05 is only partially satisfied** by this plan (client-side base-URL config + validation). REST/WS call sites (09-04/09-05) and the server-side CORS allowlist change still need to land before the requirement can be marked complete — expected at 09-07.

---
*Phase: 09-session-unlock-core-popup-sync-client*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: extension/entrypoints/background/server-config.ts
- FOUND: extension/entrypoints/background/server-config.test.ts
- FOUND: .planning/phases/09-session-unlock-core-popup-sync-client/09-03-SUMMARY.md
- FOUND commit: 1d0eaba
- FOUND commit: 00f8f12
