# iOS Spike — Running Log

**Branch:** `ios/spike` (worktree at `/Users/j5on/.work/projects/passkey-vault-ios`)
**Obligation:** `docs/IOS-HANDOFF.md` §8 — `.planning/` is deliberately never committed from this
worktree, so anything learned there dies with it. This file is where knowledge is kept instead.

**How to read this file.** Claims are split into **Verified** (a command was run, output observed,
and the command was shown capable of failing) and **Assumed / Unverified** (plausible, not proven).
That separation is the point. If this file ever disagrees with the code, the code wins and this
file is the bug.

---

## Status of the spike

| Area | State |
|---|---|
| Platform viability (PRF on iOS) | **Verified present in SDK surface.** Runtime behaviour unproven. |
| `pv-core` / `pv-provider` native iOS build | **Verified** — real artifacts, correct Mach-O platform |
| Xcode project | App + Unit + UI test targets. `PasskeyVaultTests` links `PvFfi.xcframework` and runs 6 real tests against `pv-core`; the App target still holds only Xcode's template code |
| FFI boundary | **Delivered and verified** (Phase 35, commits `f6cb883` … `37c1ff7`). `crates/pv-ffi` (UniFFI `=0.32.0`, proc-macro mode), `scripts/build-ios.sh` (XCFramework + `vtool` slice gate), `scripts/audit-ffi-opaque-handles.sh` (opaque-handle gate over the *generated* Swift), 11 Rust tests + 6 Swift tests green. IOS-06 **decided** (UniFFI) — see §1; what was learned building it — see §2.5. **Proof limit:** simulator only; the device slice is built and its Mach-O platform verified, never run |
| Credential provider extension | Not attempted |
| Server sync / UI | Not attempted |

**Milestone.** The spike graduated into milestone **v1.0 iOS — Vault w kieszeni** on 2026-08-11.
Scope agreed with Bartek: full app UI + **password** AutoFill provider + biometric (Face ID / Touch ID)
unlock + family management. Passkey provider and PRF unlock are **deferred and conditional** — they
ship only if they turn out cheap, and "not done, deferred, here is why" is an acceptable outcome.

iOS was explicitly lifted out of `PROJECT.md`'s *Out of Scope* (where it sat as "v2"), because the two
assumptions that put it there — that the crypto core might not build for Apple targets, and that PRF
might be unavailable — both turned out false, earlier than expected. **Android and Windows stay in v2.**

The milestone's planning artifacts (`REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, and four research
files under `.planning/research/ios/`) live in `.planning/`, which **is never committed from this
worktree** (handoff §7 — `main` rewrites it constantly while running v0.5 in parallel). That is exactly
why the durable findings are duplicated here instead of only there.

---

## 1. Decisions

Recorded in the `KEY-05` / `EXT-10` style the project uses: the rejected alternative is named and
rejected on its merits, not merely omitted. IOS-01…IOS-05 were taken in
`docs/superpowers/specs/2026-08-11-ios-spike-design.md` §3; they are restated here because that
spec lives under `docs/superpowers/` and this file is the one the handoff points at.

| ID | Decision | Why | Rejected |
|---|---|---|---|
| IOS-01 | Work in git worktree on `ios/spike` | A live session was finishing v0.5 on `main`; a shared working tree risks cross-contaminated commits | Plain branch on the `main` checkout |
| IOS-02 | Xcode project = App + tests only, no extension target yet | Handoff §9: one thin end-to-end slice before breadth. The extension proves nothing until the FFI works | Creating the AutoFill Credential Provider target up front |
| IOS-03 | Minimum deployment target **iOS 18.0** | Every PRF symbol is `iOS 18.0+`. Xcode's default 26.5 discards supported devices for zero gain | Xcode default 26.5; iOS 17 (passkey provider, but **no** PRF) |
| IOS-04 | Simulator-only, Team = None, no signing | Free Apple ID, not the $99 program. Simulator builds need no signing | Paying before the concept is proven |
| IOS-05 | Bundle id `cloud.blonie.PasskeyVault` | Matches the hosted instance domain `vault.blonie.cloud` | Reverse-DNS on a personal domain |

### IOS-06 — FFI mechanism: **DECIDED — UniFFI**

**Decision: UniFFI, crate `uniffi = "=0.32.0"`, proc-macro mode (no `.udl`).**
**Rejected: hand-written C ABI** (raw pointers, `#[no_mangle] extern "C"` functions, manual Swift
wrapper).

This was previously recorded as a recommendation, not yet decided, because UniFFI had never been
built against this repo's actual `pv-core`/`pv-provider` types — the earlier recommendation was evidence from other
codebases, not this one. This session (2026-08-11, `.planning/phases/35-granica-ffi-rust-swift-i-szkielet/35-RESEARCH.md`
"IOS-06 Decision — evidence gathered this session") closed that gap: `cargo info uniffi` confirmed
`0.32.0` is still current on crates.io (MPL-2.0, `github.com/mozilla/uniffi-rs`), and
`gsd-tools query package-legitimacy check --ecosystem crates uniffi` returned `verdict: OK`
(published 2020-09-11, 263,551 weekly downloads, no postinstall script). The decision is now made
against this repo's real types, not merely cited from elsewhere.

Why UniFFI wins on merit, now confirmed rather than assumed:

- `#[derive(uniffi::Object)]` on an `Arc<T>`-backed type gives exactly the opaque-handle guarantee
  `pv-wasm` already establishes: **no byte accessor is generated unless the Rust wrapper explicitly
  exports one**. The constraint below is enforced by the generator, not by reviewer vigilance.
- Production precedent in the closest possible neighbour: Element X iOS ships `matrix-sdk-ffi` — a
  real, E2E-encrypted app with a Rust core driving Swift. Also Mozilla's own application-services.
- **The decisive argument for *this* setup:** the milestone will be executed by an autonomous run with
  no human in the loop. Hand-written raw-pointer memory management under those conditions is a far
  larger failure surface than driving a well-tested generator. It also breaks from the
  `wasm-bindgen`-generated pattern `pv-wasm` already set.

