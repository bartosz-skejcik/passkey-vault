// entrypoints/background/provider-ceremony.test.ts — Plan 12-02 Task 2's
// required behaviors for handleCredentialsCreate/handleCredentialsGet: the
// locked/unlocked, zero/one/PRF-capable/PRF-unavailable, and genuine-failure
// decision logic. Mirrors capture-handler.test.ts's precedent: vault-store.ts
// is mocked with real, pure re-implementations of the exports this suite
// needs (splitCombinedEncryptedItem) plus vi.fn() stand-ins for the rest, so
// importing this module for real never drags in the transitive sync-client/
// vault-session/wasm import graph.
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  mockEnsureHydrated: vi.fn(),
  mockSubscribeSessionLockState: vi.fn(),
  mockGetItems: vi.fn(),
  mockCreateItem: vi.fn(),
  mockUpdateItem: vi.fn(),
  mockEncryptItem: vi.fn(),
  mockWasmCreateProviderCredential: vi.fn(),
  mockWasmGetProviderAssertion: vi.fn(),
  mockOpenPopup: vi.fn(),
  mockWindowsCreate: vi.fn(),
  mockStorageSet: vi.fn(),
  mockStorageGet: vi.fn(),
  mockStorageRemove: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      id: "test-ext-id",
      getURL: (p: string) => `chrome-extension://test-ext-id/${p}`,
    },
    action: {
      openPopup: hoisted.mockOpenPopup,
    },
    windows: {
      create: hoisted.mockWindowsCreate,
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

// Real, pure re-implementation of splitCombinedEncryptedItem (mirrors
// capture-handler.test.ts's own precedent) -- getItems/createItem/updateItem
// stay pure vi.fn() stand-ins since this suite has no interest in exercising
// the network/sync transport for real.
vi.mock("./vault-store", () => ({
  getItems: hoisted.mockGetItems,
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

vi.mock("../../lib/crypto/wasm-loader", () => ({
  encryptItem: hoisted.mockEncryptItem,
  wasmCreateProviderCredential: hoisted.mockWasmCreateProviderCredential,
  wasmGetProviderAssertion: hoisted.mockWasmGetProviderAssertion,
}));

import { handleCredentialsCreate, handleCredentialsGet } from "./provider-ceremony";
import type { VaultItem } from "../../lib/vault/types";

const FAKE_UK = { tag: "unlocked-user-key" };

function passkeyItem(id: string, rpId: string, username: string): VaultItem {
  return {
    id,
    revision: 1,
    fields: {
      type: "passkey",
      name: username,
      folderId: null,
      tags: [],
      rpId,
      credentialId: `cred-${id}`,
      username,
      rawPasskeyJson: JSON.stringify({ rp_id: rpId, credential_id: [1, 2, 3] }),
    },
  };
}

function combinedEncryptedItemJson(): string {
  return JSON.stringify({ enc_key: { nonce: "n1", ciphertext: "c1" }, enc_data: { nonce: "n2", ciphertext: "c2" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.mockStorageGet.mockResolvedValue({});
  hoisted.mockStorageSet.mockResolvedValue(undefined);
  hoisted.mockStorageRemove.mockResolvedValue(undefined);
  hoisted.mockGetItems.mockReturnValue([]);
  hoisted.mockCreateItem.mockResolvedValue({ id: "new-id", revision: 1, updated_at: "now" });
  hoisted.mockUpdateItem.mockResolvedValue({ revision: 2, updated_at: "now" });
  hoisted.mockEncryptItem.mockReturnValue(combinedEncryptedItemJson());
  hoisted.mockSubscribeSessionLockState.mockReturnValue(() => {});
});

describe("D-09: locked vault", () => {
  it("credentials.get opens the popup and does NOT call the WASM binding until an unlock-resolved signal arrives", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(null);
    hoisted.mockOpenPopup.mockResolvedValue(undefined);

    // Fire the handler but don't await it to completion -- with no unlock
    // signal ever delivered, waitForUnlock()'s promise never resolves.
    void handleCredentialsGet({ publicKey: { rpId: "example.com" } }, "https://example.com");

    // Flush pending microtasks so the locked branch's async work runs.
    await vi.waitFor(() => {
      expect(hoisted.mockOpenPopup).toHaveBeenCalled();
    });

    expect(hoisted.mockOpenPopup).toHaveBeenCalledTimes(1);
    expect(hoisted.mockWasmGetProviderAssertion).not.toHaveBeenCalled();
    expect(hoisted.mockWasmCreateProviderCredential).not.toHaveBeenCalled();
  });

  it("falls back to browser.windows.create when browser.action.openPopup rejects", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(null);
    hoisted.mockOpenPopup.mockRejectedValue(new Error("no active tab / user gesture required"));
    hoisted.mockWindowsCreate.mockResolvedValue(undefined);

    void handleCredentialsCreate({ publicKey: { rp: { id: "example.com" } } }, "https://example.com");

    await vi.waitFor(() => {
      expect(hoisted.mockWindowsCreate).toHaveBeenCalled();
    });

    expect(hoisted.mockOpenPopup).toHaveBeenCalledTimes(1);
    expect(hoisted.mockWindowsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ type: "popup", width: 380, url: "popup.html" }),
    );
    expect(hoisted.mockWasmCreateProviderCredential).not.toHaveBeenCalled();
  });
});

describe("credentials.get: no matching credential", () => {
  it("returns { fallthrough: true } WITHOUT calling wasmGetProviderAssertion and WITHOUT throwing", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockGetItems.mockReturnValue([passkeyItem("pk-1", "other.example", "alice")]);

    const result = await handleCredentialsGet(
      { publicKey: { rpId: "example.com" } },
      "https://example.com",
    );

    expect(result).toEqual({ fallthrough: true });
    expect(hoisted.mockWasmGetProviderAssertion).not.toHaveBeenCalled();
  });
});

describe("credentials.get: exactly one matching credential", () => {
  it("calls the (mocked) wasmGetProviderAssertion and returns { fallthrough: false, credentialResponseJson }", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockGetItems.mockReturnValue([passkeyItem("pk-1", "example.com", "alice")]);
    hoisted.mockWasmGetProviderAssertion.mockReturnValue({
      credentialResponseJson: () => '{"id":"cred-pk-1","type":"public-key"}',
      updatedEncryptedItemJson: () => undefined,
    });

    const result = await handleCredentialsGet(
      { publicKey: { rpId: "example.com" } },
      "https://example.com",
    );

    expect(result).toEqual({
      fallthrough: false,
      credentialResponseJson: '{"id":"cred-pk-1","type":"public-key"}',
    });
    expect(hoisted.mockWasmGetProviderAssertion).toHaveBeenCalledTimes(1);
    expect(hoisted.mockWasmGetProviderAssertion).toHaveBeenCalledWith(
      FAKE_UK,
      expect.any(String),
      "https://example.com",
      expect.any(String),
      "pk-1",
      1,
    );
  });

  it("persists a sign-counter mutation via updateItem when updatedEncryptedItemJson is present", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockGetItems.mockReturnValue([passkeyItem("pk-1", "example.com", "alice")]);
    hoisted.mockWasmGetProviderAssertion.mockReturnValue({
      credentialResponseJson: () => '{"id":"cred-pk-1"}',
      updatedEncryptedItemJson: () => combinedEncryptedItemJson(),
    });

    await handleCredentialsGet({ publicKey: { rpId: "example.com" } }, "https://example.com");
    await vi.waitFor(() => {
      expect(hoisted.mockUpdateItem).toHaveBeenCalled();
    });

    expect(hoisted.mockUpdateItem).toHaveBeenCalledWith(
      "pk-1",
      expect.any(String),
      expect.any(String),
      1,
    );
  });
});

