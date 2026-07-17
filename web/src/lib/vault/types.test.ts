import { describe, expect, it } from "vitest";
import { normalizeItemFields } from "./types";

// Phase 12 cross-client fix: the web app previously had no normalization at
// all for the raw `SerializablePasskey` wire JSON (crates/pv-provider/src/
// credential_store.rs) that the passkey provider ceremony writes into a
// vault item's plaintext -- ported from extension/lib/vault/types.ts.

describe("normalizeItemFields — raw passkey wire shape", () => {
  it("recognizes the raw wire shape (no `type`, has credential_id/rp_id) and normalizes it into PasskeyFields", () => {
    // credential_id byte-array -> base64url fixture, cross-checked against a
    // plain Node Buffer computation (AQIDBAX6-_w, no padding, +/ swapped for -_).
    const raw = {
      key_cbor: [10, 20, 30],
      credential_id: [1, 2, 3, 4, 5, 250, 251, 252],
      rp_id: "example.com",
      user_handle: [9, 9, 9],
      username: "bartek",
      user_display_name: "Bartek Paczesny",
      counter: 3,
      extensions: { hmac_secret: true },
    };

    const normalized = normalizeItemFields(raw as never);

    expect(normalized).toEqual({
      type: "passkey",
      name: "bartek",
      folderId: null,
      tags: [],
      rpId: "example.com",
      credentialId: "AQIDBAX6-_w",
      username: "bartek",
      userDisplayName: "Bartek Paczesny",
      rawPasskeyJson: JSON.stringify(raw),
    });
  });

  it("falls back to rp_id for `name` when username is absent", () => {
    const raw = {
      key_cbor: [1],
      credential_id: [7, 8, 9],
      rp_id: "vault.example.org",
    };

    const normalized = normalizeItemFields(raw as never);

    expect(normalized.name).toBe("vault.example.org");
    if (normalized.type === "passkey") {
      expect(normalized.username).toBeUndefined();
      expect(normalized.userDisplayName).toBeUndefined();
    }
  });

  it("passes through an already-normalized PasskeyFields object unchanged", () => {
    const alreadyNormalized = {
      type: "passkey" as const,
      name: "bartek",
      folderId: null,
      tags: [],
      rpId: "example.com",
      credentialId: "AQIDBAX6-_w",
      username: "bartek",
      userDisplayName: "Bartek Paczesny",
      rawPasskeyJson: "{}",
    };

    const normalized = normalizeItemFields(alreadyNormalized);

    expect(normalized).toBe(alreadyNormalized);
  });

  it("still normalizes a legacy login item's bare url alongside passkey recognition", () => {
    const legacyLogin = {
      type: "login" as const,
      name: "GitHub",
      username: "octocat",
      password: "hunter2",
      url: "https://github.com",
      notes: "",
      folderId: null,
      tags: [],
    };

    const normalized = normalizeItemFields(legacyLogin as never);

    expect(normalized.type).toBe("login");
    if (normalized.type === "login") {
      expect(normalized.urls).toEqual(["https://github.com"]);
    }
  });
});
