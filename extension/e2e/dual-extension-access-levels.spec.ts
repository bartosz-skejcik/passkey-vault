// extension/e2e/dual-extension-access-levels.spec.ts -- 27-14-PLAN.md
// (Task 3): closes 27-VERIFICATION.md's Gap 3 -- "Phase 26's exact repeat
// shape". Every live fixture this phase shipped before this plan granted
// `edit` access only, so the two access levels whose ENTIRE point is
// RESTRICTING behavior -- `hidden_password` and read-only -- had never been
// exercised end-to-end, the same failure pattern that let Phase 26 ship
// `hidden_password` protecting nothing while the UI claimed it did, with
// 700+ unit tests green.
//
// Proves BOTH live, in one test:
//  - a hidden_password recipient CAN still autofill (the REAL page fills
//    with the real plaintext), and gets NO reveal and NO copy affordance in
//    the popup's own detail view (UX-4: both omitted entirely, not merely
//    disabled; the mask still renders; the honesty note renders).
//  - a read-only recipient's real capture-confirm write attempt is REFUSED
//    (the toast surfaces its own error state) BEFORE any encrypt call, and
//    the collection owner's copy of the item is genuinely unchanged
//    afterward -- exercising capture-handler.ts's ReadOnlyAccessError gate
//    for the first time with live evidence (27-07's own unit suite mocks
//    lib/crypto/wasm-loader and can only assert control flow).
//
// Every helper below (signInAndUnlock/ensureServerConfigured/
// signInWithPassword/getServiceWorker/cdpSession/cdpQuery/cdpClick/
// cdpClickAttr/waitForCdp/hasAttr/captureLoginPage) is ported verbatim from
// dual-extension-sharing.spec.ts's own ALREADY-FIXED (27-14 Task 2)
// versions -- this codebase's own established duplication precedent, per
// dual-extension-revocation.spec.ts's own header comment.
//
// Headless is fine here -- no WebAuthn ceremony anywhere in this spec (only
// the password-sign-in branch of the server-origin ceremony window), so
// this spec runs in the `chromium` project (not `chromium-ceremony`).
import { expect, test } from "./fixtures";
import {
  setupAccessLevelFixture,
  SERVER,
  ACCESS_LEVELS_FORM_PORT,
  ACCESS_LEVELS_FORM_ORIGIN,
} from "./fixtures-account-setup";
import type { Page } from "@playwright/test";
import http from "node:http";

// This spec's own tsconfig program has no @types/chrome (same precedent as
// dual-extension-sharing.spec.ts/dual-browser.spec.ts) -- every use of
// `chrome.*` below runs INSIDE `popup.evaluate()` callbacks, i.e. in the
// real extension popup-document context where `chrome` truly is a global at
// runtime.
declare const chrome: any; // eslint-disable-line @typescript-eslint/no-explicit-any

// Ported verbatim from dual-extension-sharing.spec.ts's own identically-
// named function (27-11 Task 3) -- this ONE page/origin serves both
// sub-tests below (fillable #u/#p inputs for the autofill half, a real
// submit handler for the capture half). Own port (ACCESS_LEVELS_FORM_PORT,
// fixtures-account-setup.ts), distinct from every other e2e fixture server
// in this suite -- 8620/8791/8792/8895/8896/8897/8899 are all already
// claimed by sibling spec files.
function captureLoginPage(): string {
  return `<!doctype html><html><body>
<h1>27-14 access-level form</h1>
<form id="f" autocomplete="on">
  <input id="u" type="text" name="username" autocomplete="username">
  <input id="p" type="password" name="password" autocomplete="current-password">
  <button id="s" type="submit">Sign in</button>
</form>
<script>
  document.getElementById('f').addEventListener('submit', (e) => {
    e.preventDefault();
    setTimeout(() => {
      const f = document.getElementById('f');
      if (f) f.remove();
      const d = document.createElement('p'); d.textContent = 'Welcome back!'; document.body.appendChild(d);
    }, 60);
  });
</script>
</body></html>`;
}

