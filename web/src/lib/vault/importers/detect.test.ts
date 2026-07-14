import { describe, expect, it } from "vitest";
import { detectFormat } from "./detect";

describe("detectFormat", () => {
  it("detects Bitwarden JSON via shape, not file extension", () => {
    expect(detectFormat("vault_export.json", null, '{"items":[],"folders":[]}')).toBe(
      "bitwarden-json",
    );
  });

  it("detects Bitwarden CSV via header set", () => {
    expect(
      detectFormat(
        "export.csv",
        ["type", "name", "login_username", "login_password", "login_uri", "login_totp"],
        "type,name,login_username,login_password,login_uri,login_totp",
      ),
    ).toBe("bitwarden-csv");
  });

  it("detects NordPass CSV via its exact 6-column header", () => {
    expect(
      detectFormat(
        "export.csv",
        ["name", "url", "username", "password", "note", "folder"],
        "name,url,username,password,note,folder",
      ),
    ).toBe("nordpass-csv");
  });

  it("detects 1Password CSV via its minimal 3-column subset", () => {
    expect(
      detectFormat("export.csv", ["title", "username", "password"], "title,username,password"),
    ).toBe("1password-csv");
  });

  it("detects LastPass CSV via its required subset", () => {
    expect(
      detectFormat(
        "export.csv",
        ["url", "username", "password", "extra", "name", "grouping", "fav"],
        "url,username,password,extra,name,grouping,fav",
      ),
    ).toBe("lastpass-csv");
  });

  it("detects KeePass CSV case-insensitively", () => {
    expect(
      detectFormat(
        "export.csv",
        ["Group", "Title", "Username", "Password", "URL", "Notes"],
        "Group,Title,Username,Password,URL,Notes",
      ),
    ).toBe("keepass-csv");
  });

  it("returns unknown for an unrecognized header set", () => {
    expect(detectFormat("export.csv", ["colA", "colB"], "colA,colB")).toBe("unknown");
  });

  it("returns unknown when headers is null and rawText is not Bitwarden-JSON-shaped", () => {
    expect(detectFormat("export.csv", null, "colA,colB\nval1,val2")).toBe("unknown");
  });
});
