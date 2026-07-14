import { describe, expect, it } from "vitest";
import { detect, mapRow } from "./keepassCsv";

describe("keepassCsv.detect", () => {
  it("matches stock KeePass's capitalized header", () => {
    expect(detect(["Group", "Title", "Username", "Password", "URL", "Notes"])).toBe(true);
  });

  it("matches KeePassXC's lowercase header with an extra TOTP column", () => {
    expect(
      detect(["group", "title", "username", "password", "url", "notes", "totp"]),
    ).toBe(true);
  });

  it("does not match when a required column is missing", () => {
    expect(detect(["Title", "Username", "Password"])).toBe(false);
  });

  it("does not match an empty header array", () => {
    expect(detect([])).toBe(false);
  });
});

describe("keepassCsv.mapRow", () => {
  it("splits a KeePassXC row with a TOTP column into two drafts", () => {
    const result = mapRow({
      Group: "",
      Title: "X",
      Username: "u",
      Password: "p",
      URL: "",
      Notes: "",
      TOTP: "JBSWY3DPEHPK3PXP",
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[1]).toMatchObject({ type: "totp", secret: "JBSWY3DPEHPK3PXP" });
  });

  it("maps a stock-KeePass row with no TOTP column to a single draft, no error, no skip", () => {
    const result = mapRow({
      Group: "",
      Title: "X",
      Username: "u",
      Password: "p",
      URL: "",
      Notes: "",
    });

    expect(result.skipped).toBeUndefined();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe("login");
  });

  it("returns a missingField skip for a row with no title", () => {
    const result = mapRow({ Group: "", Title: "", Username: "u", Password: "p" });
    expect(result).toEqual({ items: [], skipped: "missingField" });
  });
});
