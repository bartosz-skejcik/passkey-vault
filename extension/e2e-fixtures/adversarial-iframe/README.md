# Adversarial cross-origin iframe fixture (SC #5)

This is the deliberately-constructed test page ROADMAP's SC #5 requires: a
top-level page at **Origin A** embedding a genuinely **cross-origin**
`<iframe>` at **Origin B** that hosts a login form styled to mimic Origin
A's own login -- the exact Bitwarden-CVE-class layout the origin gate must
refuse. It proves `frame-guard.ts`'s (10-01) origin refusal and
`autofill-match.ts`/`content-relay.content.ts`'s (10-04/10-05) frame-
addressed dispatch hold in a real browser, not just in jsdom.

- **Origin A:** `http://127.0.0.1:8791` -- `top.html` (own login + embedded
  Origin-B iframe), `legit-login.html` (same-origin positive-path page:
  login+TOTP, card, identity)
- **Origin B:** `http://localhost:8792` -- `attacker-frame.html` (mimics
  Origin A's login, embedded inside `top.html`)

`127.0.0.1` and `localhost` are two genuinely distinct hostnames even
though both resolve to loopback -- the browser's origin model is
scheme+host+port, so this is a real cross-origin boundary, not a same-
origin fake with two ports.

This fixture is local-only, self-contained, and makes no outbound network
request. No file references a real brand name -- `fixture-app.local` is a
placeholder used purely to make the mimicry visually convincing for the
test (T-10-27).

## 1. Build and load the extension

**Chrome (blocking pass):**
```
cd extension
npx wxt build -b chrome
```
Load `extension/.output/chrome-mv3` as an unpacked extension:
`chrome://extensions` -> enable Developer mode -> "Load unpacked" -> select
that directory.

**Firefox (strongly recommended if available, not blocking this phase):**
```
cd extension
npx wxt build -b firefox
```
Load `extension/.output/firefox-mv2/manifest.json` via
`about:debugging#/runtime/this-firefox` -> "Load Temporary Add-on...". If
Firefox is unavailable in this environment, this step is skipped per
10-RESEARCH.md's Environment Availability note -- a hard Firefox gate is
deferred to Phase 13 (Dual-Browser Hardening).

## 2. Start the two fixture origins

```
node extension/e2e-fixtures/adversarial-iframe/serve.mjs 8791 A
node extension/e2e-fixtures/adversarial-iframe/serve.mjs 8792 B
```
(Run each in its own terminal, or background both.) Confirm both respond:
`http://127.0.0.1:8791/top.html` and `http://localhost:8792/attacker-frame.html`.

## 3. Point the extension at a running pv-server, sign in, save a login

1. Have `pv-server` running (e.g. `cargo run -p pv-server`, default
   `http://localhost:8620`).
2. Open the extension popup. On first run it asks for the server URL --
   enter it, submit.
3. Sign in (or register) with a test account.
4. If Phase 9's popup-side item creation isn't available, seed the login
   via the v0.1 web app against the SAME server instead (open the app's
   own origin, sign in, create a new **Login** item):
   - **Name:** anything identifiable, e.g. `ADV-IFRAME-TEST`
   - **Username / Password:** any values -- these are what you'll watch
     land in Origin A's fields and never in Origin B's.
   - **URL:** `http://127.0.0.1:8791` (Origin A -- must match exactly,
     scheme+host+port, for the origin gate to offer it)
5. Confirm the item appears in the popup's vault list (sync landed).

## 4. Run the SC #5 UAT

Perform every step below and record pass/fail. **Any failure in step 2
(refusal) or step 3 (gesture gate) is a BLOCKER -- the phase does not seal
on a partial pass.**

| # | Step | Pass criterion |
|---|------|-----------------|
| 1 | **POSITIVE.** Navigate to `http://127.0.0.1:8791/legit-login.html`. Open the popup. The "Na tej stronie" / "On this page" section lists the saved Origin-A login. Click Wypełnij/Fill. | Username+password land in `#login-username`/`#login-password`. A real submit (Enter/click Sign in) would send them -- the fields hold real values, not placeholders. |
| 2 | **REFUSAL (the SC #5 core).** Navigate to `http://127.0.0.1:8791/top.html`. Open the popup, click Wypełnij/Fill for the same Origin-A item. | Origin A's OWN form (`#top-username`/`#top-password`) fills. The embedded Origin-B `<iframe>`'s fields (`#frame-username`/`#frame-password`, inside `#attacker-iframe`) stay **completely empty** -- inspect the iframe's DOM directly, not just "no error shown". The popup must never even OFFER the item as a match inside the iframe's own frame context. |
| 3 | **GESTURE GATE.** With the vault unlocked, load `top.html` (or `legit-login.html`) and wait 60+ seconds without clicking anything in the popup. | Nothing fills on page load or during the idle wait -- every field (`top-*`, `login-*`, and the iframe's `frame-*`) remains empty until the explicit popup Wypełnij/Fill click. |
| 4 | **CARD/IDENTITY 2nd CONFIRM.** On `legit-login.html`'s Card and Identity forms, click Wypełnij/Fill. | An inline second confirm appears; fields (`#cc-*`, `#id-*`) fill only AFTER that second click, not on the first. |
| 5 | **TOTP.** On `legit-login.html`'s login form (`#login-otp`, `autocomplete="one-time-code"`), trigger a TOTP fill/copy for a TOTP item. | The live code fills `#login-otp` directly, OR (if no OTP field is targeted) is copied to the clipboard with the auto-clear toast -- confirm whichever path the popup UI takes. |
| 6 | **REAL-FRAMEWORK spot-check.** See `../real-forms/README.md`. | Documented separately -- a real React-controlled login fill survives an actual submit; card/identity false positives absent on 2-3 real forms. |

Each field's post-fill value can be inspected via devtools console on the
respective document (`document.getElementById(...)​.value`), or -- for the
automated variant of this run -- via a Playwright script driving the
packaged build headlessly and asserting on the SAME selectors used above
(`#top-username`, `#frame-username`, etc.), with every assertion recorded
in a pass/fail array rather than inferred from the absence of an error.
The durable, checked-in cross-browser Playwright harness is Phase 13's
13-03 -- this fixture intentionally does not ship one; a throwaway driver
script (not checked in) is sufficient to accelerate re-runs during this
plan's own execution.

## Result record

Record the outcome of each numbered step (pass/fail + note) in this
phase's `10-07-SUMMARY.md` and/or the executor's checkpoint response. A
"pass" on step 2 must be backed by an assertion on the iframe's actual
field values, not merely "no console error appeared".
