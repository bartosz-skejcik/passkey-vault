import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { ApiClientError } from "@/lib/auth/api";

const {
  mockGetUnlockedUserKey,
  mockIsUnlocked,
  mockSubscribeLockState,
  mockEncryptItem,
  mockDecryptItem,
  mockListItems,
  mockListFolders,
  mockCreateItem,
  mockCreateFolder,
  mockUpdateItem,
  mockDeleteItem,
  mockDeleteFolder,
} = vi.hoisted(() => ({
  mockGetUnlockedUserKey: vi.fn(),
  mockIsUnlocked: vi.fn(),
  mockSubscribeLockState: vi.fn(),
  mockEncryptItem: vi.fn(),
  mockDecryptItem: vi.fn(),
  mockListItems: vi.fn(),
  mockListFolders: vi.fn(),
  mockCreateItem: vi.fn(),
  mockCreateFolder: vi.fn(),
  mockUpdateItem: vi.fn(),
  mockDeleteItem: vi.fn(),
  mockDeleteFolder: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  getUnlockedUserKey: mockGetUnlockedUserKey,
  isUnlocked: mockIsUnlocked,
  subscribeLockState: mockSubscribeLockState,
  encryptItem: mockEncryptItem,
  decryptItem: mockDecryptItem,
}));

vi.mock("./api", () => ({
  listItems: mockListItems,
  listFolders: mockListFolders,
  createItem: mockCreateItem,
  createFolder: mockCreateFolder,
  updateItem: mockUpdateItem,
  deleteItem: mockDeleteItem,
  deleteFolder: mockDeleteFolder,
}));

const NOTE_PLAINTEXT =
  '{"type":"note","name":"n","body":"b","folderId":null,"tags":[]}';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockListItems.mockResolvedValue([]);
  mockListFolders.mockResolvedValue([]);
});

/** Grabs the lock-state listener the store registered at import time via
 * subscribeLockState — used to simulate unlock/lock events in tests. */
async function importStoreAndGetLockListener() {
  const store = await import("./store");
  const lockListener = mockSubscribeLockState.mock.calls[0][0] as () => void;
  return { store, lockListener };
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
    mockCreateItem.mockResolvedValue({ id: "item-1", revision: 1 });

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
    mockListItems.mockResolvedValue([
      {
        id: "item-1",
        enc_key: JSON.stringify({ nonce: [1, 2], ciphertext: [3, 4] }),
        enc_data: JSON.stringify({ nonce: [5, 6], ciphertext: [7, 8] }),
        revision: 1,
      },
    ]);
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
    mockCreateItem.mockResolvedValue({ id: "item-2", revision: 1 });
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
    mockListItems.mockResolvedValue([
      { id: "item-2", enc_key: encKeyArg, enc_data: encDataArg, revision: 1 },
    ]);

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
    mockListItems.mockResolvedValue([
      { id: "item-1", enc_key: "{}", enc_data: "{}", revision: 1 },
    ]);
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
});

describe("folder plumbing", () => {
  it("createVaultFolder encrypts {name} via encryptItem/decryptItem's shape and is immediately visible via useFolders' snapshot getter", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockEncryptItem.mockReturnValue("combined-folder-json");
    mockCreateFolder.mockResolvedValue({ id: "folder-1" });

    const { store } = await importStoreAndGetLockListener();
    const folder = await store.createVaultFolder("Praca");

    expect(mockCreateFolder).toHaveBeenCalledWith("combined-folder-json");
    expect(folder.name).toBe("Praca");
    expect(store.getFolders()).toContainEqual(folder);
  });

  it("useAllTags returns the deduplicated union of every loaded item's fields.tags", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockListItems.mockResolvedValue([
      { id: "item-1", enc_key: "{}", enc_data: "{}", revision: 1 },
      { id: "item-2", enc_key: "{}", enc_data: "{}", revision: 1 },
    ]);
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
    mockUpdateItem.mockResolvedValue({ revision: 2 });

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
    expect(result).toEqual({ id: "item-1", revision: 2, fields });
    expect(store.getItems()).toContainEqual(result);
  });

  it("on a 409, does not optimistically apply the edit, re-fetches truth, and rejects with RevisionConflictError", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockListItems.mockResolvedValue([
      { id: "item-1", enc_key: "{}", enc_data: "{}", revision: 1 },
    ]);
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
    mockListItems.mockClear();
    mockListItems.mockResolvedValue([
      { id: "item-1", enc_key: "{}", enc_data: "{}", revision: 2 },
    ]);

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
    // Truth was re-fetched (loadAndDecryptAll re-ran listItems).
    expect(mockListItems).toHaveBeenCalledTimes(1);
  });
});

describe("deleteVaultItem", () => {
  it("removes the item from the store only after the API call succeeds", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockListItems.mockResolvedValue([
      { id: "item-1", enc_key: "{}", enc_data: "{}", revision: 1 },
    ]);
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
    mockListItems.mockResolvedValue([
      { id: "item-1", enc_key: "{}", enc_data: "{}", revision: 1 },
    ]);
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
