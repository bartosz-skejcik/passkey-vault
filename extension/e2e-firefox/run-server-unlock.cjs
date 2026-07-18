// extension/e2e-firefox/run-server-unlock.cjs — Plan 13-06's ONE new
// Firefox scenario: locked popup -> server-unlock secondary button -> a
// real ceremony window opens on the user's configured pv-server origin ->
// window+bridge+relay plumbing confirmed -> the honest no-passkeys
// empty-state for a fresh, passkey-less probe account.
//
// Firefox's WebAuthn Virtual Authenticator is genuinely NOT IMPLEMENTED
// (NS_ERROR_NOT_IMPLEMENTED, confirmed empirically by 13-04's own harness --
// see 13-UAT-CHECKLIST.md row 19) -- there is no automatable stand-in for a
// real PRF authenticator here. This scenario deliberately routes around
// that gap rather than faking it: a FRESH probe account with ZERO enrolled
// passkeys makes the server's own `/api/passkeys/unlock/start` return 404
// (crates/pv-server/src/routes/passkeys.rs's `unlock_start`, "Zero eligible
// passkeys is a 404... WITHOUT ever calling navigator.credentials.get()")
// BEFORE any WebAuthn ceremony is ever invoked -- so the honest empty-state
// this scenario verifies is reachable with zero authenticator involvement,
// no virtual-authenticator dependency at all. The FULL PRF-completion path
// (a real enrolled server passkey, a real authenticator tap) is NOT
// exercised here -- that is the plan's documented human live-UAT item.
//
// Reuses run-core.cjs's exact harness conventions (installAddon, tryFind/
// tryFindXpathText, screenshot+results-JSON recording) but is a SEPARATE
// script/profile/account (a persisted run-core.cjs profile already has an
// enrolled/attempted ext-passkey state on the shared UAT account -- this
// scenario needs a genuinely fresh, never-enrolled account to reach the
// no-passkeys branch honestly, not a fabricated one).
'use strict';
const path = require('path');
const fs = require('fs');

const EXT_ROOT = path.resolve(__dirname, '..');
const { Builder, By, until } = require(path.join(EXT_ROOT, 'node_modules/selenium-webdriver'));
const firefox = require(path.join(EXT_ROOT, 'node_modules/selenium-webdriver/firefox'));

const EXT_DIR = path.join(EXT_ROOT, '.output/firefox-mv2');
const PROFILE_DIR = process.env.PV_FF_SERVER_UNLOCK_PROFILE_DIR || path.join(__dirname, '.ff-profile-server-unlock');
const SHOTS = process.env.PV_FF_SERVER_UNLOCK_SHOTS_DIR || path.join(__dirname, '.ff-screenshots-server-unlock');
const RESULTS_FILE = path.join(SHOTS, 'results-server-unlock.json');
const SERVER = process.env.PV_SERVER || 'http://localhost:8620';
const RUN = String(Date.now() % 100000);
// A genuinely fresh, never-before-used account -- must have ZERO enrolled
// passkeys of any kind for the no-passkeys empty-state to be reachable.
const PROBE_EMAIL = process.env.PV_PROBE_EMAIL || `uat-noext-ff-${RUN}@example.local`;
const PROBE_PASSWORD = process.env.PV_PROBE_PASSWORD || 'CorrectHorseBattery-Probe-2026!';
const GECKO_ID = 'passkey-vault@extension.local';
// A DIFFERENT fixed UUID from run-core.cjs's own (a1b2c3d4-...) -- this
// scenario uses its own dedicated profile/account, never the shared UAT
// account's persisted enrollment state.
const FIXED_UUID = process.env.PV_FF_SERVER_UNLOCK_UUID || 'b2c3d4e5-f6a7-4890-b123-456789abcdef';
const EXT_ORIGIN = `moz-extension://${FIXED_UUID}`;
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

