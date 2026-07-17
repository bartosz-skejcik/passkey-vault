import { describe, expect, it } from "vitest";
import { addressLines, composeLegacyAddress } from "./identityAddress";

describe("addressLines", () => {
  it("returns every non-empty structured part in order", () => {
    expect(
      addressLines({
        addressLine1: "ul. Prosta 1",
        addressLine2: "m. 4",
        city: "Warszawa",
        state: "mazowieckie",
        zip: "00-001",
        country: "Polska",
      }),
    ).toEqual(["ul. Prosta 1", "m. 4", "Warszawa", "mazowieckie", "00-001", "Polska"]);
  });

  it("omits empty/whitespace-only parts", () => {
    expect(
      addressLines({
        addressLine1: "ul. Prosta 1",
        addressLine2: "",
        city: "Warszawa",
        state: undefined,
        zip: "   ",
        country: "Polska",
      }),
    ).toEqual(["ul. Prosta 1", "Warszawa", "Polska"]);
  });

  it("returns an empty array when every part is empty/undefined", () => {
    expect(addressLines({})).toEqual([]);
  });
});

describe("composeLegacyAddress", () => {
  it("joins non-empty parts with ', ' for the single-input extension autofill target", () => {
    expect(
      composeLegacyAddress({
        addressLine1: "ul. Prosta 1",
        city: "Warszawa",
        zip: "00-001",
        country: "Polska",
      }),
    ).toBe("ul. Prosta 1, Warszawa, 00-001, Polska");
  });

  it("returns an empty string when every structured part is empty", () => {
    expect(composeLegacyAddress({})).toBe("");
  });
});
