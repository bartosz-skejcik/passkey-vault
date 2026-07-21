// extension/e2e-visual/capture-tile-parity.mjs -- 17-04-PLAN.md's Task 2:
// a standalone, self-contained (own sign-in, own vault state -- never
// touches extension/e2e/dual-browser.spec.ts's shared cumulative worker
// state) Playwright/CDP screenshot + computed-style visual-parity harness.
// This is the FIRST genuine automated check that the in-page shadow-DOM
// overlay's `.pv-row-icon-tile` background actually equals the shared
// React `ItemIconTile` component's rendered background, in both themes --
// RESEARCH.md's own Pitfall 3 found that no existing suite checks this.
//
// Run via `npm run test:e2e:visual` (extension/package.json).
//
// ---------------------------------------------------------------------
// DEVIATION from the plan's literal Step 0 wording (documented in
// 17-04-SUMMARY.md, Rule 3 -- blocking-issue auto-fix):
//
// The plan's Step 0 describes probing pv-server's health at
// http://localhost:8620 and reusing an already-healthy instance. At
// execution time a healthy pv-server WAS already running on :8620 (a
// developer's own session), but its `PV_EXTENSION_ORIGINS` allowlist did
// not include this run's freshly-loaded Chrome extension's origin
// (`chrome-extension://<id>`, computed from the *packaged build's own
// pinned manifest key* -- deterministic across builds, but still an
// origin the running server was never configured to allow). Reusing it
// verbatim would silently CORS-block every background fetch the loaded
// extension makes (register/login/vault calls), defeating 3 of this
// script's 4 surfaces. This script therefore ALWAYS runs its OWN pv-server
// (and its own `next dev`) on dedicated, non-default ports, configured
// with the CORRECT extension origin computed at runtime -- never touching
// or restarting any developer's own :8620/:3000 session. The
// reuse-if-healthy / start-with-bounded-timeout / kill-only-what-we-started
// contract from the plan's Step 0 is preserved verbatim, just against
// these dedicated ports instead of the default ones.
// ---------------------------------------------------------------------
import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(EXT_ROOT, "..");
const WEB_ROOT = path.join(REPO_ROOT, "web");
const EXTENSION_PATH = path.join(EXT_ROOT, ".output/chrome-mv3");
const SHOTS_DIR = path.join(
  REPO_ROOT,
  ".planning/phases/17-shared-component-visual-alignment/uat-screenshots",
);
const RESULTS_FILE = path.join(SHOTS_DIR, "results.json");
const PV_LOG_FILE = path.join(SHOTS_DIR, "pv-server.log");

const EMAIL = process.env.PV_TILE_PARITY_EMAIL || "uat-tile-parity@example.local";
const PASSWORD = process.env.PV_TILE_PARITY_PASSWORD || "CorrectHorseBattery-TileParity-2026!";
const PV_PORT = Number(process.env.PV_TILE_PARITY_SERVER_PORT || 8630);
const PV_URL = `http://localhost:${PV_PORT}`;
// The web app is served BY this script's own pv-server instance (same
// origin, PV_STATIC_DIR -- this project's established single-container
// dev/prod pattern, confirmed against routes/mod.rs's own static-fallback
// wiring), NOT a separate `next dev` server. A separate dev server on its
// own port was tried first and found to genuinely break: pv-server's own
// CORS layer (routes/mod.rs) only ever allows the extension's origin via
// `PV_EXTENSION_ORIGINS` -- a plain browser tab's origin (e.g.
// http://localhost:3011) is never on that allowlist and every fetch()
// from RegisterForm.tsx/LoginForm.tsx failed closed with a generic "Nie
// udało się utworzyć konta" (confirmed live via a DEBUG screenshot before
// this fix). Building the web app as a static export and letting
// pv-server serve it same-origin sidesteps CORS for the web app entirely
// -- exactly how this project's own README.md/Dockerfile ship it.
const WEB_URL = PV_URL;
const FORM_PORT = Number(process.env.PV_TILE_PARITY_FORM_PORT || 8896);
const FORM_URL = `http://localhost:${FORM_PORT}`;
const RUN = String(Date.now() % 100000);
const THEME_MIRROR_KEY = "pv-theme-mirror";
const THEMES = ["vault-dark", "vault-light"];

