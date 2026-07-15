// @vitest-environment jsdom
// lib/autofill/detect-login.test.ts — jsdom coverage for the deterministic
// login/signup detector (D-06: no confidence scoring). Fixtures are inline
// HTML strings assigned to document.body.innerHTML -- no network, no real
// sites, per 10-02-PLAN.md Task 1.

import { describe, expect, it, beforeEach } from "vitest";
import { detectLogin } from "./detect-login";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("detectLogin", () => {
  it("Test 1: classic form pairs username + current-password, mode login", () => {
    document.body.innerHTML = `
      <form id="login">
        <input name="user" autocomplete="username">
        <input type="password" autocomplete="current-password">
      </form>
    `;

    const result = detectLogin(document);

    expect(result).not.toBeNull();
    expect(result?.mode).toBe("login");
    expect(result?.username).toBe(
      document.querySelector('input[autocomplete="username"]')
    );
    expect(result?.password).toBe(
      document.querySelector('input[autocomplete="current-password"]')
    );
  });

  it("Test 2: multi-form page pairs the login form's username with its OWN password field, never the newsletter form's email", () => {
    document.body.innerHTML = `
      <form id="newsletter">
        <input type="email" name="newsletter-email">
      </form>
      <form id="login">
        <input name="user" autocomplete="username">
        <input type="password" autocomplete="current-password">
      </form>
    `;

    const result = detectLogin(document);

    expect(result).not.toBeNull();
    const loginForm = document.querySelector("#login") as HTMLFormElement;
    expect(loginForm.contains(result!.username!)).toBe(true);
    expect(result?.username).not.toBe(
      document.querySelector('input[name="newsletter-email"]')
    );
  });

  it("Test 3: signup form (new-password + confirm) reports mode signup, not login", () => {
    document.body.innerHTML = `
      <form id="signup">
        <input name="user" autocomplete="username">
        <input type="password" id="pw1" autocomplete="new-password">
        <input type="password" id="pw2" autocomplete="new-password">
      </form>
    `;

    const result = detectLogin(document);

    expect(result).not.toBeNull();
    expect(result?.mode).toBe("signup");
    expect(result?.confirmPassword).toBe(document.querySelector("#pw2"));
  });

  it("Test 4: password-only step (no username sibling) still returns the password field, with username null", () => {
    document.body.innerHTML = `
      <form id="step2">
        <input type="password" autocomplete="current-password">
      </form>
    `;

    const result = detectLogin(document);

    expect(result).not.toBeNull();
    expect(result?.username).toBeNull();
    expect(result?.password).toBe(
      document.querySelector('input[type="password"]')
    );
  });

  it("Test 5: no password input at all returns null", () => {
    document.body.innerHTML = `
      <form id="search">
        <input type="text" name="q">
      </form>
    `;

    expect(detectLogin(document)).toBeNull();
  });

  it("Test 6: disabled/readonly/hidden/display:none password fields are skipped as honeypots", () => {
    document.body.innerHTML = `
      <input type="password" id="honeypot-disabled" disabled>
      <input type="password" id="honeypot-readonly" readonly>
      <input type="password" id="honeypot-hidden" hidden>
      <input type="password" id="honeypot-display-none" style="display:none">
      <input type="password" id="real" autocomplete="current-password">
    `;

    const result = detectLogin(document);

    expect(result).not.toBeNull();
    expect(result?.password).toBe(document.querySelector("#real"));
  });

  it("Test 7: formless login resolves username by nearest-preceding proximity, not the furthest decoy", () => {
    document.body.innerHTML = `
      <div>
        <input type="text" name="decoy" placeholder="Search the site">
        <input type="text" name="user">
        <input type="password" name="pass">
      </div>
    `;

    const result = detectLogin(document);

    expect(result).not.toBeNull();
    expect(result?.username).toBe(document.querySelector('input[name="user"]'));
    expect(result?.username).not.toBe(
      document.querySelector('input[name="decoy"]')
    );
  });
});
