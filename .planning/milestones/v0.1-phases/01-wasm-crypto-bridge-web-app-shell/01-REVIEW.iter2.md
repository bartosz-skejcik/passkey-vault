---
phase: 01-wasm-crypto-bridge-web-app-shell
reviewed: 2026-07-12T00:00:00Z
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
  critical: 2
  warning: 3
  info: 3
  total: 8
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-07-12T00:00:00Z
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Summary

Reviewed the pv-wasm FFI bridge, its Rust key-handling primitives, the build script that produces the JS/TS glue, and the Next.js web app shell that consumes it (crypto self-test module + layout/shell components). The opaque-handle design (`WasmUserKey`/`WasmWrappingKey`) and the AEAD/HKDF primitives in `pv-core::keys` are sound in isolation (nonce is freshly randomized per seal, wrong-key/short-nonce/short-plaintext paths are rejected, error variants carry no secret material). However, tracing key material **all the way to where the opaque handles are actually consumed in TypeScript** surfaces two BLOCKER-level gaps in the zero-knowledge/zeroization guarantee that the module's own doc comments claim to provide:

1. None of the `WasmWrappingKey`/`WasmUserKey` handles created in `web/src/lib/crypto/index.ts` are ever explicitly `.free()`'d, so the deterministic `Drop`/`ZeroizeOnDrop` wipe this design is built around never actually runs in the traced code path — it relies entirely on a non-deterministic `FinalizationRegistry` callback that browsers are not required to ever invoke.
2. The password itself crosses the WASM boundary as a `&str` (`WasmWrappingKey::from_password`), which is exactly the pattern CLAUDE.md's Security Patterns section explicitly forbids ("DO NOT use String or Vec<u8> for keys/passwords") — the password bytes sit in WASM linear memory and are only `free()`'d (deallocated), never zeroized, after the KDF call.

Because `lib/crypto/index.ts` is documented as "the sole choke-point importer" of the WASM bindings for the entire app, both patterns will propagate to every future caller (real vault unlock/encrypt/decrypt flows) unless corrected now, in this foundational phase.

Also found: a promise-memoization bug that permanently poisons crypto initialization after any transient WASM-load failure, a missing unmount guard in the self-test UI, and a couple of minor robustness/test-coverage gaps.

## Critical Issues

### CR-01: Opaque key handles are never `.free()`'d — key material relies on non-deterministic GC to be zeroized

**File:** `web/src/lib/crypto/index.ts:63-129`
**Issue:** `runSelfTest()` creates `wrappingKey` (derived from the password), `userKey` (the freshly generated vault-root User Key), and `unwrappedKey` (the User Key round-tripped through wrap/unwrap) — all `wasm-bindgen` classes backed by Rust structs whose `Zeroize`/`ZeroizeOnDrop` guarantees only fire when the Rust value is actually dropped, i.e. when JS calls `.free()` (confirmed in the generated glue: `free()` → `wasm.__wbg_wasmuserkey_free(ptr, 0)` runs real `Drop` glue). None of these three handles are ever freed in this file. The only cleanup path is the `FinalizationRegistry` wasm-bindgen registers per-instance (`web/src/lib/crypto/wasm/pv_wasm.js:315-320`), which per spec browsers are permitted to delay indefinitely or skip entirely (e.g. on tab close). The result: the vault-root User Key and the password-derived wrapping key sit unzeroized in WASM linear memory for an unbounded period after use — the exact outcome the module's own doc comment (`crates/pv-wasm/src/lib.rs:1-10`) says the opaque-handle design exists to prevent. Because this file is the mandated single entry point for all future WASM crypto calls, this leak pattern will be inherited by the real unlock/encrypt/decrypt flows built on top of it.
**Fix:**
```ts
export async function runSelfTest(): Promise<StepResult[]> {
  await initCrypto();
  const results: StepResult[] = [];
  let wrappingKey: WasmWrappingKey | undefined;
  let userKey: WasmUserKey | undefined;
  let unwrappedKey: WasmUserKey | undefined;
  try {
    // ...existing step logic building wrappingKey/userKey/unwrappedKey...
    return results;
  } finally {
    unwrappedKey?.free();
    userKey?.free();
    wrappingKey?.free();
  }
}
```
Every future caller of `wrapUserKey`/`unwrapUserKey`/`encryptItem`/`decryptItem` in this module must follow the same try/finally-with-explicit-free discipline — consider wrapping it in a small `using`/`withHandle` helper (the generated glue already sets up `Symbol.dispose` on both classes — `pv_wasm.js:32,75` — so `using wrappingKey = ...` in a TS target that supports explicit resource management would get deterministic cleanup for free).

