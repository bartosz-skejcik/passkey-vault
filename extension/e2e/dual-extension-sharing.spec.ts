// extension/e2e/dual-extension-sharing.spec.ts — 27-04-PLAN.md (Task 3): the
// phase's headline live proof. Member A shares a collection+item with member
// B via direct pv-server API calls (fixtures-account-setup.ts, entirely
// REST-level, never driving the web app's UI), then member A's and member
// B's REAL, independent extension instances (27-01's proven two-context
// harness) each sign in and unlock through the real popup UI. The single
// assertion that matters: member B's popup, which authored nothing and only
// received a share, displays the EXACT plaintext name of the item member A
// shared -- a positive, present, populated string match, never a mere count
// change or "no error" (27-RESEARCH.md's own vacuous-assertion-trap
// warning). This is exactly the class of bug Phase 26 shipped twice (a
// server-side read path with zero client consumer) — this spec proves the
// RECIPIENT side specifically, live.
//
// Sign-in interaction pattern ported verbatim from dual-browser.spec.ts's
// own `ensureServerConfigured`/`signInWithPassword` helpers (this codebase's
// existing, already-proven extension-popup sign-in/unlock driver) —
// generalized to accept an arbitrary popup `Page` + email/password pair
// instead of that file's single shared module-level account, so it can
// drive BOTH `extContext` (member A) and `extContextB` (member B)
// independently.
//
// Headless is fine here -- no WebAuthn ceremony anywhere in this spec (only
// the password-sign-in branch of the server-origin ceremony window), so this
// spec runs in the `chromium` project (not `chromium-ceremony`).
import { expect, test } from "./fixtures";
import { setupSharedFixture, computeTotpCandidates, SERVER } from "./fixtures-account-setup";
import type { Page } from "@playwright/test";

// This spec's own tsconfig program has no @types/chrome (same precedent as
// dual-browser.spec.ts) -- every use of `chrome.*` below runs INSIDE
// `popup.evaluate()` callbacks, i.e. in the real extension popup-document
// context where `chrome` truly is a global at runtime.
declare const chrome: any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** 27-11 Task 1: resolves the real background service-worker Page object for
 * a worker-scoped extension context -- mirrors fixtures.ts's own
 * extensionId resolution (same `serviceWorkers()`-then-`waitForEvent`
 * fallback), generalized to hand back the worker itself rather than just its
 * URL, since the storage audit needs to `evaluate()` INSIDE that context. */
async function getServiceWorker(
  context: import("@playwright/test").BrowserContext,
): Promise<import("@playwright/test").Worker> {
  let [worker] = context.serviceWorkers().filter((w) => w.url().startsWith("chrome-extension://"));
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 20000 });
  }
  return worker;
}

async function ensureServerConfigured(popup: Page): Promise<void> {
  const urlInput = popup.locator("input#pv-server-url");
  if (await urlInput.count()) {
    await urlInput.fill(SERVER);
    await popup.locator('button[type="submit"]').first().click();
  }
}

/** Drives the real server-origin sign-in ceremony window (AUTH-01's
 * password branch, ExtUnlockBridge.tsx `mode:"signin"`) -- ported verbatim
 * from dual-browser.spec.ts's own `signInWithPassword`, generalized to a
 * caller-supplied `popup`/`email`/`password` rather than that file's single
 * shared module-level account. */
async function signInWithPassword(popup: Page, email: string, password: string): Promise<void> {
  const signInBtn = popup.locator('[data-testid="server-ceremony-signin-button"]');
  await signInBtn.waitFor({ timeout: 15000 });
  const [ceremonyPage] = await Promise.all([popup.context().waitForEvent("page"), signInBtn.click()]);
  await ceremonyPage.locator("input#pv-ext-unlock-email").fill(email);
  await ceremonyPage.locator("input#pv-ext-unlock-password").fill(password);
  await ceremonyPage.locator('[data-testid="ext-unlock-password-submit"]').click();
  // The background closes the ceremony window itself on every resolution
  // path -- wait for either that self-close, or the popup's own view
  // advancing past the unlock screen (the item-list view's own established
  // "select" selector), whichever observably happens first.
  await Promise.race([
    ceremonyPage.waitForEvent("close", { timeout: 15000 }).catch(() => {}),
    popup.waitForSelector("select", { timeout: 20000 }).catch(() => {}),
  ]);
}

