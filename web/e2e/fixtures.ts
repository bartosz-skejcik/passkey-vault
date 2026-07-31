// web/e2e/fixtures.ts -- the two-session fixture SEC-08's Playwright layer
// needs (23-04-PLAN.md, Task 2). Two genuinely independent authenticated
// browser sessions, each produced by its own `browser.newContext()` call --
// never a single context with a swapped localStorage token, and never two
// tabs sharing one context (CONTEXT.md's explicit constraint: "2+ real
// concurrently authenticated sessions").
//
// This borrows extension/e2e/fixtures.ts's `test.extend`-based PATTERN
// (worker/test-scoped fixture shape) only -- NOT its
// `launchPersistentContext`/`--load-extension` mechanism, which is
// Chromium-extension-specific and does not apply to this plain
// `browser.newContext()`-driven suite. Both sessions authenticate through
// the real password-only `RegisterForm` UI flow (never a raw API call, and
// never a WebAuthn ceremony -- Phase 20's standing "zero OS-level dialogs
// in automation" rule).
//
// Scope choice: TEST-scoped (not worker-scoped). Unlike the extension
// suite's cumulative single-vault-per-worker design (relaunching a fresh
// persistent context per test would mean repeating a full onboarding flow
// 21+ times), this harness's whole point is proving TWO fresh, independent
// accounts bring up cleanly -- there is no cumulative state worth
// preserving across tests, and test-scoping keeps every test's two accounts
// provably isolated from any other test in the same file.
import { test as base, type Browser, type BrowserContext, type Page } from "@playwright/test";

export interface Session {
  context: BrowserContext;
  page: Page;
  email: string;
  /** True if any OS-level dialog (alert/confirm/prompt/beforeunload) has
   * fired on this session's page since creation -- exposed so the smoke
   * spec's own assertions can check this directly, rather than relying
   * solely on the fixture's internal creation-time guard below. */
  dialogFired: () => boolean;
}

interface TwoSessionsFixtures {
  /** Two independent authenticated sessions, each its own `browser.newContext()`. */
  twoSessions: [Session, Session];
}

// Exported (Plan 24-08) so a spec that navigates an already-`twoSessions`-
// authenticated page to a NEW url -- a full browser navigation, which drops
// this app's in-memory `unlockedUserKey`/`pendingUnlock` singletons exactly
// like a real page reload would -- can re-unlock that SAME account via the
// real UnlockOverlay password form afterward, without inventing a second,
// possibly-drifting copy of this literal string.
export const SESSION_PASSWORD = "correct horse battery staple 42!";
const PASSWORD = SESSION_PASSWORD;

/**
 * Seeds the same two harness-only localStorage flags every real-UI session
 * in this suite needs via `addInitScript` BEFORE the app's first script runs
 * -- both pure UX/test-ergonomics knobs with zero security or crypto stake
 * (see `lib/i18n/LocaleContext.tsx` and `lib/onboarding/flag.ts`'s own doc
 * comments):
 *   - `pv-locale=en` -- so a spec can target stable English copy instead of
 *     depending on the `pl` default;
 *   - `pv-onboarding-complete=true` -- so the post-register onboarding
 *     wizard (UI-04, shown only after RegisterForm's own onAuthed) never
 *     mounts and obscures the vault view a spec asserts on.
 * Extracted out of `createSession` (Plan 24-08) so any OTHER context this
 * suite mints -- e.g. a brand-new-invitee context, or a throwaway
 * owner-login context -- gets the identical setup rather than a third,
 * silently-drifting copy of the same three lines.
 */
async function applyE2eInitScript(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("pv-locale", "en");
      window.localStorage.setItem("pv-onboarding-complete", "true");
    } catch {
      // localStorage may be unavailable -- harmless, worst case the wizard
      // shows or copy renders in pl; neither breaks a testid-based assertion.
    }
  });
}

/**
 * Wires Phase 20's standing "no OS-level dialogs in automation" rule (memory:
 * no-interactive-prompts-in-automation) onto `page` -- a real `window.alert`/
 * `confirm`/`prompt`/`beforeunload` firing during any password-only bring-up
 * would hang the harness waiting for a human. Auto-dismisses defensively AND
 * records that one fired, so a spec can assert this never happened rather
 * than silently tolerating a dismissed one.
 */
function attachDialogGuard(page: Page): () => boolean {
  let dialogFired = false;
  page.on("dialog", (dialog) => {
    dialogFired = true;
    void dialog.dismiss();
  });
  return () => dialogFired;
}

/**
 * A brand-new `browser.newContext()` + `newPage()` with this suite's
 * standard init-script + dialog-guard setup applied, but with NO account
 * registered on it yet -- the shape every "start from a genuinely
 * unauthenticated browser" scenario needs (Plan 24-08's brand-new-invitee
 * join, and `ensureFamilyOwnerSession`'s own throwaway login context below).
 */
export async function newBareContext(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page; dialogFired: () => boolean }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await applyE2eInitScript(context);
  const dialogFired = attachDialogGuard(page);
  return { context, page, dialogFired };
}

