// lib/passkeys/prf-capability.ts — the ENROLL create()-path's PRF
// CAPABILITY reader: "can this authenticator do PRF at all", a boolean
// signal read from `create()`'s `clientExtensionResults` at
// `prf.enabled`. This is NOT the unlock get()-path's PRF OUTPUT reader --
// that stays `extractPrfBytes` in ./prf.ts, unchanged, which reads
// `prf.results.first` off a completed `get()` assertion and returns
// `ArrayBuffer | undefined`. The two never converge: `create()` only ever
// reports capability (`enabled`), never usable bytes; only a second
// `get()` ceremony (same credential, same salt) yields those.
//
// Extracted (13-02-PLAN.md Task 1) to DRY EnrollExtPasskeyPrompt.tsx's
// previously-inline `.prf?.enabled` read into one tested choke point,
// following prf.ts's own module-placement precedent (pure, no WebAuthn
// runtime dependency beyond the `PublicKeyCredential` TYPE).

/**
 * Pure two-case-collapse: `clientExtensionResults.prf.enabled === true`, or
 * bust. A missing/malformed `clientExtensionResults` (defensive: should
 * never happen per the spec, but the shape is caller-supplied JSON-ish
 * data) collapses to `false` -- the same "honest degradation, never an
 * error" posture as `extractPrfBytes`'s `undefined` return.
 */
export function parsePrfCapability(
  clientExtensionResults: { prf?: { enabled?: boolean } } | undefined,
): boolean {
  return clientExtensionResults?.prf?.enabled === true;
}

/**
 * Reads PRF capability directly off a just-created `credential` (the
 * ENROLL create()-path only). Callers on the unlock get()-path never call
 * this -- they call `extractPrfBytes` (./prf.ts) instead.
 */
export function detectPrfCapability(credential: PublicKeyCredential): boolean {
  const results = credential.getClientExtensionResults() as
    | { prf?: { enabled?: boolean } }
    | undefined;
  return parsePrfCapability(results);
}
