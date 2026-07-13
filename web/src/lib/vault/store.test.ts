import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";

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
