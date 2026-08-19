import { beforeEach, describe, expect, it, vi } from "vitest";
import { base64Encode } from "@/lib/auth/api";

// --- Fake WASM layer -------------------------------------------------------
// `@/lib/crypto` is mocked wholesale (mirrors `lib/invite/crypto.test.ts`'s
// convention of mocking the crypto boundary, not raw wasm) -- this is the
// FAST, logic-only lane; the genuine crypto claim is proven separately by
// `reseal.real-wasm.test.ts`, which mocks NOTHING from `@/lib/crypto`.
//
// vi.mock() factories are hoisted above every other top-level statement in
// this file, so every symbol a factory references must be constructed
// INSIDE a vi.hoisted() block, not merely declared above it in source order.
const {
  mockInitCrypto,
  mockUnsealCollectionKey,
  mockSealCollectionKey,
  ckFreeSpy,
  pkFreeSpy,
  identityFreeSpy,
} = vi.hoisted(() => ({
  mockInitCrypto: vi.fn().mockResolvedValue(undefined),
  mockUnsealCollectionKey: vi.fn(),
  mockSealCollectionKey: vi.fn(),
  ckFreeSpy: vi.fn(),
  pkFreeSpy: vi.fn(),
  identityFreeSpy: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  initCrypto: mockInitCrypto,
  WasmIdentityPublicKey: {
    fromBytes: (bytes: Uint8Array) => ({ bytes, free: pkFreeSpy }),
  },
  unsealCollectionKey: mockUnsealCollectionKey,
  sealCollectionKey: mockSealCollectionKey,
}));

const { mockEnsureOwnIdentityKeypair } = vi.hoisted(() => ({
  mockEnsureOwnIdentityKeypair: vi.fn(),
}));
vi.mock("@/lib/identity/ensure", () => ({ ensureOwnIdentityKeypair: mockEnsureOwnIdentityKeypair }));

const { mockGetCollection, mockAddCollectionMember } = vi.hoisted(() => ({
  mockGetCollection: vi.fn(),
  mockAddCollectionMember: vi.fn(),
}));
vi.mock("@/lib/vault/api", () => ({
  getCollection: mockGetCollection,
  addCollectionMember: mockAddCollectionMember,
}));

const { mockGetFamilyMembers } = vi.hoisted(() => ({ mockGetFamilyMembers: vi.fn() }));
vi.mock("./api", () => ({ getFamilyMembers: mockGetFamilyMembers }));

import { reshareCollectionToNewMember } from "./reseal";
import type { WasmUserKey } from "@/lib/crypto";

const FAKE_UK = {} as WasmUserKey;

const RECIPIENT_ID = "recipient-1";
const COLLECTION_ID = "collection-1";
const ACCESS_LEVEL = "read";

/** The unwrapped Collection Key object `unsealCollectionKey` returns -- a
 * fake handle carrying identity-comparable bytes, mirroring
 * `crypto.test.ts`'s `FakeCollectionKey` shape. */
function fakeCk(bytes: number[]): { bytes: number[]; free: () => void } {
  return { bytes, free: ckFreeSpy };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInitCrypto.mockResolvedValue(undefined);
  mockEnsureOwnIdentityKeypair.mockResolvedValue({
    publicKeyBytes: () => new Uint8Array([1, 2, 3, 4]),
    free: identityFreeSpy,
  });
});

