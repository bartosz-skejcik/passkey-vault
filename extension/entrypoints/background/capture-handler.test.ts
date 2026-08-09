// entrypoints/background/capture-handler.test.ts — plan 11-03's required
// behaviors for the Generate & Capture background brain. Task 1 covers
// classifySubmit (pure origin/username-match classification, no I/O); Task 2
// extends this file with confirmNewLogin/confirmUpdateLogin (encrypt+persist).
// Mirrors autofill-frame.test.ts's own precedent: frame-guard.ts's real
// itemMatchesOrigin runs UNMOCKED (this suite exercises the actual
// origin-matching gate reused from frame-guard.ts, not a stand-in for it).
// Only vault-session (ensureHydrated), the wasm-loader crypto choke-point
// (encryptItem), and vault-api's createItem/updateItem are mocked -- these
// touch chrome.storage.session / the WASM instance / the network, which
// this suite has no interest in exercising for real.
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  mockEnsureHydrated: vi.fn(),
  mockEncryptItem: vi.fn(),
  mockEncryptItemForCollection: vi.fn(),
  mockGetCollectionKey: vi.fn(),
  mockCreateItem: vi.fn(),
  mockUpdateItem: vi.fn(),
  mockGetItems: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      id: "test-ext-id",
      getURL: (p: string) => `chrome-extension://test-ext-id/${p}`,
    },
  },
}));

vi.mock("./vault-session", () => ({
  ensureHydrated: hoisted.mockEnsureHydrated,
}));

vi.mock("../../lib/crypto/wasm-loader", () => ({
  encryptItem: hoisted.mockEncryptItem,
  encryptItemForCollection: hoisted.mockEncryptItemForCollection,
}));

vi.mock("./collections-store", () => ({
  getCollectionKey: hoisted.mockGetCollectionKey,
}));

vi.mock("./vault-api", () => ({
  createItem: hoisted.mockCreateItem,
  updateItem: hoisted.mockUpdateItem,
}));

// vault-store.ts's module-level side effect (subscribeSessionLockState at
// import time, wired to sync-client/vault-session/browser.runtime) has
// nothing to do with what this suite exercises (splitCombinedEncryptedItem/
// RevisionConflictError/isConflictError are pure). Mocked here with real
// re-implementations of just those three exports so importing the module
// for real (and dragging in its transitive sync-client/vault-session/wasm
// import graph, which errors on a checkout with no built WASM artifact) is
// never necessary -- mirrors generate-handler.test.ts's own precedent of
// mocking a sibling module purely to cut off an unrelated eager import.
vi.mock("./vault-store", () => ({
  splitCombinedEncryptedItem: (combinedJson: string) => {
    const combined = JSON.parse(combinedJson) as { enc_key: unknown; enc_data: unknown };
    return {
      encKey: JSON.stringify(combined.enc_key),
      encData: JSON.stringify(combined.enc_data),
    };
  },
  RevisionConflictError: class RevisionConflictError extends Error {
    constructor() {
      super("item revision changed elsewhere — refresh and try again");
      this.name = "RevisionConflictError";
    }
  },
  isConflictError: (err: unknown) =>
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: unknown }).status === 409,
  getItems: hoisted.mockGetItems,
}));

import {
  classifySubmit,
  confirmNewLogin,
  confirmUpdateLogin,
  LockedVaultError,
  OwnershipMismatchError,
  ReadOnlyAccessError,
  CollectionKeyUnavailableError,
  DirectShareNotEditableError,
} from "./capture-handler";
import { RevisionConflictError } from "./vault-store";
import type { VaultItem } from "../../lib/vault/types";

