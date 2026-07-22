---
phase: 09-session-unlock-core-popup-sync-client
plan: 01
subsystem: crypto
tags: [wasm-bindgen, wasm, cors, tower-http, axum, zeroize, chrome-extension]

# Dependency graph
requires:
  - phase: 08-extension-bootstrap-wasm-in-background-spike
    provides: working WXT extension project (MV3 Chrome + MV2 Firefox) that instantiates pv-wasm in the background service worker
provides:
  - "pv-wasm exportUserKeyForSession/importUserKeyFromSession — sanctioned export/import pair letting a WasmUserKey's raw bytes survive a service-worker idle-kill via chrome.storage.session"
  - "pv-server PV_EXTENSION_ORIGINS-driven CORS allowlist, additive to the existing PV_DEV_CORS dev toggle"
affects: [09-02, 09-03, 09-04, 09-05, 09-06, 09-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "build_cors_layer(dev_cors_enabled, extension_origins_csv) pure/env-free core split out from cors_layer() env-reading wrapper, for unit-testable HTTP-level CORS assertions without mutating process-global env vars"
    - "wasm-bindgen export/import pair with explicit zeroize-regardless-of-outcome discipline for the one sanctioned raw-key-bytes exception (mirrors from_password/from_prf)"

key-files:
  created: []
  modified:
    - crates/pv-wasm/src/lib.rs
    - crates/pv-server/src/routes/mod.rs

key-decisions:
  - "Documented the exportUserKeyForSession/importUserKeyFromSession exception both at the module-level doc comment (updated to no longer claim randomSalt is the only exception) and inline at the export function itself, per CLAUDE.md's 'explain why at the point of risk' convention"
  - "CORS test suite added inline in crates/pv-server/src/routes/mod.rs (this file had no prior test module) using real tower::ServiceExt::oneshot HTTP request/response round-trips against the actual tower-http CorsLayer, not just string-parsing assertions"

patterns-established:
  - "Env-reading wrapper + pure testable core split (cors_layer() / build_cors_layer()) for any future server-side config surface that needs both env-var convenience and deterministic unit tests"

requirements-completed: [EXT-02, EXT-04, EXT-05]

coverage:
  - id: D1
    description: "pv-wasm exposes exportUserKeyForSession/importUserKeyFromSession, a sanctioned round-trip pair for a WasmUserKey's raw bytes, with zeroize-on-import discipline"
    requirement: "EXT-02"
    verification:
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#tests::export_import_user_key_roundtrip"
        status: pass
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#tests::import_user_key_from_session_rejects_wrong_length"
        status: pass
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#tests::import_user_key_from_session_zeroizes_input_on_success"
        status: pass
    human_judgment: false
  - id: D2
    description: "pv-server accepts real HTTP requests from an allowlisted chrome-extension://<id>/moz-extension://<id> origin via PV_EXTENSION_ORIGINS, additive to and non-interfering with the existing PV_DEV_CORS toggle, failing closed on empty/malformed config"
    requirement: "EXT-04"
    verification:
      - kind: unit
        ref: "crates/pv-server/src/routes/mod.rs#tests::allowlisted_extension_origin_receives_matching_acao_header"
        status: pass
      - kind: unit
        ref: "crates/pv-server/src/routes/mod.rs#tests::non_allowlisted_origin_gets_no_acao_header"
        status: pass
      - kind: unit
        ref: "crates/pv-server/src/routes/mod.rs#tests::empty_allowlist_matches_todays_no_cors_layer_behavior"
        status: pass
      - kind: unit
        ref: "crates/pv-server/src/routes/mod.rs#tests::dev_cors_flag_stays_permissive_regardless_of_allowlist"
        status: pass
    human_judgment: false
  - id: D3
    description: "Real, loaded chrome-extension://<id> making a live fetch() against a running pv-server with PV_EXTENSION_ORIGINS set — deferred manual proof, once a real packaged extension exists (09-05-PLAN.md's human-check)"
    requirement: "EXT-05"
    verification: []
    human_judgment: true
    rationale: "No real extension ID/build exists yet at this wave — this plan only proves the CORS middleware logic via synthetic HTTP requests. The end-to-end browser proof is explicitly deferred to 09-05-PLAN.md per this plan's own <action> text."

# Metrics
duration: 8min
completed: 2026-07-15
status: complete
---

# Phase 9 Plan 1: Session Unlock Core — pv-wasm/pv-server Foundations Summary

**Sanctioned pv-wasm session-export/import pair for WasmUserKey bytes plus a real PV_EXTENSION_ORIGINS CORS allowlist on pv-server, both additive to existing invariants and proven by 7 new inline tests (108 total passing workspace-wide).**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-15T07:45:07Z
- **Completed:** 2026-07-15T07:53:58Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `crates/pv-wasm/src/lib.rs` gained `exportUserKeyForSession`/`importUserKeyFromSession`, the sole documented, extension-only exception to "raw key bytes never cross the WASM boundary" beyond the pre-existing `randomSalt` case — import zeroizes its input buffer regardless of success/failure, mirroring `from_password`/`from_prf`.
- Regenerated the shared WASM artifact via `scripts/build-wasm.sh` (the single, un-forked build path); confirmed both new exports present in the regenerated `web/src/lib/crypto/wasm/pv_wasm.d.ts` (gitignored, not committed).
- `crates/pv-server/src/routes/mod.rs` gained a real `PV_EXTENSION_ORIGINS`-driven CORS allowlist (`build_cors_layer`), additive to and non-destructive of the existing `PV_DEV_CORS` dev toggle — malformed/empty allowlist entries fail closed to today's existing no-CORS behavior, never widen to permissive.
- Added the file's first `#[cfg(test)] mod tests` block, proving the CORS logic via real `tower::ServiceExt::oneshot` HTTP request/response round-trips against the actual `tower-http` middleware (not just string-parsing).

## Task Commits

Each task was committed atomically:

1. **Task 1: Add pv-wasm session-export pair and rebuild the shared WASM artifact** - `868ba44` (feat)
2. **Task 2: Add pv-server CORS allowlist for the extension's origin** - `a5ff669` (feat)

**Plan metadata:** pending final `docs(09-01):` commit (see below)

## Files Created/Modified
- `crates/pv-wasm/src/lib.rs` - Added `export_user_key_for_session`/`import_user_key_from_session` wasm-bindgen exports, 3 new tests, and updated the module-level doc comment to reflect the new sanctioned exception.
- `crates/pv-server/src/routes/mod.rs` - Split `cors_layer()` into env-reading wrapper + pure `build_cors_layer()` core, added `PV_EXTENSION_ORIGINS` parsing via `AllowOrigin::list`, and 4 new inline HTTP-level CORS tests.
- (Gitignored, regenerated, not committed) `web/src/lib/crypto/wasm/pv_wasm.js`, `web/src/lib/crypto/wasm/pv_wasm.d.ts`, `web/public/wasm/pv_wasm_bg.wasm`, `extension/lib/crypto/wasm/pv_wasm.js`, `extension/public/wasm/pv_wasm_bg.wasm` - regenerated shared WASM artifact from the updated `pv-wasm` source via `scripts/build-wasm.sh`.

## Decisions Made
- Updated the top-of-file module doc comment in `crates/pv-wasm/src/lib.rs` (which previously stated `randomSalt` was the *only* exception to "raw key bytes never cross the boundary") to acknowledge the new sanctioned exception, keeping the file's own documented invariant accurate — this is a documentation-accuracy fix (Rule 1), not a new deviation in behavior.
- Followed the plan's exact function signatures, doc-comment text, and CORS test names verbatim — no naming or structural changes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/Docs accuracy] Updated stale module-level doc comment in pv-wasm/src/lib.rs**
- **Found during:** Task 1 (pv-wasm session-export pair)
- **Issue:** The file's top `//!` doc comment asserted `randomSalt` was the *only* exception to "raw key bytes never cross the WASM boundary as Vec<u8>/&[u8]". Adding `exportUserKeyForSession`/`importUserKeyFromSession` (a second, deliberate exception) would leave that top-level invariant statement factually wrong if left unchanged.
- **Fix:** Extended the top-of-file comment to note the second sanctioned exception (with a pointer to the D-02 rationale at the export function itself), while keeping the plan's exact per-function doc comments unchanged.
- **Files modified:** crates/pv-wasm/src/lib.rs
- **Verification:** `cargo test -p pv-wasm` — 11/11 pass; visual review of updated comment text
- **Committed in:** 868ba44 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 doc-accuracy fix, Rule 1)
**Impact on plan:** No behavioral change; purely keeps an existing safety-invariant doc comment truthful given the plan's own new exception. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. `PV_EXTENSION_ORIGINS` is an optional, opt-in env var; unset behavior is byte-identical to before this plan (empty allowlist -> `CorsLayer::new()`, same as today).

## Next Phase Readiness
- `exportUserKeyForSession`/`importUserKeyFromSession` are compiled into the shared `pv-wasm` artifact and ready for Phase 9's Wave 2+ extension background script (`vault-session.ts`, not yet created) to consume for `chrome.storage.session` persistence across service-worker idle-kills.
- `PV_EXTENSION_ORIGINS` is ready for Phase 9's extension plans to set once a real extension ID exists; the CORS middleware logic itself is fully proven at the HTTP level. The final "real loaded extension" browser-level proof is explicitly deferred to 09-05-PLAN.md's human-check per this plan's own text (see coverage D3).
- No blockers. Both deliverables are pure Rust/server changes with zero extension-side dependency, exactly as scoped for Wave 1.

---
*Phase: 09-session-unlock-core-popup-sync-client*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: commit 868ba44
- FOUND: commit a5ff669
- FOUND: crates/pv-wasm/src/lib.rs
- FOUND: crates/pv-server/src/routes/mod.rs
- FOUND: .planning/phases/09-session-unlock-core-popup-sync-client/09-01-SUMMARY.md
