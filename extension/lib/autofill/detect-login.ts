// lib/autofill/detect-login.ts — deterministic login/signup form detection
// (D-06: this path needs no confidence-based matching, unlike plan 10-03's
// card/identity heuristic matcher). Pure DOM analysis over a Document/
// Element -- no crypto, no chrome.* calls, no key material (this file
// intentionally has zero imports from the WASM crypto bridge or the shared
// Rust core). See 10-RESEARCH.md Pattern 3 for why login/TOTP are kept out
// of the fuzzy matcher entirely.

/** Result of detectLogin(): the password field is always present (a null
 * result is returned instead when none exists); username/confirmPassword
 * are null when the page genuinely has no such field (e.g. a password-only
 * second step, or a plain login with no confirm field). `mode` is exported
 * even though Phase 10 only fills logins -- 10-CONTEXT.md's Deferred Ideas
 * records that Phase 11 (CAP-01/CAP-02) must reuse this detector for
 * signup capture rather than rebuild it. */
export interface LoginFieldSet {
  mode: "login" | "signup";
  username: HTMLInputElement | null;
  password: HTMLInputElement;
  confirmPassword: HTMLInputElement | null;
}

/**
 * True when an input element is safe to fill: not `disabled`, not
 * `readOnly`, not the `hidden` attribute, not `type="hidden"`, and not
 * hidden via an inline `display:none`/`visibility:hidden` style. Hidden/
 * disabled password fields are a common honeypot/anti-bot pattern on real
 * login forms -- filling one is a tell that reveals the autofill agent.
 *
 * This is a DOM-only, best-effort check: `offsetParent`/computed layout is
 * unreliable (or unavailable) in jsdom, so full real-browser visibility is
 * documented here as a concern the content-relay layer (Plan 10-05) may
 * refine with actual `getComputedStyle()` access once running in a live
 * page.
 *
 * Exported so detect-totp.ts reuses the same predicate rather than
 * duplicating it (10-02-PLAN.md Task 2 explicitly requires this).
 */
export function isFillableInput(el: HTMLInputElement): boolean {
  if (el.disabled || el.readOnly || el.hidden) return false;
  if (el.type === "hidden") return false;
  const style = el.getAttribute("style") ?? "";
  if (/display\s*:\s*none/i.test(style)) return false;
  if (/visibility\s*:\s*hidden/i.test(style)) return false;
  return true;
}

function formOf(el: Element): HTMLFormElement | null {
  return el.closest("form");
}

/** Space-separated `autocomplete` tokens, lowercased. Per the HTML spec an
 * autocomplete value can carry multiple tokens (e.g. "section-billing
 * new-password"); comparing token membership rather than the raw string
 * avoids false negatives on a page that qualifies the hint. */
function autocompleteTokens(el: HTMLInputElement): string[] {
  return (el.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

function hasAutocompleteToken(el: HTMLInputElement, token: string): boolean {
  return autocompleteTokens(el).includes(token);
}

/** Nearest input[type="text"] that precedes `pw` in document order, scanning
 * only within `pool`. Implements the formless-page fallback (Test 7): a
 * bare-div SPA login where there is no `<form>` to scope the search to, so
 * proximity is the only remaining signal. */
function nearestPrecedingText(
  pw: HTMLInputElement,
  pool: HTMLInputElement[]
): HTMLInputElement | null {
  const preceding = pool.filter((el) => {
    const relation = el.compareDocumentPosition(pw);
    return Boolean(relation & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  if (preceding.length === 0) return null;

  return preceding.reduce((closest, el) => {
    const relation = closest.compareDocumentPosition(el);
    return relation & Node.DOCUMENT_POSITION_FOLLOWING ? el : closest;
  }, preceding[0]);
}

/**
 * Finds the username field paired with `password`, scoped to the SAME
 * `<form>` as the password field whenever a form ancestor exists (this is
 * what stops the multi-form mispairing in Test 2 -- a candidate from a
 * different form is never even queried). When the password field is
 * formless, the search falls back to `root` but excludes any candidate
 * that itself belongs to a (different, unrelated) form.
 *
 * Priority order (10-02-PLAN.md Task 1, step 5):
 *   1. autocomplete="username"
 *   2. autocomplete="email"
 *   3. input[type="email"]
 *   4. nearest preceding input[type="text"]
 */
function findUsername(
  password: HTMLInputElement,
  root: Document | Element
): HTMLInputElement | null {
  const pwForm = formOf(password);
  const scope: Document | Element = pwForm ?? root;

  const rawPool = Array.from(scope.querySelectorAll<HTMLInputElement>("input")).filter(
    (el) => el !== password && el.type !== "password" && isFillableInput(el)
  );
  const pool = pwForm ? rawPool : rawPool.filter((el) => formOf(el) === null);

  const byUsername = pool.find((el) => hasAutocompleteToken(el, "username"));
  if (byUsername) return byUsername;

  const byEmailAutocomplete = pool.find((el) => hasAutocompleteToken(el, "email"));
  if (byEmailAutocomplete) return byEmailAutocomplete;

  const byEmailType = pool.find((el) => el.type === "email");
  if (byEmailType) return byEmailType;

  const textPool = pool.filter((el) => el.type === "text");
  return nearestPrecedingText(password, textPool);
}

/**
 * Detects a login or signup form from the standardized signal alone --
 * `input[type="password"]` plus autocomplete hints -- with NO confidence
 * scoring (D-06). Returns `null` when no fillable password field exists
 * anywhere under `root`.
 */
export function detectLogin(root: Document | Element): LoginFieldSet | null {
  const allPasswords = Array.from(
    root.querySelectorAll<HTMLInputElement>('input[type="password"]')
  ).filter(isFillableInput);

  if (allPasswords.length === 0) return null;

  // Group fillable password fields by their closest form ancestor (null
  // key = formless) so the confirm-password signup shape (2+ password
  // fields in the SAME form) can be told apart from two unrelated
  // password fields living in two unrelated forms.
  const groups = new Map<HTMLFormElement | null, HTMLInputElement[]>();
  for (const pw of allPasswords) {
    const form = formOf(pw);
    const list = groups.get(form) ?? [];
    list.push(pw);
    groups.set(form, list);
  }

  const hasNewPassword = allPasswords.some((pw) => hasAutocompleteToken(pw, "new-password"));
  const hasConfirmShape = Array.from(groups.values()).some((list) => list.length >= 2);
  const mode: "login" | "signup" = hasNewPassword || hasConfirmShape ? "signup" : "login";

  const primary =
    allPasswords.find((pw) => hasAutocompleteToken(pw, "current-password")) ?? allPasswords[0];

  const sameGroup = groups.get(formOf(primary)) ?? [primary];
  const confirmPassword = sameGroup.find((pw) => pw !== primary) ?? null;

  const username = findUsername(primary, root);

  return { mode, username, password: primary, confirmPassword };
}
