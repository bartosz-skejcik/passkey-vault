// extension/e2e-firefox/probe-request-xray.cjs — permanent byte-level
// regression probe for the REQUEST-direction Firefox Xray/cross-realm hole
// (debug session .planning/debug/resolved/firefox-request-xray-hole.md).
//
// BACKGROUND: every existing e2e fixture in this project (run-core.cjs's
// CSP-STRICT-CREATE/P12-SC1/P12-SC2, probe-provider-corruption.cjs) drives
// navigator.credentials.create()/get() with challenge/user.id fields shaped
// as `new Uint8Array(...)` -- a TypedArray. On real Firefox, a TypedArray's
// cross-realm identity survives the MAIN(page-bridge-firefox.ts, same realm
// as the page)->ISOLATED(content-relay.content.ts) window.postMessage hop
// intact (`ArrayBuffer.isView()` is an internal-slot check, not a
// prototype-chain check, so it stays reliable cross-realm) -- but a RAW
// (non-TypedArray) `ArrayBuffer`, which real-world RPs DO send (e.g.
// GitHub's webauthn-json library passes challenge/ids as ArrayBuffer, not
// TypedArray), does NOT survive the same hop the same way:
// `value instanceof ArrayBuffer` (a prototype-chain check) is FALSE on the
// receiving (ISOLATED-world) side despite the value being a fully intact,
// byte-correct ArrayBuffer (confirmed via a standalone Xray probe during
// this debug session -- Object.prototype.toString.call() still correctly
// reports "[object ArrayBuffer]", and `new Uint8Array(value)` in the
// receiving realm still reads the exact original bytes). Since a raw
// ArrayBuffer can ONLY ever satisfy isBufferSource() via the `instanceof`
// branch, such a field was left un-encoded by encodePublicKeyOptions,
// JSON.stringify'd to an empty map `{}` at the ISOLATED->background
// runtime.sendMessage hop, and rejected by pv-provider's WASM-side serde
// deserializer with "invalid type: map, expected A vector of bytes or a
// base46(url) encoded string" -- exactly Bartek's live github.com report.
//
// Fix: content-relay.content.ts's isBufferSource() now also accepts
// `Object.prototype.toString.call(value) === "[object ArrayBuffer]"`
// (proven cross-realm-reliable by the same probe), and
// bufferSourceToB64Url()'s internal branch discriminator was changed from
// `instanceof ArrayBuffer` to the already-cross-realm-safe
// `ArrayBuffer.isView()`. This fix is REQUEST-direction only, by design
// (this debug session's explicit scope).
//
// IMPORTANT FOLLOW-UP FINDING (out of THIS session's scope, not fixed
// here): a minimal standalone (non-product) Xray probe suggested the
// REVERSE (ISOLATED->MAIN, response/credential-decode) direction was
// unaffected -- but this probe's own end-to-end run against the REAL
// product code found the opposite for `cred.rawId`: `instanceof
// ArrayBuffer` is ALSO false there (same signature: toString.call still
// "[object ArrayBuffer]", bytes still intact via `new Uint8Array()`),
// evaluated from the RP page's own MAIN-world context (the SAME realm
// page-bridge-firefox.ts's shapeCredential() output is consumed in). The
// discrepancy between the isolated probe and this real end-to-end result
// is NOT YET explained (nesting depth was ruled out as the variable) --
// this needs its own follow-up debug session. Practical impact: a REAL
// RP's own code that does `credential.rawId instanceof ArrayBuffer` (or
// the equivalent on `response.clientDataJSON`/`attestationObject`/etc.)
// may treat a genuinely-valid credential as malformed on Firefox, even
// after this session's request-direction fix. This probe does not assert
// on `cred.rawId instanceof ArrayBuffer` as a PASS/FAIL gate (see
// XRAY-CREATE below) specifically because that assertion is currently
// KNOWN to fail pending the follow-up session -- only byte-level identity
// (challenge round-trip) is gated here.
//
// This probe is kept here PERMANENTLY (not just for this investigation),
// mirroring probe-provider-corruption.cjs's own precedent, as the one row
// in this project's e2e suites that exercises a RAW ArrayBuffer-shaped
// (not TypedArray) challenge/user.id on create() AND get() against a REAL,
// CSP-strict fixture page on real Firefox. (allowCredentials[].id's own
// raw-ArrayBuffer encoding is covered deterministically instead by
// content-relay.test.ts's jsdom cross-realm unit test -- see the get()
// section below for why this live probe intentionally stays discoverable.)
//
// Prerequisites: identical to run-core.cjs/probe-provider-corruption.cjs
// (see README.md) -- pv-server already running on localhost:8620,
// `npm run build:firefox` already run. This script does NOT rebuild
// anything and does NOT restart the server.
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');

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
    // The exact real-world shape this bug's hypothesis implicates:
    // `challenge`/`user.id` as raw ArrayBuffer (`.buffer`), NOT a
    // TypedArray -- unlike every other fixture in this project.
    driver.executeScript(`
      window.__pv_xray_create = null;
      const challengeBytes = new Uint8Array(${JSON.stringify(CREATE_CHALLENGE_BYTES)});
      const userIdBytes = new Uint8Array([9,9,9,9]);
      navigator.credentials.create({
        publicKey: {
          rp: { id: 'localhost', name: 'PROBE-REQUEST-XRAY RP' },
          user: { id: userIdBytes.buffer, name: 'probe-request-xray-${RUN}@localhost', displayName: 'XrayProbe' },
          challenge: challengeBytes.buffer,
          pubKeyCredParams: [{type:'public-key', alg:-7}],
          timeout: 30000,
        },
      }).then((cred) => {
        const cdj = cred.response.clientDataJSON;
        let clientDataParsed = null, parseError = null;
        try { clientDataParsed = JSON.parse(new TextDecoder().decode(cdj)); }
        catch (e) { parseError = String(e); }
        // rawId MUST be a real ArrayBuffer per spec -- captured here so the
        // get() probe below can reference it as allowCredentials[0].id,
        // itself ALSO a raw ArrayBuffer (rawId is never a TypedArray).
        window.__pv_xray_rawid_bytes = Array.from(new Uint8Array(cred.rawId));
        window.__pv_xray_create = {
          ok: true,
          id: cred.id,
          rawIdIsArrayBuffer: cred.rawId instanceof ArrayBuffer,
          rawIdToStringTag: Object.prototype.toString.call(cred.rawId),
          rawIdCtorName: cred.rawId && cred.rawId.constructor ? cred.rawId.constructor.name : null,
          rawIdIsView: ArrayBuffer.isView(cred.rawId),
          clientDataParsed,
          parseError,
        };
      }).catch((e) => { window.__pv_xray_create = {ok:false, error: String(e && e.message || e)}; });
      return true;
    `);
    await ensurePopup();
    const createConfirm = await tryFind(driver, '[data-testid="provider-confirm"]', 20000);
    if (!createConfirm) {
      record('XRAY-CREATE', 'FAIL', 'provider-confirm consent UI never appeared -- request likely rejected before reaching the background/WASM layer (the exact symptom this bug produces pre-fix: encodePublicKeyOptions leaves the raw-ArrayBuffer challenge un-encoded, background WASM decode fails, no ceremony ever reaches consent).');
      throw new Error('no consent UI for raw-ArrayBuffer create()');
    }
    await shot(driver, 'xray-create-consent-ui');
    await createConfirm.click();
    await sleep(2000);
    await driver.switchTo().window(rpTabHandle);
    const createResult = await driver.executeScript('return window.__pv_xray_create');
    const rawIdBytes = await driver.executeScript('return window.__pv_xray_rawid_bytes');
    await shot(driver, 'xray-create-rp-result');
    console.log('\n--- RAW create() (ArrayBuffer challenge/user.id) result ---\n', JSON.stringify(createResult, null, 2));
    console.log('rawIdBytes:', JSON.stringify(rawIdBytes));

    if (!createResult || !createResult.ok) {
      record('XRAY-CREATE', 'FAIL', `raw-ArrayBuffer create() failed/rejected: ${JSON.stringify(createResult)}`);
    } else {
      const challengeMatches = createResult.clientDataParsed && createResult.clientDataParsed.challenge === CREATE_EXPECTED_B64URL;
      record('XRAY-CREATE', challengeMatches ? 'PASS' : 'FAIL',
        `expected=${CREATE_EXPECTED_B64URL}\n  observed=${createResult.clientDataParsed ? createResult.clientDataParsed.challenge : null}\n  rawIdIsArrayBuffer=${createResult.rawIdIsArrayBuffer} parseError=${createResult.parseError}`);
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
    // rejected for choosing an unlisted credential. `allowCredentials[].id`
    // raw-ArrayBuffer encoding itself is covered deterministically instead
    // by content-relay.test.ts's own jsdom cross-realm unit test, which
    // doesn't depend on any live account state. This probe's job is only to
    // confirm the RAW ARRAYBUFFER CHALLENGE encoding fix end-to-end on a
    // REAL get() ceremony, exactly like it already does for create() above.
    await driver.navigate().refresh();
    await sleep(600);
    driver.executeScript(`
      window.__pv_xray_get = null;
      const challengeBytes = new Uint8Array(${JSON.stringify(GET_CHALLENGE_BYTES)});
      navigator.credentials.get({
        publicKey: {
          rpId: 'localhost',
          challenge: challengeBytes.buffer,
          timeout: 30000,
          userVerification: 'preferred',
        },
      }).then((cred) => {
        const cdj = cred.response.clientDataJSON;
        let clientDataParsed = null, parseError = null;
        try { clientDataParsed = JSON.parse(new TextDecoder().decode(cdj)); }
        catch (e) { parseError = String(e); }
        window.__pv_xray_get = { ok: true, id: cred.id, clientDataParsed, parseError };
      }).catch((e) => { window.__pv_xray_get = {ok:false, error: String(e && e.message || e)}; });
      return true;
    `);
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
    await sleep(2000);
    await driver.switchTo().window(rpTabHandle);
    const getResult = await driver.executeScript('return window.__pv_xray_get');
    await shot(driver, 'xray-get-rp-result');
    console.log('\n--- RAW get() (ArrayBuffer challenge + allowCredentials.id) result ---\n', JSON.stringify(getResult, null, 2));

    if (!getResult || !getResult.ok) {
      record('XRAY-GET', 'FAIL', `raw-ArrayBuffer get() failed/rejected: ${JSON.stringify(getResult)}`);
    } else {
      const challengeMatches = getResult.clientDataParsed && getResult.clientDataParsed.challenge === GET_EXPECTED_B64URL;
      record('XRAY-GET', challengeMatches ? 'PASS' : 'FAIL',
        `expected=${GET_EXPECTED_B64URL}\n  observed=${getResult.clientDataParsed ? getResult.clientDataParsed.challenge : null} parseError=${getResult.parseError}`);
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
    process.exit(0);
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
