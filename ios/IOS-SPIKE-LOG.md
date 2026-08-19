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
| Server sync / UI | **Verified live (Phase 39, Plans 39-01..39-07).** REST pull + two live WebSocket pushes with plaintext compared byte for byte (SYNC-01); whole-snapshot cache write, SYNC-03's ciphertext-only gate proven red-then-green against a real leaking build; freshness timestamp real and honest under a forced-failure pull, unchanged when the server cannot answer (SYNC-04); and SYNC-02's own claim — a real credential-provider extension process read the host's persisted cache with the host provably terminated (`simctl terminate`, absence confirmed by two independent `launchctl list` captures), the bytes SHA-256-identical to what the host wrote, both mandatory negative controls (a sharing identifier the extension does not declare; the cache file deleted) firing as required. **Assumed / not verified:** background wake (SYNC-05 ships without APNs by design, not by omission); a cold read after a genuine device reboot (only a cold *simulator extension invocation* was produced — see PROOF-LIMITATION-4 below); decrypt inside the extension (Phase 41 owns FILL-05); anything beyond the personal vault (Phase 40 extends the schema to shared buckets). |

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

**Written 2026-08-17, updated same day after Plan 38-13 landed. Delete this section once Phase 38
is finished.**

### Where things stand

Phases 35, 36, 37 are **verification-passed**. Phase 38 is **in progress**: plans 38-01, 38-02,
38-03, 38-12 and **38-13 are committed** to `ios/spike` (38-12/38-13 not yet pushed to
`origin/ios/spike` at the time of writing — push before starting a fresh session elsewhere).
**38-04 … 38-11 remain** (the vault-UI-facing plans; 38-12/38-13 were pulled forward ahead of them
per Bartek's ordering below).

Auth + onboarding — the item this section used to say was "entirely unstarted" — **is now done**:
the 3-step onboarding (Welcome → Server → AutoFill) exists and is gated once
(`OnboardingGate.shouldPresentOnboarding`); the server URL is user-configurable, persisted, and
validated for reachability before it is accepted (`ServerSettings`/`ServerReachability`, 38-12); the
forgot-password warning is inline (`PVWarning` callout), never an alert, retiring
`37-VERIFICATION.md`'s residual clipping item; both auth screens name the configured server under
the title. See `.planning/phases/38-pe-ny-interfejs-vaulta/38-13-SUMMARY.md` for the full walk of
the design spec's §7 Done list and every falsification transcript.

### The order Bartek asked for

1. ~~Finish auth + onboarding first~~ — **done** (38-12, 38-13).
2. **Now continue the GSD run** for the rest of Phase 38 (38-04 onward) and beyond, building against
   the approved design.

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

- ~~**`NSCameraUsageDescription` is not declared.**~~ **RESOLVED, quick task 260818-lsk
  (2026-08-18).** Declared as `INFOPLIST_KEY_NSCameraUsageDescription` in both the Debug and
  Release `XCBuildConfiguration` blocks of the app target (`cloud.blonie.PasskeyVault`) in
  `ios/PasskeyVault/PasskeyVault.xcodeproj/project.pbxproj` — the SAME mechanism already carrying
  `NSFaceIDUsageDescription` there (`GENERATE_INFOPLIST_FILE = YES` auto-generates `Info.plist`
  from `INFOPLIST_KEY_*` build settings; there is no hand-written `Info.plist` for the app target
  to edit instead). Gates TOTP QR scanning (`TotpScanView.swift`, this task); scan card remains
  ungated because it remains unbuilt (see DR-38-F).
- **The app cannot be built in Release** — landmine **L-14**, a `swift-frontend` crash in generated
  UniFFI code. Debug only; do not try to work around it.
- **`.planning/` never survives this worktree.** Anything that matters goes in this file,
  `ios/evidence/`, or `docs/`.
- **`pv-server`'s `family_wide_sharing.rs` has a pre-existing test-isolation flake, found by
  38-04, not caused by it.** `family_wide_reseal_add_member_body_is_shape_identical_to_an_ordinary_share`
  fails every time as part of `cargo test --workspace` (reproducible, not intermittent) but passes
  reliably (5/5) when its own test file runs alone. Most likely cause: the test's
  `w.client.request_bodies_matching(...)` capture list picks up a same-shaped request body from a
  DIFFERENT, concurrently-running test when more test binaries execute in parallel as part of the
  full workspace suite — a harness test-isolation issue, not a `pv-server` serialization bug.
  `git diff --stat -- crates/pv-server` was empty for all of 38-04's execution; this is out of scope
  for that plan (CLAUDE.md forbids touching `crates/pv-server`) and is left for a dedicated
  follow-up.

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

**AMENDMENT, 2026-08-17 (Plan 38-04) — the binary-size rule discharged with measured numbers.**
Both sides measured via the actual deployed artifact `scripts/build-wasm.sh` produces
(`web/public/wasm/pv_wasm_bg.wasm`, post-`wasm-bindgen`, `wasm-bindgen 0.2.126`, the version this
workspace pins), each rebuilt twice for determinism and stable both times:

| Build | `pv_wasm_bg.wasm` size |
|---|---|
| **Before** (commit `c2e1c57`, the commit preceding this plan's first commit — no `generator.rs`) | 1,398,081 bytes |
| **After** (`crates/pv-core/src/generator.rs` + `generator/wordlist.rs` unconditional, HEAD at Task 2's commit `7f99ea2`) | 1,398,626 bytes |
| **Delta** | **+545 bytes** |

Method: `git worktree add` a detached checkout of `c2e1c57` (never a `git checkout`/`git stash` on
this worktree's own branch — the destructive-git prohibition holds), ran `scripts/build-wasm.sh`
there for the before number, then the same script in this worktree at HEAD for the after number.
545 bytes is **~0.04%** of the baseline and **two orders of magnitude under the 50 KB threshold**
this record committed to.

**Decision applied: the module stays UNCONDITIONAL.** No `pv-core` cargo feature gate. The
second-order hazard this record named ("a feature-gated module is silently skipped by
`cargo test --workspace`") therefore never triggers — plain `cargo test --workspace` already
covers `generator::` with no separate command needed. (`cargo test -p pv-core generator::
--release` is still the command 38-04 actually ran for the distribution/bias test specifically,
because 200,000 draws want the release profile's speed — not because debug builds skip the
module.)

**Why the delta is this small, stated rather than left as a surprising number:** `pv-wasm` never
calls into `pv_core::generator` — no `#[wasm_bindgen]` export reaches it, so nothing in the crate's
own public API surface, as seen from the `wasm32-unknown-unknown` target's perspective, marks the
module or its 7,776-entry word list as reachable. The Rust/LLVM toolchain's dead-code elimination
for the `wasm32-unknown-unknown` target strips code that is provably unreferenced from any exported
symbol, even when the source file compiles unconditionally as part of the crate. The word list's
~90 KB of source text (DR-38-A's own original estimate) never becomes ~90 KB of linked `.wasm` for
exactly this reason. This is a measured fact about *this* crate graph today, not a general license
to assume dead code always vanishes — the day `pv-wasm` calls `generator::generate_passphrase` (the
convergence path this record's residual-risk paragraph names), the word list becomes reachable and
the size question would need remeasuring against a real 50 KB threshold, not re-assumed free.

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

**AMENDMENT, 2026-08-17 (38-05 Task 3, E-S1's discriminating arm).** Measured, not assumed.

Both arms were run against the REAL app-switcher snapshot store (a real registered account, a real
item detail screen carrying a unique marker secret, backgrounded with a genuine `XCUIDevice.shared
.press(.home)`), decoded with `scripts/snapshot-blockmap.py`, on the simulator this whole phase's
experiments are batched onto (`C24B6A19-9099-4FCF-B281-9CD786D0D8A1`, iPhone 17, iOS 26.5):

- **Default arm (resign-active, this decision's shipped mechanism):** all sceneID snapshot files —
  main and downscaled — decoded to `nonflat=0 distinct=1`, colour exactly `PVBackground` (`fcfbfa`
  light / `1f1f1f` dark, matching the asset catalog's own RGB literally, not approximately).
- **Discriminating arm (`PV_SNAPSHOT_COVER_TRIGGER_BACKGROUND`: the SAME forced-`layoutIfNeeded()`
  mechanism, moved from `sceneWillResignActive` to `sceneDidEnterBackground`):** ALSO
  `nonflat=0 distinct=1`, colour exactly `PVBackground`, on every sceneID file, both resolutions.

**Both arms passed. Neither was disqualified by a race on this harness.** This measurement itself
required a fix: the first two runs of both arms were confounded by a real bug this Task found in
`SnapshotCoverOverlay` (the SwiftUI `scenePhase`-driven visual mirror this record's own §"Residual
risk" already calls cosmetic-only) — it covered on ANY `scenePhase != .active`, unconditional on
`isCoverEnabled`. That meant the FIRST negative-control run (cover explicitly disabled via
`PV_SNAPSHOT_COVER_DISABLED`) still showed a clean cover: the "cosmetic" SwiftUI half was doing the
real mitigation's job whenever the UIKit half was compiled out, which would have made the negative
control lie about proving anything. Fixed by gating `SnapshotCoverOverlay` behind the SAME
`isCoverEnabled` AND `triggerOnBackgroundInsteadOfResignActive` flags `AppSceneDelegate.installCover`
reads (`App/SnapshotCover.swift`); re-run afterward, and the negative control genuinely failed
(`nonflat=3954`/`3957` on the two full-resolution captures, `2877`/`2975` on the downscaled ones —
the marker secret legible in the attached block-map PNG). The discriminating arm was ALSO re-run
after this fix, specifically because the SAME unconditional-`scenePhase` bug would have made a
`.background`-only UIKit trigger look like it worked purely because the SwiftUI half was still
covering from `.inactive` onward regardless of which arm was under test. The clean, isolated re-run
(SwiftUI mirror now ALSO deferred to exactly `.background` under this flag) is the result reported
above.

**Decision: KEEP resign-active as the shipped default.** Not because `.background` measured worse —
it did not, on this harness — but because the empirical tie does not retire the theoretical argument
that motivated resign-active in the first place (research D3, restated above): resign-active fires
strictly earlier in the interruption sequence, buying the render pass more real time before the
system actually takes its snapshot. The simulator's scheduler is fast and uncontended; it cannot
exercise the tight-race, memory-pressure scenario the `.background`-only arm is theoretically weaker
under, and this experiment's own proof boundary (below) says so explicitly. A tie on a harness that
cannot stress the race is evidence that `.background` is not DISQUALIFIED here — it is not evidence
that the two arms are equally safe on a physical device under load. Given that, resign-active's
structural safety margin is the deciding factor, not an arbitrary preference for whichever ran first.

Evidence: `ios/evidence/38/38-05-es1-default-arm-*.{ktx,blockmap.png}`,
`38-05-es1-negative-control-*.{ktx,blockmap.png}` (the legible failure),
`38-05-es1-discriminating-arm-*.{ktx,blockmap.png}`. Full transcript in `38-05-SUMMARY.md`.

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

### DR-38-F — the ＋ grid's final 8, import to Settings, scan-card deferred

**Written 2026-08-18, quick task 260818-lsk.** Not a Phase 38 plan (38-01…38-13 are already
verification-passed by the time this landed) — recorded here anyway, in the same style, because it
revises `VaultCreateAction`, the type those plans built and the design comment they wrote for it.

**Decision: the panel is EIGHT slots, in this order:**

1. New login  2. New card  3. New identity  4. New note  5. New code  6. Scan QR code
7. Generate password  8. New folder

`VaultCreateAction`'s case DECLARATION order is what produces this render order (`CaseIterable`'s
synthesized `allCases` follows source order for a plain enum) — the enum literally reads
`case login, card, identity, note, code, scanQr, generatePassword, newFolder`.

**Import → Settings, explicit backlog, not built now.** Not added to this grid at all. A bulk
import (pick a file, review a batch) is a different interaction shape than every other tile here
(open a form for one item), and Settings is where the rest of the app's account-level actions
already live or will land. No `VaultActiveSheet` case, no accessibility identifier, no UI path
exists for it yet — this is a scope cut recorded as a cut, not a silent gap.

**Scan card deferred, same reasoning as it was under the six-slot decision: real, wanted,
unbuilt.** It needs bespoke Vision OCR this task does not build (reading a card's embossed/printed
number, expiry and name off a photo is a materially different problem than reading a QR code's
already-structured payload). The camera permission this task DOES add
(`NSCameraUsageDescription`, for QR — see §0) makes Scan card a cheap follow-up rather than a
second permission gate to design and request separately later.

**Passkey absence reaffirmed — still permanent, still no UI path.** Unchanged from the six-slot
decision's own reasoning, restated because this record supersedes that comment block: a passkey is
cryptographic material minted during a real WebAuthn ceremony by the AutoFill credential provider,
never hand-typed. `ItemFormAndFolderUITests` and `VaultDockEvidenceUITests` both still assert
`vault.create.action.passkey` does not exist; this task added assertions, it did not weaken either.

**QR-primary / manual-fallback TOTP rationale.** Most platforms hand out an `otpauth://` QR code
carrying issuer, account and secret directly — scanning it is faster and less error-prone than
transcribing a base32 secret by hand, character by character, which is why Scan QR code is the
panel's PRIMARY TOTP entry path now, not merely an addition alongside the old one. But not every
platform offers a QR code — some show only the raw secret in text — so New code (the existing
manual form) stays exactly where it was, as the fallback path, both from the panel directly and
from inside the scanner itself when the camera is unavailable or access is denied
(`TotpScanView.swift`'s `noCameraFallback`/"Enter details manually").

**Rejected: retiring New code once Scan QR code shipped.** Rejected on the "not every platform
offers a QR code" fact above — retiring it would remove the only path some real accounts have.

**New folder reuses `FolderPicker`, not a new form.** The folder-creation UI already existed,
inline inside `FolderPicker`'s "New folder" section (`FolderPicker.swift`), reachable only by first
opening an item form and tapping its Folder row. `VaultActiveSheet.creatingFolder` is a second,
direct entry point into the SAME view — with a discarded `selection: Binding<String?>` since there
is no item to assign here, only a folder to create — rather than a duplicated create-folder form.

**TOTP parser stays FFI-boundary-clean.** `OtpauthParser.swift` parses `otpauth://totp/...` URIs
into the fields `ItemFormView`'s Code form already edits, and NEVER computes a TOTP code — TOTP
value generation stays `pv-ffi`-only (`TotpCountdownView.swift`'s existing call site), guarded by
`scripts/audit-generator-uses-ffi.sh`. `ItemFormView` gained one new `init` parameter
(`prefillTotp: TotpFields? = nil`, additive, defaulted, both existing call sites unchanged) rather
than a second creation path, so `TotpValidation`'s own check on Save runs identically whether the
draft came from a scan or from typing.

**Residual risk:** `TotpScanView`'s live-camera capture path (`QrCaptureRepresentable`,
`AVCaptureSession`/`AVCaptureMetadataOutput`) is unverified on a real device this session — the
simulator has no camera, so only the no-camera fallback is machine-verified
(`VaultDockEvidenceUITests.testPlusPanelEightActionsAndScannerNoCameraFallback`,
`ios/evidence/38/plus-panel-v2/`). This mirrors the standing MP-1 limitation already recorded
elsewhere in this file for other camera/biometry-gated surfaces: recorded as unverified, not
claimed as tested.

---

## 1b. Plans 38-12 and 38-13 results — auth + onboarding, 2026-08-17

Same Verified/Assumed discipline as the rest of this file.

**Verified.** `ServerSettings` persists a validated server URL (`UserDefaults`, default
`https://vault.blonie.cloud`), with three distinct refusals (path-carrying, non-loopback `http://`,
unparseable) — 13 unit tests, RED-before-green (38-12). `ServerReachability.check(_:)` distinguishes
`reachable` / `unreachable(reason:)` / `wrongServer` by parsing the `/healthz` body rather than
trusting the HTTP status code alone — 5 unit tests including a live run against a real `pv-server`
(38-12). The 3-step onboarding (Welcome → Server → AutoFill) is gated once by
`OnboardingGate.shouldPresentOnboarding`, a pure function `OnboardingGateTests.swift` falsifies
without touching SwiftUI (38-13). The server step's `Continue` re-validates and probes live before
advancing; `Skip` is unconditional and network-free — verified end to end via the real app
container's `Preferences` plist (no `pv.server.url` key after Skip, resolving to the shipped
default), not merely inferred from the code path. The AutoFill step's returning-state re-check was
driven against the REAL Settings → Apps → Passwords → View AutoFill Settings toggle (Phase 36's own
established navigation) and returned to via `app.activate()`, not a fresh launch — the enabled
confirmation and "Done" primary control were observed live, genuinely toggled. The forgot-password
warning moved out of `LockView`'s `.alert(...)` (now removed entirely — `grep '\.alert('` on
`LockView.swift` returns nothing) into an inline `PVWarning` callout; its AX5 readability is proven
by an assertion on the element's rendered frame HEIGHT (not `isHittable` alone, which was
empirically shown NOT to detect internal clipping of a single opaque accessibility node), calibrated
against a real falsification transcript (unclipped ~329pt, clipped-by-`.frame(maxHeight:
20).clipped()` ~69pt, threshold 150pt). This retires `37-VERIFICATION.md`'s residual item — new
evidence at `ios/evidence/38/38-13-lock-forgot-warning-ax5-light.png` shows the full sentence,
ending "...No one, including us, has access to it.", reachable by scrolling. Both `AuthView` modes
show the configured server under the title, reading `ServerSettings.resolved.host`.

**Also found and fixed, not part of either plan's original scope (Rule 1/2 deviations, both
plans):** `.buttonStyle(.borderedProminent)` does not use the `PVOnAccent` asset for its label by
default — it renders a plain white label in BOTH light and dark, silently reintroducing the exact AA
contrast failure `PVOnAccent` exists to fix (37-UI-SPEC.md's own finding about `#E16540` at
3.34:1 in dark mode). Every primary button in `AuthView`/`LockView`/the new `Onboarding/*` views now
sets `.foregroundStyle(Color("PVOnAccent"))` explicitly on the label. Caught by the FIRST onboarding
screenshot taken this session, not by `ContrastTests` (which measures the asset catalog's own
values, not what a live button actually renders) — a gap worth remembering for Phase 42's QA
standard.

**Assumed / not verified this session:** lock states 6 (Throttled) and 7 (No device passcode) are
not implemented anywhere in `LockView` — no forced-state hook, no real code path produces them. State
2 (Biometry presenting) is a system Face ID sheet, structurally undriveable on this simulator/harness
per the standing MP-1 proof limitation (§1a). Recorded here as absent, not attempted, per
38-13-PLAN.md's own instruction to verify the existing implementation against §5's table rather than
build what is not there.

**Not touched:** `crates/pv-server` (verified empty diff both plans); the Phase-38 item-model files
(`Vault/ItemFields.swift`, `ItemNormalize.swift`, `ItemCapabilities.swift`, `IdentityAddress.swift`).

---

## 1c. Plan 38-06 results — the list surface, E-U2/E-U3, 2026-08-17

**E-U2 — which search chrome does a target-18/SDK-26 build actually render, resolved with a
correction to the experiment's own premise.** Neither hypothesis as originally framed (H1: classic
drawer under the large title; H2: iOS 26 minimized bottom-docked search) survived contact with a real
run cleanly — the actual determining factor turned out to be **which container `.searchable` is
attached to, not the deployment floor**. Observed empirically, in this order:

1. `.searchable` on the outer `TabView` (with a single `NavigationStack` wrapping the whole `TabView`):
   **zero search chrome anywhere on screen.** No field, no icon, nothing — confirmed by a live
   screenshot with the full accessibility tree dumped alongside it.
2. `.searchable` moved to each `Tab`'s own bare content (same single outer `NavigationStack`):
   **still zero search chrome.**
3. `.searchable` moved to each `Tab`'s OWN `NavigationStack` (`TabView { Tab { NavigationStack { ...
   .searchable(...) } } }`, the structure this plan ships): **renders correctly** — a rounded "Search"
   pill directly under the large title, matching the classic (H1-shaped) drawer appearance, not the
   iOS 26 minimized style. `SearchField` and its `magnifyingglass` glyph are both present in the
   accessibility hierarchy dump (`ios/evidence/38/38-06-eu2-search-at-rest.png`).

Reading: the navigation bar `.searchable` docks its chrome into has to belong to the SAME
`NavigationStack` instance the modifier is attached within. A `TabView`'s own navigation bar (or one
belonging to an ancestor `NavigationStack` one level further out) does not count, regardless of SDK
version. This is a real, load-bearing correction to the research doc's "root content, not the
container" guidance — the container in question is more specific than "the immediate `NavigationStack`
wrapper" and turned out to mean "each tab's own stack."

**Second observation (scroll behaviour):** `app.swipeUp()` on a one-row list produced no visible change
— the search pill neither minimized nor moved (`ios/evidence/38/38-06-eu2-search-after-scrolling.png`).
Consistent with the non-minimizing drawer appearance from observation 3 above, but the fixture had too
little content to force a genuine scroll; recorded as a proof limitation, not a settled negative.

**Proof-limitation sentence (required by this plan's own acceptance criteria):** every search
screenshot in this phase, going forward, documents the drawer-style appearance observed above — the
appearance a user on a build linked against a DIFFERENT SDK might see is untested and could differ.

**E-U3 — do tokens and scopes coexist as two modifiers?** **PASS, with a timing qualifier not stated
in the original experiment plan.** `.searchable(text:tokens:token:)` and `.searchScopes(_:_:)` were
applied together to the same view (temporary experiment, reverted after this observation was
recorded — see the diff at commit `01d8871`'s parent for the exact code). Compiled cleanly. At
runtime: **at rest, only the tokens-capable search field is visible — no scope pills.** Once the
search field is TAPPED (active/focused), the scope pills ("All" / "Recent") appear directly below it,
alongside the same field (`ios/evidence/38/38-06-eu3-tokens-and-scopes-together.png`, captured with
the field focused and text typed into it). Both affordances ARE present simultaneously once the field
is active — the plan's pass condition ("both visible simultaneously") is met, but only in that state,
not at rest. This is standard iOS behaviour (matches Mail.app's own scope-bar timing), not a defect.

**Shipped decision:** despite E-U3 passing, the SHIPPED `ItemListView` does NOT use `.searchScopes` for
item-type filtering — design-conformance's approved navigation architecture (a `TabView` with type-
filter tabs) supersedes the plan's own pre-approval "coarse scopes, or fallback to a toolbar menu"
text, per that document's own stated precedence rule (design-conformance wins on "what the UI is").
Tag tokens ARE shipped for real, wired to `store.allTags`. Folder tokens are NOT shipped — `VaultStore`
does not decrypt folder names yet (lands with 38-09); `VaultFilter.folder(id:)` stays a faithfully
ported case with no UI path to it, an honest bounded scope cut.

**A third finding, live-discovered outside either named experiment but belonging in this section:**
a LEADING `.swipeActions` on a `List` row specifically — not swipe actions in general, not modifier
order — prevents `.contextMenu` on the same row from ever opening via long press. Isolated by removing
each modifier independently: trailing-only + contextMenu works; leading-only + contextMenu breaks;
both together breaks the same way regardless of which is applied first in the modifier chain. Not
documented in the research doc's "Standard Stack" table, because nothing there flagged the combination
as risky. `ItemListView.swift`'s row therefore ships trailing-delete + context menu only; the leading
copy-swipe named in the plan's own action text is not implemented as a swipe (its copy actions remain
reachable through the context menu instead) — see `38-06-SUMMARY.md` for the full accounting.

---

## 1d. Plan 38-07 results — the detail screen, clipboard, E-C1, 2026-08-17

**Host-sync confirmation, the defaults key the research doc could not confirm:**
`com.apple.iphonesimulator PasteboardAutomaticSync` — a boolean, `1` by default (Simulator's
pasteboard sync starts ON). Toggled off via the Simulator app's own `Edit > Automatically Sync
Pasteboard` menu item (confirmed unchecked via `AXMenuItemMarkChar`), then confirmed by reading the
domain afterward: `defaults read com.apple.iphonesimulator PasteboardAutomaticSync` returned `0`.
Re-confirmed `0` immediately before E-C1's run below.

**Landmine hit and fixed during this task, recorded so it is not repeated:** the first four arm
attempts all showed the marker MISSING even in arm A (write). Root cause: `xcrun simctl install` was
installing a STALE binary from a second, leftover DerivedData directory
(`PasskeyVault-faictfoarzmjrjfwplzwhmtivgnt`, last built 2026-08-13) that a `find ... | head -1` glob
picked nondeterministically over the fresh one — the fresh app's `PasskeyVaultApp.init()` hook was
never actually running. Diagnosed by writing a debug marker file from `init()` directly to the app's
own `Documents` container (bypassing `NSLog`/`log show` entirely, since neither showed any app-level
output either — later found to be the SAME stale-binary cause, not a logging-visibility issue) and
confirming it never appeared until the stale DerivedData directory was deleted and the correct,
freshly-verified `.app` path was installed explicitly. `xcrun simctl launch`'s environment variables
must be set on the CALLING shell with a `SIMCTL_CHILD_` prefix (there is no `--env` flag on `simctl
launch`, despite one being a natural guess) — confirmed working against the pre-existing
`PV_UITEST_SCREEN` hook before trusting it for the new clipboard one.

### E-C1

2026-08-17
**Arm A** PASS — write works. Copied `PV-CLIP-A-<runid>` through the real `ClipboardService.shared.copy` path (via a DEBUG-only `PV_UITEST_CLIPBOARD_COPY_MARKER` launch hook in `PasskeyVaultApp.init()`); `xcrun simctl pbpaste` printed it back exactly.
**Arm B** PASS — expiry honoured with the app alive. Waited 35s (seconds=30 + 5s buffer) with the app still running; `pbpaste` returned empty.
**Arm C** PASS — expiry survives app termination, the load-bearing claim. Copied, terminated the app at T+2s via `xcrun simctl terminate`, waited to T+33s; `pbpaste` returned empty. The daemon-owned `expirationDate` clears the pasteboard on this OS (iOS 26.5 simulator) independently of the writing process's lifetime.
**Arm D** PASS — the changeCount guard does not wipe unrelated data. Copied the marker, waited 5s, wrote a DIFFERENT value externally via `xcrun simctl pbcopy`, waited past the original deadline; `pbpaste` returned the externally-written value unchanged, not empty.
**Arm E** FALSIFIED — both mechanisms disabled (a raw `UIPasteboard.setObjects(_:localOnly:expirationDate:)` write with no expiry and no in-app timer, via `PV_UITEST_CLIPBOARD_DISABLE_BOTH_MECHANISMS`) and arms B and C re-run: both genuinely FAILED as predicted — the marker was still present after the same wait in both the alive case and the killed case, proving the observer is live and that arms B and C's PASS above is not a vacuous "nothing was ever going to be there anyway" result.

**Known-unknown, recorded either way (untestable from outside the daemon with any tool available
here):** whether the pasteboard daemon clears the item EAGERLY at the deadline or LAZILY on the next
read is not observable — arm C only proves the item is gone by the time this external observer reads
it sometime after the deadline, not that it vanished exactly at T. A lazy implementation would still
leak the value to a third-party clipboard manager that happened to poll a moment before the deadline.
The app's wording (`ClipboardService.swift`'s `ClipboardWording`) does not claim eager clearing, and
never uses the word "guaranteed" anywhere.

**Proof limitation (the arm-C boundary):** arm C shows that THIS simulator's pasteboard daemon, on
THIS SDK (iPhoneSimulator26.5), honours `expirationDate` past the writing process's termination. It is
evidence about this specific OS build's daemon behaviour, observed once, not a guarantee about every
iOS version or a real device — the daemon implementation is Apple's, not this app's, and could differ
or change. The wording in the app is written to hold regardless of which way this could go on a
different OS build (see Task 2's `ClipboardWording`, written before this arm ran and not weakened
after it turned out favourable).

**Result for UI-07's design:** because arm C passed, the in-app timer is a genuine BACKUP (not the
primary mechanism it would have had to become had arm B or C failed) — no wording change to Task 2's
strings was needed as a result of this measurement.

---

## 1e. Plan 38-09 results — create/edit form, optimistic concurrency, folders, 2026-08-17

**All three tasks complete.** Full detail, including RED-before-green transcripts and the folder
cross-client proof, lives in `.planning/phases/38-pe-ny-interfejs-vaulta/38-09-SUMMARY.md`
(`.planning/` is never committed from this worktree — this paragraph is the durable pointer).

- **Task 1** — `ItemFormView.swift`/`TypePicker.swift`: one `Form`, rows switched by the five creatable
  types; type picker editable only on create; `TotpValidation.swift` (new) enforces the REAL `totp-rs`
  limits (6-8 digits, >=16 decoded secret bytes) before any save, catching the exact defect this
  session found live — 38-06's own TOTP placeholder secret decoded to only 10 bytes, below the floor
  this validator now enforces (fixed as part of this plan). Identity address round trip (38-03's
  `IdentityAddress.swift`) proven byte-for-byte through real `pv-ffi` crypto. 12 tests,
  `ItemFormValidationTests.swift`.
- **Task 2** — `VaultStore.update`: sends the item's CURRENT revision as `expected_revision`, refuses
  outright over an `undecryptable` row (proven via a fake-transport request-count assertion — zero
  requests attempted), and mutates local state only after the awaited call returns (this repo's own
  "post-await bookkeeping hazard has now recurred THREE times" — a fourth instance avoided here,
  proven by an injected-throw test with the ordering demonstrated RED before GREEN). A REAL
  stale-revision conflict was produced against the live server (a second writer bumps the row, the
  phone's stale-revision save is refused with `VaultAPIError.revisionConflict`, never an overwrite) —
  8 tests, `VaultMutationTests.swift`.
- **Task 3** — `FolderStore.swift`/`FolderPicker.swift`: create/delete only (L-18: no rename route
  exists on `pv-server`). The folder direction of the cross-client proof (L-17, above) passed in both
  directions with a genuine falsification, `scripts/verify-ios-web-folder-interop.mjs`.

**A new landmine this plan's own live tests produced, not a defect in the shipped feature:** L-20 (§3)
— running a live XCTest against the shared simulator's live `pv-server` silently replaces the
persisted UI-test session another test file depended on. Fixed at the two affected files; the pattern
(`PV_UITEST_SCREEN=auth` + a fresh account per run) is the one future live/UI test files in this
worktree should follow.

**Scope note, stated rather than silently narrowed:** the tracer's legacy create-marker bar
(`ItemListView.swift`'s `createBar`) was NOT retired in this plan, unlike 38-06's SUMMARY anticipated.
Three UI test files (`SnapshotEvidenceUITests.swift`, `ItemListSearchUITests.swift`,
`ItemDetailScreenshotUITests.swift`), not one, depend on its `vault.create.marker`/`vault.create.submit`
identifiers — removing it was a larger, three-file cross-plan change with no acceptance criterion in
this plan requiring it. The real `TypePicker`/`ItemFormView` flow this plan built is fully wired
through the "+" affordance and Edit; the bar is dead UI, not a blocker for anything this plan needed.

---

## 1f. Plan 38-10 results — TOTP, the code is the row, E-T1, 2026-08-17

**Task 1** — `crates/pv-ffi/src/totp.rs`: `totp_now` exports `pv_core::totp::generate_code` with the
`usize`/`u32` digit-count cast absorbed at the boundary (mirroring `generator.rs`'s own precedent), the
secret crossing as a plain `String` (per-item plaintext the caller already holds, same rationale
`pv-wasm`'s `totpNow` records). RED-before-GREEN: a stub returning `InvalidInput` unconditionally failed
5 of 7 Rust tests (the two error-expecting tests passed trivially against the stub); wiring the real
call made all 7 pass. Falsification: mutated the cast to `(digits as u8) as usize % 4`, re-ran, watched
the SAME 5 tests fail for the SAME reason (`invalid TOTP parameters`), reverted, confirmed the diff was
byte-identical to before the mutation. `TotpFfiTests.swift` (5 tests) calls through the real generated
framework — never mocked — with the RFC 6238 literal codes as expected values.

**Task 2** — `TotpCountdownView.swift`: a `TimelineView` anchored just past a period boundary, taking
`max(context.date, Date())` every tick and recomputing through `totpNow` fresh — never decrementing a
locally-held value. The design-conformance replacement (ring beside an enlarged code, `PVWarning` in the
final 5 seconds — an author-chosen threshold; design-conformance's own text does not name a number) is
wired into `ItemDetailView.swift`'s new `totpSection`, ABOVE the existing generic field-order loop
(matching `web/.../DetailPanel.tsx`'s own structure: composed ring/code block, then the same
`FIELD_ORDER` loop every type goes through — the raw base32 secret still renders below, masked and
revealable, unchanged).

**Deliberate divergence from web, named rather than silently copied:** `DetailPanel.tsx`'s copy button
under the ring is labelled "copy TOTP code" but its `onClick` actually copies `item.fields.secret` (the
raw base32 secret), not the displayed code — an apparent bug in the web client. This iOS build's copy
button copies the LIVE CODE instead, reusing `ItemDetailView.copySecret`'s existing choke-point
(`ClipboardService` + last-used touch) under a new `"totpCode"` field key. Not fixed on web (out of this
plan's scope); flagged here per this phase's own "preserved disagreements" discipline rather than
resolved silently in either direction.

**D2 discharged** (`38-RESEARCH.md`'s own preserved disagreement): UI-05's wording ("consistent with
web/extension behaviour") is satisfiable two ways because the two reference surfaces disagree with each
other — `TotpCountdownRing.tsx` recomputes through the crypto boundary every tick; the extension's
`TotpFillRow.tsx` decrements locally because its popup is forbidden from touching the secret at all.
This build follows **web's** behaviour (recompute every tick, never decrement) — the extension's
reason for the alternative (no secret access in that process) does not apply here, where the detail
screen already holds the decrypted item.

**Never-decrement rule, proven falsifiable, not merely asserted:** with the grep-checked identifier
spelled `remainingSeconds` exactly, `grep -vE '^\s*//' TotpCountdownView.swift | grep -cE
'remainingSeconds\s*-=|remainingSeconds\s*=[^=]*remainingSeconds\s*-'` returned `0` on the real file.
Mutated in place (`var remainingSeconds = result.secondsRemaining; remainingSeconds -= 0`), re-ran,
observed `1` (the grep fires on the mutation, not on the doc-comment prose that names the pattern in
words), reverted; `diff` against the pre-mutation copy confirmed byte-identical.

**Low Power Mode caveat — could not be exercised on this harness, recorded honestly rather than
skipped.** `38-RESEARCH.md`'s own unverified caveat asks whether `PeriodicTimelineSchedule` honours
`TimelineScheduleMode.lowFrequency` under Low Power Mode. This iOS 26.5 Simulator (`iPhone 17`,
`C24B6A19-9099-4FCF-B281-9CD786D0D8A1`) has **no Battery entry in Settings at all** — confirmed two
ways: the top-level Settings list (screenshotted) has no "Battery" row, and Settings' own in-app search
for "Low Power" returned **"No Results for 'Low Power'"** verbatim. `xcrun simctl status_bar
--batteryState`/`--batteryLevel` only overrides the STATUS BAR GLYPH, not `ProcessInfo.processInfo
.isLowPowerModeEnabled` — confirmed by reading `simctl status_bar --help`'s own flag list, which has no
functional Low-Power toggle. Simulators have no physical battery, and this build has no toggle to
simulate one being low. **Recorded as untestable-in-this-harness (an MP-1-style limitation), not as
PASS or FAIL** — the same honest-abstention discipline this log already applies to `hasFocus`
(§"L-...", `LockViewFocusUITests.swift`'s own header).

**Landmine, live-found, fixed in this plan's own test code (not the shipped app):** typing directly
into the two masked `SecureField`s on `AuthView` (this repo's established UI-test pattern —
`.secureTextFields.firstMatch` / `.element(boundBy: 1)`, used by `ItemDetailScreenshotUITests.swift`,
`ItemFormAndFolderUITests.swift`, `ItemListSearchUITests.swift`, `SnapshotEvidenceUITests.swift`)
produced a real, repeatable, non-transient "Passwords don't match" banner in THIS harness, even though
the identical literal string was typed into both fields and clearing first (`XCUIKeyboardKey.delete`
x80) did not change the outcome. Root cause not fully isolated (not stale autofill content, ruled out
by the clear-first test); worked around by tapping the shared `isPasswordRevealed` toggle once before
typing (`AuthView.swift`'s `passwordField(text:)` is called for both fields with the SAME `@State`
toggle, so one tap switches both from `SecureField` to a plain, autocorrection-disabled `TextField`
simultaneously) — `TotpCountdownUITests.swift`'s own `registerFreshAccount` uses this route and is
reliably green. The four pre-existing files above still use the masked-`SecureField` route and were NOT
touched (out of this plan's `files_modified`); `ItemDetailScreenshotUITests.swift` was independently
confirmed BROKEN on this build for an unrelated reason first (stale button wording, below), so at least
one of the four is already known-red going into this plan.

**Separately, pre-existing and unrelated to the SecureField finding above:** `ItemDetailScreenshotUITests
.swift`'s `registerFreshAccount` (and `SnapshotEvidenceUITests.swift`'s fallback register path) tap
buttons labelled `"No account yet? Sign up"` / `"Create account"` — wording that no longer exists on
`AuthView` (current localized strings, `Core/I18n/Dictionary.swift`: `"Create a vault instead"` /
`"Create vault"`). Confirmed broken live: `ItemDetailScreenshotUITests
.testCardDetailWithEmptyPinOmitsThePinRow` fails at the button lookup. Not fixed (out of this plan's
`files_modified`); named here so it is not mistaken for a regression this plan caused.

**Task 3** — see the E-T1 entry immediately below.

### E-T1 — TOTP correctness (SC3), 2026-08-17

**Step zero (oracle validation) came first, as required.** `python3 scripts/totp-oracle.py --selftest`
reproduced all six RFC 6238 Appendix B SHA1 vectors from `crates/pv-core/src/totp.rs`'s own test
module, transcribed independently rather than imported — exit 0, `6/6 matched`. Also independently
verified against the crate's SHA256/SHA512 vectors (not required by the plan's own three-vector
wording, but free extra coverage of the same secret/algorithm surface). **Falsified**: altered one
expected vector to `00000000`, re-ran, observed exit 1 (`5/6 matched`), reverted, confirmed byte-
identical (`diff` clean). The oracle was proven correct AND proven able to fail before it was trusted
for anything below.

**Live comparison**, driven by a throwaway XCUITest (not committed — this plan's `files_modified` names
only `scripts/totp-oracle.py` and this file; the driver's job was to produce the transcript below, not
to become permanent CI). Real account, real server (`127.0.0.1:8621`), real `+` → Code → Save flow
(the RFC 6238 SHA1 secret `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ` is `TypePicker.swift`'s own default draft
for a Code item — no typing needed), real detail screen, accessibility values read through
`XCUIElement.value` — never OCR.

**Single-read comparison, mechanical rule, PASS:**
```
t_before=1786954812 t_after=1786954812 (same period: floor(t/30) equal both sides)
displayed code=779659  oracle(1786954812)=779659   MATCH (exact, as required same-period)
displayed remaining=18 oracle=18                    MATCH (exact, well within the ±1s tolerance)
```

**Cross-boundary continuity, 35 one-second samples, PASS:**
```
i=0..16   t=1786954812..1786954829  code=779659  remaining=18→1
i=17      t=1786954830              code=149479  remaining=30   <- the ONE transition, exactly at t%30==0
i=18..34  t=1786954832..1786954849  code=149479  remaining=28→11
```
Exactly one transition, landing precisely where `t % 30 == 0` (`1786954830 % 30 == 0`). Every one of
the 35 samples' code AND remaining-seconds independently re-checked against `totp-oracle.py` after the
run: **zero mismatches** (both code exact-match and remaining-seconds within ±1s, for all 35 rows).
Two consecutive readings 2 seconds apart appear twice in the table (i=6→7 and i=28→29, `t` jumping by 2
instead of 1) — `Thread.sleep(1)` plus XCUITest's own per-query overhead occasionally pushes a sample
past a full second; the table still shows the values the LIVE app displayed at the ACTUAL captured `t`,
and every one of those (t, code, remaining) triples independently matches the oracle, so the two-second
gaps do not weaken the continuity claim — they are exactly why capturing an explicit `t` per sample
(rather than assuming a fixed 1 Hz grid) is the correct mechanical rule.

**Falsification arm one (altered secret), PASS — proves the comparison reads live, changing data:**
```
altered secret HEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ (index 0: G -> H, still 32 chars / 20 bytes, still valid)
t=1786954862  displayed code (altered secret)=604613
oracle(1786954862) under the ORIGINAL secret = 314843    DIFFERENT, as required
```
If the displayed code under the altered secret had matched the original secret's oracle value (or any
fixed/cached value), the whole comparison above would be reading something other than the live FFI
call. It does not: the altered secret's page shows a code that agrees with NEITHER the original
secret's oracle value nor any value seen earlier in this run.

**Falsification arm two (too-short secret), PASS:**
```
item "Bad Secret (UI test fixture)", secret=JBSWY3DPEHPK3PXP (16 base32 chars, 10-byte decode)
error-visible=true  code-present=false
```
Screenshot already on file from Task 2 (`ios/evidence/38/38-10-totp-error-state-too-short-secret.png`)
shows the identical error state for the identical fixture item.

**Independent host tool cross-check (optional, per the plan): NOT run.** `oathtool` is not installed on
this machine (`command -v oathtool` → not found) and installing a new tool is out of scope for an
in-session auto-fix (deviation-rule exclusion on package-manager installs). `totp-oracle.py`'s own
self-test against the RFC's published vectors, proven falsifiable above, stands as the independent
validation for this plan; the optional third-tool cross-check is recorded as skipped, not silently
omitted.

**Conclusion:** all three named acceptance mechanisms (single-read, continuity, both falsification
arms) passed under the mechanical rule, against an oracle that was itself proven correct and provably
falsifiable before any comparison was trusted.

---

## 1g. Phase 39 decision records — DR-39-A, DR-39-B, DR-39-C, DR-39-E, 2026-08-18

**Preceded by the branch-gate checkpoint (Plan 39-02, Task 1):** DR-1 (§1 above, hybrid Keychain +
App Group) was read, quoted verbatim, and confirmed — Phase 39 executes under **Branch H**. The
extension's SC1 layer (b) election was also read as PASS (§"SC1 layers" in
`ios/AUTOFILL-FEASIBILITY.md`), so SC2's Branch E-yes wording is the sentence this phase is permitted
to write, fixed in advance of the proof (D-16). Full quotes and the branch/SC2 machine-readable lines
live in `ios/evidence/39/02-branch-gate.md`; this section records only the four decisions the phase
owns per `39-RESEARCH.md` §"Decision records this phase owns".

### DR-39-A — cache container format: **DECIDED — a single snapshot, written whole and replaced
whole**

**Decision:** the ciphertext cache is one JSON blob per user, written atomically and replaced in full
on every successful sync pull. No incremental/partial update path exists.

**Rejected: per-item files (one file per vault item).** Rejected on its merits, not by omission: it
multiplies the surface the SYNC-03 gate must audit — every new file is a new place a plaintext field
could leak into — and introduces partial-write states (some item files updated, others not) that no
single atomic-write primitive covers, forcing a second coordination mechanism to exist for no
offsetting benefit on a workload that is always a whole-snapshot replace.

**Rejected: an embedded database (SQLite/SwiftData).** Rejected on its merits: it adds an entire store
format whose ciphertext-only property must itself be proven — including its WAL/journal file and any
index it maintains, both of which are additional surfaces that could carry plaintext-derived data —
for a workload that has no queries at all (D-15; Phase 39's cache is read whole and written whole,
never filtered or joined).

**Evidence:** `39-RESEARCH.md` §"Decision records this phase owns" → DR-39-A, §"Alternatives
considered".

### DR-39-B — freshness timestamp location: **DECIDED — inside the snapshot itself, alongside the
watermark**

**Decision:** the freshness timestamp (`syncedAtMs`) is a field inside the same cache blob DR-39-A
defines, written in the same atomic operation as the data it describes. This choice is
branch-independent — it does not change under Branch H vs Branch K — and is made once, here, rather
than re-litigated per branch.

**Rejected: a separate shared preference (`UserDefaults(suiteName:)`).** Rejected on its merits: it is
a second source of truth that can drift from the data it describes (a crash or partial write between
the two writes would leave a freshness claim that outlives the data it claims to describe), and it is
unavailable under Branch K anyway — Keychain has no equivalent shared-preference surface — so choosing
it here would have made DR-39-B branch-dependent for no benefit under the branch this phase actually
runs (D-11, D-20).

**Evidence:** `39-RESEARCH.md` §"Decision records this phase owns" → DR-39-B, Branch Matrix row
"Freshness timestamp".

### DR-39-C — background refresh (`BGAppRefreshTask`): **DECIDED — out of v1.0**

**Decision:** Phase 39 does not register a `BGAppRefreshTaskRequest`. Freshness is established only by
a foreground pull; there is no background-refresh code path in v1.0.

**Reasoning, stated explicitly, not left implicit:** `BGAppRefreshTask` is not a push mechanism and
registering one would not add a server-side dependency, so SYNC-05 (no APNs) does not forbid it on its
own terms. But the system schedules background tasks at its own discretion, and
`BGTaskRequest.earliestBeginDate`'s own header — read this session,
`BackgroundTasks.framework/Headers/BGTaskRequest.h` on the iOS 26.5 SDK — states: *"Setting the
property indicates that the background task shouldn't start any earlier than this date. However, the
system doesn't guarantee launching the task at the specified date, but only that it won't begin
sooner."* The scheduling hint is documented as ignorable by the OS; nothing about a registered
background task can honestly be described to a user as "keeping the cache current," because the system
may simply never run it. It therefore buys no honest freshness copy while adding a real lifecycle
surface (registration, expiration, a second code path that must itself be proven not to leak
plaintext) to a phase that already has one.

**Rejected: registering it anyway, with copy that never promises freshness.** Not chosen for v1.0: the
research's own framing applies — "we registered a task" is not evidence it ever ran, and Phase 39
already has no success criterion that could observe a background run happening on the simulator
(`39-RESEARCH.md` Proof limitation 3, background timing does not transfer off-device either).

**Reversibility, stated plainly:** this record is reversible. Adding `BGAppRefreshTask` later is purely
additive — it does not require undoing anything DR-39-A/DR-39-B built, and revisiting it needs its own
success criterion at that time, not an amendment to this one.

**Evidence:** `BackgroundTasks.framework/Headers/BGTaskRequest.h` (iOS 26.5 SDK, read this session);
`39-RESEARCH.md` §"Decision records this phase owns" → DR-39-C.

### DR-39-E — chunking vs. a disclosed vault-size cap (conditional, Branch K only): **NOT REQUIRED**

**Not required, and here is why, not merely that:** DR-39-E exists to record the choice between a
chunked cache with a generation counter and a disclosed hard cap on vault size, and it is triggered
only if (a) Phase 39 runs under Branch K (Keychain-only), and (b) Task 2's E-C4 measurement finds a
ceiling below a realistic vault size. Neither condition holds: DR-1 (§1) committed Branch H, so the
cache is written to the App Group container — a file, with a size posture the Branch Matrix records as
"unbounded in practice" — and Task 2 performed no Keychain measurement at all under Branch H
(`ios/evidence/39/02-branch-gate.md` "Task 2 — Branch K ceiling measurement: not applicable"). Silent
truncation was never on the table and remains prohibited regardless (this plan's own `must_haves`); no
size ceiling was found to require chunking or a cap because none was measured, and none needed to be.

**Evidence:** `ios/evidence/39/02-branch-gate.md`; DR-1 (§1); `39-RESEARCH.md` §"Decision records this
phase owns" → DR-39-E.

---

## 1h. Phase 40 decision records — DR-40-A, DR-40-B, 2026-08-19

Written before any `crates/pv-ffi/` or `ios/PasskeyVault/` code, on the `IOS-06`/`KEY-05`/`EXT-10`
precedent this project already follows (decision-record-before-dependent-code). Owed per
`40-RESEARCH.md` §"Decision records this phase owes".

### DR-40-A — `pv-ffi` sharing serialization contract: **DECIDED — `String`-JSON produced by
`serde_json` inside Rust**

**Decision:** every new `#[uniffi::export]` added in plans 40-02/40-03/40-04 whose value reaches the
server wire returns a `String` produced by `serde_json` INSIDE Rust, and accepts such a `String` on
the way back — mirroring `pv-wasm`'s own convention: `sealCollectionKey`, `unsealCollectionKey`'s
input, `encryptItemForCollection`, `decryptItemForCollection`, and `WasmInviteChannel::wrapCollectionKey`
all serialize/deserialize via `serde_json::to_string`/`serde_json::from_str` in Rust, never handing a
typed record to the FFI boundary for a wire-bound value [OBS: `crates/pv-wasm/src/lib.rs:326-333,
343-353, 355-373`].

**Rejected: UniFFI `Record` with `Data`/byte-array fields** (Phase 35's `FfiWrappedKey`/
`FfiEncryptedItem` style, `crates/pv-ffi/src/lib.rs:417-448`). Rejected on the merit that `serde_json`
encodes `Vec<u8>` as a JSON number array and `[u8; N]` as a fixed-length sequence, while Swift's
`JSONEncoder` encodes a `Data` field as base64 by default — so a `Record`-of-`Data` hands the wire
format to Swift's encoder instead of fixing it in Rust, and iOS would write an encoding no other
client reads (the D-21 defect shape, third instance this project has now named explicitly).

**Two things make this sharper than the Phase 37/38 instance:**
- `SealedKey.ephemeral_pk` is `[u8; 32]` [OBS: `crates/pv-core/src/identity.rs:267-268`], whose serde
  representation is a fixed-length SEQ of numbers — a wrong encoding here fails at a *different* layer
  than the `nonce`/`ciphertext` `Vec<u8>` fields Phase 38 already reasoned about, so the existing
  wire-shape mental model does not fully cover it by analogy.
- `wrapped_secret_key` is written **once per account and then adopted forever** by
  `identity.rs::upsert`'s `ON CONFLICT(user_id) DO NOTHING` — a wrong encoding there is not one bad
  row, it is the account's identity keypair, permanently, for every client that ever authenticates.

**This project has already lived this exact tradeoff once, inside `pv-ffi` itself.** DR-38-C
(§1a below) coexists two shapes on purpose in the SAME file: `encrypt_item`/`decrypt_item` stay
`Record`-shaped (`FfiWrappedKey`/`FfiEncryptedItem`, non-wire-bound call sites), while
`encrypt_item_wire`/`decrypt_item_wire`/`encrypt_item_combined_json`/`decrypt_item_combined_json`
are `String`-JSON produced by `serde_json` inside Rust for anything that reaches persistence
[OBS: `crates/pv-ffi/src/lib.rs:102-112`, `wire.rs`]. DR-40-A extends that same split to the sharing
surface: every new sharing function is wire-bound by construction (it either goes into an HTTP request
body or gets read back out of one), so it follows the `*_wire`/`*_combined_json` half of that split,
never the `Record` half.

**The sanctioned raw-bytes exceptions, named explicitly (FFI-03 style).** Two of the fourteen new
functions genuinely need to exit as raw bytes, not JSON, and DR-40-A states why rather than leaving it
implicit: `generate_invite_secret` (mirrors `pv-wasm`'s `generateInviteSecret`, its own header calling
itself the *"TRZECI SANKCJONOWANY WYJĄTEK"* [OBS: `crates/pv-wasm/src/lib.rs:21-28`]) returns raw
bytes because the secret must literally appear in a shareable URL fragment — it cannot be JSON-wrapped
and still be a pasteable link fragment. `FfiInviteChannel::proof_for_redemption` returns raw bytes
because the proof is a bearer credential presented in a POST body (WR-08), not a structured value with
named fields. Plan 40-04 adds both to `scripts/audit-ffi-opaque-handles.sh`'s named, justified
allowlist — the pattern is NOT loosened to admit them generically (Pitfall 9); each is a specific,
commented entry.

**Residual risk, stated not glossed:** this record is INFERRED until plan 40-02's E-W2 run observes a
real row on the wire and confirms `jq -e '... | fromjson | .nonce | type'` reads `"array"`, not
`"string"`. If E-W2 contradicts it, this record is amended in place, not quietly ignored or overwritten.

**Evidence:** `crates/pv-wasm/src/lib.rs:21-28, 326-373, 697-760`; `crates/pv-ffi/src/lib.rs:102-112,
417-448`; `crates/pv-core/src/identity.rs:267-268`; `40-RESEARCH.md` §"`pv-ffi` additions this phase
requires", §"Decision records this phase owes" → DR-40-A.

### DR-40-B — iOS's role in FSH-02: **DECIDED — full participant (receiver AND resealer)**

**Decision:** iOS is a FULL FSH-02 participant. It receives a Collection Key by BOTH invite-time-wrap
(Path A) and lazy reseal (Path B), AND it runs the reseal trigger as a keyholder (owned by a later
plan, currently numbered 40-10 in this phase's plan set).

**Rejected: receiver-only.** Rejected on the merit that a family whose only key holder uses iOS never
heals under receiver-only — no web session ever fires the trigger, so `family-wide-pending`'s
`resealable` list stays unserved indefinitely for that family — and that FAM-04's prohibition
(*"nie wolno wynaleźć tu drugiego, rozjeżdżającego się modelu"*) reads as owning the whole delivery
mechanism, not the half SC4's literal wording happens to exercise. **Accepted cost, stated plainly:**
roughly one extra plan to port the trigger.

**Invariants the port must preserve, each named as load-bearing** (ported from
`main:web/src/lib/families/resealTrigger.ts`/`reseal.ts`, read this session):
- The trigger set deliberately includes the sharer — no `recipient_user_id != me` guard anywhere.
- The attempted-pair set is claimed synchronously before the first `await` and cleared on every
  lock/unlock transition, so a transient failure retries next unlock and is never stranded.
- The trigger never rejects — each pair is its own best-effort attempt — and is never awaited on the
  unlock critical path.
- A `409` from `add_member` during reseal is SUCCESS, not failure (idempotent grant via the server's
  `ON CONFLICT DO NOTHING` on `collection_keys`' composite PK) — never treated as an error.
- A recipient with no published public key throws BEFORE any network call (T-25-16) — never a
  silently skipped grant.
- Reseal delivers the SAME Collection Key and never rotates it; rotation belongs only to member
  removal.
- The level propagated to a late joiner is the SHARE's own `family_wide_access_level`, with `"read"`
  as the only fallback when that column is `NULL` — **never** the propagator's own held `access_level`.
  This is precisely the bug migration `0020_family_wide_access_level.sql` and the CR-01/CR-03 fix
  (brought current by this plan's Task 1) exist to close; an iOS port that reads `access_level` off
  its own collection row to decide what to grant reproduces a shipped, fixed bug.

**Three scope calls this phase makes explicitly, recorded here rather than left to omission**
(`40-RESEARCH.md` Open Questions 2/3/4):
- iOS authors FAMILY-scope invites only in this milestone. Collection-scoped invite authoring stays
  UI-absent on iOS, matching Phase 24's web precedent — no share-authoring sheet ships this phase (see
  `40-UI-SPEC.md` §0.3, "SPECIFIED, NOT SCHEDULED").
- iOS reproduces `itemCapabilities.ts::canEditItem`'s refusal to edit a `sharedToMe` item at ANY
  access level, including `edit`, because no encrypt-as-shared-key-recipient primitive exists on any
  client yet (the crypto half is itself deferred, tracked outside this phase). iOS must not present an
  Edit affordance it structurally cannot honor.
- iOS is NOT the surface that closes WINDOWS #13 (no UI path to add a member to an existing
  collection). That gap, if still open after re-reading `main`'s `ShareDialog.tsx`, stays open; iOS is
  not planned to be its fix.

**Evidence:** `main:web/src/lib/families/resealTrigger.ts`, `reseal.ts` (read this session, post-merge);
`crates/pv-server/migrations/0020_family_wide_access_level.sql`; `crates/pv-server/src/routes/
collections.rs` (19 occurrences of `family_wide_access_level`, confirmed post-merge, Task 1);
`crates/pv-server/tests/family_wide_sharing.rs`
`family_wide_reseal_add_member_body_is_shape_identical_to_an_ordinary_share`; `40-RESEARCH.md`
§"FSH-02, as actually implemented", §"Open Question 1", §"Decision records this phase owes" → DR-40-B.

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

**The transition happened, 2026-08-17 (Plan 38-04).** Same command, re-run after landing
`crates/pv-core/src/generator.rs` and `crates/pv-core/src/generator/wordlist.rs`:

```
$ grep -rliE "passphrase|wordlist|generate_password" crates/pv-core/src/ crates/pv-wasm/src/ | wc -l
2
crates/pv-core/src/generator.rs
crates/pv-core/src/generator/wordlist.rs
```

Non-zero, as predicted, and as it should be — this is the baseline's own recorded transition, not a
regression to chase back to zero. `crates/pv-wasm/src/` still contributes nothing to the match, because
`pv-wasm` never calls into `generator` (see DR-38-A's amendment below on why that stayed true even
after the module became unconditional in `pv-core`).

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

**OBSERVED 2026-08-17 — the FOLDER direction, plan 38-09, Task 3.** Plan 38-09's own text asks for
this to be recorded "under L-11, alongside the item result" — a mislabeling this session found and is
correcting rather than silently reproducing: L-11 (§3, below) is an unrelated `pv-ffi` build-variant
landmine; the item result this plan meant is the entry directly above, in THIS section (L-17). Recorded
here, where the item result actually lives, not under the wrong number.

An item pass does not imply a folder pass — the folder column is a DIFFERENT shape (DR-38-C:
`encrypt_item_combined_json`'s ONE combined string, not the split `enc_key`/`enc_data` pair items use),
at a FIXED revision, with an identifier that MUST be minted before encryption. Harness:
`scripts/verify-ios-web-folder-interop.mjs run-folder-interop` +
`ios/PasskeyVault/PasskeyVaultTests/FolderWireInteropTests.swift`. All three directions run for real,
against an isolated `pv-server` (throwaway `/private/tmp` database, port 8624) and the real `pv-wasm`
artifact `web/` itself imports:

```
=== Folder direction of the cross-client proof (38-09 Task 3) ===
PASS  Folder-F1 (iOS -> pv-wasm), folder name
PASS  Folder-F1 (iOS -> pv-wasm), item assignment
PASS  Folder-F2 (pv-wasm -> iOS), folder name + item assignment
PASS  Folder-F3 (iOS-side falsification)
PASS  Folder-F3 (pv-wasm-side falsification)

all 5 checks passed
```

- **F1 forward** — a folder created by the real `FolderStore.create` (`encrypt_item_combined_json`)
  came back from `GET /api/sync` with `enc_name`'s `enc_key.nonce` typed as a JSON array, and the REAL
  `pv-wasm` artifact decrypted it, recovering the literal name typed independently on both sides. An
  item created in the SAME call, with `folderId` set to that folder's id, ALSO decrypted in `pv-wasm`
  with `fields.folderId` matching the folder's own id — proving the item-assignment direction in the
  same write, since assignment is nothing more than the item's own `folderId` field.
- **F2 reverse** — a folder AND an assigned item, both written by `pv-wasm` exactly as
  `web/src/lib/vault/store.ts`'s `createVaultFolder`/`createVaultItem` write them, both decrypted on
  iOS through the real `FolderStore.refresh()`/`VaultStore.refresh()`, with the assignment surviving.
- **Falsification (F3), and it produced a real failure, on BOTH sides.** iOS deliberately minted the
  folder id AFTER encryption (`FolderWireInteropTests
  .f3_iosCreatesAFalsifiedFolderWithIdMintedAfterEncryption`: encrypt bound to `wrongId`, then mint
  `realId` and POST under it) — exactly the shape a server-minted identifier used to produce, before
  `folders.rs::CreateFolderRequest`'s own fix, on every client. The server accepted it (`201` — carries
  no information, same lesson as the item falsification arm). iOS's OWN next `FolderStore.refresh()`
  failed to decrypt it (`decrypt_item_combined_json` rejected the AAD mismatch). `pv-wasm`, reading the
  SAME row, ALSO failed: `decryption failed (wrong key or corrupted data)`. Both halves required — a
  harness that could not decrypt anything at all would also show "both failed", which is why iOS's own
  refresh is checked as a defense-in-depth arm rather than the only evidence.

**Not outstanding this time:** unlike the item direction, no browser-rendering half is claimed missing
here either — the same `web/node_modules` limitation applies (no dev server, no browser, in this
worktree), and this record does not claim otherwise; the recipient-side `pv-wasm` decrypt is the
evidence, exactly as it is for L-17's own item result above.

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

### L-19 — the persisted server setting cannot carry a subpath

**What goes wrong.** A self-hoster fronts `pv-server` under a reverse-proxy path
(`https://example.com/vault`) instead of a dedicated subdomain, types that address into 38-13's server
setting, and the app silently talks to the wrong origin's root for every request — no error anywhere,
because neither client's request-building code has a place to notice.

**Why it happens.** `PvApiClient.send`/`VaultAPI.send` build every request with an absolute path
literal (`"/api/auth/login"`, `"/api/vault/items"`, …), and pass it to `URL(string:relativeTo:)`.
Observed, both call sites:

```
$ grep -n 'URL(string: path, relativeTo: baseURL)' ios/PasskeyVault/PasskeyVault/Core/PvApiClient.swift
185:        guard let url = URL(string: path, relativeTo: baseURL) else {
$ grep -n 'URL(string: path, relativeTo: baseURL)' ios/PasskeyVault/PasskeyVault/Vault/VaultAPI.swift
166:        guard let url = URL(string: path, relativeTo: baseURL) else {
```

Per RFC 3986 §5.3 (and `URL(string:relativeTo:)`'s own documented behavior), resolving an
**absolute-path** reference (one that starts with `/`) against a base URL replaces the base's ENTIRE
path, ignoring anything after the base's host — `https://example.com/vault` as `baseURL` plus
`"/api/auth/login"` as `path` resolves to `https://example.com/api/auth/login`, silently discarding
`/vault`. Neither `send` implementation has any way to detect this; the request simply goes to the
wrong place and (if nothing happens to be mounted at the server's literal root) fails with a generic
404/routing error that gives no hint the cause was the subpath being dropped.

**How this plan (38-12) responds.** `ServerSettings.normalise(_:)` REFUSES any input carrying a path
component, naming the reason ("has a path, and paths are not supported"), rather than accepting it and
letting the failure surface two screens later as an inexplicable request error. This is a disclosed
limitation, not a fix: self-hosters who need a subpath cannot use this app's server field until a
future plan changes it.

**Consequence / backlog item.** Supporting a subpath means changing BOTH `send` implementations (making
the path-join preserve `baseURL`'s own path component ahead of each request's absolute path) and proving
it against a server genuinely mounted under a prefix — a test against `http://127.0.0.1:8621` (root-mounted)
cannot demonstrate this; a green suite here would prove nothing about it. Filed as backlog, not attempted
in this plan.

**Live harnesses are unaffected — checked, not assumed.** `AccountFlowLiveTests`/`CrossClientInteropTests`
and every other `*LiveTests.swift` build their own `PvApiClient`/`VaultAPI` directly from `PV_TEST_SERVER`
(a root-mounted `http://127.0.0.1:8621` by convention) and never read `ServerSettings.resolved`:

```
$ grep -rln 'ServerSettings' ios/PasskeyVault/PasskeyVaultTests/*.swift
ios/PasskeyVault/PasskeyVaultTests/ServerSettingsTests.swift
```

Only this plan's own `ServerSettingsTests.swift` — the file that tests `ServerSettings` itself — reads
it at all. Every `*LiveTests.swift` file, including this plan's sibling `ServerReachabilityTests.swift`
(which builds its live-server case straight from `PV_TEST_SERVER`, matching `AccountFlowLiveTests`'
own convention), has zero references. Moving the app's default off loopback (38-12) cannot break any
live harness, because none of them go through it.

**Warning sign:** a plan or bug report describing a self-hosted server "behind a reverse-proxy path" or
"mounted under a prefix" without checking whether either `send` implementation's path-join has been
changed to account for it.

### E-G1 — the four-check UI-06 gate (`scripts/audit-generator-uses-ffi.sh`), verified falsifiable

Plan 38-08, Task 2. `38-RESEARCH.md`'s own §"Pitfall 11": ROADMAP SC4, taken literally, greps for the
ABSENCE of a Swift RNG call in the generator path — which passes trivially on a generator that never
calls Rust at all. The fix is four checks (two negative, two positive), all required to hold, with
every arm demonstrated able to FAIL under a targeted mutation before its passing was trusted. All four
runs below, plus the reverts, were executed live in this session.

**Landmine found while writing the checks, both self-inflicted, both fixed before relying on the
gate:**

1. **The script's own header comment tripped check 1 and check 4.** Naming the forbidden RNG APIs
   (`SystemRandomNumberGenerator`, `arc4random`, …) and a wordlist example word in prose, inside
   `GeneratorSheet.swift`'s and `PasswordStrengthTests.swift`'s own doc comments, made those files hits
   against their own gate. Fixed by describing the forbidden set by reference (checks 1/4's own pattern
   in the script) rather than restating it, and by using SYNTHETIC placeholder tokens
   (`mockwordone`-style) in the strength-meter test fixture instead of a real EFF wordlist word — the
   score is structural (letters + hyphens, length), not word-identity-dependent, so this loses nothing.
2. **Unanchored check 3/2 patterns matched a RENAMED symbol as a substring.** The first version of
   `SYMBOL_PATTERN`/`CALL_PATTERN` (`func generatePassphrase`, no trailing anchor) still matched
   `func generatePassphraseRENAMED(...)` as a PREFIX, so falsification 3 (below) initially reported a
   false PASS over the exact mutation it exists to catch — reproducing this repo's own "a check that
   cannot fail" defect class one level up, inside the check meant to prevent it. Fixed by anchoring both
   patterns on the literal open-paren (`generatePassphrase\(`), which a renamed symbol no longer
   satisfies. Recorded here because it is the same lesson `audit-ffi-opaque-handles.sh`'s CR-02/CR-03
   already paid for (an audit whose own matching is not exact reports PASS over the defect it exists to
   find) — a fourth instance of it, discovered while building the fix for the third.

**Falsification transcripts, all four checks, one mutation at a time, each reverted and the clean run
re-confirmed before moving to the next:**

```
$ bash scripts/audit-generator-uses-ffi.sh   # baseline, before any mutation
== check 1 (negative): no Swift RNG API anywhere under ios/ ==          count: 0   PASS
== check 2 (positive): a real Swift call site ... ==                    count: 3   PASS
== check 3 (positive): the generator symbols exist in the bindings ==   count: 2   PASS
== check 4 (negative): no Swift-side wordlist/charset literal ... ==    count: 0   PASS
OVERALL: PASS

# 1. Injected `Int.random(in: 0...9)` into GeneratorSheet.swift.
== check 1 ... ==   count: 1   FAIL -- .../Generator/GeneratorSheet.swift:391: ... Int.random(in: 0...9)
$ echo $?
1
# Reverted (diff against pre-mutation copy empty); re-ran: check 1 count: 0, PASS.

# 2. Renamed every real call-site occurrence of generateCharacterPassword/generatePassphrase in
#    GeneratorSheet.swift and its UI test (a full identifier substitution, not a wrapper).
== check 2 ... ==   count: 0   FAIL -- zero call sites ... outside the generated bindings
$ echo $?
1
# Reverted both files (diff empty); re-ran: check 2 count: 3, PASS.

# 3. Renamed the GENERATED binding's own declaration: `generatePassphrase` -> `generatePassphraseRENAMED`
#    in ios/PasskeyVault/build/swift-bindings/pv_ffi.swift (gitignored build artifact).
== check 3 ... ==   count: 1   FAIL -- expected BOTH declarations, found 1
$ echo $?
1
# (First attempt at this mutation, BEFORE the check-3 anchor fix above, incorrectly PASSED --
#  the landmine recorded above. Re-run after the anchor fix produced the FAIL shown here.)
# Reverted the bindings file (diff against pre-mutation copy empty); re-ran: check 3 count: 2, PASS.

# 4. Pasted the EFF wordlist's own first entry, "abacus", into a comment in GeneratorSheet.swift.
== check 4 ... ==   count: 1   FAIL -- .../Generator/GeneratorSheet.swift:60: ... "abacus" ...
$ echo $?
1
# Reverted (diff empty); re-ran: check 4 count: 0, PASS.
```

Final clean run after all four reverts, byte-identical to the baseline above: all four checks PASS,
`OVERALL: PASS`.

**Structural rules honoured, both paid for once already in this repository:** the shell here is zsh
(L-3, this same file, §3) — every check captures grep's OUTPUT into a variable and tests the STRING,
never a status read off the end of a pipe (`grep -c PIPESTATUS scripts/audit-generator-uses-ffi.sh`
outputs `0` — the identifier itself is deliberately not spelled out in the script's own comments, for
the same reason as landmine 1 above: doing so would make the script a hit against its own check). Every
check greps the WHOLE file set (`-r`) with an explicit printed count, never a sed/awk range extraction
(CR-02/CR-03's own lesson, `audit-ffi-opaque-handles.sh`'s header).

### L-20 — a live XCTest against the shared simulator's live server silently hijacks the persisted UI-test session

**Found 2026-08-17, Plan 38-09, Tasks 2/3.** Both `VaultMutationTests
.aLiveStaleRevisionConflictIsSurfacedAndDoesNotOverwrite` and `FolderWireInteropTests`' three methods
drive the REAL `AccountService`/`PvApiClient` against `PV_TEST_SERVER ?? http://127.0.0.1:8621` —
the SAME live `pv-server` this development simulator's actual app also talks to, and each of those
tests `register()`s a fresh, randomly-named account. `AccountService.register`/`.signIn` write the
resulting session (token + `pw_wrapped_uk`) into the SAME Keychain the app's own `SessionTokenStore`/
`ContentView.determineRoute()` read on launch — there is only one Keychain per app on a given
simulator, and a unit-test host process and the app's own UI process share it. Running these live
tests therefore silently REPLACES whichever account the app's `LockView` was showing with an
unrelated one, on the SAME simulator.

**Symptom, observed live:** `ItemDetailScreenshotUITests`' pre-existing (38-07), previously-passing
helper — which assumed the shared `pv-snap-38-05@example.invalid` fixture account's session was still
the one restored on launch — started failing with `vault list never appeared after unlock` after this
plan's own `VaultMutationTests`/`FolderWireInteropTests` ran on the same simulator. A manual screenshot
of the "stuck" state showed `LockView` correctly rendering, but for `ios-va...14af@example.com` — an
`ios-vault-mutation-…` fixture email from the live conflict test, not the expected account. The
correct master password for `pv-snap-38-05` was being typed against the WRONG account's `LockView`,
which fails to unlock silently (a wrong-password failure, not a missing-view failure), and the test's
own generic "vault list never appeared" message gave no hint the account itself had changed.

**Fix applied here, and the pattern going forward:** `ContentView.swift`'s existing
`PV_UITEST_SCREEN=auth` forced-route hook (added for 38-13's onboarding evidence) sidesteps the
persisted session entirely — set it in `XCUIApplication().launchEnvironment`, then always register a
brand-new, uniquely-named account in the test itself rather than depending on ANY simulator-persisted
state surviving between test files or plans. `ItemFormAndFolderUITests.swift` (this plan) and the
fixed `ItemDetailScreenshotUITests.swift` both use this pattern now.

**Consequence for future plans:** any `*LiveTests.swift`/`*WireInteropTests.swift` file that registers
a REAL account against the SAME server/simulator this development environment's app itself is
configured to talk to (as opposed to an isolated throwaway server on its own port, the
`verify-ios-web-*-interop.mjs` scripts' own discipline) should be assumed to invalidate any
UI-test-shared session on that simulator. Prefer either an isolated server port for the live test, or
the `PV_UITEST_SCREEN=auth` + fresh-account pattern for the UI test — never a shared, persisted-session
fixture account once ANY live XCTest in the suite talks to the same live server.

### L-21 — Swift Testing's default parallel execution manufactures a dozen false failures the SAME suites do not show run alone or serialized

**Found 2026-08-18, plan 38-11, Task 1.** A bare `xcodebuild test -only-testing:PasskeyVaultTests`
(the whole target, no scoping) reported roughly a dozen failing tests spread across
`KeychainEnvelopeTests`, `AccountFlowLiveTests`, `E5Tests`, `FaviconLoaderPersistenceProofTests`,
`ServerReachabilityTests`, `ItemDetailTouchLiveTests` and `VaultMutationTests` — files this plan never
touched, most with `(0.000 seconds)` durations suggesting a setup-time failure rather than a real
assertion. `KeychainEnvelopeTests` run ALONE (`-only-testing:PasskeyVaultTests/KeychainEnvelopeTests`)
passed 12/12, immediately. Re-running the FULL target with `-parallel-testing-enabled NO` collapsed the
failure list from ~12 methods across 7 files down to exactly the six methods of the three suites this
project already documents as needing EXTERNAL isolated infrastructure this worktree does not have
(`CrossClientInteropTests`, `FolderWireInteropTests`, `VaultWireInteropTests` — L-17's own "the
browser-observed half is outstanding, `web/node_modules` does not exist in this worktree" limitation) —
`230 tests in 36 suites`, `12 issues`, all six from the same three pre-known-limited suites, doubled by
each method's own two assertions.

**Cause, not fully root-caused (fixing it is out of this plan's scope) but narrowed:** Swift Testing
runs `@Test` methods from different `@Suite`s concurrently by default. Several of the affected suites
touch a genuinely SHARED, PROCESS-WIDE resource — the real Keychain, `URLProtocol.registerClass`-style
transport interception, or a live server connection — and this project's own `.serialized` convention
(`VaultMutationTests`/`ServerReachabilityTests`/`FaviconLoaderPersistenceProofTests`'s own header
comments) exists PRECISELY because two suites racing on such a resource produce exactly this failure
shape. `-parallel-testing-enabled NO` is the coarse, whole-target fix; the fine one (auditing every
suite touching a shared resource for a missing `.serialized`) is not this plan's job.

**Consequence for future plans, and for Phase 42's QA/CI work specifically:** a bare, unscoped
`xcodebuild test` sweep of the WHOLE `PasskeyVaultTests` target is not trustworthy evidence on its own
— a red result may be this landmine, not a regression. Either scope to the suite actually under test
(as every plan in this phase already does for its own new tests), or pass
`-parallel-testing-enabled NO` for a full-target sweep, and treat only the three
externally-infrastructure-dependent interop suites as an expected, pre-existing gap.

### L-22 -- the `GET /api/sync` up-to-date branch omits `items` entirely, not merely sets it null

**Found 2026-08-18, Phase 39, Plan 39-01, Task 2.** `SyncResponse` (`crates/pv-server/src/routes/sync.rs`) is a
`#[serde(untagged)]` two-variant enum, not one struct with an optional `items` field: the `UpToDate` branch has no
`items` KEY at all on the wire. A Swift decoder that models `items` as optional and coalesces a missing value to an
empty array would silently erase a persisted cache on the server's most common response (every sync call after the
first one, on an unchanged vault).

**Verified against a live isolated server** (`scripts/ios-live-server.sh --exec scripts/sync-contract-probe.sh`),
not inferred from source alone: `GET /api/sync?since=<current revision>` returned a body where
`jq -e 'has("items")|not'` exits **0** -- while the identical check against the `since=0` snapshot body (which
does carry `items`) exits **non-zero**, the required falsifiability control (D-06). Both bodies and both exit codes
are recorded verbatim in `ios/evidence/39/01-server-contract.md`.

**Consequence for 39-03's decoder:** decode `SyncResponse` as a genuine two-case enum (or an equivalent
presence-checked branch), never as one struct with `items: [Item]?` defaulted to `[]` on `nil`.

### L-23 -- `URLComponents.queryItems` does not escape `+`, and `pv-server`'s query decoder reads it as a space

**Found 2026-08-18, Phase 39, Plan 39-04, Task 1/2, live.** 39-04-PLAN.md's own code example (`### The WS URL`)
asserted "`URLComponents` percent-encodes" as if that alone closed the 05-02 hazard (a raw `+` in a query string
decoding as a space). It does not, on this platform: `URLComponents.queryItems`/`.url` percent-encodes a query
value using the GENERIC URI query allowed-character set (RFC 3986), which does **not** require escaping `+` --
unlike JavaScript's `encodeURIComponent` (what the web and extension clients actually use), whose escaped set
does include `+`. `pv-server`'s `axum::extract::Query` decodes the query string with
`application/x-www-form-urlencoded` semantics (`serde_urlencoded`), where an unescaped `+` decodes as a SPACE.

**Verified live, not inferred:** a real session token containing `+`, built via `SyncSocket.wsURL`'s ORIGINAL
`.queryItems`-based implementation, was sniffed off the wire (a local TCP relay proxy logging both directions)
reaching the server as a literal `GET /api/sync/ws?token=...+...` -- the server responded `401
{"error":"unauthorized"}`. `URLSessionWebSocketTask` reported this back to the client as
`NSURLErrorDomain Code=-1011 "There was a bad response from the server."` with
`_NSURLErrorWebSocketHandshakeFailureReasonKey=0` -- a generic-looking error that gives no hint the actual cause
is a query-encoding mismatch, not a TLS/ATS/handshake-computation problem (`Sec-WebSocket-Accept` was verified
correct against the same token via a raw `curl --http1.1` request with a fixed key, confirmed correct via the
RFC 6455 SHA-1 formula in Python).

**Fix:** `SyncSocket.wsURL` builds the query via `URLComponents.percentEncodedQueryItems`, pre-encoding the
token with `CharacterSet.urlQueryAllowed.subtracting(CharacterSet(charactersIn: "+&=?"))` as the allowed set --
still URL-component construction, never string concatenation, just a stricter allowed-character set than
`.urlQueryAllowed`'s default. Re-verified live via the same sniff proxy: the identical `+`-bearing token now
reaches the server pre-encoded (`%2B`) and the handshake completes with `HTTP/1.1 101 Switching Protocols`.

**Consequence:** any FUTURE iOS code that puts a token/secret in a URL query via bare `URLComponents.queryItems`
should not assume the encoding is equivalent to `encodeURIComponent` -- it is not, specifically for `+`, and the
failure mode (a generic-looking 401 or, at the transport layer, a generic-looking `-1011`) does not name the
cause.

### L-24 -- a one-shot `URLSessionWebSocketTask.receive` disguised by a working poll fallback

**Found 2026-08-18, Phase 39, Plan 39-04, Task 1, RED-before-green demonstration.**
`receiveMessageWithCompletionHandler:` (`NSURLSession.h:658`) delivers exactly ONE message per call -- a receive
loop that does not re-arm itself inside its own success branch receives precisely one push per connection and
then looks correct forever, because nothing about the socket's own state changes. With `SyncSocket`'s re-arm
line (`self.receiveLoop(task: task)`) temporarily removed, `SyncSocketTests
/receivingASecondFrameOnTheSameConnectionTriggersASecondPull()` fails as expected (transcript in
39-04-SUMMARY.md); restored, it passes. **Classified Verified** -- this is exactly why Task 2's live two-push
proof (`scripts/ios-ws-push-proof.sh`) refuses to run with the in-foreground repeating pull enabled (D-06): with
the poll running, a one-shot receive would be invisible, because the poll alone would still refresh the second
mutation on its own schedule.

**Note on numbering:** 39-04-PLAN.md's own text names these two landmines "L-10" and "L-11" -- both numbers were
already in use (L-10/L-11, cold-DerivedData and shared-output-path races, Phase 36) by the time this plan
executed. Recorded here as L-23/L-24, the next available numbers, rather than colliding with the existing
entries.

### L-25 -- the cross-process reach result (SYNC-02), and the two controls that proved it was enforced

**Found 2026-08-19, Phase 39, Plan 39-07, Tasks 1/2.** A snapshot written by the host app IS readable,
cold, by a second, independently-scheduled process: a real credential-provider extension process
(invoked via `AutoFillInvocationUITests`' Settings toggle, Phase 36), with the host app terminated
(`xcrun simctl terminate`, absence confirmed by two independent `launchctl list` captures rather than
assumed from the command alone), read bytes SHA-256-identical to what the host wrote
(`ios/evidence/39/07-cold-read.md`). Both mandatory negative controls fired: a read against a sharing
identifier the extension does not declare in its entitlements returns `resolve_failed`
(`containerURL(forSecurityApplicationGroupIdentifier:)` returning nil for an undeclared identifier IS
the platform's own enforcement -- if it had instead resolved, the positive result above would have
proven nothing); and a read after the cache file is deleted reports `status=absent`, not a stale
in-process copy, proving the reader reads storage rather than memory. `scripts/ios-cold-read-proof.sh`
also proved the AutoFill surface's own last-synced line (SYNC-04): the host and the extension,
reading the same persisted snapshot through the SAME `PvShared/SyncFreshness` formatter with a
pinned, externally-coordinated reference instant, render byte-identical strings -- and the identical
comparison mechanism, pointed at a snapshot with a deliberately different `syncedAtMs`, emits a
genuinely different string, so "SAME" is not indistinguishable from a comparison that never ran.

### L-26 -- Xcode 26.6's Debug app-extension binary is a thin loader stub; the real code lives in a sidecar `.debug.dylib`

**Found 2026-08-19, Phase 39, Plan 39-07, Task 1's own backstop-truth check.** Proving "the shared
module compiled into the extension target and the extension binary links it" by inspecting the built
`.appex`'s own executable (`nm .../PasskeyVaultAutoFill | grep AppGroupCiphertextCacheStore`) returned
**zero matches** on a run that had JUST demonstrated the real code executing correctly (matching
SHA-256 digests, correct freshness strings) -- `nm`/`strings`/`otool -l` on that binary showed only
~80 symbols total, no Swift metadata sections, and a `___debug_blank_executor_main` symbol; total file
size ~56 KB. This is not a build failure: Xcode 26.6's Debug configuration links the target's actual
compiled code into a **sidecar `<Target>.debug.dylib`** sitting next to the on-disk executable inside
the same `.appex`/`.app` bundle (confirmed: `PasskeyVaultAutoFill.appex/PasskeyVaultAutoFill.debug.dylib`,
~4.7 MB, 17868 symbols, 52 matches for the same class name) -- the thin executable is a loader stub for
faster iterative Debug rebuilds. **Any future binary-inspection gate against a Debug build product on
this toolchain must check the `.debug.dylib` first, falling back to the plain executable only for
configurations (e.g. Release) where this indirection does not apply** -- `scripts/ios-cold-read-proof.sh`
does this now.

### L-27 -- two shell landmines found building this plan's own live-proof harness

**Found 2026-08-19, Phase 39, Plan 39-07, Task 1.** (1) `grep -rc PATTERN DIR | grep -v ":0" | wc -l`,
used elsewhere in this repo to count files WITH a match, aborts under this project's own
`set -euo pipefail` discipline on the DESIRED, passing outcome (zero hits anywhere): `grep -rc` with no
match at all exits 1 even though it still prints `file:0` for every file, and `pipefail` propagates that
upstream exit-1 through the pipe even though the downstream `grep -v`/`wc`/`tr` stages all succeed.
Rewritten as `grep -rl PATTERN DIR | wc -l` (list files WITH a match) with a guarding `|| true` on the
assignment. (2) A stale marker file left in the shared App Group container by an earlier, aborted run of
the SAME script silently satisfied a `wait_for_file` poll before the CURRENT run's own host test had
written anything -- pinning a freshness comparison to a DIFFERENT run's own reference instant and
producing a plausible-looking but false mismatch. Fixed by deleting every marker file the script itself
owns immediately before waiting for it, the same discipline `scripts/ios-probe-run.sh`'s own
`RUN_START`-scoped log capture already established for exactly this class of stale-evidence
false-positive.

## 3a. The visual layer was never verified — open gaps as of 2026-08-17

**Written after Bartek looked at the running app and said, twice, that the screens
do not match the approved design. He was right both times.**

### The failure mode, named so it stops recurring

Phase 38's plans were executed with green tests, green gates, and screenshots
attached — and the screens still did not look like the approved artifact. Three
distinct causes, none of which any gate could see:

1. **A spec sentence was read as outranking the drawing.** The design spec's §4
   opens *"Structure is unchanged. This is a colour correction plus one copy
   move."* That sentence is about LAYOUT. Plan 38-13 took it as licence to leave
   Phase 37's auth screens as they were, so the titles stayed "Passkey Vault"
   instead of "Sign in"/"Create your vault", and every button kept saying
   *account* where the approved copy says *vault*. **Rule: where a spec's prose
   and the approved screens disagree about what the UI is, the screens win.**
2. **An empty `AccentColor.colorset`.** Xcode's placeholder carries no colour
   values; iOS's fallback for that is system blue. The entire vault surface —
   tab bar, selected label, lock glyph — rendered iOS blue. Auth and onboarding
   escaped only because 38-13 tinted each button by hand. Now generated from
   PVAccent by `scripts/gen-ios-colorsets.py` and drift-checked by `--check`.
3. **`scripts/audit-ios-colour-tokens.sh` cannot see absence.** It finds wrong
   colours and tokens naming a nonexistent colorset. An unset accent and an
   un-tinted control are neither — they are missing values. **A colour gate that
   greps source cannot verify a rendering. Only looking at the screen can.**

### Still open, and owned by 38-11's roll-up

| Gap | Approved design says | What ships today |
|---|---|---|
| ＋ control | detached capsule expanding in place into a 3×3 action grid, becoming ✕ | a stock `Menu` on a plain circular FAB |
| Search | dock accessory pill (`tabViewBottomAccessory`) | inline search bar under a large title |
| Section index | `L C 2 P I N` down the right edge, `#available(iOS 26)` guarded | not rendered at all |
| Lock title | "Vault locked", Face ID glyph, "Unlock with Face ID" primary | "Unlock your vault", no glyph, password primary |
| Lock state 3 | muted status slot explaining biometry is unavailable | no slot; the screen just omits Face ID silently |
| Lock states 5 / 8 | visually distinct (`PVError` vs muted) | one shared `PVError` banner |
| Lock states 6 / 7 | throttled (controls visibly disabled), no-passcode | not implemented |

### What to do differently next phase

**Open the app and look at every screen against `ios/brand/screens*.html` and the
published artifact BEFORE writing a SUMMARY that says a plan is done.** Every
defect in the table above would have been caught in about ten minutes of looking,
and none of them was caught by 209 passing tests and three passing gates.

## 3b. The $99 tripwire FIRED on hardware — 2026-08-17

**[OBSERVED]** This closes §4 q.3, which has been open since Phase 36.

Bartek set his own team (`4S7F2M7YLW`, a FREE Apple ID) on both targets in Xcode and hit ⌘R against a
real `iPhone 16` (`iPhone17,3`). Xcode reported, on the `PasskeyVaultAutoFill` target:

```
No profiles for 'cloud.blonie.PasskeyVault.AutoFill' were found: Xcode couldn't find any
iOS App Development provisioning profiles matching 'cloud.blonie.PasskeyVault.AutoFill'.

Communication with Apple failed: The selected team does not have a program membership
that is eligible for this feature.
```

**The second message is the load-bearing one.** It is Apple refusing an entitlement to a team without a
paid Developer Program membership. Not a misconfiguration, not a missing click — a membership refusal
from Apple's own service.

**CORRECTION, 2026-08-17, and it matters because the original wording recorded an inference as an
observation.** This entry first said Apple refused
`com.apple.developer.authentication-services.autofill-credential-provider` **and**
`com.apple.security.application-groups`. The error message names **neither** — it names a *target*
(`cloud.blonie.PasskeyVault.AutoFill`). Which key triggered it was never observed.

It has since been settled empirically, against the provisioning profiles Apple actually issued to
Bartek's machine (`~/Library/Developer/Xcode/UserData/Provisioning Profiles`, decoded with
`security cms -D`):

| Profile | `autofill-credential-provider` | `application-groups` | Expires |
|---|---|---|---|
| `cloud.blonie.PasskeyVault` | **absent** | **PRESENT** | 7 days out |
| `cloud.blonie.PasskeyVault.AutoFill` | absent | absent | 7 days out |

**App Groups WAS granted on the free team.** The claim that it was refused is withdrawn. Only the
AutoFill entitlement is missing from every issued profile, so that is the one the membership buys.
This also settles §4 q.4 ("App Groups are unavailable on a free Apple ID, unexplored"), which is
**wrong** and is retired here.

Second, unrelated but observed at the same time: **a 7-day profile expiry is the free-team
signature.** A paid membership issues them for a year. That is the cheapest way to check whether a
purchased membership has actually taken effect in the toolchain, without building anything.

### Why this matters beyond one failed build

§4 q.3 pre-registered the exact condition: *"Will the simulator grant
`com.apple.developer.authentication-services.autofill-credential-provider` to a personal/no team? If it
refuses, that — and only that — is the decision point for the $99 Apple Developer Program. Not before."*

Phase 36 answered the SIMULATOR half and answered it yes — the entitlement embedded, the extension
registered, was elected, and appeared in Settings (`ios/evidence/36/`). That result stands and is not
retracted. What it never touched is the **device** half, because the simulator path *"has no
entitlement-issuing authority at all — no provisioning profile, no `amfid`/`taskgated`"* (DR-1's own
recorded residual risk, §1). This is that residual risk arriving.

**So: the simulator granted it; hardware refuses it on a free team.** DR-1's caveat was correct, and the
$99 decision is now a live business gate rather than a hypothetical one — Bartek's call, not a technical
phase.

### What it costs, concretely, until the membership exists

Phase 37's device run already showed the shape of the workaround, and it is the same one: strip
`autofill-credential-provider`, `application-groups` and `keychain-access-groups` from **both**
`.entitlements` files, keep the Team set, and the app signs and installs fine — a free team can sign an
ordinary app, it simply cannot carry those three keys. The appex does NOT need unembedding; with empty
entitlements it signs like any other target.

**Consequences to state plainly rather than discover later:**

- **Biometric unlock still works on device** — `UkEnvelopeStore` uses the DEFAULT keychain access group,
  which needs no entitlement. This is what Phase 37's device run proved (SC4/SC5 confirmed on hardware,
  `ios/evidence/37/DEVICE-VERIFICATION-RESULT.md`).
- **Nothing about AutoFill is exercised on device.** No shared keychain group, no App Group container,
  no credential-provider election. **Phase 41 cannot be verified on hardware at all without the paid
  membership** — it is not "verify it later", it is blocked. Phase 41 owes its own device proof and
  cannot inherit Phase 37's, which was taken with these keys stripped.
- **Phase 43 (conditional passkeys) inherits the same block**, since it ships on the same extension.
- The stripped state **must never be committed.** It disables the extension for every other build and
  every simulator proof in Phases 36/41 silently. Both files are tracked, so
  `git checkout -- <both paths>` restores them; the stripped copies carry a comment saying so.

**Warning sign that this has been forgotten:** an `.entitlements` file in `git diff` with its keys
removed, or a phase claiming AutoFill device coverage without naming a paid membership.

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

## 6. Phase 38 — evidence

**Written 2026-08-18, plan 38-11, Task 2.** One row per ROADMAP success criterion: the criterion as
written, the artifact that evidences it, the falsification that made that evidence admissible, and its
status. Read `.planning/ROADMAP.md`'s Phase 38 section for the five criteria's exact original wording
before reading this table — this section reports AGAINST that wording, amending SC2 explicitly rather
than silently substituting a weaker claim for it.

| Criterion | Artifact | Falsification | Status |
|---|---|---|---|
| 38-SC1 — list with `.searchable`, swipe actions and context menu renders real decrypted items from a live server | `ItemListSearchUITests.swift` (search predicate against real rows), `VaultDockUITests`/`VaultDockEvidenceUITests` (dock, swipe, context menu, live commit `4cda61f`/`50cb594`), `ios/evidence/38/38-06b-*` (10 screenshots, 5 states × light/dark, real `pv-server`) | `VaultSearch`/`VaultFilter`/`VaultSort`: three RED-before-GREEN falsifications run and reverted (diacritic-folding substitution, cardholder-name widening, a broken filter→search→sort chain), 14 Swift Testing cases; `scripts/audit-ios-colour-tokens.sh` proven able to fail (a live `.borderedProminent`-without-`PVOnAccent` regression it caught, 38-13) | met |
| 38-SC2 — all five item types create/edit/delete, change visible server-side via a direct request | `VaultWireInteropTests.swift`/`scripts/verify-ios-web-item-interop.mjs` (items), `FolderWireInteropTests.swift`/`scripts/verify-ios-web-folder-interop.mjs` (folders) — **AMENDED wording per L-17**, see below | E-W1/F3: a base64-encoded (wrong-shape) row is server-accepted (`201`) and rejected by BOTH `pv-wasm` and iOS's own next refresh; `PV_ITEM_INTEROP_SKIP_CORRUPTION=1` turns the falsification-dependent checks red, proving the arm is not vacuous | met (amended) |
| 38-SC3 — TOTP detail screen's code/countdown match an independent RFC 6238 computation for the same second | `scripts/totp-oracle.py --selftest` (6/6 RFC 6238 Appendix B vectors) + `ios/IOS-SPIKE-LOG.md` §1f's E-T1 live comparison transcript (single-read exact match, 35s continuity sample, one period-boundary transition, zero mismatches) | oracle validated FIRST against published vectors before any comparison was trusted; two falsification arms (altered secret, too-short secret) both produced genuine non-vacuous failures | met |
| 38-SC4 — generator calls `pv-core`'s CSPRNG via `pv-ffi`, never `SystemRandomNumberGenerator`/`arc4random` | `scripts/audit-generator-uses-ffi.sh` (E-G1, four checks: two negative, two positive) — **replaces the ROADMAP's own literal single-grep wording**, which 38-RESEARCH.md's own Pitfall 11 names as passing trivially on a generator that never calls Rust at all | all four checks demonstrated able to FAIL under a targeted mutation, one at a time, each reverted (transcript in `ios/IOS-SPIKE-LOG.md` §"E-G1"); one check (`SYMBOL_PATTERN`/`CALL_PATTERN`) initially reported a false PASS on a renamed-symbol mutation (unanchored regex) — caught live, fixed, re-falsified before being trusted | met |
| 38-SC5 — a background app-switcher snapshot does not reveal vault contents | `scripts/snapshot-blockmap.py` (real AAPL/LZFSE/ASTC decoder, validated against a real Calendar capture before being trusted) + `SnapshotEvidenceUITests.swift` (E-S1, real register/create/background flow) | negative control (`PV_SNAPSHOT_COVER_DISABLED`) initially passed clean when it should have failed — a SwiftUI cosmetic mirror was covering unconditionally, confounding the control; fixed, re-run genuinely failed (`nonflat=3954` etc., marker secret legible in the decoded PNG) before the real run was trusted | met |

### SC2, in full: the amendment and why, item and folder results kept separate

SC2's literal ROADMAP wording — "server-visible via a direct request to `/api/sync`" — is satisfied by
`pv-server` storing `enc_data`/`enc_name` as opaque `TEXT` and returning whatever bytes it was given,
never parsing them (`crates/pv-server/migrations/0003_vault_items_rebuild.sql:20`). An iOS-written row
using Swift `JSONEncoder`'s base64 encoding for a `Data`/byte-array field would be perfectly
"server-visible" and still **undecryptable in the web client** — this is L-17, and it is not
hypothetical: `crates/pv-ffi/src/wire.rs`'s own base64-rejection test exists because of it. The amendment
this phase adopted in its place, matching the milestone-v0.5 lesson ("evidence that measures the wrong
thing"): **an item created on iOS is opened and decrypted in the real web client's own crypto
(`pv-wasm`), and an item created in the web client is opened and decrypted on iOS through the real
`pv-ffi` framework** — recipient-side, through each client's own production decode path, never the
writer's own encoder agreeing with itself.

**Items (38-02, Task 3, E-W1):** D1 forward (iOS writes → real `pv-wasm` decrypts, recovering the name
typed independently on both sides) and D2 reverse (`pv-wasm` writes exactly as `web/src/lib/vault/
store.ts`'s `createVaultItem` does → real iOS `VaultStore.refresh()` decrypts) both PASS. Full transcript:
`ios/evidence/38/EW1-CROSS-CLIENT-WIRE.md`. **Still outstanding, not folded into the green result:** the
browser-RENDERED half (an iOS-written item showing correctly in a running web client's UI, console
clean) — `web/node_modules` does not exist in this worktree, so no dev server and no browser were
available; `pv-wasm` is the web client's own crypto, not its rendering.

**Folders (38-09, Task 3, same amendment, F1–F3):** F1 forward, F2 reverse, and F3's falsification
(iOS deliberately mints the folder id AFTER encryption — fails on iOS's own next refresh AND in
`pv-wasm`, both independently, proving the id-before-encryption ordering guard is load-bearing) all
PASS — 5/5 checks. Same browser-rendered-half limitation as items, for the same reason.

### The type-count correction (L-15), restated here because SC2 is where it bites

The ROADMAP's SC2 and `REQUIREMENTS.md`'s UI-03 both say "all five item types". `packages/pv-ui/vault/
types.ts:4`'s `ItemType` union has **six**: `login | card | identity | note | totp | passkey`. This
phase built five in the CREATE surface (`ItemCreationKind`, now in `ItemFormView.swift` after 38-11's
retirement of the dedicated `TypePicker` view — passkeys are provider-minted, never hand-typed) and six
in the DECODE surface (`ItemFields`, `ItemNormalize.swift`) — `scripts/check-item-type-parity.sh`
enforces the render surface stays at six, deliberately narrower than the create surface's five.

### SC3/SC4's own inherited proof-standard note

Neither SC3 nor SC4 is reported as met on a green unit test over a mocked crypto boundary (QA-01).
SC3's evidence is a live comparison against an INDEPENDENT oracle implementation, itself validated
against published test vectors before being trusted, run through the REAL `pv-ffi` framework on the
simulator. SC4's evidence is a four-check structural audit whose every arm was demonstrated able to
fail by mutation — not a claim about randomness quality (CSPRNG statistical soundness is `pv-core`'s
own, pre-existing, out-of-scope-for-this-phase property), only about which code path the generator
actually calls.

### Proof limitations (MP-1 style), recorded without softening

- **Everything in this phase is simulator-only.** No verification of real rendering, real timing, or
  real performance on a physical iPhone screen — the ROADMAP itself pre-declares this for Phase 38.
- **E-S1 (SC5) observes the simulator's own SplashBoard/app-switcher snapshot mechanism.** Timing under
  real memory pressure on a physical device is not covered and cannot be inferred from this.
- **E-C1's clipboard-expiry result (38-07, UI-07) is what THIS simulator's `pasteboardd` daemon does.**
  Device behavior is inferred, not observed. Eager-versus-lazy pasteboard expiry is not observable from
  outside the daemon at all, on any platform, with any tool available here — recorded as permanently
  unknown, not merely untested.
- **If the newer iOS 26 search/dock chrome rendered during this phase's screenshot evidence, every
  search-related screenshot documents THAT appearance, not the iOS 18 appearance a user on the
  deployment floor (IOS-03's actual target) would see.** This phase's own dock work (38-06b) confirms
  iOS 26 rendering was in fact what was captured.
- **The Swift `String` holding a decrypted secret cannot be reliably zeroed once it leaves the UniFFI
  boundary (DR-38-E).** 38-11's lock handler is the compensating control this phase actually built
  (store wipe, nav truncation, sheet dismissal, reveal-set clear, key-handle release) — it is a
  mitigation of the RISK, not a proof the underlying heap bytes are gone. Stated in writing rather than
  silently absorbed, per DR-38-E's own text.
- **The iOS 18 dock fallback (`AvailableFallbackCreateButton`) has never been on a screen.** This
  machine has exactly one simulator runtime installed (`iOS 26.5`); the fallback code path is a
  signature argument (it compiles against the SDK's own `@available` guards), not a picture. Recorded
  as untested, not as working.
- **Lock state 2 (Face ID actively presenting, mid-prompt) is undriven on this simulator.**
  `BiometricUnlockService`'s own probe returns `-1020` (no enrolled biometry in this simulator/OS
  combination) — this state has never been observed, forced-screenshot or otherwise, and is recorded as
  undriven, never as passing.
- **`XCUIElement.hasFocus` never becomes `true` in this harness** (no interactive WindowServer) —
  `LockViewFocusUITests.swift`'s own header already documents this; state 4's focus-move behavior is
  therefore unobservable by this tool, not merely unobserved.

### Unclosed research gaps, named rather than silenced

- **No mapping of the product's visual language onto the phone beyond the approved design's own
  specification.** The design work (specs + `ios/brand/screens*.html`) exists and was largely followed,
  but no systematic pass checked EVERY rendered screen pixel-for-pixel against the artifact; §3a's own
  gap table (below) is the closest this project came, and it was produced by a human looking, not a
  gate.
- **No accessibility work beyond the TOTP countdown's own accessibility VALUES** (used as the
  machine-readable surface for live, ticking UI state) and the AX5 forgot-password-warning height check
  (38-13). VoiceOver labeling, Dynamic Type at extreme sizes, and reduce-motion behavior across the
  vault surface were never systematically audited this phase.
- **No list-performance measurement at realistic item counts with a one-second tick in a visible row.**
  The dock fixture (`PV_UITEST_SEED_DOCK_LIST`) creates ~24 real items across all six types; no
  measurement exists of scroll performance, memory, or TOTP-ring redraw cost at hundreds or thousands of
  items, nor of what a `TimelineView`-driven ticking row costs when many are simultaneously visible.

### §3a's gap table, reconciled row by row against what this phase actually closed

`ios/IOS-SPIKE-LOG.md` §3a ("The visual layer was never verified") named seven open gaps as of
2026-08-17, owned by 38-11's roll-up. Closed here:

| Gap (§3a) | Closed by | Evidence |
|---|---|---|
| ＋ control: detached capsule → 3×3 grid, becomes ✕ | 38-06b (`50cb594`) | `ios/evidence/38/38-06b-panel-open*.png`; `VaultDockEvidenceUITests`/`VaultDockUITests` |
| Search: dock accessory pill vs. inline bar | 38-06b (`50cb594`, `d78da22`) | `ios/evidence/38/38-06b-at-rest*.png` (magnifier-collapsed nav bar, one search affordance in content) |
| Section index `L C 2 P I N` | 38-06 (`AvailableSectionIndexLabel`/`AvailableListSectionIndexVisibility`, iOS 26+ guarded) | `ItemListView.swift`'s `VaultSectionKind.indexLabel`; **iOS 26+ only, below-floor behavior is "omitted", not "broken"** — recorded, not closed, on iOS 18 |
| Lock title/glyph/primary (state 1) | 38-13 | `docs/superpowers/specs/2026-08-16-ios-onboarding-and-auth-design.md`-driven `LockView.swift` rewrite, `ios/evidence/38/38-13-*` |
| Lock state 3 (muted, biometry unavailable) | pre-existing before 38-11 (38-13's own `unlockBiometryUnavailableSlot`/`unlockNoPasscodeSlot`) | `LockView.swift`'s `statusSlot`, the `availability`-unavailable branch |
| **Lock states 5/8, visually distinct** | **38-11 (addendum A3, this plan)** | `LockView.swift`'s `isOffline` branch, `.muted` tone, distinct from state 5's `.error`; `ios/evidence/38/lock-states-v4/38-11-lock-state-8-offline.png` |
| Lock states 6/7 (throttled/no-passcode) | pre-existing before 38-11 (`throttledUntil`/`requiresDevicePasscode`, both real production properties, not new this plan) | `LockView.swift`'s `throttleRemaining`/`availability?.requiresDevicePasscode` branches |

**Not closed, named openly rather than silently dropped:**
- iOS 18 dock fallback — untested (no iOS 18 runtime on this machine), see proof limitations above.
- VoiceOver on ＋ announcing the search role despite its "Create item" label — explicitly handed to
  Phase 42's audit register by 38-06's own header note; not touched this plan.
- `.searchable(isPresented:)` death after ＋ use — already documented in 38-06b; referenced, not
  re-fixed (no acceptance criterion in this plan required it).
- `family_wide_sharing.rs`'s pre-existing test-isolation flake (`deferred-items.md`) — stays deferred;
  `crates/pv-server` is untouchable from this worktree.
- E-W1's browser-rendered half (item and folder directions both) — still outstanding, `web/node_modules`
  absent from this worktree.
## 7. Phase 38 — whole-phase gate (Task 3, plan 38-11, 2026-08-18)

Every gate command run in this pass, with its real output recorded below rather than a summary of it,
and its exit status obtained without ever reading a status off the end of a pipe (the shell here is
zsh; `$pipestatus`, never `PIPESTATUS` — L-3).

### Gate commands, in the order Task 3 names them

1. **`cargo test --workspace`** — 74+1+24+0+7+4+1+3+59+2+9+9+23+2+5+7+12 = 232 passed across the
   workspace's crates, **one known failure**:
   `family_wide_reseal_add_member_body_is_shape_identical_to_an_ordinary_share`
   (`pv-server`'s `family_wide_sharing.rs`) — the pre-existing test-isolation flake `deferred-items.md`
   already documents from plan 38-04 (fails every time under the full workspace suite's concurrent test
   binaries, passes 5/5 run alone; `git diff --stat -- crates/pv-server` is empty for this plan's entire
   execution, confirming it). Not fixed here — `crates/pv-server` is untouchable from this worktree.
2. **The binding crate's tests, including feature-gated ones** — `cargo test -p pv-ffi --all-features`
   (both `ffi06-probe` and `kdf-probe` together, per L-11's combined-feature discipline): **35 passed,
   0 failed** (28 unit + 7 `wire_shape.rs` integration tests).
3. **Generator tests under whichever feature arm was chosen** — the generator module is UNCONDITIONAL
   in `pv-core` (DR-38-A amended, L-16's own recorded transition), so `cargo test --workspace` (item 1
   above) already covers `generator::` with no separate command.
4. **The full application test suite on the simulator** — `xcodebuild test-without-building
   -parallel-testing-enabled NO` (both `PasskeyVaultTests` and `PasskeyVaultUITests`, the whole
   target, no `-only-testing` scoping): **242 passed / 262 total, 20 failed.** Every failure
   individually investigated, not assumed; full breakdown and root-causing in `deferred-items.md`
   ("38-11 Task 3: pre-existing, unrelated UI test failures found by the whole-phase gate"):
   - **6 failures are BY DESIGN**: `VaultWireInteropTests`/`CrossClientInteropTests`/
     `FolderWireInteropTests` each fail with a self-authored message naming the exact
     `PV_INTEROP_*` env var `scripts/verify-ios-web-*-interop.mjs` sets before driving them —
     "This test FAILS on a missing env var; it never silently skips." SC2's own evidence (§6 above)
     comes from running these THROUGH that harness, never from a bare sweep.
   - **2 failures are the already-documented, permanent `hasFocus` limitation** (`LockViewFocusUITests`,
     both methods) — recorded as unobservable in §6's proof-limitations list, per design-conformance's
     own instruction for this exact case.
   - **~12 failures show the L-20 cross-test session/state-pollution shape** across files this plan did
     not touch (`SnapshotEvidenceUITests`, `GeneratorSheetScreenshotUITests`, `ItemListSearchUITests`,
     `OnboardingUITests` ×4, `OnboardingServerStepUITests` ×2, `VaultDockEvidenceUITests`,
     `VaultDockUITests` ×1) — `VaultDockUITests` and `ItemFormAndFolderUITests` were each independently
     confirmed 100% green when run ALONE (isolated re-runs, this plan), which is the L-20 signature:
     clean alone, contaminated when many UI tests share one simulator's Keychain/`UserDefaults`/
     live-session across one long sweep. **This plan's OWN evidence is scoped, isolated re-runs**
     (`LockTeardownTests`: 15/15; `LockTeardownUITests`: 2/2), never this contaminated mega-sweep.
   - **1 failure (`TotpCountdownUITests`) is genuinely pre-existing and unrelated**, confirmed by
     re-running it ALONE (still fails, at a step this plan's own edit to that file never reaches) —
     not diagnosed further; recorded in `deferred-items.md` for whichever plan next touches
     `AuthView.swift`'s register flow.
5. **`scripts/check-item-type-parity.sh`** — PASS: 6 members, identical on both sides.
6. **`node scripts/check-wordlist-parity.mjs`** — PASS: 7,776 words, digest
   `abae49761b88f3f1ba31ef944bea1f61b795a3cd7e1cfb7d276ed45bf77967ba`.
7. **`bash scripts/audit-generator-uses-ffi.sh`** — PASS: all five checks (E-G1's four plus the
   excluded-test-dirs check) hold, negative results confirmed non-vacuous.
8. **`python3 scripts/totp-oracle.py --selftest`** — PASS: 6/6 RFC 6238 Appendix B vectors.
9. **`git log --oneline $(git merge-base main ios/spike)..ios/spike -- .planning/`** — **empty**, as
   required (QA-05). The UNSCOPED whole-history form
   (`git log --oneline -- .planning/`, 796 commits; `--all` form, 814) is **not empty on this branch**
   — `ios/spike` inherits `.planning/` history from before this worktree's own commits began, so that
   form is not, and never was, the gate; the merge-base-scoped form is.

**Two gates run outside Task 3's own literal command, as part of this plan's own addendum A6:**
`scripts/audit-ios-colour-tokens.sh` — PASS (all three checks); `python3 scripts/gen-ios-colorsets.py
--check` — PASS (22 colorsets match `tokens.json`).

### The five inherited proof-standard requirements (REQUIREMENTS.md's QA section), answered

- **QA-01 (no crypto/real-time/real-server claim resting on a green unit test)**: SC3 (TOTP) rests on a
  live comparison against an independently-validated oracle through the real `pv-ffi` framework, not a
  mocked unit test — `ios/IOS-SPIKE-LOG.md` §1f's E-T1. SC2 (wire format) rests on recipient-side
  decrypts through each client's own REAL production crypto (`pv-wasm`/`pv-ffi`), never a mocked
  boundary — §6 above. This plan's own `LockTeardownTests.swift` uses a fake `URLProtocol` transport
  ONLY for state-teardown assertions (never a crypto/wire-format claim); the weak-reference key-release
  test uses a REAL `FfiUserKey.generate()`.
- **QA-02 (every new guard shown red before trusted)**: this plan's own four RED-before-green
  demonstrations (nav truncation, sheet dismissal, reveal-set clear, key-handle release), each run live
  and reverted. Phase-wide: ~38 falsification/RED-before-green demonstrations across the twelve plans
  that had guards to falsify (38-01/38-03 are decision-record/data-model plans with none) — a
  per-plan tally, not a re-verification of every individual transcript: 38-02: 1, 38-03: 1, 38-04: 3,
  38-05: 1, 38-06: 4, 38-07: 4, 38-08: 4, 38-09: 5, 38-10: 3, 38-11: 4, 38-12: 5, 38-13: 3.
- **QA-03 (positive assertions on the receiving side, never absence alone)**: `LockTeardownUITests
  .swift` asserts the lock surface's OWN element present after a lock, and the list root's OWN element
  present after unlocking — the detail screen's absence is asserted ALONGSIDE each positive assertion,
  never alone. SC2's item/folder interop assertions run on the RECEIVING client's own decrypt, not the
  writer's encoder agreeing with itself.
- **QA-04 (every verification command shown able to fail)**: this plan's own weak-reference and
  reveal-set/sheet/nav tests were each demonstrated failing by a live, reverted mutation (four
  transcripts). The whole-phase gate's OWN `cargo test --workspace` step is demonstrated able to fail
  live, right here — the `family_wide_sharing.rs` flake IS a real, currently-failing assertion.
- **QA-05 (`.planning/` never committed from this worktree)**: verified above (item 9), empty for the
  correct scope. No commit in this plan's own history touches `.planning/` (`git log --oneline
  ad5e336..HEAD -- .planning/` — n/a until this commit lands; verified by inspection of every commit's
  own file list during authoring).

**PHASE-GATE:** not a bare `PASS` — the plan's own literal `<verify>` chain (`set -e; cargo test
--workspace; ...; echo PHASE-GATE-OK`) would abort at step 1 on the known `family_wide_sharing.rs`
flake, which is itself the exact "a command that cannot fail is a defect" pattern this project's own
discipline exists to catch, inverted: a chain that CANNOT SUCCEED on a fully green codebase because it
inherits an out-of-scope, pre-existing failure is not the right gate shape either. Each command was run
separately instead (per Task 3's own action text: "record the output of each command, not a summary of
it"), and this section is that record. Every command that CAN legitimately gate this plan's own work
does: items 2, 3, 5–9 all PASS cleanly; item 1's one failure and item 4's twenty failures are each
individually accounted for above, none traced to this plan's own changes.


## 8. Phase 38 — human-verify backlog (2026-08-18, orchestrator disposition)

`38-VERIFICATION.md` closed 12/13 with `human_needed`; the autonomous run continued per Bartek's
standing brief ("choose continuation, record what remains"). Items still owed to a human:

1. **Browser-RENDERED half of E-W1** — an iOS-written item viewed in the *running* web client
   (`npm i` in `web/`, dev server), row renders, console clean. pv-wasm decrypt was re-proven; the
   rendering half needs `web/node_modules`, absent in this worktree.
2. **Per-type EDIT and DELETE recipient-side** — edit+delete one card, identity and TOTP on the
   phone, confirm each recipient-side. The interop proof covers notes both directions + a live
   stale-revision conflict; the wire path is type-agnostic and field names diff clean against
   `packages/pv-ui/vault/types.ts`, so residual risk is low but not zero.
3. **TOTP boundary-transition live UI sampling** — the committed
   `TotpCountdownUITests.testLiveCodeAndCountdownThenErrorState` hits a runner-launch failure
   (`ipc/mig server died`) in this environment; crypto is triple-proven (oracle 6/6 RFC vectors,
   pv-ffi vectors, fresh-per-tick FFI), and `CodesRowDesignConformanceUITests` now exercises the
   live code+ring — but a sampled period-wrap remains unwitnessed by a committed runnable test.
4. **Full visual pass** — every screen against `ios/brand/screens*.html` + the artifacts. Partially
   discharged live by Bartek on 2026-08-18 (Codes rows, ＋ panel, icons — all fixed to match); the
   sweep of the remaining screens is still a taste call for a human.
5. **`AutoLockPolicy` is orphaned** (verifier finding): tested storage whitelist, zero consumers, so
   no auto-lock ships. Named owner in-code is Phase 39; the truer home is Phase 41's ACC-06/ACC-07.
   MUST be claimed by one of them or it will be lost.

## 8a. Phase 39, plan 39-06 — human-verify backlog (2026-08-19, orchestrator disposition)

Plan 39-06's Task 4 (SYNC-04's copy-literalism check) is `checkpoint:human-verify` with
`gate="blocking"`. Per the standing brief for this run, every automatable arm was completed and
this residue is recorded rather than blocking:

1. **The freshness copy's literal reading, by a skeptical user whose AutoFill just came up
   short** — needs a human's judgement call, not a mechanical check. Everything a human needs to
   make that call is already produced and referenced from `ios/evidence/39/06-freshness-host.md`:
   - The exact strings, verbatim: `"Not synced yet"` (never-synced), `"Last synced <relative
     phrase>"` (recent, same calendar day), `"Last synced <absolute date/time>"` (previous day) —
     `ios/PasskeyVault/PvShared/SyncFreshness.swift`.
   - Two live screenshots: `ios/evidence/39/39-06-freshness-recent.png` ("Last synced 4 seconds
     ago") and `ios/evidence/39/39-06-freshness-stale.png` ("Last synced 33 seconds ago" plus a
     visible red error banner disclosing the failed pull — "Couldn't refresh the vault... Could
     not connect to the server").
   - This app builds NO separate connection indicator (`SyncStatusView.swift`'s own header) —
     there is nothing for a human to check "is the indicator subordinate to the timestamp"
     against; the last-synced text is the only sync-related surface on screen.
2. **What a human still needs to confirm, specifically**: that none of the three strings above,
   read literally, could lead a user to believe AutoFill (a SEPARATE process, which never syncs
   in this milestone and only ever reads what the host last wrote) is current. This is the SAME
   standard as FSH-02's caveat ("automatycznie" ≠ "natychmiast"), applied to a different surface.
   Nothing here is expected to fail that reading — the copy was written directly against
   `39-RESEARCH.md`'s "Copy requirements" section — but the plan's own `must_haves.truths` entry
   for this is explicitly `verification: backstop`, so SYNC-04 is not claimed fully closed by this
   plan's automated evidence alone.

**Phase 39 closure additions (2026-08-19, orchestrator):**

- **SC2 on real hardware after a reboot** — the simulator enforces no data protection, so the cache
  file's protection class is a declaration, not a proof. First device session should force-quit the
  host, reboot, and drive the extension cold (same choreography as `scripts/ios-cold-read-proof.sh`).
- **Optional**: an independent live re-run of `audit-ios-cache-ciphertext.sh`'s content checks (its
  falsification transcripts in `ios/evidence/39/05-gates.md` hold on inspection; both fix passes
  declined a live re-run on the same reasoning).
- **`AutoLockPolicy` ROUTED TO PHASE 41 (ACC-06/07).** Still zero production consumers after 39
  (only its own tests reference it). Phase 41's lazy-lock/idle work is its real home — the 41
  executor MUST wire it or explicitly record why not. Do not let a tested-but-unenforced policy ship.
