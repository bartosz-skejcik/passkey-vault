---
phase: 01-wasm-crypto-bridge-web-app-shell
fixed_at: 2026-07-12T19:54:01Z
review_path: .planning/phases/01-wasm-crypto-bridge-web-app-shell/01-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-07-12T19:54:01Z
**Source review:** .planning/phases/01-wasm-crypto-bridge-web-app-shell/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (fix_scope: critical_warning — CR-* and WR-* only; IN-01/IN-02/IN-03 excluded)
- Fixed: 5
- Skipped: 0

## Fixed Issues

### CR-01: Opaque key handles are never `.free()`'d — key material relies on non-deterministic GC to be zeroized

**Files modified:** `web/src/lib/crypto/index.ts`
**Commit:** d5b4741
**Applied fix:** Wrapped `runSelfTest()`'s step logic in an outer `try/finally`. The `finally` block explicitly frees `unwrappedKey`, `userKey`, and `wrappingKey` (in that order) on every exit path, so the Rust-side `Zeroize`/`ZeroizeOnDrop` glue runs deterministically instead of depending on the browser's `FinalizationRegistry`. Used `handle?.free?.()` (optional method call, not just optional property access) rather than the review's plain `handle?.free()`, because `index.test.ts` mocks `WasmWrappingKey`/`WasmUserKey` with plain `{}` objects that have no `.free` method — the extra `?.` on the call keeps the existing test suite green without needing to touch the test file.

### CR-02: Password crosses the WASM boundary as `&str`/`String`, violating the project's explicit "no String/Vec<u8> for keys/passwords" rule, and is never zeroized after use

**Files modified:** `crates/pv-wasm/src/lib.rs`, `web/src/lib/crypto/index.ts`
**Commit:** fb7c314
**Applied fix:** Changed `WasmWrappingKey::from_password`'s `password` parameter from `&str` to `&mut [u8]`, calling `password.zeroize()` on the WASM-side buffer after the KDF call regardless of success/failure. Verified via a full `wasm-bindgen`/`wasm32-unknown-unknown` build that this parameter type is marshaled as a mutable-slice `Uint8Array` in the generated glue (`web/src/lib/crypto/wasm/pv_wasm.d.ts`: `fromPassword(password: Uint8Array, ...)`), and that `wasm-bindgen` copies the WASM-side buffer back into the caller's JS `Uint8Array` after the call — so the Rust-side `zeroize()` also wipes the caller's view. Updated the sole caller (`web/src/lib/crypto/index.ts`) to build the password via `new TextEncoder().encode(SELF_TEST_PASSWORD)` and `.fill(0)` it in the `finally` block as defense in depth. Updated the two native `#[cfg(test)]` callers in `crates/pv-wasm/src/lib.rs` to pass a `&mut Vec<u8>` instead of a string literal.

### WR-01: `initCrypto()`'s memoized promise is never reset after rejection — a transient WASM-load failure permanently disables crypto for the session

**Files modified:** `web/src/lib/crypto/index.ts`
**Commit:** 00f9745
**Applied fix:** Applied the review's suggested fix as-is: added a `.catch()` handler to the memoized `init(...)` promise chain that resets the module-level `ready` singleton to `null` before rethrowing, so a subsequent `initCrypto()` call retries instead of replaying the same rejection forever.

### WR-02: `SelfTestCard`'s async effect has no unmount guard

**Files modified:** `web/src/components/self-test/SelfTestCard.tsx`
**Commit:** 0d7baa4
**Applied fix:** The actual component differs from the review's snippet — `run()` is a named async function shared between the mount `useEffect` *and* the "Uruchom ponownie" retry button's `onClick`, not an inline effect IIFE, so an effect-local `cancelled` boolean (as in the review's suggested snippet) would not cover the button-triggered call path. Adapted the fix to use a `useRef`-backed `mountedRef` flag instead: set to `true` on mount, `false` in the effect's cleanup function, and checked before every `setState` call inside `run()` that follows an `await`. This covers both call sites with one guard.

### WR-03: Inline theme-init script doesn't validate the stored theme value against the known allow-list

**Files modified:** `web/src/app/layout.tsx`
**Commit:** d523b5e
**Applied fix:** Applied the review's suggested fix as-is: the inline pre-hydration script now validates `localStorage.getItem('pv-theme')` against the `'vault-light'`/`'vault-dark'` allow-list before using it, falling back to the `prefers-color-scheme` media-query check otherwise — mirroring the existing pattern already used in `Sidebar.tsx`'s theme-sync effect.

## Skipped Issues

None — all in-scope findings were fixed.

## Verification

Ran after every fix and again as a final full-suite pass on the completed set:

- `cargo test -p pv-core -p pv-wasm` — **8 + 2 = 10 tests passed**, 0 failed
- `cargo build -p pv-wasm --target wasm32-unknown-unknown --release` — **succeeded**
- `bash scripts/build-wasm.sh` (regenerates `web/src/lib/crypto/wasm/pv_wasm.js`/`.d.ts` from the changed Rust signature) — **succeeded**
- `cd web && npm test` (vitest) — **4/4 tests passed**
- `cd web && npm run build` (`next build`, includes a TypeScript typecheck pass and re-runs `scripts/build-wasm.sh` via the `prebuild` hook) — **succeeded**, no TypeScript errors

Out-of-scope, unrelated build artifacts (`web/next-env.d.ts`, `web/tsconfig.tsbuildinfo`) that changed as a side effect of running the build/typecheck commands were reverted/removed before each commit to keep the diffs scoped to the actual fixes.

## Notes for the developer

- IN-01 (redundant `Uint8Array` wrapping of `randomSalt()`'s return value), IN-02 (no test exercises the real compiled WASM module through the JS/TS boundary), and IN-03 (malformed-input error paths in the WASM bindings are untested) were **not** addressed — `fix_scope` for this run was `critical_warning`, which excludes `IN-*` findings. Re-run with `fix_scope: all` to include them.
- None of the fixed findings were logic-error/algorithm-correctness issues requiring separate human sign-off beyond normal review — all five are either resource-lifecycle (free/zeroize/cancellation) or input-validation fixes with straightforward, testable behavior, and all touched automated tests (Rust `cargo test`, TS `vitest`) still pass.

---

_Fixed: 2026-07-12T19:54:01Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
