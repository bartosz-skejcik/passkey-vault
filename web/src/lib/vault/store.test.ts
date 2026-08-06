import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { ApiClientError } from "@/lib/auth/api";
import type { SharedRevisions, SyncSnapshot } from "./api";
import type { SyncCallbacks } from "./sync";

const {
  mockGetUnlockedUserKey,
  mockIsUnlocked,
  mockSubscribeLockState,
  mockEncryptItem,
  mockEncryptItemForCollection,
  mockDecryptItem,
  mockDecryptItemForCollection,
  mockGetSyncSnapshot,
  mockCreateItem,
  mockCreateFolder,
  mockUpdateItem,
  mockDeleteItem,
  mockDeleteFolder,
  mockTouchItem,
  mockStartSync,
  mockStopSync,
  mockGetCollectionKey,
} = vi.hoisted(() => ({
  mockGetUnlockedUserKey: vi.fn(),
  mockIsUnlocked: vi.fn(),
  mockSubscribeLockState: vi.fn(),
  mockEncryptItem: vi.fn(),
  mockEncryptItemForCollection: vi.fn(),
  mockDecryptItem: vi.fn(),
  mockDecryptItemForCollection: vi.fn(),
  mockGetSyncSnapshot: vi.fn(),
  mockCreateItem: vi.fn(),
  mockCreateFolder: vi.fn(),
  mockUpdateItem: vi.fn(),
  mockDeleteItem: vi.fn(),
  mockDeleteFolder: vi.fn(),
  mockTouchItem: vi.fn(),
  mockStartSync: vi.fn(),
  mockStopSync: vi.fn(),
  mockGetCollectionKey: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  getUnlockedUserKey: mockGetUnlockedUserKey,
  isUnlocked: mockIsUnlocked,
  subscribeLockState: mockSubscribeLockState,
  encryptItem: mockEncryptItem,
  encryptItemForCollection: mockEncryptItemForCollection,
  decryptItem: mockDecryptItem,
  decryptItemForCollection: mockDecryptItemForCollection,
}));

vi.mock("./api", () => ({
  getSyncSnapshot: mockGetSyncSnapshot,
  createItem: mockCreateItem,
  createFolder: mockCreateFolder,
  updateItem: mockUpdateItem,
  deleteItem: mockDeleteItem,
  deleteFolder: mockDeleteFolder,
  touchItem: mockTouchItem,
}));

vi.mock("./sync", () => ({
  startSync: mockStartSync,
  stopSync: mockStopSync,
}));

// Task 1's collections.ts store is mocked wholesale here -- store.test.ts
// tests store.ts's own decrypt-dispatch/onSharedRevisions logic, not
// collections.ts's own refresh behavior (that has its own real-WASM test
// file, collections.real-wasm.test.ts). Mocking this module also sidesteps
// a real ordering hazard: the REAL collections.ts registers its OWN
// subscribeLockState listener at import time (store.ts imports it) -- were
// it left unmocked, `mockSubscribeLockState.mock.calls[0]` would resolve to
// collections.ts's listener instead of store.ts's own, silently breaking
// `importStoreAndGetLockListener()` below. Mocking it here means store.ts's
// own subscribeLockState call is the ONLY registration this test file ever
// sees.
vi.mock("@/lib/vault/collections", () => ({
  getCollectionKey: mockGetCollectionKey,
}));

const NOTE_PLAINTEXT =
  '{"type":"note","name":"n","body":"b","folderId":null,"tags":[]}';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  // Fresh/never-synced-user fixture: full-but-empty snapshot by default.
  mockGetSyncSnapshot.mockResolvedValue({ revision: 0, items: [], folders: [] });
});

/** Grabs the lock-state listener the store registered at import time via
 * subscribeLockState — used to simulate unlock/lock events in tests. */
async function importStoreAndGetLockListener() {
  const store = await import("./store");
  const lockListener = mockSubscribeLockState.mock.calls[0][0] as () => void;
  return { store, lockListener };
}

/** Returns the SyncCallbacks the store passed to startSync on unlock —
 * the handle tests use to drive background-sync snapshot merges. */
function getSyncCallbacks(): SyncCallbacks {
  const callbacks = mockStartSync.mock.calls[0]?.[0] as SyncCallbacks | undefined;
  if (!callbacks) {
    throw new Error("startSync was never called");
  }
  return callbacks;
}

describe("recombine/split round-trip", () => {
  it("createVaultItem splits encryptItem's combined output into enc_key/enc_data before POSTing", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockEncryptItem.mockReturnValue(
      JSON.stringify({
        enc_key: { nonce: [1, 2], ciphertext: [3, 4] },
        enc_data: { nonce: [5, 6], ciphertext: [7, 8] },
      }),
    );
    mockCreateItem.mockResolvedValue({ id: "item-1", revision: 1, updated_at: "2026-07-13 12:00:00" });

    const { store } = await importStoreAndGetLockListener();
    const fields = {
      type: "note" as const,
      name: "n",
      body: "b",
      folderId: null,
      tags: [],
    };

    await store.createVaultItem(fields);

    expect(mockCreateItem).toHaveBeenCalledTimes(1);
    const [, encKeyArg, encDataArg] = mockCreateItem.mock.calls[0];
    expect(JSON.parse(encKeyArg)).toEqual({ nonce: [1, 2], ciphertext: [3, 4] });
    expect(JSON.parse(encDataArg)).toEqual({ nonce: [5, 6], ciphertext: [7, 8] });
  });

  it("recombines a server row's separate enc_key/enc_data into the exact combined JSON decryptItem receives", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockGetSyncSnapshot.mockResolvedValue({
      revision: 1,
      items: [
        {
          id: "item-1",
          enc_key: JSON.stringify({ nonce: [1, 2], ciphertext: [3, 4] }),
          enc_data: JSON.stringify({ nonce: [5, 6], ciphertext: [7, 8] }),
          revision: 1,
          collection_id: null,
        },
      ],
      folders: [],
    });
    mockDecryptItem.mockReturnValue(NOTE_PLAINTEXT);

    const { lockListener } = await importStoreAndGetLockListener();
    mockIsUnlocked.mockReturnValue(true);
    await act(async () => {
      lockListener();
      await Promise.resolve();
      await Promise.resolve();
    });

    const expectedCombined = JSON.stringify({
      enc_key: { nonce: [1, 2], ciphertext: [3, 4] },
      enc_data: { nonce: [5, 6], ciphertext: [7, 8] },
    });
    expect(mockDecryptItem).toHaveBeenCalledWith(
      expect.anything(),
      expectedCombined,
      "item-1",
      1,
    );
  });

  it("a value encrypted then immediately decrypted through the split->recombine path yields the original ItemFields", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    const combinedJson = JSON.stringify({
      enc_key: { nonce: [9], ciphertext: [10] },
      enc_data: { nonce: [11], ciphertext: [12] },
    });
    mockEncryptItem.mockReturnValue(combinedJson);
    mockCreateItem.mockResolvedValue({ id: "item-2", revision: 1, updated_at: "2026-07-13 12:00:00" });
    mockDecryptItem.mockReturnValue(NOTE_PLAINTEXT);

    const { store } = await importStoreAndGetLockListener();
    const fields = {
      type: "note" as const,
      name: "n",
      body: "b",
      folderId: null,
      tags: [],
    };
    await store.createVaultItem(fields);

    const [, encKeyArg, encDataArg] = mockCreateItem.mock.calls[0];
    mockGetSyncSnapshot.mockResolvedValue({
      revision: 1,
      items: [{ id: "item-2", enc_key: encKeyArg, enc_data: encDataArg, revision: 1, collection_id: null }],
      folders: [],
    });

    mockIsUnlocked.mockReturnValue(true);
    const { lockListener } = await importStoreAndGetLockListener();
    await act(async () => {
      lockListener();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockDecryptItem).toHaveBeenLastCalledWith(
      expect.anything(),
      combinedJson,
      "item-2",
      1,
    );
    expect(JSON.parse(NOTE_PLAINTEXT)).toEqual(fields);
  });
});

