// FAM-10/FSH-04 regression (30-05-PLAN.md Task 1): proves, by test, that a
// family-wide collection needs ZERO special-casing to flow through
// `buildMemberRemovalBatch` -- the SAME removal/deletion re-key batch v0.4
// already ships. This file imports zero new production code: it exercises
// the EXISTING `./rekey` module exactly as `DeleteAccountDialog.tsx`'s
// `branch === "member"` path already does, proving RESEARCH.md's own finding
// ("`getMemberAccess(targetUserId)` already returns `access.collections` --
// every collection the target can reach -- and if a family-wide collection
// is modeled as an ordinary `collections` row, it is already included in
// that batch with no code change") rather than re-implementing anything.
//
// Mocked lane (this codebase's own "pure batch-construction logic, no crypto
// assertion" test map -- RESEARCH.md's test-lane note): `@/lib/crypto` is
// mocked wholesale, mirroring `ShareDialog.test.tsx`'s own mock shape.
// `rekey.real-wasm-batch.test.ts` already proves the SAME function against
// the real compiled wasm binary for the ordinary-collection case; this file
// is deliberately narrower -- it proves family-wide collections receive
// IDENTICAL treatment to ordinary ones, not that the crypto primitives
// themselves are correct (already proven elsewhere).
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockInitCrypto,
  mockSealCollectionKey,
  mockUnsealCollectionKey,
  mockRewrapItemKeyForCollection,
  mockGenerateCollectionKey,
  mockFromBytesIdentityPublicKey,
} = vi.hoisted(() => ({
  mockInitCrypto: vi.fn(),
  mockSealCollectionKey: vi.fn(),
  mockUnsealCollectionKey: vi.fn(),
  mockRewrapItemKeyForCollection: vi.fn(),
  mockGenerateCollectionKey: vi.fn(),
  mockFromBytesIdentityPublicKey: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  initCrypto: mockInitCrypto,
  // `WasmCollectionKey.generate()`/`WasmIdentityPublicKey.fromBytes()` are
  // called as static-style members by `rekey.ts` -- plain objects exposing
  // just those two functions are sufficient, mirroring how the other
  // mocked-crypto tests in this codebase (e.g. `ShareDialog.test.tsx`) stub
  // this same module.
  WasmCollectionKey: { generate: mockGenerateCollectionKey },
  WasmIdentityPublicKey: { fromBytes: mockFromBytesIdentityPublicKey },
  sealCollectionKey: mockSealCollectionKey,
  unsealCollectionKey: mockUnsealCollectionKey,
  rewrapItemKeyForCollection: mockRewrapItemKeyForCollection,
}));

const { mockBase64Decode } = vi.hoisted(() => ({
  mockBase64Decode: vi.fn((s: string) => new TextEncoder().encode(s)),
}));
vi.mock("@/lib/auth/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/api")>()),
  base64Decode: mockBase64Decode,
}));

const { mockEnsureOwnIdentityKeypair } = vi.hoisted(() => ({
  mockEnsureOwnIdentityKeypair: vi.fn(),
}));
vi.mock("@/lib/identity/ensure", () => ({
  ensureOwnIdentityKeypair: mockEnsureOwnIdentityKeypair,
}));

const { mockGetCollection, mockGetCollectionItems, mockGetCollectionAccessList } = vi.hoisted(
  () => ({
    mockGetCollection: vi.fn(),
    mockGetCollectionItems: vi.fn(),
    mockGetCollectionAccessList: vi.fn(),
  }),
);
vi.mock("@/lib/vault/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vault/api")>()),
  getCollection: mockGetCollection,
  getCollectionItems: mockGetCollectionItems,
  getCollectionAccessList: mockGetCollectionAccessList,
}));

const { mockGetMemberAccess, mockGetFamilyMembers, mockRemoveMember } = vi.hoisted(() => ({
  mockGetMemberAccess: vi.fn(),
  mockGetFamilyMembers: vi.fn(),
  mockRemoveMember: vi.fn(),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  getMemberAccess: mockGetMemberAccess,
  getFamilyMembers: mockGetFamilyMembers,
  removeMember: mockRemoveMember,
}));

import type { WasmUserKey } from "@/lib/crypto";
import { buildMemberRemovalBatch } from "./rekey";

const CALLER_USER_ID = "user-caller";
const REMAINING_USER_ID = "user-remaining";
const TARGET_USER_ID = "user-target";

// Per the fixture's OWN bookkeeping -- this id names a collection that would,
// at the data-model layer (30-09's `family_wide_kind`), be flagged
// family-wide. `buildMemberRemovalBatch` reads NOTHING about that field (see
// `rekey.ts` lines 47-126), so this fixture deliberately never sets it: the
// test's whole point is that the function cannot tell the difference.
const FAMILY_WIDE_COLLECTION_ID = "collection-family-wide";
const ORDINARY_COLLECTION_ID = "collection-ordinary";

// `buildMemberRemovalBatch` only ever passes `ownUk` straight through to the
// mocked `ensureOwnIdentityKeypair` -- a placeholder is honest here, mirrors
// `rekey.real-wasm-batch.test.ts`'s identical `OWN_UK` fixture.
const OWN_UK = {} as WasmUserKey;

function fakeCollectionKey(label: string) {
  return { label, free: vi.fn() };
}

function fakeIdentityPublicKey(bytes: Uint8Array) {
  return { label: new TextDecoder().decode(bytes), free: vi.fn() };
}

function collectionRecord(id: string) {
  return {
    id,
    enc_name: "opaque",
    created_at: "2026-08-10T00:00:00Z",
    access_level: "edit",
    sealed_key: `sealed-caller-blob-${id}`,
  };
}

