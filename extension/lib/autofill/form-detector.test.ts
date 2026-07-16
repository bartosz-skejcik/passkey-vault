// lib/autofill/form-detector.test.ts — jsdom fixtures for classifyForm()/
// findPasswordFieldPair() (Phase 11, Plan 11-02, Task 1). Written FIRST
// (TDD RED) against a form-detector.ts that does not exist yet -- these
// five fixtures MUST fail before the source file is created.
import { describe, expect, it } from "vitest";
import { classifyForm, findPasswordFieldPair } from "./form-detector";

function setBody(html: string): void {
  document.body.innerHTML = html;
}

describe("classifyForm", () => {
  it("Test 1: classic two-field signup form (new-password + confirm-password names) -> signup", () => {
    setBody(`
      <form id="f">
        <input type="text" name="email" />
        <input type="password" name="new-password" autocomplete="new-password" />
        <input type="password" name="confirm-password" autocomplete="new-password" />
      </form>
    `);
    const form = document.getElementById("f") as HTMLFormElement;
    expect(classifyForm(form)).toBe("signup");
  });

  it("Test 2: single-field signup form (autocomplete=new-password, no second field) -> signup", () => {
    setBody(`
      <form id="f">
        <input type="text" name="email" />
        <input type="password" name="password" autocomplete="new-password" />
      </form>
    `);
    const form = document.getElementById("f") as HTMLFormElement;
    expect(classifyForm(form)).toBe("signup");
  });

  it("Test 3: single-field login form with no new-password signal -> login-submit", () => {
    setBody(`
      <form id="f">
        <input type="text" name="email" />
        <input type="password" name="password" autocomplete="current-password" />
      </form>
    `);
    const form = document.getElementById("f") as HTMLFormElement;
    expect(classifyForm(form)).toBe("login-submit");
  });

  it("Test 4: <div>-based SPA login container, one password input, no <form> tag -> login-submit", () => {
    setBody(`
      <div id="f">
        <input type="text" name="email" />
        <input type="password" name="password" />
      </div>
    `);
    const container = document.getElementById("f") as HTMLElement;
    expect(classifyForm(container)).toBe("login-submit");
  });

  it("Test 5: container with unrelated fields only (no password input) -> none", () => {
    setBody(`
      <form id="f">
        <input type="text" name="search" />
        <input type="email" name="newsletter" />
      </form>
    `);
    const form = document.getElementById("f") as HTMLFormElement;
    expect(classifyForm(form)).toBe("none");
  });
});

describe("findPasswordFieldPair", () => {
  it("returns the real confirm field when a signup container has two password inputs", () => {
    setBody(`
      <form id="f">
        <input type="password" name="new-password" id="pw1" autocomplete="new-password" />
        <input type="password" name="confirm-password" id="pw2" autocomplete="new-password" />
      </form>
    `);
    const form = document.getElementById("f") as HTMLFormElement;
    const pair = findPasswordFieldPair(form);
    expect(pair.newPasswordEl?.id).toBe("pw1");
    expect(pair.confirmPasswordEl?.id).toBe("pw2");
  });

  it("returns confirmPasswordEl: null for a single-field signup container", () => {
    setBody(`
      <form id="f">
        <input type="password" name="password" id="pw1" autocomplete="new-password" />
      </form>
    `);
    const form = document.getElementById("f") as HTMLFormElement;
    const pair = findPasswordFieldPair(form);
    expect(pair.newPasswordEl?.id).toBe("pw1");
    expect(pair.confirmPasswordEl).toBeNull();
  });
});
