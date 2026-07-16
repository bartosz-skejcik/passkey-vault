// lib/messaging/ext-protocol.test.ts — the structural gate against the
// Post-UAT protocol fix's root cause regressing: Chrome's MV3
// `chrome.runtime.sendMessage` JSON-serializes its payload (unlike
// Firefox's structured clone), so a raw `Uint8Array`/`ArrayBuffer` field on
// this union silently arrives at the background as `{"0":..,"1":..}`/`{}`.
// Vitest's in-process mock of `sendMessage` never exercises real
// serialization, so a broken binary field previously passed every test
// while failing in a real Chrome browser (see this SUMMARY's "Post-UAT
// protocol fix" section for the full incident).
//
// This file is the in-process stand-in for that missing serialization
// step: `JSON.parse(JSON.stringify(fixture))` deep-equaling the original
// fixture is exactly what Chrome's transport does to every message, so any
// future binary field re-introduced onto the union fails this test loudly,
// in Node, without a real browser.
//
// Exhaustiveness is enforced at the TYPE level, not by a runtime
// switch/case with careful maintenance: `MESSAGE_FIXTURES`/
// `RESPONSE_FIXTURES` are typed as mapped-object types keyed by
// `Message["kind"]` (`{ [K in Message["kind"]]: ... }`). TypeScript
// requires an object literal assigned to that type to have EVERY key of
// `Message["kind"]` present, and rejects any key that isn't one --  so
// adding a new `kind` to the union without adding a fixture here (in
// either map) fails `tsc`, not just this test file's own assertions.
import { describe, expect, it } from "vitest";
import type { Message, MessageResponseMap, SessionStatus } from "./ext-protocol";

type MessageFixtureMap = { [K in Message["kind"]]: Extract<Message, { kind: K }> };

/** One representative request-side fixture per `Message["kind"]`. */
const MESSAGE_FIXTURES: MessageFixtureMap = {
  "session.status": { kind: "session.status" },
  "session.setAutoLockMinutes": { kind: "session.setAutoLockMinutes", minutes: 15 },
  // Binary fields are ALWAYS base64 strings (`*B64` suffix) on this union --
  // see lib/messaging/bytes-b64.ts's header comment for why.
  "unlock.password": { kind: "unlock.password", passwordB64: btoa("hunter2") },
  "auth.signIn.password": {
    kind: "auth.signIn.password",
    passwordB64: btoa("hunter2"),
    email: "a@example.com",
  },
  "vault.list": { kind: "vault.list" },
  "vault.updated": { kind: "vault.updated" },
  "session.locked": { kind: "session.locked" },
  "extPasskey.enroll.start": { kind: "extPasskey.enroll.start" },
  "extPasskey.enroll.finish": {
    kind: "extPasskey.enroll.finish",
    credentialIdB64url: "cred-id-b64url",
    prfSaltB64: btoa("salt-bytes"),
    prfB64: btoa("prf-output-bytes-3"),
  },
  "extPasskey.suppressPrompt": { kind: "extPasskey.suppressPrompt", suppress: true },
  "unlock.extPrf.start": { kind: "unlock.extPrf.start" },
  "unlock.extPrf.finish": {
    kind: "unlock.extPrf.finish",
    credentialIdB64url: "cred-id-b64url-2",
    prfB64: btoa("prf-output-bytes-4"),
  },
  "config.get": { kind: "config.get" },
  "config.set": { kind: "config.set", rawUrl: "https://vault.example.com" },
  // Phase 10 (Plan 10-01): autofill.match carries no fields at all --
  // nothing to round-trip beyond the discriminant.
  "autofill.match": { kind: "autofill.match" },
  "autofill.fill": { kind: "autofill.fill", itemId: "item-1", kind_: "login" },
  "autofill.totpCode": { kind: "autofill.totpCode", itemId: "item-2" },
  // Phase 10 (Plan 10-09): content-script -> background, dispatched by the
  // separate registerAutofillFrameChannel() listener -- no origin field.
  "autofill.matchFrame": {
    kind: "autofill.matchFrame",
    detected: { login: true, totp: false, card: false, identity: false },
  },
  "autofill.fillFrame": { kind: "autofill.fillFrame", itemId: "item-3", kind_: "login" },
  // Phase 11 (Plan 11-01): content-script -> background, dispatched by the
  // same registerAutofillFrameChannel() listener -- no origin field.
  "generate-request": {
    kind: "generate-request",
    mode: "character",
    length: 16,
    opts: { lowercase: true, uppercase: true, digits: true, symbols: false },
  },
  "capture.propose": {
    kind: "capture.propose",
    frameOrigin: "https://example.com",
    username: "user@example.com",
    password: "hunter2",
  },
  "capture.confirm": {
    kind: "capture.confirm",
    action: "new",
    frameOrigin: "https://example.com",
    username: "user@example.com",
    password: "hunter2",
  },
  // Phase 12 (Plan 12-02): content-script -> background, no origin field --
  // `publicKey` binaries are already base64url strings (D-21), never
  // ArrayBuffer/Uint8Array, so this fixture round-trips cleanly like every
  // other kind on this union.
  "credentials.create": {
    kind: "credentials.create",
    publicKey: {
      rp: { id: "example.com", name: "Example" },
      user: { id: "dXNlci1pZA", name: "user@example.com", displayName: "User" },
      challenge: "Y2hhbGxlbmdl",
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    },
  },
  "credentials.get": {
    kind: "credentials.get",
    publicKey: { rpId: "example.com", challenge: "Y2hhbGxlbmdl" },
  },
  // Phase 12 (Plan 12-04, deviation): popup -> background, no binary
  // fields -- `itemId: null` (explicit decline) round-trips through JSON
  // as `null`, not `undefined`, so it survives this gate identically to
  // the selection case.
  "provider.resolveChoice": {
    kind: "provider.resolveChoice",
    requestId: "req-1",
    itemId: "item-1",
  },
};

