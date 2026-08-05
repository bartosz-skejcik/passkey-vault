// WR-10 (24-REVIEW.md), carried forward per 25-07-PLAN.md's phase context:
// "The unit suite's `@/lib/crypto` mocking is a structural blind spot."
// Phase 24's Wave 5 live run found four real bugs no unit test could see
// (three invite flows missing `await initCrypto()`; a no-fragment route
// falling through to the login screen; a button unclickable under a modal
// overlay; a Revoke 404ing on a consumed invite). Code review then found the
// same mechanism had let a 100%-failure control ship green, because a test
// file mocked `@/lib/invite/crypto` wholesale. "Treat 'the unit test passes'
// as weak evidence for anything crypto-adjacent."
//
// This file is that fix's twin for Plan 25-02's rewrap-only primitive: it
// loads the REAL compiled wasm binary -- no mocking of `@/lib/crypto`
// anywhere in this file -- and proves the actual rewrap output round-trips
// through `decryptItemForCollection` under the new key, and is rejected
// under the old key -- mirroring `lib/invite/crypto.real-wasm.test.ts`'s
// exact `beforeAll` wiring (stub ONLY `global.fetch` for the wasm binary
// path, load the real compiled `.wasm` from `public/wasm/`).
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import {
  initCrypto,
  WasmCollectionKey,
  WasmIdentityKey,
  WasmIdentityPublicKey,
  encryptItemForCollection,
  decryptItemForCollection,
  rewrapItemKeyForCollection,
  sealCollectionKey,
  unsealCollectionKey,
} from "@/lib/crypto";

beforeAll(async () => {
  // `initCrypto()` hardcodes the fetch path "/wasm/pv_wasm_bg.wasm" -- stub
  // global fetch to serve the REAL compiled binary's bytes directly off
  // disk, rather than mocking the crypto module itself away. This is the
  // ONLY thing stubbed in this file; every crypto call below runs the
  // genuine wasm-bindgen bindings.
  const wasmPath = path.join(process.cwd(), "public", "wasm", "pv_wasm_bg.wasm");
  const wasmBytes = readFileSync(wasmPath);
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("pv_wasm_bg.wasm")) {
      return new Response(wasmBytes, { status: 200, headers: { "Content-Type": "application/wasm" } });
    }
    return originalFetch(input);
  }) as typeof fetch;

  await initCrypto();
});

/** `encryptItemForCollection`'s combined `{enc_key, enc_data}` JSON output
 * split into its two wire-shaped sub-fields -- the same split
 * `lib/vault/store.ts`'s `splitCombinedEncryptedItem` performs for the
 * server's two opaque-string columns, and the exact shape
 * `getCollectionItems`'s `CollectionItemRow.enc_key`/`enc_data` carry. */
function splitEncryptedItem(combinedJson: string): { encKey: string; encData: string } {
  const combined = JSON.parse(combinedJson) as { enc_key: unknown; enc_data: unknown };
  return { encKey: JSON.stringify(combined.enc_key), encData: JSON.stringify(combined.enc_data) };
}

/** Recombines a split enc_key/enc_data pair back into the single JSON string
 * `decryptItemForCollection` expects -- the inverse of `splitEncryptedItem`. */
function recombineEncryptedItem(encKey: string, encData: string): string {
  return JSON.stringify({
    enc_key: JSON.parse(encKey) as unknown,
    enc_data: JSON.parse(encData) as unknown,
  });
}

describe("rewrapItemKeyForCollection round-trips under the new key and is rejected under the old key", () => {
  it("real rewrap output decrypts under the NEW key with the original enc_data, and is rejected under the OLD key", () => {
    const collectionId = "collection-1";
    const itemId = "item-1";
    const revision = 1;
    const plaintext = '{"type":"note","body":"rekey fixture secret"}';

    const oldCk = WasmCollectionKey.generate();
    const newCk = WasmCollectionKey.generate();
    try {
      const encryptedJson = encryptItemForCollection(oldCk, plaintext, collectionId, itemId, revision);
      const { encKey, encData } = splitEncryptedItem(encryptedJson);

      // The wire-shaped rewrap this plan's `rekey.ts` actually performs:
      // ONLY the split-out enc_key JSON string crosses in, never enc_data --
      // the same signature discipline Plan 25-02 proved makes touching
      // payload ciphertext a compile-time impossibility.
      const newEncKey = rewrapItemKeyForCollection(oldCk, newCk, encKey, collectionId, itemId);

      const rewrappedItemJson = recombineEncryptedItem(newEncKey, encData);

      const decryptedUnderNewKey = decryptItemForCollection(
        newCk,
        rewrappedItemJson,
        collectionId,
        itemId,
        revision,
      );
      expect(decryptedUnderNewKey).toBe(plaintext);

      expect(() =>
        decryptItemForCollection(oldCk, rewrappedItemJson, collectionId, itemId, revision),
      ).toThrow();
    } finally {
      newCk.free?.();
      oldCk.free?.();
    }
  });
});

describe("sealCollectionKey/unsealCollectionKey round-trip a real CollectionKey through a real identity keypair", () => {
  it("unsealed key is usable to decrypt an item encrypted under the ORIGINAL CollectionKey", () => {
    const collectionId = "collection-2";
    const itemId = "item-2";
    const revision = 1;
    const plaintext = '{"type":"note","body":"seal round-trip fixture"}';

    const identityKey = WasmIdentityKey.generate();
    const originalCk = WasmCollectionKey.generate();
    let publicKey: WasmIdentityPublicKey | undefined;
    let unsealedCk: WasmCollectionKey | undefined;
    try {
      publicKey = WasmIdentityPublicKey.fromBytes(identityKey.publicKeyBytes());
      const sealedJson = sealCollectionKey(publicKey, originalCk);
      unsealedCk = unsealCollectionKey(identityKey, sealedJson);

      // `WasmCollectionKey` exposes no raw-byte getter -- equivalence is
      // proven via a real encrypt/decrypt round trip instead, mirroring
      // pv-wasm's own existing test convention for this exact limitation:
      // encrypt under the ORIGINAL key, decrypt under the UNSEALED one.
      const encryptedJson = encryptItemForCollection(originalCk, plaintext, collectionId, itemId, revision);
      const decrypted = decryptItemForCollection(unsealedCk, encryptedJson, collectionId, itemId, revision);
      expect(decrypted).toBe(plaintext);
    } finally {
      unsealedCk?.free?.();
      publicKey?.free?.();
      originalCk.free?.();
      identityKey.free?.();
    }
  });
});
