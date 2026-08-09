// entrypoints/background/provider-ceremony.test.ts — the locked/unlocked,
// zero/one/multi-match, PRF-capable/PRF-unavailable, and genuine-failure
// decision logic of handleCredentialsCreate/handleCredentialsGet, PLUS
// Plan 12-05's Decision A consent gate (12-REVIEW.md CR-01..IN-04): EVERY
// ceremony now awaits an explicit popup confirm/decline before minting/
// persisting or signing anything, never a silent-on-unlocked-vault path.
// Mirrors capture-handler.test.ts's precedent: vault-store.ts is mocked
// with real, pure re-implementations of the exports this suite needs
// (splitCombinedEncryptedItem) plus vi.fn() stand-ins for the rest, so
// importing this module for real never drags in the transitive sync-client/
// vault-session/wasm import graph.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  mockEnsureHydrated: vi.fn(),
  mockSubscribeSessionLockState: vi.fn(),
  mockGetItems: vi.fn(),
  mockTouchVaultItem: vi.fn(),
  mockEnsureItemsHydrated: vi.fn(),
  mockEnsureSharedItemsHydrated: vi.fn(),
  mockCreateItem: vi.fn(),
  mockUpdateItem: vi.fn(),
  mockEncryptItem: vi.fn(),
  mockDecryptItem: vi.fn(),
  mockEncryptItemForCollection: vi.fn(),
  mockGetCollectionKey: vi.fn(),
  mockGetCollections: vi.fn(),
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
      getURL: (p: string) => `chrome-extension://test-ext-id/${p}`,
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

// Real, pure re-implementation of splitCombinedEncryptedItem (mirrors
// capture-handler.test.ts's own precedent) -- getItems/createItem/updateItem
// stay pure vi.fn() stand-ins since this suite has no interest in exercising
// the network/sync transport for real.
vi.mock("./vault-store", () => ({
  getItems: hoisted.mockGetItems,
  touchVaultItem: hoisted.mockTouchVaultItem,
  ensureItemsHydrated: hoisted.mockEnsureItemsHydrated,
  ensureSharedItemsHydrated: hoisted.mockEnsureSharedItemsHydrated,
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
  getCollections: hoisted.mockGetCollections,
}));

vi.mock("../../lib/crypto/wasm-loader", () => ({
  encryptItem: hoisted.mockEncryptItem,
  decryptItem: hoisted.mockDecryptItem,
  encryptItemForCollection: hoisted.mockEncryptItemForCollection,
  wasmCreateProviderCredential: hoisted.mockWasmCreateProviderCredential,
  wasmGetProviderAssertion: hoisted.mockWasmGetProviderAssertion,
}));

// Bartek live-UAT bug follow-up (.planning/debug/resolved/
// signin-passkeyless-spin.md, provider-hijack diagnosis): the background's
// OWN defense-in-depth refusal (isConfiguredServerOrigin, this file) reads
// the same server-config module server-unlock.ts already uses -- defaults
// to `null` (no server configured), so every EXISTING test below is
// unaffected unless it explicitly opts in via mockReadServerConfig.
vi.mock("./server-config", () => ({
  readServerConfig: hoisted.mockReadServerConfig,
}));

import {
  handleCredentialsCreate,
  handleCredentialsGet,
  resolveProviderCredentialChoice,
} from "./provider-ceremony";
import type { VaultItem } from "../../lib/vault/types";

const FAKE_UK = { tag: "unlocked-user-key" };
const PENDING_CEREMONY_KEY = "pv-pending-provider-ceremony";

interface CapturedConsentPayload {
  requestId: string;
  kind: "create" | "get";
  rpId: string;
  account?: string;
  prfRequested: boolean;
  candidates: { itemId: string; label: string }[];
}

