// entrypoints/background/frame-guard.ts — the pure, adversarially-tested
// origin/frame access-control gate (D-04/D-10). Every predicate here takes
// ONLY injected data -- no direct `browser.tabs.*` calls -- so the whole
// gate is unit-testable without a browser fake; the caller (plan 10-04)
// performs the one `browser.tabs.get()` and hands the result in.
//
// Threat model (10-01-PLAN.md's threat_model, T-10-01..T-10-05):
//  - T-10-01: assertPopupSender() refuses session.*/vault.* dispatch from
//    any sender with `sender.tab` defined -- Phase 10 is the first phase a
//    content script shares this channel with the popup (wired by
//    router.ts, Task 3).
//  - T-10-02: resolveFillTarget() takes ONLY platform-provided tab data
//    (`tabUrl`, as returned by browser.tabs.get()) -- there is no
//    payload-origin parameter here for a caller to spoof.
//  - T-10-03: itemMatchesOrigin() compares against the FRAME's own origin
//    only -- a cross-origin subframe never inherits its parent page's
//    match (frame-guard.test.ts's Test 2 is the explicit adversarial
//    case).
//  - T-10-04: originFromContentSender() falls back to `sender.url` when
//    `sender.origin` is unavailable (Firefox parity, 10-RESEARCH.md
//    Pitfall 3) and returns null rather than guessing when neither parses.
//  - T-10-05: itemMatchesOrigin() compares full origin (scheme + hostname
//    + port) equality via `URL#origin` -- no suffix/substring matching.
import { browser } from "wxt/browser";
import type { Browser } from "wxt/browser";
import type { VaultItem } from "../../lib/vault/types";
import type { FillTarget } from "../../lib/autofill/types";

/** The platform-provided `MessageSender` shape passed to every
 * `runtime.onMessage` listener -- re-exported here so router.ts (Task 3)
 * and this module share exactly one type name for it. */
export type MessageSender = Browser.runtime.MessageSender;

/**
 * True only when the message came from THIS extension's own page (popup or
 * options, whether action-hosted or opened in a tab) -- never from a
 * content script. The discriminator is the sender DOCUMENT's origin, not
 * tab-hosting: popup.html opened as a regular tab has `sender.tab` DEFINED
 * yet its document origin is still `chrome-extension://<own-id>`
 * (`moz-extension://` on Firefox), while a content script -- even though it
 * also reports `sender.id === browser.runtime.id` -- always carries the WEB
 * page's http(s) origin in `sender.origin`/`sender.url`. (An earlier
 * `sender.tab === undefined` check wrongly refused the tab-hosted popup;
 * found by packaged-build UAT in real Chrome, invisible to unit tests.)
 * Extension pages cannot be framed by web pages here (popup.html is not
 * web_accessible), so an extension-origin document is popup-tier by
 * construction. Phase 10 is the first phase a content script shares the
 * `runtime.onMessage` channel that previously only the popup used, so this
 * turns the previously-ASSUMED popup-only privilege tier into an enforced
 * check.
 */
export function assertPopupSender(sender: MessageSender): boolean {
  if (sender.id !== browser.runtime.id) return false;
  // String-prefix comparison, deliberately NOT `new URL(...).origin`:
  // chrome-extension:// / moz-extension:// are non-special schemes for
  // WHATWG URL, so `.origin` degrades to "null" outside the browser's own
  // parser (Node/vitest) -- a runtime-vs-test divergence trap.
  const ownBase = browser.runtime.getURL(""); // "chrome-extension://<id>/"
  const ownOrigin = ownBase.endsWith("/") ? ownBase.slice(0, -1) : ownBase;
  if (sender.origin !== undefined) return sender.origin === ownOrigin;
  if (sender.url !== undefined) return sender.url.startsWith(ownBase);
  // Neither origin nor url reported (some Firefox action-popup paths):
  // only the tab-less action popup is acceptable then.
  return sender.tab === undefined;
}

/**
 * The origin of a message that DID come from a content script (the sender
 * `assertPopupSender` refuses). Prefers `sender.origin`; some Firefox
 * versions omit it (10-RESEARCH.md Pitfall 3), so this falls back to
 * `new URL(sender.url).origin`. Returns null -- never a guess -- when
 * neither is present or parseable, so a caller must treat "unknown origin"
 * as "no origin", never as "same origin".
 */
export function originFromContentSender(sender: MessageSender): string | null {
  if (sender.origin) {
    return sender.origin;
  }
  if (sender.url) {
    try {
      return new URL(sender.url).origin;
    } catch {
      return null;
    }
  }
  return null;
}

const RESTRICTED_RESULT = { ok: false, reason: "restricted" } as const;

/**
 * Derives an explicit fill target ONLY from platform-provided tab data --
 * there is no origin field in this function's input for a caller to spoof
 * (T-10-02); `autofill.match`'s request shape (lib/messaging/ext-protocol.ts)
 * deliberately carries no origin for exactly this reason. `frameId: 0` is
 * always the top-level frame -- there is no code path here that returns a
 * target without a concrete numeric frameId.
 */
