// Real-WASM proof for store.ts::decryptItemRow's scope dispatch (Task 2,
// 26-05-PLAN.md) — the phase's own self-declared CENTRAL PROOF. Per this
// plan's "Test-tiering decision" note: no `vi.mock("@/lib/crypto", ...)`
// anywhere in this file — every seal/unseal/encrypt/decrypt call below runs
// the genuine wasm-bindgen bindings. Only the wire boundary is mocked:
// `getSyncSnapshot()`/`listCollections()` from `@/lib/vault/api`, plus
// `ensureOwnIdentityKeypair` from `@/lib/identity/ensure` (identity
// PLUMBING, not crypto — stubbed to hand back a REAL, locally-generated
// `WasmIdentityKey`, mirroring `rekey.real-wasm-batch.test.ts`'s identical
// precedent).
//
// This proves the CLIENT'S decrypt-dispatch-by-scope logic against genuine
// ciphertext produced by a real `encryptItemForCollection` call. Whether a
// REAL server actually returns rows shaped this way is proven separately by
// Plan 26-01/26-04's Rust tests and by Plan 26-13's live 2-session
// Playwright run — never invented as a new live-server vitest harness here.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSyncSnapshot, mockListCollections, mockUpdateItem } = vi.hoisted(() => ({
  mockGetSyncSnapshot: vi.fn(),
  mockListCollections: vi.fn(),
  mockUpdateItem: vi.fn(),
}));

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  getSyncSnapshot: mockGetSyncSnapshot,
  listCollections: mockListCollections,
  updateItem: mockUpdateItem,
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
} from "@/lib/crypto";
import { getCollectionKey } from "@/lib/vault/collections";
import { getItems, updateVaultItem } from "./store";
import type { SyncSnapshot } from "./api";

beforeAll(async () => {
  // `initCrypto()` hardcodes the fetch path "/wasm/pv_wasm_bg.wasm" — stub
  // global fetch to serve the REAL compiled binary's bytes directly off
  // disk, identical to every other `*.real-wasm.test.ts` file's own
  // `beforeAll`.
  const wasmPath = path.join(process.cwd(), "public", "wasm", "pv_wasm_bg.wasm");
  const wasmBytes = readFileSync(wasmPath);
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("pv_wasm_bg.wasm")) {
      return new Response(wasmBytes, { status: 200, headers: { "Content-Type": "application/wasm" } });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  await initCrypto();
});

beforeEach(() => {
  vi.clearAllMocks();
});

/** `encryptItemForCollection`'s combined `{enc_key, enc_data}` JSON output
 * split into its two wire-shaped sub-fields — the same split
 * `lib/vault/store.ts`'s `splitCombinedEncryptedItem` performs for the
 * server's two opaque-string columns, and the exact shape `ItemRow.enc_key`/
 * `enc_data` carry (mirrors `rekey.real-wasm.test.ts`'s identical helper). */
function splitEncryptedItem(combinedJson: string): { encKey: string; encData: string } {
  const combined = JSON.parse(combinedJson) as { enc_key: unknown; enc_data: unknown };
  return { encKey: JSON.stringify(combined.enc_key), encData: JSON.stringify(combined.enc_data) };
}

