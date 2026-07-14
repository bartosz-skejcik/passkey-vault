---
phase: 04-prf-unlock-login-unification
fixed_at: 2026-07-14T11:40:23Z
review_path: .planning/phases/04-prf-unlock-login-unification/04-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 4: Code Review Fix Report

**Fixed at:** 2026-07-14T11:40:23Z
**Source review:** .planning/phases/04-prf-unlock-login-unification/04-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (CR-01, WR-01, WR-02 — scope `critical_warning`; IN-01/IN-02 excluded by scope)
- Fixed: 3
- Skipped: 0

**Note on provenance:** These three fixes were originally produced and committed by an
earlier invocation of this fixer that was interrupted before completing its worktree
cleanup (an orphaned worktree + `gsd-reviewfix/04-46489` branch were found at session
start, recorded in a recovery sentinel). Each commit was independently re-read in full,
verified against the review findings and current source, and re-verified green
(`cargo test -p pv-server`, `cargo clippy -p pv-server --all-targets`, `npm --prefix web
test`, `npx tsc --noEmit -p web`) before being recovered via cherry-pick onto a fresh
worktree/branch rather than blindly trusted. All three commit messages already followed
the `fix(04): <description> [review <ID>]` convention.

## Fixed Issues

### CR-01: Passkey login/unlock POST the raw PRF output to the server (zero-knowledge boundary violation)

**Files modified:** `web/src/lib/passkeys/login.ts`, `web/src/lib/passkeys/login.test.ts`
**Commit:** `6f2dfa4` (recovered/re-verified; re-applied at `ec1dff8` in this run)
**Applied fix:** Added a `stripPrfFromCredentialJson(assertion)` helper mirroring
`enroll.ts`'s WR-04 defense-in-depth: calls `assertion.toJSON()`, deletes
`clientExtensionResults.prf` if present, and returns the stripped JSON. Both
`passkeyLogin`'s `passkeyLoginFinish` call and `passkeyUnlock`'s `unlockFinish` call now
POST the stripped credential instead of the raw `assertion.toJSON()`. `extractPrfBytes`
continues to read PRF bytes from the original (unstripped) `assertion` object, so the
client-side wrapping-key derivation is unaffected. Updated the module's doc comment,
which previously made a now-corrected false claim that PRF bytes never cross a network
request body. Added one regression test per ceremony (`passkeyLogin`, `passkeyUnlock`)
asserting the POSTed credential's `clientExtensionResults.prf` is `undefined` even when
the mocked `assertion.toJSON()` includes it, while `WasmWrappingKey.fromPrf` is still
called (proving the strip doesn't break the legitimate client-side PRF-bytes path).

### WR-01: `passkey_login_start` enumeration surface exceeds what the parity test covers

**Files modified:** `crates/pv-server/src/lib.rs`, `crates/pv-server/src/main.rs`,
`crates/pv-server/src/routes/auth.rs`, `crates/pv-server/tests/common/mod.rs`,
`crates/pv-server/tests/passkey_login.rs`
**Commit:** `54c1001` (recovered/re-verified; re-applied at `788b714` in this run)
**Applied fix:** Chose the "harden" option (b) from the review. Added a per-process
`AppState::dummy_secret: [u8; 32]` (generated fresh at startup in `main.rs`, and in each
test app's `common::test_app`), never serialized or exposed to any client. The dummy
`passkey_login_start` branch now derives 1-2 `allowCredentials` entries (instead of a
fixed one), each a full 32-byte SHA-256 digest of `dummy_secret || email || index`
(instead of a 16-byte truncation of a public per-email hash), closing all three
findings: (1) fixed entry count, (2) unrealistic 16-byte id length, and (3) a
publicly-precomputable id derivation. `userVerification` continues to hard-code
`"required"`, now with a doc comment recording that this byte-matches
`webauthn-rs` 0.5.5's `start_passkey_authentication`, verified by the strengthened test.
Extended `passkey_login_start_shape_parity_unknown_vs_zero_passkey_email` to assert
value-level (not just key-set) equality for `userVerification`, `rpId`, and `timeout`
against a real response, plus id-length (32 bytes) and count-range (1-2) checks on the
dummy `allowCredentials`. Added a new test,
`passkey_login_start_dummy_allow_credentials_stable_across_repeat_probes_same_email`,
proving repeat probes of the same unknown email return byte-identical dummy
`allowCredentials` (while the `challenge` itself stays fresh randomness) and that a
different email never collides onto the same dummy ids — closing the
refresh-compare oracle the review flagged as a risk of a naive fix.

### WR-02: UnlockOverlay pending-unlock failure has no error surface and re-click uses a freed wasm key

**Files modified:** `web/src/components/auth/UnlockOverlay.tsx`,
`web/src/components/auth/UnlockOverlay.test.tsx`
**Commit:** `1918938` (recovered/re-verified; re-applied at `1058f18` in this run)
**Applied fix:** Changed `pending` from a read-once `useState` initializer to a
stateful `[pending, setPending]` pair. In `unlockFromPending`'s `catch` block, added
`setPending(null)` alongside the existing `setError(...)` call, so a failed pending
unlock clears the (about-to-be-freed) pending material and falls through to the
standard password/passkey branch on the next render, instead of leaving a dead button
pointed at a freed wasm-bindgen handle. Also added `{error ? <p ...> : null}` rendering
inside the pending branch's JSX (previously the branch never displayed `error` at all,
so the failure was silent even before the dead-button issue). Added a regression test
that fails an `unwrapUserKey` call inside the pending branch, asserts the error text
renders, asserts the wrapping key's `.free()` was called exactly once, asserts the UI
falls back to the password form, and asserts a second click (now hitting the password
form's own handler) neither throws nor touches the already-freed handle again.

## Skipped Issues

None — all in-scope findings were fixed.

---

_Fixed: 2026-07-14T11:40:23Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
