// WR-11 (25-REVIEW.md): `buildMemberRemovalBatch` -- the orchestration module
// that contains the T-25-16 fail-closed check, the target-exclusion filter,
// the roster lookup, and the WASM-handle `finally` cleanup -- had ZERO
// automated coverage. `rekey.real-wasm.test.ts`, the file named after this
// module, never imports it: it exercises only the `@/lib/crypto` primitives.
//
// This file closes that gap on the terms the review specified: mock ONLY the
// five network functions, drive the real `buildMemberRemovalBatch` against the
// REAL compiled wasm binary, and assert the three properties that actually
// matter. `@/lib/crypto` is deliberately NOT mocked anywhere here -- the whole
// point is that every key produced below is a genuine WASM output, so an
// assertion that a rewrapped `enc_key` decrypts under the new key and not the
// old one is real cryptographic evidence rather than a mock's say-so.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetMemberAccess,
  mockGetFamilyMembers,
  mockGetCollection,
  mockGetCollectionItems,
  mockGetCollectionAccessList,
} = vi.hoisted(() => ({
  mockGetMemberAccess: vi.fn(),
  mockGetFamilyMembers: vi.fn(),
  mockGetCollection: vi.fn(),
  mockGetCollectionItems: vi.fn(),
  mockGetCollectionAccessList: vi.fn(),
}));

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  getMemberAccess: mockGetMemberAccess,
  getFamilyMembers: mockGetFamilyMembers,
  removeMember: vi.fn(),
}));

vi.mock("@/lib/vault/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vault/api")>()),
  getCollection: mockGetCollection,
  getCollectionItems: mockGetCollectionItems,
  getCollectionAccessList: mockGetCollectionAccessList,
}));

// `ensureOwnIdentityKeypair` performs network I/O (GET/PUT
// /api/identity/keypair) to resolve the caller's own identity key. Stubbed to
// hand back a REAL, locally-generated `WasmIdentityKey` -- this is identity
// PLUMBING, not crypto: every seal/unseal below still runs the genuine
// bindings against it.
const { mockEnsureOwnIdentityKeypair } = vi.hoisted(() => ({
  mockEnsureOwnIdentityKeypair: vi.fn(),
}));
vi.mock("@/lib/identity/ensure", () => ({
  ensureOwnIdentityKeypair: mockEnsureOwnIdentityKeypair,
}));

import {
  initCrypto,
  WasmCollectionKey,
  WasmIdentityKey,
  WasmIdentityPublicKey,
  encryptItemForCollection,
  decryptItemForCollection,
  sealCollectionKey,
  unsealCollectionKey,
  type WasmUserKey,
} from "@/lib/crypto";
import { base64Encode } from "@/lib/auth/api";
import { buildMemberRemovalBatch } from "./rekey";

beforeAll(async () => {
  // Identical wiring to `rekey.real-wasm.test.ts`: stub ONLY `global.fetch`
  // for the wasm binary path, load the real compiled `.wasm` off disk.
  const wasmPath = path.join(process.cwd(), "public", "wasm", "pv_wasm_bg.wasm");
  const wasmBytes = readFileSync(wasmPath);
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("pv_wasm_bg.wasm")) {
      return new Response(wasmBytes, { status: 200, headers: { "Content-Type": "application/wasm" } });
    }
    return originalFetch(input);
  }) as typeof fetch;

  await initCrypto();
});

function splitEncryptedItem(combinedJson: string): { encKey: string; encData: string } {
  const combined = JSON.parse(combinedJson) as { enc_key: unknown; enc_data: unknown };
  return { encKey: JSON.stringify(combined.enc_key), encData: JSON.stringify(combined.enc_data) };
}

function recombineEncryptedItem(encKey: string, encData: string): string {
  return JSON.stringify({
    enc_key: JSON.parse(encKey) as unknown,
    enc_data: JSON.parse(encData) as unknown,
  });
}

const COLLECTION_ID = "collection-wr11";
const ITEM_ID = "item-wr11";
const ITEM_REVISION = 4;
const PLAINTEXT = '{"type":"login","name":"WR-11 fixture","password":"s3cret"}';

const TARGET_USER_ID = "user-target";
const CALLER_USER_ID = "user-caller";
const REMAINING_USER_ID = "user-remaining";