describe("store.ts decrypt dispatch: a real collection-scoped item decrypts and appears in getItems() (real WASM, network mocked)", () => {
  it("appears fully decrypted with the correct fields and collectionId set -- never undecryptable: true", async () => {
    const identityKey = WasmIdentityKey.generate();
    mockEnsureOwnIdentityKeypair.mockResolvedValue(identityKey);

    const collectionId = "collection-central-proof";
    const ck = WasmCollectionKey.generate();
    const identityPub = WasmIdentityPublicKey.fromBytes(identityKey.publicKeyBytes());
    let sealedKey: string;
    try {
      sealedKey = sealCollectionKey(identityPub, ck);
    } finally {
      identityPub.free?.();
    }
    const collectionEncName = encryptItemForCollection(
      ck,
      JSON.stringify({ name: "Central Proof Folder" }),
      collectionId,
      collectionId,
      1,
    );
    mockListCollections.mockResolvedValue([
      {
        id: collectionId,
        enc_name: collectionEncName,
        created_at: "2026-08-06T00:00:00Z",
        access_level: "edit",
        sealed_key: sealedKey,
      },
    ]);

    // The fixture item: real WASM `encryptItemForCollection` output,
    // mirroring what `moveItemToCollection`'s real request body would carry
    // (Plan 26-01's wrapper) -- a real personal item's plaintext, encrypted
    // into the collection's own key with the collection-scoped AAD, at a
    // revision > 1 (CR-04's fix -- never hardcode 1, this mirrors what the
    // only real server path, vault::move_item, actually produces).
    const itemId = "item-central-proof";
    const itemRevision = 2;
    const itemPlaintext = JSON.stringify({
      type: "note",
      name: "Shared Family Secret",
      body: "central proof fixture",
      folderId: null,
      tags: [],
    });
    const encryptedCombined = encryptItemForCollection(ck, itemPlaintext, collectionId, itemId, itemRevision);
    const { encKey, encData } = splitEncryptedItem(encryptedCombined);

    // Deferred: getSyncSnapshot's resolution is held back until the
    // collections store has genuinely finished caching the key (see the
    // `vi.waitFor` below) -- this deterministically sequences store.ts's
    // personal-snapshot merge AFTER collections.ts's own refresh, rather
    // than relying on which of the two independently-triggered, unlock-fired
    // async listeners happens to win an unforced race. Both listeners are
    // genuinely independent in production (mirrors real app behavior); this
    // test asserts the steady-state claim the plan requires -- once the key
    // IS cached, the item decrypts correctly -- not the transient race
    // itself, which decryptItemRow's own undefined-key fallback (a SEPARATE,
    // mocked test in store.test.ts) already covers.
    let resolveSnapshot: (snapshot: SyncSnapshot) => void = () => {
      throw new Error("resolveSnapshot called before assignment");
    };
    const snapshotPromise = new Promise<SyncSnapshot>((resolve) => {
      resolveSnapshot = resolve;
    });
    mockGetSyncSnapshot.mockReturnValue(snapshotPromise);

    const uk = generateUserKey();
    try {
      setUnlockedUserKey(uk); // fires BOTH collections.ts's and store.ts's real subscribeLockState listeners

      await vi.waitFor(() => expect(getCollectionKey(collectionId)).toBeDefined());

      resolveSnapshot({
        revision: 1,
        items: [
          {
            id: itemId,
            enc_key: encKey,
            enc_data: encData,
            revision: itemRevision,
            updated_at: "2026-08-06T00:00:00Z",
            last_used_at: null,
            is_shared: true,
            collection_id: collectionId,
            last_editor_email: null,
          },
        ],
        folders: [],
      });

      await vi.waitFor(() => expect(getItems().find((item) => item.id === itemId)).toBeDefined());

      const item = getItems().find((item) => item.id === itemId);
      if (item === undefined) {
        throw new Error("expected the collection-scoped item to be present");
      }
      expect(item.undecryptable).toBe(false);
      expect(item.collectionId).toBe(collectionId);
      expect(item.revision).toBe(itemRevision);
      expect(item.fields).toEqual({
        type: "note",
        name: "Shared Family Secret",
        body: "central proof fixture",
        folderId: null,
        tags: [],
      });
    } finally {
      lockVault();
      ck.free?.();
    }
  });
});