/**
 * Registers a fresh, uniquely-emailed account through the real RegisterForm
 * UI flow (never a raw API call -- this fixture's job is proving genuine
 * two-account UI bring-up) and returns the resulting session.
 */
async function createSession(browser: Browser): Promise<Session> {
  const { context, page, dialogFired } = await newBareContext(browser);

  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const email = `pv-e2e-${unique}@example.test`;

  await page.goto("/");
  await page.getByRole("button", { name: "No account yet? Sign up" }).click();
  await page.getByTestId("register-email").fill(email);
  await page.getByTestId("register-password").fill(PASSWORD);
  await page.getByTestId("register-confirm-password").fill(PASSWORD);
  await page.getByTestId("register-submit").click();

  // RegisterForm's onAuthed synchronously calls setUnlockedUserKey(uk)
  // before returning (RegisterForm.tsx) -- unlike LoginForm's password
  // path, a successful register lands directly on the unlocked vault view
  // with no separate UnlockOverlay step. `new-item-button` only renders
  // once page.tsx's `authed` branch takes over from the auth screen.
  await page.getByTestId("new-item-button").waitFor({ state: "visible" });

  if (dialogFired()) {
    throw new Error(
      `pv-e2e: an OS-level dialog fired during registration for ${email} -- zero dialogs are ` +
        "expected for this password-only flow (Phase 20's standing no-OS-dialog rule).",
    );
  }

  return { context, page, email, dialogFired };
}

/**
 * Fixed, deterministic email+password for the ONE real, UI-capable "family
 * owner" account shared across every e2e spec file that needs owner-only
 * family/invite authority (Plan 24-08). `families.rs::create`'s singleton
 * constraint (`idx_families_singleton`) means whichever caller's
 * `POST /api/families` succeeds FIRST in a given run's DB becomes the
 * PERMANENT owner -- there is no ownership-transfer endpoint. Both
 * `web/e2e/invite-flow.spec.ts` (needs a genuinely unlockable UserKey to
 * drive the real Settings > Family tab) and `web/e2e/shared-sync.spec.ts`
 * (only ever needs a valid bearer token for raw requests) must therefore
 * resolve to this SAME identity, regardless of which spec FILE's turn to
 * establish it runs first in a given Playwright invocation -- unlike
 * `createSession`'s deliberately-unique-per-call email, this one identity
 * must be RECONSTRUCTIBLE (register-or-login) by any file in this run.
 */
export const FAMILY_OWNER_EMAIL = "pv-e2e-family-owner@example.test";
export const FAMILY_OWNER_PASSWORD = "correct horse battery staple owner 42!";

/**
 * Idempotently registers-or-logs-in `FAMILY_OWNER_EMAIL` on `page` via the
 * REAL RegisterForm/LoginForm/UnlockOverlay UI flow (never a raw request) --
 * register first (this account may not exist yet in this run's DB); on the
 * specific "already registered" failure, fall back to a real login + unlock
 * instead (LoginForm's own onAuthed only sets a *pending* unlock -- see
 * LoginForm.tsx's doc comment -- so one extra UnlockOverlay submit is
 * needed, unlike the register path's direct landing). Ends with the vault
 * fully unlocked (`new-item-button` visible) either way. `page`'s own
 * context must already have `applyE2eInitScript`'s flags applied (every
 * caller below goes through `newBareContext`, which does).
 */
export async function ensureFamilyOwnerSession(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "No account yet? Sign up" }).click();
  await page.getByTestId("register-email").fill(FAMILY_OWNER_EMAIL);
  await page.getByTestId("register-password").fill(FAMILY_OWNER_PASSWORD);
  await page.getByTestId("register-confirm-password").fill(FAMILY_OWNER_PASSWORD);
  await page.getByTestId("register-submit").click();

  const outcome = await Promise.race([
    page
      .getByTestId("new-item-button")
      .waitFor({ state: "visible" })
      .then(() => "registered" as const),
    page
      .getByText("An account with this email already exists")
      .waitFor({ state: "visible" })
      .then(() => "duplicate" as const),
  ]);

  if (outcome === "registered") {
    return;
  }

  // The account already existed (an earlier test in THIS file, or another
  // spec file entirely, registered it first) -- fall back to a real login +
  // unlock, the same two-step dance any returning user goes through.
  await page.getByRole("button", { name: "Already have an account? Log in" }).click();
  await page.getByTestId("login-email").fill(FAMILY_OWNER_EMAIL);
  await page.getByTestId("login-password").fill(FAMILY_OWNER_PASSWORD);
  await page.getByTestId("login-submit").click();
  await page.getByTestId("unlock-submit").waitFor({ state: "visible" });
  await page.getByTestId("unlock-submit").click();
  await page.getByTestId("new-item-button").waitFor({ state: "visible" });
}

export const test = base.extend<TwoSessionsFixtures>({
  twoSessions: async ({ browser }, use) => {
    const [sessionA, sessionB] = await Promise.all([
      createSession(browser),
      createSession(browser),
    ]);
    await use([sessionA, sessionB]);
    await sessionA.context.close();
    await sessionB.context.close();
  },
});

export const expect = test.expect;