interface Fixture {
  callerIdentity: WasmIdentityKey;
  remainingIdentity: WasmIdentityKey;
  oldCk: WasmCollectionKey;
  encKey: string;
  encData: string;
  free: () => void;
}

/** Builds a REAL collection: a genuine CollectionKey, a genuine item encrypted
 * under it, and genuine sealed-key blobs for the caller and one remaining
 * recipient -- exactly the server state `buildMemberRemovalBatch` reads. */
function makeFixture(): Fixture {
  const callerIdentity = WasmIdentityKey.generate();
  const remainingIdentity = WasmIdentityKey.generate();
  const oldCk = WasmCollectionKey.generate();

  const callerPub = WasmIdentityPublicKey.fromBytes(callerIdentity.publicKeyBytes());
  let callerSealed: string;
  try {
    callerSealed = sealCollectionKey(callerPub, oldCk);
  } finally {
    callerPub.free?.();
  }

  const encryptedJson = encryptItemForCollection(oldCk, PLAINTEXT, COLLECTION_ID, ITEM_ID, ITEM_REVISION);
  const { encKey, encData } = splitEncryptedItem(encryptedJson);

  mockEnsureOwnIdentityKeypair.mockResolvedValue(callerIdentity);
  mockGetMemberAccess.mockResolvedValue({
    collections: [{ id: COLLECTION_ID, access_level: "edit" }],
    item_shares: [],
  });
  mockGetCollection.mockResolvedValue({
    id: COLLECTION_ID,
    enc_name: "opaque",
    created_at: "2026-01-01 10:00:00",
    access_level: "edit",
    sealed_key: callerSealed,
  });
  mockGetCollectionItems.mockResolvedValue([
    { id: ITEM_ID, enc_key: encKey, enc_data: encData, revision: ITEM_REVISION },
  ]);
  mockGetCollectionAccessList.mockResolvedValue([
    { user_id: CALLER_USER_ID, email: "caller@example.test", access_level: "edit", created_at: "" },
    { user_id: REMAINING_USER_ID, email: "remaining@example.test", access_level: "read", created_at: "" },
    { user_id: TARGET_USER_ID, email: "target@example.test", access_level: "read", created_at: "" },
  ]);
  mockGetFamilyMembers.mockResolvedValue([
    {
      user_id: CALLER_USER_ID,
      email: "caller@example.test",
      role: "owner",
      joined_at: "",
      public_key: base64Encode(callerIdentity.publicKeyBytes()),
      fingerprint: null,
      verified_at: null,
      status: "active",
    },
    {
      user_id: REMAINING_USER_ID,
      email: "remaining@example.test",
      role: "member",
      joined_at: "",
      public_key: base64Encode(remainingIdentity.publicKeyBytes()),
      fingerprint: null,
      verified_at: null,
      status: "active",
    },
    {
      user_id: TARGET_USER_ID,
      email: "target@example.test",
      role: "member",
      joined_at: "",
      public_key: "AAAA",
      fingerprint: null,
      verified_at: null,
      status: "active",
    },
  ]);

  return {
    callerIdentity,
    remainingIdentity,
    oldCk,
    encKey,
    encData,
    // NOTE (discovered by this test, on its first run): `callerIdentity` is
    // deliberately NOT freed here. `buildMemberRemovalBatch` takes OWNERSHIP
    // of the handle `ensureOwnIdentityKeypair` hands it and frees it in its
    // own outer `finally` -- on the throwing path too. Freeing it again here
    // panics the wasm module with "null pointer passed to rust". That
    // ownership contract is undocumented in `rekey.ts`'s signature, which is
    // precisely the kind of thing a module with zero coverage hides.
    free: () => {
      oldCk.free?.();
      remainingIdentity.free?.();
    },
  };
}

// `buildMemberRemovalBatch` only ever passes `ownUk` straight through to the
// mocked `ensureOwnIdentityKeypair`, so a placeholder is honest here -- no
// crypto operation in this file consumes it.
const OWN_UK = {} as WasmUserKey;

