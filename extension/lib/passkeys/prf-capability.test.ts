import { describe, expect, it } from "vitest";
import { parsePrfCapability } from "./prf-capability";

describe("parsePrfCapability", () => {
  it("Test 1: { prf: { enabled: true } } returns true", () => {
    expect(parsePrfCapability({ prf: { enabled: true } })).toBe(true);
  });

  it("Test 2: { prf: { enabled: false } } returns false", () => {
    expect(parsePrfCapability({ prf: { enabled: false } })).toBe(false);
  });

  it("Test 3: undefined (clientExtensionResults unexpectedly absent) returns false", () => {
    expect(parsePrfCapability(undefined)).toBe(false);
  });

  it("Test 4: {} (prf key entirely missing) returns false", () => {
    expect(parsePrfCapability({})).toBe(false);
  });
});