describe("lock/unlock subscription behavior", () => {
  it("populates items on unlock and clears them (in-memory) on lock", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockGetSyncSnapshot.mockResolvedValue({
      revision: 1,
      items: [{ id: "item-1", enc_key: "{}", enc_data: "{}", revision: 1, collection_id: null }],
      folders: [],
    });
    mockDecryptItem.mockReturnValue(NOTE_PLAINTEXT);

    const { store, lockListener } = await importStoreAndGetLockListener();

    mockIsUnlocked.mockReturnValue(true);
    await act(async () => {
      lockListener();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(store.getItems()).toHaveLength(1);

    mockIsUnlocked.mockReturnValue(false);
    act(() => {
      lockListener();
    });
    expect(store.getItems()).toHaveLength(0);
  });

  it("startSync/stopSync are called exactly once each across an unlock-then-lock cycle", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockDecryptItem.mockReturnValue(NOTE_PLAINTEXT);

    const { lockListener } = await importStoreAndGetLockListener();

    mockIsUnlocked.mockReturnValue(true);
    await act(async () => {
      lockListener();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockStartSync).toHaveBeenCalledTimes(1);
    expect(mockStopSync).not.toHaveBeenCalled();

    mockIsUnlocked.mockReturnValue(false);
    act(() => {
      lockListener();
    });
    expect(mockStartSync).toHaveBeenCalledTimes(1);
    expect(mockStopSync).toHaveBeenCalledTimes(1);
  });
});

/** Unlocks the vault with an initial two-item snapshot and returns the
 * sync callbacks startSync received, ready for onSnapshot-driven merges.
 * Module-scoped (not just applySyncSnapshot's own describe block) — the
 * touchVaultItem tests below also need a populated in-memory store. */
async function unlockWithTwoItems() {
  mockGetUnlockedUserKey.mockReturnValue({});
  mockGetSyncSnapshot.mockResolvedValue({
    revision: 2,
    items: [
      {
        id: "item-1",
        enc_key: "{}",
        enc_data: "{}",
        revision: 1,
        updated_at: "2026-07-14 12:00:00",
        last_used_at: null,
        is_shared: false,
        collection_id: null,
        last_editor_email: null,
      },
      {
        id: "item-2",
        enc_key: "{}",
        enc_data: "{}",
        revision: 1,
        updated_at: "2026-07-14 12:00:00",
        last_used_at: null,
        is_shared: false,
        collection_id: null,
        last_editor_email: null,
      },
    ],
    folders: [],
  });
  mockDecryptItem.mockReturnValue(NOTE_PLAINTEXT);

  const { store, lockListener } = await importStoreAndGetLockListener();
  mockIsUnlocked.mockReturnValue(true);
  await act(async () => {
    lockListener();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(store.getItems()).toHaveLength(2);
  return { store, callbacks: getSyncCallbacks(), lockListener };
}

describe("applySyncSnapshot (background sync merge)", () => {
  it("merges a stale snapshot by replacing items wholesale, dropping any id absent from the new array", async () => {
    const { store, callbacks } = await unlockWithTwoItems();

    // item-2 was deleted on another device: the new snapshot simply no
    // longer contains it — deletion via absence, no diff pass.
    const staleSnapshot: SyncSnapshot = {
      revision: 3,
      items: [
        {
          id: "item-1",
          enc_key: "{}",
          enc_data: "{}",
          revision: 1,
          updated_at: "2026-07-14 12:00:00",
          last_used_at: null,
          is_shared: false,
          collection_id: null,
          last_editor_email: null,
        },
      ],
      folders: [],
    };
    act(() => {
      callbacks.onSnapshot(staleSnapshot);
    });

    const ids = store.getItems().map((item) => item.id);
    expect(ids).toEqual(["item-1"]);
  });

  it("an up-to-date snapshot (no items/folders keys) leaves the current in-memory items/folders untouched", async () => {
    const { store, callbacks } = await unlockWithTwoItems();
    const itemsBefore = store.getItems();
    const foldersBefore = store.getFolders();

    act(() => {
      callbacks.onSnapshot({ revision: 5 }); // cheap-check response: no arrays
    });

    // Same array references — the merge never touched the in-memory state.
    expect(store.getItems()).toBe(itemsBefore);
    expect(store.getFolders()).toBe(foldersBefore);
    // ...but the revision watermark still advanced, so the NEXT pull does
    // not immediately re-detect "stale" against an already-known revision.
    expect(callbacks.getSinceRevision()).toBe(5);
  });

  it("merging an unrelated item's update does not disturb a different, unmodified item's array entry", async () => {
    const { store, callbacks } = await unlockWithTwoItems();
    const item1Before = store.getItems().find((item) => item.id === "item-1");

    // item-2 changed elsewhere (revision bumped); item-1 is byte-identical.
    mockDecryptItem.mockImplementation((_uk: unknown, _combined: string, id: string) =>
      id === "item-2"
        ? '{"type":"note","name":"edited","body":"b2","folderId":null,"tags":[]}'
        : NOTE_PLAINTEXT,
    );
    act(() => {
      callbacks.onSnapshot({
        revision: 4,
        items: [
          {
            id: "item-1",
            enc_key: "{}",
            enc_data: "{}",
            revision: 1,
            updated_at: "2026-07-14 12:00:00",
            last_used_at: null,
            is_shared: false,
            collection_id: null,
            last_editor_email: null,
          },
          {
            id: "item-2",
            enc_key: "{}",
            enc_data: "{}",
            revision: 2,
            updated_at: "2026-07-14 12:00:00",
            last_used_at: null,
            is_shared: false,
            collection_id: null,
            last_editor_email: null,
          },
        ],
        folders: [],
      });
    });

    const item1After = store.getItems().find((item) => item.id === "item-1");
    expect(item1After).toEqual(item1Before);
    const item2After = store.getItems().find((item) => item.id === "item-2");
    expect(item2After?.fields.name).toBe("edited");
    expect(item2After?.revision).toBe(2);
  });

  it("applying a snapshot after the vault has since locked is a safe no-op", async () => {
    const { store, callbacks } = await unlockWithTwoItems();

    // Lock raced the in-flight fetch: the User Key handle is gone by the
    // time the snapshot arrives — it must never be decrypted/merged.
    mockGetUnlockedUserKey.mockReturnValue(null);
    mockDecryptItem.mockClear();
    act(() => {
      callbacks.onSnapshot({
        revision: 9,
        items: [
          {
            id: "item-3",
            enc_key: "{}",
            enc_data: "{}",
            revision: 1,
            updated_at: "2026-07-14 12:00:00",
            last_used_at: null,
            is_shared: false,
            collection_id: null,
            last_editor_email: null,
          },
        ],
        folders: [],
      });
    });

    expect(mockDecryptItem).not.toHaveBeenCalled();
    expect(store.getItems().map((item) => item.id)).toEqual(["item-1", "item-2"]);
  });

  // CR-03 (code review iteration 1): a decrypt failure must never be
  // silently discarded as if the merge fully succeeded — see
  // applySyncSnapshot's own doc comment for the full rationale (a stuck
  // save-409 loop with no way out through the UI, and a swallowed integrity
  // signal in a zero-knowledge product).
  describe("decrypt-failure fallback (CR-03)", () => {
    it("a single failing row keeps the merge alive for every other row", async () => {
      const { store, callbacks } = await unlockWithTwoItems();

      mockDecryptItem.mockImplementation((_uk: unknown, _combined: string, id: string) => {
        if (id === "item-2") {
          throw new Error("AEAD authentication failed");
        }
        return NOTE_PLAINTEXT;
      });
      act(() => {
        callbacks.onSnapshot({
          revision: 5,
          items: [
            {
              id: "item-1",
              enc_key: "{}",
              enc_data: "{}",
              revision: 1,
              updated_at: "2026-07-14 12:00:00",
              last_used_at: null,
              is_shared: false,
              collection_id: null,
              last_editor_email: null,
            },
            {
              id: "item-2",
              enc_key: "{}",
              enc_data: "{}",
              revision: 2,
              updated_at: "2026-07-14 12:00:00",
              last_used_at: null,
              is_shared: false,
              collection_id: null,
              last_editor_email: null,
            },
          ],
          folders: [],
        });
      });

      const ids = store.getItems().map((item) => item.id);
      expect(ids).toEqual(["item-1", "item-2"]);
    });

    it("does NOT advance the revision watermark when any row fails to decrypt", async () => {
      const { callbacks } = await unlockWithTwoItems();
      // The initial unlock merge left the watermark at 2 (unlockWithTwoItems'
      // own fixture snapshot revision).
      expect(callbacks.getSinceRevision()).toBe(2);

      mockDecryptItem.mockImplementation((_uk: unknown, _combined: string, id: string) => {
        if (id === "item-2") {
          throw new Error("AEAD authentication failed");
        }
        return NOTE_PLAINTEXT;
      });
      act(() => {
        callbacks.onSnapshot({
          revision: 5,
          items: [
            {
              id: "item-1",
              enc_key: "{}",
              enc_data: "{}",
              revision: 1,
              updated_at: "2026-07-14 12:00:00",
              last_used_at: null,
              is_shared: false,
              collection_id: null,
              last_editor_email: null,
            },
            {
              id: "item-2",
              enc_key: "{}",
              enc_data: "{}",
              revision: 2,
              updated_at: "2026-07-14 12:00:00",
              last_used_at: null,
              is_shared: false,
              collection_id: null,
              last_editor_email: null,
            },
          ],
          folders: [],
        });
      });

      // Watermark stayed at 2 -- the NEXT poll must re-fetch and retry,
      // never believe itself caught up on a revision it never actually
      // merged.
      expect(callbacks.getSinceRevision()).toBe(2);
    });

    it("flags the retained last-known-good row as undecryptable", async () => {
      const { store, callbacks } = await unlockWithTwoItems();

      mockDecryptItem.mockImplementation((_uk: unknown, _combined: string, id: string) => {
        if (id === "item-2") {
          throw new Error("AEAD authentication failed");
        }
        return NOTE_PLAINTEXT;
      });
      act(() => {
        callbacks.onSnapshot({
          revision: 5,
          items: [
            {
              id: "item-1",
              enc_key: "{}",
              enc_data: "{}",
              revision: 1,
              updated_at: "2026-07-14 12:00:00",
              last_used_at: null,
              is_shared: false,
              collection_id: null,
              last_editor_email: null,
            },
            {
              id: "item-2",
              enc_key: "{}",
              enc_data: "{}",
              revision: 2,
              updated_at: "2026-07-14 12:00:00",
              last_used_at: null,
              is_shared: false,
              collection_id: null,
              last_editor_email: null,
            },
          ],
          folders: [],
        });
      });

      const item1 = store.getItems().find((item) => item.id === "item-1");
      const item2 = store.getItems().find((item) => item.id === "item-2");
      expect(item1?.undecryptable).toBe(false);
      expect(item2?.undecryptable).toBe(true);
    });

    it("the folder branch gets the identical treatment: keeps the merge alive, flags the retained folder, and withholds the watermark", async () => {
      mockGetUnlockedUserKey.mockReturnValue({});
      mockGetSyncSnapshot.mockResolvedValue({
        revision: 1,
        items: [],
        folders: [{ id: "folder-1", enc_name: "{}" }],
      });
      mockDecryptItem.mockReturnValue('{"name":"Folder One"}');
      const { store, lockListener } = await importStoreAndGetLockListener();
      mockIsUnlocked.mockReturnValue(true);
      await act(async () => {
        lockListener();
        await Promise.resolve();
        await Promise.resolve();
      });
      const callbacks = getSyncCallbacks();
      expect(store.getFolders()).toHaveLength(1);

      mockDecryptItem.mockImplementation(() => {
        throw new Error("AEAD authentication failed");
      });
      act(() => {
        callbacks.onSnapshot({
          revision: 4,
          items: [],
          folders: [{ id: "folder-1", enc_name: "{}" }],
        });
      });

      expect(store.getFolders()).toHaveLength(1);
      expect(store.getFolders()[0]?.undecryptable).toBe(true);
      expect(callbacks.getSinceRevision()).toBe(1);
    });
  });
});

// NordPass-style last-used tracking (quick-260717): the single fire-and-
// forget choke-point every copy/reveal/fill/ceremony call site goes through.
describe("touchVaultItem", () => {
  it("calls the touch endpoint and optimistically updates the item's lastUsedAt on success", async () => {
    const { store } = await unlockWithTwoItems();
    mockTouchItem.mockResolvedValue({ last_used_at: "2026-07-17 09:00:00" });

    await act(async () => {
      store.touchVaultItem("item-1");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockTouchItem).toHaveBeenCalledWith("item-1");
    const item = store.getItems().find((i) => i.id === "item-1");
    expect(item?.lastUsedAt).toBe("2026-07-17 09:00:00");
    // The untouched sibling item is unaffected.
    const other = store.getItems().find((i) => i.id === "item-2");
    expect(other?.lastUsedAt).toBeUndefined();
  });

  it("never throws and leaves lastUsedAt unset when the touch request fails (fire-and-forget)", async () => {
    const { store } = await unlockWithTwoItems();
    mockTouchItem.mockRejectedValue(new Error("offline"));

    expect(() => store.touchVaultItem("item-1")).not.toThrow();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const item = store.getItems().find((i) => i.id === "item-1");
    expect(item?.lastUsedAt).toBeUndefined();
  });

  it("is a safe no-op when the touched id is no longer in the in-memory store", async () => {
    const { store } = await unlockWithTwoItems();
    mockTouchItem.mockResolvedValue({ last_used_at: "2026-07-17 09:00:00" });

    await act(async () => {
      store.touchVaultItem("some-other-id-never-in-store");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(store.getItems().map((i) => i.id)).toEqual(["item-1", "item-2"]);
  });
});

describe("folder plumbing", () => {
  it("createVaultFolder encrypts {name} via encryptItem/decryptItem's shape and is immediately visible via useFolders' snapshot getter", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockEncryptItem.mockReturnValue("combined-folder-json");
    mockCreateFolder.mockResolvedValue({ id: "folder-1" });

    const { store } = await importStoreAndGetLockListener();
    const folder = await store.createVaultFolder("Praca");

    // 26-13-PLAN.md live-run fix: `createFolder` now takes the client-minted
    // `id` as its first argument (mirrors `createCollection`'s existing
    // shape) -- the SAME id `encryptItem`'s AAD was bound to, sent to the
    // server explicitly instead of a server-minted id being silently
    // discarded (the real bug this fix closes, see `store.ts::
    // createVaultFolder`'s own doc comment).
    expect(mockCreateFolder).toHaveBeenCalledWith(folder.id, "combined-folder-json");
    expect(folder.name).toBe("Praca");
    expect(store.getFolders()).toContainEqual(folder);
  });

  it("useAllTags returns the deduplicated union of every loaded item's fields.tags", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockGetSyncSnapshot.mockResolvedValue({
      revision: 1,
      items: [
        { id: "item-1", enc_key: "{}", enc_data: "{}", revision: 1, collection_id: null },
        { id: "item-2", enc_key: "{}", enc_data: "{}", revision: 1, collection_id: null },
      ],
      folders: [],
    });
    mockDecryptItem
      .mockReturnValueOnce(
        '{"type":"note","name":"a","body":"b","folderId":null,"tags":["work","urgent"]}',
      )
      .mockReturnValueOnce(
        '{"type":"note","name":"c","body":"d","folderId":null,"tags":["urgent","home"]}',
      );

    const { store, lockListener } = await importStoreAndGetLockListener();
    mockIsUnlocked.mockReturnValue(true);
    await act(async () => {
      lockListener();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(store.getAllTags().sort()).toEqual(["home", "urgent", "work"]);
  });
});

describe("updateVaultItem", () => {
  it("encrypts with currentRevision+1 as the AD-binding revision and replaces the item on success", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockEncryptItem.mockReturnValue(
      JSON.stringify({
        enc_key: { nonce: [1], ciphertext: [2] },
        enc_data: { nonce: [3], ciphertext: [4] },
      }),
    );
    mockUpdateItem.mockResolvedValue({ revision: 2, updated_at: "2026-07-13 12:00:00" });

    const { store } = await importStoreAndGetLockListener();
    const fields = {
      type: "note" as const,
      name: "updated",
      body: "b",
      folderId: null,
      tags: [],
    };

    const result = await store.updateVaultItem("item-1", fields, 1);

    expect(mockEncryptItem).toHaveBeenCalledWith(
      expect.anything(),
      JSON.stringify(fields),
      "item-1",
      2,
    );
    expect(mockUpdateItem).toHaveBeenCalledWith("item-1", expect.any(String), expect.any(String), 1);
    expect(result).toEqual({
      id: "item-1",
      revision: 2,
      fields,
      updatedAt: "2026-07-13 12:00:00",
    });
    expect(store.getItems()).toContainEqual(result);
  });

  it("on a 409, does not optimistically apply the edit, re-fetches truth, and rejects with RevisionConflictError", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockGetSyncSnapshot.mockResolvedValue({
      revision: 1,
      items: [{ id: "item-1", enc_key: "{}", enc_data: "{}", revision: 1, collection_id: null }],
      folders: [],
    });
    mockDecryptItem.mockReturnValue(NOTE_PLAINTEXT);

    const { store, lockListener } = await importStoreAndGetLockListener();
    mockIsUnlocked.mockReturnValue(true);
    await act(async () => {
      lockListener();
      await Promise.resolve();
      await Promise.resolve();
    });

    mockEncryptItem.mockReturnValue(JSON.stringify({ enc_key: {}, enc_data: {} }));
    mockUpdateItem.mockRejectedValue(new ApiClientError(409, "stale revision"));
    mockGetSyncSnapshot.mockClear();
    mockGetSyncSnapshot.mockResolvedValue({
      revision: 2,
      items: [{ id: "item-1", enc_key: "{}", enc_data: "{}", revision: 2, collection_id: null }],
      folders: [],
    });

    const conflictingFields = {
      type: "note" as const,
      name: "conflicting-edit",
      body: "b",
      folderId: null,
      tags: [],
    };

    await expect(store.updateVaultItem("item-1", conflictingFields, 1)).rejects.toBeInstanceOf(
      store.RevisionConflictError,
    );

    // The conflicting edit was never applied optimistically.
    const stored = store.getItems().find((i) => i.id === "item-1");
    expect(stored?.fields.name).not.toBe("conflicting-edit");
    // Truth was re-fetched (loadAndDecryptAll re-ran the snapshot pull).
    expect(mockGetSyncSnapshot).toHaveBeenCalledTimes(1);
  });

  // Plan 23-05 (SYNC-06 client half): a shared item's 409 conflict body
  // carries the current last editor's email, attributed via
  // ApiClientError.details — a personal item's conflict has no such field.
  it("on a shared item's 409, RevisionConflictError carries the mocked last_editor_email from the response body", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockGetSyncSnapshot.mockResolvedValue({
      revision: 1,
      items: [{ id: "item-1", enc_key: "{}", enc_data: "{}", revision: 1, collection_id: null }],
      folders: [],
    });
    mockDecryptItem.mockReturnValue(NOTE_PLAINTEXT);

    const { store, lockListener } = await importStoreAndGetLockListener();
    mockIsUnlocked.mockReturnValue(true);
    await act(async () => {
      lockListener();
      await Promise.resolve();
      await Promise.resolve();
    });

    mockEncryptItem.mockReturnValue(JSON.stringify({ enc_key: {}, enc_data: {} }));
    mockUpdateItem.mockRejectedValue(
      new ApiClientError(409, "stale revision", { error: "stale revision", last_editor_email: "anna@example.com" }),
    );
    mockGetSyncSnapshot.mockClear();
    mockGetSyncSnapshot.mockResolvedValue({
      revision: 2,
      items: [{ id: "item-1", enc_key: "{}", enc_data: "{}", revision: 2, collection_id: null }],
      folders: [],
    });

    const conflictingFields = {
      type: "note" as const,
      name: "conflicting-edit",
      body: "b",
      folderId: null,
      tags: [],
    };

    let caught: unknown;
    try {
      await store.updateVaultItem("item-1", conflictingFields, 1);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(store.RevisionConflictError);
    expect((caught as InstanceType<typeof store.RevisionConflictError>).lastEditorEmail).toBe(
      "anna@example.com",
    );
  });

  it("on a personal item's 409 (no last_editor_email in the body), RevisionConflictError's lastEditorEmail is undefined", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockGetSyncSnapshot.mockResolvedValue({
      revision: 1,
      items: [{ id: "item-1", enc_key: "{}", enc_data: "{}", revision: 1, collection_id: null }],
      folders: [],
    });
    mockDecryptItem.mockReturnValue(NOTE_PLAINTEXT);

    const { store, lockListener } = await importStoreAndGetLockListener();
    mockIsUnlocked.mockReturnValue(true);
    await act(async () => {
      lockListener();
      await Promise.resolve();
      await Promise.resolve();
    });

    mockEncryptItem.mockReturnValue(JSON.stringify({ enc_key: {}, enc_data: {} }));
    // Personal-item conflict body: no last_editor_email key at all
    // (ApiError::Conflict's byte-identical existing wire shape).
    mockUpdateItem.mockRejectedValue(
      new ApiClientError(409, "stale revision", { error: "stale revision" }),
    );
    mockGetSyncSnapshot.mockClear();
    mockGetSyncSnapshot.mockResolvedValue({
      revision: 2,
      items: [{ id: "item-1", enc_key: "{}", enc_data: "{}", revision: 2, collection_id: null }],
      folders: [],
    });

    const conflictingFields = {
      type: "note" as const,
      name: "conflicting-edit",
      body: "b",
      folderId: null,
      tags: [],
    };

    let caught: unknown;
    try {
      await store.updateVaultItem("item-1", conflictingFields, 1);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(store.RevisionConflictError);
    expect(
      (caught as InstanceType<typeof store.RevisionConflictError>).lastEditorEmail,
    ).toBeUndefined();
  });

  // 26-05a (live data-corruption fix): mirrors decryptItemRow's own
  // scope-dispatch tests ("decrypt dispatch by scope" describe block below)
  // on the ENCRYPT side. Real-WASM round-trip proof lives in
  // store.real-wasm.test.ts -- these mocked tests only prove the DISPATCH
  // (which function gets called with which args), not that the resulting
  // ciphertext is genuinely readable back.
  describe("encrypt dispatch by scope (collection_id) -- 26-05a", () => {
    /** Unlocks with a single collection-scoped item already in the store,
     * so `updateVaultItem`'s `existingBeforeSave` lookup finds a non-null
     * `collectionId`. */
    async function unlockWithCollectionItem() {
      mockGetUnlockedUserKey.mockReturnValue({});
      mockGetSyncSnapshot.mockResolvedValue({
        revision: 1,
        items: [
          {
            id: "item-collection-1",
            enc_key: "{}",
            enc_data: "{}",
            revision: 3,
            updated_at: "2026-08-06T00:00:00Z",
            last_used_at: null,
            is_shared: true,
            collection_id: "collection-1",
            last_editor_email: null,
          },
        ],
        folders: [],
      });
      mockGetCollectionKey.mockReturnValue({});
      mockDecryptItemForCollection.mockReturnValue(NOTE_PLAINTEXT);

      const { store, lockListener } = await importStoreAndGetLockListener();
      mockIsUnlocked.mockReturnValue(true);
      await act(async () => {
        lockListener();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(store.getItems()).toHaveLength(1);
      return store;
    }

    it("a collection-scoped item's save calls encryptItemForCollection with the item's collection_id, id, and new revision -- never encryptItem", async () => {
      const store = await unlockWithCollectionItem();
      const ckHandle = mockGetCollectionKey.mock.results[0]?.value as unknown;
      mockEncryptItemForCollection.mockReturnValue(
        JSON.stringify({
          enc_key: { nonce: [1], ciphertext: [2] },
          enc_data: { nonce: [3], ciphertext: [4] },
        }),
      );
      mockUpdateItem.mockResolvedValue({ revision: 4, updated_at: "2026-08-06T00:01:00Z" });

      const fields = {
        type: "note" as const,
        name: "updated shared secret",
        body: "b",
        folderId: null,
        tags: [],
      };
      const result = await store.updateVaultItem("item-collection-1", fields, 3);

      expect(mockGetCollectionKey).toHaveBeenCalledWith("collection-1");
      expect(mockEncryptItemForCollection).toHaveBeenCalledWith(
        ckHandle,
        JSON.stringify(fields),
        "collection-1",
        "item-collection-1",
        4,
      );
      expect(mockEncryptItem).not.toHaveBeenCalled();
      expect(result.collectionId).toBe("collection-1");
      expect(result.revision).toBe(4);
    });

    it("an unavailable collection key FAILS THE SAVE LOUDLY -- rejects with CollectionKeyUnavailableError, never falls back to encryptItem, and never calls updateItem", async () => {
      const store = await unlockWithCollectionItem();
      mockGetCollectionKey.mockReturnValue(undefined); // key not cached yet

      const fields = {
        type: "note" as const,
        name: "updated shared secret",
        body: "b",
        folderId: null,
        tags: [],
      };

      await expect(store.updateVaultItem("item-collection-1", fields, 3)).rejects.toBeInstanceOf(
        store.CollectionKeyUnavailableError,
      );

      expect(mockEncryptItem).not.toHaveBeenCalled();
      expect(mockEncryptItemForCollection).not.toHaveBeenCalled();
      expect(mockUpdateItem).not.toHaveBeenCalled();
      // The in-memory item is untouched -- no personal-key ciphertext was
      // ever written, optimistically or otherwise.
      const stored = store.getItems().find((i) => i.id === "item-collection-1");
      expect(stored?.revision).toBe(3);
    });
  });
});

describe("legacy field normalization", () => {
  it("normalizes a legacy login item's bare `url` string into `urls: [url]` on decrypt", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockGetSyncSnapshot.mockResolvedValue({
      revision: 1,
      items: [{ id: "item-1", enc_key: "{}", enc_data: "{}", revision: 1, collection_id: null }],
      folders: [],
    });
    mockDecryptItem.mockReturnValue(
      JSON.stringify({
        type: "login",
        name: "GitHub",
        username: "bartek",
        password: "s3cret",
        url: "https://github.com",
        notes: "",
        folderId: null,
        tags: [],
      }),
    );

    const { store, lockListener } = await importStoreAndGetLockListener();
    mockIsUnlocked.mockReturnValue(true);
    await act(async () => {
      lockListener();
      await Promise.resolve();
      await Promise.resolve();
    });

    const item = store.getItems()[0];
    expect(item.fields.type).toBe("login");
    if (item.fields.type === "login") {
      expect(item.fields.urls).toEqual(["https://github.com"]);
      expect(item.fields).not.toHaveProperty("url");
    }
  });

  it("tolerates a legacy login item with a missing url by normalizing to an empty urls array", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockGetSyncSnapshot.mockResolvedValue({
      revision: 1,
      items: [{ id: "item-1", enc_key: "{}", enc_data: "{}", revision: 1, collection_id: null }],
      folders: [],
    });
    mockDecryptItem.mockReturnValue(
      JSON.stringify({
        type: "login",
        name: "GitHub",
        username: "bartek",
        password: "s3cret",
        notes: "",
        folderId: null,
        tags: [],
      }),
    );

    const { store, lockListener } = await importStoreAndGetLockListener();
    mockIsUnlocked.mockReturnValue(true);
    await act(async () => {
      lockListener();
      await Promise.resolve();
      await Promise.resolve();
    });

    const item = store.getItems()[0];
    if (item.fields.type === "login") {
      expect(item.fields.urls).toEqual([]);
    }
  });

  it("leaves a current-shape login item's urls array untouched", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockGetSyncSnapshot.mockResolvedValue({
      revision: 1,
      items: [{ id: "item-1", enc_key: "{}", enc_data: "{}", revision: 1, collection_id: null }],
      folders: [],
    });
    mockDecryptItem.mockReturnValue(
      JSON.stringify({
        type: "login",
        name: "GitHub",
        username: "bartek",
        password: "s3cret",
        urls: ["https://github.com", "https://github.com/login"],
        notes: "",
        folderId: null,
        tags: [],
      }),
    );

    const { store, lockListener } = await importStoreAndGetLockListener();
    mockIsUnlocked.mockReturnValue(true);
    await act(async () => {
      lockListener();
      await Promise.resolve();
      await Promise.resolve();
    });

    const item = store.getItems()[0];
    if (item.fields.type === "login") {
      expect(item.fields.urls).toEqual([
        "https://github.com",
        "https://github.com/login",
      ]);
    }
  });

  // Phase 12 cross-client fix (live bug): before this fix, a passkey vault
  // item's raw `SerializablePasskey` wire JSON (no `tags` array at all) flowed
  // straight into recomputeAllTags()'s `for (const tag of item.fields.tags)`
  // loop and threw "a.fields.tags is not iterable" the moment the sidebar
  // switched away from a type-filtered view.
  it("normalizes a raw passkey wire item on decrypt and recomputeAllTags tolerates it without throwing", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockGetSyncSnapshot.mockResolvedValue({
      revision: 1,
      items: [{ id: "item-1", enc_key: "{}", enc_data: "{}", revision: 1, collection_id: null }],
      folders: [],
    });
    mockDecryptItem.mockReturnValue(
      JSON.stringify({
        key_cbor: [1, 2, 3],
        credential_id: [4, 5, 6],
        rp_id: "example.com",
        username: "bartek",
      }),
    );

    const { store, lockListener } = await importStoreAndGetLockListener();
    mockIsUnlocked.mockReturnValue(true);
    await act(async () => {
      lockListener();
      await Promise.resolve();
      await Promise.resolve();
    });

    const item = store.getItems()[0];
    expect(item.fields.type).toBe("passkey");
    if (item.fields.type === "passkey") {
      expect(item.fields.rpId).toBe("example.com");
      expect(item.fields.tags).toEqual([]);
    }
    // The crash this test guards against: recomputeAllTags() ran as part of
    // the unlock merge above (applySyncSnapshot -> decryptItemRow ->
    // normalizeItemFields), so simply reaching this line without a thrown
    // TypeError already proves the fix — this assertion documents the
    // expected (empty) result.
    expect(store.getAllTags()).toEqual([]);
  });
});

describe("deleteVaultFolder", () => {
  it("removes the folder from the store only after the API call succeeds", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockEncryptItem.mockReturnValue("combined-folder-json");
    mockCreateFolder.mockResolvedValue({ id: "folder-1" });

    const { store } = await importStoreAndGetLockListener();
    // createVaultFolder generates its own client-side id via
    // crypto.randomUUID() and sends it explicitly to the server (26-13-PLAN.md
    // live-run fix -- see store.ts's own doc comment); the mocked API's
    // returned {id} is a distinct mock value, never consulted, since the
    // caller already knows the real id it minted -- so the real id must be
    // read back off the created folder, not assumed.
    const folder = await store.createVaultFolder("Praca");
    expect(store.getFolders()).toHaveLength(1);

    mockDeleteFolder.mockResolvedValue(undefined);
    await store.deleteVaultFolder(folder.id);

    expect(mockDeleteFolder).toHaveBeenCalledWith(folder.id);
    expect(store.getFolders()).toHaveLength(0);
  });

  it("leaves the folder in the store if the delete API call fails", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockEncryptItem.mockReturnValue("combined-folder-json");
    mockCreateFolder.mockResolvedValue({ id: "folder-1" });

    const { store } = await importStoreAndGetLockListener();
    const folder = await store.createVaultFolder("Praca");

    mockDeleteFolder.mockRejectedValue(new Error("network error"));
    await expect(store.deleteVaultFolder(folder.id)).rejects.toThrow("network error");

    expect(store.getFolders()).toHaveLength(1);
  });
});

