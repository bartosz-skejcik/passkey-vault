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

export type { WasmUserKey };
// WasmWrappingKey is exported as a VALUE (not just a type) — callers need
// its static `fromPassword` method, the same way `web/src/lib/crypto/index.ts`
// re-exports it as a value for its own callers.
export { WasmWrappingKey };
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
