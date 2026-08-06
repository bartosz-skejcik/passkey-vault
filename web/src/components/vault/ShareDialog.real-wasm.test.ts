// SHARE-02's real-WASM 2-party proof (Plan 26-08, Task 2) -- mirrors
// `families/rekey.real-wasm.test.ts`'s EXISTING two-account harness shape
// exactly (see this plan's own "Test-tiering decision" context note): "two
// parties" are two independently, locally generated `WasmIdentityKey`s, no
// real second browser/process/server. Loads the REAL compiled wasm binary
// -- `@/lib/crypto` is NEVER mocked anywhere in this file. The ONLY mock is
// `createItemShare` (the network POST inside `shareItemWithRecipients`'s
// exported crypto+wire composition) -- this test proves the CRYPTO
// composition genuinely round-trips, not that the wire path reaches a real
// server (Task 1's mocked-fetch component tests already cover that shape,
// and the full real-client-to-real-server round trip is proven live by
// Plan 26-13's own scenario).
//
// Calls the EXPORTED `shareItemWithRecipients` from ShareDialog.tsx itself
// -- not a re-implementation of its crypto sequence -- so this test would
// actually catch a real regression in the component's own submit path
// (this plan's own phase-context advisory: re-deriving the sequence a test
// is supposed to prove is a mild cousin of a circularity defect this
// project has already hit).
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  initCrypto,
  generateUserKey,
  WasmIdentityKey,
  encryptItem,
  unsealCollectionKey,
  decryptItemWithSharedKey,
} from "@/lib/crypto";
import { base64Encode } from "@/lib/auth/api";

const { mockCreateItemShare } = vi.hoisted(() => ({
  mockCreateItemShare: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/vault/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/vault/api")>("@/lib/vault/api");
  return {
    ...actual,
    // The ONLY mock in this file -- avoids an actual network round trip
    // for the wire POST `shareItemWithRecipients` performs after sealing.
    // Every crypto call remains real.
    createItemShare: mockCreateItemShare,
  };
});

import { shareItemWithRecipients } from "./ShareDialog";

beforeAll(async () => {
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

/** `encryptItem`'s combined `{enc_key, enc_data}` JSON output split into its
 * two wire-shaped sub-fields -- the exact split `ShareDialog.tsx`'s own
 * `listItems()` row shape carries (`ItemRow.enc_key`/`enc_data`), and the
 * same split `rekey.real-wasm.test.ts` performs for the identical reason. */
function splitEncryptedItem(combinedJson: string): { encKey: string; encData: string } {
  const combined = JSON.parse(combinedJson) as { enc_key: unknown; enc_data: unknown };
  return { encKey: JSON.stringify(combined.enc_key), encData: JSON.stringify(combined.enc_data) };
}

describe("ShareDialog's real item-share crypto composition (2 locally-generated parties, no live server)", () => {
  it("Alice seals her real item's Cipher Key to Bob's real public key; Bob's real secret key genuinely unseals and decrypts it back to the original plaintext", async () => {
    const itemId = "item-real-wasm-1";
    const revision = 1;
    const plaintext = '{"type":"login","username":"alice","password":"s3cret-fixture"}';

    const aliceUk = generateUserKey();
    const bob = WasmIdentityKey.generate();

    try {
      const encryptedJson = encryptItem(aliceUk, plaintext, itemId, revision);
      const { encKey, encData } = splitEncryptedItem(encryptedJson);

      // The EXACT sequence ShareDialog's item-variant submit path performs.
      await shareItemWithRecipients(
        itemId,
        encKey,
        [{ user_id: "bob-user-id", public_key: base64Encode(bob.publicKeyBytes()) }],
        "edit",
        aliceUk,
      );

      expect(mockCreateItemShare).toHaveBeenCalledTimes(1);
      const [calledItemId, calledRecipientId, sealedKeyJson, calledAccessLevel] =
        mockCreateItemShare.mock.calls[0] as [string, string, string, string];
      expect(calledItemId).toBe(itemId);
      expect(calledRecipientId).toBe("bob-user-id");
      expect(calledAccessLevel).toBe("edit");

      // Bob's side: unseal with his OWN real secret key, then decrypt
      // Alice's untouched enc_data with the recovered raw key.
      const unsealed = unsealCollectionKey(bob, sealedKeyJson);
      const decrypted = decryptItemWithSharedKey(unsealed, encData, itemId, revision);
      expect(decrypted).toBe(plaintext);
      unsealed.free?.();
    } finally {
      bob.free?.();
      aliceUk.free?.();
    }
  });

  it("a DIFFERENT recipient's real secret key cannot unseal what was sealed to Bob", async () => {
    const itemId = "item-real-wasm-2";
    const revision = 1;
    const plaintext = '{"type":"note","body":"cross-party rejection fixture"}';

    const aliceUk = generateUserKey();
    const bob = WasmIdentityKey.generate();
    const mallory = WasmIdentityKey.generate();

    try {
      const encryptedJson = encryptItem(aliceUk, plaintext, itemId, revision);
      const { encKey } = splitEncryptedItem(encryptedJson);

      await shareItemWithRecipients(
        itemId,
        encKey,
        [{ user_id: "bob-user-id", public_key: base64Encode(bob.publicKeyBytes()) }],
        "read",
        aliceUk,
      );

      const [, , sealedKeyJson] = mockCreateItemShare.mock.calls.at(-1) as [string, string, string, string];
      expect(() => unsealCollectionKey(mallory, sealedKeyJson)).toThrow();
    } finally {
      mallory.free?.();
      bob.free?.();
      aliceUk.free?.();
    }
  });

  it("T-25-16: throws before any network call when the selected recipient has no published public key", async () => {
    const itemId = "item-real-wasm-3";
    const aliceUk = generateUserKey();
    try {
      const encryptedJson = encryptItem(aliceUk, '{"type":"note","body":"x"}', itemId, 1);
      const { encKey } = splitEncryptedItem(encryptedJson);

      mockCreateItemShare.mockClear();
      await expect(
        shareItemWithRecipients(itemId, encKey, [{ user_id: "no-key-user", public_key: null }], "read", aliceUk),
      ).rejects.toThrow();
      expect(mockCreateItemShare).not.toHaveBeenCalled();
    } finally {
      aliceUk.free?.();
    }
  });
});
