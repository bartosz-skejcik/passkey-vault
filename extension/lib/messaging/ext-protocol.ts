// lib/messaging/ext-protocol.ts — the typed popup<->background message
// contract. Popup NEVER imports pv-wasm/pv-core directly (D-05) — this
// discriminated-union, dispatched over browser.runtime.sendMessage, is the
// ONLY thing that crosses the popup<->background boundary.
//
// This union grows across Waves 3-5: 09-04 adds `unlock.*` AND
// `auth.signIn.*` kinds (the unlock-only pair requires an existing token;
// the sign-in pair mints one), 09-05 adds `vault.list` (request/response,
// dispatched by router.ts) and `vault.updated` (fire-and-forget broadcast
// from vault-store.ts's lock-state subscription -- NOT dispatched by
// router.ts's switch; it exists here purely so a future popup listener can
// type-check against the same union). Each later plan ADDS a union member
// here plus a matching `MessageResponseMap` entry — this file's overall
// shape (discriminated union + response map + typed sendMessage helper)
// never gets restructured.
//
// `UnlockResult`/`PrfStartResult` are `import type`-only from
// entrypoints/background/unlock.ts (their canonical definition, per that
// plan's own export surface) — erased at compile time, so this file (and
// any popup that imports it) never bundles background-only runtime code,
// only the type shape.
import { browser } from "wxt/browser";
import type { UnlockResult, PrfStartResult } from "../../entrypoints/background/unlock";
import type { Folder, VaultItem } from "../vault/types";

export type SessionStatus =
  | { kind: "no-session" }
  | { kind: "locked"; wasAutoLocked: boolean; autoLockMinutes: number }
  | { kind: "unlocked"; autoLockMinutes: number; accountEmail: string };

export type Message =
  | { kind: "session.status" }
  | { kind: "session.setAutoLockMinutes"; minutes: number }
  // Unlock-only pair — existing token, SessionUser-gated server routes.
  | { kind: "unlock.password"; passwordBytes: Uint8Array }
  | { kind: "unlock.prf.start" }
  | { kind: "unlock.prf.finish"; stateId: string; credentialJson: unknown; prfBytes: ArrayBuffer }
  // Sign-in pair — fresh install/no-session, mints a new session token.
  | { kind: "auth.signIn.password"; passwordBytes: Uint8Array; email: string }
  | { kind: "auth.signIn.prf.start"; email: string }
  | {
      kind: "auth.signIn.prf.finish";
      stateId: string;
      email: string;
      credentialJson: unknown;
      prfBytes: ArrayBuffer;
    }
  // Read path only (CONTEXT.md's locked out-of-scope boundary — no
  // create/edit/delete this phase): the popup's current decrypted item/
  // folder list, backed by vault-store.ts's real sync.
  | { kind: "vault.list" }
  // Fire-and-forget broadcast — vault-store.ts sends this whenever the
  // decrypted cache changes (a sync pull applied, or a lock event cleared
  // it). No response payload; a popup listens via its own
  // browser.runtime.onMessage, not via sendMessage()'s request/response
  // round trip.
  | { kind: "vault.updated" };

export interface MessageResponseMap {
  "session.status": SessionStatus;
  "session.setAutoLockMinutes": { ok: true };
  "unlock.password": UnlockResult;
  "unlock.prf.start": PrfStartResult;
  "unlock.prf.finish": UnlockResult;
  "auth.signIn.password": UnlockResult;
  "auth.signIn.prf.start": PrfStartResult;
  "auth.signIn.prf.finish": UnlockResult;
  "vault.list": { items: VaultItem[]; folders: Folder[] };
  "vault.updated": void;
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
