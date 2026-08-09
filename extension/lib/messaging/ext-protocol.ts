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
// rpId Chrome accepts from this origin). That extension-scoped path was
// ITSELF hard-removed in AUTH-03 (Plan 15-04): the server-origin ceremony
// window (`unlock.serverCeremony.*` below, background/server-unlock.ts) is
// now the sole passkey unlock/sign-in mechanism on both browsers. Keeping
// either dead pair only widens isProtocolMessage's accepted surface and
// invites a future caller to reintroduce a bug no UAT could see.
//
// This union grows across Waves 3-5: 09-04 adds `unlock.*` (the unlock-only
// pair requires an existing token), 09-05 adds `vault.list` (request/
// response, dispatched by router.ts) and `vault.updated` (fire-and-forget
// broadcast from vault-store.ts's lock-state subscription -- NOT dispatched
// by router.ts's switch; it exists here purely so a future popup listener
// can type-check against the same union). 09-06 adds `config.get`/
// `config.set`, delegating to server-config.ts (Plan 09-03). Each later
// plan ADDS a union member here plus a matching `MessageResponseMap`
// entry — this file's overall shape (discriminated union + response map +
// typed sendMessage helper) never gets restructured. (09-08's
// `auth.signIn.*` kind and the extension-scoped-PRF message kinds were
// removed in AUTH-03/Plan 15-04 -- their exact former literal names are
// intentionally not repeated here, see Plan 15-06's permanent
// no-ext-scoped-prf-strings.test.ts guard.)
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
// `UnlockResult` is `import type`-only from entrypoints/background/unlock.ts
// (its canonical definition, per that plan's own export surface) — erased
// at compile time, so this file (and any popup that imports it) never
// bundles background-only runtime code, only the type shape.
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
import type { CreateRpcResponse, GetRpcResponse } from "../../entrypoints/background/provider-ceremony";
import type { Folder, VaultItem } from "../vault/types";
import type { AutofillMatch, DetectedFields, FillKind } from "../autofill/types";
// 27-04 (Task 1): the popup's SOLE, message-based route to a decrypted
// collection name (D-05's boundary -- the popup never imports a background/
// WASM-adjacent module itself). Type-only import, mirrors this file's
// existing UnlockResult/CreateRpcResponse precedent.
import type { Collection } from "../../entrypoints/background/collections-store";
// 27-12 (Blocker 1 gap closure): same D-05 boundary rationale as the
// Collection import above -- the popup never imports a background/WASM-
// adjacent module for its VALUE, only its type.
import type { PendingSharedItemEntry } from "../../entrypoints/background/vault-store";

export type SessionStatus =
  | { kind: "no-session" }
  | {
      kind: "locked";
      wasAutoLocked: boolean;
      autoLockMinutes: number;
    }
  | {
      kind: "unlocked";
      autoLockMinutes: number;
      accountEmail: string;
    };

