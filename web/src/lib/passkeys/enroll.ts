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
        // Cast needed: TS's DOM lib types `BufferSource` against a plain
        // `ArrayBuffer`, but `Uint8Array`'s generic buffer type widens to
        // `ArrayBufferLike` (which also covers `SharedArrayBuffer`) — the
        // value itself is always a real, non-shared `Uint8Array` here.
        extensions: { prf: { eval: { first: base64Decode(prfSaltB64) as BufferSource } } },
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
    // `wrappingKey` is a wasm-bindgen handle: its `ZeroizeOnDrop` only fires
    // when the underlying Rust value is dropped, which for a wasm-bindgen
    // object needs an explicit `.free()` (JS garbage collection alone would
    // eventually zeroize it, but on an unpredictable timeline) — matching
    // the project's deterministic-zeroization discipline for key material
    // (IN-02). `wrapUserKey` fully consumes `wrappingKey` synchronously (it
    // does not hold onto it), so freeing it right after is safe.
    try {
      const wrappedJson = wrapUserKey(wrappingKey, uk);

      // Defense-in-depth (WR-04): `PublicKeyCredential.toJSON()` serializes
      // `clientExtensionResults`, which for the PRF extension can in
      // principle include the raw eval output bytes (mainstream browsers
      // currently don't appear to put the secret `results.first` bytes
      // there, but that's an undocumented, browser-version-dependent
      // behavior, not a contract). The server's `finish_passkey_authentication`
      // never needs `prf` output — strip it before it ever leaves the
      // client, so the zero-knowledge boundary doesn't rely on that
      // assumption holding forever.
      const credentialJson = assertion.toJSON() as { clientExtensionResults?: { prf?: unknown } };
      if (credentialJson.clientExtensionResults?.prf !== undefined) {
        delete credentialJson.clientExtensionResults.prf;
      }

      await prfWrap(passkeyId, {
        state_id: prfStateId,
        credential: credentialJson,
        prf_wrapped_uk: wrappedJson,
      });
      onStep("doneWithPrf");
    } finally {
      wrappingKey.free();
    }
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