function passkeyItem(
  id: string,
  rpId: string,
  username: string,
  collectionId?: string,
  undecryptable?: boolean,
): VaultItem {
  return {
    id,
    revision: 1,
    collectionId: collectionId ?? null,
    ...(undecryptable === true ? { undecryptable: true } : {}),
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

/** Decision A (Plan 12-05): every create()/get() ceremony now writes ONE
 * unified consent payload to `chrome.storage.session` and awaits an
 * explicit `resolveProviderCredentialChoice` call before proceeding --
 * this helper reads the LAST such payload written (mirrors how App.tsx
 * would read it) so tests can drive the confirm/decline step. */
function lastPendingCeremonyPayload(): CapturedConsentPayload | undefined {
  const call = hoisted.mockStorageSet.mock.calls
    .map((args) => (args[0] as Record<string, unknown>)[PENDING_CEREMONY_KEY])
    .filter((v): v is CapturedConsentPayload => v !== undefined);
  return call.at(-1);
}

async function awaitPendingCeremonyPayload(): Promise<CapturedConsentPayload> {
  await vi.waitFor(() => {
    expect(lastPendingCeremonyPayload()).toBeDefined();
  });
  return lastPendingCeremonyPayload() as CapturedConsentPayload;
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.mockStorageGet.mockResolvedValue({});
  hoisted.mockStorageSet.mockResolvedValue(undefined);
  hoisted.mockStorageRemove.mockResolvedValue(undefined);
  hoisted.mockGetItems.mockReturnValue([]);
  hoisted.mockEnsureItemsHydrated.mockResolvedValue({ ok: true });
  hoisted.mockEnsureSharedItemsHydrated.mockResolvedValue({ ok: true });
  hoisted.mockCreateItem.mockResolvedValue({ id: "new-id", revision: 1, updated_at: "now" });
  hoisted.mockUpdateItem.mockResolvedValue({ revision: 2, updated_at: "now" });
  hoisted.mockEncryptItem.mockReturnValue(combinedEncryptedItemJson());
  hoisted.mockDecryptItem.mockReturnValue('{"type":"passkey"}');
  hoisted.mockEncryptItemForCollection.mockReturnValue(combinedEncryptedItemJson());
  hoisted.mockGetCollectionKey.mockReturnValue(undefined);
  hoisted.mockGetCollections.mockReturnValue([]);
  hoisted.mockSubscribeSessionLockState.mockReturnValue(() => {});
  hoisted.mockReadServerConfig.mockResolvedValue(null);
  hoisted.mockWindowsGetLastFocused.mockResolvedValue({ left: 100, top: 50, width: 1200, height: 800 });
});

// Bartek live-UAT bug follow-up (.planning/debug/resolved/
// signin-passkeyless-spin.md, provider-hijack diagnosis): defense-in-depth
// -- content-relay.content.ts's own isConfiguredServerOrigin() check is
// the PRIMARY refusal (never even forwards to the background); this SECOND
// layer covers a request that reaches the background anyway (a future
// content-relay regression, a different/older build, or any other path).
describe("provider-hijack defense-in-depth: refuses ceremonies on the configured server origin", () => {
  it("handleCredentialsGet: falls through immediately, never touches ensureHydrated/the popup/the WASM binding", async () => {
    hoisted.mockReadServerConfig.mockResolvedValue({ baseUrl: "https://vault.example.com" });

    const result = await handleCredentialsGet(
      { publicKey: { rpId: "vault.example.com" } },
      "https://vault.example.com",
    );

    expect(result).toEqual({ fallthrough: true });
    expect(hoisted.mockEnsureHydrated).not.toHaveBeenCalled();
    expect(hoisted.mockOpenPopup).not.toHaveBeenCalled();
    expect(hoisted.mockWindowsCreate).not.toHaveBeenCalled();
    expect(hoisted.mockWasmGetProviderAssertion).not.toHaveBeenCalled();
  });

  it("handleCredentialsCreate: falls through immediately, never touches ensureHydrated/the popup/the WASM binding", async () => {
    hoisted.mockReadServerConfig.mockResolvedValue({ baseUrl: "https://vault.example.com" });

    const result = await handleCredentialsCreate(
      { publicKey: { rp: { id: "vault.example.com" } } },
      "https://vault.example.com",
    );

    expect(result).toEqual({ fallthrough: true });
    expect(hoisted.mockEnsureHydrated).not.toHaveBeenCalled();
    expect(hoisted.mockOpenPopup).not.toHaveBeenCalled();
    expect(hoisted.mockWindowsCreate).not.toHaveBeenCalled();
    expect(hoisted.mockWasmCreateProviderCredential).not.toHaveBeenCalled();
  });

  it("a DIFFERENT (non-matching) sender origin proceeds normally even with a server configured", async () => {
    hoisted.mockReadServerConfig.mockResolvedValue({ baseUrl: "https://vault.example.com" });
    hoisted.mockEnsureHydrated.mockResolvedValue(null);
    hoisted.mockOpenPopup.mockResolvedValue(undefined);

    void handleCredentialsGet({ publicKey: { rpId: "some-other-site.com" } }, "https://some-other-site.com");

    await vi.waitFor(() => {
      expect(hoisted.mockOpenPopup).toHaveBeenCalled();
    });
    expect(hoisted.mockOpenPopup).toHaveBeenCalledTimes(1);
  });

  it("no server configured at all: proceeds normally (fails closed to 'not the configured origin', never suppresses based on a guess)", async () => {
    hoisted.mockReadServerConfig.mockResolvedValue(null);
    hoisted.mockEnsureHydrated.mockResolvedValue(null);
    hoisted.mockOpenPopup.mockResolvedValue(undefined);

    void handleCredentialsGet({ publicKey: { rpId: "example.com" } }, "https://example.com");

    await vi.waitFor(() => {
      expect(hoisted.mockOpenPopup).toHaveBeenCalled();
    });
    expect(hoisted.mockOpenPopup).toHaveBeenCalledTimes(1);
  });

  it("a corrupt/non-URL configured baseUrl fails closed to 'not the configured origin' -- proceeds normally rather than refusing everything", async () => {
    hoisted.mockReadServerConfig.mockResolvedValue({ baseUrl: "not a url" });
    hoisted.mockEnsureHydrated.mockResolvedValue(null);
    hoisted.mockOpenPopup.mockResolvedValue(undefined);

    void handleCredentialsGet({ publicKey: { rpId: "example.com" } }, "https://example.com");

    await vi.waitFor(() => {
      expect(hoisted.mockOpenPopup).toHaveBeenCalled();
    });
    expect(hoisted.mockOpenPopup).toHaveBeenCalledTimes(1);
  });
});

describe("D-09: locked vault", () => {
  it("credentials.get opens the popup and does NOT call the WASM binding until an unlock-resolved signal arrives", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(null);
    hoisted.mockOpenPopup.mockResolvedValue(undefined);

    // Fire the handler but don't await it to completion -- with no unlock
    // signal ever delivered, waitForUnlock()'s promise never resolves
    // (short of its own WR-03 abandon timeout, far outside this test's
    // real-time budget).
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
      expect.objectContaining({
        type: "popup",
        url: "popup.html",
        width: 380,
        height: 460,
        focused: true,
        left: 510,
        top: 220,
      }),
    );
    expect(hoisted.mockWasmCreateProviderCredential).not.toHaveBeenCalled();
  });

  it("falls back to default placement (no left/top) when getLastFocused() resolves empty geometry", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(null);
    hoisted.mockOpenPopup.mockRejectedValue(new Error("no active tab / user gesture required"));
    hoisted.mockWindowsCreate.mockResolvedValue(undefined);
    hoisted.mockWindowsGetLastFocused.mockResolvedValue({});

    void handleCredentialsCreate({ publicKey: { rp: { id: "example.com" } } }, "https://example.com");

    await vi.waitFor(() => {
      expect(hoisted.mockWindowsCreate).toHaveBeenCalled();
    });

    const call = hoisted.mockWindowsCreate.mock.calls[0][0];
    expect(call).not.toHaveProperty("left");
    expect(call).not.toHaveProperty("top");
    expect(call).toEqual(
      expect.objectContaining({ type: "popup", url: "popup.html", width: 380, height: 460, focused: true }),
    );
  });

  it("falls back to default placement (no left/top) when getLastFocused() resolves partial geometry (height missing)", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(null);
    hoisted.mockOpenPopup.mockRejectedValue(new Error("no active tab / user gesture required"));
    hoisted.mockWindowsCreate.mockResolvedValue(undefined);
    hoisted.mockWindowsGetLastFocused.mockResolvedValue({ left: 100, top: 50, width: 1200 });

    void handleCredentialsCreate({ publicKey: { rp: { id: "example.com" } } }, "https://example.com");

    await vi.waitFor(() => {
      expect(hoisted.mockWindowsCreate).toHaveBeenCalled();
    });

    const call = hoisted.mockWindowsCreate.mock.calls[0][0];
    expect(call).not.toHaveProperty("left");
    expect(call).not.toHaveProperty("top");
    expect(call).toEqual(
      expect.objectContaining({ type: "popup", url: "popup.html", width: 380, height: 460, focused: true }),
    );
  });
});

