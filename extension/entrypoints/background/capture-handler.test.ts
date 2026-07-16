// entrypoints/background/capture-handler.test.ts — plan 11-03's required
// behaviors for the Generate & Capture background brain. Task 1 covers
// classifySubmit (pure origin/username-match classification, no I/O); Task 2
// extends this file with confirmNewLogin/confirmUpdateLogin (encrypt+persist).
// Mirrors autofill-frame.test.ts's own precedent: frame-guard.ts's real
// itemMatchesOrigin runs UNMOCKED (this suite exercises the actual
// origin-matching gate reused from frame-guard.ts, not a stand-in for it).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      id: "test-ext-id",
      getURL: (p: string) => `chrome-extension://test-ext-id/${p}`,
    },
  },
}));

import { classifySubmit } from "./capture-handler";
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
