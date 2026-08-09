// entrypoints/background/provider-ceremony.ts — Plan 12-02's "server" tier
// of the extension's passkey provider: `handleCredentialsCreate`/
// `handleCredentialsGet` orchestrate a `credentials.create`/`credentials.get`
// ceremony arriving from `content-relay.content.ts` (Plan 12-03) over the
// content-frame channel (router.ts, Task 3). This is the ONE place Plan
// 12-01's `wasmCreateProviderCredential`/`wasmGetProviderAssertion` bindings
// are called (D-05) and the ONE place the unlocked User Key is read for a
// provider ceremony.
//
// Pure orchestration + no framework state (12-PATTERNS.md's "pure
// orchestration function" convention, mirrors web/src/lib/passkeys/
// enroll.ts/login.ts): both handlers are plain async functions taking a
// typed request + the SENDER-VERIFIED origin string (never a caller-
// supplied origin field -- router.ts, Task 3, always passes
// `assertContentSender(sender).origin`). `CreateRpcRequest`/`GetRpcRequest`/
// `CreateRpcResponse`/`GetRpcResponse` are this module's OWN types (not
// ext-protocol.ts's) -- ext-protocol.ts (Task 3) type-only imports the
// response shapes from here, mirroring its existing precedent of importing
// `UnlockResult`/`ExtEnrollStartResult` from their owning background
// modules. This keeps the wire-message layer a thin typed-`unknown`
// boundary (12-PATTERNS.md) and this file the one place WebAuthn JSON is
// actually interpreted.
//
// D-10 (fresh re-check every invocation): every handler calls
// `ensureHydrated()` at the START of its own body -- never a module-level
// cached flag -- so a fresh/idle-killed service worker always re-derives
// the current lock state before doing anything.
//
// D-09 (locked -> open popup, await unlock, never fail outright): if
// `ensureHydrated()` resolves null, `openPopupAndAwaitUnlock()` attempts
// `browser.action.openPopup()`, falls back to `browser.windows.create()`,
// and awaits `vault-session.ts`'s lock-state subscription reporting an
// unlock (`waitForUnlock`) -- `null` on abandonment (WR-03 below), never a
// hung promise.
//
// Decision A (Bartek, 2026-07-16, 12-05-PLAN.md): EVERY ceremony -- create(),
// single-match get(), AND multi-match get() -- now awaits an EXPLICIT popup
// confirm via `awaitCeremonyConsent` before minting/persisting a passkey or
// signing an assertion. There is no silent-on-unlocked-vault path left: the
// prior scope (12-04-SUMMARY's "Scope Clarification #3") only gated the
// multi-match picker; create()/single-match get() proceeded immediately
// once the vault was unlocked. `awaitCeremonyConsent` writes ONE unified
// payload shape (`{requestId, kind, rpId, account?, prfRequested,
// candidates}`) to `chrome.storage.session` regardless of kind -- App.tsx
// mounts `ProviderCeremonyView` for all three (create/single-get/multi-get)
// off this single shape now, not just the multi-match picker.
//
// WR-04 fix (12-REVIEW.md): the prior locked-vault path wrote a dead
// boolean (`{ [PENDING_CEREMONY_KEY]: true }`) that nothing ever read and
// that was never cleared -- removed entirely. `openPopupAndAwaitUnlock`
// only opens the popup and waits for unlock now; the SAME popup naturally
// transitions from `UnlockView` to `ProviderCeremonyView` once
// `awaitCeremonyConsent` writes the real payload right after unlock
// resolves, so there is exactly ONE object shape ever written to this key.
//
// CR-03 fix (12-REVIEW.md, orphan-credential half): `handleCredentialsCreate`
// NEVER calls `wasmCreateProviderCredential`/persists anything until
// `awaitCeremonyConsent` resolves to an explicit confirm -- a decline OR an
// abandoned/timed-out ceremony (WR-03) returns `{ fallthrough: true }`
// before the WASM binding is ever invoked, so a page that already gave up
// can never end up with a vault/server credential it never received.
//
// WR-03 fix (12-REVIEW.md): both `waitForUnlock` (locked-vault wait) and
// `awaitCeremonyConsent` (the popup consent await) are bounded by
// `CEREMONY_ABANDON_TIMEOUT_MS` -- if the user closes the popup without an
// explicit decline ever reaching `resolveProviderCredentialChoice`, the
// promise still resolves (to `null`/abandon), `unsubscribe()` is called,
// and `PENDING_CEREMONY_KEY` is removed -- no permanently-leaked
// `subscribeSessionLockState` listener or stale storage key. Mirrors
// CR-03's page-side 120s backstop (page-bridge.content.ts/
// page-bridge-firefox.ts) -- same ceiling, same "genuinely stuck ceremony"
// semantics.
//
// D-11/PROV-03 (never dead-end): every exported handler wraps its ENTIRE
// body in try/catch -- any exception (including from the WASM bindings)
// becomes `{ fallthrough: false, failed: true }`, never an uncaught throw
// or a hung promise. Zero matches on `credentials.get` short-circuits to
// `{ fallthrough: true }` before any WASM call.
//
// D-16 (PRF capability-driven, never browser-sniff): `derivePrfCapability`
// reads `clientExtensionResults.prf.enabled` from the REAL
// `credential_response_json` passkey-rs produced -- the RP's own `prf`
// extension request is the only trigger for reporting this field at all;
// there is no user-agent/browser-detection code path anywhere in this file.
//
// D-19 (pendingProviderItems holds ciphertext directly): the newly-created
// credential's `encrypted_item_json` (already an `EncryptedItem` under the
// User Key, Plan 12-01) is written to `chrome.storage.session` verbatim --
// no ephemeral re-wrap -- then asynchronously persisted via the EXACT
// capture-handler.ts write path (`splitCombinedEncryptedItem` ->
// `createItem`), and cleared once that succeeds. `retryPendingProviderItems`
// re-attempts any still-pending entries (D-10's "possibly just-woken"
// discipline applied to this write path).
import { browser } from "wxt/browser";
import { ensureHydrated, subscribeSessionLockState } from "./vault-session";
import {
  ensureItemsHydrated,
  ensureSharedItemsHydrated,
  getItems,
  splitCombinedEncryptedItem,
  touchVaultItem,
} from "./vault-store";
import { createItem, updateItem } from "./vault-api";
import { findMatchingPasskeyItems } from "./credential-store";
import { getCollectionKey, getCollections } from "./collections-store";
import { CEREMONY_ABANDON_TIMEOUT_MS } from "../../lib/messaging/ceremony-timeouts";
import { readServerConfig } from "./server-config";
import {
  encryptItem,
  decryptItem,
  encryptItemForCollection,
  wasmCreateProviderCredential,
  wasmGetProviderAssertion,
  type WasmUserKey,
} from "../../lib/crypto/wasm-loader";
import { centeredWindowPosition, type WindowGeometry } from "../../lib/window-geometry";

