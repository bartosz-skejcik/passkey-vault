// lib/messaging/ext-protocol.ts — the typed popup<->background message
// contract. Popup NEVER imports pv-wasm/pv-core directly (D-05) — this
// discriminated-union, dispatched over browser.runtime.sendMessage, is the
// ONLY thing that crosses the popup<->background boundary.
//
// WR-08 (09-REVIEW.md) — WHY THERE IS NO WEB-RP PRF PAIR HERE, and why one
// must never be added back: `unlock.prf.start/finish` and
// `auth.signIn.prf.start/finish` (plus their handlers, router cases, and
// auth-api transport) were deleted as unreachable-by-construction. A
// `chrome-extension://` popup page gets a SecurityError from
// `navigator.credentials.get()` for ANY web RP ID — empirically probed, and
// the reason for the 09-CONTEXT AMENDMENT 2026-07-15 pivot to an
// extension-scoped PRF passkey (`rpId === browser.runtime.id`, the ONLY
// rpId Chrome accepts from this origin). The extension's PRF path is
// `unlock.extPrf.*` below; it is not an alternative to the web-RP pair, it
// is the only thing that can work. Keeping the dead pair only widened
// isProtocolMessage's accepted surface and invited a future caller to
// reintroduce a bug no UAT could see.
//
// This union grows across Waves 3-5: 09-04 adds `unlock.*` AND
// `auth.signIn.*` kinds (the unlock-only pair requires an existing token;
// the sign-in pair mints one), 09-05 adds `vault.list` (request/response,
// dispatched by router.ts) and `vault.updated` (fire-and-forget broadcast
// from vault-store.ts's lock-state subscription -- NOT dispatched by
// router.ts's switch; it exists here purely so a future popup listener can
// type-check against the same union). 09-08 adds `extPasskey.*`/
// `unlock.extPrf.*` kinds (the extension-scoped PRF passkey, 09-CONTEXT
// AMENDMENT 2026-07-15). 09-06 adds `config.get`/`config.set`, delegating to
// server-config.ts (Plan 09-03). Each later plan ADDS a union member here plus a
// matching `MessageResponseMap` entry — this file's overall shape
// (discriminated union + response map + typed sendMessage helper) never
// gets restructured.
//
// `UnlockResult`/`PrfStartResult`/`ExtEnrollStartResult`/`ExtUnlockResult`
// are `import type`-only from entrypoints/background/unlock.ts and
// entrypoints/background/ext-passkey.ts (their canonical definitions, per
// each plan's own export surface) — erased at compile time, so this file
// (and any popup that imports it) never bundles background-only runtime
// code, only the type shape.
//
// Post-UAT protocol fix (JSON-transport safety): every binary field on this
// union is a base64 STRING (`*B64` suffix), never a raw `Uint8Array`/
// `ArrayBuffer`/`BufferSource` -- Chrome's MV3 `sendMessage` transport
// JSON-serializes its payload, which silently mangles those types into
// `{"0":1,...}`/`{}` (see lib/messaging/bytes-b64.ts's header comment for
// the full root cause). Senders encode with `bytesToB64`, receivers decode
// with `b64ToBytes` from that file. `ext-protocol.test.ts`'s
// JSON-round-trip fixture test is the structural gate against regression:
// adding a new binary field back to this union without going through
// bytes-b64.ts will fail that test (and, via its fixture-exhaustiveness
// switch, fail `tsc` if a new `kind` is added without a fixture at all).
import { browser } from "wxt/browser";
import type { UnlockResult } from "../../entrypoints/background/unlock";
import type { ExtEnrollStartResult, ExtUnlockResult } from "../../entrypoints/background/ext-passkey";
import type { Folder, VaultItem } from "../vault/types";

export type SessionStatus =
  | { kind: "no-session" }
  | {
      kind: "locked";
      wasAutoLocked: boolean;
      autoLockMinutes: number;
      // 09-08: gates the popup's PRF-button visibility / enrollment prompt
      // (09-CONTEXT AMENDMENT 2026-07-15) purely off this ONE status call —
      // no parallel status kind is added.
      extPasskeyEnrolled: boolean;
      extPasskeyPromptSuppressed: boolean;
    }
  | {
      kind: "unlocked";
      autoLockMinutes: number;
      accountEmail: string;
      extPasskeyEnrolled: boolean;
      extPasskeyPromptSuppressed: boolean;
    };

