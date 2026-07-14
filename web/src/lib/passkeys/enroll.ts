// Two-ceremony passkey enrollment orchestration (AUTH-03) — pure function,
// NO React state, mirrors lib/vault/store.ts's "mutation functions live in
// lib/, not components" convention. EnrollPasskeyDialog.tsx drives its UI
// purely off the `onStep` callback this function reports through.
//
// Zero-knowledge boundary: the raw PRF bytes read from
// `assertion.getClientExtensionResults()` are passed directly into
// `WasmWrappingKey.fromPrf` (which zeroizes the buffer as a side effect)
// and never assigned to any other variable, logged, or included in a
// network request body — only the already-wrapped `prf_wrapped_uk`
// ciphertext crosses to the server.
import { WasmWrappingKey, getUnlockedUserKey, wrapUserKey } from "@/lib/crypto";
import { base64Decode } from "@/lib/auth/api";
import { registerStart, registerFinish, prfWrap } from "./api";

export type EnrollStep =
  | "step1"
  | "step2"
  | "doneWithPrf"
  | "doneNoPrf"
  | "cancelled"
  | "failed";

/** The browser's standard signal for "user dismissed the WebAuthn prompt". */
function isNotAllowedError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "NotAllowedError";
}

export async function enrollPasskey(
  name: string,
  onStep: (step: EnrollStep) => void,
): Promise<void> {
  const uk = getUnlockedUserKey();
  if (uk === null) throw new Error("vault must be unlocked to enroll a passkey");

  onStep("step1");
  let passkeyId: string;
  let prfChallenge: unknown;
  let prfStateId: string;
  let prfSaltB64: string;
  try {
    const start = await registerStart({ display_name: name });
    const creationOptions = PublicKeyCredential.parseCreationOptionsFromJSON(
      (start.challenge as { publicKey: unknown }).publicKey as Parameters<
        typeof PublicKeyCredential.parseCreationOptionsFromJSON
      >[0],
    );
    const credential = (await navigator.credentials.create({
      publicKey: { ...creationOptions, extensions: { prf: {} } },
    })) as PublicKeyCredential;
    const finish = await registerFinish({
      state_id: start.state_id,
      credential: credential.toJSON(),
    });
    passkeyId = finish.passkey_id;
    prfChallenge = finish.prf_challenge;
    prfStateId = finish.prf_state_id;
    prfSaltB64 = finish.prf_salt;
  } catch (e) {
    onStep(isNotAllowedError(e) ? "cancelled" : "failed");
    return;
  }

  onStep("step2");
  try {
    const requestOptions = PublicKeyCredential.parseRequestOptionsFromJSON(
      (prfChallenge as { publicKey: unknown }).publicKey as Parameters<
        typeof PublicKeyCredential.parseRequestOptionsFromJSON
      >[0],
    );
    const assertion = (await navigator.credentials.get({
      publicKey: {
        ...requestOptions,
        extensions: { prf: { eval: { first: base64Decode(prfSaltB64) } } },
      },
    })) as PublicKeyCredential;

    const results = assertion.getClientExtensionResults() as {
      prf?: { results?: { first?: ArrayBuffer } };
    };
    const prfBytes = results.prf?.results?.first;
    if (prfBytes === undefined) {
      onStep("doneNoPrf");
      return;
    }
    const prfArray = new Uint8Array(prfBytes);
    const wrappingKey = WasmWrappingKey.fromPrf(prfArray); // zeroizes prfArray as a side effect
    const wrappedJson = wrapUserKey(wrappingKey, uk);
    await prfWrap(passkeyId, {
      state_id: prfStateId,
      credential: assertion.toJSON(),
      prf_wrapped_uk: wrappedJson,
    });
    onStep("doneWithPrf");
  } catch {
    // Any step-2 cancel/failure is STILL a successful enrollment: the
    // credential from step 1 already exists server-side. Routing this to
    // "cancelled"/"failed" (as if nothing happened) would let a naive
    // "retry" restart from Name entry and create a second, orphaned
    // credential while the first silently remains enrolled as a
    // legitimate no-PRF passkey (03-RESEARCH.md Pitfall 3).
    onStep("doneNoPrf");
  }
}
