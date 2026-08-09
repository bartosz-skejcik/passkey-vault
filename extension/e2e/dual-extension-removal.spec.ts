// extension/e2e/dual-extension-removal.spec.ts -- 28-03-PLAN.md: the live
// proof that closes v0.4 audit Blocker 3 (FAM-07/08/09, KEY-06) for the
// EXTENSION client. Three tests land here across this plan's Tasks 2/3/5:
//
//   1. (Task 2) Fixture-validation smoke test -- proves the real,
//      exact-set-comparison-satisfying member-removal batch this file's own
//      `setupFamilyRemovalFixture()` builds is genuinely ACCEPTED (204, not
//      409) and genuinely revokes server-side access, with ZERO involvement
//      of any extension page/popup. This isolates the phase's highest-risk
//      crypto-construction work (Pitfall 2: `apply_member_removal_rekey`'s
//      exact-set guards 409 a bare/empty/wrong batch) from the UI-behavior
//      proof, per plan-checker feedback that the original bundled task
//      carried too much risk in one place.
//   2. (Task 3) The extension-UI purge proof -- closes the two-call-site
//      race the plan-review blocker identified (sync-client.ts's
//      `hasEverConfirmedFamilyMembership` armed by BOTH `pullOnce()` and
//      `vault-store.ts`'s earlier `refreshSharedItemsNow()`).
//   3. (Task 5) The suspension direct-bucket signal proof, both directions.
//
// Deliberately a DIFFERENT server path from `dual-extension-revocation.spec.ts`
// (which proves `collections::revoke_access`, a per-collection revoke) --
// this file proves `families.rs::remove_member`/`suspend_member`/
// `reinstate_member`, the whole-family-membership path. Per this plan's own
// Pitfall 1, `dual-extension-revocation.spec.ts`'s own mechanism is never
// touched or re-tested here.
//
// Headless is fine -- no WebAuthn ceremony anywhere in this spec (only the
// password-sign-in branch of the server-origin ceremony window, identical to
// dual-extension-revocation.spec.ts's own precedent), so this spec runs in
// the `chromium` project (not `chromium-ceremony`).
import { expect, test } from "./fixtures";
import { setupFamilyRemovalFixture, SERVER } from "./fixtures-account-setup";
import type { Page } from "@playwright/test";

// This spec's own tsconfig program has no @types/chrome (same precedent as
// dual-extension-sharing.spec.ts/dual-extension-revocation.spec.ts) -- every
// use of `chrome.*` below runs INSIDE `popup.evaluate()` callbacks, i.e. in
// the real extension popup-document context where `chrome` truly is a
// global at runtime.
declare const chrome: any; // eslint-disable-line @typescript-eslint/no-explicit-any

// Ported verbatim from dual-extension-revocation.spec.ts's own identically-
// named helpers -- deliberately duplicated, not extracted into a shared
// module, matching fixtures.ts's own explicit precedent for extContextB
// ("kept additive so a future reader can diff the two pairs line-for-line").
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

async function getServiceWorker(
  context: import("@playwright/test").BrowserContext,
): Promise<import("@playwright/test").Worker> {
  let [worker] = context.serviceWorkers().filter((w) => w.url().startsWith("chrome-extension://"));
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 20000 });
  }
  return worker;
}

/** Cold-MV3-wake service-worker-readiness barrier (27-14 Task 2's own gap
 * fix) -- awaiting `getServiceWorker(context)` FIRST closes the race between
 * a fresh service-worker wake and the popup's own first
 * `chrome.runtime.sendMessage` call. */
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

