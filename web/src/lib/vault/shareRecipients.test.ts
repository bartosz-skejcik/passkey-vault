import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { VaultItem } from "./types";

const { mockGetCollectionAccessList, mockListItemShares, mockMe } = vi.hoisted(() => ({
  mockGetCollectionAccessList: vi.fn(),
  mockListItemShares: vi.fn(),
  // WR-03: the caller's own id, used to drop the caller from their own
  // avatar stack. Mocked at the wire boundary like the other two.
  mockMe: vi.fn(),
}));

vi.mock("./api", () => ({
  getCollectionAccessList: mockGetCollectionAccessList,
  listItemShares: mockListItemShares,
}));

vi.mock("@/lib/auth/api", () => ({
  me: mockMe,
}));

// WR-12: this module now registers a lock-state listener at import time
// (mirroring collections.ts). Mocked so this file stays a pure unit test of
// the caching/resolution logic -- `lockListener` below is the captured
// callback, invoked directly to simulate a lock event.
const { mockSubscribeLockState, mockIsUnlocked, lockState } = vi.hoisted(() => {
  const lockState = { listener: null as null | (() => void), unlocked: true };
  return {
    lockState,
    mockSubscribeLockState: vi.fn((listener: () => void) => {
      lockState.listener = listener;
      return () => {};
    }),
    mockIsUnlocked: vi.fn(() => lockState.unlocked),
  };
});

vi.mock("@/lib/crypto", () => ({
  subscribeLockState: mockSubscribeLockState,
  isUnlocked: mockIsUnlocked,
}));

import { useShareRecipients } from "./shareRecipients";

function makeItem(overrides: Partial<VaultItem> = {}): VaultItem {
  return {
    id: "item-1",
    revision: 1,
    fields: { type: "note", name: "Note", body: "", folderId: null, tags: [] },
    collectionId: null,
    isShared: false,
    ...overrides,
  };
}

const SELF_ID = "self-user-id";

beforeEach(() => {
  vi.clearAllMocks();
  mockMe.mockResolvedValue({ user_id: SELF_ID, email: "me@example.com", pw_wrapped_uk: "x" });
});

