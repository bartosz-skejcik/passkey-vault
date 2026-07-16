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
// `ensureHydrated()` resolves null, `openPopupAndAwaitUnlock()` writes a
// pending-ceremony flag to `chrome.storage.session` (12-04's popup reads
// this on mount), attempts `browser.action.openPopup()`, falls back to
// `browser.windows.create()`, and returns a promise that resolves once
// `vault-session.ts`'s lock-state subscription reports an unlock.
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
import { getItems, splitCombinedEncryptedItem } from "./vault-store";
import { createItem, updateItem } from "./vault-api";
import { findMatchingPasskeyItems, type MatchingPasskeyItem } from "./credential-store";
import {
  encryptItem,
  wasmCreateProviderCredential,
  wasmGetProviderAssertion,
  type WasmUserKey,
} from "../../lib/crypto/wasm-loader";

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
 * ceremony (the response already went to the page by the time this runs).*/
async function persistUpdatedProviderItem(
  itemId: string,
  expectedRevision: number,
  updatedEncryptedItemJson: string,
): Promise<void> {
  try {
    const { encKey, encData } = splitCombinedEncryptedItem(updatedEncryptedItemJson);
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

async function tryOpenFallbackWindow(): Promise<void> {
  try {
    await browser.windows.create({ type: "popup", width: 380, url: "popup.html" });
  } catch (e) {
    console.error("[passkey-vault] failed to open fallback ceremony window", e);
  }
}

/** Resolves once `vault-session.ts` reports an unlock -- re-checks
 * `ensureHydrated()` on every lock-state transition (not just "unlock"
 * events specifically, since `subscribeSessionLockState`'s listener carries
 * no payload) rather than assuming the FIRST notification means unlocked. */
function waitForUnlock(): Promise<WasmUserKey> {
  return new Promise((resolve) => {
    const unsubscribe = subscribeSessionLockState(() => {
      void ensureHydrated().then((uk) => {
        if (uk !== null) {
          unsubscribe();
          resolve(uk);
        }
      });
    });
  });
}

/** D-09: writes the pending-ceremony flag (12-04's popup reads this on
 * mount), attempts `browser.action.openPopup()` first, falls back to a
 * dedicated small `browser.windows.create()` popup window when unavailable/
 * rejected, then awaits the unlock signal -- never proceeds with a null key
 * and never fails the ceremony outright while locked. */
async function openPopupAndAwaitUnlock(): Promise<WasmUserKey> {
  await browser.storage.session.set({ [PENDING_CEREMONY_KEY]: true });
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

// --- Multi-match picker groundwork (Plan 12-04 wires the actual popup UI) ---

interface PendingPickerResolution {
  resolve: (itemId: string | null) => void;
}

const pendingPickerResolutions = new Map<string, PendingPickerResolution>();

/** More than one vault-stored passkey matches the RP -- signals a picker
 * state for the popup UI (Plan 12-04) and awaits the user's selection
 * before returning. `null` (decline/dismiss) is a legitimate resolution --
 * the caller must fall through, not treat it as a failure. Not yet exercised
 * by this plan's `<behavior>` tests (no multi-match fixture listed) --
 * groundwork for Plan 12-04's picker UI, which calls
 * `resolveProviderCredentialChoice` once the user picks (or the popup is
 * dismissed, per D-11's "popup dismissal = implicit decline"). */
async function resolvePasskeyChoice(
  candidates: MatchingPasskeyItem[],
): Promise<MatchingPasskeyItem | null> {
  const requestId = crypto.randomUUID();
  await browser.storage.session.set({
    [PENDING_CEREMONY_KEY]: {
      requestId,
      // Plan 12-04 (Rule 2 fix): the popup's multi-match consent screen
      // must show WHICH site is asking (12-UI-SPEC.md's
      // signinBodyMultiple `{site}` interpolation) -- omitting it would
      // defeat the anti-phishing point of a WebAuthn RP-scoped consent
      // screen. All `candidates` share the same rpId by construction
      // (findMatchingPasskeyItems filters on a single rpId).
      rpId: candidates[0]?.fields.rpId ?? "",
      candidates: candidates.map((c) => ({
        itemId: c.item.id,
        label: c.fields.username ?? c.fields.rpId,
      })),
    },
  });
  const opened = await tryOpenPopup();
  if (!opened) {
    await tryOpenFallbackWindow();
  }
  const chosenItemId = await new Promise<string | null>((resolve) => {
    pendingPickerResolutions.set(requestId, { resolve });
  });
  await browser.storage.session.remove(PENDING_CEREMONY_KEY);
  if (chosenItemId === null) {
    return null;
  }
  return candidates.find((c) => c.item.id === chosenItemId) ?? null;
}

/** Called by Plan 12-04's popup picker UI once the user selects a
 * credential (or explicitly declines, `itemId: null`) for a multi-match
 * `credentials.get` ceremony. */
export function resolveProviderCredentialChoice(requestId: string, itemId: string | null): void {
  const pending = pendingPickerResolutions.get(requestId);
  if (pending === undefined) {
    return;
  }
  pendingPickerResolutions.delete(requestId);
  pending.resolve(itemId);
}

// --- Handlers ---------------------------------------------------------

/**
 * `credentials.create`: registers a new vault-backed passkey. Persistence
 * reuses the phase-11 capture write path verbatim (capture-handler.ts:
 * encryptItem -> splitCombinedEncryptedItem -> createItem) via
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
    let uk = await ensureHydrated();
    if (uk === null) {
      uk = await openPopupAndAwaitUnlock();
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
 * WASM call (D-11/PROV-03). Exactly one match -> signs directly. More than
 * one -> awaits the user's choice via `resolvePasskeyChoice` (Plan 12-04).
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
    let uk = await ensureHydrated();
    if (uk === null) {
      uk = await openPopupAndAwaitUnlock();
    }

    const rpId = extractGetRpId(req.publicKey, senderOrigin);
    const candidates = findMatchingPasskeyItems(getItems(), rpId);

    if (candidates.length === 0) {
      return { fallthrough: true };
    }

    const chosen = candidates.length === 1 ? candidates[0] : await resolvePasskeyChoice(candidates);
    if (chosen === null || chosen === undefined) {
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
      void persistUpdatedProviderItem(chosen.item.id, chosen.item.revision, updatedEncryptedItemJson);
    }

    return { fallthrough: false, credentialResponseJson: result.credentialResponseJson() };
  } catch (e) {
    console.error("[passkey-vault] credentials.get failed", e);
    return { fallthrough: false, failed: true };
  }
}
