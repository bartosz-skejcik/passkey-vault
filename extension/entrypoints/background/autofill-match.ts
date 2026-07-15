// entrypoints/background/autofill-match.ts — the background's three
// autofill handlers (plan 10-04). This is the crypto boundary for the
// whole phase (10-CONTEXT.md D-02, ARCHITECTURE.md Anti-Pattern 1): the
// background is the ONLY context that ever sees a decrypted vault item or
// derives a live TOTP code, and the content script / popup only ever
// receive field values or a derived code -- never the User Key, never a
// decrypt handle.
//
// Real Phase 9 interface (confirmed against 09-05's vault-store.ts, NOT
// the plan's placeholder `getDecryptedItems()`): `getItems()` from
// ./vault-store already returns the FULLY DECRYPTED, in-memory
// `VaultItem[]` -- Phase 9's sync client decrypts every item as it lands
// and the store is cleared the instant the vault locks (vault-store.ts's
// own Pitfall 4 / T-09-18 comment). There is no per-fill "decrypt this one
// ciphertext blob" step here: the item is already plaintext by the time
// this file ever sees it. The background choke-point call this file DOES
// make directly is `totpNow()` (lib/crypto/wasm-loader.ts) -- the one
// value that is derived fresh per request rather than cached at sync time.
//
// Gate design (deliberate divergence from the plan's literal Task 1 step
// 1): the plan's draft gate was `if (!isSessionUnlocked()) return locked;
// then const uk = await ensureHydrated(); if (!uk) return locked;` --
// but isSessionUnlocked() is a SYNC, in-memory-only check (vault-
// session.ts's own doc comment: "may be null on a fresh SW instance").
// Running it as a hard gate BEFORE ensureHydrated() would incorrectly
// report "locked" on a freshly-woken service worker that still has a
// valid persisted key envelope -- exactly the case Test 7 requires to
// succeed. `ensureHydrated()` alone is both the cheap fast-path (returns
// the in-memory handle immediately if already hydrated) AND the correct
// single source of truth for "is there a usable User Key right now" --
// so every handler below gates on it alone (Rule 1 fix; see 10-04-SUMMARY
// for the full record).
import { browser } from "wxt/browser";
import { itemMatchesOrigin, resolveFillTarget, type MessageSender } from "./frame-guard";
import { ensureHydrated } from "./vault-session";
import { getItems } from "./vault-store";
import { totpNow } from "../../lib/crypto/wasm-loader";
import type {
  AutofillMatch,
  ContentDetectRequest,
  ContentDetectResponse,
  ContentFillRequest,
  ContentFillResponse,
  DetectedFields,
  FillKind,
  FillTarget,
  FillValues,
} from "../../lib/autofill/types";
import type { MessageOf, MessageResponseMap } from "../../lib/messaging/ext-protocol";
import type { VaultItem } from "../../lib/vault/types";

const EMPTY_DETECTED: DetectedFields = { login: false, totp: false, card: false, identity: false };

/** The only FillKind values that are ever offered/filled -- "note" is a
 * VaultItem type with no fill target (lib/autofill/types.ts's own header
 * comment), so it is filtered out wherever an item's `fields.type` is
 * compared against a FillKind. */
function asFillKind(itemType: VaultItem["fields"]["type"]): FillKind | null {
  return itemType === "login" || itemType === "totp" || itemType === "card" || itemType === "identity"
    ? itemType
    : null;
}

/**
 * Derives the fill target from the CURRENT active tab, fresh on every call
 * -- never cached across the match/fill round trip (T-10-15 / Pattern 4's
 * "never cache across the two-request round-trip"). `resolveFillTarget()`
 * (frame-guard.ts) does the actual origin/scheme gating; this helper's
 * only job is the one `browser.tabs.query()` call that function
 * deliberately has no access to itself (T-10-02).
 */
async function resolveActiveTarget(): Promise<
  { ok: true; target: FillTarget } | { ok: false; reason: "restricted" | "unreachable" }
> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (tab === undefined || tab.id === undefined) {
    return { ok: false, reason: "unreachable" };
  }
  return resolveFillTarget({ tabId: tab.id, tabUrl: tab.url });
}

/** "••••1234" for a card, "j***@example.com" for an email-shaped login
 * username or identity email -- never a live credential value (D-02). */
function maskEmailOrText(value: string): string {
  const at = value.indexOf("@");
  if (at > 0) {
    return `${value[0]}***${value.slice(at)}`;
  }
  return value.length <= 2 ? "***" : `${value[0]}***`;
}

function maskCardNumber(number: string): string {
  const digits = number.replace(/\D/g, "");
  const last4 = digits.slice(-4);
  return last4.length === 4 ? `••••${last4}` : "••••";
}

function maskedHintFor(item: VaultItem): string {
  switch (item.fields.type) {
    case "login":
      return maskEmailOrText(item.fields.username);
    case "card":
      return maskCardNumber(item.fields.number);
    case "identity":
      return maskEmailOrText(item.fields.email);
    default:
      return "";
  }
}

/**
 * Builds the plaintext values delivered to the content-relay for a single
 * matched item. `totp` derives the code FRESH here via `totpNow()` -- the
 * one background-choke-point crypto call this file makes -- rather than
 * ever reading a cached code. Returns null for an item type with no fill
 * shape (defensive; unreachable in practice because callers already
 * refuse a `kind_`/`item.fields.type` mismatch before this runs).
 */
function buildFillValues(item: VaultItem): FillValues | null {
  switch (item.fields.type) {
    case "login":
      return { type: "login", username: item.fields.username, password: item.fields.password };
    case "card":
      return {
        type: "card",
        cardholderName: item.fields.cardholderName,
        number: item.fields.number,
        expiry: item.fields.expiry,
        cvv: item.fields.cvv,
      };
    case "identity":
      return {
        type: "identity",
        firstName: item.fields.firstName,
        lastName: item.fields.lastName,
        email: item.fields.email,
        phone: item.fields.phone,
        address: item.fields.address,
      };
    case "totp": {
      const { code } = totpNow(
        item.fields.secret,
        item.fields.algorithm,
        item.fields.digits,
        item.fields.period,
        Math.floor(Date.now() / 1000),
      );
      return { type: "totp", code };
    }
    default:
      return null;
  }
}

/**
 * Popup -> background. Never returns a field value or derived secret --
 * only metadata (T-10-13). Gates closed on `ensureHydrated()` before
 * touching the tab/content-relay at all; on any resolution failure
 * (restricted page, unreachable content-relay) returns an accurate
 * `pageState` with empty matches rather than fabricating a result.
 */
export async function handleAutofillMatch(
  _sender: MessageSender,
): Promise<MessageResponseMap["autofill.match"]> {
  const uk = await ensureHydrated();
  if (uk === null) {
    // Locked: fail closed with an empty result. There is no dedicated
    // "locked" pageState in this contract (frozen by plan 10-01) -- the
    // popup already has its own session.status-driven locked UI, so this
    // branch exists purely as defense-in-depth and is not expected to be
    // user-visible; "ok" + empty matches is the least-surprising choice
    // among the three existing pageState values.
    return { pageState: "ok", origin: null, detected: EMPTY_DETECTED, matches: [] };
  }

  const resolved = await resolveActiveTarget();
  if (!resolved.ok) {
    return { pageState: resolved.reason, origin: null, detected: EMPTY_DETECTED, matches: [] };
  }
  const { target } = resolved;

  let detectResponse: ContentDetectResponse | undefined;
  try {
    detectResponse = (await browser.tabs.sendMessage(
      target.tabId,
      { kind: "content.detect" } satisfies ContentDetectRequest,
      { frameId: target.frameId },
    )) as ContentDetectResponse | undefined;
  } catch {
    detectResponse = undefined;
  }
  if (detectResponse === undefined) {
    // Never fabricate detection results -- no answer means "unreachable",
    // not "nothing detected".
    return { pageState: "unreachable", origin: target.origin, detected: EMPTY_DETECTED, matches: [] };
  }

  const matches: AutofillMatch[] = [];
  for (const item of getItems()) {
    const kind = asFillKind(item.fields.type);
    if (kind === null) {
      continue; // "note" -- no fill target
    }
    if (!detectResponse.detected[kind]) {
      continue; // content-relay didn't see a matching field family on this page
    }
    if (!itemMatchesOrigin(item, target.origin)) {
      continue;
    }
    matches.push({ itemId: item.id, kind, label: item.fields.name, maskedHint: maskedHintFor(item) });
  }

  return { pageState: "ok", origin: target.origin, detected: detectResponse.detected, matches };
}

