// entrypoints/background/provider-ceremony.real-wasm.test.ts — Task 1's
// (27-06-PLAN.md, T-27-14) real-WASM proof that persistUpdatedProviderItem's
// collection-aware write-back dispatch genuinely re-encrypts under the
// item's REAL Collection Key/scope/AAD before persisting -- not merely "a
// different function was called". provider-ceremony.test.ts's own EXISTING
// mocked-crypto suite (`vi.mock("../../lib/crypto/wasm-loader", ...)`)
// cannot distinguish a correct-AAD call from a wrong-AAD one; this file's
// item-crypto is genuine end to end, mirroring collections-store.real-wasm
// .test.ts's own beforeAll pattern.
//
// Mocked here: wxt/browser (storage.session/action/windows -- wire
// plumbing), ./vault-session (ensureHydrated/subscribeSessionLockState --
// session plumbing, hands back a REAL locally-generated WasmUserKey),
// ./vault-store (getItems/touchVaultItem -- pure stand-ins;
// splitCombinedEncryptedItem is a REAL, pure re-implementation, same
// precedent as provider-ceremony.test.ts's own mock), ./vault-api
// (createItem/updateItem -- the SERVER wire boundary this task's own action
// text names as the one thing to mock, exactly enough to capture the
// ciphertext argument it was actually called with), ./collections-store
// (getCollectionKey -- hands back a REAL, locally-generated
// WasmCollectionKey cached ahead of time by the test), ./server-config
// (readServerConfig -- null, so isConfiguredServerOrigin's defense-in-depth
// never fires).
//
// PARTIAL mock of ../../lib/crypto/wasm-loader: only
// wasmCreateProviderCredential/wasmGetProviderAssertion (the two
// provider-ceremony-SPECIFIC bindings) are stubbed -- per 27-02's EXT-10
// finding, a REAL wasmGetProviderAssertion call NEVER returns
// updated_passkey_json today (no signature counter is ever set on any live
// ceremony), so this test's own stub is what exercises the otherwise-
// dormant write-back dispatch at all. Every OTHER export --
// encryptItem/decryptItem/encryptItemForCollection/decryptItemForCollection/
// WasmUserKey/WasmCollectionKey/initCrypto -- is the REAL module
// (`importOriginal`, mirrors web/src/lib/vault/store.real-wasm.test.ts's
// identical `./api` partial-mock precedent). The stub's own
// `updatedEncryptedItemJson()` return value is produced by a REAL
// `encryptItem(uk, plaintext, itemId, revision + 1)` call in this test's
// setup, mirroring `wasm_get_provider_assertion`'s own internal math
// exactly (crates/pv-wasm/src/lib.rs) -- so the write-back this test proves
// is exercised against genuine ciphertext, never a fabricated string.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  mockEnsureHydrated: vi.fn(),
  mockSubscribeSessionLockState: vi.fn(),
  mockGetItems: vi.fn(),
  mockTouchVaultItem: vi.fn(),
  mockCreateItem: vi.fn(),
  mockUpdateItem: vi.fn(),
  mockGetCollectionKey: vi.fn(),
  mockWasmCreateProviderCredential: vi.fn(),
  mockWasmGetProviderAssertion: vi.fn(),
  mockOpenPopup: vi.fn(),
  mockWindowsCreate: vi.fn(),
  mockWindowsGetLastFocused: vi.fn(),
  mockStorageSet: vi.fn(),
  mockStorageGet: vi.fn(),
  mockStorageRemove: vi.fn(),
  mockReadServerConfig: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      id: "test-ext-id",
      getURL: (p: string) => `chrome-extension://test-ext-id${p}`,
    },
    action: {
      openPopup: hoisted.mockOpenPopup,
    },
    windows: {
      create: hoisted.mockWindowsCreate,
      getLastFocused: hoisted.mockWindowsGetLastFocused,
    },
    storage: {
      session: {
        get: hoisted.mockStorageGet,
        set: hoisted.mockStorageSet,
        remove: hoisted.mockStorageRemove,
      },
    },
  },
}));

vi.mock("./vault-session", () => ({
  ensureHydrated: hoisted.mockEnsureHydrated,
  subscribeSessionLockState: hoisted.mockSubscribeSessionLockState,
}));

vi.mock("./vault-store", () => ({
  getItems: hoisted.mockGetItems,
  touchVaultItem: hoisted.mockTouchVaultItem,
  splitCombinedEncryptedItem: (combinedJson: string) => {
    const combined = JSON.parse(combinedJson) as { enc_key: unknown; enc_data: unknown };
    return {
      encKey: JSON.stringify(combined.enc_key),
      encData: JSON.stringify(combined.enc_data),
    };
  },
}));

vi.mock("./vault-api", () => ({
  createItem: hoisted.mockCreateItem,
  updateItem: hoisted.mockUpdateItem,
}));

vi.mock("./collections-store", () => ({
  getCollectionKey: hoisted.mockGetCollectionKey,
}));

vi.mock("./server-config", () => ({
  readServerConfig: hoisted.mockReadServerConfig,
}));

vi.mock("../../lib/crypto/wasm-loader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/crypto/wasm-loader")>();
  return {
    ...actual,
    wasmCreateProviderCredential: hoisted.mockWasmCreateProviderCredential,
    wasmGetProviderAssertion: hoisted.mockWasmGetProviderAssertion,
  };
});

