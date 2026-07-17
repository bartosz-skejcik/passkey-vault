// extension/e2e/dual-browser.spec.ts — 13-03-PLAN.md's 21-SC Chromium
// harness. One test per Phase 9-12 success criterion (Phase 9 has SEVEN,
// not five -- 7+5+4+5 = 21), titles copied verbatim from ROADMAP.md so the
// mapping to 13-UAT-CHECKLIST.md is unambiguous. Grouped by originating
// phase via `test.describe()`.
//
// This suite builds ONE signed-in, passkey-enrolled, item-populated vault
// cumulatively (fixtures.ts's `context`/`extensionId` are worker-scoped;
// `playwright.config.ts` pins `workers: 1`/`fullyParallel: false`) -- tests
// run in file declaration order and later tests depend on state earlier
// tests created, mirroring this project's own prior-session UAT harnesses
// (chrome-idle-kill.js, popup-full-flow.js, probe-sc4567.js, ...) rather
// than isolated per-test fixtures, since a fresh Argon2id sign-in/enroll
// cycle 21 times over would be neither realistic nor a reasonable runtime.
//
// WebAuthn / CDP virtual-authenticator scoping (13-03-PLAN.md, narrow and
// precise):
//   - P12-SC1/SC2 (provider create()/get()): NO CDP virtual authenticator --
//     the real ProviderCeremonyView consent UI is driven directly.
//   - P12-SC3's fallthrough half: CDP virtual authenticator on the
//     THIRD-PARTY RP PAGE's own CDP session, fires only AFTER the shim
//     falls through via [data-testid=provider-decline].
//   - P9-SC2's ext-scoped PRF-unlock half: CDP virtual authenticator with
//     hasPrf:true on the POPUP's own CDP session (a genuine browser
//     WebAuthn call against the extension's own rpId, not a brokered
//     provider ceremony).
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import http from "node:http";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// extension/package.json has `"type": "module"` -- this file runs as real
// ESM (no `__dirname`), so `import.meta.url` + `fileURLToPath` is the
// correct replacement, not a CommonJS shim.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// This spec's own tsconfig program has no @types/chrome (production source
// under entrypoints/** always goes through `browser` from "wxt/browser"
// instead, never the raw `chrome.*` MV3 global) -- but every use of
// `chrome.*` below runs INSIDE `page.evaluate()`/`popup.evaluate()`
// callbacks, i.e. in the real extension page context where `chrome` truly
// is a global at runtime. This ambient `any`-typed declaration exists
// solely to satisfy `tsc --noEmit` for this test-only file; it intentionally
// does not attempt to model the real `chrome.*` surface.
declare const chrome: any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SERVER = "http://localhost:8620";
const EMAIL = "uat-prf04@example.local";
const PASSWORD = "CorrectHorseBattery-UAT-2026!";
const RUN = String(Date.now() % 100000);

// Fixture HTTP server for Phase 10/11/12 pages (login/signup/card/identity/
// provider-RP forms) -- one dependency-free node:http server for the whole
// suite, ports chosen to avoid collision with pv-server (:8620) and the
// pre-existing adversarial-iframe fixture (:8791/:8792).
const FORM_PORT = 8895;
const FORM_ORIGIN = `http://localhost:${FORM_PORT}`;
const ADV_DIR = path.resolve(__dirname, "../e2e-fixtures/adversarial-iframe");
const ORIGIN_A = "http://127.0.0.1:8791";

let popup: Page;
let webPage: Page | undefined;
let formServer: http.Server;
let sharedExtContext: import("@playwright/test").BrowserContext;
let sharedExtensionId: string;
let advA: ChildProcess | undefined;
let advB: ChildProcess | undefined;
const consoleErrors: string[] = [];

