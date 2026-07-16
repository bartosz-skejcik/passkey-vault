// lib/autofill/form-detector.ts — signup-vs-login-submit form classifier
// (Phase 11, Plan 11-02, Task 1). Pure DOM analysis over a container
// element -- no crypto, no chrome.* calls, no key material, mirroring
// detect-login.ts's own zero-import convention (D-06 precedent: this
// classifier needs no confidence scoring either).
//
// Deliberately accepts `HTMLFormElement | HTMLElement` rather than only a
// real `<form>` -- Pitfall A (10-RESEARCH.md, referenced again in
// 11-RESEARCH.md) is that many SPA signup/login flows render a `<div>`-
// based container with no `<form>` wrapper at all. Scanning is always
// scoped to `container.querySelectorAll(...)`, never `document`-wide, so a
// caller controls exactly which subtree is classified (submit-capture.ts's
// job in Task 2 is to find that container in the first place).

/** `'signup'`: 2+ password fields, or exactly one with an explicit
 * `autocomplete="new-password"` hint. `'login-submit'`: exactly one
 * password field with no new-password/confirm signal. `'none'`: zero
 * password fields under `container`. */
export type FormClassification = "signup" | "login-submit" | "none";

export interface PasswordFieldPair {
  newPasswordEl: HTMLInputElement | null;
  confirmPasswordEl: HTMLInputElement | null;
}

function passwordInputs(container: HTMLFormElement | HTMLElement): HTMLInputElement[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="password"]'));
}

function hasNewPasswordAutocomplete(el: HTMLInputElement): boolean {
  const tokens = (el.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.includes("new-password");
}

/**
 * Classifies `container` as `'signup'`, `'login-submit'`, or `'none'` based
 * purely on its `input[type="password"]` descendants -- see
 * `FormClassification`'s doc comment for the exact rule. Never assumes a
 * real `<form>` wrapper exists (Pitfall A).
 */
export function classifyForm(container: HTMLFormElement | HTMLElement): FormClassification {
  const passwords = passwordInputs(container);

  if (passwords.length === 0) {
    return "none";
  }

  if (passwords.length >= 2) {
    return "signup";
  }

  // Exactly one password field -- signup only if it's explicitly flagged
  // as a NEW password (a confirm-less signup form, e.g. many single-field
  // "set your password" signup steps), otherwise it's a login submit.
  return hasNewPasswordAutocomplete(passwords[0]) ? "signup" : "login-submit";
}

/**
 * Resolves the new-password/confirm-password element pair inside a
 * signup-classified `container`. When only one password field exists,
 * `confirmPasswordEl` is `null` -- the caller must not assume a confirm
 * field is always present (Task 1's second must_haves.artifacts contract).
 * Document order determines which of two password fields is "new" vs.
 * "confirm" -- the first encountered is treated as the primary/new field.
 */
export function findPasswordFieldPair(container: HTMLFormElement | HTMLElement): PasswordFieldPair {
  const passwords = passwordInputs(container);

  if (passwords.length === 0) {
    return { newPasswordEl: null, confirmPasswordEl: null };
  }

  return {
    newPasswordEl: passwords[0],
    confirmPasswordEl: passwords.length >= 2 ? passwords[1] : null,
  };
}
