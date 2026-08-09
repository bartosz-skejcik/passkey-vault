import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock functions must be created via vi.hoisted() so they exist before the
// hoisted vi.mock() factories below run -- same pattern as
// ./unlock.test.ts/./vault-session.test.ts. Every one of vault-store.ts's
// dependencies is mocked wholesale (wasm-loader's decrypt* functions,
// vault-session's lock-state surface, sync-client's startSync/stopSync,
// vault-api's snapshot/shared-pull functions, collections-store's Collection
// Key cache, identity-store's identity-keypair primitive, and wxt/browser's
// runtime.sendMessage) so vault-store.ts's OWN merge/lock-order/dispatch
// logic is what runs for real.
const hoisted = vi.hoisted(() => ({
  mockDecryptItem: vi.fn(),
  mockDecryptItemForCollection: vi.fn(),
  mockDecryptItemWithSharedKey: vi.fn(),
  mockUnsealCollectionKey: vi.fn(),
  mockGetUnlockedUserKey: vi.fn(),
  mockIsSessionUnlocked: vi.fn(),
  mockSubscribeSessionLockState: vi.fn(),
  mockStartSync: vi.fn(),
  mockStopSync: vi.fn(),
  mockGetSyncSnapshot: vi.fn(),
  mockTouchItem: vi.fn(),
  mockGetSharedRevisions: vi.fn(),
  mockGetCollectionSync: vi.fn(),
  mockGetSharedDirectSync: vi.fn(),
  mockSendMessage: vi.fn(),
  mockGetCollectionKey: vi.fn(),
  mockGetCollectionAccessLevel: vi.fn(),
  mockRefreshCollectionsNow: vi.fn(),
  mockFreeAllCollectionKeys: vi.fn(),
  mockHasRefreshedThisSession: vi.fn(),
  mockEnsureOwnIdentityKeypair: vi.fn(),
  mockFreeIdentityKey: vi.fn(),
}));

vi.mock("../../lib/crypto/wasm-loader", () => ({
  decryptItem: hoisted.mockDecryptItem,
  decryptItemForCollection: hoisted.mockDecryptItemForCollection,
  decryptItemWithSharedKey: hoisted.mockDecryptItemWithSharedKey,
  unsealCollectionKey: hoisted.mockUnsealCollectionKey,
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
  touchItem: hoisted.mockTouchItem,
  getSharedRevisions: hoisted.mockGetSharedRevisions,
  getCollectionSync: hoisted.mockGetCollectionSync,
  getSharedDirectSync: hoisted.mockGetSharedDirectSync,
}));

// 27-04 (Task 1): collections-store.ts/identity-store.ts are mocked wholesale
// -- this file's own job is vault-store.ts's merge/dispatch/lock-order logic,
// not re-proving the Collection Key cache or identity-keypair primitive
// (both already real-WASM-proven by 27-03's own suites).
vi.mock("./collections-store", () => ({
  getCollectionKey: hoisted.mockGetCollectionKey,
  getCollectionAccessLevel: hoisted.mockGetCollectionAccessLevel,
  refreshCollectionsNow: hoisted.mockRefreshCollectionsNow,
  freeAllCollectionKeys: hoisted.mockFreeAllCollectionKeys,
  hasRefreshedThisSession: hoisted.mockHasRefreshedThisSession,
}));