function loginPage(otp = true) {
  return `<!doctype html><html><body>
<h1>DBH login ${RUN}</h1>
<form id="f" autocomplete="on">
  <input id="u" type="text" name="username" autocomplete="username">
  <input id="p" type="password" name="password" autocomplete="current-password">
  ${otp ? '<input id="otp" type="text" name="otp" autocomplete="one-time-code" inputmode="numeric">' : ""}
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

function signupPage() {
  return `<!doctype html><html><body>
<h1>DBH signup ${RUN}</h1>
<form id="sf">
  <input id="su" type="text" name="username" autocomplete="username">
  <input id="np" type="password" name="new-password" autocomplete="new-password">
  <input id="cp" type="password" name="confirm-password" autocomplete="new-password">
  <button type="submit">Create account</button>
</form>
</body></html>`;
}

function cardIdentityPage() {
  return `<!doctype html><html><body>
<h1>DBH card+identity ${RUN}</h1>
<form id="card-form" autocomplete="on">
  <input id="cc-name" name="cc-name" type="text" autocomplete="cc-name">
  <input id="cc-number" name="cc-number" type="text" autocomplete="cc-number">
  <input id="cc-exp" name="cc-exp" type="text" autocomplete="cc-exp">
  <input id="cc-csc" name="cc-csc" type="text" autocomplete="cc-csc">
</form>
<form id="id-form" autocomplete="on">
  <input id="id-name" name="name" type="text" autocomplete="name">
  <input id="id-email" name="email" type="email" autocomplete="email">
  <input id="id-phone" name="tel" type="text" autocomplete="tel">
  <input id="id-address" name="street-address" type="text" autocomplete="street-address">
</form>
</body></html>`;
}

function providerPage() {
  return `<!doctype html><html><body><h1>DBH provider RP ${RUN}</h1></body></html>`;
}

test.beforeAll(async ({ extContext, extensionId }) => {
  sharedExtContext = extContext;
  sharedExtensionId = extensionId;
  popup = await extContext.newPage();
  popup.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
  });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  formServer = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    const url = req.url ?? "/";
    if (url.startsWith("/signup")) return res.end(signupPage());
    if (url.startsWith("/card-identity")) return res.end(cardIdentityPage());
    if (url.startsWith("/provider")) return res.end(providerPage());
    if (url.startsWith("/no-otp")) return res.end(loginPage(false));
    return res.end(loginPage(true));
  });
  await new Promise<void>((resolve) => formServer.listen(FORM_PORT, resolve));
});

test.afterAll(async () => {
  // A stabilization: keep-alive HTTP connections from the many form/
  // signup/login/rp pages opened across this suite can keep `formServer`'s
  // underlying sockets technically open past their own page's lifetime
  // (Node's default keep-alive timeout), which made a plain `server.close()`
  // wait out that natural expiry and blow the "afterAll" hook's own 30s
  // budget. `closeAllConnections()` force-closes them immediately -- every
  // page that needed them has already finished its own real work by the
  // time this hook runs, so nothing is lost by cutting them short here.
  formServer?.closeAllConnections();
  await new Promise((resolve) => formServer?.close(resolve));
  advA?.kill();
  advB?.kill();
});

test.beforeEach(() => {
  // 240s (not 120s): openWebApp()'s own up-to-3-attempt retry loop (each
  // attempt individually bounded at up to ~60s for its slowest wait) can
  // legitimately need more than 120s end-to-end under this dev machine's
  // real memory pressure -- a 120s outer test timeout was cutting the
  // retry loop off mid-attempt (killing attempt 2 before it could even
  // finish, let alone reach attempt 3), which looked identical to "no
  // retries happened" in the test log. This does not mask genuine
  // failures -- it just stops the OUTER timeout from out-racing the
  // INNER, already-bounded retry logic.
  test.setTimeout(240_000);
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function ensureServerConfigured(): Promise<void> {
  const urlInput = popup.locator("input#pv-server-url");
  if (await urlInput.count()) {
    await urlInput.fill(SERVER);
    await popup.locator('button[type="submit"]').first().click();
  }
}

async function signInWithPassword(): Promise<void> {
  const passwordField = popup.locator('input[type="password"]').first();
  await passwordField.waitFor({ timeout: 15000 });
  await popup.fill('input[type="email"]', EMAIL);
  await passwordField.fill(PASSWORD);
  await popup.locator('button[type="submit"]').first().click();
}

/** Defensive recovery from a confirmed Playwright-harness artifact (see
 * 13-03-SUMMARY.md's Deviations section for the full investigation): an
 * assertion/thrown-error failure inside an EARLIER test can leave
 * chrome.storage.local's "pv-server-config" unset by the time the NEXT
 * test's popup interaction starts -- reproduced deterministically (ANY
 * thrown error inside a test body triggers it, not any one specific
 * matcher/locator), and confirmed NOT caused by any product code path
 * (lockVaultSession() only ever touches chrome.storage.session, never
 * .local -- grep confirms no other file in this codebase clears
 * "pv-server-config"). Called only from Phase 10/11/12's `beforeEach`
 * (never Phase 9's, which deliberately exercises the real first-run/
 * unlock sequence itself) so one SC's genuine failure never cascades into
 * unrelated SCs' verdicts, without masking the ORIGINALLY failing SC's own
 * result. */
async function ensureVaultReady(): Promise<void> {
  // Every test starts with a genuinely FRESH web-app tab -- openWebApp()
  // reuses `webPage` WITHIN a single test (a test calling createWebItem()
  // more than once shouldn't pay a full sign-in twice), but never carries
  // a stale/previous test's tab forward into the next one.
  if (webPage && !webPage.isClosed()) {
    await webPage.close().catch(() => {});
  }
  webPage = undefined;

  // A successful UI-driven "Fill" gesture (TotpFillRow.tsx/
  // AutofillItemRow.tsx's handleFill(Click)) closes the popup window on
  // success -- real, intentional production UX (the user's job is done),
  // not a bug. Any test that clicks a real Fill button through to
  // completion legitimately ends its own test with the shared `popup`
  // page closed; recreate it here rather than treating that as failure.
  if (popup.isClosed()) {
    popup = await sharedExtContext.newPage();
    popup.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
    });
    await popup.goto(`chrome-extension://${sharedExtensionId}/popup.html`);
  }
  const cfg = await popup.evaluate(() =>
    chrome.runtime.sendMessage({ kind: "config.get" }),
  );
  if (cfg !== null) {
    return;
  }
  await ensureServerConfigured();
  await popup.waitForSelector('input[type="password"], select', { timeout: 20000 });
  if (await popup.locator('input[type="password"]').count()) {
    await signInWithPassword();
  }
  await popup.waitForSelector('select, button:has-text("Create a passkey")', {
    timeout: 60000,
  });
  const notNow = popup.locator("text=/Not now|Nie teraz/i");
  if (await notNow.count()) {
    await notNow.first().click();
  }
  await popup.waitForSelector("select", { timeout: 20000 });
}

async function openWebAppOnce(): Promise<Page> {
  if (webPage && !webPage.isClosed()) {
    await webPage.close().catch(() => {});
  }
  const ctxPage = await popup.context().newPage();
  webPage = ctxPage;
  await ctxPage.goto(`${SERVER}/`);
  const emailField = ctxPage.locator('input[type="email"]').first();
  if (await emailField.count()) {
    await emailField.waitFor({ timeout: 15000 });
    await emailField.fill(EMAIL);
    await ctxPage.locator('input[type="password"]').first().fill(PASSWORD);
    await ctxPage.locator('button[type="submit"]').first().click();
  }
  // TopBar's "new-item-button" is always mounted post-login (locked or
  // unlocked, per web/src/components/shell/TopBar.tsx -- not gated on
  // unlock state), a far more stable target than a generic "Wszystkie/All
  // items" text match, which can resolve to multiple (sidebar nav label,
  // empty-state heading, ...) simultaneously-rendering nodes and flake.
  await ctxPage.waitForSelector('[data-testid="new-item-button"]', { timeout: 60000 });
  await ctxPage.waitForTimeout(1200);
  const unlockSubmit = ctxPage.locator('[data-testid="unlock-submit"]');
  if (await unlockSubmit.count()) {
    await unlockSubmit.click();
    await ctxPage.waitForFunction(
      () => !document.querySelector('[data-testid="unlock-submit"]'),
      { timeout: 60000 },
    );
  }
  const skip = ctxPage.locator('button:has-text("Pomiń"), button:has-text("Skip")').first();
  if (await skip.count()) {
    await skip.click();
    await ctxPage.waitForTimeout(500);
  }
  return ctxPage;
}

async function openWebApp(): Promise<Page> {
  // Reuse WITHIN the same test if already open and signed in (a test
  // calling createWebItem() more than once -- e.g. P10-SC1's two login
  // items -- would otherwise pay a full fresh Argon2id sign-in TWICE,
  // roughly doubling that test's exposure window to the renderer-crash
  // risk documented below). `ensureVaultReady`'s own `test.beforeEach`
  // guarantees a genuinely FRESH tab at the start of every test regardless
  // (see its own header comment), so this reuse never leaks state across
  // test boundaries -- only within one.
  if (webPage && !webPage.isClosed()) {
    return webPage;
  }
  // Bounded retries (up to 2 extra attempts) -- an intermittent renderer
  // crash/close of the web app tab mid-sign-in, or an outright
  // "Target.createTarget: Failed to open a new tab" under this dev
  // machine's real memory pressure (observed swap usage of several GB
  // during this suite's own runs -- a genuine host constraint, not a
  // product bug), was observed under headed Chromium's real compositing
  // load. A short real wait between attempts (not a busy-loop) gives the
  // OS/Chromium a moment to reclaim memory before the next real,
  // freshly-rendered attempt.
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await openWebAppOnce();
    } catch (e) {
      lastError = e;
      console.warn(
        `[e2e] openWebApp attempt ${attempt}/3 failed, ${attempt < 3 ? "retrying" : "giving up"}:`,
        (e as Error).message,
      );
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }
  throw lastError;
}