import {
  initCrypto,
  WasmUserKey,
  WasmCollectionKey,
  encryptItem,
  decryptItemForCollection,
} from "../../lib/crypto/wasm-loader";
import { handleCredentialsGet, resolveProviderCredentialChoice } from "./provider-ceremony";
import type { VaultItem } from "../../lib/vault/types";

const PENDING_CEREMONY_KEY = "pv-pending-provider-ceremony";

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

function collectionPasskeyItem(
  id: string,
  rpId: string,
  collectionId: string,
  revision: number,
): VaultItem {
  return {
    id,
    revision,
    collectionId,
    fields: {
      type: "passkey",
      name: "alice",
      folderId: null,
      tags: [],
      rpId,
      credentialId: `cred-${id}`,
      username: "alice",
      rawPasskeyJson: JSON.stringify({ rp_id: rpId, credential_id: [1, 2, 3] }),
    },
  };
}

async function awaitConsentRequestId(): Promise<string> {
  let requestId: string | undefined;
  await vi.waitFor(() => {
    const call = hoisted.mockStorageSet.mock.calls
      .map((args) => (args[0] as Record<string, unknown>)[PENDING_CEREMONY_KEY])
      .filter((v): v is { requestId: string } => v !== undefined)
      .at(-1);
    if (call === undefined) {
      throw new Error("no consent payload captured yet");
    }
    requestId = call.requestId;
  });
  if (requestId === undefined) {
    throw new Error("unreachable: requestId never captured");
  }
  return requestId;
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.mockStorageGet.mockResolvedValue({});
  hoisted.mockStorageSet.mockResolvedValue(undefined);
  hoisted.mockStorageRemove.mockResolvedValue(undefined);
  hoisted.mockReadServerConfig.mockResolvedValue(null);
  hoisted.mockUpdateItem.mockResolvedValue({ revision: 2, updated_at: "now" });
  hoisted.mockSubscribeSessionLockState.mockReturnValue(() => {});
});

describe("Task 1 (27-06) behavior 2: persistUpdatedProviderItem collection-scoped re-encrypt (REAL WASM crypto)", () => {
  it("decrypts a real User-Key-encrypted updatedEncryptedItemJson and persists it re-encrypted under the item's REAL Collection Key -- the server-persisted ciphertext round-trips back to the original known plaintext via a real decryptItemForCollection call", async () => {
    const uk = WasmUserKey.generate();
    const ck = WasmCollectionKey.generate();
    const itemId = "shared-passkey-1";
    const collectionId = "collection-real-1";
    const currentRevision = 3;
    const mutatedPlaintext = JSON.stringify({ mutated: true, marker: "27-06-real-round-trip" });

    try {
      hoisted.mockEnsureHydrated.mockResolvedValue(uk);
      hoisted.mockGetItems.mockReturnValue([
        collectionPasskeyItem(itemId, "example.com", collectionId, currentRevision),
      ]);
      hoisted.mockGetCollectionKey.mockReturnValue(ck);

      // Mirrors wasm_get_provider_assertion's OWN internal math exactly
      // (crates/pv-wasm/src/lib.rs's core_encrypt_item(&uk.0, updated_json,
      // item_id, revision + 1)) -- a REAL encryptItem call, same
      // uk/item_id/revision+1 the write-back dispatch will decrypt with.
      const realUserKeyEncryptedUpdate = encryptItem(uk, mutatedPlaintext, itemId, currentRevision + 1);

      hoisted.mockWasmGetProviderAssertion.mockReturnValue({
        credentialResponseJson: () => '{"id":"cred-shared-passkey-1"}',
        updatedEncryptedItemJson: () => realUserKeyEncryptedUpdate,
      });

      const resultPromise = handleCredentialsGet(
        { publicKey: { rpId: "example.com" } },
        "https://example.com",
      );

      const requestId = await awaitConsentRequestId();
      resolveProviderCredentialChoice(requestId, itemId);

      const result = await resultPromise;
      expect(result).toEqual({
        fallthrough: false,
        credentialResponseJson: '{"id":"cred-shared-passkey-1"}',
      });

      await vi.waitFor(() => {
        expect(hoisted.mockUpdateItem).toHaveBeenCalled();
      });

      expect(hoisted.mockGetCollectionKey).toHaveBeenCalledWith(collectionId);

      // The SERVER-PERSISTED ciphertext: reconstruct the combined
      // {enc_key, enc_data} JSON updateItem was ACTUALLY called with.
      const [persistedItemId, encKeyJson, encDataJson, persistedExpectedRevision] =
        hoisted.mockUpdateItem.mock.calls[0] as [string, string, string, number];
      expect(persistedItemId).toBe(itemId);
      expect(persistedExpectedRevision).toBe(currentRevision);

      const persistedCombined = JSON.stringify({
        enc_key: JSON.parse(encKeyJson) as unknown,
        enc_data: JSON.parse(encDataJson) as unknown,
      });

      // Genuinely re-encrypted -- never the User-Key-scoped input persisted
      // verbatim.
      expect(persistedCombined).not.toBe(realUserKeyEncryptedUpdate);

      // The real round trip: decrypting the SERVER-PERSISTED ciphertext
      // with the item's REAL Collection Key recovers the ORIGINAL known
      // plaintext -- proving the re-encrypt is genuinely collection-scoped
      // (correct key, correct collection_id/item_id/revision AAD), not
      // merely "a different function was called".
      const roundTripped = decryptItemForCollection(
        ck,
        persistedCombined,
        collectionId,
        itemId,
        currentRevision + 1,
      );
      expect(roundTripped).toBe(mutatedPlaintext);
    } finally {
      uk.free?.();
      ck.free?.();
    }
  });
});
