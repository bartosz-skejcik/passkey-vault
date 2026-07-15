import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock functions must be created via vi.hoisted() so they exist before the
// hoisted vi.mock() factories below run -- same pattern as
// ./unlock.test.ts/./vault-session.test.ts. Every one of vault-store.ts's
// dependencies is mocked wholesale (wasm-loader's decryptItem, vault-
// session's lock-state surface, sync-client's startSync/stopSync, vault-
// api's getSyncSnapshot, and wxt/browser's runtime.sendMessage) so
// vault-store.ts's OWN merge/lock-order logic is what runs for real.
const hoisted = vi.hoisted(() => ({
  mockDecryptItem: vi.fn(),
  mockGetUnlockedUserKey: vi.fn(),
  mockIsSessionUnlocked: vi.fn(),
  mockSubscribeSessionLockState: vi.fn(),
  mockStartSync: vi.fn(),
  mockStopSync: vi.fn(),
  mockGetSyncSnapshot: vi.fn(),
  mockSendMessage: vi.fn(),
}));

vi.mock("../../lib/crypto/wasm-loader", () => ({
  decryptItem: hoisted.mockDecryptItem,
}));

vi.mock("./vault-session", () => ({
  getUnlockedUserKey: hoisted.mockGetUnlockedUserKey,
  isSessionUnlocked: hoisted.mockIsSessionUnlocked,
  subscribeSessionLockState: hoisted.mockSubscribeSessionLockState,
}));

vi.mock("./sync-client", () => ({
  startSync: hoisted.mockStartSync,
  stopSync: hoisted.mockStopSync,
}));

vi.mock("./vault-api", () => ({
  getSyncSnapshot: hoisted.mockGetSyncSnapshot,
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      sendMessage: hoisted.mockSendMessage,
    },
  },
}));

/** Captures the lock-state listener registered at module load, so tests
 * can simulate an unlock/lock transition by invoking it directly. */
let lockStateListener: () => void = () => {};

function itemRow(id: string, overrides: Partial<{ enc_key: string; enc_data: string; revision: number; updated_at: string }> = {}) {
  return { id, enc_key: "{}", enc_data: "{}", revision: 1, updated_at: "2026-01-01", ...overrides };
}

function folderRow(id: string, encName = "{}") {
  return { id, enc_name: encName };
}

beforeEach(() => {
  vi.resetAllMocks();
  hoisted.mockSubscribeSessionLockState.mockImplementation((listener: () => void) => {
    lockStateListener = listener;
    return () => {};
  });
  hoisted.mockSendMessage.mockResolvedValue(undefined);
  hoisted.mockGetSyncSnapshot.mockResolvedValue({ revision: 0 });
  vi.resetModules();
});

