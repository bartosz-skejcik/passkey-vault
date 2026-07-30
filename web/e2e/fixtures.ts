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

const PASSWORD = "correct horse battery staple 42!";

/**
 * Registers a fresh, uniquely-emailed account through the real RegisterForm
 * UI flow (never a raw API call -- this fixture's job is proving genuine
 * two-account UI bring-up) and returns the resulting session.
 *
 * Seeds two harness-only localStorage flags via `addInitScript` BEFORE the
 * app's first script runs, both of them pure UX/test-ergonomics knobs with
 * zero security or crypto stake (see `lib/i18n/LocaleContext.tsx` and
 * `lib/onboarding/flag.ts`'s own doc comments):
 *   - `pv-locale=en` -- so this fixture can target stable English copy
 *     instead of depending on the `pl` default;
 *   - `pv-onboarding-complete=true` -- so the post-register onboarding
 *     wizard (UI-04, shown only after RegisterForm's own onAuthed) never
 *     mounts and obscures the vault view this fixture asserts on.
 */
async function createSession(browser: Browser): Promise<Session> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("pv-locale", "en");
      window.localStorage.setItem("pv-onboarding-complete", "true");
    } catch {
      // localStorage may be unavailable -- harmless, worst case the wizard
      // shows or copy renders in pl; neither breaks this fixture's own
      // testid-based assertions below.
    }
  });

  // Phase 20's standing "no OS-level dialogs in automation" rule (memory:
  // no-interactive-prompts-in-automation) -- a real `window.alert`/
  // `confirm`/`prompt`/`beforeunload` firing during this password-only
  // bring-up would hang the harness waiting for a human. Auto-dismiss
  // defensively AND record that one fired, so the smoke spec can assert
  // this never happened rather than silently tolerating a dismissed one.
  let dialogFired = false;
  page.on("dialog", (dialog) => {
    dialogFired = true;
    void dialog.dismiss();
  });

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

  if (dialogFired) {
    throw new Error(
      `pv-e2e: an OS-level dialog fired during registration for ${email} -- zero dialogs are ` +
        "expected for this password-only flow (Phase 20's standing no-OS-dialog rule).",
    );
  }

  return { context, page, email, dialogFired: () => dialogFired };
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