describe("reshareCollectionToNewMember", () => {
  it("unwraps the caller's OWN sealed_key and reseals the SAME (never fresh) key to the recipient, then grants via addCollectionMember", async () => {
    const originalCk = fakeCk([9, 8, 7, 6]);
    mockGetCollection.mockResolvedValue({ sealed_key: "sealed-blob" });
    mockUnsealCollectionKey.mockReturnValue(originalCk);
    mockGetFamilyMembers.mockResolvedValue([
      { user_id: RECIPIENT_ID, public_key: base64Encode(new Uint8Array([5, 5, 5, 5])) },
    ]);
    mockSealCollectionKey.mockReturnValue("sealed-for-recipient");
    mockAddCollectionMember.mockResolvedValue(undefined);

    await reshareCollectionToNewMember(COLLECTION_ID, RECIPIENT_ID, ACCESS_LEVEL, FAKE_UK);

    expect(mockUnsealCollectionKey).toHaveBeenCalledWith(
      expect.anything(),
      "sealed-blob",
    );
    // The SAME unwrapped `ck` object is what gets sealed -- never a freshly
    // generated key (no `WasmCollectionKey.generate()` call exists in this
    // module at all).
    expect(mockSealCollectionKey).toHaveBeenCalledWith(expect.anything(), originalCk);
    expect(mockAddCollectionMember).toHaveBeenCalledWith(
      COLLECTION_ID,
      RECIPIENT_ID,
      "sealed-for-recipient",
      ACCESS_LEVEL,
    );
  });

  it("throws before getCollection/addCollectionMember when the recipient has no published public key", async () => {
    mockGetFamilyMembers.mockResolvedValue([{ user_id: RECIPIENT_ID, public_key: null }]);

    await expect(
      reshareCollectionToNewMember(COLLECTION_ID, RECIPIENT_ID, ACCESS_LEVEL, FAKE_UK),
    ).rejects.toThrow();

    expect(mockGetCollection).not.toHaveBeenCalled();
    expect(mockAddCollectionMember).not.toHaveBeenCalled();
  });

  // CR-03 fix (31-REVIEW.md): this used to assert the OPPOSITE -- that a
  // 409 from `addCollectionMember` resolved normally. That policy was
  // correct for the ONE caller whose own snapshot-driven pairs can only
  // ever 409 on a genuine same-pair race (`resealTrigger.ts`, which now
  // restores it in its OWN catch -- see `resealTrigger.test.ts`'s new
  // test), but wrong here: this function has no way to know whether a
  // caller's 409 means "a race landed first at the SAME level" or "this
  // recipient already holds a grant at a DIFFERENT level", so it must not
  // decide that for every caller. `submitRowsForExistingDestination`
  // (`ShareDialog.tsx`) now owns that verification itself, per-caller.
  it("propagates a structural 409 from addCollectionMember to the caller, rather than deciding it means success", async () => {
    const originalCk = fakeCk([1, 1, 1, 1]);
    mockGetCollection.mockResolvedValue({ sealed_key: "sealed-blob" });
    mockUnsealCollectionKey.mockReturnValue(originalCk);
    mockGetFamilyMembers.mockResolvedValue([
      { user_id: RECIPIENT_ID, public_key: base64Encode(new Uint8Array([2, 2, 2, 2])) },
    ]);
    mockSealCollectionKey.mockReturnValue("sealed-for-recipient");
    mockAddCollectionMember.mockRejectedValue({ status: 409 });

    await expect(
      reshareCollectionToNewMember(COLLECTION_ID, RECIPIENT_ID, ACCESS_LEVEL, FAKE_UK),
    ).rejects.toEqual({ status: 409 });
  });

  it("throws before any sealCollectionKey/network call when the caller has sealed_key: null", async () => {
    // A valid, public-key-bearing recipient — this test isolates the
    // sealed_key-null check, not the T-25-16 missing-public-key check above.
    mockGetFamilyMembers.mockResolvedValue([
      { user_id: RECIPIENT_ID, public_key: base64Encode(new Uint8Array([6, 6, 6, 6])) },
    ]);
    mockGetCollection.mockResolvedValue({ sealed_key: null });

    await expect(
      reshareCollectionToNewMember(COLLECTION_ID, RECIPIENT_ID, ACCESS_LEVEL, FAKE_UK),
    ).rejects.toThrow();

    expect(mockUnsealCollectionKey).not.toHaveBeenCalled();
    expect(mockSealCollectionKey).not.toHaveBeenCalled();
    expect(mockAddCollectionMember).not.toHaveBeenCalled();
  });

  it("frees every WASM handle (identityKey, unwrapped ck, recipient public key) in a finally block", async () => {
    const originalCk = fakeCk([3, 3, 3, 3]);
    mockGetCollection.mockResolvedValue({ sealed_key: "sealed-blob" });
    mockUnsealCollectionKey.mockReturnValue(originalCk);
    mockGetFamilyMembers.mockResolvedValue([
      { user_id: RECIPIENT_ID, public_key: base64Encode(new Uint8Array([4, 4, 4, 4])) },
    ]);
    mockSealCollectionKey.mockReturnValue("sealed-for-recipient");
    mockAddCollectionMember.mockResolvedValue(undefined);

    await reshareCollectionToNewMember(COLLECTION_ID, RECIPIENT_ID, ACCESS_LEVEL, FAKE_UK);

    expect(identityFreeSpy).toHaveBeenCalled();
    expect(ckFreeSpy).toHaveBeenCalled();
    expect(pkFreeSpy).toHaveBeenCalled();
  });
});
