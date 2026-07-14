import { describe, expect, it } from "vitest";
import { detect, mapRow } from "./onePasswordCsv";

describe("onePasswordCsv.detect", () => {
  it("matches the minimal 3-column subset", () => {
    expect(detect(["title", "username", "password"])).toBe(true);
  });

  it("does not match when title is missing", () => {
    expect(detect(["url", "username", "password"])).toBe(false);
  });

  it("does not match an empty header array", () => {
    expect(detect([])).toBe(false);
  });
});

describe("onePasswordCsv.mapRow", () => {
  it("maps a row to a login draft, defaulting unmapped fields", () => {
    const result = mapRow({ title: "GitHub", username: "bartek", password: "hunter2" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      type: "login",
      name: "GitHub",
      username: "bartek",
      password: "hunter2",
      urls: [],
      tags: [],
    });
  });

  it("splits out a totp draft when otp is present", () => {
    const result = mapRow({
      title: "GitHub",
      username: "bartek",
      password: "hunter2",
      otp: "JBSWY3DPEHPK3PXP",
    });
    expect(result.items).toHaveLength(2);
    expect(result.items[1]).toMatchObject({ type: "totp", secret: "JBSWY3DPEHPK3PXP" });
  });

  it("returns a missingField skip for a row with no title", () => {
    const result = mapRow({ title: "", username: "u", password: "p" });
    expect(result).toEqual({ items: [], skipped: "missingField" });
  });
});