/**
 * Defense-in-depth (Bartek live-UAT bug follow-up, .planning/debug/resolved/
 * signin-passkeyless-spin.md): content-relay.content.ts's own
 * isConfiguredServerOrigin() check is the PRIMARY refusal -- it never even
 * forwards a configured-server-origin ceremony to the background at all.
 * This is the SECOND, independent layer: if a request somehow still
 * reaches here with `senderOrigin` equal to the user's own configured
 * pv-server origin (a future content-relay regression, a different/older
 * content-relay build, or any other path this file cannot anticipate),
 * both provider handlers refuse it too, mirroring
 * server-unlock.ts's completeServerUnlock's identical
 * `new URL(config.baseUrl).origin !== callerOrigin` comparison style.
 * Fails CLOSED to "not the configured origin" (never suppress based on a
 * guess) on no config / an unparseable baseUrl, exactly like
 * content-relay's own isConfiguredServerOrigin().
 */
async function isConfiguredServerOrigin(senderOrigin: string): Promise<boolean> {
  const config = await readServerConfig();
  if (config === null) {
    return false;
  }
  try {
    return new URL(config.baseUrl).origin === senderOrigin;
  } catch {
    return false;
  }
}

/** Thin typed-`unknown` boundary (12-PATTERNS.md) -- `publicKey` is the RP's
 * spec `PublicKeyCredentialCreationOptionsJSON`/`PublicKeyCredentialRequestOptionsJSON`
 * form (content-relay.content.ts, Plan 12-03, base64url-encodes every
 * binary field before this ever reaches the background, D-21). Real
 * interpretation of its shape happens in this file only. */
export interface CreateRpcRequest {
  publicKey: unknown;
}

export interface GetRpcRequest {
  publicKey: unknown;
}

export interface CreateRpcResponse {
  fallthrough: boolean;
  failed?: boolean;
  credentialResponseJson?: string;
  prfCapable?: boolean;
  prfUnavailableReason?: string;
}

export interface GetRpcResponse {
  fallthrough: boolean;
  failed?: boolean;
  credentialResponseJson?: string;
}

// --- Pending-ceremony (D-09) / pending-provider-item (D-19) storage -------

const PENDING_CEREMONY_KEY = "pv-pending-provider-ceremony";
const PENDING_PROVIDER_ITEMS_KEY = "pv-pending-provider-items";

interface PendingProviderItemsMap {
  [itemId: string]: string; // encrypted_item_json ciphertext (D-19)
}

function isPendingProviderItemsMap(value: unknown): value is PendingProviderItemsMap {
  return typeof value === "object" && value !== null;
}

async function readPendingProviderItems(): Promise<PendingProviderItemsMap> {
  const result = await browser.storage.session.get(PENDING_PROVIDER_ITEMS_KEY);
  const value = (result as Record<string, unknown>)[PENDING_PROVIDER_ITEMS_KEY];
  return isPendingProviderItemsMap(value) ? value : {};
}

async function writePendingProviderItem(itemId: string, encryptedItemJson: string): Promise<void> {
  const pending = await readPendingProviderItems();
  pending[itemId] = encryptedItemJson;
  await browser.storage.session.set({ [PENDING_PROVIDER_ITEMS_KEY]: pending });
}

async function clearPendingProviderItem(itemId: string): Promise<void> {
  const pending = await readPendingProviderItems();
  delete pending[itemId];
  await browser.storage.session.set({ [PENDING_PROVIDER_ITEMS_KEY]: pending });
}