vi.mock("./identity-store", () => ({
  ensureOwnIdentityKeypair: hoisted.mockEnsureOwnIdentityKeypair,
  freeIdentityKey: hoisted.mockFreeIdentityKey,
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

function itemRow(
  id: string,
  overrides: Partial<{
    enc_key: string;
    enc_data: string;
    revision: number;
    updated_at: string;
    last_used_at: string | null;
    is_shared: boolean;
    last_editor_email: string | null;
    collection_id: string | null;
  }> = {},
) {
  return {
    id,
    enc_key: "{}",
    enc_data: "{}",
    revision: 1,
    updated_at: "2026-01-01",
    last_used_at: null,
    // 27-04 (Task 1): the wire's new sharing-metadata fields -- default to
    // an ordinary personal row (unshared, no collection) so every
    // pre-existing test in this file exercises decryptItemRow's PERSONAL
    // branch exactly as before, without touching getCollectionKey at all.
    is_shared: false,
    last_editor_email: null,
    collection_id: null,
    ...overrides,
  };
}

function folderRow(id: string, encName = "{}") {
  return { id, enc_name: encName };
}

/** 27-04 (Task 1): decryptItemRow now unconditionally sets isShared/
 * lastEditorEmail/collectionId/accessLevel -- this helper builds the full
 * expected VaultItem shape for an ORDINARY personal row (the shape every
 * pre-existing test in this file decrypts), so each assertion states the
 * full contract rather than an ellipsis a reader has to reconcile against
 * decryptItemRow's own doc comment by hand. */
function personalVaultItem(overrides: Record<string, unknown>) {
  return {
    isShared: false,
    lastEditorEmail: undefined,
    collectionId: null,
    accessLevel: undefined,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  hoisted.mockSubscribeSessionLockState.mockImplementation((listener: () => void) => {
    lockStateListener = listener;
    return () => {};
  });
  hoisted.mockSendMessage.mockResolvedValue(undefined);
  hoisted.mockGetSyncSnapshot.mockResolvedValue({ revision: 0 });
  // 27-04 (Task 1): every unlock transition now ALSO fires
  // refreshCollectionsNow()/getSharedRevisions() (the eager shared pull) --
  // default both to trivial, self-resolving no-ops so every PRE-EXISTING
  // test in this file (none of which cares about shared data) exercises
  // ensureVaultSyncStarted() without a synchronous throw from an
  // otherwise-unmocked call.
  hoisted.mockRefreshCollectionsNow.mockResolvedValue(undefined);
  hoisted.mockGetSharedRevisions.mockResolvedValue({ collections: [], direct: { revision: 0 } });
  hoisted.mockHasRefreshedThisSession.mockReturnValue(true);
  hoisted.mockGetCollectionKey.mockReturnValue(undefined);
  hoisted.mockGetCollectionAccessLevel.mockReturnValue(undefined);
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
      personalVaultItem({
        id: "i1",
        revision: 1,
        fields: { type: "note", name: "N1", body: "b", folderId: null, tags: [] },
        updatedAt: "2026-01-01",
      }),
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
      personalVaultItem({
        id: "i2",
        revision: 1,
        fields: { type: "note", name: "Second", body: "b2", folderId: null, tags: [] },
        updatedAt: "2026-01-01",
      }),
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

  it("Test 13 (27-04, A-1's collection-scope dispatch): a row with a non-null collection_id decrypts via decryptItemForCollection, never decryptItem", async () => {
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockGetCollectionKey.mockReturnValue({ tag: "ck" });
    hoisted.mockGetCollectionAccessLevel.mockReturnValue("edit");
    hoisted.mockDecryptItemForCollection.mockReturnValue(
      JSON.stringify({ type: "note", name: "Shared", body: "b", folderId: null, tags: [] }),
    );
    const { applySyncSnapshot, getItems } = await import("./vault-store");

    applySyncSnapshot({
      revision: 1,
      items: [itemRow("i1", { collection_id: "c1", is_shared: true })],
    });

    expect(hoisted.mockDecryptItem).not.toHaveBeenCalled();
    expect(hoisted.mockDecryptItemForCollection).toHaveBeenCalledWith({ tag: "ck" }, expect.any(String), "c1", "i1", 1);
    expect(getItems()).toEqual([
      {
        id: "i1",
        revision: 1,
        fields: { type: "note", name: "Shared", body: "b", folderId: null, tags: [] },
        updatedAt: "2026-01-01",
        isShared: true,
        lastEditorEmail: undefined,
        collectionId: "c1",
        accessLevel: "edit",
      },
    ]);
  });

  it("Test 14 (27-04, CollectionKeyPendingError): a collection-scoped row with no cached key AND hasRefreshedThisSession() false is recorded as PENDING, not dropped silently", async () => {
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockGetCollectionKey.mockReturnValue(undefined);
    hoisted.mockHasRefreshedThisSession.mockReturnValue(false);
    const { applySyncSnapshot, getItems, getPendingSharedItems } = await import("./vault-store");

    applySyncSnapshot({
      revision: 1,
      items: [itemRow("i1", { collection_id: "c1", is_shared: true })],
    });

    expect(getItems()).toEqual([]);
    expect(getPendingSharedItems()).toEqual([{ id: "i1", collectionId: "c1", status: "pending" }]);
  });

  it("Test 15 (27-04, must_haves.prohibitions): a collection-scoped row that is genuinely BROKEN (key resolved, decrypt still fails) is ALSO recorded via getPendingSharedItems(), never simply absent with no trace", async () => {
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockGetCollectionKey.mockReturnValue({ tag: "ck" });
    hoisted.mockHasRefreshedThisSession.mockReturnValue(true);
    hoisted.mockDecryptItemForCollection.mockImplementation(() => {
      throw new Error("AEAD integrity check failed");
    });
    const { applySyncSnapshot, getItems, getPendingSharedItems } = await import("./vault-store");

    applySyncSnapshot({
      revision: 1,
      items: [itemRow("i1", { collection_id: "c1", is_shared: true })],
    });

    expect(getItems()).toEqual([]);
    expect(getPendingSharedItems()).toEqual([{ id: "i1", collectionId: "c1", status: "broken" }]);
  });

  it("Test 16 (27-04): a row that later resolves clears its own pending entry", async () => {
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockGetCollectionKey.mockReturnValue(undefined);
    hoisted.mockHasRefreshedThisSession.mockReturnValue(false);
    const { applySyncSnapshot, getPendingSharedItems } = await import("./vault-store");

    applySyncSnapshot({ revision: 1, items: [itemRow("i1", { collection_id: "c1", is_shared: true })] });
    expect(getPendingSharedItems()).toEqual([{ id: "i1", collectionId: "c1", status: "pending" }]);

    hoisted.mockGetCollectionKey.mockReturnValue({ tag: "ck" });
    hoisted.mockGetCollectionAccessLevel.mockReturnValue("edit");
    hoisted.mockDecryptItemForCollection.mockReturnValue(
      JSON.stringify({ type: "note", name: "Now resolved", body: "b", folderId: null, tags: [] }),
    );
    applySyncSnapshot({ revision: 2, items: [itemRow("i1", { collection_id: "c1", is_shared: true })] });

    expect(getPendingSharedItems()).toEqual([]);
  });

  it("Test 17 (27-04): a personal row's own decrypt failure is skipped (dropped) WITHOUT being recorded via getPendingSharedItems() -- that stub path is collection-scoped only", async () => {
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockDecryptItem.mockImplementation(() => {
      throw new Error("corrupt personal row");
    });
    const { applySyncSnapshot, getItems, getPendingSharedItems } = await import("./vault-store");

    applySyncSnapshot({ revision: 1, items: [itemRow("i1")] });

    expect(getItems()).toEqual([]);
    expect(getPendingSharedItems()).toEqual([]);
  });

  it("Test 17b (27-12, Blocker 1): markPending's reattempt UPSERTS the status for the SAME row id rather than ignoring the second call -- a row classified 'pending' on the first attempt is upgraded to 'broken' once hasRefreshedThisSession() flips true and the key still doesn't resolve", async () => {
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockGetCollectionKey.mockReturnValue(undefined);
    hoisted.mockHasRefreshedThisSession.mockReturnValue(false);
    const { applySyncSnapshot, getPendingSharedItems } = await import("./vault-store");

    // First attempt: collections store hasn't refreshed this session yet --
    // classified "pending".
    applySyncSnapshot({
      revision: 1,
      items: [itemRow("i1", { collection_id: "c1", is_shared: true })],
    });
    expect(getPendingSharedItems()).toEqual([{ id: "i1", collectionId: "c1", status: "pending" }]);

    // Second attempt for the SAME row id: the refresh has now completed, but
    // the key is STILL unresolvable -- must upgrade to "broken" in place,
    // never append a second entry for the same id.
    hoisted.mockHasRefreshedThisSession.mockReturnValue(true);
    applySyncSnapshot({
      revision: 2,
      items: [itemRow("i1", { collection_id: "c1", is_shared: true })],
    });
    expect(getPendingSharedItems()).toEqual([{ id: "i1", collectionId: "c1", status: "broken" }]);
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

  it("Test 3b (27-04, A-1's key_links): on unlock, ALSO refreshes the collections store AND runs the eager shared-revisions pull", async () => {
    await import("./vault-store");
    hoisted.mockIsSessionUnlocked.mockReturnValue(true);

    lockStateListener();
    await Promise.resolve();
    await Promise.resolve();

    expect(hoisted.mockRefreshCollectionsNow).toHaveBeenCalledTimes(1);
    expect(hoisted.mockGetSharedRevisions).toHaveBeenCalledTimes(1);
  });

  it("Test 4 (Pitfall 4 / T-09-18 / A-3): on lock, stopSync() runs BEFORE items/folders AND the new identity/Collection-Key caches are cleared, in that exact order", async () => {
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
    // if the clear happened first, this would already be empty. Also
    // records the RELATIVE call order of stopSync vs. the two new key-cache
    // frees this plan adds.
    const callOrder: string[] = [];
    let itemsAtStopSyncTime = -1;
    let foldersAtStopSyncTime = -1;
    hoisted.mockStopSync.mockImplementation(() => {
      callOrder.push("stopSync");
      itemsAtStopSyncTime = vaultStore.getItems().length;
      foldersAtStopSyncTime = vaultStore.getFolders().length;
    });
    hoisted.mockFreeAllCollectionKeys.mockImplementation(() => {
      callOrder.push("freeAllCollectionKeys");
    });
    hoisted.mockFreeIdentityKey.mockImplementation(() => {
      callOrder.push("freeIdentityKey");
    });

    hoisted.mockIsSessionUnlocked.mockReturnValue(false);
    lockStateListener();

    expect(hoisted.mockStopSync).toHaveBeenCalledTimes(1);
    expect(itemsAtStopSyncTime).toBe(1); // stopSync saw the PRE-clear state
    expect(foldersAtStopSyncTime).toBe(1);

    // 27-04 (A-3): freeAllCollectionKeys/freeIdentityKey run in the SAME
    // handler, immediately AFTER stopSync -- never before it, never via a
    // second listener.
    expect(callOrder).toEqual(["stopSync", "freeAllCollectionKeys", "freeIdentityKey"]);

    // Test 4's own assertion: getItems()/getFolders() are empty immediately
    // after the lock event completes -- no plaintext survives a lock.
    expect(vaultStore.getItems()).toEqual([]);
    expect(vaultStore.getFolders()).toEqual([]);
  });

  it("Test 4b (27-04): on lock, getPendingSharedItems() is also cleared", async () => {
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockGetCollectionKey.mockReturnValue(undefined);
    hoisted.mockHasRefreshedThisSession.mockReturnValue(false);
    const vaultStore = await import("./vault-store");

    vaultStore.applySyncSnapshot({
      revision: 1,
      items: [itemRow("i1", { collection_id: "c1", is_shared: true })],
    });
    expect(vaultStore.getPendingSharedItems()).toEqual([{ id: "i1", collectionId: "c1", status: "pending" }]);

    hoisted.mockIsSessionUnlocked.mockReturnValue(false);
    lockStateListener();

    expect(vaultStore.getPendingSharedItems()).toEqual([]);
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
      personalVaultItem({
        id: "i1",
        revision: 1,
        fields: { type: "note", name: "N1", body: "b", folderId: null, tags: [] },
        updatedAt: "2026-01-01",
      }),
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

  it("Test 9 (WR-03, iteration 2): ensureItemsHydrated() resolves ok:true only AFTER the initial pull settles, with items populated by then", async () => {
    hoisted.mockIsSessionUnlocked.mockReturnValue(true);
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockDecryptItem.mockReturnValue(
      JSON.stringify({ type: "note", name: "N1", body: "b", folderId: null, tags: [] }),
    );
    let resolveSnapshot!: (snapshot: { revision: number; items?: unknown[] }) => void;
    hoisted.mockGetSyncSnapshot.mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );

    const { ensureItemsHydrated, getItems } = await import("./vault-store");

    const hydrated = ensureItemsHydrated();

    // Still empty -- the pull hasn't settled yet.
    expect(getItems()).toEqual([]);

    resolveSnapshot({ revision: 1, items: [itemRow("i1")] });
    const result = await hydrated;

    expect(result).toEqual({ ok: true });
    expect(getItems()).toEqual([
      personalVaultItem({
        id: "i1",
        revision: 1,
        fields: { type: "note", name: "N1", body: "b", folderId: null, tags: [] },
        updatedAt: "2026-01-01",
      }),
    ]);
  });

  it("Test 10 (WR-03, iteration 2): ensureItemsHydrated() is single-flight -- concurrent callers share ONE getSyncSnapshot(0) pull", async () => {
    hoisted.mockIsSessionUnlocked.mockReturnValue(true);
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockGetSyncSnapshot.mockResolvedValue({ revision: 0 });

    const { ensureItemsHydrated } = await import("./vault-store");

    const [a, b] = await Promise.all([ensureItemsHydrated(), ensureItemsHydrated()]);

    expect(hoisted.mockGetSyncSnapshot).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
  });

  it("Test 11 (WR-03, iteration 2): ensureItemsHydrated() resolves ok:false when the initial pull fails -- cache state is unknown, not confirmed empty", async () => {
    hoisted.mockIsSessionUnlocked.mockReturnValue(true);
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    const pullError = new Error("network down");
    hoisted.mockGetSyncSnapshot.mockRejectedValue(pullError);

    const { ensureItemsHydrated } = await import("./vault-store");

    const result = await ensureItemsHydrated();

    expect(result).toEqual({ ok: false, error: pullError });
  });

  it("Test 12 (WR-03, iteration 2): a re-unlock after a lock awaits a NEW pull, not the previous session's stale settled promise", async () => {
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockGetSyncSnapshot.mockResolvedValueOnce({ revision: 1 }).mockResolvedValueOnce({ revision: 2 });

    const vaultStore = await import("./vault-store");

    hoisted.mockIsSessionUnlocked.mockReturnValue(true);
    await vaultStore.ensureItemsHydrated();
    expect(hoisted.mockGetSyncSnapshot).toHaveBeenCalledTimes(1);

    hoisted.mockIsSessionUnlocked.mockReturnValue(false);
    lockStateListener(); // lock transition -- resets initialPullSettled

    hoisted.mockIsSessionUnlocked.mockReturnValue(true);
    lockStateListener(); // re-unlock transition
    await vaultStore.ensureItemsHydrated();

    expect(hoisted.mockGetSyncSnapshot).toHaveBeenCalledTimes(2);
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

describe("shared-revisions merge (27-04, A-1's mergeCollectionSnapshot/mergeDirectSnapshot/doHandleSharedRevisions)", () => {
  it("Test 18: a collection whose revision moved is pulled via getCollectionSync and merged into the public items view", async () => {
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockGetCollectionKey.mockReturnValue({ tag: "ck" });
    hoisted.mockGetCollectionAccessLevel.mockReturnValue("edit");
    hoisted.mockDecryptItemForCollection.mockReturnValue(
      JSON.stringify({ type: "note", name: "Shared", body: "b", folderId: null, tags: [] }),
    );
    hoisted.mockGetCollectionSync.mockResolvedValue({
      revision: 1,
      items: [itemRow("i1", { collection_id: "c1", is_shared: true })],
    });

    const { handleSharedRevisions, getItems } = await import("./vault-store");

    await handleSharedRevisions({ collections: [{ id: "c1", revision: 1 }], direct: { revision: 0 } });

    expect(hoisted.mockGetCollectionSync).toHaveBeenCalledWith("c1");
    expect(getItems()).toEqual([
      {
        id: "i1",
        revision: 1,
        fields: { type: "note", name: "Shared", body: "b", folderId: null, tags: [] },
        updatedAt: "2026-01-01",
        isShared: true,
        lastEditorEmail: undefined,
        collectionId: "c1",
        accessLevel: "edit",
      },
    ]);
  });

  it("Test 19: an UNCHANGED shared-revisions payload (matching the last-known watermark) is a silent no-op -- no getCollectionSync round trip", async () => {
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    const { handleSharedRevisions } = await import("./vault-store");

    // First call establishes the watermark.
    hoisted.mockGetCollectionSync.mockResolvedValue({ revision: 1, items: [] });
    await handleSharedRevisions({ collections: [{ id: "c1", revision: 1 }], direct: { revision: 0 } });
    expect(hoisted.mockGetCollectionSync).toHaveBeenCalledTimes(1);

    // Second call, IDENTICAL payload -- must not re-fetch.
    await handleSharedRevisions({ collections: [{ id: "c1", revision: 1 }], direct: { revision: 0 } });
    expect(hoisted.mockGetCollectionSync).toHaveBeenCalledTimes(1);
  });

  it("Test 20: a directly-shared item is decrypted via the identity-keypair/unseal sequence, never decryptItem/decryptItemForCollection", async () => {
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    const fakeIdentityKey = { free: vi.fn() };
    hoisted.mockEnsureOwnIdentityKeypair.mockResolvedValue(fakeIdentityKey);
    hoisted.mockUnsealCollectionKey.mockReturnValue({ tag: "unsealed-item-key", free: vi.fn() });
    hoisted.mockDecryptItemWithSharedKey.mockReturnValue(
      JSON.stringify({ type: "note", name: "Direct Share", body: "b", folderId: null, tags: [] }),
    );
    hoisted.mockGetSharedDirectSync.mockResolvedValue({
      revision: 1,
      items: [
        {
          id: "i1",
          enc_data: "{}",
          sealed_key: "sealed-blob",
          revision: 1,
          updated_at: "2026-01-01",
          last_used_at: null,
          is_shared: true,
          last_editor_email: null,
          access_level: "read",
        },
      ],
    });

    const { handleSharedRevisions, getItems } = await import("./vault-store");

    await handleSharedRevisions({ collections: [], direct: { revision: 1 } });

    expect(hoisted.mockDecryptItem).not.toHaveBeenCalled();
    expect(hoisted.mockDecryptItemForCollection).not.toHaveBeenCalled();
    expect(hoisted.mockDecryptItemWithSharedKey).toHaveBeenCalledWith(
      { tag: "unsealed-item-key", free: expect.any(Function) },
      "{}",
      "i1",
      1,
    );
    expect(getItems()).toEqual([
      {
        id: "i1",
        revision: 1,
        fields: { type: "note", name: "Direct Share", body: "b", folderId: null, tags: [] },
        updatedAt: "2026-01-01",
        isShared: true,
        lastEditorEmail: undefined,
        collectionId: null,
        sharedToMe: true,
        accessLevel: "read",
      },
    ]);
    expect(fakeIdentityKey.free).toHaveBeenCalled();
  });

  it("Test 21: a collection the caller is no longer a member of is purged from collectionSharedItems AND pendingSharedItems on the next revisions tick", async () => {
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockGetCollectionKey.mockReturnValue({ tag: "ck" });
    hoisted.mockGetCollectionAccessLevel.mockReturnValue("edit");
    hoisted.mockDecryptItemForCollection.mockReturnValue(
      JSON.stringify({ type: "note", name: "Shared", body: "b", folderId: null, tags: [] }),
    );
    hoisted.mockGetCollectionSync.mockResolvedValue({
      revision: 1,
      items: [itemRow("i1", { collection_id: "c1", is_shared: true })],
    });

    const { handleSharedRevisions, getItems } = await import("./vault-store");

    await handleSharedRevisions({ collections: [{ id: "c1", revision: 1 }], direct: { revision: 0 } });
    expect(getItems()).toHaveLength(1);

    // c1 is now absent from the revisions payload -- membership revoked.
    await handleSharedRevisions({ collections: [], direct: { revision: 0 } });

    expect(getItems()).toEqual([]);
  });
});

// NordPass-style last-used tracking (quick-260717): the single fire-and-
// forget choke-point every fill/TOTP-code/passkey-ceremony/popup-copy call
// site in this extension goes through.
describe("touchVaultItem", () => {
  it("calls the touch endpoint and optimistically updates the item's lastUsedAt on success", async () => {
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockDecryptItem.mockReturnValue(
      JSON.stringify({ type: "note", name: "N1", body: "b", folderId: null, tags: [] }),
    );
    hoisted.mockTouchItem.mockResolvedValue({ last_used_at: "2026-07-17 09:00:00" });
    const vaultStore = await import("./vault-store");

    vaultStore.applySyncSnapshot({ revision: 1, items: [itemRow("i1")] });

    vaultStore.touchVaultItem("i1");
    await Promise.resolve();
    await Promise.resolve();

    expect(hoisted.mockTouchItem).toHaveBeenCalledWith("i1");
    const item = vaultStore.getItems().find((i) => i.id === "i1");
    expect(item?.lastUsedAt).toBe("2026-07-17 09:00:00");
  });

  it("never throws and leaves lastUsedAt unset when the touch request fails (fire-and-forget)", async () => {
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockDecryptItem.mockReturnValue(
      JSON.stringify({ type: "note", name: "N1", body: "b", folderId: null, tags: [] }),
    );
    hoisted.mockTouchItem.mockRejectedValue(new Error("offline"));
    const vaultStore = await import("./vault-store");

    vaultStore.applySyncSnapshot({ revision: 1, items: [itemRow("i1")] });

    expect(() => vaultStore.touchVaultItem("i1")).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    const item = vaultStore.getItems().find((i) => i.id === "i1");
    expect(item?.lastUsedAt).toBeUndefined();
  });

  it("is a safe no-op when the touched id is no longer in the in-memory store", async () => {
    hoisted.mockTouchItem.mockResolvedValue({ last_used_at: "2026-07-17 09:00:00" });
    const vaultStore = await import("./vault-store");

    vaultStore.touchVaultItem("never-existed");
    await Promise.resolve();
    await Promise.resolve();

    expect(vaultStore.getItems()).toEqual([]);
  });
});
