import { describe, expect, it } from "vitest";
import { detect, mapRow } from "./lastpassCsv";

describe("lastpassCsv.detect", () => {
  it("matches when a superset header includes fav", () => {
    expect(
      detect(["url", "username", "password", "extra", "name", "grouping", "fav"]),
    ).toBe(true);
  });

  it("matches even without fav (not required)", () => {
    expect(detect(["url", "username", "password", "extra", "name", "grouping"])).toBe(true);
  });

  it("does not match when a required column is missing", () => {
    expect(detect(["url", "username", "password"])).toBe(false);
  });
});

describe("lastpassCsv.mapRow", () => {
  it("splits a row with an embedded totp into two drafts, folder = first grouping segment", () => {
    const result = mapRow({
      url: "https://x.com",
      username: "u",
      password: "p",
      totp: "JBSWY3DPEHPK3PXP",
      extra: "note text",
      name: "X",
      grouping: "Personal\\Work",
      fav: "0",
    });

    expect(result.items).toHaveLength(2);
    const [loginDraft, totpDraft] = result.items;
    expect(loginDraft).toMatchObject({
      type: "login",
      name: "X",
      folder: "Personal",
      notes: "note text",
    });
    expect(totpDraft).toMatchObject({ type: "totp", secret: "JBSWY3DPEHPK3PXP", folder: "Personal" });
  });

  it("does not split when totp is empty", () => {
    const result = mapRow({
      url: "https://x.com",
      username: "u",
      password: "p",
      totp: "",
      extra: "",
      name: "X",
      grouping: "",
      fav: "0",
    });
    expect(result.items).toHaveLength(1);
  });

  it("returns a missingField skip for a row with no name", () => {
    const result = mapRow({
      url: "",
      username: "",
      password: "",
      totp: "",
      extra: "",
      name: "",
      grouping: "",
      fav: "0",
    });
    expect(result).toEqual({ items: [], skipped: "missingField" });
  });
});