async function createWebItem(
  typeTestId: string,
  fill: (web: Page) => Promise<void>,
): Promise<void> {
  const web = await openWebApp();
  await web.locator('button:has-text("Nowy item"), button:has-text("New item")').first().click();
  await web.waitForTimeout(500);
  const tile = web.locator(`[data-testid="${typeTestId}"]`).first();
  if (await tile.count()) {
    await tile.click();
    await web.waitForTimeout(400);
  }
  await fill(web);
  await web.locator('button:has-text("Zapisz"), button:has-text("Save")').first().click();
  await web.waitForTimeout(1200);
}

async function matchOnPopup(): Promise<{
  detected: Record<string, boolean>;
  matches: Array<{ itemId: string; label: string; kind: string }>;
}> {
  // MV3's chrome.runtime.sendMessage() returns a Promise when called with no
  // callback -- the same form the real popup code uses (sendMessage()
  // wrapper in App.tsx/useAutofillMatches.ts).
  return popup.evaluate(() => chrome.runtime.sendMessage({ kind: "autofill.match" }));
}

// CDP closed-shadow-root helpers (Phase 11's generate/capture UI mounts
// inside a closed shadow root) -- ported from this project's prior-session
// probe-phase11-capture.js, the proven pattern for driving that surface.
async function cdpSession(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send("DOM.enable");
  return client;
}
type CdpNode = { nodeId: number; attributes?: string[]; nodeType: number; nodeValue?: string; children?: CdpNode[]; shadowRoots?: CdpNode[]; contentDocument?: CdpNode };
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
async function cdpValue(client: Awaited<ReturnType<typeof cdpSession>>, node: CdpNode): Promise<string> {
  const { object } = await client.send("DOM.resolveNode", { nodeId: node.nodeId });
  const { result } = await client.send("Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration: "function(){return this.value}",
    returnByValue: true,
  });
  return result.value as string;
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

// ---------------------------------------------------------------------------
// Phase 9 -- Session Unlock Core, Popup & Sync Client (7 SCs)
// ---------------------------------------------------------------------------

