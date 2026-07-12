---
phase: 01-wasm-crypto-bridge-web-app-shell
plan: 01
subsystem: crypto
tags: [wasm-bindgen, wasm32, rust, zeroize, argon2, xchacha20poly1305, hkdf]

# Dependency graph
requires: []
provides:
  - "pv-wasm crate: opaque-handle wasm-bindgen bridge over pv-core (WasmWrappingKey, WasmUserKey + 7 exported functions)"
  - "pv_core::keys::random_bytes(len) — public, non-secret randomness helper"
  - "scripts/build-wasm.sh — reproducible, version-pinned WASM build producing web/src/lib/crypto/wasm/ (JS/TS glue) + web/public/wasm/ (binary)"
affects: ["01-02", "01-03"]

# Tech tracking
tech-stack:
  added: ["wasm-bindgen =0.2.126", "wasm-bindgen-cli 0.2.126 (dev tool)", "getrandom 0.2 (js feature, wasm32-only)"]
  patterns:
    - "Opaque #[wasm_bindgen] struct handles for key material — no exported function returns raw key bytes except non-secret randomSalt"
    - "CryptoError -> JsValue conversion only at the FFI boundary (to_js_err/to_js_str_err), never inside pv-core"
    - "cfg(target_arch = \"wasm32\") split for JsValue-constructing error paths so cargo test runs natively without touching the (panicking) wasm-bindgen JS-host stub"
    - "Build script single-sources the wasm-bindgen version from crates/pv-wasm/Cargo.toml — no duplicate version literal anywhere else"

key-files:
  created:
    - crates/pv-wasm/Cargo.toml
    - crates/pv-wasm/src/lib.rs
    - scripts/build-wasm.sh
  modified:
    - Cargo.toml (workspace members)
    - crates/pv-core/src/keys.rs (random_bytes helper)
    - .gitignore (WASM build output dirs)

key-decisions:
  - "JsValue-constructing error conversions are cfg-split wasm32 vs native, because wasm-bindgen's native JsValue stub panics ('function not implemented on non-wasm32 targets') the instant an Err path is exercised under cargo test — contradicting the plan's assumption that #[wasm_bindgen] functions run unmodified as plain Rust natively. Native builds return JsValue::NULL on Err (Result variant preserved, message irrelevant off-target); wasm32 keeps the real .to_string() message."
  - "getrandom duplicate-major audit in build-wasm.sh greps only root 'getrandom vX.Y.Z' lines (column 0) from cargo tree -i output, not every 'vX.Y' substring in the whole reverse-dependency tree — the naive pattern was flagging unrelated crates (sha2, hkdf, cipher, poly1305, ...) as phantom duplicate getrandom majors."
  - "build-wasm.sh exports $HOME/.cargo/bin onto PATH defensively before invoking wasm-bindgen, since cargo install's target directory isn't guaranteed to be on PATH in every shell (observed: rustup-managed cargo in this environment did not have it)."

patterns-established:
  - "New WASM-bound crates: mirror pv-core/Cargo.toml's version.workspace/edition.workspace/license.workspace shape, crate-type = [\"cdylib\", \"rlib\"], wasm-bindgen exact-pinned, target-arch-gated getrandom dependency"

requirements-completed: [UI-01]

coverage:
  - id: D1
    description: "pv-wasm crate compiles natively (cargo test) and for wasm32-unknown-unknown, proving the crypto round-trip works"
    requirement: "UI-01"
    verification:
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#tests::full_roundtrip"
        status: pass
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#tests::wrong_password_fails_to_unwrap"
        status: pass
      - kind: other
        ref: "cargo build -p pv-wasm --target wasm32-unknown-unknown --release"
        status: pass
    human_judgment: false
  - id: D2
    description: "No #[wasm_bindgen]-exported function in pv-wasm returns raw key/secret bytes — only opaque handles or ciphertext/plaintext strings cross the boundary (randomSalt is the sole sanctioned non-secret exception)"
    requirement: "UI-01"
    verification:
      - kind: other
        ref: "grep -n 'Vec<u8>' crates/pv-wasm/src/lib.rs | grep -v random_salt | grep -v -- '-> Result<String' (empty output)"
        status: pass
    human_judgment: false
  - id: D3
    description: "scripts/build-wasm.sh reproducibly builds pv-wasm to WASM, single-sources the wasm-bindgen version pin, installs a matching wasm-bindgen-cli on demand, audits for duplicate getrandom majors, and splits output into web/src/lib/crypto/wasm/ (JS/TS glue) + web/public/wasm/ (binary)"
    requirement: "UI-01"
    verification:
      - kind: other
        ref: "bash scripts/build-wasm.sh && test -f web/src/lib/crypto/wasm/pv_wasm.js && test -f web/public/wasm/pv_wasm_bg.wasm && test ! -f web/src/lib/crypto/wasm/pv_wasm_bg.wasm"
        status: pass
    human_judgment: false

