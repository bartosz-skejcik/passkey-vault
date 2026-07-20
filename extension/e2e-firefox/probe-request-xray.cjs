// extension/e2e-firefox/probe-request-xray.cjs — permanent byte-level
// regression probe for the Firefox Xray/cross-realm hole
// (.planning/debug/resolved/firefox-request-xray-hole.md, Critical, XBR-02).
//
// REQUEST direction (MAIN(page-bridge-firefox.ts)->ISOLATED
// (content-relay.content.ts)): every existing e2e fixture elsewhere in this
// project (run-core.cjs's CSP-STRICT-CREATE/P12-SC1/P12-SC2,
// probe-provider-corruption.cjs) drives navigator.credentials.create()/get()
// with challenge/user.id fields shaped as `new Uint8Array(...)` -- a
// TypedArray. On real Firefox, a TypedArray's cross-realm identity survives
// the MAIN->ISOLATED window.postMessage hop intact (`ArrayBuffer.isView()`
// is an internal-slot check, not a prototype-chain check, so it stays
// reliable cross-realm) -- but a RAW (non-TypedArray) `ArrayBuffer`, which
// real-world RPs DO send (e.g. GitHub's webauthn-json library passes
// challenge/ids as ArrayBuffer, not TypedArray), does NOT survive the same
// hop the same way: `value instanceof ArrayBuffer` (a prototype-chain
// check) was FALSE on the receiving (ISOLATED-world) side despite the value
// being a fully intact, byte-correct ArrayBuffer. FIXED: isBufferSource()
// now also accepts `Object.prototype.toString.call(value) === "[object
// ArrayBuffer]"`, and bufferSourceToB64Url()'s internal branch
// discriminator uses the cross-realm-safe `ArrayBuffer.isView()`. Verified
// below by XRAY-CREATE/XRAY-GET's byte-exact challenge round-trip
// (`clientDataParsed.challenge`), driven the ORIGINAL way (a
// `driver.executeScript(...)`-injected `.then()` capture) -- this half of
// the gate has no `instanceof`/realm-identity check in it (only a JSON
// string comparison), so it is NOT subject to the WebDriver-artifact
// correction described below.
//
// RESPONSE direction (ISOLATED->MAIN, credential.rawId/response.*):
// page-bridge-firefox.ts's shapeCredential() now re-materializes every
// response-direction binary field as a genuine MAIN-world-native
// ArrayBuffer (Plan 14-02 Task 2). FULLY RESOLVED, hard-gated below --
// see .planning/debug/resolved/firefox-request-xray-hole.md's Resolution
// section for the complete history, including a critical correction:
//
// ***WEBDRIVER-ARTIFACT WARNING (read before touching the *IsArrayBuffer
// capture logic below)***: Plan 14-02's own investigation (debug doc
// Evidence entry timestamped 2026-07-20T11:30:00Z) discovered that
// `driver.executeScript(...)` runs injected script text in geckodriver's
// own per-call sandbox realm -- a FRESH, distinct global object set (its
// OWN `ArrayBuffer` constructor, unrelated to the real page's) is created
// for EVERY `executeScript` invocation. A value constructed in the REAL
// page's own realm (e.g. `cred.rawId`, built by page-bridge-firefox.ts's
// `shapeCredential()`, which itself runs in the page's genuine MAIN world)
// will therefore show `instanceof ArrayBuffer: false` when checked by code
// whose OWN top-level text was injected via `executeScript` -- REGARDLESS
// of whether that check runs synchronously or inside a later `.then()`/
// `setTimeout` continuation of that same `executeScript` call, because the
// continuation's closure still resolves `ArrayBuffer` against the
// SANDBOX's global (its defining realm), not the page's. This is a false
// negative with ZERO connection to any real Xray/extension/postMessage
// hazard -- confirmed via a 100%-native, zero-extension-involvement
// `ArrayBuffer` reproducing the identical signature. The ONLY technique
// proven decisive (debug doc, same Evidence entry, method (3)): a
// genuinely INLINE `<script>` tag that is part of the RP fixture's own
// HTML source (parsed by the browser during normal page load, giving the
// function its OWN closure over the PAGE's real globals -- JS functions
// always execute in their defining realm, regardless of what realm calls
// them) performing BOTH the `navigator.credentials.create()/get()` trigger
// AND the `instanceof` checks, with the RESULT written to a DOM element
// (a plain string -- safe to read back via `executeScript` or a native
// WebDriver DOM read, since strings/primitives have no per-realm identity
// issue) rather than a live object a later call would need to re-check.
// This probe's XRAY-CREATE/XRAY-GET response-direction battery below
// therefore uses inline `<script nonce="...">` fixture pages
// (`/xray-create`, `/xray-get`) -- NOT `driver.executeScript()` -- for
// every `*IsArrayBuffer` capture. Do not "simplify" this back to an
// executeScript-injected `.then()` capture; that is the exact pattern
// that produced this correction's false negative in the first place.
//
// This probe is kept here PERMANENTLY (not just for this investigation),
// mirroring probe-provider-corruption.cjs's own precedent, as the one row
// in this project's e2e suites that exercises a RAW ArrayBuffer-shaped
// (not TypedArray) challenge/user.id AND hard-gates response-direction
// realm identity for every binary field, against a REAL, CSP-strict-styled
// fixture page on real Firefox.
//
// Prerequisites: identical to run-core.cjs/probe-provider-corruption.cjs
// (see README.md) -- pv-server already running on localhost:8620,
// `npm run build:firefox` already run. This script does NOT rebuild
// anything and does NOT restart the server.
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

