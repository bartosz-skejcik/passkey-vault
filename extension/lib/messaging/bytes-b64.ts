// lib/messaging/bytes-b64.ts — pure base64 <-> bytes helpers for the
// popup<->background message boundary (Post-UAT protocol fix, Phase 9).
//
// WHY THIS FILE EXISTS: Chrome's MV3 `chrome.runtime.sendMessage` transport
// JSON-serializes its payload (unlike Firefox, which uses the structured
// clone algorithm). A `Uint8Array` field survives JSON.stringify/parse as a
// plain `{"0":1,"1":2,...}` index-keyed object, and an `ArrayBuffer` field
// survives as `{}` -- both silently losing all their bytes. ext-protocol.ts
// therefore never puts a `Uint8Array`/`ArrayBuffer`/`BufferSource` directly
// on the wire; every binary field is a base64 STRING (already JSON-safe),
// encoded/decoded via this file's two functions at the sender/receiver
// boundary.
//
// btoa/atob-based (no Buffer dependency) -- same pattern already used in
// entrypoints/background/auth-api.ts, entrypoints/background/ext-passkey.ts,
// lib/passkeys/prf.ts, and lib/passkeys/ext-prf.ts. Deliberately NOT a
// re-export of any of those: this module must be importable from BOTH the
// popup and the background without pulling in background-only modules
// (server-config.ts/session-storage.ts) into a popup bundle (D-05) -- pure,
// no browser-runtime APIs beyond the universally-available btoa/atob.

/** Encodes raw bytes to a base64 string (browser btoa, no Buffer dependency). */
export function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Decodes a base64 string back to raw bytes (browser atob, no Buffer dependency). */
export function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
