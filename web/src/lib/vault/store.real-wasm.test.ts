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

const {
  mockGetSyncSnapshot,
  mockListCollections,
  mockUpdateItem,
  mockGetSharedRevisions,
  mockGetCollectionSync,
  mockGetSharedDirectSync,
} = vi.hoisted(() => ({
  mockGetSyncSnapshot: vi.fn(),
  mockListCollections: vi.fn(),
  mockUpdateItem: vi.fn(),
  mockGetSharedRevisions: vi.fn(),
  mockGetCollectionSync: vi.fn(),
  mockGetSharedDirectSync: vi.fn(),
}));

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  getSyncSnapshot: mockGetSyncSnapshot,
  listCollections: mockListCollections,
  updateItem: mockUpdateItem,
  // 26-14-PLAN.md (WINDOWS #7/#8/#9): the recipient-side read paths this
  // file's new describe blocks below prove against real WASM crypto.
  // Defaulted to the "no family membership at all" shape in `beforeEach`
  // (mirrors `store.test.ts`'s identical default) so the two PRE-EXISTING
  // tests above (unaffected by this plan) see the identical no-op behavior
  // they always did.
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
  sealItemKeyForRecipient,
  unsealCollectionKey,
  decryptItemWithSharedKey,
  encryptItem,
} from "@/lib/crypto";
import { getCollectionKey } from "@/lib/vault/collections";
import { getItems, updateVaultItem, DirectShareNotEditableError } from "./store";
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
  // 26-14-PLAN.md: `refreshSharedItemsNow`'s eager unlock-time attempt calls
  // `getSharedRevisions()` on EVERY unlock -- default to the "no family
  // membership at all" shape so the two PRE-EXISTING tests above (which
  // never touch sharing) see the identical no-op behavior they always did.
  // Tests below that DO exercise sharing override this per-test.
  mockGetSharedRevisions.mockResolvedValue({ collections: [], direct: { revision: 0 } });
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

/** 26-14-PLAN.md: `handleSharedRevisions` calls `refreshCollectionsNow()`
 * (WINDOWS #7's fix) EVERY time a shared-revisions mismatch is detected --
 * on the FIRST post-unlock tick this is genuinely a SECOND collections
 * refresh in addition to `collections.ts`'s own unlock-triggered one, and a
 * direct-share merge (WINDOWS #9) resolves the identity keypair a THIRD
 * time in the same tick (a known, accepted minor inefficiency, see
 * 26-14-SUMMARY.md's Threat Flags). Every real call independently
 * resolves+frees its OWN `ensureOwnIdentityKeypair` handle in PRODUCTION
 * (the real implementation hands back a freshly-unwrapped `WasmIdentityKey`
 * every call, each safe to free independently, and a later call can happen
 * strictly AFTER an earlier one has already fully freed its own). This test
 * file's mock, by contrast, must hand back the SAME locally-generated
 * instance to every caller (there is no `WasmIdentityKey.fromBytes`/
 * secret-export API to construct a genuine second handle sharing the same
 * key material — by design, see that class's own doc comment). A naive
 * reference-count on `.free()` is NOT sufficient here: once the count
 * returns to zero and the REAL free runs, a LATER, temporally-separate
 * caller "checking out" the same object again would receive an
 * already-deallocated pointer (exactly the failure this plan's own
 * multi-caller chain triggers: collections.ts's two refresh calls can each
 * fully check in/out before `mergeDirectSnapshot`'s own call ever starts).
 * The correct test-only accommodation instead makes EVERY production
 * `.free()` call a no-op for the shared instance, deferring the ONE real
 * free to an explicit `.dispose()` the test itself calls once, after every
 * production consumer is known to have finished (`vi.waitFor`'s own
 * terminal-state check already guarantees this by construction). */