const EXT_ROOT = path.resolve(__dirname, '..');
const { Builder, By, until } = require(path.join(EXT_ROOT, 'node_modules/selenium-webdriver'));
const firefox = require(path.join(EXT_ROOT, 'node_modules/selenium-webdriver/firefox'));

const EXT_DIR = path.join(EXT_ROOT, '.output/firefox-mv2');
const PROFILE_DIR = process.env.PV_FF_PROFILE_DIR || path.join(__dirname, '.ff-profile-probe-request-xray');
const SHOTS = process.env.PV_FF_SHOTS_DIR || path.join(__dirname, '.ff-screenshots-probe-request-xray');
const RESULTS_FILE = path.join(SHOTS, 'results-probe-request-xray.json');
const SERVER = process.env.PV_SERVER || 'http://localhost:8620';
const EMAIL = process.env.PV_UAT_EMAIL || 'uat-prf04@example.local';
const PASSWORD = process.env.PV_UAT_PASSWORD || 'CorrectHorseBattery-UAT-2026!';
const RUN = String(Date.now() % 100000);
const GECKO_ID = 'passkey-vault@extension.local';
const FIXED_UUID = process.env.PV_FF_FIXED_UUID || 'c3d4e5f6-a7b8-4901-b234-56789abcdef0';
const EXT_ORIGIN = `moz-extension://${FIXED_UUID}`;
const FORM_PORT = 8899;
const FORM_ORIGIN = `http://localhost:${FORM_PORT}`;
const FIREFOX_BINARY = process.env.PV_FIREFOX_BINARY || '/Applications/Firefox.app/Contents/MacOS/firefox';

// Known, non-trivial byte vectors (distinct from probe-provider-corruption
// .cjs's [1..32] so a stale-cache/wrong-fixture bug would also be caught).
const CREATE_CHALLENGE_BYTES = Array.from({ length: 32 }, (_, i) => 200 - i);
const CREATE_EXPECTED_B64URL = Buffer.from(CREATE_CHALLENGE_BYTES).toString('base64url');
const GET_CHALLENGE_BYTES = Array.from({ length: 32 }, (_, i) => 50 + i * 2);
const GET_EXPECTED_B64URL = Buffer.from(GET_CHALLENGE_BYTES).toString('base64url');

// A single nonce, shared by the CSP header and the inline <script nonce="">
// tag on the /xray-create and /xray-get fixture pages -- real-website
// technique for allowlisting one specific inline script under a strict
// `script-src 'self'` policy without a blanket `'unsafe-inline'`. The
// extension's own MAIN-world injection (page-bridge-firefox.js, loaded via
// `.src`, not inline text) is unaffected either way -- WebExtension content-
// script resource injection bypasses page CSP entirely, independent of this
// nonce (see .planning/debug/resolved/firefox-injection-csp-blocked.md).
const CSP_NONCE = crypto.randomBytes(16).toString('base64');

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

