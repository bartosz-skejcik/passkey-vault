// lib/passkeys/ext-prf.ts — pure builders for the popup's extension-scoped
// PRF passkey ceremony (09-CONTEXT AMENDMENT 2026-07-15): a DEDICATED
// passkey whose rpId is the extension's OWN id, the only rpId
// `navigator.credentials.get()` accepts from a `chrome-extension://` popup
// page (empirically proven — v0.1's server-registered web-RP passkeys throw
// `SecurityError` there). The caller (Plan 09-06's popup) supplies `rpId`
// explicitly, read from the extension's own runtime id AT CALL TIME — this
// file NEVER hard-codes or defaults an id, and has no dependency on the
// extension runtime API at all, so the invariant can't silently regress
// into a module-scope constant (`manifest.key`, Task 4, is what makes that
// per-call value stable across dev reloads).
//
// Zero WASM/background dependency — same discipline as
// ../../lib/passkeys/prf.ts (see that file's header comment for the
// rationale): a popup bundle importing this file must stay free of
// pv-wasm/chrome.storage-backed background modules. The actual
// PRF -> wrapping-key derivation (WasmWrappingKey.fromExtPrf) only ever
// happens in the background (entrypoints/background/ext-passkey.ts), which
// receives this module's ceremony INPUTS as plain message payloads.

function base64Decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * URL_SAFE_NO_PAD decode — credential ids arrive from the server/local meta
 * record already base64url-encoded (matches pv-server's own encoding
 * discipline for `credential_id`, see routes/extension_passkeys.rs).
 */
function base64UrlDecode(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  return base64Decode(padded + "=".repeat(padLength));
}

/**
 * Builds `navigator.credentials.create()`'s options for enrolling the
 * extension-scoped passkey. `attestation: "none"` — the server never
 * verifies this ceremony (09-CONTEXT AMENDMENT: no ceremony-verification
 * crate involvement by design). `extensions: { prf: {} }` requests PRF
 * capability at creation time, mirroring `web/src/lib/passkeys/enroll.ts`'s
 * own step-1 shape.
 */
export function buildExtCreateOptions(args: {
  rpId: string;
  accountEmail: string;
  userHandleB64: string;
  challengeB64: string;
}): CredentialCreationOptions {
  return {
    publicKey: {
      rp: { id: args.rpId, name: "Passkey Vault" },
      user: {
        id: base64Decode(args.userHandleB64) as BufferSource,
        name: args.accountEmail,
        displayName: args.accountEmail,
      },
      challenge: base64Decode(args.challengeB64) as BufferSource,
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      attestation: "none",
      extensions: { prf: {} },
    },
  };
}

/**
 * Builds `navigator.credentials.get()`'s options for the PRF unlock
 * ceremony against the previously-enrolled extension-scoped credential.
 * Exactly one `allowCredentials` entry (this ceremony always targets one
 * specific, already-known credential id — never a discoverable-credential
 * empty-list prompt).
 */
export function buildExtGetOptions(args: {
  rpId: string;
  credentialIdB64url: string;
  prfSaltB64: string;
  challengeB64: string;
}): CredentialRequestOptions {
  return {
    publicKey: {
      rpId: args.rpId,
      challenge: base64Decode(args.challengeB64) as BufferSource,
      allowCredentials: [
        { type: "public-key", id: base64UrlDecode(args.credentialIdB64url) as BufferSource },
      ],
      userVerification: "required",
      extensions: { prf: { eval: { first: base64Decode(args.prfSaltB64) as BufferSource } } },
    },
  };
}
