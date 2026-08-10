// web/e2e/settings-jumpnav-labels.spec.ts -- Phase 29 gap closure
// (29-06-PLAN.md Task 3), 29-VERIFICATION.md's human_verification item 1.
//
// This is the retained, re-runnable successor to 29-01-PLAN.md's declared
// backstop ("all four Polish jump-nav labels render without clipping at
// 375px and inside the 200px desktop rail"). The original evidence was an
// ad-hoc Playwright measurement run once during Plan 29-01's execution and
// cited only in commit 8ef5f3e's message and a code comment -- never
// retained as a test.
//
// The lane choice is deliberately LIVE Playwright, not a vitest/jsdom unit
// test: jsdom implements no real layout engine -- every element's
// scrollWidth/clientWidth/getBoundingClientRect() height reads back as 0 in
// jsdom regardless of actual content, so a jsdom version of this assertion
// would trivially pass (0 === 0) whether or not "Rodzina i udostępnianie"
// (23 characters, the real pressure case) actually clips -- a fake
// backstop, worse than none. Only a real Chromium layout produces
// meaningful geometry here.
import { test, expect, newBareContext, SESSION_PASSWORD } from "./fixtures";

test("all four Polish jump-nav labels render without clipping at 375px and inside the 200px desktop rail", async ({
  browser,
}) => {
  const { context, page, dialogFired } = await newBareContext(browser);

  // newBareContext internally seeds pv-locale=en via its own
  // applyE2eInitScript -- since this spec's entire point is the Polish
  // label strings, register a second, later-registered init script that
  // overrides it to "pl". Playwright runs every context-registered
  // addInitScript in registration order before a navigating document's
  // first real script executes, so this script overwrites pv-locale to
  // "pl" before LocaleContext's own pre-hydration read (layout.tsx's inline
  // script, read once) ever observes it -- the net effect is "pl" for this
  // entire session, without needing to reimplement newBareContext's own
  // registration flow.
  await context.addInitScript(() => {
    window.localStorage.setItem("pv-locale", "pl");
  });

  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const email = `pv-e2e-jumpnav-labels-${unique}@example.test`;

  await page.goto("/");
  await page.getByRole("button", { name: "Nie masz konta? Zarejestruj się" }).click();
  await page.getByTestId("register-email").fill(email);
  await page.getByTestId("register-password").fill(SESSION_PASSWORD);
  await page.getByTestId("register-confirm-password").fill(SESSION_PASSWORD);
  await page.getByTestId("register-submit").click();
  await page.getByTestId("new-item-button").waitFor({ state: "visible" });

  // Navigate to /settings via the real sidebar gear, not a cold page.goto --
  // this is deliberate: a cold full navigation drops the in-memory unlock
  // singleton and renders the settings shell behind UnlockOverlay's
  // backdrop blur, which is exactly what made 29-01-SUMMARY.md's own ad-hoc
  // screenshots unusable (though it does not affect element geometry, per
  // that same SUMMARY's own note). The client-side <Link> transition avoids
  // the overlay entirely, giving a clean, fully-rendered page.
  await page.getByRole("button", { name: "Konto" }).click();
  await page.getByTestId("sidebar-open-settings").click();
  await page.getByTestId("settings-section-konto").waitFor({ state: "visible" });

  const nav = page.getByRole("navigation", { name: "Nawigacja ustawień" });
  await expect(nav).toBeVisible();

  const links = nav.getByRole("link");
  await expect(links).toHaveCount(4);

  async function assertNoClippingAndUniformHeight(viewportLabel: string): Promise<void> {
    const metrics = await links.evaluateAll((elements) =>
      elements.map((el) => ({
        text: el.textContent,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        height: el.getBoundingClientRect().height,
      })),
    );

    for (const m of metrics) {
      expect(
        m.scrollWidth,
        `label "${m.text}" at ${viewportLabel}: scrollWidth (${m.scrollWidth}) must equal clientWidth (${m.clientWidth}) -- a mismatch means this label's content overflows its own box (a clipped word)`,
      ).toBe(m.clientWidth);
    }

    const heights = metrics.map((m) => m.height);
    // Sub-pixel tolerance (< 1, not strict equality) deliberately -- this
    // tolerates float rounding across environments while still catching a
    // genuine multi-line wrap, which differs by tens of pixels, not
    // fractions of one.
    expect(
      Math.max(...heights) - Math.min(...heights),
      `at ${viewportLabel}: all four jump-nav links must share the same height -- a difference means one label wrapped to a second line while the others stayed on one`,
    ).toBeLessThan(1);
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await assertNoClippingAndUniformHeight("desktop 1280px rail");

  await page.setViewportSize({ width: 375, height: 800 });
  await assertNoClippingAndUniformHeight("mobile 375px pill row");

  expect(dialogFired(), "zero OS-level dialogs across this session").toBe(false);

  await context.close();
});