/** Waits for the inline-script fixture's `#pv-xray-out[data-status="done"]`
 * marker, then reads its (JSON-string) result via a native WebDriver DOM
 * text read -- NOT `driver.executeScript()` -- and parses it. See this
 * file's header comment: the *contents* of that string were computed
 * entirely by the page's own genuinely-inline `<script>` tag (the
 * `instanceof`/`toString.call` battery below), never by anything
 * `executeScript`-injected, so this readback step never touches the
 * WebDriver-sandbox-realm hazard either. */
async function waitForXrayResult(driver, timeoutMs = 20000) {
  const el = await driver.wait(until.elementLocated(By.css('#pv-xray-out')), timeoutMs);
  await driver.wait(async () => (await el.getAttribute('data-status')) === 'done', timeoutMs);
  const text = await el.getText();
  return JSON.parse(text);
}

/** Shared inline-script battery helper text (embedded verbatim into both
 * fixture pages below) -- computes the four-check signature
 * (`instanceof`/`toString.call`/`.constructor.name`/`ArrayBuffer.isView`)
 * for one binary field, using explicit per-field property names (not a
 * generic prefix-driven loop) so each field's `*IsArrayBuffer`/
 * `*ToStringTag` names appear as literal, greppable strings in this file --
 * matching this project's existing rawId-battery style. */
function fieldBatteryJs(varName, fieldName) {
  return `
    result.${fieldName}IsArrayBuffer = ${varName} instanceof ArrayBuffer;
    result.${fieldName}ToStringTag = Object.prototype.toString.call(${varName});
    result.${fieldName}CtorName = ${varName} && ${varName}.constructor ? ${varName}.constructor.name : null;
    result.${fieldName}IsView = ArrayBuffer.isView(${varName});`;
}

function xrayCreateFixtureHtml() {
  return `<!doctype html><html><body>
<h1>PROBE-REQUEST-XRAY provider RP ${RUN} (create)</h1>
<pre id="pv-xray-out" data-status="pending"></pre>
<script nonce="${CSP_NONCE}">
(function () {
  var out = document.getElementById('pv-xray-out');
  function writeResult(obj) {
    out.textContent = JSON.stringify(obj);
    out.dataset.status = 'done';
  }
  // Waits until content-relay.content.ts has actually injected
  // page-bridge-firefox.js's MAIN-world patch onto navigator.credentials
  // before triggering the ceremony -- this genuinely-inline <script>
  // executes synchronously during the initial HTML parse (very early),
  // which can race ahead of the extension's own (asynchronous) content-
  // script injection on a BRAND-NEW page navigation. Calling create()/get()
  // before the patch lands would silently hit Firefox's REAL native
  // WebAuthn implementation instead (which then hangs indefinitely with no
  // authenticator attached) -- not a product bug, a fixture-timing hazard
  // this polling avoids.
  function whenPatched(run) {
    var deadline = Date.now() + 10000;
    (function poll() {
      var wrapped = !navigator.credentials.create.toString().includes('[native code]');
      if (wrapped) { run(); return; }
      if (Date.now() > deadline) { writeResult({ ok: false, error: 'patch never installed within 10s' }); return; }
      setTimeout(poll, 50);
    })();
  }
  out.dataset.status = 'script-started';
  var challengeBytes = new Uint8Array(${JSON.stringify(CREATE_CHALLENGE_BYTES)});
  var userIdBytes = new Uint8Array([9, 9, 9, 9]);
  whenPatched(function () {
  navigator.credentials.create({
    publicKey: {
      rp: { id: 'localhost', name: 'PROBE-REQUEST-XRAY RP' },
      user: { id: userIdBytes.buffer, name: 'probe-request-xray-${RUN}@localhost', displayName: 'XrayProbe' },
      challenge: challengeBytes.buffer,
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      timeout: 30000,
    },
  }).then(function (cred) {
    var cdj = cred.response.clientDataJSON;
    var ao = cred.response.attestationObject;
    var clientDataParsed = null, parseError = null;
    try { clientDataParsed = JSON.parse(new TextDecoder().decode(cdj)); }
    catch (e) { parseError = String(e); }
    var result = {
      ok: true,
      id: cred.id,
      clientDataParsed: clientDataParsed,
      parseError: parseError,
      rawIdBytes: Array.from(new Uint8Array(cred.rawId)),
    };
    ${fieldBatteryJs('cred.rawId', 'rawId')}
    ${fieldBatteryJs('cdj', 'clientDataJSON')}
    ${fieldBatteryJs('ao', 'attestationObject')}
    writeResult(result);
  }).catch(function (e) {
    writeResult({ ok: false, error: String(e && e.message || e) });
  });
  });
})();
</script>
</body></html>`;
}

