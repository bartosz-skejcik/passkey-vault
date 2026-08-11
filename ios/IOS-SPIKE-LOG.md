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
| Xcode project | Skeleton only (App + Unit + UI test targets, no code of ours) |
| FFI boundary | **Not started (no code yet).** IOS-06 **decided** (UniFFI) — see §1. |
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
| Workspace members | `pv-core`, `pv-server`, `pv-wasm`, `pv-provider` (unchanged — no FFI crate yet) |

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
5. **Byte-shape at the FFI boundary.** Landmine D-21 lives at serialization boundaries and the FFI
   is a brand-new one. `crates/pv-provider/tests/response_shape.rs` (requirement QA-04) decodes raw
   wire bytes rather than trusting the Rust type; the iOS boundary needs the equivalent, asserting
   positively on the Swift receiving side.

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

- No FFI crate. Root `Cargo.toml` `members` is untouched, so the coordination point with `main`
  (handoff §7) has not been triggered.
- No Swift code of ours — `ContentView.swift` etc. are Xcode's untouched template.
- Nothing built for a physical device; nothing signed; no entitlements requested.
- No test yet exercises a single line of `pv-core` *from Swift*. Until that exists, "the crypto core
  runs on iOS" means "it compiles for iOS" — which is real, and is less.
