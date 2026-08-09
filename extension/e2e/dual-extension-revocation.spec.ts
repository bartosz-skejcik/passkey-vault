// extension/e2e/dual-extension-revocation.spec.ts -- 27-11-PLAN.md Task 2:
// the LIVE post-revocation-staleness proof. STATE.md's own Phase 25 lesson
// ("the resolve_access is the sole enforcement point premise was false")
// is a direct warning against trusting one code-review pass over a
// cross-cutting authorization property -- this spec supplies the live
// evidence collections-store.ts's WR-02 eviction loop (27-03/27-04) and
// vault-store.ts's doHandleSharedRevisions purge (27-04) genuinely close
// T-27-24: a member revoked WHILE their extension session stays unlocked
// (no lock/unlock cycle on either side) loses visibility of the revoked
// collection's items on their NEXT sync poll, not merely "would, in
// principle, once they happen to re-authenticate".
//
// Provisioning reuses fixtures-account-setup.ts's setupSharedFixture()
// verbatim (the SAME account/family/collection/item shape
// dual-extension-sharing.spec.ts already proves the RECIPIENT-side read
// path with) -- this spec's own addition is `revokeMemberBAccess()`, a
// closure the fixture returns that calls the real server-side revoke
// endpoint (`DELETE /api/vault/collections/{id}/access/{user_id}`,
// collections.rs::revoke_access) directly, mirroring how
// fixtures-account-setup.ts already sets UP sharing state via direct REST
// calls rather than the web UI.
//
// Why this genuinely needs a real ~1-minute wait, not a "force a sync tick"
// shortcut: collections.rs::revoke_access deliberately resolves its
// WS-fanout recipient list AFTER the DELETE (T-23-10's mitigation -- "never
// notify a removed member of their own removal through the very channel
// being cut"), so member B's own WebSocket receives NOTHING about this
// revocation, ever. B's ONLY path to discover it is sync-client.ts's
// alarm-backed poll fallback (POLL_PERIOD_MINUTES = 1, chrome.alarms
// clamps periodInMinutes to >= 1 minute in release builds) -- this spec's
// grep of the e2e harness for a documented "force a sync tick" helper (this
// plan's own read_first instruction) found none, so it waits out the real
// poll-alarm interval via Playwright's own auto-retrying `expect(...)`
// polling, exactly as 27-11-PLAN.md's own action text names as the
// fallback when no such helper exists.
//
// Headless is fine here -- no WebAuthn ceremony anywhere in this spec (only
// the password-sign-in branch of the server-origin ceremony window,
// identical to dual-extension-sharing.spec.ts), so this spec runs in the
// `chromium` project (not `chromium-ceremony`).
import { expect, test } from "./fixtures";
import { setupSharedFixture, SERVER } from "./fixtures-account-setup";
import type { Page } from "@playwright/test";

// This spec's own tsconfig program has no @types/chrome (same precedent as
// dual-extension-sharing.spec.ts/dual-browser.spec.ts) -- every use of
// `chrome.*` below runs INSIDE `popup.evaluate()` callbacks, i.e. in the
// real extension popup-document context where `chrome` truly is a global at
// runtime.
declare const chrome: any; // eslint-disable-line @typescript-eslint/no-explicit-any

// Ported verbatim from dual-extension-sharing.spec.ts's own identically-named
// helpers (27-04-PLAN.md Task 3) -- deliberately duplicated, not extracted
// into a shared module, matching fixtures.ts's own explicit precedent for
// extContextB ("kept additive so a future reader can diff the two pairs
// line-for-line; a shared helper is a legitimate follow-up but out of this
// plan's file scope").
async function ensureServerConfigured(popup: Page): Promise<void> {
  const urlInput = popup.locator("input#pv-server-url");
  if (await urlInput.count()) {
    await urlInput.fill(SERVER);
    await popup.locator('button[type="submit"]').first().click();
  }
}

async function signInWithPassword(popup: Page, email: string, password: string): Promise<void> {
  const signInBtn = popup.locator('[data-testid="server-ceremony-signin-button"]');
  await signInBtn.waitFor({ timeout: 15000 });
  const [ceremonyPage] = await Promise.all([popup.context().waitForEvent("page"), signInBtn.click()]);
  await ceremonyPage.locator("input#pv-ext-unlock-email").fill(email);
  await ceremonyPage.locator("input#pv-ext-unlock-password").fill(password);
  await ceremonyPage.locator('[data-testid="ext-unlock-password-submit"]').click();
  await Promise.race([
    ceremonyPage.waitForEvent("close", { timeout: 15000 }).catch(() => {}),
    popup.waitForSelector("select", { timeout: 20000 }).catch(() => {}),
  ]);
}