fs.mkdirSync(SHOTS_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOk(url, timeoutMs = 3000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitFor(predicate, timeoutMs, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  return false;
}

const results = {};
function recordResult(id, pass, extra) {
  results[id] = { pass, ...extra };
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
}

const skippedSteps = [];
function logSkipped(step, reason) {
  skippedSteps.push({ step, reason });
  console.warn(`[capture-tile-parity] SKIPPED: ${step} -- ${reason}`);
}

// ---------------------------------------------------------------------
// CDP closed-shadow-root helpers -- ported from extension/e2e/
// dual-browser.spec.ts's own proven `cdpSession`/`cdpQuery` pattern
// (itself ported from a prior-session probe script), extended with a
// computed-style read via the CSS domain (CSS.getComputedStyleForNode)
// since this script's own job (unlike dual-browser.spec.ts's click-driven
// interactions) is reading a resolved color, not just locating/clicking a
// node.
// ---------------------------------------------------------------------
async function cdpSession(page) {
  const client = await page.context().newCDPSession(page);
  await client.send("DOM.enable");
  await client.send("CSS.enable");
  return client;
}

async function cdpQuery(client, predicate) {
  const { root } = await client.send("DOM.getDocument", { depth: -1, pierce: true });
  const out = [];
  function attrsOf(node) {
    const m = {};
    if (node.attributes) {
      for (let i = 0; i < node.attributes.length; i += 2) m[node.attributes[i]] = node.attributes[i + 1];
    }
    return m;
  }
  function walk(node) {
    const attrs = attrsOf(node);
    if (predicate(node, attrs)) out.push({ node, attrs });
    if (node.children) for (const c of node.children) walk(c);
    if (node.shadowRoots) for (const sr of node.shadowRoots) walk(sr);
    if (node.contentDocument) walk(node.contentDocument);
  }
  walk(root);
  return out;
}

async function cdpComputedBackgroundColor(client, nodeId) {
  const { computedStyle } = await client.send("CSS.getComputedStyleForNode", { nodeId });
  const prop = computedStyle.find((p) => p.name === "background-color");
  return prop ? prop.value : null;
}

// `getComputedStyle(el).backgroundColor` (used for the web/popup React
// tile, a Tailwind `bg-zinc-100`/`bg-base-200` class) and CDP's
// `CSS.getComputedStyleForNode` (used for the in-page shadow tile, a raw
// `var(--pv-tile-bg)` reference) serialize their RESOLVED color in
// whatever color-function notation the ORIGINATING declaration used --
// modern Chromium does not collapse every computed color down to a
// uniform `rgb()` string (CSS Color 4's "computed value" preserves the
// declared color space when it isn't already sRGB legacy). A raw string
// comparison between e.g. `lab(96.16 ...)` (Tailwind's precompiled
// zinc-100) and `oklch(0.967 0.001 286.375)` (tokens.css's own literal)
// would report a false MISMATCH even when both resolve to the exact same
// real pixel color (confirmed live: this project's own UI-SPEC.md
// documents `--pv-tile-bg`'s oklch() value as independently
// "verified against tailwindcss/theme.css" to equal zinc-100). Rendering
// both strings into a 1x1 canvas and reading back 8-bit sRGB pixel data
// is a genuine, browser-native color-space-agnostic normalization --
// canvas 2D context color parsing accepts any valid CSS color function
// and always writes out quantized sRGB, giving a true apples-to-apples
// comparison instead of a brittle string comparison.
async function normalizeColor(page, cssColorString) {
  if (!cssColorString) return null;
  return page.evaluate((c) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
  }, cssColorString);
}

// ---------------------------------------------------------------------
// pv-server + web dev-server lifecycle -- Step 0's reuse-or-start-with-
// bounded-timeout contract, applied to this script's own dedicated ports
// (see the DEVIATION comment at the top of this file for why not :8620).
// ---------------------------------------------------------------------
let ownPvServerProc = null;
let ownWebDevProc = null;
let formServer = null;
let ownPvDbPath = null;

async function ensurePvServer(extensionOrigin) {
  const alreadyHealthy = await fetchOk(`${PV_URL}/healthz`, 2000);
  if (alreadyHealthy) {
    console.log(`[capture-tile-parity] reusing already-healthy pv-server at ${PV_URL}`);
    return;
  }
  console.log(
    `[capture-tile-parity] starting own pv-server at ${PV_URL} (PV_EXTENSION_ORIGINS=${extensionOrigin}, PV_STATIC_DIR=web/out)`,
  );
  const dbPath = path.join(SHOTS_DIR, `tile-parity-${RUN}.db`);
  ownPvDbPath = dbPath;
  const logStream = fs.createWriteStream(PV_LOG_FILE);
  ownPvServerProc = spawn("cargo", ["run", "-p", "pv-server"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PV_ADDR: `127.0.0.1:${PV_PORT}`,
      PV_DB_URL: `sqlite://${dbPath}`,
      PV_EXTENSION_ORIGINS: extensionOrigin,
      PV_STATIC_DIR: path.join(WEB_ROOT, "out"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  ownPvServerProc.stdout.pipe(logStream);
  ownPvServerProc.stderr.pipe(logStream);
  const healthy = await waitFor(() => fetchOk(`${PV_URL}/healthz`, 2000), 30000);
  if (!healthy) {
    throw new Error(
      `pv-server at ${PV_URL} did not become healthy within 30s -- see ${PV_LOG_FILE} for the actual startup error (never a silent hang).`,
    );
  }
  console.log("[capture-tile-parity] own pv-server healthy (serving both the API and the static web app, same origin).");
}

/** Builds web/ as a static export with NEXT_PUBLIC_API_BASE_URL="" (same-
 * origin API calls once pv-server serves this same output via
 * PV_STATIC_DIR -- see the WEB_URL constant's own header comment for why
 * a separate `next dev` server was abandoned). Skipped if a fresh-enough
 * `web/out/index.html` already exists from this run's own earlier build
 * (idempotent re-runs during local iteration should not always pay a full
 * ~5s Turbopack build). */
async function ensureWebStaticExport() {
  const outIndex = path.join(WEB_ROOT, "out", "index.html");
  if (fs.existsSync(outIndex)) {
    console.log(`[capture-tile-parity] reusing existing web/out static export.`);
    return;
  }
  console.log("[capture-tile-parity] building web/ as a static export (NEXT_PUBLIC_API_BASE_URL=\"\")...");
  await new Promise((resolve, reject) => {
    const proc = spawn("npx", ["next", "build"], {
      cwd: WEB_ROOT,
      env: { ...process.env, NEXT_PUBLIC_API_BASE_URL: "" },
      stdio: "inherit",
    });
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`web/ static export build failed with exit code ${code}`));
    });
  });
  console.log("[capture-tile-parity] web/out static export ready.");
}