export function resolveFillTarget(input: {
  tabId: number;
  tabUrl: string | undefined;
}): { ok: true; target: FillTarget } | { ok: false; reason: "restricted" | "unreachable" } {
  if (input.tabUrl === undefined) {
    return RESTRICTED_RESULT;
  }
  let parsed: URL;
  try {
    parsed = new URL(input.tabUrl);
  } catch {
    return RESTRICTED_RESULT;
  }
  // Allow-list, not deny-list: only http/https tabs ever receive a fill.
  // chrome://, about:, moz-extension://, chrome-extension://, file://,
  // view-source:, and any other scheme fall through to "restricted".
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return RESTRICTED_RESULT;
  }
  return {
    ok: true,
    target: { tabId: input.tabId, frameId: 0, origin: parsed.origin },
  };
}

/**
 * Compares a stored URL's origin (scheme + hostname + port, via `URL#origin`)
 * against `frameOrigin` for EXACT equality -- no suffix/substring matching
 * (T-10-05, e.g. `evil-bank.example` must never match `bank.example`). This
 * extends web/src/lib/vault/search.ts's `domainFromUrl()` parsing shape
 * (`new URL(...)` in a try/catch) rather than inventing a second matching
 * algorithm, but deliberately fails CLOSED (false) on an unparseable stored
 * URL -- unlike `domainFromUrl()`, which falls back to the raw string for a
 * permissive search-feature match. An access-control gate must never treat
 * "couldn't parse" as a match.
 */
export function originEquals(storedUrl: string, frameOrigin: string): boolean {
  try {
    return new URL(storedUrl).origin === frameOrigin;
  } catch {
    return false;
  }
}

/**
 * D-04's core rule: does this vault item belong on the frame at
 * `frameOrigin`? The match policy is deliberately ASYMMETRIC by item type
 * -- documented here so a reviewer does not read the card/identity branch
 * as a missing check:
 *
 *  - login: strictly origin-bound -- true only if one of `fields.urls`
 *    origin-equals `frameOrigin`.
 *  - totp: origin-bound by ISSUER, because `TotpFields` carries no stored
 *    URL. `issuerMatchesHost()` matches the item's `issuer` (or, as a
 *    fallback, its `name`) against a hostname label of `frameOrigin` --
 *    issuer "GitHub" is offered on github.com, "Google" on
 *    accounts.google.com. This is deliberately NARROWER than card/identity
 *    (which are offered everywhere): surfacing a 2FA code on the WRONG site
 *    is a real trust hazard, so a totp item only appears where its issuer
 *    plausibly belongs. The caller additionally gates on a detected OTP
 *    field (`autofill-match.ts` only pushes a totp match when
 *    `detected.totp` is true) -- Bartek's checkpoint decision 2026-07-15:
 *    "match po issuer i jest pole otp". (Previously this branch returned
 *    false unconditionally, which made every TotpFillRow dead code and left
 *    SC#2 unverifiable -- found by 10-07's adversarial UAT.)
 *  - card / identity: offered on ANY http(s) origin -- true unconditionally
 *    -- because a stored card or address is not origin-bound data (a card
 *    is usable at any checkout). `resolveFillTarget()` still gates WHICH
 *    pages can receive a fill at all (http(s) only, never chrome://); this
 *    function only decides whether a given item is eligible once a target
 *    origin exists.
 */
export function itemMatchesOrigin(item: VaultItem, frameOrigin: string): boolean {
  switch (item.fields.type) {
    case "login":
      return item.fields.urls.some((url) => url !== "" && originEquals(url, frameOrigin));
    case "totp":
      return issuerMatchesHost(item.fields.issuer, item.fields.name, frameOrigin);
    case "card":
    case "identity":
      return true;
    case "note":
    default:
      return false;
  }
}

/**
 * True when `issuer` (or, as a fallback, the item `name`) names the host at
 * `frameOrigin`. A TOTP item stores no URL, so we match its human-facing
 * issuer against the frame's hostname LABELS: issuer "GitHub" matches
 * `github.com` (label "github"), "Google" matches `accounts.google.com`
 * (label "google"). Normalisation lowercases and strips non-alphanumerics
 * from the issuer ("Google (Work)" -> "googlework" -> token "google" is not
 * derivable, so we also test the raw normalized issuer as a substring of a
 * label and each label as a substring of the issuer, bounded to labels of
 * length >= 3 to avoid "co"/"io" style false hits). Fails CLOSED on an
 * unparseable origin. This is a heuristic surfacing gate, NOT a security
 * boundary on its own -- `resolveFillTarget()` + the detected-OTP-field
 * requirement in `autofill-match.ts` are the hard gates.
 */
function issuerMatchesHost(issuer: string, name: string, frameOrigin: string): boolean {
  let host: string;
  try {
    host = new URL(frameOrigin).hostname.toLowerCase();
  } catch {
    return false;
  }
  const labels = host
    .split(".")
    .filter((l) => l.length >= 3 && l !== "com" && l !== "www" && l !== "net" && l !== "org");
  const candidates = [issuer, name]
    .map((s) => s.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((s) => s.length >= 3);
  return candidates.some((c) => labels.some((l) => l === c || l.includes(c) || c.includes(l)));
}
