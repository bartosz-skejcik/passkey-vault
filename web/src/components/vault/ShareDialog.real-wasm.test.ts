// SHARE-02's real-WASM 2-party proof (Plan 26-08, Task 2) -- mirrors
// `families/rekey.real-wasm.test.ts`'s EXISTING two-account harness shape
// exactly (see this plan's own "Test-tiering decision" context note): "two
// parties" are two independently, locally generated `WasmIdentityKey`s, no
// real second browser/process/server. Loads the REAL compiled wasm binary
// -- `@/lib/crypto` is NEVER mocked anywhere in this file. The ONLY mocks
// are the NETWORK layer this file's compositions orchestrate (never the
// crypto primitives themselves) -- this test proves the CRYPTO composition
// genuinely round-trips, not that the wire path reaches a real server
// (Task 1's mocked-fetch component tests already cover that shape, and the
// full real-client-to-real-server round trip is proven live by Plan
// 26-13/31-03's own e2e scenarios).
//
// Calls the EXPORTED `shareItemWithRecipients`/`submitRowsForExistingDestination`
// from ShareDialog.tsx itself -- not a re-implementation of their crypto
// sequences -- so this test would actually catch a real regression in the
// component's own submit paths (this plan's own phase-context advisory:
// re-deriving the sequence a test is supposed to prove is a mild cousin of
// a circularity defect this project has already hit).
//
// 31-03-PLAN.md Task 2 adds the ORG-03/SC3 describe block below: a new
// recipient added to an EXISTING destination (never a mint-new one)
// decrypts an item that was ALREADY IN the destination before they joined
// -- v0.4's WINDOWS #13, proven through `submitRowsForExistingDestination`'s
// real `reshareCollectionToNewMember` dispatch, never a mocked seal.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initCrypto,
  generateUserKey,
  WasmIdentityKey,
  WasmCollectionKey,
  WasmIdentityPublicKey,
  encryptItem,
  encryptItemForCollection,
  decryptItemForCollection,
  sealCollectionKey,
  unsealCollectionKey,
  decryptItemWithSharedKey,
  type WasmUserKey,
} from "@/lib/crypto";
import { base64Encode } from "@/lib/auth/api";

const {
  mockCreateItemShare,
  mockGetCollection,
  mockAddCollectionMember,
  mockEnsureOwnIdentityKeypair,
  mockGetFamilyMembers,
} = vi.hoisted(() => ({
  mockCreateItemShare: vi.fn().mockResolvedValue(undefined),
  // ORG-03/SC3 (31-03-PLAN.md Task 2): the network layer
  // `reshareCollectionToNewMember` (real, unmocked -- `@/lib/families/reseal`
  // is never mocked in this file) orchestrates. Every crypto call it makes
  // (`unsealCollectionKey`/`sealCollectionKey`) stays real.
  mockGetCollection: vi.fn(),
  mockAddCollectionMember: vi.fn(),
  mockEnsureOwnIdentityKeypair: vi.fn(),
  mockGetFamilyMembers: vi.fn(),
}));

vi.mock("@/lib/vault/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/vault/api")>("@/lib/vault/api");
  return {
    ...actual,
    // Avoids an actual network round trip for the wire POST
    // `shareItemWithRecipients` performs after sealing. Every crypto call
    // remains real.
    createItemShare: mockCreateItemShare,
    // ORG-03/SC3: the two network calls `reshareCollectionToNewMember`
    // makes -- `getCollection` (the caller's own sealed_key row) and
    // `addCollectionMember` (the grant POST). Mirrors
    // `families/reseal.real-wasm.test.ts`'s identical mocking boundary.
    getCollection: mockGetCollection,
    addCollectionMember: mockAddCollectionMember,
  };
});

vi.mock("@/lib/identity/ensure", () => ({
  ensureOwnIdentityKeypair: mockEnsureOwnIdentityKeypair,
}));

