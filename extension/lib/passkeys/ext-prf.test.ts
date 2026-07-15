import { describe, expect, it } from "vitest";
import { buildExtCreateOptions, buildExtGetOptions } from "./ext-prf";

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("buildExtCreateOptions", () => {
  it("Test 1a: builds create() options bound to the caller-supplied rpId, attestation none, ES256, resident+UV required", () => {
    const userHandle = new Uint8Array([1, 2, 3, 4]);
    const challenge = new Uint8Array([5, 6, 7, 8]);
    const options = buildExtCreateOptions({
      rpId: "abc123",
      accountEmail: "a@example.com",
      userHandleB64: base64Encode(userHandle),
      challengeB64: base64Encode(challenge),
    });

    const pk = options.publicKey!;
    expect(pk.rp.id).toBe("abc123");
    expect(pk.attestation).toBe("none");
    expect(pk.extensions).toHaveProperty("prf");
    expect(pk.pubKeyCredParams.some((p) => p.alg === -7)).toBe(true);
    expect(pk.authenticatorSelection?.residentKey).toBe("required");
    expect(pk.authenticatorSelection?.userVerification).toBe("required");
  });

  it("Test 1b: never references browser.runtime and has no wasm/background imports (grep-verified in acceptance criteria)", () => {
    // This is a structural invariant enforced by the plan's grep gate over
    // the source file itself, not something exercisable at runtime — this
    // test exists as documentation of that contract at the call-site level:
    // the function must be usable with a purely caller-supplied rpId.
    const options = buildExtCreateOptions({
      rpId: "caller-supplied-id",
      accountEmail: "a@example.com",
      userHandleB64: base64Encode(new Uint8Array([1])),
      challengeB64: base64Encode(new Uint8Array([2])),
    });
    expect(options.publicKey!.rp.id).toBe("caller-supplied-id");
  });
});

describe("buildExtGetOptions", () => {
  it("Test 2: builds get() options with rpId, exactly one allowCredentials entry decoding the b64url id, and prf.eval.first decoding the b64 salt", () => {
    const credentialIdBytes = new Uint8Array([9, 9, 9, 9]);
    const saltBytes = new Uint8Array(32).fill(3);
    const challenge = new Uint8Array([1, 1, 1]);

    const options = buildExtGetOptions({
      rpId: "abc123",
      credentialIdB64url: base64UrlEncode(credentialIdBytes),
      prfSaltB64: base64Encode(saltBytes),
      challengeB64: base64Encode(challenge),
    });

    const pk = options.publicKey!;
    expect(pk.rpId).toBe("abc123");
    expect(pk.allowCredentials).toHaveLength(1);
    const idBytes = new Uint8Array(pk.allowCredentials![0].id as ArrayBuffer);
    expect(Array.from(idBytes)).toEqual(Array.from(credentialIdBytes));

    const prfExt = pk.extensions as { prf: { eval: { first: ArrayBuffer } } };
    const decodedSalt = new Uint8Array(prfExt.prf.eval.first);
    expect(Array.from(decodedSalt)).toEqual(Array.from(saltBytes));
  });
});
