import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { VaultItem } from "./types";

const { mockGetCollectionAccessList, mockListItemShares } = vi.hoisted(() => ({
  mockGetCollectionAccessList: vi.fn(),
  mockListItemShares: vi.fn(),
}));

vi.mock("./api", () => ({
  getCollectionAccessList: mockGetCollectionAccessList,
  listItemShares: mockListItemShares,
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

beforeEach(() => {
  vi.clearAllMocks();
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
});
