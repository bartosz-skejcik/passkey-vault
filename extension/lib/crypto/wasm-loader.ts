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

// Module-level singleton promise — memoizes the (expensive, one-time) wasm
// module instantiation. Mirrors `web/src/lib/crypto/index.ts`'s `ready`/
// `initCrypto` shape exactly (lines 84-100), with one deliberate
// divergence: `init()` is called with an `ArrayBuffer`, never a URL/string.
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
      .then((bytes) => init(bytes))
      .then(() => undefined)
      .catch((e) => {
        ready = null; // allow a future call to retry instead of replaying this rejection forever
        throw e;
      });
  }
  return ready;
}
