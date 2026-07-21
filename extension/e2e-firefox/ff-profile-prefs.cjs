// extension/e2e-firefox/ff-profile-prefs.cjs — shared preference-injection
// helper resolving
// .planning/todos/pending/2026-07-20-suppress-macos-passkey-sheet-in-firefox-harness.md
// (relocated to .planning/todos/resolved/ once this fix landed).
//
// Problem: rows in this harness that deliberately fall through to native
// WebAuthn (documented D-11 fallthrough behavior) raised the macOS system
// passkey sheet (iCloud Keychain / Touch ID) in harness-spawned Firefox
// profiles, requiring a human to manually dismiss it -- breaking the
// unattended-run contract every one of these scripts otherwise satisfies.
//
// Fix: apply BOTH candidate approaches from the todo TOGETHER
// (belt-and-suspenders), rather than picking just one:
//   1. security.webauthn.enable_macos_passkeys -> false
//      (native ceremony fails fast instead of raising the OS sheet)
//   2. security.webauth.webauthn_enable_softtoken -> true +
//      security.webauth.webauthn_enable_usbtoken -> false
//      (native ceremony completes silently in a virtual authenticator
//      instead of raising the OS sheet)
// An unrecognized pref name is silently harmless in Firefox (it is simply
// stored, unused, in prefs.js) -- so combining both approaches maximizes
// suppression reliability across the webauthn-pref-name churn the todo
// itself flags (verified against Firefox 152.0.6, this project's own
// tested/pinned release -- see README.md's Prerequisites section) without
// any downside risk from applying the "wrong" one.
'use strict';

/**
 * Applies the 3 native-WebAuthn-UI-suppression preferences to a
 * selenium-webdriver firefox.Options instance. Call this AFTER the
 * existing `opts.setPreference('xpinstall.signatures.required', false)`
 * line and BEFORE `new Builder().forBrowser('firefox').setFirefoxOptions(opts).build()`.
 *
 * @param {import('selenium-webdriver/firefox').Options} opts
 */
function applyNoNativeUiPrefs(opts) {
  opts.setPreference('security.webauthn.enable_macos_passkeys', false);
  opts.setPreference('security.webauth.webauthn_enable_softtoken', true);
  opts.setPreference('security.webauth.webauthn_enable_usbtoken', false);
  return opts;
}

module.exports = { applyNoNativeUiPrefs };