test.describe("Phase 9 -- Session Unlock Core, Popup & Sync Client", () => {
  test("P9-SC1: on first run the user configures their own self-hosted pv-server URL; the URL is validated (reachable, e.g. /healthz) before use, persisted, and editable later -- nothing is hard-coded", async () => {
    const urlInput = popup.locator("input#pv-server-url");
    await expect(urlInput).toBeVisible({ timeout: 15000 });
    await urlInput.fill(SERVER);
    await popup.locator('button[type="submit"]').first().click();
    // A validated, persisted config advances the popup off the first-run
    // view -- next view is the sign-in form (no server-url input anymore).
    await popup.waitForSelector('input[type="password"]', { timeout: 20000 });
    await expect(popup.locator("input#pv-server-url")).toHaveCount(0);
    // Editable later: config.get should now report the persisted URL.
    const cfg = await popup.evaluate(() => chrome.runtime.sendMessage({ kind: "config.get" }));
    expect(JSON.stringify(cfg)).toContain("8620");
  });

  test("P9-SC2: user unlocks the vault from the popup with the master password, and with a PRF passkey where the browser supports it", async () => {
    await signInWithPassword();
    await popup.waitForSelector('select, button:has-text("Create a passkey")', { timeout: 60000 });
    await expect(popup.locator("select")).toBeVisible({ timeout: 15000 });

    // PRF-unlock half: arm a CDP virtual authenticator (hasPrf:true) on the
    // POPUP's OWN CDP session -- this is a genuine browser WebAuthn call
    // against the extension's own rpId (ext-scoped unlock passkey), never a
    // brokered provider ceremony.
    const cdp = await popup.context().newCDPSession(popup);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        hasPrf: true,
        automaticPresenceSimulation: true,
      },
    });

    const enrollBtn = popup.locator('button:has-text("Create a passkey")');
    await expect(enrollBtn).toBeVisible({ timeout: 15000 });
    await enrollBtn.click();
    await popup.waitForTimeout(2500);

    // Force-lock: clearing chrome.storage.session ALONE is not enough -- a
    // still-alive service worker's soft in-memory cache legitimately keeps
    // the session warm (this project's own prior-session UAT harnesses hit
    // exactly this: popup-full-flow.js's comment). The real lock path
    // clears both, so this harness must too: clear the envelope AND force-
    // terminate the worker via CDP before reloading.
    await popup.evaluate(() => chrome.storage.session.remove("pv-uk-envelope"));
    await cdp.send("ServiceWorker.enable");
    await cdp.send("ServiceWorker.stopAllWorkers");
    await popup.waitForTimeout(1500);
    await popup.reload();
    const prfBtn = popup.locator('button:has-text("Unlock with passkey")');
    await expect(prfBtn).toBeVisible({ timeout: 15000 });
    await prfBtn.click();
    await popup.waitForTimeout(3000);
    await expect(popup.locator("select")).toBeVisible({ timeout: 15000 });
  });

  test("P9-SC3: the unlocked User Key lives only in chrome.storage.session (never storage.local) and the vault stays usable across a service-worker idle-kill/wake cycle within the session", async ({ extContext, extensionId }) => {
    const envelope = await popup.evaluate(() => chrome.storage.session.get("pv-uk-envelope"));
    expect(Object.keys(envelope).length).toBeGreaterThan(0);
    const local = await popup.evaluate(() => chrome.storage.local.get("pv-uk-envelope"));
    expect(Object.keys(local).length).toBe(0);

    // Real service-worker termination via CDP (the programmatic equivalent
    // of chrome://serviceworker-internals "Stop"), mirroring this project's
    // proven Phase 8/9 harness pattern -- not a reload/disable-enable.
    const worker = extContext.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${extensionId}`));
    const cdp = await extContext.newCDPSession(popup);
    await cdp.send("ServiceWorker.enable");
    await cdp.send("ServiceWorker.stopAllWorkers");
    await new Promise((r) => setTimeout(r, 1500));
    void worker;

    await popup.reload();
    await popup.waitForTimeout(1200);
    await expect(popup.locator("select")).toBeVisible({ timeout: 15000 });
    await expect(popup.locator('input[type="password"]')).toHaveCount(0);
  });

  test("P9-SC4: the session auto-locks -- the key is cleared after a configurable idle timeout and on browser close, so an unlocked vault never persists indefinitely", async ({ extContext, extensionId }) => {
    const worker = extContext.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${extensionId}`));
    expect(worker).toBeTruthy();
    const alarmsBefore: string[] = await worker!.evaluate(async () =>
      (await chrome.alarms.getAll()).map((a: { name: string }) => a.name),
    );
    // chrome.alarms (never setTimeout/setInterval) is the auto-lock
    // mechanism -- an alarm survives SW idle-kill, a JS timer would not.
    expect(alarmsBefore.some((n: string) => n === "pv-auto-lock")).toBe(true);

    await popup.selectOption("select", "5");
    await popup.waitForTimeout(600);
    const alarmsAfter: Array<{ name: string; in: number }> = await worker!.evaluate(async () =>
      (await chrome.alarms.getAll()).map((a: { name: string; scheduledTime: number }) => ({
        name: a.name,
        in: a.scheduledTime - Date.now(),
      })),
    );
    const lockAlarm = alarmsAfter.find((a: { name: string }) => a.name === "pv-auto-lock");
    expect(lockAlarm).toBeTruthy();
    expect(lockAlarm!.in).toBeGreaterThan(0);
  });

  test("P9-SC5: in the popup, the user can browse, search, and pick any vault item, and an edit made on another synced device (or the v0.1 web app) appears via the same REST + WebSocket sync used in v0.1", async () => {
    const meta = await popup.evaluate(() =>
      chrome.storage.session.get("pv-session-meta"),
    );
    const token = (meta["pv-session-meta"] as { sessionToken?: string } | undefined)?.sessionToken;
    expect(token).toBeTruthy();

    // A raw REST POST with placeholder (non-WASM-wrapped) enc_key/enc_data
    // blobs is REJECTED by the popup's own list rendering by design --
    // entrypoints/background/vault-store.ts's ensureItemsHydrated()
    // decrypts every row inside its own try/catch and silently SKIPS (not
    // renders-as-error) anything that fails to decrypt, so a garbage blob
    // would never increase the visible item count regardless of whether
    // sync genuinely worked. The real "another synced client" proof this
    // SC needs is the v0.1 WEB APP (a second, independent client against
    // the SAME server) creating a genuinely-encrypted item, which the
    // popup CAN decrypt and display.
    const marker = `DBH-SYNC-${RUN}`;
    await createWebItem("type-tile-login", async (web) => {
      await web.fill("#item-name", marker);
      await web.fill("#item-username", `sync-user-${RUN}`);
      await web.fill("#item-password", `sync-pass-${RUN}!`);
    });

    // search + browse: the item list is searchable, and the second-client
    // (web app) edit propagates via the same REST+WS sync as v0.1.
    await popup.bringToFront();
    await popup.reload();
    await popup.waitForSelector("select", { timeout: 20000 });
    const search = popup.locator('input[type="search"], input[placeholder*="zukaj"], input[placeholder*="earch"]').first();
    if (await search.count()) {
      await search.fill(marker);
      await popup.waitForTimeout(400);
    }
    await expect(popup.locator(`text=${marker}`).first()).toBeVisible({ timeout: 15000 });
    if (await search.count()) {
      await search.fill("");
    }
  });

  test("P9-SC6: the self-hosted pv-server's CORS allowlist accepts the fixed published extension origin (chrome-extension://<published-id>), verified end-to-end against a real request", async () => {
    // Chrome half only -- moz-extension:// is a DEFERRED, separate half (see
    // deferred-items.md:25-26 and 13-UAT-CHECKLIST.md's honesty-disposition
    // Notes column for this row). Every REST call made by this suite so far
    // has gone through the real chrome-extension:// origin without a CORS
    // rejection -- assert that held.
    const corsErrors = consoleErrors.filter((e) => /CORS|blocked by/i.test(e));
    expect(corsErrors).toEqual([]);
  });

  test("P9-SC7: the popup exposes a 'fullscreen / open full vault' action that opens the configured server's v0.1 web-app frontend in a new browser tab; the popup does not re-implement full vault management", async () => {
    const fullscreenBtn = popup.locator("text=/Pełny widok|Full screen/i").first();
    await expect(fullscreenBtn).toBeVisible({ timeout: 15000 });
    const [newTab] = await Promise.all([
      popup.context().waitForEvent("page", { timeout: 10000 }),
      fullscreenBtn.click(),
    ]);
    expect(newTab.url().startsWith(SERVER)).toBe(true);
    await newTab.close();
  });
});

// ---------------------------------------------------------------------------
// Phase 10 -- Autofill: Login, TOTP, Card & Identity (5 SCs)
// ---------------------------------------------------------------------------