function xrayGetFixtureHtml() {
  return `<!doctype html><html><body>
<h1>PROBE-REQUEST-XRAY provider RP ${RUN} (get)</h1>
<pre id="pv-xray-out" data-status="pending"></pre>
<script nonce="${CSP_NONCE}">
(function () {
  var out = document.getElementById('pv-xray-out');
  function writeResult(obj) {
    out.textContent = JSON.stringify(obj);
    out.dataset.status = 'done';
  }
  // See xrayCreateFixtureHtml()'s identical whenPatched() comment -- this
  // genuinely-inline <script> can race ahead of content-relay.content.ts's
  // asynchronous MAIN-world patch injection on a brand-new page navigation.
  function whenPatched(run) {
    var deadline = Date.now() + 10000;
    (function poll() {
      var wrapped = !navigator.credentials.get.toString().includes('[native code]');
      if (wrapped) { run(); return; }
      if (Date.now() > deadline) { writeResult({ ok: false, error: 'patch never installed within 10s' }); return; }
      setTimeout(poll, 50);
    })();
  }
  out.dataset.status = 'script-started';
  var challengeBytes = new Uint8Array(${JSON.stringify(GET_CHALLENGE_BYTES)});
  whenPatched(function () {
  navigator.credentials.get({
    publicKey: {
      rpId: 'localhost',
      challenge: challengeBytes.buffer,
      timeout: 30000,
      userVerification: 'preferred',
    },
  }).then(function (cred) {
    var cdj = cred.response.clientDataJSON;
    var ad = cred.response.authenticatorData;
    var sig = cred.response.signature;
    var clientDataParsed = null, parseError = null;
    try { clientDataParsed = JSON.parse(new TextDecoder().decode(cdj)); }
    catch (e) { parseError = String(e); }
    var result = {
      ok: true,
      id: cred.id,
      clientDataParsed: clientDataParsed,
      parseError: parseError,
    };
    ${fieldBatteryJs('cred.rawId', 'rawId')}
    ${fieldBatteryJs('cdj', 'clientDataJSON')}
    ${fieldBatteryJs('ad', 'authenticatorData')}
    ${fieldBatteryJs('sig', 'signature')}
    writeResult(result);
  }).catch(function (e) {
    writeResult({ ok: false, error: String(e && e.message || e) });
  });
  });
})();
</script>
</body></html>`;
}

