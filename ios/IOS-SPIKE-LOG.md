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
| Credential provider extension | **Real skeleton built, installed, and exercised end-to-end (Phase 36, Plans 36-01..36-04).** Entitlement embedding, App Group + Keychain sharing, and SC1's three layers (registration/election/Settings visibility) all proven live from inside the real `.appex` process. FILL-06 measured for real: production Argon2id (64 MiB/t=3/p=4) peaks at ~85 MB `phys_footprint` across 10 runs, DR-2 recommends removing the KDF from the extension path entirely. No credential-list/fill *logic* yet (Phase 41) — this row covers the skeleton, entitlement, and memory-budget proof only. |
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

## 0. Next session — read this first

**Written 2026-08-17. Delete this section once Phase 38 is finished.**

### Where things stand

Phases 35, 36, 37 are **verification-passed**. Phase 38 is **in progress**: plans 38-01, 38-02 and
38-03 are committed and pushed to `origin/ios/spike`; **38-04 … 38-11 remain**.

### The order Bartek asked for

1. **Finish auth + onboarding first** — the 3-step onboarding (Welcome → Server → AutoFill), the
   server URL made configurable, and the auth rework. An agent was dispatched for this on 2026-08-16
   and produced **nothing** (see the warning below), so it is entirely unstarted in code.
2. **Then continue the GSD run** for the rest of Phase 38 and onward, building against the approved
   design.

Resume with:

```
/gsd-autonomous --from 38
```

### The design is settled, approved, and committed — do not redesign it

| File | Contents |
|---|---|
| `docs/superpowers/specs/2026-08-16-ios-onboarding-and-auth-design.md` | onboarding, auth, lock (9 states) |
| `docs/superpowers/specs/2026-08-16-ios-vault-ui-design.md` | vault list, all six types, generator, family |
| `ios/brand/screens.html` · `ios/brand/screens-vault.html` | 34 screens, light + dark, real token values |
| `ios/brand/tokens.json` · `scripts/gen-ios-colorsets.py` | 14 colour tokens; `--check` fails on drift |

Bartek approved these ("lgtm") on 2026-08-16. **Read both specs before planning 38-04 onward.** They
carry decisions that are expensive to rediscover — `PVOnAccent` (never `.white` on an accent fill), the
zero-knowledge favicon rule plus the iOS-only on-disk `URLCache` hazard, `Codes` indexing as `2`
because Cards and Codes collide on `C`, and the deliberate tab-bar-as-filter departure from the HIG.

### ⚠ Background agents are failing in this environment — 0 for 3 on 2026-08-16

1. `gsd-execute-phase` dispatched in the background tried to spawn `gsd-executor` subagents.
   **Backgrounded agents have no `Agent` tool.** It reported "wave 1 dispatched and running" and
   produced zero commits — a false success report, which is worse than a failure.
2. A direct execution agent was killed by the machine sleeping. **Mitigation that works: prefix every
   long build/test with `caffeinate -i`.**
3. The onboarding/auth agent ran 270 turns and 836 KB of transcript, committed **nothing**, and ended
   on `[Request interrupted by user for tool use]` — it stalled on a permission prompt it could not
   answer.

**Everything that actually landed on 2026-08-16 was run inline.** Prefer inline execution, or a fresh
interactive session, over backgrounding write-heavy work.

### A defect shape this project keeps producing: truncated output read as absence

Hit **three times in one day**, each producing a confident and wrong conclusion:

- `grep … | head -5` over `SwiftUI.swiftinterface` → "there is no public section-index API". There is:
  `sectionIndexLabel(_:)` and `listSectionIndexVisibility(_:)`, iOS 26+. The public declarations sat
  below the cut.
- A grep that did not account for xcodebuild escaping `=` → "ThreadSanitizer never ran". It had.
  (Landmine **L-13**.)
- `head -8` over a `Failing tests:` list → "only two tests failed". Thirteen had.

**Never pipe a check for *absence* or *failure* through `head`.** The one line that refutes you is
exactly the line that gets cut.

### Known open items carried into 38

- **`NSCameraUsageDescription` is not declared.** It gates TOTP QR scanning and card scanning.
- **The app cannot be built in Release** — landmine **L-14**, a `swift-frontend` crash in generated
  UniFFI code. Debug only; do not try to work around it.
- **`.planning/` never survives this worktree.** Anything that matters goes in this file,
  `ios/evidence/`, or `docs/`.

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

### DR-2 — KDF-path architecture: **architectural (option a) recommended; the disclosed-global-reduction
option is the product owner's call, never taken here**

**Decision: recommend option (a) — the extension never runs Argon2id itself.** The host app derives the
User Key (an app, with an app's memory budget) and hands it across the process boundary via the already
load-bearing `export_user_key_for_session`/`import_user_key_from_session` pair (§1, IOS-06's own
amendment), deposited in a biometric-gated Keychain item Phase 37 owns the design of. The extension reads
the already-derived key; it never runs a KDF at all in the steady-state (unlocked-recently) path.

**Written because the independent competitor tripwire fired, per FILL-06/SC4's own trigger condition** —
not because the numeric band failed. Plan 36-04's real, ten-run measurement (`ios/AUTOFILL-FEASIBILITY.md`
`## E6`) landed the peak `phys_footprint` in the PASS band (~85.1–85.3 MB, under the pre-declared 90 MiB
threshold on every run) — but the KDF's own cost, D, was **~64.06–64.08 MB on every single run**, at and
above the 32 MiB tripwire `36-RESEARCH.md`'s competitor precedent sets. `36-RESEARCH.md` is explicit that
this case is still DR-2's to write: *"If E6 lands PASS but D ≥ 32 MiB, the tripwire fires and DR-2 is
still worth writing — three shipping competitors' documented guidance is violated even on a numeric
pass."*

**The three options, per the mandated style — the rejected ones named and rejected on their merits, not
by omission:**

- **(a) Architectural — RECOMMENDED.** The extension never runs the derivation; the host app derives and
  hands the key across the boundary this milestone already treats as load-bearing. Precedent: Bitwarden's
  own community PSA (`36-RESEARCH.md` §"The escape hatch, and why it is a decision record and not a
  recommendation") — *"The 120 MB limit of the autofill API does not apply to Bitwarden if you use
  biometric unlock."* **Cost, stated honestly, not hidden:** a cold start with no prior unlocked session
  (device just rebooted, no biometric session cached) needs a defined fallback — a UX decision for Phase
  37/41, not a security one, most likely bouncing the user to the host app for a one-time password unlock
  before the extension can fill anything. This option **widens the window in which key material is
  resident in a second process's address space** for as long as that cached session exists — the residual
  risk this milestone's own IOS-06 FFI decision already inherited and disclosed (CP-4/T-36-18 in this
  plan's threat register), not a new one introduced here. Depends on Phase 37 (biometric Keychain design)
  and E3 (Keychain sharing, already proven live, `## E3` above).
- **(b) Lower `m_cost` globally to match a documented competitor floor (e.g. Bitwarden's 32 MiB
  default)** — a real, disclosed security reduction, **not decided here**. This is the option FILL-06's
  own wording explicitly forbids taking silently ("ciche obniżenie bezpieczeństwa" — ROADMAP Phase 36 SC4).
  It requires its own decision record, a migration story for every existing vault (re-deriving and
  re-wrapping every stored `WrappedKey` at a new parameter set), and the product owner's explicit sign-off
  — the same escalation posture as the $99 Apple Developer Program question (SC2). **Escalated to
  Bartek, not taken.**
- **(c) Fork parameters per-process — REJECTED on merit.** A KDF parameter is a property of the *vault*,
  not of the process that happens to be unlocking it: forking it so the extension uses a cheaper profile
  than the host app leaves the extension unable to open a vault the app created (and vice versa) without a
  re-wrap migration identical in shape to option (b)'s, but hidden behind a process boundary instead of
  disclosed as a real parameter change. No surveyed competitor does this (`36-RESEARCH.md` §"Competitor
  precedent" — all four rows lower the parameter *globally* or bypass the KDF entirely; none forks it).

**Competitor precedent cited as the decision's basis** (`36-RESEARCH.md` §"Competitor precedent — the
decision record's template"): Bitwarden (32 MiB default; a warning dialogue above 64 MiB — our own
production value), KeePassium (recommends ≤32 MB, a dedicated "Not enough memory to continue" KB
article), Strongbox (≤16 MB recommended, "anything above 32MB will cause issues... due to iOS system
limitations"), KeePassXC (lowered its *desktop* default because ecosystem iOS AutoFill clients could not
open the resulting databases). **Three independent shipping password managers land at ≤32 MiB for the
extension path, and Bitwarden's own warning threshold is exactly our production value (64 MiB).**

**Evidence this decision rests on:** `ios/AUTOFILL-FEASIBILITY.md` `## E6` (the ten-run measurement,
`ios/evidence/36/kdf-inprocess.log`, `kdf-coldstart.log`, `kdf-cold-{1..5}.log`), `## E7` (the
out-of-process cross-check attempt — not obtained, recorded honestly rather than inferred), and
`crates/pv-ffi/src/lib.rs`'s own `MAX_M_COST_KIB` commentary (already anticipating this exact tightening,
written in Phase 35 before this measurement existed).

### ACC-03 — Keychain layout, accessibility classes, biometric invalidation: **DECIDED**

Two secrets live behind this design, not one. The ROADMAP's own wording anticipates only the first;
the second (GAP 3, `37-RESEARCH.md`) is recorded here rather than left implicit, because it needs a
*different* accessibility class for a stated reason, not the same one by default.

