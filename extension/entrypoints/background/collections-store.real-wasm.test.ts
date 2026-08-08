// Real-WASM proof for collections-store.ts (27-03-PLAN.md Task 2). Loads
// the REAL compiled wasm binary (no `vi.mock` of `../../lib/crypto/
// wasm-loader` anywhere in this file) and mocks ONLY the wire boundary --
// `listCollections()` from `./vault-api` -- plus `ensureOwnIdentityKeypair`
// from `./identity-store` (identity PLUMBING, not crypto; stubbed to hand
// back a REAL, locally-generated `WasmIdentityKey`, mirroring web's
// `collections.real-wasm.test.ts` precedent). Every seal/unseal/encrypt/
// decrypt call below runs the genuine wasm-bindgen bindings. `./vault-session`
// is also mocked (session PLUMBING, controllable state) -- this module has
// no exported way to trigger a refresh via a lock-state listener (this
// plan deliberately registers none, see collections-store.ts's own header
// comment), so every test drives it directly via `refreshCollectionsNow()`/
// `freeAllCollectionKeys()`.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  mockListCollections: vi.fn(),
  mockEnsureOwnIdentityKeypair: vi.fn(),
  mockGetUnlockedUserKey: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      getURL: (p: string) => `chrome-extension://fake-test-id${p}`,
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock("./vault-api", () => ({
  listCollections: hoisted.mockListCollections,
}));

vi.mock("./identity-store", () => ({
  ensureOwnIdentityKeypair: hoisted.mockEnsureOwnIdentityKeypair,
}));

vi.mock("./vault-session", () => ({
  getUnlockedUserKey: hoisted.mockGetUnlockedUserKey,
}));

import {
  initCrypto,
  WasmUserKey,
  WasmCollectionKey,
  WasmIdentityKey,
  WasmIdentityPublicKey,
  sealCollectionKey,
  encryptItemForCollection,
  decryptItemForCollection,
} from "../../lib/crypto/wasm-loader";
import {
  getCollectionAccessLevel,
  getCollectionKey,
  getCollections,
  freeAllCollectionKeys,
  refreshCollectionsNow,
} from "./collections-store";

const COLLECTION_NAME_REVISION = 1;

