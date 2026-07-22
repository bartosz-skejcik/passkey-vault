---
phase: 04-prf-unlock-login-unification
reviewed: 2026-07-14T00:00:00Z
depth: standard
files_reviewed: 22
files_reviewed_list:
  - crates/pv-server/src/lib.rs
  - crates/pv-server/src/main.rs
  - crates/pv-server/src/routes/auth.rs
  - crates/pv-server/src/routes/mod.rs
  - crates/pv-server/src/routes/passkeys.rs
  - crates/pv-server/src/routes/webauthn_state.rs
  - crates/pv-server/tests/common/mod.rs
  - crates/pv-server/tests/passkey_login.rs
  - crates/pv-server/tests/unlock.rs
  - web/src/components/auth/LoginForm.test.tsx
  - web/src/components/auth/LoginForm.tsx
  - web/src/components/auth/PasskeyUnlockButton.tsx
  - web/src/components/auth/UnlockOverlay.test.tsx
  - web/src/components/auth/UnlockOverlay.tsx
  - web/src/lib/auth/prfUnavailable.ts
  - web/src/lib/i18n/dictionary.ts
  - web/src/lib/passkeys/api.ts
  - web/src/lib/passkeys/enroll.ts
  - web/src/lib/passkeys/errors.ts
  - web/src/lib/passkeys/login.test.ts
  - web/src/lib/passkeys/login.ts
findings:
  critical: 1
  warning: 2
  info: 2
  total: 5
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-07-14T00:00:00Z
**Depth:** standard
**Files Reviewed:** 22
**Status:** issues_found

## Summary

Phase 4 wires up the unauthenticated passkey-login ceremony pair
(`passkey_login_start`/`finish`) and the SessionUser-gated unlock pair
(`unlock_start`/`finish`), plus the client orchestration in `login.ts` and the
LoginForm/UnlockOverlay UI. The server-side crypto discipline is generally
strong: atomic `DELETE ... RETURNING` state consumption, enumeration-resistant
dummy branches, unified error strings on the unauthenticated finish path, and
bound-to-resolved-user-id session issuance. Integration tests cover the happy
paths, shape parity, cross-user rejection, and no-session-on-unlock.

However, one finding is a **BLOCKER**: the two new client ceremonies in
`login.ts` transmit the raw WebAuthn assertion — including the PRF extension
output — to the server unstripped, directly violating the project's core
zero-knowledge invariant ("serwer nigdy nie widzi PRF output"). The sibling
enrollment path (`enroll.ts`) strips it; the login path does not. This is not
hypothetical: the same code path reads the PRF secret out of
`getClientExtensionResults()`, and `toJSON()` serializes that same structure
into the request body.

Two warnings cover an under-tested enumeration surface on
`passkey_login_start` and a dead-end error path in `UnlockOverlay`'s
pending-unlock branch.

## Critical Issues

### CR-01: Passkey login/unlock POST the raw PRF output to the server (zero-knowledge boundary violation)

**File:** `web/src/lib/passkeys/login.ts:92-95` and `web/src/lib/passkeys/login.ts:170-173`

**Issue:** Both `passkeyLogin` and `passkeyUnlock` send `assertion.toJSON()`
directly as the `credential` field of the finish request, with no stripping of
the PRF extension results:

```ts
const finish = await passkeyLoginFinish({
  state_id: start.state_id,
  credential: assertion.toJSON(),   // includes clientExtensionResults.prf.results.first
});
```

On this exact success path the PRF secret is provably present in the
extension results — `extractPrfBytes` (lines 45-50) reads it from
`assertion.getClientExtensionResults().prf.results.first`. `PublicKeyCredential.toJSON()`
serializes `clientExtensionResults` (with ArrayBuffers base64url-encoded), so
`assertion.toJSON().clientExtensionResults.prf.results.first` carries the raw
PRF output across the client/server boundary in the finish request body. The
server never needs it (`finish_passkey_authentication` ignores it), but it now
crosses the wire and is exposed to any request logging / reverse proxy /
`TraceLayer`. This breaks the project's non-negotiable zero-knowledge
guarantee and the domain invariant "PRF extension results must be stripped
from assertions before POSTing".

The same codebase already does exactly the right thing in the enrollment path
— `web/src/lib/passkeys/enroll.ts:107-110` explicitly deletes
`clientExtensionResults.prf` before calling `prfWrap`, with a WR-04 comment
explaining this precise risk. The login path regressed on that discipline.
Worse, `login.ts`'s own module doc comment (lines 6-12) falsely claims "PRF
bytes ... never ... included in a network request body — only the
already-wrapped `prf_wrapped_uk` ciphertext ... cross the client/server
boundary."

**Fix:** Mirror `enroll.ts`'s strip in both ceremonies before POSTing. Extract
a shared helper to avoid drift:

```ts
function stripPrfFromCredentialJson(assertion: PublicKeyCredential): unknown {
  const json = assertion.toJSON() as { clientExtensionResults?: { prf?: unknown } };
  if (json.clientExtensionResults?.prf !== undefined) {
    delete json.clientExtensionResults.prf;
  }
  return json;
}

// passkeyLogin:
const finish = await passkeyLoginFinish({
  state_id: start.state_id,
  credential: stripPrfFromCredentialJson(assertion),
});

// passkeyUnlock:
const finish = await unlockFinish({
  state_id: start.state_id,
  credential: stripPrfFromCredentialJson(assertion),
});
```

Note: `extractPrfBytes(assertion)` must still be called on the original
`assertion` object (not the stripped JSON) so the client can derive the
wrapping key — that is legitimate client-side use and is unaffected by the
strip. Add a test asserting the credential POSTed to `passkeyLoginFinish`/
`unlockFinish` contains no `clientExtensionResults.prf`.

