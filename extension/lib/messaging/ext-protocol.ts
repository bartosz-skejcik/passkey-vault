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
// Phase 10 (Plan 10-01) adds `autofill.match`/`autofill.fill`/
// `autofill.totpCode` -- the popup-driven autofill contract. Per this
// plan's architecture_note: the transport is popup-driven, NOT
// content-driven (content-relay never sends these; it only answers
// `content.detect`/`content.fill` from the background, defined in
// lib/autofill/types.ts, a SEPARATE channel). `autofill.match` deliberately
// carries no origin field -- the background resolves the active tab itself
// via entrypoints/background/frame-guard.ts's resolveFillTarget(), so
// there is nothing here for a caller to spoof (T-10-02). Handlers are
// wired up by Plan 10-04; this plan only extends the typed contract.
//
// Plan 10-09 adds `autofill.matchFrame`/`autofill.fillFrame` -- the
// CONTENT-SCRIPT-driven counterpart to `autofill.match`/`autofill.fill`
// above (the in-page overlay Plan 10-10 builds on top of). These two kinds
// are additive members of the SAME `Message` union (do not restructure),
// but they are dispatched by a SEPARATE `browser.runtime.onMessage`
// listener -- `registerAutofillFrameChannel()` in
// entrypoints/background/router.ts -- not by this file's popup-facing
// `handle()`. The popup router's WR-01 sender-origin gate (which refuses
// every content-script sender) stays completely unchanged; a page's
// content script reaches ONLY `handleMatchFrame`/`handleFillFrame`
// (entrypoints/background/autofill-frame.ts), never `session.*`/`vault.*`.
// `autofill.matchFrame` carries the caller's OWN `detected` map (computed
// locally, no `content.detect` round-trip needed) but deliberately NO
// origin field -- the background derives the origin from the platform-
// provided `sender` (`originFromContentSender()`), exactly the same
// no-spoofable-origin-field pattern `autofill.match` already uses for the
// popup-driven tab-derived origin. `autofill.fillFrame` reuses
// `autofill.fill`'s exact value-free response shape.
//
// Phase 11 (Plan 11-01) adds `generate-request`/`capture.propose`/
// `capture.confirm` -- TYPES ONLY here, no handler logic (that is Task 3 of
// this plan for `generate-request`; Plans 11-03/11-05 for `capture.*`).
// All three are CONTENT-SCRIPT-driven, exactly like `autofill.matchFrame`/
// `autofill.fillFrame` above -- dispatched by the SAME SEPARATE
// `registerAutofillFrameChannel()` listener in router.ts, never by this
// file's popup-facing `handle()`/`isProtocolMessage()`. `generate-request`
// deliberately mirrors `autofill.matchFrame`'s "no origin field" shape --
// the generator has no origin-scoped state to protect, so there is nothing
// for a caller to spoof. `capture.propose`/`capture.confirm` DO carry a
// `frameOrigin` field (unlike the autofill kinds) because the capture flow
// needs to compare the CLAIMED submit-time frame origin against the
// SENDER's own origin (assertContentSender-derived) to detect a
// cross-frame mismatch (`mismatch: boolean` on the `capture.propose`
// response) -- the field is compared against, never trusted blindly, by
// the handlers Plan 11-03 adds.
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
import type { CreateRpcResponse, GetRpcResponse } from "../../entrypoints/background/provider-ceremony";
import type { Folder, VaultItem } from "../vault/types";
import type { AutofillMatch, DetectedFields, FillKind } from "../autofill/types";

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
  | { kind: "config.set"; rawUrl: string }
  // Phase 10 (Plan 10-01): popup-driven autofill. `autofill.match` carries
  // no origin (see header comment) -- the background derives the active
  // tab's origin itself. `autofill.fill` deliberately carries NO field
  // values in its response -- plaintext flows background -> content-relay
  // only, never through the popup (D-02). The fill-kind field is named
  // `kind_` (not `kind`) because `kind` is already this union's own
  // discriminant; do not rename it and do not add a second name for the
  // same concept.
  | { kind: "autofill.match" }
  | { kind: "autofill.fill"; itemId: string; kind_: FillKind }
  // The ONE sanctioned path where a derived-from-secret value reaches the
  // popup: 10-UI-SPEC.md's "Kopiuj kod" clipboard-write action runs in the
  // popup context. Returns the derived code only, never the raw TOTP seed.
  | { kind: "autofill.totpCode"; itemId: string }
  // Phase 10 (Plan 10-09): content-script -> background, dispatched by the
  // SEPARATE registerAutofillFrameChannel() listener (see header comment).
  // No origin field on either -- the background derives it from the
  // platform-provided sender, never from this payload.
  | { kind: "autofill.matchFrame"; detected: DetectedFields }
  | { kind: "autofill.fillFrame"; itemId: string; kind_: FillKind }
  // Phase 11 (Plan 11-01): content-script -> background, dispatched by the
  // SAME SEPARATE registerAutofillFrameChannel() listener as the
  // autofill.*Frame kinds above (see header comment). No origin field --
  // the generator has nothing origin-scoped to protect.
  | {
      kind: "generate-request";
      mode: "character";
      length: number;
      opts: GenerateCharacterOptions;
    }
  | { kind: "generate-request"; mode: "passphrase"; wordCount: number; separator?: string }
  // Phase 11 (Plan 11-01, types only -- handlers land in Plan 11-03):
  // content-script -> background, proposing a just-submitted signup/login
  // credential for capture. `frameOrigin` is the CLAIMED origin from the
  // submitting frame; the handler compares it against the SENDER's own
  // origin (assertContentSender-derived, never trusted from this field
  // alone) to compute the response's `mismatch` flag.
  | { kind: "capture.propose"; frameOrigin: string; username: string; password: string }
  // Confirms (or overrides) the proposed capture after the user's explicit
  // choice in the capture UI (Plan 11-04/11-05) -- carries the same
  // frameOrigin/username/password plus the resolved action and, for an
  // `'update'`, the target item's id/currentRevision (optimistic-concurrency
  // guard against a stale revision, mirrors vault.list's revision field).
  | {
      kind: "capture.confirm";
      action: "new" | "update";
      frameOrigin: string;
      username: string;
      password: string;
      itemId?: string;
      currentRevision?: number;
    }
  // Phase 12 (Plan 12-02): content-script -> background, dispatched by the
  // SAME SEPARATE registerAutofillFrameChannel() listener as
  // autofill.*Frame/generate-request/capture.* above (see header comment).
  // No origin field, exactly like autofill.matchFrame/generate-request --
  // the origin is derived from assertContentSender(sender).origin, never
  // from a caller-supplied field (router.ts, Task 3). `publicKey` is the
  // RP's spec PublicKeyCredentialCreationOptionsJSON/
  // PublicKeyCredentialRequestOptionsJSON form -- content-relay.content.ts
  // (Plan 12-03) base64url-encodes every binary field before this ever
  // reaches the background (D-21); this thin typed-unknown boundary never
  // interprets the shape itself (12-PATTERNS.md), only
  // provider-ceremony.ts (Task 2) does.
  | { kind: "credentials.create"; publicKey: unknown }
  | { kind: "credentials.get"; publicKey: unknown }
  // Phase 12 (Plan 12-04, deviation -- see SUMMARY): popup -> background,
  // the multi-match credentials.get() picker's confirm/decline (D-11) AND
  // ProviderCeremonyView's dismissal-as-decline path. Unlike
  // credentials.create/credentials.get above, this is POPUP-driven (routed
  // through isProtocolMessage()/handle(), the WR-01-gated channel), not
  // content-frame-driven -- it is the ONLY way to unblock
  // provider-ceremony.ts's resolvePasskeyChoice() awaited Promise from
  // outside that module, since a background service-worker function cannot
  // be called directly from the popup's separate JS execution context.
  // `itemId: null` is an explicit decline.
  | { kind: "provider.resolveChoice"; requestId: string; itemId: string | null }
  // Plan 13-06: Firefox (or Chrome) passkey unlock via a server-origin PRF
  // ceremony relayed through content-relay.content.ts (13-FF-WEBAUTHN-
  // RESEARCH.md option 1). `unlock.serverCeremony.start` is popup-driven
  // (this router's ordinary WR-01-gated channel, mirrors
  // `unlock.extPrf.start`'s shape) -- background/server-unlock.ts mints a
  // single-use nonce and opens the ceremony window; it carries no fields,
  // the guard (server configured + session locked) runs entirely
  // background-side. `unlock.serverCeremony.relay` is content-script ->
  // background, dispatched by the SAME SEPARATE
  // registerAutofillFrameChannel() listener as credentials.create/get
  // above (T-13-14: the result must ride the content-frame guarded channel,
  // never the popup-gated one) -- `nonce`/`prfB64`/`prfWrappedUk` are the
  // ONLY things that ever cross this hop; the raw User Key never does
  // (T-13-12, unwrapped exclusively in server-unlock.ts). PRF output is a
  // base64url STRING here (D-21) -- content-relay.content.ts encodes the
  // real ArrayBuffer it received via postMessage before this sendMessage
  // hop, mirroring the provider bridge's own base64url boundary.
  // `unlock.serverCeremony.state` is a FIRE-AND-FORGET broadcast FROM the
  // background (mirrors `session.locked`'s shape/discipline) -- deliberately
  // NOT one of `isProtocolMessage()`'s accepted kinds in router.ts, for the
  // exact same reason `session.locked`/`vault.updated` aren't: it is never
  // dispatched TO `handle()`, only listened for by the popup's own
  // `browser.runtime.onMessage` listener.
  | { kind: "unlock.serverCeremony.start" }
  | { kind: "unlock.serverCeremony.relay"; nonce: string; prfB64: string; prfWrappedUk: string }
  | { kind: "unlock.serverCeremony.state"; ok: boolean }
  // quick-260717: NordPass-style last-used tracking. ItemDetailView.tsx's
  // copy affordances decrypt/copy CLIENT-SIDE in the popup document (unlike
  // every autofill/ceremony touch-point above, which already runs in the
  // background) -- this is the ONE lightweight hop that lets the popup
  // signal "this item's secret was just used" without duplicating
  // vault-store.ts's touchVaultItem()/vault-api.ts's touchItem() fetch
  // logic in the popup bundle. Fire-and-forget from the popup's point of
  // view, exactly like `provider.resolveChoice` above -- the response is
  // always `{ ok: true }` regardless of whether the underlying network
  // touch actually succeeds (vault-store.ts's touchVaultItem() itself never
  // throws; see its own doc comment).
  | { kind: "vault.touch"; itemId: string };

