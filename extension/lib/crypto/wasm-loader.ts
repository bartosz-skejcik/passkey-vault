// lib/crypto/wasm-loader.ts — the sole choke-point importer of the
// generated WASM bindings (crates/pv-wasm, built by
// ../../../scripts/build-wasm.sh into ./wasm/) inside extension/. No other
// file under extension/ may import from `./wasm` — mirrors the same
// "sole choke-point importer" invariant `web/src/lib/crypto/index.ts`
// establishes for the web app (see that file's header comment).
//
// Only opaque key handles (WasmWrappingKey/WasmUserKey), booleans,
// ciphertext/plaintext strings, and salts cross out of this module — never
// raw key bytes.
import { browser } from "wxt/browser";
import init, {
  WasmWrappingKey,
  WasmUserKey,
  wrapUserKey,
  unwrapUserKey,
  defaultKdfParamsJson,
  randomSalt,
  exportUserKeyForSession,
  importUserKeyFromSession,
  deriveAuthMaterial,
  decryptItem,
  totpNow as wasmTotpNow,
} from "./wasm/pv_wasm.js";

// Both WasmWrappingKey and WasmUserKey are re-exported as VALUES (not just
// types): callers need WasmWrappingKey's static `fromPassword` and
// WasmUserKey's static `generate` factory method directly (vault-session.ts,
// plan 08-02 Task 2). This is a deliberate divergence from
// `web/src/lib/crypto/index.ts`, which type-only re-exports `WasmUserKey`
// because its own `generateUserKey()` wrapper is the sole caller of
// `.generate()` — this extension has no equivalent wrapper yet, so the
// static method must cross this choke-point directly.
export { WasmWrappingKey, WasmUserKey };
export { wrapUserKey, unwrapUserKey, defaultKdfParamsJson, randomSalt };
// Plan 09-01's sanctioned exception (see crates/pv-wasm/src/lib.rs's
// export_user_key_for_session doc comment, D-02): the ONLY raw-key-bytes
// crossing this choke-point, required so entrypoints/background/
// vault-session.ts (Plan 09-02) can survive a service-worker idle-kill by
// round-tripping a WasmUserKey's bytes through chrome.storage.session.
export { exportUserKeyForSession, importUserKeyFromSession };
// Plan 09-04's unlock.ts needs the password-unlock derivation entry point --
// mirrors web/src/lib/crypto/index.ts's own re-export of the same wasm
// function. Only the opaque WasmAuthMaterial handle (takeAuthHash/
// takeWrappingKey/free) crosses this choke-point, never raw key bytes.
export { deriveAuthMaterial };
// Plan 09-05's vault-store.ts needs the item-decryption entry point --
// mirrors web/src/lib/crypto/index.ts's own re-export of the same wasm
// function. Only ciphertext/plaintext strings cross this choke-point here,
// never raw key bytes (the WasmUserKey handle used for decryption is
// itself an opaque handle, already re-exported above).
export { decryptItem };

// Plan 10-04's autofill-match.ts needs the live TOTP derivation entry
// point -- mirrors web/src/lib/crypto/index.ts's own totpNow wrapper
// exactly (see that file's header comment for the full rationale): the
// JSON.parse happens once here so every caller gets the same
// `{code, secondsRemaining}` shape, and `period`/`unixTimeSeconds` are
// `u64` on the Rust side (marshaled as `bigint` by wasm-bindgen) --
// converted here so callers keep passing plain numbers. No zeroize/
// lifecycle concerns: a TOTP secret is a per-item stored value, not root
// key material (pv-wasm's own module doc).
export type TotpNowResult = { code: string; secondsRemaining: number };

export function totpNow(
  secretB32: string,
  algorithm: string,
  digits: number,
  period: number,
  unixTimeSeconds: number,
): TotpNowResult {
  const json = wasmTotpNow(secretB32, algorithm, digits, BigInt(period), BigInt(unixTimeSeconds));
  return JSON.parse(json) as TotpNowResult;
}

// Module-level singleton promise — memoizes the (expensive, one-time) wasm
// module instantiation. Mirrors `web/src/lib/crypto/index.ts`'s `ready`/
// `initCrypto` shape exactly (lines 84-100), with one deliberate
// divergence: `init()` is called with an `ArrayBuffer` (via the modern
// `{ module_or_path }` options-object form, never a bare positional arg --
// the generated glue warns "using deprecated parameters" otherwise), never
// a URL/string.
//
// pv_wasm.js's generated `__wbg_load` only takes the browser's native
// streaming-compile WebAssembly API when its argument is a `Response`
// instance (i.e. when `init()` is given a string/URL/Request,
// which it internally `fetch()`s itself). Passing raw bytes instead routes
// straight to the plain `WebAssembly.instantiate(bytes, imports)` branch
// (D-03) — zero changes to the shared glue required. Streaming compilation
// from `chrome-extension://`/`moz-extension://` URLs has had cross-browser
// MIME-type reliability issues (RESEARCH.md Pattern 3), so this fetch+
// ArrayBuffer+instantiate path is deliberately chosen over the web app's
// pass-a-URL-and-let-the-glue-fetch-it approach.
let ready: Promise<void> | null = null;

export function initCrypto(): Promise<void> {
  if (ready === null) {
    ready = fetch(browser.runtime.getURL("/wasm/pv_wasm_bg.wasm"))
      .then((response) => response.arrayBuffer())
      .then((bytes) => init({ module_or_path: bytes }))
      .then(() => undefined)
      .catch((e) => {
        ready = null; // allow a future call to retry instead of replaying this rejection forever
        throw e;
      });
  }
  return ready;
}
