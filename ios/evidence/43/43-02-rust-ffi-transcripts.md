# 43-02 — get_assertion_ctap2 (pv-provider) + provider_get_assertion (pv-ffi): transcripts

Toolchain: Rust 1.97.0 (stable), `cargo test`/`cargo build` workspace; Xcode 26.6.0 (17F113),
`scripts/build-ios.sh`, `scripts/audit-ffi-opaque-handles.sh`, `scripts/check-ios-gate.sh`,
simulator `PV-iPhone16` (UDID `34992BB7-4982-4915-92C7-C7FC987802AF`,
`/private/tmp/pv16.udid`). Recorded 2026-08-21.

Rust/FFI half of the phase's tracer (43-PLAN-CHECK.md B5 split) -- no Swift file touched, no live
Safari harness, `cargo test` alone plus the standing FFI/iOS structural gates.

## 1. `get_assertion_ctap2`'s three behavior-driven tests (Task 1, `ceremony::ctap2_tests`)

```
$ cargo test -p pv-provider --lib -- --nocapture
...
running 7 tests
test ceremony::ctap2_tests::empty_store_rejected ... ok
test tests::origin_mismatch_rejected ... ok
test tests::prf_capable_credential ... ok
test credential_store::tests::passkey_round_trip_is_lossless_for_a_fully_populated_passkey ... ok
test ceremony::ctap2_tests::wrong_rp_id_rejected ... ok
test tests::create_then_get_roundtrip ... ok
test ceremony::ctap2_tests::signature_verifies_against_independent_webauthn_rs ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
```

`signature_verifies_against_independent_webauthn_rs` is the byte-level plumbing proof: seeds a real
credential via `create_provider_credential` (verified by webauthn-rs's own
`finish_passkey_registration`), starts a genuine `webauthn-rs` authentication ceremony to get a real
challenge, builds a `clientDataJSON` embedding that challenge, SHA-256-hashes it into
`client_data_hash` (the exact split an OS-level caller performs -- `get_assertion_ctap2` never sees
or produces a `clientDataJSON` itself), calls `get_assertion_ctap2`, then reconstructs a `webauthn-rs`
`PublicKeyCredential` from the CTAP2 result's raw bytes plus that same JSON and hands it to
`webauthn.finish_passkey_authentication` -- the SAME independent, cross-vendor verifier
`tests/real_rp_verification.rs` (QA-03) uses.

## 2. Falsification proof (QA-02/QA-04) -- corrupted signature genuinely fails

```
$ # signature byte flipped (result.signature[0] ^= 0xFF) immediately before verification
$ cargo test -p pv-provider --lib ctap2_tests::signature_verifies -- --nocapture
...
thread 'ceremony::ctap2_tests::signature_verifies_against_independent_webauthn_rs' panicked at
crates/pv-provider/src/ceremony.rs:509:67:
independent webauthn-rs verifier must accept get_assertion_ctap2's real signature over the SAME
client_data_hash passed in -- proving the byte-level plumbing, not merely that the call returns Ok:
OpenSSLError(ErrorStack([]))
test ceremony::ctap2_tests::signature_verifies_against_independent_webauthn_rs ... FAILED

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
```

Corruption reverted; re-run confirmed green (see §1). The test genuinely detects a broken signature,
not a vacuous pass.

## 3. EXT-10 fast-regression backstop (Task 2, `tests/ctap2_ceremony.rs`)

```
$ cargo test -p pv-provider --lib --test ctap2_ceremony -- --nocapture
...
     Running tests/ctap2_ceremony.rs (target/debug/deps/ctap2_ceremony-da04cbb9302f112f)

running 2 tests
test sign_count_is_always_zero_for_ctap2_assertion ... ok
test sign_count_stays_zero_across_two_consecutive_calls ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
```

(C3 discipline: `--test ctap2_ceremony` scopes by FILE, never a bare name-filter that could silently
match zero tests and still exit 0; combined with `--lib` this run also exercised §1's three
in-module tests in the SAME invocation.)

### Falsification proof -- a nonzero counter genuinely fails

```
$ # assert_eq!(..., 1, ...) substituted for the real 0 expectation
$ cargo test -p pv-provider --test ctap2_ceremony sign_count_is_always_zero_for_ctap2_assertion -- --nocapture
...
thread 'sign_count_is_always_zero_for_ctap2_assertion' panicked at
crates/pv-provider/tests/ctap2_ceremony.rs:94:5:
assertion `left == right` failed: EXT-10 extended to get_assertion_ctap2: ...
  left: 0
 right: 1
test sign_count_is_always_zero_for_ctap2_assertion ... FAILED
```

Reverted; re-run confirmed green (see §3 above).

## 4. Whole workspace remains green

```
$ cargo test --workspace 2>&1 | grep -E "^test result|FAILED|error\["
test result: ok. 74 passed; ...
...
test result: ok. 33 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.38s
(35 suites total, all ok, 0 failed)
```

`cargo clippy -p pv-provider -p pv-ffi --all-targets` produces only pre-existing
`clippy::doc_lazy_continuation` warnings on lines this plan did not touch (the EXT-10 decision-record
comment in `ceremony.rs` and `tests/response_shape.rs`, both predating this plan -- confirmed via
`git diff` line-range comparison).

## 5. `scripts/build-ios.sh` -- FFI surface change, rebuilt XCFramework + Swift bindings (L-10)