type ResponseFixtureMap = { [K in Message["kind"]]: MessageResponseMap[K] };

const UNLOCKED_STATUS: SessionStatus = {
  kind: "unlocked",
  autoLockMinutes: 15,
  accountEmail: "a@example.com",
  extPasskeyEnrolled: true,
  extPasskeyPromptSuppressed: false,
};

/**
 * One representative response-side fixture per `Message["kind"]`. Responses
 * cross the SAME JSON boundary in the opposite direction (background ->
 * popup) -- challenges/credential ids/PRF salts going popup-ward must be
 * JSON-safe too, not just the request side.
 *
 * `"vault.updated"`'s response type is `void` -- it is a fire-and-forget
 * broadcast that NEVER calls `sendResponse()`, so there is no real payload
 * to serialize on that path. `undefined` documents that intentionally; the
 * round-trip loop below skips it for that reason (JSON.stringify(undefined)
 * is not valid JSON text, so it can't go through JSON.parse at all).
 */
const RESPONSE_FIXTURES: ResponseFixtureMap = {
  "session.status": UNLOCKED_STATUS,
  "session.setAutoLockMinutes": { ok: true },
  "unlock.password": { ok: true },
  "auth.signIn.password": { ok: true },
  "vault.list": {
    items: [],
    folders: [{ id: "f1", name: "Folder" }],
  },
  "vault.updated": undefined,
  "session.locked": undefined,
  "extPasskey.enroll.start": {
    ok: true,
    accountEmail: "a@example.com",
    userHandleB64: btoa("user-handle-bytes"),
    challengeB64: btoa("challenge-bytes"),
    prfSaltB64: btoa("salt-bytes"),
  },
  "extPasskey.enroll.finish": { ok: true },
  "extPasskey.suppressPrompt": { ok: true },
  "unlock.extPrf.start": { credentialIdB64url: "cred-id-b64url", prfSaltB64: btoa("salt-bytes") },
  "unlock.extPrf.finish": { ok: true },
  "config.get": { baseUrl: "https://vault.example.com" },
  "config.set": { ok: true },
  "autofill.match": {
    pageState: "ok",
    origin: "https://example.com",
    detected: { login: true, totp: false, card: false, identity: false },
    matches: [
      { itemId: "item-1", kind: "login", label: "Example", maskedHint: "j***@example.com" },
    ],
  },
  "autofill.fill": { ok: true },
  "autofill.totpCode": { ok: true, code: "123456", secondsRemaining: 17 },
  "autofill.matchFrame": {
    pageState: "ok",
    origin: "https://example.com",
    detected: { login: true, totp: false, card: false, identity: false },
    matches: [
      { itemId: "item-1", kind: "login", label: "Example", maskedHint: "j***@example.com" },
    ],
  },
  "autofill.fillFrame": { ok: true },
  "generate-request": { password: "correct-horse-battery-staple" },
  "capture.propose": {
    action: "new",
    frameOrigin: "https://example.com",
    topOrigin: "https://example.com",
    mismatch: false,
  },
  "capture.confirm": { status: "ok", item: { id: "item-1", revision: 2 } },
  "credentials.create": {
    fallthrough: false,
    credentialResponseJson: '{"id":"cred-1","type":"public-key"}',
    prfCapable: true,
  },
  "credentials.get": {
    fallthrough: false,
    credentialResponseJson: '{"id":"cred-1","type":"public-key"}',
  },
  "provider.resolveChoice": { ok: true },
};

describe("Message JSON-transport safety (Chrome MV3 sendMessage stand-in)", () => {
  for (const [kind, fixture] of Object.entries(MESSAGE_FIXTURES)) {
    it(`${kind}: request survives JSON.parse(JSON.stringify(...)) with deep equality`, () => {
      const roundTripped: unknown = JSON.parse(JSON.stringify(fixture));
      expect(roundTripped).toEqual(fixture);
    });
  }
});

describe("MessageResponseMap JSON-transport safety (background -> popup direction)", () => {
  for (const [kind, fixture] of Object.entries(RESPONSE_FIXTURES)) {
    if (fixture === undefined) {
      it(`${kind}: void response -- no payload ever crosses sendResponse(), nothing to round-trip`, () => {
        expect(fixture).toBeUndefined();
      });
      continue;
    }
    it(`${kind}: response survives JSON.parse(JSON.stringify(...)) with deep equality`, () => {
      const roundTripped: unknown = JSON.parse(JSON.stringify(fixture));
      expect(roundTripped).toEqual(fixture);
    });
  }
});