### CR-02: Password crosses the WASM boundary as `&str`/`String`, violating the project's explicit "no String/Vec<u8> for keys/passwords" rule, and is never zeroized after use

**File:** `crates/pv-wasm/src/lib.rs:65-76`
**Issue:** `WasmWrappingKey::from_password(password: &str, ...)` accepts the master password as a JS string. wasm-bindgen marshals it into WASM linear memory via `passStringToWasm0(password, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)` (`web/src/lib/crypto/wasm/pv_wasm.js:62`) and releases it after the call with `wasm.__wbindgen_free(...)` (a plain deallocation, not a zeroing wipe — confirmed by inspecting the generated glue, no zero-fill occurs anywhere in that path). CLAUDE.md's Security Patterns section states explicitly: *"Sensitive data ... DO NOT use `String` or `Vec<u8>` for keys/passwords"* — this function does exactly that for the single most sensitive user secret in the whole system (the master password). Once the call returns, the raw password bytes remain resident and recoverable in the WASM heap's freed-but-not-overwritten region until that memory happens to be reused.
**Fix:** Accept the password as raw bytes owned by the caller (`&[u8]`/`Uint8Array`) instead of `&str`, and explicitly zero the WASM-side copy before returning:
```rust
pub fn from_password(
    password: &mut [u8], // caller passes a Uint8Array it also zeroes on its side after the call
    salt: &[u8],
    kdf_params_json: &str,
) -> Result<WasmWrappingKey, JsValue> {
    let params: KdfParams = serde_json::from_str(kdf_params_json)
        .map_err(|e| to_js_str_err(&e.to_string()))?;
    let result = wrapping_key_from_password(password, salt, &params).map_err(to_js_err);
    password.zeroize(); // wipe the WASM-side copy regardless of outcome
    let wk = result?;
    Ok(WasmWrappingKey(*wk))
}
```
and update `web/src/lib/crypto/index.ts` callers to build the password as a `Uint8Array` (e.g. `new TextEncoder().encode(password)`) and zero that array themselves once `fromPassword` resolves.

## Warnings

### WR-01: `initCrypto()`'s memoized promise is never reset after rejection — a transient WASM-load failure permanently disables crypto for the session