test.describe("Phase 10 -- Autofill: Login, TOTP, Card & Identity", () => {
  test.beforeEach(ensureVaultReady);

  const LOGIN_USER = `dbh-user-${RUN}`;
  const LOGIN_PASS = `dbh-pass-${RUN}!`;
  const LOGIN_MARKER = `DBH-LOGIN-${RUN}`;
  const LOGIN_MARKER_2 = `DBH-LOGIN2-${RUN}`;
  const CARD_MARKER = `DBH-CARD-${RUN}`;
  const ID_MARKER = `DBH-ID-${RUN}`;
  const TOTP_MARKER = `DBH-TOTP-${RUN}`;

  test("P10-SC1: the extension detects a login form on the current origin and offers to fill the saved username + password (with a picker when multiple accounts match)", async () => {
    await createWebItem("type-tile-login", async (web) => {
      await web.fill("#item-name", LOGIN_MARKER);
      await web.fill("#item-username", LOGIN_USER);
      await web.fill("#item-password", LOGIN_PASS);
      await web.fill('[data-testid="item-url-0"]', FORM_ORIGIN);
    });
    await createWebItem("type-tile-login", async (web) => {
      await web.fill("#item-name", LOGIN_MARKER_2);
      await web.fill("#item-username", `${LOGIN_USER}-2`);
      await web.fill("#item-password", `${LOGIN_PASS}2`);
      await web.fill('[data-testid="item-url-0"]', FORM_ORIGIN);
    });

    const form = await popup.context().newPage();
    await form.goto(`${FORM_ORIGIN}/`);
    await form.bringToFront();
    await popup.reload();
    await popup.waitForSelector("select", { timeout: 20000 });
    await popup.waitForTimeout(1500);

    const match = await matchOnPopup();
    const matchingLogins = match.matches.filter((m) => m.kind === "login" && (m.label === LOGIN_MARKER || m.label === LOGIN_MARKER_2));
    // Picker when multiple accounts match: at least the two we just created.
    expect(matchingLogins.length).toBeGreaterThanOrEqual(2);
    await expect(popup.locator('[data-testid="on-this-page-section"]')).toBeVisible({ timeout: 15000 });

    const target = matchingLogins.find((m) => m.label === LOGIN_MARKER)!;
    const fillBtn = popup.locator(`[data-testid="autofill-fill-${target.itemId}"]`);
    await expect(fillBtn).toBeVisible({ timeout: 10000 });
    await fillBtn.click();
    await form.waitForFunction(() => (document.getElementById("u") as HTMLInputElement)?.value !== "", { timeout: 10000 });
    const vals = await form.evaluate(() => ({
      u: (document.getElementById("u") as HTMLInputElement).value,
      p: (document.getElementById("p") as HTMLInputElement).value,
    }));
    expect(vals.u).toBe(LOGIN_USER);
    expect(vals.p).toBe(LOGIN_PASS);
    await form.close();
  });

  test("P10-SC2: the live TOTP code fills or copies into a detected 2FA field for the current origin", async () => {
    await createWebItem("type-tile-totp", async (web) => {
      await web.fill("#item-name", TOTP_MARKER);
      await web.fill("#item-secret", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
      await web.locator('[data-testid="totp-advanced-toggle"]').click();
      await web.waitForTimeout(200);
      await web.fill("#item-issuer", "localhost");
    });

    const form = await popup.context().newPage();
    await form.goto(`${FORM_ORIGIN}/`);
    await form.bringToFront();
    await popup.reload();
    await popup.waitForSelector("select", { timeout: 20000 });
    await popup.waitForTimeout(1500);

    const match = await matchOnPopup();
    expect(match.detected.totp).toBe(true);
    const totpItem = match.matches.find((m) => m.kind === "totp" && m.label === TOTP_MARKER);
    expect(totpItem).toBeTruthy();

    // UI-level: the copy button exists and is clickable (does not close the
    // shared popup, unlike the fill button which calls window.close()).
    const copyBtn = popup.locator(`[data-testid="autofill-totp-copy-${totpItem!.itemId}"]`);
    await expect(copyBtn).toBeVisible({ timeout: 10000 });
    await copyBtn.click();
    await expect(popup.locator('[data-testid="autofill-totp-copied-toast"]')).toBeVisible({ timeout: 5000 });

    // Live-code proof: the underlying handler returns a real, live 6-digit
    // code derived from the item's actual TOTP secret.
    const code = await popup.evaluate(
      (itemId) => chrome.runtime.sendMessage({ kind: "autofill.totpCode", itemId }),
      totpItem!.itemId,
    );
    expect((code as { ok: boolean; code?: string }).ok).toBe(true);
    expect(/^[0-9]{6}$/.test((code as { code?: string }).code ?? "")).toBe(true);
    await form.close();
  });

  test("P10-SC3: credit-card fields (number, expiry, CVV, cardholder) fill from a saved card item on a same-origin form", async () => {
    await createWebItem("type-tile-card", async (web) => {
      await web.fill("#item-name", CARD_MARKER);
      await web.fill("#item-cardholderName", "DBH TESTER");
      await web.fill("#item-number", "4111111111111111");
      await web.fill("#item-expiry", "12/30");
      await web.fill("#item-cvv", "123");
    });

    const form = await popup.context().newPage();
    await form.goto(`${FORM_ORIGIN}/card-identity`);
    await form.bringToFront();
    await popup.reload();
    await popup.waitForSelector("select", { timeout: 20000 });
    await popup.waitForTimeout(1500);

    const match = await matchOnPopup();
    const cardItem = match.matches.find((m) => m.kind === "card" && m.label === CARD_MARKER);
    expect(cardItem).toBeTruthy();

    const fillBtn = popup.locator(`[data-testid="autofill-fill-${cardItem!.itemId}"]`);
    await expect(fillBtn).toBeVisible({ timeout: 10000 });
    await fillBtn.click();
    // Sensitive kinds (card/identity) require a second, explicit confirm
    // (T-10-1x threat model's "second-confirm" gate) before the actual write.
    const secondConfirm = popup.locator('[data-testid="sensitive-fill-confirm-submit"]');
    if (await secondConfirm.count()) {
      await secondConfirm.click();
    }
    await form.waitForFunction(() => (document.getElementById("cc-number") as HTMLInputElement)?.value !== "", { timeout: 10000 });
    const num = await form.evaluate(() => (document.getElementById("cc-number") as HTMLInputElement).value);
    expect(num).toBe("4111111111111111");
    await form.close();
  });

  test("P10-SC4: identity fields (name, address, email, phone) fill from a saved identity item", async () => {
    await createWebItem("type-tile-identity", async (web) => {
      await web.fill("#item-name", ID_MARKER);
      await web.fill("#item-firstName", "Dual");
      await web.fill("#item-lastName", "Browser");
      await web.fill("#item-email", `dbh-tester-${RUN}@example.local`);
      await web.fill("#item-phone", "+48123456789");
      // web/src/components/vault/ItemForm.tsx's identity form has NO
      // single `#item-address` field -- it's structured into
      // `#item-addressLine1`/`#item-addressLine2` (confirmed by reading
      // the real form's field ids; the plain "#item-address" selector
      // this test previously used never matched anything, so `.fill()`
      // polled for its default 30s actionability timeout every run before
      // finally failing -- that long, silent poll window is what made
      // this specific fill by far this suite's most likely spot to also
      // eat an unrelated, genuine environmental renderer crash under this
      // dev machine's memory pressure. Fixing the selector removes that
      // artificially long exposure window entirely.
      await web.fill("#item-addressLine1", "ul. Testowa 1");
    });

    const form = await popup.context().newPage();
    await form.goto(`${FORM_ORIGIN}/card-identity`);
    await form.bringToFront();
    await popup.reload();
    await popup.waitForSelector("select", { timeout: 20000 });
    await popup.waitForTimeout(1500);

    const match = await matchOnPopup();
    const idItem = match.matches.find((m) => m.kind === "identity" && m.label === ID_MARKER);
    expect(idItem).toBeTruthy();

    const fillBtn = popup.locator(`[data-testid="autofill-fill-${idItem!.itemId}"]`);
    await expect(fillBtn).toBeVisible({ timeout: 10000 });
    await fillBtn.click();
    const secondConfirm = popup.locator('[data-testid="sensitive-fill-confirm-submit"]');
    if (await secondConfirm.count()) {
      await secondConfirm.click();
    }
    await form.waitForFunction(() => (document.getElementById("id-email") as HTMLInputElement)?.value !== "", { timeout: 10000 });
    const email = await form.evaluate(() => (document.getElementById("id-email") as HTMLInputElement).value);
    expect(email).toBe(`dbh-tester-${RUN}@example.local`);
    await form.close();
  });

  test("P10-SC5: nothing autofills without an explicit user gesture, and nothing fills top-level-page credentials into a cross-origin iframe -- verified against a deliberately constructed adversarial iframe test page", async () => {
    try {
      execFileSync("bash", ["-lc", "lsof -ti :8791 :8792 | xargs -r kill -9"], { stdio: "ignore" });
    } catch {
      // no zombies -- fine
    }
    advA = spawn("node", ["serve.mjs", "8791", "A"], { cwd: ADV_DIR, stdio: "ignore" });
    advB = spawn("node", ["serve.mjs", "8792", "B"], { cwd: ADV_DIR, stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 800));

    const advUser = `dbh-adv-${RUN}`;
    const advPass = `dbh-adv-pass-${RUN}!`;
    await createWebItem("type-tile-login", async (web) => {
      await web.fill("#item-name", `DBH-ADV-${RUN}`);
      await web.fill("#item-username", advUser);
      await web.fill("#item-password", advPass);
      await web.fill('[data-testid="item-url-0"]', ORIGIN_A);
    });

    const top = await popup.context().newPage();
    await top.goto(`${ORIGIN_A}/top.html`);
    await top.bringToFront();
    await popup.reload();
    await popup.waitForSelector("select", { timeout: 20000 });
    await popup.waitForTimeout(1000);

    // Gesture gate: fields empty before any popup click.
    const pre = await top.evaluate(() => ({
      u: (document.getElementById("top-username") as HTMLInputElement).value,
      p: (document.getElementById("top-password") as HTMLInputElement).value,
    }));
    expect(pre.u).toBe("");
    expect(pre.p).toBe("");

    const match = await matchOnPopup();
    const advItem = match.matches.find((m) => m.kind === "login" && m.label === `DBH-ADV-${RUN}`);
    expect(advItem).toBeTruthy();

    const fillBtn = popup.locator(`[data-testid="autofill-fill-${advItem!.itemId}"]`);
    await expect(fillBtn).toBeVisible({ timeout: 10000 });
    await fillBtn.click();
    await top.waitForFunction(() => (document.getElementById("top-username") as HTMLInputElement)?.value !== "", { timeout: 10000 });

    const post = await top.evaluate(() => ({
      u: (document.getElementById("top-username") as HTMLInputElement).value,
      p: (document.getElementById("top-password") as HTMLInputElement).value,
    }));
    expect(post.u).toBe(advUser);
    expect(post.p).toBe(advPass);

    const frame = top.frames().find((f) => f.url().includes("attacker-frame.html"));
    expect(frame).toBeTruthy();
    const frameVals = await frame!.evaluate(() => ({
      u: (document.getElementById("frame-username") as HTMLInputElement).value,
      p: (document.getElementById("frame-password") as HTMLInputElement).value,
      ev: (window as unknown as { __frameEvents: { username: number; password: number } }).__frameEvents,
    }));
    expect(frameVals.u).toBe("");
    expect(frameVals.p).toBe("");
    expect(frameVals.ev.username).toBe(0);
    expect(frameVals.ev.password).toBe(0);

    await top.close();
    advA.kill();
    advB.kill();
    advA = undefined;
    advB = undefined;
  });
});

// ---------------------------------------------------------------------------
// Phase 11 -- Generate & Capture (4 SCs)
// ---------------------------------------------------------------------------

test.describe("Phase 11 -- Generate & Capture", () => {
  test.beforeEach(ensureVaultReady);

  const CAP_USER = `cap-user-${RUN}`;
  const CAP_PASS_1 = `cap-pass-A-${RUN}!`;
  const CAP_PASS_2 = `cap-pass-B-${RUN}!`;

  test("P11-SC1: on a signup/registration form, the extension offers a generated strong password (character and passphrase modes, reusing the v0.1 generator)", async () => {
    const signup = await popup.context().newPage();
    await signup.goto(`${FORM_ORIGIN}/signup`);
    await signup.bringToFront();
    await signup.waitForTimeout(1000);
    await signup.focus("#np");
    await signup.waitForTimeout(700);
    const client = await cdpSession(signup);

    const trigger = await waitForCdp(async () => {
      const t = await cdpQuery(client, (_n, a) => hasAttr(a, "data-pv-gen-trigger"));
      return t.length ? t : null;
    });
    expect(trigger).toBeTruthy();
    await cdpClickAttr(client, "data-pv-gen-trigger");
    const popover = await waitForCdp(async () => {
      const p = await cdpQuery(client, (_n, a) => hasAttr(a, "data-pv-gen-popover"));
      return p.length ? p : null;
    });
    expect(popover).toBeTruthy();

    const preview = await cdpQuery(client, (_n, a) => hasAttr(a, "data-pv-gen-preview"));
    const genValue = preview.length ? await cdpValue(client, preview[0].node) : "";
    expect(genValue.length).toBeGreaterThanOrEqual(8);

    const apply = await cdpQuery(client, (_n, a) => hasAttr(a, "data-pv-gen-apply"));
    expect(apply.length).toBeGreaterThan(0);
    await cdpClickAttr(client, "data-pv-gen-apply");
    await signup.waitForTimeout(600);
    const vals = await signup.evaluate(() => ({
      np: (document.getElementById("np") as HTMLInputElement).value,
      cp: (document.getElementById("cp") as HTMLInputElement).value,
    }));
    expect(vals.np).toBe(genValue);
    expect(vals.cp).toBe(genValue);

    // Passphrase mode.
    await signup.evaluate(() => {
      (document.getElementById("np") as HTMLInputElement).value = "";
      (document.getElementById("cp") as HTMLInputElement).value = "";
    });
    await signup.focus("#np");
    await signup.waitForTimeout(500);
    const trigger2 = await cdpQuery(client, (_n, a) => hasAttr(a, "data-pv-gen-trigger"));
    expect(trigger2.length).toBeGreaterThan(0);
    await cdpClickAttr(client, "data-pv-gen-trigger");
    await signup.waitForTimeout(400);
    const modeBtn = await cdpQuery(client, (_n, a) => hasAttr(a, "data-pv-gen-mode-passphrase"));
    expect(modeBtn.length).toBeGreaterThan(0);
    await cdpClickAttr(client, "data-pv-gen-mode-passphrase");
    await signup.waitForTimeout(600);
    const pv2 = await cdpQuery(client, (_n, a) => hasAttr(a, "data-pv-gen-preview"));
    const passphrase = pv2.length ? await cdpValue(client, pv2[0].node) : "";
    const words = passphrase.split(/[-_ .]/).filter(Boolean);
    expect(words.length).toBeGreaterThanOrEqual(3);
    await signup.close();
  });

  test("P11-SC2: after a successful submit/login, the extension prompts the user to save the new login to the vault, attributed to the correct origin", async () => {
    const login = await popup.context().newPage();
    await login.goto(`${FORM_ORIGIN}/no-otp`);
    await login.bringToFront();
    await login.waitForTimeout(1000);
    const client = await cdpSession(login);

    await login.fill("#u", CAP_USER);
    await login.fill("#p", CAP_PASS_1);
    // The extension's own autofill-hint overlay (`data-pv-autofill-host`)
    // renders adjacent to this minimal test page's fields and can
    // intercept a coordinate-based click on #s -- pressing Enter in the
    // password field is both a more natural real-user login gesture and
    // sidesteps that overlap entirely, still dispatching a genuine
    // "submit" event for capture-handler.ts to detect.
    await login.locator("#p").press("Enter");
    const toast = await waitForCdp(async () => {
      const t = await cdpQuery(client, (_n, a) => hasAttr(a, "data-pv-toast"));
      return t.length ? t : null;
    });
    expect(toast).toBeTruthy();
    const confirmed = await cdpClickAttr(client, "data-pv-toast-confirm");
    expect(confirmed).toBe(true);
    await login.waitForTimeout(2000);

    await popup.bringToFront();
    await expect(popup.locator(`text=${CAP_USER}`).first()).toBeVisible({ timeout: 15000 });
    await login.close();
  });

  test("P11-SC3: when the user changes a password on a site with an existing saved login, the extension detects the change and offers to update the stored item instead of creating a duplicate", async () => {
    const login = await popup.context().newPage();
    await login.goto(`${FORM_ORIGIN}/no-otp`);
    await login.bringToFront();
    await login.waitForTimeout(1000);
    await login.fill("#u", CAP_USER);
    await login.fill("#p", CAP_PASS_2);
    // The extension's own autofill-hint overlay (`data-pv-autofill-host`)
    // renders adjacent to this minimal test page's fields and can
    // intercept a coordinate-based click on #s -- pressing Enter in the
    // password field is both a more natural real-user login gesture and
    // sidesteps that overlap entirely, still dispatching a genuine
    // "submit" event for capture-handler.ts to detect.
    await login.locator("#p").press("Enter");
    const client = await cdpSession(login);
    const toast = await waitForCdp(async () => {
      const t = await cdpQuery(client, (_n, a) => hasAttr(a, "data-pv-toast"));
      return t.length ? t : null;
    });
    expect(toast).toBeTruthy();
    const confirmed = await cdpClickAttr(client, "data-pv-toast-confirm");
    expect(confirmed).toBe(true);
    await login.waitForTimeout(2000);

    await popup.bringToFront();
    await popup.waitForTimeout(1500);
    const rows = await popup.locator(`text=${CAP_USER}`).count();
    expect(rows).toBeLessThanOrEqual(1);
    await login.close();
  });

  test("P11-SC4: save/update prompts always show the actual originating domain and warn explicitly on any origin mismatch (e.g., a form embedded in a cross-origin iframe)", async () => {
    try {
      execFileSync("bash", ["-lc", "lsof -ti :8791 :8792 | xargs -r kill -9"], { stdio: "ignore" });
    } catch {
      // no zombies
    }
    advA = spawn("node", ["serve.mjs", "8791", "A"], { cwd: ADV_DIR, stdio: "ignore" });
    advB = spawn("node", ["serve.mjs", "8792", "B"], { cwd: ADV_DIR, stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 800));

    const top = await popup.context().newPage();
    await top.goto(`${ORIGIN_A}/top.html`);
    await top.bringToFront();
    await top.waitForTimeout(1200);
    const advClient = await cdpSession(top);

    const frame = top.frames().find((f) => f.url().includes("attacker-frame.html"));
    expect(frame).toBeTruthy();
    await frame!.fill("#frame-username", `dbh-mismatch-${RUN}`);
    await frame!.fill("#frame-password", `dbh-mismatch-pass-${RUN}!`);
    await frame!.click('button[type="submit"]');

    const mounted = await waitForCdp(async () => {
      const v = await frame!.evaluate(() => ({
        host: !!document.querySelector("[data-pv-mount-host]"),
        formGone: !document.getElementById("frame-form"),
      }));
      return v.host && v.formGone ? v : null;
    });
    expect(mounted).toBeTruthy();

    // The mismatch capture surface stays FRAME-scoped -- the top page (a
    // different origin than the form that was actually submitted) shows no
    // toast/modal of its own.
    const topSurfaces = await cdpQuery(advClient, (_n, a) => hasAttr(a, "data-pv-toast") || hasAttr(a, "data-pv-mismatch-panel"));
    expect(topSurfaces.length).toBe(0);

    // Positive control: the SAME top page's OWN same-origin submit gets a
    // plain save toast (no mismatch modal).
    await top.goto(`${ORIGIN_A}/top.html`);
    await top.bringToFront();
    await top.waitForTimeout(1000);
    await top.fill("#top-username", `dbh-control-${RUN}`);
    await top.fill("#top-password", `dbh-control-pass-${RUN}!`);
    await top.click('#top-form button[type="submit"]');
    const advClient2 = await cdpSession(top);
    const topToast = await waitForCdp(async () => {
      const t = await cdpQuery(advClient2, (_n, a) => hasAttr(a, "data-pv-toast"));
      return t.length ? t : null;
    });
    expect(topToast).toBeTruthy();

    await top.close();
    advA.kill();
    advB.kill();
    advA = undefined;
    advB = undefined;
  });
});

// ---------------------------------------------------------------------------
// Phase 12 -- Passkey Provider (5 SCs)
// ---------------------------------------------------------------------------

test.describe("Phase 12 -- Passkey Provider", () => {
  test.beforeEach(ensureVaultReady);

  test("P12-SC1: on a third-party site, navigator.credentials.create() registers a new ES256 passkey (via passkey-rs) that is saved to the user's vault", async () => {
    const rp = await popup.context().newPage();
    await rp.goto(`${FORM_ORIGIN}/provider`);
    await rp.bringToFront();

    // NO CDP virtual authenticator here -- the extension's MAIN-world shim
    // intercepts navigator.credentials.create() directly and routes it to
    // the REAL ProviderCeremonyView consent UI, never touching the
    // browser's own (virtual or real) WebAuthn authenticator.
    const createPromise = rp.evaluate(
      async (runId) => {
        try {
          const cred = await navigator.credentials.create({
            publicKey: {
              rp: { id: "localhost", name: "DBH Provider Test RP" },
              user: {
                id: new Uint8Array([1, 2, 3, 4]),
                name: `e2e-provider-${runId}@localhost`,
                displayName: "E2E Provider Tester",
              },
              challenge: new Uint8Array(32),
              pubKeyCredParams: [{ type: "public-key", alg: -7 }],
              timeout: 30000,
            },
          });
          return { ok: true, id: (cred as { id?: string } | null)?.id ?? null };
        } catch (e) {
          return { ok: false, error: String((e as Error).message) };
        }
      },
      RUN,
    );

    const confirmBtn = popup.locator('[data-testid="provider-confirm"]');
    await expect(confirmBtn).toBeVisible({ timeout: 20000 });
    await confirmBtn.click();

    const result = await createPromise;
    expect(result.ok).toBe(true);
    expect(result.id).toBeTruthy();
    await rp.close();
  });

  test("P12-SC2: navigator.credentials.get() logs the user in with a passkey already saved in their vault", async () => {
    const rp = await popup.context().newPage();
    await rp.goto(`${FORM_ORIGIN}/provider`);
    await rp.bringToFront();

    // NO CDP virtual authenticator -- a REAL stored credential from
    // P12-SC1 (this account may carry more than one localhost-scoped
    // provider passkey from prior runs against this shared UAT account, so
    // this handles BOTH the single-match confirm and the multi-match
    // picker -- either way, get() must genuinely succeed).
    const getPromise = rp.evaluate(async () => {
      try {
        const cred = await navigator.credentials.get({
          publicKey: {
            rpId: "localhost",
            challenge: new Uint8Array(32),
            timeout: 30000,
            userVerification: "preferred",
          },
        });
        return { ok: true, id: (cred as { id?: string } | null)?.id ?? null };
      } catch (e) {
        return { ok: false, error: String((e as Error).message) };
      }
    });

    // Quick task 260717-lnx: multi-match rows are now one-click
    // select+confirm (no separate provider-confirm click for that path) --
    // wait for EITHER the single-match confirm button OR a multi-match
    // candidate row, since this shared UAT account may carry more than one
    // localhost-scoped passkey from prior runs.
    const confirmBtn = popup.locator('[data-testid="provider-confirm"]');
    const candidateRow = popup.locator('[data-testid^="provider-credential-row-"]').first();
    await expect(confirmBtn.or(candidateRow)).toBeVisible({ timeout: 20000 });
    if (await candidateRow.count()) {
      await candidateRow.click();
    } else {
      await expect(confirmBtn).toBeEnabled({ timeout: 10000 });
      await confirmBtn.click();
    }

    const result = await getPromise;
    expect(result.ok).toBe(true);
    expect(result.id).toBeTruthy();
    await rp.close();
  });

  test("P12-SC3: when the user declines, or the vault has no matching credential, the ceremony falls through cleanly to the native OS authenticator, never dead-ending the page's login flow", async () => {
    const rp = await popup.context().newPage();
    await rp.goto(`${FORM_ORIGIN}/provider`);
    await rp.bringToFront();

    // CDP virtual authenticator on the THIRD-PARTY RP PAGE's own CDP
    // session ONLY -- it stands in for the native OS authenticator the
    // browser falls through to AFTER the shim's brokered ceremony is
    // declined; it is never attached to (and never fires during) the
    // brokered ceremony itself.
    const cdp = await rp.context().newCDPSession(rp);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    const createPromise = rp.evaluate(async () => {
      try {
        const cred = await navigator.credentials.create({
          publicKey: {
            rp: { id: "localhost", name: "DBH Provider Fallthrough Test" },
            user: {
              id: crypto.getRandomValues(new Uint8Array(16)),
              name: "fallthrough-tester@localhost",
              displayName: "Fallthrough Tester",
            },
            challenge: new Uint8Array(32),
            pubKeyCredParams: [{ type: "public-key", alg: -7 }],
            timeout: 30000,
          },
        });
        return { ok: true, id: (cred as { id?: string } | null)?.id ?? null };
      } catch (e) {
        return { ok: false, error: String((e as Error).message) };
      }
    });

    const declineBtn = popup.locator('[data-testid="provider-decline"]');
    await expect(declineBtn).toBeVisible({ timeout: 20000 });
    await declineBtn.click();

    // After decline, the page's create() call falls through to the native
    // (here, CDP-virtual) authenticator -- it must resolve, not hang/reject.
    const result = await createPromise;
    expect(result.ok).toBe(true);
    expect(result.id).toBeTruthy();
    await rp.close();
    // The 'another PM extension installed' coexistence clause is MANUAL --
    // see deferred-items.md D-15 install-order UAT, not automated here.
  });

  test("P12-SC4: PRF is used where the browser allows it (Chromium-first); on Firefox or wherever PRF is unavailable, the flow degrades honestly with a clear, specific fallback message", async () => {
    // Chrome POSITIVE 'PRF used' path only -- provider PRF is WASM-computed
    // (D-16), never browser-sniffed; the degradation-copy half is
    // Firefox-side (verified in 13-04), not asserted here.
    const rp = await popup.context().newPage();
    await rp.goto(`${FORM_ORIGIN}/provider`);
    await rp.bringToFront();

    const createPromise = rp.evaluate(async () => {
      try {
        const cred = (await navigator.credentials.create({
          publicKey: {
            rp: { id: "localhost", name: "DBH Provider PRF Test" },
            user: {
              id: crypto.getRandomValues(new Uint8Array(16)),
              name: "prf-tester@localhost",
              displayName: "PRF Tester",
            },
            challenge: new Uint8Array(32),
            pubKeyCredParams: [{ type: "public-key", alg: -7 }],
            timeout: 30000,
            extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
          },
        })) as (Credential & { getClientExtensionResults?: () => { prf?: { enabled?: boolean } } }) | null;
        const ext = cred?.getClientExtensionResults?.() ?? {};
        return { ok: true, prfEnabled: ext.prf?.enabled === true };
      } catch (e) {
        return { ok: false, error: String((e as Error).message) };
      }
    });

    const confirmBtn = popup.locator('[data-testid="provider-confirm"]');
    await expect(confirmBtn).toBeVisible({ timeout: 20000 });
    await confirmBtn.click();

    const result = await createPromise;
    expect(result.ok).toBe(true);
    expect(result.prfEnabled).toBe(true);
    await rp.close();
  });

  test("P12-SC5: a security review (/gsd-secure-phase) confirms the MAIN-world navigator.credentials patch is a key-free RPC shim -- grep-audited to prove no User Key, PRF output, or plaintext ever crosses into MAIN-world JS", async () => {
    // NOT a Playwright browser assertion -- this is a static audit script,
    // shelled out to and asserted on exit code, per the plan's honesty
    // disposition for this row (verified by audit script + 12-05 review).
    const scriptPath = path.resolve(__dirname, "../../scripts/audit-mainworld-boundary.sh");
    expect(() => execFileSync(scriptPath, { cwd: path.resolve(__dirname, "../..") })).not.toThrow();
  });
});
