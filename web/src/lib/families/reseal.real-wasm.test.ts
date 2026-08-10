// The real-WASM proof for FSH-02's reseal composition (Plan 30-04) — the
// mechanism itself, never mocked. Mirrors `rekey.real-wasm.test.ts`'s exact
// `beforeAll` wiring: stubs ONLY `global.fetch` to serve the real compiled
// wasm binary off disk, never mocks `@/lib/crypto` itself. Every
// `unsealCollectionKey`/`sealCollectionKey` call this file exercises is a
// genuine wasm-bindgen call. Only the NETWORK layer (`@/lib/vault/api`'s
// `getCollection`/`addCollectionMember`, `families/api.ts`'s
// `getFamilyMembers`, and `@/lib/identity/ensure`'s
// `ensureOwnIdentityKeypair`) is stubbed — proving this composition preserves
// the exact Collection Key end to end through real crypto, never a mock.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initCrypto,
  WasmCollectionKey,
  WasmIdentityKey,
  WasmIdentityPublicKey,
  encryptItemForCollection,
  decryptItemForCollection,
  sealCollectionKey,
  unsealCollectionKey,
} from "@/lib/crypto";
import { base64Encode } from "@/lib/auth/api";

beforeAll(async () => {
  // `initCrypto()` hardcodes the fetch path "/wasm/pv_wasm_bg.wasm" -- stub
  // global fetch to serve the REAL compiled binary's bytes directly off
  // disk, rather than mocking the crypto module itself away. This is the
  // ONLY thing stubbed for the crypto boundary in this file; every crypto
  // call below runs the genuine wasm-bindgen bindings.
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

// The network layer this composition orchestrates is mocked -- never the
// crypto primitives themselves. `ensureOwnIdentityKeypair` is stubbed to
// hand back a REAL `WasmIdentityKey` directly (its own User-Key wrap/unwrap
// plumbing is a separate, already-proven primitive -- `identity/ensure.ts`
// has no real-WASM test of its own to duplicate here).
const { mockEnsureOwnIdentityKeypair, mockGetCollection, mockAddCollectionMember, mockGetFamilyMembers } =
  vi.hoisted(() => ({
    mockEnsureOwnIdentityKeypair: vi.fn(),
    mockGetCollection: vi.fn(),
    mockAddCollectionMember: vi.fn(),
    mockGetFamilyMembers: vi.fn(),
  }));

vi.mock("@/lib/identity/ensure", () => ({ ensureOwnIdentityKeypair: mockEnsureOwnIdentityKeypair }));
vi.mock("@/lib/vault/api", () => ({
  getCollection: mockGetCollection,
  addCollectionMember: mockAddCollectionMember,
}));
vi.mock("./api", () => ({ getFamilyMembers: mockGetFamilyMembers }));

import { reshareCollectionToNewMember } from "./reseal";
import type { WasmUserKey } from "@/lib/crypto";

const FAKE_UK = {} as WasmUserKey;
const COLLECTION_ID = "collection-reseal-1";
const RECIPIENT_USER_ID = "recipient-user-1";
const ACCESS_LEVEL = "read";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reshareCollectionToNewMember -- real-WASM proof (the mechanism itself, never mocked)", () => {
  it("the resealed blob, unsealed with the RECIPIENT's real identity secret key, decrypts to byte-identical Collection Key material as the ORIGINAL key the caller unwrapped", async () => {
    // 1. A real Collection Key, sealed to a real "caller" identity keypair
    //    -- simulating an existing collection_keys row the caller already
    //    holds a decryptable sealed_key for.
    const callerIdentity = WasmIdentityKey.generate();
    const recipientIdentity = WasmIdentityKey.generate();
    const originalCk = WasmCollectionKey.generate();
    let callerPublicKey: WasmIdentityPublicKey | undefined;
    let capturedSealedForRecipient: WasmCollectionKey | undefined;

    try {
      callerPublicKey = WasmIdentityPublicKey.fromBytes(callerIdentity.publicKeyBytes());
      const callerSealedBlob = sealCollectionKey(callerPublicKey, originalCk);

      // 2. Stub the network layer ONLY: getCollection returns the caller's
      //    own real sealed_key row; getFamilyMembers returns the
      //    recipient's real published public key; addCollectionMember
      //    captures the resealed blob instead of making a real HTTP call.
      mockEnsureOwnIdentityKeypair.mockResolvedValue(callerIdentity);
      mockGetCollection.mockResolvedValue({ sealed_key: callerSealedBlob });
      mockGetFamilyMembers.mockResolvedValue([
        {
          user_id: RECIPIENT_USER_ID,
          public_key: base64Encode(recipientIdentity.publicKeyBytes()),
        },
      ]);
      let capturedSealedJson: string | undefined;
      mockAddCollectionMember.mockImplementation(
        async (
          _collectionId: string,
          _recipientUserId: string,
          sealedKey: string,
          _accessLevel: string,
        ) => {
          capturedSealedJson = sealedKey;
        },
      );

      // 3. Run the actual composition under test -- no mock of
      //    unsealCollectionKey/sealCollectionKey anywhere in this file.
      await reshareCollectionToNewMember(
        COLLECTION_ID,
        RECIPIENT_USER_ID,
        ACCESS_LEVEL,
        FAKE_UK,
      );

      expect(mockAddCollectionMember).toHaveBeenCalledTimes(1);
      expect(capturedSealedJson).toBeDefined();

      // 4. The genuine SC4 real-WASM proof: unseal the CAPTURED blob with
      //    the RECIPIENT's own real identity secret key -- this only
      //    succeeds if `reshareCollectionToNewMember` genuinely sealed the
      //    SAME key to the recipient's real public key, not a corrupted or
      //    freshly-generated one.
      capturedSealedForRecipient = unsealCollectionKey(
        recipientIdentity,
        capturedSealedJson as string,
      );

      // `WasmCollectionKey` exposes no raw-byte getter -- equivalence is
      // proven via a real encrypt/decrypt round trip instead, mirroring
      // `rekey.real-wasm.test.ts`'s own established convention for this
      // exact limitation: encrypt under the ORIGINAL key, decrypt under the
      // recipient-unsealed one.
      const itemId = "item-reseal-1";
      const revision = 1;
      const plaintext = '{"type":"note","body":"reseal fixture secret"}';
      const encryptedJson = encryptItemForCollection(
        originalCk,
        plaintext,
        COLLECTION_ID,
        itemId,
        revision,
      );
      const decrypted = decryptItemForCollection(
        capturedSealedForRecipient,
        encryptedJson,
        COLLECTION_ID,
        itemId,
        revision,
      );
      expect(decrypted).toBe(plaintext);
    } finally {
      // `callerIdentity` is NOT freed here — ownership passes to
      // `reshareCollectionToNewMember` via the mocked `ensureOwnIdentityKeypair`
      // return value, and the function's own `finally` block frees it
      // internally (mirroring its real caller's ownership contract). Freeing
      // it again here would double-free the same WASM handle.
      capturedSealedForRecipient?.free?.();
      callerPublicKey?.free?.();
      originalCk.free?.();
      recipientIdentity.free?.();
    }
  });

  it("end to end through real pv-wasm calls: the caller's identity key and the collection's sealed_key are both resolved via genuine unseal/seal, no intermediate mock of the crypto steps", async () => {
    // A second, independent fixture pair -- proving the composition is not
    // accidentally coupled to state left over from the first case, and that
    // every crypto step (seal for the fixture setup, unseal inside
    // reshareCollectionToNewMember, seal inside reshareCollectionToNewMember,
    // unseal for this test's own verification) is a real wasm-bindgen call.
    const callerIdentity = WasmIdentityKey.generate();
    const recipientIdentity = WasmIdentityKey.generate();
    const originalCk = WasmCollectionKey.generate();
    let callerPublicKey: WasmIdentityPublicKey | undefined;
    let unsealedByRecipient: WasmCollectionKey | undefined;

    try {
      callerPublicKey = WasmIdentityPublicKey.fromBytes(callerIdentity.publicKeyBytes());
      const callerSealedBlob = sealCollectionKey(callerPublicKey, originalCk);

      mockEnsureOwnIdentityKeypair.mockResolvedValue(callerIdentity);
      mockGetCollection.mockResolvedValue({ sealed_key: callerSealedBlob });
      mockGetFamilyMembers.mockResolvedValue([
        {
          user_id: RECIPIENT_USER_ID,
          public_key: base64Encode(recipientIdentity.publicKeyBytes()),
        },
      ]);
      let capturedSealedJson: string | undefined;
      mockAddCollectionMember.mockImplementation(
        async (
          _collectionId: string,
          _recipientUserId: string,
          sealedKey: string,
          _accessLevel: string,
        ) => {
          capturedSealedJson = sealedKey;
        },
      );

      await reshareCollectionToNewMember(
        "collection-reseal-2",
        RECIPIENT_USER_ID,
        ACCESS_LEVEL,
        FAKE_UK,
      );

      unsealedByRecipient = unsealCollectionKey(recipientIdentity, capturedSealedJson as string);

      const itemId = "item-reseal-2";
      const revision = 1;
      const plaintext = '{"type":"note","body":"second real-wasm fixture secret"}';
      const encryptedJson = encryptItemForCollection(
        originalCk,
        plaintext,
        "collection-reseal-2",
        itemId,
        revision,
      );
      const decrypted = decryptItemForCollection(
        unsealedByRecipient,
        encryptedJson,
        "collection-reseal-2",
        itemId,
        revision,
      );
      expect(decrypted).toBe(plaintext);
    } finally {
      // See the first case's identical comment — `callerIdentity` is freed
      // internally by `reshareCollectionToNewMember`, not here.
      unsealedByRecipient?.free?.();
      callerPublicKey?.free?.();
      originalCk.free?.();
      recipientIdentity.free?.();
    }
  });
});
