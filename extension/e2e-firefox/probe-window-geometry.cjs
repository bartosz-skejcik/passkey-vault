// extension/e2e-firefox/probe-window-geometry.cjs — permanent live-Firefox
// regression probe for UX-02 (18-firefox-window-consent-hardening): the
// consent window (`provider-ceremony.ts`'s `tryOpenFallbackWindow()`, 380x460)
// and the ceremony window (`server-unlock.ts`'s `startServerUnlock()`,
// 480x640) centering, sizing, and self-close contract, driven against the
// REAL production window-open call sites -- never a manually-opened popup
// tab -- on a real, visible Firefox window against a real running pv-server.
//
// WHY KEPT PERMANENTLY (mirrors probe-request-xray.cjs's own precedent):
// the centering/sizing/self-close behavior landed live in quick task
// 260720-16k (commit 40d1965) with only unit coverage over the pure
// `centeredWindowPosition()` formula -- this probe is the durable
// live-Firefox proof that the two REAL `browser.windows.create()` call
// sites actually apply that formula end-to-end, so a future edit to either
// call site cannot silently regress geometry/self-close behavior without a
// green run here.
//
// GEOM-* gates defined (7 total, per 18-UI-SPEC.md's "Window Geometry &
// Lifecycle Contract" numbered assertions #1/#3/#4):
//   GEOM-CEREMONY-SIZE      -- ceremony window opens at exactly 480x640
//   GEOM-CEREMONY-POSITION  -- ceremony window centered per the formula
//                               (TOLERANCE_PX position-only slack)
//   GEOM-CEREMONY-CLOSE     -- ceremony window closes on successful
//                               password sign-in
//   GEOM-CONSENT-SIZE       -- consent window opens at exactly 380x460
//   GEOM-CONSENT-POSITION   -- consent window centered per the formula
//   GEOM-CONSENT-CLOSE-CONFIRM -- consent window closes on explicit confirm
//   GEOM-CONSENT-CLOSE-DECLINE -- consent window closes on explicit decline
//
// EXPLICITLY OUT OF SCOPE for this probe (stays unit-only / deferred, see
// 18-01-PLAN.md Task 2's action block for the full rationale):
//   - assertion #2 (missing/partial geometry -> {}) -- environment-
//     uncontrollable from outside the extension, window-geometry.test.ts's
//     job.
//   - assertion #5's non-close exceptions (forbidden-origin,
//     ceremony-failed, the 120s alarm timeout) -- too slow/environment-
//     specific for a routine probe, server-unlock.test.ts's job.
//   - assertion #6 (pure-function negative-position pass-through) --
//     pure-function-only, window-geometry.test.ts's job (18-01 Task 1).
//   - `focused: true` -- not reliably readable via WebDriver's getRect(),
//     already source-verified unchanged at both call sites (provider-
//     ceremony.ts line ~297, server-unlock.ts line ~223).
//   - RESEARCH.md's Open Question 1 (the double-window-open/"zero-one-many"
//     concurrent startServerUnlock() race, 18-UI-SPEC's own backstop row):
//     already unit-tested in server-unlock.test.ts ("latest wins" closes
//     the prior window, overwrites its nonce) -- UX-02's success criteria
//     are centering/sizing/self-close, not concurrency races, so this
//     probe deliberately does NOT add a live assertion for it. Deferred,
//     not silently omitted (mirrors 18-01-PLAN.md's own must_haves
//     backstop entry).
//
// DELIBERATE FORMULA DUPLICATION: `centeredWindowPosition()`'s own
// two-line formula is duplicated locally below (`expectedPosition()`)
// rather than imported, since this file runs as a bare Node.js script
// against the built extension package, not through the TS/vitest module
// graph. `extension/lib/window-geometry.ts` remains the single source of
// truth for the formula itself -- any drift between that file and this
// probe's copy is caught by window-geometry.test.ts's own 8 cases
// (including 18-01 Task 1's new negative-position case), not silently.
//
// Prerequisites: identical to probe-request-xray.cjs/run-core.cjs (see
// README.md) -- pv-server already running on localhost:8620 with
// PV_EXTENSION_ORIGINS including the moz-extension://* wildcard, `npm run
// build:firefox` already run (this script does NOT rebuild anything and
// does NOT restart the server). Reuses the harness's existing shared
// `uat-prf04@example.local` test account.
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');

const EXT_ROOT = path.resolve(__dirname, '..');
const { Builder, By, until } = require(path.join(EXT_ROOT, 'node_modules/selenium-webdriver'));
const firefox = require(path.join(EXT_ROOT, 'node_modules/selenium-webdriver/firefox'));

