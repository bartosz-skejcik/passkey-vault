// Passkey login (unauthenticated) + unlock (SessionUser-gated) ceremony
// orchestration (AUTH-04, AUTH-09) — pure functions, NO React state, mirror
// enroll.ts's "pure function" convention. LoginForm/UnlockOverlay drive
// their UI purely off the `onStep` callback these functions report through.
//
// Zero-knowledge boundary: PRF bytes read from
// `assertion.getClientExtensionResults()` are passed directly into
// `WasmWrappingKey.fromPrf` (which zeroizes the buffer as a side effect)
// and never assigned to any other variable or logged. The credential JSON
// POSTed to the server is explicitly stripped of `clientExtensionResults.prf`
// (see `stripPrfFromCredentialJson` below) before it ever leaves the client —
// mirrors `enroll.ts`'s WR-04 defense-in-depth: `PublicKeyCredential.toJSON()`
// serializes `clientExtensionResults`, which can in principle include the raw
// PRF eval output bytes, so the zero-knowledge boundary must not rely on any
// particular browser's current (undocumented, version-dependent) behavior of
// omitting them.
import { WasmWrappingKey, unwrapUserKey, setUnlockedUserKey } from "@/lib/crypto";
import { base64Decode, ApiClientError } from "@/lib/auth/api";
import { setSessionToken, setStoredEmail } from "@/lib/auth/session";
import { setPendingUnlock } from "@/lib/auth/pendingUnlock";
import { setPrfUnavailableHint } from "@/lib/auth/prfUnavailable";
import { publishOnUnlock } from "@/lib/identity/publishOnUnlock";
import { isNotAllowedError, isAbortError } from "./errors";
import {
  passkeyLoginStart,
  passkeyLoginFinish,
  unlockStart,
  unlockFinish,
} from "./api";

export type LoginStep = "start" | "ceremony" | "cancelled" | "timedOut" | "failed" | "success";

/**
 * Bounded wait for the gesture itself (Bartek live-UAT bug, 13-07 signin
 * flow): `navigator.credentials.get()` had NO client-side timeout anywhere
 * in this file -- for a zero-passkey account, `passkey_login_start`'s own
 * anti-enumeration DUMMY challenge (T-04-01, crates/pv-server/src/routes/
 * auth.rs) still makes this a REAL WebAuthn ceremony (unlike
 * `unlockStart()`'s clean 404), so the browser's native, out-of-DOM picker
 * can hang indefinitely with nothing in this codebase ever resolving it --
 * confirmed via live reproduction against real Firefox (see
 * .planning/debug/resolved/signin-passkeyless-spin.md). Deliberately
 * SHORTER than server-unlock.ts's own CEREMONY_TIMEOUT_MS (120_000) so the
 * ceremony window's own UI resolves on its own well before that background
 * alarm would anyway -- generous enough for a real, slower biometric/
 * security-key interaction to still complete normally.
 */
const GESTURE_TIMEOUT_MS = 60_000;

/**
 * Wraps `navigator.credentials.get()` with an `AbortController`-backed
 * bound (Credential Management API's own `signal` option) -- unlike a bare
 * `Promise.race`, this actually asks the browser to cancel the underlying
 * ceremony (dismissing a still-open native picker) rather than merely
 * abandoning our own Promise while that picker lingers. On timeout, the
 * browser rejects with an `AbortError` `DOMException` -- distinct from
 * `NotAllowedError` (`isNotAllowedError` below), so a caller's existing
 * cancel-vs-genuine-failure branching classifies a timeout as a genuine
 * failure, not a silent user-cancel.
 */
