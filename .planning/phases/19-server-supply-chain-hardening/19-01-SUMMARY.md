---
phase: 19-server-supply-chain-hardening
plan: 01
subsystem: api
tags: [axum, tower-http, cors, webauthn-rs, reqwest, firefox]

# Dependency graph
requires:
  - phase: 13-dual-browser-hardening
    provides: the D-10 moz-extension://* scheme-scoped wildcard CORS carve-out this plan removes
provides:
  - "build_cors_layer() with an explicit [authorization, content-type] Access-Control-Allow-Headers list (never Any/*)"
  - "parse_extension_origins()/ParsedExtensionOrigins with the moz-extension://* wildcard branch removed — concrete origins only"
  - "pub router_with_cors(state, static_dir, cors: CorsLayer) — router() now a thin wrapper over it"
  - "test_app_with_cors()/serve_router() test helpers in crates/pv-server/tests/common/mod.rs"
  - "crates/pv-server/tests/cors_preflight.rs — real-socket OPTIONS preflight proof (SEC-01)"
affects: [phase-20-test-infrastructure-ci-gate, self-hosting-docs, e2e-firefox-lanes]

# Tech tracking
tech-stack:
  added: ["reqwest 0.13.4 (dev-dependency only, pv-server)"]
  patterns:
    - "router() split into router_with_cors(state, static_dir, cors) so integration tests can inject a CorsLayer built directly from build_cors_layer() instead of mutating process env vars"
    - "test_app_with_cors()/serve_router() test-helper precedent alongside test_app_with_static_dir()"

key-files:
  created:
    - crates/pv-server/tests/cors_preflight.rs
  modified:
    - crates/pv-server/src/routes/mod.rs
    - crates/pv-server/src/config.rs
    - crates/pv-server/tests/common/mod.rs
    - crates/pv-server/Cargo.toml
    - extension/e2e-firefox/README.md
    - extension/e2e-firefox/run-core.cjs
    - extension/e2e-firefox/probe-window-geometry.cjs
    - docs/SELF-HOSTING.md

key-decisions:
  - "router() refactored into a thin wrapper over a new pub router_with_cors(state, static_dir, cors: CorsLayer) rather than reading PV_EXTENSION_ORIGINS/PV_DEV_CORS env vars a second way in tests — avoids flaky parallel-cargo-test env mutation while reusing the exact same route/state wiring as production"
  - "config.rs's extension_origins_moz_wildcard_validates_ok test rewritten to extension_origins_moz_wildcard_now_rejected (asserts Err) — same shared parser as routes/mod.rs, so Task 1's behavior change applies there too even though config.rs wasn't in the plan's files_modified list"
  - "docs/SELF-HOSTING.md's Firefox CORS section and troubleshooting row updated to stop documenting moz-extension://* as an accepted mechanism — out of the plan's file list but directly required by the must_haves prohibition (no wildcard documented as supported anywhere)"

requirements-completed: [SEC-01, SEC-02]

