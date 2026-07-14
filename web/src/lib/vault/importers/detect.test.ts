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

  it("returns unknown for an unrecognized header set", () => {
    expect(detectFormat("export.csv", ["colA", "colB"], "colA,colB")).toBe("unknown");
  });

  it("returns unknown when headers is null and rawText is not Bitwarden-JSON-shaped", () => {
    expect(detectFormat("export.csv", null, "colA,colB\nval1,val2")).toBe("unknown");
  });
});
