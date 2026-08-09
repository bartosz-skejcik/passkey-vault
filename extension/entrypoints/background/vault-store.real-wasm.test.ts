// Real-WASM proof for vault-store.ts's pending-vs-broken decrypt
// classification (27-12-PLAN.md Task 1, closing 27-VERIFICATION.md
// Blocker 1). Mirrors collections-store.real-wasm.test.ts's own beforeAll
// WASM-init/global.fetch-intercept technique. Every dependency
// vault-store.test.ts already mocks wholesale is mocked here too EXCEPT
// `../../lib/crypto/wasm-loader` -- that module is imported for REAL, so
// the "broken" case below exercises decryptItemForCollection's own AEAD
// integrity check against a genuinely wrong (but real) WasmCollectionKey,
// never a mocked throw. This is the Nyquist evidence 27-VALIDATION.md's
// evidence rule requires for a crypto-adjacent classification claim: a
// mocked wasm-loader can only prove "the mock was called," never that a
// real wrong-key decrypt genuinely fails its integrity check.
//
// State reset between the two cases below is done via the SAME lock-state
// mechanism vault-store.ts's own production code already uses (never
// vi.resetModules() -- that would tear down and re-instantiate the real
// WASM module/linear memory between tests, invalidating any
// WasmCollectionKey handle created before the reset): `./vault-session`'s
// mock captures the listener vault-store.ts registers at module load via
// subscribeSessionLockState, and each test's beforeEach fires a simulated
// lock transition through it -- the exact same code path
// vault-store.test.ts's own Test 4/4b exercise -- clearing
// pendingSharedItems/items/etc. before the next case runs.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  mockGetUnlockedUserKey: vi.fn(),
  mockGetCollectionKey: vi.fn(),
  mockGetCollectionAccessLevel: vi.fn(),
  mockHasRefreshedThisSession: vi.fn(),
  mockRefreshCollectionsNow: vi.fn(),
  mockFreeAllCollectionKeys: vi.fn(),
  mockEnsureOwnIdentityKeypair: vi.fn(),
  mockFreeIdentityKey: vi.fn(),
  mockStartSync: vi.fn(),
  mockStopSync: vi.fn(),
  mockGetSyncSnapshot: vi.fn(),
  mockTouchItem: vi.fn(),
  mockGetSharedRevisions: vi.fn(),
  mockGetCollectionSync: vi.fn(),
  mockGetSharedDirectSync: vi.fn(),
  mockSendMessage: vi.fn(),
  // Captures vault-store.ts's own subscribeSessionLockState(listener) call
  // (fired once, at module load, below) so beforeEach can drive a simulated
  // lock transition without ever calling vi.resetModules().
  lockState: { listener: (() => {}) as () => void, unlocked: true },
}));

vi.mock("./vault-session", () => ({
  getUnlockedUserKey: hoisted.mockGetUnlockedUserKey,
  isSessionUnlocked: () => hoisted.lockState.unlocked,
  subscribeSessionLockState: (listener: () => void) => {
    hoisted.lockState.listener = listener;
    return () => {};
  },
}));

vi.mock("./sync-client", () => ({
  startSync: hoisted.mockStartSync,
  stopSync: hoisted.mockStopSync,
}));

vi.mock("./vault-api", () => ({
  getSyncSnapshot: hoisted.mockGetSyncSnapshot,
  touchItem: hoisted.mockTouchItem,
  getSharedRevisions: hoisted.mockGetSharedRevisions,
  getCollectionSync: hoisted.mockGetCollectionSync,
  getSharedDirectSync: hoisted.mockGetSharedDirectSync,
}));

vi.mock("./collections-store", () => ({
  getCollectionKey: hoisted.mockGetCollectionKey,
  getCollectionAccessLevel: hoisted.mockGetCollectionAccessLevel,
  refreshCollectionsNow: hoisted.mockRefreshCollectionsNow,
  freeAllCollectionKeys: hoisted.mockFreeAllCollectionKeys,
  hasRefreshedThisSession: hoisted.mockHasRefreshedThisSession,
}));

vi.mock("./identity-store", () => ({
  ensureOwnIdentityKeypair: hoisted.mockEnsureOwnIdentityKeypair,
  freeIdentityKey: hoisted.mockFreeIdentityKey,
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      getURL: (p: string) => `chrome-extension://fake-test-id${p}`,
      sendMessage: hoisted.mockSendMessage,
    },
  },
}));