describe("CR-02: credentials.get with an omitted rpId defaults to the sender origin host", () => {
  it("matches a stored credential keyed on the sender origin's hostname when the RP's request omits rpId entirely", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockGetItems.mockReturnValue([passkeyItem("pk-1", "example.com", "alice")]);
    hoisted.mockWasmGetProviderAssertion.mockReturnValue({
      credentialResponseJson: () => '{"id":"cred-pk-1","type":"public-key"}',
      updatedEncryptedItemJson: () => undefined,
    });

    // No `rpId` field at all on the request -- the spec-valid omitted case
    // (defaults to the caller origin's effective domain) CR-02 fixes.
    const result = await handleCredentialsGet({ publicKey: {} }, "https://example.com");

    expect(result).toEqual({
      fallthrough: false,
      credentialResponseJson: '{"id":"cred-pk-1","type":"public-key"}',
    });
    expect(hoisted.mockWasmGetProviderAssertion).toHaveBeenCalledTimes(1);
  });

  it("still returns { fallthrough: true } when the origin's hostname matches no stored credential", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockGetItems.mockReturnValue([passkeyItem("pk-1", "other.example", "alice")]);

    const result = await handleCredentialsGet({ publicKey: {} }, "https://example.com");

    expect(result).toEqual({ fallthrough: true });
    expect(hoisted.mockWasmGetProviderAssertion).not.toHaveBeenCalled();
  });
});