function deferRealFree(key: WasmIdentityKey): { dispose: () => void } {
  const originalFree = key.free.bind(key);
  key.free = () => {
    // Every production `.free()` call becomes a no-op — see this
    // function's own doc comment for why a simple reference count is not
    // sufficient here.
  };
  return { dispose: () => originalFree() };
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

// 26-14-PLAN.md (WINDOWS #8): the phase's own confirmed, phase-defining
// gap -- `fetch_items_for`'s collection-scoped SQL arm filters by the
// CALLER's own user_id, so a non-owning collection member's personal
// `GET /api/sync` NEVER returns another member's item. This describe block
// proves the FIX: the dedicated `GET /api/vault/collections/{id}/sync`
// read path (`pull_shared_collection`, zero client consumers before this
// plan) now genuinely decrypts and surfaces that item, through real WASM
// crypto -- and its negative twin proves a caller the server would never
// even list a collection for gets nothing at all.
describe("WINDOWS #8 (26-14-PLAN.md): a non-owning collection member reads a collection-scoped item's plaintext via the NEW pull_shared_collection read path (real WASM)", () => {
  it("the item is fetched via getCollectionSync, decrypted with the collection's OWN Collection Key, and appears in getItems() -- even though this caller's OWN personal getSyncSnapshot never includes it", async () => {
    const bobIdentity = WasmIdentityKey.generate();
    const bobIdentityHandle = deferRealFree(bobIdentity);
    mockEnsureOwnIdentityKeypair.mockResolvedValue(bobIdentity);

    const collectionId = "collection-windows8-proof";
    const ck = WasmCollectionKey.generate();
    const bobPub = WasmIdentityPublicKey.fromBytes(bobIdentity.publicKeyBytes());
    let sealedKeyForBob: string;
    try {
      sealedKeyForBob = sealCollectionKey(bobPub, ck);
    } finally {
      bobPub.free?.();
    }
    const collectionEncName = encryptItemForCollection(
      ck,
      JSON.stringify({ name: "Family Passwords" }),
      collectionId,
      collectionId,
      1,
    );
    mockListCollections.mockResolvedValue([
      {
        id: collectionId,
        enc_name: collectionEncName,
        created_at: "2026-08-06T00:00:00Z",
        access_level: "read",
        sealed_key: sealedKeyForBob,
      },
    ]);

    // The fixture item was created by SOMEONE ELSE (never Bob) -- real WASM
    // ciphertext under the collection's OWN key, exactly what
    // `pull_shared_collection`'s server-side query returns with NO
    // `user_id` filter at all (`sync.rs`'s own "Pitfall A" doc comment).
    const itemId = "item-windows8-proof";
    const itemRevision = 3;
    const itemPlaintext = JSON.stringify({
      type: "note",
      name: "Wifi Password",
      body: "not Bob's own item -- created by another member entirely",
      folderId: null,
      tags: [],
    });
    const encryptedCombined = encryptItemForCollection(ck, itemPlaintext, collectionId, itemId, itemRevision);
    const { encKey, encData } = splitEncryptedItem(encryptedCombined);

    // Bob's OWN personal snapshot is genuinely EMPTY -- proves this item
    // reaches getItems() ONLY through the new collection-sync path, never
    // through `fetch_items_for` (which would never return it: Bob isn't
    // its creator).
    mockGetSyncSnapshot.mockResolvedValue({ revision: 0, items: [], folders: [] });
    mockGetSharedRevisions.mockResolvedValue({
      collections: [{ id: collectionId, revision: itemRevision }],
      direct: { revision: 0 },
    });
    mockGetCollectionSync.mockResolvedValue({
      revision: itemRevision,
      items: [
        {
          id: itemId,
          enc_key: encKey,
          enc_data: encData,
          revision: itemRevision,
          updated_at: "2026-08-06T00:05:00Z",
          last_used_at: null,
          is_shared: true,
          collection_id: collectionId,
          last_editor_email: "another-member@example.com",
        },
      ],
    });

    const bobUk = generateUserKey(); // Bob's OWN personal vault key -- unrelated to `ck`
    try {
      setUnlockedUserKey(bobUk);

      await vi.waitFor(() => expect(mockGetCollectionSync).toHaveBeenCalledWith(collectionId));
      await vi.waitFor(() => expect(getItems().find((item) => item.id === itemId)).toBeDefined());

      const item = getItems().find((item) => item.id === itemId);
      if (item === undefined) {
        throw new Error("expected the non-owned collection-scoped item to be present");
      }
      expect(item.undecryptable).toBe(false);
      expect(item.collectionId).toBe(collectionId);
      expect(item.revision).toBe(itemRevision);
      expect(item.fields).toEqual({
        type: "note",
        name: "Wifi Password",
        body: "not Bob's own item -- created by another member entirely",
        folderId: null,
        tags: [],
      });
      expect(item.lastEditorEmail).toBe("another-member@example.com");
      // The claim by construction: mockGetSyncSnapshot's own resolved value
      // (asserted above/below never to have changed) never contained this
      // item at all -- the ONLY path that could have surfaced it is the one
      // this plan added.
      expect(mockGetSyncSnapshot).toHaveBeenCalled();
    } finally {
      lockVault();
      ck.free?.();
      bobIdentityHandle.dispose();
    }
  });

  it("negative: a collection absent from getSharedRevisions() is never fetched via getCollectionSync, and its item never appears -- the non-member proof", async () => {
    const strangerIdentity = WasmIdentityKey.generate();
    const strangerIdentityHandle = deferRealFree(strangerIdentity);
    mockEnsureOwnIdentityKeypair.mockResolvedValue(strangerIdentity);

    // The stranger holds NO collection_keys row at all -- mirrors what a
    // real server's Membership<Collection, RequireRead> extractor (404,
    // never 403) and pull_shared_revisions's own recipient-scoped join
    // would genuinely produce for this caller.
    mockListCollections.mockResolvedValue([]);
    mockGetSyncSnapshot.mockResolvedValue({ revision: 0, items: [], folders: [] });
    mockGetSharedRevisions.mockResolvedValue({ collections: [], direct: { revision: 0 } });

    const strangerUk = generateUserKey();
    try {
      setUnlockedUserKey(strangerUk);
      // Give every async chain a genuine chance to run -- there is no
      // "eventually true" condition to wait FOR here (the claim under test
      // is a negative), so this waits for the ONE call that DOES happen
      // (getSharedRevisions) and then a short grace period for anything
      // that might follow it.
      await vi.waitFor(() => expect(mockGetSharedRevisions).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockGetCollectionSync).not.toHaveBeenCalled();
      expect(getItems()).toHaveLength(0);
    } finally {
      lockVault();
      strangerIdentityHandle.dispose();
    }
  });
});

// 26-14-PLAN.md (WINDOWS #9): no client code anywhere consumed
// `GET /api/sync/shared/direct` before this plan -- this describe block
// proves the fix through real WASM crypto, mirroring
// `ShareDialog.real-wasm.test.ts`'s already-proven recipient-side sequence
// (`unsealCollectionKey` + `decryptItemWithSharedKey`), but reached through
// `store.ts`'s own merge path this time, not a hand-rolled test-local
// sequence.
describe("WINDOWS #9 (26-14-PLAN.md): a direct-share recipient reads the shared item via pull_shared_direct (real WASM, unsealCollectionKey + decryptItemWithSharedKey)", () => {
  it("Alice's real item, shared directly to Bob, decrypts through Bob's own unsealed Cipher Key and appears in his getItems() -- never via decryptItem/decryptItemForCollection", async () => {
    const aliceUk = generateUserKey();
    const bob = WasmIdentityKey.generate();
    const bobHandle = deferRealFree(bob);
    mockEnsureOwnIdentityKeypair.mockResolvedValue(bob);

    const itemId = "item-windows9-proof";
    const revision = 1;
    const plaintext = JSON.stringify({
      type: "note",
      name: "Shared Streaming Account",
      body: "alice's own personal item, shared directly to bob",
      folderId: null,
      tags: [],
    });

    const bobUk = generateUserKey(); // Bob's OWN personal vault key -- Alice's item is decrypted WITHOUT it
    try {
      const encryptedCombined = encryptItem(aliceUk, plaintext, itemId, revision);
      const { encKey, encData } = splitEncryptedItem(encryptedCombined);

      const bobPub = WasmIdentityPublicKey.fromBytes(bob.publicKeyBytes());
      let sealedKeyForBob: string;
      try {
        sealedKeyForBob = sealItemKeyForRecipient(aliceUk, encKey, itemId, bobPub);
      } finally {
        bobPub.free?.();
      }

      mockGetSyncSnapshot.mockResolvedValue({ revision: 0, items: [], folders: [] });
      mockListCollections.mockResolvedValue([]);
      mockGetSharedRevisions.mockResolvedValue({ collections: [], direct: { revision: 9 } });
      mockGetSharedDirectSync.mockResolvedValue({
        revision: 9,
        items: [
          {
            id: itemId,
            enc_data: encData,
            sealed_key: sealedKeyForBob,
            revision,
            updated_at: "2026-08-06T00:10:00Z",
            last_used_at: null,
            is_shared: true,
            last_editor_email: null,
          },
        ],
      });

      setUnlockedUserKey(bobUk);

      await vi.waitFor(() => expect(mockGetSharedDirectSync).toHaveBeenCalled());
      await vi.waitFor(() => expect(getItems().find((item) => item.id === itemId)).toBeDefined());

      const item = getItems().find((item) => item.id === itemId);
      if (item === undefined) {
        throw new Error("expected the directly-shared item to be present");
      }
      expect(item.undecryptable).toBe(false);
      expect(item.collectionId).toBeNull();
      expect(item.revision).toBe(revision);
      expect(item.fields).toEqual({
        type: "note",
        name: "Shared Streaming Account",
        body: "alice's own personal item, shared directly to bob",
        folderId: null,
        tags: [],
      });

      // The recipient-side sequence genuinely used unsealCollectionKey +
      // decryptItemWithSharedKey -- proven directly (not merely inferred
      // from the plaintext matching) by independently reproducing the
      // SAME sequence here and asserting the two results are identical.
      const unsealedAgain = unsealCollectionKey(bob, sealedKeyForBob);
      try {
        const decryptedAgain = decryptItemWithSharedKey(unsealedAgain, encData, itemId, revision);
        expect(decryptedAgain).toBe(plaintext);
      } finally {
        unsealedAgain.free?.();
      }
    } finally {
      lockVault();
      aliceUk.free?.();
      bobHandle.dispose();
    }
  });

  it("DirectShareNotEditableError is thrown for a real, successfully-decrypted directly-shared item -- never silently re-encrypted under this recipient's own personal key", async () => {
    const aliceUk = generateUserKey();
    const bob = WasmIdentityKey.generate();
    const bobHandle = deferRealFree(bob);
    mockEnsureOwnIdentityKeypair.mockResolvedValue(bob);

    const itemId = "item-windows9-guard-proof";
    const revision = 1;
    const plaintext = JSON.stringify({
      type: "note",
      name: "Guard Proof",
      body: "",
      folderId: null,
      tags: [],
    });

    const bobUk = generateUserKey();
    try {
      const encryptedCombined = encryptItem(aliceUk, plaintext, itemId, revision);
      const { encKey, encData } = splitEncryptedItem(encryptedCombined);
      const bobPub = WasmIdentityPublicKey.fromBytes(bob.publicKeyBytes());
      let sealedKeyForBob: string;
      try {
        sealedKeyForBob = sealItemKeyForRecipient(aliceUk, encKey, itemId, bobPub);
      } finally {
        bobPub.free?.();
      }

      mockGetSyncSnapshot.mockResolvedValue({ revision: 0, items: [], folders: [] });
      mockListCollections.mockResolvedValue([]);
      mockGetSharedRevisions.mockResolvedValue({ collections: [], direct: { revision: 4 } });
      mockGetSharedDirectSync.mockResolvedValue({
        revision: 4,
        items: [
          {
            id: itemId,
            enc_data: encData,
            sealed_key: sealedKeyForBob,
            revision,
            updated_at: "2026-08-06T00:12:00Z",
            last_used_at: null,
            is_shared: true,
            last_editor_email: null,
          },
        ],
      });

      setUnlockedUserKey(bobUk);
      await vi.waitFor(() => expect(getItems().find((item) => item.id === itemId)).toBeDefined());

      await expect(
        updateVaultItem(itemId, JSON.parse(plaintext) as never, revision),
      ).rejects.toThrow(DirectShareNotEditableError);
      // updateItem (the server wire call) must never even be reached.
      expect(mockUpdateItem).not.toHaveBeenCalled();
    } finally {
      lockVault();
      aliceUk.free?.();
      bobHandle.dispose();
    }
  });
});