coverage:
  - id: D1
    description: "moz-extension://* wildcard removed from ParsedExtensionOrigins/parse_extension_origins/build_cors_layer; only concrete origins accepted; WR-07 bare-* rejection unchanged"
    requirement: SEC-02
    verification:
      - kind: unit
        ref: "crates/pv-server/src/routes/mod.rs routes::tests (16 tests, incl. parse_extension_origins_moz_wildcard_fails_with_the_same_error_shape_as_chrome_wildcard, build_cors_layer_accepts_a_concrete_moz_extension_uuid_origin)"
        status: pass
      - kind: unit
        ref: "crates/pv-server/src/config.rs config::tests (15 tests, incl. extension_origins_moz_wildcard_now_rejected)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Access-Control-Allow-Headers explicitly lists authorization+content-type (never *), proven against a real bound TCP server with two header-casing/order variants"
    requirement: SEC-01
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/cors_preflight.rs (2 #[tokio::test] functions, real TcpListener + reqwest OPTIONS)"
        status: pass
    human_judgment: false
  - id: D3
    description: "All four e2e-firefox lanes' operator docs updated with concrete UUIDs instead of the removed wildcard"
    requirement: SEC-02
    verification:
      - kind: other
        ref: "grep -c 'moz-extension://\\*' extension/e2e-firefox/README.md run-core.cjs probe-window-geometry.cjs == 0 each"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-07-21
status: complete
---

# Phase 19 Plan 01: Server & Supply-Chain Hardening — CORS Explicit Headers + Concrete Origins Summary

**Removed the D-10 `moz-extension://*` scheme-scoped CORS wildcard and replaced `Access-Control-Allow-Headers: *` with an explicit `[authorization, content-type]` list, proven against a genuinely bound TCP server.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-21
- **Tasks:** 3/3
- **Files modified:** 8 (1 created: `crates/pv-server/tests/cors_preflight.rs`)

## Accomplishments
- SEC-02: `moz-extension://*` no longer accepted anywhere in the CORS layer — `ParsedExtensionOrigins` has exactly one field (`concrete`), `is_well_formed_moz_extension_origin()` deleted, `build_cors_layer` collapsed to two branches (empty/non-empty). A concrete `moz-extension://<uuid>` origin still works unchanged via `AllowOrigin::list`.
- SEC-01: `Access-Control-Allow-Headers` is now an explicit `[AUTHORIZATION, CONTENT_TYPE]` list, never `Any`/`*`. New `crates/pv-server/tests/cors_preflight.rs` proves this against a real `TcpListener` + `reqwest::Client` OPTIONS round-trip (both header-casing/order variants a real browser preflight can send).
- All four e2e-firefox lanes' operator docs (README.md, run-core.cjs, probe-window-geometry.cjs) updated from the wildcard to the 4 concrete pinned UUIDs, plus `docs/SELF-HOSTING.md`'s Firefox CORS section and troubleshooting row.
- `cargo test --workspace` stays fully green (151+ tests across pv-core/pv-provider/pv-server/pv-wasm) — no regression from the CORS refactor.

## Task Commits

Each task was committed atomically:

1. **Task 1: SEC-02 — remove the moz-extension://* wildcard, concrete origins only** - `b109659` (feat)
2. **Task 2: SEC-01 — explicit Access-Control-Allow-Headers + real-server preflight proof** - `0980ffa` (feat)
3. **Task 3: SEC-02 Firefox lane fallout — concrete-origin operator docs** - `1ff7edb` (docs)

_No separate plan-metadata commit — this SUMMARY is written directly to disk per the orchestrator's instruction not to touch STATE.md/ROADMAP.md in this plan._

## Files Created/Modified
- `crates/pv-server/src/routes/mod.rs` - Removed the moz-extension wildcard mechanism; explicit Allow-Headers list; `router()` split into a thin wrapper over new `pub router_with_cors()`; rewrote the D-10 test section
- `crates/pv-server/src/config.rs` - Rewrote `extension_origins_moz_wildcard_validates_ok` → `extension_origins_moz_wildcard_now_rejected` (shared parser, same behavior change)
- `crates/pv-server/tests/common/mod.rs` - Added `test_app_with_cors()` and `serve_router()` helpers; `test_server()` now delegates to `serve_router()`
- `crates/pv-server/tests/cors_preflight.rs` - New: real-socket OPTIONS preflight proof (2 tests)
- `crates/pv-server/Cargo.toml` / `Cargo.lock` - `reqwest = "0.13.4"` added under `[dev-dependencies]` via `cargo add --dev`
- `extension/e2e-firefox/README.md` - Prerequisites step 2 now lists all 4 concrete lane UUIDs
- `extension/e2e-firefox/run-core.cjs` - Header comment + P9-SC6 log message updated
- `extension/e2e-firefox/probe-window-geometry.cjs` - Header comment updated
- `docs/SELF-HOSTING.md` - Firefox CORS section rewritten (wildcard no longer documented as accepted); troubleshooting table row updated

## Decisions Made
- `router()` refactored into `router_with_cors(state, static_dir, cors: CorsLayer)` + a thin env-reading wrapper, rather than duplicating route wiring in tests or mutating process env vars under parallel `cargo test` — mirrors the plan's Open Question 2 resolution.
- `config.rs`'s D-10 test fixed alongside Task 1 (same shared `parse_extension_origins`, same behavior change) even though `config.rs` wasn't in the plan's Task 1 `<files>` list — Rule 1 (the test would otherwise assert now-false behavior).
- `docs/SELF-HOSTING.md` updated even though absent from the plan's `files_modified` frontmatter — the plan's `must_haves.prohibitions` explicitly forbids documenting `moz-extension://*` as supported anywhere, and this doc still described it as an accepted D-10 carve-out.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] config.rs's `extension_origins_moz_wildcard_validates_ok` test asserted now-false behavior**
- **Found during:** Task 1 (SEC-02 wildcard removal)
- **Issue:** `Config::validate()` calls the same shared `parse_extension_origins()` Task 1 changed; the pre-existing D-10 test asserted `moz-extension://*` validates OK, which is no longer true.
- **Fix:** Renamed to `extension_origins_moz_wildcard_now_rejected`, asserting `Err` with a message naming `PV_EXTENSION_ORIGINS`.
- **Files modified:** `crates/pv-server/src/config.rs`
- **Verification:** `cargo test -p pv-server config::tests` — 15/15 pass.
- **Committed in:** `b109659` (Task 1 commit)