async function getAssertionWithTimeout(
  options: CredentialRequestOptions,
): Promise<PublicKeyCredential> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GESTURE_TIMEOUT_MS);
  try {
    return (await navigator.credentials.get({
      ...options,
      signal: controller.signal,
    })) as PublicKeyCredential;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Builds the `prf.evalByCredential` WebAuthn extension input from a
 * server-supplied `{ credIdB64Url: saltB64 }` map. The map's KEYS
 * (credential ids) are used AS-IS — they already arrived base64url-encoded
 * from the server and must byte-match `allowCredentials[i].id`. Only the
 * VALUES (salts) get base64-decoded. This asymmetry is deliberate.
 */
export function buildPrfExtensions(
  prfSalts: Record<string, string>,
): { prf: { evalByCredential: Record<string, { first: BufferSource }> } } {
  const evalByCredential: Record<string, { first: BufferSource }> = {};
  for (const [credIdB64Url, saltB64] of Object.entries(prfSalts)) {
    evalByCredential[credIdB64Url] = { first: base64Decode(saltB64) as BufferSource };
  }
  return { prf: { evalByCredential } };
}

/**
 * Minimum accepted PRF output length. Must match crates/pv-core/src/prf.rs's
 * `PRF_OUTPUT_LEN` (32 -- `wrapping_key_from_prf`/`wrapping_key_from_ext_prf`
 * reject anything shorter as `CryptoError::InvalidInput("PRF output too
 * short")`). Enforcing the same floor client-side lets a malformed browser
 * result get classified as "PRF unavailable" BEFORE it ever reaches
 * `WasmWrappingKey.fromPrf` — see `extractPrfBytes` below.
 */
const PRF_OUTPUT_MIN_LEN = 32;

/**
 * Strict PRF-result shape validation (Bartek live finding, Zen Browser —
 * a Firefox fork — on macOS): `getClientExtensionResults()` was observed
 * returning `{ prf: { results: { first: {} } } }` — `first` a plain,
 * non-BufferSource empty object, NOT `undefined` and not a documented
 * WebAuthn outcome. The previous check (`!== undefined`) treated any
 * non-undefined `first` as a genuine PRF result, taking the full-success
 * path with a degenerate value — which then either threw inside
 * `new Uint8Array(prfBytes)` or, for a valid-but-short buffer, would have
 * silently derived a wrong wrapping key from too little entropy. `first`
 * must be a real `ArrayBuffer` or an `ArrayBuffer` view with
 * `byteLength >= PRF_OUTPUT_MIN_LEN` to count as present; anything else
 * (missing, a plain object, a zero/short-length buffer, or the wrong type)
 * is treated identically to "browser returned no PRF bytes" (`undefined`)
 * — routing every caller into the existing `prfBrowserGap` branch (the
 * honest `prf-unavailable` copy) instead of a false success.
 */
function extractPrfBytes(assertion: PublicKeyCredential): ArrayBuffer | undefined {
  const results = assertion.getClientExtensionResults() as {
    prf?: { results?: { first?: unknown } };
  };
  const first = results.prf?.results?.first;
  if (first instanceof ArrayBuffer) {
    return first.byteLength >= PRF_OUTPUT_MIN_LEN ? first : undefined;
  }
  if (ArrayBuffer.isView(first)) {
    return first.byteLength >= PRF_OUTPUT_MIN_LEN
      ? (first.buffer.slice(first.byteOffset, first.byteOffset + first.byteLength) as ArrayBuffer)
      : undefined;
  }
  return undefined;
}

/**
 * CR-01 / mirrors `enroll.ts`'s WR-04 strip: `PublicKeyCredential.toJSON()`
 * serializes `clientExtensionResults`, which for the PRF extension can in
 * principle include the raw eval output bytes (mainstream browsers
 * currently don't appear to put the secret `results.first` bytes there, but
 * that's undocumented, browser-version-dependent behavior, not a contract).
 * Neither `finish_passkey_authentication` (login) nor the unlock finish
 * handler ever needs `prf` output — strip it before the credential JSON
 * ever leaves the client, so the zero-knowledge boundary doesn't rely on
 * that assumption holding forever. Must be called on `assertion.toJSON()`
 * output ONLY — `extractPrfBytes(assertion)` (above) must still read from
 * the original, unstripped `assertion` object to derive the wrapping key.
 */
function stripPrfFromCredentialJson(assertion: PublicKeyCredential): unknown {
  const json = assertion.toJSON() as { clientExtensionResults?: { prf?: unknown } };
  if (json.clientExtensionResults?.prf !== undefined) {
    delete json.clientExtensionResults.prf;
  }
  return json;
}

/**
 * Result of the CEREMONY HALF only (start -> get() -> finish) of the
 * unauthenticated passkey LOGIN (AUTH-04) — mirrors
 * `PasskeyUnlockCeremonyResult`/`passkeyUnlockCeremony` below byte-for-byte
 * in shape, deliberately stopping short of ever touching `pendingUnlock`/
 * `setSessionToken`/`setStoredEmail` (this web app's OWN session state).
 * Plan 13-07's `web/src/components/auth/ExtUnlockBridge.tsx` needs exactly
 * this half for its `signin` mode: identify the user by EMAIL (this
 * ceremony's prelogin, `passkeyLoginStart({email})`, is how v0.1 login
 * actually identifies a user — NOT a discoverable credential; there is no
 * server-side "look up by credential id alone" path this codebase
 * implements) and return the server session token + PRF material WITHOUT
 * ever persisting anything web-side — the extension background is the
 * sole place that persists that token/unwraps the User Key for THAT flow
 * (T-13-12/T-13-15). `passkeyLogin` below is `passkeyLoginCeremony` plus
 * the local session-persist-and-pend finish, unchanged in observable
 * behavior from before this refactor.
 */
export interface PasskeyLoginCeremonyResult {
  prfUnavailable: boolean;
  /**
   * True ONLY when the server verified the assertion and returned a
   * PRF-capable `prf_wrapped_uk`, but THIS browser's own WebAuthn extension
   * results came back without PRF bytes — the Firefox/macOS-platform-
   * authenticator `{}` gap documented in 13-FF-WEBAUTHN-RESEARCH.md.
   * Distinct from `prfUnavailable` alone, which stays `true` for every
   * PRF-unusable outcome (including the server-side "no PRF-capable
   * credential matched" case). Always `false` whenever `prfUnavailable` is
   * `false`.
   */
  prfBrowserGap: boolean;
  cancelled: boolean;
  /**
   * True when `getAssertionWithTimeout`'s own `GESTURE_TIMEOUT_MS` bound
   * fired (browser rejected with `AbortError`) before the gesture resolved
   * either way — distinct from `cancelled` (a user-dismissed prompt,
   * `NotAllowedError`). Always `false`/absent whenever `cancelled` is
   * `true`, and vice versa; never both (260803-cnd).
   */
  timedOut?: boolean;
  /** Present whenever the ceremony reaches `passkeyLoginFinish` without
   * throwing/cancelling — i.e. on every outcome except `cancelled: true`
   * or a rethrown ceremony failure. */
  sessionToken?: string;
  prfBytes?: ArrayBuffer;
  prfWrappedUk?: string;
}

/**
 * Unauthenticated passkey login CEREMONY (AUTH-04) — a single
 * `navigator.credentials.get()` gesture that verifies against the server
 * (any enrolled passkey, PRF-capable or not) and returns the fresh session
 * token, WITHOUT touching this web app's own session/pendingUnlock state.
 */
export async function passkeyLoginCeremony(
  email: string,
  onStep?: (step: LoginStep) => void,
): Promise<PasskeyLoginCeremonyResult> {
  onStep?.("start");
  const start = await passkeyLoginStart({ email });

  const requestOptions = PublicKeyCredential.parseRequestOptionsFromJSON(
    (start.challenge as { publicKey: unknown }).publicKey as Parameters<
      typeof PublicKeyCredential.parseRequestOptionsFromJSON
    >[0],
  );

  onStep?.("ceremony");
  let assertion: PublicKeyCredential;
  try {
    assertion = await getAssertionWithTimeout({
      publicKey: { ...requestOptions, extensions: buildPrfExtensions(start.prf_salts) },
    });
  } catch (e) {
    if (isNotAllowedError(e)) {
      // cancelled: true jest jedynym sygnałem dla LoginForm, że sesja NIE
      // powstała — bez niego caller brał ciche anulowanie za udany login
      // (bug znaleziony w UAT 04-03 krok 8).
      onStep?.("cancelled");
      return { prfUnavailable: false, prfBrowserGap: false, cancelled: true };
    }
    if (isAbortError(e)) {
      // GESTURE_TIMEOUT_MS fired — the gesture never resolved either way.
      // Previously rethrown and misclassified as a generic hard failure
      // (260803-cnd); a 60s timeout is closer to "the user walked away"
      // than "the passkey is broken", so it gets its own outcome, distinct
      // from both `cancelled` (silent) and a genuine failure (rethrown).
      onStep?.("timedOut");
      return { prfUnavailable: false, prfBrowserGap: false, cancelled: false, timedOut: true };
    }
    onStep?.("failed");
    throw e;
  }

  const finish = await passkeyLoginFinish({
    state_id: start.state_id,
    credential: stripPrfFromCredentialJson(assertion),
  });

  if (finish.prf_wrapped_uk !== null) {
    const prfBytes = extractPrfBytes(assertion);
    if (prfBytes !== undefined) {
      onStep?.("success");
      return {
        prfUnavailable: false,
        prfBrowserGap: false,
        cancelled: false,
        sessionToken: finish.session_token,
        prfBytes,
        prfWrappedUk: finish.prf_wrapped_uk,
      };
    }

    // Server verified the assertion and this credential IS PRF-capable
    // (prf_wrapped_uk non-null), but THIS browser's own WebAuthn extension
    // results came back without PRF bytes — Firefox's documented `{}` gap
    // (13-FF-WEBAUTHN-RESEARCH.md), not "no PRF-capable credential". The
    // login still succeeded; only PRF unlock didn't, and for a browser
    // reason rather than an account reason.
    onStep?.("success");
    return {
      prfUnavailable: true,
      prfBrowserGap: true,
      cancelled: false,
      sessionToken: finish.session_token,
    };
  }

  // prf_wrapped_uk === null — no PRF-capable credential matched at all
  // (Area 3's original two-case collapse is now split: the browser-gap case
  // above is handled separately). The login still succeeded, only PRF
  // unlock isn't available for this account/credential.
  onStep?.("success");
  return {
    prfUnavailable: true,
    prfBrowserGap: false,
    cancelled: false,
    sessionToken: finish.session_token,
  };
}

/**
 * Unauthenticated passkey login (AUTH-04): a single `navigator.credentials.get()`
 * gesture both creates a session (any enrolled passkey, PRF-capable or not)
 * and — when the matched credential is PRF-capable — stashes the derived
 * wrapping key + `prf_wrapped_uk` in `pendingUnlock` for UnlockOverlay's
 * existing one-click fast path. Login success is independent of PRF
 * availability: `setSessionToken`/`setStoredEmail` always run once the
 * ceremony verifies, regardless of which branch below is taken. Thin
 * wrapper over `passkeyLoginCeremony` above (13-07 extraction, mirrors
 * `passkeyUnlock`/`passkeyUnlockCeremony`'s own precedent) — this
 * function's own observable behavior is unchanged.
 */
export async function passkeyLogin(
  email: string,
  onStep?: (step: LoginStep) => void,
): Promise<{ prfUnavailable: boolean; cancelled: boolean; timedOut?: boolean }> {
  const result = await passkeyLoginCeremony(email, onStep);

  if (result.cancelled || result.timedOut || result.sessionToken === undefined) {
    // `sessionToken === undefined` is defensive-only: passkeyLoginCeremony
    // sets it on every non-cancelled, non-timed-out, non-thrown path (both
    // the PRF-success and the two-case-collapse branches) — see that
    // function's own return sites. A cancelled OR timed-out ceremony never
    // created a session, so nothing to persist either way — `timedOut` must
    // be checked here explicitly (not just folded into `sessionToken ===
    // undefined`) so callers get an accurate `timedOut` flag back rather
    // than losing that distinction.
    return {
      prfUnavailable: result.prfUnavailable,
      cancelled: result.cancelled,
      timedOut: result.timedOut,
    };
  }

  // Login succeeded either way — session material is stored regardless of
  // whether PRF unlock is also available.
  setSessionToken(result.sessionToken);
  setStoredEmail(email);

  if (result.prfBytes !== undefined && result.prfWrappedUk !== undefined) {
    const prfArray = new Uint8Array(result.prfBytes);
    const wrappingKey = WasmWrappingKey.fromPrf(prfArray); // zeroizes prfArray as a side effect
    // Ownership transfers to pendingUnlock — the SAME function the
    // password-login path already uses. UnlockOverlay's existing
    // pending-material fast path frees this handle after consuming it.
    setPendingUnlock(wrappingKey, result.prfWrappedUk);
    return { prfUnavailable: false, cancelled: false };
  }

  setPrfUnavailableHint();
  return { prfUnavailable: true, cancelled: false };
}

/**
 * Result of the CEREMONY HALF only (start -> get() -> finish) of the
 * SessionUser-gated PRF unlock -- deliberately stops short of unwrapping the
 * User Key. Plan 13-06's `web/src/components/auth/ExtUnlockBridge.tsx` needs
 * exactly this half (it must NEVER call `unwrapUserKey`/`setUnlockedUserKey`
 * itself -- the extension background is the sole unwrap anchor for that
 * flow); `passkeyUnlock` below is `passkeyUnlockCeremony` plus the local
 * unwrap-and-set finish, unchanged in observable behavior from before this
 * refactor.
 *
 * `prfBytes`/`prfWrappedUk` are BOTH present only on a genuine PRF success;
 * every other outcome (no PRF-capable passkeys, cancelled, PRF result
 * absent) leaves them `undefined` and the two boolean flags say why.
 */
export interface PasskeyUnlockCeremonyResult {
  prfUnavailable: boolean;
  /**
   * True ONLY when the server verified the assertion and returned a
   * PRF-capable `prf_wrapped_uk`, but THIS browser's own WebAuthn extension
   * results came back without PRF bytes — the Firefox/macOS-platform-
   * authenticator `{}` gap documented in 13-FF-WEBAUTHN-RESEARCH.md.
   * Distinct from `prfUnavailable` alone, which stays `true` for every
   * PRF-unusable outcome (including "zero PRF-capable passkeys registered").
   * Always `false` whenever `prfUnavailable` is `false`.
   */
  prfBrowserGap: boolean;
  cancelled: boolean;
  /** Same GESTURE_TIMEOUT_MS-fired outcome as `PasskeyLoginCeremonyResult.timedOut`
   * above — see that field's doc comment (260803-cnd). */
  timedOut?: boolean;
  prfBytes?: ArrayBuffer;
  prfWrappedUk?: string;
}

/**
 * SessionUser-gated vault-unlock CEREMONY (AUTH-04/09) — no `email`
 * argument, the ceremony is scoped server-side to the already-authenticated
 * user's `prf_capable` credentials only. Runs `unlockStart -> get() ->
 * unlockFinish` and returns the raw PRF bytes + `prf_wrapped_uk` blob on
 * success WITHOUT unwrapping or unlocking anything — callers that need the
 * full local unlock use `passkeyUnlock` below, which wraps this.
 */
export async function passkeyUnlockCeremony(
  onStep?: (step: LoginStep) => void,
): Promise<PasskeyUnlockCeremonyResult> {
  onStep?.("start");
  let start: Awaited<ReturnType<typeof unlockStart>>;
  try {
    start = await unlockStart();
  } catch (e) {
    if (e instanceof ApiClientError && e.status === 404) {
      // Zero PRF-capable passkeys — UI-SPEC's explicit "no browser prompt
      // ever shown" requirement for this case.
      return { prfUnavailable: true, prfBrowserGap: false, cancelled: false };
    }
    onStep?.("failed");
    throw e;
  }

  const requestOptions = PublicKeyCredential.parseRequestOptionsFromJSON(
    (start.challenge as { publicKey: unknown }).publicKey as Parameters<
      typeof PublicKeyCredential.parseRequestOptionsFromJSON
    >[0],
  );

  onStep?.("ceremony");
  let assertion: PublicKeyCredential;
  try {
    assertion = await getAssertionWithTimeout({
      publicKey: { ...requestOptions, extensions: buildPrfExtensions(start.prf_salts) },
    });
  } catch (e) {
    if (isNotAllowedError(e)) {
      onStep?.("cancelled");
      return { prfUnavailable: false, prfBrowserGap: false, cancelled: true };
    }
    if (isAbortError(e)) {
      // Same GESTURE_TIMEOUT_MS-fired outcome as passkeyLoginCeremony's own
      // AbortError branch above — see that branch's comment (260803-cnd).
      onStep?.("timedOut");
      return { prfUnavailable: false, prfBrowserGap: false, cancelled: false, timedOut: true };
    }
    onStep?.("failed");
    throw e;
  }

  const finish = await unlockFinish({
    state_id: start.state_id,
    credential: stripPrfFromCredentialJson(assertion),
  });

  if (finish.prf_wrapped_uk !== null) {
    const prfBytes = extractPrfBytes(assertion);
    if (prfBytes !== undefined) {
      onStep?.("success");
      return {
        prfUnavailable: false,
        prfBrowserGap: false,
        cancelled: false,
        prfBytes,
        prfWrappedUk: finish.prf_wrapped_uk,
      };
    }

    // Server verified the assertion and this credential IS PRF-capable
    // (prf_wrapped_uk non-null), but THIS browser's own WebAuthn extension
    // results came back without PRF bytes — Firefox's documented `{}` gap
    // (13-FF-WEBAUTHN-RESEARCH.md), not "no PRF-capable credential".
    onStep?.("success");
    return { prfUnavailable: true, prfBrowserGap: true, cancelled: false };
  }

  // Defensive branch: unlock_start only ever offers prf_capable credentials,
  // so a null prf_wrapped_uk here should be rare — the browser-gap case is
  // now split out above, so this remaining branch means only "no
  // PRF-capable credential" (should not normally happen for unlock).
  onStep?.("success");
  return { prfUnavailable: true, prfBrowserGap: false, cancelled: false };
}

/**
 * SessionUser-gated vault unlock via a PRF-capable passkey (AUTH-04/09). A
 * thin wrapper over `passkeyUnlockCeremony` above: unlike `passkeyLogin`, a
 * PRF success here unwraps the User Key directly — there is no session-gate
 * to cross, so no `pendingUnlock` indirection is needed.
 */
export async function passkeyUnlock(
  onStep?: (step: LoginStep) => void,
): Promise<{ prfUnavailable: boolean; cancelled: boolean; timedOut?: boolean }> {
  const result = await passkeyUnlockCeremony(onStep);

  if (result.prfBytes !== undefined && result.prfWrappedUk !== undefined) {
    const prfArray = new Uint8Array(result.prfBytes);
    const wrappingKey = WasmWrappingKey.fromPrf(prfArray); // zeroizes prfArray as a side effect
    try {
      const uk = unwrapUserKey(wrappingKey, result.prfWrappedUk);
      setUnlockedUserKey(uk);
      publishOnUnlock(uk); // KEY-01 (26-02-PLAN.md): fire-and-forget, never awaited (E9)
    } finally {
      wrappingKey.free?.();
    }
  }

  return {
    prfUnavailable: result.prfUnavailable,
    cancelled: result.cancelled,
    timedOut: result.timedOut,
  };
}
