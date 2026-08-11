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
| FFI boundary | **Not started.** Blocked on decision IOS-06. |
| Credential provider extension | Not attempted |
| Server sync / UI | Not attempted |

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

### IOS-06 — FFI mechanism: **OPEN**

UniFFI vs hand-written C ABI. **No binding code may be written before this is decided and recorded
here** (handoff §5 requires the decision record to land before the code that depends on it, and
that ordering is checked by commit order).

Non-negotiable constraint on whichever wins: mirror `crates/pv-wasm`'s **opaque-handle** design.
Raw key bytes must never cross the boundary except through explicitly named, auditable functions —
`pv-wasm` allows exactly two (`export_user_key_for_session` / `import_user_key_from_session`) and
that is the shape to copy. An FFI that returns key bytes "for convenience" is a design error, not a
tradeoff.

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

## 4. Open questions — honestly open

1. **IOS-06: UniFFI vs hand-written C ABI.** Blocks all binding code. UniFFI has not been evaluated
   against this codebase's actual types; the comparison table in handoff §5 is a starting frame, not
   an earned recommendation.
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

## 5. What is explicitly *not* done

- No FFI crate. Root `Cargo.toml` `members` is untouched, so the coordination point with `main`
  (handoff §7) has not been triggered.
- No Swift code of ours — `ContentView.swift` etc. are Xcode's untouched template.
- Nothing built for a physical device; nothing signed; no entitlements requested.
- No test yet exercises a single line of `pv-core` *from Swift*. Until that exists, "the crypto core
  runs on iOS" means "it compiles for iOS" — which is real, and is less.
