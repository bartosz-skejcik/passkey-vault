// entrypoints/background/credential-store.test.ts — Plan 12-02 Task 1's
// required behavior: findMatchingPasskeyItems filters the already-decrypted
// item cache by rpId, over a fixture with 2 passkey items (different RPs)
// + 1 login item.
import { describe, expect, it } from "vitest";
import { findMatchingPasskeyItems } from "./credential-store";
import type { VaultItem } from "../../lib/vault/types";

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

function loginItem(id: string): VaultItem {
  return {
    id,
    revision: 1,
    fields: {
      type: "login",
      name: "Some login",
      folderId: null,
      tags: [],
      username: "user@example.com",
      password: "hunter2",
      urls: ["https://example.com"],
      notes: "",
    },
  };
}

describe("findMatchingPasskeyItems", () => {
  it("returns only the passkey item(s) matching the requested rpId, excluding non-passkey items and other RPs", () => {
    const items: VaultItem[] = [
      passkeyItem("pk-1", "example.com", "alice@example.com"),
      passkeyItem("pk-2", "other.example", "bob@other.example"),
      loginItem("login-1"),
    ];

    const result = findMatchingPasskeyItems(items, "example.com");

    expect(result).toHaveLength(1);
    expect(result[0].item.id).toBe("pk-1");
    expect(result[0].fields.rpId).toBe("example.com");
    expect(result[0].fields.username).toBe("alice@example.com");
  });

  it("returns an empty array when no passkey item matches the rpId", () => {
    const items: VaultItem[] = [
      passkeyItem("pk-1", "example.com", "alice@example.com"),
      loginItem("login-1"),
    ];

    expect(findMatchingPasskeyItems(items, "no-match.example")).toEqual([]);
  });

  it("returns all matches when multiple passkey items share the same rpId (multi-account case)", () => {
    const items: VaultItem[] = [
      passkeyItem("pk-1", "example.com", "alice@example.com"),
      passkeyItem("pk-2", "example.com", "bob@example.com"),
      loginItem("login-1"),
    ];

    const result = findMatchingPasskeyItems(items, "example.com");

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.item.id).sort()).toEqual(["pk-1", "pk-2"]);
  });
});