describe("applySyncSnapshot", () => {
  it("Test 1: decrypts and replaces items/folders wholesale when the vault is unlocked", async () => {
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockDecryptItem
      .mockReturnValueOnce(
        JSON.stringify({ type: "note", name: "N1", body: "b", folderId: null, tags: [] }),
      )
      .mockReturnValueOnce(JSON.stringify({ name: "Folder1" }));

    const { applySyncSnapshot, getItems, getFolders } = await import("./vault-store");

    applySyncSnapshot({
      revision: 3,
      items: [itemRow("i1")],
      folders: [folderRow("f1")],
    });

    expect(getItems()).toEqual([
      {
        id: "i1",
        revision: 1,
        fields: { type: "note", name: "N1", body: "b", folderId: null, tags: [] },
        updatedAt: "2026-01-01",
      },
    ]);
    expect(getFolders()).toEqual([{ id: "f1", name: "Folder1" }]);
  });

  it("Test 1b: a fresh snapshot's arrays REPLACE the prior in-memory arrays wholesale (no merge/diff)", async () => {
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockDecryptItem.mockReturnValue(
      JSON.stringify({ type: "note", name: "First", body: "b", folderId: null, tags: [] }),
    );
    const { applySyncSnapshot, getItems } = await import("./vault-store");

    applySyncSnapshot({ revision: 1, items: [itemRow("i1")] });
    expect(getItems()).toHaveLength(1);

    hoisted.mockDecryptItem.mockReturnValue(
      JSON.stringify({ type: "note", name: "Second", body: "b2", folderId: null, tags: [] }),
    );
    applySyncSnapshot({ revision: 2, items: [itemRow("i2")] });

    // i1 is gone entirely -- the new snapshot's items array replaced the
    // old one wholesale, it was never merged/appended.
    expect(getItems()).toEqual([
      {
        id: "i2",
        revision: 1,
        fields: { type: "note", name: "Second", body: "b2", folderId: null, tags: [] },
        updatedAt: "2026-01-01",
      },
    ]);
  });

  it("Test 2: is a no-op when getUnlockedUserKey() returns null (a lock raced the in-flight fetch)", async () => {
    hoisted.mockGetUnlockedUserKey.mockReturnValue(null);
    const { applySyncSnapshot, getItems, getFolders } = await import("./vault-store");

    applySyncSnapshot({ revision: 5, items: [itemRow("i1")], folders: [folderRow("f1")] });

    expect(hoisted.mockDecryptItem).not.toHaveBeenCalled();
    expect(getItems()).toEqual([]);
    expect(getFolders()).toEqual([]);
  });
});