## Warnings

### WR-01: `passkey_login_start` enumeration surface exceeds what the parity test covers

**File:** `crates/pv-server/src/routes/auth.rs:410-438` (dummy builder), `crates/pv-server/tests/passkey_login.rs:266-285` (parity test)

**Issue:** The dummy `passkey_login_start` response is meant to be
indistinguishable from a real one (threat_model T-04-01), but the parity test
(`passkey_login_start_shape_parity_...`) only compares the *top-level
`publicKey` key set*. Three value-level distinctions survive that check and can
act as an account-existence oracle:

1. **`allowCredentials` count.** The dummy always emits exactly one entry
   (lines 423-426). A real account with 2+ enrolled passkeys emits 2+. So any
   account with ≥2 passkeys is definitively distinguishable from a
   non-existent / zero-passkey email, defeating the indistinguishability goal
   for those accounts.
2. **Dummy credential-id length is fixed at 16 bytes** (`&digest[..MIN_SALT_LEN]`,
   line 416). Real authenticator credential ids are frequently not 16 bytes
   (platform authenticators vary), so `allowCredentials[0].id` length can
   distinguish dummy from real.
3. **Hand-built `userVerification: "required"`** (line 427). This must
   byte-match whatever `webauthn-rs`'s `start_passkey_authentication` actually
   emits for a `Passkey` set (which may be `"preferred"`). If it differs, the
   value distinguishes dummy from real. The test never asserts value equality,
   only key-set equality.

**Fix:** Either (a) accept and document these as residual risk in the same
vein as `prelogin`'s dummy-salt note, explicitly scoping T-04-01 parity to the
single-passkey case; or (b) harden: derive a deterministic dummy
`allowCredentials` length/count that mirrors realistic distributions and
assert value-level parity (not just key-set) in the test against a real
`RequestChallengeResponse`, e.g.:

```rust
// in the parity test, additionally compare the serialized values:
assert_eq!(unknown_body["challenge"]["publicKey"]["userVerification"],
           real_body["challenge"]["publicKey"]["userVerification"]);
assert_eq!(unknown_body["challenge"]["publicKey"]["allowCredentials"].as_array().unwrap().len(),
           real_body["challenge"]["publicKey"]["allowCredentials"].as_array().unwrap().len());
```

At minimum, verify (3) does not currently diverge — a value mismatch there
would be a live enumeration oracle today.

### WR-02: UnlockOverlay pending-unlock failure has no error surface and re-click uses a freed wasm key

**File:** `web/src/components/auth/UnlockOverlay.tsx:88-101` and `web/src/components/auth/UnlockOverlay.tsx:153-164`

**Issue:** In the `pending !== null` branch, the rendered JSX (lines 153-164)
is only the unlock button — there is no `{error && ...}` render and no
password fallback. If `unlockFromPending` throws (corrupt/incorrect
`pw_wrapped_uk`, WASM error), `setError(...)` is called (line 95) but that
state is never displayed in this branch, so the failure is silent.

Compounding it: the `finally` (line 98) always calls
`pending.wrappingKey.free?.()`, but `pending` remains non-null component state.
A second click re-invokes `unwrapUserKey(pending.wrappingKey, ...)` on an
already-freed wasm-bindgen handle, which throws ("null pointer passed to
rust") and is again swallowed. The user is left with a dead button, no error,
and no fallback — only a full page reload recovers (which discards the consumed
pending material and falls through to the password branch).

**Fix:** Render the error in the pending branch and neutralize the button
after a failed attempt so the freed key is never reused. For example, on
failure clear the pending material and fall through to the password/passkey
branch:

```tsx
async function unlockFromPending() {
  if (pending === null) return;
  setSubmitting(true);
  try {
    await initCrypto();
    const uk = unwrapUserKey(pending.wrappingKey, pending.pwWrappedUk);
    setUnlockedUserKey(uk);
  } catch {
    setError(t("auth.loginFailed"));
    setPending(null); // drop consumed/freed material -> render password fallback
  } finally {
    pending.wrappingKey.free?.();
    setSubmitting(false);
  }
}
```

(Requires making `pending` stateful with a setter rather than a read-once
`useState` initializer.) Also render `{error ? <p .../> : null}` inside the
pending branch.

## Info

### IN-01: Inconsistent wasm handle free idiom between enroll and login paths

**File:** `web/src/lib/passkeys/enroll.ts:119` vs `web/src/lib/passkeys/login.ts:184`

**Issue:** `enroll.ts` calls `wrappingKey.free()` (unconditional) while
`login.ts`/`UnlockOverlay.tsx` use `wrappingKey.free?.()` (optional chaining).
Both target the same `WasmWrappingKey` type. The inconsistency suggests
uncertainty about whether `.free` can be undefined; if it can (test doubles),
`enroll.ts` would throw. If it cannot, the optional chaining elsewhere is dead
defensiveness. Pick one convention.

**Fix:** Standardize on `wrappingKey.free?.()` everywhere (safe under test
doubles), or document that `.free` is always defined on the real type and drop
the `?.`.

### IN-02: LoginForm passkey button is a silent no-op when email is empty

**File:** `web/src/components/auth/LoginForm.tsx:32-33`

**Issue:** `handlePasskeyLogin` early-returns when `email.trim() === ""`, but
the passkey button is not disabled in that state, so a user who clicks it with
an empty email gets no feedback (no error, no prompt). Minor UX gap.

**Fix:** Disable the passkey button when `email.trim() === ""`, or surface an
inline hint ("enter your email first"), so the affordance's state matches its
behavior.

---

_Reviewed: 2026-07-14T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
