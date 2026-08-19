// Real-WASM proof for store.ts::moveVaultItem's destination-key dispatch
// (32-01-PLAN.md Task 2) -- mirrors store.real-wasm.test.ts's "encrypt
// dispatch" describe block (lines 277-427) exactly in setup shape: no
// `vi.mock("@/lib/crypto", ...)` anywhere in this file -- every
// seal/encrypt/decrypt call below runs the genuine wasm-bindgen bindings.
// Only the wire boundary is mocked: `getSyncSnapshot()`/`listCollections()`/
// `moveItemToCollection()` from `@/lib/vault/api`, plus
// `ensureOwnIdentityKeypair` from `@/lib/identity/ensure` (identity
// PLUMBING, not crypto -- stubbed to hand back a REAL, locally-generated
// `WasmIdentityKey`, mirroring `rekey.real-wasm-batch.test.ts`'s and
// `store.real-wasm.test.ts`'s identical precedent).
//
// This proves moveVaultItem's own encrypt-under-destination dispatch
// against genuine ciphertext, decrypted back through the real collection/
// personal decrypt paths -- the client-detectable half of ORG-02's
// refusal path (Test 4) and the destination-key-genuinely-differs claim
// (Tests 1/3's negative checks). Whether a REAL server actually accepts
// this wire shape is proven separately by 32-01-PLAN.md Task 1's live
// 2-session Playwright run -- never invented as a new live-server vitest
// harness here.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSyncSnapshot,
  mockListCollections,
  mockMoveItemToCollection,
  mockGetSharedRevisions,
  mockGetCollectionSync,
  mockGetSharedDirectSync,
} = vi.hoisted(() => ({
  mockGetSyncSnapshot: vi.fn(),
  mockListCollections: vi.fn(),
  mockMoveItemToCollection: vi.fn(),
  mockGetSharedRevisions: vi.fn(),
  mockGetCollectionSync: vi.fn(),
  mockGetSharedDirectSync: vi.fn(),
}));

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  getSyncSnapshot: mockGetSyncSnapshot,
  listCollections: mockListCollections,
  moveItemToCollection: mockMoveItemToCollection,
  // Same "unlock fires both the personal AND shared pipelines" reality
  // store.real-wasm.test.ts's own beforeEach documents -- defaulted to the
  // "no family membership at all" shape so every test below (none of which
  // exercises sharing) sees the identical no-op behavior.
  getSharedRevisions: mockGetSharedRevisions,
  getCollectionSync: mockGetCollectionSync,
  getSharedDirectSync: mockGetSharedDirectSync,
}));

const { mockEnsureOwnIdentityKeypair } = vi.hoisted(() => ({
  mockEnsureOwnIdentityKeypair: vi.fn(),
}));
vi.mock("@/lib/identity/ensure", () => ({
  ensureOwnIdentityKeypair: mockEnsureOwnIdentityKeypair,
}));

import {
  initCrypto,
  generateUserKey,
  setUnlockedUserKey,
  lockVault,
  WasmCollectionKey,
  WasmIdentityKey,
  WasmIdentityPublicKey,
  sealCollectionKey,
  encryptItemForCollection,
  decryptItemForCollection,
  decryptItem,
} from "@/lib/crypto";
import { getCollectionKey } from "@/lib/vault/collections";
import { CollectionKeyUnavailableError, moveVaultItem } from "./store";

beforeAll(async () => {
  // `initCrypto()` hardcodes the fetch path "/wasm/pv_wasm_bg.wasm" --
  // stub global fetch to serve the REAL compiled binary's bytes directly
  // off disk, identical to every other `*.real-wasm.test.ts` file's own
  // `beforeAll`.
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

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSharedRevisions.mockResolvedValue({ collections: [], direct: { revision: 0 } });
});

/** Registers two genuine, distinct WasmCollectionKey-backed collections
 * (sealed to a freshly-generated identity keypair) via the mocked
 * `listCollections()`, unlocks a fresh personal UserKey (which fires
 * BOTH store.ts's and collections.ts's real subscribeLockState listeners,
 * mirroring store.real-wasm.test.ts's own convention), and waits for both
 * Collection Keys to be genuinely cached before returning. */