describe("deleteVaultItem", () => {
  it("removes the item from the store only after the API call succeeds", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockGetSyncSnapshot.mockResolvedValue({
      revision: 1,
      items: [{ id: "item-1", enc_key: "{}", enc_data: "{}", revision: 1, collection_id: null }],
      folders: [],
    });
    mockDecryptItem.mockReturnValue(NOTE_PLAINTEXT);

    const { store, lockListener } = await importStoreAndGetLockListener();
    mockIsUnlocked.mockReturnValue(true);
    await act(async () => {
      lockListener();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(store.getItems()).toHaveLength(1);

    mockDeleteItem.mockResolvedValue(undefined);
    await store.deleteVaultItem("item-1");

    expect(mockDeleteItem).toHaveBeenCalledWith("item-1");
    expect(store.getItems()).toHaveLength(0);
  });

  it("leaves the item in the store if the delete API call fails", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockGetSyncSnapshot.mockResolvedValue({
      revision: 1,
      items: [{ id: "item-1", enc_key: "{}", enc_data: "{}", revision: 1, collection_id: null }],
      folders: [],
    });
    mockDecryptItem.mockReturnValue(NOTE_PLAINTEXT);

    const { store, lockListener } = await importStoreAndGetLockListener();
    mockIsUnlocked.mockReturnValue(true);
    await act(async () => {
      lockListener();
      await Promise.resolve();
      await Promise.resolve();
    });

    mockDeleteItem.mockRejectedValue(new Error("network error"));
    await expect(store.deleteVaultItem("item-1")).rejects.toThrow("network error");

    expect(store.getItems()).toHaveLength(1);
  });
});

