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

  // Regression: .planning/debug/rekey-order-dependent-hang.md.
  // Decrypted plaintext is UNTRUSTED INPUT -- a collection-scoped item is
  // authored by a FELLOW MEMBER's client, possibly a different platform or
  // version. A plaintext with no `tags` key used to flow through untouched,
  // and store.ts's `recomputeAllTags()` (`for (const tag of
  // item.fields.tags)`) then threw `TypeError: fields.tags is not iterable`
  // on EVERY store mutation -- create, update, delete and sync merge alike --
  // permanently wedging the account with no UI path left to remove the row.
  describe("CommonFields.tags invariant (untrusted-plaintext hardening)", () => {
    // Boundary neighbors around the defect's equivalence class: absent,
    // explicitly null/undefined, and the wrong scalar type all have to land
    // on an iterable array, not just the one shape the live bug produced.
    it.each([
      ["absent entirely (the shape the live e2e defect produced)", {}],
      ["explicitly undefined", { tags: undefined }],
      ["explicitly null", { tags: null }],
      ["a non-array scalar", { tags: "work" }],
    ])("defaults tags to [] when it is %s", (_label, tagsPart) => {
      const raw = {
        type: "login" as const,
        name: "PV E2E Post-Rekey Real Item",
        password: "irrelevant-e2e-pw",
        ...tagsPart,
      };

      const normalized = normalizeItemFields(raw as never);

      expect(normalized.tags).toEqual([]);
      // The real assertion is not the value but the INVARIANT the crashing
      // call site depends on: it must be iterable.
      expect(() => [...normalized.tags]).not.toThrow();
    });

    it("preserves a genuine tags array rather than clobbering it", () => {
      const raw = {
        type: "note" as const,
        name: "n",
        body: "b",
        folderId: null,
        tags: ["work", "personal"],
      };

      expect(normalizeItemFields(raw as never).tags).toEqual(["work", "personal"]);
    });

    it("holds for every non-login item type, not just the one that regressed", () => {
      for (const type of ["note", "card", "identity", "totp"] as const) {
        const normalized = normalizeItemFields({ type, name: "x" } as never);
        expect(() => [...normalized.tags], `${type} must expose an iterable tags`).not.toThrow();
      }
    });
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