let accessLevelsFormServer: http.Server;

test.beforeAll(async () => {
  accessLevelsFormServer = http.createServer((_req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(captureLoginPage());
  });
  await new Promise<void>((resolve) => accessLevelsFormServer.listen(ACCESS_LEVELS_FORM_PORT, resolve));
});

test.afterAll(async () => {
  // http.Server#close()'s callback only fires once every existing
  // connection has ended -- mirrors dual-extension-sharing.spec.ts's own
  // documented closeAllConnections() fix (27-06-SUMMARY.md), ported
  // verbatim.
  accessLevelsFormServer?.closeAllConnections?.();
  await new Promise<void>((resolve) => accessLevelsFormServer?.close(() => resolve()));
});

// CDP closed-shadow-root helpers, ported verbatim from
// dual-extension-sharing.spec.ts's own proven pattern (itself ported from
// dual-browser.spec.ts/probe-phase11-capture.js) -- not re-derived, so this
// spec's own capture.confirm dispatch drives the SAME real save/update
// toast production code every other capture proof does.
async function cdpSession(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send("DOM.enable");
  // 28-01-PLAN.md Task 1: Runtime.enable is required for
  // Runtime.callFunctionOn (cdpText below) to resolve against a live
  // execution context -- DOM.enable alone is not sufficient.
  await client.send("Runtime.enable");
  return client;
}
type CdpNode = {
  nodeId: number;
  attributes?: string[];
  nodeType: number;
  nodeValue?: string;
  children?: CdpNode[];
  shadowRoots?: CdpNode[];
  contentDocument?: CdpNode;
};
async function cdpQuery(
  client: Awaited<ReturnType<typeof cdpSession>>,
  predicate: (node: CdpNode, attrs: Record<string, string>) => boolean,
) {
  const { root } = await client.send("DOM.getDocument", { depth: -1, pierce: true });
  const out: Array<{ node: CdpNode; attrs: Record<string, string> }> = [];
  function attrsOf(node: CdpNode): Record<string, string> {
    const m: Record<string, string> = {};
    if (node.attributes) {
      for (let i = 0; i < node.attributes.length; i += 2) m[node.attributes[i]] = node.attributes[i + 1];
    }
    return m;
  }
  function walk(node: CdpNode) {
    const attrs = attrsOf(node);
    if (predicate(node, attrs)) out.push({ node, attrs });
    if (node.children) for (const c of node.children) walk(c);
    if (node.shadowRoots) for (const sr of node.shadowRoots) walk(sr);
    if (node.contentDocument) walk(node.contentDocument);
  }
  walk(root as CdpNode);
  return out;
}
function hasAttr(a: Record<string, string>, n: string) {
  return Object.prototype.hasOwnProperty.call(a, n);
}
async function cdpClick(client: Awaited<ReturnType<typeof cdpSession>>, node: CdpNode) {
  const { model } = await client.send("DOM.getBoxModel", { nodeId: node.nodeId });
  const cx = (model.content[0] + model.content[4]) / 2;
  const cy = (model.content[1] + model.content[5]) / 2;
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: cx, y: cy, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx, y: cy, button: "left", clickCount: 1 });
}
async function cdpClickAttr(client: Awaited<ReturnType<typeof cdpSession>>, attrName: string, idx = 0) {
  const nodes = await cdpQuery(client, (_n, a) => hasAttr(a, attrName));
  if (!nodes.length) return false;
  await cdpClick(client, nodes[Math.min(idx, nodes.length - 1)].node);
  return true;
}

/** 28-01-PLAN.md Task 1: reads `.textContent` off a real DOM node found via
 * `cdpQuery`'s closed-shadow-root-piercing walk, via `DOM.resolveNode` +
 * `Runtime.callFunctionOn` -- the standard CDP idiom for reading a live
 * property off a node CDP itself found, since `page.evaluate()` cannot
 * reach into a CLOSED shadow root (the whole reason this file's CDP helpers
 * exist at all, per this file's own header comment). */
