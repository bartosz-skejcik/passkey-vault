// Real-WASM proof for lib/vault/collections.ts (Task 1, 26-05-PLAN.md). Per
// this plan's "Test-tiering decision" note: this file loads the REAL
// compiled wasm binary (no `vi.mock("@/lib/crypto", ...)` anywhere in this
// file) and mocks ONLY the wire boundary — `listCollections()` from
// `@/lib/vault/api` — plus `ensureOwnIdentityKeypair` from
// `@/lib/identity/ensure` (identity PLUMBING, not crypto; stubbed to hand
// back a REAL, locally-generated `WasmIdentityKey`, mirroring
// `rekey.real-wasm-batch.test.ts`'s identical precedent). Every seal/unseal/
// encrypt/decrypt call below runs the genuine wasm-bindgen bindings.
//
// This module has no exported way to trigger a refresh directly (mirrors
// store.ts's own private loadAndDecryptAll()) — every test drives it the
// SAME way the real app does: `setUnlockedUserKey()`/`lockVault()` (real,
// unmocked `@/lib/crypto` singletons) fire this module's own
// `subscribeLockState` listener, registered as a module-level side effect at
// import time.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockListCollections } = vi.hoisted(() => ({
  mockListCollections: vi.fn(),
}));

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  listCollections: mockListCollections,
}));

const { mockEnsureOwnIdentityKeypair } = vi.hoisted(() => ({
  mockEnsureOwnIdentityKeypair: vi.fn(),
}));
vi.mock("@/lib/identity/ensure", () => ({
  ensureOwnIdentityKeypair: mockEnsureOwnIdentityKeypair,
}));

import {
  initCrypto,
  generateUserKey,
  setUnlockedUserKey,
  lockVault,
  WasmCollectionKey,
  WasmIdentityKey,
  WasmIdentityPublicKey,
  sealCollectionKey,
  encryptItemForCollection,
  decryptItemForCollection,
} from "@/lib/crypto";
import {
  getCollectionAccessLevel,
  getCollectionKey,
  getCollections,
  refreshCollectionsNow,
} from "./collections";

const COLLECTION_NAME_REVISION = 1;

beforeAll(async () => {
  // `initCrypto()` hardcodes the fetch path "/wasm/pv_wasm_bg.wasm" — stub
  // global fetch to serve the REAL compiled binary's bytes directly off
  // disk, identical to every other `*.real-wasm.test.ts` file's own
  // `beforeAll`.
  const wasmPath = path.join(process.cwd(), "public", "wasm", "pv_wasm_bg.wasm");
  const wasmBytes = readFileSync(wasmPath);
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("pv_wasm_bg.wasm")) {
      return new Response(wasmBytes, { status: 200, headers: { "Content-Type": "application/wasm" } });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  await initCrypto();
});

beforeEach(() => {
  vi.clearAllMocks();
});

/** Builds one REAL fixture collection row: a genuine WasmCollectionKey,
 * genuinely `sealCollectionKey`d to a genuine, locally-generated identity
 * keypair's own public key, and a real `encryptItemForCollection`-encrypted
 * name bound to `collectionId`. Mirrors `RemoveMemberDialog.tsx`'s own
 * `resolveFolder` decrypt shape (AAD's collection-scope AND item-id
 * components both bound to `collectionId`, revision 1 — collections carry
 * no revision column of their own). Returns the fixture row plus the RAW
 * fixture CollectionKey (`ck`) — the caller owns freeing both `ck` and
 * `identityKey`; this module's own `unsealCollectionKey` call inside
 * `collections.ts` produces a SEPARATE handle, freed by that module itself.
 */
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
      created_at: "2026-08-06T00:00:00Z",
      access_level: "edit",
      sealed_key: sealedKey,
    },
  };
}

