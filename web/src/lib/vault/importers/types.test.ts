import { describe, expect, it } from "vitest";
import { parseTotpValue } from "./types";

describe("parseTotpValue", () => {
  it("parses a full otpauth:// URI with all params present", () => {
    expect(
      parseTotpValue(
        "otpauth://totp/GitHub:bartek?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA1&digits=6&period=30",
      ),
    ).toEqual({
      secret: "JBSWY3DPEHPK3PXP",
      issuer: "GitHub",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
  });

  it("applies RFC 6238 defaults to a bare base32 secret", () => {
    expect(parseTotpValue("JBSWY3DPEHPK3PXP")).toEqual({
      secret: "JBSWY3DPEHPK3PXP",
      issuer: "",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
  });

  it("returns null for an empty string", () => {
    expect(parseTotpValue("")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseTotpValue(undefined as unknown as string)).toBeNull();
  });

  it("returns null for null", () => {
    expect(parseTotpValue(null)).toBeNull();
  });

  it("returns null when an otpauth:// URI is missing its secret param", () => {
    expect(parseTotpValue("otpauth://totp/GitHub:bartek?issuer=GitHub")).toBeNull();
  });

  it("applies defaults for missing optional otpauth:// params", () => {
    expect(parseTotpValue("otpauth://totp/GitHub:bartek?secret=JBSWY3DPEHPK3PXP")).toEqual({
      secret: "JBSWY3DPEHPK3PXP",
      issuer: "",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
  });

  it("honors a non-default algorithm/digits/period", () => {
    expect(
      parseTotpValue(
        "otpauth://totp/X:y?secret=ABC234&algorithm=SHA512&digits=8&period=60",
      ),
    ).toEqual({
      secret: "ABC234",
      issuer: "",
      algorithm: "SHA512",
      digits: 8,
      period: 60,
    });
  });

  it("falls back to defaults when digits/period are present but non-numeric", () => {
    expect(
      parseTotpValue("otpauth://totp/X:y?secret=ABC234&digits=x&period=x"),
    ).toMatchObject({ digits: 6, period: 30 });
  });

  it("falls back to defaults when digits/period are present but empty", () => {
    expect(
      parseTotpValue("otpauth://totp/X:y?secret=ABC234&digits=&period="),
    ).toMatchObject({ digits: 6, period: 30 });
  });

  it("falls back to defaults when digits/period are out of range or non-integer", () => {
    expect(
      parseTotpValue("otpauth://totp/X:y?secret=ABC234&digits=1&period=-5"),
    ).toMatchObject({ digits: 6, period: 30 });
    expect(
      parseTotpValue("otpauth://totp/X:y?secret=ABC234&digits=6.5&period=30.5"),
    ).toMatchObject({ digits: 6, period: 30 });
  });
});