**Secret A — the User Key envelope.** `kSecClassGenericPassword`; `kSecAttrService` =
`cloud.blonie.PasskeyVault.uk-envelope`; value = the 32 raw bytes returned by
`export_user_key_for_session` (`crates/pv-ffi/src/lib.rs`, the load-bearing cross-process mechanism
per §1 IOS-06's own amendment); protection = **`kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`**;
flags = `[.biometryCurrentSet]`, passed **only** through `SecAccessControlCreateWithFlags` and never
additionally as `kSecAttrAccessible` in the `SecItemAdd` dictionary (`37-RESEARCH.md` records the
header/folklore disagreement on that collision as unresolved — the design rule holds regardless of
which is true, and E4 in a later plan settles it).

Rejected on merit, each with its own reason, not by omission:
- `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` — adds successfully on a passcode-less device, where
  "unlocked" is the permanent state, silently degrading the strongest class to "always"; and it leaves
  the ciphertext on disk after the passcode is removed, where `WhenPasscodeSetThisDeviceOnly` has the
  OS delete it (`[OBSERVED, doc]`, `SecItem.h`: "Disabling the device passcode will cause all
  previously protected items to be deleted").
- both `AfterFirstUnlock*` (including `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, which Secret
  B below deliberately DOES use) — readable while the device is locked; exactly what a User Key
  envelope must not be.
- every non-`ThisDeviceOnly` variant — rides an encrypted backup onto a different device, breaking the
  zero-knowledge posture.
- `.biometryAny` and `.userPresence` — Apple's own `SecAccessControl.h` states the item "is still
  accessible by Touch ID even if fingers are added or removed"; an attacker who enrolls their own
  finger on a stolen unlocked device reaches the vault.
- `.devicePasscode` alone — no biometric gate at all, which is the entire point of ACC-04.

State the counter-argument rather than suppressing it: `.biometryCurrentSet` already requires enrolled
biometry, which already requires a passcode, so the passcode-removal deletion is defence-in-depth, not
the primary gate. The argument that stands alone is the **write-time refusal**: on a passcode-less
device `SecItemAdd` against `WhenPasscodeSetThisDeviceOnly` fails outright (predicted `OSStatus`:
`errSecNotAvailable`/-25291), turning "no passcode" into a surfaced product message — "Biometric
unlock requires a device passcode" — instead of a class that silently degrades to "always available."

**Secret B — the session token (GAP 3).** A bearer credential valid 168 h by default
(`PV_SESSION_TTL_HOURS`) that grants read of every ciphertext blob on the account. Stored
`kSecClassGenericPassword`, `kSecAttrService` = `cloud.blonie.PasskeyVault.session-token`, protection =
**`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`**, **no** `SecAccessControl`, **no** biometric
flag.

The asymmetry with Secret A is stated as a security decision, not an implementation shortcut: the
AutoFill extension (Phase 41) must be able to reach the server on a cold launch without throwing a Face
ID sheet just to attach a bearer header to an HTTP request, and gating the transport credential behind
biometry would make that structurally impossible. The secret that actually decrypts anything is Secret
A, which keeps the strict class; Secret B's exposure is bounded by TTL and revocation
(`DELETE /api/sessions/{id}`), not by a biometric gate that would defeat the extension's own purpose.

Transport correctness, recorded here because a silent violation is a session-invalidating bug and not
merely a style note: the token is stored and transmitted **as the received base64 string, byte for
byte** — `session.rs`'s `token_hash` is `SHA256(<the base64 string's bytes>)`, not of the decoded 32
bytes. A `Data(base64Encoded:)` → `.base64EncodedString()` round trip on the Swift side can silently
invalidate every subsequent request without ever raising a decode error.

### DR-37-B — the session token's accessibility class is decided inside ACC-03, not separately

Recorded as its own ID because GAP 3 surfaced it as a gap in the ROADMAP's ACC-03 wording, but the
content lives entirely in ACC-03 Secret B above: `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`,
no `SecAccessControl`, no biometric flag, byte-exact transport. This cross-reference exists so a future
reader searching for "DR-37-B" or "session-token" lands on the decision rather than concluding it was
never made.

**Biometric-set change.** Apple's own word is *invalidated*, never *deleted*, and Apple names no
`OSStatus` for it (`[OBSERVED, doc]`, `SecAccessControl.h`: "When fingers are added or removed, the
item is invalidated. When Face ID is re-enrolled this item is invalidated."). The reported `OSStatus`
changed across OS versions in third-party reports (`[UNVERIFIED, WEB]`, Apple forum 690546):
`errSecItemNotFound` (**-25300**) on older OS, `errSecAuthFailed` (**-25293**) on iOS 15+, with
`errSecNotAvailable` (**-25291**) also reported by others. Record `{-25293, -25300, -25291}` as **ONE
equivalence class** meaning "envelope unusable" — a standing prohibition on branching on which member
appeared, since the value already changed once between iOS 14 and 15 and could change again. Recovery
is **`SecItemDelete` then `SecItemAdd`**, never add-and-hope; `errSecDuplicateItem` (-25299) is the
predicted symptom of getting that order wrong (`[INFERRED]`, since a fresh add against a still-present
invalidated row collides on the primary key).

Two further groupings the code must make, from the same error taxonomy: benign cancel
`{errSecUserCanceled -128, LAError.userCancel -2, LAError.userFallback -3}` → no alarm, no retry
counter; locked / no-UI `{errSecInteractionNotAllowed -25308, errSecInteractionRequired -25315,
LAError.notInteractive -1004}` → report "locked", never "missing" — the silent-probe path
(`interactionNotAllowed = true`) exists precisely so this bucket can be distinguished without ever
presenting UI.

**`LAContext` discipline, recorded as a decision, not a style note.** Fresh `LAContext` per unlock
attempt; `context.invalidate()` immediately after the key is obtained; `localizedReason` supplies the
prompt copy; `interactionNotAllowed = true` for the silent probe. Quote `SecItem.h`'s own sentence as
the reason this is mandatory, not optional: "If the specified context has been previously
authenticated, the operation will succeed without asking user for authentication." A long-lived context
turns the OS's gate back into the process-local boolean ACC-04 explicitly forbids, wearing OS clothing.

`touchIDAuthenticationAllowableReuseDuration` is rejected by name, not merely left unused: it accepts a
*lock-screen* unlock from the past (`[OBSERVED]`, `LAContext.h:340-362`, max 5 minutes) and does "not
allow reusing previous biometric matches in application or between applications" — using it would mean
"the phone was unlocked recently" releases the vault key, which is not what ACC-04 requires.

**ACC-06 forward constraint (not implemented in this plan).** `SecItem.h` has no expiry/TTL/timeout/
lifetime attribute at all; `kSecAttrCreationDate`/`kSecAttrModificationDate` are documented read-only.
Nothing about a Keychain item expires on its own. The layout above must therefore keep expiry a
**single** `SecItemDelete` call — this is the reason the two-artifact Secure Enclave design is rejected
below in ACC-05 R4, not a separate argument invented there.

**MP-1 proof limitations, pre-registered before any experiment runs**, so a later green run cannot
quietly widen the claim beyond what it actually showed: whatever Phase 37 observes empirically is a
statement about a simulator whose `securityd` links a mock AKS (`SecMockAKS`, `MockAKSRefKey`,
`MockAKSRefKeyObject` strings are present in the binary), where simulated biometry is delivered via a
`notifyutil` notification and not a physical sensor, where `simctl shutdown`/`boot` is not a device
reboot, and where — if the simulator turns out unable to hold a passcode at all (`[UNVERIFIED, WEB]`,
contested) — the shipped `WhenPasscodeSetThisDeviceOnly` protection class ships **unverified on this
harness**. Say so plainly in the plan that runs the experiment rather than softening the criterion to
one the simulator happens to pass.

### ACC-05 — Secure Enclave for the User Key envelope: **REJECTED**, on corrected grounds

The requirement's own stated reason is wrong and is replaced here, in writing, so the wrong reason
cannot come back later wearing the authority of a decision record.

**TRUE half.** `[OBSERVED]` `SecItem.h:1087-1096` (`kSecAttrTokenIDSecureEnclave`): SE Keychain items
are 256-bit EC keys only (`kSecAttrKeyTypeECSECPrimeRandom`), generate-on-enclave only, never
importable. `[OBSERVED]` `SecItem.h:443-445`: once created, an item's `kSecAttrTokenID` cannot change.

**FALSE half.** "…therefore it cannot protect symmetric blobs" does not follow, and that specific
sentence is **wrong**: key agreement composes into exactly a symmetric-blob protector, and Apple ships
the composition. `[OBSERVED]` `CryptoKit.framework/…/arm64e-apple-ios.swiftinterface` line 641:
`extension SecureEnclave.P256.KeyAgreement.PrivateKey : HPKEDiffieHellmanPrivateKey` at **iOS
17.0+** — below this project's 18.0 floor — so `HPKE.Sender`/`HPKE.Recipient` over an SE key protects
an arbitrary-length blob; `sharedSecretFromKeyAgreement` is iOS 13.0+. **An SE-protected User Key
envelope is buildable.** The claim "SE cannot protect symmetric blobs" is refuted by that same
`.swiftinterface` line, and "no symmetric decrypt on an arbitrary blob" is equally false — ECIES's
`…VariableIV…` family (`SecKey.h:1170-1224`) explicitly does not limit message size.

The rejection survives anyway, on different grounds — R1 through R5, each with its evidence marker:

- **R1 [INFERRED]** — a `WhenPasscodeSetThisDeviceOnly` + `.biometryCurrentSet` Keychain item (ACC-03
  above) is already released only after the SEP validates the LocalAuthentication result, and the SEP
  is what invalidates that ACL on re-enrollment. Wrapping the envelope under our own SE key puts a
  *second* SEP-held key in front of an item the SEP already gates: against a stolen locked device,
  offline keychain-DB extraction, and backup exfiltration the two designs are indistinguishable; against
  live compromise of an unlocked app both lose identically, because the decrypted User Key lands in the
  same address space either way. **This claim is marked `[INFERRED]`, not `[OBSERVED]`** — it follows
  from Apple's platform security model plus the ACL invalidation semantics ACC-03 already documents, not
  from a measurement. **E-SE-4 (named here, owned by Plan 37-05) is the experiment that tests its
  *consequence* — behavioural equivalence of the two designs under the realistic threats above — not its
  mechanism. Standing obligation: if E-SE-4 shows the SE key gating or invalidating strictly better than
  the plain Keychain item, this record is amended in a follow-up commit, and ACC-04's own invalidation
  claim is re-checked at the same time.**

  **E-SE-4 ran (Plan 37-05, Task 3, `SecureEnclaveProbeTests.eSe4_confirmOrAmendAccc05R1`). Obligation
  discharged: R1 STAYS `[INFERRED]`, for a reason recorded, not left silently as-is.** `SecureEnclave
  .isAvailable` is `true` on this harness and a plain (unguarded) SE key generates successfully — but
  generating an SE key UNDER a `.biometryCurrentSet` `accessControl` + a real `LAContext`
  (`authenticationContext:`) fails unconditionally with the identical error E3-alt's own
  `evaluateAccessControl` call already hit this session:
  `Error Domain=com.apple.LocalAuthentication Code=-1020 "This call is not supported on iOS Simulator."`
  — a FOURTH independent instance of this exact error this plan run (after E3-alt's match run, E3-alt's
  nomatch run, and this one), reinforcing that any code path routing through LocalAuthentication's own
  biometric evaluation — not only `SecItemCopyMatching`'s implicit gate — is categorically unavailable on
  this simulator/Xcode 26.6 combination, independent of whether the underlying key is a plain Keychain
  item or a Secure-Enclave-backed one. **This means R1's actual realistic-threat comparison (does an
  SE-wrapped envelope gate or invalidate strictly BETTER than the plain Keychain item under a genuine
  biometric challenge) cannot be exercised for EITHER side on this harness — not because the two designs
  were shown equivalent, but because the harness cannot drive a real biometric evaluation for either
  design at all.** R1 is therefore kept `[INFERRED]`, explicitly NOT upgraded to `[OBSERVED]` on the
  strength of this result (that would overclaim what "both hit the same wall" proves), and this result is
  also not evidence AGAINST R1 — it is an honest non-result, recorded rather than glossed over. The
  narrower E-SE-1/E-SE-1b mechanism-level facts (below) remain true and OBSERVED independent of this.
- **R2 [OBSERVED]** — `SecKey.h:1171-1224`: ECIES on any EC key ≤256 bit wraps under **AES-128-GCM**,
  and the SE holds only P-256, so Composition C downgrades this project's 256-bit hierarchy.
  Compositions A/B (HPKE, manual key-agreement) avoid that AES-128 cap only by moving a KDF+AEAD step
  into Apple-specific crypto — an iOS-only key path `pv-core`'s own test suite cannot exercise, `pv-wasm`
  has no counterpart for, and Android/Windows (v2) will not share.
- **R3 [OBSERVED]** — `SecItem.h:1093-1094`, `442-444`: non-exportable, non-importable, non-migratable —
  for what is only a convenience cache whose authoritative recovery path is `pw_wrapped_uk` on the
  server plus the passkey recipients.
- **R4** — two artifacts (the SE key and the ciphertext envelope) that must be deleted, invalidated, and
  recreated in lockstep across two OS processes, against ACC-03's own ACC-06 forward constraint that
  expiry is a **single** `SecItemDelete`. A single ACL-protected item keeps exactly one delete; the SE
  design doubles the state that can desynchronize.
- **R5 [OBSERVED]** — `SecureEnclave.MLKEM768`/`MLKEM1024` with `decapsulate(_:) -> SymmetricKey` would
  be the genuinely interesting version of this idea — a real KEM producing a `SymmetricKey` in hardware
  — and is `@available(iOS 26.0)`, above IOS-03's 18.0 floor. **Record this as the explicit revisit
  trigger: if the deployment floor ever rises to 26, ACC-05 is worth reopening on new facts, not on the
  reasoning rejected here.**

**Honest counterweight, stated rather than hidden.** With Composition A/B the envelope ciphertext is
inert without an enclave operation, so a future bug that leaked the Keychain *item blob* without an
LA-authorized read would be survivable, where the plain ACL design would not be. This is outweighed by
R2–R4 for this project's stack, not dismissed.

**Three claims this record must never make** (all refuted or unverified above, `37-RESEARCH.md`
§"What the ACC-05 record must NOT claim"): "SE cannot protect symmetric blobs" is **false**, refuted by
the `HPKEDiffieHellmanPrivateKey` conformance cited above; "no symmetric decrypt on an arbitrary blob"
is **false**, refuted by ECIES's variable-IV family; "the extension cannot reach an SE-backed key" is
**[UNVERIFIED]** — SE keys are ordinary Keychain items carrying `kSecAttrAccessGroup`, so a same-team
access group should make them visible to the AutoFill extension, but **E-SE-3 is deferred because no
extension target consuming an SE key exists yet** — do not build this record on an unverified claim.

### DR-37-A — `pw_wrapped_uk` on the wire: serde owns the encoding on BOTH clients

**Decision:** `pv-ffi` gains `wrap_user_key_json(...) -> String` and
`unwrap_user_key_from_json(...) -> Arc<FfiUserKey>`, so the stored blob is produced and consumed by
`serde_json` — the same serializer `crates/pv-wasm` already uses (`pv-wasm/src/lib.rs:182-185`) — and
**Swift never encodes or decodes the envelope itself**; it moves an opaque `String` between `pv-ffi` and
the HTTP body.

**Rejected on merit:** "encode `FfiWrappedKey` (the UniFFI Record, `Vec<u8>` nonce + ciphertext fields)
as `[UInt8]`/`Data` on the Swift side and JSON-encode it there." It produces the right bytes today, but
leaves two independent encoders — `serde_json` on the Rust/web/wasm side, `Codable`/`JSONEncoder` on the
Swift side — that must be kept agreeing forever, against a server that stores `pw_wrapped_uk` as opaque
`TEXT` and **never parses or length-checks it** on the register route (`auth.rs:136`, in explicit
contrast to `identity.rs:81`'s `validate_blob_len`), returning **201 on either encoding**.

The concrete failure this decision buys against: `serde_json` emits `Vec<u8>` as a JSON **number
array** (`{"nonce":[12,34,…],"ciphertext":[…]}`); Swift's `JSONEncoder` defaults `Data` to a **base64
string**. An iOS-registered account would appear to succeed at `201`, and then fail to unlock **from the
web app**, later, with the web client flagging the row `undecryptable` — which this codebase reads as a
*tampering* signal, not an encoding mismatch. Same shape as landmine D-21 (`passkey_types::Bytes`
serializing as a JSON byte array).

**A2 (the exact on-disk shape) is `[INFERRED from serde_json semantics, never observed]`** at the time
of this record — nobody has looked at a real stored row yet. **37-02 settles it against a real row, and
37-03 proves interop in BOTH directions** — a symmetric-but-wrong encoding (both clients agreeing on the
same wrong shape) would pass a one-direction test and hide the defect until the *other* client tries to
read it.

---

## 1a. Phase 38 decision records

Five records Phase 38 owes, in the `KEY-05` / `EXT-10` / `IOS-06` style: the decision, the rejected
alternative rejected **on merit** rather than by omission, and the residual risk that survives the
decision. Committed by Plan 38-01 **before** any of the code that depends on them (38-02, 38-03,
38-04, 38-05, 38-09, 38-10, 38-11), so the ordering is auditable in `git log`.

Three of these five exist because Phase 38's research found a ROADMAP premise false. Those
corrections are recorded as landmines L-14…L-17 in §3; the records below are where the *decisions*
that follow from them live.

### DR-38-A — Password generator: **`pv-core`, exported through `pv-ffi` as free functions**

**Decision:** the generator is a new `crates/pv-core/src/generator.rs`, a port of the canonical
TypeScript implementation, exported through `pv-ffi` as **free functions that take no `FfiUserKey`**.

**Rejected:** `pv-ffi` exposes a `random_bytes` primitive and Swift performs the rejection sampling
itself. Rejected on merit, twice over. First, it satisfies the *literal* wording of the phase's
success criterion — "generator uses the `pv-core` CSPRNG" would still grep green — while relocating
the part that can actually be wrong (modulo bias in rejection sampling, charset composition,
guaranteed-class placement) into Swift, where no cross-language parity test can see it. A criterion
that passes while the risk moves somewhere unobservable is the exact failure shape this repo has now
paid for seven times. Second, the generator must remain reachable **with the vault locked** — the
extension's `generate-handler.ts` header states it must never hold an unlocked User Key — so binding
generation to a key-holding handle would be a functional regression against the existing clients.

Note what this record does *not* claim: UI-06's premise as written is false. There is no generator in
`pv-core` or `pv-wasm` today to "wire up" (baseline recorded in L-15). This is a first-time port, and
it is planned as one.

**Binary-size rule this record commits to, to be amended by 38-04 with measured numbers:** if the
release `pv-wasm` `.wasm` grows by more than **50 KB** once `generator.rs` is unconditional in
`pv-core`, the module moves behind a `pv-core` cargo feature that `pv-ffi` enables and `pv-wasm` does
not; below that threshold it stays unconditional. The EFF wordlist is the bulk of it (a fourth copy
in the repo, ~90 KB of source text before compression).

In **either** outcome the explicit test command that covers the module must be recorded here,
because a feature-gated module is silently skipped by the workspace-wide default command — a green
`cargo test --workspace` would then be evidence of nothing. 38-04 records the command it actually
ran.

**Residual risk:** the product now carries **two** generator implementations (TypeScript for
web/extension, Rust for iOS), and they can drift. Mitigation is 38-04's byte-for-byte parity test
over the constants and the wordlist — not a behavioural sample, a structural comparison — plus a
backlog item for later convergence of web/extension onto the Rust generator via `pv-wasm`. Two
implementations is hereby a **recorded state, not an accident** (research OQ-9).

### DR-38-B — Swift item field model: **hand-written mirror of `packages/pv-ui/vault/types.ts`**

**Decision:** the Swift item model is hand-written in `ios/PasskeyVault/PasskeyVault/Vault/`, mirroring
`packages/pv-ui/vault/types.ts` (410 lines), which is the single source of truth for the field model
across every client.

**Rejected:** generate or derive the Swift model from `pv-ffi` types. Rejected on an observed fact,
not a preference: `crates/pv-core/src/items.rs` **has no field model at all** — it treats the item
payload as opaque `&[u8]` and only ever encrypts/decrypts it. There is literally nothing in Rust to
mirror. Deriving the iOS field model from `pv-core` would derive nothing; inventing one in Rust to
derive *from* would create a third source of truth competing with `types.ts` and the Swift mirror,
which is strictly worse than two.

The union has **six** members — `login | card | identity | note | totp | passkey`
(`packages/pv-ui/vault/types.ts:4`) — not the five the ROADMAP and REQUIREMENTS name. The reconciling
reading is that five is the *create/edit* surface and six is the *render* surface; that reading is
well-supported but is an **inference** and is recorded as one in L-14. What is not in dispute, and
what this decision binds: the decode path must tolerate a `passkey` row, or a user who created a
passkey in the extension gets a broken list on iOS.

**Residual risk:** permanent drift between the TypeScript union and the Swift mirror, with no
compiler anywhere that can see both. Named guard: 38-03 carries a parity check that fails when the
Swift type union and the TypeScript union diverge, and it is required to be demonstrated red before
it is trusted green.

### DR-38-C — Item and folder wire JSON: **produced by `serde_json` inside `pv-ffi`**

**Decision:** the on-wire JSON for items and folders is produced and consumed **inside `pv-ffi`** by
`serde_json`, through `encrypt_item_wire`, `decrypt_item_wire`, `encrypt_item_combined_json` and
`decrypt_item_combined_json`. Swift never builds the persisted JSON with `JSONEncoder`.

**Rejected:** Swift assembles the JSON from the existing `FfiEncryptedItem` record. Rejected because
Foundation encodes `Data` as **base64** by default, while every other client in this project emits a
JSON **number array**, and `pv-server` stores the field as opaque `TEXT` — so the server accepts both
encodings happily and returns whichever it was given. The divergence would therefore **not** surface
as a format error at the API boundary. It would surface later, to a user, in the web client, as an
`undecryptable` row — which this codebase reads as a *tampering* signal. Identical in shape to
landmine D-21 (`passkey_types::Bytes`) and to the `pw_wrapped_uk` problem DR-37-A already settled the
same way. Server-visible is not recipient-decrypted.

The record-shaped `encrypt_item` / `decrypt_item` exports **stay**. They serve the in-process AutoFill
path (Phase 41), which never touches the server and for which the record shape is the better API.
The crate therefore deliberately offers two shapes, and this record fixes which is which: **the
persistence path — anything whose bytes reach `pv-server` — must use the `*_wire` /
`*_combined_json` functions.** The record API is for in-process use only.

**Residual risk:** two ways to do one thing, and the wrong one is not a compile error. Guard is
38-02's byte-shape regression test, which asserts on the actual emitted JSON rather than on a
round-trip through the same encoder (a round-trip agrees with itself no matter how wrong it is).

### DR-38-D — Snapshot cover: **installed on scene resign-active, forced layout pass, flat opaque colour**

**Decision:** the app-switcher cover is installed on scene **resign-active**, forced to render with an
explicit layout pass rather than left to SwiftUI's own commit timing, and it is a **flat opaque
colour** — not the logo, not a blurred screenshot.

**Rejected:** three alternatives, each on merit. SwiftUI `scenePhase` alone — nothing orders the SwiftUI
commit before the OS takes its snapshot, so it is a race the framework gives no way to win;
`.privacySensitive()` — inert without a privacy redaction *reason*, which the system sets only for
Lock Screen widgets, so it is a no-op in this context; and `sceneCaptureState` — a **detector**, it
reports that capture is happening, it does not prevent it.

The resign-active-versus-`.background` trigger question is **genuinely open** (research D3: one probe
argues resign-active is strictly stronger because it buys the render pass real time; another warns
resign-active also fires for Control Center, incoming calls and permission alerts, so a cover added
there and removed in `didBecomeActive` can race). 38-05's discriminating arm settles it. **Whichever
arm wins is written back into this record** — explicitly, with its evidence. It is not to be kept
merely because it happened to come out green.

**Residual risk:** resign-active fires for non-backgrounding interruptions, so the cover can flash
during a Control Center pull or an incoming call. Accepted: a spurious cover is a cosmetic defect, a
missing cover is a disclosure of vault contents to the app switcher.

### DR-38-E — Secret field values in Swift: **held as `String`, with the limitation stated not glossed**

**Decision:** decrypted secret field values are held as Swift `String`.

**Rejected:** hold them as `[UInt8]` behind a rendering wrapper. Rejected on merit: every SwiftUI
text-rendering API, every pasteboard API and every accessibility API takes `String`. A `[UInt8]`
wrapper would therefore have to convert at each of those call sites, producing **more** unzeroable
heap copies than the raw `String` it was introduced to avoid, while adding the appearance of a
protection that is not there. A control that increases the harm it names is worse than the honest
absence of one.

**Residual risk:** stated plainly rather than mitigated away — `pv-core` returns a self-wiping
`Zeroizing<Vec<u8>>` from `decrypt_item` precisely so the payload carries its own wipe obligation, and
**that guarantee ends at the UniFFI boundary**. A Swift `String` is heap-allocated, may be copied by
the runtime at will, and cannot be reliably zeroed. This is accepted, in writing, because accepting it
silently is the failure mode this record exists to prevent.

Compensating controls this phase actually builds, and against which the acceptance should be judged:
38-11's lock handler tears down the store, the navigation path, every presented sheet and the reveal
set; and no field value is ever written to `UserDefaults`, nor to any observable property that could
reach a debug description or a crash log.

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

  **Update (Phase 36, Plan 36-01) — the moment named above arrived early.** `default = []` is now set
  in `crates/pv-ffi/Cargo.toml`, and `scripts/build-ios.sh` accepts an explicit `--with-panic-probe`
  flag (appending `--features ffi06-probe`) rather than compiling the probe in unconditionally.
  `PasskeyVaultTests`' own Run Script phase passed `--with-panic-probe` explicitly, so
  `FfiPanicSafetyTests.swift` kept a probe-carrying artifact while the credential-provider extension
  target Plan 36-01 added did not.

  **Update (Plan 37-02) — module ownership moved, the flag's owner changed, the residual did not
  close.** Task 1 moved the "Build pv-ffi XCFramework" Run Script phase (and the flag it passes) from
  `PasskeyVaultTests` to the `PasskeyVault` APP target, because a hosted test bundle and its host app
  cannot both compile the generated bindings into their own module. The script phase's own default
  argument (`${PV_FFI_TEST_VARIANT:---with-panic-probe}`) is unchanged, so the App target's build now
  passes `--with-panic-probe` by default too — this is what lets `xcodebuild build-for-testing`
  produce an App binary whose module carries `ffi06SyntheticPanicProbe` for
  `FfiPanicSafetyTests.swift` to call via `@testable import`. **Recorded honestly, not claimed closed
  (Task 3, Plan 37-02, does the Cargo-level half of this debt but cannot fix this):** there is still
  exactly ONE XCFramework/one Run Script phase, now consumed by BOTH the app target and the test
  bundle, so the synthetic probe is still present in every `PasskeyVault.app` build produced by this
  project's current build recipe — not only test builds. What changed across Phases 36–37 is that a
  consumer which does not opt in (the AutoFill extension's own future production build path) no longer
  gets it *silently* — but the app target itself still does, by the script phase's own default. Phase
  41 (per-target production/test build split) is the named owner of actually separating these; until
  then, `ffi06_synthetic_panic_probe` ships in the real app binary, feature-flagged off by default at
  the Cargo level but turned back on by this one Run Script phase's own default argument.

### 2.6 `pw_wrapped_uk` wire shape — settled against a real row (Plan 37-02, Task 2)

**[OBSERVED]**, superseding `37-RESEARCH.md`'s Assumptions Log row A2, which was
`[INFERRED from serde_json semantics, never observed on a wire or in a DB]`.

Queried directly, via `scripts/check-ios-wire-shape.sh`, against a real `users` row written by a live
iOS-process registration (Plan 37-02, Task 1's tracer — `AccountService.register` -> `pv-ffi`'s
`wrap_user_key_json` -> `POST /api/auth/register` -> a throwaway SQLite DB at
`/private/tmp/pv-phase37-1786535771.db`, never `data/pv.db`):

```
$ scripts/check-ios-wire-shape.sh /private/tmp/pv-phase37-1786535771.db
PASS: serde_json number-array shape
pw_wrapped_uk (first 120 chars): {"nonce":[93,211,52,30,127,131,19,198,228,185,154,65,91,104,162,179,177,13,53,76,133,121,135,232],"ciphertext":[141,69,3
```

**The stored shape is `{"nonce":[<numbers>],"ciphertext":[<numbers>]}` — a plain `serde_json` number
array for each `Vec<u8>` field, exactly the DR-37-A design (`pv-ffi`'s `wrap_user_key_json`/
`unwrap_user_key_from_json` own both clients' encoding) and exactly A2's inference.** Never a base64
string — the shape Swift's `Codable` `Data` default would have silently produced had any Swift code
in this app encoded the envelope itself instead of treating it as an opaque `String` handed to/from
`pv-ffi`.

This settles the *shape*, not *interop*: a symmetric-but-wrong encoding (both clients independently
agreeing on the same wrong shape) would still look right in this single-direction observation — which
is why Plan 37-03 runs the two-direction cross-client test (a web-registered account's
`pw_wrapped_uk` unlocked from iOS, and vice versa) before this risk is fully retired.

### cross-client interop — settled in BOTH directions, both shown falsifiable (Plan 37-03, Task 1)

**[OBSERVED].** §2.6's own closing sentence named the residual risk: a symmetric-but-wrong encoding
(both clients independently agreeing on the same wrong shape) would still look right in a
single-direction observation. This closes it — `scripts/verify-ios-web-interop.mjs run-interop`
drives all four expectations against a live, isolated `pv-server`, using the REAL `pv-wasm` artifact
(never a hand-written JS re-implementation) on the Node side and the REAL `AccountService`/`pv-ffi` on
the iOS side (`ios/PasskeyVault/PasskeyVaultTests/CrossClientInteropTests.swift`).

**Direction 1 (iOS registers -> web/wasm unlocks).** `CrossClientInteropTests.direction1_iosRegisters_forWebUnlock`
registers a fresh account through the real `AccountService.register`, encrypts a literal fixture
plaintext under the resulting `FfiUserKey`, and persists it as a REAL vault item via the
already-shipped `POST /api/vault/items` (never a server change — `crates/pv-server` diff stays empty).
The external harness reads the account's email and that vault item's `enc_key`/`enc_data` back with a
direct SQL query against the SAME `/private/tmp` database (not stdout/`print()` — see below), then
runs `unlock-web`: `prelogin` -> `deriveAuthMaterial` -> `login` -> `unwrapUserKey` (the REAL `pv-wasm`
decoder) -> `decryptItem`, asserting the decrypted plaintext equals the same literal byte-for-byte.

**Direction 2 (web/wasm registers -> iOS unlocks).** The Node harness registers a fresh account
through the real `pv-wasm` bindings (`deriveAuthMaterial`/`wrapUserKey`/`register`/`login`/`encryptItem`),
then `CrossClientInteropTests.direction2_webRegistered_iosUnlocks` reads the email/password/item JSON
from `PV_INTEROP_EMAIL`/`PV_INTEROP_PASSWORD`/`PV_INTEROP_ITEM_JSON` (see the env-var finding below),
signs in through the real `AccountService.signIn`, decrypts the web-sealed item through `decryptItem`
(the REAL `pv-ffi` decoder), and asserts the plaintext equals a literal authored in that Swift file.

**Both directions were shown able to FAIL, inside the gate itself.** A SEPARATE throwaway account is
registered for each direction, one byte of its stored `pw_wrapped_uk` ciphertext is flipped via direct
SQL `UPDATE` (never re-encrypting — a genuine bit-flip of already-sealed AEAD ciphertext), and the same
unlock path is re-run: both directions reject the corrupted envelope with a genuine AEAD/decrypt
failure (`unwrapUserKey` throwing on the Node side; `unwrapUserKeyFromJson`/`decryptItem` throwing
`FfiError.Decrypt`, surfaced as a failing `xcodebuild test`, on the iOS side) — never a length check,
never a silent accept.

**Full `run-interop` transcript (the real, non-corruption-disabled run):**

```
=== run-interop: two-direction cross-client pw_wrapped_uk proof ===
==> starting pv-server on http://127.0.0.1:8621 against /private/tmp/pv-37-03-interop-1786538993390.db
==> server healthy
==> using simulator C24B6A19-9099-4FCF-B281-9CD786D0D8A1 (iPhone 17)
==> simulator boot state: booted by this script

==> Direction 1: iOS registers via CrossClientInteropTests, Node/wasm unlocks
    iOS-registered account: ios-interop-d1-f444f1e9-0d93-47a9-8407-bc258e5be2fb@example.com
INTEROP D1: PASS

==> Direction 2: Node/wasm registers, iOS (CrossClientInteropTests) unlocks
INTEROP D2: PASS

==> Falsifying Direction 1: a SEPARATE throwaway account, one byte flipped in pw_wrapped_uk
INTEROP D1-FALSIFIED: PASS

==> Falsifying Direction 2: a SEPARATE throwaway account, one byte flipped in pw_wrapped_uk
Failing tests:
	CrossClientInteropTests.direction2_webRegistered_iosUnlocks()
** TEST FAILED **
INTEROP D2-FALSIFIED: PASS

==> tearing down: server + simulator

=== run-interop summary ===
INTEROP D1: PASS
INTEROP D2: PASS
INTEROP D1-FALSIFIED: PASS
INTEROP D2-FALSIFIED: PASS
```
(exit 0; full raw log including xcodebuild's own build noise is longer — this is the harness's own
narration plus the load-bearing lines.)

**The falsification demonstration itself, demonstrated able to fail** (acceptance criterion: run
`run-interop` once with the direction-1 corruption step disabled and confirm it reports
`INTEROP D1-FALSIFIED: FAIL` and exits non-zero) — `PV_INTEROP_SKIP_D1_CORRUPTION=1 node
scripts/verify-ios-web-interop.mjs run-interop`:

```
(PV_INTEROP_SKIP_D1_CORRUPTION=1 -- deliberately disabling the D1 falsification step, to demonstrate the gate can FAIL)
...
INTEROP D1-FALSIFIED: FAIL (PV_INTEROP_SKIP_D1_CORRUPTION=1 -- corruption step skipped on purpose, unlock succeeded, so falsification correctly reports FAIL)
...
INTEROP D2-FALSIFIED: FAIL (PV_INTEROP_SKIP_D1_CORRUPTION=1 -- corruption step skipped on purpose, iOS unlock succeeded, so falsification correctly reports FAIL)

=== run-interop summary ===
INTEROP D1: PASS
INTEROP D2: PASS
INTEROP D1-FALSIFIED: FAIL (...)
INTEROP D2-FALSIFIED: FAIL (...)
```
(exit 1 — the harness's own guard against corruption never having been exercised.)

**Empirical findings recorded, not assumed, from building this task:**

- **`print()` does not survive a Swift Testing run under `xcodebuild test`.** `xcresulttool get log
  --type console` and `test-results activities` both came back EMPTY against a real recorded run of
  this exact test. This project's own `os_log`/`PVPROBE|` convention (Phase 36's probes) was the next
  candidate, but **`xcodebuild test` was ALSO observed to run every test on an EPHEMERAL "Clone N of
  <device>" simulator** — `Test suite '...' started on 'Clone 1 of iPhone 17 - PasskeyVault (NNNNN)'`
  — regardless of whether the base device UDID was already booted, and the clone (with its own
  separate log store) is torn down by the time `xcodebuild test` returns. `xcrun simctl spawn
  <original-udid> log show` afterward cannot see it. Direction 1 therefore moves data out through the
  REAL, already-shipped `POST /api/vault/items` + a direct SQL read, not through any log/stdout
  capture — see `CrossClientInteropTests.swift`'s own header for the full reasoning.
- **`-only-testing:` for a Swift Testing method needs the trailing `()`.** Omitting it
  (`.../direction1_iosRegisters_forWebUnlock`, no parens) silently matches **zero** tests
  (`xcresulttool get test-results summary` reports `"totalTestCount": 0`) while `xcodebuild` still
  prints `** TEST SUCCEEDED **` and exits 0 — a filter that can silently match nothing and still report
  success is this repo's own landmine L-3 family. `scripts/verify-ios-web-interop.mjs`'s
  `runXcodebuildTest` now parses the xcresult's own test count and treats zero as a hard failure.
- **Env-var forwarding to `xcodebuild test`: only the `TEST_RUNNER_`-prefixed spelling works on this
  toolchain (Xcode 26.6/17F113).** Tested directly: `PV_INTEROP_EMAIL=... xcodebuild test
  -only-testing:.../direction2_webRegistered_iosUnlocks()` FAILS in 0.007s (the env-var-missing path);
  `TEST_RUNNER_PV_INTEROP_EMAIL=... xcodebuild test ...` PASSES in 0.5s. `CrossClientInteropTests.env()`
  checks the plain name first (matching this project's other scripts' convention) then the
  `TEST_RUNNER_`-prefixed form; the harness sets BOTH on every invocation so it works regardless of
  which the toolchain actually honors.

`git diff --stat crates/pv-server crates/pv-core crates/pv-provider` stayed empty throughout — every
gap this task found was closed on the iOS/Node harness side, never the server.

### ATS — H1 confirmed: cleartext loopback permitted with no Info.plist key (Plan 37-03, Task 2)

ATS VERDICT: H1

**[OBSERVED].** The built `PasskeyVault.app`'s `Info.plist` (Debug-iphonesimulator,
`GENERATE_INFOPLIST_FILE = YES`, no `INFOPLIST_FILE` build setting) carries **no**
`NSAppTransportSecurity` key at all:

```
$ plutil -p .../PasskeyVault.app/Info.plist | grep -i AppTransport
NO ATS KEY PRESENT
```

And the positive half — a real cleartext `URLSession` call to `http://127.0.0.1:8621` succeeding with
that key absent — is not merely inferred from the negative check above: it is what every single test in
this plan (and 37-02's `AccountFlowLiveTests` before it) already does, dozens of times over, against the
real host-app process. `scripts/verify-ios-server-contract.sh`'s own live run and every
`CrossClientInteropTests`/`AccountFlowLiveTests` invocation this task performed is a positive H1
data point: had ATS refused the connection, every one of those would have failed with
`NSURLErrorAppTransportSecurityRequiresSecureConnection` (-1022), and none did.

**H1 confirmed, H2 refuted** — `GENERATE_INFOPLIST_FILE = YES` needing an `INFOPLIST_FILE`/exception
merge (the H2 remediation the plan's own action text pre-registered) is moot: nothing needs adding.

**Two limitations, stated verbatim rather than allowed to be inferred more broadly than they are:**

1. **A host-app pass is NOT evidence for the AutoFill extension**, which is a separate process with its
   own `Info.plist` (`ios/PasskeyVault/PasskeyVaultAutoFill/Info.plist`) and its own ATS configuration —
   Phase 41 owes its own run against the extension target specifically before this verdict can extend
   to it.
2. **`127.0.0.1` works only because the simulator shares the Mac's network stack** — this is not
   evidence that "networking works on iOS" for a physical device, which needs the Mac's LAN IP over
   `https` and hits ATS for real, on hardware this milestone has never run on (see §5, "Nothing built
   for a physical device").

---

### Keychain `.biometryCurrentSet` — no biometry enrollable on this harness (Plan 37-04, Task 1)

**[OBSERVED].** This session's iPhone 17 / iOS 26.5 simulator has NO biometry ever enrolled, and this
harness has NO headless path to enroll it:

- `xcrun simctl` ships no biometry/passcode subcommand (confirmed directly, `simctl --help`'s full
  subcommand list has neither).
- The documented `xcrun simctl spawn <UDID> notifyutil -s com.apple.BiometricKit.enrollmentChanged 1`
  + `-p` post sequence (`37-RESEARCH.md` §E5) did not change subsequent read behaviour; `notifyutil -g`
  read the value back as `0` immediately after the `-s` write, i.e. the notify-only mechanism does not
  durably flip enrollment state by itself.
- GUI automation via `osascript`/System Events (the Simulator.app Features → Face ID → Enrolled menu
  item) is denied in this environment: `System Events got an error: osascript is not allowed assistive
  access (-1719)` — no accessibility permission is grantable non-interactively here.

**Concrete effect on `UkEnvelopeStore`:** `store()` (`SecItemAdd` with
`SecAccessControlCreateWithFlags(kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, [.biometryCurrentSet])`)
**succeeds** — `errSecSuccess` — refuting the E1 hypothesis that this class fails to *add* on a
passcode-less simulator. The immediately-following `SecItemCopyMatching` (via a fresh, correctly
`kSecUseAuthenticationContext`-supplied `LAContext`) then returns `errSecItemNotFound` (**-25300**), not
success and not a Face ID sheet. This is a NEW data point extending `37-RESEARCH.md`'s documented row for
`-25300` ("also the pre-iOS-15 code for a biometry-set change") to the "never enrolled at all" case on
iOS 26.5 — and it lands in exactly the `envelopeUnusable` bucket ACC-03's equivalence class already
covers, so the existing design requires no change; it simply could not be driven to its `.ok` branch on
this harness.

**Scope of this finding:** this is a statement about THIS session's simulator and automation
environment, not a claim about simulators in general or about physical devices — consistent with MP-1's
pre-registered limitation. 37-04's `KeychainEnvelopeTests` therefore proves the store/read/classify
plumbing and, via a second non-ACL Keychain item, the `pv-ffi` decrypt-of-real-bytes property, but could
not exercise the ACL's `.ok` path end-to-end on this harness. 37-05's E1/E2 own the question of whether
a DIFFERENT session (with Face ID interactively enrolled through the Simulator.app UI by a human, or on
a physical device) changes this.

**AMENDMENT (Plan 37-05, Task 1) — the "GUI automation is denied" half of the finding above did NOT
hold in this session, and Face ID is now Enrolled on the same device.** The claim above ("GUI automation
via `osascript`/System Events is denied … no assistive-access permission") was re-tested directly at the
start of 37-05, not assumed carried forward:

```
$ osascript -e 'tell application "System Events" to return UI elements enabled'
true
```

Assistive-access permission is granted in this session's environment (a change in the HOST machine's own
permission grants between the 37-04 and 37-05 sessions, not a code or simulator change). Driving the
Simulator.app **Features → Face ID → Enrolled** submenu via `osascript`/System Events now works, and on
the `iPhone 17` simulator (`C24B6A19-9099-4FCF-B281-9CD786D0D8A1`) used throughout this phase, **Face ID
is ALREADY Enrolled** (`AXMenuItemMarkChar` on the "Enrolled" menu item reads `✓`):

```
$ osascript -e '... query the "Enrolled" menu item's AXMenuItemMarkChar ...'
✓
```

**This does not retract the 37-04 finding for the SESSION it was recorded in** — it was true then, for
that session's environment. It does mean 37-05's own E1/E2 (below) run against a simulator with Face ID
genuinely enrolled, not the never-enrolled state 37-04 documented.

---

## 2.7 Plan 37-05, Task 1 — the instrument, and E1/E2/E4/E6

### Task 1(a) — settling the instrument before trusting any reading

**[OBSERVED].** 35-03 and 37-03 both recorded that `xcodebuild test -destination "platform=iOS
Simulator,name=<Name>"` (a bare device NAME) spins up an ephemeral "Clone N of `<Name>`" simulator that
does not carry the source device's Face ID enrollment state. This matters here specifically because
every biometry observation in this plan is attributed to `C24B6A19-9099-4FCF-B281-9CD786D0D8A1`.

Tested directly: `xcodebuild test -destination "platform=iOS Simulator,id=C24B6A19-9099-4FCF-B281-9CD786D0D8A1"
-parallel-testing-enabled NO` (pinning by exact **`id=`**, never `name=`), then reading the resulting
`.xcresult`'s own structured device record:

```
$ xcrun xcresulttool get test-results tests --path <xcresult> | grep -A3 '"device"'
"device" : {
  "deviceId" : "C24B6A19-9099-4FCF-B281-9CD786D0D8A1",
  "deviceName" : "iPhone 17",
  ...
```

The reported `deviceId` is byte-identical to the already-booted UDID, and `deviceName` reads `"iPhone
17"` — never `"Clone 1 of iPhone 17"`, the shape 35-03/37-03 observed when pinning by `name=` instead.
**Pinning by exact `id=<UDID>` plus `-parallel-testing-enabled NO` avoids the clone on this toolchain.**
This is the mechanism `scripts/run-ios-biometry-experiments.sh` and every `xcodebuild test` invocation in
this plan use — never `name=`. `xcrun simctl list devices | grep -c Booted` was `1` throughout this
determination.

**A second instrument finding, load-bearing for how results are extracted, not just how the device is
selected:** Foundation's `Process` type is **unavailable on iOS** — `error: cannot find 'Process' in
scope` — a genuine compile error, not a runtime restriction. This forecloses the design this task's own
`<action>` text anticipated (spawning `xcrun simctl spawn … notifyutil` FROM inside the test process,
timed against the blocking Keychain call). What was found to work instead, verified with a throwaway
probe test and read back from the host shell: a plain `Data(...).write(to: URL(fileURLWithPath:
"/private/tmp/..."))` from inside a Simulator-hosted test process lands on the REAL host filesystem
(`ls -la /private/tmp/pv37-05-filewrite-check.txt` showed the file, with the exact bytes written, right
after the test run). Every experiment below writes its result to a fixed `/private/tmp/pv37-05-<name>.txt`
path; the HOST shell (not the test process) is what sends `notifyutil` biometric-response notifications,
timed via a fixed sleep before `xcodebuild test` returns.

### E1 — can this simulator hold a passcode?
E1 OBSERVED status=0

`SecItemAdd` of the ACC-03-shaped item (`kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` +
`.biometryCurrentSet`) returned **`errSecSuccess` (0)**. The shipped protection class is addable — and,
combined with Face ID now being Enrolled (see the amendment above), testable as actually shipped, not
only as a degraded fallback class. This is consistent with, and now more directly confirms, 37-04's own
informal observation (`SecItemAdd` succeeding regardless of enrollment state).

### E2 — does this simulator enforce the ACL?
E2 VERDICT: Result B

`SecItemCopyMatching` with `kSecReturnData: true` and **NO** `LAContext` at all, against a freshly-stored
ACC-03 envelope, on a device with Face ID genuinely Enrolled (confirmed above): status **`0`**, and the
returned bytes equal the literal 32-byte fixture **immediately** — the test suite's own wall-clock
duration was `2026-08-12 23:13:24.376` to `...:24.377`, i.e. **under 2ms**, well before a `pearl.match`
notification sent 3 seconds later by the host script ever had a chance to matter. No system sheet, no
block, no wait.

**Required response, per this plan's own mandated wording:** *the OS gate was configured correctly and
the code path was exercised; enforcement was NOT observed, because the simulator returns ACL-protected
data unconditionally.* This is a genuinely new, stronger data point than 37-04's (which ran with NO
biometry enrolled at all and got `errSecItemNotFound` via a real `LAContext`); this run has Face ID
Enrolled AND supplies no `LAContext` whatsoever, and the mock AKS still released the data. **Task 2 runs
E3-alt, not E3, per this result.** MP-1 item 1 (whatever this simulator's `securityd`/mock AKS does is not
evidence for a physical device) applies at full force here — this is the single most consequential
observation in the whole plan and it falls entirely on the "cannot prove enforcement here" side.

### E4 — kSecAttrAccessible x kSecAttrAccessControl collision
E4 OBSERVED status=-50

Adding the same item twice — once with only `kSecAttrAccessControl`, once with BOTH that AND
`kSecAttrAccessible` naming the same class — returned **`errSecParam` (-50)** on the second add. **The
third-party folklore is right, and `UkEnvelopeStore`'s existing design rule (ACC-03: the class is
supplied ONLY through `SecAccessControlCreateWithFlags`, never additionally as `kSecAttrAccessible`) is
now empirically confirmed correct on this harness, not merely a defensive convention.**

### E6 — does anything expire it?
E6 OBSERVED item_survived_reboot=yes

The ACC-03-shaped envelope was written (`status=0`), the simulator was `simctl shutdown` then `boot`ed
(never more than one simulator booted during the cycle), and a fresh, separate test process
(`E6ReadBackTests`, since the original process is torn down by the reboot) read the item back:
`item_survived_reboot=yes status=0`. **Confirms ACC-06's premise operationally**: nothing expires a
Keychain item across a shutdown/boot cycle on this harness; expiry must remain a single, explicit
`SecItemDelete`, exactly as ACC-03/ACC-06 already designed for.

### MP-1 limitations recorded verbatim (items 1, 3, 4, 6)

1. **Item 1 (whatever this simulator's `securityd`/mock AKS does is not evidence for a physical
   device).** Directly load-bearing for E2 above: "the simulator does not enforce" is a true statement
   about THIS mock AKS, never a claim extending to real hardware.
3. **Item 3 (`simctl shutdown`/`boot` is not a device reboot).** E6's "survived" result is a statement
   about the simulator's own persistence semantics, not a hardware reboot's.
4. **Item 4 (a simulator that cannot hold a passcode would leave the shipped class unverified).** Does
   NOT apply this run — E1 observed `status=0`, so the shipped class WAS exercised, not degraded.
6. **Item 6 (say so plainly rather than softening the criterion).** Applied directly to E2: the result is
   recorded as "enforcement NOT observed" in exactly those words, not reworded into a pass.

---

## 2.8 Plan 37-05, Task 2 — E3-alt, E5, and ACC-04's honest limit

Per E2's own Result B verdict, **E3 does not run — E3-alt runs instead**, exactly as this plan's own
`<action>` text requires.

### E3-alt — code asks the OS and the ACL carries the right constraint (NOT an enforcement proof)
E3-ALT BRANCH: ran (E2 = Result B)

**`SecAccessControlCreateWithFlags` constructs successfully** and its `CFCopyDescription` was dumped:

```
<SecAccessControlRef: akpu;od(cbio(pbioc()pbioh()));odel(true);oe(true)>
```

`cbio(pbioc()pbioh())` names the biometry-current-set constraint inside the ACL's own internal
description — positive evidence the object carries the right constraint, independent of whether this
simulator enforces it (E2 already answered that: it does not).

**A THIRD independent negative result, not anticipated by the plan's own text:**
`LAContext.evaluateAccessControl(_:operation:localizedReason:)` — the explicit LA-level gate E3-alt's own
design calls for — **throws unconditionally on this simulator**, regardless of a `pearl.match` or
`pearl.nomatch` signal sent beforehand:

```
Error Domain=com.apple.LocalAuthentication Code=-1020 "This call is not supported on iOS Simulator."
```

Observed identically on both the match-signal run and the nomatch-signal run — the error fires before
either notification could matter, confirming (a third way, after E2's SecItemCopyMatching-without-context
result and 37-04's session-specific "no biometry enrollable" finding) that this simulator's biometric
gating machinery is not faithfully modeled for at least this API. **This forecloses demonstrating the
POSITIVE half of E3-alt (a successful `evaluateAccessControl` reaching `SecItemCopyMatching`) on this
harness at all — only the negative half (never reaching it) is demonstrable, and it is demonstrable only
because EVERY attempt fails, not because a genuine match/nomatch distinction was exercised.**

**What IS proven, positively, with a falsification transcript:** the app's own gating code
(`e3alt_nonMatchingFaceNeverReachesSecItemCopyMatching`) correctly does NOT proceed to
`SecItemCopyMatching` when `evaluateAccessControl` fails, for ANY reason — asserted via an observable side
effect (`reachedSecItemCopyMatching`, set `true` only if the code actually executes the read), not the
absence of a log line. Falsification demonstrated live: the assertion was inverted
(`#expect(reachedSecItemCopyMatching == true)`) with no other code change, re-run, and failed exactly as
expected —

```
✘ Test e3alt_nonMatchingFaceNeverReachesSecItemCopyMatching() recorded an issue at
  BiometricGateSimulatorTests.swift:417:13: Expectation failed: (reachedSecItemCopyMatching → false) == true
```

— then reverted and re-confirmed green (`xcodebuild test -only-testing:PasskeyVaultTests/E3AltTests`
exit 0).

**Stated in words, per this plan's own mandatory disclaimer:** *this is NOT a proof that the OS would
deny the read on a device; it is a proof that the code asks the OS before reading, plus a proof that the
ACL object carries the right constraint.* On THIS simulator, "asking the OS" via `evaluateAccessControl`
always fails with "not supported" — a data point about the simulator's own limits, not about whether a
real device's gate would open or close.

### E5 — SC5, both halves, and the honest FAIL
E5 OBSERVED status=0 row_survived=n-a
E5 UNPROVABLE — `.biometryCurrentSet` invalidation on a biometric-set change is not simulated on this
harness: a real read after toggling Face ID Enrolled off (Simulator.app Features -> Face ID -> Enrolled,
driven via `osascript`/System Events `AXPress`, now that assistive access is granted this session) still
returned the correct 32 bytes with `status=0`, never one of {-25293, -25300, -25291}. This is MP-1 item 2
(a proof limitation this phase could not overcome), recorded here rather than softening SC5's criterion.

**Part A** (`e5_partA_storeAndReadBeforeChange`): stored the envelope, read it back through the REAL
production `UkEnvelopeStore.read` (a real `LAContext`), recorded `domainState.biometry.stateHash` before
any change:

```
stateHash=5ueZPT6+w8K5je9JgTv7pJ4pSSuHaSYYXIq+44zYx6A= outcome=ok bytes-match=true
```

**Between Part A and Part B**, the enrolled set was changed: Simulator.app's Features -> Face ID ->
Enrolled menu item was toggled via `osascript`/System Events `perform action "AXPress"`, in a SEPARATE
`xcodebuild test` invocation (the change is driven from the host, not from inside the test process, per
this plan's own design). **Read-back reliability of the checkbox's own `AXMenuItemMarkChar` was itself
inconsistent across different scripting approaches this session** (a `click`-based read sequence reported
`✓` at a point where an `AXPress`-based read sequence, run moments later with no intervening toggle,
reported empty/unchecked) -- recorded honestly as a genuine ambiguity in the GUI-automation channel
itself, not smoothed over. The LAST stable, repeated reading before Part B ran showed the "Enrolled" item
unchecked (empty `AXMenuItemMarkChar`, confirmed twice in a row with no intervening action), which is
what this record treats as "the enrolled set was changed" for Part B's purposes. A subsequent attempt to
toggle it back ON, using the identical `AXPress` mechanism that produced the OFF reading, did NOT change
the read-back state (still empty afterward) — left as an additional, honestly-recorded uncertainty about
whether this GUI channel reliably drives the underlying simulator biometry state at all, rather than
merely the menu's own displayed checkmark.

**Part B** (`e5_partB_readAfterChangeAndCheckRecovery`): read the envelope again through the SAME
production API:

```
status=0 row_survived=n-a stateHash=5ueZPT6+w8K5je9JgTv7pJ4pSSuHaSYYXIq+44zYx6A= stillOkBytesMatch=true
```

**The read still succeeded, with the byte-identical correct key, and the `stateHash` did not change at
all** (identical to Part A's). Two consistent readings — the read itself, and the unchanged `stateHash` —
both point the same direction: **this platform does not simulate `.biometryCurrentSet` invalidation on an
enrolled-set change**, independent of whatever ambiguity exists in the GUI-toggle channel's own
reliability (E2 already established, via a completely different code path with no dependency on the GUI
toggle at all, that this simulator's mock AKS does not enforce the ACL in the first place — a platform
that does not gate on biometry at read time is not a strong candidate to invalidate on a biometry
change either, and E5's result is consistent with that).

**Step 4 (row survival) does not apply** — the read never entered the `.envelopeUnusable` branch, so the
attributes-only follow-up query and the naive-re-add/`errSecDuplicateItem` check were never reached; both
are conditioned on that branch in the test code and neither wrote a result file, honestly reflecting that
they did not run.

**Positive user-visible half, verified independent of E5's own FAIL, over the code the app actually ships**
(`ios/PasskeyVault/PasskeyVault/Core/I18n/Dictionary.swift`): `BiometricUnlockOutcome.envelopeInvalidated`
maps to `.unlockEnvelopeInvalidated`, whose English copy is *"The fingerprint or face enrolled in Face
ID/Touch ID changed. Unlock with your master password below — biometrics will re-enable automatically."*
— contains "password", asserted via `t(.unlockEnvelopeInvalidated, locale: .en).localizedCaseInsensitiveContains("password")`,
independently of whether THIS harness can ever reach that branch live.

### MP-1 limitations recorded verbatim (items 2, 5), Task 2

2. **Item 2 (whatever this simulator's biometric-set-change signal does is not evidence a real device
   invalidates the same way).** E5's FAIL result is a statement about this mock AKS's own behaviour under
   a simulated enrolled-set toggle, never a claim that a physical device would fail to invalidate.
5. **Item 5 (the record must say so plainly rather than soften the criterion when a proof cannot be
   obtained here).** Directly applied: SC5's `.biometryCurrentSet` invalidation guarantee is recorded as
   **unprovable on this harness**, in exactly those words, with the `E5 UNPROVABLE —` marker line, rather
   than declaring SC5 satisfied on the strength of the classifier existing.

---

## 2.9 Plan 37-05, Task 3 — Secure Enclave probes, ACC-05 R1, and the phase's closing gates

### E-SE-2 — is the Secure Enclave available at all on this harness?

`SecureEnclave.isAvailable` = **`true`**, and a plain (unguarded, no biometric `accessControl`)
`SecKeyCreateRandomKey` with `kSecAttrTokenIDSecureEnclave` **succeeds** on this simulator. This is
notable because Secure Enclave availability inside iOS Simulator is commonly assumed unavailable by
default developer folklore — on THIS toolchain (Xcode 26.6, iOS 26.5 runtime, Apple Silicon host) it is
available for key generation, even though (see E-SE-4 below) any USE of it gated by a real
`LAContext`/biometric `accessControl` still hits the same LocalAuthentication wall E3-alt hit. So E-SE-1/
E-SE-1b were NOT skipped (unlike the plan's own contingency for an unavailable SE).

### E-SE-1 — algorithm support probe, with the mandatory RSA control
E-SE-1 OBSERVED decrypt-ecies=true keyExchange-ecdh=true rsaControl=false

`SecKeyIsAlgorithmSupported` on a real SE-backed EC key: ECIES decrypt (`…CofactorVariableIVX963SHA256AESGCM`)
= **true**, ECDH key exchange (`…CofactorX963SHA256`) = **true**. **Mandatory RSA control**
(`kSecKeyAlgorithmRSAEncryptionOAEPSHA256` on the same EC key) = **`false`**, exactly as required — the
harness is not lying, so the two `true` results above are trustworthy.

### E-SE-1b — the load-bearing HPKE round trip, with its mismatched-info control
E-SE-1B OBSERVED roundtrip-matches=true mismatched-info-threw=true

`SecureEnclave.P256.KeyAgreement.PrivateKey()` + `HPKE.Sender`/`HPKE.Recipient` with
`P256_SHA256_AES_GCM_256`, round-tripping 32 literal bytes through a real SE key: **byte-exact match**.
**Control:** opening with a mismatched `info` string throws, as required. **This is the strongest
positive confirmation this plan produces of ACC-05's own "TRUE half"** (`ios/IOS-SPIKE-LOG.md` §1): an
SE-protected User Key envelope really is buildable, exactly as the header/`.swiftinterface`-cited
mechanism claimed — the rejection of ACC-05 stands on R2–R5, never on "it doesn't work".

### E-SE-4 — see the ACC-05 R1 entry above (§1), where the confirm-or-amend obligation is discharged in
place rather than duplicated here. Summary: R1 stays `[INFERRED]`; the realistic-threat comparison
cannot be exercised on this harness for either side, because SE-key creation under a real biometric
`accessControl`/`LAContext` hits the identical `-1020` "not supported on iOS Simulator" error E3-alt's
`evaluateAccessControl` already hit — a fourth instance of that exact error this plan run.

### E-SE-3 — deferred, as planned
No AutoFill extension target consumes an SE-backed key yet (Phase 36 built the skeleton only; Phase 41
owns the credential-list/fill logic). No argument in this plan or in ACC-05's record depends on E-SE-3.

### Closing gates for the whole phase

- **SC1 — `crates/pv-server` untouched.** `git diff --stat crates/pv-server` prints nothing. Holds for
  the whole phase (every plan 37-01..37-05 confirmed this independently in its own SUMMARY).
- **SC3 — decision-before-code ordering, asserted by comparing commit positions, not by prose.**
  - ACC-03 commit (`acc`, first commit introducing `### ACC-03 — Keychain layout` into this file):
    `df53333` (`df533335ef35a9773e56e72f33cd3e8b61de63be`).
  - First Phase-37 code commit introducing `derive_auth_material` into `crates/pv-ffi/src/lib.rs`
    (`code1`) AND the commit adding `Core/AccountService.swift` (`code2`): **both resolve to the SAME
    commit**, `120b227` (`120b2273138c461321782ddb6fe7d39cad710384`) — Plan 37-02 Task 1's tracer commit,
    which introduced the FFI surface and the app-level account service together.
  - `git merge-base --is-ancestor df53333 120b227` — **succeeds**: `acc` is a strict ancestor of `code1`/
    `code2`.
  - The REVERSED comparison, `git merge-base --is-ancestor 120b227 df53333` — **fails**, as required: the
    comparison is discriminating, not a same-commit or non-linear-graph false positive.
  - **SC3 holds**: the ACC-03 decision record (`df53333`, committed in Plan 37-01) is a genuine ancestor
    of the first Phase-37 code commit (`120b227`, Plan 37-02).
- **QA-05 — `.planning/` absent from this worktree's own commits.**
  `git log --oneline $(git merge-base main ios/spike)..ios/spike -- .planning/` prints nothing. Note
  (per this plan's own instruction): the ROADMAP's Phase 42 SC4 wording
  (`git log --all --full-history -- .planning/`) would NOT be empty on this branch, because `ios/spike`
  inherits `main`'s full history and `.planning/` commits exist there (a different, parallel session's
  work) — the worktree-scoped `merge-base..ios/spike` form used here is the correct check for THIS
  worktree's own commits; Phase 42 owns restating the ROADMAP wording to match.

### All five ROADMAP Phase 37 success criteria, with evidence or recorded impossibility

| # | Criterion (paraphrased from ROADMAP) | Status | Evidence / recorded impossibility |
|---|---|---|---|
| SC1 | `crates/pv-server` diff empty for the whole phase | **MET** | `git diff --stat crates/pv-server` empty, confirmed above and in every plan's own SUMMARY |
| SC2 | Password unlock + account creation works end-to-end against a live server | **MET** | 37-02 (`AccountFlowLiveTests.swift`, tracer + 2 expansion tasks), 37-03 (two-direction cross-client interop, falsified) |
| SC3 | ACC-03 decision recorded before any Phase-37 code | **MET** | Commit-position comparison above: `df53333` (ACC-03) is a strict ancestor of `120b227` (first code commit); reversed comparison fails, confirming discrimination |
| SC4 | Biometric unlock gates real key release (ACC-04) | **RECORDED AS UNPROVABLE ON THIS HARNESS** | E2 = Result B: this simulator returns ACL-protected data unconditionally with no `LAContext`. E3-alt and E-SE-4 both additionally show `LAContext.evaluateAccessControl`/SE-key-creation-under-accessControl are unconditionally unsupported (`-1020`) on this simulator. The CODE is proven correct (ACL construction, the three-bucket classifier, the gating logic never reaching `SecItemCopyMatching` without a successful evaluation) — enforcement itself was never observed to hold on THIS platform, and is recorded as such rather than claimed |
| SC5 | `.biometryCurrentSet` invalidation on an enrolled-set change (ACC-06 adjacency) | **RECORDED AS UNPROVABLE ON THIS HARNESS** | E5: a read after toggling Face ID Enrolled off still returned the correct 32 bytes (`status=0`), never the documented equivalence class. Paired with an `E5 UNPROVABLE —` record per this plan's own mandatory gate |

**SC4 and SC5 are the two criteria this simulator genuinely cannot prove.** Every other criterion (SC1,
SC2, SC3) is fully met with mechanical evidence. This is the honest bottom line the plan's own objective
asked for: *"either prove ACC-04 on both sides or record honestly that the platform under test cannot
prove it — never by adjusting the assertion until it passes."* No ROADMAP wording was changed to
accommodate either negative result.

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

**Plan 36-04 update — a fourth instance, a different shape, the same class.** `36-RESEARCH.md`'s own
E7 pseudocode resolved the extension's PID via
`xcrun simctl spawn <udid> launchctl list | grep -i PasskeyVaultAutoFill`. That grep can **never**
match: the extension's real bundle id is `cloud.blonie.PasskeyVault.AutoFill` — **with a dot** between
"PasskeyVault" and "AutoFill" — so the contiguous literal `PasskeyVaultAutoFill` (no dot) is never a
substring of the label `launchctl list` actually prints. Confirmed directly, live, more than once this
session: `pgrep -f` against the compiled executable's own path found the process alive at the exact
moment the `launchctl list | grep` shape found nothing, run back-to-back. This is Pitfall 6's own
standing rule (`36-RESEARCH.md`) proven necessary a session later, against fresh code: *"assume any
SDK/runtime grep is wrong until it is shown returning a hit for a string known to be present."* Fixed
in `scripts/ios-vmmap-crosscheck.sh` by resolving the PID via `pgrep -f` against the compiled
executable's own path on the HOST process table, with the search-shape demonstration (against
SpringBoard) built into the script itself rather than left as a one-off manual check.

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

**Plan 36-04 update — a fifth instance, self-referential counting.** `scripts/ios-memory-gate.sh
measure`'s first draft computed its "expected run count" via `grep -c` against the SAME evidence file
it was about to parse, then compared the parsed line count against that same derived number. Deleting
one run's line from a scratch copy changed BOTH numbers together, so the comparison could never
disagree with itself — a real run with a genuinely missing ordinal would have read green. Caught before
this plan's evidence was captured (not after), by actually performing the mandated falsification
(deleting a real run's line and observing the gate still print `PASS`). Fixed by checking that the
parsed run/invocation numbers form the *complete permutation* `1..N` — a check with an independent
shape from the thing it is validating, not a restatement of it in different words.

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

### L-14 — the app cannot be built in Release: a Swift compiler crash in generated UniFFI code

**Found 2026-08-16, first time the app target was built optimized. BLOCKS SHIPPING. Not our code.**

`xcodebuild build -configuration Release` fails with a `swift-frontend` crash — infinite recursion,
the same frame repeating at one address until the stack is exhausted:

```
4.  While running pass #54311 SILFunctionTransform "EarlyPerfInliner" on SILFunction
    "@$s12PasskeyVault15UniffiHandleMap33_3020C04B17195456C4681D445E4E403DLLCfD"
4   swift-frontend  0x000000010622b44c isCallerAndCalleeLayoutConstraintsCompatible(swift::FullApplySite) + 236
5   swift-frontend  0x000000010622b44c isCallerAndCalleeLayoutConstraintsCompatible(swift::FullApplySite) + 236
    ... (same address, repeating)
```

The mangled symbol is `UniffiHandleMap.deinit` — the generic `fileprivate final class UniffiHandleMap<T>`
that `uniffi-bindgen-swift` emits into `pv_ffi.swift` (~line 406). **Generator output, not hand-written
code**, so it cannot be fixed by editing our sources.

**The boundary, measured rather than assumed:**

| `SWIFT_OPTIMIZATION_LEVEL` | Result |
|---|---|
| `-O` (Release default) | **crash** |
| `-Osize` | **crash** |
| `-Onone` (Debug default) | builds, and has all day — every test in Phases 35–37 ran here |

So it is the optimizer, not the bindings' correctness, and any optimizing mode reproduces it.

**Why this stayed invisible until Phase 38.** Phase 35 built exactly one consumer (`PasskeyVaultTests`),
Phases 36–37 added the extension and moved module ownership — all Debug. Nothing had ever compiled the
generated bindings at `-O`. This is the same shape as the `ffi06-probe` debt: a fact that was true only
because exactly one build path existed, surfacing the moment a second one did.

**Do NOT "fix" this by shipping `-Onone`.** It builds, which makes it the tempting answer, and it means
shipping an unoptimized crypto client. Three real options, none taken yet:

1. **Bump UniFFI** off the `=0.32.0` pin — the emitted `UniffiHandleMap` shape may differ. Cheapest to
   test, and the pin is ours to move. Note IOS-06 chose `=0.32.0` deliberately, so a bump needs the
   opaque-handle audit (`scripts/audit-ffi-opaque-handles.sh`) re-run against the new codegen.
2. **Isolate the generated bindings into their own module built `-Onone`**, leaving the app optimized.
   Surgical and keeps the security posture, but it is per-target build-graph work — and **Phase 41
   already owns the per-target production/test split**, so this should land there rather than being
   invented twice. **The crash dump supports this one specifically:** the failing frontend invocation
   compiles `pv_ffi.swift` in the SAME whole-module pass as all fifteen app sources, with
   `-enable-default-cmo`. Moving it to its own module removes the generated `deinit` from the app
   module's SIL pipeline outright, rather than hoping a different `-O` level steps around it (which
   `-Osize` already did not).
3. **Report upstream and pin the toolchain.** Xcode 26.6 / Swift 6.3.3. Worth doing regardless of which
   of the above is chosen; a compiler crash on generator output will hit other UniFFI users.

**Phase 42 owns making this a gate.** A CI that only ever builds Debug would have shipped this. The
QA phase must build Release, or it is measuring the wrong thing — the exact defect class this project
keeps paying for.

### L-13 — a grep for `-fsanitize=`/`-sanitize=` reads as "the sanitizer never ran"

**Found 2026-08-16, closing Phase 35's BACKSTOP B1.** `xcodebuild` escapes the `=` in the compiler
invocations it echoes, so a fully TSan-instrumented build logs `-sanitize\=thread`, not
`-sanitize=thread`. The obvious verification command therefore returns **zero matches on a build where
the sanitizer is fully active**:

```bash
grep -c "sanitize=thread" build.log     # 0 -- and completely misleading
grep -c 'sanitize\\=thread' build.log   # 20 -- the truth
```

This produced a live false negative during Phase 35's verification: TSan was declared "silently
ignored" on the strength of that grep, and a second run was launched to "fix" a problem that did not
exist. The false negative is the dangerous direction — it argues for *abandoning* a working
instrument, or worse, for recording a limitation the harness does not actually have (the exact shape
of the Phase 37 simulator/Face-ID story, but inverted and self-inflicted).

**Check the artifact, not the log.** Four log-independent indicators, any of which settles it:

- `otool -L <binary> | grep sanitiz` — TSan links `libclang_rt.tsan_iossim_dynamic.dylib` into the app
  AND test binaries.
- build products land under `Objects-normal-tsan/` rather than `Objects-normal/`.
- the test process environment carries `TSAN_OPTIONS` (and the dylib appears in
  `XCTestBundleInjectPath`).
- **ASan behaves differently and must not be checked the same way:** it is injected at load time, NOT
  link-embedded, so `otool -L` finds nothing for ASan on a correctly instrumented build. Using TSan's
  own check on ASan reproduces the same false negative one level down.

The only check that settles it for either: **run a deliberate defect and confirm the instrument
fires.** A race made TSan `SIGABRT` at the racy closure; a 4-byte allocation written at offset 512
made ASan crash at the overflowing function. Evidence:
`ios/evidence/35/B1-CONCURRENCY-SANITIZERS.md`.

### L-12 — a header's prose is not the capability surface (third instance of L-1's shape)

**Numbering note:** Phase 37's own planning material named this landmine "L-9", written before Plan
36-04 landed and claimed that slot for an unrelated defect ("`a check that cannot fail` produced FOUR
more instances in a single phase", above). It is recorded here as **L-12**, the next free ID, rather
than as a duplicate L-9 — two landmines sharing one ID would break every future cross-reference by that
number. The content below is what the plan's own text called "L-9"; only the label changed.

`SecAccessControl.h`'s doc comment for `kSecAccessControlPrivateKeyUsage` reads "Create access control
for private key operations (i.e. sign operation)" — a 2014 doc gloss, not a constraint. The identical
flag governs `Decrypt` and `KeyExchange` on Secure Enclave keys, not only `Sign` (`37-RESEARCH.md`
§"Where the false premise probably came from" — this is `[INFERRED, high confidence]` as the origin of
ACC-05's original wrong premise). Same shape as L-1: a type or flag looks constrained in the
representation that documents it and is not constrained in the one that actually ships.

**AMENDMENT to L-1, recorded here because this landmine is the third confirming instance of the pattern
L-1's own amendment describes.** L-1 holds for the passkey/PRF types it was actually found on, not for
`AuthenticationServices` wholesale — the password-AutoFill headers contain zero `NS_REFINED_FOR_SWIFT`
and *are* ground truth. The correct general rule, now confirmed a third time across two different
frameworks (`AuthenticationServices` and `Security`), is the weaker, true one: for any given
header-documented capability, check both the header's prose and the type's actual behavior/conformances
before concluding either way — neither representation is ground truth on its own by default.

### L-15 — the item type union has SIX members; the roadmap and requirements name five

**Numbering note (same reason as L-12's):** Plan 38-01 Task 3 named these four landmines "L-9" through
"L-12". Those four IDs were already claimed by unrelated defects from Phases 35–37 before this plan
executed. They are recorded here as **L-15 … L-18**, the next free block after L-14, rather than as
duplicate IDs — two landmines sharing one number breaks every future cross-reference by that number.
Only the labels changed; the content is the plan's own.

**What goes wrong.** A plan derived from `.planning/ROADMAP.md`'s SC2 ("five item types") builds a
Swift item model with five cases, ships it, and the first user who created a passkey in the browser
extension opens the iOS list to a decode failure — or, worse, to a silently dropped row.

**Why it happens.** The roadmap's SC2 and `REQUIREMENTS.md`'s UI-03 both say five. The field model's
actual source of truth says six. Observed this session, first line of the union:

```
$ sed -n '4p' packages/pv-ui/vault/types.ts
export type ItemType = "login" | "card" | "identity" | "note" | "totp" | "passkey";
```

`packages/pv-ui/vault/types.ts:4` — six members, `passkey` being the sixth. Its field interface is at
`packages/pv-ui/vault/types.ts:110` (`type: "passkey"`), written by Phase 12 for provider-created
credentials.

**The reconciling reading, marked as what it is.** [INFERRED, not established] five is plausibly the
*create/edit* surface (a user does not hand-author a passkey item; the provider writes it) and six is
the *render* surface. That reading is an inference and is recorded as one — nobody has confirmed the
roadmap author meant it.

**The part that is NOT in dispute, and is what actually constrains the code:** the decode path must
tolerate the sixth type. Whatever SC2 meant, an iOS client that cannot decode a `passkey` item shows a
broken list to any user who has ever used the extension as a passkey provider.

**How to avoid.** Derive the Swift union from `packages/pv-ui/vault/types.ts`, never from the roadmap
prose. **Warning sign:** any plan, test, or record that says "five item types" without citing a file.

### L-16 — UI-06's premise is false as written: there is no generator in `pv-core` to "wire up"

**What goes wrong.** UI-06 reads as an integration task ("generator via `pv-core` CSPRNG"), gets
estimated as one, and the phase discovers mid-execution that the thing being integrated does not
exist. The tempting recovery is to write the sampling loop in Swift, which satisfies the requirement's
literal wording while putting modulo-bias risk where no Rust-vs-TypeScript parity test can see it
(DR-38-A rejects exactly that, §1a).

**Why it happens.** The requirement names a component by capability, not by symbol, and no one ran the
grep.

**The command, its observed output, and the date.** Observed **2026-08-16**:

```
$ grep -rliE "passphrase|wordlist|generate_password" crates/pv-core/src/ crates/pv-wasm/src/ | wc -l
0
```

Zero files. The generator lives only in TypeScript (`packages/pv-ui`, the extension's
`generate-handler.ts`).

**This is a DATED BASELINE, not an invariant.** It is expected to stop returning zero once Plan 38-04
lands `crates/pv-core/src/generator.rs`. A later non-zero result is **the recorded transition, not a
regression** — do not "fix" it back to zero. A zero-hit claim is worth recording precisely *because* a
single line of new Rust can break it; a claim that no change could break is not evidence of anything.

**Warning sign:** a plan that describes UI-06 with a verb like "wire", "expose" or "surface".

### L-17 — Phase 38's SC2 passes on a broken wire format

**What goes wrong.** SC2 as written is satisfied by "the item is visible on the server". It is not.
`pv-server` stores the item payload as **opaque TEXT** (`enc_data TEXT NOT NULL`,
`crates/pv-server/migrations/0003_vault_items_rebuild.sql:20`; read back into a Rust `String`, e.g.
`crates/pv-server/src/routes/collections.rs:311`). The server never parses it, so it accepts and
returns **either** encoding. Swift's `JSONEncoder` emits `Data` as base64 by default; `serde_json`
emits `Vec<u8>` as a JSON number array. An iOS-written row can therefore be server-visible, round-trip
through iOS itself perfectly, and be **undecryptable in the web client** — surfacing to the user as an
integrity warning, not as a format error anyone would trace back to here.

**Why it happens.** "Server-visible" and "recipient-decrypted" are different claims, and the cheap one
is the one a green test tends to make. This is the same defect shape as the milestone-v0.5 lesson
("evidence that measures the wrong thing").

**The amendment this phase adopts, in place of SC2's literal wording:** an item created on iOS is
**opened and decrypted in the web client**, and an item created in the web client is opened and
decrypted on iOS. Two directions, recipient-side assertion, or SC2 is not discharged.

**Warning sign:** any wire-format evidence whose assertion runs on the same client that wrote the row.

**OBSERVED 2026-08-16 — experiment E-W1, plan 38-02 Task 3.** No longer an inference. Full transcript:
`ios/evidence/38/EW1-CROSS-CLIENT-WIRE.md`; harness
`scripts/verify-ios-web-item-interop.mjs run-item-interop` +
`ios/PasskeyVault/PasskeyVaultTests/VaultWireInteropTests.swift`.

**The forward direction was run first** (iOS writes, `pv-wasm` reads), because it is the direction
this landmine predicts would break. Both directions pass, asserted on the receiving side, through each
client's own real crypto:

- **D1 forward** — a note created by the real `VaultStore.create` (`encryptItemWire`, `serde_json`)
  came back from `GET /api/sync` with `typeof enc_key.nonce = array`, and the **real `pv-wasm`
  artifact `web/` imports** decrypted it, recovering the literal name typed independently on both
  sides. The discriminator alone would not have been enough and was not treated as enough.
- **D2 reverse** — a row written by `pv-wasm` exactly as `store.ts`'s `createVaultItem` writes one
  decrypted on iOS through the real `VaultStore.refresh()`.
- **Falsification, and it produced a real failure.** A second row in the same account, `enc_key`
  re-encoded the way Foundation's `JSONEncoder` encodes `Data` (base64 strings), was **accepted by
  the server with `201`** — the direct observation that server acceptance carries no information —
  and rejected by *both* recipients: `pv-wasm` with `invalid type: string "boAfQ09q…", expected a
  sequence`, and iOS by marking the row `undecryptable` while retaining it, in the same `refresh()`
  that decrypted the good row. Running the harness with `PV_ITEM_INTEROP_SKIP_CORRUPTION=1` (a
  correctly-encoded row placed in the bad slot) turns both falsification-dependent checks red, so the
  arm is demonstrably not vacuous.

**Still outstanding, deliberately not folded into the green result:** the browser-observed half — the
iOS-written item rendering in the running web client with a clean console. `web/node_modules` does not
exist in this worktree, so no dev server and no browser were available. `pv-wasm` is the web client's
own crypto, not its rendering.

### L-18 — there is no folder rename or update route in `pv-server`

**What goes wrong.** UI-04 ("folders and tags") is planned to include folder editing; the plan reaches
implementation and finds no verb to call.

**Why it happens.** The route table was never read. Observed route list for folders
(`crates/pv-server/src/routes/mod.rs:71-72`):

```
.route("/api/vault/folders", get(folders::list).post(folders::create))
.route("/api/vault/folders/{id}", delete(folders::delete))
```

`/api/vault/folders` — **GET (list) and POST (create) only**. `/api/vault/folders/{id}` — **DELETE
only**. No `PUT`, no `PATCH`, no update or rename verb exists for either path, and
`crates/pv-server/src/routes/folders.rs` defines no handler for one.

**Consequence.** Folder **editing is out of scope for UI-04** on iOS: adding it requires a new server
route, and this milestone's own premise is that the server does not change for iOS. iOS folder support
is therefore create / delete / assign-item-to-folder. Renaming a folder is, today, delete-and-recreate
on every client — not an iOS limitation.

**Warning sign:** a plan that says "edit folder" without naming the HTTP verb it will call.

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