function startFormServer() {
  return new Promise((resolve) => {
    formServer = http.createServer((req, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(loginFormHtml());
    });
    formServer.listen(FORM_PORT, () => resolve());
  });
}

function loginFormHtml() {
  return `<!doctype html><html><body>
<h1>tile-parity ${RUN}</h1>
<form id="f" autocomplete="on">
  <input id="u" type="text" name="username" autocomplete="username">
  <input id="p" type="password" name="password" autocomplete="current-password">
  <button id="s" type="submit">Sign in</button>
</form>
<script>
  document.getElementById('f').addEventListener('submit', (e) => { e.preventDefault(); });
</script>
</body></html>`;
}

async function cleanup() {
  if (formServer) {
    try {
      formServer.closeAllConnections?.();
      formServer.close();
    } catch {
      /* best-effort */
    }
  }
  if (ownWebDevProc) {
    try {
      ownWebDevProc.kill("SIGTERM");
    } catch {
      /* best-effort */
    }
  }
  if (ownPvServerProc) {
    try {
      ownPvServerProc.kill("SIGTERM");
    } catch {
      /* best-effort */
    }
  }
  // The temp sqlite db this script's own pv-server instance used is
  // local scratch state only (never committed, matches this plan's own
  // prohibition on committing uat-screenshots/) -- delete it and its
  // WAL/SHM siblings so repeated local runs don't accumulate stale
  // *.db/*.db-wal/*.db-shm files in the screenshots directory.
  if (ownPvDbPath) {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.rmSync(`${ownPvDbPath}${suffix}`, { force: true });
      } catch {
        /* best-effort */
      }
    }
  }
}

