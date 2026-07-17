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
import { isNotAllowedError } from "./errors";
import {
  passkeyLoginStart,
  passkeyLoginFinish,
  unlockStart,
  unlockFinish,
} from "./api";

export type LoginStep = "start" | "ceremony" | "cancelled" | "failed" | "success";

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

function extractPrfBytes(assertion: PublicKeyCredential): ArrayBuffer | undefined {
  const results = assertion.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  return results.prf?.results?.first;
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
 * Unauthenticated passkey login (AUTH-04): a single `navigator.credentials.get()`
 * gesture both creates a session (any enrolled passkey, PRF-capable or not)
 * and — when the matched credential is PRF-capable — stashes the derived
 * wrapping key + `prf_wrapped_uk` in `pendingUnlock` for UnlockOverlay's
 * existing one-click fast path. Login success is independent of PRF
 * availability: `setSessionToken`/`setStoredEmail` always run once the
 * ceremony verifies, regardless of which branch below is taken.
 */
export async function passkeyLogin(
  email: string,
  onStep?: (step: LoginStep) => void,
): Promise<{ prfUnavailable: boolean; cancelled: boolean }> {
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
    assertion = (await navigator.credentials.get({
      publicKey: { ...requestOptions, extensions: buildPrfExtensions(start.prf_salts) },
    })) as PublicKeyCredential;
  } catch (e) {
    if (isNotAllowedError(e)) {
      // cancelled: true jest jedynym sygnałem dla LoginForm, że sesja NIE
      // powstała — bez niego caller brał ciche anulowanie za udany login
      // (bug znaleziony w UAT 04-03 krok 8).
      onStep?.("cancelled");
      return { prfUnavailable: false, cancelled: true };
    }
    onStep?.("failed");
    throw e;
  }

  const finish = await passkeyLoginFinish({
    state_id: start.state_id,
    credential: stripPrfFromCredentialJson(assertion),
  });

  // Login succeeded either way — session material is stored regardless of
  // whether PRF unlock is also available.
  setSessionToken(finish.session_token);
  setStoredEmail(email);

  if (finish.prf_wrapped_uk !== null) {
    const prfBytes = extractPrfBytes(assertion);
    if (prfBytes !== undefined) {
      const prfArray = new Uint8Array(prfBytes);
      const wrappingKey = WasmWrappingKey.fromPrf(prfArray); // zeroizes prfArray as a side effect
      // Ownership transfers to pendingUnlock — the SAME function the
      // password-login path already uses. UnlockOverlay's existing
      // pending-material fast path frees this handle after consuming it.
      setPendingUnlock(wrappingKey, finish.prf_wrapped_uk);
      onStep?.("success");
      return { prfUnavailable: false, cancelled: false };
    }
  }

  // Either prf_wrapped_uk === null, or it was present but the extension
  // results were unexpectedly absent — both routed identically (Area 3's
  // deliberate two-case collapse): the login still succeeded, only PRF
  // unlock didn't.
  setPrfUnavailableHint();
  onStep?.("success");
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
  cancelled: boolean;
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
      return { prfUnavailable: true, cancelled: false };
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
    assertion = (await navigator.credentials.get({
      publicKey: { ...requestOptions, extensions: buildPrfExtensions(start.prf_salts) },
    })) as PublicKeyCredential;
  } catch (e) {
    if (isNotAllowedError(e)) {
      onStep?.("cancelled");
      return { prfUnavailable: false, cancelled: true };
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
        cancelled: false,
        prfBytes,
        prfWrappedUk: finish.prf_wrapped_uk,
      };
    }
  }

  // Defensive branch: unlock_start only ever offers prf_capable credentials,
  // so a null prf_wrapped_uk here should be rare — same two-case collapse
  // as passkeyLogin applies if the extension silently didn't report.
  onStep?.("success");
  return { prfUnavailable: true, cancelled: false };
}

/**
 * SessionUser-gated vault unlock via a PRF-capable passkey (AUTH-04/09). A
 * thin wrapper over `passkeyUnlockCeremony` above: unlike `passkeyLogin`, a
 * PRF success here unwraps the User Key directly — there is no session-gate
 * to cross, so no `pendingUnlock` indirection is needed.
 */
export async function passkeyUnlock(
  onStep?: (step: LoginStep) => void,
): Promise<{ prfUnavailable: boolean; cancelled: boolean }> {
  const result = await passkeyUnlockCeremony(onStep);

  if (result.prfBytes !== undefined && result.prfWrappedUk !== undefined) {
    const prfArray = new Uint8Array(result.prfBytes);
    const wrappingKey = WasmWrappingKey.fromPrf(prfArray); // zeroizes prfArray as a side effect
    try {
      const uk = unwrapUserKey(wrappingKey, result.prfWrappedUk);
      setUnlockedUserKey(uk);
    } finally {
      wrappingKey.free?.();
    }
  }

  return { prfUnavailable: result.prfUnavailable, cancelled: result.cancelled };
}