const EXT_DIR = path.join(EXT_ROOT, '.output/firefox-mv2');
const PROFILE_DIR = process.env.PV_FF_PROFILE_DIR || path.join(__dirname, '.ff-profile-probe-window-geometry');
const SHOTS = process.env.PV_FF_SHOTS_DIR || path.join(__dirname, '.ff-screenshots-probe-window-geometry');
const RESULTS_FILE = path.join(SHOTS, 'results-probe-window-geometry.json');
const SERVER = process.env.PV_SERVER || 'http://localhost:8620';
const EMAIL = process.env.PV_UAT_EMAIL || 'uat-prf04@example.local';
const PASSWORD = process.env.PV_UAT_PASSWORD || 'CorrectHorseBattery-UAT-2026!';
const RUN = String(Date.now() % 100000);
const GECKO_ID = 'passkey-vault@extension.local';
// Fresh FIXED_UUID, distinct from every other probe's (run-core.cjs's
// a1b2..., probe-provider-corruption.cjs's, probe-request-xray.cjs's
// c3d4e5f6-...) -- keeps this probe's moz-extension origin/storage state
// isolated from a concurrently-running sibling probe.
const FIXED_UUID = process.env.PV_FF_FIXED_UUID || 'f6a7b8c9-d0e1-4234-a567-89abcdef0123';
const EXT_ORIGIN = `moz-extension://${FIXED_UUID}`;
// Distinct from run-core.cjs's 8896, probe-provider-corruption.cjs's 8897,
// probe-request-xray.cjs's 8899.
const FORM_PORT = 8898;
const FORM_ORIGIN = `http://localhost:${FORM_PORT}`;
const FIREFOX_BINARY = process.env.PV_FIREFOX_BINARY || '/Applications/Firefox.app/Contents/MacOS/firefox';

// Fixed sizes -- must match provider-ceremony.ts's CONSENT_WINDOW_WIDTH/
// HEIGHT and server-unlock.ts's CEREMONY_WINDOW_WIDTH/HEIGHT exactly.
const CONSENT_WIDTH = 380;
const CONSENT_HEIGHT = 460;
const CEREMONY_WIDTH = 480;
const CEREMONY_HEIGHT = 640;

// Position-only comparison tolerance: WebDriver's getRect() reads the
// browser's OUTER window bounds, which can differ slightly from what the
// extension's own browser.windows.getLastFocused() reads inside the
// background context, by window-manager/DPI chrome-decoration slack.
// Width/height are compared with EXACT equality (never tolerance) since
// those are the two windows.create() call sites' own hardcoded literals.
const TOLERANCE_PX = 5;

fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(PROFILE_DIR, { recursive: true });

const results = {};
function record(id, status, notes) {
  results[id] = { status, notes };
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  console.log(`\n[${status}] ${id}\n  ${notes}\n`);
}

let shotN = 0;
async function shot(driver, name) {
  shotN += 1;
  const file = path.join(SHOTS, `${String(shotN).padStart(2, '0')}-${name}.png`);
  try {
    const data = await driver.takeScreenshot();
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  } catch (e) {
    console.warn('screenshot failed:', e.message);
  }
  return file;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Hoisted so the FATAL top-level `.catch` (below `main()`) can quit/close
// them even when `main()` throws before returning `{ driver, formServer }`
// -- see WR-03 (18-REVIEW.md): without this hoist, a mid-run throw orphans
// the geckodriver-spawned Firefox process tree because `driver` was only a
// local inside `main()`.
let driver;
let formServer;

/** Best-effort `driver.quit()` that never hangs the FATAL exit path past
 * `timeoutMs` -- a wedged geckodriver session must not block `process.exit`. */
async function quitBounded(d, timeoutMs = 5000) {
  if (!d) return;
  try {
    await Promise.race([d.quit(), sleep(timeoutMs)]);
  } catch {}
}

async function tryFind(driver, css, timeout = 8000) {
  try {
    const el = await driver.wait(until.elementLocated(By.css(css)), timeout);
    await driver.wait(until.elementIsVisible(el), timeout);
    return el;
  } catch {
    return null;
  }
}

/** Duplicates centeredWindowPosition()'s exact formula -- see this file's
 * header comment on why this is a deliberate copy, not an import. */
function expectedPosition(cur, newWidth, newHeight) {
  return {
    left: Math.round(cur.x + (cur.width - newWidth) / 2),
    top: Math.round(cur.y + (cur.height - newHeight) / 2),
  };
}

function withinTolerance(observed, expected, label) {
  const dLeft = Math.abs(observed.x - expected.left);
  const dTop = Math.abs(observed.y - expected.top);
  return {
    pass: dLeft <= TOLERANCE_PX && dTop <= TOLERANCE_PX,
    notes: `${label}: observed=(${observed.x},${observed.y}) expected=(${expected.left},${expected.top}) delta=(${dLeft},${dTop}) tolerance=${TOLERANCE_PX}px`,
  };
}

/** Waits up to `timeoutMs` for a NEW window handle (not present in
 * `before`) to appear -- mirrors run-core.cjs's P9-SC2/P12-SC1 handlesBefore/
 * handlesAfter/newHandles diff technique. Returns the single new handle, or
 * null if none/more than one appeared within the deadline. */
async function waitForNewHandle(driver, before, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const after = await driver.getAllWindowHandles();
    const fresh = after.filter((h) => !before.includes(h));
    if (fresh.length === 1) return fresh[0];
    if (fresh.length > 1) return null;
    await sleep(200);
  }
  return null;
}

