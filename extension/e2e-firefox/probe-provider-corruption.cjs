// extension/e2e-firefox/probe-provider-corruption.cjs — permanent
// byte-level regression probe for the provider ceremony's WebAuthn binary
// field round-trip (debug session .planning/debug/resolved/
// firefox-provider-corruption.md).
//
// BACKGROUND: this probe was built to investigate a hypothesized
// Firefox-specific hazard -- that page-bridge-firefox.ts's relay() posting
// raw (unencoded) ArrayBuffer/TypedArray WebAuthn fields across the
// MAIN(page-realm) <-> ISOLATED(content-relay.content.ts) postMessage
// boundary would suffer the same Xray-wrapper-over-page-typed-array
// corruption that hit ExtUnlockBridge.tsx's raw postMessage (fixed in
// 0aa8204/0d970a7). Empirical results DISPROVED that hypothesis for this
// path: a byte-level probe (below) showed real corruption, but isolating
// variables (see debug session for the full trail: Rust-only fix retested
// against the ORIGINAL, unmodified JS -- no realm-boundary rework -- still
// passed byte-for-byte) proved the actual, sole root cause was
// browser-independent: `crates/pv-provider`'s `passkey-types` dependency
// never enabled the `serialize_bytes_as_base64_string` Cargo feature, so
// every `Bytes`-typed field (`rawId`, `clientDataJSON`,
// `attestationObject`, `authenticatorData`, `signature`, `userHandle`, PRF
// extension results) in `credentialResponseJson` serialized as a raw JSON
// ARRAY of byte numbers (serde_json's default `serialize_bytes` behavior --
// JSON has no native "bytes" type) instead of the base64url STRING
// content-relay.content.ts's decode logic has always expected (and
// documented, in its own D-21 boundary comment, as "matching passkey_types'
// own Vec<u8><->base64url convention" -- an assumption that was never
// actually true until this fix). Affects Chrome and Firefox identically;
// "Chrome path presumed unaffected" (this debug session's original
// carried-over assessment) was itself wrong. Fix: crates/pv-provider/
// Cargo.toml now enables that feature on its `passkey-types` dependency --
// zero JS/TS changes were needed or kept.
//
// This probe is kept here PERMANENTLY (not just for this investigation) as
// the one row in this project's e2e suites that verifies BYTE-LEVEL
// correctness of a provider ceremony's WebAuthn response -- every other
// existing row (run-core.cjs's P12-SC1/SC2/SC4) only asserts
// `result.ok && result.id`, which stayed green throughout this entire bug's
// lifetime because `id` (a real spec `String` field, never `Bytes`) was
// never affected -- exactly how this class of bug went unnoticed.
//
// Drives a REAL navigator.credentials.create() on a throwaway RP fixture
// page (mirrors run-core.cjs's P12-SC1 pattern) with a KNOWN, non-trivial
// 32-byte challenge, completes the ceremony via real provider consent (100%
// WASM-software-implemented -- no hardware/native authenticator needed,
// confirmed via entrypoints/background/provider-ceremony.ts), then
// page-side decodes credential.response.clientDataJSON and diffs its
// .challenge against the KNOWN base64url bytes -- computed INDEPENDENTLY in
// Node (Buffer.toString('base64url')), never reusing any of this project's
// own encode/decode code, so a shared bug on both sides cannot produce a
// false PASS.
//
// Prerequisites: identical to run-core.cjs (see README.md) -- pv-server
// already running on localhost:8620, `npm run build:firefox` already run
// (which itself requires `bash scripts/build-wasm.sh` to have run first if
// the WASM binary changed). This script does NOT rebuild anything and does
// NOT restart the server.
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');

const EXT_ROOT = path.resolve(__dirname, '..');
const { Builder, By, until } = require(path.join(EXT_ROOT, 'node_modules/selenium-webdriver'));
const firefox = require(path.join(EXT_ROOT, 'node_modules/selenium-webdriver/firefox'));
const { applyNoNativeUiPrefs } = require('./ff-profile-prefs.cjs');

