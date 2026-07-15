// lib/messaging/ext-protocol.ts — the typed popup<->background message
// contract. Popup NEVER imports pv-wasm/pv-core directly (D-05) — this
// discriminated-union, dispatched over browser.runtime.sendMessage, is the
// ONLY thing that crosses the popup<->background boundary.
//
// This union grows across Waves 3-4: 09-03 adds `unlock.*` kinds, 09-04
// adds `auth.signIn.*` kinds, 09-05 adds `vault.list`. Each later plan ADDS
// a union member here plus a matching `MessageResponseMap` entry — this
// file's overall shape (discriminated union + response map + typed
// sendMessage helper) never gets restructured.
import { browser } from "wxt/browser";

export type SessionStatus =
  | { kind: "no-session" }
  | { kind: "locked"; wasAutoLocked: boolean; autoLockMinutes: number }
  | { kind: "unlocked"; autoLockMinutes: number; accountEmail: string };

export type Message =
  | { kind: "session.status" }
  | { kind: "session.setAutoLockMinutes"; minutes: number };

export interface MessageResponseMap {
  "session.status": SessionStatus;
  "session.setAutoLockMinutes": { ok: true };
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