test("Task 2: the real member-removal batch is accepted (204, not 409) and genuinely severs the target's server-side access, with zero extension-page involvement", async () => {
  // Real Argon2id KDF (register/login for owner + target) + a real
  // Collection-Key generate/seal/unseal/rewrap sequence -- generous but
  // bounded (no polling/waiting in this test, only real crypto + REST).
  test.setTimeout(60_000);

  const fixture = await setupFamilyRemovalFixture();

  // PRESENCE first (this codebase's own established discipline for a
  // negative assertion -- see dual-extension-revocation.spec.ts's own header
  // comment): before removal, the target's OWN session genuinely has access.
  const preRemovalAccessRes = await fixture.fetchAsTarget(
    `/api/vault/collections/${fixture.collectionId}/access`,
  );
  expect(
    preRemovalAccessRes.status,
    "the target's own session must have live collection access before removal",
  ).toBe(200);

  const preRemovalSharedRes = await fixture.fetchAsTarget("/api/sync/shared");
  expect(
    preRemovalSharedRes.status,
    "the target's own session must have a live family membership before removal",
  ).toBe(200);

  // Trigger the real removal -- Pitfall 2: `removeTargetMember` builds a
  // REAL, exact-set-matching batch (never a bare/empty one) and submits
  // `DELETE /api/families/members/{target}`. A 409 here means the batch's
  // own construction is wrong (a missing collection/item/recipient against
  // the server's exact-set-comparison guard); this call itself asserts
  // success via its own `removeRes.status !== 204` throw.
  await fixture.removeTargetMember();

  // ABSENCE second, on BOTH the collection-access endpoint (the
  // per-collection re-key half, KEY-06) AND `/api/sync/shared` (the
  // whole-family-membership half, B-7's own discriminant endpoint -- this
  // is the SAME 404 the rest of this plan's client-side fix distinguishes
  // from "never had a family"). Both via the target's OWN, STILL-VALID
  // session token -- no re-login, no token reissue, proving server-side
  // enforcement is genuinely immediate on the next request.
  const postRemovalAccessRes = await fixture.fetchAsTarget(
    `/api/vault/collections/${fixture.collectionId}/access`,
  );
  expect(
    postRemovalAccessRes.status,
    "the target's own session must lose collection access on its very next request",
  ).toBe(404);

  const postRemovalSharedRes = await fixture.fetchAsTarget("/api/sync/shared");
  expect(
    postRemovalSharedRes.status,
    "the target's own session must lose family membership (the B-7 discriminant endpoint) on its very next request",
  ).toBe(404);
});

test("Task 3: a genuinely removed member's extension purges its shared cache -- and ONLY its shared cache -- on the next completed poll, closing the two-call-site race", async ({
  extContextB,
  extensionIdB,
}) => {
  // Real Argon2id KDF + a real password-unlock ceremony + a bounded wait for
  // the eager shared-revisions pull (presence half) + a real ~1-minute
  // alarm-backed poll wait (absence half, mirrors
  // dual-extension-revocation.spec.ts's own generous-but-bounded budget).
  test.setTimeout(240_000);

  const fixture = await setupFamilyRemovalFixture();

  const popupB = await extContextB.newPage();
  await popupB.goto(`chrome-extension://${extensionIdB}/popup.html`);
  await signInAndUnlock(extContextB, popupB, fixture.targetEmail, fixture.targetPassword);

  // PRESENCE first, on BOTH items -- and this ordering is the crux of this
  // test's own proof, not merely a formality: `signInAndUnlock`'s own
  // unlock necessarily runs `ensureVaultSyncStarted()`'s EAGER
  // `refreshSharedItemsNow()` to SUCCESS before this assertion can pass
  // (the shared item is only visible once that eager refresh has decrypted
  // and cached it). That success is precisely what Task 1's hoisted
  // `markFamilyMembershipConfirmed()` call arms the discriminant from --
  // making this test a genuine proof of the plan-review blocker fix, not a
  // repeat of Task 2's fixture-validation proof.
  await expect(popupB.getByText(fixture.itemName, { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(popupB.getByText(fixture.personalItemName, { exact: true })).toBeVisible({ timeout: 30000 });

  // Trigger the real removal -- STRICTLY AFTER B's unlock/eager-refresh
  // above (per this test's own header comment: the ordering IS the proof).
  // `sync-client.ts`'s own `pullOnce()` has not yet made its own first
  // shared round trip at this point (the alarm-backed poll fires on its own
  // ~1-minute cadence, started by `startSync()` inside `signInAndUnlock`'s
  // unlock, not yet ticked) -- so the NEXT poll tick's 404 is the FIRST 404
  // `sync-client.ts`'s own module has ever observed this session. It must
  // still purge, because `refreshSharedItemsNow()` already armed the (Task
  // 1-hoisted) discriminant during the eager unlock-time refresh above --
  // this is exactly the two-call-site race the plan-review blocker
  // identified.
  await fixture.removeTargetMember();

  // ABSENCE: the shared item is genuinely gone -- `toHaveCount(0)` is a
  // genuine-absence assertion (never rendered as a broken/pending row
  // either), bounded to allow the real alarm-backed poll fallback (up to
  // ~1 real minute, `chrome.alarms`' own release-build floor) to fire and
  // land `purgeSharedStateOnRemoval`.
  await expect(popupB.getByText(fixture.itemName, { exact: true })).toHaveCount(0, { timeout: 100000 });

  // KEY-06 adjacency, in the SAME test run: the target's OWN personal item
  // is STILL present and unchanged -- the purge must never over-reach into
  // personal data, which would be a worse defect than the one being fixed.
  await expect(popupB.getByText(fixture.personalItemName, { exact: true })).toBeVisible();
});