async function cdpText(
  client: Awaited<ReturnType<typeof cdpSession>>,
  node: CdpNode,
): Promise<string | null> {
  const { object } = await client.send("DOM.resolveNode", { nodeId: node.nodeId });
  const objectId = (object as { objectId?: string }).objectId;
  if (!objectId) return null;
  const { result } = await client.send("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: "function () { return this.textContent; }",
    returnByValue: true,
  });
  return (result.value as string | undefined) ?? null;
}

/** Finds the FIRST node whose `class` attribute matches exactly, and
 * returns its `.textContent` -- used to read the toast's title/message
 * copy, neither of which carries its own `data-pv-toast-*` attribute
 * (only interactive/structural elements do), so class-name matching is the
 * correct predicate here. */
async function cdpTextByClass(
  client: Awaited<ReturnType<typeof cdpSession>>,
  className: string,
): Promise<string | null> {
  const nodes = await cdpQuery(client, (_n, a) => a.class === className);
  if (!nodes.length) return null;
  return cdpText(client, nodes[0].node);
}

/** True when the FIRST node whose `class` attribute matches exactly also
 * carries the `hidden` attribute -- the toast's own `[hidden] { display:
 * none !important }` rule, so this is a genuine visibility check, not
 * merely "the element exists somewhere in the DOM". */
async function cdpClassIsHidden(
  client: Awaited<ReturnType<typeof cdpSession>>,
  className: string,
): Promise<boolean> {
  const nodes = await cdpQuery(client, (_n, a) => a.class === className);
  if (!nodes.length) return false;
  return hasAttr(nodes[0].attrs, "hidden");
}
async function waitForCdp<T>(fn: () => Promise<T | null>, timeout = 9000, interval = 300): Promise<T | null> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, interval));
  }
  return null;
}

/** Ported verbatim from dual-extension-sharing.spec.ts's own helper (27-11
 * Task 1). */
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

/** Ported verbatim from dual-extension-sharing.spec.ts's own ALREADY-FIXED
 * (27-14 Task 2) version -- awaits `getServiceWorker(context)` as the very
 * first line, closing 27-VERIFICATION.md's Gap 5 (a cold MV3
 * service-worker wake racing the popup's own first
 * chrome.runtime.sendMessage call). */
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