describe("credentials.create: PRF capability reporting (D-16)", () => {
  it("reports { prfCapable: true } when the ceremony's own clientExtensionResults.prf.enabled is true", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockWasmCreateProviderCredential.mockReturnValue({
      credentialResponseJson: () =>
        JSON.stringify({ id: "new-cred", clientExtensionResults: { prf: { enabled: true } } }),
      encryptedItemJson: () => combinedEncryptedItemJson(),
    });

    const result = await handleCredentialsCreate(
      { publicKey: { rp: { id: "example.com" }, extensions: { prf: {} } } },
      "https://example.com",
    );

    expect(result.fallthrough).toBe(false);
    expect(result.prfCapable).toBe(true);
    expect(result.prfUnavailableReason).toBeUndefined();
  });

  it("reports { prfCapable: false, prfUnavailableReason: <non-empty> } when the ceremony reports capability-unavailable", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockWasmCreateProviderCredential.mockReturnValue({
      credentialResponseJson: () =>
        JSON.stringify({ id: "new-cred", clientExtensionResults: { prf: { enabled: false } } }),
      encryptedItemJson: () => combinedEncryptedItemJson(),
    });

    const result = await handleCredentialsCreate(
      { publicKey: { rp: { id: "example.com" }, extensions: { prf: {} } } },
      "https://example.com",
    );

    expect(result.fallthrough).toBe(false);
    expect(result.prfCapable).toBe(false);
    expect(result.prfUnavailableReason).toBeTruthy();
  });

  it("never reports prfCapable/prfUnavailableReason when the RP request did not include the prf extension", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockWasmCreateProviderCredential.mockReturnValue({
      credentialResponseJson: () => JSON.stringify({ id: "new-cred", clientExtensionResults: {} }),
      encryptedItemJson: () => combinedEncryptedItemJson(),
    });

    const result = await handleCredentialsCreate(
      { publicKey: { rp: { id: "example.com" } } },
      "https://example.com",
    );

    expect(result.prfCapable).toBeUndefined();
    expect(result.prfUnavailableReason).toBeUndefined();
  });
});

describe("genuine WASM failure (not decline/no-match)", () => {
  it("credentials.create: a thrown exception from the WASM call is caught and converted to { fallthrough: false, failed: true }", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockWasmCreateProviderCredential.mockImplementation(() => {
      throw new Error("ceremony failed");
    });

    const result = await handleCredentialsCreate(
      { publicKey: { rp: { id: "example.com" } } },
      "https://example.com",
    );

    expect(result).toEqual({ fallthrough: false, failed: true });
  });

  it("credentials.get: a thrown exception from the WASM call is caught and converted to { fallthrough: false, failed: true }", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockGetItems.mockReturnValue([passkeyItem("pk-1", "example.com", "alice")]);
    hoisted.mockWasmGetProviderAssertion.mockImplementation(() => {
      throw new Error("ceremony failed");
    });

    const result = await handleCredentialsGet(
      { publicKey: { rpId: "example.com" } },
      "https://example.com",
    );

    expect(result).toEqual({ fallthrough: false, failed: true });
  });
});

describe("D-10: fresh re-check of chrome.storage.session on every invocation", () => {
  it("calls ensureHydrated at least once per handler invocation, even on a second call in the same run", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockGetItems.mockReturnValue([]);

    await handleCredentialsGet({ publicKey: { rpId: "example.com" } }, "https://example.com");
    await handleCredentialsGet({ publicKey: { rpId: "example.com" } }, "https://example.com");

    expect(hoisted.mockEnsureHydrated).toHaveBeenCalledTimes(2);
  });
});

describe("every exported handler has a top-level try/catch (grep-auditable, D-11)", () => {
  it("provider-ceremony.ts source wraps handleCredentialsCreate/handleCredentialsGet bodies in try/catch", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(import.meta.dirname, "provider-ceremony.ts"),
      "utf-8",
    );
    const tryCount = (src.match(/\btry\s*{/g) ?? []).length;
    expect(tryCount).toBeGreaterThanOrEqual(2);
  });
});