# Metrics
duration: ~35min
completed: 2026-07-12
status: complete
---

# Phase 1 Plan 1: WASM Crypto Bridge Summary

**New `pv-wasm` crate bridges pv-core's Argon2id/HKDF/XChaCha20-Poly1305 crypto to `wasm32-unknown-unknown` through opaque-handle wasm-bindgen types (`WasmWrappingKey`, `WasmUserKey`), plus a reproducible `scripts/build-wasm.sh` that single-sources the wasm-bindgen version pin and audits for duplicate `getrandom` majors.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-12 (session start)
- **Completed:** 2026-07-12T15:30:53Z
- **Tasks:** 2 completed
- **Files modified:** 7 (Cargo.toml, crates/pv-wasm/Cargo.toml, crates/pv-wasm/src/lib.rs, crates/pv-core/src/keys.rs, scripts/build-wasm.sh, .gitignore)

## Accomplishments

- `crates/pv-wasm` created as a third workspace member, compiling both natively (`cargo test`) and to `wasm32-unknown-unknown --release`
- Full crypto round trip (derive wrapping key from password → generate User Key → wrap → unwrap → encrypt item → decrypt item) proven correct via native tests, plus a wrong-password-fails-cleanly test (no panic, clean `Err`)
- Zero-knowledge boundary enforced by construction: `WasmWrappingKey`/`WasmUserKey` are opaque handles; the only exported function returning `Vec<u8>` is `randomSalt` (non-secret, public randomness) — verified by grep in acceptance criteria
- `pv_core::keys::random_bytes(len)` added as a small, generically-useful `OsRng`-based helper, reused by `pv-wasm`'s `randomSalt`
- `scripts/build-wasm.sh` builds reproducibly: parses the `=0.2.126` wasm-bindgen pin directly from `crates/pv-wasm/Cargo.toml` (no duplicate literal), installs a matching `wasm-bindgen-cli` only when needed, runs a `cargo tree -i getrandom` duplicate-major audit (confirmed single `v0.2` major), and splits output into `web/src/lib/crypto/wasm/` (JS/TS glue, gitignored) + `web/public/wasm/` (binary, gitignored) — the Turbopack-safe layout plan 01-03 will consume
- Verified end-to-end: ran the build script twice (fresh install, then idempotent skip-install path) and confirmed the exact generated export surface in `pv_wasm.d.ts`

## Task Commits

Each task was committed atomically (Task 1 used the RED → GREEN TDD cycle):

1. **Task 1 RED: pv-wasm scaffold + failing tests** - `82e213b` (test)
2. **Task 1 GREEN: pv-wasm implementation** - `e76fe4b` (feat)
3. **Task 2: build-wasm.sh** - `d2a4730` (feat)

