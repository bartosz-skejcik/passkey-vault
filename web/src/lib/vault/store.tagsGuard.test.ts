// WR-08 layer 2 — the ONE test that holds `recomputeAllTags`'s `?? []`
// in place.
//
// Why a separate file. 26-VERIFICATION.md's mutation check found that
// removing `recomputeAllTags`'s `?? []` left the whole 785-test suite green:
// the guard the WR-08 fixer named "the load-bearing one ... it does not
// depend on a choke point staying complete forever, which is exactly the
// assumption that failed twice already" was the one layer no test would
// notice disappearing. Layers 1 (`normalizeItemFields` at both write
// boundaries) and 3 (the post-commit try/catch) are both mutation-verified
// in store.test.ts; this file covers layer 2.
//
// The premise the layer exists for, made literal. Layer 2 is only ever
// reachable when the normalizer choke point is INCOMPLETE — a future writer,
// a new read path, a new item type, or an extension/mobile client whose own
// store wiring forgets to normalize. That has already happened twice in this
// repo (WINDOWS #10's live account wedge, then WR-08's discovery that the
// decrypt-boundary guard never covered the write boundary). So this file
// mocks `normalizeItemFields` to the identity function: not to weaken
// anything, but because a bypassed normalizer is precisely and only the
// state in which layer 2 does any work at all. With the choke point intact
// (every other test file in this suite), layer 2 is by construction
// unobservable — which is exactly why the whole suite stayed green under the
// mutation.
//
// Mutation evidence (26-VERIFICATION-FIX.md records the verbatim output):
// deleting `?? []` from `recomputeAllTags` makes both tests below fail —
// `applySyncSnapshot` calls `recomputeItems()` unguarded, so the TypeError
// escapes `loadAndDecryptAll` and the unlock leaves the store empty.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";

const {
  mockGetUnlockedUserKey,
  mockIsUnlocked,
  mockSubscribeLockState,
  mockDecryptItem,
  mockGetSyncSnapshot,
  mockGetSharedRevisions,
  mockStartSync,
  mockStopSync,
  mockGetCollectionKey,
  mockRefreshCollectionsNow,
  mockEnsureOwnIdentityKeypair,
} = vi.hoisted(() => ({
  mockGetUnlockedUserKey: vi.fn(),
  mockIsUnlocked: vi.fn(),
  mockSubscribeLockState: vi.fn(),
  mockDecryptItem: vi.fn(),
  mockGetSyncSnapshot: vi.fn(),
  mockGetSharedRevisions: vi.fn(),
  mockStartSync: vi.fn(),
  mockStopSync: vi.fn(),
  mockGetCollectionKey: vi.fn(),
  mockRefreshCollectionsNow: vi.fn(),
  mockEnsureOwnIdentityKeypair: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  getUnlockedUserKey: mockGetUnlockedUserKey,
  isUnlocked: mockIsUnlocked,
  subscribeLockState: mockSubscribeLockState,
  encryptItem: vi.fn(),
  encryptItemForCollection: vi.fn(),
  decryptItem: mockDecryptItem,
  decryptItemForCollection: vi.fn(),
  decryptItemWithSharedKey: vi.fn(),
  unsealCollectionKey: vi.fn(),
}));

vi.mock("./api", () => ({
  getSyncSnapshot: mockGetSyncSnapshot,
  getSharedRevisions: mockGetSharedRevisions,
  getCollectionSync: vi.fn(),
  getSharedDirectSync: vi.fn(),
  createItem: vi.fn(),
  createFolder: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  deleteFolder: vi.fn(),
  touchItem: vi.fn(),
}));

vi.mock("./sync", () => ({
  startSync: mockStartSync,
  stopSync: mockStopSync,
}));

vi.mock("@/lib/vault/collections", () => ({
  getCollectionKey: mockGetCollectionKey,
  refreshCollectionsNow: mockRefreshCollectionsNow,
}));

vi.mock("@/lib/identity/ensure", () => ({
  ensureOwnIdentityKeypair: mockEnsureOwnIdentityKeypair,
}));