describe("WR-04: no dead boolean flag written to pv-pending-provider-ceremony", () => {
  it("while the vault is locked (never unlocks), every write to the storage key is an OBJECT, never a bare boolean", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(null);
    hoisted.mockOpenPopup.mockResolvedValue(undefined);

    void handleCredentialsGet({ publicKey: { rpId: "example.com" } }, "https://example.com");

    await vi.waitFor(() => {
      expect(hoisted.mockOpenPopup).toHaveBeenCalled();
    });

    for (const call of hoisted.mockStorageSet.mock.calls) {
      const value = (call[0] as Record<string, unknown>)[PENDING_CEREMONY_KEY];
      if (value !== undefined) {
        expect(typeof value).toBe("object");
        expect(value).not.toBe(true);
      }
    }
  });
});

describe("WR-03: waitForUnlock cancellation (abandon timeout)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("credentials.get: if the vault never unlocks within the abandon timeout, unsubscribe() is called and the handler falls through without ever calling wasmGetProviderAssertion", async () => {
    vi.useFakeTimers();
    hoisted.mockEnsureHydrated.mockResolvedValue(null);
    hoisted.mockOpenPopup.mockResolvedValue(undefined);
    const mockUnsubscribe = vi.fn();
    hoisted.mockSubscribeSessionLockState.mockReturnValue(mockUnsubscribe);

    const resultPromise = handleCredentialsGet(
      { publicKey: { rpId: "example.com" } },
      "https://example.com",
    );

    await vi.advanceTimersByTimeAsync(120_000);
    const result = await resultPromise;

    expect(result).toEqual({ fallthrough: true });
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    expect(hoisted.mockWasmGetProviderAssertion).not.toHaveBeenCalled();
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
    // Zero matches means nothing to ask consent for -- no popup, no
    // storage write at all.
    expect(hoisted.mockOpenPopup).not.toHaveBeenCalled();
  });

  // 27-10 Task 2: confirms the empty-candidates fallthrough claim against
  // real code for a shared-but-undecryptable would-be candidate, rather
  // than leaving it as an inference. vault-store.ts never actually sets
  // `undecryptable: true` on any VaultItem it produces for the extension
  // (every decrypt failure is dropped from getItems() entirely, recorded
  // only via getPendingSharedItems()) -- this test exercises the DEFENSIVE
  // filter at handleCredentialsGet's call site regardless, so the
  // ceremony's own behavior is pinned even if a future change starts
  // retaining stale items the way web's store does.
  it("a stale-but-otherwise-matching item.undecryptable:true candidate is excluded from the ceremony -- falls through cleanly instead of rendering it", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockGetItems.mockReturnValue([
      passkeyItem("pk-stale", "example.com", "alice", undefined, true),
    ]);

    const result = await handleCredentialsGet(
      { publicKey: { rpId: "example.com" } },
      "https://example.com",
    );

    expect(result).toEqual({ fallthrough: true });
    expect(hoisted.mockWasmGetProviderAssertion).not.toHaveBeenCalled();
    expect(hoisted.mockOpenPopup).not.toHaveBeenCalled();
  });

  it("an undecryptable candidate is excluded even when a healthy candidate also matches -- the healthy one alone reaches the picker", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockGetItems.mockReturnValue([
      passkeyItem("pk-stale", "example.com", "alice", undefined, true),
      passkeyItem("pk-healthy", "example.com", "bob"),
    ]);
    hoisted.mockWasmGetProviderAssertion.mockReturnValue({
      credentialResponseJson: () => '{"id":"cred-pk-healthy"}',
      updatedEncryptedItemJson: () => undefined,
    });

    const resultPromise = handleCredentialsGet(
      { publicKey: { rpId: "example.com" } },
      "https://example.com",
    );
    const payload = await awaitPendingCeremonyPayload();
    expect(payload.candidates).toEqual([{ itemId: "pk-healthy", label: "bob" }]);

    resolveProviderCredentialChoice(payload.requestId, "pk-healthy");
    const result = await resultPromise;
    expect(result).toEqual({ fallthrough: false, credentialResponseJson: '{"id":"cred-pk-healthy"}' });
  });
});

