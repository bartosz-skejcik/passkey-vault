// 30-06-PLAN.md Task 1: proves both halves of "one query, two consumers" --
// `getFamilyWidePending()` (families/api.ts, a thin GET wrapper around
// `/api/families/family-wide-pending`, 30-02's discovery endpoint) is
// fail-safe (never throws, resolves to the empty-arrays shape on any error),
// and `familyWidePending.ts`'s module-singleton store exposes a synchronous
// getter that 30-12's reseal-trigger and 30-13's pending-row UI will both
// read from, with `refreshFamilyWidePending()` as the ONLY caller of
// `getFamilyWidePending()` (exactly one fetch per pull cycle).
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- getFamilyWidePending() (families/api.ts) ---------------------------
//
// Mirrors rekey.test.ts's own mocking shape: `@/lib/auth/api` is mocked with
// `importOriginal` spread so `ApiClientError`/`base64Encode`/etc. stay real,
// with only `apiJson` swapped for a controllable mock -- this lets the test
// drive the exact 200 / thrown-error behavior `getFamilyWidePending()` must
// handle without hitting a real network call.
const { mockApiJson } = vi.hoisted(() => ({
  mockApiJson: vi.fn(),
}));
vi.mock("@/lib/auth/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/api")>()),
  apiJson: mockApiJson,
}));

describe("getFamilyWidePending() (families/api.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

// --- familyWidePending.ts's module-singleton store -----------------------
describe("familyWidePending.ts store", () => {
  const { mockGetFamilyWidePending } = vi.hoisted(() => ({
    mockGetFamilyWidePending: vi.fn(),
  }));
  vi.mock("./api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./api")>()),
    getFamilyWidePending: mockGetFamilyWidePending,
  }));

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("getFamilyWidePendingSnapshot() returns the empty default synchronously, with zero prior awaits", async () => {
    const { getFamilyWidePendingSnapshot } = await import("./familyWidePending");

    expect(getFamilyWidePendingSnapshot()).toEqual({ missing: [], resealable: [] });
    expect(mockGetFamilyWidePending).not.toHaveBeenCalled();
  });

  it("refreshFamilyWidePending() calls getFamilyWidePending() exactly once and stores the result", async () => {
    const response = {
      missing: [{ collection_id: "col-1", kind: "item_bucket" }],
      resealable: [],
    };
    mockGetFamilyWidePending.mockResolvedValue(response);

    const { refreshFamilyWidePending, getFamilyWidePendingSnapshot } = await import(
      "./familyWidePending"
    );
    await refreshFamilyWidePending();

    expect(mockGetFamilyWidePending).toHaveBeenCalledTimes(1);
    expect(getFamilyWidePendingSnapshot()).toEqual(response);
  });

  it("refreshFamilyWidePending() notifies every subscribed listener", async () => {
    mockGetFamilyWidePending.mockResolvedValue({ missing: [], resealable: [] });

    const { refreshFamilyWidePending, subscribeFamilyWidePending } = await import(
      "./familyWidePending"
    );
    const listener = vi.fn();
    subscribeFamilyWidePending(listener);
    await refreshFamilyWidePending();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("an unsubscribed listener is never notified by a later refresh", async () => {
    mockGetFamilyWidePending.mockResolvedValue({ missing: [], resealable: [] });

    const { refreshFamilyWidePending, subscribeFamilyWidePending } = await import(
      "./familyWidePending"
    );
    const listener = vi.fn();
    const unsubscribe = subscribeFamilyWidePending(listener);
    unsubscribe();
    await refreshFamilyWidePending();

    expect(listener).not.toHaveBeenCalled();
  });
});