function loginItem(
  id: string,
  urls: string[],
  username: string,
  password: string,
  // 28-01-PLAN.md Task 2: `sharedToMe` added alongside the existing
  // `collectionId`/`accessLevel` optional fields, same pattern
  // provider-ceremony.test.ts's own `passkeyItem()` helper follows for its
  // sibling addition (Task 3).
  scope?: { collectionId: string | null; accessLevel?: string; sharedToMe?: boolean },
): VaultItem {
  return {
    id,
    revision: 1,
    fields: {
      type: "login",
      name: `Login ${id}`,
      folderId: null,
      tags: [],
      username,
      password,
      urls,
      notes: "",
    },
    ...(scope !== undefined
      ? { collectionId: scope.collectionId, accessLevel: scope.accessLevel, sharedToMe: scope.sharedToMe }
      : {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("classifySubmit", () => {
  it("returns 'new' when no login item matches origin+username", () => {
    const result = classifySubmit(
      { frameOrigin: "https://a.example", username: "user@example.com", password: "pw1" },
      [loginItem("item-1", ["https://a.example/login"], "someone-else@example.com", "pw1")],
      "https://a.example",
    );

    expect(result.action).toBe("new");
  });

  it("returns 'update' with itemId/currentRevision when a match exists with a differing password", () => {
    const item = loginItem("item-1", ["https://a.example/login"], "user@example.com", "old-pw");
    const result = classifySubmit(
      { frameOrigin: "https://a.example", username: "user@example.com", password: "new-pw" },
      [item],
      "https://a.example",
    );

    expect(result.action).toBe("update");
    if (result.action === "update") {
      expect(result.itemId).toBe("item-1");
      expect(result.currentRevision).toBe(1);
    }
  });

  it("returns 'no-op' when a match exists with an identical password (Pitfall B — never offer update for an unchanged resubmit)", () => {
    const item = loginItem("item-1", ["https://a.example/login"], "user@example.com", "same-pw");
    const result = classifySubmit(
      { frameOrigin: "https://a.example", username: "user@example.com", password: "same-pw" },
      [item],
      "https://a.example",
    );

    expect(result.action).toBe("no-op");
  });

  it("sets mismatch:true on the 'new' branch when frameOrigin !== senderTopOrigin", () => {
    const result = classifySubmit(
      { frameOrigin: "https://iframe.example", username: "user@example.com", password: "pw1" },
      [],
      "https://top.example",
    );

    expect(result.action).toBe("new");
    expect(result.mismatch).toBe(true);
    expect(result.frameOrigin).toBe("https://iframe.example");
    expect(result.topOrigin).toBe("https://top.example");
  });

  it("sets mismatch:true on the 'update' branch when frameOrigin !== senderTopOrigin", () => {
    const item = loginItem("item-1", ["https://a.example/login"], "user@example.com", "old-pw");
    const result = classifySubmit(
      { frameOrigin: "https://a.example", username: "user@example.com", password: "new-pw" },
      [item],
      "https://top.example",
    );

    expect(result.action).toBe("update");
    expect(result.mismatch).toBe(true);
  });

  it("sets mismatch:true on the 'no-op' branch when frameOrigin !== senderTopOrigin", () => {
    const item = loginItem("item-1", ["https://a.example/login"], "user@example.com", "same-pw");
    const result = classifySubmit(
      { frameOrigin: "https://a.example", username: "user@example.com", password: "same-pw" },
      [item],
      "https://top.example",
    );

    expect(result.action).toBe("no-op");
    expect(result.mismatch).toBe(true);
  });

  it("sets mismatch:false when frameOrigin === senderTopOrigin", () => {
    const result = classifySubmit(
      { frameOrigin: "https://a.example", username: "user@example.com", password: "pw1" },
      [],
      "https://a.example",
    );

    expect(result.mismatch).toBe(false);
  });

  it("never matches an item bound to a different origin, even with the same username (reuses itemMatchesOrigin's exact-origin gate)", () => {
    const item = loginItem("item-1", ["https://other.example/login"], "user@example.com", "pw1");
    const result = classifySubmit(
      { frameOrigin: "https://a.example", username: "user@example.com", password: "pw1" },
      [item],
      "https://a.example",
    );

    expect(result.action).toBe("new");
  });

  it("ignores non-login items entirely", () => {
    const noteItem: VaultItem = {
      id: "note-1",
      revision: 1,
      fields: { type: "note", name: "Note", folderId: null, tags: [], body: "hi" },
    };
    const result = classifySubmit(
      { frameOrigin: "https://a.example", username: "user@example.com", password: "pw1" },
      [noteItem],
      "https://a.example",
    );

    expect(result.action).toBe("new");
  });

  // 28-01-PLAN.md Task 1/2 (B-4/B-10): blockedReason -- the SAME two
  // conditions confirmUpdateLogin's gate enforces, computed here purely for
  // the toast's proactive announcement.
  it("sets blockedReason:'direct-share' on the 'update' branch for a sharedToMe match, regardless of accessLevel", () => {
    const item = loginItem("item-1", ["https://a.example/login"], "user@example.com", "old-pw", {
      collectionId: null,
      sharedToMe: true,
    });
    const result = classifySubmit(
      { frameOrigin: "https://a.example", username: "user@example.com", password: "new-pw" },
      [item],
      "https://a.example",
    );

    expect(result.action).toBe("update");
    if (result.action === "update") {
      expect(result.blockedReason).toBe("direct-share");
    }
  });

  it("sets blockedReason:'no-edit-access' on the 'update' branch for a collection-scoped match with accessLevel 'read'", () => {
    const item = loginItem("item-1", ["https://a.example/login"], "user@example.com", "old-pw", {
      collectionId: "col-1",
      accessLevel: "read",
    });
    const result = classifySubmit(
      { frameOrigin: "https://a.example", username: "user@example.com", password: "new-pw" },
      [item],
      "https://a.example",
    );

    expect(result.action).toBe("update");
    if (result.action === "update") {
      expect(result.blockedReason).toBe("no-edit-access");
    }
  });

  it("sets blockedReason:'no-edit-access' on the 'update' branch for a collection-scoped match with accessLevel 'hidden_password' (B-10 -- no exception)", () => {
    const item = loginItem("item-1", ["https://a.example/login"], "user@example.com", "old-pw", {
      collectionId: "col-1",
      accessLevel: "hidden_password",
    });
    const result = classifySubmit(
      { frameOrigin: "https://a.example", username: "user@example.com", password: "new-pw" },
      [item],
      "https://a.example",
    );

    expect(result.action).toBe("update");
    if (result.action === "update") {
      expect(result.blockedReason).toBe("no-edit-access");
    }
  });

  it("leaves blockedReason undefined on the 'update' branch for a personal match (collectionId absent)", () => {
    const item = loginItem("item-1", ["https://a.example/login"], "user@example.com", "old-pw");
    const result = classifySubmit(
      { frameOrigin: "https://a.example", username: "user@example.com", password: "new-pw" },
      [item],
      "https://a.example",
    );

    expect(result.action).toBe("update");
    if (result.action === "update") {
      expect(result.blockedReason).toBeUndefined();
    }
  });

  it("leaves blockedReason undefined on the 'update' branch for a collection-scoped match with accessLevel 'edit'", () => {
    const item = loginItem("item-1", ["https://a.example/login"], "user@example.com", "old-pw", {
      collectionId: "col-1",
      accessLevel: "edit",
    });
    const result = classifySubmit(
      { frameOrigin: "https://a.example", username: "user@example.com", password: "new-pw" },
      [item],
      "https://a.example",
    );

    expect(result.action).toBe("update");
    if (result.action === "update") {
      expect(result.blockedReason).toBeUndefined();
    }
  });
});

describe("confirmNewLogin", () => {
  it("persists via encryptItem -> splitCombinedEncryptedItem -> createItem and returns revision 1", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockEncryptItem.mockReturnValue(
      JSON.stringify({ enc_key: { a: 1 }, enc_data: { b: 2 } }),
    );
    hoisted.mockCreateItem.mockResolvedValue({
      id: "new-id",
      revision: 1,
      updated_at: "2026-01-01T00:00:00Z",
    });

    const result = await confirmNewLogin({
      frameOrigin: "https://a.example",
      username: "user@example.com",
      password: "pw1",
    });

    expect(result.revision).toBe(1);
    expect(hoisted.mockCreateItem).toHaveBeenCalledTimes(1);
    const [, encKey, encData] = hoisted.mockCreateItem.mock.calls[0] as [string, string, string];
    expect(JSON.parse(encKey)).toEqual({ a: 1 });
    expect(JSON.parse(encData)).toEqual({ b: 2 });
  });

  it("throws LockedVaultError when ensureHydrated() resolves null (simulated idle-kill), never calling encryptItem", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(null);

    await expect(
      confirmNewLogin({
        frameOrigin: "https://a.example",
        username: "user@example.com",
        password: "pw1",
      }),
    ).rejects.toThrow(LockedVaultError);
    expect(hoisted.mockEncryptItem).not.toHaveBeenCalled();
    expect(hoisted.mockCreateItem).not.toHaveBeenCalled();
  });
});

describe("confirmUpdateLogin", () => {
  it("persists at currentRevision + 1 via updateItem when the target item origin/username-matches (WR-04 re-check)", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockGetItems.mockReturnValue([
      loginItem("item-1", ["https://a.example/login"], "user@example.com", "old-pw"),
    ]);
    hoisted.mockEncryptItem.mockReturnValue(
      JSON.stringify({ enc_key: { a: 1 }, enc_data: { b: 2 } }),
    );
    hoisted.mockUpdateItem.mockResolvedValue({ revision: 3, updated_at: "2026-01-01T00:00:00Z" });

    const result = await confirmUpdateLogin(
      "item-1",
      { frameOrigin: "https://a.example", username: "user@example.com", password: "pw2" },
      2,
    );

    expect(result.revision).toBe(3);
    expect(hoisted.mockUpdateItem).toHaveBeenCalledWith(
      "item-1",
      expect.any(String),
      expect.any(String),
      2,
    );
  });

  it("a 409 from updateItem throws RevisionConflictError instead of silently overwriting", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockGetItems.mockReturnValue([
      loginItem("item-1", ["https://a.example/login"], "user@example.com", "old-pw"),
    ]);
    hoisted.mockEncryptItem.mockReturnValue(
      JSON.stringify({ enc_key: { a: 1 }, enc_data: { b: 2 } }),
    );
    hoisted.mockUpdateItem.mockRejectedValue({ status: 409 });

    await expect(
      confirmUpdateLogin(
        "item-1",
        { frameOrigin: "https://a.example", username: "user@example.com", password: "pw2" },
        2,
      ),
    ).rejects.toThrow(RevisionConflictError);
  });

  it("throws LockedVaultError when ensureHydrated() resolves null, never calling updateItem", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(null);

    await expect(
      confirmUpdateLogin(
        "item-1",
        { frameOrigin: "https://a.example", username: "user@example.com", password: "pw2" },
        2,
      ),
    ).rejects.toThrow(LockedVaultError);
    expect(hoisted.mockUpdateItem).not.toHaveBeenCalled();
  });

  it("WR-04: throws OwnershipMismatchError -- never calling updateItem -- when itemId doesn't exist in the current cache", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockGetItems.mockReturnValue([]);

    await expect(
      confirmUpdateLogin(
        "item-1",
        { frameOrigin: "https://a.example", username: "user@example.com", password: "pw2" },
        2,
      ),
    ).rejects.toThrow(OwnershipMismatchError);
    expect(hoisted.mockUpdateItem).not.toHaveBeenCalled();
  });

  it("WR-04: throws OwnershipMismatchError when itemId exists but belongs to a DIFFERENT origin (itemId round-tripped through an untrusted closure)", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockGetItems.mockReturnValue([
      loginItem("item-1", ["https://other.example/login"], "user@example.com", "old-pw"),
    ]);

    await expect(
      confirmUpdateLogin(
        "item-1",
        { frameOrigin: "https://a.example", username: "user@example.com", password: "pw2" },
        2,
      ),
    ).rejects.toThrow(OwnershipMismatchError);
    expect(hoisted.mockUpdateItem).not.toHaveBeenCalled();
  });

  it("WR-04: throws OwnershipMismatchError when itemId exists at the right origin but a DIFFERENT username", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockGetItems.mockReturnValue([
      loginItem("item-1", ["https://a.example/login"], "someone-else@example.com", "old-pw"),
    ]);

    await expect(
      confirmUpdateLogin(
        "item-1",
        { frameOrigin: "https://a.example", username: "user@example.com", password: "pw2" },
        2,
      ),
    ).rejects.toThrow(OwnershipMismatchError);
    expect(hoisted.mockUpdateItem).not.toHaveBeenCalled();
  });

  it("WR-04: throws OwnershipMismatchError when itemId belongs to a non-login item", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockGetItems.mockReturnValue([
      { id: "item-1", revision: 1, fields: { type: "note", name: "Note", folderId: null, tags: [], body: "hi" } },
    ]);

    await expect(
      confirmUpdateLogin(
        "item-1",
        { frameOrigin: "https://a.example", username: "user@example.com", password: "pw2" },
        2,
      ),
    ).rejects.toThrow(OwnershipMismatchError);
    expect(hoisted.mockUpdateItem).not.toHaveBeenCalled();
  });

  // 27-07-PLAN.md Task 1: collection-aware encrypt dispatch + read-only
  // refusal gate.
  it("updating a PERSONAL item (collectionId absent/null) is byte-identical to today's behavior -- encryptItem unchanged", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockGetItems.mockReturnValue([
      loginItem("item-1", ["https://a.example/login"], "user@example.com", "old-pw"),
    ]);
    hoisted.mockEncryptItem.mockReturnValue(
      JSON.stringify({ enc_key: { a: 1 }, enc_data: { b: 2 } }),
    );
    hoisted.mockUpdateItem.mockResolvedValue({ revision: 3, updated_at: "2026-01-01T00:00:00Z" });

    const result = await confirmUpdateLogin(
      "item-1",
      { frameOrigin: "https://a.example", username: "user@example.com", password: "pw2" },
      2,
    );

    expect(result.revision).toBe(3);
    expect(hoisted.mockEncryptItem).toHaveBeenCalledTimes(1);
    expect(hoisted.mockEncryptItemForCollection).not.toHaveBeenCalled();
    expect(hoisted.mockGetCollectionKey).not.toHaveBeenCalled();
  });

  it("updating a COLLECTION-scoped item with 'edit' access encrypts via encryptItemForCollection using the cached Collection Key, never encryptItem", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockGetItems.mockReturnValue([
      loginItem("item-1", ["https://a.example/login"], "user@example.com", "old-pw", {
        collectionId: "col-1",
        accessLevel: "edit",
      }),
    ]);
    hoisted.mockGetCollectionKey.mockReturnValue("fake-collection-key");
    hoisted.mockEncryptItemForCollection.mockReturnValue(
      JSON.stringify({ enc_key: { a: 1 }, enc_data: { b: 2 } }),
    );
    hoisted.mockUpdateItem.mockResolvedValue({ revision: 3, updated_at: "2026-01-01T00:00:00Z" });

    const result = await confirmUpdateLogin(
      "item-1",
      { frameOrigin: "https://a.example", username: "user@example.com", password: "pw2" },
      2,
    );

    expect(result.revision).toBe(3);
    expect(hoisted.mockGetCollectionKey).toHaveBeenCalledWith("col-1");
    expect(hoisted.mockEncryptItemForCollection).toHaveBeenCalledWith(
      "fake-collection-key",
      expect.any(String),
      "col-1",
      "item-1",
      3,
    );
    expect(hoisted.mockEncryptItem).not.toHaveBeenCalled();
  });

  // 28-01-PLAN.md Task 2 (B-10): REPLACES the pre-28-01 test that asserted
  // this case succeeds -- the server's RequireEdit::satisfied_by is an
  // exact match on Edit and structurally excludes hidden_password, so the
  // extension must refuse here too, mirroring web's own canEditItem.
  it("updating a COLLECTION-scoped item with 'hidden_password' access throws ReadOnlyAccessError BEFORE any encrypt call (B-10 -- no exception)", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockGetItems.mockReturnValue([
      loginItem("item-1", ["https://a.example/login"], "user@example.com", "old-pw", {
        collectionId: "col-1",
        accessLevel: "hidden_password",
      }),
    ]);

    await expect(
      confirmUpdateLogin(
        "item-1",
        { frameOrigin: "https://a.example", username: "user@example.com", password: "pw2" },
        2,
      ),
    ).rejects.toThrow(ReadOnlyAccessError);
    expect(hoisted.mockEncryptItem).not.toHaveBeenCalled();
    expect(hoisted.mockEncryptItemForCollection).not.toHaveBeenCalled();
    expect(hoisted.mockUpdateItem).not.toHaveBeenCalled();
  });

  // 28-01-PLAN.md Task 1/2 (B-4/B-5, closes v0.4 audit Blocker 2): the
  // control proving `sharedToMe` refuses unconditionally, even at
  // `hidden_password` -- a direct share is never eligible for a write,
  // regardless of accessLevel, since there is no encrypt-as-recipient
  // primitive.
  it("updating a DIRECT-shared item (sharedToMe:true) at 'hidden_password' throws DirectShareNotEditableError BEFORE any encrypt call", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockGetItems.mockReturnValue([
      loginItem("item-1", ["https://a.example/login"], "user@example.com", "old-pw", {
        collectionId: null,
        accessLevel: "hidden_password",
        sharedToMe: true,
      }),
    ]);

    await expect(
      confirmUpdateLogin(
        "item-1",
        { frameOrigin: "https://a.example", username: "user@example.com", password: "pw2" },
        2,
      ),
    ).rejects.toThrow(DirectShareNotEditableError);
    expect(hoisted.mockEncryptItem).not.toHaveBeenCalled();
    expect(hoisted.mockEncryptItemForCollection).not.toHaveBeenCalled();
    expect(hoisted.mockUpdateItem).not.toHaveBeenCalled();
  });

  // The sharedToMe gate must win even when accessLevel:"edit" is also set
  // (a direct share carries no accessLevel from the server today, but the
  // gate must not rely on that -- sharedToMe alone is authoritative).
  it("updating a DIRECT-shared item (sharedToMe:true) refuses even when accessLevel is 'edit'", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockGetItems.mockReturnValue([
      loginItem("item-1", ["https://a.example/login"], "user@example.com", "old-pw", {
        collectionId: null,
        accessLevel: "edit",
        sharedToMe: true,
      }),
    ]);

    await expect(
      confirmUpdateLogin(
        "item-1",
        { frameOrigin: "https://a.example", username: "user@example.com", password: "pw2" },
        2,
      ),
    ).rejects.toThrow(DirectShareNotEditableError);
    expect(hoisted.mockEncryptItem).not.toHaveBeenCalled();
    expect(hoisted.mockEncryptItemForCollection).not.toHaveBeenCalled();
  });

  it("updating a COLLECTION-scoped item with 'read' access throws ReadOnlyAccessError BEFORE any encrypt call", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockGetItems.mockReturnValue([
      loginItem("item-1", ["https://a.example/login"], "user@example.com", "old-pw", {
        collectionId: "col-1",
        accessLevel: "read",
      }),
    ]);

    await expect(
      confirmUpdateLogin(
        "item-1",
        { frameOrigin: "https://a.example", username: "user@example.com", password: "pw2" },
        2,
      ),
    ).rejects.toThrow(ReadOnlyAccessError);
    expect(hoisted.mockEncryptItem).not.toHaveBeenCalled();
    expect(hoisted.mockEncryptItemForCollection).not.toHaveBeenCalled();
    expect(hoisted.mockUpdateItem).not.toHaveBeenCalled();
  });

  it("updating a COLLECTION-scoped item with an unrecognized accessLevel fails closed, throwing ReadOnlyAccessError before any encrypt call", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockGetItems.mockReturnValue([
      loginItem("item-1", ["https://a.example/login"], "user@example.com", "old-pw", {
        collectionId: "col-1",
        accessLevel: "something-unrecognized",
      }),
    ]);

    await expect(
      confirmUpdateLogin(
        "item-1",
        { frameOrigin: "https://a.example", username: "user@example.com", password: "pw2" },
        2,
      ),
    ).rejects.toThrow(ReadOnlyAccessError);
    expect(hoisted.mockEncryptItem).not.toHaveBeenCalled();
    expect(hoisted.mockEncryptItemForCollection).not.toHaveBeenCalled();
  });

  it("updating a COLLECTION-scoped item whose Collection Key is not yet cached throws CollectionKeyUnavailableError, never falling back to encryptItem", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockGetItems.mockReturnValue([
      loginItem("item-1", ["https://a.example/login"], "user@example.com", "old-pw", {
        collectionId: "col-1",
        accessLevel: "edit",
      }),
    ]);
    hoisted.mockGetCollectionKey.mockReturnValue(undefined);

    await expect(
      confirmUpdateLogin(
        "item-1",
        { frameOrigin: "https://a.example", username: "user@example.com", password: "pw2" },
        2,
      ),
    ).rejects.toThrow(CollectionKeyUnavailableError);
    expect(hoisted.mockEncryptItem).not.toHaveBeenCalled();
    expect(hoisted.mockEncryptItemForCollection).not.toHaveBeenCalled();
    expect(hoisted.mockUpdateItem).not.toHaveBeenCalled();
  });
});