async function setupTwoRealCollections(): Promise<{
  collectionAId: string;
  collectionBId: string;
  ckA: WasmCollectionKey;
  ckB: WasmCollectionKey;
}> {
  const identityKey = WasmIdentityKey.generate();
  mockEnsureOwnIdentityKeypair.mockResolvedValue(identityKey);

  const collectionAId = "collection-move-proof-a";
  const collectionBId = "collection-move-proof-b";
  const ckA = WasmCollectionKey.generate();
  const ckB = WasmCollectionKey.generate();
  const identityPub = WasmIdentityPublicKey.fromBytes(identityKey.publicKeyBytes());
  let sealedKeyA: string;
  let sealedKeyB: string;
  try {
    sealedKeyA = sealCollectionKey(identityPub, ckA);
    sealedKeyB = sealCollectionKey(identityPub, ckB);
  } finally {
    identityPub.free?.();
  }
  const encNameA = encryptItemForCollection(
    ckA,
    JSON.stringify({ name: "Move Proof Folder A" }),
    collectionAId,
    collectionAId,
    1,
  );
  const encNameB = encryptItemForCollection(
    ckB,
    JSON.stringify({ name: "Move Proof Folder B" }),
    collectionBId,
    collectionBId,
    1,
  );

  mockListCollections.mockResolvedValue([
    {
      id: collectionAId,
      enc_name: encNameA,
      created_at: "2026-08-19T00:00:00Z",
      access_level: "edit",
      sealed_key: sealedKeyA,
    },
    {
      id: collectionBId,
      enc_name: encNameB,
      created_at: "2026-08-19T00:00:00Z",
      access_level: "edit",
      sealed_key: sealedKeyB,
    },
  ]);
  mockGetSyncSnapshot.mockResolvedValue({ revision: 0, items: [], folders: [] });

  const uk = generateUserKey();
  setUnlockedUserKey(uk);

  await vi.waitFor(() => expect(getCollectionKey(collectionAId)).toBeDefined());
  await vi.waitFor(() => expect(getCollectionKey(collectionBId)).toBeDefined());

  return { collectionAId, collectionBId, ckA, ckB };
}

