# Plan 42-03 — FFI gate composition, real transcripts

All transcripts below are verbatim tool output captured while executing 42-03-PLAN.md on
2026-08-21, `ios/spike`, HEAD `0cca540511e250744eec29f29570037f932d869d` (Task 1's commit;
unchanged across all of Task 2's mutations, confirmed by `git rev-parse HEAD` before/after).

## Task 1 — full composer run, first time, all four sub-gates green

```
==> running sub-gate: qa05
PASS[qa05]: zero .planning/ commits authored on this branch itself since 6bbee654a1a591970e7c6db4d7c933d580061b07 (excluding $QA05_EXCLUDE_REF=origin/main; positive control: 327 commit(s) found under -- ios/; commit_docs precondition holds)
==> running sub-gate: ffi_build
==> variant: plain (no extra features -- the artifact every non-test consumer, including the appex, links)
==> uniffi version (single-sourced): 0.32.0
==> IPHONEOS_DEPLOYMENT_TARGET=18.0 (must match project.pbxproj)
==> Building pv-ffi for aarch64-apple-ios-sim (staticlib, release)
    Finished `release` profile [optimized] target(s) in 0.20s
==> Building pv-ffi for aarch64-apple-ios (staticlib, release)
    Finished `release` profile [optimized] target(s) in 0.13s
==> Generating Swift bindings (uniffi-bindgen-swift)
==> Assembling PvFfi.xcframework
xcframework successfully written out to: /Users/j5on/.work/projects/passkey-vault-ios/ios/PasskeyVault/build/PvFfi.xcframework
==> Running the vtool slice gate
==> OK: ios-arm64 (pv_ffi-92c02a029ec2a884.pv_ffi.9ce83068b9aca6c2-cgu.6.rcgu.o) matches the expected load command (/^[[:space:]]*platform[[:space:]]+IOS$/)
==> OK: ios-arm64-simulator (pv_ffi-f08fa03416ab3dea.pv_ffi.adaa6d7cb56fb1ac-cgu.8.rcgu.o) matches the expected load command (/^[[:space:]]*platform[[:space:]]+IOSSIMULATOR$/)
==> Done. XCFramework: ios/PasskeyVault/build/PvFfi.xcframework
==> Done. Swift bindings: ios/PasskeyVault/build/swift-bindings
PASS[ffi_build]: scripts/build-ios.sh completed (both triples built, Swift bindings generated, XCFramework assembled, its own slice gate ran)
==> running sub-gate: ffi_falsifiable
==> --verify-falsifiable: proving BOTH halves of the vtool gate CAN fail
[... both slice halves falsified, WR-03 pv-ffi-object guard falsified ...]
==> ALL falsification proofs passed
PASS[ffi_falsifiable]: scripts/build-ios.sh --verify-falsifiable proved both slice-gate halves (device+simulator) and the WR-03 pv-ffi-object guard can genuinely fail
==> running sub-gate: ffi_opaque
OK[ffi_opaque]: freshness precondition holds -- ios/PasskeyVault/build/swift-bindings/pv_ffi.swift exists, is non-empty, and no source under crates/pv-ffi/src/ is newer than it
PASS: generated Swift exposes zero raw-byte accessors beyond exportUserKeyForSession/importUserKeyFromSession, and zero handle-carrying structs smuggle a raw-byte field alongside the handle (FFI-02, shapes A/B/C/D)
      audited handle classes: FfiCollectionKey FfiIdentityKey FfiIdentityPublicKey FfiInviteChannel FfiUserKey FfiWrappingKey
      audited handle-carrying structs: FfiAuthMaterial
PASS[ffi_opaque]: bindings provably fresh (see OK line above), and scripts/audit-ffi-opaque-handles.sh reports zero raw-byte accessors outside its sanctioned exceptions
==> SUMMARY: executed sub-gate(s): qa05 ffi_build ffi_falsifiable ffi_opaque
full gate exit=0
```

## Task 1 — composer-level `--verify-falsifiable` (zero mutation of any real artifact)

Every sub-gate's own FAIL path driven via an overridden path variable (mirrors `gate_qa05`'s
`QA05_CONTROL_PATH` idiom), then `ffi_falsifiable` delegates to `scripts/build-ios.sh
--verify-falsifiable`'s own already-self-falsifying mode rather than duplicating it:

```
==> --verify-falsifiable: ffi_build
    gate_ffi_build with a missing script path exited 1 and named the missing-script guard:
      FAIL[ffi_build]: scripts/build-ios-does-not-exist.sh not found or not readable -- cannot run the pv-ffi build
==> PASS: ffi_build's missing-prerequisite FAIL path is reachable, zero mutation of the real script or any build artifact

==> --verify-falsifiable: ffi_falsifiable
--- ordering-dependency FAIL path (zero mutation -- overridden path only) ---
    gate_ffi_falsifiable with an absent XCFramework path exited 1 and named the ordering dependency:
      FAIL[ffi_falsifiable]: ios/PasskeyVault/build/PvFfi-does-not-exist.xcframework not found -- scripts/build-ios.sh --verify-falsifiable does not rebuild; the ffi_build sub-gate (a plain 'scripts/build-ios.sh' run) must run first in this invocation
==> PASS: the ordering-dependency FAIL path is reachable, zero mutation of any real artifact

--- delegated proof: the underlying slice gate's OWN self-falsification mode (not duplicated here) ---
[... real vtool corruption of both slices + WR-03 guard, all PASS ...]
==> PASS: scripts/build-ios.sh --verify-falsifiable's own proof (both slice-gate halves + the WR-03 pv-ffi-object guard) delegated to, not reimplemented

==> --verify-falsifiable: ffi_opaque
--- missing-bindings FAIL path (zero mutation -- overridden path only) ---
    gate_ffi_opaque with an absent bindings dir exited 1 and named the missing-bindings guard:
      FAIL[ffi_opaque]: no non-empty generated Swift bindings file found under ios/PasskeyVault/build/swift-bindings-does-not-exist (find exit=1) -- run the ffi_build sub-gate (a plain 'scripts/build-ios.sh' run) first
==> PASS: the missing-bindings FAIL path is reachable, zero mutation of any real artifact

--- staleness FAIL path (a SCRATCH COPY of the real bindings file, dated 2000-01-01 -- zero mutation of the real bindings or of crates/pv-ffi/src/) ---
    gate_ffi_opaque against a scratch bindings copy dated 2000-01-01 exited 1 and named staleness:
      FAIL[ffi_opaque]: /var/.../ffi-opaque-staleness/pv_ffi.swift is STALE -- crates/pv-ffi/src/bin/uniffi-bindgen-swift.rs (under crates/pv-ffi/src/) is newer than the generated bindings, so the audit's verdict below would be about code that is no longer there. Re-run the ffi_build sub-gate to regenerate bindings, then re-run this sub-gate.
==> PASS: the freshness precondition's FAIL path is reachable, against a real (copied, never mutated in place) bindings file

==> NOT proven falsifiable in THIS automated mode: scripts/audit-ffi-opaque-handles.sh's own opaque-handle scan (shapes A/B/C/D). [...] recorded as this plan's Task 2 M3 in 42-03-SUMMARY.md, not by this fast composer-level mode. Do not read this invocation's PASS as covering that half.

==> --verify-falsifiable: ALL defined sub-gate falsification proofs passed (qa05 ffi_build ffi_falsifiable ffi_opaque) -- see each sub-gate's own output above for exactly what was, and was not, proven falsifiable in this fast mode
verify-falsifiable exit=0
```

## Task 2 — M1: missing prerequisite (real `mv`, real XCFramework)