describe("lock-state subscription", () => {
  it("Test 3: on unlock, calls startSync AND triggers an initial getSyncSnapshot(0) pull", async () => {
    const vaultStore = await import("./vault-store");
    hoisted.mockIsSessionUnlocked.mockReturnValue(true);
    hoisted.mockGetSyncSnapshot.mockResolvedValue({ revision: 0 });

    lockStateListener();
    await Promise.resolve();
    await Promise.resolve();

    expect(hoisted.mockStartSync).toHaveBeenCalledTimes(1);
    const passedCallbacks = hoisted.mockStartSync.mock.calls[0][0];
    expect(passedCallbacks.getSinceRevision()).toBe(0);
    expect(passedCallbacks.onSnapshot).toBe(vaultStore.applySyncSnapshot);
    expect(hoisted.mockGetSyncSnapshot).toHaveBeenCalledWith(0);
  });

  it("Test 4 (Pitfall 4 / T-09-18): on lock, stopSync() runs BEFORE items/folders are cleared, in that exact order", async () => {
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockDecryptItem
      .mockReturnValueOnce(
        JSON.stringify({ type: "note", name: "N1", body: "b", folderId: null, tags: [] }),
      )
      .mockReturnValueOnce(JSON.stringify({ name: "Folder1" }));
    const vaultStore = await import("./vault-store");

    // Seed the store with data while unlocked.
    vaultStore.applySyncSnapshot({
      revision: 1,
      items: [itemRow("i1")],
      folders: [folderRow("f1")],
    });
    expect(vaultStore.getItems()).toHaveLength(1);
    expect(vaultStore.getFolders()).toHaveLength(1);

    // Record what getItems()/getFolders() saw AT THE MOMENT stopSync ran --
    // if the clear happened first, this would already be empty.
    let itemsAtStopSyncTime = -1;
    let foldersAtStopSyncTime = -1;
    hoisted.mockStopSync.mockImplementation(() => {
      itemsAtStopSyncTime = vaultStore.getItems().length;
      foldersAtStopSyncTime = vaultStore.getFolders().length;
    });

    hoisted.mockIsSessionUnlocked.mockReturnValue(false);
    lockStateListener();

    expect(hoisted.mockStopSync).toHaveBeenCalledTimes(1);
    expect(itemsAtStopSyncTime).toBe(1); // stopSync saw the PRE-clear state
    expect(foldersAtStopSyncTime).toBe(1);

    // Test 4's own assertion: getItems()/getFolders() are empty immediately
    // after the lock event completes -- no plaintext survives a lock.
    expect(vaultStore.getItems()).toEqual([]);
    expect(vaultStore.getFolders()).toEqual([]);
  });

  it("Test 6 (post-UAT regression): ensureVaultSyncStarted() on a fresh module that is ALREADY unlocked (no transition fired) starts sync AND populates items", async () => {
    hoisted.mockIsSessionUnlocked.mockReturnValue(true);
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockDecryptItem.mockReturnValue(
      JSON.stringify({ type: "note", name: "N1", body: "b", folderId: null, tags: [] }),
    );
    hoisted.mockGetSyncSnapshot.mockResolvedValue({ revision: 1, items: [itemRow("i1")] });

    const { ensureVaultSyncStarted, getItems } = await import("./vault-store");

    // No lock-state transition ever fires here -- this simulates a fresh
    // service worker waking up to find the session already unlocked
    // (rehydrated from chrome.storage.session), the exact scenario the
    // subscription-only implementation missed.
    ensureVaultSyncStarted();
    await Promise.resolve();
    await Promise.resolve();

    expect(hoisted.mockStartSync).toHaveBeenCalledTimes(1);
    expect(hoisted.mockGetSyncSnapshot).toHaveBeenCalledWith(0);
    expect(getItems()).toEqual([
      {
        id: "i1",
        revision: 1,
        fields: { type: "note", name: "N1", body: "b", folderId: null, tags: [] },
        updatedAt: "2026-01-01",
      },
    ]);
  });

  it("Test 7 (post-UAT regression): calling ensureVaultSyncStarted() twice while unlocked does not double-start sync", async () => {
    hoisted.mockIsSessionUnlocked.mockReturnValue(true);
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockGetSyncSnapshot.mockResolvedValue({ revision: 0 });

    const { ensureVaultSyncStarted } = await import("./vault-store");

    ensureVaultSyncStarted();
    ensureVaultSyncStarted();
    await Promise.resolve();
    await Promise.resolve();

    expect(hoisted.mockStartSync).toHaveBeenCalledTimes(1);
    expect(hoisted.mockGetSyncSnapshot).toHaveBeenCalledTimes(1);
  });

  it("Test 8 (post-UAT regression): after a lock resets the guard, the NEXT unlock transition starts sync again (not permanently suppressed)", async () => {
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockGetSyncSnapshot.mockResolvedValue({ revision: 0 });

    const vaultStore = await import("./vault-store");

    hoisted.mockIsSessionUnlocked.mockReturnValue(true);
    vaultStore.ensureVaultSyncStarted();
    await Promise.resolve();
    expect(hoisted.mockStartSync).toHaveBeenCalledTimes(1);

    hoisted.mockIsSessionUnlocked.mockReturnValue(false);
    lockStateListener(); // lock transition -- resets the syncStarted guard

    hoisted.mockIsSessionUnlocked.mockReturnValue(true);
    lockStateListener(); // re-unlock transition
    await Promise.resolve();

    expect(hoisted.mockStartSync).toHaveBeenCalledTimes(2);
  });

  it("Test 5: a lock event broadcasts a vault.updated message for any open popup, tolerating no-receiver rejections", async () => {
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockDecryptItem.mockReturnValue(
      JSON.stringify({ type: "note", name: "N1", body: "b", folderId: null, tags: [] }),
    );
    hoisted.mockSendMessage.mockRejectedValue(new Error("Could not establish connection"));
    const vaultStore = await import("./vault-store");

    vaultStore.applySyncSnapshot({ revision: 1, items: [itemRow("i1")] });
    hoisted.mockIsSessionUnlocked.mockReturnValue(false);

    expect(() => lockStateListener()).not.toThrow();
    await Promise.resolve();

    expect(hoisted.mockSendMessage).toHaveBeenCalledWith({ kind: "vault.updated" });
  });
});