// NOTE: deliberately NO `vi.mock("../../lib/crypto/wasm-loader", ...)` --
// this is the real module, real wasm-bindgen bindings, for both the
// fixture-building calls below AND vault-store.ts's own internal
// decryptItemForCollection call.
import { initCrypto, WasmCollectionKey, encryptItemForCollection } from "../../lib/crypto/wasm-loader";
import { applySyncSnapshot, getItems, getPendingSharedItems, splitCombinedEncryptedItem } from "./vault-store";

const COLLECTION_ID = "collection-real-wasm-1";
const ITEM_ID = "item-real-wasm-1";

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
  // notifyListeners() (fired by applySyncSnapshot/the lock-state reset
  // below) always calls browser.runtime.sendMessage(...).catch(() => {}) --
  // resolved once here (clearAllMocks in beforeEach clears call history, not
  // implementations, so this persists across every test in this file).
  hoisted.mockSendMessage.mockResolvedValue(undefined);
});

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.mockSendMessage.mockResolvedValue(undefined);
  // Simulated lock transition through vault-store.ts's OWN production
  // subscribeSessionLockState handler -- clears pendingSharedItems/items/
  // every other in-memory array before each case, exactly like
  // vault-store.test.ts's Test 4b, without tearing down the real WASM
  // module (vi.resetModules() would do that and is deliberately not used
  // anywhere in this file -- see this file's header comment).
  hoisted.lockState.unlocked = false;
  hoisted.lockState.listener();
  hoisted.lockState.unlocked = true;
});

/** Builds one real, collection-scoped ItemRow -- genuinely encrypted under
 * `encryptingKey` -- in the split enc_key/enc_data wire shape
 * applySyncSnapshot/decryptItemRow expect (recombineEncryptedItem's own
 * inverse, via vault-store.ts's own exported splitCombinedEncryptedItem). */
function buildRealCollectionItemRow(encryptingKey: WasmCollectionKey) {
  const plaintext = JSON.stringify({
    type: "note",
    name: "Real WASM Fixture",
    body: "b",
    folderId: null,
    tags: [],
  });
  const combined = encryptItemForCollection(encryptingKey, plaintext, COLLECTION_ID, ITEM_ID, 1);
  const { encKey, encData } = splitCombinedEncryptedItem(combined);
  return {
    id: ITEM_ID,
    enc_key: encKey,
    enc_data: encData,
    revision: 1,
    updated_at: "2026-08-09T00:00:00Z",
    last_used_at: null,
    is_shared: true,
    last_editor_email: null,
    collection_id: COLLECTION_ID,
  };
}

describe("vault-store.ts: pending-vs-broken decrypt classification (27-12, Blocker 1 -- real WASM, not a mocked throw)", () => {
  it("a collection-scoped row whose Collection Key resolved but decrypts under a genuinely WRONG key classifies as 'broken', via a real AEAD integrity failure", async () => {
    const correctKey = WasmCollectionKey.generate();
    const wrongKey = WasmCollectionKey.generate();
    try {
      const row = buildRealCollectionItemRow(correctKey);

      hoisted.mockGetUnlockedUserKey.mockReturnValue({});
      hoisted.mockHasRefreshedThisSession.mockReturnValue(true);
      // The key IS resolved -- just genuinely the wrong one. This is the
      // exact shape the E2-error backstop is failing on: the Collection Key
      // cache has an entry, but it doesn't decrypt this row.
      hoisted.mockGetCollectionKey.mockReturnValue(wrongKey);
      hoisted.mockGetCollectionAccessLevel.mockReturnValue("edit");

      applySyncSnapshot({ revision: 1, items: [row] });

      expect(getItems()).toEqual([]);
      expect(getPendingSharedItems()).toEqual([
        { id: ITEM_ID, collectionId: COLLECTION_ID, status: "broken" },
      ]);
    } finally {
      correctKey.free?.();
      wrongKey.free?.();
    }
  });

  it("a collection-scoped row whose Collection Key isn't cached YET (hasRefreshedThisSession() false) classifies as 'pending', never attempting a decrypt at all", async () => {
    const correctKey = WasmCollectionKey.generate();
    try {
      const row = buildRealCollectionItemRow(correctKey);

      hoisted.mockGetUnlockedUserKey.mockReturnValue({});
      hoisted.mockHasRefreshedThisSession.mockReturnValue(false);
      hoisted.mockGetCollectionKey.mockReturnValue(undefined);

      applySyncSnapshot({ revision: 1, items: [row] });

      expect(getItems()).toEqual([]);
      expect(getPendingSharedItems()).toEqual([
        { id: ITEM_ID, collectionId: COLLECTION_ID, status: "pending" },
      ]);
    } finally {
      correctKey.free?.();
    }
  });
});