```
$ ls ios/PasskeyVault/build/PvFfi.xcframework > /dev/null && echo "xcframework present before move"
xcframework present before move
$ mv ios/PasskeyVault/build/PvFfi.xcframework ios/PasskeyVault/build/PvFfi.xcframework.moved-aside
$ bash scripts/check-ios-gate.sh --only ffi_falsifiable
==> running sub-gate: ffi_falsifiable
FAIL[ffi_falsifiable]: ios/PasskeyVault/build/PvFfi.xcframework not found -- scripts/build-ios.sh --verify-falsifiable does not rebuild; the ffi_build sub-gate (a plain 'scripts/build-ios.sh' run) must run first in this invocation
FAIL: sub-gate 'ffi_falsifiable' failed -- see message above
M1 exit=1
```

Restoration:

```
$ mv ios/PasskeyVault/build/PvFfi.xcframework.moved-aside ios/PasskeyVault/build/PvFfi.xcframework
$ bash scripts/check-ios-gate.sh --only ffi_falsifiable
==> running sub-gate: ffi_falsifiable
[... real vtool falsification proofs, both slices + WR-03 guard, all PASS ...]
PASS[ffi_falsifiable]: scripts/build-ios.sh --verify-falsifiable proved both slice-gate halves (device+simulator) and the WR-03 pv-ffi-object guard can genuinely fail
==> SUMMARY: executed sub-gate(s): ffi_falsifiable
M1 restore exit=0
```

## Task 2 — M2: stale bindings (the WR-05 hole itself, real `touch`, no rebuild)

```
$ ls -la crates/pv-ffi/src/lib.rs ios/PasskeyVault/build/swift-bindings/pv_ffi.swift
-rw-r--r--@ 1 j5on  staff  53399 Aug 19 07:44 crates/pv-ffi/src/lib.rs
-rw-r--r--@ 1 j5on  staff  98585 Aug 21 12:11 ios/PasskeyVault/build/swift-bindings/pv_ffi.swift
$ touch crates/pv-ffi/src/lib.rs
$ ls -la crates/pv-ffi/src/lib.rs ios/PasskeyVault/build/swift-bindings/pv_ffi.swift
-rw-r--r--@ 1 j5on  staff  53399 Aug 21 12:12 crates/pv-ffi/src/lib.rs
-rw-r--r--@ 1 j5on  staff  98585 Aug 21 12:11 ios/PasskeyVault/build/swift-bindings/pv_ffi.swift
$ bash scripts/check-ios-gate.sh --only ffi_opaque
==> running sub-gate: ffi_opaque
FAIL[ffi_opaque]: ios/PasskeyVault/build/swift-bindings/pv_ffi.swift is STALE -- crates/pv-ffi/src/lib.rs (under crates/pv-ffi/src/) is newer than the generated bindings, so the audit's verdict below would be about code that is no longer there. Re-run the ffi_build sub-gate to regenerate bindings, then re-run this sub-gate.
FAIL: sub-gate 'ffi_opaque' failed -- see message above
M2 exit=1
```

This is the exact assertion 35-REVIEW.md's WR-05 named as missing: a source file newer than the
generated bindings is now caught BEFORE the audit is even consulted, naming the specific stale file.