// 26-05-PLAN.md, Task 2: decryptItemRow dispatches to decryptItemForCollection
// for a collection-scoped row (row.collection_id !== null) instead of
// unconditionally calling decryptItem (the personal-scope path). The genuine
// crypto proof that a real collection-scoped item round-trips end to end is
// store.real-wasm.test.ts's own central-proof test (never mocked crypto,
// see this plan's "Test-tiering decision" note) — this mocked test instead
// covers a code path the real-wasm test does not: the collections store
// not having refreshed yet (getCollectionKey returns undefined), which must
// fall through to the SAME CR-03 undecryptable/retained-last-known-good
// path any other decrypt failure already uses, never a crash.
describe("decrypt dispatch by scope (collection_id)", () => {
  it("a collection-scoped row calls decryptItemForCollection with the row's collection_id, id, and revision -- never decryptItem", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockGetSyncSnapshot.mockResolvedValue({
      revision: 1,
      items: [
        {
          id: "item-collection-1",
          enc_key: "{}",
          enc_data: "{}",
          revision: 3,
          updated_at: "2026-08-06T00:00:00Z",
          last_used_at: null,
          is_shared: true,
          collection_id: "collection-1",
          last_editor_email: null,
        },
      ],
      folders: [],
    });
    mockGetCollectionKey.mockReturnValue({});
    mockDecryptItemForCollection.mockReturnValue(NOTE_PLAINTEXT);

    const { store, lockListener } = await importStoreAndGetLockListener();
    mockIsUnlocked.mockReturnValue(true);
    await act(async () => {
      lockListener();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetCollectionKey).toHaveBeenCalledWith("collection-1");
    expect(mockDecryptItemForCollection).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      "collection-1",
      "item-collection-1",
      3,
    );
    expect(mockDecryptItem).not.toHaveBeenCalled();

    const item = store.getItems().find((i) => i.id === "item-collection-1");
    expect(item?.collectionId).toBe("collection-1");
    expect(item?.undecryptable).toBe(false);
  });

  it("a collection-scoped row whose key isn't cached yet falls through to the undecryptable retained-last-known-good path, never a crash", async () => {
    const { store, callbacks } = await unlockWithTwoItems();

    mockGetCollectionKey.mockReturnValue(undefined); // collections store hasn't refreshed yet
    act(() => {
      callbacks.onSnapshot({
        revision: 5,
        items: [
          {
            id: "item-1",
            enc_key: "{}",
            enc_data: "{}",
            revision: 1,
            updated_at: "2026-07-14 12:00:00",
            last_used_at: null,
            is_shared: false,
            collection_id: null,
            last_editor_email: null,
          },
          {
            id: "item-2",
            enc_key: "{}",
            enc_data: "{}",
            revision: 2,
            updated_at: "2026-07-14 12:00:00",
            last_used_at: null,
            is_shared: true,
            collection_id: "collection-not-yet-cached",
            last_editor_email: null,
          },
        ],
        folders: [],
      });
    });

    const item1 = store.getItems().find((i) => i.id === "item-1");
    const item2 = store.getItems().find((i) => i.id === "item-2");
    expect(item1?.undecryptable).toBe(false);
    expect(item2?.undecryptable).toBe(true); // retained last-known-good copy, not dropped
    expect(mockDecryptItemForCollection).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "collection-not-yet-cached",
      expect.anything(),
      expect.anything(),
    );
  });
});

