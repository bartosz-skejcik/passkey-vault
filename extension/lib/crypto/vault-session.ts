// lib/crypto/vault-session.ts — the idle-kill/wake round-trip proof for
// Phase 8's spike (ROADMAP success criterion #3), plus the storage-survival
// pattern Phase 9's real vault-session logic depends on.
//
// D-05 (the single most important constraint this file exists to satisfy):
// this file has no code path that can reach a persistent storage area,
// because it never references one by name at all — storage access is
// entirely through the injected `SessionStorage` parameter. The real
// caller (entrypoints/background.ts) passes `browser.storage.session` at
// the call site; this file itself imports no browser/chrome global.
import {
  initCrypto,
  WasmWrappingKey,
  WasmUserKey,
  wrapUserKey,
  unwrapUserKey,
  defaultKdfParamsJson,
  randomSalt,
} from "./wasm-loader";

export type SessionStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

type SpikeEnvelope = { wrappedJson: string; saltB64: string };

// A fixed spike password is intentional here — this file proves the
// round-trip/storage-survival mechanics only, not a real unlock flow (that's
// Phase 9's AUTH work). No user-facing password ever flows through this
// file.
const SPIKE_PASSWORD = "pv-extension-spike-password";
const ENVELOPE_KEY = "spikeEnvelope";

// btoa/atob operate on binary strings, not byte arrays — these two helpers
// are the standard bridge, and both are available as plain globals in every
// context this code runs in (MV3 service worker, MV2 background page, and
// Node under vitest).
function saltToBase64(salt: Uint8Array): string {
  let binary = "";
  for (const byte of salt) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToSalt(saltB64: string): Uint8Array {
  const binary = atob(saltB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Round-trip crypto proof (derive -> wrap -> unwrap) plus injectable
 * chrome.storage.session-shaped persistence.
 *
 * - Empty `storage`: fresh UserKey + salt, wrap, persist, self-verify via
 *   unwrap, return `{ survived: false, ok: true }`.
 * - Pre-existing `spikeEnvelope` in `storage` (simulating a fresh
 *   service-worker instance woken after a real idle-kill, per D-10/D-05):
 *   re-derive the WrappingKey from the persisted salt, unwrap the
 *   persisted wrappedJson, return `{ survived: true, ok: true }` — never
 *   writes a new envelope in this path.
 */
export async function roundTripSpike(
  storage: SessionStorage,
): Promise<{ survived: boolean; ok: boolean }> {
  await initCrypto();

  const existing = await storage.get(ENVELOPE_KEY);
  const envelope = existing[ENVELOPE_KEY] as SpikeEnvelope | undefined;

  if (envelope !== undefined) {
    // Survived-a-wake path: re-derive from the persisted salt, never mint a
    // new one, never write anything back.
    const salt = base64ToSalt(envelope.saltB64);
    const passwordBytes = new TextEncoder().encode(SPIKE_PASSWORD);
    let wrappingKey: WasmWrappingKey;
    try {
      wrappingKey = WasmWrappingKey.fromPassword(passwordBytes, salt, defaultKdfParamsJson());
    } finally {
      passwordBytes.fill(0);
    }

    const unwrapped = unwrapUserKey(wrappingKey, envelope.wrappedJson);
    return { survived: true, ok: unwrapped !== undefined };
  }

  // Fresh-init path: generate a new UserKey, wrap it under a freshly
  // generated salt, persist the envelope, then self-verify by unwrapping
  // immediately before returning.
  const salt = new Uint8Array(randomSalt(16));
  const passwordBytes = new TextEncoder().encode(SPIKE_PASSWORD);
  let wrappingKey: WasmWrappingKey;
  try {
    wrappingKey = WasmWrappingKey.fromPassword(passwordBytes, salt, defaultKdfParamsJson());
  } finally {
    passwordBytes.fill(0);
  }

  const userKey: WasmUserKey = WasmUserKey.generate();
  const wrappedJson = wrapUserKey(wrappingKey, userKey);

  await storage.set({
    [ENVELOPE_KEY]: { wrappedJson, saltB64: saltToBase64(salt) } satisfies SpikeEnvelope,
  });

  unwrapUserKey(wrappingKey, wrappedJson); // self-verify before returning

  return { survived: false, ok: true };
}
