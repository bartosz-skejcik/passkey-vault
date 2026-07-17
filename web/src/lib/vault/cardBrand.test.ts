import { describe, expect, it } from "vitest";
import { detectCardBrand } from "./cardBrand";

describe("detectCardBrand", () => {
  it("detects Visa from a 4-prefixed number", () => {
    expect(detectCardBrand("4111111111111111")).toBe("visa");
  });

  it("detects Mastercard from the classic 51-55 prefix range", () => {
    expect(detectCardBrand("5105105105105100")).toBe("mastercard");
    expect(detectCardBrand("5500000000000004")).toBe("mastercard");
  });

  it("detects Mastercard from the newer 2221-2720 prefix range", () => {
    expect(detectCardBrand("2221000000000009")).toBe("mastercard");
    expect(detectCardBrand("2720999999999996")).toBe("mastercard");
  });

  it("does not misclassify just outside the 2221-2720 range as Mastercard", () => {
    expect(detectCardBrand("2220999999999999")).not.toBe("mastercard");
    expect(detectCardBrand("2721000000000000")).not.toBe("mastercard");
  });

  it("detects Amex from the 34/37 prefix", () => {
    expect(detectCardBrand("340000000000009")).toBe("amex");
    expect(detectCardBrand("370000000000002")).toBe("amex");
  });

  it("detects Discover from the 6011/65/644-649 prefixes", () => {
    expect(detectCardBrand("6011000000000004")).toBe("discover");
    expect(detectCardBrand("6500000000000002")).toBe("discover");
    expect(detectCardBrand("6440000000000007")).toBe("discover");
    expect(detectCardBrand("6490000000000000")).toBe("discover");
  });

  it("tolerates spaces and dashes in the input", () => {
    expect(detectCardBrand("4111 1111 1111 1111")).toBe("visa");
    expect(detectCardBrand("4111-1111-1111-1111")).toBe("visa");
  });

  it("returns null for an unrecognized prefix", () => {
    expect(detectCardBrand("9999999999999999")).toBeNull();
  });

  it("returns null for an empty or non-numeric input", () => {
    expect(detectCardBrand("")).toBeNull();
    expect(detectCardBrand("abcd")).toBeNull();
  });
});
