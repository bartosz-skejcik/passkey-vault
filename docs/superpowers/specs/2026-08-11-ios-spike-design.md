# iOS Spike — Design Spec

**Written:** 2026-08-11, in a session rooted in the `main` checkout (which could not mutate this
worktree — see §7).
**Branch:** `ios/spike`, worktree at `/Users/j5on/.work/projects/passkey-vault-ios`.
**Supersedes nothing.** Complements `docs/IOS-HANDOFF.md`, and **resolves its §10 open question
about PRF**.

---

## 1. Scope of this spec

The first end-to-end slice of the iOS spike: prove that `pv-core` crypto runs natively on iOS and
can be called from Swift, asserted on real bytes.

Explicitly **out of scope** for this slice: the credential provider extension, entitlements, App
Groups, server sync, UI. Those come after the FFI boundary is proven.

---

## 2. Verified findings (2026-08-11)

Everything in this section was checked against the installed SDK, not against documentation or
memory. Commands are given so the next reader can re-run them rather than trust this file.

### 2.1 PRF is supported on iOS — both directions. The spike is viable.

`docs/IOS-HANDOFF.md` §6 and §10 flagged iOS PRF support as an unverified assumption that could
"reshape the whole spike". It is now verified, and the answer is **yes**.

Ground truth is the Swift interface shipped in the SDK:

```
/Applications/Xcode-26.6.0.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS26.5.sdk/System/Library/Frameworks/AuthenticationServices.framework/Modules/AuthenticationServices.swiftmodule/arm64e-apple-ios.swiftinterface
```

| Direction | Symbol | Line | Availability |
|---|---|---|---|
| **Provider** receives a PRF assertion request | `ASPasskeyAssertionCredentialExtensionInput.prf` | 24 | iOS 18.0+ |
| **Provider** returns PRF assertion output | `ASPasskeyAssertionCredentialExtensionOutput.prf` | 36 | iOS 18.0+ |
| **Provider** returns PRF registration output | `ASPasskeyRegistrationCredentialExtensionOutput.prf` | 62 | iOS 18.0+ |
| **Provider** receives PRF registration input | `ASPasskeyRegistrationCredentialExtensionInput.prf` | 72 | iOS 18.0+ |
| **Client/RP** requests PRF for own-vault unlock | `ASAuthorizationPlatformPublicKeyCredentialAssertionRequest.prf` | — | iOS 18.0+ |

Both halves of the project's core value proposition are therefore expressible on iOS 18.0+:
serving passkeys with PRF to other people's sites, *and* PRF-unlocking our own vault.

Reproduce with:

```bash
SDK=$(xcrun --sdk iphoneos --show-sdk-path)
grep -n "prf" "$SDK/System/Library/Frameworks/AuthenticationServices.framework/Modules/AuthenticationServices.swiftmodule/arm64e-apple-ios.swiftinterface"
```

### 2.2 LANDMINE: the Objective-C headers lie about PRF

**This spec was nearly written with the opposite conclusion.** The ObjC headers for the
provider-side extension types expose **only `largeBlob`** and no `prf` whatsoever:

```
$SDK/System/Library/Frameworks/AuthenticationServices.framework/Headers/ASPasskeyAssertionCredentialExtensionInput.h
$SDK/System/Library/Frameworks/AuthenticationServices.framework/Headers/ASPasskeyAssertionCredentialExtensionOutput.h
```

A grep for `PRF` across all `ASPasskey*.h` and `ASCredentialProvider*.h` returns **zero hits**.
Read naively, that says "third-party credential providers cannot do PRF on iOS" — a confident,
well-evidenced, completely wrong conclusion that would have killed the spike on day one.

The cause: those ObjC classes are annotated `NS_REFINED_FOR_SWIFT`. Swift does not see the ObjC
class; it sees a *different* overlay struct defined in the `.swiftinterface`, which carries
additional members. Apple's own doc URLs signal this with the `-swift.struct` suffix.

**Rule for this spike: for any AuthenticationServices question, the `.swiftinterface` is ground
truth, not the ObjC header.** This is the same shape as landmine D-21 (`passkey_types::Bytes`
serializing as a JSON byte array): a type that looks right in one representation and is wrong in
the one that actually ships.

### 2.3 Environment

| Item | State |
|---|---|
| Xcode | 26.6 (17F113), `xcode-select` → `/Applications/Xcode-26.6.0.app/Contents/Developer` |
| iOS SDK | iPhoneOS26.5 |
| Simulator runtime | iOS 26.5 (23F77) |
| Simulators available | iPhone 17 Pro, 17 Pro Max, 17e, 17, iPhone Air |
| Rust Apple targets installed | `aarch64-apple-darwin` **only** — iOS targets not yet added |
| Workspace members | `pv-core`, `pv-server`, `pv-wasm`, `pv-provider` |
| `pv-provider` public surface | `create_provider_credential`, `get_provider_assertion`, `PvCredentialStore`, `PvUserValidation` — matches handoff §4 |

---

## 3. Decisions taken

