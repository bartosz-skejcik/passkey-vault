// lib/passkeys/prf.ts — the PRF-output reader for a completed WebAuthn
// ceremony. Pure and browser-API-free aside from `PublicKeyCredential`'s
// TYPE (not its runtime).
//
// WR-08 (09-REVIEW.md): this file used to also export `buildPrfExtensions`
// (the `prf.evalByCredential` input builder for a WEB-RP ceremony) and
// `stripPrfFromCredentialJson`, and its header used to claim it was "the
// ONLY thing the popup needs to prepare/consume a WebAuthn PRF ceremony" --
// which became false at the AMENDMENT. Both had zero callers and are
// deleted: a `chrome-extension://` popup gets a SecurityError from
// `navigator.credentials.get()` for any web RP ID, so no web-RP ceremony
// can ever run from this extension. See lib/messaging/ext-protocol.ts's
// header for the full rationale and 09-CONTEXT AMENDMENT 2026-07-15 for the
// pivot to an extension-scoped PRF passkey.
//
// The extension-scoped ceremony's OPTIONS are built by ./ext-prf.ts's
// `buildExtGetOptions` (rpId = browser.runtime.id); this file only reads the
// RESULT, and is used by both the unlock (UnlockView.tsx) and enrollment
// (EnrollExtPasskeyPrompt.tsx) paths.
//
// `stripPrfFromCredentialJson` went with the web-RP pair because nothing
// sends credential JSON to the server any more: the extension-scoped
// recipient never verifies a ceremony server-side (the PRF output IS the
// secret, T-09-24's locked disposition), so no `PublicKeyCredential` is
// ever serialized onto the wire and there is nothing to strip.
//
// Zero-knowledge / D-05 boundary: no import of the generated WASM bindings
// or their choke-point loader (no crypto happens here), so a popup that
// imports this file stays free of any WASM dependency. The PRF -> wrapping-
// key derivation (WasmWrappingKey.fromExtPrf) only ever happens in the
// background (entrypoints/background/ext-passkey.ts), which receives this
// module's OUTPUT as a plain base64 message payload -- never a live
// PublicKeyCredential.

/**
 * Reads the PRF eval output directly from the LIVE `assertion` object.
 * Returns `undefined` when the authenticator didn't report a PRF result
 * (i.e. it doesn't support the extension) -- callers treat that as an
 * honest Tier-1 degradation, never as an error.
 */
export function extractPrfBytes(assertion: PublicKeyCredential): ArrayBuffer | undefined {
  const results = assertion.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  return results.prf?.results?.first;
}