vi.mock("@/lib/families/api", () => ({
  getFamilyMembers: mockGetFamilyMembers,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

import { shareItemWithRecipients, submitRowsForExistingDestination, type RecipientRow } from "./ShareDialog";

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

// 31-03-PLAN.md Task 2 -- ORG-03/SC3, v0.4's WINDOWS #13: a person added to
// an EXISTING destination decrypts the items ALREADY IN IT, proven through
// real (unmocked) crypto. Calls `submitRowsForExistingDestination` -- the
// EXACT function Task 1 wired the folder-scope grant branch's
// existing-destination case to -- never a re-implementation of the
// unwrap-own-key/reseal-to-recipient composition. The item is encrypted
// under the real `originalCk` BEFORE the reshare call ever runs, so a
// successful decrypt on the recipient's side is only possible if
// `reshareCollectionToNewMember`'s internals genuinely unwrapped and
// resealed that SAME key.
describe("ORG-03/SC3: a new recipient on an EXISTING destination decrypts an item that was already in it (v0.4 WINDOWS #13)", () => {
  const COLLECTION_ID = "existing-destination-1";
  const RECIPIENT_USER_ID = "bob-user-existing";

  it("Bob, newly added via the dialog's real reshare dispatch, unwraps the destination's sealed_key and decrypts a PRE-EXISTING item back to the original plaintext", async () => {
    const ownerIdentity = WasmIdentityKey.generate();
    const bobIdentity = WasmIdentityKey.generate();
    const originalCk = WasmCollectionKey.generate();
    const ownerUk = generateUserKey();
    let ownerPublicKey: WasmIdentityPublicKey | undefined;
    let bobUnsealedCk: WasmCollectionKey | undefined;

    try {
      // 1. The destination's PRE-EXISTING item -- encrypted under the real
      //    CollectionKey BEFORE Bob is ever granted access. This is the
      //    exact ordering ORG-03/SC3 requires: decrypting content that
      //    predates the grant, not content created after it.
      const itemId = "item-preexisting-1";
      const revision = 1;
      const plaintext = '{"type":"login","username":"pre-existing","password":"already-here"}';
      const encryptedJson = encryptItemForCollection(originalCk, plaintext, COLLECTION_ID, itemId, revision);

      // 2. The OWNER's own real sealed_key row for this destination -- what
      //    `getCollection` returns, and what `reshareCollectionToNewMember`
      //    unwraps internally.
      ownerPublicKey = WasmIdentityPublicKey.fromBytes(ownerIdentity.publicKeyBytes());
      const ownerSealedBlob = sealCollectionKey(ownerPublicKey, originalCk);

      // 3. Stub the network layer ONLY (mirrors
      //    `families/reseal.real-wasm.test.ts`'s identical boundary):
      //    `ensureOwnIdentityKeypair` hands back the OWNER's real identity
      //    key, `getCollection` returns the owner's real sealed_key row,
      //    `getFamilyMembers` returns Bob's real published public key, and
      //    `addCollectionMember` captures the resealed blob instead of a
      //    real HTTP call.
      mockEnsureOwnIdentityKeypair.mockResolvedValue(ownerIdentity);
      mockGetCollection.mockResolvedValue({ sealed_key: ownerSealedBlob });
      mockGetFamilyMembers.mockResolvedValue([
        { user_id: RECIPIENT_USER_ID, public_key: base64Encode(bobIdentity.publicKeyBytes()) },
      ]);
      let capturedSealedJson: string | undefined;
      mockAddCollectionMember.mockImplementation(
        async (_collectionId: string, _recipientUserId: string, sealedKey: string, _accessLevel: string) => {
          capturedSealedJson = sealedKey;
        },
      );

      // 4. The ACTUAL production dispatch this plan's Task 1 wired: a row
      //    whose `currentLevel` is `null` (Bob has no prior grant on this
      //    destination) reconciles to "grant" via `reconcileRow`, which
      //    `submitRowsForExistingDestination` routes through
      //    `reshareCollectionToNewMember` -- never
      //    `WasmCollectionKey.generate()`, which would produce a key that
      //    cannot decrypt anything already in the destination (see the
      //    falsification below for exactly this failure mode).
      const row: RecipientRow = {
        userId: RECIPIENT_USER_ID,
        email: "bob@example.test",
        currentLevel: null,
        pendingLevel: "edit",
        suspended: false,
        publicKey: base64Encode(bobIdentity.publicKeyBytes()),
      };
      const { failedRecipients, committedAnything } = await submitRowsForExistingDestination(
        COLLECTION_ID,
        [row],
        ownerUk,
      );

      expect(failedRecipients).toEqual([]);
      expect(committedAnything).toBe(true);
      expect(mockAddCollectionMember).toHaveBeenCalledTimes(1);
      expect(capturedSealedJson).toBeDefined();

      // 5. The genuine SC3 real-WASM proof: unseal the CAPTURED blob with
      //    BOB's own real identity secret key, then decrypt the
      //    PRE-EXISTING item's real ciphertext -- this only succeeds if the
      //    resealed key is genuinely the SAME CollectionKey the item was
      //    originally encrypted under, read by a DIFFERENT recipient's own
      //    identity key, through the production dispatch path.
      bobUnsealedCk = unsealCollectionKey(bobIdentity, capturedSealedJson as string);
      const decrypted = decryptItemForCollection(bobUnsealedCk, encryptedJson, COLLECTION_ID, itemId, revision);
      expect(decrypted).toBe(plaintext);
    } finally {
      bobUnsealedCk?.free?.();
      ownerPublicKey?.free?.();
      originalCk.free?.();
      bobIdentity.free?.();
      ownerUk.free?.();
      // `ownerIdentity` is NOT freed here -- ownership passes to
      // `reshareCollectionToNewMember` via the mocked
      // `ensureOwnIdentityKeypair` return value, and that function's own
      // `finally` block frees it internally (mirrors
      // `reseal.real-wasm.test.ts`'s identical ownership-transfer comment).
      // Freeing it again here would double-free the same WASM handle.
    }
  });
});