export type Message =
  | { kind: "session.status" }
  | { kind: "session.setAutoLockMinutes"; minutes: number }
  // Unlock-only — existing token, SessionUser-gated server routes.
  | { kind: "unlock.password"; passwordB64: string }
  // Sign-in — fresh install/no-session, mints a new session token.
  | { kind: "auth.signIn.password"; passwordB64: string; email: string }
  // Read path only (CONTEXT.md's locked out-of-scope boundary — no
  // create/edit/delete this phase): the popup's current decrypted item/
  // folder list, backed by vault-store.ts's real sync.
  | { kind: "vault.list" }
  // Fire-and-forget broadcast — vault-store.ts sends this whenever the
  // decrypted cache changes (a sync pull applied, or a lock event cleared
  // it). No response payload; a popup listens via its own
  // browser.runtime.onMessage, not via sendMessage()'s request/response
  // round trip.
  | { kind: "vault.updated" }
  // CR-01 fix (09-REVIEW.md): fire-and-forget broadcast sent by
  // vault-session.ts's lockVaultSession() the instant the vault locks
  // (auto-lock alarm OR any other caller) — distinct from `vault.updated`
  // (which also fires on every ordinary sync merge) so App.tsx's top-level
  // listener can react to a LOCK specifically, from ANY view including
  // `detail`, without paying a `session.status` round trip on every sync.
  | { kind: "session.locked" }
  // 09-08: extension-scoped PRF passkey (09-CONTEXT AMENDMENT 2026-07-15).
  // Enroll pair — requires an unlocked session (wraps the CURRENT UK).
  | { kind: "extPasskey.enroll.start" }
  | {
      kind: "extPasskey.enroll.finish";
      credentialIdB64url: string;
      prfSaltB64: string;
      prfB64: string;
    }
  | { kind: "extPasskey.suppressPrompt"; suppress: boolean }
  // Unlock pair — existing token, no ceremony verification server-side (the
  // PRF output IS the secret).
  | { kind: "unlock.extPrf.start" }
  | { kind: "unlock.extPrf.finish"; credentialIdB64url: string; prfB64: string }
  // 09-06: the popup's server-URL configuration screen (EXT-05) and the
  // "open full vault" / header redirect controls' sole source of the
  // configured pv-server origin -- delegates directly to server-config.ts
  // (Plan 09-03)'s readServerConfig()/configureServer().
  | { kind: "config.get" }
  | { kind: "config.set"; rawUrl: string };

export interface MessageResponseMap {
  "session.status": SessionStatus;
  "session.setAutoLockMinutes": { ok: true };
  "unlock.password": UnlockResult;
  "auth.signIn.password": UnlockResult;
  "vault.list": { items: VaultItem[]; folders: Folder[] };
  "vault.updated": void;
  "session.locked": void;
  "extPasskey.enroll.start": ExtEnrollStartResult;
  "extPasskey.enroll.finish": {
    ok: boolean;
    error?: "not-unlocked" | "unreachable" | "unknown" | "invalid-credentials";
  };
  "extPasskey.suppressPrompt": { ok: true };
  "unlock.extPrf.start": { credentialIdB64url: string; prfSaltB64: string } | { notEnrolled: true };
  "unlock.extPrf.finish": ExtUnlockResult;
  "config.get": { baseUrl: string } | null;
  "config.set": { ok: true } | { ok: false; error: "invalid-url" | "unreachable" };
}

export type MessageOf<K extends Message["kind"]> = Extract<Message, { kind: K }>;

/**
 * Typed wrapper over `browser.runtime.sendMessage` — the popup's sole entry
 * point into the background context. The generic `K` ties the request
 * shape (`MessageOf<K>`) to its response shape (`MessageResponseMap[K]`) so
 * a caller can never mismatch a message kind with the wrong response type.
 */
export async function sendMessage<K extends Message["kind"]>(
  message: MessageOf<K>,
): Promise<MessageResponseMap[K]> {
  return browser.runtime.sendMessage(message) as Promise<MessageResponseMap[K]>;
}