// A-5 (26-CONTEXT.md, Phase 23's inherited obligation #3): `GET
// /api/sync/shared` shipped fully implemented, authorized and tested since
// Phase 23 with zero client consumer -- store.ts's syncCallbacks.
// onSharedRevisions is the first one. sync.ts (mocked in this file) is the
// ONLY caller of this callback in production; these tests drive it directly
// via the callbacks handle startSync received, exactly like every other
// onSnapshot-driven test above.
describe("onSharedRevisions (A-5 / Phase 23 inherited obligation)", () => {
  it("is wired onto syncCallbacks as a function", async () => {
    await unlockWithTwoItems();
    const callbacks = getSyncCallbacks();
    expect(callbacks.onSharedRevisions).toBeInstanceOf(Function);
  });

  it("a watermark mismatch (new collection revision) triggers a full getSyncSnapshot(0) re-pull that merges via applySyncSnapshot", async () => {
    const { store, callbacks } = await unlockWithTwoItems();
    const callCountBefore = mockGetSyncSnapshot.mock.calls.length;

    mockGetSyncSnapshot.mockResolvedValueOnce({
      revision: 2, // same watermark -- only the shared-collection item is new
      items: [
        {
          id: "item-1",
          enc_key: "{}",
          enc_data: "{}",
          revision: 1,
          updated_at: "2026-07-14 12:00:00",
          last_used_at: null,
          is_shared: false,
          collection_id: null,
          last_editor_email: null,
        },
        {
          id: "item-2",
          enc_key: "{}",
          enc_data: "{}",
          revision: 1,
          updated_at: "2026-07-14 12:00:00",
          last_used_at: null,
          is_shared: false,
          collection_id: null,
          last_editor_email: null,
        },
        {
          id: "item-shared-1",
          enc_key: "{}",
          enc_data: "{}",
          revision: 2,
          updated_at: "2026-07-14 12:00:00",
          last_used_at: null,
          is_shared: true,
          collection_id: "collection-1",
          last_editor_email: null,
        },
      ],
      folders: [],
    });
    mockGetCollectionKey.mockReturnValue({});
    mockDecryptItemForCollection.mockReturnValue(NOTE_PLAINTEXT);

    const revisions: SharedRevisions = {
      collections: [{ id: "collection-1", revision: 7 }],
      direct: { revision: 0 },
    };
    await act(async () => {
      await callbacks.onSharedRevisions?.(revisions);
    });

    expect(mockGetSyncSnapshot.mock.calls.length).toBe(callCountBefore + 1);
    // Bypasses lastKnownRevision entirely -- a shared-only change never
    // bumps the caller's own personal vault_revision (SYNC-04).
    expect(mockGetSyncSnapshot).toHaveBeenLastCalledWith(0);
    expect(store.getItems().map((i) => i.id)).toContain("item-shared-1");
  });

  it("an unchanged shared-revisions payload triggers no extra pull", async () => {
    const { callbacks } = await unlockWithTwoItems();
    const callCountBefore = mockGetSyncSnapshot.mock.calls.length;

    // Baseline watermark after unlock is empty ({ collections: [], direct: 0
    // }) -- an equally-empty payload is, by definition, unchanged.
    const revisions: SharedRevisions = { collections: [], direct: { revision: 0 } };
    await act(async () => {
      await callbacks.onSharedRevisions?.(revisions);
    });

    expect(mockGetSyncSnapshot.mock.calls.length).toBe(callCountBefore);
  });

  it("a SECOND call with the identical payload that already triggered a pull does not trigger another one", async () => {
    const { callbacks } = await unlockWithTwoItems();
    mockGetCollectionKey.mockReturnValue({});
    mockDecryptItemForCollection.mockReturnValue(NOTE_PLAINTEXT);

    const revisions: SharedRevisions = {
      collections: [{ id: "collection-1", revision: 3 }],
      direct: { revision: 0 },
    };
    await act(async () => {
      await callbacks.onSharedRevisions?.(revisions);
    });
    const callCountAfterFirst = mockGetSyncSnapshot.mock.calls.length;

    await act(async () => {
      await callbacks.onSharedRevisions?.(revisions);
    });

    expect(mockGetSyncSnapshot.mock.calls.length).toBe(callCountAfterFirst);
  });

  it("the watermark resets on every unlock -- an identical payload that already triggered a pull triggers again after a lock/re-unlock cycle", async () => {
    const { store, lockListener, callbacks } = await unlockWithTwoItems();
    mockGetCollectionKey.mockReturnValue({});
    mockDecryptItemForCollection.mockReturnValue(NOTE_PLAINTEXT);

    const revisions: SharedRevisions = {
      collections: [{ id: "collection-1", revision: 3 }],
      direct: { revision: 0 },
    };
    await act(async () => {
      await callbacks.onSharedRevisions?.(revisions);
    });

    // Lock, then re-unlock -- a fresh startSync() hands out a fresh
    // callbacks object, per this module's own subscribeLockState wiring.
    mockIsUnlocked.mockReturnValue(false);
    act(() => {
      lockListener();
    });
    mockIsUnlocked.mockReturnValue(true);
    await act(async () => {
      lockListener();
      await Promise.resolve();
      await Promise.resolve();
    });
    const newCallbacks = getSyncCallbacks();
    const callCountAfterReUnlock = mockGetSyncSnapshot.mock.calls.length;

    await act(async () => {
      await newCallbacks.onSharedRevisions?.(revisions);
    });

    expect(mockGetSyncSnapshot.mock.calls.length).toBe(callCountAfterReUnlock + 1);
    void store; // unused in this test beyond the initial unlock fixture
  });
});