```
$ caffeinate -i bash scripts/build-ios.sh
==> variant: plain (no extra features -- the artifact every non-test consumer, including the appex, links)
==> uniffi version (single-sourced): 0.32.0
==> IPHONEOS_DEPLOYMENT_TARGET=18.0 (must match project.pbxproj)
==> Building pv-ffi for aarch64-apple-ios-sim (staticlib, release)
    Finished `release` profile [optimized] target(s) in 26.34s
==> Building pv-ffi for aarch64-apple-ios (staticlib, release)
   ... (fresh device-target compile, first in this worktree, ~3m10s total)
    Finished `release` profile [optimized] target(s) in 3m 10s
==> Generating Swift bindings (uniffi-bindgen-swift)
==> Assembling PvFfi.xcframework
xcframework successfully written out to: .../ios/PasskeyVault/build/PvFfi.xcframework
==> Running the vtool slice gate
==> OK: ios-arm64 (...) matches the expected load command (/^[[:space:]]*platform[[:space:]]+IOS$/)
==> OK: ios-arm64-simulator (...) matches the expected load command (/^[[:space:]]*platform[[:space:]]+IOSSIMULATOR$/)
==> Done. XCFramework: ios/PasskeyVault/build/PvFfi.xcframework
==> Done. Swift bindings: ios/PasskeyVault/build/swift-bindings
```

Generated Swift binding confirms the new export shape:

```
$ grep -n "providerGetAssertion\|FfiProviderAssertionResult" ios/PasskeyVault/build/swift-bindings/*.swift
1879:public struct FfiProviderAssertionResult: Equatable, Hashable {
2390:public func providerGetAssertion(rpId: String, clientDataHash: Data, allowCredentialId: Data?, existingCredentialsJson: String)throws  -> FfiProviderAssertionResult
```

## 6. `scripts/audit-ffi-opaque-handles.sh` -- FFI-02 gate, T-43-02 mitigation confirmed structurally

```
$ bash scripts/audit-ffi-opaque-handles.sh
PASS: generated Swift exposes zero raw-byte accessors beyond exportUserKeyForSession/importUserKeyFromSession,
      and zero handle-carrying structs smuggle a raw-byte field alongside the handle (FFI-02, shapes A/B/C/D)
      audited handle classes: FfiCollectionKey FfiIdentityKey FfiIdentityPublicKey FfiInviteChannel FfiUserKey FfiWrappingKey
      audited handle-carrying structs: FfiAuthMaterial
```

`FfiProviderAssertionResult` carries no handle-typed field at all (only `Vec<u8>`/`Option<Vec<u8>>`
public WebAuthn response bytes), so it needs no allow-list entry -- confirmed by this PASS covering
the freshly rebuilt bindings without any new entry added to `$HANDLE_TYPES`/`$EXPECTED_CLASSES`.

## 7. `scripts/check-ios-gate.sh` -- full composer, all six sub-gates green

```
$ caffeinate -i bash scripts/check-ios-gate.sh
==> running sub-gate: qa05
PASS[qa05]: zero .planning/ commits authored on this branch itself since 6bbee654a1a591970e7c6db4d7c933d580061b07 ...
==> running sub-gate: ffi_build
PASS[ffi_build]: scripts/build-ios.sh completed (both triples built, Swift bindings generated, XCFramework assembled, its own slice gate ran)
==> running sub-gate: ffi_falsifiable
PASS[ffi_falsifiable]: scripts/build-ios.sh --verify-falsifiable proved both slice-gate halves (device+simulator) and the WR-03 pv-ffi-object guard can genuinely fail
==> running sub-gate: ffi_opaque
PASS[ffi_opaque]: bindings provably fresh, and scripts/audit-ffi-opaque-handles.sh reports zero raw-byte accessors outside its sanctioned exceptions
==> running sub-gate: swift_tests
RETRY[swift_tests]: attempt 1 hit the L-41 bindings-transition build failure (xcodebuild exit 65) -- retrying once (known transitional, not a real regression)
PASS[swift_tests]: scheme 'PasskeyVault' present (E9 autocreated); xcodebuild test exit=0 (after 1 L-41 retry); executed-test count=5;
  matched all required FFI identifiers: FfiRoundTripTests/fullRoundTripOnLiteralBytes()
  FfiRoundTripTests/embeddedNulByteSurvivesExportImportRoundTrip() FfiRoundTripTests/embeddedNulByteInNonceIsNotTruncated()
  FfiPanicSafetyTests/nonSentinelInputReturnsNormally() FfiPanicSafetyTests/sentinelInputThrowsCatchableDiscriminatedErrorAndHandleSurvives()
==> running sub-gate: qa_register
PASS[qa_register]: positive control holds -- 150 row(s) parsed across 7 phase section(s), Phase 35's section is among them
PASS[qa_register]: every IN-COVERAGE phase with SUMMARY files on disk has a register section carrying at least one row; all 150 row(s) resolve to a real file:line with a non-empty excerpt
PASS[qa_register]: scripts/check-qa-audit-register.sh reports full coverage over ios/QA-AUDIT-v1.0.md (see its own OK/PASS line above)
==> SUMMARY: executed sub-gate(s): qa05 ffi_build ffi_falsifiable ffi_opaque swift_tests qa_register
```

Exit code: `0`. The scoped Swift test lane (`FfiRoundTripTests`/`FfiPanicSafetyTests`) exercises the
new UniFFI-generated code path (the app target links the freshly rebuilt XCFramework carrying
`provider_get_assertion`) without needing any new Swift test of its own -- this plan adds no Swift
code and the L-41 retry is the SAME known-transitional bindings-transition signature this gate's own
header already documents, not a regression introduced here.

## 8. Post-run simulator cleanup (L-24 discipline)

```
$ xcrun simctl --set testing shutdown all
$ xcrun simctl --set testing delete all
$ xcrun simctl list devices | grep -i "PV-iPhone16\|Booted"
    PV-iPhone16 (34992BB7-4982-4915-92C7-C7FC987802AF) (Booted)
```

Only the base `PV-iPhone16` simulator remains booted; no parallel-testing clones left behind.
