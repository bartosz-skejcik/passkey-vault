import { describe, expect, it } from "vitest";
import { detect, mapRow } from "./bitwardenCsv";

describe("bitwardenCsv.detect", () => {
  it("matches a full Bitwarden CSV header", () => {
    expect(
      detect([
        "folder",
        "favorite",
        "type",
        "name",
        "notes",
        "fields",
        "reprompt",
        "login_uri",
        "login_username",
        "login_password",
        "login_totp",
      ]),
    ).toBe(true);
  });

  it("does not match a LastPass-shaped header", () => {
    expect(detect(["url", "username", "password"])).toBe(false);
  });

  it("does not match an empty header array", () => {
    expect(detect([])).toBe(false);
  });
});

describe("bitwardenCsv.mapRow", () => {
  it("maps a login row with a single uri wrapped into urls", () => {
    const result = mapRow({
      type: "login",
      name: "GitHub",
      login_username: "bartek",
      login_password: "hunter2",
      login_totp: "",
      login_uri: "https://github.com",
      notes: "",
      folder: "",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      type: "login",
      name: "GitHub",
      username: "bartek",
      password: "hunter2",
      urls: ["https://github.com"],
    });
  });

  it("splits a login row with an embedded totp into two drafts", () => {
    const result = mapRow({
      type: "login",
      name: "GitHub",
      login_username: "bartek",
      login_password: "hunter2",
      login_totp: "JBSWY3DPEHPK3PXP",
      login_uri: "",
      notes: "",
      folder: "",
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[1]).toMatchObject({ type: "totp", secret: "JBSWY3DPEHPK3PXP" });
  });

  it("returns a missingField skip for a row with no name", () => {
    const result = mapRow({ type: "login", name: "", login_username: "u", login_password: "p" });
    expect(result).toEqual({ items: [], skipped: "missingField" });
  });

  it("returns an unparseableRow skip for an unrecognized type", () => {
    const result = mapRow({ type: "unknownType", name: "X" });
    expect(result).toEqual({ items: [], skipped: "unparseableRow" });
  });
});