describe("store.ts encrypt dispatch: moveVaultItem re-encrypts under the DESTINATION scope's own key, all directions (real WASM, network mocked)", () => {
  it("Test 1 (personal -> collection): decrypts under the destination collection's key/AAD, and FAILS under a different collection's key", async () => {
    const { collectionAId, collectionBId, ckA, ckB } = await setupTwoRealCollections();
    try {
      const itemId = "item-move-proof-personal-to-collection";
      const currentRevision = 1;
      const fields = {
        type: "note" as const,
        name: "Personal Secret",
        body: "moved out of personal scope",
        folderId: null,
        tags: [],
      };

      let capturedEncKey: string | undefined;
      let capturedEncData: string | undefined;
      mockMoveItemToCollection.mockImplementation(
        (
          _id: string,
          _newCollectionId: string | null,
          encKey: string,
          encData: string,
          _expectedRevision: number,
        ) => {
          capturedEncKey = encKey;
          capturedEncData = encData;
          return Promise.resolve({
            revision: currentRevision + 1,
            collection_id: collectionBId,
            updated_at: "2026-08-19T00:05:00Z",
          });
        },
      );

      const updated = await moveVaultItem(itemId, fields, currentRevision, collectionBId);

      expect(mockMoveItemToCollection).toHaveBeenCalledTimes(1);
      if (capturedEncKey === undefined || capturedEncData === undefined) {
        throw new Error("moveItemToCollection was never called with wire ciphertext");
      }
      const combined = JSON.stringify({
        enc_key: JSON.parse(capturedEncKey) as unknown,
        enc_data: JSON.parse(capturedEncData) as unknown,
      });

      // THE central proof: decrypt the ciphertext moveVaultItem actually
      // sent, through the REAL destination collection path -- a genuine
      // successful AEAD open whose plaintext matches the original fields.
      const roundTripped = decryptItemForCollection(
        ckB,
        combined,
        collectionBId,
        itemId,
        currentRevision + 1,
      );
      expect(JSON.parse(roundTripped)).toEqual(fields);

      // Negative check: the SAME ciphertext, same AAD (collectionBId is
      // what was actually used to encrypt), but the WRONG key (ckA, a
      // genuinely different collection's key) -- must fail AEAD
      // authentication, proving the destination key genuinely differs per
      // destination, not merely per call.
      expect(() =>
        decryptItemForCollection(ckA, combined, collectionBId, itemId, currentRevision + 1),
      ).toThrow();

      expect(updated.collectionId).toBe(collectionBId);
      expect(updated.revision).toBe(currentRevision + 1);
      expect(updated.fields).toEqual(fields);
    } finally {
      lockVault();
      ckA.free?.();
      ckB.free?.();
    }
  });

  it("Test 2 (collection -> personal, ORG-04's move-out mechanism): decrypts via decryptItem under the caller's own UserKey", async () => {
    mockListCollections.mockResolvedValue([]);
    mockGetSyncSnapshot.mockResolvedValue({ revision: 0, items: [], folders: [] });

    const uk = generateUserKey();
    try {
      setUnlockedUserKey(uk);

      const itemId = "item-move-proof-collection-to-personal";
      const currentRevision = 3;
      const fields = {
        type: "note" as const,
        name: "Moved Back Out",
        body: "leaving the shared folder, back to personal scope",
        folderId: null,
        tags: [],
      };

      let capturedEncKey: string | undefined;
      let capturedEncData: string | undefined;
      mockMoveItemToCollection.mockImplementation(
        (
          _id: string,
          newCollectionId: string | null,
          encKey: string,
          encData: string,
          _expectedRevision: number,
        ) => {
          expect(newCollectionId).toBeNull();
          capturedEncKey = encKey;
          capturedEncData = encData;
          return Promise.resolve({
            revision: currentRevision + 1,
            collection_id: null,
            updated_at: "2026-08-19T00:06:00Z",
          });
        },
      );

      const updated = await moveVaultItem(itemId, fields, currentRevision, null);

      expect(mockMoveItemToCollection).toHaveBeenCalledTimes(1);
      if (capturedEncKey === undefined || capturedEncData === undefined) {
        throw new Error("moveItemToCollection was never called with wire ciphertext");
      }
      const combined = JSON.stringify({
        enc_key: JSON.parse(capturedEncKey) as unknown,
        enc_data: JSON.parse(capturedEncData) as unknown,
      });

      const roundTripped = decryptItem(uk, combined, itemId, currentRevision + 1);
      expect(JSON.parse(roundTripped)).toEqual(fields);

      expect(updated.collectionId).toBeNull();
      expect(updated.revision).toBe(currentRevision + 1);
      expect(updated.fields).toEqual(fields);
    } finally {
      lockVault();
    }
  });

  it("Test 3 (collection -> a different collection): decrypts under the NEW collection's key, and FAILS under the OLD one", async () => {
    const { collectionAId, collectionBId, ckA, ckB } = await setupTwoRealCollections();
    try {
      const itemId = "item-move-proof-collection-to-collection";
      const currentRevision = 5;
      const fields = {
        type: "note" as const,
        name: "Reshared Elsewhere",
        body: "moved between two distinct shared folders",
        folderId: null,
        tags: [],
      };

      let capturedEncKey: string | undefined;
      let capturedEncData: string | undefined;
      mockMoveItemToCollection.mockImplementation(
        (
          _id: string,
          _newCollectionId: string | null,
          encKey: string,
          encData: string,
          _expectedRevision: number,
        ) => {
          capturedEncKey = encKey;
          capturedEncData = encData;
          return Promise.resolve({
            revision: currentRevision + 1,
            collection_id: collectionAId,
            updated_at: "2026-08-19T00:07:00Z",
          });
        },
      );

      // Destination is collection A this time (the reverse direction from
      // Test 1) -- moveVaultItem's dispatch is destination-only, so this
      // exercises the identical code path against a genuinely different
      // pair of real keys, not a re-run of Test 1.
      const updated = await moveVaultItem(itemId, fields, currentRevision, collectionAId);

      expect(mockMoveItemToCollection).toHaveBeenCalledTimes(1);
      if (capturedEncKey === undefined || capturedEncData === undefined) {
        throw new Error("moveItemToCollection was never called with wire ciphertext");
      }
      const combined = JSON.stringify({
        enc_key: JSON.parse(capturedEncKey) as unknown,
        enc_data: JSON.parse(capturedEncData) as unknown,
      });

      const roundTripped = decryptItemForCollection(
        ckA,
        combined,
        collectionAId,
        itemId,
        currentRevision + 1,
      );
      expect(JSON.parse(roundTripped)).toEqual(fields);

      // Negative: same ciphertext/AAD collection id, wrong (OLD) key.
      expect(() =>
        decryptItemForCollection(ckB, combined, collectionAId, itemId, currentRevision + 1),
      ).toThrow();

      expect(updated.collectionId).toBe(collectionAId);
      expect(updated.revision).toBe(currentRevision + 1);
    } finally {
      lockVault();
      ckA.free?.();
      ckB.free?.();
    }
  });

  it("Test 4: getCollectionKey(newCollectionId) returning undefined throws CollectionKeyUnavailableError BEFORE any network call", async () => {
    mockListCollections.mockResolvedValue([]);
    mockGetSyncSnapshot.mockResolvedValue({ revision: 0, items: [], folders: [] });

    const uk = generateUserKey();
    try {
      setUnlockedUserKey(uk);

      const itemId = "item-move-proof-unavailable-key";
      const currentRevision = 1;
      const fields = {
        type: "note" as const,
        name: "Never Sent",
        body: "destination key was never cached",
        folderId: null,
        tags: [],
      };
      const neverCachedCollectionId = "collection-never-cached";

      // Precondition of the test itself: this collection genuinely has no
      // cached key (listCollections resolved to [] above).
      expect(getCollectionKey(neverCachedCollectionId)).toBeUndefined();

      await expect(
        moveVaultItem(itemId, fields, currentRevision, neverCachedCollectionId),
      ).rejects.toBeInstanceOf(CollectionKeyUnavailableError);

      // The client-detectable half of ORG-02's refusal path: fails before
      // ever reaching the network, never sending ciphertext encrypted
      // under the wrong (or no) key.
      expect(mockMoveItemToCollection).not.toHaveBeenCalled();
    } finally {
      lockVault();
    }
  });
});