/** Fire-and-forget: converts the wasm-produced ciphertext into the server's
 * two-column wire shape via vault-store.ts's OWN `splitCombinedEncryptedItem`
 * (the exact function capture-handler.ts's confirmNewLogin already proved
 * correct for this exact encryptItem -> split -> createItem shape) and
 * clears the pending entry once persisted. A failure here is logged, not
 * thrown -- the ceremony already responded to the page; `
 * retryPendingProviderItems` (D-10) is what re-attempts it later. */
async function persistPendingProviderItem(itemId: string, encryptedItemJson: string): Promise<void> {
  try {
    const { encKey, encData } = splitCombinedEncryptedItem(encryptedItemJson);
    await createItem(itemId, encKey, encData);
    await clearPendingProviderItem(itemId);
  } catch (e) {
    console.error(
      "[passkey-vault] failed to persist new provider credential (will retry on next wake)",
      e,
    );
  }
}

/** Fire-and-forget counterpart to `persistPendingProviderItem` for the
 * `credentials.get` sign-counter-mutation case (`updated_encrypted_item_json`,
 * Plan 12-01): the item already exists server-side, so this is an
 * `updateItem` PUT at `expectedRevision` (the item's CURRENT revision
 * before this ceremony), never a `createItem` POST -- mirrors
 * capture-handler.ts's `confirmUpdateLogin`'s `currentRevision`/
 * `newRevision = currentRevision + 1` discipline. Best-effort: a failure
 * here only means a stale sign counter server-side, never a broken
 * ceremony (the response already went to the page by the time this runs).
 *
 * 27-06 (T-27-14) COLLECTION-AWARE DISPATCH: `updatedEncryptedItemJson` is
 * ALWAYS produced by `wasm_get_provider_assertion`'s own internal
 * `core_encrypt_item(&uk.0, updated_json, item_id, revision + 1)` call
 * (crates/pv-wasm/src/lib.rs) -- that WASM binding has NO collection-key
 * accepting variant, so the ciphertext it hands back is unconditionally
 * User-Key-scoped regardless of the item's real storage scope. Persisting
 * it verbatim for a collection-scoped (shared) item would silently corrupt
 * that row for every other member the next time they try to decrypt it.
 * `collectionId === null` (personal item): persist `updatedEncryptedItemJson`
 * exactly as before this fix -- byte-identical behavior, zero change.
 * `collectionId !== null`: decrypt with the SAME `uk`/`itemId`/`revision+1`
 * the WASM binding used to PRODUCE this ciphertext (see
 * `wasm_get_provider_assertion`'s own math above), then re-encrypt the
 * recovered plaintext under the item's cached Collection Key via
 * `encryptItemForCollection` before ever calling `updateItem`. If the
 * Collection Key is not cached, log and return WITHOUT persisting -- fail
 * loud, never fall back to writing the wrong-scoped ciphertext.
 *
 * Per the EXT-10 spike (27-02): `updatedEncryptedItemJson` is `None`/dormant
 * for EVERY ceremony today (no signature counter is ever set) -- this
 * dispatch is defense-in-depth for ANY future field-mutation write-back,
 * not currently exercised by any live ceremony, and must NOT be read as
 * license to add per-item counter tracking (27-02's explicit anti-goal).
 *
 * 28-01-PLAN.md Task 3 (B-6, closes v0.4 audit Warning 3): `sharedToMe` is
 * checked FIRST, before the `collectionId === null` dispatch below -- the
 * IDENTICAL `collectionId === null` blind spot as Blocker 2
 * (capture-handler.ts's `confirmUpdateLogin`): a DIRECTLY-shared item also
 * has `collectionId: null`, so without this check it would silently fall
 * into the "personal item" branch and re-encrypt under the RECIPIENT's own
 * User Key -- permanently corrupting the owner's item, the exact failure
 * this phase exists to close. Fixed now while the shape is fresh, even
 * though `updatedEncryptedItemJson` is always `None` today (dormant, per
 * the EXT-10 spike above) -- a dormant wrong-key write is still a
 * landmine. */
async function persistUpdatedProviderItem(
  uk: WasmUserKey,
  itemId: string,
  expectedRevision: number,
  updatedEncryptedItemJson: string,
  collectionId: string | null,
  sharedToMe: boolean,
): Promise<void> {
  try {
    if (sharedToMe === true) {
      // Same "fail loud via log, never write" discipline the
      // CollectionKeyUnavailable branch below already uses -- there is no
      // encrypt-as-recipient primitive, so this MUST refuse rather than
      // silently corrupt the owner's item under the wrong key.
      console.error(
        "[passkey-vault] refusing to persist provider write-back for a directly-shared item (no encrypt-as-recipient primitive)",
        { itemId },
      );
      return;
    }
    if (collectionId === null) {
      const { encKey, encData } = splitCombinedEncryptedItem(updatedEncryptedItemJson);
      await updateItem(itemId, encKey, encData, expectedRevision);
      return;
    }

    const newRevision = expectedRevision + 1;
    const plaintext = decryptItem(uk, updatedEncryptedItemJson, itemId, newRevision);

    const collectionKey = getCollectionKey(collectionId);
    if (collectionKey === undefined) {
      console.error(
        "[passkey-vault] cannot persist collection-scoped provider write-back: Collection Key not cached (never falling back to the wrong-scoped ciphertext)",
        { itemId, collectionId },
      );
      return;
    }

    const recipheredJson = encryptItemForCollection(
      collectionKey,
      plaintext,
      collectionId,
      itemId,
      newRevision,
    );
    const { encKey, encData } = splitCombinedEncryptedItem(recipheredJson);
    await updateItem(itemId, encKey, encData, expectedRevision);
  } catch (e) {
    console.error("[passkey-vault] failed to persist updated provider credential", e);
  }
}

