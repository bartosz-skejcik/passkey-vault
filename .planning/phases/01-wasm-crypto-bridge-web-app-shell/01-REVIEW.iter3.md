---
phase: 01-wasm-crypto-bridge-web-app-shell
reviewed: 2026-07-12T22:10:00Z
depth: standard
files_reviewed: 19
files_reviewed_list:
  - crates/pv-core/src/keys.rs
  - crates/pv-wasm/Cargo.toml
  - crates/pv-wasm/src/lib.rs
  - scripts/build-wasm.sh
  - web/next-env.d.ts
  - web/next.config.ts
  - web/package.json
  - web/postcss.config.mjs
  - web/src/app/globals.css
  - web/src/app/layout.tsx
  - web/src/app/page.tsx
  - web/src/components/self-test/SelfTestCard.tsx
  - web/src/components/self-test/StepRow.tsx
  - web/src/components/shell/MainColumn.tsx
  - web/src/components/shell/Sidebar.tsx
  - web/src/components/shell/TopBar.tsx
  - web/src/lib/crypto/index.test.ts
  - web/src/lib/crypto/index.ts
  - web/tsconfig.json
  - web/vitest.config.ts
findings:
  critical: 0
  warning: 1
  info: 4
  total: 5
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-07-12T22:10:00Z
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Summary

Iteration 2 of the fix loop. Verified all five fixes (CR-01, CR-02, WR-01, WR-02, WR-03) against the actual diffs in commits `d5b4741`, `fb7c314`, `00f9745`, `0d7baa4`, `d523b5e`, then went further than reading the diff: I rebuilt the real `pv-wasm` WASM binary with `scripts/build-wasm.sh` and drove the regenerated bindings from Node against both `WasmWrappingKey.fromPassword` and the full `runSelfTest()` sequence, to empirically confirm the zeroization and `.free()` claims rather than trust the code comments. `cargo test -p pv-core -p pv-wasm`, `cargo clippy -p pv-core -p pv-wasm`, `npx tsc --noEmit`, and `npm test` (vitest) all pass clean.

**CR-01 (free handles) — confirmed fixed.** `runSelfTest()` now wraps every step in `try { ... } finally { unwrappedKey?.free?.(); userKey?.free?.(); wrappingKey?.free?.(); }`, covering every exit path (including partial-failure paths where a later handle was never assigned). Empirically verified against the real compiled module: all three handles get freed with no leaked/dangling state, and a second call to `.free()` on an already-freed handle throws cleanly (`"null pointer passed to rust"`) rather than corrupting memory — there's no double-free risk in the code path since each variable is assigned and freed at most once.

**CR-02 (password as bytes, zeroized) — confirmed fixed, and empirically verified end-to-end.** `WasmWrappingKey::from_password` now takes `&mut [u8]` and calls `password.zeroize()` unconditionally (both success and error paths) before returning. I was skeptical of the code comment's claim that "wasm-bindgen copies mutable slices back to the caller's JS view" (this is exactly the kind of claim that's easy to get wrong), so I rebuilt the WASM artifact and ran it directly: a JS `Uint8Array` passed into `fromPassword` is verifiably all-zero immediately after the call returns, via wasm-bindgen's `__wbindgen_copy_to_typed_array` write-back mechanism. `index.ts`'s caller also does defense-in-depth `passwordBytes.fill(0)` in its own `finally`. Both Rust-side unit tests were correctly updated to the new signature.

**WR-01 (reset `ready` on rejection) — confirmed fixed.** `ready = null` inside `.catch` before rethrowing allows a later call to retry instead of replaying the same rejection forever. Logic is correct; no new test was added that specifically exercises "retry succeeds after a transient failure" (see IN-04), but the fix itself is sound.

**WR-02 (unmount guard) — fix is incomplete; see WR-04 below for a race condition the chosen implementation reintroduces.**

**WR-03 (theme allow-list) — confirmed fixed.** The inline pre-hydration script now validates `stored === 'vault-light' || stored === 'vault-dark'` before use, matching `Sidebar.tsx`'s existing check, with the same `vault-dark` fallback for any other value.

No new files outside the four touched by the fix commits (`crates/pv-wasm/src/lib.rs`, `web/src/app/layout.tsx`, `web/src/components/self-test/SelfTestCard.tsx`, `web/src/lib/crypto/index.ts`) were modified, so the remaining 15 files carry forward unchanged from iteration 1 and were not re-audited in depth.

## Warnings

### WR-04: `SelfTestCard`'s `mountedRef` guard is shared across effect invocations, so it does not actually prevent a stale `run()` from applying results after a React Strict Mode remount

**File:** `web/src/components/self-test/SelfTestCard.tsx:18-42`
**Issue:** The WR-02 fix replaced the originally-suggested per-effect-invocation `let cancelled = false` closure with a single `mountedRef` that persists for the component's entire lifetime and is reset to `true` on every effect setup. This closes the "component permanently unmounted" case, but reopens a narrower race under React's Strict Mode double-invocation of effects (mount → cleanup → remount), which happens on **every** `next dev` page load for this app: `next.config.ts` does not set `reactStrictMode: false`, and Next.js defaults Strict Mode to `true` for the App Router (confirmed against `node_modules/next/dist/server/config-shared.js`, which resolves the `null` default to `true` for `app/`).