describe("buildMemberRemovalBatch (real WASM, network mocked)", () => {
  let fixture: Fixture;

  beforeEach(() => {
    vi.clearAllMocks();
    fixture = makeFixture();
  });

  it("(a) excludes the TARGET from new_sealed_keys while keeping every remaining recipient", async () => {
    const batches = await buildMemberRemovalBatch(TARGET_USER_ID, OWN_UK);
    try {
      expect(batches).toHaveLength(1);
      const recipients = batches[0].new_sealed_keys.map((k) => k.recipient_user_id).sort();
      expect(recipients).toEqual([CALLER_USER_ID, REMAINING_USER_ID].sort());
      expect(recipients).not.toContain(TARGET_USER_ID);
      expect(batches[0].collection_id).toBe(COLLECTION_ID);
    } finally {
      fixture.free();
    }
  });

  it("(b) THROWS when a remaining recipient has no published public key, rather than shrinking the set (T-25-16)", async () => {
    // The REMAINING recipient -- not the target -- has never published a
    // keypair. Silently dropping them would strand their future decryption
    // ability the moment the re-key lands.
    const roster = await mockGetFamilyMembers();
    mockGetFamilyMembers.mockResolvedValue(
      roster.map((m: { user_id: string }) =>
        m.user_id === REMAINING_USER_ID ? { ...m, public_key: null } : m,
      ),
    );

    try {
      await expect(buildMemberRemovalBatch(TARGET_USER_ID, OWN_UK)).rejects.toThrow(
        /has no published public key/,
      );
    } finally {
      fixture.free();
    }
  });

  it("(c) each returned enc_key decrypts under the NEW key and is rejected under the OLD one", async () => {
    const batches = await buildMemberRemovalBatch(TARGET_USER_ID, OWN_UK);

    let newCk: WasmCollectionKey | undefined;
    try {
      expect(batches[0].item_rewraps).toHaveLength(1);
      const rewrap = batches[0].item_rewraps[0];
      expect(rewrap.item_id).toBe(ITEM_ID);
      // The rewrapped key must genuinely differ from the original -- a
      // pass-through would satisfy a naive "an enc_key came back" assertion.
      expect(rewrap.enc_key).not.toBe(fixture.encKey);

      // Recover the NEW CollectionKey the way a REMAINING recipient would:
      // unseal the blob that was sealed to their real published public key.
      // Deliberately the remaining member's key, not the caller's -- the
      // caller's handle has already been consumed and freed by the function
      // under test, and this is anyway the stronger assertion: it proves the
      // OTHER member can still read the folder after the re-key.
      const remainingEntry = batches[0].new_sealed_keys.find(
        (k) => k.recipient_user_id === REMAINING_USER_ID,
      );
      expect(remainingEntry).toBeDefined();
      newCk = unsealCollectionKey(fixture.remainingIdentity, remainingEntry!.sealed_key);

      const rewrapped = recombineEncryptedItem(rewrap.enc_key, fixture.encData);

      // The decisive property: the ORIGINAL payload ciphertext, paired with
      // the rewrapped key, still yields the ORIGINAL plaintext under the NEW
      // Collection Key -- i.e. the re-key rotated the key without touching
      // enc_data (KEY-02/SC 6's rewrap-only guarantee, proven end to end
      // through the orchestration module rather than the primitive alone).
      const decrypted = decryptItemForCollection(newCk, rewrapped, COLLECTION_ID, ITEM_ID, ITEM_REVISION);
      expect(decrypted).toBe(PLAINTEXT);

      // ...and the removed member's copy of the OLD key is now useless.
      expect(() =>
        decryptItemForCollection(fixture.oldCk, rewrapped, COLLECTION_ID, ITEM_ID, ITEM_REVISION),
      ).toThrow();
    } finally {
      newCk?.free?.();
      fixture.free();
    }
  });

  it("(d) enc_data is never read or returned -- the batch has no field capable of carrying a payload", async () => {
    const batches = await buildMemberRemovalBatch(TARGET_USER_ID, OWN_UK);
    try {
      const serialized = JSON.stringify(batches);
      expect(serialized).not.toContain("enc_data");
      // The fixture's real payload ciphertext must appear nowhere in the wire
      // shape the client is about to POST.
      const payloadCiphertext = (JSON.parse(fixture.encData) as { ciphertext: string }).ciphertext;
      expect(serialized).not.toContain(payloadCiphertext);
    } finally {
      fixture.free();
    }
  });
});
