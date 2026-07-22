/**
 * Store-listing screenshot harness (publication 2026-07-22) — NOT a test of
 * product behavior. Drives the packaged chrome-mv3 build against the LIVE
 * production server (vault.blonie.cloud) on a dedicated demo account and
 * captures raw PNGs for the Chrome Web Store / AMO listings into
 * docs/store/screenshots/raw/. Idempotent: registers the demo account on
 * first run, signs in on subsequent runs.
 *
 * Run: PV_DEMO_PASSWORD=<pw> npx playwright test store-screenshots --project=chromium
 */
import * as http from "node:http";
import * as path from "node:path";
import * as fs from "node:fs";
import { test, expect } from "./fixtures";
import type { BrowserContext, Page } from "@playwright/test";

const SERVER = process.env.PV_DEMO_SERVER ?? "https://vault.blonie.cloud";
const EMAIL = process.env.PV_DEMO_EMAIL ?? "demo@blonie.cloud";
const PASSWORD = process.env.PV_DEMO_PASSWORD ?? "";
if (!PASSWORD) throw new Error("PV_DEMO_PASSWORD must be set");

const OUT = path.resolve(import.meta.dirname, "../../docs/store/screenshots/raw");
const FORM_PORT = 8899;
const FORM_ORIGIN = `http://localhost:${FORM_PORT}`;

function signupPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Sign up — Acme</title>
  <style>body{font-family:-apple-system,system-ui,sans-serif;background:#f6f4ef;display:flex;justify-content:center;padding-top:60px;margin:0}
  form{background:#fff;border:1px solid #e5e0d5;border-radius:12px;padding:32px;width:360px;box-shadow:0 2px 12px rgba(0,0,0,.06)}
  h1{font-size:22px;margin:0 0 20px}label{display:block;font-size:13px;color:#555;margin:14px 0 4px}
  input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #d8d2c4;border-radius:8px;font-size:15px}
  button{margin-top:22px;width:100%;padding:11px;border:0;border-radius:8px;background:#0f766e;color:#fff;font-size:15px;cursor:pointer}</style>
  </head><body><form autocomplete="on">
  <h1>Create your account</h1>
  <label for="em">Email</label><input id="em" type="email" autocomplete="email" value="you@example.com">
  <label for="np">Password</label><input id="np" type="password" autocomplete="new-password">
  <label for="cp">Confirm password</label><input id="cp" type="password" autocomplete="new-password">
  <button type="submit">Sign up</button></form></body></html>`;
}

let formServer: http.Server;
let context: BrowserContext;
let popup: Page;
let extensionId: string;

// --- CDP helpers (closed-shadow-DOM interaction; copied from dual-browser.spec.ts) ---
async function cdpSession(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send("DOM.enable");
  return client;
}
type CdpNode = { nodeId: number; attributes?: string[]; nodeType: number; children?: CdpNode[]; shadowRoots?: CdpNode[]; contentDocument?: CdpNode };
async function cdpQuery(
  client: Awaited<ReturnType<typeof cdpSession>>,
  predicate: (node: CdpNode, attrs: Record<string, string>) => boolean,
) {
  const { root } = await client.send("DOM.getDocument", { depth: -1, pierce: true });
  const out: Array<{ node: CdpNode; attrs: Record<string, string> }> = [];
  function attrsOf(node: CdpNode): Record<string, string> {
    const m: Record<string, string> = {};
    if (node.attributes) for (let i = 0; i < node.attributes.length; i += 2) m[node.attributes[i]] = node.attributes[i + 1];
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
async function waitForCdp<T>(fn: () => Promise<T | null>, timeout = 9000, interval = 300): Promise<T | null> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, interval));
  }
  return null;
}

// --- web-app helpers ---
async function webSignInOrRegister(page: Page): Promise<void> {
  console.log("STEP: goto server");
  await page.goto(`${SERVER}/`);
  console.log("STEP: goto done");
  const emailField = page.locator('[data-testid="login-email"]');
  await emailField.waitFor({ timeout: 20000 });
  await emailField.fill(EMAIL, { timeout: 15000 });
  await page.locator('[data-testid="login-password"]').fill(PASSWORD, { timeout: 15000 });
  await page.locator('[data-testid="login-submit"]').click({ timeout: 15000 });
  // Either we land in the vault, or the account does not exist yet -> register.
  const landed = await page
    .waitForSelector('[data-testid="new-item-button"]', { timeout: 12000 })
    .then(() => true)
    .catch(() => false);
  if (!landed) {
    await page.locator('text=/Sign up|Zarejestruj/').first().click({ timeout: 15000 });
    await page.locator('[data-testid="register-email"]').fill(EMAIL, { timeout: 15000 });
    await page.locator('[data-testid="register-password"]').fill(PASSWORD, { timeout: 15000 });
    await page.locator('[data-testid="register-confirm-password"]').fill(PASSWORD, { timeout: 15000 });
    await page.locator('[data-testid="register-submit"]').click({ timeout: 15000 });
    await page.waitForSelector('[data-testid="new-item-button"]', { timeout: 30000 });
    const skip = page.locator('button:has-text("Pomiń"), button:has-text("Skip")').first();
    if (await skip.count()) await skip.click({ timeout: 15000 });
  }
  // Clear any full-screen takeover: onboarding wizard (per-browser flag —
  // always fresh in this throwaway profile) and/or the locked-session
  // UnlockOverlay. Loop until the vault is actually interactable.
  await page.waitForTimeout(2500); // let session-state settle so the overlay (if any) mounts
  const deadline = Date.now() + 60000;
  let stableGone = 0;
  while (Date.now() < deadline) {
    const skip = page.locator('button:has-text("Pomiń"), button:has-text("Skip")').first();
    if (await skip.isVisible().catch(() => false)) {
      stableGone = 0;
      await skip.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(600);
      continue;
    }
    const unlockPw = page.locator('[data-testid="unlock-password"]');
    const unlockSubmit = page.locator('[data-testid="unlock-submit"]').first();
    if (await unlockPw.isVisible().catch(() => false)) {
      stableGone = 0;
      await unlockPw.fill(PASSWORD, { timeout: 10000 });
      await unlockSubmit.click({ timeout: 10000 });
      await page
        .waitForFunction(() => !document.querySelector('[data-testid="unlock-submit"]'), { timeout: 30000 })
        .catch(() => {});
      await page.waitForTimeout(600);
      continue;
    }
    // pending-unlock recovery variant: a lone unlock-submit button, no password field
    if (await unlockSubmit.isVisible().catch(() => false)) {
      stableGone = 0;
      await unlockSubmit.click({ timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1200);
      continue;
    }
    const overlayGone = await page
      .evaluate(() => !document.querySelector("div.fixed.inset-0.z-50"))
      .catch(() => false);
    if (overlayGone) {
      stableGone += 1;
      if (stableGone >= 3) break; // gone across ~2s of consecutive checks — really gone
    } else {
      stableGone = 0;
    }
    await page.waitForTimeout(700);
  }
}

async function createLogin(page: Page, name: string, user: string, pw: string, url: string): Promise<void> {
  await page.locator('[data-testid="new-item-button"]').click({ timeout: 15000 });
  await page.waitForTimeout(400);
  const tile = page.locator('[data-testid="type-tile-login"]').first();
  if (await tile.count()) await tile.click({ timeout: 15000 });
  await page.waitForTimeout(300);
  await page.locator('[data-testid="item-name"]').fill(name, { timeout: 15000 });
  await page.locator("#item-username").fill(user, { timeout: 15000 });
  await page.locator('[data-testid="item-password"]').fill(pw, { timeout: 15000 });
  await page.locator('[data-testid="item-url-0"]').fill(url, { timeout: 15000 });
  await page.locator('button:has-text("Zapisz"), button:has-text("Save")').first().click({ timeout: 15000 });
  await page.waitForTimeout(1000);
}

test.describe("store screenshots", () => {
  test.beforeAll(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    formServer = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(signupPage());
    });
    await new Promise<void>((resolve) => formServer.listen(FORM_PORT, "127.0.0.1", resolve));
  });
  test.afterAll(async () => {
    (formServer as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    await new Promise((resolve) => formServer?.close(resolve));
  });

  test("capture all listing screenshots", async ({ extContext, extensionId: extId }) => {
    test.setTimeout(180_000);
    context = extContext;
    extensionId = extId;

    // 1. Seed the demo vault through the real web app on production.
    console.log("STEP: newPage web");
    const web = await context.newPage();
    await web.setViewportSize({ width: 1440, height: 900 });
    console.log("STEP: signInOrRegister");
    await webSignInOrRegister(web);
    const itemRows = web.locator('[data-testid="new-item-button"]');
    await expect(itemRows).toBeVisible();
    const hasItems = await web.locator("text=GitHub").count();
    if (!hasItems) {
      await createLogin(web, "GitHub", "octo-demo", "Fj9#kLm2$pQr7!vX", "https://github.com");
      await createLogin(web, "Google", "demo.account@gmail.com", "tR4&nWq8@zYs3^bH", "https://accounts.google.com");
      await createLogin(web, "Netflix", "demo@blonie.cloud", "mK6!dPv1&cJt9*eL", "https://www.netflix.com");
    }
    await web.waitForTimeout(800);

    // 2. Web vault screenshot (desktop).
    await web.screenshot({ path: path.join(OUT, "web-vault.png") });

    // 3. Popup: configure server + SignInView shot, then sign in, then list shot.
    console.log("STEP: popup open");
    popup = await context.newPage();
    await popup.setViewportSize({ width: 380, height: 600 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    const urlInput = popup.locator("input#pv-server-url");
    if (await urlInput.count()) {
      await urlInput.fill(SERVER, { timeout: 15000 });
      await popup.locator('button[type="submit"]').first().click({ timeout: 15000 });
    }
    await popup.waitForSelector('[data-testid="server-ceremony-signin-button"]', { timeout: 20000 });
    await popup.waitForTimeout(600);

    const [ceremonyPage] = await Promise.all([
      context.waitForEvent("page"),
      popup.locator('[data-testid="server-ceremony-signin-button"]').click(),
    ]);
    await ceremonyPage.locator("input#pv-ext-unlock-email").fill(EMAIL, { timeout: 15000 });
    await ceremonyPage.locator("input#pv-ext-unlock-password").fill(PASSWORD, { timeout: 15000 });
    await ceremonyPage.waitForTimeout(400);
    await ceremonyPage.screenshot({ path: path.join(OUT, "ceremony-signin.png") }).catch(() => {});
    await ceremonyPage.locator('[data-testid="ext-unlock-password-submit"]').click({ timeout: 15000 });
    await Promise.race([
      ceremonyPage.waitForEvent("close", { timeout: 20000 }).catch(() => {}),
      popup.waitForSelector("select", { timeout: 25000 }).catch(() => {}),
    ]);
    await popup.reload();
    await popup.waitForSelector("select", { timeout: 25000 });
    await popup.waitForTimeout(1200);
    await popup.evaluate(() => document.querySelectorAll('[role="alert"], .alert').forEach((e) => e.remove()));
    await popup.waitForTimeout(300);
    await popup.screenshot({ path: path.join(OUT, "popup-list.png") });

    // 4. In-page autofill dropdown on github.com/login.
    const gh = await context.newPage();
    await gh.setViewportSize({ width: 1280, height: 800 });
    await gh.goto("https://github.com/login", { waitUntil: "domcontentloaded" }).catch(() => {});
    await gh.waitForTimeout(2500);
    const loginField = gh.locator("#login_field");
    if (await loginField.count()) {
      await loginField.click({ timeout: 15000 });
      await gh.waitForTimeout(1500);
      await gh.screenshot({ path: path.join(OUT, "inpage-github.png") });
    }

    // 5. Generator popover on a signup form (closed shadow DOM -> CDP).
    const signup = await context.newPage();
    await signup.setViewportSize({ width: 1280, height: 800 });
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
    if (trigger) {
      await cdpClick(client, trigger[0].node);
      await waitForCdp(async () => {
        const p = await cdpQuery(client, (_n, a) => hasAttr(a, "data-pv-gen-popover"));
        return p.length ? p : null;
      });
      await signup.waitForTimeout(600);
      await signup.screenshot({ path: path.join(OUT, "generator-signup.png") });
    }
  });
});
