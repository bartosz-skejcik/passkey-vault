import { describe, expect, it } from "vitest";
import { buildJsonExport } from "./toJson";
import type { LoginFields, TotpFields, VaultItem } from "@/lib/vault/types";

describe("buildJsonExport", () => {
  it("returns a JSON string with exportedAt, items' fields, and folders", () => {
    const loginItem: VaultItem = {
      id: "1",
      revision: 1,
      fields: {
        type: "login",
        name: "GitHub",
        username: "me",
        password: "pw",
        urls: ["https://github.com"],
        notes: "",
        folderId: "f1",
        tags: [],
      } satisfies LoginFields,
    };
    const totpItem: VaultItem = {
      id: "2",
      revision: 1,
      fields: {
        type: "totp",
        name: "GitHub TOTP",
        secret: "JBSWY3DPEHPK3PXP",
        issuer: "GitHub",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        notes: "",
        folderId: null,
        tags: [],
      } satisfies TotpFields,
    };

    const result = buildJsonExport([loginItem, totpItem], [{ id: "f1", name: "Work" }]);
    const parsed = JSON.parse(result) as {
      exportedAt: string;
      items: unknown[];
      folders: { id: string; name: string }[];
    };

    expect(typeof parsed.exportedAt).toBe("string");
    expect(() => new Date(parsed.exportedAt).toISOString()).not.toThrow();
    expect(parsed.items).toEqual([loginItem.fields, totpItem.fields]);
    expect(parsed.folders).toEqual([{ id: "f1", name: "Work" }]);
  });

  it("returns an empty items/folders shape for an empty vault", () => {
    const result = buildJsonExport([], []);
    const parsed = JSON.parse(result) as { items: unknown[]; folders: unknown[] };
    expect(parsed.items).toEqual([]);
    expect(parsed.folders).toEqual([]);
  });
});