Sequence:
1. Effect setup #1 runs: `mountedRef.current = true`, `run()` starts (task A), awaits `runSelfTest()`.
2. Strict-mode cleanup runs immediately: `mountedRef.current = false`.
3. Effect setup #2 runs: `mountedRef.current = true` (reset!), `run()` starts (task B), also awaits `runSelfTest()`.
4. Task A (the *stale* run belonging to the already-cleaned-up first invocation) eventually resolves. Its guard check (`if (mountedRef.current) setState(...)`) now reads `true` — set by setup #2, not by task A's own invocation — so task A's `setState` fires anyway.

Net effect: every dev-mode mount runs `runSelfTest()` twice concurrently (double Argon2id KDF work, wasteful but not itself incorrect), and whichever of task A / task B resolves last "wins" the final render state non-deterministically — the guard does not actually make the update stale-safe, it only prevents updates after a component is unmounted and *never remounted*. This directly undermines the stated purpose of the fix ("guard every post-await setState"). It does not corrupt key material or leak secrets (each `runSelfTest()` invocation uses fully independent, self-contained key handles that are freed correctly per CR-01), so this is not security-critical, but it is a real, demonstrable correctness gap in exactly the pattern the original WR-02 finding was raised to close.
**Fix:** Use a per-invocation token/generation counter instead of a single persistent boolean, so only the *current* effect's own `run()` call is allowed to commit state:
```tsx
const runIdRef = useRef(0);

async function run() {
  const myRunId = ++runIdRef.current;
  setState({ kind: "loading" });
  try {
    const results = await runSelfTest();
    if (runIdRef.current === myRunId) setState({ kind: "results", results });
  } catch (e) {
    if (runIdRef.current === myRunId) {
      setState({ kind: "fatal", error: e instanceof Error ? e.message : String(e) });
    }
  }
}

useEffect(() => {
  run();
  return () => {
    // Invalidate this invocation's in-flight run without needing a
    // separate "mounted" concept — a genuine unmount and a Strict Mode
    // remount both bump runIdRef, so only the latest call ever commits.
  };
}, []);
```
(The button's `onClick={run}` still works unchanged — each click naturally gets its own `myRunId`.)

## Info

### IN-04: No regression test exercises "retry succeeds after a transient `initCrypto()` failure" (WR-01)

**File:** `web/src/lib/crypto/index.test.ts:73-79`
**Issue:** The existing test only asserts that a single failing `init()` call rejects; nothing calls `initCrypto()` a second time after the rejection to confirm `ready` was actually reset and a fresh attempt is made. The fix is correct (verified by inspection), but the specific regression this fix targets — "crypto permanently disabled after a transient failure" — has no test guarding against it being silently reintroduced later.
**Fix:**
```ts
it("allows a later call to retry after a rejected init()", async () => {
  const initError = new Error("transient failure");
  mockInit.mockRejectedValueOnce(initError).mockResolvedValueOnce(undefined);
  const { initCrypto } = await import("./index");

  await expect(initCrypto()).rejects.toThrow("transient failure");
  await expect(initCrypto()).resolves.toBeUndefined();
  expect(mockInit).toHaveBeenCalledTimes(2);
});
```

### IN-01: Redundant `Uint8Array` wrapping of an already-typed return value

**File:** `web/src/lib/crypto/index.ts:83`
**Issue:** `randomSalt(len: number): Uint8Array` already returns a `Uint8Array`. Wrapping it again in `new Uint8Array(randomSalt(16))` allocates and copies an identical second array for no behavioral benefit. (Carried forward from iteration 1 — intentionally not fixed.)
**Fix:** `const salt = randomSalt(16);`

### IN-02: No test exercises the real compiled WASM module through the JS/TS boundary

**File:** `web/src/lib/crypto/index.test.ts`
**Issue:** `index.test.ts` mocks `./wasm/pv_wasm.js` entirely, so it only verifies `index.ts`'s own orchestration logic. Nothing in the JS test suite loads the actual `pv_wasm_bg.wasm` binary and drives it through `wasm-bindgen`'s marshalling/finalization code in CI. (Carried forward from iteration 1 — intentionally not fixed. Note: this reviewer manually did exactly this kind of end-to-end verification out-of-band to validate CR-01/CR-02, which increases confidence the underlying fixes are sound, but that verification is not captured as a repeatable CI test.)
**Fix:** Consider a browser-mode (e.g. Vitest `--browser` or Playwright) smoke test that loads the real `pv_wasm.js`/`.wasm` pair and runs `runSelfTest()` unmocked at least once in CI.

### IN-03: Malformed-input error paths in the WASM bindings are untested on every target

**File:** `crates/pv-wasm/src/lib.rs:47-55, 106-127`
**Issue:** `to_js_str_err` (hit when `kdf_params_json`, `wrapped_json`, or `item_json` fail to deserialize) is only referenced from error branches that no test in `#[cfg(test)] mod tests` exercises — both tests only cover the happy path and the wrong-password path, never malformed JSON input from an untrusted/corrupted source. (Carried forward from iteration 1 — intentionally not fixed.)
**Fix:** Add a test asserting `unwrap_user_key(&wrapping_key, "not json")` and `decrypt_item(&uk, "not json")` return `Err(...)` rather than panicking.

---

_Reviewed: 2026-07-12T22:10:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
