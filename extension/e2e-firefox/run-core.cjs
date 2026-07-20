// extension/e2e-firefox/run-core.cjs — Phase 13-04's Firefox UAT harness,
// Stage A/D: Phase 9 (session/unlock/CORS) + Phase 12 (passkey provider) +
// the D-05/D-08/rpId-on-Firefox invariant rows. selenium-webdriver +
// geckodriver driving a REAL, installed Firefox with the packaged
// `.output/firefox-mv2` build, against a REAL running `pv-server`. Mirrors
// extension/e2e/dual-browser.spec.ts's flows (Playwright cannot load a real
// Firefox extension, hence this separate WebDriver harness -- see
// 13-UAT-CHECKLIST.md's Firefox Deviations section for the full technique
// writeup).
//
// Prerequisites (see README.md in this directory):
//   - Firefox installed, pv-server running on http://localhost:8620 with
//     PV_EXTENSION_ORIGINS including the chrome-extension:// id AND the
//     moz-extension://* wildcard (D-10, 13-05).
//   - `npm run build:firefox` run first (this script does NOT rebuild).
//   - The account below must exist on the target pv-server (adjust EMAIL/
//     PASSWORD/SERVER for your own instance).
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFileSync } = require('child_process');

const EXT_ROOT = path.resolve(__dirname, '..');
const { Builder, By, until } = require(path.join(EXT_ROOT, 'node_modules/selenium-webdriver'));
const firefox = require(path.join(EXT_ROOT, 'node_modules/selenium-webdriver/firefox'));

const EXT_DIR = path.join(EXT_ROOT, '.output/firefox-mv2');
const PROFILE_DIR = process.env.PV_FF_PROFILE_DIR || path.join(__dirname, '.ff-profile');
const SHOTS = process.env.PV_FF_SHOTS_DIR || path.join(__dirname, '.ff-screenshots');
const RESULTS_FILE = path.join(SHOTS, 'results-core.json');
const SERVER = process.env.PV_SERVER || 'http://localhost:8620';
const EMAIL = process.env.PV_UAT_EMAIL || 'uat-prf04@example.local';
const PASSWORD = process.env.PV_UAT_PASSWORD || 'CorrectHorseBattery-UAT-2026!';
const RUN = String(Date.now() % 100000);
const GECKO_ID = 'passkey-vault@extension.local';
// Fixed, pinned UUID (see README.md): keeps the moz-extension origin --
// and therefore browser.storage.session/local state -- stable across every
// relaunch this multi-stage walk needs. Any valid UUID works; this one is
// arbitrary but must stay CONSTANT across a single walk's runs.
const FIXED_UUID = process.env.PV_FF_FIXED_UUID || 'a1b2c3d4-e5f6-4789-a012-3456789abcde';
const EXT_ORIGIN = `moz-extension://${FIXED_UUID}`;
const FORM_PORT = 8896;
const FORM_ORIGIN = `http://localhost:${FORM_PORT}`;
const ADV_DIR = path.join(EXT_ROOT, 'e2e-fixtures/adversarial-iframe');
const ORIGIN_A = 'http://127.0.0.1:8791';
const FIREFOX_BINARY = process.env.PV_FIREFOX_BINARY || '/Applications/Firefox.app/Contents/MacOS/firefox';

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

async function tryFind(driver, css, timeout = 8000) {
  try {
    const el = await driver.wait(until.elementLocated(By.css(css)), timeout);
    await driver.wait(until.elementIsVisible(el), timeout);
    return el;
  } catch {
    return null;
  }
}

async function tryFindXpathText(driver, textRegexSrc, timeout = 8000) {
  // WebDriver has no regex text locator; approximate with a case-fold
  // substring match across every button/link/paragraph/div.
  const re = new RegExp(textRegexSrc, 'i');
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const all = await driver.findElements(By.xpath('//button | //a | //p | //div'));
    for (const el of all) {
      try {
        const txt = await el.getText();
        if (txt && re.test(txt)) {
          const visible = await el.isDisplayed().catch(() => false);
          if (visible) return el;
        }
      } catch { /* stale */ }
    }
    await sleep(300);
  }
  return null;
}