export type Message =
  | { kind: "session.status" }
  | { kind: "session.setAutoLockMinutes"; minutes: number }
  // Unlock-only — existing token, SessionUser-gated server routes. (The
  // popup-dispatched sign-in counterpart, `auth.signIn.password`, was
  // hard-removed in AUTH-03/Plan 15-04 -- sign-in now goes exclusively
  // through `unlock.serverCeremony.start` mode:"signin" below; the
  // underlying `handleUnlockPassword` sign-in branch survives only as an
  // internal target server-unlock.ts's `completeServerUnlock` calls.)
  | { kind: "unlock.password"; passwordB64: string }
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
  // 09-06: the popup's server-URL configuration screen (EXT-05) and the
  // "open full vault" / header redirect controls' sole source of the
  // configured pv-server origin -- delegates directly to server-config.ts
  // (Plan 09-03)'s readServerConfig()/configureServer().
  | { kind: "config.get" }
  | { kind: "config.set"; rawUrl: string }
  // Plan 15-05 (AUTH-04): a PERSIST-FREE sibling of `config.set` -- thin
  // wrapper over server-config.ts's already-exported
  // `probeServerHealthDetailed()`, reusing `config.set`'s exact error union
  // minus the persist side effect. Exists so ServerConfigView can validate
  // the NEW server is reachable BEFORE touching storage, keeping the OLD
  // config live for the sign-out-old-session step that must run first
  // (Pitfall 1, 15-RESEARCH.md -- persisting the new URL before tearing
  // down the old session would make logout()'s apiFetch hit the WRONG
  // server).
  | { kind: "config.probe"; rawUrl: string }
  // Plan 15-05 (AUTH-04): fire-and-forget-style full sign-out, delegating
  // to Plan 15-02's `signOutVaultSession()` (composes lockVaultSession() ->
  // best-effort server logout() -> unconditional clearSessionMeta()).
  // Always `{ok:true}` -- signOutVaultSession() never throws by design
  // (mirrors `provider.resolveChoice`'s always-ok:true shape). Falls under
  // the EXISTING WR-01 `assertPopupSender()` gate automatically via the
  // `"session."` prefix check -- no change to that gate's own code.
  | { kind: "session.signOut" }
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
  // (this router's ordinary WR-01-gated channel) -- background/server-unlock.ts mints a
  // single-use nonce and opens the ceremony window; the guard (server
  // configured + session precondition, which DIFFERS per mode -- see
  // server-unlock.ts) runs entirely background-side. `unlock.serverCeremony.relay`
  // is content-script -> background, dispatched by the SAME SEPARATE
  // registerAutofillFrameChannel() listener as credentials.create/get
  // above (T-13-14: the result must ride the content-frame guarded channel,
  // never the popup-gated one) -- `nonce`/`prfB64`/`prfWrappedUk` are the
  // ONLY things that ever cross this hop for the UNLOCK mode; the raw User
  // Key never does (T-13-12, unwrapped exclusively in server-unlock.ts).
  // PRF output is a base64url STRING here (D-21) -- content-relay.content.ts
  // encodes the real ArrayBuffer it received via postMessage before this
  // sendMessage hop, mirroring the provider bridge's own base64url boundary.
  // `unlock.serverCeremony.state` is a FIRE-AND-FORGET broadcast FROM the
  // background (mirrors `session.locked`'s shape/discipline) -- deliberately
  // NOT one of `isProtocolMessage()`'s accepted kinds in router.ts, for the
  // exact same reason `session.locked`/`vault.updated` aren't: it is never
  // dispatched TO `handle()`, only listened for by the popup's own
  // `browser.runtime.onMessage` listener.
  //
  // Plan 13-07 (Bartek mandate, full SIGN-IN, not just unlock): `mode` is
  // now REQUIRED on `unlock.serverCeremony.start` -- minted by the popup
  // (which already knows whether it's rendering the sign-in or the
  // locked-unlock variant, `session.status`'s own `kind` discriminant), but
  // the AUTHORITATIVE mode lives in the background's pending record
  // (server-unlock.ts's `startServerUnlock`), never trusted from a later
  // payload. `token`/`accountEmail` on `unlock.serverCeremony.relay` are
  // OPTIONAL and ONLY meaningful for `mode: 'signin'` -- `token` is the
  // server's opaque session-token STRING (already base64, but treated as an
  // OPAQUE bearer value never decoded client-side, exactly like
  // `auth.signIn.password`'s own `session_token` handling in unlock.ts --
  // no additional encoding boundary applies to it, unlike the PRF
  // ArrayBuffer field). `accountEmail` is the email the bridge's own
  // prelogin used (passkeyLogin's prelogin identifies the user by email,
  // NOT a discoverable credential -- see web/src/lib/passkeys/login.ts).
  // `completeServerUnlock` REJECTS a `token`/`accountEmail` payload on an
  // `unlock`-mode nonce and REJECTS their absence on a `signin`-mode nonce
  // (T-13-16) -- `invalid-mode-payload` is that typed failure.
  | { kind: "unlock.serverCeremony.start"; mode: "signin" | "unlock" }
  // `failed: true` (Bartek live-UAT bug fix, .planning/debug/resolved/
  // signin-passkeyless-spin.md): ExtUnlockBridge's own explicit "this
  // ceremony reached a terminal, calmly-explained failure state" notice --
  // `prfB64`/`prfWrappedUk` are absent on this shape (nothing to relay);
  // completeServerUnlock's own `failed` branch resolves the pending record
  // + broadcasts ok:false immediately, instead of only ever being reached
  // via the 120s CEREMONY_TIMEOUT_MS alarm (T-13-13).
  | {
      kind: "unlock.serverCeremony.relay";
      nonce: string;
      failed: true;
    }
  | {
      kind: "unlock.serverCeremony.relay";
      nonce: string;
      failed?: false;
      prfB64: string;
      prfWrappedUk: string;
      token?: string;
      accountEmail?: string;
    }
  // Plan 15-01: the master-password sign-in path through the SAME ceremony
  // window (AMENDMENT, 15-CONTEXT.md -- mode:'signin' offers BOTH passkey
  // AND password). Mutually exclusive with the PRF-shaped variant above --
  // this shape carries none of prfB64/prfWrappedUk/token/accountEmail.
  // `passwordB64` is STANDARD base64 (b64ToBytes convention, NOT base64url
  // -- matches unlock.password's own passwordB64 field, unlike the PRF
  // field's base64url D-21 convention), decoded background-side and handed
  // straight to unlock.ts's handleUnlockPassword -- this relay never
  // touches WASM/pv-core itself (D-05).
  | {
      kind: "unlock.serverCeremony.relay";
      nonce: string;
      failed?: false;
      passwordB64: string;
      email: string;
    }
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
  // 27-04 (Task 1): `pending` is vault-store.ts's getPendingSharedItems()
  // stub list (a shared row this caller has access to but could not be
  // decrypted yet/at all this pass -- never simply absent with no trace,
  // see that function's own doc comment); `collections` is
  // collections-store.ts's getCollections() -- the popup's sole route to a
  // decrypted collection name for a given collectionId (D-05).
  // 27-12 (Blocker 1 gap closure): `pending`'s entries now carry
  // PendingSharedItemEntry's `status: "pending" | "broken"` discriminant --
  // the popup's route to distinguishing a transient MV3-wake race from a
  // genuinely broken shared row (UI-SPEC E2-error backstop).
  "vault.list": {
    items: VaultItem[];
    folders: Folder[];
    pending: PendingSharedItemEntry[];
    collections: Collection[];
  };
  "vault.updated": void;
  "session.locked": void;
  "config.get": { baseUrl: string } | null;
  "config.set": { ok: true } | { ok: false; error: "invalid-url" | "unreachable" | "cors-blocked" };
  // Plan 15-05: identical error union to config.set, minus persistence --
  // see the Message union's own doc comment above.
  "config.probe": { ok: true } | { ok: false; error: "invalid-url" | "unreachable" | "cors-blocked" };
  // Plan 15-05: see the Message union's own doc comment above for why this
  // is always ok:true.
  "session.signOut": { ok: true };
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
    // 28-01-PLAN.md Task 1 (B-4/B-10, closes v0.4 audit Blocker 2/Warning
    // 1): set only for `action:"update"`, computed by classifySubmit's
    // SAME predicate confirmUpdateLogin's gate enforces -- announces a
    // write that WILL be refused BEFORE the toast ever offers an Update
    // button, rather than surfacing a generic post-confirm failure
    // (28-UI-SPEC.md's "suppressed, not failed").
    blockedReason?: "direct-share" | "no-edit-access";
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
  // Plan 13-06/13-07: see the Message union's own doc comment above for the
  // full rationale on all three of these. `already-signed-in` (13-07) is
  // `mode:'signin'`'s own precondition failure -- mirrors `not-locked`
  // being `mode:'unlock'`'s. `invalid-mode-payload` (13-07, T-13-16) is the
  // mode-pinning rejection: an `unlock`-mode nonce carrying a `token` field,
  // or a `signin`-mode nonce missing one. `unlock.serverCeremony.relay`'s
  // OWN `already-signed-in` (WR-01(rev2), 13-REVIEW-2.md) is the COMPLETE-time
  // twin of `unlock.serverCeremony.start`'s START-time precondition above --
  // a session established between start and completion (e.g. a concurrent
  // password sign-in) makes completeServerUnlock's signin branch re-check
  // readSessionMeta() and refuse to clobber it, rather than trusting the
  // start-time guard alone.
  "unlock.serverCeremony.start":
    | { ok: true }
    | { ok: false; error: "no-server-configured" | "not-locked" | "already-signed-in" | "unknown" };
  "unlock.serverCeremony.relay":
    | { ok: true }
    | {
        ok: false;
        error:
          | "forbidden-sender"
          | "forbidden-origin"
          | "invalid-nonce"
          | "expired"
          | "invalid-mode-payload"
          | "already-signed-in"
          | "ceremony-failed"
          | "unwrap-failed"
          // Plan 15-01: the password-branch's own wrong-password outcome
          // (handleUnlockPassword's own "invalid-credentials", distinct
          // from unwrap-failed which covers the PRF branch's blob/key
          // mismatch and any other password-branch failure).
          | "invalid-credentials"
          | "unknown";
      };
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
