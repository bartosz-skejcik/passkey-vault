# Firefox manual/semi-automated UAT harness (Phase 13-04)

Playwright cannot load a real Firefox extension (its Firefox channel has no
`--load-extension` equivalent for WebExtensions), so this project's Chrome
harness (`extension/e2e/`) has no direct Firefox port. This directory holds
the `selenium-webdriver` + `geckodriver` harness built for Plan 13-04's
Firefox re-verification pass, kept here so a future dual-browser hardening
pass (or a real product regression on Firefox) can be re-run without
rebuilding the tooling from scratch.

**This is not a CI-grade automated suite** — it drives a real, visible
Firefox window against a real running `pv-server`, and several rows are
verified via computed-coordinate clicks into this project's closed shadow
roots (Firefox has no CDP, so the Chrome suite's `DOM.getDocument({pierce:
true})` shadow-piercing technique has no equivalent here — see
`13-UAT-CHECKLIST.md`'s Firefox Deviations section for the full writeup of
every technique used).

## Prerequisites

1. Firefox installed locally (tested against 152.0.6; any recent release
   should work — `strict_min_version` is pinned to 115.0 in `wxt.config.ts`).
2. `pv-server` running with `PV_EXTENSION_ORIGINS` including the Chrome
   extension id AND every lane's own concrete `moz-extension://<uuid>`
   origin — SEC-02 (Phase 19, Plan 19-01) removed the scheme-scoped
   `moz-extension://` wildcard fallback, so each lane's pinned UUID must be
   listed explicitly:
   `a1b2c3d4-e5f6-4789-a012-3456789abcde` (run-core.cjs, run-autofill-capture.cjs),
   `b2c3d4e5-f6a7-4890-b123-456789abcdef` (probe-provider-corruption.cjs,
   run-server-unlock.cjs), `c3d4e5f6-a7b8-4901-b234-56789abcdef0`
   (probe-request-xray.cjs), `f6a7b8c9-d0e1-4234-a567-89abcdef0123`
   (probe-window-geometry.cjs). One command covering all four lanes:
   ```
   PV_EXTENSION_ORIGINS=chrome-extension://<your-chrome-id>,moz-extension://a1b2c3d4-e5f6-4789-a012-3456789abcde,moz-extension://b2c3d4e5-f6a7-4890-b123-456789abcdef,moz-extension://c3d4e5f6-a7b8-4901-b234-56789abcdef0,moz-extension://f6a7b8c9-d0e1-4234-a567-89abcdef0123 \
     cargo run -p pv-server
   ```
3. `npm run build:firefox` (from `extension/`) — this harness does NOT
   rebuild the extension itself.
4. A real account on the target `pv-server` (defaults below match this
   project's own shared UAT account; override via env vars for a different
   server/account).
5. `python3` with Pillow installed (`pip install Pillow`) — used by
   `find_color.py` for closed-shadow-root button targeting.

## Running

```bash
cd extension
npm run test:e2e:firefox:core                # Phase 9 + Phase 12 + D-05/D-08/rpId-on-Firefox
npm run test:e2e:firefox:autofill            # Phase 10 + Phase 11
npm run test:e2e:firefox:server-unlock       # Plan 13-06: server-origin ceremony window+bridge+relay
npm run test:e2e:firefox:window-geometry     # Plan 18-01, UX-02: window centering/sizing/self-close
npm run test:e2e:firefox:request-xray        # Plan 14-03: permanent XBR-02 response-direction byte-identity regression gate
npm run test:e2e:firefox:provider-corruption # Permanent provider-response byte-level regression gate (.planning/debug/resolved/firefox-provider-corruption.md)
```

