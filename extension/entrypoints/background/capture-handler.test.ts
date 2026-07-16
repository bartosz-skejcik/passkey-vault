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
} from "./capture-handler";
import { RevisionConflictError } from "./vault-store";
import type { VaultItem } from "../../lib/vault/types";

function loginItem(id: string, urls: string[], username: string, password: string): VaultItem {
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
});
