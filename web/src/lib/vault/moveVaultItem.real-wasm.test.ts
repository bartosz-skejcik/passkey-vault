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
  mockListItems,
} = vi.hoisted(() => ({
  mockGetSyncSnapshot: vi.fn(),
  mockListCollections: vi.fn(),
  mockMoveItemToCollection: vi.fn(),
  mockGetSharedRevisions: vi.fn(),
  mockGetCollectionSync: vi.fn(),
  mockGetSharedDirectSync: vi.fn(),
  // ME-05 (code review, Phase 32): moveVaultItem's own recovery/
  // classification catch block -- previously entirely untested -- reads
  // `listItems()` for a move-OUT probe (ME-03).
  mockListItems: vi.fn(),
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
  listItems: mockListItems,
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
import {
  CollectionKeyUnavailableError,
  NotItemOwnerError,
  RevisionConflictError,
  getItems,
  moveVaultItem,
} from "./store";

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

// ME-05 (code review, Phase 32): moveVaultItem's ENTIRE catch block --
// recovery, the C-2 revision+content conjunct, the "rethrow the ORIGINAL
// error on refetch failure" rule, and the 403/404 classification -- had
// ZERO test coverage before this describe block (the C-2 conjunct was
// tested only in ItemForm's own mirror, where moveVaultItem itself is a
// mock). Real WASM throughout, same discipline as every other describe
// block in this file: no `vi.mock("@/lib/crypto", ...)`, only the wire
// boundary (`./api`) is mocked.
describe("store.ts moveVaultItem: ownership guard, recovery, and error classification (ME-05/CR-01/CR-02/ME-03/ME-06/HI-01)", () => {
  /** Seeds ONE real collection (via the same collections.ts pipeline
   * setupTwoRealCollections uses) plus a genuine item inside it, encrypted
   * under the collection's own key -- but with `owned_by_caller: false` on
   * the wire, simulating an item authored by a FELLOW member (never the
   * caller). Drives the exact same `getSharedRevisions` ->
   * `getCollectionSync` sync pipeline production code uses, rather than
   * reaching into store.ts internals -- so `ownedByMe: false` lands in
   * `getItems()` the same way it would from a real server. */
  async function setupForeignCollectionItem(): Promise<{
    collectionId: string;
    ck: WasmCollectionKey;
    itemId: string;
    fields: { type: "note"; name: string; body: string; folderId: null; tags: string[] };
    itemRevision: number;
  }> {
    const identityKey = WasmIdentityKey.generate();
    mockEnsureOwnIdentityKeypair.mockResolvedValue(identityKey);

    const collectionId = "collection-foreign-owner";
    const ck = WasmCollectionKey.generate();
    const identityPub = WasmIdentityPublicKey.fromBytes(identityKey.publicKeyBytes());
    let sealedKey: string;
    try {
      sealedKey = sealCollectionKey(identityPub, ck);
    } finally {
      identityPub.free?.();
    }
    const encName = encryptItemForCollection(
      ck,
      JSON.stringify({ name: "Foreign Owner Folder" }),
      collectionId,
      collectionId,
      1,
    );
    mockListCollections.mockResolvedValue([
      {
        id: collectionId,
        enc_name: encName,
        created_at: "2026-08-19T00:00:00Z",
        access_level: "edit",
        sealed_key: sealedKey,
      },
    ]);

    const itemId = "item-foreign-owner";
    const itemRevision = 3;
    const fields = {
      type: "note" as const,
      name: "Not Mine",
      body: "authored by a fellow member, not the caller",
      folderId: null,
      tags: [],
    };
    const encryptedCombined = encryptItemForCollection(
      ck,
      JSON.stringify(fields),
      collectionId,
      itemId,
      itemRevision,
    );
    const parsed = JSON.parse(encryptedCombined) as { enc_key: unknown; enc_data: unknown };
    const itemRow = {
      id: itemId,
      enc_key: JSON.stringify(parsed.enc_key),
      enc_data: JSON.stringify(parsed.enc_data),
      revision: itemRevision,
      updated_at: "2026-08-19T00:10:00Z",
      last_used_at: null,
      is_shared: true,
      last_editor_email: null,
      collection_id: collectionId,
      // THE central fixture value: this row was NOT authored by the
      // caller.
      owned_by_caller: false,
    };

    mockGetSyncSnapshot.mockResolvedValue({ revision: 0, items: [], folders: [] });
    // Drives the real sync pipeline: a non-zero collection revision (vs.
    // the fresh-unlock watermark of 0) is what makes
    // `doHandleSharedRevisions` actually call `getCollectionSync`.
    mockGetSharedRevisions.mockResolvedValue({
      collections: [{ id: collectionId, revision: 1 }],
      direct: { revision: 0 },
    });
    mockGetCollectionSync.mockResolvedValue({ revision: 1, items: [itemRow] });

    const uk = generateUserKey();
    setUnlockedUserKey(uk);

    await vi.waitFor(() => expect(getCollectionKey(collectionId)).toBeDefined());
    await vi.waitFor(() => {
      const seeded = getItems().find((i) => i.id === itemId);
      expect(seeded).toBeDefined();
      expect(seeded?.ownedByMe).toBe(false);
      expect(seeded?.collectionId).toBe(collectionId);
    });

    return { collectionId, ck, itemId, fields, itemRevision };
  }

  it("CR-01: refuses (NotItemOwnerError) a move-out of a collection item the caller does not own, BEFORE any network call", async () => {
    const { itemId, fields, itemRevision } = await setupForeignCollectionItem();
    try {
      await expect(
        moveVaultItem(itemId, fields, itemRevision, null),
      ).rejects.toBeInstanceOf(NotItemOwnerError);
      expect(mockMoveItemToCollection).not.toHaveBeenCalled();
    } finally {
      lockVault();
    }
  });

  it("CR-01: does NOT refuse a move-out of the caller's OWN collection item (ownedByMe: true reaches the same guard and passes it)", async () => {
    mockListCollections.mockResolvedValue([]);
    mockGetSyncSnapshot.mockResolvedValue({ revision: 0, items: [], folders: [] });
    const uk = generateUserKey();
    try {
      setUnlockedUserKey(uk);
      const itemId = "item-own-move-out";
      const fields = {
        type: "note" as const,
        name: "Mine",
        body: "the caller's own item",
        folderId: null,
        tags: [],
      };
      mockMoveItemToCollection.mockResolvedValue({
        revision: 2,
        collection_id: null,
        updated_at: "2026-08-19T00:11:00Z",
      });
      // No pre-existing store entry at all (existingBeforeSave undefined)
      // -- the guard must not fire on an item it has no ownership
      // information for at all (the create-then-move sequence's own shape).
      const updated = await moveVaultItem(itemId, fields, 1, null);
      expect(updated.collectionId).toBeNull();
      expect(mockMoveItemToCollection).toHaveBeenCalledTimes(1);
    } finally {
      lockVault();
    }
  });

  it("F-2 (32-VERIFICATION.md gap closure): refuses (NotItemOwnerError) a move BETWEEN two shared folders of a collection item the caller does not own, BEFORE any network call", async () => {
    const { itemId, fields, itemRevision } = await setupForeignCollectionItem();
    try {
      // A DIFFERENT collection id than the item's current one -- the
      // verifier's exact probe shape (an edit-level member of the source
      // folder who also holds edit/ownership on a genuinely different
      // destination folder). CR-01's original guard only fired on
      // `newCollectionId === null`; this proves the destination-independent
      // extension.
      await expect(
        moveVaultItem(itemId, fields, itemRevision, "collection-a-different-shared-folder"),
      ).rejects.toBeInstanceOf(NotItemOwnerError);
      expect(mockMoveItemToCollection).not.toHaveBeenCalled();
    } finally {
      lockVault();
    }
  });

  it("F-2: does NOT refuse reselecting the item's OWN current collection (no actual re-scope) even when the caller does not own the item", async () => {
    const { collectionId, itemId, fields, itemRevision } = await setupForeignCollectionItem();
    try {
      mockMoveItemToCollection.mockResolvedValue({
        revision: itemRevision + 1,
        collection_id: collectionId,
        updated_at: "2026-08-19T00:15:00Z",
      });
      // Same destination as the item's current collection -- not a
      // re-scope at all, so the ownership guard must not fire even though
      // ownedByMe is false.
      const updated = await moveVaultItem(itemId, fields, itemRevision, collectionId);
      expect(updated.collectionId).toBe(collectionId);
      expect(mockMoveItemToCollection).toHaveBeenCalledTimes(1);
    } finally {
      lockVault();
    }
  });

  it("CR-02: recovery DECLINES when the fresh row is at the right destination/revision but its DECRYPTED content does not match this attempt's own -- the exact false-success shape C-2 exists to prevent", async () => {
    const { collectionId, ck, itemId } = await setupForeignCollectionItem();
    try {
      // This attempt's own content -- deliberately DIFFERENT from what the
      // fresh row (below) actually holds, simulating: save #1 committed
      // content A; the client never observed it; the user edited to B;
      // save #2 (THIS attempt) is B, and fails.
      const thisAttemptFields = {
        type: "note" as const,
        name: "Not Mine",
        body: "THIS ATTEMPT's content (B) -- must never be silently eaten",
        folderId: null,
        tags: [],
      };
      // The fresh row genuinely IS at the destination and at the exact
      // revision this attempt would compute (itemRevision + 1) -- the
      // revision conjunct ALONE would recover here. Its content is
      // SOMEONE ELSE's commit (content A), re-encrypted under the SAME
      // real collection key so the AEAD open succeeds and the mismatch is
      // provably a CONTENT mismatch, not a decrypt failure.
      const foreignPriorFields = {
        type: "note" as const,
        name: "Not Mine",
        body: "A PRIOR attempt's content (A) -- landed, but is not THIS attempt's",
        folderId: null,
        tags: [],
      };
      const freshEncrypted = encryptItemForCollection(
        ck,
        JSON.stringify(foreignPriorFields),
        collectionId,
        itemId,
        4, // itemRevision (3) + 1
      );
      const freshParsed = JSON.parse(freshEncrypted) as { enc_key: unknown; enc_data: unknown };
      mockGetCollectionSync.mockResolvedValueOnce({
        revision: 2,
        items: [
          {
            id: itemId,
            enc_key: JSON.stringify(freshParsed.enc_key),
            enc_data: JSON.stringify(freshParsed.enc_data),
            revision: 4,
            updated_at: "2026-08-19T00:12:00Z",
            last_used_at: null,
            is_shared: true,
            last_editor_email: null,
            collection_id: collectionId,
            owned_by_caller: true,
          },
        ],
      });
      mockMoveItemToCollection.mockRejectedValue(new Error("aborted"));

      // itemRevision (3) is the caller's own last-known revision here --
      // recovery would compute newRevision = 4, exactly matching the
      // fresh row above; a revision-only check would wrongly recover.
      await expect(
        moveVaultItem(itemId, thisAttemptFields, 3, collectionId),
      ).rejects.toThrow("aborted");
    } finally {
      lockVault();
    }
  });

  it("CR-02: recovery SUCCEEDS when the fresh row is at the right destination/revision AND its decrypted content genuinely matches this attempt's own", async () => {
    const { collectionId, ck, itemId } = await setupForeignCollectionItem();
    try {
      const thisAttemptFields = {
        type: "note" as const,
        name: "Not Mine",
        body: "THIS ATTEMPT's own content, genuinely landed",
        folderId: null,
        tags: [],
      };
      const freshEncrypted = encryptItemForCollection(
        ck,
        JSON.stringify(thisAttemptFields),
        collectionId,
        itemId,
        4,
      );
      const freshParsed = JSON.parse(freshEncrypted) as { enc_key: unknown; enc_data: unknown };
      mockGetCollectionSync.mockResolvedValueOnce({
        revision: 2,
        items: [
          {
            id: itemId,
            enc_key: JSON.stringify(freshParsed.enc_key),
            enc_data: JSON.stringify(freshParsed.enc_data),
            revision: 4,
            updated_at: "2026-08-19T00:13:00Z",
            last_used_at: null,
            is_shared: true,
            last_editor_email: null,
            collection_id: collectionId,
            owned_by_caller: true,
          },
        ],
      });
      mockMoveItemToCollection.mockRejectedValue(new Error("lost response"));

      const recovered = await moveVaultItem(itemId, thisAttemptFields, 3, collectionId);
      expect(recovered.revision).toBe(4);
      expect(recovered.fields).toEqual(thisAttemptFields);
    } finally {
      lockVault();
    }
  });

  it("F-3 (32-VERIFICATION.md gap closure): recovery DECLINES when the fresh row's decrypted content matches this attempt's own but its REVISION is not exactly this attempt's predicted newRevision -- isolates the revision conjunct from the content conjunct so removing ONLY the revision check is caught here even though content-match alone would wrongly pass", async () => {
    const { collectionId, ck, itemId } = await setupForeignCollectionItem();
    try {
      // Content this attempt submits is IDENTICAL to what the fresh row
      // below actually holds -- e.g. a no-op resubmission of unchanged
      // fields, or two independent attempts that happen to land the same
      // normalized content. Content match ALONE can never discriminate
      // this case (32-VERIFICATION.md F-3: deleting the revision conjunct
      // alone left the whole suite green, because every OTHER test that
      // reaches this branch also varies the content, so a content-only
      // implementation still passed them). Only the revision conjunct can
      // tell "this attempt's own commit" apart from "a foreign write that
      // coincidentally matches".
      const thisAttemptFields = {
        type: "note" as const,
        name: "Not Mine",
        body: "identical content -- content-match ALONE cannot tell this apart from a genuine recovery",
        folderId: null,
        tags: [],
      };
      // itemRevision (3) -> this attempt predicts newRevision = 4. The
      // fresh row below is at revision 6 -- NOT 4 -- simulating a foreign
      // write (this attempt's own commit never actually reached the
      // server at all) that happens to hold byte-identical content.
      const freshEncrypted = encryptItemForCollection(
        ck,
        JSON.stringify(thisAttemptFields),
        collectionId,
        itemId,
        6,
      );
      const freshParsed = JSON.parse(freshEncrypted) as { enc_key: unknown; enc_data: unknown };
      mockGetCollectionSync.mockResolvedValueOnce({
        revision: 2,
        items: [
          {
            id: itemId,
            enc_key: JSON.stringify(freshParsed.enc_key),
            enc_data: JSON.stringify(freshParsed.enc_data),
            revision: 6,
            updated_at: "2026-08-19T00:14:00Z",
            last_used_at: null,
            is_shared: true,
            last_editor_email: null,
            collection_id: collectionId,
            owned_by_caller: true,
          },
        ],
      });
      mockMoveItemToCollection.mockRejectedValue(new Error("aborted (revision-conjunct isolation)"));

      // Recovery must DECLINE despite the content match (revision 6 !==
      // predicted newRevision 4) -- the ORIGINAL error must propagate,
      // never a false "recovered" that would mis-file the store at
      // revision 4 while the server is actually at 6.
      await expect(moveVaultItem(itemId, thisAttemptFields, 3, collectionId)).rejects.toThrow(
        "aborted (revision-conjunct isolation)",
      );
    } finally {
      lockVault();
    }
  });

  it("ME-03: the recovery probe for a NON-NULL destination calls getCollectionSync (every author's rows), never listItems (caller-authored only)", async () => {
    const { collectionId, itemId, fields, itemRevision } = await setupForeignCollectionItem();
    try {
      mockGetCollectionSync.mockClear();
      mockGetCollectionSync.mockResolvedValueOnce({ revision: 2, items: [] });
      mockMoveItemToCollection.mockRejectedValue(new Error("network fail"));

      await expect(
        moveVaultItem(itemId, fields, itemRevision, collectionId),
      ).rejects.toThrow("network fail");

      expect(mockGetCollectionSync).toHaveBeenCalledWith(collectionId);
      expect(mockListItems).not.toHaveBeenCalled();
    } finally {
      lockVault();
    }
  });

  it("ME-03: the recovery probe for a NULL destination (move-out) calls listItems, never getCollectionSync (only the item's owner can ever reach this branch)", async () => {
    mockListCollections.mockResolvedValue([]);
    mockGetSyncSnapshot.mockResolvedValue({ revision: 0, items: [], folders: [] });
    const uk = generateUserKey();
    try {
      setUnlockedUserKey(uk);
      mockGetCollectionSync.mockClear();
      mockListItems.mockResolvedValueOnce([]);
      mockMoveItemToCollection.mockRejectedValue(new Error("network fail"));

      await expect(
        moveVaultItem("item-move-out-probe", { type: "note", name: "n", body: "b", folderId: null, tags: [] }, 1, null),
      ).rejects.toThrow("network fail");

      expect(mockListItems).toHaveBeenCalledTimes(1);
      expect(mockGetCollectionSync).not.toHaveBeenCalled();
    } finally {
      lockVault();
    }
  });

  it("rethrows the ORIGINAL error, not the refetch's, when the recovery probe itself fails (never masks a genuine refusal behind a network blip)", async () => {
    mockListCollections.mockResolvedValue([]);
    mockGetSyncSnapshot.mockResolvedValue({ revision: 0, items: [], folders: [] });
    const uk = generateUserKey();
    try {
      setUnlockedUserKey(uk);
      mockListItems.mockRejectedValueOnce(new Error("recovery probe network blip"));
      mockMoveItemToCollection.mockRejectedValue(new Error("original failure"));

      await expect(
        moveVaultItem("item-refetch-fails", { type: "note", name: "n", body: "b", folderId: null, tags: [] }, 1, null),
      ).rejects.toThrow("original failure");
    } finally {
      lockVault();
    }
  });

  it("ME-06/CR-01: a 403 with a NULL destination classifies as NotItemOwnerError (an ownership refusal, not a destination-key refusal)", async () => {
    mockListCollections.mockResolvedValue([]);
    mockGetSyncSnapshot.mockResolvedValue({ revision: 0, items: [], folders: [] });
    const uk = generateUserKey();
    try {
      setUnlockedUserKey(uk);
      mockListItems.mockResolvedValueOnce([]);
      mockMoveItemToCollection.mockRejectedValue(
        Object.assign(new Error("forbidden"), { status: 403 }),
      );

      await expect(
        moveVaultItem("item-403-null-dest", { type: "note", name: "n", body: "b", folderId: null, tags: [] }, 1, null),
      ).rejects.toBeInstanceOf(NotItemOwnerError);
    } finally {
      lockVault();
    }
  });

  it("ME-06: a 403 with a NON-NULL destination classifies as CollectionKeyUnavailableError (the pre-existing destination-access-lost shape, unchanged)", async () => {
    const { collectionId, itemId, fields, itemRevision } = await setupForeignCollectionItem();
    try {
      mockGetCollectionSync.mockResolvedValueOnce({ revision: 2, items: [] });
      mockMoveItemToCollection.mockRejectedValue(
        Object.assign(new Error("forbidden"), { status: 403 }),
      );

      await expect(
        moveVaultItem(itemId, fields, itemRevision, collectionId),
      ).rejects.toBeInstanceOf(CollectionKeyUnavailableError);
    } finally {
      lockVault();
    }
  });

  it("HI-01: a 404 (a FULLY revoked destination grant) classifies as CollectionKeyUnavailableError, not an unhandled raw 404", async () => {
    const { collectionId, itemId, fields, itemRevision } = await setupForeignCollectionItem();
    try {
      mockGetCollectionSync.mockResolvedValueOnce({ revision: 2, items: [] });
      mockMoveItemToCollection.mockRejectedValue(
        Object.assign(new Error("not found"), { status: 404 }),
      );

      await expect(
        moveVaultItem(itemId, fields, itemRevision, collectionId),
      ).rejects.toBeInstanceOf(CollectionKeyUnavailableError);
    } finally {
      lockVault();
    }
  });

  // Live-E2E-caught regression (code review, Phase 32): this fix's OWN
  // first draft still had `throw err` INSIDE the recovery probe's `catch`
  // block -- a throw inside a catch unwinds the stack immediately, so it
  // does NOT "fall through" to isConflictError/isForbiddenError/
  // isNotFoundError below in the SAME outer catch. Invisible against the
  // test above (its mocked probe SUCCEEDS, just finds nothing) and against
  // SC3's live demotion case (a mere demotion leaves read access, so the
  // probe never fails there) -- caught live by THIS exact shape: a FULL
  // revocation where the caller loses read access too, so the recovery
  // probe 404s right alongside the move itself. Reproduces that here with
  // BOTH the move AND the probe rejecting.
  it("HI-01 (live-E2E-caught): a 404 STILL classifies as CollectionKeyUnavailableError even when the recovery probe ITSELF also fails (both the move and the probe lose access together)", async () => {
    const { collectionId, itemId, fields, itemRevision } = await setupForeignCollectionItem();
    try {
      mockGetCollectionSync.mockRejectedValueOnce(
        Object.assign(new Error("not found"), { status: 404 }),
      );
      mockMoveItemToCollection.mockRejectedValue(
        Object.assign(new Error("not found"), { status: 404 }),
      );

      await expect(
        moveVaultItem(itemId, fields, itemRevision, collectionId),
      ).rejects.toBeInstanceOf(CollectionKeyUnavailableError);
    } finally {
      lockVault();
    }
  });

  it("ME-06 (live-E2E-caught shape): a 403 with a NULL destination STILL classifies as NotItemOwnerError even when the recovery probe (listItems) itself also fails", async () => {
    mockListCollections.mockResolvedValue([]);
    mockGetSyncSnapshot.mockResolvedValue({ revision: 0, items: [], folders: [] });
    const uk = generateUserKey();
    try {
      setUnlockedUserKey(uk);
      mockListItems.mockRejectedValueOnce(new Error("network blip during recovery"));
      mockMoveItemToCollection.mockRejectedValue(
        Object.assign(new Error("forbidden"), { status: 403 }),
      );

      await expect(
        moveVaultItem(
          "item-403-null-dest-probe-fails",
          { type: "note", name: "n", body: "b", folderId: null, tags: [] },
          1,
          null,
        ),
      ).rejects.toBeInstanceOf(NotItemOwnerError);
    } finally {
      lockVault();
    }
  });

  it("a 409 still classifies as RevisionConflictError -- unchanged by any of this describe block's other fixes", async () => {
    mockListCollections.mockResolvedValue([]);
    mockGetSyncSnapshot.mockResolvedValue({ revision: 0, items: [], folders: [] });
    const uk = generateUserKey();
    try {
      setUnlockedUserKey(uk);
      mockListItems.mockResolvedValueOnce([]);
      mockMoveItemToCollection.mockRejectedValue(
        Object.assign(new Error("conflict"), { status: 409 }),
      );

      await expect(
        moveVaultItem("item-409", { type: "note", name: "n", body: "b", folderId: null, tags: [] }, 1, null),
      ).rejects.toBeInstanceOf(RevisionConflictError);
    } finally {
      lockVault();
    }
  });
});