function formServerHtml() {
  const provider = () => `<!doctype html><html><body><h1>PROBE-REQUEST-XRAY provider RP ${RUN}</h1></body></html>`;
  return http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    const url = req.url || '/';
    // Same CSP-strict fixture technique as run-core.cjs's /provider-csp
    // (firefox-injection-csp-blocked fix) -- exercises the ArrayBuffer
    // detection fix under a real restrictive page CSP too, so a future
    // regression in either fix can't hide behind the other's fixture.
    if (url.startsWith('/provider-csp')) {
      res.setHeader('content-security-policy', "script-src 'self'");
      return res.end(provider());
    }
    if (url.startsWith('/xray-create')) {
      res.setHeader('content-security-policy', `script-src 'self' 'nonce-${CSP_NONCE}'`);
      return res.end(xrayCreateFixtureHtml());
    }
    if (url.startsWith('/xray-get')) {
      res.setHeader('content-security-policy', `script-src 'self' 'nonce-${CSP_NONCE}'`);
      return res.end(xrayGetFixtureHtml());
    }
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
    record('STEP0-origin', liveOrigin === EXT_ORIGIN ? 'PASS' : 'FAIL',
      `Observed origin=${liveOrigin}, expected=${EXT_ORIGIN}`);

    // ================= server config + sign-in =================
    await ensurePopup();
    const urlInput = await tryFind(driver, 'input#pv-server-url', 15000);
    if (!urlInput) throw new Error('server-config url input not found');
    await urlInput.clear();
    await urlInput.sendKeys(SERVER);
    const submitBtn = await driver.findElement(By.css('button[type="submit"]'));
    await submitBtn.click();
    await sleep(1500);
    await tryFind(driver, 'input[type="password"]', 20000);

    await driver.findElement(By.css('input[type="email"]')).sendKeys(EMAIL);
    await driver.findElement(By.css('input[type="password"]')).sendKeys(PASSWORD);
    await driver.findElement(By.css('button[type="submit"]')).click();
    const postSignin = await tryFind(driver, 'select, button', 60000);
    await sleep(1500);
    record('SIGNIN', postSignin ? 'PASS' : 'FAIL', 'password sign-in advanced past unlock view');
    if (!postSignin) throw new Error('sign-in failed, cannot proceed to probe');

    // ================= CSP-strict shim sanity =================
    const rpTabHandle = await newTabTo(`${FORM_ORIGIN}/provider-csp`);
    await sleep(600);
    const patchCheck = await driver.executeScript(`
      try {
        const src = navigator.credentials.create.toString();
        return { wrapped: !src.includes('[native code]') };
      } catch (e) { return { error: String(e) }; }
    `);
    record('SHIM-PRESENT', patchCheck.wrapped ? 'PASS' : 'FAIL',
      `navigator.credentials.create patched=${patchCheck.wrapped} on CSP-strict page`);
    if (!patchCheck.wrapped) throw new Error('MAIN-world patch not installed, aborting probe');

    // ================= RAW-ArrayBuffer create() =================
    // Navigates the SAME tab to a genuinely inline-<script> fixture page
    // (see this file's header comment) which waits for content-relay's
    // MAIN-world patch to actually land (whenPatched(), inside the fixture
    // HTML -- a brand-new navigation can otherwise race ahead of the
    // extension's own asynchronous content-script injection) and then
    // auto-runs the ceremony -- `challenge`/`user.id` as raw ArrayBuffer
    // (`.buffer`), NOT a TypedArray -- unlike every other fixture in this
    // project. NO `driver.executeScript()` triggers the ceremony or
    // computes any `instanceof` check here; the inline script does both,
    // in its own page realm.
    await driver.switchTo().window(rpTabHandle);
    await driver.get(`${FORM_ORIGIN}/xray-create`);
    await ensurePopup();
    const createConfirm = await tryFind(driver, '[data-testid="provider-confirm"]', 20000);
    if (!createConfirm) {
      record('XRAY-CREATE', 'FAIL', 'provider-confirm consent UI never appeared -- request likely rejected before reaching the background/WASM layer (the exact symptom this bug produces pre-fix: encodePublicKeyOptions leaves the raw-ArrayBuffer challenge un-encoded, background WASM decode fails, no ceremony ever reaches consent).');
      throw new Error('no consent UI for raw-ArrayBuffer create()');
    }
    await shot(driver, 'xray-create-consent-ui');
    await createConfirm.click();
    await sleep(1500);
    await driver.switchTo().window(rpTabHandle);
    const createResult = await waitForXrayResult(driver);
    await shot(driver, 'xray-create-rp-result');
    console.log('\n--- RAW create() (ArrayBuffer challenge/user.id) result ---\n', JSON.stringify(createResult, null, 2));

    if (!createResult || !createResult.ok) {
      record('XRAY-CREATE', 'FAIL', `raw-ArrayBuffer create() failed/rejected: ${JSON.stringify(createResult)}`);
    } else {
      const challengeMatches = createResult.clientDataParsed && createResult.clientDataParsed.challenge === CREATE_EXPECTED_B64URL;
      const responseDirectionFields = {
        rawIdIsArrayBuffer: createResult.rawIdIsArrayBuffer,
        clientDataJSONIsArrayBuffer: createResult.clientDataJSONIsArrayBuffer,
        attestationObjectIsArrayBuffer: createResult.attestationObjectIsArrayBuffer,
      };
      const failingFields = Object.entries(responseDirectionFields)
        .filter(([, v]) => v !== true)
        .map(([k]) => k);
      const allPass = challengeMatches && failingFields.length === 0;
      record('XRAY-CREATE', allPass ? 'PASS' : 'FAIL',
        `challengeMatches=${challengeMatches} (expected=${CREATE_EXPECTED_B64URL}, observed=${createResult.clientDataParsed ? createResult.clientDataParsed.challenge : null})\n  response-direction fields: ${JSON.stringify(responseDirectionFields)}${failingFields.length ? `\n  FAILING FIELDS: ${failingFields.join(', ')}` : ''}`);
    }

    // ================= RAW-ArrayBuffer get() (discoverable, no allowCredentials) =================
    // Deliberately discoverable (no `allowCredentials`), mirroring
    // run-core.cjs's own already-passing P12-SC2 pattern -- this shared
    // test account (`uat-prf04`) has accumulated many enrolled credentials
    // for RP 'localhost' across every debug/e2e session that has ever run
    // against it, so an `allowCredentials`-scoped request would need to
    // deterministically pick the ONE matching row out of a long,
    // non-deterministically-ordered candidate list (a test-account-hygiene
    // problem, not a product bug) to avoid the ceremony being correctly
    // rejected for choosing an unlisted credential.
    await driver.switchTo().window(rpTabHandle);
    await driver.get(`${FORM_ORIGIN}/xray-get`);
    await ensurePopup();
    const getConfirm = await tryFind(driver, '[data-testid="provider-confirm"]', 20000);
    const candidateRow = await tryFind(driver, '[data-testid^="provider-credential-row-"]', 3000);
    if (candidateRow) {
      await shot(driver, 'xray-get-multimatch-ui');
      await candidateRow.click();
    } else if (getConfirm) {
      await shot(driver, 'xray-get-consent-ui');
      await getConfirm.click();
    } else {
      record('XRAY-GET', 'FAIL', 'Neither provider-confirm nor multi-match row appeared -- request likely rejected before reaching background/WASM (raw-ArrayBuffer challenge left un-encoded pre-fix).');
      throw new Error('no consent UI for raw-ArrayBuffer get()');
    }
    await sleep(1500);
    await driver.switchTo().window(rpTabHandle);
    const getResult = await waitForXrayResult(driver);
    await shot(driver, 'xray-get-rp-result');
    console.log('\n--- RAW get() (ArrayBuffer challenge) result ---\n', JSON.stringify(getResult, null, 2));

    if (!getResult || !getResult.ok) {
      record('XRAY-GET', 'FAIL', `raw-ArrayBuffer get() failed/rejected: ${JSON.stringify(getResult)}`);
    } else {
      const challengeMatches = getResult.clientDataParsed && getResult.clientDataParsed.challenge === GET_EXPECTED_B64URL;
      const responseDirectionFields = {
        rawIdIsArrayBuffer: getResult.rawIdIsArrayBuffer,
        clientDataJSONIsArrayBuffer: getResult.clientDataJSONIsArrayBuffer,
        authenticatorDataIsArrayBuffer: getResult.authenticatorDataIsArrayBuffer,
        signatureIsArrayBuffer: getResult.signatureIsArrayBuffer,
      };
      const failingFields = Object.entries(responseDirectionFields)
        .filter(([, v]) => v !== true)
        .map(([k]) => k);
      const allPass = challengeMatches && failingFields.length === 0;
      record('XRAY-GET', allPass ? 'PASS' : 'FAIL',
        `challengeMatches=${challengeMatches} (expected=${GET_EXPECTED_B64URL}, observed=${getResult.clientDataParsed ? getResult.clientDataParsed.challenge : null})\n  response-direction fields: ${JSON.stringify(responseDirectionFields)}${failingFields.length ? `\n  FAILING FIELDS: ${failingFields.join(', ')}` : ''}`);
    }

    console.log('\n=== probe-request-xray.cjs complete ===\n');
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
    console.log('probe-request-xray.cjs done. Quitting.');
    await sleep(1000);
    try { await driver.quit(); } catch {}
    formServer.close();
    const failed = Object.entries(results).filter(([, r]) => r.status === 'FAIL');
    if (failed.length) {
      console.error('FAILED gates:', failed.map(([k]) => k).join(', '));
      process.exit(1);
    }
    process.exit(0);
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