const EXT_DIR = path.join(EXT_ROOT, '.output/firefox-mv2');
const PROFILE_DIR = process.env.PV_FF_PROFILE_DIR || path.join(__dirname, '.ff-profile-probe-corruption');
const SHOTS = process.env.PV_FF_SHOTS_DIR || path.join(__dirname, '.ff-screenshots-probe-corruption');
const RESULTS_FILE = path.join(SHOTS, 'results-probe-corruption.json');
const SERVER = process.env.PV_SERVER || 'http://localhost:8620';
const EMAIL = process.env.PV_UAT_EMAIL || 'uat-prf04@example.local';
const PASSWORD = process.env.PV_UAT_PASSWORD;
if (!PASSWORD) throw new Error('PV_UAT_PASSWORD must be set');
const RUN = String(Date.now() % 100000);
const GECKO_ID = 'passkey-vault@extension.local';
const FIXED_UUID = process.env.PV_FF_FIXED_UUID || 'b2c3d4e5-f6a7-4890-b123-456789abcdef';
const EXT_ORIGIN = `moz-extension://${FIXED_UUID}`;
const FORM_PORT = 8897;
const FORM_ORIGIN = `http://localhost:${FORM_PORT}`;
const FIREFOX_BINARY = process.env.PV_FIREFOX_BINARY || '/Applications/Firefox.app/Contents/MacOS/firefox';

// Known, non-trivial byte vector (NOT all-zero, NOT a palindrome -- a
// truncation/reversal/off-by-one bug would still be caught, unlike
// run-core.cjs's P12-SC1/SC2, which use `new Uint8Array(32)` and never
// assert clientDataJSON content at all).
const CHALLENGE_BYTES = Array.from({ length: 32 }, (_, i) => i + 1); // [1..32]
const EXPECTED_CHALLENGE_B64URL = Buffer.from(CHALLENGE_BYTES).toString('base64url');

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
// -- courtesy mirror of probe-window-geometry.cjs's WR-03 fix (18-REVIEW.md):
// without this hoist, a mid-run throw orphans the geckodriver-spawned
// Firefox process tree because `driver` was only a local inside `main()`.
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

