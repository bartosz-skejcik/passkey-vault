// Passkey login (unauthenticated) + unlock (SessionUser-gated) ceremony
// orchestration (AUTH-04, AUTH-09) — pure functions, NO React state, mirror
// enroll.ts's "pure function" convention. LoginForm/UnlockOverlay drive
// their UI purely off the `onStep` callback these functions report through.
//
// Zero-knowledge boundary: PRF bytes read from
// `assertion.getClientExtensionResults()` are passed directly into
// `WasmWrappingKey.fromPrf` (which zeroizes the buffer as a side effect)
// and never assigned to any other variable, logged, or included in a
// network request body — only the already-wrapped `prf_wrapped_uk`
// ciphertext (from the server) and the opaque WebAuthn credential JSON
// cross the client/server boundary.
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
): Promise<{ prfUnavailable: boolean }> {
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
      onStep?.("cancelled");
      return { prfUnavailable: false };
    }
    onStep?.("failed");
    throw e;
  }

  const finish = await passkeyLoginFinish({
    state_id: start.state_id,
    credential: assertion.toJSON(),
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
      return { prfUnavailable: false };
    }
  }

  // Either prf_wrapped_uk === null, or it was present but the extension
  // results were unexpectedly absent — both routed identically (Area 3's
  // deliberate two-case collapse): the login still succeeded, only PRF
  // unlock didn't.
  setPrfUnavailableHint();
  onStep?.("success");
  return { prfUnavailable: true };
}

/**
 * SessionUser-gated vault unlock via a PRF-capable passkey (AUTH-04/09). No
 * `email` argument — the ceremony is scoped server-side to the
 * already-authenticated user's `prf_capable` credentials only. Unlike
 * `passkeyLogin`, a PRF success here unwraps the User Key directly — there
 * is no session-gate to cross, so no `pendingUnlock` indirection is needed.
 */
export async function passkeyUnlock(
  onStep?: (step: LoginStep) => void,
): Promise<{ prfUnavailable: boolean }> {
  onStep?.("start");
  let start: Awaited<ReturnType<typeof unlockStart>>;
  try {
    start = await unlockStart();
  } catch (e) {
    if (e instanceof ApiClientError && e.status === 404) {
      // Zero PRF-capable passkeys — UI-SPEC's explicit "no browser prompt
      // ever shown" requirement for this case.
      return { prfUnavailable: true };
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
      return { prfUnavailable: false };
    }
    onStep?.("failed");
    throw e;
  }

  const finish = await unlockFinish({
    state_id: start.state_id,
    credential: assertion.toJSON(),
  });

  if (finish.prf_wrapped_uk !== null) {
    const prfBytes = extractPrfBytes(assertion);
    if (prfBytes !== undefined) {
      const prfArray = new Uint8Array(prfBytes);
      const wrappingKey = WasmWrappingKey.fromPrf(prfArray); // zeroizes prfArray as a side effect
      try {
        const uk = unwrapUserKey(wrappingKey, finish.prf_wrapped_uk);
        setUnlockedUserKey(uk);
      } finally {
        wrappingKey.free?.();
      }
      onStep?.("success");
      return { prfUnavailable: false };
    }
  }

  // Defensive branch: unlock_start only ever offers prf_capable credentials,
  // so a null prf_wrapped_uk here should be rare — same two-case collapse
  // as passkeyLogin applies if the extension silently didn't report.
  onStep?.("success");
  return { prfUnavailable: true };
}
