// lib/passkeys/prf.ts — pure, browser-API-free (aside from
// `PublicKeyCredential`'s TYPE, not its runtime) port of
// web/src/lib/passkeys/login.ts lines 39-75, verbatim in logic. Serves BOTH
// the sign-in ceremony (auth.signIn.prf.*) and the unlock-only ceremony
// (unlock.prf.*) identically -- this module has no notion of which flow is
// calling it.
//
// Zero-knowledge / D-05 boundary: this file is the ONLY thing the popup
// (Plan 09-06) needs to prepare/consume a WebAuthn PRF ceremony -- it has no
// import of the generated WASM bindings or their choke-point loader (no
// crypto happens here), so a popup that imports it stays free of any WASM
// dependency. The actual PRF -> wrapping-key derivation
// (WasmWrappingKey.fromPrf) only ever happens in the background
// (entrypoints/background/unlock.ts), which receives this module's OUTPUT
// (extracted bytes / stripped JSON) as plain message payloads -- never a
// live PublicKeyCredential.
//
// Deliberately does NOT import base64Decode from
// entrypoints/background/auth-api.ts: that would pull server-config.ts/
// session-storage.ts (background-only, chrome.storage-backed modules) into
// any popup bundle that imports this file. The tiny helper is duplicated
// locally instead so this module stays import-free of anything
// background-context-specific.
function base64Decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Builds the `prf.evalByCredential` WebAuthn extension input from a
 * server-supplied `{ credIdB64Url: saltB64 }` map. The map's KEYS
 * (credential ids) are used AS-IS -- they already arrived base64url-encoded
 * from the server and must byte-match `allowCredentials[i].id`. Only the
 * VALUES (salts) get base64-decoded. This asymmetry is deliberate.
 */
export function buildPrfExtensions(
  prfSalts: Record<string, string>,
): { prf: { evalByCredential: Record<string, { first: BufferSource }> } } {
  const evalByCredential: Record<string, { first: BufferSource }> = {};
  for (const [credIdB64Url, saltB64] of Object.entries(prfSalts)) {
    evalByCredential[credIdB64Url] = { first: base64Decode(saltB64) as BufferSource };
  }
  return { prf: { evalByCredential } };
}

/**
 * Reads the PRF eval output directly from the LIVE `assertion` object --
 * must be called on the original, unstripped `PublicKeyCredential`, never on
 * `stripPrfFromCredentialJson`'s JSON output (see that function's own doc
 * comment for why the two must never be confused).
 */
export function extractPrfBytes(assertion: PublicKeyCredential): ArrayBuffer | undefined {
  const results = assertion.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  return results.prf?.results?.first;
}

/**
 * CR-01 / mirrors `enroll.ts`'s WR-04 strip: `PublicKeyCredential.toJSON()`
 * serializes `clientExtensionResults`, which for the PRF extension can in
 * principle include the raw eval output bytes (mainstream browsers
 * currently don't appear to put the secret `results.first` bytes there, but
 * that's undocumented, browser-version-dependent behavior, not a contract).
 * Neither the sign-in finish nor the unlock finish handler ever needs `prf`
 * output on the wire -- strip it before the credential JSON ever leaves the
 * popup, so the zero-knowledge boundary doesn't rely on that assumption
 * holding forever. Must be called on `assertion.toJSON()` output ONLY --
 * `extractPrfBytes(assertion)` (above) must still read from the original,
 * unstripped `assertion` object to derive the wrapping key.
 */
export function stripPrfFromCredentialJson(assertion: PublicKeyCredential): unknown {
  const json = assertion.toJSON() as { clientExtensionResults?: { prf?: unknown } };
  if (json.clientExtensionResults?.prf !== undefined) {
    delete json.clientExtensionResults.prf;
  }
  return json;
}