// 27-13 (Blocker 2 gap closure, 27-VERIFICATION.md): handleCredentialsGet
// previously snapshotted getItems() immediately after resolving the User
// Key, with no barrier on the shared-item/Collection-Key caches also having
// settled this MV3 wake -- so a cold wake where a personal passkey matches
// the RP while a shared one for the SAME RP is still resolving could render
// an incomplete picker as if it were complete. Both tests below prove this
// against real control flow (an await-ordering claim, not a crypto claim --
// this suite mocks ../../lib/crypto/wasm-loader, so mocked-crypto evidence
// is inadmissible for a crypto claim, but IS admissible here since neither
// test asserts anything about ciphertext).
describe("27-13 (Blocker 2 gap closure): handleCredentialsGet's resolution barrier before the candidate snapshot", () => {
  it("awaits ensureItemsHydrated() then ensureSharedItemsHydrated(), in that order, BEFORE getItems() is ever called", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    const callOrder: string[] = [];
    hoisted.mockEnsureItemsHydrated.mockImplementation(async () => {
      callOrder.push("ensureItemsHydrated");
      return { ok: true };
    });
    hoisted.mockEnsureSharedItemsHydrated.mockImplementation(async () => {
      callOrder.push("ensureSharedItemsHydrated");
      return { ok: true };
    });
    hoisted.mockGetItems.mockImplementation(() => {
      callOrder.push("getItems");
      return [passkeyItem("pk-1", "example.com", "alice")];
    });
    hoisted.mockWasmGetProviderAssertion.mockReturnValue({
      credentialResponseJson: () => '{"id":"cred-pk-1"}',
      updatedEncryptedItemJson: () => undefined,
    });

    const resultPromise = handleCredentialsGet(
      { publicKey: { rpId: "example.com" } },
      "https://example.com",
    );
    const payload = await awaitPendingCeremonyPayload();
    resolveProviderCredentialChoice(payload.requestId, "pk-1");
    await resultPromise;

    expect(callOrder).toEqual(["ensureItemsHydrated", "ensureSharedItemsHydrated", "getItems"]);
  });

  it("a shared candidate whose Collection Key resolves DURING ensureSharedItemsHydrated()'s await window is included in the resulting picker -- not silently omitted", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    // Seeds getItems() with ONLY the personal candidate to start -- the
    // exact shape of the race this plan closes: a personal match for the RP
    // is already decrypted, but a shared match for the SAME rpId has not
    // landed yet.
    let currentItems: VaultItem[] = [passkeyItem("pk-personal", "example.com", "alice")];
    hoisted.mockGetItems.mockImplementation(() => currentItems);
    hoisted.mockEnsureItemsHydrated.mockResolvedValue({ ok: true });
    // Simulates the shared-revisions merge landing DURING this exact await
    // window -- mutates what getItems() will subsequently return to also
    // include a second, shared passkey candidate for the same rpId, exactly
    // as a real ensureSharedItemsHydrated() resolving would (its side
    // effect is vault-store.ts's own internal state, read back via
    // getItems() afterward).
    hoisted.mockEnsureSharedItemsHydrated.mockImplementation(async () => {
      currentItems = [
        ...currentItems,
        passkeyItem("pk-shared", "example.com", "bob", "collection-1"),
      ];
      return { ok: true };
    });

    const resultPromise = handleCredentialsGet(
      { publicKey: { rpId: "example.com" } },
      "https://example.com",
    );
    const payload = await awaitPendingCeremonyPayload();

    // Without the ensureSharedItemsHydrated() await, getItems() would be
    // read immediately after ensureItemsHydrated() resolves -- BEFORE this
    // mutation lands -- and payload.candidates would contain only
    // "pk-personal". A genuine regression guard, not a vacuous pass.
    expect(payload.candidates.map((c) => c.itemId).sort()).toEqual(["pk-personal", "pk-shared"]);

    resolveProviderCredentialChoice(payload.requestId, "pk-personal");
    await resultPromise;
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
    const resultPromise = handleCredentialsGet({ publicKey: {} }, "https://example.com");
    const payload = await awaitPendingCeremonyPayload();
    expect(payload.rpId).toBe("example.com");
    resolveProviderCredentialChoice(payload.requestId, "pk-1");

    const result = await resultPromise;
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

describe("Decision A (12-05-PLAN.md): credentials.create is consent-gated end-to-end", () => {
  it("writes a create-kind consent payload and awaits an explicit confirm BEFORE calling wasmCreateProviderCredential", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockWasmCreateProviderCredential.mockReturnValue({
      credentialResponseJson: () => JSON.stringify({ id: "new-cred", clientExtensionResults: {} }),
      encryptedItemJson: () => combinedEncryptedItemJson(),
    });

    const resultPromise = handleCredentialsCreate(
      { publicKey: { rp: { id: "example.com" }, user: { name: "alice@example.com" } } },
      "https://example.com",
    );

    const payload = await awaitPendingCeremonyPayload();
    expect(payload.kind).toBe("create");
    expect(payload.rpId).toBe("example.com");
    expect(payload.account).toBe("alice@example.com");
    expect(payload.candidates).toEqual([]);
    // The whole point of the gate: nothing minted yet.
    expect(hoisted.mockWasmCreateProviderCredential).not.toHaveBeenCalled();

    resolveProviderCredentialChoice(payload.requestId, "confirmed");
    const result = await resultPromise;

    expect(result.fallthrough).toBe(false);
    expect(hoisted.mockWasmCreateProviderCredential).toHaveBeenCalledTimes(1);
  });

  it("decline returns { fallthrough: true } and NEVER calls wasmCreateProviderCredential or createItem (CR-03 orphan-credential fix)", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);

    const resultPromise = handleCredentialsCreate(
      { publicKey: { rp: { id: "example.com" } } },
      "https://example.com",
    );

    const payload = await awaitPendingCeremonyPayload();
    resolveProviderCredentialChoice(payload.requestId, null);
    const result = await resultPromise;

    expect(result).toEqual({ fallthrough: true });
    expect(hoisted.mockWasmCreateProviderCredential).not.toHaveBeenCalled();
    expect(hoisted.mockCreateItem).not.toHaveBeenCalled();
  });

  it("falls back to the origin host for rpId when the create request's rp.id is omitted (CR-02 parity for create())", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);

    const resultPromise = handleCredentialsCreate({ publicKey: {} }, "https://example.com");
    const payload = await awaitPendingCeremonyPayload();
    expect(payload.rpId).toBe("example.com");
    resolveProviderCredentialChoice(payload.requestId, null);
    await resultPromise;
  });
});

