// wasm-loader.real-wasm.test.ts — this repo's FIRST extension-side
// real-WASM regression (27-03-PLAN.md Task 1). Establishes the
// node-environment loading pattern Task 2's/Task 3's own
// `*.real-wasm.test.ts` files reuse: mock ONLY `wxt/browser`'s
// `runtime.getURL` (the wire boundary this module's own `initCrypto()`
// resolves its wasm path through -- see that function's header comment),
// stub `global.fetch` to serve the REAL compiled `.wasm` binary's bytes
// straight off disk for whatever URL `getURL` produces, then call the
// genuine `initCrypto()`. No `vi.mock` of `wasm-loader.ts` itself, or of
// `./wasm/pv_wasm.js`, anywhere in this file -- the whole point is proving
// THIS module's own 11 (see note below) new collection/identity
// re-exports resolve as defined values through genuine wasm-bindgen
// bindings, not a mock.
//
// Note on the count: 27-PATTERNS.md's own "Pattern 1" excerpt and
// crates/pv-wasm/src/lib.rs both enumerate 12 new names (WasmIdentityKey,
// WasmIdentityPublicKey, WasmCollectionKey, wrapIdentitySecretKey,
// unwrapIdentitySecretKey, sealCollectionKey, unsealCollectionKey,
// encryptItemForCollection, decryptItemForCollection,
// rewrapItemKeyForCollection, sealItemKeyForRecipient,
// decryptItemWithSharedKey) though the plan's own prose says "11" -- this
// test asserts the full, correct set of 12 rather than truncating to match
// the plan's off-by-one count.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// wasm-loader.ts's own initCrypto() calls
// `browser.runtime.getURL("/wasm/pv_wasm_bg.wasm")` (wxt/browser) --
// mirrors vault-session.test.ts's/session-storage.test.ts's own
// `vi.mock("wxt/browser", ...)` precedent (there is no WxtVitest plugin
// wired into vitest.config.ts, so `browser` resolves to `undefined` under
// plain node/vitest without this mock).
vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      getURL: (p: string) => `chrome-extension://fake-test-id${p}`,
    },
  },
}));

import {
  initCrypto,
  WasmIdentityKey,
  WasmIdentityPublicKey,
  WasmCollectionKey,
  wrapIdentitySecretKey,
  unwrapIdentitySecretKey,
  sealCollectionKey,
  unsealCollectionKey,
  encryptItemForCollection,
  decryptItemForCollection,
  rewrapItemKeyForCollection,
  sealItemKeyForRecipient,
  decryptItemWithSharedKey,
} from "./wasm-loader";

beforeAll(async () => {
  const wasmPath = path.join(process.cwd(), "public", "wasm", "pv_wasm_bg.wasm");
  const wasmBytes = readFileSync(wasmPath);
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("pv_wasm_bg.wasm")) {
      return new Response(wasmBytes, {
        status: 200,
        headers: { "Content-Type": "application/wasm" },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  await initCrypto();
});

describe("wasm-loader.ts: collection/identity WASM bindings resolve as defined values (real WASM)", () => {
  it("every new collection/identity name is a defined export", () => {
    expect(WasmIdentityKey).toBeDefined();
    expect(WasmIdentityPublicKey).toBeDefined();
    expect(WasmCollectionKey).toBeDefined();
    expect(wrapIdentitySecretKey).toBeDefined();
    expect(unwrapIdentitySecretKey).toBeDefined();
    expect(sealCollectionKey).toBeDefined();
    expect(unsealCollectionKey).toBeDefined();
    expect(encryptItemForCollection).toBeDefined();
    expect(decryptItemForCollection).toBeDefined();
    expect(rewrapItemKeyForCollection).toBeDefined();
    expect(sealItemKeyForRecipient).toBeDefined();
    expect(decryptItemWithSharedKey).toBeDefined();
  });

  it("WasmIdentityKey.generate().publicKeyBytes() round-trips through this module's own re-export as a 32-byte array", () => {
    const isk = WasmIdentityKey.generate();
    try {
      const pk = isk.publicKeyBytes();
      expect(pk).toBeInstanceOf(Uint8Array);
      expect(pk.length).toBe(32);
    } finally {
      isk.free?.();
    }
  });
});