**CSP-strict coverage:** there is no separate `csp-strict` lane. The `core`
lane (`run-core.cjs:397-454`, records `CSP-STRICT-SHIM-PRESENT` at line ~418
and `CSP-STRICT-CREATE` at line ~448/451) and the `request-xray` lane
(`probe-request-xray.cjs:439-450`, records `SHIM-PRESENT` at line ~448 and
gates the rest of that probe's ceremony on it) both drive a real
`/provider-csp` fixture route serving `Content-Security-Policy: script-src
'self'` as part of their own run, proving the MAIN-world provider shim
(D-08) survives a genuinely restrictive page CSP — the exact class of bug
`.planning/debug/resolved/firefox-injection-csp-blocked.md` fixed. No
dedicated CSP-strict script exists or is needed.

Both scripts open a real, visible Firefox window and drive it for several
minutes. Screenshots and a `results-*.json` summary land in
`.ff-screenshots/` (git-ignored, created on first run). A persistent
profile lives in `.ff-profile/` (also git-ignored) — this pins the
`moz-extension://<uuid>` origin across relaunches via a pinned
`extensions.webextensions.uuids` preference, which both storage-persistence
and CORS-origin-observation rows depend on.

`run-server-unlock.cjs` (Plan 13-06) is a SEPARATE script/profile/account
from the two above: it registers a fresh, never-enrolled probe account
(`uat-noext-ff-<run>@example.local` by default) via the real web-app
RegisterForm UI, then drives the extension's locked-popup ->
server-ceremony-button -> ceremony-window -> gesture -> honest
no-passkeys-empty-state flow. It deliberately does NOT exercise the full
PRF-completion path — Firefox's WebAuthn Virtual Authenticator is genuinely
`NS_ERROR_NOT_IMPLEMENTED` (see `run-core.cjs`'s P12-SC3 row and
`13-UAT-CHECKLIST.md`), so there is no automatable stand-in for a real
authenticator tap. A fresh account with zero enrolled passkeys makes the
server's own `/api/passkeys/unlock/start` 404 before any WebAuthn ceremony
is ever invoked, which is exactly how this scenario reaches the honest
empty-state without needing hardware. **Full-PRF-on-Firefox completion is a
documented live-UAT item for a human with a real authenticator** (see
13-06-SUMMARY.md's human-check section) — this harness does not claim to
cover it.

Plan 13-07 (Bartek mandate, full SIGN-IN) extends the SAME script with a
second scenario, run immediately after the unlock-mode one above in the
same profile/session: clears the extension's own session-meta record
(reaching the genuine no-session/Sign-in view), confirms the sign-in
variant's own server-ceremony button (unconditional whenever a server is
configured — unlike the unlock-mode button's own "unusable" gate), opens
the ceremony window with `pv-mode=signin`, and confirms `ExtUnlockBridge`
renders the SIGNIN surface (distinct heading + the email field this mode
requires — passkeyLogin identifies the user by EMAIL, not a discoverable
credential). **Asymmetry vs. unlock mode, found and documented, not a
bug:** `passkeyLoginStart()` (the login ceremony's own server route)
returns an enumeration-resistant DUMMY WebAuthn challenge even for a
zero-passkey account (`crates/pv-server/src/routes/auth.rs`'s
`passkey_login_start`, threat_model T-04-01) — unlike `unlockStart()`'s
clean 404, this means `navigator.credentials.get()` IS genuinely invoked
for the signin-mode gesture, with no real/virtual authenticator available
under geckodriver. This scenario therefore stops at the GESTURE (recorded
as `INFO`, not asserted to a specific terminal state) rather than reaching
a no-passkeys empty-state the way the unlock-mode scenario does — this is
the signin-mode ceremony's own honest authenticator-less limit, confirmed
via screenshot (the ceremony's own busy/"Confirm in your browser..." state,
Firefox's native picker pending outside the DOM).

## Environment variables (all optional, sensible defaults shown)

| Variable | Default | Purpose |
|---|---|---|
| `PV_SERVER` | `http://localhost:8620` | The `pv-server` base URL |
| `PV_UAT_EMAIL` | `uat-prf04@example.local` | Test account email |
| `PV_UAT_PASSWORD` | (this project's own shared UAT password) | Test account password |
| `PV_FIREFOX_BINARY` | `/Applications/Firefox.app/Contents/MacOS/firefox` | Path to the Firefox binary (adjust for Linux/Windows) |
| `PV_FF_FIXED_UUID` | a fixed placeholder UUID | The pinned `moz-extension://` origin UUID; keep CONSTANT across a single walk's runs |
| `PV_FF_PROFILE_DIR` | `./e2e-firefox/.ff-profile` | Persistent Firefox profile directory |
| `PV_FF_SHOTS_DIR` | `./e2e-firefox/.ff-screenshots` | Screenshot + results-JSON output directory |

## Known, accepted test-harness quirks (see 13-UAT-CHECKLIST.md for the full writeup)

- The popup's own "on this page" autofill picker (active-tab-based
  `autofill.match`/`autofill.fill`) is not reliably drivable via classic
  WebDriver on Firefox — switching `driver.switchTo().window()` genuinely
  changes Firefox's OS-level "active tab" (unlike CDP), so autofill fill
  rows are driven via Surface B/A (`autofill.matchFrame`/`fillFrame`,
  the content-relay's own sender-derived-origin channel) instead — the
  exact same underlying fill code path, just reached through a different
  real UI surface.
- This project's shared UAT test account has accumulated many historical
  items across many prior sessions; some rows (P10-SC2/SC3/SC4) therefore
  iterate rows or verify a plausible real-value SHAPE rather than an exact
  match, since a fixed "row 0" assumption is not reliable on a heavily
  reused account. A fresh/isolated account would not need this.