describe("Decision A (12-05-PLAN.md): credentials.get single-match is consent-gated end-to-end", () => {
  it("writes a get-kind consent payload with the single pre-selected candidate and awaits confirm BEFORE calling wasmGetProviderAssertion", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockGetItems.mockReturnValue([passkeyItem("pk-1", "example.com", "alice")]);
    hoisted.mockWasmGetProviderAssertion.mockReturnValue({
      credentialResponseJson: () => '{"id":"cred-pk-1"}',
      updatedEncryptedItemJson: () => undefined,
    });

    const resultPromise = handleCredentialsGet(
      { publicKey: { rpId: "example.com" } },
      "https://example.com",
    );

    const payload = await awaitPendingCeremonyPayload();
    expect(payload.kind).toBe("get");
    expect(payload.candidates).toEqual([{ itemId: "pk-1", label: "alice" }]);
    expect(payload.account).toBe("alice");
    expect(hoisted.mockWasmGetProviderAssertion).not.toHaveBeenCalled();

    resolveProviderCredentialChoice(payload.requestId, "pk-1");
    const result = await resultPromise;

    expect(result).toEqual({ fallthrough: false, credentialResponseJson: '{"id":"cred-pk-1"}' });
    expect(hoisted.mockWasmGetProviderAssertion).toHaveBeenCalledWith(
      FAKE_UK,
      expect.any(String),
      "https://example.com",
      expect.any(String),
      "pk-1",
      1,
    );
    // NordPass-style last-used tracking (quick-260717): a successful
    // credentials.get() assertion touches the chosen passkey item.
    expect(hoisted.mockTouchVaultItem).toHaveBeenCalledWith("pk-1");
  });

  it("decline returns { fallthrough: true } and NEVER calls wasmGetProviderAssertion -- no signature produced", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockGetItems.mockReturnValue([passkeyItem("pk-1", "example.com", "alice")]);

    const resultPromise = handleCredentialsGet(
      { publicKey: { rpId: "example.com" } },
      "https://example.com",
    );

    const payload = await awaitPendingCeremonyPayload();
    resolveProviderCredentialChoice(payload.requestId, null);
    const result = await resultPromise;

    expect(result).toEqual({ fallthrough: true });
    expect(hoisted.mockWasmGetProviderAssertion).not.toHaveBeenCalled();
  });

  it("persists a sign-counter mutation via updateItem when updatedEncryptedItemJson is present, only after confirm", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockGetItems.mockReturnValue([passkeyItem("pk-1", "example.com", "alice")]);
    hoisted.mockWasmGetProviderAssertion.mockReturnValue({
      credentialResponseJson: () => '{"id":"cred-pk-1"}',
      updatedEncryptedItemJson: () => combinedEncryptedItemJson(),
    });

    const resultPromise = handleCredentialsGet(
      { publicKey: { rpId: "example.com" } },
      "https://example.com",
    );
    const payload = await awaitPendingCeremonyPayload();
    resolveProviderCredentialChoice(payload.requestId, "pk-1");
    await resultPromise;

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

// Task 1 (27-06-PLAN.md, T-27-14): persistUpdatedProviderItem's
// collection-aware write-back dispatch -- see that function's own header
// comment in provider-ceremony.ts for the full crypto-boundary rationale
// (why line ~711's ephemeral matchingItemJson round trip is UNCHANGED and
// this dispatch fix belongs here instead). Behaviors 1 and 3 below are pure
// control-flow branching (personal-path byte-identical passthrough, and the
// no-cached-key fail-loud guard) -- mocked crypto is admissible evidence
// for both; the genuine collection-scoped re-encrypt round trip (behavior
// 2) is proven with REAL WASM crypto in provider-ceremony.real-wasm.test.ts.
describe("Task 1 (27-06): persistUpdatedProviderItem collection-aware dispatch", () => {
  it("behavior 1: a PERSONAL item (collectionId null) persists updatedEncryptedItemJson VERBATIM -- no decrypt/re-encrypt round trip added", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockGetItems.mockReturnValue([passkeyItem("pk-1", "example.com", "alice")]);
    hoisted.mockWasmGetProviderAssertion.mockReturnValue({
      credentialResponseJson: () => '{"id":"cred-pk-1"}',
      updatedEncryptedItemJson: () => combinedEncryptedItemJson(),
    });

    const resultPromise = handleCredentialsGet(
      { publicKey: { rpId: "example.com" } },
      "https://example.com",
    );
    const payload = await awaitPendingCeremonyPayload();
    resolveProviderCredentialChoice(payload.requestId, "pk-1");
    await resultPromise;

    await vi.waitFor(() => {
      expect(hoisted.mockUpdateItem).toHaveBeenCalled();
    });

    // No decrypt/re-encrypt round trip for a personal item.
    expect(hoisted.mockDecryptItem).not.toHaveBeenCalled();
    expect(hoisted.mockEncryptItemForCollection).not.toHaveBeenCalled();
    expect(hoisted.mockGetCollectionKey).not.toHaveBeenCalled();
    // The persisted ciphertext is updatedEncryptedItemJson VERBATIM (split,
    // never re-encrypted) -- byte-identical to this file's existing
    // personal-path test above.
    expect(hoisted.mockUpdateItem).toHaveBeenCalledWith(
      "pk-1",
      JSON.stringify((JSON.parse(combinedEncryptedItemJson()) as { enc_key: unknown }).enc_key),
      JSON.stringify((JSON.parse(combinedEncryptedItemJson()) as { enc_data: unknown }).enc_data),
      1,
    );
  });

  it("behavior 3: a COLLECTION-scoped item with NO cached Collection Key logs and returns WITHOUT persisting -- never falls back to the wrong-scoped ciphertext", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockGetItems.mockReturnValue([
      passkeyItem("pk-shared-1", "example.com", "alice", "collection-1"),
    ]);
    hoisted.mockWasmGetProviderAssertion.mockReturnValue({
      credentialResponseJson: () => '{"id":"cred-pk-shared-1"}',
      updatedEncryptedItemJson: () => combinedEncryptedItemJson(),
    });
    hoisted.mockGetCollectionKey.mockReturnValue(undefined);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const resultPromise = handleCredentialsGet(
      { publicKey: { rpId: "example.com" } },
      "https://example.com",
    );
    const payload = await awaitPendingCeremonyPayload();
    resolveProviderCredentialChoice(payload.requestId, "pk-shared-1");
    const result = await resultPromise;

    // The ceremony's own response to the page is unaffected -- only the
    // best-effort fire-and-forget persist is skipped.
    expect(result).toEqual({ fallthrough: false, credentialResponseJson: '{"id":"cred-pk-shared-1"}' });

    await vi.waitFor(() => {
      expect(hoisted.mockGetCollectionKey).toHaveBeenCalledWith("collection-1");
    });

    expect(hoisted.mockUpdateItem).not.toHaveBeenCalled();
    expect(hoisted.mockEncryptItemForCollection).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe("credentials.get (multi-match): picker flow unchanged (regression)", () => {
  it("more than one match writes a get-kind consent payload with ALL candidates; selecting one signs it", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockGetItems.mockReturnValue([
      passkeyItem("pk-1", "example.com", "alice"),
      passkeyItem("pk-2", "example.com", "bob"),
    ]);
    hoisted.mockWasmGetProviderAssertion.mockReturnValue({
      credentialResponseJson: () => '{"id":"cred-pk-2"}',
      updatedEncryptedItemJson: () => undefined,
    });

    const resultPromise = handleCredentialsGet(
      { publicKey: { rpId: "example.com" } },
      "https://example.com",
    );
    const payload = await awaitPendingCeremonyPayload();
    expect(payload.candidates).toEqual([
      { itemId: "pk-1", label: "alice" },
      { itemId: "pk-2", label: "bob" },
    ]);
    // No single pre-selected account for a multi-match payload.
    expect(payload.account).toBeUndefined();

    resolveProviderCredentialChoice(payload.requestId, "pk-2");
    const result = await resultPromise;

    expect(result).toEqual({ fallthrough: false, credentialResponseJson: '{"id":"cred-pk-2"}' });
    expect(hoisted.mockWasmGetProviderAssertion).toHaveBeenCalledWith(
      FAKE_UK,
      expect.any(String),
      "https://example.com",
      expect.any(String),
      "pk-2",
      1,
    );
  });

  it("declining a multi-match picker returns { fallthrough: true } without signing", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockGetItems.mockReturnValue([
      passkeyItem("pk-1", "example.com", "alice"),
      passkeyItem("pk-2", "example.com", "bob"),
    ]);

    const resultPromise = handleCredentialsGet(
      { publicKey: { rpId: "example.com" } },
      "https://example.com",
    );
    const payload = await awaitPendingCeremonyPayload();
    resolveProviderCredentialChoice(payload.requestId, null);
    const result = await resultPromise;

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

    const resultPromise = handleCredentialsCreate(
      { publicKey: { rp: { id: "example.com" }, extensions: { prf: {} } } },
      "https://example.com",
    );
    const payload = await awaitPendingCeremonyPayload();
    expect(payload.prfRequested).toBe(true);
    resolveProviderCredentialChoice(payload.requestId, "confirmed");
    const result = await resultPromise;

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

    const resultPromise = handleCredentialsCreate(
      { publicKey: { rp: { id: "example.com" }, extensions: { prf: {} } } },
      "https://example.com",
    );
    const payload = await awaitPendingCeremonyPayload();
    resolveProviderCredentialChoice(payload.requestId, "confirmed");
    const result = await resultPromise;

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

    const resultPromise = handleCredentialsCreate(
      { publicKey: { rp: { id: "example.com" } } },
      "https://example.com",
    );
    const payload = await awaitPendingCeremonyPayload();
    expect(payload.prfRequested).toBe(false);
    resolveProviderCredentialChoice(payload.requestId, "confirmed");
    const result = await resultPromise;

    expect(result.prfCapable).toBeUndefined();
    expect(result.prfUnavailableReason).toBeUndefined();
  });
});

describe("genuine WASM failure (not decline/no-match)", () => {
  it("credentials.create: a thrown exception from the WASM call (after confirm) is caught and converted to { fallthrough: false, failed: true }", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockWasmCreateProviderCredential.mockImplementation(() => {
      throw new Error("ceremony failed");
    });

    const resultPromise = handleCredentialsCreate(
      { publicKey: { rp: { id: "example.com" } } },
      "https://example.com",
    );
    const payload = await awaitPendingCeremonyPayload();
    resolveProviderCredentialChoice(payload.requestId, "confirmed");
    const result = await resultPromise;

    expect(result).toEqual({ fallthrough: false, failed: true });
  });

  it("credentials.get: a thrown exception from the WASM call (after confirm) is caught and converted to { fallthrough: false, failed: true }", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockGetItems.mockReturnValue([passkeyItem("pk-1", "example.com", "alice")]);
    hoisted.mockWasmGetProviderAssertion.mockImplementation(() => {
      throw new Error("ceremony failed");
    });

    const resultPromise = handleCredentialsGet(
      { publicKey: { rpId: "example.com" } },
      "https://example.com",
    );
    const payload = await awaitPendingCeremonyPayload();
    resolveProviderCredentialChoice(payload.requestId, "pk-1");
    const result = await resultPromise;

    expect(result).toEqual({ fallthrough: false, failed: true });
  });
});

describe("D-10: fresh re-check of chrome.storage.session on every invocation", () => {
  it("calls ensureHydrated at least once per handler invocation, even on a second call in the same run", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(FAKE_UK);
    hoisted.mockGetItems.mockReturnValue([]);

    // Zero matches both times -- returns before ever reaching the consent
    // gate, so no confirm/decline needs to be driven here.
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