beforeAll(async () => {
  const wasmPath = path.join(process.cwd(), "public", "wasm", "pv_wasm_bg.wasm");
  const wasmBytes = readFileSync(wasmPath);
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("pv_wasm_bg.wasm")) {
      return new Response(wasmBytes, {
        status: 200,
        headers: { "Content-Type": "application/wasm" },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  await initCrypto();
});

beforeEach(() => {
  vi.clearAllMocks();
  freeAllCollectionKeys();
});

/** Builds one REAL fixture collection row: a genuine WasmCollectionKey,
 * genuinely `sealCollectionKey`d to a genuine, locally-generated identity
 * keypair's own public key, and a real `encryptItemForCollection`-encrypted
 * name bound to `collectionId`. Mirrors web's own
 * `collections.real-wasm.test.ts::makeFixtureCollectionRow`. Caller owns
 * freeing both `identityKey` and `ck`; this module's own
 * `unsealCollectionKey` call produces a SEPARATE handle, freed by that
 * module itself. */
function makeFixtureCollectionRow(collectionId: string, name: string) {
  const identityKey = WasmIdentityKey.generate();
  const ck = WasmCollectionKey.generate();
  const identityPub = WasmIdentityPublicKey.fromBytes(identityKey.publicKeyBytes());
  let sealedKey: string;
  try {
    sealedKey = sealCollectionKey(identityPub, ck);
  } finally {
    identityPub.free?.();
  }
  const encName = encryptItemForCollection(
    ck,
    JSON.stringify({ name }),
    collectionId,
    collectionId,
    COLLECTION_NAME_REVISION,
  );
  return {
    identityKey,
    ck,
    row: {
      id: collectionId,
      enc_name: encName,
      created_at: "2026-08-08T00:00:00Z",
      access_level: "edit",
      sealed_key: sealedKey,
    },
  };
}

describe("collections-store.ts: refresh, decrypt, cache (real WASM, network mocked)", () => {
  it("EXT-11 no-op: a fresh state refreshed against zero collections completes with no thrown error and getCollections() returns []", async () => {
    const uk = {} as WasmUserKey;
    // refreshCollections resolves ONE identity key per refresh regardless
    // of row count (see collections-store.ts's own comment) -- a real
    // generated handle here, freed by refreshCollections' own finally.
    hoisted.mockGetUnlockedUserKey.mockReturnValue(uk);
    hoisted.mockEnsureOwnIdentityKeypair.mockImplementation(async () => WasmIdentityKey.generate());
    hoisted.mockListCollections.mockResolvedValue([]);

    await expect(refreshCollectionsNow()).resolves.toBeUndefined();
    expect(getCollections()).toEqual([]);
  });

  it("a real sealed Collection Key + real encryptItemForCollection ciphertext round-trips through getCollectionKey()'s cached handle", async () => {
    const uk = {} as WasmUserKey;
    const { identityKey, ck, row } = makeFixtureCollectionRow(
      "collection-fixture-1",
      "Real Shared Family Folder",
    );
    hoisted.mockGetUnlockedUserKey.mockReturnValue(uk);
    hoisted.mockEnsureOwnIdentityKeypair.mockResolvedValue(identityKey);
    hoisted.mockListCollections.mockResolvedValue([row]);

    try {
      await refreshCollectionsNow();

      expect(getCollections()).toEqual([
        { id: "collection-fixture-1", name: "Real Shared Family Folder", accessLevel: "edit" },
      ]);
      expect(getCollectionAccessLevel("collection-fixture-1")).toBe("edit");

      const cachedKey = getCollectionKey("collection-fixture-1");
      expect(cachedKey).toBeDefined();
      if (cachedKey === undefined) throw new Error("unreachable");

      const plaintext = '{"type":"note","body":"round-trip fixture secret"}';
      const encrypted = encryptItemForCollection(
        cachedKey,
        plaintext,
        "collection-fixture-1",
        "item-fixture-1",
        1,
      );
      const decrypted = decryptItemForCollection(
        cachedKey,
        encrypted,
        "collection-fixture-1",
        "item-fixture-1",
        1,
      );
      expect(decrypted).toBe(plaintext);
    } finally {
      freeAllCollectionKeys();
      ck.free?.();
    }
  });

  it("freeAllCollectionKeys frees every cached handle and getCollectionKey returns undefined for a previously-cached id (simulated lock transition)", async () => {
    const uk = {} as WasmUserKey;
    const { identityKey, ck, row } = makeFixtureCollectionRow(
      "collection-fixture-2",
      "Freed On Lock Folder",
    );
    hoisted.mockGetUnlockedUserKey.mockReturnValue(uk);
    hoisted.mockEnsureOwnIdentityKeypair.mockResolvedValue(identityKey);
    hoisted.mockListCollections.mockResolvedValue([row]);

    const freeSpy = vi.spyOn(WasmCollectionKey.prototype, "free");
    try {
      await refreshCollectionsNow();
      expect(getCollectionKey("collection-fixture-2")).toBeDefined();

      freeSpy.mockClear(); // ignore frees during setup/refresh above

      // Simulated lock-state transition: this module registers no
      // subscribeSessionLockState listener of its own (see this module's
      // header comment) -- 27-04's wiring calls this from vault-store.ts's
      // existing handler; this test calls it directly, matching the
      // caller-must-invoke contract.
      freeAllCollectionKeys();

      expect(freeSpy).toHaveBeenCalledTimes(1);
      expect(getCollections()).toEqual([{ id: "collection-fixture-2", name: "Freed On Lock Folder", accessLevel: "edit" }]);
      expect(getCollectionKey("collection-fixture-2")).toBeUndefined();
    } finally {
      freeSpy.mockRestore();
      ck.free?.();
    }
  });

  // WR-02 (ported from web's code review, Phase 26): a second refresh whose
  // response omits a previously-known collection id evicts that id's
  // cached key -- the mechanism that closes T-27-06 once 27-04 wires
  // refreshCollectionsNow() into the periodic shared-revisions tick.
  it("a collection the server no longer returns has its cached key freed and evicted, not merely hidden", async () => {
    const uk = {} as WasmUserKey;
    const { identityKey, ck, row } = makeFixtureCollectionRow(
      "collection-fixture-revoked",
      "Revoked Folder",
    );
    hoisted.mockGetUnlockedUserKey.mockReturnValue(uk);
    // refreshCollections frees the identity handle it resolves, and this
    // test drives TWO refreshes -- hand back a fresh handle each time,
    // exactly as the real ensureOwnIdentityKeypair does (returning one
    // shared fixture handle twice would double-free it).
    hoisted.mockEnsureOwnIdentityKeypair.mockImplementationOnce(async () => identityKey);
    hoisted.mockEnsureOwnIdentityKeypair.mockImplementation(async () => WasmIdentityKey.generate());
    hoisted.mockListCollections.mockResolvedValue([row]);

    const freeSpy = vi.spyOn(WasmCollectionKey.prototype, "free");
    try {
      await refreshCollectionsNow();
      expect(getCollectionKey("collection-fixture-revoked")).toBeDefined();

      freeSpy.mockClear(); // ignore frees during setup/refresh above

      // Access revoked server-side: the row simply stops being returned.
      hoisted.mockListCollections.mockResolvedValue([]);
      await refreshCollectionsNow();

      expect(getCollections()).toEqual([]);
      expect(getCollectionKey("collection-fixture-revoked")).toBeUndefined();
      expect(freeSpy).toHaveBeenCalledTimes(1);
    } finally {
      freeSpy.mockRestore();
      freeAllCollectionKeys();
      ck.free?.();
    }
  });
});