// ---------------------------------------------------------------------
// Web app helpers (register a fresh dedicated test account -- never reuses
// the shared uat-prf04@example.local account this project's other e2e
// harnesses accumulate state on).
// ---------------------------------------------------------------------
async function registerAndCreateItem(page) {
  await page.goto(`${WEB_URL}/`);
  await page.waitForSelector('[data-testid="login-email"], [data-testid="register-email"]', {
    timeout: 20000,
  });
  // Default mode is login -- toggle to register via the "toggleToRegister"
  // link (LoginForm's own untestid'd `<button type="button">`, the only
  // such button in that form).
  if (await page.locator('[data-testid="login-email"]').count()) {
    // NOT `.first()` on a bare `button[type="button"]` selector --
    // LoginForm also renders `PasskeyUnlockButton` (data-testid=
    // "passkey-unlock-button"), which is ALSO `type="button"` and sits
    // earlier in the DOM than the toggle-to-register link, so a positional
    // `.first()` match hits the wrong button (found live: a 10s timeout
    // waiting for the register form that never appeared). Text-match the
    // toggle link directly instead (PL/EN copy from dictionary.ts's own
    // "auth.toggleToRegister" key).
    await page
      .locator('button:has-text("Zarejestruj"), button:has-text("Sign up")')
      .first()
      .click();
    await page.waitForSelector('[data-testid="register-email"]', { timeout: 10000 });
  }
  await page.locator('[data-testid="register-email"]').fill(EMAIL);
  await page.locator('[data-testid="register-password"]').fill(PASSWORD);
  await page.locator('[data-testid="register-confirm-password"]').fill(PASSWORD);
  await page.locator('[data-testid="register-submit"]').click();
  try {
    await page.waitForSelector('[data-testid="new-item-button"]', { timeout: 30000 });
  } catch (e) {
    await page.screenshot({ path: path.join(SHOTS_DIR, "DEBUG-register-timeout.png") }).catch(() => {});
    fs.writeFileSync(path.join(SHOTS_DIR, "DEBUG-register-timeout.html"), await page.content().catch(() => ""));
    console.error("[capture-tile-parity] DEBUG dump written to uat-screenshots/DEBUG-register-timeout.{png,html}");
    throw e;
  }
  await page.waitForTimeout(800);

  // UI-04 onboarding (shown once, only after a fresh register) -- a
  // 3-step wizard behind a `fixed inset-0` backdrop-blur scrim
  // (OnboardingWizard.tsx) that blocks every other click until dismissed.
  // Step 1's own ImportWizard (variant="inline") exposes
  // `data-testid="import-wizard-skip"` (NOT a "Pomiń"/"Skip" TEXT match --
  // found live: no such text exists on step 1's actual skip control, which
  // silently left `skip.count()` at 0 and the scrim up, causing every
  // subsequent click to hang until Playwright's own retry budget expired).
  // Skipping step 1 advances to step 3 (Finish), which needs its own
  // second dismiss via `onboarding-step3-finish`.
  const importSkip = page.locator('[data-testid="import-wizard-skip"]');
  if (await importSkip.count()) {
    await importSkip.click();
    await page.waitForTimeout(400);
    const finish = page.locator('[data-testid="onboarding-step3-finish"]');
    if (await finish.count()) {
      await finish.click();
      await page.waitForTimeout(400);
    }
  }

  await page.locator('button:has-text("Nowy item"), button:has-text("New item")').first().click();
  await page.waitForTimeout(500);
  await page.locator('[data-testid="type-tile-login"]').first().click();
  await page.waitForTimeout(400);
  await page.locator("#item-name").fill(`Tile Parity ${RUN}`);
  await page.locator("#item-username").fill(`tile-parity-${RUN}`);
  await page.locator("#item-password").fill(`tile-parity-pass-${RUN}!`);
  // urls[0] = github.com -- resolves a real, dark-logo favicon for the
  // web/popup React ItemIconTile (per UI-SPEC.md, chosen specifically to
  // make a vault-dark dark-tile bug visually obvious). urls[1] = this
  // script's own local fixture form origin -- itemMatchesOrigin() (frame-
  // guard.ts) checks `urls.some(...)`, so BOTH resolve: web/popup's
  // favicon comes from urls[0] (domainFromUrl() takes the FIRST non-empty
  // url), while the in-page overlay's Surface A/B origin-gate (a hard
  // security invariant, T-10-05 full-origin equality -- never relaxed for
  // a test) is satisfied by urls[1] matching this script's own fixture
  // page's real origin. The in-page tile's OWN favicon source is
  // `doc.location.origin` (this fixture's origin, not the item's stored
  // URL -- UI-SPEC.md's "Favicon source rule"), so it legitimately falls
  // back to the neutral type-glyph there; only the tile BACKGROUND COLOR
  // (this script's actual computed-style assertion) needs to match across
  // surfaces, not the favicon image itself.
  await page.locator('[data-testid="item-url-0"]').fill("https://github.com");
  const addUrl = page.locator('[data-testid="item-add-url"]');
  if (await addUrl.count()) {
    await addUrl.click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid="item-url-1"]').fill(FORM_URL);
  }
  await page.locator('button:has-text("Zapisz"), button:has-text("Save")').first().click();
  await page.waitForTimeout(1200);
}

