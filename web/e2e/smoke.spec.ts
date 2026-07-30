// web/e2e/smoke.spec.ts -- the first real automated proof that this phase's
// new Playwright harness itself works (23-04-PLAN.md, Task 2): a real
// pv-server boots via `webServer`, and two genuinely independent
// authenticated sessions (two separate `browser.newContext()` calls, two
// separate real accounts) come up with zero OS-level dialogs and zero
// shared state between them. Plan 23-06 builds the actual shared-sync proof
// specs on top of this harness; this file only proves the harness itself.
import { test, expect } from "./fixtures";

test("two independent sessions authenticate with distinct tokens and reach the vault", async ({
  twoSessions,
}) => {
  const [sessionA, sessionB] = twoSessions;

  // Both pages already reached the authenticated vault view during fixture
  // setup (new-item-button visible) -- re-assert independently here so this
  // spec's own failure output names the exact expectation, and so both
  // sessions are checked to be simultaneously live (not one torn down
  // before the other is checked).
  await expect(sessionA.page.getByTestId("new-item-button")).toBeVisible();
  await expect(sessionB.page.getByTestId("new-item-button")).toBeVisible();
  await expect(sessionA.page.getByTestId("sidebar-nav-all")).toBeVisible();
  await expect(sessionB.page.getByTestId("sidebar-nav-all")).toBeVisible();

  // Different accounts, so their emails must differ (fixture generates a
  // per-run unique local-part per session).
  expect(sessionA.email).not.toBe(sessionB.email);

  // The real assertion this whole harness exists to prove: two independent
  // `browser.newContext()` calls hold two genuinely distinct bearer
  // tokens -- never a single context with a swapped token. `pv-session-token`
  // is the exact localStorage key `lib/auth/session.ts` writes.
  const tokenA = await sessionA.page.evaluate(() => window.localStorage.getItem("pv-session-token"));
  const tokenB = await sessionB.page.evaluate(() => window.localStorage.getItem("pv-session-token"));

  expect(tokenA).not.toBeNull();
  expect(tokenA).not.toBe("");
  expect(tokenB).not.toBeNull();
  expect(tokenB).not.toBe("");
  expect(tokenA).not.toBe(tokenB);

  // Zero OS-level dialogs (alert/confirm/prompt/beforeunload) during either
  // bring-up -- Phase 20's standing no-OS-dialog-in-automation rule, proven
  // via Playwright's own dialog-listener staying unfired for the whole
  // fixture lifetime, not just at the instant this assertion runs.
  expect(sessionA.dialogFired()).toBe(false);
  expect(sessionB.dialogFired()).toBe(false);

  // Both sessions can act independently at the same time without
  // interfering with each other -- open the new-item flow on A only, and
  // confirm B's own view is entirely unaffected.
  await sessionA.page.getByTestId("new-item-button").click();
  await expect(sessionA.page.getByTestId("type-picker-close")).toBeVisible();
  await expect(sessionB.page.getByTestId("type-picker-close")).not.toBeVisible();
});