// 26-05a (live data-corruption fix): mirrors the describe block above, but
// proves the ENCRYPT side -- store.ts::updateVaultItem's own scope dispatch
// (deferred-items.md's original finding). A test that only asserted
// "encryptItemForCollection was called" would NOT prove the item is still
// readable afterwards -- this test decrypts the exact ciphertext
// updateVaultItem sent to the (mocked) server, through the real collection
// path, and asserts the plaintext round-trips.
describe("store.ts encrypt dispatch: updateVaultItem re-encrypts a collection-scoped item so it is STILL decryptable through the collection path (real WASM, network mocked)", () => {
  it("a saved edit's ciphertext decrypts back to the new fields via decryptItemForCollection under the SAME collection key", async () => {
    const identityKey = WasmIdentityKey.generate();
    mockEnsureOwnIdentityKeypair.mockResolvedValue(identityKey);

    const collectionId = "collection-encrypt-proof";
    const ck = WasmCollectionKey.generate();
    const identityPub = WasmIdentityPublicKey.fromBytes(identityKey.publicKeyBytes());
    let sealedKey: string;
    try {
      sealedKey = sealCollectionKey(identityPub, ck);
    } finally {
      identityPub.free?.();
    }
    const collectionEncName = encryptItemForCollection(
      ck,
      JSON.stringify({ name: "Encrypt Proof Folder" }),
      collectionId,
      collectionId,
      1,
    );
    mockListCollections.mockResolvedValue([
      {
        id: collectionId,
        enc_name: collectionEncName,
        created_at: "2026-08-06T00:00:00Z",
        access_level: "edit",
        sealed_key: sealedKey,
      },
    ]);

    const itemId = "item-encrypt-proof";
    const originalRevision = 1;
    const originalPlaintext = JSON.stringify({
      type: "note",
      name: "Original Shared Secret",
      body: "before the edit",
      folderId: null,
      tags: [],
    });
    const originalCombined = encryptItemForCollection(
      ck,
      originalPlaintext,
      collectionId,
      itemId,
      originalRevision,
    );
    const { encKey: origEncKey, encData: origEncData } = splitEncryptedItem(originalCombined);

    // Same deferred-snapshot sequencing as the decrypt-dispatch proof above:
    // deterministically ensures the initial load merges AFTER the
    // collection key is genuinely cached, so the item is present in
    // getItems() (with a real collectionId) BEFORE updateVaultItem is
    // called -- updateVaultItem's own dispatch reads that in-memory item's
    // collectionId via its `existingBeforeSave` lookup.
    let resolveSnapshot: (snapshot: SyncSnapshot) => void = () => {
      throw new Error("resolveSnapshot called before assignment");
    };
    const snapshotPromise = new Promise<SyncSnapshot>((resolve) => {
      resolveSnapshot = resolve;
    });
    mockGetSyncSnapshot.mockReturnValue(snapshotPromise);

    const uk = generateUserKey();
    try {
      setUnlockedUserKey(uk);

      await vi.waitFor(() => expect(getCollectionKey(collectionId)).toBeDefined());

      resolveSnapshot({
        revision: 1,
        items: [
          {
            id: itemId,
            enc_key: origEncKey,
            enc_data: origEncData,
            revision: originalRevision,
            updated_at: "2026-08-06T00:00:00Z",
            last_used_at: null,
            is_shared: true,
            collection_id: collectionId,
            last_editor_email: null,
          },
        ],
        folders: [],
      });

      await vi.waitFor(() => expect(getItems().find((item) => item.id === itemId)).toBeDefined());
      const beforeEdit = getItems().find((item) => item.id === itemId);
      if (beforeEdit === undefined) {
        throw new Error("expected the collection-scoped item to be present before the edit");
      }
      expect(beforeEdit.collectionId).toBe(collectionId);

      // Capture the exact wire args updateVaultItem sends -- this is the
      // real proof surface, not a spy assertion on which function was
      // called.
      let capturedEncKey: string | undefined;
      let capturedEncData: string | undefined;
      mockUpdateItem.mockImplementation(
        (_id: string, encKey: string, encData: string, _expectedRevision: number) => {
          capturedEncKey = encKey;
          capturedEncData = encData;
          return Promise.resolve({ revision: 2, updated_at: "2026-08-06T00:05:00Z" });
        },
      );

      const newFields = {
        type: "note" as const,
        name: "Edited Shared Secret",
        body: "after the edit -- via a full-edit member",
        folderId: null,
        tags: ["family"],
      };

      const updated = await updateVaultItem(itemId, newFields, originalRevision);

      // The dispatch reached the server call at all (never blocked).
      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      if (capturedEncKey === undefined || capturedEncData === undefined) {
        throw new Error("updateItem was never called with wire ciphertext");
      }

      // THE central proof: decrypt the ciphertext updateVaultItem actually
      // sent, through the REAL collection path, using the SAME collection
      // key -- not a mock assertion, an actual successful AEAD open whose
      // plaintext matches the new fields exactly.
      const combinedForDecrypt = JSON.stringify({
        enc_key: JSON.parse(capturedEncKey) as unknown,
        enc_data: JSON.parse(capturedEncData) as unknown,
      });
      const roundTrippedPlaintext = decryptItemForCollection(
        ck,
        combinedForDecrypt,
        collectionId,
        itemId,
        2, // originalRevision + 1, the AD-binding revision updateVaultItem used
      );
      expect(JSON.parse(roundTrippedPlaintext)).toEqual(newFields);

      // The in-memory item was updated in place, still scoped to the same
      // collection.
      expect(updated.collectionId).toBe(collectionId);
      expect(updated.revision).toBe(2);
      expect(updated.fields).toEqual(newFields);
    } finally {
      lockVault();
      ck.free?.();
    }
  });
});