**File:** `web/src/lib/crypto/index.ts:25-32`
**Issue:** `ready` is a module-level singleton that is assigned once and never cleared. If `init("/wasm/pv_wasm_bg.wasm")` rejects (e.g. transient network hiccup, CDN blip, or the WASM binary briefly 404s during a deploy), `ready` is left holding the *rejected* promise forever. Every subsequent call to `initCrypto()` (including from `SelfTestCard`'s "Uruchom ponownie" retry button) returns that same already-rejected promise, so the app can never recover from a transient init failure without a full page reload — `initCrypto`'s own retry test only checks a single failing call, not that a later call can succeed once the transient condition clears.
**Fix:**
```ts
export function initCrypto(): Promise<void> {
  if (ready === null) {
    ready = init("/wasm/pv_wasm_bg.wasm")
      .then(() => undefined)
      .catch((e) => {
        ready = null; // allow a future call to retry instead of replaying this rejection forever
        throw e;
      });
  }
  return ready;
}
```

### WR-02: `SelfTestCard`'s async effect has no unmount guard

**File:** `web/src/components/self-test/SelfTestCard.tsx:15-31`
**Issue:** `run()` is an async function kicked off from `useEffect` with no cleanup/cancellation. If the component unmounts while `runSelfTest()`'s WASM init or crypto steps are still pending (e.g. user navigates away quickly), the subsequent `setState(...)` calls fire on an unmounted component, producing React warnings and doing unnecessary work.
**Fix:**
```tsx
useEffect(() => {
  let cancelled = false;
  (async () => {
    setState({ kind: "loading" });
    try {
      const results = await runSelfTest();
      if (!cancelled) setState({ kind: "results", results });
    } catch (e) {
      if (!cancelled) setState({ kind: "fatal", error: e instanceof Error ? e.message : String(e) });
    }
  })();
  return () => { cancelled = true; };
}, []);
```

### WR-03: Inline theme-init script doesn't validate the stored theme value against the known allow-list

**File:** `web/src/app/layout.tsx:27-37`
**Issue:** `theme = stored || (...)` trusts whatever is in `localStorage.getItem('pv-theme')` verbatim and assigns it straight to `data-theme`. If that value is ever anything other than `'vault-light'`/`'vault-dark'` (corrupted storage, a stale value from a future/removed theme, or third-party tampering via a shared-origin script), DaisyUI silently fails to match a theme block and the page renders unstyled instead of falling back to `'vault-dark'`. `Sidebar.tsx:19-24` already implements the correct allow-list check for its own theme-sync effect — this script should mirror it instead of trusting the raw value.
**Fix:**
```js
var stored = localStorage.getItem('pv-theme');
var valid = stored === 'vault-light' || stored === 'vault-dark';
var theme = valid ? stored : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'vault-light' : 'vault-dark');
```

## Info

### IN-01: Redundant `Uint8Array` wrapping of an already-typed return value

**File:** `web/src/lib/crypto/index.ts:66`
**Issue:** `randomSalt(len: number): Uint8Array` (per `web/src/lib/crypto/wasm/pv_wasm.d.ts:36`) already returns a `Uint8Array`. Wrapping it again in `new Uint8Array(randomSalt(16))` allocates and copies an identical second array for no behavioral benefit.
**Fix:** `const salt = randomSalt(16);`

### IN-02: No test exercises the real compiled WASM module through the JS/TS boundary

**File:** `web/src/lib/crypto/index.test.ts:28-38`
**Issue:** `index.test.ts` mocks `./wasm/pv_wasm.js` entirely via `vi.mock`, so it only verifies `index.ts`'s own orchestration logic (step ordering, error propagation, memoization). Nothing in the JS test suite loads the actual `pv_wasm_bg.wasm` binary and drives it through `wasm-bindgen`'s marshalling/finalization code — that surface is currently only covered by `cargo test -p pv-wasm`, which calls the Rust functions natively and bypasses the JS glue (string marshalling, `passStringToWasm0`, `FinalizationRegistry`, etc.) entirely.
**Fix:** Consider a browser-mode (e.g. Vitest `--browser` or Playwright) smoke test that loads the real `pv_wasm.js`/`.wasm` pair and runs `runSelfTest()` unmocked at least once in CI.

### IN-03: Malformed-input error paths in the WASM bindings are untested on every target

**File:** `crates/pv-wasm/src/lib.rs:44-55, 98-121`
**Issue:** `to_js_str_err` (hit when `kdf_params_json`, `wrapped_json`, or `item_json` fail to deserialize) is only referenced from error branches that no test in `#[cfg(test)] mod tests` (`crates/pv-wasm/src/lib.rs:135-170`) exercises — both tests only cover the happy path and the wrong-password path, never malformed JSON input from an untrusted/corrupted source (e.g. a tampered `wrapped_json` blob coming back from server storage).
**Fix:** Add a test asserting `unwrap_user_key(&wrapping_key, "not json")` and `decrypt_item(&uk, "not json")` return `Err(...)` rather than panicking.

---

_Reviewed: 2026-07-12T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