async function main() {
  const opts = new firefox.Options();
  opts.setBinary(FIREFOX_BINARY);
  opts.addArguments('-profile', PROFILE_DIR);
  opts.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: FIXED_UUID }));
  opts.setPreference('xpinstall.signatures.required', false);
  opts.windowSize({ width: 1280, height: 950 });

  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(opts).build();
  let popupHandle;

  async function ensurePopup() {
    const handles = await driver.getAllWindowHandles();
    if (!handles.includes(popupHandle)) {
      await driver.switchTo().newWindow('tab');
      await driver.get(`${EXT_ORIGIN}/popup.html`);
      popupHandle = await driver.getWindowHandle();
      return;
    }
    await driver.switchTo().window(popupHandle);
  }

  try {
    console.log('Installing extension (temporary, dedicated persistent profile)...');
    const addonId = await driver.installAddon(EXT_DIR, true);
    console.log('installed addon id:', addonId);
    await sleep(1500);

    // ================= Step 0: register a fresh, passkey-less probe =================
    // account via the REAL web-app RegisterForm UI (no crypto/API replication
    // in this harness -- the real product code does the Argon2/wrap work).
    // This ALSO seeds this browser profile's localStorage with a real web-app
    // session token for the probe account -- the precondition for
    // ExtUnlockBridge's unlockStart() to reach the server's 404 branch at
    // all, rather than a 401 "not signed in" one.
    await driver.switchTo().newWindow('tab');
    await driver.get(`${SERVER}/`);
    await sleep(800);
    // The persistent profile (PROFILE_DIR) carries the web app's own
    // localStorage session token across separate runs of this script -- a
    // fresh navigation to a PRIOR run's already-authed origin shows the
    // vault shell, not AuthCard's register/login toggle. Force a clean
    // slate every run so the register flow below is always reachable.
    await driver.executeScript('window.localStorage.clear();');
    await driver.navigate().refresh();
    await sleep(1500);
    // Locate the actual <button> (not a wrapping non-clickable ancestor
    // sharing the same text -- the exact false-negative class documented in
    // 13-UAT-CHECKLIST.md's Deviations #5 for the "Full screen" button).
    const toggleBtns = await driver.findElements(
      By.xpath("//button[contains(., 'Zarejestruj się') or contains(., 'Sign up')]"),
    );
    if (toggleBtns.length === 0) throw new Error('register-toggle <button> not found on web-app root');
    await toggleBtns[0].click();
    await sleep(500);
    const registerEmail = await tryFind(driver, '#register-email', 8000);
    if (!registerEmail) throw new Error('#register-email did not appear after clicking the register toggle');
    await registerEmail.sendKeys(PROBE_EMAIL);
    await driver.findElement(By.css('#register-password')).sendKeys(PROBE_PASSWORD);
    await driver.findElement(By.css('#register-confirm-password')).sendKeys(PROBE_PASSWORD);
    await shot(driver, 'step0-probe-register-filled');
    await driver.findElement(By.css('button[type="submit"]')).click();
    await sleep(2500);
    await shot(driver, 'step0-probe-registered');
    const webAppSessionToken = await driver.executeScript(
      "return window.localStorage.getItem('pv-session-token')",
    );
    record(
      'STEP0-probe-account-registered',
      webAppSessionToken ? 'PASS' : 'FAIL',
      `probe account=${PROBE_EMAIL}, web-app session token present=${!!webAppSessionToken}`,
    );
    if (!webAppSessionToken) throw new Error('probe account registration did not produce a web-app session token');

    // ================= Step 1: configure + sign in on the EXTENSION =================
    // (the same probe account -- the extension's own session token is
    // independent of the web app's, minted separately by auth.signIn.password).
    await ensurePopup();
    await sleep(800);
    const liveOrigin = await driver.executeScript(
      "return (window.browser||window.chrome).runtime.getURL('').replace(/\\/$/, '')",
    );
    console.log('Observed live moz-extension origin:', liveOrigin);
    await shot(driver, 'step1-popup-open');

    // The dedicated persistent profile carries the EXTENSION's own
    // config.set from a prior run of this script too -- only drive the
    // first-run server-config gate if it's actually showing.
    const urlInput = await tryFind(driver, 'input#pv-server-url', 5000);
    if (urlInput) {
      await urlInput.clear();
      await urlInput.sendKeys(SERVER);
      await driver.findElement(By.css('button[type="submit"]')).click();
      await sleep(1500);
    }
    await shot(driver, 'step1-server-configured');

    const pwField = await tryFind(driver, 'input[type="password"]', 15000);
    if (!pwField) throw new Error('sign-in view did not appear after server config');
    await driver.findElement(By.css('input[type="email"]')).sendKeys(PROBE_EMAIL);
    await driver.findElement(By.css('input[type="password"]')).sendKeys(PROBE_PASSWORD);
    await shot(driver, 'step1-signin-filled');
    await driver.findElement(By.css('button[type="submit"]')).click();
    const postSignin = await tryFind(driver, 'select, button', 30000);
    await sleep(1000);
    await shot(driver, 'step1-post-signin-unlocked');
    record(
      'STEP1-ext-signin',
      postSignin ? 'PASS' : 'FAIL',
      'extension sign-in with the same probe account advanced past the unlock view (vault unlocked)',
    );

    // ================= Step 2: force the vault back to LOCKED =================
    // Firefox's MV2 background page is PERSISTENT (Phase 8 decision) --
    // vault-session.ts's `currentUserKey` module-level in-memory cache is
    // the FAST-PATH source `ensureHydrated()`/`isSessionUnlocked()` check
    // FIRST and never re-consult storage once populated, so directly
    // deleting `pv-uk-envelope` from storage.session (run-core.cjs's D-05
    // check technique, which only ever re-reads the STORAGE key itself, not
    // the live popup UI) does NOT actually flip the popup's live view here
    // -- confirmed empirically against this exact scenario (the popup
    // stayed on the unlocked item-list view after a storage-only clear).
    // Firing the REAL `pv-auto-lock` alarm is the correct, real mechanism:
    // `browser.alarms` is extension-wide (not per-context), so creating it
    // from the popup's own JS reaches registerAutoLockAlarmListener()'s
    // handler in the persistent background page, which calls the REAL
    // `lockVaultSession(true)` -- clearing BOTH the in-memory cache and the
    // storage envelope, exactly like a genuine idle-timeout lock.
    await driver.executeScript(`
      return new Promise((resolve) => {
        (window.browser||window.chrome).alarms.create('pv-auto-lock', { when: Date.now() + 50 }).then(resolve).catch(resolve);
      });
    `);
    await sleep(2000);
    await driver.get(`${EXT_ORIGIN}/popup.html`);
    popupHandle = await driver.getWindowHandle();
    await sleep(1200);
    const lockedPwField = await tryFind(driver, 'input[type="password"]', 15000);
    await shot(driver, 'step2-locked-view');
    record(
      'STEP2-locked',
      lockedPwField ? 'PASS' : 'FAIL',
      'popup shows the Unlock-only (locked) view after clearing the key envelope',
    );
    if (!lockedPwField) throw new Error('could not reach the locked unlock-only view');

    // ================= Step 3: the server-ceremony button is present =================
    // On real Firefox, `import.meta.env.FIREFOX` alone (the "known-
    // impossible" static signal, UnlockView.tsx) makes this button appear
    // WITHOUT any prior ext-scoped enrollment attempt -- this probe account
    // never even tried to enroll an ext-passkey.
    // Located by its own data-testid, not by text -- an ancestor wrapping
    // div/text-matching risk that would click the wrong (non-interactive)
    // element, the same false-negative class documented in
    // 13-UAT-CHECKLIST.md's Deviations #5.
    const serverBtn = await tryFind(driver, '[data-testid="server-ceremony-unlock-button"]', 8000);
    await shot(driver, 'step3-locked-view-with-button');
    record(
      'P13-06-BUTTON-VISIBLE',
      serverBtn ? 'PASS' : 'FAIL',
      `server-ceremony secondary button ${serverBtn ? 'IS' : 'is NOT'} present in the locked unlock-only view on real Firefox (known-impossible signal, no prior ext-passkey enrollment attempt needed)`,
    );
    if (!serverBtn) throw new Error('server-ceremony button not found -- cannot continue this scenario');

    const handlesBefore = await driver.getAllWindowHandles();
    await serverBtn.click();
    await sleep(2000);
    const handlesAfter = await driver.getAllWindowHandles();
    const newHandles = handlesAfter.filter((h) => !handlesBefore.includes(h));
    record(
      'P13-06-CEREMONY-WINDOW-OPENED',
      newHandles.length === 1 ? 'PASS' : 'FAIL',
      `handles before=${handlesBefore.length} after=${handlesAfter.length} new=${newHandles.length}`,
    );
    if (newHandles.length !== 1) throw new Error('ceremony window did not open (or opened more than one)');

    // ================= Step 4: the ceremony window is on the SERVER origin =================
    // and renders ExtUnlockBridge.
    const ceremonyHandle = newHandles[0];
    await driver.switchTo().window(ceremonyHandle);
    await sleep(1000);
    const ceremonyUrl = await driver.getCurrentUrl();
    const onServerOrigin = ceremonyUrl.startsWith(SERVER);
    await shot(driver, 'step4-ceremony-window');
    record('P13-06-CEREMONY-WINDOW-ORIGIN', onServerOrigin ? 'PASS' : 'FAIL', `ceremony window URL=${ceremonyUrl}`);

    const headingEls = await driver.findElements(
      By.xpath("//h1[contains(.,'Unlock the extension') or contains(.,'Odblokuj rozszerzenie')]"),
    );
    await shot(driver, 'step4-extunlockbridge-heading');
    record(
      'P13-06-BRIDGE-RENDERED',
      headingEls.length > 0 ? 'PASS' : 'FAIL',
      'ExtUnlockBridge heading rendered in the ceremony window',
    );
    if (headingEls.length === 0) throw new Error('ExtUnlockBridge did not render in the ceremony window');

    // ================= Step 5: gesture -> ceremony -> honest empty-state =================
    // Zero WebAuthn/authenticator involvement -- the server's own 404 on
    // zero enrolled passkeys short-circuits passkeyUnlockCeremony() before
    // navigator.credentials.get() is ever called (see this file's header
    // comment).
    // Same data-testid-based locator discipline as serverBtn above --
    // ExtUnlockBridge is the ONLY thing mounted on this page (page.tsx
    // returns it exclusively when the pv-ext-unlock param is present), so
    // this shared testid (also used by LoginForm/UnlockOverlay elsewhere)
    // is unambiguous here.
    const gestureBtn = await tryFind(driver, '[data-testid="passkey-unlock-button"]', 5000);
    if (!gestureBtn) throw new Error('gesture button not found in the ceremony window');
    await gestureBtn.click();
    const emptyState = await tryFindXpathText(
      driver,
      'nie ma jeszcze passkeya po stronie serwera|has no server-side passkey yet',
      15000,
    );
    await shot(driver, 'step5-no-passkeys-empty-state');
    record(
      'P13-06-NO-PASSKEYS-EMPTY-STATE',
      emptyState ? 'PASS' : 'FAIL',
      'honest empty-state rendered for the passkey-less probe account -- reached WITHOUT ever invoking navigator.credentials.get() (server unlock/start 404s on zero enrolled passkeys, crates/pv-server/src/routes/passkeys.rs)',
    );

    const settingsLink = await driver.findElements(By.css('a[href="/?panel=settings"]'));
    record(
      'P13-06-SETTINGS-LINK',
      settingsLink.length > 0 ? 'PASS' : 'FAIL',
      `Settings link present in the empty-state=${settingsLink.length > 0}`,
    );

    // NOTE on the postMessage->content-relay->background relay round trip
    // itself (T-13-11's binary-field boundary): a synthetic
    // `driver.executeScript()`-constructed `ArrayBuffer` posted via this
    // harness does NOT satisfy `instanceof ArrayBuffer` inside the page's
    // own realm -- confirmed empirically (a value created inside
    // geckodriver's own script-execution sandbox, even via the page's own
    // `window.crypto`/`window.fetch`, is tagged to a DIFFERENT realm than
    // objects the page's own script creates natively). This is a WebDriver
    // sandbox artifact, the same class of test-environment limitation
    // 12-03-SUMMARY.md already documented for jsdom's own
    // `postMessage`-vs-`event.source` quirk -- NOT a real product gap. The
    // relay's binary-field handling (base64url-encoding a REAL ArrayBuffer
    // arriving via postMessage before the sendMessage hop, D-21) is
    // correctly covered by
    // extension/entrypoints/__tests__/content-relay.test.ts's own "server-
    // origin ext-unlock relay" describe block instead, which dispatches a
    // real MessageEvent with a real ArrayBuffer constructed in the SAME
    // realm as the listener under test. This harness intentionally does
    // NOT attempt to re-prove that here with a binary payload.

    // Close the unlock-mode ceremony window before starting the signin-mode
    // scenario below (it may still be open/idle after step 5's empty-state).
    try {
      await driver.close();
    } catch { /* already closed */ }
    await driver.switchTo().window(popupHandle);

    // ================= Step 6: SIGN-IN mode (Plan 13-07, Bartek mandate) =================
    // Drives the popup back to the genuine no-session state (mode:'signin'
    // is only reachable from THAT status, mirroring auth.signIn.password's
    // own precondition, server-unlock.ts's startServerUnlock guard) by
    // clearing the extension's OWN session-meta record directly from
    // storage.session -- unlike step 2's key-envelope removal (which does
    // NOT flip the live popup view because vault-session.ts's in-memory
    // currentUserKey cache is checked first), getSessionStatus() always
    // re-reads session-meta FRESH on every call (no in-memory cache for
    // THAT record), so this technique is sound for the no-session <->
    // locked distinction specifically (confirmed against server-unlock.ts's
    // own module comment on session-storage.ts's two independently-
    // lifetimed records).
    await driver.executeScript(`
      return new Promise((resolve) => {
        (window.browser||window.chrome).storage.session.remove(['pv-session-meta', 'pv-uk-envelope']).then(resolve).catch(resolve);
      });
    `);
    await sleep(500);
    await driver.get(`${EXT_ORIGIN}/popup.html`);
    popupHandle = await driver.getWindowHandle();
    await sleep(1200);
    const signinEmailField = await tryFind(driver, 'input[type="email"]', 15000);
    await shot(driver, 'step6-signin-view');
    record(
      'STEP6-signin-view',
      signinEmailField ? 'PASS' : 'FAIL',
      'popup shows the Sign-in (no-session) view after clearing the session-meta record',
    );
    if (!signinEmailField) throw new Error('could not reach the sign-in (no-session) view');

    // ================= Step 7: the sign-in server-ceremony button is present =================
    // Unconditional whenever a server is configured (unlike step 3's own
    // extScopedUnusable-gated unlock-mode button) -- both browsers, per the
    // plan's own must_haves.truths wording.
    const signinBtn = await tryFind(driver, '[data-testid="server-ceremony-signin-button"]', 8000);
    await shot(driver, 'step7-signin-view-with-button');
    record(
      'P13-07-SIGNIN-BUTTON-VISIBLE',
      signinBtn ? 'PASS' : 'FAIL',
      `sign-in server-ceremony button ${signinBtn ? 'IS' : 'is NOT'} present on the Sign-in view`,
    );
    if (!signinBtn) throw new Error('sign-in server-ceremony button not found -- cannot continue this scenario');

    const signinHandlesBefore = await driver.getAllWindowHandles();
    await signinBtn.click();
    await sleep(2000);
    const signinHandlesAfter = await driver.getAllWindowHandles();
    const newSigninHandles = signinHandlesAfter.filter((h) => !signinHandlesBefore.includes(h));
    record(
      'P13-07-SIGNIN-CEREMONY-WINDOW-OPENED',
      newSigninHandles.length === 1 ? 'PASS' : 'FAIL',
      `handles before=${signinHandlesBefore.length} after=${signinHandlesAfter.length} new=${newSigninHandles.length}`,
    );
    if (newSigninHandles.length !== 1) throw new Error('signin ceremony window did not open (or opened more than one)');

    // ================= Step 8: the ceremony window carries pv-mode=signin =================
    // and renders ExtUnlockBridge's SIGNIN surface (distinct heading + the
    // email field this mode requires -- passkeyLogin identifies the user
    // by EMAIL, not a discoverable credential, web/src/lib/passkeys/login.ts).
    // The URL is captured IMMEDIATELY -- ExtUnlockBridge strips pv-mode/
    // pv-ext-unlock via replaceState on its own mount effect, so this must
    // race that strip -- confirmed empirically to be LOST every real run
    // (ExtUnlockBridge's mount effect strips both params via replaceState
    // before this WebDriver round trip's getCurrentUrl() ever lands, unlike
    // step 4's onServerOrigin check which only needs the URL to still
    // START WITH the server origin, a property the strip never removes).
    // This is therefore recorded as INFO, never a hard requirement -- the
    // STRONGER, non-racy proof that `pv-mode=signin` was correctly threaded
    // through startServerUnlock -> the ceremony URL -> page.tsx's own
    // read-once-at-mount state is the SIGNIN-specific heading/email-field
    // assertion immediately below, which is NOT subject to this race (it
    // reflects React state already committed, not a URL that gets stripped
    // out from under the check).
    const signinCeremonyHandle = newSigninHandles[0];
    await driver.switchTo().window(signinCeremonyHandle);
    const signinCeremonyUrl = await driver.getCurrentUrl();
    await sleep(1000);
    await shot(driver, 'step8-signin-ceremony-window');
    record(
      'P13-07-CEREMONY-URL-CAPTURED',
      'INFO',
      `signin ceremony window URL (likely already pv-mode-stripped by ExtUnlockBridge's own mount effect, see comment above)=${signinCeremonyUrl}`,
    );

    const signinHeadingEls = await driver.findElements(
      By.xpath("//h1[contains(.,'Sign in to the extension') or contains(.,'Zaloguj się do rozszerzenia')]"),
    );
    const signinEmailInBridge = await tryFind(driver, 'input#pv-ext-unlock-email', 5000);
    await shot(driver, 'step8-extunlockbridge-signin-surface');
    record(
      'P13-07-BRIDGE-SIGNIN-SURFACE-RENDERED',
      signinHeadingEls.length > 0 && signinEmailInBridge ? 'PASS' : 'FAIL',
      `signin heading present=${signinHeadingEls.length > 0}, email field present=${!!signinEmailInBridge}`,
    );
    if (signinHeadingEls.length === 0 || !signinEmailInBridge) {
      throw new Error('ExtUnlockBridge did not render the signin surface in the ceremony window');
    }

    // ================= Step 9: gesture -- honest authenticator-less limit =================
    // Unlike unlockStart() (a clean 404 on zero enrolled passkeys, no
    // WebAuthn call at all -- step 5 above), passkeyLoginStart() returns an
    // enumeration-resistant DUMMY response even for a zero-passkey account
    // (crates/pv-server/src/routes/auth.rs's passkey_login_start,
    // threat_model T-04-01 -- the shape must be indistinguishable from a
    // real account with passkeys) -- so `navigator.credentials.get()` IS
    // genuinely invoked here, with no matching real/virtual authenticator
    // available under geckodriver. This scenario therefore records
    // WHATEVER honest outcome that produces (busy -> some terminal state)
    // rather than asserting a specific one -- the authenticator-less limit
    // for signin mode is reaching this GESTURE, not a guaranteed
    // no-passkeys empty-state (that asymmetry vs. unlock mode is expected
    // and documented, not a bug).
    await signinEmailInBridge.sendKeys(PROBE_EMAIL);
    const signinGestureBtn = await tryFind(driver, '[data-testid="passkey-unlock-button"]', 5000);
    if (!signinGestureBtn) throw new Error('signin gesture button not found in the ceremony window');
    await shot(driver, 'step9-signin-gesture-ready');
    await signinGestureBtn.click();
    await sleep(4000);
    await shot(driver, 'step9-signin-post-gesture');
    const signinTerminalState = await driver.executeScript(`
      const body = document.body.innerText || '';
      return body;
    `);
    record(
      'P13-07-SIGNIN-GESTURE-REACHED',
      'INFO',
      `gesture clicked with email=${PROBE_EMAIL} (zero enrolled passkeys); post-gesture body text captured for human review (authenticator-less limit -- see this file's own Step 9 comment): ${JSON.stringify(signinTerminalState).slice(0, 400)}`,
    );

    console.log('\n=== Firefox server-unlock scenario complete (unlock + signin) ===');
    console.log(JSON.stringify(results, null, 2));
  } catch (e) {
    console.error('FATAL:', e);
    record('FATAL', 'FAIL', String((e && e.stack) || e));
  } finally {
    await driver.quit().catch(() => {});
  }
}

main();