function formServerHtml() {
  const provider = () => `<!doctype html><html><body><h1>PROBE-CORRUPTION provider RP ${RUN}</h1></body></html>`;
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
  applyNoNativeUiPrefs(opts);
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
    if (!postSignin) throw new Error('sign-in failed, cannot proceed to provider probe');

    // ================= D-08 sanity: MAIN-world patch present =================
    const rpTabHandle = await newTabTo(`${FORM_ORIGIN}/provider`);
    await sleep(600);
    const patchCheck = await driver.executeScript(`
      try {
        const src = navigator.credentials.create.toString();
        return { wrapped: !src.includes('[native code]') };
      } catch (e) { return { error: String(e) }; }
    `);
    record('D-08-sanity', patchCheck.wrapped ? 'PASS' : 'FAIL',
      `navigator.credentials.create patched=${patchCheck.wrapped} (probe cannot proceed meaningfully otherwise)`);
    if (!patchCheck.wrapped) throw new Error('MAIN-world patch not installed, aborting probe');

    // ================= PROBE: known challenge byte round-trip via create() =================
    driver.executeScript(`
      window.__pv_probe_create = null;
      const challengeBytes = new Uint8Array(${JSON.stringify(CHALLENGE_BYTES)});
      navigator.credentials.create({
        publicKey: {
          rp: { id: 'localhost', name: 'PROBE-CORRUPTION RP' },
          user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'probe-corruption-${RUN}@localhost', displayName: 'Probe' },
          challenge: challengeBytes,
          pubKeyCredParams: [{type:'public-key', alg:-7}],
          timeout: 30000,
        },
      }).then((cred) => {
        const cdj = cred.response.clientDataJSON;
        const diag = {
          typeofVal: typeof cdj,
          ctorName: (cdj && cdj.constructor && cdj.constructor.name) || null,
          toStringTag: Object.prototype.toString.call(cdj),
          isArrayBufferInstance: (typeof ArrayBuffer !== 'undefined') && (cdj instanceof ArrayBuffer),
          isArrayBufferView: (typeof ArrayBuffer !== 'undefined') && ArrayBuffer.isView(cdj),
          byteLength: (cdj && typeof cdj.byteLength === 'number') ? cdj.byteLength : null,
        };
        let clientDataText = null, clientDataParsed = null, clientDataParseError = null;
        try {
          clientDataText = new TextDecoder().decode(cdj);
        } catch (e) { clientDataParseError = 'decode:' + String(e); }
        if (clientDataText !== null) {
          try { clientDataParsed = JSON.parse(clientDataText); }
          catch (e) { clientDataParseError = 'json-parse:' + String(e); }
        }
        window.__pv_probe_create = {
          ok: true,
          id: cred.id,
          clientDataDiag: diag,
          clientDataText,
          clientDataParsed,
          clientDataParseError,
        };
      }).catch((e) => { window.__pv_probe_create = {ok:false, error: String(e && e.message || e)}; });
      return true;
    `);
    await ensurePopup();
    const confirmBtn = await tryFind(driver, '[data-testid="provider-confirm"]', 20000);
    if (!confirmBtn) {
      record('PROBE-create', 'FAIL', 'provider-confirm consent UI never appeared');
      throw new Error('no consent UI for create()');
    }
    await shot(driver, 'probe-consent-ui');
    await confirmBtn.click();
    await sleep(2000);
    await driver.switchTo().window(rpTabHandle);
    const createResult = await driver.executeScript('return window.__pv_probe_create');
    await shot(driver, 'probe-rp-result');

    console.log('\n--- RAW create() result ---\n', JSON.stringify(createResult, null, 2));

    if (!createResult || !createResult.ok) {
      record('PROBE-create', 'FAIL', `create() itself failed/rejected: ${JSON.stringify(createResult)}`);
    } else if (createResult.clientDataParseError || !createResult.clientDataParsed) {
      record('PROBE-clientDataJSON-shape', 'CORRUPTED',
        `credential.response.clientDataJSON is not a usable ArrayBuffer/decodable JSON on this build -- diag=${JSON.stringify(createResult.clientDataDiag)}. decode error: ${createResult.clientDataParseError}. This is exactly the class of bug crates/pv-provider/Cargo.toml's passkey-types "serialize_bytes_as_base64_string" feature fixes (see this file's own header comment) -- if this fires again, check whether that feature got dropped from Cargo.toml, or whether content-relay.content.ts's RESPONSE_BINARY_FIELDS-based decode regressed.`);
    } else {
      const observedChallenge = createResult.clientDataParsed.challenge;
      const challengeMatches = observedChallenge === EXPECTED_CHALLENGE_B64URL;
      record('PROBE-challenge-roundtrip', challengeMatches ? 'PASS' : 'CORRUPTED',
        `expected=${EXPECTED_CHALLENGE_B64URL}\n  observed=${observedChallenge}\n  clientDataJSON parsed OK (type=${createResult.clientDataParsed.type}, origin=${createResult.clientDataParsed.origin}, ctorName=${createResult.clientDataDiag.ctorName}) -- ${challengeMatches ? 'challenge bytes survived the full create() round trip (page -> content-relay -> background/WASM -> content-relay -> page) intact, and clientDataJSON is a genuine ArrayBuffer the page can TextDecoder/Uint8Array without throwing' : 'challenge MISMATCH -- see .planning/debug/resolved/firefox-provider-corruption.md for the full investigation trail of this bug class'}`);
    }

    console.log('\n=== probe-provider-corruption.cjs complete ===\n');
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
    console.log('probe-provider-corruption.cjs done. Quitting.');
    await sleep(1000);
    try { await driver.quit(); } catch {}
    formServer.close();
    const failed = Object.entries(results).filter(([, r]) => r.status === 'FAIL' || r.status === 'CORRUPTED');
    if (failed.length) {
      console.error('FAILED gates:', failed.map(([k]) => k).join(', '));
      process.exit(1);
    }
    process.exit(0);
  }).catch(async (e) => {
    console.error(e);
    // Courtesy mirror of probe-window-geometry.cjs's WR-03 fix
    // (18-REVIEW.md): the happy path above quits `driver`/closes
    // `formServer` itself, but a thrown error skips straight here -- without
    // this, the geckodriver-spawned Firefox process tree survives as an
    // orphan. `driver`/`formServer` are the module-level hoisted bindings
    // `main()` assigned to, so they are populated even when `main()` throws
    // mid-run.
    await quitBounded(driver);
    try { formServer && formServer.close(); } catch {}
    process.exit(1);
  });
}