/**
 * Popup -> background. ALWAYS re-resolves the target frame and re-checks
 * `itemMatchesOrigin` from scratch -- never trusts the origin decision an
 * earlier `autofill.match` call made (T-10-15). An `itemId` is never
 * trusted in isolation: it must belong to an item that (a) is the
 * requested `kind_` and (b) matches the freshly-resolved frame origin
 * (T-10-14). The response is value-free by shape (MessageResponseMap) --
 * plaintext crosses to the content-relay only, addressed to the exact
 * resolved `{frameId}` (T-10-16), never broadcast to the tab.
 */
export async function handleAutofillFill(
  message: MessageOf<"autofill.fill">,
  _sender: MessageSender,
): Promise<MessageResponseMap["autofill.fill"]> {
  const uk = await ensureHydrated();
  if (uk === null) {
    return { ok: false, reason: "locked" };
  }

  const resolved = await resolveActiveTarget();
  if (!resolved.ok) {
    return { ok: false, reason: "target-unreachable" };
  }
  const { target } = resolved;

  const item = getItems().find((candidate) => candidate.id === message.itemId);
  if (item === undefined || item.fields.type !== message.kind_) {
    return { ok: false, reason: "no-match" };
  }
  if (!itemMatchesOrigin(item, target.origin)) {
    return { ok: false, reason: "origin-mismatch" };
  }

  const values = buildFillValues(item);
  if (values === null) {
    return { ok: false, reason: "no-match" };
  }

  try {
    const ack = (await browser.tabs.sendMessage(
      target.tabId,
      { kind: "content.fill", values } satisfies ContentFillRequest,
      { frameId: target.frameId },
    )) as ContentFillResponse | undefined;
    if (ack?.ok !== true) {
      return { ok: false, reason: "target-unreachable" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "target-unreachable" };
  }
}

/**
 * Popup -> background. The ONE sanctioned path where a value derived from
 * a secret reaches the popup (10-UI-SPEC.md's "Kopiuj kod" clipboard-write
 * action runs in the popup context) -- the raw TOTP seed never crosses
 * this boundary, only the derived `code`. Deliberately has NO origin
 * check: `itemMatchesOrigin()` always returns false for a totp item (no
 * stored URL to compare, frame-guard.ts's own documented policy), so this
 * message is keyed by an `itemId` the popup already knows from a prior
 * match/manual pick, never gated by frame origin (frame-guard.ts header
 * comment). Derives fresh every call -- never caches a code between
 * requests.
 */
export async function handleAutofillTotpCode(
  message: MessageOf<"autofill.totpCode">,
  _sender: MessageSender,
): Promise<MessageResponseMap["autofill.totpCode"]> {
  const uk = await ensureHydrated();
  if (uk === null) {
    return { ok: false, reason: "locked" };
  }

  const item = getItems().find((candidate) => candidate.id === message.itemId);
  if (item === undefined || item.fields.type !== "totp") {
    return { ok: false, reason: "no-match" };
  }

  const { code, secondsRemaining } = totpNow(
    item.fields.secret,
    item.fields.algorithm,
    item.fields.digits,
    item.fields.period,
    Math.floor(Date.now() / 1000),
  );
  return { ok: true, code, secondsRemaining };
}