/** 27-14 Task 2 (Gap 5 fix): ported verbatim from
 * dual-extension-sharing.spec.ts's own identically-named helper -- this
 * file did not define it before, and `signInAndUnlock` below now needs it
 * as the same service-worker-readiness barrier that closes the diagnosed
 * cold-MV3-wake race (27-VERIFICATION.md's own Gap 5, observed against
 * this spec's sibling file, applied here identically since the race
 * applies equally to both). */
async function getServiceWorker(
  context: import("@playwright/test").BrowserContext,
): Promise<import("@playwright/test").Worker> {
  let [worker] = context.serviceWorkers().filter((w) => w.url().startsWith("chrome-extension://"));
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 20000 });
  }
  return worker;
}

/** 27-14 Task 2 (Gap 5 fix): the verifier's own diagnosed cause of
 * 27-VERIFICATION.md's Gap 5 -- 2 of 6 attempts failed, always at THIS
 * function's own first `waitForSelector`, a cold MV3 service-worker wake
 * racing the popup's own first `chrome.runtime.sendMessage` call. Awaiting
 * `getServiceWorker(context)` as the very first line closes that race by
 * ensuring the background is genuinely resolvable before any message is
 * sent to it. */
async function signInAndUnlock(
  context: import("@playwright/test").BrowserContext,
  popup: Page,
  email: string,
  password: string,
): Promise<void> {
  await getServiceWorker(context);
  const cfg = await popup.evaluate(() => chrome.runtime.sendMessage({ kind: "config.get" }));
  if (cfg === null) {
    await ensureServerConfigured(popup);
  }
  await popup.waitForSelector(
    '[data-testid="server-ceremony-signin-button"], input[type="password"], select',
    { timeout: 20000 },
  );
  if (await popup.locator('[data-testid="server-ceremony-signin-button"]').count()) {
    await signInWithPassword(popup, email, password);
  } else if (await popup.locator('input[type="password"]').count()) {
    await popup.fill('input[type="password"]', password);
    await popup.locator('button[type="submit"]').first().click();
  }
  await popup.waitForSelector("select", { timeout: 20000 });
}

test("a member revoked mid-session, with no lock/unlock cycle, loses visibility of the revoked collection's items on the next sync poll", async ({
  extContextB,
  extensionIdB,
}) => {
  // Real Argon2id KDF (register) + a real password-unlock ceremony + a
  // bounded wait for the eager shared-revisions pull (presence half) + a
  // real ~1-minute alarm-backed poll wait (absence half, see this file's
  // own header comment) -- generous but bounded.
  test.setTimeout(240_000);

  const fixture = await setupSharedFixture();

  const popupB = await extContextB.newPage();
  await popupB.goto(`chrome-extension://${extensionIdB}/popup.html`);
  await signInAndUnlock(extContextB, popupB, fixture.memberBEmail, fixture.memberBPassword);

  // PRESENCE first (Pitfall 2's discipline, applied to a negative
  // assertion this plan's own acceptance criteria names explicitly): a
  // bare absence check could pass trivially before the item was ever
  // visible at all -- this is the same class of vacuous-guard defect
  // web/e2e/sharing.spec.ts's own header comment warns "survived a total
  // feature regression" once already (WINDOWS #2/27-CONTEXT.md).
  await expect(popupB.getByText(fixture.sharedItemName, { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(popupB.getByText(fixture.sharedTotpItemName, { exact: true })).toBeVisible({
    timeout: 30000,
  });

  // Revoke member B's access to the WHOLE collection via a direct
  // server-side API call -- mirrors Phase 25's own server-side
  // revoke/remove-member test pattern (crates/pv-server/tests/collections.rs)
  // and this codebase's established REST-fixture precedent
  // (fixtures-account-setup.ts's own header comment: "never drives the web
  // app's UI"). B's extension session is NEVER touched here -- no lock, no
  // unlock, no reload -- this is the whole point of the proof: access is
  // lost while the session stays alive.
  await fixture.revokeMemberBAccess();

  // ABSENCE second, on BOTH items in the now-revoked collection (T-27-24's
  // own threat register wording: "a revoked member's still-unlocked
  // extension continuing to serve stale shared data"). Bounded to allow
  // sync-client.ts's real alarm-backed poll fallback (up to ~1 real minute,
  // chrome.alarms' own release-build floor) to fire and land
  // doHandleSharedRevisions's purge -- see this file's own header comment
  // for why no faster "force a tick" mechanism exists in this codebase's
  // e2e harness today.
  await expect(popupB.getByText(fixture.sharedItemName, { exact: true })).toHaveCount(0, {
    timeout: 100000,
  });
  await expect(popupB.getByText(fixture.sharedTotpItemName, { exact: true })).toHaveCount(0, {
    timeout: 100000,
  });

  // No passkey is shared in this fixture (setupSharedFixture() creates a
  // login + a totp item only -- setupSharedPasskeyCollectionFixture() is a
  // SEPARATE fixture, 27-06's own), so this plan's own conditional
  // "if a passkey was also shared" bonus clause does not apply here --
  // documented rather than silently skipped.
});