_Note: Task 1 was TDD (`tdd="true"`) — RED commit scaffolds the crate/tests so they fail to compile (types/functions don't exist yet), GREEN commit implements the real bindings and random_bytes helper to make them pass._

## Files Created/Modified

- `Cargo.toml` - workspace `members` array gains `"crates/pv-wasm"`
- `crates/pv-wasm/Cargo.toml` - new crate manifest: `cdylib`+`rlib`, `pv-core` path dep, `wasm-bindgen = "=0.2.126"`, `serde_json.workspace`, `zeroize` (derive), wasm32-only `getrandom = { version = "0.2", features = ["js"] }`
- `crates/pv-wasm/src/lib.rs` - `WasmWrappingKey`, `WasmUserKey` opaque handles; `wrapUserKey`/`unwrapUserKey`/`encryptItem`/`decryptItem`/`defaultKdfParamsJson`/`randomSalt` exports; `to_js_err`/`to_js_str_err` boundary conversions (cfg-split wasm32 vs native)
- `crates/pv-core/src/keys.rs` - added `random_bytes(len: usize) -> Vec<u8>` (public, non-secret) plus its two unit tests
- `scripts/build-wasm.sh` - new, executable, single-sourced version pin + getrandom audit + two-directory output split
- `.gitignore` - appended `web/src/lib/crypto/wasm/` and `web/public/wasm/`

## Decisions Made

- **cfg-split JsValue error conversion (wasm32 vs native):** `JsValue::from_str`/any `JsValue`-constructing call requires an actual JS host to back the wasm-bindgen extern it invokes. Compiling for the native `cargo test` target succeeds (as the plan expected), but *calling* the conversion at runtime panics with "function not implemented on non-wasm32 targets" — this only manifests on the `Err` path, so the plan's `full_roundtrip` test (all-`Ok`) passed immediately while `wrong_password_fails_to_unwrap` (hits `Err`) aborted the test binary. Fixed by splitting `to_js_err`/`to_js_str_err` via `#[cfg(target_arch = "wasm32")]`: the wasm32 build keeps the real, descriptive `.to_string()` message for the browser; the native build returns `JsValue::NULL` on the `Err` path (the `Result` variant — what tests assert — is unaffected; only the payload content differs, and only off-target).
- **getrandom audit precision:** `cargo tree -i getrandom` prints the full reverse-dependency tree, and a naive `grep -oE 'v[0-9]+\.[0-9]+'` over the whole output matches every indented dependent's own version too (e.g. `sha2 v0.10.9`, `cipher v0.4.4`), producing 9 phantom "majors" on the very first run. Fixed by filtering to only the root `^getrandom ` line before extracting the version — this correctly reports the single real major (`v0.2`).
- **PATH robustness in build-wasm.sh:** `cargo install wasm-bindgen-cli` succeeded and placed binaries in `~/.cargo/bin`, but that directory was not on this shell's `PATH` (rustup-managed `cargo` binary lived elsewhere), so the very next script step (`wasm-bindgen --target web ...`) failed with "command not found" despite the tool being present. Fixed by exporting `$HOME/.cargo/bin` onto `PATH` at the top of the script — a standard, low-risk robustness addition for any environment invoking this script.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `JsValue` conversions panic on native test target's `Err` path**
- **Found during:** Task 1 (initial `cargo test -p pv-wasm` run after GREEN implementation)
- **Issue:** The plan's `<behavior>`/`<action>` assumed `#[wasm_bindgen]`-annotated functions "compile and run on the native test target too." This holds for compilation and for `Ok`-only code paths, but any code path that actually constructs a `JsValue` (i.e. every `Err` return) invokes a real wasm-bindgen JS-host extern that has no implementation on native targets and aborts the process (`SIGABRT`) rather than returning an error value.
- **Fix:** Split `to_js_err` and a new `to_js_str_err` helper via `#[cfg(target_arch = "wasm32")]` / `#[cfg(not(target_arch = "wasm32"))]` — wasm32 keeps the real `.to_string()`-based `JsValue::from_str`, native returns `JsValue::NULL` (still an `Err` variant, satisfying every test assertion; message content is untested and irrelevant off-target).
- **Files modified:** crates/pv-wasm/src/lib.rs
- **Verification:** `cargo test -p pv-core -p pv-wasm` — both tests pass; `cargo build -p pv-wasm --target wasm32-unknown-unknown --release` — still exits 0, confirming the wasm32 branch (unexercised by native tests) still compiles correctly.
- **Committed in:** e76fe4b (Task 1 GREEN commit)

**2. [Rule 3 - Blocking] getrandom duplicate-major audit false-positived on unrelated crate versions**
- **Found during:** Task 2 (first `bash scripts/build-wasm.sh` run)
- **Issue:** `cargo tree -i getrandom --target wasm32-unknown-unknown -p pv-wasm | grep -oE 'v[0-9]+\.[0-9]+'` matched version substrings from every package in the printed reverse-dependency tree (sha2, hkdf, cipher, poly1305, blake2, chacha20, argon2, crypto-common, digest — 9 distinct "majors"), not just getrandom's own resolved version, causing the audit to fail-closed on a healthy dependency graph.
- **Fix:** Added `grep '^getrandom '` before the version-extraction grep, restricting the match to root-level `getrandom vX.Y.Z` lines only (cargo tree's reverse-dependency roots are unindented; all dependents are indented under them).
- **Files modified:** scripts/build-wasm.sh
- **Verification:** Re-ran `bash scripts/build-wasm.sh` — audit now reports the single correct major (`v0.2`) and the script proceeds.
- **Committed in:** d2a4730 (Task 2 commit)

**3. [Rule 3 - Blocking] `wasm-bindgen` CLI unresolvable on PATH immediately after `cargo install`**
- **Found during:** Task 2 (same build-wasm.sh run, next step after the getrandom fix)
- **Issue:** `cargo install wasm-bindgen-cli --version 0.2.126 --locked` completed successfully and placed the binary at `~/.cargo/bin/wasm-bindgen`, but this shell's `PATH` did not include `~/.cargo/bin` (cargo itself resolved via a separate rustup shim path), so the script's own `wasm-bindgen --target web ...` invocation failed with "command not found."
- **Fix:** Added `export PATH="$HOME/.cargo/bin:$PATH"` near the top of `scripts/build-wasm.sh`, defensively ensuring cargo-installed binaries are resolvable regardless of the invoking shell's baseline `PATH`.
- **Files modified:** scripts/build-wasm.sh
- **Verification:** Re-ran `bash scripts/build-wasm.sh` end-to-end (both fresh-install and idempotent-skip paths) — script completes and produces both output files.
- **Committed in:** d2a4730 (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 3 - blocking issues, all in test/build infrastructure, none touching pv-core's crypto logic or the zero-knowledge/opaque-handle design)
**Impact on plan:** All three fixes are narrow, environment/runtime-correctness issues uncovered by actually executing the plan's verification commands — none required deviating from the plan's architecture, API surface, or security properties. No scope creep.

## Issues Encountered

None beyond the three auto-fixed deviations above — all resolved within task scope.

## User Setup Required

None - no external service configuration required. (Note: `scripts/build-wasm.sh` does run `cargo install wasm-bindgen-cli` on first use, which is a normal, expected first-run step documented in the plan and RESEARCH.md, not an ad-hoc setup requirement.)

## Next Phase Readiness

- `pv-wasm`'s exported surface is stable and verified for plan 01-03's `web/src/lib/crypto/index.ts` facade to consume: `WasmWrappingKey.fromPassword(password, salt, kdfParamsJson)`, `WasmUserKey.generate()`, `wrapUserKey(wrappingKey, userKey)`, `unwrapUserKey(wrappingKey, wrappedJson)`, `encryptItem(userKey, plaintext)`, `decryptItem(userKey, itemJson)`, `defaultKdfParamsJson()`, `randomSalt(len)`.
- `scripts/build-wasm.sh`'s two output directories (`web/src/lib/crypto/wasm/` for JS/TS glue, `web/public/wasm/` for the binary) exist and are gitignored, ready for plan 01-03's `initCrypto()` to call `init('/wasm/pv_wasm_bg.wasm')` against.
- No blockers. One pre-existing repo-hygiene note (out of scope for this plan, not fixed): `crates/pv-core/Cargo.toml`, `crates/pv-core/src/{error,items,kdf,lib,prf}.rs`, `crates/pv-server/`, `docs/`, `README.md`, `Cargo.lock`, and `rust-toolchain.toml` were already present on disk but untracked by git before this plan started (confirmed via `git status` at session start — no plan task touched or was responsible for these). Only this plan's own `files_modified` were staged and committed; the rest remain untracked and are a separate concern for whoever owns initial-commit hygiene.

---
*Phase: 01-wasm-crypto-bridge-web-app-shell*
*Completed: 2026-07-12*

## Self-Check: PASSED

- FOUND: Cargo.toml
- FOUND: crates/pv-wasm/Cargo.toml
- FOUND: crates/pv-wasm/src/lib.rs
- FOUND: crates/pv-core/src/keys.rs
- FOUND: scripts/build-wasm.sh
- FOUND: .gitignore
- FOUND: .planning/phases/01-wasm-crypto-bridge-web-app-shell/01-01-SUMMARY.md
- FOUND commit: 82e213b (test: RED)
- FOUND commit: e76fe4b (feat: GREEN pv-wasm)
- FOUND commit: d2a4730 (feat: build-wasm.sh)