| ID | Decision | Rationale | Rejected alternative |
|---|---|---|---|
| IOS-01 | Work in git worktree `ios/spike` at `../passkey-vault-ios` | The v0.5 session is **live** on `main` — verified by file mtimes advancing during this session (`.planning/debug/…` written 90 s before the check). Sharing a working tree with a live agent risks cross-contaminated commits. | Working directly on `main`; a plain branch without a worktree |
| IOS-02 | Xcode project at `ios/PasskeyVault/PasskeyVault.xcodeproj`, App + Unit Tests only | Handoff §9 mandates one thin end-to-end slice before breadth. The credential provider extension needs entitlements the free Apple ID cannot grant, and proves nothing until the FFI works. | Creating the AutoFill Credential Provider target up front |
| IOS-03 | Minimum deployment target **iOS 18.0** | PRF on every relevant symbol is `iOS 18.0+` (§2.1). Xcode defaults to 26.x, which would drop supported devices for no gain. | Xcode default (26.x); iOS 17 (has passkey provider support but **no** PRF) |
| IOS-04 | Simulator-only for this spike; Team = None, no signing | Bartek has a free Apple ID, not the $99 Apple Developer Program. Simulator builds need no signing. | Paying for the Developer Program before the concept is proven |
| IOS-05 | Bundle identifier `cloud.blonie.PasskeyVault` | Matches the existing hosted instance domain (`vault.blonie.cloud`). | Reverse-DNS on a personal domain |

### Open decision — must be recorded before any binding code

**IOS-06: FFI mechanism — UniFFI vs hand-written C ABI.** Not yet decided. Handoff §5 requires this
be written down *before* the code that depends on it, in the `KEY-05` / `EXT-10` style with
alternatives rejected on their merits. Non-negotiable constraint on whichever wins: **mirror
`pv-wasm`'s opaque-handle design — raw key bytes must never cross the boundary except through
explicitly named, auditable functions.**

---

## 4. The tracer bullet

One real crypto round-trip from `pv-core`, compiled natively for
`aarch64-apple-ios-sim`, invoked from Swift, asserted on **raw bytes** in `PasskeyVaultTests`.

Steps, in order:

1. `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`
2. Resolve IOS-06 and write the decision record.
3. New FFI crate (touches root `Cargo.toml` `members` — a coordination point per handoff §7).
4. `scripts/build-ios.sh` producing an XCFramework; link it into the Xcode project.
5. A test that asserts on the actual bytes crossing the boundary.

**Acceptance:** the test fails if the FFI returns wrong bytes. Per the project's operational rule, a
passing test that cannot fail is not evidence — the test must be shown failing before it is
believed. Assert positively on the receiving (Swift) side.

---

## 5. Known limitations to carry forward

- **Free Apple ID:** no App Group and no
  `com.apple.developer.authentication-services.autofill-credential-provider` entitlement from a
  personal team. Physical-device installs and App Store distribution are out of reach for this
  spike. If the simulator also refuses the entitlement, that is the decision point for the $99
  membership — not before.
- PRF support is verified as **present in the SDK surface**. It has **not** been verified as
  *working at runtime* through a real provider extension. That is a separate, later proof and must
  not be conflated with §2.1.

---

## 6. Housekeeping for the next session

> **CORRECTION, 2026-08-11, from the worktree session that executed this list.** The first item
> below was **wrong**: `ios/PasskeyVault/.git` does not exist. `find ios -name .git` returns
> nothing and `git status --untracked-files=all -- ios` shows plain untracked files with no
> gitlink. The `rm -rf` was *not* run against an unverified path. The remaining items are done and
> are marked as such. See `ios/IOS-SPIKE-LOG.md` §3 L-4 — the spec was written by a session that
> could not mutate this worktree and therefore could not re-check its own claim.

- ~~**`ios/PasskeyVault/.git` must be deleted.**~~ **Does not exist — see the correction above.**
  The claim that it held one commit (`8fd2fc4 "Initial Commit"`) could not be reproduced.

- ✅ Add Xcode noise to `.gitignore`: `xcuserdata/`, `*.xcuserstate`, `DerivedData/`. Done, plus
  `ios/**/build/`; verified with `git check-ignore -v`.
- ✅ Verify Minimum Deployments really reads **iOS 18.0** (IOS-03). It did **not** — all four build
  configurations carried Xcode's default `26.5`. Fixed, and confirmed through
  `xcodebuild -showBuildSettings` rather than by re-reading `project.pbxproj`.
- ✅ Start `ios/IOS-SPIKE-LOG.md` (handoff §8) and carry §2.2 into it as the first landmine.
- Run `/gsd-new-milestone` **in this worktree's session**, never on `main` — `.planning/` on `main`
  is being rewritten by the live v0.5 session.

---

## 7. Why this spec was written from outside the worktree

A session rooted in `/Users/j5on/.work/projects/passkey-vault` can read this worktree but cannot run
mutating shell commands in it, and cannot write files into it either — a cross-project guard blocks
both, and an explicit directory grant does **not** override it.

**Consequence: the iOS spike needs its own Claude Code session rooted at
`/Users/j5on/.work/projects/passkey-vault-ios`.** That is also what `docs/IOS-HANDOFF.md` assumed
from the start; its §7 claim that the reader is *already* in that worktree was not true, and
creating the worktree was itself the first task.