/** D-10: re-checks for any still-pending provider items in
 * `chrome.storage.session` and retries their sync -- callable opportunistically
 * (e.g. from background.ts's wake path) since a fresh/idle-killed service
 * worker never assumes the previous instance's fire-and-forget persist
 * actually completed. */
export async function retryPendingProviderItems(): Promise<void> {
  const pending = await readPendingProviderItems();
  for (const [itemId, encryptedItemJson] of Object.entries(pending)) {
    await persistPendingProviderItem(itemId, encryptedItemJson);
  }
}

// --- D-09: locked -> open popup, await unlock, never fail outright -------

async function tryOpenPopup(): Promise<boolean> {
  try {
    if (typeof browser.action?.openPopup !== "function") {
      return false;
    }
    await browser.action.openPopup();
    return true;
  } catch {
    return false;
  }
}

// quick-260720-16k: consent fallback window size. Width (380) matches
// popup/index.html's fixed `width: 380px; overflow: hidden` body -- that is
// the exact content width, no more/no less. Height (460) is the RECOMPUTED
// value for this plan's revision, superseding an earlier 420px pick that
// predates the multi-match list's own scroll cap (Task 5,
// ProviderCeremonyView.tsx's `max-h-52`): worst case is the multi-match
// picker -- site row (20px) + title/body (60px) + capped list (208px) +
// decline-only buttons (40px) + 3 gaps (48px) + p-6 padding (48px) = ~424px
// -- 460 leaves ~36px of headroom above that, and far more above the
// common single-match/create case (~250-280px, no candidate list at all).
const CONSENT_WINDOW_WIDTH = 380;
const CONSENT_WINDOW_HEIGHT = 460;

/** Reads the current (triggering) window's geometry so the consent window
 * can be centered over it -- never throws, mirrors this file's own
 * tryOpenPopup try/catch-to-safe-fallback discipline. `null` on any
 * rejection (e.g. no windows API access in this context). */
async function getCurrentWindowGeometry(): Promise<WindowGeometry | null> {
  try {
    return await browser.windows.getLastFocused();
  } catch {
    return null;
  }
}

async function tryOpenFallbackWindow(): Promise<void> {
  try {
    const current = await getCurrentWindowGeometry();
    const position = centeredWindowPosition(current, CONSENT_WINDOW_WIDTH, CONSENT_WINDOW_HEIGHT);
    await browser.windows.create({
      type: "popup",
      url: "popup.html",
      width: CONSENT_WINDOW_WIDTH,
      height: CONSENT_WINDOW_HEIGHT,
      focused: true,
      ...position,
    });
  } catch (e) {
    console.error("[passkey-vault] failed to open fallback ceremony window", e);
  }
}

// WR-03 (12-REVIEW.md): shared abandon ceiling for both the locked-vault
// unlock wait (`waitForUnlock`) and the consent await (`awaitCeremonyConsent`
// below) -- mirrors CR-03's page-side 120s backstop (page-bridge.content.ts/
// page-bridge-firefox.ts's `RESPONSE_TIMEOUT_MS`). A plain `setTimeout`
// (never `chrome.alarms`) is deliberate here, matching sync-client.ts's own
// `reconnectTimer` precedent: losing this timer to an MV3 service-worker
// idle-kill is harmless -- the in-memory Promise/Map entry it would clean
// up is itself garbage-collected the instant the worker dies, so there is
// nothing left to leak once that happens.
// CEREMONY_ABANDON_TIMEOUT_MS is imported from the shared
// lib/messaging/ceremony-timeouts module (single source of truth; CR-03
// page-authority-backstop invariant guarded by ceremony-timeouts.test.ts).

/** Resolves once `vault-session.ts` reports an unlock -- re-checks
 * `ensureHydrated()` on every lock-state transition (not just "unlock"
 * events specifically, since `subscribeSessionLockState`'s listener carries
 * no payload) rather than assuming the FIRST notification means unlocked.
 * WR-03 fix: bounded by `CEREMONY_ABANDON_TIMEOUT_MS` -- resolves `null`
 * (never a permanently-pending Promise) and calls `unsubscribe()` if no
 * unlock arrives in time, so a user who closes the popup/window while the
 * vault stays locked no longer leaks this subscription indefinitely. */