test("hidden_password autofills without reveal/copy, and read-only writes are refused", async ({
  extContext,
  extensionId,
  extContextB,
  extensionIdB,
}) => {
  // Real Argon2id KDF (register, twice) + two real password-unlock
  // ceremonies + a bounded wait for the eager shared-revisions pull, plus a
  // real capture-confirm round trip -- generous but bounded, mirrors
  // dual-extension-sharing.spec.ts's own per-test timeout rationale.
  test.setTimeout(180_000);

  const fixture = await setupAccessLevelFixture();

  const popupB = await extContextB.newPage();
  await popupB.goto(`chrome-extension://${extensionIdB}/popup.html`);
  await signInAndUnlock(extContextB, popupB, fixture.memberBEmail, fixture.memberBPassword);

  // --- 3. hidden_password, detail-view masking ---------------------------
  // Anchored (27-RESEARCH.md's own vacuous-assertion-trap discipline): the
  // item's own name is asserted present FIRST, before any absence check.
  await expect(popupB.getByText(fixture.hiddenPasswordItemName, { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await popupB.getByText(fixture.hiddenPasswordItemName, { exact: true }).click();

  const honestyNote = popupB.getByTestId("hidden-password-extension-note");
  await expect(honestyNote).toBeVisible({ timeout: 10000 });

  // No reveal button anywhere in this view -- a login item's ONLY
  // REVEALABLE_FIELDS entry is `password`, and it's omitted entirely for a
  // hidden_password grant (ItemDetailView.tsx's own `hidden` check), so a
  // global count-0 check is non-vacuous here (anchored above by the item
  // name + honesty note both being genuinely present first).
  await expect(popupB.getByRole("button", { name: /show password/i })).toHaveCount(0);

  // No copy button scoped to the password field's OWN row -- a login item
  // DOES have working copy buttons on username/notes, so this check must be
  // scoped to the password row specifically (via the honesty note's own
  // parent row), never a global count-0 (which would be trivially false).
  const passwordRow = honestyNote.locator("xpath=..");
  await expect(passwordRow.locator('button[aria-label*="Copy" i]')).toHaveCount(0);

  await popupB.getByRole("button", { name: "Back to list" }).click();

  // --- 4. hidden_password, autofill still works ---------------------------
  // A REAL fill drive, mirroring 27-14 Task 2's own new block in
  // dual-extension-sharing.spec.ts and dual-browser.spec.ts's P10-SC1
  // pattern: a positive, present, populated field-value match against the
  // fixture's own known plaintext, never a mere "no error" check.
  const fillTargetPage = await extContextB.newPage();
  await fillTargetPage.goto(`${ACCESS_LEVELS_FORM_ORIGIN}/`);
  await fillTargetPage.bringToFront();
  await popupB.reload();
  await popupB.waitForSelector("select", { timeout: 20000 });
  await popupB.waitForTimeout(1500);

  const fillBtn = popupB.locator(`[data-testid="autofill-fill-${fixture.hiddenPasswordItemId}"]`);
  await expect(fillBtn).toBeVisible({ timeout: 10000 });
  await fillBtn.click();
  await fillTargetPage.waitForFunction(
    () => (document.getElementById("u") as HTMLInputElement)?.value !== "",
    { timeout: 10000 },
  );
  const filledValues = await fillTargetPage.evaluate(() => ({
    u: (document.getElementById("u") as HTMLInputElement).value,
    p: (document.getElementById("p") as HTMLInputElement).value,
  }));
  expect(filledValues.u).toBe(fixture.hiddenPasswordItemUsername);
  expect(filledValues.p).toBe(fixture.hiddenPasswordItemPassword);
  await fillTargetPage.close();
  // AutofillItemRow.tsx's doFill() closes the popup on a CONFIRMED
  // successful fill (real production UX) -- popupB is not touched again in
  // this test, so no reopen is needed here (unlike 27-14 Task 2's own block
  // in dual-extension-sharing.spec.ts, which still had further popupB
  // assertions afterward).

  // --- 5. read-only (collection-scoped, non-edit), PROACTIVE write refusal
  // (28-01-PLAN.md Task 1, B-10/Warning 1: `update.blockedNoEditAccessBody`
  // covers BOTH plain read-only and hidden_password collection-scoped
  // access, since they now route through the identical gate). Before this
  // plan the toast opened in the ordinary "Update?" state and only
  // surfaced a generic error AFTER a confirm click was attempted; now it
  // must open DIRECTLY in the blocked state -- there is no Update button to
  // click at all (28-UI-SPEC.md E2, "suppressed, not failed").
  const readOnlyFormPage = await extContextB.newPage();
  await readOnlyFormPage.goto(`${ACCESS_LEVELS_FORM_ORIGIN}/`);
  await readOnlyFormPage.bringToFront();
  // Let content-relay's submit watcher attach (document_idle) before the
  // gesture below -- mirrors dual-extension-sharing.spec.ts's own
  // established wait.
  await readOnlyFormPage.waitForTimeout(1000);

  const readOnlyClient = await cdpSession(readOnlyFormPage);
  const attemptedNewPassword = `pv-e2e-access-level-readonly-attempt-${Date.now()}`;
  await readOnlyFormPage.fill("#u", fixture.readOnlyItemUsername);
  await readOnlyFormPage.fill("#p", attemptedNewPassword);
  // A real Enter-key submit dispatches a genuine `submit` event for
  // submit-capture.ts's watcher to detect -- mirrors 27-11's own
  // established precedent, sidestepping any coordinate-based click overlap
  // with the extension's own in-page overlay.
  await readOnlyFormPage.locator("#p").press("Enter");
  const toast = await waitForCdp(async () => {
    const t = await cdpQuery(readOnlyClient, (_n, a) => hasAttr(a, "data-pv-toast"));
    return t.length ? t : null;
  });
  expect(toast).toBeTruthy();
  // THE positive observation that the write was PROACTIVELY refused --
  // the message element is genuinely VISIBLE on first render (its `hidden`
  // attribute never applied), never a mere "the message element exists in
  // the DOM" check.
  const blockedSignal = await waitForCdp(async () => {
    const nodes = await cdpQuery(
      readOnlyClient,
      (_n, a) => hasAttr(a, "data-pv-toast-message") && !hasAttr(a, "hidden"),
    );
    return nodes.length ? nodes : null;
  });
  expect(blockedSignal).toBeTruthy();
  const readOnlyBlockedTitle = await cdpTextByClass(readOnlyClient, "pv-toast-title");
  expect(readOnlyBlockedTitle).toMatch(/Can't update|Nie można zaktualizować/);
  const readOnlyBlockedBody = await cdpTextByClass(readOnlyClient, "pv-toast-message");
  expect(readOnlyBlockedBody).toMatch(/edit access to this shared folder|uprawnień do edycji tego udostępnionego folderu/);
  // No password preview, no Update/Retry/Dismiss button -- genuine absence,
  // not merely disabled (28-01-PLAN.md acceptance criteria).
  expect(await cdpClassIsHidden(readOnlyClient, "pv-toast-preview-row")).toBe(true);
  expect(await cdpClassIsHidden(readOnlyClient, "pv-toast-actions")).toBe(true);
  const readOnlyConfirmNodes = await cdpQuery(readOnlyClient, (_n, a) => hasAttr(a, "data-pv-toast-confirm"));
  expect(readOnlyConfirmNodes).toHaveLength(0);
  await readOnlyFormPage.close();

  // --- 6. read-only, load-bearing proof -----------------------------------
  // Even if the toast's error-state timing were ever flaky, the owner's
  // copy staying byte-identical is the real, load-bearing proof of refusal
  // -- the write member B attempted never landed.
  const popupA = await extContext.newPage();
  await popupA.goto(`chrome-extension://${extensionId}/popup.html`);
  await signInAndUnlock(extContext, popupA, fixture.memberAEmail, fixture.memberAPassword);

  const searchBoxA = popupA
    .locator('input[type="search"], input[placeholder*="zukaj"], input[placeholder*="earch"]')
    .first();
  await searchBoxA.fill(fixture.readOnlyItemUsername);
  const readOnlyRow = popupA.getByText(fixture.readOnlyItemName, { exact: true });
  await expect(readOnlyRow).toHaveCount(1, { timeout: 30000 });
  await readOnlyRow.click();
  await popupA.getByRole("button", { name: /show password/i }).click();
  await expect(popupA.getByText(fixture.readOnlyItemOldPassword, { exact: true })).toBeVisible({
    timeout: 10000,
  });
});

// 28-01-PLAN.md Task 1 (B-4/B-5, closes v0.4 audit Blocker 2): the live
// proof that a DIRECT share's write refusal genuinely stops a wrong-key
// encrypt before it happens -- capture-handler.ts's own unit suite mocks
// lib/crypto/wasm-loader and can only assert control flow, never that a
// real crypto write was refused. No Save/Update button is ever clicked in
// this test -- there is none to click (the toast opens directly in the
// blocked state), which is what makes this a genuine proactive-blocked
// proof, not a reactive one.
test("direct share (hidden_password) write is refused BEFORE any encrypt call, owner's item stays byte-unchanged", async ({
  extContextB,
  extensionIdB,
}) => {
  // Real Argon2id KDF (register, twice) + two real password-unlock
  // ceremonies + a bounded wait for the eager shared-revisions pull, plus a
  // real capture-confirm round trip -- generous but bounded, mirrors this
  // file's own sibling test's per-test timeout rationale.
  test.setTimeout(180_000);

  const fixture = await setupAccessLevelFixture();

  const popupB = await extContextB.newPage();
  await popupB.goto(`chrome-extension://${extensionIdB}/popup.html`);
  await signInAndUnlock(extContextB, popupB, fixture.memberBEmail, fixture.memberBPassword);

  // Anchored (27-RESEARCH.md's own vacuous-assertion-trap discipline): the
  // direct share's own item name is asserted present FIRST -- this is what
  // actually gates the wait on the eager shared-revisions pull completing
  // (never a bare `waitForTimeout` guess), before the capture-submit gesture
  // below can possibly resolve the item as an 'update' against B's own
  // decrypted cache.
  await expect(popupB.getByText(fixture.hiddenPasswordItemName, { exact: true })).toBeVisible({
    timeout: 30000,
  });

  // --- direct share, PROACTIVE write refusal ------------------------------
  const directShareFormPage = await extContextB.newPage();
  await directShareFormPage.goto(`${ACCESS_LEVELS_FORM_ORIGIN}/`);
  await directShareFormPage.bringToFront();
  // Let content-relay's submit watcher attach (document_idle) before the
  // gesture below -- mirrors this file's own sibling test's established
  // wait.
  await directShareFormPage.waitForTimeout(1000);

  const directShareClient = await cdpSession(directShareFormPage);
  const attemptedNewPassword = `pv-e2e-access-level-direct-share-attempt-${Date.now()}`;
  await directShareFormPage.fill("#u", fixture.hiddenPasswordItemUsername);
  await directShareFormPage.fill("#p", attemptedNewPassword);
  // A real Enter-key submit dispatches a genuine `submit` event for
  // submit-capture.ts's watcher to detect -- mirrors 27-11's own
  // established precedent, sidestepping any coordinate-based click overlap
  // with the extension's own in-page overlay.
  await directShareFormPage.locator("#p").press("Enter");

  const toast = await waitForCdp(async () => {
    const t = await cdpQuery(directShareClient, (_n, a) => hasAttr(a, "data-pv-toast"));
    return t.length ? t : null;
  });
  expect(toast).toBeTruthy();
  // THE positive observation that the write was PROACTIVELY refused -- the
  // message element is genuinely VISIBLE on first render (its `hidden`
  // attribute never applied), never a mere "the message element exists in
  // the DOM" check.
  const blockedSignal = await waitForCdp(async () => {
    const nodes = await cdpQuery(
      directShareClient,
      (_n, a) => hasAttr(a, "data-pv-toast-message") && !hasAttr(a, "hidden"),
    );
    return nodes.length ? nodes : null;
  });
  expect(blockedSignal).toBeTruthy();

  const blockedTitle = await cdpTextByClass(directShareClient, "pv-toast-title");
  expect(blockedTitle).toMatch(/Can't update|Nie można zaktualizować/);
  const blockedBody = await cdpTextByClass(directShareClient, "pv-toast-message");
  expect(blockedBody).toMatch(/shared directly with you|udostępniony Ci bezpośrednio/);

  // No password preview, no Update/Retry/Dismiss button -- genuine
  // absence, not merely disabled (28-01-PLAN.md acceptance criteria).
  expect(await cdpClassIsHidden(directShareClient, "pv-toast-preview-row")).toBe(true);
  expect(await cdpClassIsHidden(directShareClient, "pv-toast-actions")).toBe(true);
  const confirmNodes = await cdpQuery(directShareClient, (_n, a) => hasAttr(a, "data-pv-toast-confirm"));
  expect(confirmNodes).toHaveLength(0);
  await directShareFormPage.close();

  // --- load-bearing proof (Blocker 2) -------------------------------------
  // Member A's own item never moved past its create-time revision -- a
  // successful (wrongly-keyed) write would have bumped it to 2 via a real
  // server PUT. A raw authenticated request as member A (see
  // getHiddenPasswordItemRevision's own doc comment in
  // fixtures-account-setup.ts), not a second popup-unlock round trip.
  const revisionAfter = await fixture.getHiddenPasswordItemRevision();
  expect(revisionAfter).toBe(1);
});