Rebuild restores green (full gate re-run, see below — same run also serves as M4's transcript).

## Task 2 — M3: a real opaque-handle violation (real Rust edit, real rebuild, real revert)

Injected into `crates/pv-ffi/src/lib.rs`, `impl FfiUserKey`:

```rust
    /// TEMP (42-03 Task 2, M3): a deliberately injected raw-byte accessor,
    /// same shape 35-04/40-04 used -- MUST be caught and reverted before
    /// this task ends. Not a real API.
    pub fn temp_leak_raw_bytes(&self) -> Vec<u8> {
        self.0.expose().to_vec()
    }
```

Full gate run (rebuild + audit):

```
$ caffeinate -i bash scripts/check-ios-gate.sh
==> running sub-gate: qa05
PASS[qa05]: ...
==> running sub-gate: ffi_build
[... cargo compiles pv-ffi, bindings regenerate, xcframework reassembles, slice gate OK x2 ...]
PASS[ffi_build]: scripts/build-ios.sh completed (...)
==> running sub-gate: ffi_falsifiable
[... vtool falsification proofs, both slices + WR-03 guard, all PASS ...]
PASS[ffi_falsifiable]: scripts/build-ios.sh --verify-falsifiable proved both slice-gate halves (...)
==> running sub-gate: ffi_opaque
OK[ffi_opaque]: freshness precondition holds -- ios/PasskeyVault/build/swift-bindings/pv_ffi.swift exists, is non-empty, and no source under crates/pv-ffi/src/ is newer than it
FAIL: raw-byte accessor(s)/field(s) found on or alongside a key-handle type outside the FFI-03 sanctioned exception (exportUserKeyForSession/importUserKeyFromSession) or the shape-C allowlist:
ios/PasskeyVault/build/swift-bindings/pv_ffi.swift [FfiUserKey method]: open func tempLeakRawBytes() -> Data  {

FAIL[ffi_opaque]: scripts/audit-ffi-opaque-handles.sh exited non-zero -- see its own output above
FAIL: sub-gate 'ffi_opaque' failed -- see message above
M3 exit=1
```

Note the freshness precondition itself correctly reports `OK` (the bindings ARE fresh — they were
just regenerated with the leak baked in) — this is the SECOND, distinct mechanism inside
`gate_ffi_opaque` (the delegated audit call) failing, not the freshness check from M2.

Revert:

```
$ git checkout -- crates/pv-ffi/src/lib.rs
$ git diff --stat -- crates/pv-ffi/src/lib.rs
(empty)
```

Rebuild restores green (full gate re-run — exit 0, all four sub-gates green, confirmed via a clean
run redirected to a log file: `post-revert full gate exit=0`).

## Task 2 — M4: the slice gate (inherited coverage, not newly proven here)

`gate_ffi_falsifiable` is, by construction, `bash scripts/build-ios.sh --verify-falsifiable` —
every full composer run above (Task 1's first run, the M1 restoration, the M2/M3 rebuilds) carries
this sub-gate's own real corruption-and-restore proof for BOTH the device and simulator vtool slice
checks, plus the WR-03 "slice must contain pv-ffi's own code" guard. This plan does **not** newly
prove that coverage — it delegates to and captures `build-ios.sh`'s own pre-existing
`--verify-falsifiable` mode, unmodified (`git diff --stat -- scripts/build-ios.sh` empty
throughout this plan).

**Explicitly undemonstrated (35-REVIEW.md WR-10, carried to 42-06's register, not fixed here):**
the DEVICE slice's own half of the vtool gate has been falsified (`falsify_slice "ios-arm64" ...`
runs and passes every time above), so WR-10 as originally written ("the device slice's
falsification never having been demonstrated") is now empirically stale as of `build-ios.sh`'s
current state — both halves ARE falsified in every transcript above. What remains genuinely
undemonstrated, and is NOT this plan's job to fix (DR-42-A: find and record, do not repair): the
other three `35-REVIEW.md` findings in `build-ios.sh` (the unset deployment target coupling to a
legacy load command, the arbitrary extracted object question, the dead version-parse branch) — see
`42-03-SUMMARY.md`'s own deferred-items note for exact routing to 42-06.

## Final state

```
$ git diff --stat -- crates/pv-ffi/src/lib.rs
(empty)
$ git status --porcelain | grep -v '\.planning/' || echo "(no non-planning changes)"
?? .agents/
?? .claude/skills/
?? skills-lock.json
$ echo "before: 0cca540511e250744eec29f29570037f932d869d"
$ echo "after:  $(git rev-parse HEAD)"
before: 0cca540511e250744eec29f29570037f932d869d
after:  0cca540511e250744eec29f29570037f932d869d
```

(`.agents/`, `.claude/skills/`, `skills-lock.json` are pre-existing untracked items from before
this plan started, unrelated to this task.)