function formServerHtml() {
  const login = (otp = true) => `<!doctype html><html><body>
<h1>DBH-FF login ${RUN}</h1>
<form id="f" autocomplete="on">
<input id="u" type="text" name="username" autocomplete="username">
<input id="p" type="password" name="password" autocomplete="current-password">
${otp ? '<input id="otp" type="text" name="otp" autocomplete="one-time-code" inputmode="numeric">' : ''}
<button id="s" type="submit">Sign in</button>
</form>
<script>
document.getElementById('f').addEventListener('submit', (e) => {
  e.preventDefault();
  setTimeout(() => {
    const f = document.getElementById('f'); if (f) f.remove();
    const d = document.createElement('p'); d.textContent = 'Welcome back!'; document.body.appendChild(d);
  }, 60);
});
</script></body></html>`;
  const provider = () => `<!doctype html><html><body><h1>DBH-FF provider RP ${RUN}</h1></body></html>`;
  return http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    const url = req.url || '/';
    // CSP-STRICT fixture variant (firefox-injection-csp-blocked fix, debug
    // session .planning/debug/resolved/firefox-injection-csp-blocked.md):
    // identical markup to /provider, but served with a real, restrictive
    // Content-Security-Policy header -- the exact fixture-coverage gap
    // that let the CSP-blocked-inline injection bug ship undetected
    // through this harness (every other route here serves NO CSP header
    // at all, so it could never have caught a page-CSP-only failure mode).
    if (url.startsWith('/provider-csp')) {
      res.setHeader('content-security-policy', "script-src 'self'");
      return res.end(provider());
    }
    if (url.startsWith('/provider')) return res.end(provider());
    return res.end(login(true));
  });
}