/**
 * Phase 11 (Plan 11-01): the character-class selection shape shared by
 * `generate-request`'s `'character'` mode and
 * `extension/lib/generator/password.ts`'s `CharacterPasswordOptions`
 * (Task 2 of this plan) -- defined inline here rather than imported so this
 * file never depends on Task 2's not-yet-created module; Task 3 wires the
 * two together by passing this shape straight through to
 * `generateCharacterPassword`.
 */
export interface GenerateCharacterOptions {
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
}

/**
 * Response to `autofill.match` -- metadata only (item ids, labels, masked
 * hints), never field values or derived secrets. `pageState` distinguishes
 * a genuine "no matches" from a restricted page (`chrome://`, `file://`,
 * etc. -- see frame-guard.ts's resolveFillTarget()) or an unreachable
 * content-relay (not yet injected on this page), so the popup can render
 * three different empty states instead of one ambiguous one.
 */
export interface AutofillMatchResult {
  pageState: "ok" | "restricted" | "unreachable";
  origin: string | null;
  detected: DetectedFields;
  matches: AutofillMatch[];
}

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
  "config.set": { ok: true } | { ok: false; error: "invalid-url" | "unreachable" | "cors-blocked" };
  "autofill.match": AutofillMatchResult;
  "autofill.fill":
    | { ok: true }
    | { ok: false; reason: "no-match" | "origin-mismatch" | "target-unreachable" | "locked" };
  "autofill.totpCode":
    | { ok: true; code: string; secondsRemaining: number }
    | { ok: false; reason: string };
  // Phase 10 (Plan 10-09): same response shapes as their popup-driven
  // counterparts above -- metadata-only match, value-free fill.
  "autofill.matchFrame": AutofillMatchResult;
  "autofill.fillFrame":
    | { ok: true }
    | { ok: false; reason: "no-match" | "origin-mismatch" | "target-unreachable" | "locked" };
  // Phase 11 (Plan 11-01): the generated password/passphrase, produced
  // exclusively by the background's ported v0.1 generator (Task 2) --
  // never by a local reimplementation in the content script (D-01/D-03).
  "generate-request": { password: string } | { error: string };
  // Phase 11 (Plan 11-01, types only): `mismatch` flags a claimed
  // `frameOrigin` that disagrees with the sender's own resolved origin
  // (Plan 11-03's handler computes this); `topOrigin` is the resolved
  // top-level frame's origin, distinct from `frameOrigin` for an
  // iframe-hosted login form.
  "capture.propose": {
    action: "new" | "update" | "no-op";
    itemId?: string;
    currentRevision?: number;
    frameOrigin: string;
    topOrigin: string;
    mismatch: boolean;
  };
  "capture.confirm": {
    status: "ok" | "conflict" | "error";
    item?: { id: string; revision: number };
    message?: string;
  };
  // Phase 12 (Plan 12-02): response shapes are provider-ceremony.ts's OWN
  // CreateRpcResponse/GetRpcResponse types (type-only import, mirrors this
  // file's existing UnlockResult/ExtEnrollStartResult precedent) -- never
  // redefined here, so the wire contract and the orchestration function's
  // return type can never drift apart.
  "credentials.create": CreateRpcResponse;
  "credentials.get": GetRpcResponse;
  // Phase 12 (Plan 12-04, deviation): fire-and-forget from the popup's
  // point of view -- resolveProviderCredentialChoice() itself returns
  // void, so this is always a simple ack.
  "provider.resolveChoice": { ok: true };
  // quick-260717: always `{ ok: true }` -- see the Message union's own
  // doc comment above for why this never surfaces a failure to the popup.
  "vault.touch": { ok: true };
  // Plan 13-06: see the Message union's own doc comment above for the full
  // rationale on all three of these.
  "unlock.serverCeremony.start":
    | { ok: true }
    | { ok: false; error: "no-server-configured" | "not-locked" | "unknown" };
  "unlock.serverCeremony.relay":
    | { ok: true }
    | { ok: false; error: "forbidden-sender" | "forbidden-origin" | "invalid-nonce" | "expired" | "unwrap-failed" | "unknown" };
  "unlock.serverCeremony.state": void;
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