function waitForUnlock(): Promise<WasmUserKey | null> {
  return new Promise((resolve) => {
    let settled = false;
    const unsubscribe = subscribeSessionLockState(() => {
      void ensureHydrated().then((uk) => {
        if (uk !== null && !settled) {
          settled = true;
          clearTimeout(timeoutId);
          unsubscribe();
          resolve(uk);
        }
      });
    });
    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        unsubscribe();
        resolve(null);
      }
    }, CEREMONY_ABANDON_TIMEOUT_MS);
  });
}

/** D-09: attempts `browser.action.openPopup()` first, falls back to a
 * dedicated small `browser.windows.create()` popup window when unavailable/
 * rejected, then awaits the unlock signal. Returns `null` on abandonment
 * (WR-03) -- callers must treat that identically to an explicit decline
 * (`{ fallthrough: true }`), never proceed with a null key. WR-04 fix: no
 * longer writes any flag to `PENDING_CEREMONY_KEY` -- the vault-locked
 * state is already fully conveyed by `session.status` (App.tsx's existing
 * `UnlockView`, per 12-04-SUMMARY's Scope Clarification #3); the real
 * consent payload is written by `awaitCeremonyConsent` immediately after
 * this resolves, so the popup naturally transitions from UnlockView to
 * ProviderCeremonyView with no intermediate flag needed. */
async function openPopupAndAwaitUnlock(): Promise<WasmUserKey | null> {
  const opened = await tryOpenPopup();
  if (!opened) {
    await tryOpenFallbackWindow();
  }
  return waitForUnlock();
}

// --- PRF capability reporting (D-16 -- capability-driven, never browser-sniff) ---

function requestedPrf(publicKeyRequest: unknown): boolean {
  if (typeof publicKeyRequest !== "object" || publicKeyRequest === null) {
    return false;
  }
  const extensions = (publicKeyRequest as { extensions?: unknown }).extensions;
  return typeof extensions === "object" && extensions !== null && "prf" in extensions;
}

/** Reads `clientExtensionResults.prf.enabled` from the REAL
 * `credential_response_json` passkey-rs produced (Plan 12-01's
 * `HmacSecretConfig`-backed authenticator) -- the ONLY signal this function
 * ever consults. Returns `{}` (both fields omitted) when the RP's request
 * didn't include `prf` at all -- never omitted when it DID (D-16). */
function derivePrfCapability(
  publicKeyRequest: unknown,
  credentialResponseJson: string,
): { prfCapable?: boolean; prfUnavailableReason?: string } {
  if (!requestedPrf(publicKeyRequest)) {
    return {};
  }
  let enabled = false;
  try {
    const parsed = JSON.parse(credentialResponseJson) as {
      clientExtensionResults?: { prf?: { enabled?: boolean } };
    };
    enabled = parsed.clientExtensionResults?.prf?.enabled === true;
  } catch {
    enabled = false;
  }
  if (enabled) {
    return { prfCapable: true };
  }
  return {
    prfCapable: false,
    prfUnavailableReason:
      "the vault-backed authenticator did not report hmac-secret support for this credential",
  };
}

function extractRpId(publicKeyRequest: unknown): string {
  if (typeof publicKeyRequest === "object" && publicKeyRequest !== null) {
    const rpId = (publicKeyRequest as { rpId?: unknown }).rpId;
    if (typeof rpId === "string") {
      return rpId;
    }
  }
  return "";
}

/** CR-02 fix (12-REVIEW.md): `rpId` is spec-OPTIONAL on `get()` -- many real
 * RPs omit it and rely on the default (the caller origin's effective
 * domain). `extractRpId` alone returns `""` in that case, which matched no
 * stored item (every vault passkey has a concrete `rpId`), silently
 * refusing to serve `get()` for every RP that omits it. Falls back to
 * `senderOrigin`'s hostname (guarded -- a parse failure yields `""`, same
 * as before this fix, never a crash). This only WIDENS the candidate
 * search; `passkey-client`'s own registrable-suffix/origin validation
 * during signing (D-06, proven by `origin_mismatch_rejected`) is still the
 * authoritative check, so this never weakens origin binding. */
function deriveOriginHost(senderOrigin: string): string {
  try {
    return new URL(senderOrigin).hostname;
  } catch {
    return "";
  }
}

function extractGetRpId(publicKeyRequest: unknown, senderOrigin: string): string {
  return extractRpId(publicKeyRequest) || deriveOriginHost(senderOrigin);
}

/** 27-06 (UI-SPEC data-contract prerequisite): synchronous, never-
 * fabricating owning-collection-name lookup -- mirrors
 * `autofill-match.ts`'s own `folderNameFor()` (27-05) exactly. `undefined`
 * (never a placeholder) when `collectionId` is null/undefined (personal or
 * direct-shared) or not yet cached. */
function folderNameFor(collectionId: string | null | undefined): string | undefined {
  if (collectionId == null) {
    return undefined;
  }
  return getCollections().find((collection) => collection.id === collectionId)?.name;
}

/** `create()`'s RP id lives at `rp.id` (spec-optional there too, same
 * default-to-origin rule as `get()`'s top-level `rpId`, CR-02) -- never at
 * `publicKeyRequest.rpId` (a `get()`-only field). */