**Why hand-written C ABI loses, on the merits, not by default.** The opaque-handle guarantee
(FFI-02) would depend entirely on reviewer vigilance across every hand-written accessor in an
autonomous run with no human in the loop — exactly the failure mode `pv-wasm`'s own header comment
already calls out as the reason `wasm-bindgen` was chosen over hand-rolled JS glue. Manual
`Vec<u8>`→`UnsafeBufferPointer` marshaling and manual Swift-side memory-management wrapper code would
be written entirely by that same autonomous run, with zero generator-enforced invariants. Panic
safety (see below) would also need `catch_unwind` re-added by hand at every single `#[no_mangle]`
boundary function — a much larger, more error-prone surface for the identical property UniFFI gives
for free. Both properties this decision cares about (opaque handles, panic safety) are structurally
*harder* to guarantee by hand, and the workspace already has a `wasm-bindgen`-shaped precedent to
follow. UniFFI wins on the same merits this file originally named — now confirmed against the real
types instead of assumed.

**Error type normalization — concrete incompatibility found this session, not hypothetical.**
Neither `pv-core::CryptoError` nor `pv-provider::PvProviderError` can derive `uniffi::Error` directly:
both are `thiserror`-derived enums with an `InvalidInput(&'static str)` variant, and UniFFI has no
builtin-type mapping for an owned enum variant holding `&'static str`. Resolution: `pv-ffi` defines
its **own** `FfiError` enum (`#[derive(Debug, uniffi::Error)]`), mirroring the variant names but with
`String` instead of `&'static str`, plus `From<CryptoError> for FfiError` (and
`From<PvProviderError> for FfiError` if/when `pv-provider` is touched) conversions at the boundary —
structurally identical to `pv-wasm`'s existing `to_js_err`/`to_js_str_err` pattern, just typed instead
of stringly-typed. `pv-core` and `pv-provider` stay at zero `uniffi` dependency; `CryptoError` and
`PvProviderError` are never modified.

**Panic safety (CP-3).** UniFFI wraps every `#[uniffi::export]` call in
`std::panic::catch_unwind` automatically [CITED: mozilla/uniffi-rs
docs/manual/src/internals/rust_calls.md], converting a caught panic into a normal foreign-side error
(a Swift-visible error/exception) instead of a process abort. **This is conditional on the crate never
setting `panic = "abort"`** in any `[profile.*]` section — confirmed absent workspace-wide this
session (`grep -rn panic Cargo.toml crates/*/Cargo.toml` returned nothing). This is recorded here as a
standing constraint on `crates/pv-ffi`'s own `Cargo.toml` going forward: it must never set
`panic = "abort"`, or this guarantee silently stops applying.

**Un-zeroized Swift copies — structural amendment to CP-4, not a gloss-over.** `pv-wasm`'s
`import_user_key_from_session`/`from_password` take `&mut [u8]`, a signature that lets
`wasm-bindgen`'s mutable-slice marshaling copy the *caller's own* JS buffer back out zeroized after
the call — a mechanism unique to how `wasm-bindgen` bridges JS `Uint8Array`s, not a general FFI
property. **UniFFI has no equivalent.** UniFFI only supports immutable `&[u8]` and owned
`Vec<u8>`/`bytes`; `&mut [u8]`/`&mut Vec<u8>` are not valid `#[uniffi::export]` argument types. So on
the `pv-ffi` boundary: Rust takes ownership of an owned `Vec<u8>`, `Zeroizing`-wraps its own copy, and
zeroizes it on drop/early-return exactly like the rest of `pv-core` — but **the Swift-side caller's
original `Data`/`[UInt8]` is NOT retroactively wiped by the call**, unlike the `pv-wasm` original. This
is accepted as a bounded residual risk, the same posture `pv-wasm`'s own header already takes for JS,
with a best-effort caller-side mitigation: call `data.resetBytes(in: 0..<data.count)` on the Swift
side immediately after the call returns.

Non-negotiable constraint on the mechanism that won: mirror `crates/pv-wasm`'s **opaque-handle**
design. Raw key bytes must never cross the boundary except through explicitly named, auditable
functions. An FFI that returns key bytes "for convenience" is a design error, not a tradeoff.

**Amendment from architecture research — this changes the security model, not just the plumbing.**
In `pv-wasm`, `export_user_key_for_session` / `import_user_key_from_session` exist *only* for the MV3
idle-kill case and are documented as a sanctioned one-off exception. On iOS the host app and the
AutoFill extension are **two independently-scheduled OS processes with no shared address space** —
App Groups and Keychain access groups are storage-level sharing, not shared memory. So that export/
import pair becomes the **normal, load-bearing mechanism** by which an unlocked vault reaches the
second process at all. It must be a first-class, permanently-supported part of `pv-ffi`'s public API,
documented with the rigor of `pv-wasm/src/lib.rs`'s header — not apologised for as unusual.

### DR-1 — Data-sharing model: **hybrid (Keychain + App Group)**

**Decision: hybrid.** Both the shared keychain access group (`$(AppIdentifierPrefix)cloud.blonie.
PasskeyVault`) and the App Group container (`group.cloud.blonie.PasskeyVault`) are load-bearing —
Keychain for the User Key envelope (small, security-critical), App Group for the ciphertext cache
Phase 39 will write (larger, file-based).

**Rejected: Keychain-only (MP-2 fallback).** Rejected on its merits, not by omission: Keychain-only
was the fallback the pitfalls research (L-5) recommended defensively, on the unconfirmed premise that
App Groups might be refused on a free personal team. Phase 36, Plan 36-02's E2 disproves that premise
on this simulator (see below) — the App Group container resolves, identically, for both the host app
(outside, via `simctl`) and the extension (inside, via `FileManager`, from the real running process).
Falling back to Keychain-only anyway would forfeit App Group's file-based storage model for no
measured benefit, forcing Phase 39's ciphertext cache through Keychain's item-size-oriented API
instead — a real cost with no offsetting gain once the premise it was hedging against is disproven.