describe("useShareRecipients", () => {
  it("returns [] immediately (no fetch) for an item with no collection and not shared", async () => {
    const { result } = renderHook(() => useShareRecipients(makeItem()));
    await waitFor(() => expect(result.current).toEqual([]));
    expect(mockGetCollectionAccessList).not.toHaveBeenCalled();
    expect(mockListItemShares).not.toHaveBeenCalled();
  });

  it("returns [] immediately (no fetch) when item is null", async () => {
    const { result } = renderHook(() => useShareRecipients(null));
    await waitFor(() => expect(result.current).toEqual([]));
    expect(mockGetCollectionAccessList).not.toHaveBeenCalled();
    expect(mockListItemShares).not.toHaveBeenCalled();
  });

  it("resolves a collection-scoped item via getCollectionAccessList and fetches that COLLECTION only ONCE across two items sharing one collectionId (N+1 avoidance)", async () => {
    mockGetCollectionAccessList.mockResolvedValue([
      { user_id: "u1", email: "anna@example.com", access_level: "read", created_at: "t", suspended: false },
      { user_id: "u2", email: "tomasz@example.com", access_level: "edit", created_at: "t", suspended: false },
    ]);

    const itemA = makeItem({ id: "item-a", collectionId: "col-shared-1" });
    const itemB = makeItem({ id: "item-b", collectionId: "col-shared-1" });

    const { result: resultA } = renderHook(() => useShareRecipients(itemA));
    const { result: resultB } = renderHook(() => useShareRecipients(itemB));

    await waitFor(() => expect(resultA.current).not.toBeNull());
    await waitFor(() => expect(resultB.current).not.toBeNull());

    expect(resultA.current).toEqual([
      { email: "anna@example.com", suspended: false },
      { email: "tomasz@example.com", suspended: false },
    ]);
    expect(resultB.current).toEqual(resultA.current);
    // The whole point: ONE fetch for the collection, reused by every item in it.
    expect(mockGetCollectionAccessList).toHaveBeenCalledTimes(1);
    expect(mockGetCollectionAccessList).toHaveBeenCalledWith("col-shared-1");
    expect(mockListItemShares).not.toHaveBeenCalled();
  });

  it("resolves a directly-shared personal item via listItemShares, caching by item id", async () => {
    mockListItemShares.mockResolvedValue([
      { user_id: "u3", email: "kasia@example.com", access_level: "hidden_password", created_at: "t", suspended: true },
    ]);

    const item = makeItem({ id: "item-direct-1", collectionId: null, isShared: true });
    const { result } = renderHook(() => useShareRecipients(item));

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toEqual([{ email: "kasia@example.com", suspended: true }]);
    expect(mockListItemShares).toHaveBeenCalledTimes(1);
    expect(mockListItemShares).toHaveBeenCalledWith("item-direct-1");
    expect(mockGetCollectionAccessList).not.toHaveBeenCalled();

    // A second hook instance for the SAME item id reuses the cached fetch.
    const { result: result2 } = renderHook(() => useShareRecipients(makeItem({ id: "item-direct-1", isShared: true })));
    await waitFor(() => expect(result2.current).not.toBeNull());
    expect(mockListItemShares).toHaveBeenCalledTimes(1);
  });

  it("returns null (unresolved) synchronously before the fetch settles -- E5's loading backstop", async () => {
    let resolveFetch: (value: unknown[]) => void = () => {};
    mockGetCollectionAccessList.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const item = makeItem({ id: "item-loading", collectionId: "col-loading" });
    const { result } = renderHook(() => useShareRecipients(item));
    expect(result.current).toBeNull();

    resolveFetch([]);
    await waitFor(() => expect(result.current).toEqual([]));
  });

  it("resolves to [] (fail-safe) rather than throwing when the fetch rejects", async () => {
    mockListItemShares.mockRejectedValue(new Error("network error"));
    const item = makeItem({ id: "item-fail", collectionId: null, isShared: true });
    const { result } = renderHook(() => useShareRecipients(item));
    await waitFor(() => expect(result.current).toEqual([]));
  });

  // WR-03 (code review, Phase 26): both endpoints include the CALLER's own
  // row (the creator's collection_keys row is hard-coded `edit`
  // server-side; a recipient listing an item shared to them sees
  // themselves), so an unfiltered stack rendered the caller's own initial
  // and reported n+1 in sharing.sharedWithLabel.
  it("drops the caller's own entry from a collection's recipient list", async () => {
    mockGetCollectionAccessList.mockResolvedValue([
      { user_id: SELF_ID, email: "me@example.com", access_level: "edit", created_at: "t", suspended: false },
      { user_id: "u1", email: "anna@example.com", access_level: "read", created_at: "t", suspended: false },
    ]);
    const item = makeItem({ id: "item-self-col", collectionId: "col-self-filter" });
    const { result } = renderHook(() => useShareRecipients(item));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toEqual([{ email: "anna@example.com", suspended: false }]);
  });

  it("drops the caller's own entry from a direct item share's recipient list", async () => {
    mockListItemShares.mockResolvedValue([
      { user_id: SELF_ID, email: "me@example.com", access_level: "read", created_at: "t", suspended: false },
      { user_id: "u2", email: "tomasz@example.com", access_level: "read", created_at: "t", suspended: false },
    ]);
    const item = makeItem({ id: "item-self-direct", collectionId: null, isShared: true });
    const { result } = renderHook(() => useShareRecipients(item));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toEqual([{ email: "tomasz@example.com", suspended: false }]);
  });

  // WR-12 (code review, Phase 26): the caches hold co-recipient EMAIL
  // ADDRESSES; nothing cleared them on lock, so a locked vault kept a
  // roster of who shares what until the tab was closed (and served it stale
  // to a different account on re-unlock).
  it("clears every cached roster on lock, so the next unlock re-fetches instead of serving a stale one", async () => {
    mockListItemShares.mockResolvedValue([
      { user_id: "u3", email: "kasia@example.com", access_level: "read", created_at: "t", suspended: false },
    ]);
    const item = makeItem({ id: "item-lock-clear", collectionId: null, isShared: true });
    const { result } = renderHook(() => useShareRecipients(item));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(mockListItemShares).toHaveBeenCalledTimes(1);

    // A lock event fires this module's own listener.
    expect(lockState.listener).not.toBeNull();
    lockState.unlocked = false;
    lockState.listener?.();
    lockState.unlocked = true;

    const { result: afterLock } = renderHook(() => useShareRecipients(item));
    await waitFor(() => expect(afterLock.current).not.toBeNull());
    // Re-fetched rather than served from the cache that survived the lock.
    expect(mockListItemShares).toHaveBeenCalledTimes(2);
  });
});