async function setWebTheme(page, theme) {
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await page.waitForTimeout(150);
}

// ---------------------------------------------------------------------
// Extension popup helpers.
// ---------------------------------------------------------------------
async function configureAndSignInPopup(popup) {
  // An immediate (non-waiting) `.count()` check right after `goto()` is a
  // genuine race against the popup's own first React render (WASM init +
  // an initial `chrome.storage` read) -- found live via a DEBUG screenshot
  // showing the server-config screen still up, un-filled, after the
  // script had already moved past this branch to wait on a LATER-stage
  // selector that (correctly) never appeared. Wait up to 8s for either
  // this screen or a later one to actually render before branching.
  await popup
    .waitForSelector(
      'input#pv-server-url, [data-testid="server-ceremony-signin-button"], input[type="password"], select',
      { timeout: 8000 },
    )
    .catch(() => {});
  const urlInput = popup.locator("input#pv-server-url");
  if (await urlInput.count()) {
    await urlInput.fill(PV_URL);
    await popup.locator('button[type="submit"]').first().click();
  }
  try {
    await popup.waitForSelector(
      '[data-testid="server-ceremony-signin-button"], input[type="password"], select',
      { timeout: 20000 },
    );
  } catch (e) {
    await popup.screenshot({ path: path.join(SHOTS_DIR, "DEBUG-popup-config-timeout.png") }).catch(() => {});
    fs.writeFileSync(
      path.join(SHOTS_DIR, "DEBUG-popup-config-timeout.html"),
      await popup.content().catch(() => ""),
    );
    console.error("[capture-tile-parity] DEBUG dump written to uat-screenshots/DEBUG-popup-config-timeout.{png,html}");
    throw e;
  }
  if (await popup.locator('[data-testid="server-ceremony-signin-button"]').count()) {
    const signInBtn = popup.locator('[data-testid="server-ceremony-signin-button"]');
    const [ceremonyPage] = await Promise.all([
      popup.context().waitForEvent("page"),
      signInBtn.click(),
    ]);
    await ceremonyPage.locator("input#pv-ext-unlock-email").fill(EMAIL);
    await ceremonyPage.locator("input#pv-ext-unlock-password").fill(PASSWORD);
    await ceremonyPage.locator('[data-testid="ext-unlock-password-submit"]').click();
    await Promise.race([
      ceremonyPage.waitForEvent("close", { timeout: 15000 }).catch(() => {}),
      popup.waitForSelector("select", { timeout: 20000 }).catch(() => {}),
    ]);
  } else if (await popup.locator('input[type="password"]').count()) {
    await popup.fill('input[type="password"]', PASSWORD);
    await popup.locator('button[type="submit"]').first().click();
  }
  await popup.waitForSelector("select", { timeout: 20000 });
}