**Evidence:**
- E2 (`ios/AUTOFILL-FEASIBILITY.md` §"E2"): `ios/evidence/36/appgroup-host.txt` (outside, host bundle,
  `simctl get_app_container … groups`) and `ios/evidence/36/appgroup.log` (inside,
  `AppGroupProbe.swift`'s `PVPROBE|stage=appgroup` line, from the real extension process) resolve to
  the byte-identical path, including the container UUID
  (`8B89C66D-A449-4832-9A27-125948A6E8B5`). Negative control:
  `ios/evidence/36/appgroup-negative-control.txt` (never-installed bundle, same command shape, fails).
- E3 (`ios/AUTOFILL-FEASIBILITY.md` §"E3"): `ios/evidence/36/keychain.log` — a fixed 32-byte test
  vector written by the host app (`ProbeSeeder.swift`) is read back byte-for-byte inside the extension
  (`KeychainProbe.swift`, `status=0 bytes=32 equal=true`), with the missing-entitlement negative
  control firing (`status=-34018`) and the equality assertion itself demonstrated falsifiable
  (one-byte mutation → `equal=false` → reverted → `equal=true`).

**Residual risk carried forward, verbatim from `Ograniczenie dowodu`:** this result is true for **the
simulator under a free Apple ID** specifically. The simulator path has no entitlement-issuing authority
at all — no provisioning profile, no `amfid`/`taskgated` — so this decision does not extrapolate
automatically to hardware; the device slice has never been run (see the status table above). Apple's `APP_GROUPS`
capability-table `supportedProductTypes` field is silent (not negative) on `app-extension` product
types, and `simctl get_app_container` itself cannot address extension bundle ids at all on this
toolchain (a tool-registry limitation, recorded in E2, not an entitlement signal) — the equality proof
above rests on the extension's own in-process resolution rather than a second outside `simctl` call for
exactly that reason.

**Consequences named for the phases that consume this decision:**
- **Phase 39** (sync + offline cache): the ciphertext cache the host app writes for a cold-launched
  extension to read lives in the App Group container (`group.cloud.blonie.PasskeyVault`), not
  Keychain. SYNC-03's ciphertext-only constraint is Phase 39's to enforce; this plan wrote only a fixed
  labelled test vector into both storage mechanisms, never real vault data.
- **Phase 41** (AutoFill for passwords): the extension reads the User Key envelope from the shared
  keychain access group (the mechanism E3 proves), and the ciphertext cache from the shared App Group
  container (the mechanism E2 proves) — both mechanisms proven live from inside the real running
  `.appex` process, not inferred from the host app's own view.

---

## 2. Verified against reality (2026-08-11)

### 2.1 PRF is available on iOS in both directions — iOS 18.0+

Independently re-checked, not taken from the spec.

```bash
SDK=$(xcrun --sdk iphoneos --show-sdk-path)
grep -n "prf" "$SDK/System/Library/Frameworks/AuthenticationServices.framework/Modules/AuthenticationServices.swiftmodule/arm64e-apple-ios.swiftinterface"
```

15 hits. Both halves of the product's value proposition are expressible:

- **Provider** (serving passkeys to other people's sites): `ASPasskeyAssertionCredentialExtensionInput.prf`
  (line 24), `…Output.prf` (36), `ASPasskeyRegistrationCredentialExtension{Input,Output}.prf` (72, 62)
- **Client/RP** (PRF-unlocking our own vault): `ASAuthorizationPlatformPublicKeyCredentialAssertionRequest.prf`

**Boundary of this evidence:** it proves the **API exists in the SDK**. It does **not** prove PRF
works at runtime through a real credential-provider extension. Nobody has checked that. Do not let
the two get conflated — see §4.

### 2.2 `pv-core` and `pv-provider` build natively for both iOS triples

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
cargo build -p pv-core     --target aarch64-apple-ios-sim   # and --target aarch64-apple-ios
cargo build -p pv-provider --target aarch64-apple-ios-sim   # and --target aarch64-apple-ios
```

All four combinations compile clean. `pv-provider` matters more than `pv-core` here: it drags in
`passkey-types` / `passkey-authenticator` / `passkey-client` (all pinned `=0.5.0`), `p256`, `coset`,
`ciborium` — that is where a portability surprise would have lived, and there wasn't one.

Handoff §10 listed `pv-core`'s Apple portability as **inferred** from it having no I/O and no
`cfg(target_arch)` gating. It is now **observed**. The discipline of keeping `pv-core` pure paid off
exactly as intended.

Artifacts, not just a green log line (`Finished` on its own is not evidence):

| Target | `libpv_core.rlib` | `libpv_provider.rlib` |
|---|---|---|
| `aarch64-apple-ios-sim` | 1.9M, arm64 | 8.4M, arm64 |
| `aarch64-apple-ios` | 1.9M, arm64 | 8.4M, arm64 |

Falsifiability check: `cargo build -p pv-core --target aarch64-apple-tvos` (target not installed)
exits **101**. The passing check can fail, so passing means something.

### 2.3 Deployment target is 18.0 *according to the build system*

`project.pbxproj` had `IPHONEOS_DEPLOYMENT_TARGET = 26.5` in all four build configurations —
Xcode's default, and wrong per IOS-03. Changed to `18.0`, then verified through the build system
rather than by re-reading the file:

```bash
xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj -target PasskeyVault -showBuildSettings
```

→ `IPHONEOS_DEPLOYMENT_TARGET = 18.0`, `PRODUCT_BUNDLE_IDENTIFIER = cloud.blonie.PasskeyVault`
(IOS-05 confirmed), `SDKROOT = …/iPhoneOS26.5.sdk`.

Reading the edited file back would only have proven the edit landed, not that Xcode honours it.

### 2.4 Environment

| Item | Value |
|---|---|
| Xcode | 26.6 (17F113), SDK iPhoneOS26.5 |
| rustc / cargo | 1.97.0 |
| Rust targets installed | `aarch64-apple-darwin`, `aarch64-apple-ios`, `aarch64-apple-ios-sim`, `wasm32-unknown-unknown` |
| Workspace members | `pv-core`, `pv-server`, `pv-wasm`, `pv-provider`, **`pv-ffi`** (added by Phase 35 — this is the coordination point with `main` that handoff §7 warned about, and it has now been triggered) |

### 2.5 The FFI boundary, and what building it against the real types taught

Phase 35. Everything below was found by building it, not by reading about it.

**What exists.** `crates/pv-ffi` is a thin UniFFI layer over `pv-core`, mirroring `crates/pv-wasm`'s
opaque-handle design: `FfiUserKey` and `FfiWrappingKey` are `#[derive(uniffi::Object)]` handles with
no `Debug`/`Display`/`Clone`/serde derive and no byte accessor, and the *only* functions that pass raw
key bytes are the two explicitly named ones (`export_user_key_for_session` /
`import_user_key_from_session`, FFI-03). That is not asserted from the Rust source — it is checked
against the **generated Swift** by `scripts/audit-ffi-opaque-handles.sh`, because the Rust source is
not what Swift can call.

**UniFFI's type mapping is the constraint, and it bites in two specific places against *these* types.**

1. **`&'static str` in an error variant has no UniFFI mapping.** Both `pv_core::CryptoError` and
   `pv_provider::PvProviderError` carry `InvalidInput(&'static str)`. UniFFI can pass `&str` as a
   *function argument* (`[ByRef]`, valid for one call), but there is no builtin mapping for an owned
   enum variant holding one, so neither enum can derive `uniffi::Error`. Absorbed in
   `crates/pv-ffi/src/error.rs` as a separate `FfiError` with `String` payloads plus
   `From<CryptoError>` — the same shape `pv-wasm` already uses for JS. `pv-core` was not modified (P2).
2. **`&mut [u8]` has no UniFFI equivalent at all**, and this one is a *security-model* downgrade, not
   plumbing — it is the CP-4 residual risk. `pv-wasm`'s `from_password`/`import_user_key_from_session`
   take `&mut [u8]`, which lets `wasm-bindgen`'s mutable-slice marshaling copy the caller's own JS
   buffer back out **zeroized**. UniFFI supports only immutable `&[u8]` and owned `Vec<u8>`. So
   `pv-ffi` takes owned `Vec<u8>` and `Zeroizing`-wraps its own copy — **the Swift caller's original
   `Data` is not retroactively wiped by the call.** Mitigation is caller-side and best-effort:
   `data.resetBytes(in: 0..<data.count)` immediately after the call returns. Two further Rust-side
   copies are outside this boundary's control and are disclosed rather than hidden: UniFFI's
   intermediate `RustBuffer` for every `Vec<u8>`/`String` crossing, and `decrypt_item`'s returned
   `String` / `encrypt_item`'s accepted `String`, which hold item plaintext un-zeroized. That last one
   should become an opaque handle before Phase 43 puts passkey private keys through it.

**`Result<T, E>` vs bare `T` decides whether a caught panic is catchable — this is load-bearing, and
it was nearly missed.** UniFFI wraps every `#[uniffi::export]` call in `catch_unwind`, but it emits a
Swift `throws` wrapper **only** for a Rust signature returning `Result<T, E: uniffi::Error>`. A bare
return generates a NON-throwing Swift wrapper that force-unwraps the call with `try!` — so a panic
that `catch_unwind` genuinely *did* catch is converted, on the Swift side, into an uncatchable
`fatalError`: a process kill, which in an AutoFill extension is the worst available outcome. Every
export in `crates/pv-ffi` now returns `Result`, including `FfiUserKey::generate()`, which does have a
real (if remote) panic path via `OsRng::fill_bytes`. The single deliberate exception,
`export_user_key_for_session`, is audited in a table in that file's own header.

**The FFI-06/CP-3 panic proof rests on a DELIBERATELY SYNTHETIC vector, and must never be read as
more.** No attacker-reachable panic was found in `pv-core`/`pv-provider` — so rather than dress one
up, `crates/pv-ffi/src/panic_probe.rs` carries a single clearly-labelled synthetic `panic!()`, driven
by a sentinel input, never called by production Swift code, behind the `ffi06-probe` Cargo feature.
Honesty bound on the supporting evidence, too: the "no reachable panic exists" claim rests on a grep
of *first-party source only*, which cannot see into `rand_core`/`argon2`/`chacha20poly1305`, where the
only real ones live. The proof that a panic is caught, discriminated from an ordinary `FfiError`, and
leaves the handle usable is real; the claim that no genuine vector exists is narrower than it sounds.

**Server-supplied `KdfParams` are now bounded at this boundary.** `kdf_params_json` arrives from
`POST /api/auth/prelogin` — untrusted by construction. `argon2::Params::new` accepts `m_cost_kib` up
to `0x0FFFFFFF` (256 GiB) and then allocates and writes that much, which is a process kill rather than
a catchable error, so `crates/pv-ffi/src/lib.rs` rejects out-of-range values *before* anything is
allocated (96 MiB / t=10 / p=8 ceilings; production is 64 MiB / t=3 / p=4). Measured while proving it:
on macOS `Vec::<u8>::with_capacity(268435455 * 1024)` **succeeds** (lazy VA reservation) on a 16 GB
host, so the "allocation failure is an abort" reasoning is only half the story — on Darwin the
realistic shape is a memory blow-up, not a clean abort. The ceiling is a **crash guard, not a memory
budget**: 96 MiB is not proven survivable in an extension, and FILL-06 must tighten it once a real
number exists. It is also upper-bounds-only — a hostile server sending *weak* params is a real,
still-open downgrade attack that a constant here cannot answer.

**Build-system recipes that took a real failure each to find.**

- `uniffi-bindgen-swift` needs **two** invocations, not one: headers+modulemap into a `Headers/` dir
  with `--module-name pv_ffiFFI`, and `--swift-sources` alone into a separate dir. The module name is
  not cosmetic — the generated `.swift` always does `#if canImport(pv_ffiFFI)`, so any other name
  makes the import silently fall through the `#if` and every FFI symbol go unresolved.
- **Do NOT pass `--xcframework` to the headers invocation.** It emits a `framework module`
  declaration, whose `header "..."` entry Clang resolves relative to a `<Name>.framework/Headers/`
  *bundle*, not to the directory the modulemap lives in. Our headers are a plain `-I` directory, so it
  fails with `header 'pv_ffiFFI.h' not found` with the file sitting right next to the modulemap. The
  flag and `xcodebuild -create-xcframework` share a name by coincidence, not by requirement.
- `PasskeyVaultTests` needs `ENABLE_USER_SCRIPT_SANDBOXING = NO` (the Run Script writes outside
  DerivedData and shells out to cargo/xcodebuild) and `SWIFT_ENABLE_EXPLICIT_MODULES = NO` (Xcode 26's
  default explicit-module Swift driver never discovers a hand-linked XCFramework's C module through a
  header search path). Both found by real build-for-testing failures. Keep them confined to the test
  target when Phase 36 adds an extension target.
- **`ffi06-probe` is `default = true`, and that is accepted, time-bound debt.**
  `#[cfg(debug_assertions)]` was correctly rejected as the alternative — `[profile.release]` sets
  `debug-assertions = false` and `build-ios.sh` builds `--release`, so the probe would have been
  compiled out of the very XCFramework its own test links against. Default-on was accepted only
  because Phase 35 builds exactly one consumer (`PasskeyVaultTests`). **The moment a second build path
  exists — the app target, likely Phase 38 — flip it to `default = []` and add `--features
  ffi06-probe` to the test-only `cargo rustc` lines in `scripts/build-ios.sh`.**

---

## 3. Landmines

### L-1 — The Objective-C headers lie about PRF

**The single most expensive trap found so far. It nearly killed the spike on day one.**

The ObjC headers for the provider-side extension types expose **only `largeBlob`**. A
case-insensitive grep for `prf` across every `ASPasskey*.h` and `ASCredentialProvider*.h` in the SDK
returns **zero hits**. Read naively that says *"third-party credential providers cannot do PRF on
iOS"* — a confident, well-evidenced, completely wrong conclusion.

Cause: those classes are `NS_REFINED_FOR_SWIFT`. Swift does not see the ObjC class at all; it sees a
*different* overlay struct declared in the `.swiftinterface`, carrying members the header never
mentions. Apple's own doc URLs hint at it with the `-swift.struct` suffix.

**Rule: for any AuthenticationServices question the `.swiftinterface` is ground truth, never the
ObjC header.** Same shape as landmine D-21 (`passkey_types::Bytes` serializing as a JSON byte
array, see the comment in `crates/pv-provider/Cargo.toml`): a type that looks right in one
representation and is wrong in the one that actually ships.

> **AMENDMENT (2026-08-11, Phase 36 research) — the rule above is recorded TOO BROADLY and must not
> be applied to AuthenticationServices wholesale.**
>
> The **password-AutoFill** headers contain **zero** `NS_REFINED_FOR_SWIFT` and **are** ground truth.
> Going the other way is just as wrong as the original trap: the `.swiftinterface` is a *partial
> overlay*, and it contains **no `ASCredentialProviderViewController` at all** — so a check that
> consults only the `.swiftinterface` would conclude the base class of the entire extension does not
> exist.
>
> L-1 holds for the **passkey/PRF types it was actually found on**, not for the framework as a whole.
> The correct rule is the weaker, true one: *for any given AuthenticationServices type, check both
> representations and reconcile them* — neither is ground truth on its own. A third instance of the
> same shape turned up in Phase 37 research (`kSecAccessControlPrivateKeyUsage`'s header prose "(i.e.
> sign operation)" is not the capability surface), so the shape recurs; the over-broad rule is what
> does not survive.

### L-2 — `lipo -info` cannot tell an iOS device slice from a simulator slice

Both report bare `arm64`. The difference lives in the Mach-O load command, and it is the difference
between a library that links into a simulator app and one that does not:

```bash
ar x target/aarch64-apple-ios-sim/debug/libpv_core.rlib <some>.o && vtool -show-build-version <some>.o
```

| Triple | Load command | min OS |
|---|---|---|
| `aarch64-apple-ios-sim` | `LC_BUILD_VERSION`, `platform IOSSIMULATOR` | 14.0 |
| `aarch64-apple-ios` | `LC_VERSION_MIN_IPHONEOS` | 10.0 |

Consequences to carry into the XCFramework step:

1. **Verify slices with `vtool`, not `lipo`.** A build script that "checks the architecture" with
   `lipo -info` is a check that cannot fail — it says `arm64` either way.
2. Rust's own minimums (14.0 sim / 10.0 device) are **below** our IOS-03 floor of 18.0, so there is
   no conflict today. They are also not *governed* by the Xcode setting — cargo does not read
   `project.pbxproj`. If the floor ever needs raising on the Rust side it must be set explicitly
   for cargo (`IPHONEOS_DEPLOYMENT_TARGET` in the build script's environment).
3. The device target still emits the **legacy** `LC_VERSION_MIN_IPHONEOS` rather than
   `LC_BUILD_VERSION`. Worth knowing if a tool downstream only understands the modern form.

### L-3 — `PIPESTATUS` is empty in this project's shell

The shell here is **zsh**, where the array is `$pipestatus`; `PIPESTATUS` is bash-only. A loop
written as `cargo build … | tail -25; echo "exit=${PIPESTATUS[0]}"` prints `exit=` — an empty
status that looks like a pass and can never report a failure. This was hit live while running the
builds above (the builds were fine; the *check* was worthless).

That is the third distinct member of a class this repo has already paid for — a pipe to `tail`
discarding the real status, a `||` fallback that could never fire, and `cargo test --lib <mod>::`
filters matching zero tests (handoff §0). **Any verification command added to this spike must be
demonstrated failing at least once before its passing is believed.**

### L-4 — Spec §6 ordered a destructive command against a path that does not exist

`docs/superpowers/specs/2026-08-11-ios-spike-design.md` §6 states that `ios/PasskeyVault/.git`
exists (one commit, `8fd2fc4 "Initial Commit"`) and must be removed with `rm -rf`. It does **not**
exist:

```bash
find ios -name .git      # no output
git status --porcelain=v1 --untracked-files=all -- ios   # plain untracked files, no gitlink
```

Harmless in outcome, instructive in kind: the spec was written by a session that could not mutate
this worktree and therefore could not re-check its own claim. `rm -rf` was **not** run against an
unverified path. Correction recorded rather than silently absorbed.

---

### L-5 — Two research agents directly contradicted each other on App Groups

Not a landmine hit yet; a landmine **located**. Recorded because believing either side without proof
would design the whole cross-process story wrong.

| Source | Claim |
|---|---|
| architecture research | The ciphertext cache lives in a **shared App Group container**; the User Key envelope in a shared Keychain access group. The design is built on both existing. |
| pitfalls research | **App Groups are unavailable on a free personal team.** That forces Keychain-only sharing "now rather than later". |

Both flagged their own confidence as less than certain. If pitfalls is right, the architecture
design does not stand on Bartek's account, and this becomes the trigger for the $99 Apple Developer
Program decision. **It must be settled by a real build that either gets the entitlement or is refused
— before any code depends on App Groups existing.** Related unknown, also unconfirmed: whether
`keychain-access-groups` needs the same paid-account allowlisting as the credential-provider
entitlement.

### L-6 — Argon2id may not fit in the extension's memory budget

The project's Argon2id parameters are **64 MiB** (`m_cost_kib: 65536`). Credential-provider
extensions are reported to sit under roughly a **120 MB** ceiling, enforced by a *silent jetsam kill*
— the process dies, it does not throw. That would put our KDF at about half the entire budget of the
process that has to run it.

Two honesty notes: the ~120 MB figure is **single-vendor sourced, not Apple-documented**, and nobody
has measured ours. A unit test cannot see this at all — it only appears under real memory pressure on
a real run.

If it does not fit, lowering KDF cost *for the extension path* is a **security decision needing its
own record**, never a quiet tuning commit.

**Update (2026-08-11, Phase 36 research) — now measured once, and the ceiling got *weaker*, not
stronger.** A standalone binary using the exact `argon2 = "=0.5.3"` pin from `crates/pv-core`, built
for `aarch64-apple-ios-sim` and run **inside the iOS 26.5 simulator**, showed the production profile
at **~64.06 MB `phys_footprint`, transient and fully released**. That materially de-risks this
landmine, with three caveats that must survive: (a) the ~120 MB figure is *weaker* than
"single-vendor sourced" — it traces to a support-KB article with no attribution and no method; (b) the
jetsam documentation speaks of a *resident* limit while `os/proc.h` speaks of a *dirty memory* limit
and `phys_footprint` — **different metrics** that merely coincide for a 64 MiB arena written
end-to-end; (c) the measurement was taken in a **host-app** process, not inside a running
credential-provider extension, so it does **not** satisfy Phase 36's SC3. And the simulator has no
jetsam machinery at all, so it can produce a *number* but never a *verdict* — no "fits in budget"
phrasing is provable there.

### L-7 — Xcode 26.6's extension template omits the key that makes the extension appear at all

The AutoFill Credential Provider template emits **no `ASCredentialProviderExtensionCapabilities`**
dictionary in the extension's `Info.plist`, and the `ProvidesPasswords` key that belongs in it is
**live in the OS binary but documented nowhere in the SDK**. Consequence, and it is nasty because
every step looks correct: a template-built extension can silently fail to appear in
Settings → Passwords → Password Options, get recorded as an **entitlement FAIL**, and escalate the
$99 Apple Developer Program decision (see §4 q.3) over a **missing plist key**. Add the capabilities
dictionary before concluding anything about entitlements.

**Plan 36-01 update**: the capabilities dict was added to
`ios/PasskeyVault/PasskeyVaultAutoFill/Info.plist` up front (both `ASCredentialProviderExtensionCapabilities`
and the legacy top-level key), before SC1 layers (a)/(b) were tested. Neither layer registered a FAIL
on this run (`ios/evidence/36/pluginkit-registered.txt`, `ios/evidence/36/pluginkit-elected.txt`), so
this landmine did not materialize at registration/election. It remains a live, untested risk for SC1
layer (c) — Settings → Passwords → AutoFill visibility — which Plan 36-01 does not test and Plan
36-02 owns; do not infer (c) from (a)/(b) passing (D-09).

**Plan 36-02 update — the bisect ran, and the outcome is settled but NOT what was speculated.**
`ProvidesPasswords` was removed from `Info.plist`, rebuilt, reinstalled, and layer (c) re-run; then
restored, rebuilt, reinstalled, and re-run. Contrary to this landmine's original "can silently fail to
appear in Settings" framing: **the provider row does NOT disappear.** With the key absent, "PasskeyVault"
is still a real, present, toggleable `Switch` element in the AutoFill & Passwords list
(`ios/evidence/36/bisect-key-absent-layer-c.png`). What changes is the row's accessibility label —
`'PasskeyVault'` (key absent) vs `'PasskeyVault, Passwords'` (key present) — and its subtitle
`StaticText` sibling disappears entirely (`ios/evidence/36/bisect-key-absent-hierarchy-excerpt.txt`).
`AutoFillInvocationUITests`' exact-match query on the label `"PasskeyVault, Passwords"` is what fails
(`AutoFillInvocationUITests.swift:271`), not the provider's presence in Settings.

**Settled: `ProvidesPasswords` is NOT required for the provider to appear/be listed/be toggleable in
Settings → Passwords → AutoFill on this simulator/OS version (iOS 26.5).** It gates the row's declared
capability category (its accessibility label's "Passwords" component), not list membership. The
original speculation — a template-built extension "can silently fail to appear" — does not hold on
this toolchain; the more precise, evidenced finding replaces it. Four observations, all recorded:
key present → layer-a PASS (`ios/evidence/36/bisect-key-present-layer-a.txt`), layer-c label
`'PasskeyVault, Passwords'`, test passes; key absent → layer-a PASS (`bisect-key-absent-layer-a.txt`,
registration is unaffected either way), layer-c label `'PasskeyVault'` (no Passwords suffix), the
UI test's own exact-match assertion fails; key restored → layer-a PASS
(`bisect-key-restored-layer-a.txt`), layer-c label back to `'PasskeyVault, Passwords'`
(`bisect-key-restored-layer-c.png`), test passes again. `ShowsConfigurationUI` and the legacy
top-level `ASCredentialProviderExtensionShowsConfigurationUI` key were never removed during this
bisect, so whether either of THOSE keys (rather than `ProvidesPasswords`) is what keeps the row listed
remains open — this bisect isolated only `ProvidesPasswords`, as scoped.

### L-8 — `$(AppIdentifierPrefix)` expands to the literal `FAKETEAMID.` on this setup

With Team = None (IOS-04), `$(AppIdentifierPrefix)` resolves to the literal string `FAKETEAMID.`. So
any **hardcoded** App Group identifier works on the simulator and breaks on hardware, at the moment
the team prefix becomes real. Always compose App Group / Keychain access group strings from the
build-setting variable, never from a string typed out after reading the simulator's value. Directly
relevant to L-5, which is the same subject from the other direction.

**Plan 36-01 evidence**: confirmed against both built binaries —
`ios/evidence/36/app-entitlements.plist` and `ios/evidence/36/appex-entitlements.plist` both show
`keychain-access-groups = [FAKETEAMID.cloud.blonie.PasskeyVault]`, the expanded runtime value of the
unexpanded `$(AppIdentifierPrefix)cloud.blonie.PasskeyVault` build variable both `.entitlements`
source files carry (never the literal, per D-14). `scripts/ios-autofill-layers.sh wording-gate`
mechanically enforces that no `ios/` source file (outside `ios/evidence/` and the gate script itself)
hardcodes this literal; falsified against all four forbidden-phrasing classes in
`ios/evidence/36/wording-gate-falsification.log`.

### L-9 — "a check that cannot fail" produced FOUR more instances in a single phase

This is now the repo's most reliably recurring defect, and Phase 35 is the clearest data point yet:
**four fresh instances in one phase**, three caught by plan-check before they were written and one
caught only because a mutation was actually *performed*.

- The one that reached committed code: `scripts/audit-ffi-opaque-handles.sh`'s first draft isolated a
  Swift class body with a `sed` line range (`/^open class X:/,/^}/p`). `uniffi-bindgen-swift` emits a
  single-expression function's own closing brace **unindented at column 0**, identical in shape to the
  class's true closing brace, so the range truncated early and reported **PASS with an injected
  raw-byte accessor present**. It was caught *only* because the plan mandated actually injecting the
  accessor. Reading the script would not have found it. Rewritten to awk brace-depth counting, then
  hardened again in code review (comment-aware counting, and a non-matching class declaration is now a
  hard `ERROR`, not a `continue`).
- The generalisation to carry forward: **a gate whose falsification proof only covers the shape it
  already handles is not proven falsifiable.** Falsify with the input you did *not* design for.

**The `compiler_builtins` corollary — a gate can validate the wrong object forever.** The FFI-04
`vtool` slice gate originally picked its object with `find … -name '*.o' -print -quit`, i.e. whichever
one the filesystem yielded first. Measured on the current artifact: the device slice's archive holds
**667** objects, of which **7** are `pv_ffi*.o`, and that `find` picks a `compiler_builtins` object.
And `compiler_builtins` ships **prebuilt inside `rust-std`**, so even after the deployment floor was
raised it *still* reports:

```
compiler_builtins-….rcgu.o : LC_VERSION_MIN_IPHONEOS  version 10.0
pv_ffi-….rcgu.o            : LC_BUILD_VERSION  platform IOS  minos 18.0
```

A gate sampling "any object" would therefore have gone on validating a 10.0 object indefinitely, and
would have *failed* the moment someone did the right thing. Fixed to select `pv_ffi*.o` and to error
out if a slice contains none of this crate's code.

**And cargo does not fingerprint `IPHONEOS_DEPLOYMENT_TARGET`.** `rustc` reads it from the environment
at compile time, but cargo does not track it, so exporting it changes **nothing** on warm artifacts —
observed exactly that: `Finished release profile in 0.34s` and the object still reported 10.0.
Deleting `libpv_ffi.a` is not enough either, because the archive bundles objects from every dependency
rlib and those carry the old floor too; the whole triple has to go.
`scripts/build-ios.sh` now stamps the floor per triple and runs `cargo clean --release --target …`
when it changes. A build script that needs a manual `cargo clean` to be correct is a trap.

### L-10 — a cold DerivedData mismatches the generated bindings against the linked library

Observed 2026-08-11 while re-proving the phase's guards in a fresh git worktree. On the **first**
`xcodebuild test` against a brand-new DerivedData, all five FFI tests failed in `0.000 seconds` with:

```
Crash: PasskeyVault at uniffiEnsurePvFfiInitialized()
```

That is UniFFI's own API-checksum guard `fatalError`-ing because the compiled `pv_ffi.swift` and the
linked `libpv_ffi.a` did not come from the same build. Cause: the "Build pv-ffi XCFramework" Run
Script phase declares **no inputs and no outputs** (Xcode says so itself: *"will be run during every
build because it does not specify any outputs"*), so Xcode cannot order it against the Swift compile
and link. A second, identical invocation passes 6/6 — which is exactly what makes this dangerous: it
looks like a flake, and on CI or a fresh clone it is the *first* run that counts. Declaring
`crates/pv-ffi/src/**` as inputs and `build/swift-bindings/pv_ffi.swift` + `build/PvFfi.xcframework`
as outputs is the real fix and is owed before any CI job runs this.

### L-11 — a second non-test pv-ffi feature variant compounds L-10's shared-output-path race

Observed 2026-08-11/12, Plan 36-03 Task 2 (E5.c), the first time this repo needed TWO different
non-default `pv-ffi` feature variants alive during the same `xcodebuild test` invocation:
`PasskeyVaultTests` (built for testing on every `test` action, even with `-skip-testing:PasskeyVaultTests`
— confirmed live, that flag only skips *running* it, not building it) needs `ffi06-probe`
(`FfiPanicSafetyTests.swift`); `PasskeyVaultAutoFill`, under the `sensitivity` probe condition, needs
`kdf-probe` (`KdfProbe.swift`). Both targets compile against the SAME shared
`ios/PasskeyVault/build/swift-bindings/pv_ffi.swift` + `PvFfi.xcframework` (L-10's own root cause: no
declared outputs on the Run Script phase that regenerates them). `PasskeyVaultTests`' Run Script phase
hardcoded `--with-panic-probe`, so it unconditionally clobbered whichever variant the *other* target
in the same invocation actually needed, non-deterministically, **inside** `xcodebuild`'s own build
graph — retrying with a fresh single-feature rebuild *before* each attempt did not converge, because
the clobber happens during the invocation itself, not before it starts. Fixed at the source, not
retried around: `scripts/build-ios.sh` now accepts `--with-panic-probe` and `--with-kdf-probe`
*together*, producing one artifact carrying both diagnostic symbols; the Run Script phase reads a
`PV_FFI_TEST_VARIANT` build setting (`ios/PasskeyVault/PasskeyVault.xcodeproj/project.pbxproj`,
defaulting to the prior `--with-panic-probe`-only behavior when unset), and
`scripts/ios-probe-run.sh` sets it to both flags only for the `sensitivity` probe. **Carry forward: a
third simultaneous non-default feature variant would need the same treatment — extend the combined
`FEATURES` list in `build-ios.sh`, never add a third mutually-exclusive flag.**

## 4. Open questions — honestly open

1. ~~**IOS-06: UniFFI vs hand-written C ABI.**~~ **RESOLVED — see §1.** Decided: UniFFI, evaluated
   against this codebase's actual `pv-core`/`pv-provider` types, not merely the handoff §5 starting
   frame.
2. **Does PRF actually work at runtime through a third-party credential-provider extension?** §2.1
   proves only that the API exists. This is the question the whole product surface rests on, and it
   is unanswered.
3. **Will the simulator grant
   `com.apple.developer.authentication-services.autofill-credential-provider` to a
   personal/no team?** If it refuses, that — and only that — is the decision point for the $99
   Apple Developer Program. Not before.
4. **App Groups** are unavailable on a free Apple ID, which affects how the extension and the host
   app would share vault state. Unexplored.
5. ~~**Byte-shape at the FFI boundary.**~~ **CLOSED for the FFI boundary itself** —
   `ios/PasskeyVault/PasskeyVaultTests/FfiRoundTripTests.swift` asserts positively on the Swift
   receiving side against author-chosen literals, including embedded `0x00` at a mid-buffer offset in
   both a key and a nonce, and it discriminates `.Decrypt` from `.InvalidInput` so a silent
   truncation cannot hide behind "some error was thrown". Proven able to fail: a NUL-truncating
   mutation of `export_user_key_for_session` turns it red, and an identity `wrap`/`unwrap` pair turns
   its WR-12 assertions red while every pre-existing assertion in the same test stays green.
   **STILL OPEN, and it is the bigger half:** the **wire** encoding between clients.
   `pv_core::keys::WrappedKey` has no serde attributes — `serde_json` emits `Vec<u8>` as a JSON
   *number array* while Swift's `JSONEncoder` defaults `Data` to *base64*, and `pv-server` stores the
   field as opaque `TEXT` without parsing it. Nothing in either client can catch that; only a
   **two-direction cross-client test** can. The first phase that writes a real row from iOS owns it,
   not "Phase 39/41".

---

## 4a. The v1.0 roadmap, in outline

Phases **35–43** (this project numbers sequentially; v0.5 ran 29–34 and those directories belong to a
live parallel session on `main` — do not touch them). Full text lives in `.planning/ROADMAP.md`, which
is never committed, hence this outline.

| # | Goal |
|---|---|
| 35 | **FFI boundary + skeleton — gates everything.** IOS-06 decided *before* binding code; opaque handles mirrored from `pv-wasm`; one real round-trip asserted on real bytes |
| 36 | **AutoFill feasibility gate.** Falsifiable check of the entitlement + App Groups on a free Apple ID, and a *measured* Argon2id memory footprint — before any data-sharing design commits |
| 37 | Account, password unlock, biometric unlock (Face ID / Touch ID gating real key release) |
| 38 | Full vault UI — CRUD for every item type, folders/tags, TOTP, generator through FFI, clipboard, app-switcher protection |
| 39 | Sync + offline cache — REST/WS unchanged, host app writes ciphertext where a cold-launched extension can reach it, honest freshness copy |
| 40 | Family & sharing on the phone — truthful shared marking, family management, FSH-02 as a third client |
| 41 | **AutoFill for passwords + cross-process lock correctness** — the first phase where both processes exist at once |
| 42 | Proof standard — the iOS QA/CI gate, auditing phases 35–41 |
| 43 | **Conditional: passkeys only if cheap.** Go/no-go recorded first; "not done, deferred, here is why" is a passing outcome |

Coverage was **verified independently, not taken from the agent's report**: 46 requirement IDs defined,
46 referenced, zero orphans, zero invented, zero duplicated. The duplicate check was then falsified by
injecting a fake duplicate and watching it get caught — otherwise its silence would have proved nothing.

Two phases exist purely because research disagreed with itself or with reality, and those disagreements
are the milestone's real risk (see L-5, L-6): **36 exists to settle them before anything depends on the
answer.**

## 5. What is explicitly *not* done

Rewritten after Phase 35 — the four bullets that used to live here ("no FFI crate", "no Swift code of
ours", "no test exercises `pv-core` from Swift", "`members` untouched") are **no longer true** and are
recorded as closed rather than deleted, so the change is visible:

- ~~No FFI crate; root `Cargo.toml` `members` untouched.~~ **Done.** `crates/pv-ffi` exists and is a
  workspace member — the coordination point with `main` (handoff §7) **has** now been triggered.
- ~~No Swift code of ours.~~ **Partly done.** `PasskeyVaultTests` is ours; the App target
  (`ContentView.swift` etc.) is still Xcode's untouched template.
- ~~No test exercises `pv-core` from Swift.~~ **Done.** Six Swift tests call real `pv-core` crypto
  across the UniFFI boundary. "The crypto core runs on iOS" is no longer shorthand for "it compiles".

Still genuinely not done:

- **Nothing built for a physical device; nothing signed; no entitlements requested.** The device
  slice is compiled and its Mach-O platform is verified by `vtool`, but it has never been *run*. Every
  runtime claim in this file is a **simulator** claim.
- **No credential-provider extension target**, so nothing here proves PRF (or password AutoFill) works
  at runtime through a real provider — §4 q.2 is still the question the product rests on.
- **No concurrency proof on the handles.** The generated Swift declares
  `open class FfiUserKey: …, @unchecked Sendable` — that is the compiler being *told* the invariant
  holds, not shown. Using one handle from several threads under TSan/ASan is untested; UniFFI's
  `Arc`-backed model makes it plausible, and plausible is not verified.
- **No cross-client wire-format test** (§4 q.5) — the largest remaining correctness risk on this
  branch.
