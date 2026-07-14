import { describe, expect, it } from "vitest";
import { GENERIC_TARGET_FIELDS, mapRowGeneric, type GenericFieldMapping } from "./genericMapping";

const emptyMapping: GenericFieldMapping = {
  name: "",
  username: "",
  password: "",
  urls: "",
  notes: "",
  secret: "",
  folder: "",
  tags: "",
};

describe("GENERIC_TARGET_FIELDS", () => {
  it("lists the manual-mapping UI's target fields", () => {
    expect(GENERIC_TARGET_FIELDS).toEqual([
      "name",
      "username",
      "password",
      "urls",
      "notes",
      "secret",
      "folder",
      "tags",
    ]);
  });
});

describe("mapRowGeneric", () => {
  it("maps a row using a partial mapping, defaulting unmapped fields", () => {
    const result = mapRowGeneric(
      { colA: "GitHub", colB: "bartek" },
      { ...emptyMapping, name: "colA", username: "colB" },
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      type: "login",
      name: "GitHub",
      username: "bartek",
      password: "",
      urls: [],
      notes: "",
      folder: "",
      tags: [],
    });
  });

  it("returns a missingField skip when the mapped name column is absent from the row", () => {
    const result = mapRowGeneric({ colA: "GitHub" }, { ...emptyMapping, name: "colZ" });
    expect(result).toEqual({ items: [], skipped: "missingField" });
  });

  it("returns a missingField skip when name is not mapped at all", () => {
    const result = mapRowGeneric({ colA: "GitHub" }, emptyMapping);
    expect(result).toEqual({ items: [], skipped: "missingField" });
  });

  it("splits comma-separated urls/tags columns into arrays", () => {
    const result = mapRowGeneric(
      { n: "X", u: "https://a.com, https://b.com", t: "work, personal" },
      { ...emptyMapping, name: "n", urls: "u", tags: "t" },
    );
    expect(result.items[0]).toMatchObject({
      urls: ["https://a.com", "https://b.com"],
      tags: ["work", "personal"],
    });
  });

  it("splits out a totp draft when secret is mapped and present", () => {
    const result = mapRowGeneric(
      { n: "X", s: "JBSWY3DPEHPK3PXP" },
      { ...emptyMapping, name: "n", secret: "s" },
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[1]).toMatchObject({ type: "totp", secret: "JBSWY3DPEHPK3PXP" });
  });
});
