// @vitest-environment jsdom
// lib/autofill/fill-dom.test.ts — jsdom coverage for the framework-safe DOM
// value writer (10-05-PLAN.md Task 1). jsdom DOES honour prototype
// value-setter descriptors and dispatch synthetic events, so Tests 1/2 are
// genuinely exercised here; the one thing jsdom cannot reproduce is a real
// React reconciler (that's plan 10-07's UAT job, per 10-VALIDATION.md
// Manual-Only).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { setNativeValue, fillValues, type FillTargets } from "./fill-dom";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("setNativeValue", () => {
  it("Test 1: sets the value AND dispatches a bubbling input event and a bubbling change event", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);

    let sawBubblingInput = false;
    let sawBubblingChange = false;
    document.body.addEventListener("input", (e) => {
      if (e.bubbles && e.target === input) sawBubblingInput = true;
    });
    document.body.addEventListener("change", (e) => {
      if (e.bubbles && e.target === input) sawBubblingChange = true;
    });

    setNativeValue(input, "x");

    expect(input.value).toBe("x");
    expect(sawBubblingInput).toBe(true);
    expect(sawBubblingChange).toBe(true);
  });

  it("Test 2: uses the prototype's value setter, bypassing a React-style instance-level setter override", () => {
    const proto = HTMLInputElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, "value")!;
    const protoSetSpy = vi.fn(original.set);
    Object.defineProperty(proto, "value", { ...original, set: protoSetSpy });

    try {
      const input = document.createElement("input");
      document.body.appendChild(input);

      let instanceSetterCalls = 0;
      Object.defineProperty(input, "value", {
        configurable: true,
        get() {
          return original.get!.call(input);
        },
        set() {
          // A naive `input.value = x` assignment would land HERE instead
          // of the real DOM setter -- this is exactly what React's
          // controlled-input pattern installs on a live DOM node.
          instanceSetterCalls += 1;
        },
      });

      setNativeValue(input, "hello");

      expect(protoSetSpy).toHaveBeenCalledWith("hello");
      expect(instanceSetterCalls).toBe(0);
      expect(original.get!.call(input)).toBe("hello");
    } finally {
      Object.defineProperty(proto, "value", original);
    }
  });
});

describe("fillValues", () => {
  it("Test 3: login writes username into the username element and password into the password element; a login with no username target fills only the password", () => {
    const username = document.createElement("input");
    const password = document.createElement("input");
    document.body.append(username, password);

    const targets: FillTargets = { type: "login", username, password };
    const result = fillValues({ type: "login", username: "bob", password: "hunter2" }, targets);

    expect(result).toEqual({ ok: true, filledCount: 2 });
    expect(username.value).toBe("bob");
    expect(password.value).toBe("hunter2");

    // No username target at all (page has no such field) -- only password fills.
    const passwordOnly = document.createElement("input");
    document.body.appendChild(passwordOnly);
    const passwordOnlyTargets: FillTargets = { type: "login", username: null, password: passwordOnly };
    const result2 = fillValues({ type: "login", username: "bob", password: "hunter2" }, passwordOnlyTargets);

    expect(result2).toEqual({ ok: true, filledCount: 1 });
    expect(passwordOnly.value).toBe("hunter2");
  });

  it("Test 4: card writes cardholderName/number/expiry/cvv into resolved slots; a split-expiry target receives parsed month and year, not the raw expiry string", () => {
    const cardholderName = document.createElement("input");
    const number = document.createElement("input");
    const cvv = document.createElement("input");
    const expiry = document.createElement("input");
    document.body.append(cardholderName, number, cvv, expiry);

    const singleTargets: FillTargets = {
      type: "card",
      cardholderName,
      number,
      cvv,
      expiryMode: "single",
      expiry,
      expiryMonth: null,
      expiryYear: null,
    };
    const singleResult = fillValues(
      { type: "card", cardholderName: "Jane Doe", number: "4111111111111111", expiry: "04/26", cvv: "123" },
      singleTargets,
    );
    expect(singleResult).toEqual({ ok: true, filledCount: 4 });
    expect(cardholderName.value).toBe("Jane Doe");
    expect(number.value).toBe("4111111111111111");
    expect(cvv.value).toBe("123");
    expect(expiry.value).toBe("04/26");

    // Split expiry: month + year sub-fields, year field expects 4 digits.
    const expiryMonth = document.createElement("input");
    const expiryYear = document.createElement("input");
    expiryYear.maxLength = 4;
    document.body.append(expiryMonth, expiryYear);

    const splitTargets: FillTargets = {
      type: "card",
      cardholderName: null,
      number: null,
      cvv: null,
      expiryMode: "split",
      expiry: null,
      expiryMonth,
      expiryYear,
    };
    const splitResult = fillValues(
      { type: "card", cardholderName: "", number: "", cvv: "", expiry: "04/26" },
      splitTargets,
    );
    expect(splitResult).toEqual({ ok: true, filledCount: 2 });
    expect(expiryMonth.value).toBe("04");
    expect(expiryYear.value).toBe("2026");
    // Raw "04/26" must NOT have been written verbatim into either sub-field.
    expect(expiryMonth.value).not.toBe("04/26");
    expect(expiryYear.value).not.toBe("04/26");
  });

  it("Test 5 (vanished field): a target element detached from the document returns { ok: false, filledCount } without throwing", () => {
    const password = document.createElement("input");
    // Deliberately NOT appended to document.body -- simulates a field the
    // SPA removed between detect-time and fill-time.
    const targets: FillTargets = { type: "login", username: null, password };

    let result: { ok: boolean; filledCount: number } | undefined;
    expect(() => {
      result = fillValues({ type: "login", username: "", password: "hunter2" }, targets);
    }).not.toThrow();

    expect(result).toEqual({ ok: false, filledCount: 0 });
    expect(password.value).toBe("");
  });

  it("Test 6 (identity): writes firstName/lastName/email/phone/address into their slots; missing slots are skipped silently", () => {
    const firstName = document.createElement("input");
    const email = document.createElement("input");
    document.body.append(firstName, email);

    const targets: FillTargets = {
      type: "identity",
      firstName,
      lastName: null,
      email,
      phone: null,
      address: null,
    };

    let result: { ok: boolean; filledCount: number } | undefined;
    expect(() => {
      result = fillValues(
        {
          type: "identity",
          firstName: "Jane",
          lastName: "Doe",
          email: "jane@example.com",
          phone: "+48123456789",
          address: "Main St 1",
        },
        targets,
      );
    }).not.toThrow();

    expect(result).toEqual({ ok: true, filledCount: 2 });
    expect(firstName.value).toBe("Jane");
    expect(email.value).toBe("jane@example.com");
  });
});