// THE mock this file exists for: a store whose normalizer choke point has a
// hole in it. Everything else in `./types` (the `Folder`/`ItemFields`/
// `VaultItem` types store.ts imports, and `normalizeItemFields`'s real
// implementation for every OTHER importer) is left untouched.
vi.mock("./types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./types")>();
  return {
    ...actual,
    normalizeItemFields: (raw: unknown) => raw,
  };
});

/** A perfectly ordinary login plaintext with no `tags` key at all — byte-for-
 * byte the shape WINDOWS #10's live repro found on the wire (a foreign
 * client's post-rekey item). */
const PLAINTEXT_WITHOUT_TAGS = JSON.stringify({
  type: "login",
  name: "Written by a client that never normalized",
  username: "u",
  password: "p",
  urls: [],
  notes: "",
  folderId: null,
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockGetSharedRevisions.mockResolvedValue({ collections: [], direct: { revision: 0 } });
  mockRefreshCollectionsNow.mockResolvedValue(undefined);
});

describe("WR-08 layer 2 — recomputeAllTags survives a tags-less item even when the normalizer did not run", () => {
  it("completes the merge and notifies subscribers rather than throwing out of it", async () => {
    mockGetUnlockedUserKey.mockReturnValue({});
    mockGetSyncSnapshot.mockResolvedValue({
      revision: 1,
      items: [
        { id: "unnormalized-1", enc_key: "{}", enc_data: "{}", revision: 1, collection_id: null },
      ],
      folders: [],
    });
    mockDecryptItem.mockReturnValue(PLAINTEXT_WITHOUT_TAGS);

    const store = await import("./store");
    const lockListener = mockSubscribeLockState.mock.calls[0][0] as () => void;
    // Subscribed BEFORE the merge runs. `recomputeItems` assigns `items`,
    // then calls `recomputeAllTags()`, then `notifyListeners()` — so a throw
    // in the middle step leaves `getItems()` looking correct while every
    // subscriber is silently stranded and the UI never re-renders. Asserting
    // on the notification (not just on `getItems()`) is what makes this test
    // able to see the mutation at all.
    const notified = vi.fn();
    store.subscribeItems(notified);

    mockIsUnlocked.mockReturnValue(true);
    await act(async () => {
      lockListener();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Proves the premise: this item genuinely bypassed layer 1 — its
    // `tags` is still absent in the store, so `recomputeAllTags` really did
    // iterate an undefined.
    const items = store.getItems();
    expect(items).toHaveLength(1);
    expect(items[0].fields.tags).toBeUndefined();

    expect(notified).toHaveBeenCalled();
    expect(store.getAllTags()).toEqual([]);
  });

  it("still indexes the tags of every WELL-FORMED item alongside the malformed one", async () => {
    // The `?? []` must skip only the offending item, never abandon the rest
    // of the index — a guard that silently emptied `getAllTags()` would make
    // the Sidebar's whole tag list vanish on one bad row.
    mockGetUnlockedUserKey.mockReturnValue({});
    mockGetSyncSnapshot.mockResolvedValue({
      revision: 1,
      items: [
        { id: "unnormalized-1", enc_key: "{}", enc_data: "{}", revision: 1, collection_id: null },
        { id: "well-formed-1", enc_key: "{}", enc_data: "{}", revision: 1, collection_id: null },
      ],
      folders: [],
    });
    mockDecryptItem
      .mockReturnValueOnce(PLAINTEXT_WITHOUT_TAGS)
      .mockReturnValueOnce(
        JSON.stringify({
          type: "note",
          name: "well formed",
          body: "b",
          folderId: null,
          tags: ["work", "archive"],
        }),
      );

    const store = await import("./store");
    const lockListener = mockSubscribeLockState.mock.calls[0][0] as () => void;
    mockIsUnlocked.mockReturnValue(true);
    await act(async () => {
      lockListener();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(store.getItems()).toHaveLength(2);
    expect(store.getAllTags()).toEqual(["archive", "work"]);
  });
});