/** Waits up to `timeoutMs` for `handle` to no longer be present among the
 * live window handles (self-close observed). */
async function waitForHandleGone(driver, handle, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const handles = await driver.getAllWindowHandles();
    if (!handles.includes(handle)) return true;
    await sleep(200);
  }
  return false;
}

function formServerHtml() {
  const provider = () => `<!doctype html><html><body><h1>PROBE-WINDOW-GEOMETRY provider RP ${RUN}</h1></body></html>`;
  return http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end(provider());
  });
}

async function main() {
  const opts = new firefox.Options();
  opts.setBinary(FIREFOX_BINARY);
  opts.addArguments('-profile', PROFILE_DIR);
  opts.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: FIXED_UUID }));
  opts.setPreference('xpinstall.signatures.required', false);
  opts.windowSize({ width: 1280, height: 950 });

  formServer = formServerHtml();
  await new Promise((resolve) => formServer.listen(FORM_PORT, resolve));

  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(opts).build();
  let popupHandle;

  async function openPopupTab() {
    await driver.switchTo().newWindow('tab');
    await driver.get(`${EXT_ORIGIN}/popup.html`);
    popupHandle = await driver.getWindowHandle();
    return popupHandle;
  }

  async function newTabTo(url) {
    await driver.switchTo().newWindow('tab');
    await driver.get(url);
    return driver.getWindowHandle();
  }

  try {
    console.log('Installing extension (temporary, persistent profile)...');
    const addonId = await driver.installAddon(EXT_DIR, true);
    console.log('installed addon id:', addonId);
    await sleep(1500);

    await openPopupTab();
    await sleep(800);

    // Force a clean slate every run -- the persistent PROFILE_DIR carries
    // the extension's own browser.storage.local/session state (server
    // config, session token, unlocked key envelope) across separate
    // invocations of this script, which would otherwise skip straight past
    // the server-config screen this probe's flow starts from. Mirrors
    // run-server-unlock.cjs's identical `window.localStorage.clear()`
    // clean-slate technique, applied to the extension's own storage APIs
    // instead of the web app's localStorage.
    await driver.executeScript(`
      return new Promise((resolve) => {
        const b = window.browser || window.chrome;
        Promise.all([b.storage.local.clear(), b.storage.session.clear()]).then(resolve).catch(resolve);
      });
    `);
    await driver.get(`${EXT_ORIGIN}/popup.html`);
    await sleep(800);

    // ================= server config + sign-in =================
    const urlInput = await tryFind(driver, 'input#pv-server-url', 15000);
    if (!urlInput) throw new Error('server-config url input not found');
    await urlInput.clear();
    await urlInput.sendKeys(SERVER);
    const submitBtn = await driver.findElement(By.css('button[type="submit"]'));
    await submitBtn.click();
    await sleep(1500);
    const signinCta = await tryFind(driver, '[data-testid="server-ceremony-signin-button"]', 20000);
    if (!signinCta) throw new Error('server-ceremony-signin-button not found -- cannot continue');

    // ================= GEOM-CEREMONY-SIZE / GEOM-CEREMONY-POSITION =====
    // preCeremonyRect approximates what getCurrentWindowGeometry() reads
    // inside the extension at click-time (no second OS window exists yet,
    // so the popup tab's own outer window bounds ARE the "current" window
    // browser.windows.getLastFocused() would report).
    const preCeremonyRect = await driver.manage().window().getRect();
    const handlesBeforeCeremony = await driver.getAllWindowHandles();
    await signinCta.click();
    const ceremonyHandle = await waitForNewHandle(driver, handlesBeforeCeremony, 20000);
    if (!ceremonyHandle) {
      record('GEOM-CEREMONY-SIZE', 'FAIL', 'ceremony window did not open (or more than one new window appeared)');
      record('GEOM-CEREMONY-POSITION', 'FAIL', 'ceremony window did not open, cannot measure position');
      throw new Error('ceremony window did not open -- cannot continue');
    }
    await driver.switchTo().window(ceremonyHandle);
    await sleep(500);
    const ceremonyRect = await driver.manage().window().getRect();
    await shot(driver, 'ceremony-window-open');
    record(
      'GEOM-CEREMONY-SIZE',
      ceremonyRect.width === CEREMONY_WIDTH && ceremonyRect.height === CEREMONY_HEIGHT ? 'PASS' : 'FAIL',
      `observed=${ceremonyRect.width}x${ceremonyRect.height}, expected=${CEREMONY_WIDTH}x${CEREMONY_HEIGHT}`,
    );
    const ceremonyPosCheck = withinTolerance(
      ceremonyRect,
      expectedPosition(preCeremonyRect, CEREMONY_WIDTH, CEREMONY_HEIGHT),
      'ceremony window',
    );
    record('GEOM-CEREMONY-POSITION', ceremonyPosCheck.pass ? 'PASS' : 'FAIL', ceremonyPosCheck.notes);

    // ================= GEOM-CEREMONY-CLOSE =================
    await driver.findElement(By.css('input#pv-ext-unlock-email')).sendKeys(EMAIL);
    await driver.findElement(By.css('input#pv-ext-unlock-password')).sendKeys(PASSWORD);
    await shot(driver, 'ceremony-window-filled');
    await driver.findElement(By.css('[data-testid="ext-unlock-password-submit"]')).click();
    const ceremonyClosed = await waitForHandleGone(driver, ceremonyHandle, 8000);
    record('GEOM-CEREMONY-CLOSE', ceremonyClosed ? 'PASS' : 'FAIL',
      `ceremony window handle present after submit=${!ceremonyClosed}`);

    // Switch back to the popup tab and confirm it advanced past unlock.
    await driver.switchTo().window(popupHandle);
    const postSignin = await tryFind(driver, 'select, button', 60000);
    await sleep(1000);
    if (!postSignin) throw new Error('popup did not advance past unlock view after sign-in -- cannot continue to consent-window rows');

    // ================= GEOM-CONSENT-SIZE / GEOM-CONSENT-POSITION =======
    const rpTabHandle = await newTabTo(`${FORM_ORIGIN}/`);
    await sleep(500);
    const preConsentRect = await driver.manage().window().getRect();
    const handlesBeforeConsent = await driver.getAllWindowHandles();
    const randomUserId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
    const randomChallenge = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256));
    await driver.executeScript(`
      window.__pv_geom_create_result = null;
      navigator.credentials.create({
        publicKey: {
          rp: { id: 'localhost', name: 'PROBE-WINDOW-GEOMETRY RP' },
          user: { id: new Uint8Array(${JSON.stringify(randomUserId)}), name: 'probe-window-geometry-${RUN}@localhost', displayName: 'GeomProbe' },
          challenge: new Uint8Array(${JSON.stringify(randomChallenge)}),
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          timeout: 30000,
        },
      }).then((cred) => { window.__pv_geom_create_result = { ok: true, id: cred && cred.id }; })
        .catch((e) => { window.__pv_geom_create_result = { ok: false, error: String(e && e.message || e) }; });
      return true;
    `);
    const consentHandle1 = await waitForNewHandle(driver, handlesBeforeConsent, 20000);
    if (!consentHandle1) {
      record('GEOM-CONSENT-SIZE', 'FAIL', 'consent (fallback) window did not open for create() -- or more than one new window appeared');
      record('GEOM-CONSENT-POSITION', 'FAIL', 'consent window did not open, cannot measure position');
      throw new Error('consent window did not open for create() -- cannot continue');
    }
    await driver.switchTo().window(consentHandle1);
    await sleep(500);
    const consentRect1 = await driver.manage().window().getRect();
    await shot(driver, 'consent-window-create-open');
    record(
      'GEOM-CONSENT-SIZE',
      consentRect1.width === CONSENT_WIDTH && consentRect1.height === CONSENT_HEIGHT ? 'PASS' : 'FAIL',
      `observed=${consentRect1.width}x${consentRect1.height}, expected=${CONSENT_WIDTH}x${CONSENT_HEIGHT}`,
    );
    const consentPosCheck = withinTolerance(
      consentRect1,
      expectedPosition(preConsentRect, CONSENT_WIDTH, CONSENT_HEIGHT),
      'consent window',
    );
    record('GEOM-CONSENT-POSITION', consentPosCheck.pass ? 'PASS' : 'FAIL', consentPosCheck.notes);

    // ================= GEOM-CONSENT-CLOSE-CONFIRM =================
    const confirmBtn = await tryFind(driver, '[data-testid="provider-confirm"]', 20000);
    if (!confirmBtn) {
      record('GEOM-CONSENT-CLOSE-CONFIRM', 'FAIL', 'provider-confirm button never appeared in consent window');
      throw new Error('provider-confirm not found -- cannot continue to decline row');
    }
    await shot(driver, 'consent-window-create-confirm-ui');
    await confirmBtn.click();
    const consentClosedConfirm = await waitForHandleGone(driver, consentHandle1, 8000);
    record('GEOM-CONSENT-CLOSE-CONFIRM', consentClosedConfirm ? 'PASS' : 'FAIL',
      `consent window handle present after confirm=${!consentClosedConfirm}`);
    await sleep(500);
    const createResult = await driver.switchTo().window(rpTabHandle).then(() =>
      driver.executeScript('return window.__pv_geom_create_result'),
    );
    console.log('create() result:', JSON.stringify(createResult));

    // ================= GEOM-CONSENT-CLOSE-DECLINE =================
    await driver.switchTo().window(rpTabHandle);
    await driver.navigate().refresh();
    await sleep(500);
    const handlesBeforeConsent2 = await driver.getAllWindowHandles();
    await driver.executeScript(`
      window.__pv_geom_get_result = null;
      navigator.credentials.get({
        publicKey: { rpId: 'localhost', challenge: new Uint8Array(${JSON.stringify(randomChallenge)}), timeout: 30000, userVerification: 'preferred' },
      }).then((cred) => { window.__pv_geom_get_result = { ok: true, id: cred && cred.id }; })
        .catch((e) => { window.__pv_geom_get_result = { ok: false, error: String(e && e.message || e) }; });
      return true;
    `);
    const consentHandle2 = await waitForNewHandle(driver, handlesBeforeConsent2, 20000);
    if (!consentHandle2) {
      record('GEOM-CONSENT-CLOSE-DECLINE', 'FAIL', 'consent (fallback) window did not open for get() -- or more than one new window appeared');
      throw new Error('consent window did not open for get() -- cannot continue');
    }
    await driver.switchTo().window(consentHandle2);
    await sleep(500);
    // provider-decline is present regardless of single/multi-match per
    // ProviderCeremonyView.tsx -- no need to branch on candidate rows here.
    const declineBtn = await tryFind(driver, '[data-testid="provider-decline"]', 20000);
    if (!declineBtn) {
      record('GEOM-CONSENT-CLOSE-DECLINE', 'FAIL', 'provider-decline button never appeared in consent window');
      throw new Error('provider-decline not found');
    }
    await shot(driver, 'consent-window-get-decline-ui');
    await declineBtn.click();
    const consentClosedDecline = await waitForHandleGone(driver, consentHandle2, 8000);
    record('GEOM-CONSENT-CLOSE-DECLINE', consentClosedDecline ? 'PASS' : 'FAIL',
      `consent window handle present after decline=${!consentClosedDecline}`);

    console.log('\n=== probe-window-geometry.cjs complete ===\n');
    console.log(JSON.stringify(results, null, 2));

    return { driver, formServer };
  } catch (e) {
    console.error('FATAL:', e);
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
    throw e;
  }
}

if (require.main === module) {
  main().then(async ({ driver, formServer }) => {
    console.log('probe-window-geometry.cjs done. Quitting.');
    await sleep(1000);
    try { await driver.quit(); } catch {}
    formServer.close();
    const failed = Object.entries(results).filter(([, r]) => r.status === 'FAIL');
    if (failed.length) {
      console.error('FAILED gates:', failed.map(([k]) => k).join(', '));
      process.exit(1);
    }
    process.exit(0);
  }).catch(async (e) => {
    console.error(e);
    // WR-03 (18-REVIEW.md): the happy path above quits `driver`/closes
    // `formServer` itself, but a thrown error skips straight here -- without
    // this, the geckodriver-spawned Firefox process tree (and its
    // persistent PROFILE_DIR, visible OS window) survives as an orphan.
    // `driver`/`formServer` are the module-level hoisted bindings `main()`
    // assigned to (not the now-out-of-scope `{ driver, formServer }`
    // destructured in the `.then()` above), so they are populated even when
    // `main()` throws mid-run.
    await quitBounded(driver);
    try { formServer && formServer.close(); } catch {}
    process.exit(1);
  });
}