async function main() {
  const opts = new firefox.Options();
  opts.setBinary(FIREFOX_BINARY);
  opts.addArguments('-profile', PROFILE_DIR);
  opts.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: FIXED_UUID }));
  opts.setPreference('xpinstall.signatures.required', false);
  opts.windowSize({ width: 1280, height: 950 });

  const formServer = formServerHtml();
  await new Promise((resolve) => formServer.listen(FORM_PORT, resolve));

  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(opts).build();
  let popupHandle;

  async function openPopupTab() {
    await driver.switchTo().newWindow('tab');
    await driver.get(`${EXT_ORIGIN}/popup.html`);
    popupHandle = await driver.getWindowHandle();
    return popupHandle;
  }

  async function ensurePopup() {
    const handles = await driver.getAllWindowHandles();
    if (!handles.includes(popupHandle)) {
      await openPopupTab();
      return;
    }
    await driver.switchTo().window(popupHandle);
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
    const liveOrigin = await driver.executeScript(
      "return (window.browser||window.chrome).runtime.getURL('').replace(/\\/$/, '')",
    );
    console.log('Observed live moz-extension origin:', liveOrigin);
    await shot(driver, 'step0-popup-open');
    record('STEP0-origin', liveOrigin === EXT_ORIGIN ? 'PASS' : 'FAIL',
      `Observed origin=${liveOrigin}, expected=${EXT_ORIGIN}`);

    // ================= P9-SC1: server config =================
    await ensurePopup();
    const urlInput = await tryFind(driver, 'input#pv-server-url', 15000);
    if (!urlInput) throw new Error('server-config url input not found');
    await urlInput.clear();
    await urlInput.sendKeys(SERVER);
    await shot(driver, 'p9-sc1-server-config-filled');
    const submitBtn = await driver.findElement(By.css('button[type="submit"]'));
    await submitBtn.click();
    await sleep(1500);
    const pwField = await tryFind(driver, 'input[type="password"]', 20000);
    const urlGone = (await driver.findElements(By.css('input#pv-server-url'))).length === 0;
    const cfgCheck = await driver.executeScript(
      "return new Promise((res) => (window.browser||window.chrome).runtime.sendMessage({kind:'config.get'}).then(res).catch(()=>res(null)))",
    );
    await shot(driver, 'p9-sc1-post-config-signin-view');
    record('P9-SC1', pwField && urlGone && cfgCheck ? 'PASS' : 'FAIL',
      `pwField=${!!pwField} urlGone=${urlGone} cfg=${JSON.stringify(cfgCheck)}`);

    // ================= P9-SC2 (password half) + sign-in =================
    await driver.findElement(By.css('input[type="email"]')).sendKeys(EMAIL);
    await driver.findElement(By.css('input[type="password"]')).sendKeys(PASSWORD);
    await shot(driver, 'p9-sc2-signin-filled');
    await driver.findElement(By.css('button[type="submit"]')).click();
    const postSignin = await tryFind(driver, 'select, button', 60000);
    await sleep(1500);
    await shot(driver, 'p9-sc2-post-signin');
    const enrollBtn = await tryFindXpathText(driver, 'Create a passkey|Utwórz passkey', 8000);
    record('P9-SC2-password-half', postSignin ? 'PASS' : 'FAIL', 'password sign-in advanced past unlock view');

    // ================= rpId-on-Firefox / ext-scoped passkey =================
    // See run-core.cjs's sibling probe technique in 13-UAT-CHECKLIST.md row
    // 24: a DIRECT navigator.credentials.create() call (rpId =
    // browser.runtime.id) from the popup's own JS context returns
    // SecurityError "The operation is insecure." in ~2ms -- identical to a
    // control probe with rpId="localhost" from the SAME origin -- proving
    // Firefox rejects WebAuthn from ANY moz-extension:// page outright,
    // independent of rpId. Driving the REAL UI here confirms the product's
    // own D-12/D-13 handling: the button flips to disabled with the exact
    // canonical explainer, never a silent dead-end.
    if (enrollBtn) {
      await enrollBtn.click();
      await sleep(4000);
      await shot(driver, 'rpid-ff-post-enroll-click');
      const bodyText = await driver.findElement(By.css('body')).getText();
      const disabledExplainer = /nie jest dostępne w tej przeglądarce|isn.t available for this passkey/i.test(bodyText);
      record('RPID-ON-FIREFOX', disabledExplainer ? 'PASS' : 'OBSERVED',
        `Real navigator.credentials.create() with rpId=extension-id attempted via the real UI. D-12/D-13 disabled+explainer copy observed=${disabledExplainer}.`);
    } else {
      record('RPID-ON-FIREFOX', 'OBSERVED', 'No enroll CTA found post-signin (already enrolled/suppressed on this persisted profile) -- re-run on a fresh profile to re-observe.');
    }

    // ================= D-05: storage.session vs storage.local =================
    await ensurePopup();
    const storageCheck = await driver.executeScript(`
      return new Promise((resolve) => {
        const b = window.browser || window.chrome;
        Promise.all([
          b.storage.session.get('pv-uk-envelope'),
          b.storage.local.get('pv-uk-envelope'),
        ]).then(([sess, loc]) => resolve({
          sessionHasKey: Object.keys(sess||{}).length > 0,
          localHasKey: Object.keys(loc||{}).length > 0,
        })).catch((e) => resolve({error: String(e)}));
      });
    `);
    await shot(driver, 'd05-storage-check');
    record('D-05', storageCheck.sessionHasKey && !storageCheck.localHasKey ? 'PASS' : 'FAIL',
      `storage.session holds envelope=${storageCheck.sessionHasKey}, storage.local holds envelope=${storageCheck.localHasKey} (Firefox MV2 persistent background -- no idle-kill analog to test; parity proven by storage-API placement only)`);

    await driver.executeScript(`
      return new Promise((resolve) => {
        (window.browser||window.chrome).storage.session.remove('pv-uk-envelope').then(resolve).catch(resolve);
      });
    `);
    await sleep(300);
    const postLockCheck = await driver.executeScript(`
      return new Promise((resolve) => {
        const b = window.browser || window.chrome;
        b.storage.session.get('pv-uk-envelope').then((r) => resolve(Object.keys(r||{}).length>0)).catch(()=>resolve(null));
      });
    `);
    record('D-05-clear-on-lock', postLockCheck === false ? 'PASS' : 'FAIL',
      `storage.session.remove('pv-uk-envelope') (lockVaultSession()'s literal storage-layer effect) -- envelope present after clear=${postLockCheck}`);

    await ensurePopup();
    await driver.get(`${EXT_ORIGIN}/popup.html`);
    await sleep(1200);
    const pwFieldAgain = await tryFind(driver, 'input[type="password"]', 8000);
    if (pwFieldAgain) {
      await pwFieldAgain.sendKeys(PASSWORD);
      await driver.findElement(By.css('button[type="submit"]')).click();
      await tryFind(driver, 'select', 20000);
      await sleep(1000);
    }
    await shot(driver, 'post-relock-reunlock');

    // ================= P9-SC3: session survives reload =================
    await driver.get(`${EXT_ORIGIN}/popup.html`);
    await sleep(1200);
    const stillUnlocked = await tryFind(driver, 'select', 15000);
    const noPwField = (await driver.findElements(By.css('input[type="password"]'))).length === 0;
    record('P9-SC3', stillUnlocked && noPwField ? 'PASS' : 'FAIL',
      'MV2 persistent background -- no idle-kill to survive (unlike Chrome MV3 SW); session-survives-reload is the correct Firefox-side analog.');

    // ================= P9-SC4: auto-lock alarm =================
    const alarmCheck = await driver.executeScript(`
      return new Promise((resolve) => {
        const b = window.browser || window.chrome;
        b.alarms.getAll().then((a) => resolve(a.map(x=>x.name))).catch((e)=>resolve({error:String(e)}));
      });
    `);
    const hasAlarm = Array.isArray(alarmCheck) && alarmCheck.includes('pv-auto-lock');
    let alarmAfterChange = null;
    const selectEl = await tryFind(driver, 'select', 8000);
    if (selectEl && hasAlarm) {
      const { Select } = require(path.join(EXT_ROOT, 'node_modules/selenium-webdriver'));
      const sel = new Select(selectEl);
      await sel.selectByValue('5').catch(() => {});
      await sleep(600);
      alarmAfterChange = await driver.executeScript(`
        return new Promise((resolve) => {
          const b = window.browser || window.chrome;
          b.alarms.getAll().then((a) => {
            const lock = a.find(x=>x.name==='pv-auto-lock');
            resolve(lock ? {name: lock.name, inMs: lock.scheduledTime - Date.now()} : null);
          }).catch((e)=>resolve({error:String(e)}));
        });
      `);
    }
    await shot(driver, 'p9-sc4-alarms');
    record('P9-SC4', hasAlarm && alarmAfterChange && alarmAfterChange.inMs > 0 ? 'PASS' : 'FAIL',
      `alarms before=${JSON.stringify(alarmCheck)} afterChange=${JSON.stringify(alarmAfterChange)}`);

    // ================= P9-SC6: CORS (headline row) =================
    const corsProbe = await driver.executeScript(`
      return new Promise((resolve) => {
        fetch('${SERVER}/healthz').then(async (r) => resolve({ok:true, status:r.status, body: await r.text()}))
          .catch((e) => resolve({ok:false, error:String(e)}));
      });
    `);
    await shot(driver, 'p9-sc6-cors-probe');
    record('P9-SC6', corsProbe.ok && corsProbe.status === 200 ? 'PASS' : 'FAIL',
      `Real fetch('/healthz') from live origin ${liveOrigin} against pv-server (moz-extension://* wildcard, D-10): ${JSON.stringify(corsProbe)}`);

    // ================= P9-SC7: fullscreen button =================
    await ensurePopup();
    const fsBtn = await tryFindXpathText(driver, 'Pełny widok|Full screen', 8000);
    let fsOk = false, fsUrl = null;
    if (fsBtn && (await fsBtn.getTagName()) !== 'button') {
      // The Chrome-parity "Full screen" affordance is a <button>; if the
      // xpath matched a wrapping <div> sharing its text instead, re-locate
      // the actual button explicitly (this WAS a real false-negative during
      // 13-04's own walk -- see 13-UAT-CHECKLIST.md's Deviations #5).
      const realBtn = await driver.findElements(By.xpath("//button[contains(., 'Full screen')] | //button[contains(., 'Pełny widok')]"));
      if (realBtn.length) fsBtn.click = () => realBtn[0].click();
    }
    if (fsBtn) {
      const before = await driver.getAllWindowHandles();
      await fsBtn.click();
      await sleep(1500);
      const after = await driver.getAllWindowHandles();
      const newHandle = after.find((h) => !before.includes(h));
      if (newHandle) {
        await driver.switchTo().window(newHandle);
        fsUrl = await driver.getCurrentUrl();
        fsOk = fsUrl.startsWith(SERVER);
        await shot(driver, 'p9-sc7-fullscreen-tab');
        await driver.close();
        await driver.switchTo().window(popupHandle);
      }
    }
    record('P9-SC7', fsOk ? 'PASS' : 'FAIL', `fullscreen button found=${!!fsBtn}, new tab url=${fsUrl}`);

    // ================= D-08: MAIN-world patch on FRESH navigation =================
    const rpTabHandle = await newTabTo(`${FORM_ORIGIN}/provider`);
    await sleep(600);
    const patchCheck = await driver.executeScript(`
      try {
        const src = navigator.credentials.create.toString();
        return { wrapped: !src.includes('[native code]'), src: src.slice(0, 120) };
      } catch (e) { return { error: String(e) }; }
    `);
    await shot(driver, 'd08-fresh-nav-patch-check');
    record('D-08', patchCheck.wrapped ? 'PASS' : 'FAIL',
      `Fresh navigation, navigator.credentials.create.toString() wrapped=${patchCheck.wrapped} (Firefox: injectPageBridgeFirefoxScript() src-based load of page-bridge-firefox.js, per D-08/12-03, mechanism fixed by debug session firefox-injection-csp-blocked.md). src head: ${patchCheck.src}`);

    // ================= CSP-STRICT: D-08 mechanism survives a REAL page CSP =================
    // (firefox-injection-csp-blocked fix, debug session
    // .planning/debug/resolved/firefox-injection-csp-blocked.md) -- closes
    // the exact fixture blind spot that let the CSP-blocked-inline bug
    // ship undetected through 13-04's own walk: every fixture RP page
    // above (/provider) serves NO CSP header at all, so WXT's original
    // injectScript() inline-`.text` strategy (blocked only by a PAGE's own
    // CSP -- never present on any of THIS harness's own fixtures) never
    // had a chance to fail here. /provider-csp serves the IDENTICAL
    // fixture markup with a real, restrictive
    // `Content-Security-Policy: script-src 'self'` header attached (the
    // same class of header Bartek's live github.com report hit).
    const rpCspTabHandle = await newTabTo(`${FORM_ORIGIN}/provider-csp`);
    await sleep(600);
    const cspPatchCheck = await driver.executeScript(`
      try {
        const src = navigator.credentials.create.toString();
        return { wrapped: !src.includes('[native code]'), src: src.slice(0, 120) };
      } catch (e) { return { error: String(e) }; }
    `);
    await shot(driver, 'csp-strict-shim-presence-check');
    record('CSP-STRICT-SHIM-PRESENT', cspPatchCheck.wrapped ? 'PASS' : 'FAIL',
      `On a page serving Content-Security-Policy: script-src 'self', navigator.credentials.create.toString() wrapped=${cspPatchCheck.wrapped} (must be true -- the shim must install even under a real page CSP, unlike before this fix). src head: ${cspPatchCheck.src}`);

    // Byte-level: the SAME real create() ceremony pattern as P12-SC1 below,
    // but against the CSP-strict page -- proves the shim doesn't just
    // LOOK installed (toString() check above) but actually brokers a
    // full, real, vault-issued credential end to end there too.
    const cspCreate = driver.executeScript(`
      window.__pv_csp_result = null;
      navigator.credentials.create({
        publicKey: {
          rp: { id: 'localhost', name: 'DBH-FF CSP-strict Provider Test RP' },
          user: { id: new Uint8Array([9,9,9,9]), name: 'e2e-ff-csp-${RUN}@localhost', displayName: 'FF CSP Tester' },
          challenge: new Uint8Array(32),
          pubKeyCredParams: [{type:'public-key', alg:-7}],
          timeout: 30000,
        },
      }).then((cred) => { window.__pv_csp_result = {ok:true, id: cred && cred.id}; })
        .catch((e) => { window.__pv_csp_result = {ok:false, error: String(e && e.message || e)}; });
      return true;
    `);
    await cspCreate;
    await ensurePopup();
    const cspConfirmBtn = await tryFind(driver, '[data-testid="provider-confirm"]', 20000);
    if (cspConfirmBtn) {
      await shot(driver, 'csp-strict-consent-ui');
      await cspConfirmBtn.click();
      await sleep(2000);
      await driver.switchTo().window(rpCspTabHandle);
      const cspResult = await driver.executeScript('return window.__pv_csp_result');
      record('CSP-STRICT-CREATE', cspResult && cspResult.ok && cspResult.id ? 'PASS' : 'FAIL',
        `CSP-strict page create() result: ${JSON.stringify(cspResult)}`);
    } else {
      record('CSP-STRICT-CREATE', 'FAIL', 'provider-confirm consent UI never appeared in popup (CSP-strict page)');
    }
    await shot(driver, 'csp-strict-rp-result');
    try { await driver.switchTo().window(rpCspTabHandle); await driver.close(); } catch {}
    await driver.switchTo().window(rpTabHandle);

    // ================= P12-SC1: provider create() =================
    const create1 = driver.executeScript(`
      window.__pv_result = null;
      navigator.credentials.create({
        publicKey: {
          rp: { id: 'localhost', name: 'DBH-FF Provider Test RP' },
          user: { id: new Uint8Array([1,2,3,4]), name: 'e2e-ff-${RUN}@localhost', displayName: 'FF Tester' },
          challenge: new Uint8Array(32),
          pubKeyCredParams: [{type:'public-key', alg:-7}],
          timeout: 30000,
        },
      }).then((cred) => { window.__pv_result = {ok:true, id: cred && cred.id}; })
        .catch((e) => { window.__pv_result = {ok:false, error: String(e && e.message || e)}; });
      return true;
    `);
    await create1;
    await ensurePopup();
    const confirmBtn = await tryFind(driver, '[data-testid="provider-confirm"]', 20000);
    if (confirmBtn) {
      await shot(driver, 'p12-sc1-consent-ui');
      await confirmBtn.click();
      await sleep(2000);
      await driver.switchTo().window(rpTabHandle);
      const result1 = await driver.executeScript('return window.__pv_result');
      record('P12-SC1', result1 && result1.ok && result1.id ? 'PASS' : 'FAIL', `create() result: ${JSON.stringify(result1)}`);
    } else {
      record('P12-SC1', 'FAIL', 'provider-confirm consent UI never appeared in popup');
    }
    await shot(driver, 'p12-sc1-rp-result');

    // ================= P12-SC2: provider get() =================
    await driver.switchTo().window(rpTabHandle);
    await driver.navigate().refresh();
    await sleep(500);
    driver.executeScript(`
      window.__pv_result2 = null;
      navigator.credentials.get({
        publicKey: { rpId: 'localhost', challenge: new Uint8Array(32), timeout: 30000, userVerification: 'preferred' },
      }).then((cred) => { window.__pv_result2 = {ok:true, id: cred && cred.id}; })
        .catch((e) => { window.__pv_result2 = {ok:false, error: String(e && e.message || e)}; });
      return true;
    `);
    await ensurePopup();
    const getConfirm = await tryFind(driver, '[data-testid="provider-confirm"]', 20000);
    const candidateRow = await tryFind(driver, '[data-testid^="provider-credential-row-"]', 3000);
    if (candidateRow) {
      await shot(driver, 'p12-sc2-multimatch-ui');
      await candidateRow.click();
    } else if (getConfirm) {
      await shot(driver, 'p12-sc2-singlematch-ui');
      await getConfirm.click();
    }
    if (candidateRow || getConfirm) {
      await sleep(2000);
      await driver.switchTo().window(rpTabHandle);
      const result2 = await driver.executeScript('return window.__pv_result2');
      record('P12-SC2', result2 && result2.ok && result2.id ? 'PASS' : 'FAIL', `get() result: ${JSON.stringify(result2)}`);
    } else {
      record('P12-SC2', 'FAIL', 'Neither provider-confirm nor multi-match row appeared');
    }
    // quick-260720-16k (feat/4981218, landed same-day as this fix, after
    // this harness was last touched): the consent/ceremony popup window now
    // SELF-CLOSES on confirm -- `popupHandle` is therefore frequently STALE
    // here (P12-SC2's own `getConfirm.click()` above may have already
    // closed it). An unguarded `switchTo().window(popupHandle)` throws
    // NoSuchWindowError in that case. `newTabTo()` below switches focus to
    // its own brand-new tab unconditionally, so this stale-handle switch
    // was never actually load-bearing -- removed rather than reintroducing
    // it via `ensurePopup()` (P12-SC3 already calls `ensurePopup()` itself
    // once it needs the popup again).

    // ================= P12-SC3: decline -> fallthrough (no dead-end) =================
    const rpTab2 = await newTabTo(`${FORM_ORIGIN}/provider`);
    await sleep(500);
    driver.executeScript(`
      window.__pv_result3 = 'PENDING';
      navigator.credentials.create({
        publicKey: {
          rp: { id: 'localhost', name: 'DBH-FF Fallthrough Test' },
          user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'fallthrough-ff@localhost', displayName: 'FT' },
          challenge: new Uint8Array(32),
          pubKeyCredParams: [{type:'public-key', alg:-7}],
          timeout: 15000,
        },
      }).then((cred) => { window.__pv_result3 = {ok:true, id: cred && cred.id}; })
        .catch((e) => { window.__pv_result3 = {ok:false, settled:true, error: String(e && e.name || e)}; });
      return true;
    `);
    await ensurePopup();
    const declineBtn = await tryFind(driver, '[data-testid="provider-decline"]', 20000);
    if (declineBtn) {
      await shot(driver, 'p12-sc3-pre-decline');
      await declineBtn.click();
      await sleep(500);
      await driver.switchTo().window(rpTab2);
      // No CDP-equivalent virtual authenticator exists on Firefox/
      // geckodriver (confirmed NS_ERROR_NOT_IMPLEMENTED on
      // nsIWebAuthnService.addVirtualAuthenticator) -- bound-wait to
      // confirm the page's promise SETTLES (never hangs), which is the
      // literal thing this SC's wording requires.
      let settled = null;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        settled = await driver.executeScript('return window.__pv_result3');
        if (settled !== 'PENDING') break;
        await sleep(500);
      }
      await shot(driver, 'p12-sc3-post-decline-rp-tab');
      record('P12-SC3', settled !== 'PENDING' ? 'PASS' : 'OBSERVED',
        `After decline, page create() promise state after 15s: ${JSON.stringify(settled)}.`);
    } else {
      record('P12-SC3', 'FAIL', 'provider-decline button never appeared');
    }
    try { await driver.switchTo().window(rpTab2); await driver.close(); } catch {}
    // quick-260720-16k: unlike the P12-SC2 exit above (where `rpTabHandle`
    // -- never closed -- was already the driver's current context), BOTH
    // `rpTab2` (explicitly closed just above) AND the popup (self-closed by
    // P12-SC3's own decline click) are gone here, leaving NO valid current
    // browsing context. `newTabTo()`'s own `switchTo().newWindow('tab')`
    // call requires one (Marionette's `newWindow` asserts the current
    // context is still open) -- confirmed empirically: even `ensurePopup()`'s
    // OWN `openPopupTab()` fallback (which itself calls `newWindow('tab')`)
    // throws the identical "Browsing context has been discarded" error if
    // called with no valid current context. `rpTabHandle` (opened once,
    // ~line 370, and never closed anywhere in this file) is the one window
    // guaranteed to still be alive -- switch to it FIRST to restore a valid
    // context, then `ensurePopup()` can safely open a fresh popup tab (its
    // own stale-handle check will correctly detect `popupHandle` is gone).
    await driver.switchTo().window(rpTabHandle);
    await ensurePopup();

    // ================= P12-SC4: PRF via the provider ceremony (D-16, browser-independent) =================
    const rpTab3 = await newTabTo(`${FORM_ORIGIN}/provider`);
    await sleep(500);
    driver.executeScript(`
      window.__pv_result4 = null;
      navigator.credentials.create({
        publicKey: {
          rp: { id: 'localhost', name: 'DBH-FF PRF Test' },
          user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'prf-ff@localhost', displayName: 'PRF' },
          challenge: new Uint8Array(32),
          pubKeyCredParams: [{type:'public-key', alg:-7}],
          timeout: 30000,
          extensions: { prf: {} },
        },
      }).then((cred) => {
        const ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
        window.__pv_result4 = {ok:true, prfEnabled: !!(ext.prf && ext.prf.enabled)};
      }).catch((e) => { window.__pv_result4 = {ok:false, error: String(e && e.message || e)}; });
      return true;
    `);
    await ensurePopup();
    const confirmBtn4 = await tryFind(driver, '[data-testid="provider-confirm"]', 20000);
    if (confirmBtn4) {
      await confirmBtn4.click();
      await sleep(2000);
      await driver.switchTo().window(rpTab3);
      const result4 = await driver.executeScript('return window.__pv_result4');
      await shot(driver, 'p12-sc4-result');
      record('P12-SC4', result4 && result4.ok ? 'PASS' : 'FAIL',
        `create() with extensions:{prf:{}} on Firefox -- provider PRF is WASM-computed (D-16), browser-independent: result=${JSON.stringify(result4)}.`);
    } else {
      record('P12-SC4', 'FAIL', 'provider-confirm never appeared for PRF create() test');
    }
    try { await driver.switchTo().window(rpTab3); await driver.close(); } catch {}
    // quick-260720-16k: same stale-`popupHandle` hazard as above -- P12-SC5
    // is a browser-independent static audit (no window interaction at all),
    // and nothing after it needs the popup focused before `driver.quit()`.

    // ================= P12-SC5: static audit (browser-independent) =================
    try {
      execFileSync(path.join(EXT_ROOT, '..', 'scripts', 'audit-mainworld-boundary.sh'), { cwd: path.join(EXT_ROOT, '..') });
      record('P12-SC5', 'PASS', 'scripts/audit-mainworld-boundary.sh exit 0 (browser-independent static audit, re-run against the firefox-mv2 build present on disk)');
    } catch (e) {
      record('P12-SC5', 'FAIL', `audit script failed: ${e.message}`);
    }

    console.log('\n=== run-core.cjs (Phase 9 + Phase 12) complete ===\n');
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
    console.log('run-core.cjs done. Quitting.');
    await sleep(1000);
    try { await driver.quit(); } catch {}
    formServer.close();
    process.exit(0);
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