function extractCreateRpId(publicKeyRequest: unknown, senderOrigin: string): string {
  if (typeof publicKeyRequest === "object" && publicKeyRequest !== null) {
    const rp = (publicKeyRequest as { rp?: unknown }).rp;
    if (typeof rp === "object" && rp !== null) {
      const id = (rp as { id?: unknown }).id;
      if (typeof id === "string" && id.length > 0) {
        return id;
      }
    }
  }
  return deriveOriginHost(senderOrigin);
}

/** The account label shown on the `create()` consent screen
 * (`provider.accountLabel`, 12-UI-SPEC.md) -- `user.name`/`user.displayName`
 * from the RP's OWN create request, never fabricated. `undefined` (no
 * account line rendered) if the request carries neither. */
function extractAccountLabel(publicKeyRequest: unknown): string | undefined {
  if (typeof publicKeyRequest === "object" && publicKeyRequest !== null) {
    const user = (publicKeyRequest as { user?: unknown }).user;
    if (typeof user === "object" && user !== null) {
      const name = (user as { name?: unknown }).name;
      if (typeof name === "string" && name.length > 0) {
        return name;
      }
      const displayName = (user as { displayName?: unknown }).displayName;
      if (typeof displayName === "string" && displayName.length > 0) {
        return displayName;
      }
    }
  }
  return undefined;
}

// --- Decision A: unified popup-consent gate for EVERY ceremony -----------

export interface PendingCeremonyCandidate {
  itemId: string;
  label: string;
  /** 27-06 (UI-SPEC data-contract prerequisite): mirrors
   * `ProviderCredentialCandidate.isShared`/`folderName`
   * (ProviderCeremonyView.tsx) -- set only for a genuinely shared candidate/
   * a resolvable owning-collection name, from the corresponding `VaultItem`'s
   * own `isShared`/`collectionId` fields, exactly like Task 1's dispatch
   * reads `collectionId`. Wiring these into the popup's candidate row UI is
   * 27-10's job, not this plan's. */
  isShared?: boolean;
  folderName?: string;
}

/** The ONE payload shape `awaitCeremonyConsent` ever writes to
 * `PENDING_CEREMONY_KEY` -- App.tsx (Plan 12-05) mounts
 * `ProviderCeremonyView` off this SAME shape for all three ceremony kinds
 * (create, single-match get, multi-match get), replacing 12-02/12-04's
 * two-shape split (a dead boolean for the locked-wait path, WR-04, and this
 * object shape for the multi-match picker only). `candidates` is `[]` for
 * `create` (no picker list, one implicit "new credential" affordance per
 * 12-UI-SPEC.md); 1 entry for a single-match `get` (pre-selected, no list
 * rendered); 2+ for a multi-match `get` (the existing picker). */
interface PendingCeremonyPayload {
  requestId: string;
  kind: "create" | "get";
  rpId: string;
  account?: string;
  prfRequested: boolean;
  candidates: PendingCeremonyCandidate[];
}

interface PendingConsentResolution {
  resolve: (itemId: string | null) => void;
}

const pendingConsentResolutions = new Map<string, PendingConsentResolution>();

/** Decision A: writes the unified consent payload, opens the popup, and
 * awaits an EXPLICIT confirm/decline before the caller may mint/persist or
 * sign anything -- called from BOTH `handleCredentialsCreate` and
 * `handleCredentialsGet` (single- and multi-match), never bypassed for an
 * already-unlocked vault. Returns the confirmed `itemId` (an opaque
 * "confirmed" sentinel for `create`, since there is no candidate to choose
 * there) or `null` for an explicit decline OR an abandoned/timed-out
 * ceremony (WR-03) -- callers must treat both identically
 * (`{ fallthrough: true }`, never mint/persist/sign, CR-03's orphan fix). */
async function awaitCeremonyConsent(
  payload: Omit<PendingCeremonyPayload, "requestId">,
): Promise<string | null> {
  const requestId = crypto.randomUUID();
  await browser.storage.session.set({
    [PENDING_CEREMONY_KEY]: { requestId, ...payload } satisfies PendingCeremonyPayload,
  });

  const opened = await tryOpenPopup();
  if (!opened) {
    await tryOpenFallbackWindow();
  }

  const resolution = await new Promise<string | null>((resolve) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      pendingConsentResolutions.delete(requestId);
      resolve(null);
    }, CEREMONY_ABANDON_TIMEOUT_MS);

    pendingConsentResolutions.set(requestId, {
      resolve: (itemId) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        resolve(itemId);
      },
    });
  });

  await browser.storage.session.remove(PENDING_CEREMONY_KEY);
  return resolution;
}

/** Called by the popup UI once the user confirms/selects a credential (or
 * explicitly declines, `itemId: null`) for ANY pending ceremony (create,
 * single-match get, or multi-match get, Decision A) -- the ONLY way to
 * unblock `awaitCeremonyConsent`'s awaited Promise from outside this
 * module. A no-op for an unknown/already-resolved `requestId` (already
 * timed out via WR-03's abandon ceiling, or a stale/replayed message). */
export function resolveProviderCredentialChoice(requestId: string, itemId: string | null): void {
  const pending = pendingConsentResolutions.get(requestId);
  if (pending === undefined) {
    return;
  }
  pendingConsentResolutions.delete(requestId);
  pending.resolve(itemId);
}

