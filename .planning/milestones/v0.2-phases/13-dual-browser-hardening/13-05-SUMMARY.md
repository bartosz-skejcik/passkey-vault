---
phase: 13-dual-browser-hardening
plan: 05
subsystem: pv-server CORS / extension popup config
tags: [cors, webauthn-extension, firefox, tech-debt, d-10, d-11]
status: complete
dependency-graph:
  requires: [XBR-01, EXT-05 (Phase 9)]
  provides: [moz-extension-cors-wildcard, cors-blocked-ux]
  affects: [crates/pv-server/src/routes/mod.rs, extension/entrypoints/popup/ServerConfigView.tsx]
tech-stack:
  added: []
  patterns: ["AllowOrigin::predicate scheme-scoped wildcard", "no-cors retry to disambiguate CORS-blocked vs unreachable"]
key-files:
  created: []
  modified:
    - crates/pv-server/src/routes/mod.rs
    - crates/pv-server/src/config.rs
    - extension/entrypoints/popup/ServerConfigView.tsx
    - extension/entrypoints/popup/ServerConfigView.test.tsx
    - extension/entrypoints/background/server-config.ts
    - extension/entrypoints/background/server-config.test.ts
    - extension/entrypoints/background/router.ts
    - extension/lib/messaging/ext-protocol.ts
    - extension/lib/i18n/dictionary.ts
    - .env.example
    - docs/SELF-HOSTING.md
    - .planning/STATE.md
decisions:
  - "D-10: pv-server accepts the literal moz-extension://* as a scheme-scoped wildcard PATTERN via AllowOrigin::predicate, never by loosening the bare-* WR-07 rejection; logged at warn level as active tech-debt each time it's used"
  - "D-11: ServerConfigView distinguishes cors-blocked from unreachable via a no-cors retry (opaque response = server reachable, CORS just rejected it), rendering a distinct message naming PV_EXTENSION_ORIGINS with the extension's own origin as copyable select-all text"
metrics:
  duration: ~35min
  completed: 2026-07-17
---

# Phase 13 Plan 05: moz-extension CORS wildcard + CORS-blocked UX Summary

pv-server now accepts `moz-extension://*` as a deliberate, scheme-scoped CORS wildcard pattern for Firefox's per-install UUID origin (D-10), and the extension's `ServerConfigView` distinguishes a CORS-blocked-but-reachable server from a genuinely unreachable one, showing the extension's own copyable origin plus a `PV_EXTENSION_ORIGINS` pointer (D-11) — closing the moz-extension half of Phase 9's EXT-05 / this phase's XBR-01.

## What Was Built

### Task 1 — pv-server scheme-scoped wildcard (D-10)

`parse_extension_origins` (routes/mod.rs) now returns a `ParsedExtensionOrigins { concrete: Vec<HeaderValue>, allow_moz_wildcard: bool }` struct instead of a flat `Vec<HeaderValue>`. Per-entry parsing:

1. `raw == "*"` — unchanged bail (WR-07's existing message, still names `PV_DEV_CORS`).
2. `raw == "moz-extension://*"` — new: sets `allow_moz_wildcard = true`, kept OUT of `concrete`.
3. Any OTHER entry containing `*` (`chrome-extension://*`, `https://*`, `moz-extension://*/*`, etc.) — new fatal case, naming the offending value.
4. Everything else — unchanged concrete `HeaderValue` parse.

`build_cors_layer` builds a real `AllowOrigin::predicate` closure (tower-http 0.6.11's exact signature, confirmed against the vendored source at `~/.cargo/registry/.../tower-http-0.6.11/src/cors/allow_origin.rs`) when `allow_moz_wildcard` is true: it accepts an origin if it exactly matches one of the `concrete` entries OR passes a new `is_well_formed_moz_extension_origin()` gate — a strict 36-byte UUID-shape check (hyphens at positions 8/13/18/23, hex everywhere else) after stripping the `moz-extension://` prefix. This branch logs at `tracing::warn!` naming the wildcard as active tech-debt, pointing at STATE.md's Deferred Items row.

`Config::validate()` needed no logic change (still just `?`, discards the `Ok` value) — the return-type change is transparent there.

7 new tests added (routes/mod.rs `mod tests` + config.rs `mod tests`), covering: the parse succeeding with the flag set, an arbitrary well-formed UUID origin getting the ACAO echo, a malformed UUID and an unrelated origin both getting denied, every other wildcard shape (`chrome-extension://*`, `https://*`, `moz-extension://*/*`) still failing loudly, the bare `*` regression guard, mixed concrete+wildcard coexistence, and `Config::validate()` accepting the new literal while still rejecting bare `*`/`chrome-extension://*`. One pre-existing test (`parse_extension_origins_accepts_an_unset_value_and_a_valid_whitespaced_list`) needed a mechanical `.concrete.len()` adjustment for the new return shape — no behavior change.

`cargo test -p pv-server` — all 33 unit tests (18 routes + 15 config) plus the full 68-test integration suite pass; every pre-existing WR-07 test passes unmodified.

### Task 2 — ServerConfigView CORS-blocked vs unreachable (D-11)

Added `probeServerHealthDetailed(baseUrl): Promise<"ok" | "cors-blocked" | "unreachable">` in server-config.ts alongside the existing boolean `probeServerHealth` (kept untouched for any other caller). The disambiguation: if the plain `fetch` throws, retry with `{ mode: "no-cors" }` — a CORS-blocked-but-reachable server still completes the TCP/TLS handshake and returns an opaque `Response` (`type === "opaque"`), while a genuinely unreachable server fails the retry too.

`configureServer` now throws a new `ServerCorsBlockedError` (distinct from `ServerUnreachableError`) when the detailed probe resolves `"cors-blocked"`. Threaded through:
- `ext-protocol.ts`: `MessageResponseMap["config.set"]`'s error union widened to include `"cors-blocked"`.
- `router.ts`'s `handleConfigSet`: new catch arm for `ServerCorsBlockedError`, checked BEFORE the generic `ServerUnreachableError` arm (more specific case first).
- `ServerConfigView.tsx`: `error` state widened to include `"cors-blocked"`; renders a distinct alert block with the new `config.corsBlocked` / `config.corsBlockedOriginLabel` copy (PL+EN, dictionary.ts) plus the extension's own origin as `select-all` copyable text.

**Deviation from the plan's literal suggestion:** the plan's implementation hint suggested `new URL(browser.runtime.getURL("")).origin` to compute the extension's own origin. I discovered mid-implementation (jsdom test rendered the literal string `"null"`) that `chrome-extension://`/`moz-extension://` are non-special WHATWG URL schemes, so `.origin` degrades to the opaque-origin serialization `"null"` outside a real browser's own parser — exactly the runtime-vs-test divergence trap `frame-guard.ts`'s `assertPopupSender()` already documents and works around with a string-slice (`ownBase.endsWith("/") ? ownBase.slice(0, -1) : ownBase`). Added a small `ownExtensionOrigin()` helper in ServerConfigView.tsx reusing that exact proven pattern instead of `new URL(...).origin`, with a comment cross-referencing frame-guard.ts's precedent. This is a Rule 1 auto-fix (the plan's suggested implementation would have been visibly broken — literally showing "null" — the instant a real Firefox/Chrome origin was rendered).

6 new/updated tests: `probeServerHealthDetailed`'s 4 branches (ok / cors-blocked / unreachable-both-fail / unreachable-non-opaque-retry) in server-config.test.ts, `configureServer`'s cors-blocked rejection path, and `ServerConfigView.test.tsx`'s new case asserting the distinct copy + copyable origin (and that it is NOT the generic unreachable message). The existing `wxt/browser` mock in ServerConfigView.test.tsx gained a `runtime.getURL` stub returning a `chrome-extension://test-extension-id/` shape.

`npx vitest run entrypoints/popup/ServerConfigView.test.tsx entrypoints/background/server-config.test.ts` — 30/30 pass. Full extension suite (`npm test`) — 521/521 pass. `npm run compile` (tsc --noEmit) — clean.

### Task 3 — Documentation + tech-debt registration

- `.env.example`: new `PV_EXTENSION_ORIGINS` block documenting the CORS allowlist, the `moz-extension://*` stopgap, and that bare `*` is always rejected.
- `docs/SELF-HOSTING.md`: new table row + a full new section ("`PV_EXTENSION_ORIGINS` — CORS dla rozszerzenia przeglądarki") covering Chrome's stable published-ID origin vs Firefox's per-profile UUID churn, the exact `moz-extension://*` env line, the D-10 tech-debt framing (CORS is not the auth boundary; every state-changing route still requires a bearer token; planned replacement with per-install concrete-origin config), and a new troubleshooting-table row for the Firefox "CORS Missing Allow Origin" symptom.
- `.planning/STATE.md`: new Deferred Items row, category `tech-debt`, tracking the wildcard stopgap for later replacement.

`grep -q "PV_EXTENSION_ORIGINS" .env.example && grep -q "PV_EXTENSION_ORIGINS" docs/SELF-HOSTING.md && grep -q "moz-extension" docs/SELF-HOSTING.md && grep -qi "moz-extension" .planning/STATE.md` — all pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `new URL(...).origin` would have rendered the literal string "null" for extension origins**
- **Found during:** Task 2, while writing the ServerConfigView test for the cors-blocked copyable origin.
- **Issue:** The plan's implementation hint (`new URL(browser.runtime.getURL("")).origin`) is broken for `chrome-extension://`/`moz-extension://` URLs — these are non-special WHATWG schemes, so `URL#origin` returns the opaque-origin serialization `"null"` rather than the scheme+host. Caught by the jsdom test literally rendering `<code>null</code>` instead of the mocked extension origin.
- **Fix:** Replaced with a small `ownExtensionOrigin()` helper reusing `frame-guard.ts`'s already-proven string-slice pattern (`browser.runtime.getURL("")` with a trailing-slash strip), which that file's own header comment already documents as the workaround for this exact WHATWG-vs-browser divergence.
- **Files modified:** `extension/entrypoints/popup/ServerConfigView.tsx`
- **Commit:** fd8d945

### Auth Gates

None — this plan required no login/credential flow.

## Live Firefox Verification

Not performed in this plan's execution. Per explicit orchestrator instruction, the running `pv-server` dev instance (`PV_EXTENSION_ORIGINS=chrome-extension://bbpnpamaoddpkfjnohkkepbjgbjpdbfo`, no `moz-extension://*` entry yet) was left untouched — the orchestrator restarts it with the new config for its own Firefox walk after this plan lands. The `moz-extension://*` predicate mechanism and the `cors-blocked` popup UX are validated here by unit/integration test only (18 Rust CORS tests + 6 extension tests specifically exercising these code paths); the empirical real-Firefox round-trip against a live server is the orchestrator's subsequent step, not part of this plan's own verification.

## Known Stubs

None — no stub data or placeholder UI introduced.

## Threat Flags

None beyond what the plan's own `<threat_model>` already registers (T-13-11 through T-13-15, all addressed by the implementation above — the strict UUID-shape gate, the unforgeable-Origin-header spoofing analysis, the CORS-is-not-auth documentation, the unchanged WR-07 fatal cases, and the non-secret nature of the surfaced extension origin).

## Self-Check: PASSED

- `crates/pv-server/src/routes/mod.rs` — FOUND (modified, contains `ParsedExtensionOrigins`, `is_well_formed_moz_extension_origin`)
- `crates/pv-server/src/config.rs` — FOUND (modified, new D-10 tests present)
- `extension/entrypoints/popup/ServerConfigView.tsx` — FOUND (modified, `ownExtensionOrigin()` present)
- `extension/entrypoints/background/server-config.ts` — FOUND (modified, `probeServerHealthDetailed`/`ServerCorsBlockedError` present)
- `.env.example` — FOUND (modified via git plumbing, `PV_EXTENSION_ORIGINS` present — verified via `git show :.env.example`)
- `docs/SELF-HOSTING.md` — FOUND (modified, new section + troubleshooting row present)
- `.planning/STATE.md` — FOUND (modified, new Deferred Items row present)
- Commit dd3bee5 (Task 1) — FOUND in `git log --oneline`
- Commit fd8d945 (Task 2) — FOUND in `git log --oneline`
- Commit e2d3509 (Task 3) — FOUND in `git log --oneline`