function accessList(id: string) {
  return [
    { user_id: CALLER_USER_ID, email: "caller@example.test", access_level: "edit", created_at: "" },
    {
      user_id: REMAINING_USER_ID,
      email: "remaining@example.test",
      access_level: "read",
      created_at: "",
    },
    { user_id: TARGET_USER_ID, email: "target@example.test", access_level: "read", created_at: "" },
  ].map((entry) => ({ ...entry, collection_id: id }));
}

function items(id: string) {
  return [{ id: `item-${id}`, enc_key: `enckey-${id}`, enc_data: `encdata-${id}`, revision: 3 }];
}

beforeEach(() => {
  vi.clearAllMocks();

  mockEnsureOwnIdentityKeypair.mockResolvedValue({ free: vi.fn() });
  mockGenerateCollectionKey.mockImplementation(() => fakeCollectionKey("new-ck"));
  mockUnsealCollectionKey.mockImplementation(() => fakeCollectionKey("old-ck"));
  mockFromBytesIdentityPublicKey.mockImplementation((bytes: Uint8Array) => fakeIdentityPublicKey(bytes));
  mockSealCollectionKey.mockImplementation(
    (pk: { label: string }, ck: { label: string }) => `sealed:${pk.label}:${ck.label}`,
  );
  mockRewrapItemKeyForCollection.mockImplementation(
    (_oldCk: unknown, _newCk: unknown, _encKey: string, _collectionId: string, itemId: string) =>
      `rewrapped:${itemId}`,
  );

  mockGetFamilyMembers.mockResolvedValue([
    {
      user_id: CALLER_USER_ID,
      email: "caller@example.test",
      role: "owner",
      joined_at: "",
      public_key: "caller-pub",
      fingerprint: null,
      verified_at: null,
      status: "active",
    },
    {
      user_id: REMAINING_USER_ID,
      email: "remaining@example.test",
      role: "member",
      joined_at: "",
      public_key: "remaining-pub",
      fingerprint: null,
      verified_at: null,
      status: "active",
    },
    {
      user_id: TARGET_USER_ID,
      email: "target@example.test",
      role: "member",
      joined_at: "",
      public_key: "target-pub",
      fingerprint: null,
      verified_at: null,
      status: "active",
    },
  ]);
});

describe("buildMemberRemovalBatch: family-wide collections need zero special-casing (FAM-10/FSH-04)", () => {
  it("(a) a family-wide collection produces a CollectionRekeyBatch entry -- fresh key sealed to every remaining recipient -- identical in shape to an ordinary collection's entry", async () => {
    mockGetMemberAccess.mockResolvedValue({
      collections: [{ id: FAMILY_WIDE_COLLECTION_ID, access_level: "read" }],
      item_shares: [],
    });
    mockGetCollection.mockResolvedValue(collectionRecord(FAMILY_WIDE_COLLECTION_ID));
    mockGetCollectionAccessList.mockResolvedValue(accessList(FAMILY_WIDE_COLLECTION_ID));
    mockGetCollectionItems.mockResolvedValue(items(FAMILY_WIDE_COLLECTION_ID));

    const batches = await buildMemberRemovalBatch(TARGET_USER_ID, OWN_UK);

    expect(batches).toHaveLength(1);
    expect(batches[0].collection_id).toBe(FAMILY_WIDE_COLLECTION_ID);

    const recipients = batches[0].new_sealed_keys.map((k) => k.recipient_user_id).sort();
    expect(recipients).toEqual([CALLER_USER_ID, REMAINING_USER_ID].sort());
    expect(recipients).not.toContain(TARGET_USER_ID);

    expect(batches[0].item_rewraps).toHaveLength(1);
    expect(batches[0].item_rewraps[0].item_id).toBe(`item-${FAMILY_WIDE_COLLECTION_ID}`);

    // A FRESH key, not the caller's own re-used sealed_key -- proves this is
    // genuine rotation, the same shape an ordinary collection's entry gets.
    expect(mockGenerateCollectionKey).toHaveBeenCalledTimes(1);
  });

  it("(b) an ordinary and a family-wide collection both appear in the batch, in access.collections' own order, with no differing treatment", async () => {
    mockGetMemberAccess.mockResolvedValue({
      collections: [
        { id: ORDINARY_COLLECTION_ID, access_level: "edit" },
        { id: FAMILY_WIDE_COLLECTION_ID, access_level: "read" },
      ],
      item_shares: [],
    });
    const records: Record<string, ReturnType<typeof collectionRecord>> = {
      [ORDINARY_COLLECTION_ID]: collectionRecord(ORDINARY_COLLECTION_ID),
      [FAMILY_WIDE_COLLECTION_ID]: collectionRecord(FAMILY_WIDE_COLLECTION_ID),
    };
    mockGetCollection.mockImplementation(async (id: string) => records[id]);
    mockGetCollectionAccessList.mockImplementation(async (id: string) => accessList(id));
    mockGetCollectionItems.mockImplementation(async (id: string) => items(id));

    const batches = await buildMemberRemovalBatch(TARGET_USER_ID, OWN_UK);

    expect(batches).toHaveLength(2);
    // Same order `access.collections` supplied them -- never reordered or
    // filtered by whichever collection happens to be family-wide.
    expect(batches.map((b) => b.collection_id)).toEqual([
      ORDINARY_COLLECTION_ID,
      FAMILY_WIDE_COLLECTION_ID,
    ]);

    for (const batch of batches) {
      const recipients = batch.new_sealed_keys.map((k) => k.recipient_user_id).sort();
      expect(recipients).toEqual([CALLER_USER_ID, REMAINING_USER_ID].sort());
      expect(recipients).not.toContain(TARGET_USER_ID);
      expect(batch.item_rewraps).toHaveLength(1);
    }
  });
});
