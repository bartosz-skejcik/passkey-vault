// web/e2e/settings-route.spec.ts -- Plan 29-05's live proof of SC1's
// remaining unverified claims: a real `page.goto("/settings")` cold entry, a
// real `page.reload()`, and a real `page.goBack()`. Plan 29-01's own
// `npm run build` artifact check (`out/settings.html`/`.txt`/`out/settings/`)
// and jsdom mount test prove the route EXISTS and RENDERS in isolation --
// neither exercises an actual browser navigating to it, reloading it, or
// navigating away and back. This file is that live navigation proof.
//
// Single-session spec (mirrors smoke.spec.ts's own file-header shape) --
// one real account is sufficient for all three cases below, so this uses
// `newBareContext` + a manual register-via-UI (mirroring sharing.spec.ts's
// own `registerFreshSession`) rather than the two-account `twoSessions`
// fixture.
import { test, expect, newBareContext, SESSION_PASSWORD } from "./fixtures";

test("cold /settings entry, reload survival, and browser-back all behave as SC1 and the <Link> design intend", async ({
  browser,
}) => {
  const { context, page, dialogFired } = await newBareContext(browser);
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const email = `pv-e2e-settings-route-${unique}@example.test`;

  // Register via the real RegisterForm UI flow -- lands directly on the
  // unlocked vault view (fixtures.ts's own documented RegisterForm
  // onAuthed behavior, unlike LoginForm's separate pending-unlock step).
  await page.goto("/");
  await page.getByRole("button", { name: "No account yet? Sign up" }).click();
  await page.getByTestId("register-email").fill(email);
  await page.getByTestId("register-password").fill(SESSION_PASSWORD);
  await page.getByTestId("register-confirm-password").fill(SESSION_PASSWORD);
  await page.getByTestId("register-submit").click();
  await page.getByTestId("new-item-button").waitFor({ state: "visible" });

  // ------------------------------------------------------------------
  // Case 1: cold navigation. This browser context's FIRST visit to the
  // exact `/settings` URL -- a valid session exists (real token in
  // localStorage), but nothing has been prefetched/hydrated for this route
  // yet. A full `page.goto()` is a real browser load, which drops this
  // app's in-memory unlock singleton exactly like `web/e2e/fixtures.ts`'s
  // own SESSION_PASSWORD/reloadAndUnlock precedent documents for other full
  // navigations -- so the settings shell renders BEHIND its own
  // UnlockOverlay, not settings content outright.
  // ------------------------------------------------------------------
  await page.goto("/settings");

  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" }),
    "a cold /settings entry with a valid session must render the settings shell's own <h1>, not a 404 or blank page",
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Settings navigation" }),
    "the jump-nav landmark must be present on a cold entry",
  ).toBeVisible();
  await expect(
    page.getByTestId("unlock-password"),
    "a cold full-navigation entry must drop the in-memory unlock singleton and show UnlockOverlay, exactly like any other full navigation",
  ).toBeVisible();

  await page.getByTestId("unlock-password").fill(SESSION_PASSWORD);
  await page.getByTestId("unlock-submit").click();
  await expect(
    page.getByTestId("settings-section-konto"),
    "unlocking from a cold /settings entry must reveal real settings content end to end",
  ).toBeVisible();

  // ------------------------------------------------------------------
  // Case 2: reload survival. A hard `page.reload()` on `/settings` must
  // re-render the same static-export route (not a 404) -- proven live here,
  // not only via Plan 29-01's `npm run build` artifact check.
  // ------------------------------------------------------------------
  await page.reload();

  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" }),
    "page.reload() on /settings must re-render the shell's <h1>, not a 404",
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Settings navigation" }),
    "page.reload() on /settings must re-render the jump-nav landmark",
  ).toBeVisible();
  await expect(
    page.getByTestId("settings-back-to-vault"),
    "page.reload() on /settings must re-render the back-to-vault link",
  ).toBeVisible();
  await expect(
    page.getByTestId("unlock-password"),
    "reload is a full navigation too -- the vault must be locked again, same singleton-drop reasoning as Case 1",
  ).toBeVisible();

  await page.getByTestId("unlock-password").fill(SESSION_PASSWORD);
  await page.getByTestId("unlock-submit").click();
  await expect(page.getByTestId("settings-section-konto")).toBeVisible();

  // ------------------------------------------------------------------
  // Case 3: browser back. `settings-back-to-vault` is a real `next/link`
  // client-side transition (Plan 29-01/29-03) -- it must NOT drop the
  // in-memory unlock singleton, unlike Cases 1/2's full navigations.
  // ------------------------------------------------------------------
  await page.getByTestId("settings-back-to-vault").click();
  await expect(
    page.getByTestId("new-item-button"),
    "the back-to-vault link must land on a usable, still-unlocked vault",
  ).toBeVisible();

  // Client-side transition back to /settings -- corroborates the <Link>
  // design rationale from 29-01/29-03: NO unlock prompt this time.
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByTestId("sidebar-open-settings").click();
  await expect(
    page.getByTestId("settings-section-konto"),
    "a client-side <Link> transition back to /settings must reach real content directly",
  ).toBeVisible();
  await expect(
    page.getByTestId("unlock-password"),
    "a client-side transition must NOT drop the in-memory unlock singleton -- no re-unlock prompt expected",
  ).not.toBeVisible();

  // A real page.goBack() must return to a usable vault.
  await page.goBack();
  await expect(
    page.getByTestId("new-item-button"),
    "browser back from /settings must genuinely return to a usable vault",
  ).toBeVisible();

  expect(dialogFired(), "zero OS-level dialogs across this whole session").toBe(false);

  await context.close();
});

// WR-09 (code review, Phase 29): `page.test.tsx`'s own `panel=settings`
// redirect test is fully mocked (`next/navigation`'s `useRouter` is a
// vitest mock), so nothing in that unit suite proves the URL actually stops
// carrying `?panel=settings` after the redirect -- the shipped-0.4.0-
// extension contract this whole phase exists to protect. This is the live
// proof: a real browser navigation to `/?panel=settings`, asserting
// `page.url()` lands on `/settings` with NO query string.
test("navigating to /?panel=settings live strips the query string -- page.url() ends in /settings with none left over (WR-09)", async ({
  browser,
}) => {
  const { context, page, dialogFired } = await newBareContext(browser);
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const email = `pv-e2e-settings-panel-query-${unique}@example.test`;

  await page.goto("/");
  await page.getByRole("button", { name: "No account yet? Sign up" }).click();
  await page.getByTestId("register-email").fill(email);
  await page.getByTestId("register-password").fill(SESSION_PASSWORD);
  await page.getByTestId("register-confirm-password").fill(SESSION_PASSWORD);
  await page.getByTestId("register-submit").click();
  await page.getByTestId("new-item-button").waitFor({ state: "visible" });

  await page.goto("/?panel=settings");
  await page.getByTestId("unlock-password").waitFor({ state: "visible" });
  await page.getByTestId("unlock-password").fill(SESSION_PASSWORD);
  await page.getByTestId("unlock-submit").click();
  await page.getByTestId("settings-section-konto").waitFor({ state: "visible" });

  const url = new URL(page.url());
  expect(url.pathname, "must land on the real /settings route").toBe("/settings");
  expect(url.search, "must carry NO leftover query string -- ?panel=settings must not survive the redirect").toBe(
    "",
  );

  expect(dialogFired(), "zero OS-level dialogs across this session").toBe(false);

  await context.close();
});