describe("collections.ts: list, decrypt names, cache unwrapped Collection Keys (real WASM, network mocked)", () => {
  it("a real collection's enc_name decrypts correctly through this module against a mocked listCollections() response", async () => {
    const { identityKey, ck, row } = makeFixtureCollectionRow(
      "collection-fixture-1",
      "Real Shared Family Folder",
    );
    mockEnsureOwnIdentityKeypair.mockResolvedValue(identityKey);
    mockListCollections.mockResolvedValue([row]);

    const uk = generateUserKey();
    try {
      setUnlockedUserKey(uk); // fires this module's real subscribeLockState listener
      await vi.waitFor(() => expect(getCollections()).toHaveLength(1));

      // 26-VERIFICATION.md gap 1: `access_level` is no longer DROPPED by
      // this store — `collections::list` always returned it, and without it
      // no collection-scoped item had an access level anywhere in the
      // client, so `hidden_password` could not be honoured on any surface.
      expect(getCollections()).toEqual([
        { id: "collection-fixture-1", name: "Real Shared Family Folder", accessLevel: "edit" },
      ]);
      expect(getCollectionKey("collection-fixture-1")).toBeDefined();
      expect(getCollectionAccessLevel("collection-fixture-1")).toBe("edit");
    } finally {
      lockVault();
      ck.free?.();
    }
  });

  it("the cached WasmCollectionKey round-trips a real encrypt/decrypt through encryptItemForCollection/decryptItemForCollection", async () => {
    const { identityKey, ck, row } = makeFixtureCollectionRow(
      "collection-fixture-2",
      "Round Trip Folder",
    );
    mockEnsureOwnIdentityKeypair.mockResolvedValue(identityKey);
    mockListCollections.mockResolvedValue([row]);

    const uk = generateUserKey();
    try {
      setUnlockedUserKey(uk);
      await vi.waitFor(() => expect(getCollectionKey("collection-fixture-2")).toBeDefined());

      const cachedKey = getCollectionKey("collection-fixture-2");
      if (cachedKey === undefined) {
        throw new Error("expected the collection key to be cached");
      }
      const plaintext = '{"type":"note","body":"round-trip fixture secret"}';
      const encrypted = encryptItemForCollection(
        cachedKey,
        plaintext,
        "collection-fixture-2",
        "item-fixture-2",
        1,
      );
      const decrypted = decryptItemForCollection(
        cachedKey,
        encrypted,
        "collection-fixture-2",
        "item-fixture-2",
        1,
      );
      expect(decrypted).toBe(plaintext);
    } finally {
      lockVault();
      ck.free?.();
    }
  });

  it("a lock event frees every cached WasmCollectionKey handle and clears the in-memory list", async () => {
    const { identityKey, ck, row } = makeFixtureCollectionRow(
      "collection-fixture-3",
      "Freed On Lock Folder",
    );
    mockEnsureOwnIdentityKeypair.mockResolvedValue(identityKey);
    mockListCollections.mockResolvedValue([row]);

    const uk = generateUserKey();
    const freeSpy = vi.spyOn(WasmCollectionKey.prototype, "free");
    try {
      setUnlockedUserKey(uk);
      await vi.waitFor(() => expect(getCollections()).toHaveLength(1));
      expect(getCollectionKey("collection-fixture-3")).toBeDefined();

      freeSpy.mockClear(); // ignore any frees during setup/refresh above

      lockVault(); // real crypto singleton lock -- fires this module's listener synchronously

      expect(freeSpy).toHaveBeenCalledTimes(1); // the cached key, freed on lock (T-26-10)
      expect(getCollections()).toEqual([]);
      expect(getCollectionKey("collection-fixture-3")).toBeUndefined();
    } finally {
      freeSpy.mockRestore();
      ck.free?.();
    }
  });

  // WR-02 (code review, Phase 26): refreshCollections rebuilt `collections`
  // wholesale but only ever wrote INTO collectionKeys, so a revoked
  // collection's unwrapped key stayed cached (and unfreed) until lock --
  // both an unfreed WASM handle holding live key material and a stale
  // capability, since getCollectionKey() kept returning it.
  it("a collection the server no longer returns has its cached key freed and evicted, not merely hidden", async () => {
    const { identityKey, ck, row } = makeFixtureCollectionRow(
      "collection-fixture-revoked",
      "Revoked Folder",
    );
    // `refreshCollections` frees the identity handle it resolves, and this
    // test drives TWO refreshes -- hand back a fresh handle each time,
    // exactly as the real `ensureOwnIdentityKeypair` does (returning one
    // shared fixture handle twice would double-free it).
    mockEnsureOwnIdentityKeypair.mockImplementationOnce(async () => identityKey);
    mockEnsureOwnIdentityKeypair.mockImplementation(async () => WasmIdentityKey.generate());
    mockListCollections.mockResolvedValue([row]);

    const uk = generateUserKey();
    const freeSpy = vi.spyOn(WasmCollectionKey.prototype, "free");
    try {
      setUnlockedUserKey(uk);
      await vi.waitFor(() => expect(getCollectionKey("collection-fixture-revoked")).toBeDefined());

      freeSpy.mockClear(); // ignore frees during setup/refresh above

      // Access revoked server-side: the row simply stops being returned.
      mockListCollections.mockResolvedValue([]);
      await refreshCollectionsNow();

      expect(getCollections()).toEqual([]);
      expect(getCollectionKey("collection-fixture-revoked")).toBeUndefined();
      expect(freeSpy).toHaveBeenCalledTimes(1);
    } finally {
      freeSpy.mockRestore();
      lockVault();
      ck.free?.();
    }
  });
});