// --- Handlers ---------------------------------------------------------

/**
 * `credentials.create`: registers a new vault-backed passkey. Decision A:
 * ALWAYS awaits an explicit popup confirm via `awaitCeremonyConsent` FIRST
 * -- `wasmCreateProviderCredential` is never called, and nothing is ever
 * persisted, until that resolves to a confirm; a decline OR an abandoned/
 * timed-out ceremony (WR-03) returns `{ fallthrough: true }` before the
 * WASM binding is touched at all (CR-03's orphan-credential fix -- there is
 * no window where a page that already gave up ends up with a credential it
 * never received). Persistence, once confirmed, reuses the phase-11
 * capture write path verbatim (capture-handler.ts: encryptItem ->
 * splitCombinedEncryptedItem -> createItem) via
 * `wasmCreateProviderCredential`'s combined create+encrypt binding, using
 * the SAME `crypto.randomUUID()` for both the WASM call's `item_id` and
 * `createItem`'s id -- `encrypt_item` binds `item_id`+`revision` as AAD, so
 * a mismatched id would make the item permanently undecryptable. Responds
 * to the page IMMEDIATELY with `credential_response_json`/`prfCapable`/
 * `prfUnavailableReason` -- persistence happens asynchronously afterward
 * (D-19), never blocking the ceremony's response.
 */
export async function handleCredentialsCreate(
  req: CreateRpcRequest,
  senderOrigin: string,
): Promise<CreateRpcResponse> {
  try {
    if (await isConfiguredServerOrigin(senderOrigin)) {
      // Defense-in-depth -- see isConfiguredServerOrigin's own header
      // comment. The user's own vault web app needs REAL WebAuthn, never a
      // provider-brokered ceremony.
      return { fallthrough: true };
    }
    let uk = await ensureHydrated();
    if (uk === null) {
      uk = await openPopupAndAwaitUnlock();
      if (uk === null) {
        return { fallthrough: true };
      }
    }

    const rpId = extractCreateRpId(req.publicKey, senderOrigin);
    const resolution = await awaitCeremonyConsent({
      kind: "create",
      rpId,
      account: extractAccountLabel(req.publicKey),
      prfRequested: requestedPrf(req.publicKey),
      candidates: [],
    });
    if (resolution === null) {
      return { fallthrough: true };
    }

    const requestJson = JSON.stringify({ publicKey: req.publicKey });
    const id = crypto.randomUUID();
    const result = wasmCreateProviderCredential(uk, requestJson, senderOrigin, id);
    const credentialResponseJson = result.credentialResponseJson();
    const encryptedItemJson = result.encryptedItemJson();

    const prf = derivePrfCapability(req.publicKey, credentialResponseJson);

    await writePendingProviderItem(id, encryptedItemJson);
    void persistPendingProviderItem(id, encryptedItemJson);

    return { fallthrough: false, credentialResponseJson, ...prf };
  } catch (e) {
    console.error("[passkey-vault] credentials.create failed", e);
    return { fallthrough: false, failed: true };
  }
}

/**
 * `credentials.get`: signs an assertion with a vault-stored passkey
 * matching the RP. Zero matches -> `{ fallthrough: true }` immediately, no
 * WASM call, no consent prompt (D-11/PROV-03 -- there is nothing to ask
 * consent FOR). One or more matches -> Decision A: ALWAYS awaits an
 * explicit popup confirm/selection via `awaitCeremonyConsent` (single- AND
 * multi-match alike, closing 12-04-SUMMARY's documented single-match gap)
 * before `wasmGetProviderAssertion` is ever called; a decline/abandon
 * (WR-03) returns `{ fallthrough: true }` with no signature produced.
 * `matching_item_json` (the ciphertext `wasmGetProviderAssertion` needs) is
 * reconstructed by re-encrypting the already-decrypted `rawPasskeyJson`
 * with the SAME `item_id`/`revision` -- `encrypt_item`'s AEAD binds those
 * as AAD but not the plaintext itself, so re-encrypting the identical
 * plaintext under the same User Key/id/revision always produces a validly
 * decryptable ciphertext, without this plan needing to plumb the raw
 * server-side ciphertext through vault-store.ts's decrypted-cache pipeline
 * (out of this plan's file scope).
 */
