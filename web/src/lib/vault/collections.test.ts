// 30-05-PLAN.md Task 2: sealed_key-change detection ("a re-key just ran") --
// `onCollectionRekeyed` fires ONLY when an already-known collection's raw
// `sealed_key` blob changes value between two refreshes, never for a
// brand-new grant. This is pure string-diff logic (no crypto assertion
// needed, mirroring `DeleteAccountDialog.test.tsx`'s own "mocked wholesale,
// proves state-machine logic" scope note) -- `@/lib/crypto` is mocked
// wholesale here, unlike `collections.real-wasm.test.ts`'s genuine-decrypt
// proof of the SAME module's name/key-cache behavior.
//
// `vi.resetModules()` + a fresh dynamic `import("./collections")` per test
// (mirrors `store.test.ts`'s own `importStoreAndGetLockListener` pattern):
// `lastSealedKeys` is deliberately a module-private singleton that persists
// across refreshes WITHIN one real app session (so a re-key that happened
// while locked is still detected on the next unlock) -- exactly the state
// that must NOT leak between two independent test cases in the same file.
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetUnlockedUserKey,
  mockIsUnlocked,
  mockSubscribeLockState,
  mockUnsealCollectionKey,
  mockDecryptItemForCollection,
} = vi.hoisted(() => ({
  mockGetUnlockedUserKey: vi.fn(),
  mockIsUnlocked: vi.fn(() => true),
  // Module-level side effect: `collections.ts` calls `subscribeLockState(...)`
  // the instant it's imported. A safe no-op default (mirrors
  // `ShareDialog.test.tsx`'s identical note) so this module's own real
  // refresh logic is instead driven directly via `refreshCollectionsNow()`.
  mockSubscribeLockState: vi.fn(() => () => {}),
  mockUnsealCollectionKey: vi.fn(),
  mockDecryptItemForCollection: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  getUnlockedUserKey: mockGetUnlockedUserKey,
  isUnlocked: mockIsUnlocked,
  subscribeLockState: mockSubscribeLockState,
  unsealCollectionKey: mockUnsealCollectionKey,
  decryptItemForCollection: mockDecryptItemForCollection,
}));

const { mockEnsureOwnIdentityKeypair } = vi.hoisted(() => ({
  mockEnsureOwnIdentityKeypair: vi.fn(),
}));
vi.mock("@/lib/identity/ensure", () => ({
  ensureOwnIdentityKeypair: mockEnsureOwnIdentityKeypair,
}));

const { mockListCollections } = vi.hoisted(() => ({ mockListCollections: vi.fn() }));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  listCollections: mockListCollections,
}));

const COLLECTION_A = "collection-a";
const COLLECTION_B = "collection-b";

function row(id: string, sealedKey: string) {
  return {
    id,
    enc_name: "opaque",
    created_at: "2026-08-10T00:00:00Z",
    access_level: "read",
    sealed_key: sealedKey,
  };
}

/** Fresh module instance per test -- `lastSealedKeys` is a module-private
 * singleton and must not leak between test cases. */
async function importCollectionsFresh() {
  return import("./collections");
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockIsUnlocked.mockReturnValue(true);
  mockGetUnlockedUserKey.mockReturnValue({ label: "uk" });
  mockEnsureOwnIdentityKeypair.mockResolvedValue({ free: vi.fn() });
  // Unseal never fails and never needs to be inspected for this module's own
  // detection logic -- a fresh throwaway handle every call, decrypt returns a
  // harmless JSON name so the name-resolution branch never throws.
  mockUnsealCollectionKey.mockImplementation(() => ({ free: vi.fn() }));
  mockDecryptItemForCollection.mockReturnValue('{"name":"Fixture"}');
});

describe("collections.ts: onCollectionRekeyed sealed_key-change detection (30-05-PLAN.md Task 2)", () => {
  it("(1) fires exactly once, with the collection's id, when an already-known collection's sealed_key changes value", async () => {
    const { onCollectionRekeyed, refreshCollectionsNow } = await importCollectionsFresh();
    const listener = vi.fn();
    const unsubscribe = onCollectionRekeyed(listener);
    try {
      // First refresh establishes COLLECTION_A as "already known" at sealed_key "A".
      mockListCollections.mockResolvedValue([row(COLLECTION_A, "sealed-A")]);
      await refreshCollectionsNow();
      expect(listener).not.toHaveBeenCalled();

      // Second refresh returns the SAME id with a DIFFERENT sealed_key -- a
      // re-key just ran.
      mockListCollections.mockResolvedValue([row(COLLECTION_A, "sealed-B")]);
      await refreshCollectionsNow();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(COLLECTION_A);
    } finally {
      unsubscribe();
    }
  });

  it("(2) does NOT fire when a refresh returns a collection id not previously present (a brand-new grant is not a re-key)", async () => {
    const { onCollectionRekeyed, refreshCollectionsNow } = await importCollectionsFresh();
    const listener = vi.fn();
    const unsubscribe = onCollectionRekeyed(listener);
    try {
      // First refresh already knows about COLLECTION_A only.
      mockListCollections.mockResolvedValue([row(COLLECTION_A, "sealed-A")]);
      await refreshCollectionsNow();

      // Second refresh adds a BRAND-NEW collection id -- never seen before.
      mockListCollections.mockResolvedValue([
        row(COLLECTION_A, "sealed-A"),
        row(COLLECTION_B, "sealed-fresh-grant"),
      ]);
      await refreshCollectionsNow();

      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("does NOT fire when an already-known collection's sealed_key is unchanged across refreshes", async () => {
    const { onCollectionRekeyed, refreshCollectionsNow } = await importCollectionsFresh();
    const listener = vi.fn();
    const unsubscribe = onCollectionRekeyed(listener);
    try {
      mockListCollections.mockResolvedValue([row(COLLECTION_A, "sealed-A")]);
      await refreshCollectionsNow();

      mockListCollections.mockResolvedValue([row(COLLECTION_A, "sealed-A")]);
      await refreshCollectionsNow();

      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
});