async function main() {
  console.log("[capture-tile-parity] loading packaged Chrome extension...");
  const extContext = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    viewport: { width: 420, height: 700 },
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  try {
    let [worker] = extContext
      .serviceWorkers()
      .filter((w) => w.url().startsWith("chrome-extension://"));
    if (!worker) {
      worker = await extContext.waitForEvent("serviceworker", { timeout: 20000 });
    }
    const extensionId = new URL(worker.url()).host;
    const extensionOrigin = `chrome-extension://${extensionId}`;
    console.log(`[capture-tile-parity] extension loaded, id=${extensionId}`);

    await ensureWebStaticExport();
    await ensurePvServer(extensionOrigin);
    await startFormServer();

    // ---- Web app: register + create the one shared login item ----
    const webPage = await extContext.newPage();
    // The persistent context's own default viewport (420x700, sized for
    // the POPUP surface -- see launchPersistentContext below) is far too
    // narrow for the web app's desktop layout: DetailPanel's fixed
    // `md:w-[400px]` aside nearly fills a 420px-wide viewport, covering
    // the item list underneath and making a second row click intercept on
    // the still-open panel (found live: a 30s click timeout on the second
    // theme iteration). Every web/ page gets its own real desktop
    // viewport; only the popup page (below) keeps the context default.
    await webPage.setViewportSize({ width: 1280, height: 900 });
    await registerAndCreateItem(webPage);
    console.log("[capture-tile-parity] web app: account registered, item created.");

    // ---- Web app: ItemRow (list) + DetailPanel (header) screenshots ----
    for (const theme of THEMES) {
      await setWebTheme(webPage, theme);
      const row = webPage.locator('[data-testid^="item-row-"]').first();
      await row.waitFor({ timeout: 10000 });
      await row.screenshot({ path: path.join(SHOTS_DIR, `web-itemrow-${theme}.png`) });

      const rowTile = row.locator(".bg-base-200").first();
      const rowTileBox = await rowTile.boundingBox();
      let rowBg = null;
      if (rowTileBox) {
        const raw = await rowTile.evaluate((el) => getComputedStyle(el).backgroundColor);
        rowBg = await normalizeColor(webPage, raw);
      }

      // On the SECOND theme iteration, DetailPanel is still open from the
      // first -- its own `[data-testid="side-panel-scrim"]` (a `fixed
      // inset-0` overlay) then intercepts a fresh click on the row
      // underneath (found live: a 30s click timeout). Close it first so
      // every iteration opens the panel via the same real click path.
      const closeBtn = webPage.locator('[data-testid="detail-panel-close"]');
      if (await closeBtn.count()) {
        await closeBtn.click();
        await webPage.waitForTimeout(200);
      }
      await row.click();
      const detail = webPage.locator('[data-testid="detail-panel"]');
      await detail.waitFor({ timeout: 10000 });
      await webPage.waitForTimeout(200);
      await detail.screenshot({ path: path.join(SHOTS_DIR, `web-detailpanel-${theme}.png`) });
      const detailTile = detail.locator(".bg-base-200").first();
      const detailBg = (await detailTile.count())
        ? await normalizeColor(
            webPage,
            await detailTile.evaluate((el) => getComputedStyle(el).backgroundColor),
          )
        : null;

      recordResult(`web-itemrow-${theme}`, rowBg !== null, { computed: rowBg });
      recordResult(`web-detailpanel-${theme}`, detailBg !== null, { computed: detailBg });
    }
    await setWebTheme(webPage, "vault-dark");

    // ---- Extension popup: list row screenshot + computed style ----
    const popup = await extContext.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await configureAndSignInPopup(popup);
    console.log("[capture-tile-parity] popup: signed in.");
    await popup.waitForTimeout(1000);

    for (const theme of THEMES) {
      // main.tsx stamps `data-theme` on `document.BODY`, not `<html>`
      // (D-12/plan 11-07's own comment: index.html deliberately does NOT
      // hardcode it on the root element) -- unlike web/'s layout.tsx,
      // which stamps `document.documentElement`. Setting `documentElement`
      // here left `<body>` un-stamped; the popup rendered visually
      // unchanged between "themes" even though the ItemIconTile's own
      // computed background happened to still read correctly (its
      // `:root, [data-theme=vault-dark]` default-block token still
      // resolved via `:root`) -- found live via a screenshot that looked
      // identical (light chrome) in the vault-dark capture.
      await popup.evaluate((t) => document.body.setAttribute("data-theme", t), theme);
      await popup.waitForTimeout(150);
      await popup.screenshot({ path: path.join(SHOTS_DIR, `popup-list-${theme}.png`) });
      // Scoped to `button .bg-base-200` (NOT a bare global `.bg-base-200`)
      // -- ItemListView.tsx's own search/sort header bar (line ~281) also
      // carries a plain `bg-base-200` class with NO dark-theme flip
      // (it's a header fill, not a tile), and it renders BEFORE the item
      // row in DOM order, so an unscoped `.first()` silently matched the
      // WRONG element (found live: the "vault-dark" iteration reported
      // vault-LIGHT's base-200 value). ItemListView's own item row is the
      // only `.bg-base-200` nested inside an actual `<button>` in this
      // popup (AutofillItemRow.tsx/TotpFillRow.tsx, the other
      // `bg-base-200` users, both render a `<div>` wrapper, never a
      // `<button>`).
      const tile = popup.locator("button .bg-base-200").first();
      const popupBg = (await tile.count())
        ? await normalizeColor(
            popup,
            await tile.evaluate((el) => getComputedStyle(el).backgroundColor),
          )
        : null;
      recordResult(`popup-list-${theme}`, popupBg !== null, { computed: popupBg });
    }

    // ---- In-page overlay: Surface A (dropdown) + Surface B (form prompt) ----
    const fixturePage = await extContext.newPage();
    // Same fix as webPage above: the context's own 420px-wide popup
    // default viewport makes inpage-overlay.ts's own `position: fixed;
    // top:16; right:16; width:352px` panel overlap this bare fixture
    // form's naturally-flowing fields (found live: the shadow host div
    // intercepted a click on `#p`, a genuine visual overlap on a 420px
    // viewport, not a shadow-DOM piercing bug).
    await fixturePage.setViewportSize({ width: 1000, height: 800 });
    await fixturePage.goto(`${FORM_URL}/`);
    await fixturePage.waitForTimeout(1500); // let content-relay detect + Surface B auto-render

    const cdp = await cdpSession(fixturePage);

    for (const theme of THEMES) {
      // Toggle the mirror via the (already extension-privileged) popup
      // page's own `chrome.storage` access -- see this file's header:
      // a plain content-script/page context has no `chrome.storage`
      // global to call from `page.evaluate`, only genuine extension
      // pages (popup/background) do.
      await popup.evaluate(
        ({ key, value }) => chrome.storage.local.set({ [key]: value }),
        { key: THEME_MIRROR_KEY, value: theme },
      );
      await fixturePage.waitForTimeout(300); // watchMirroredTheme()'s live re-stamp

      // Surface B (form prompt) should already be showing (auto-rendered
      // on page load once matches exist) -- screenshot it directly.
      await fixturePage.screenshot({ path: path.join(SHOTS_DIR, `inpage-prompt-${theme}.png`) });
      const promptTiles = await cdpQuery(cdp, (_n, a) => a.class === "pv-row-icon-tile");
      const promptBg = promptTiles.length
        ? await normalizeColor(
            fixturePage,
            await cdpComputedBackgroundColor(cdp, promptTiles[0].node.nodeId),
          )
        : null;
      recordResult(`inpage-prompt-${theme}`, promptBg !== null, { computed: promptBg });

      // Surface A (per-field dropdown) -- focus the password field.
      await fixturePage.locator("#p").click();
      await fixturePage.waitForTimeout(600);
      await fixturePage.screenshot({ path: path.join(SHOTS_DIR, `inpage-dropdown-${theme}.png`) });
      const dropdownTiles = await cdpQuery(cdp, (_n, a) => a.class === "pv-row-icon-tile");
      const dropdownBg = dropdownTiles.length
        ? await normalizeColor(
            fixturePage,
            await cdpComputedBackgroundColor(cdp, dropdownTiles[dropdownTiles.length - 1].node.nodeId),
          )
        : null;
      recordResult(`inpage-dropdown-${theme}`, dropdownBg !== null, { computed: dropdownBg });

      // Move focus away so the next theme iteration's Surface B
      // screenshot isn't obscured by a lingering dropdown.
      await fixturePage.locator("#u").click();
      await fixturePage.waitForTimeout(200);
    }

    // ---- Cross-mechanism computed-background-color comparison ----
    for (const theme of THEMES) {
      const webBg = results[`web-itemrow-${theme}`]?.computed;
      const popupBg = results[`popup-list-${theme}`]?.computed;
      const dropdownBg = results[`inpage-dropdown-${theme}`]?.computed;
      const promptBg = results[`inpage-prompt-${theme}`]?.computed;

      recordResult(`parity-web-vs-inpage-dropdown-${theme}`, webBg !== null && webBg === dropdownBg, {
        web: webBg,
        inpage: dropdownBg,
      });
      recordResult(`parity-popup-vs-inpage-dropdown-${theme}`, popupBg !== null && popupBg === dropdownBg, {
        popup: popupBg,
        inpage: dropdownBg,
      });
      recordResult(`parity-web-vs-inpage-prompt-${theme}`, webBg !== null && webBg === promptBg, {
        web: webBg,
        inpage: promptBg,
      });
    }

    // ---- Best-effort Firefox Selenium re-run (Step 8) ----
    try {
      const ffBinaryCandidates = [
        process.env.PV_FIREFOX_BINARY,
        "/Applications/Firefox.app/Contents/MacOS/firefox",
      ].filter(Boolean);
      const ffBinary = ffBinaryCandidates.find((p) => fs.existsSync(p));
      if (!ffBinary) {
        logSkipped(
          "Firefox Selenium re-run (Step 8)",
          "no Firefox binary found at this environment's conventional path(s) -- best-effort, not required for this task's own pass/fail",
        );
      } else {
        console.log("[capture-tile-parity] Firefox binary found -- Firefox re-run left to the operator (npm run test:e2e:firefox:autofill runs against the SHARED uat-prf04 account, not this script's own dedicated account; running it here would conflate two different test identities). Logged as available-but-not-invoked.");
        logSkipped(
          "Firefox Selenium re-run (Step 8)",
          "Firefox binary present, but run-autofill-capture.cjs targets the project's SHARED uat-prf04@example.local account/state, not this script's own dedicated tile-parity account -- invoking it here would conflate two independent test identities. Run `npm run test:e2e:firefox:autofill` separately for supplementary Firefox evidence.",
        );
      }
    } catch (e) {
      logSkipped("Firefox Selenium re-run (Step 8)", `probe failed: ${e.message}`);
    }

    results.skipped = skippedSteps;
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

    const failures = Object.entries(results).filter(
      ([k, v]) => k !== "skipped" && v && typeof v === "object" && v.pass === false,
    );
    console.log(`[capture-tile-parity] done. ${Object.keys(results).length - 1} results recorded, ${failures.length} failing.`);
    if (failures.length) {
      console.error("[capture-tile-parity] FAILING comparisons:", JSON.stringify(failures, null, 2));
    }

    await webPage.close().catch(() => {});
    await popup.close().catch(() => {});
    await fixturePage.close().catch(() => {});

    return failures.length === 0;
  } finally {
    await extContext.close().catch(() => {});
    await cleanup();
  }
}

main()
  .then((ok) => {
    process.exit(ok ? 0 : 1);
  })
  .catch(async (e) => {
    console.error("[capture-tile-parity] FATAL:", e);
    await cleanup();
    process.exit(1);
  });