/** Full sign-in-or-unlock drive for a genuinely fresh persistent-context
 * popup (27-01's own `extContext`/`extContextB` pair always launches an
 * anonymous temp profile per test run -- `config.get` is always null and the
 * account is always signed OUT at the start, so the sign-in branch below is
 * this spec's only reachable path in practice; the locked/already-unlocked
 * branches are kept for the same defensive resilience
 * `ensureVaultReady`/`signInWithPassword` already established in
 * dual-browser.spec.ts). */
async function signInAndUnlock(popup: Page, email: string, password: string): Promise<void> {
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

test("member B's extension displays the exact plaintext name of the item member A shared", async ({
  extContext,
  extensionId,
  extContextB,
  extensionIdB,
}) => {
  // Real Argon2id KDF (register, twice) + two real password-unlock
  // ceremonies + a bounded wait for the eager shared-revisions pull --
  // generous but bounded, mirrors dual-browser.spec.ts's own per-test
  // timeout rationale for real-crypto-bound flows.
  test.setTimeout(240_000);

  const fixture = await setupSharedFixture();

  const popupA = await extContext.newPage();
  await popupA.goto(`chrome-extension://${extensionId}/popup.html`);
  await signInAndUnlock(popupA, fixture.memberAEmail, fixture.memberAPassword);

  const popupB = await extContextB.newPage();
  await popupB.goto(`chrome-extension://${extensionIdB}/popup.html`);
  await signInAndUnlock(popupB, fixture.memberBEmail, fixture.memberBPassword);

  // THE headline assertion of this phase (27-CONTEXT.md's own framing):
  // member B's extension, which authored nothing and only received a share,
  // correctly decrypts and displays member A's item. A positive, present,
  // populated assertion on the exact plaintext string -- never a mere count
  // change or an absence check (27-RESEARCH.md Pitfall 2), bounded to allow
  // for the eager shared-revisions pull (ensureVaultSyncStarted's
  // refreshCollectionsNow()/refreshSharedItemsNow()) to land after unlock.
  await expect(popupB.getByText(fixture.sharedItemName, { exact: true })).toBeVisible({
    timeout: 30000,
  });

  // 27-05 Task 2 (EXT-08): the SECOND shared item -- a real `type: "totp"`
  // item with a fixed, known secret -- must ALSO have landed by now (same
  // shared-revisions pull as the login item above; a positive, present,
  // populated assertion on its own exact plaintext name).
  await expect(popupB.getByText(fixture.sharedTotpItemName, { exact: true })).toBeVisible({
    timeout: 30000,
  });

  // THE byte-equality proof (A-6/EXT-08): member B's extension is asked to
  // generate a TOTP code for the SHARED item via the exact same message the
  // real "Na tej stronie" TOTP fill row (`TotpFillRow.tsx`'s `onPeekTotp`)
  // and the popup-driven autofill channel both dispatch --
  // `autofill.totpCode` -- proving the Collection-Key decrypt path
  // (`decryptItemForCollection`/`decryptDirectSharedRow`) yields
  // byte-identical secret material to the personal User-Key path, since
  // `handleAutofillTotpCode` (autofill-match.ts) is UNCHANGED by this
  // plan -- it reads `getItems()` with zero type-narrowing on
  // `collectionId`/`accessLevel` (27-RESEARCH.md's own "already
  // scope-agnostic" finding). Dispatched directly against the background
  // (rather than driving the "Na tej stronie" UI) for a deterministic,
  // single fixed-time-step round trip: no page-origin/issuer-match
  // dependency to also set up.
  const totpResult = (await popupB.evaluate(
    (itemId) => chrome.runtime.sendMessage({ kind: "autofill.totpCode", itemId }),
    fixture.sharedTotpItemId,
  )) as { ok: true; code: string; secondsRemaining: number } | { ok: false; reason: string };
  expect(totpResult.ok).toBe(true);
  const returnedCode = (totpResult as { ok: true; code: string }).code;

  // {current, previous} candidates, computed from the SAME known secret
  // INDEPENDENTLY of the extension under test, immediately after reading
  // its own returned code -- a bounded 2-candidate window, never an
  // unbounded pass, since `pv-core/src/totp.rs`'s `generate_code` never
  // reads the clock itself and this live round trip can legitimately
  // straddle a 30-second period boundary between the background's own
  // `now` read and this one (27-05-PLAN.md Task 2's own instruction --
  // "not cosmetic").
  const nowSeconds = Math.floor(Date.now() / 1000);
  const candidates = await computeTotpCandidates(
    fixture.sharedTotpSecret,
    fixture.sharedTotpAlgorithm,
    fixture.sharedTotpDigits,
    fixture.sharedTotpPeriod,
    nowSeconds,
  );
  expect(candidates).toContain(returnedCode);

  // "No TOTP secret -> no TOTP affordance" truth: the ORIGINAL shared login
  // item (`fixture.sharedItemName`) carries no `totp` field at all --
  // opening its detail view must render no "Secret (base32)" row, exactly
  // like a personal login item (ItemDetailView.tsx's `FIELD_ORDER.login`
  // has no `secret` entry; this asserts that holds for a REAL shared item
  // too, not merely by type-system construction). A positive, present
  // assertion the OPPOSITE way round from the headline proof above: proving
  // an affordance's ABSENCE by first proving the item's own name IS visible
  // (so this is never a vacuous "nothing rendered because nothing loaded"
  // pass, 27-RESEARCH.md's vacuous-assertion-trap warning).
  await popupB.getByText(fixture.sharedItemName, { exact: true }).click();
  await expect(popupB.getByText("Password", { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(popupB.getByText("Secret (base32)")).toHaveCount(0);

  // 27-11 Task 1 (EXT-11's whole-phase chrome.storage.session audit): run
  // AFTER every crypto path this test exercises has actually executed
  // (identity-keypair unwrap, Collection Key unseal/decrypt, the
  // shared-revisions merge, the reveal above) -- a live enumeration of
  // member B's OWN service-worker chrome.storage.session key set, never an
  // inference from reading collections-store.ts's/identity-store.ts's own
  // header comments. Allowed set is this codebase's pre-Phase-27 baseline
  // (session-storage.ts) plus provider-ceremony.ts's/server-unlock.ts's own
  // pre-existing transient records (none of which ran in this spec, so in
  // practice only the two session-storage.ts keys are expected -- the wider
  // allow-list is deliberate belt-and-suspenders, not a loosened bar: EVERY
  // entry in it predates this phase).
  const ALLOWED_SESSION_STORAGE_KEYS = new Set([
    "pv-session-meta", // session-storage.ts's SessionMeta record
    "pv-uk-envelope", // session-storage.ts's KeyEnvelope record
    "pv-pending-provider-ceremony", // provider-ceremony.ts -- mid-ceremony only, none ran here
    "pv-pending-provider-items", // provider-ceremony.ts's own sibling record
    "pv-server-unlock-pending", // server-unlock.ts's single-use nonce, cleared on every resolution path
  ]);
  const workerB = await getServiceWorker(extContextB);
  const sessionStorageDump = (await workerB.evaluate(() =>
    chrome.storage.session.get(null),
  )) as Record<string, unknown>;
  const observedKeys = Object.keys(sessionStorageDump);
  const unexpectedKeys = observedKeys.filter((k) => !ALLOWED_SESSION_STORAGE_KEYS.has(k));
  expect(
    unexpectedKeys,
    `chrome.storage.session gained an unexpected key -- full observed key set: ${JSON.stringify(observedKeys)}`,
  ).toEqual([]);
  // T-27-05/EXT-11's own explicit prohibition, checked directly on the
  // ACTUAL live key names (never inferred from source): no key ever carries
  // "identity"/"collection"/"sealed" -- the identity secret key and every
  // Collection Key stay module-memory-only, re-derived per MV3 wake.
  const forbiddenSubstringKeys = observedKeys.filter((k) => /identity|collection|sealed/i.test(k));
  expect(
    forbiddenSubstringKeys,
    `chrome.storage.session leaked identity/collection/sealed key material -- full observed key set: ${JSON.stringify(observedKeys)}`,
  ).toEqual([]);
});
