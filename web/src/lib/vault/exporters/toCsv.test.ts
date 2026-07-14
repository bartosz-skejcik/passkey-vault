import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { buildCsvExport, EXPORT_COLUMNS } from "./toCsv";
import type { LoginFields, VaultItem } from "@/lib/vault/types";

describe("buildCsvExport", () => {
  it("produces the exact locked column set in order, with folder resolved to name and tags joined", () => {
    const loginItem: VaultItem = {
      id: "1",
      revision: 1,
      fields: {
        type: "login",
        name: "GitHub",
        username: "me",
        password: "pw",
        urls: ["https://github.com", "https://github.com/login"],
        notes: "a note",
        folderId: "f1",
        tags: ["dev", "personal"],
      } satisfies LoginFields,
    };

    const csv = buildCsvExport([loginItem], [{ id: "f1", name: "Work" }]);
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });

    expect(parsed.meta.fields).toEqual([...EXPORT_COLUMNS]);
    const row = parsed.data[0];
    expect(row.name).toBe("GitHub");
    expect(row.type).toBe("login");
    expect(row.username).toBe("me");
    expect(row.password).toBe("pw");
    expect(row.urls).toBe("https://github.com; https://github.com/login");
    expect(row.notes).toBe("a note");
    expect(row.folder).toBe("Work");
    expect(row.tags).toBe("dev, personal");
    // Card/identity/totp-only columns stay blank for a login row.
    expect(row.cardholderName).toBe("");
    expect(row.number).toBe("");
    expect(row.firstName).toBe("");
    expect(row.secret).toBe("");
  });

  it("resolves an unset folderId to a blank folder cell", () => {
    const item: VaultItem = {
      id: "1",
      revision: 1,
      fields: {
        type: "login",
        name: "X",
        username: "",
        password: "",
        urls: [],
        notes: "",
        folderId: null,
        tags: [],
      } satisfies LoginFields,
    };

    const csv = buildCsvExport([item], []);
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
    expect(parsed.data[0].folder).toBe("");
  });
});