**2. [Rule 2 - Missing Critical] docs/SELF-HOSTING.md still documented the removed wildcard as an accepted mechanism**
- **Found during:** Task 3 (Firefox lane fallout audit)
- **Issue:** The self-hosting operator guide's Firefox CORS section explained `moz-extension://*` as a deliberate, currently-accepted D-10 tech-debt carve-out, and its troubleshooting table suggested adding it — both now factually wrong and in direct tension with the plan's `must_haves.prohibitions` (no wildcard documented as supported anywhere).
- **Fix:** Rewrote the Firefox CORS section to explain the concrete-origin-only requirement and that SEC-02 removed the wildcard; updated the troubleshooting row's suggested fix to the concrete UUID.
- **Files modified:** `docs/SELF-HOSTING.md`
- **Verification:** `grep -c 'moz-extension://\*' docs/SELF-HOSTING.md` — 1 remaining hit is explanatory prose stating the mechanism was removed, not documenting it as supported.
- **Committed in:** `1ff7edb` (Task 3 commit)

**3. [Rule 1 - Bug] Task 1's own new test initially failed a self-imposed assertion**
- **Found during:** Task 1 verification run
- **Issue:** The new `parse_extension_origins_moz_wildcard_fails_with_the_same_error_shape_as_chrome_wildcard` test asserted the error message contains no "scheme-scoped" language — but the rewritten `bail!` message I wrote for the generic-wildcard branch itself used the word "scheme-scoped", making the test fail against my own new code.
- **Fix:** Reworded the `bail!` message to drop "scheme-scoped" while keeping it equally informative.
- **Files modified:** `crates/pv-server/src/routes/mod.rs`
- **Verification:** `cargo test -p pv-server routes::tests` — 16/16 pass after the fix.
- **Committed in:** `b109659` (Task 1 commit — fixed before commit, not a separate follow-up)

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bug fixes, 1 Rule 2 missing-critical doc fix)
**Impact on plan:** All three are direct, in-scope consequences of Task 1's behavior change or the plan's own explicit prohibition. No scope creep — no other files touched.

## Issues Encountered
- The top-level `<verification>` section's item 3 (`grep -c 'moz-extension://\*' ... crates/pv-server/src/routes/mod.rs ... returns 0`) is not literally satisfiable alongside Task 1's own `<action>` text, which explicitly requires several test/doc-comment occurrences of the literal string `"moz-extension://*"` to prove it is now *rejected* (e.g. `assert!(parse_extension_origins("moz-extension://*").is_err())`). Resolved by treating the more specific Task-level acceptance criteria (`grep -c 'allow_moz_wildcard\|is_well_formed_moz_extension_origin'` == 0, no runtime-accepting logic remains) as authoritative for `mod.rs`, and the literal-string-== 0 grep as scoped to the three e2e-firefox operator-doc files (where it does hold, confirmed). The `must_haves.prohibitions` intent — no wildcard documented/accepted as *supported* — is fully satisfied; the surviving `mod.rs` occurrences are all in rejection-context (comments explaining the removal, or test assertions proving `Err`).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- SEC-01/SEC-02 both closed; `cargo test --workspace` green (151+ tests).
- `.planning/STATE.md`'s D-10 Deferred Items row is intentionally left unmodified by this plan (per this plan's execution instructions) — the orchestrator applies that resolution note post-merge.
- No blockers for Phase 19's remaining plans (SEC-03/SEC-04, cargo audit/deny + toolchain pin, sign-count clone-detection) or Phase 20 (Test Infrastructure & CI Gate).

---
*Phase: 19-server-supply-chain-hardening*
*Completed: 2026-07-21*

## Self-Check: PASSED

All created/modified files and all 3 task commit hashes (b109659, 0980ffa, 1ff7edb) verified present on disk and in git log.
