// @vitest-environment jsdom
// lib/autofill/detect-scored.identity.test.ts — pins the scored,
// autocomplete-first, threshold-gated identity slot resolver (FILL-04,
// D-05). Covers a well-marked address form, the Polish fallback
// vocabulary (product's primary UI language), deterministic tie-refusal,
// and the "values are never touched" encoding guarantee.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

import { detectIdentity } from "./detect-scored";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "__fixtures__");

function loadFixture(name: string): string {
  return readFileSync(path.join(FIXTURES, name), "utf-8");
}

function setBody(html: string): void {
  document.body.innerHTML = html;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("detectIdentity", () => {
  it("Test 9: a well-marked address form resolves firstName/lastName/email/phone/address", () => {
    setBody(loadFixture("identity-form-en.html"));
    const result = detectIdentity(document);

    expect(result.hasAny).toBe(true);
    expect(result.firstName).toBe(document.getElementById("fname"));
    expect(result.lastName).toBe(document.getElementById("lname"));
    expect(result.email).toBe(document.getElementById("em"));
    expect(result.phone).toBe(document.getElementById("ph"));
    expect(result.address).toBe(document.getElementById("addr"));
  });

  it("Test 10: a Polish-language form resolves via the Polish fallback vocabulary", () => {
    setBody(loadFixture("identity-form-pl.html"));
    const result = detectIdentity(document);

    expect(result.hasAny).toBe(true);
    expect(result.firstName).toBe(document.getElementById("p-imie"));
    expect(result.lastName).toBe(document.getElementById("p-nazwisko"));
    expect(result.phone).toBe(document.getElementById("p-tel"));
    expect(result.address).toBe(document.getElementById("p-adres"));
    // No email field on this fixture at all -- must not be invented.
    expect(result.email).toBeNull();
  });

  it("Test 11 (ORDERING): a tied email slot is deterministic and resolves to null across repeated calls", () => {
    setBody(`
      <input id="email-a" autocomplete="email" type="email" />
      <input id="email-b" autocomplete="email" type="email" />
      <input id="fname" autocomplete="given-name" type="text" />
    `);

    const first = detectIdentity(document);
    const second = detectIdentity(document);

    expect(first.email).toBeNull();
    expect(second.email).toBeNull();
    expect(first.firstName).toBe(document.getElementById("fname"));
    expect(second.firstName).toBe(document.getElementById("fname"));
    expect(first.firstName).toBe(second.firstName);
  });

  it("Test 12 (ENCODING): resolution is markup-only -- an existing unicode value is untouched", () => {
    const unicodeValue = "Zoë Müller-Åström 日本語";
    setBody(`<input id="em" autocomplete="email" type="email" value="${unicodeValue}" />`);

    const result = detectIdentity(document);
    const el = document.getElementById("em") as HTMLInputElement;

    expect(result.email).toBe(el);
    expect(el.value).toBe(unicodeValue);
  });
});
