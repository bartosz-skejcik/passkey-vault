// 30-06-PLAN.md Task 1: proves both halves of "one query, two consumers" --
// `getFamilyWidePending()` (families/api.ts, a thin GET wrapper around
// `/api/families/family-wide-pending`, 30-02's discovery endpoint) is
// fail-safe (never throws, resolves to the empty-arrays shape on any error),
// and `familyWidePending.ts`'s module-singleton store exposes a synchronous
// getter that 30-12's reseal-trigger and 30-13's pending-row UI will both
// read from, with `refreshFamilyWidePending()` as the ONLY caller of
// `getFamilyWidePending()` (exactly one fetch per pull cycle).
//
// Single mock boundary for the whole file: `@/lib/auth/api`'s `apiJson` is
// swapped for a controllable mock (mirrors rekey.test.ts's own
// `importOriginal`-spread shape, so `ApiClientError`/`base64Encode`/etc. stay
// real). Both describe blocks below drive `getFamilyWidePending()`'s
// behavior through THIS one mock -- deliberately not also mocking `./api`
// itself, since `vi.mock` calls are hoisted file-wide and a second mock of
// the very module the first describe block imports directly would silently
// shadow it for the whole file, not just its own describe.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApiJson } = vi.hoisted(() => ({
  mockApiJson: vi.fn(),
}));
vi.mock("@/lib/auth/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/api")>()),
  apiJson: mockApiJson,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("getFamilyWidePending() (families/api.ts)", () => {
  it("resolves to the typed {missing, resealable} shape on a 200", async () => {
    const response = {
      missing: [{ collection_id: "col-1", kind: "folder" }],
      resealable: [{ collection_id: "col-2", recipient_user_id: "user-3" }],
    };
    mockApiJson.mockResolvedValue(response);

    const { getFamilyWidePending } = await import("./api");
    await expect(getFamilyWidePending()).resolves.toEqual(response);
    expect(mockApiJson).toHaveBeenCalledTimes(1);
    expect(mockApiJson).toHaveBeenCalledWith(
      "/api/families/family-wide-pending",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("never throws on a network failure -- resolves to empty arrays instead", async () => {
    mockApiJson.mockRejectedValue(new Error("network failure"));

    const { getFamilyWidePending } = await import("./api");
    await expect(getFamilyWidePending()).resolves.toEqual({ missing: [], resealable: [] });
  });

  it("never throws on a 403 (suspended member) -- resolves to empty arrays instead", async () => {
    mockApiJson.mockRejectedValue({ status: 403 });

    const { getFamilyWidePending } = await import("./api");
    await expect(getFamilyWidePending()).resolves.toEqual({ missing: [], resealable: [] });
  });

  it("never throws on a 404 (no-family account) -- resolves to empty arrays instead", async () => {
    mockApiJson.mockRejectedValue({ status: 404 });

    const { getFamilyWidePending } = await import("./api");
    await expect(getFamilyWidePending()).resolves.toEqual({ missing: [], resealable: [] });
  });
});

describe("familyWidePending.ts store", () => {
  it("getFamilyWidePendingSnapshot() returns the empty default synchronously, with zero prior awaits", async () => {
    const { getFamilyWidePendingSnapshot } = await import("./familyWidePending");

    expect(getFamilyWidePendingSnapshot()).toEqual({ missing: [], resealable: [] });
    expect(mockApiJson).not.toHaveBeenCalled();
  });

  it("refreshFamilyWidePending() fetches exactly once per invocation and stores the result", async () => {
    const response = {
      missing: [{ collection_id: "col-1", kind: "item_bucket" }],
      resealable: [],
    };
    mockApiJson.mockResolvedValue(response);

    const { refreshFamilyWidePending, getFamilyWidePendingSnapshot } = await import(
      "./familyWidePending"
    );
    await refreshFamilyWidePending();

    expect(mockApiJson).toHaveBeenCalledTimes(1);
    expect(getFamilyWidePendingSnapshot()).toEqual(response);
  });

  it("refreshFamilyWidePending() notifies every subscribed listener", async () => {
    mockApiJson.mockResolvedValue({ missing: [], resealable: [] });

    const { refreshFamilyWidePending, subscribeFamilyWidePending } = await import(
      "./familyWidePending"
    );
    const listener = vi.fn();
    subscribeFamilyWidePending(listener);
    await refreshFamilyWidePending();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("an unsubscribed listener is never notified by a later refresh", async () => {
    mockApiJson.mockResolvedValue({ missing: [], resealable: [] });

    const { refreshFamilyWidePending, subscribeFamilyWidePending } = await import(
      "./familyWidePending"
    );
    const listener = vi.fn();
    const unsubscribe = subscribeFamilyWidePending(listener);
    unsubscribe();
    await refreshFamilyWidePending();

    expect(listener).not.toHaveBeenCalled();
  });

  it("a failing fetch resolves to the empty-arrays fallback (getFamilyWidePending's own fail-safe), never crashes the refresh", async () => {
    mockApiJson.mockRejectedValue(new Error("network failure"));

    const { refreshFamilyWidePending, getFamilyWidePendingSnapshot } = await import(
      "./familyWidePending"
    );
    await expect(refreshFamilyWidePending()).resolves.toBeUndefined();
    expect(getFamilyWidePendingSnapshot()).toEqual({ missing: [], resealable: [] });
  });
});