export async function handleCredentialsGet(
  req: GetRpcRequest,
  senderOrigin: string,
): Promise<GetRpcResponse> {
  try {
    if (await isConfiguredServerOrigin(senderOrigin)) {
      // Defense-in-depth -- see isConfiguredServerOrigin's own header
      // comment. The user's own vault web app needs REAL WebAuthn, never a
      // provider-brokered ceremony.
      return { fallthrough: true };
    }
    let uk = await ensureHydrated();
    if (uk === null) {
      uk = await openPopupAndAwaitUnlock();
      if (uk === null) {
        return { fallthrough: true };
      }
    }

    // 27-13 (Blocker 2 gap closure): a resolution barrier before the
    // candidate snapshot below. A cold MV3 wake reaching this point before
    // EITHER cache has completed its first refresh this session can present
    // a PARTIAL candidate list -- a personal match rendered as if it were
    // the complete list, while a shared match for the same rpId is still
    // resolving its Collection Key. Both awaits are best-effort barriers
    // (see each function's own doc comment): the caller's own existing
    // zero-candidate fallthrough further down is untouched and still applies
    // to whatever getItems() returns once these two resolve. No new
    // artificial timeout is added -- the page-side
    // EXTENSION_AUTHORITY_TIMEOUT_MS (300s) backstop already bounds the
    // whole ceremony end-to-end (T-27-29).
    await ensureItemsHydrated();
    await ensureSharedItemsHydrated();

    const rpId = extractGetRpId(req.publicKey, senderOrigin);
    // 27-10 Task 2 (confirmed against real code, not merely inferred):
    // `findMatchingPasskeyItems` filters the ALREADY-DECRYPTED cache
    // (vault-store.ts's `getItems()`), and a shared-but-undecryptable item
    // -- whether still pending (Collection Key not yet re-derived this MV3
    // wake) or genuinely broken (key resolved, AEAD integrity check still
    // failed) -- is recorded ONLY via `markPending`/`getPendingSharedItems()`
    // and is NEVER pushed into the decrypted array `getItems()` returns
    // (confirmed by direct read of `applySyncSnapshot`/`mergeCollectionSnapshot`
    // in vault-store.ts: every per-row catch branch either `continue`s past
    // the push or never reaches it). Unlike web's store, this extension
    // never retains a last-known-good `VaultItem` with `undecryptable: true`
    // set -- so today this filter is unreachable dead code. It is still
    // wired as defense-in-depth (T-27-23, same "wire it anyway" discipline
    // 27-08 applied to the E1-error/E3-error backstops): presenting a
    // candidate this popup elsewhere flags with an integrity warning inside
    // a SECURITY ceremony would be confusing even though it is
    // cryptographically safe (a stale-but-still-valid `rawPasskeyJson`
    // signs a perfectly valid assertion) -- so a future architecture change
    // that starts retaining stale items (mirroring web) inherits a ceremony
    // that already excludes them, rather than a silent gap.
    const candidates = findMatchingPasskeyItems(getItems(), rpId).filter(
      (c) => c.item.undecryptable !== true,
    );

    if (candidates.length === 0) {
      return { fallthrough: true };
    }

    const chosenItemId = await awaitCeremonyConsent({
      kind: "get",
      rpId,
      account:
        candidates.length === 1 ? (candidates[0].fields.username ?? candidates[0].fields.rpId) : undefined,
      // get() ceremonies never surface a PRF-capability note -- 12-02's
      // derivePrfCapability() is only ever invoked from
      // handleCredentialsCreate (D-16's capability signal is a property of
      // the CREATED credential, not something a get() ceremony reports).
      prfRequested: false,
      candidates: candidates.map((c) => {
        const candidate: PendingCeremonyCandidate = {
          itemId: c.item.id,
          label: c.fields.username ?? c.fields.rpId,
        };
        if (c.item.isShared === true) {
          candidate.isShared = true;
        }
        const folderName = folderNameFor(c.item.collectionId);
        if (folderName !== undefined) {
          candidate.folderName = folderName;
        }
        return candidate;
      }),
    });
    if (chosenItemId === null) {
      return { fallthrough: true };
    }
    const chosen = candidates.find((c) => c.item.id === chosenItemId);
    if (chosen === undefined) {
      return { fallthrough: true };
    }

    const requestJson = JSON.stringify({ publicKey: req.publicKey });
    const matchingItemJson = encryptItem(
      uk,
      chosen.fields.rawPasskeyJson,
      chosen.item.id,
      chosen.item.revision,
    );
    const result = wasmGetProviderAssertion(
      uk,
      requestJson,
      senderOrigin,
      matchingItemJson,
      chosen.item.id,
      chosen.item.revision,
    );

    const updatedEncryptedItemJson = result.updatedEncryptedItemJson();
    if (updatedEncryptedItemJson !== undefined && updatedEncryptedItemJson !== null) {
      // Sign-counter (or similar) mutation -- persist the re-encrypted item
      // best-effort, same fire-and-forget discipline as the create path.
      // collectionId threaded through so persistUpdatedProviderItem can
      // dispatch to the correct (personal vs. collection-scoped) re-encrypt
      // path -- see that function's own header comment (T-27-14).
      // sharedToMe threaded through too (28-01-PLAN.md Task 3, B-6) so the
      // function's own FIRST check can refuse a directly-shared item before
      // ever reaching that dispatch.
      void persistUpdatedProviderItem(
        uk,
        chosen.item.id,
        chosen.item.revision,
        updatedEncryptedItemJson,
        chosen.item.collectionId ?? null,
        chosen.item.sharedToMe === true,
      );
    }

    // NordPass-style last-used tracking (quick-260717): a successful
    // credentials.get() assertion is a "use" of the passkey item.
    touchVaultItem(chosen.item.id);

    return { fallthrough: false, credentialResponseJson: result.credentialResponseJson() };
  } catch (e) {
    console.error("[passkey-vault] credentials.get failed", e);
    return { fallthrough: false, failed: true };
  }
}
