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
| Credential provider extension | **CORRECTED 2026-08-21 (Phase 42, plan 42-07 — the "no fill logic yet" clause below was true when Phase 36 wrote it and false as of Phase 41's own delivered code; see `ios/QA-AUDIT-v1.0.md`'s "Durable-log correction" section for the found-state and citation).** Real skeleton built Phase 36 (Plans 36-01..36-04): entitlement embedding, App Group + Keychain sharing, SC1's three layers, all proven live from inside the real `.appex` process. FILL-06 measured for real: production Argon2id (64 MiB/t=3/p=4) peaks at ~85 MB `phys_footprint` across 10 runs. **Credential-list/fill logic DELIVERED and independently re-verified live (Phase 41, Plans 41-01..41-08, `41-VERIFICATION.md` HEAD `d0c3916`, after 2 review-fix iterations / 33 `fix(41):` commits):** a real password fills into a real Safari form field, cold (host force-quit, `simctl shutdown`/`boot`, server unreachable), with cross-process lock correctness proven receiver-side (host unlock → extension does not re-prompt; expiry in one process observed via the extension's own next access; extension-only activity keeps the host's session alive, measured against real elapsed wall-clock time). Two disclosed residuals: `.domain`-typed identities' fill-time gate cannot see the LIVE PAGE (only the item's own stored data — WINDOWS #17); the QuickType receiver-side screenshot proof (SC1) and the third-party-domain proof (SC5) were not RE-driven at Phase 41's own re-verification HEAD, only their mechanisms were. |
| Family sharing | **Delivered and independently re-verified (Phase 40, Plans 40-01..40-10, `40-VERIFICATION.md`, a re-verification after a gap-closure cycle `c9fc54e..9ca0141`, 6/6 truths verified).** Shared-by-me vs shared-to-me distinguishable on the list screen (real two-account, real shared item); an invite authored on iOS redeemed end-to-end by an independently-driven real `pv-wasm` web client, roster read receiver-side; hidden-password's interface-level-protection copy plus real direct-FFI key-holder recovery (E-F3); invite-time-wrap and lazy-reseal proven as two structurally separate mechanisms through the PRODUCTION `ResealTrigger`/`ResealService` types (E-F6). The identity/Collection-Key wire encoding (DR-40-A) was designed explicitly against the `WrappedKey` base64-vs-array hazard (see `ios/QA-AUDIT-v1.0.md`'s wire-encoding hazard subsection) and proven two-direction cross-client (E-W2) before any dependent Swift code was written. **Known residual, correctly left open (not fixed — needs a `pv-server` route change, out of this milestone's scope):** the member-removal batch's re-key set is scoped differently from the server's own completeness guard; masked today by a server-side singleton-family constraint. |
| Server sync / UI | **Verified live (Phase 39, Plans 39-01..39-07).** REST pull + two live WebSocket pushes with plaintext compared byte for byte (SYNC-01); whole-snapshot cache write, SYNC-03's ciphertext-only gate proven red-then-green against a real leaking build; freshness timestamp real and honest under a forced-failure pull, unchanged when the server cannot answer (SYNC-04); and SYNC-02's own claim — a real credential-provider extension process read the host's persisted cache with the host provably terminated (`simctl terminate`, absence confirmed by two independent `launchctl list` captures), the bytes SHA-256-identical to what the host wrote, both mandatory negative controls (a sharing identifier the extension does not declare; the cache file deleted) firing as required. **Assumed / not verified:** background wake (SYNC-05 ships without APNs by design, not by omission); a cold read after a genuine device reboot (only a cold *simulator extension invocation* was produced — see PROOF-LIMITATION-4 below); decrypt inside the extension (delivered by Phase 41, see the row above); anything beyond the personal vault (delivered by Phase 40, see the row above). |

**Milestone.** The spike graduated into milestone **v1.0 iOS — Vault w kieszeni** on 2026-08-11.
Scope agreed with Bartek: full app UI + **password** AutoFill provider + biometric (Face ID / Touch ID)
unlock + family management. **The passkey-provider question below is now DECIDED, not conditional —
see `## 1m. OPT-01` for the full record (2026-08-21):** GO for a third-party passkey provider
(OPT-03, NordPass-parity scope), vault-PRF-unlock (OPT-02) REJECTED on product grounds (Face ID
unlock already covers it), and PRF served through the provider (OPT-04) DEFERRED with reason. The
original "ships only if cheap, deferred is an acceptable outcome" framing is superseded by that
record for the parts it resolves.

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
  UniFFI code. Debug only; do not try to work around it. **UPDATE, Phase 44 (`DR-44-A` addendum,
  `ios/IOS-SPIKE-LOG.md` §1o):** re-probed twice at the new iOS 26.2 deployment floor, both runs
  `** BUILD SUCCEEDED **`, zero crash markers — not yet confirmed durable across a future session,
  but no longer demonstrated-broken as of this plan. Read the addendum before treating this bullet
  as still current.
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

### Plan 40-03 closing note — `sharing.rs`'s crypto surface is now complete, two durable facts for later plans

Plan 40-03 finished the collection-scoped + direct-share crypto surface DR-40-A anticipated:
`rewrap_item_key_for_collection`, `seal_item_key_for_recipient`, `decrypt_item_with_shared_key` are
now in `crates/pv-ffi/src/sharing.rs` alongside 40-02's `encrypt_item_for_collection`/
`decrypt_item_for_collection` — every function `40-RESEARCH.md`'s "`pv-ffi` additions this phase
requires" names for items now exists, callable from Swift. No new decision record was needed; two
facts surfaced worth recording for whichever later plan (40-05 onward) next touches `FfiWrappedKey`
or writes a falsification transcript:

- **`FfiWrappedKey.nonce`/`.ciphertext` are UniFFI-native `Data`, not `[UInt8]`**, contrary to what the
  `pv-wasm`/`pv-core` precedent might suggest by analogy. Building a hand-rolled `WrappedKey`-shaped
  JSON string from a `FfiWrappedKey` in Swift (as plan 40-03's `seal_item_key_for_recipient` test does,
  `enc_key_json: String`) must map `Data` byte-by-byte into `[Int]` BEFORE `JSONSerialization` — handing
  the `Data` itself to `JSONEncoder`/`JSONSerialization` produces base64, the exact DR-40-A divergence
  this whole record exists to prevent. `Data.map { Int($0) }` is the safe path; `JSONEncoder().encode(_:)`
  on a `Codable` wrapping the `Data` field directly is not.
- **A falsification mutation must hardcode the SPECIFIC value the target negative test's own fixture
  used, not an arbitrary wrong one.** Hardcoding an arbitrary/generic wrong AAD-component value still
  makes `decrypt` fail (for the wrong reason) and the negative test's `assert(is_err())` stays green —
  no RED is observed, and the falsification proves nothing. The mutation must make decrypt SUCCEED when
  it should not, by hardcoding the value that happens to be correct for that one test's own encrypted
  fixture — that is what turns the negative test's own assertion RED.

**Evidence:** `40-03-SUMMARY.md`'s Falsification Transcripts and Decisions Made sections;
`crates/pv-ffi/src/sharing.rs` (`rewrap_item_key_for_collection`, `seal_item_key_for_recipient`,
`decrypt_item_with_shared_key`); `ios/PasskeyVault/build/swift-bindings/pv_ffi.swift:1681-1690`
(`FfiWrappedKey`'s generated `Data` fields).

---

## 1i. Phase 41 decision records — DR-41-A, DR-41-C, 2026-08-20

Written before any Phase-41 fill code, on the `IOS-06`/`ACC-03`/`DR-40-A` precedent this project
already follows (decision-record-before-dependent-code). Owed per `41-RESEARCH.md` §"Decision records
this phase owns" and §"Primary recommendation for the planner". Answered at Plan `41-02`'s Task 1
`checkpoint:decision` (gate `blocking`), resolved by the orchestrator under Bartek's standing
full-autonomy brief for architecture-level calls — presentation and evidence transcript in
`ios/evidence/41/dr-41-a-options.md`.

### DR-41-A — The silent-fill artifact: **DECIDED — Option B, a second, non-biometric session artifact ("Secret C")**

**Decision: a second, non-biometric Keychain item** (`kSecClassGenericPassword`,
`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, **no** `SecAccessControl`, shared access group
`$(AppIdentifierPrefix)cloud.blonie.PasskeyVault`, same group ACC-03's Secret A already uses), written
by the host app on every successful biometric or master-password unlock, carrying the exported User Key
session bytes (`export_user_key_for_session`, the load-bearing mechanism IOS-06's own amendment already
made permanent), deleted by whichever process observes expiry (ACC-06). Named **Secret C** in this
record to keep it distinct from ACC-03's Secret A (the `.biometryCurrentSet` User Key envelope,
unchanged) and Secret B (the session token, GAP 3).

**Rejected: Option A, no second artifact.** Under Option A the extension would always read Secret A
directly, so every QuickType tap becomes a Face ID sheet (F1, `41-RESEARCH.md`) and ROADMAP SC3 would
have to be reworded to a weaker claim — "one biometric prompt, never a master-password prompt" — rather
than met. Rejected on the merit that the phase's own `Goal` line (`ROADMAP.md` §"Phase 41") names the
Bitwarden "Face ID mówi odblokowane, autofill i tak pyta o hasło główne" bug class as the defect this
phase exists to avoid, and SC3's literal wording — *"odblokowanie w host apce, potem wywołanie AutoFilla
NIE pyta ponownie o hasło"* — is Option B by construction: no rewording of SC3 that keeps Option A can
make that sentence true, because a `.biometryCurrentSet`-only artifact cannot be read without UI from a
second process (F1, composed from `ASCredentialProviderViewController.h:100-134`'s UI prohibition and
37-RESEARCH's confirmed fact that an `LAContext` cannot cross a process boundary). Option A is not wrong,
it is simply the choice that redefines the goal around the defect instead of closing it, and this record
chooses to close it.

**Rejected, explicitly, as structurally impossible: Option C, a long-lived pre-authenticated `LAContext`
shared across the host app and extension processes.** This is not a cost/benefit rejection — it cannot
be built. An `LAContext` is process-local; it cannot cross a process boundary at all [37-RESEARCH,
OBSERVED]. Even confined to one process, keeping a pre-authenticated context alive indefinitely across
calls is the exact anti-pattern Apple's own `SecItem.h`/`LAContext` header prose warns against. Recorded
here, by name, so it does not return as a proposal in a later phase.

**Evidence that framed the decision — E41-1, literal `OSStatus` integers**
(`ios/evidence/41/e41-1-silent-read.log`): `stage=silent status=0`, `stage=nocontext status=0`,
`stage=negative-control status=-34018`, host-written and extension-read digests byte-for-byte equal
(`00e988677eecf94c0bb9233371c7c0d6f4db8ebdcdecb7c5ebaa666f17249227`) — **PASS-silent**. Per
`ios/evidence/41/branch-state.md` §"What a PASS in this phase can and cannot mean" and Phase 37's own E2
result (`ios/IOS-SPIKE-LOG.md:1962-1979`), this simulator releases `.biometryCurrentSet`-gated data
unconditionally regardless of `LAContext`, so E41-1's PASS-silent is a statement about our code's intent
(does it correctly ask the OS before reading?), not about a real device's Secure Enclave behaviour. F1's
structural claim — that Secret A alone can never be read silently from a second process **on real
hardware** — stands un-falsified by this simulator result; it rests on API mechanics (an `LAContext`'s
process-locality, the header's UI prohibition), not on this simulator's ACL enforcement, which is why
Secret C is being added rather than relying on Secret A to somehow answer differently on a device.

**The exposure, stated without softening, exactly as the checkpoint required.** For the duration of the
session window, a second process — the AutoFill extension — can read the User Key with **no** biometric
challenge, through Secret C. This is the exact posture `ACC-04` (biometry gates key release, always) was
written to prevent. It is not eliminated by this decision; it is **scoped to a bounded window instead of
forbidden outright**. `ACC-04`'s guarantee is amended for Secret C only — Secret A (the Phase-37
envelope) keeps its `.biometryCurrentSet` ACL completely unchanged; nothing about its write path,
accessibility class, or biometric flag is touched here. `ACC-06`'s lazy expiry check and its explicit
`SecItemDelete` on expiry are hereby **load-bearing security controls**, not housekeeping — they are the
only thing bounding Secret C's exposure once it exists, and Plan `41-07` must prove them **red-first** (a
mutation that skips the delete, shown to fail the guard, before the guard is trusted). This is,
structurally, what Bitwarden's own "biometric unlock bypasses the limit" PSA describes — the same
tradeoff, now made explicitly and bounded rather than discovered as an unrecorded behaviour.

**Evidence:** `ios/evidence/41/e41-1-silent-read.log`; `ios/evidence/41/branch-state.md` §"B4", §"What a
PASS in this phase can and cannot mean"; `ios/evidence/41/dr-41-a-options.md` (full presentation +
provenance transcript); `ios/IOS-SPIKE-LOG.md:353-409` (ACC-03, Secret A/Secret B, the precedent for an
asymmetric accessibility class stated as a security decision, not a shortcut); `41-RESEARCH.md` §F1,
§"Decision records this phase owns" → DR-41-A, §"Wording the phase record must use".

### DR-41-C — Lock marker: storage, clock, extension write permission, absolute session ceiling: **DECIDED**

**Storage: the App Group container** (`group.cloud.blonie.PasskeyVault`), as
`UserDefaults(suiteName:)` under key `unlockedAtMs`-equivalent (a small struct, not a bare timestamp —
see clock below) — following DR-1's hybrid model (§1, `ios/IOS-SPIKE-LOG.md:243-290`), which this
phase's own branch-state row B1 confirms is committed reality, not a proposal
(`ios/evidence/41/branch-state.md` §"B1"). `41-RESEARCH.md`'s own Branch Matrix names this the
comparatively-easy outcome under Hybrid: "the `unlockedAtMs` marker can live in
`UserDefaults(suiteName:)` or a group file; both processes read/write it directly."

**Rejected: a Keychain item colocated with Secret C.** Both processes must read this marker on **every**
entry point before any other read (ACC-06's lazy check, inherited premise), including the hot QuickType
fill path where latency is directly user-visible — a `SecItem*` round trip on every fill is real,
avoidable cost for a value that itself protects nothing at rest: the marker is a timestamp, not key
material, and an attacker who can already read the App Group container (the same access-group boundary
Keychain access-group scoping also enforces, both proven live in Phase 36's E2/E3) learns nothing more
from it than "the user unlocked at approximately time T" — no bytes that decrypt anything. Colocating a
frequently-written, low-sensitivity value with Secret C's own storage class would add write traffic to a
security-critical item's Keychain entry for no compensating security gain, since the Keychain's own lack
of an expiry attribute (37-RESEARCH, CONFIRMED — `kSecAttrCreationDate`/`kSecAttrModificationDate` are
read-only) means Secret C's own storage mechanism offers no expiry primitive the marker could inherit by
being colocated.

**Clock: a boot-session-identifier + monotonic-uptime pair**, not wall-clock `Date()` alone and not
boot-relative uptime alone. The marker records `(bootSessionId, systemUptimeAtUnlock)` —
`ProcessInfo.processInfo.systemUptime` for the monotonic half, paired with the Darwin
`kern.bootsessionuuid` sysctl value (a UUID that changes every boot) as the comparability key. A read
compares `bootSessionId` for equality first: a mismatch means the device has rebooted since the marker
was written, treated as expired (a reboot ending the session is judged a defensible default, not a
defect — 41-RESEARCH's own reasoning). If `bootSessionId` matches, the elapsed
`systemUptime - systemUptimeAtUnlock` is compared against the idle window and against the 12-hour
absolute ceiling below.

- **Rejected: `Date()` alone.** User-rewindable — moving the system clock backward is a direct
  session-extension attack surface against both ACC-06's expiry and the 12-hour absolute ceiling this
  record adds below. This is precisely the attack DR-41-C exists to close, not merely a theoretical
  concern (`41-RESEARCH.md` A8, E41-7's own mandated backward-jump leg).
- **Rejected: boot-relative uptime alone, with no boot identifier.** `systemUptime` resets near zero on
  every boot, so without a per-boot identifier a stored value from a **previous** boot cannot be
  distinguished from a small elapsed value in the **current** boot — an ambiguous state depending on
  comparison direction, not a clean "expired," which is worse than either alternative on its own.

**This reasoning is [ASSUMED]/UNVERIFIED** — `kern.bootsessionuuid`'s exact accessibility and stability
from an app-extension sandbox on this iOS/toolchain combination has not been measured. It is a decision
about which primitive to build against, not a proof that the primitive behaves as expected here. Plan
`41-07`'s clock legs (the forward-jump and backward-jump `Date()` manipulation runs, plus a real
`simctl shutdown`+`boot` cycle observing whether `bootSessionId` actually changes) are the falsifier; if
`kern.bootsessionuuid` is unreachable or unstable inside the `.appex` sandbox, this record must be
amended in place, not quietly worked around.

**Extension write permission: YES.** ACC-07 requires it — an AutoFill-only user (never opening the host
app) would otherwise be logged out mid-use even while actively using the product as designed. The cost,
named plainly per the checkpoint context: a process the user never looks at can extend the *idle* window
indefinitely without the lock screen ever appearing.

**Absolute session ceiling: YES — 12 hours from the last real unlock in the host app.** The session ends
12 hours after the last successful biometric or master-password unlock event **in the host app**,
regardless of any AutoFill activity in the interim. AutoFill traffic (ACC-07's marker refresh) can extend
the *idle* window but can never push the session past this 12-hour ceiling measured from the last real
unlock — the ceiling is tracked as a separate, host-app-only-writable field the extension's own refresh
never touches. This bounds Secret C's non-biometric exposure window (DR-41-A) even under continuous,
legitimate AutoFill-only use, which is exactly the case DR-41-A's cost statement names.

**Evidence:** `ios/IOS-SPIKE-LOG.md:243-290` (DR-1, hybrid model); `ios/evidence/41/branch-state.md`
§"B1"; `ios/IOS-SPIKE-LOG.md:391-408` (ACC-03 Secret B, the precedent for `SecItem.h`'s confirmed
lack of an expiry attribute); `ios/evidence/41/dr-41-a-options.md` (the ceiling decision's
provenance); `41-RESEARCH.md` §"ACC-06 inherited premise" and §"Decision records this phase owns" →
DR-41-C.

**DR-41-A/DR-41-C now IMPLEMENTED and PROVEN LIVE, not merely decided (Plan 41-07, 2026-08-20).**
Both records above described the DESIGN; `SessionLifecycle.swift` is the composed implementation
(the lazy check, the activity refresh, the explicit lock), wired into all three extension entry
points and the host's own unlock/foreground paths, with `SessionKeyStore.store`/`SessionLifecycle
.recordHostUnlock()` finally called from the REAL unlock flow (`ContentView.handleUnlocked`) —
`SessionKeyStore.swift`'s own header (Plan 41-03) had explicitly deferred that wiring "to a later
plan." E41-4 proves the silent, no-ceremony fill and the check's ability to refuse, live, in both
directions; E41-7 proves ACC-07's cross-process keep-alive, ACC-06's real `SecItemDelete` (with a
red-first transcript) and a fresh unlock recreating a readable entry, and the backward-clock model
DR-41-C's own clock choice was designed to have no attack surface against. See
`.planning/phases/41-.../41-07-SUMMARY.md` for the full account, including the honest reconciliation
of the "delete query byte-identical to Phase 37's write query" acceptance criterion against this
record's own artifact choice (Secret C, never Secret A).

**AMENDMENT (CR-04 / WR-07, 41-REVIEW.md, 2026-08-20): the monotonic clock changed; this record's
own "Clock" paragraph above did not, until now.** `ProcessInfo.processInfo.systemUptime` is
documented by Apple as "the amount of time the system has been awake since the last time it was
restarted" — backed by `mach_absolute_time()`, which does **not** accrue while the device sleeps.
Both the idle-window comparison and the 12-hour absolute-ceiling comparison this record describes
therefore under-counted real elapsed time by however long the device slept between marker-write and
marker-read — the fail-**open** direction, on the artifact that lets a second process read the User
Key with no biometric challenge. CR-04 (iteration 1 fix pass) replaced the monotonic half with
`LockMarker.monotonicNow()` (`clock_gettime_nsec_np(CLOCK_MONOTONIC)`, backed by
`mach_continuous_time()` on Darwin, documented as incrementing "including when the system is
asleep" — still monotonic and NOT user-rewindable, so this record's own rewound-clock rejection two
paragraphs up is unaffected). The marker's persisted-defaults key was bumped to
`cloud.blonie.PasskeyVault.lockMarker.v2` in the same fix so a marker written by a pre-CR-04 build
is treated as unreadable (fails closed to "expired") rather than silently compared across two
different clock domains, and the field itself was renamed `systemUptimeAtUnlock` ->
`monotonicAtUnlock` (WR-07, iteration 2) so the artifact's own name stops asserting the rejected
clock. Wherever this record (above) reads `ProcessInfo.processInfo.systemUptime` or
`systemUptimeAtUnlock`, substitute `LockMarker.monotonicNow()` / `monotonicAtUnlock` — the design
intent (a boot-session-identifier + monotonic-uptime pair, never wall-clock `Date()` alone) is
unchanged; only the specific monotonic primitive and the field's name are. This determination is
DOCUMENTED against Apple's xnu header documentation for the `CLOCK_MONOTONIC` family, not
empirically re-verified against a real device-sleep cycle in either fix pass (doing so safely
requires suspending the host Mac mid-session, which neither pass automated unattended) — carried
forward as a `human_verification_required` item on both REVIEW.md iterations.

**AMENDMENT (`.planning/debug/faceid-relock-loop-bootsession.md`, 2026-08-21): this record's own
requested falsifier arrived, live, on Bartek's real iPhone 16 (iOS 27) — `kern.bootsessionuuid` is
UNREADABLE from this app's sandboxed process, on every call, unconditionally, regardless of
entitlements.** The paragraph above already flagged this `[ASSUMED]`/UNVERIFIED and asked for a
real-device falsifier "if `kern.bootsessionuuid` is unreachable or unstable inside the `.appex`
sandbox, this record must be amended in place, not quietly worked around" — this is that amendment,
prompted by a production bug report rather than a planned verification task. L-35's own simulator
measurement (below) was correct as far as it went; it simply could never have caught this, because
the simulator's own `kern.bootsessionuuid` resolves to the HOST MAC's boot session, not a
per-app-sandbox value, so the simulator was never capable of exercising "the sysctl fails" at all.

**Consequence, and the fix:** before this amendment, `SessionLifecycle.recordHostUnlock()` papered
over a `nil` `currentBootSessionId()` with a fake `"unknown-boot-session"` placeholder string on
write, and `checkAndExpireIfNeeded` treated a `nil` `currentBootSessionId()` on READ as a genuine,
evaluated boot-identity refusal (falling into the same branch as an actual mismatch) — on real
hardware, where the sysctl fails on EVERY call, this made every foreground check read `.expired`
unconditionally, regardless of whether the session was otherwise perfectly healthy. Routed through
`ContentView`'s own `.expired` → `performLock()` handling (d8d9c9b, the FIRST Face-ID-loop fix,
which remains correct and necessary but was not sufficient for this device), this produced an
infinite Face-ID relock loop: unlock → marker written with the placeholder → foreground check reads
it back, cannot confirm the boot leg, wrongly reads `.expired` → relock → auto-prompt → unlock →
repeat forever. Confirmed live, verbatim, in Bartek's own Xcode console capture.

**`LockMarker.bootSessionId` is `Optional<String>` as of this fix** — `nil` now means exactly "this
leg is unavailable", never a placeholder that LOOKS like real boot-continuity data.
`LockMarker.isValid(currentBootSessionId:...)` refuses on the boot-identity leg ONLY when BOTH the
stored and current values are present AND disagree — a missing value on either side now falls
through to `isUnlockedLazily`'s own idle-window/absolute-ceiling arithmetic instead, never treated
as a positive expiry verdict on its own. This is the identical principle `LockState.mustRelock`
already established at the ROUTING layer (d8d9c9b) — applied one layer down, at the INPUT to
`LockState` itself: a missing input must never be misclassified as a positive verdict, wherever in
the pipeline it occurs.

**What still detects a real reboot when the boot-id leg is unavailable, and what does not, stated
plainly:** `LockMarker.monotonicNow()` is backed by `mach_continuous_time()`, which resets to ~0 on
every boot — so a STORED monotonic anchor (`monotonicAtUnlock`/`hostUnlockUptime`) greater than the
CURRENT `now` reading is independent proof a reboot occurred (no in-boot reading can ever exceed a
later one), and `isUnlockedLazily`'s own existing rewound-clock guard (T-41-35) already implements
exactly this comparison — it was simply never previously understood as ALSO serving as a reboot
detector, only as a rewound-`Date()` guard, since at the time it was written `bootSessionId` was
assumed reliable and this guard's reboot-detecting role never had to carry weight on its own. This
signal has a real, honest, and NAMED asymmetry: it can PROVE a reboot happened (`now` less than the
stored anchor) but cannot prove one did NOT happen — a device that reboots and then stays up longer
than the stored anchor's own magnitude before the next check passes this arithmetic as if nothing
happened. **This is a genuine, accepted weakening of DR-41-C's original cross-reboot guarantee,
specifically and only in the boot-leg-unavailable case (i.e. real hardware, as things stand today)**
— stated here rather than silently assumed away, per this record's own established discipline.
Investigated, per the debugging session's own instruction, whether `sysctl kern.boottime` (a
DIFFERENT sysctl — the wall-clock boot timestamp, not the per-boot UUID) might be readable from a
sandboxed real-iOS process where `kern.bootsessionuuid` is not: no real device was available in
this debugging session to test it empirically, and no prior evidence exists in this log either way.
Deliberately NOT added as a new dependency in this fix specifically because it could not be
verified here — a conservative choice, not a claim that it would fail. A candidate for a future,
properly device-tested plan, not this one.

### Restated success criteria for Phase 41

Both restatements are forced by `41-RESEARCH.md` F1 (SC3) and Pitfall 4 (SC2). Quoted verbatim first,
per this record's own QA-05/QA-03 obligation not to silently narrow scope.

**SC2, as written in `ROADMAP.md` §"Phase 41", verbatim:** *"Rozszerzenie odszyfrowuje i wypełnia
hasło uruchomione **na zimno** (host app force-quit, brak wcześniejszej aktywności w tej sesji
symulatora) wyłącznie z cache'u — pozytywny dowód wypełnienia w realnym polu formularza w Safari na
symulatorze."*

**Replaced because:** force-quitting the host app does not cold-start a separate `.appex` process —
they are independently-scheduled OS processes with no shared address space (Pitfall 4,
`41-RESEARCH.md`). A "cold" claim built on a host-app swipe-up proves nothing about the extension's own
process state.

**Restated wording:** *"po `simctl shutdown` + `boot`, bez ani jednego uruchomienia host appki po
starcie; nowość procesu potwierdzona pidem rozszerzenia."*

**SC3, as written in `ROADMAP.md` §"Phase 41", verbatim:** *"`.biometryCurrentSet`/timeout ustawione w
jednym procesie faktycznie obowiązuje w drugim: odblokowanie w host apce, potem wywołanie AutoFilla NIE
pyta ponownie o hasło (pozytywny dowód — zrzut ekranu/log pokazujący brak promptu); i odwrotnie,
wygaśnięcie sesji w jednym procesie jest widoczne w drugim przy jego następnym dostępie (ACC-06)."*

**Replaced because:** even under DR-41-A(b) (chosen above), where the silent branch is achievable, the
literal wording's proof shape — "pozytywny dowód — zrzut ekranu/log pokazujący brak promptu" — asks for
an **absence** of a prompt as the primary evidence, which QA-03 forbids as a primary proof (an absence
assertion cannot distinguish "correctly filled silently" from "silently failed to do anything"). The
replacement keeps SC3's substance (no ceremony after a real unlock) but requires a positive assertion
instead.

**Restated wording (this phase's DR-41-A(b) branch):** *"rozszerzenie loguje gałąź silent i wypełnia
poprawne hasło bez żadnej ceremonii biometrycznej (dowód: wartość pola == zapisane hasło, plus log
gałęzi)."* The reverse direction (ACC-06 expiry visible cross-process) is unchanged from the original
wording — it was already a positive proof shape ("wygaśnięcie ... jest widoczne").

**Evidence:** `.planning/ROADMAP.md` §"Phase 41" Success Criteria (quoted verbatim above);
`41-RESEARCH.md` §"Wording the phase record must use", §F1, §"Pitfall 4".

## 1j. Phase 41 decision record — DR-41-B, 2026-08-20

Written against `ios/evidence/41/e41-3-matching-matrix.md` (E41-3, Plan 41-05 Task 1) — three
diagnostic identities (one `.domain`, two `.URL` differing only by port) registered directly
against the real `ASCredentialIdentityStore`, five real Safari navigations observed, replicated
three complete times end to end on the pinned simulator.

### DR-41-B — Credential↔service matching policy on iOS: **DECIDED — Option (a), `.domain`
identities unchanged, full origin equality re-applied at fill time**

**Decision: keep `IdentityStoreSync`'s existing `.domain`-typed registration (no code change to
`IdentityStoreSync.swift` itself — DR-41-A/DR-41-C's own precedent for "the record states the
outcome even when it is 'no change'" applies here too), and enforce this repo's canonical
`originEquals`/`itemMatchesOrigin` policy (`extension/entrypoints/background/frame-guard.ts:135-184`)
at the ONE place iOS hands the fill entry point a real target:
`request.credentialIdentity.serviceIdentifier`, inside `provideCredentialWithoutUserInteraction`/
`prepareInterfaceToProvideCredential` (`CredentialProviderViewController.swift`'s `fillOrCancel`).
This is `CredentialMatcher.swift` (Shared/), a pure function mirroring the extension's own
per-item-type rules, with the `.domain` case's lossy (no scheme/port) conversion made an explicit
case in its own `MatchTarget` enum rather than hidden inside a helper.**

**Rejected: Option (b), `.URL`-typed identities as the primary registration type.** E41-3's own
table (`ios/evidence/41/e41-3-matching-matrix.md` §"Key findings") found `.URL`-typed identities B
and C **never** offered through the system's own "Sign in to …" suggestion mechanism, in any of
five direct tests — including at B's own exact registered address (loc1, url-only replication).
This is not "collapsed to host" (the RESEARCH's own anticipated worst case,
`41-RESEARCH.md` §"The matching-model divergence") — it is "not observed to be offered at all" on
this simulator/toolchain. The plan's own REPLANNING TRIGGERS name exactly this outcome as taking
Option (b) off the table; this record does so on stronger grounds than the trigger anticipated.

**Rejected: Option (c), accept the divergence and document iOS as more permissive, with no
fill-time gate.** Once the `.domain` identity's registration has propagated (E41-3's own Note 1),
it is offered on **every** subsequently-visited location regardless of host — same host/port
(loc1), the same host under a different scheme (loc2), a subdomain (loc3), the same host on a
different port (loc4), and a **completely unrelated host** (loc5, the deliberately-unregistered
control) — in all 3 replications for loc3/4/5. This is not a bounded divergence a record could
merely "accept" (T-41-23's own "high" severity, `41-05-PLAN.md`'s `threat_model`) — a suggestion
breadth this wide, left unenforced at fill time, means ANY password field on ANY http(s) page a
user's cursor happens to focus can offer to fill with a credential registered for an entirely
unrelated site. `CredentialMatcher`'s fill-time gate is what stands between that suggestion and an
actual fill.

**Stated plainly, per this record's own obligation not to soften it: iOS, as measured on this
simulator/toolchain, is dramatically more permissive at the SUGGESTION layer than every other PV
client (extension, web).** The browser extension's own `itemMatchesOrigin`/`originEquals`
(`frame-guard.ts:22-23`) refuses a suggestion at the UI layer itself for anything but an exact
origin match; iOS's suggestion layer applies **no** host-based filtering that this experiment could
detect once a `.domain` identity's registration has settled. **This divergence was intended to be
closed at fill time — see the CORRECTED FINDING below: it is NOT, in fact, closeable there for a
mismatched LIVE PAGE, only for a mismatched STORED IDENTITY.** iOS structurally cannot filter its
OWN suggestion set the way the extension filters its UI (F3, `41-RESEARCH.md`: "QuickType matching
against registered identities is performed by the system, not by us" — confirmed live this session
via `os_log`: zero `PasskeyVaultAutoFill` process activity during the entire five-location drive,
meaning the suggestion sheet is populated by the system directly from stored metadata, never by
invoking our extension code at all). The cost this record names in those words, now stated at its
full severity per the correction below: a user can be offered a suggestion on a page that has
nothing to do with the credential shown, AND — unlike the original hope — the fill is NOT
guaranteed to be refused, because the fill-time check cannot see the live page either. This is the
honest, unsoftened shape of what `.domain`'s measured breadth and `.URL`'s measured absence leave
this milestone with.

**Matching logic is deliberately NOT centralised into `crates/pv-core` or `crates/pv-provider`.**
No matching logic exists there today (a repo-wide search for eTLD/public-suffix/domain-match style
symbols finds only `pv-server/src/config.rs`, unchanged by this plan — `git diff --name-only`
against this plan's own commits contains no path under `crates/`). The semantics iOS needs (a
lossy host, sometimes; a real origin, when `.URL`-typed data is available) are not the semantics
the browser extension needs (always a full origin) — porting `originEquals` into a shared crate
would be a second, iOS-motivated addition to a crate this milestone's constraints protect, for
semantics the extension does not require. The divergence is recorded here, honestly, rather than
resolved by inventing a second, drifting matching model (FAM-04's own warning, cited by `41-RESEARCH.md`
§"The matching-model divergence").

**CORRECTED FINDING (E41-3-policy, live this session) — the fill-time gate does NOT enforce origin
equality against the live page for `.domain`-typed identities; stated plainly, per this record's
own obligation not to soften it.** The paragraphs above, drafted before Task 2's own live proof,
assumed `request.credentialIdentity.serviceIdentifier` carries the fill's real target. It does
not: measured live, it ECHOES OUR OWN REGISTERED `.domain` identity verbatim ("127.0.0.1"),
identically, whether the actual visit was to the item's own registered port (8765, accepted) or a
different port entirely (8766, still echoed as "127.0.0.1" with no port information at all). Since
`IdentityStoreSync` derives the registered `.domain` host directly FROM the item's own stored URL,
the echoed identity and the item's own data are self-consistent BY CONSTRUCTION regardless of
which page actually triggered the fill — a same-host-different-port or different-host VISIT is
therefore structurally invisible to `CredentialMatcher` at the fill entry point. **T-41-23
("filling a credential on a service this product's own policy refuses") is, as measured, NOT
mitigated by this fill-time gate for `.domain`-typed identities on this platform.** The threat
register's own disposition for T-41-23 is amended by this correction (see the plan's own
`threat_model`, this record's evidence trail).

What the gate DOES genuinely enforce, proven live: a DATA-INTEGRITY property — does the identity
selected for a fill actually belong, by its own registered host, to the item it claims via
`recordIdentifier`. This defends T-41-25 (a corrupted or malicious identity-store entry naming the
wrong host for a real item) even though it cannot defend T-41-23. The demonstration
(`e41-3-policy`) therefore mismatches the ITEM's own stored URL against its correctly-registered
identity — not the visited page against the identity, which this session found cannot be
constructed at all via documented, available APIs for `.domain`-typed password credentials.
`prepareCredentialList(for:)`'s own array DOES carry the live page's real `.URL`-typed identifier
(confirmed live, `stage=list-evaluate`), but that callback never reaches a specific fill decision
in this milestone (no picker UI is built here) — logged for evidence
(`logCandidateMatchEvaluation`), never gated.

**Falsification of the guard itself:** `CredentialMatcher`'s per-item-type behaviour matches the
extension's exactly (login: full origin equality including the `.domain` degradation; totp: issuer
heuristic; card/identity: offered everywhere; note: never) — proven by 22 unit tests
(`PasskeyVaultTests/CredentialMatcherTests.swift`). The fill-time gate's OWN data-integrity check
was demonstrated able to fail: bypassing the matcher check in `fillOrCancel` (`true ||` around the
guard) and re-running against a deliberately item/identity-mismatched item showed the fill SUCCEED
where it should have been refused — both runs' terminal log line became `stage=fill status=ok`,
and the harness's own differential assertion caught it (`the two runs' terminal branch lines are
IDENTICAL`) — before the guard was restored and shown refusing correctly, both verified live
(`scripts/ios-autofill-e41.sh e41-3-policy`, `ios/evidence/41/e41-3-policy.log`).

**Evidence:** `ios/evidence/41/e41-3-matching-matrix.md` (the full table, methodology, and honest
account of the control's own failure to stay clean); `ios/evidence/41/e41-3-raw.log` (raw
observations); `ios/evidence/41/e41-3-policy.log` (the fill-time gate's own accepted/refused
proof); `PasskeyVault/Shared/CredentialMatcher.swift`; `41-RESEARCH.md` §"The matching-model
divergence (F3)", §"Decision records this phase owns" → DR-41-B.

---

## 1k. Phase 42-era corrections — DR-42-A, 2026-08-20

Root-caused live (`.planning/debug/ios-cold-launch-blank-offline.md`), from a real-device screen
recording Bartek captured cold-launching the app while signed in: a BLANK white screen for several
seconds, a Face ID sheet racing that blank screen, and — the worse half, found only by reading the
code, never mentioned in the recording because a slow-but-eventually-reachable server never
triggers it — a signed-in user silently bounced to the SIGN-IN screen on any launch where
`GET /api/auth/me` failed for ANY reason, including a purely transport failure. Confirmed BEFORE
any fix by direct code reading (`ContentView.swift`, `AccountService.swift`, `LockView.swift`) and
then reproduced live on the simulator (`ios/evidence/42/launch-offline/before-fix-*.png`): a
signed-in session, server pointed at `203.0.113.1:9999` (TEST-NET-3, non-routable), landed on
"Sign in to 203.0.113.1" **within 1.7 seconds** of a cold launch.

`ContentView.swift`'s own header, since Phase 37 (37-04), had NAMED this as an accepted
simplification at the time ("LockView eligibility is decided by a LIVE `GET /api/auth/me` call
each launch... at the cost of requiring network reachability to distinguish the two screens on
cold launch") — correct when written, but Phase 39 (offline ciphertext cache) and Phase 41 (cold
offline AutoFill) both shipped since, without anyone returning to close this gap, leaving the host
app's own cold-launch routing the one place in the product that still assumed the network.

### DR-42-A — Cache the account's `pw_wrapped_uk` (+ `salt`/`kdf`) locally, in the Keychain, for offline password unlock: **DECIDED**

**Decision: a companion Keychain item, `AccountEnvelopeCache`** (`kSecClassGenericPassword`,
`kSecAttrService = "cloud.blonie.PasskeyVault.account-envelope-cache"`,
`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, no explicit `kSecAttrAccessGroup` — the SAME
accessibility class and access-group defaulting as `SessionTokenStore` (ACC-03/DR-37-B), a
companion to that item, not a third, differently-scoped secret class), written by
`AccountService.register`/`.signIn` on every real success (the two call sites that actually hold
`salt`/`kdf`, never re-derived or invented), and refreshed by `AccountService.restoreSession()`
(now a background call, DR text below) with a **merge** that never blanks an already-cached
`salt`/`kdf` — `GET /api/auth/me` does not return either field, and overwriting them with empty
strings on every background refresh would silently downgrade an already-offline-capable session
back into one that needs the network to unlock. `ContentView.routeToLockOrAuth()` reads it via a
new `AccountService.localAccount()` (Keychain-only, no `apiClient` parameter at all — structurally
incapable of a network call) to route straight to `.lock` on cold launch, with zero network.
`LockView.submitPassword()` reads it via a new `AccountService.unlockLocally(account:password:)`
(`deriveAuthMaterial` + `unwrapUserKeyFromJson`, entirely local) as its PRIMARY unlock path — the
wrapped key's own AEAD tag is the credential check; the server is never asked to confirm a
password. Falls back to the pre-fix, network-based `AccountService.signIn` flow only for a
legacy/pre-cache session (empty `salt`/`kdf` — a session established before this fix ever ran on
this device), confining the app's one remaining unlock-time network dependency to that single,
self-healing edge case.

**Rationale:** this is already a password-wrapped blob (`pw_wrapped_uk`) whose brute-force
resistance is Argon2id's job — the SAME posture Bitwarden ships for its own offline vault unlock —
and the vault ciphertext itself has been on-device since Phase 39 (`AppGroupCiphertextCacheStore`).
Without this cache the app is unusable offline for its own primary "unlock the vault" action, which
directly contradicts two already-shipped phases (39's offline cache, 41's cold offline AutoFill)
whose entire premise is that the vault works without the server.

**Rejected: keep `GET /api/auth/me` as the ONLY source, make it a background refresh, but leave
password unlock going through the network `signIn` flow regardless.** This was the FIRST shape this
correction took, and it shipped a "fix" that still failed the actual requirement: `ContentView`
would route to `.lock` from a cache holding only `email`/`pw_wrapped_uk` (no `salt`/`kdf`), and
`LockView.submitPassword()` still called `AccountService.signIn` — a live `prelogin` + `login`
round trip — meaning the password field rendered promptly but could not actually be used with the
server unreachable. Caught by this session's OWN live proof: `LaunchOfflineLockUITests` failed at
exactly this point (`Password unlock did not reach the unlocked vault with the server
unreachable`), which is precisely why this record extends the cache to `salt`/`kdf` and adds
`unlockLocally` as a distinct code path rather than merely caching data nothing local ever reads.
Recorded here so a future pass does not re-introduce the same half-fix having forgotten why the
extra two fields exist.

**Rejected: extend `GET /api/auth/me` to also return `salt`/`kdf`, so a single network round trip
after a fresh install/legacy upgrade could seed a fully offline-capable cache in one shot.**
Structurally excluded by this session's own constraint (`crates/pv-server` source is never
modified while investigating a client-side bug) — and, on the merits, unnecessary: `register`/
`signIn` are the only two events that ever need to establish a NEW envelope in the first place,
and both already hold `salt`/`kdf` locally without any server change. The one case this would help
(a legacy session that signed in before this fix shipped) is bounded and self-healing: the very
next real sign-in caches the missing fields permanently.

**Residual risk, stated plainly, not softened:** an attacker with the unlocked device's file system
gains an offline brute-force target for the master password — bounded by Argon2id's cost
parameters (64 MiB / t=3 / p=4, the SAME parameters that already protect `pw_wrapped_uk` in transit
and at rest server-side; this cache relocates one already-wrapped copy of that same blob onto the
device, it does not weaken the bound protecting it). Cleared on sign-out
(`AccountService.logout()`) and on a server-address change (`ServerSettings.store(_:)`, the SAME
"secrets cleared on change" path this file's own §"38-12"/§"39" precedent already established for
`SessionTokenStore`/`UkEnvelopeStore` — extended here, not duplicated) — a stale envelope surviving
either event would let `routeToLockOrAuth()` present a Lock screen for an account the new
server/no-longer-signed-in state has never heard of.

**Two smaller, non-alternative-bearing corrections, recorded rather than left implicit:**

- **Launch (and re-lock) must never block the first render on the network.**
  `ContentView.routeToLockOrAuth()` tries `AccountService.localAccount()` first and routes straight
  to `.lock`; `GET /api/auth/me` (`refreshSessionInBackground()`) now fires AFTER that route is
  already on screen, and on `invalidCredentials` (a REAL 401) is the ONLY case that may still route
  a signed-in user to `.auth` — any other failure (transport, unexpected) is silently ignored here,
  because `LockView`'s own `probeReachabilityOnAppear()`/`submitPassword()` (38-11 state 8,
  `isOffline`) already own the visible offline treatment; inventing a second one would be the exact
  "two contradictory signals" that state's own doc comment already warns against.
- **Biometry must not race the first paint.** `LockView.setUpOnAppear()` deferred
  `attemptBiometricUnlock` via `DispatchQueue.main.async` — `onAppear` fires once the view is added
  to the hierarchy but before UIKit has necessarily committed the first actual frame, and on a real
  device the system Face ID sheet won that race and appeared over a still-blank frame (the reported
  symptom's own second half). This is a genuinely separate defect from DR-42-A above and survives it
  on its own — nothing about a faster local route also guarantees biometry waits for the first
  paint.

**Evidence:** `.planning/debug/ios-cold-launch-blank-offline.md` (full investigation, Evidence
section citing exact line ranges in `ContentView.swift`/`AccountService.swift`/`LockView.swift`
read BEFORE any edit); `ios/evidence/42/launch-offline/transcript.md` +
`before-fix-01-blank-loading.png`/`before-fix-02-bounced-to-signin.png` (the pre-fix defect, live);
`after-fix-02-lock-chrome-offline-banner.png`/`after-fix-03-reachable-background-refresh.png` (the
fix, live, both offline and reachable); `LaunchOfflineLockUITests.swift` (automated, repeatable,
green twice); `LocalAccountRestoreTests.swift` (8 cases: `localAccount()`'s Keychain-only
structure, `unlockLocally`'s real-crypto round trip / wrong-password rejection /
`noCachedCredentials` fallback signal, and the envelope-cache merge-never-blanks contract).

**Numbering note (added Phase 42, Plan 42-05):** the `DR-42-A` label above is the ONLY `DR-42-A` --
this is the decision it names. Plan 42-05 (`ios/QA-AUDIT-v1.0.md`) needed a "the audit records, it
does not repair" decision and its own planning material called it "DR-42-A" too, written before
anyone checked this section for a collision; that decision is recorded as **DR-42-C** instead (the
next free `DR-42-*` letter), with its own numbering note, per the same renumber-forward convention
this file already used for L-12/L-15/L-33/L-39. One already-committed record, `42-03-SUMMARY.md`
(quoted nearby in this file's WR-10 discussion), made the same collision one plan earlier and was
left as-is rather than rewritten; a reader following that reference should understand it to mean
DR-42-C, not this section's DR-42-A.

---

## 1l. QA-05 enforcement mechanism — IOS-07, 2026-08-20

### IOS-07 — QA-05 enforcement mechanism: **DECIDED — two layers, preventive + detective**

**Decision: two layers.** Preventive: a shared `pre-commit` hook (`scripts/install-ios-hooks.sh`)
delegating to `gsd-tools query check-commit`, which discriminates by `.planning/config.json`'s
`commit_docs` key — `false` in this worktree, `true` on `main`. Detective:
`scripts/check-ios-gate.sh`'s `qa05` sub-gate, asserting over this branch's own commit range
(`FORK..HEAD`, excluding commits already reachable from `origin/main`/local `main`) that no
`.planning/` commit was ever authored on `ios/spike` itself.

`.planning/` is never committed from this worktree, so a decision recorded only in `.planning/`
does not exist for anyone reading the committed tree — this record lives here for that reason.

**Rejected, on merit, each with its own reason:**

- **A bespoke pattern-matching hook** (`git diff --cached --name-only | grep '^\.planning/'`). It
  would fire on `main` too and break the live v0.5 session there — it has no configuration-driven
  discriminator, only a shape that would need a branch-name/worktree-path heuristic to avoid that,
  exactly the class Pitfall 2 (42-RESEARCH.md) names.
- **An ignore-file entry** (`.gitignore` `.planning/` line). Zero effect on the 1000 already-tracked
  `.planning/` paths inherited from `main` at the fork point — `.gitignore` cannot retroactively
  untrack a tracked path — and it would be a change to a file `main` also reads.
- **The shared exclude file** (`.git/info/exclude`). Lives in the git **common** directory, shared
  with `main`; an entry there would hide new planning files from `main`'s own session. Actively
  destructive, not merely ineffective.
- **`git update-index --skip-worktree`** on the five modified tracked files. Genuinely
  worktree-local (the index itself is per-worktree), but invisible to a future session — edits would
  silently vanish with no record of why — and broken by an ordinary `git checkout`/merge. It would
  become a landmine of its own rather than a fix. Open Question 6 (42-RESEARCH.md) answered NO on
  this basis.
- **Per-worktree git config** (`git config --worktree`, `.git/worktrees/<name>/config.worktree`).
  Requires `extensions.worktreeConfig=true`, a **repository-wide** mutation — currently unset — and
  enabling a repo-wide extension mid-run while another session is live is exactly the class of shared-
  state mutation this plan's own prohibitions forbid.

**The fail-open choice, stated as a cost, not a feature.** When `node` or `gsd-tools.cjs` cannot be
resolved inside the hook's own minimal git-provided environment, the installed hook prints a loud
warning to stderr and exits 0 — it does NOT block the commit. What that buys: a broken PATH on either
worktree can never block `main`'s autonomous session mid-run. What it costs: a silent QA-05
preventive-layer gap in exactly the circumstance nobody is watching for it (an interpreter resolution
failure inside a git hook's own restricted environment). The compensating control is the detective
layer (`gate_qa05`), which catches a `.planning/` commit after the fact regardless of why the
preventive hook did or did not fire.

**Two residual holes, named rather than glossed over:**

- **The bypass flag.** `git commit --no-verify` skips every hook, including this one, and GSD's own
  `cmdCommit` accepts a `--no-verify` flag that forwards it to the real `git commit`
  (`gsd-tools.cjs`, `commands.cjs`). So the preventive layer is necessary and not sufficient; a
  `--no-verify` commit is caught only by the detective layer, after the fact.
- **The guard's own input is itself an uncommitted modification.** `commit_docs: false` lives in
  `.planning/config.json`, itself one of the five tracked-and-modified planning files in this
  worktree. Reverting that value would silently disarm the preventive hook (it would then read
  `commit_docs_enabled` and allow everything) without touching the hook file itself. This is why
  `gate_qa05` asserts `commit_docs == false` **positively** as its own precondition (QA-03) rather
  than inferring it from the absence of a problem.

No claim here states that committing `.planning/` from this worktree is structurally impossible —
that claim would be false (the bypass flag and the config-revert both defeat the preventive layer on
their own). The honest claim is exactly two layers, with both named gaps disclosed.

**The scope call on CI (Open Question 5, 42-RESEARCH.md), answered NO.** `.github/workflows/ci.yml`
is byte-identical to `main`'s copy on this branch, and all five of its jobs run on `ubuntu-latest`, a
platform that cannot build for iOS. Editing it to add an iOS lane would create this branch's first
merge-conflict surface with a live session, for a lane that could not run this milestone's tests
anyway. `scripts/check-ios-gate.sh` is the milestone's CI surrogate, exactly as the ROADMAP's own
`Ograniczenie dowodu` ("static audit + runnable scripts on the simulator/local machine; this does not
replace a real CI runner") anticipates.

**Verified this session, by execution, not by argument:**
- The guard's FAIL path: staging `.planning/STATE.md` and running `gsd-tools query check-commit`
  exits non-zero and names the file. A clean index exits 0 with reason `no_planning_files_staged`.
- `gsd-tools query check-commit` run with `main`'s worktree as cwd, BEFORE the hook was installed,
  exits 0 with reason `commit_docs_enabled`.
- The installed hook, executed directly (no git) with `main`'s worktree as cwd, exits 0.
- A real `git commit` staging `.planning/STATE.md` in this worktree is refused end to end
  (non-zero exit, HEAD unchanged).
- `main`'s own HEAD and tracked-file set were undisturbed by the install.

Full transcripts: `.planning/phases/42-standard-dowodu-bramka-qa-i-ci-dla-ios/42-02-SUMMARY.md`
(not committed from this worktree by the standing convention this record itself documents).

---

## 1m. OPT-01 — Passkey provider scope and cost, 2026-08-21

### OPT-01 — Passkey provider scope and cost: **DECIDED — GO for OPT-03, scoped narrowly; OPT-02 product-rejected; OPT-04 deferred**

Recorded in the `KEY-05`/`IOS-06`/`ACC-03` style: a decision is stated, rejected alternatives are
named and rejected on their own merits (never merely omitted), and residual risk is stated plainly
rather than softened. Full research behind every clause below:
`.planning/phases/43-warunkowe-passkeys-tylko-je-li-tanie/43-RESEARCH.md`.

**1. Decision: GO for OPT-03**, scoped exactly to registration (`make_credential`) and assertion
(`get_assertion`) for third-party relying parties, offered through the system's own passkey UI
surfaces (`ASCredentialProviderViewController`'s existing app/Safari entry points — the SAME
target and entitlement Phase 36/41 already ship). No PRF, no attestation format beyond `"none"`,
no signature-counter tracking.

Cost basis: this reuses the SAME `AUTOFILL_CREDENTIAL_PROVIDER` entitlement Phase 36/41 already
embed. Verified directly against Apple's own portal capability metadata
(`DVTPortalCachedPortalCapabilities.json`, re-derived live this session, 43-RESEARCH.md "The
Associated-Domains question, settled directly from Apple's own capability table"):
`AUTOFILL_CREDENTIAL_PROVIDER` lists exactly one boolean entitlement and has no dependency field on
Associated Domains or any other capability — a provider identifies credentials by `rpId` supplied
fresh on every request, never by an entitlement-enumerated domain list, so the domain-binding
capability that gates an app acting as its own WebAuthn RP client is structurally irrelevant to the
provider role. This also reuses the SAME `pv-provider`/`pv-ffi` infrastructure pattern Phase 35
already proved live.

The one genuinely new Rust surface: `pv-provider`'s two EXISTING public functions
(`create_provider_credential`/`get_provider_assertion`) are WebAuthn-**client**-level — they build
and hash `clientData` internally from a full `{"publicKey": …}` options JSON. iOS instead hands a
credential provider a pre-computed `clientDataHash` and expects a raw CTAP2-shaped exchange
(43-RESEARCH.md Finding 2). Those two shapes do not meet, which is why two NEW entry points
(`get_assertion_ctap2`/`make_credential_ctap2`) are the real remaining cost — plumbing between OS
shapes and CTAP2 shapes, reusing the SAME `passkey-authenticator=0.5.0` dependency and the SAME
`PvCredentialStore`/`PvUserValidation` this crate already has, not new cryptography.

**2. The UI scope fence, stated as a locked boundary, not an open question.** The product ask is
literal NordPass parity: iOS itself asks "use a passkey from Passkey Vault?" — no bespoke
multi-credential picker view is in scope. PV renders only what
`ASCredentialProviderViewController` requires: a registration-confirmation screen. The assertion
path needs no UI PV draws at all, mirroring the password fill path's own QuickType surface. Where a
screen IS unavoidable it follows `ios/brand/screens-vault.html` and `Core/StatusCallout.swift`
patterns, PV* tokens only, security copy always plain — never playful. This resolves
43-RESEARCH.md's Open Question 4 with its own default assumption A3 (the system surface suffices
for the common case; PV only needs the registration-confirmation screen the ROADMAP explicitly
names) — stated here as the answer, not left open.

**3. Decision: OPT-02 (PRF unlock of the vault itself) is REJECTED on PRODUCT grounds.** Bartek's own
words, quoted verbatim (`ROADMAP.md`, 2026-08-20, "### Phase 43" block): "passkey provider dla
cudzych stron. u nas jest faceid unlock więc to wystarcza." This is a product decision, not a
technical no-go: Face ID unlock is the product's stated sufficient answer, and that is the entire
and only reason. Nothing about entitlement gating, deployment topology, or implementation
difficulty is the reason — the reason is that the product owner decided the existing biometric
unlock already covers this need.

**4. Decision: PRF served through the provider to third-party relying parties (`largeBlob`
included) is DEFERRED, with reason.** Most RPs never request the `prf`/`largeBlob` WebAuthn
extensions; building partial support for a rarely-requested capability contradicts this project's
own "not done, deferred, here is why" standard. `largeBlob` was never in scope at any point,
distinct from `prf` extension support (which at least has SDK-availability precedent from the
superseded research). §4 Open Question 2 (does a real-world flow ever need the passkey-aware
picker-list override, `prepareCredentialListForServiceIdentifiers:requestParameters:`, versus the
direct-fill path Phase 41 already proved) stays open and is named here as still open — it is not
resolved by this record.

**5. Rejected alternative: treating this as still bundled with the superseded PRF-scoped go/no-go.**
That earlier research spent its budget on two hard unknowns: whether a non-`XCODE_FREE_PROGRAM`
capability row blocks the domain-binding entitlement a native RP client needs for its own vault's
PRF unlock, and a genuinely unresolved raw-vs-hashed PRF salt question for a PRF-enabled provider
path. Both are now structurally irrelevant to a provider-only, PRF-free scope: the first question
belongs to OPT-02's scope, rejected on product grounds above (see item 3), and the second
belongs to an extension surface this record defers above (see item 4) — neither unknown has any
analogue in the narrower GO scope decided in item 1 (43-RESEARCH.md Finding 1, Summary paragraph
1). Reopening either question would require reopening a scope decision already made elsewhere in
this record, not adding new research here.

**6. Rejected alternative: reusing `create_provider_credential`/`get_provider_assertion` for the
iOS path.** Impossible, not merely inconvenient — SHA-256 is not invertible, and iOS never gives PV
the WebAuthn options JSON those functions require, only the finished hash (43-RESEARCH.md
"Anti-patterns to avoid," first bullet). Building a fake `{"publicKey": ...}` JSON around a hash to
force-fit the existing functions is not a shortcut; it is a sign the wrong layer was chosen.

**7. Residual risks, named rather than softened, each assigned to the concrete task that will
settle it empirically:**
- Open Question 1 (does a fresh registration's `ASPasskeyCredentialIdentity` carry the RP's real
  `user.name`/`user.displayName`, or a placeholder) — assigned to **Plan 43-07**'s registration
  wiring task, settled by a live log-line experiment before that plan's own SC4 proof is trusted as
  final.
- Open Question 3 (does `ciborium`'s `fmt:"none"` attestation object satisfy a real RP verifier) —
  assigned to **Plan 43-04**'s registration CTAP2 task, settled by an independent `webauthn-rs`
  verification extending `crates/pv-provider/tests/real_rp_verification.rs`'s own pattern.
- Assumption A1 (does `request.supportedAlgorithms` always include ES256/-7 for a real RP) —
  accepted as low risk; registration fails cleanly (never substitutes an algorithm) if a real RP's
  list excludes it, per **Plan 43-04**'s own algorithm-negotiation task.

**8. Discrepancy note (C8), and fix applied.** `.planning/REQUIREMENTS.md`'s OPT-02 line (~line
102) reads as an open, undecided cost question — stale relative to this 2026-08-20 product
decision. `ROADMAP.md`'s Phase 43 block is the fresher, authoritative artifact (explicitly dated,
carries Bartek's verbatim words) and this record treats it as controlling. A verbatim-cited
amendment has been appended directly to that `REQUIREMENTS.md` line in this worktree's local copy
(never committed from this worktree, per IOS-07/QA-05 above), marking it product-rejected rather
than editing away the original text.

**Update to the spike-status framing above.** The "Status of the spike" table's Milestone paragraph
(top of this file) previously stated passkey provider and PRF unlock as jointly "deferred and
conditional." That framing is now superseded by this record: the passkey **provider** for
third-party sites (OPT-03) is DECIDED GO (scoped as above), OPT-02 is DECIDED REJECTED (product
grounds), and OPT-04 (PRF-through-the-provider) is DECIDED DEFERRED (item 4 above) — see this entry
for the authoritative, current framing.

**Verification, re-run at commit time.** `! grep -rq "get_assertion_ctap2\|make_credential_ctap2"
crates/pv-provider/src crates/pv-ffi/src` and `! grep -rlq "ASPasskeyCredentialRequest\|
prepareInterfaceForPasskeyRegistration\|ProvidesPasskeys" ios/PasskeyVault/PasskeyVaultAutoFill`
both hold immediately before and after this commit — no passkey-provider code exists anywhere in
this worktree yet. This entry is this task's own, standalone commit, landing before any commit
that adds `crates/pv-provider/src/ceremony.rs` CTAP2 code, `crates/pv-ffi/src/provider.rs`, or any
`ASPasskey*`-touching Swift line, per SC1's commit-order requirement (mirrors `35-01`'s own
verification discipline for `IOS-06`).

## 1n. OPT-04 closure — build+absence proof, 2026-08-22

### OPT-04 — PRF-through-the-provider and largeBlob: **DEFERRED SCOPE CONFIRMED SHIPPED-NOTHING**

Sibling entry to §1m, closing the OPT-04 half of that same decision record: the deferred scope
(OPT-02 PRF unlock, PRF-through-provider, `largeBlob`) reaches zero shipped symbols in either the
Rust workspace build or the iOS app/extension build, and the workspace still compiles green.

**1. `cargo build --workspace` — PASS.** Compiles `pv-core`, `pv-provider`, `rp-fixture`, `pv-ffi`,
`pv-wasm`, `pv-server` clean, `Finished 'dev' profile ... target(s) in 8.30s`.

**2. `.hmac_secret(` grep — exactly the two pre-existing call sites, never a third.**
`grep -n '\.hmac_secret(' crates/pv-provider/src/ceremony.rs` returns lines 96 and 228 only, both
inside the two functions that predate this phase (`create_provider_credential`,
`get_provider_assertion`). The two NEW CTAP2 entry points this phase added
(`get_assertion_ctap2` at line 308, `make_credential_ctap2` at line 431) carry only comments
(`// NEVER .hmac_secret(...) -- OPT-01 scopes PRF out of Phase 43`, lines 304/420/489) — zero calls.

**3. L-14 re-probed live, THIS session, not carried forward.** `xcodebuild -project
ios/PasskeyVault/PasskeyVault.xcodeproj -scheme PasskeyVault -configuration Release -destination
"platform=iOS Simulator,id=$(cat /private/tmp/pv16.udid)" build` — **exit 65, STILL CRASHING.**
Identical crash signature to the 2026-08-16 original (`ios/evidence/38/L14-RELEASE-BUILD-CRASH.md`)
and the 2026-08-20 Phase 42 re-probe (§8d item 1 above): same mangled symbol
(`UniffiHandleMap...deinit`), same generated-file location (`pv_ffi.swift:406:25`), same
unbounded-recursion shape (`isCallerAndCalleeLayoutConstraintsCompatible`, two frames at the
identical address), same pass name `EarlyPerfInliner` (pass number differs run to run — expected,
not itself meaningful). **Recorded unsoftened: L-14 remains OPEN and remains the milestone's ship
blocker.** None of its three recorded options (bump the UniFFI pin; isolate the generated bindings
into their own `-Onone` module; report upstream + pin the toolchain) have been applied. Full
transcript: `ios/evidence/43/43-10-l14-reprobe.log`.

**4. OPT-02-scoped symbol grep — zero hits in the shipped Swift surface.** `grep -rn "largeBlob"
ios/PasskeyVault ios/PasskeyVaultHarness` — no matches. `grep -rln "PRF\|prf"
ios/PasskeyVault/PasskeyVault ios/PasskeyVault/PasskeyVaultAutoFill` — the ONE hit
(`PasskeyRegistrationConfirmView.swift`) is a source-comment cross-reference to this very decision
record ("decision record: 'provider: yes; PRF/OPT-02: no'"), not a functional symbol or code path.
No native RP-client PRF unlock path exists anywhere in the shipped app or extension targets.

**5. Test-only surfaces confirmed absent from production paths.** `grep -n "rp-fixture\|
PasskeyVaultHarness" Dockerfile` — no matches (positive control: the same file's own `grep -n
"pv-server" Dockerfile` finds three hits, confirming the grep itself is live, not vacuously
matching against an empty/wrong file). No `.github/`/docker-compose reference to either surface
either. `crates/rp-fixture` (43-03) and `ios/PasskeyVaultHarness` (43-08) are test-only surfaces
this phase added; both are confirmed absent from every production build/deploy path.

**OPT-04 is closed.** The deferred scope shipped zero new symbols, the workspace build is green,
and this phase's own test-only surfaces never touch production. L-14's current, honestly re-probed
state is a SEPARATE, pre-existing landmine (found 2026-08-16, Phase 38) that this phase's own work
neither caused nor fixed — it remains Bartek's own call among its three recorded options, unchanged
by Phase 43.

---

## 1o. Phase 44 decision records — DR-44-A, DR-44-B, 2026-08-22

### DR-44-A -- Deployment floor raised: 18.0 (IOS-03) to 26.2: **DECIDED**

**1. Decision.** Raise `IPHONEOS_DEPLOYMENT_TARGET` from 18.0 to 26.2 everywhere it is declared
(`project.pbxproj`'s 8 occurrences, `scripts/build-ios.sh`'s own exported value). This **REVISES**
IOS-03, it does not overwrite it. IOS-03's original table row, quoted verbatim: *"IOS-03 | Minimum
deployment target **iOS 18.0** | Every PRF symbol is `iOS 18.0+`. Xcode's default 26.5 discards
supported devices for zero gain | Xcode default 26.5; iOS 17 (passkey provider, but **no** PRF)"*.
PRF's own 18.0+ requirement stays satisfied (26.2 ≥ 18.0) — nothing about IOS-03's original reasoning
is wrong or reversed. The reason for THIS raise is different and additive: `ASSavePasswordRequest`
and `ASGeneratePasswordsRequest` are `API_AVAILABLE(ios(26.2))` in the shipped iPhoneOS26.5 SDK
header, full stop — no lower floor is possible for either API, so SAVE-01/SAVE-02 cannot exist on
this codebase's own 18.0 floor at all.

**2. The price, named plainly** (ROADMAP Phase 44 SC1's own instruction). Users on iOS 18.0–26.1
lose the app entirely — it will refuse to install/launch on those OS versions once
`IPHONEOS_DEPLOYMENT_TARGET` is raised and any TestFlight/ad-hoc build ships. Stated honestly rather
than minimized: `.planning/REQUIREMENTS.md`'s own "Świadomie poza zakresem" already excludes App
Store distribution from this milestone, so today's actual blast radius is limited to any future
TestFlight/ad-hoc install target running below 26.2 — a small/unknown population, not zero, and not
softened into "should be fine." Bartek's own real device (iPhone 16, iOS 27.0) is unaffected.

**3. Rejected alternative: keep the 18.0 floor and gate SAVE-01/SAVE-02 behind their own
`@available(iOS 26.2, *)` branches.** Rejected because it would ADD a new long-lived conditional
pair in the exact place ROADMAP SC1 asks to SIMPLIFY (this same plan removes six existing
`#available(iOS 26.0, *)` branches), for a capability that is entirely unavailable below 26.2
regardless of any conditional wrapper — a user between 18.0 and 26.1 gets nothing from Phase 44's
headline capability either way, so the conditional buys no real coverage for that user population,
only permanent maintenance cost on two code paths that can never both execute on the same OS
version. Raising the floor outright is strictly simpler and loses nothing the conditional would
have preserved.

**4. What this closes.** The "iOS 18 dock fallback (`AvailableFallbackCreateButton`) has never been
on a screen" open item (§6 "Phase 38 — evidence", both its "Proof limitations" bullet and its "Not
closed, named openly" bullet — see the edits made in place alongside this record) is CLOSED as
no-longer-applicable, not finally tested: once the floor is 26.2, that fallback path is provably
unreachable on any supported OS version — there is no longer any live OS version this simulator or
any device could run where the fallback branch is selectable. Stated explicitly here rather than
left implicit.

**5. Addendum (Task 2), the six now-dead `#available(iOS 26.0, *)` branches and
`AvailableFallbackCreateButton` were removed in the same plan (`ItemListView.swift`,
`PVDesign.swift`).**

**Floor change verified through the build system, not the file.** `caffeinate -i bash
scripts/build-ios.sh` reported `deployment floor for aarch64-apple-ios-sim is unrecorded or
differs from 26.2 -- cleaning` AND the identical line for `aarch64-apple-ios` — L-9's own stamp
mechanism actually fired a real `cargo clean --release --target ...` for BOTH triples (3589 files
removed for the sim triple), not a `Finished ... in 0.3s` no-op. `vtool -show-build-version`
against a NAMED, non-first `pv_ffi*.o` object extracted from the rebuilt
`libpv_ffi-554da463dc6567f1.a` archive (`pv_ffi-554da463dc6567f1.pv_ffi.8d9c1ff36d2991a9-cgu.08.rcgu.o`
— the exact object the build script's own vtool slice gate independently matched, per its own
log line `OK: ios-arm64 (pv_ffi-554da463dc6567f1...)`) reports `LC_BUILD_VERSION platform IOS
minos 26.2`. `xcodebuild -showBuildSettings | grep IPHONEOS_DEPLOYMENT_TARGET` reports `26.2`.

**L-14 re-probed live, twice, this session — RESULT: NEWLY-FIXED, not still-crashing.** `xcodebuild
build -configuration Release -project ios/PasskeyVault/PasskeyVault.xcodeproj -scheme PasskeyVault
-destination "platform=iOS Simulator,id=$(cat /private/tmp/pv16.udid)"` — **exit 0, `** BUILD
SUCCEEDED **`**, both runs (`ios/evidence/44/44-01-l14-reprobe.log`,
`ios/evidence/44/44-01-l14-reprobe-run2.log`). Zero occurrences of `UniffiHandleMap`, `crash`,
`Fatal error`, or `Segmentation` in either log — the prior signature (mangled
`UniffiHandleMap...deinit` symbol, `EarlyPerfInliner` pass,
`isCallerAndCalleeLayoutConstraintsCompatible` unbounded-recursion shape, generated-file location
`pv_ffi.swift:406:25`) that reproduced identically across the 2026-08-16 original, the 2026-08-20
Phase 42 re-probe, and the 2026-08-22 Phase 43 re-probe does not appear here. Both new logs show a
genuine fresh Whole-Module-Optimization Swift compile of every source file in both the `PasskeyVault`
and `PasskeyVaultAutoFill` targets (`SwiftDriverJobDiscovery`, full file lists, both targets),
confirming this is not a stale/cached build silently reporting success.

**Stated plainly, per this project's own QA-01 standard: raising the deployment floor changed
something about L-14 that three prior re-probes at the 18.0 floor never showed.** This is recorded
as an honest, reproduced (2/2) observation, not a theory of WHY — the most plausible mechanism is
that the Swift target triple itself changed (`arm64-apple-ios26.2-simulator` in this session's
logs, vs. `arm64-apple-ios18.0-simulator` at the old floor), which can select a different
`swift-frontend` optimization/codegen path for the SAME generated UniFFI bindings, but this record
does not claim that mechanism as verified — only the OUTCOME (build succeeds, twice, where it
previously crashed, consistently, three times) is the load-bearing fact. **L-14 is no longer
demonstrated-broken on this toolchain as of this plan.** Whether it is durably fixed (vs.
coincidentally avoided by this specific floor/SDK/toolchain combination) is not settled by two
re-probes alone — a future session should re-confirm before removing L-14 from the "Known open
items" list entirely; this record does not do that removal itself, only reports the new
observation where it belongs (DR-44-A, the record that caused the floor change).**

### DR-44-B -- SAVE-02 password-rules translation: **DECIDED -- extend the Rust generator, additive**

**1. Decision.** Plan 44-02 adds a new, additive Rust entry point
(`generate_character_password_from_rules`) to `crates/pv-core`'s existing generator module, that
parses Apple's Password Rules DSL (`https://developer.apple.com/password-rules/`) and genuinely
honours `minlength`/`maxlength`, named `required`/`allowed` classes
(`lower`/`upper`/`digit`/`special`/`ascii-printable`), and `max-consecutive` — via guaranteed
per-class inclusion and a bounded reject-and-retry loop for `max-consecutive`, both real constraints
this project's existing `generate_character_password` deliberately does not enforce.

**2. What stays unchanged, stated explicitly.** `generate_character_password`'s own documented
design is UNCHANGED — quoting its own doc comment verbatim: *"Deliberately NO 'guarantee one
character per selected class' option -- the canonical generator draws uniformly over the union, and
an inclusion rule would change that distribution."* It remains exactly the generator the vault's own
"Generate password" screen (DR-38-A, UI-06) calls, with the identical uniform-distribution guarantee
it has always had. The new `generate_character_password_from_rules` function is purely additive, for
a genuinely different caller (an RP's own stated Password Rules), not a modification or replacement
of the existing function or its callers.

**3. Two shapes explicitly REFUSED, never silently substituted:** a custom bracket character class
(e.g. `required: [ABCDEFGH]`) and the `unicode` allowed/required class. This project's charset
constants (`CHARSET_LOWERCASE`/`CHARSET_UPPERCASE`/`CHARSET_DIGITS`/`CHARSET_SYMBOLS`) are
ASCII-only by construction — claiming to satisfy either shape would produce exactly the "generated
password an RP will reject" defect `44-RESEARCH.md`'s Pitfall 3 named. The parser returns a named
error for both shapes rather than silently ignoring or coarsely approximating them; the Swift caller
(Plan 44-05) falls back to the documented `ascii-printable` default rather than failing the whole
generate request outright — recorded here as part of the same decision, not left for 44-05 to invent
independently.

**4. Rejected alternative: the coarse mapping** (length + named classes only, no guaranteed
inclusion, no max-consecutive). Rejected because it would silently violate exactly the two
constraints real RPs commonly enforce (guaranteed per-class inclusion, max-consecutive), reproducing
`44-RESEARCH.md` Pitfall 3's defect shape verbatim: a generated password that looks valid but fails
an RP's own client-side validation, with no PV-side warning it could happen.

**5. Rejected alternative: a full bracket-class grammar** (arbitrary nested `[...]` custom character
sets, matching the full published spec's grammar). Rejected because it is genuinely more parser
complexity for a shape this project's own generator could not honour even if parsed correctly — no
custom-charset concept exists in `CharacterPasswordOptions` at all, so a fully general parser would
produce structured output with no consumer able to act on the general case, only its ASCII-named-class
subset.

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

### L-27 -- `Foundation.Process` does not exist on iOS; a Node/pv-wasm "second client" driver cannot be spawned from inside an `xcodebuild test` method

**Found 2026-08-19, Phase 40, Plan 40-06, Task 3.** `scripts/invite-live-e2e.mjs` was written to be the
E-F2 live test's "second real client" (a pv-wasm Node driver, mirroring `verify-ios-web-interop.mjs`'s
established pattern), invoked via `Foundation.Process` from `InviteTests.swift`'s
`liveInviteRedeemedByWebAccount`. This does not compile: `error: cannot find 'Process' in scope` --
confirmed by grepping the iphonesimulator SDK's `Foundation.swiftinterface` directly, which contains no
`class Process` declaration at all (present only in the macOS SDK's interface). `Process`/`NSTask` is a
macOS-only Foundation type; an iOS (or iOS Simulator) process — including the `xcodebuild test` runner's
own test bundle — cannot spawn an arbitrary host subprocess this way. This is why
`CrossClientInteropTests.swift`'s own two-method split (`direction1`/`direction2`) exists: the Node-side
work happens in the EXTERNAL `verify-ios-web-interop.mjs` orchestrator, BETWEEN two separate
`xcodebuild test -only-testing:.../directionN_...()` invocations it drives itself — no Swift test method
ever spawns anything.

**Consequence:** a single self-contained Swift Testing method cannot itself run a Node/pv-wasm "second
client" mid-test. Either (a) split the live test into two methods and write a new external `.mjs`/shell
orchestrator (this milestone's established pattern, `verify-ios-web-interop.mjs`), or (b) perform BOTH
sides of the round trip using REAL `pv-ffi` calls from Swift (what plan 40-06's `redeemInviteSwiftSide`
does) — genuinely live, real crypto, real server round trips, just not a JS/wasm interop claim
specifically (already covered elsewhere in this milestone for other wire shapes). `scripts/invite-live-e2e.mjs`
is kept in the repo, unused by any automated gate, as a ready-made template for option (a) if a future
plan needs the JS/wasm interop claim specifically.

### L-28 -- `xcodebuild test -only-testing:<Target>/<Suite>` (no trailing method) silently runs the WHOLE suite twice in one invocation on this toolchain

**Found 2026-08-19, Phase 40, Plan 40-06, Tasks 1-3, empirically, repeatedly.** Every
`xcodebuild test -only-testing:PasskeyVaultTests/InviteTests` invocation (suite-level scope, no
trailing `/methodName()`) in this task ran `Test suite 'InviteTests' started on 'Clone 1 of ...'` and
every one of its test cases TWICE, back to back, inside the SAME `xcodebuild` process/clone -- confirmed
across at least four separate invocations (the Task 1 RED/GREEN/falsify/restore cycle, and the Task 2/3
suite-wide sweeps), never once during any `-only-testing:.../methodName()` (trailing-parens,
single-method) invocation, which always ran exactly once. For an idempotent (pure, no side effect) test
this is harmless -- both runs pass identically. For `liveInviteRedeemedByWebAccount` specifically it is
NOT harmless: the second run's `POST /api/families` correctly 409s ("family already exists") against
`pv-server`'s v0.4 SINGLETON family model (one family per server/DB, not per account -- confirmed via
`crates/pv-server/src/routes/families.rs::create`'s own doc comment), so a bare suite-level sweep of
`InviteTests` against a single live server session always reports the run as failed even when the live
proof itself (the FIRST internal run) genuinely passed. Root cause not fully identified (no
`.xcscheme`/`.xctestplan` exists on disk for this project -- Xcode auto-generates the scheme -- so
whatever default is doubling execution is not visible as a config file to inspect).

**Consequence, mirroring L-21's own guidance for external-infra-dependent suites:** treat `InviteTests`
the same way `CrossClientInteropTests`/`FolderWireInteropTests`/`VaultWireInteropTests` are already
treated -- a bare, unscoped suite-level `-only-testing:` sweep is not trustworthy evidence for the LIVE
method on its own; run `liveInviteRedeemedByWebAccount()` scoped individually (trailing `()`, as this
plan's own `<verify>` commands do after the L-3-family "trailing parens" correction) against a FRESH
`scripts/ios-live-server.sh` session for a trustworthy result. The three pure (Tasks 1-2) tests remain
safe under either scoping, since they carry no server-side state to collide on.

### L-29 -- `UIHostingController`/`UIWindow` accessibility-tree introspection is non-deterministic in a `PasskeyVaultTests` (Swift Testing) run on this simulator/toolchain

**Found 2026-08-19, Phase 40, Plan 40-08, Task 2.** An attempt to assert a SwiftUI view's real
`.accessibilityIdentifier` presence/absence from inside `PasskeyVaultTests` (not `PasskeyVaultUITests`) --
without `ViewInspector` -- by hosting the view in a real `UIHostingController`/`UIWindow` and walking the
resulting accessibility tree (`accessibilityElements` array, and separately the older
`accessibilityElementCount()`/`accessibilityElement(at:)` pair) was tried in SIX distinct variations in
this session: (1) a fresh scene-less `UIWindow(frame:)` per call -- found nothing, ever; (2) a fresh
`UIWindow(windowScene:)` attached to the host app's own active `UIWindowScene` per call -- found real
content on the FIRST call in a process, reliably found NOTHING on every subsequent call, regardless of
teardown discipline in between; (3) a single REUSED window with a fresh `UIHostingController` swapped in
per call -- same "first call only" pattern; (4) a single reused window AND a single reused hosting
controller, mutating an `@ObservedObject` fixture between samples instead of re-hosting -- non-
deterministic in either direction (sometimes the FIRST sample found nothing); (5) the same, with a 0.2s
`RunLoop` settle after layout -- same non-determinism; (6) the same, polling layout+walk in a loop up to
a ~3s budget instead of a single fixed sleep -- STILL found nothing on some runs, ruling out timing/settle
delay as the root cause. `@Suite(.serialized)` (Swift Testing's own execution-serialization trait) was
also applied and did not fix it. No reproducible trigger was identified (not window/controller reuse
alone, not timing, not test ordering within the file).

**Consequence:** do not re-attempt this exact technique in `PasskeyVaultTests` without first identifying
the actual root cause (candidates, untested in this session: `UIHostingController`'s accessibility tree
construction may be genuinely best-effort/asynchronous outside a real `XCUIApplication` process; the iOS
26.5 simulator's accessibility daemon may need a signal this harness never sent). For an assertion that
NEEDS the real rendered accessibility tree (not just the underlying gate boolean a production view reads),
use `PasskeyVaultUITests` (`XCUIApplication`, which reliably queries accessibility identifiers elsewhere in
this codebase -- `VaultDockUITests`, `VaultDockEvidenceUITests`) against a real running app instead of
`UIHostingController` introspection inside the unit-test bundle. `40-08-SUMMARY.md`'s Deviations section
records the fallback this plan took instead: asserting the underlying, already-public,
already-tested production gate condition (`DetailFieldTables.passwordFieldIsHidden`) rather than the
rendered tree.

### L-30 -- `xcodebuild test -only-testing:.../methodName` WITHOUT the trailing `()` silently selects ZERO Swift Testing tests and exits 0

**Found 2026-08-19, Phase 40, Plan 40-09, Tasks 2-3, empirically.** This plan's own `<verify>` commands,
copied verbatim from the PLAN.md text, read `-only-testing:PasskeyVaultTests/Fsh02ReceiveTests/livePathAInviteTimeWrap`
(no trailing parens). Run exactly as written, `xcodebuild test` printed `** TEST SUCCEEDED **` -- but no
evidence files landed on disk, and a follow-up run with `-parallel-testing-enabled NO` (which suppresses
L-28's clone-doubling and makes the true count visible) reported `Executed 0 tests, with 0 failures` /
`Test run with 0 tests in 1 suite passed`. The identifier silently matched NOTHING, and an empty test
selection is, to `xcodebuild`, a passing run -- exactly the "vacuous gate" shape this project's own
review discipline watches for (a `<verify>` that cannot fail because it never runs). Confirmed the fix
empirically: adding the trailing `()` -- `-only-testing:PasskeyVaultTests/Fsh02ReceiveTests/livePathAInviteTimeWrap()`
-- made `xcodebuild` actually select and run the method (`◇ Test livePathAInviteTimeWrap() started` /
`✔ ... passed after 0.83 seconds`, real evidence files written to disk immediately after). This is a
DIFFERENT failure mode from L-28 (suite-level scope running everything twice) -- this is method-level
scope, missing parens, running NOTHING.

**Consequence:** every `-only-testing:<Target>/<Suite>/<method>` invocation targeting a Swift Testing
(not XCTest) method on this toolchain MUST include the trailing `()`, or the command silently verifies
nothing while reporting success. A PLAN.md `<verify>` block that omits the parens (as this plan's own
Task 2/3 blocks did, copying the shape of an ordinary shell path rather than a Swift Testing method
identifier) is not just a style nit -- it is a gate that can never fail. This plan's own two live runs
were actually executed and their evidence actually produced using the corrected, parenthesized form;
the PLAN.md text itself should be read as needing that correction for any future re-run.

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

### L-31 -- a `.biometryCurrentSet` Keychain item makes silent QuickType fill structurally impossible

**Found 2026-08-20, Phase 41, Plan 41-02, Task 2, from the composed facts DR-41-A is written against**
(not newly observed this plan -- `41-RESEARCH.md` F1 named it; recorded here as a landmine, per this
plan's own mandate, so it is never rediscovered as a bug). `provideCredentialWithoutUserInteraction`
[OBSERVED, `ASCredentialProviderViewController.h:100-134`] forbids showing any UI at all; reading a
`.biometryCurrentSet`-protected Keychain item **is** a biometric evaluation; and an `LAContext` cannot
be shared between the host app and the extension process [37-RESEARCH, OBSERVED]. Composing the three:
any design that stores the User Key *only* behind a `.biometryCurrentSet` item has chosen, structurally,
to prompt Face ID on every single AutoFill invocation, including the QuickType-bar tap path. This is not
a bug to be found and fixed later -- it is the exact bug class (Bitwarden's "Face ID mówi odblokowane,
autofill i tak pyta o hasło główne") that Phase 41's own goal line exists to avoid, and DR-41-A's Secret C
is the artifact that avoids it.

**Consequence:** never diagnose a Face ID prompt on every QuickType tap as a defect in the cross-process
lock plumbing before checking which Keychain item the fill path actually read. If it read Secret A
(the `.biometryCurrentSet` envelope) instead of Secret C (DR-41-A's session artifact), the prompt is
expected behaviour by design, not a regression.

### L-32 -- a cold launch of an app extension is not a force-quit of the host app

**Found 2026-08-20, Phase 41, Plan 41-02, Task 2, from `41-RESEARCH.md` Pitfall 4** (recorded here as a
landmine per this plan's own mandate). The host app and the `.appex` are two independently-scheduled OS
processes with no shared address space or lifecycle. Force-quitting (swiping away) the host app does not
touch the extension process, does not clear its memory, and does not reset whatever the OS has cached for
it. A "cold fill" claim (ROADMAP SC2) built on a host-app swipe-up therefore proves nothing about the
extension's own process state -- it must be built on an actual new extension process, confirmed by pid,
which this phase's own restated SC2 wording (§1i above) now requires via `simctl shutdown` + `boot`
rather than a host-app force-quit.

**Consequence:** any plan or test that "goes cold" only by force-quitting `PasskeyVault.app` and then
invoking AutoFill has not tested a cold extension launch at all -- the `.appex` process may still be
warm, with the identity store and any in-memory state from a prior invocation intact. `simctl shutdown`
+ `boot`, with pid verification, is the only definition this phase accepts.

### L-33 -- the identity-store overload trap is real, but NOT where the plan's own text (and 41-03's own header) assumed -- it needs the completion-handler call form, not array element type alone

**Numbering note (same reason as L-12's/L-15's):** 41-04-PLAN.md's own text names this landmine "L-9".
That ID was already claimed by an unrelated defect from an earlier phase (`ios/IOS-SPIKE-LOG.md:2615`,
"a check that cannot fail" produced FOUR more instances in a single phase"). It is recorded here as
**L-33**, the next free ID after L-32, rather than as a duplicate L-9 -- two landmines sharing one number
breaks every future cross-reference by that number.

**CORRECTION, not just a relabeling.** 41-04-PLAN.md's own text (and 41-03's `IdentityStoreSync.swift`
header, written before this plan ran) asserted that a literal `[ASPasswordCredentialIdentity]` array
"silently binds the DEPRECATED selector" of `saveCredentialIdentities`/`removeCredentialIdentities`
regardless of call form. **This was tested live, this session, and is FALSE for the call form this
codebase actually uses.** `ASCredentialIdentityStore.h` declares BOTH a current
(`saveCredentialIdentityEntries:completion:` -> Swift `saveCredentialIdentities(_:completion:)`,
`[any ASCredentialIdentity]`) and a deprecated (`saveCredentialIdentities:completion:`, ALSO imported as
`saveCredentialIdentities(_:completion:)`, `[ASPasswordCredentialIdentity]`,
`__attribute__((swift_attr("@_disfavoredOverload")))`) overload, sharing the identical Swift base name and
argument labels -- that structural fact is real. But `@_disfavoredOverload` means Swift's overload solver
EXCLUDES the deprecated candidate whenever ANY other candidate type-checks, including one requiring an
implicit array-element upcast (`[ASPasswordCredentialIdentity]` -> `[any ASCredentialIdentity]`, which
Swift performs automatically at a call site). Two throwaway `swiftc -typecheck` probes against this exact
SDK confirmed it directly:

```swift
func f1(store: ASCredentialIdentityStore, ids: [ASPasswordCredentialIdentity]) async throws {
    try await store.saveCredentialIdentities(ids)   // binds the CURRENT overload -- compiles clean
}
func f2(store: ASCredentialIdentityStore, ids: [ASPasswordCredentialIdentity]) {
    store.saveCredentialIdentities(ids, completion: nil)   // binds the DEPRECATED overload -- warns
}
```

`f1` -- the `try await` async-sugar form, which is the ONLY form `IdentityStoreSync.swift` (both 41-03's
original and this plan's generalised version) ever writes -- compiled with ZERO deprecation warning even
under `-Xfrontend -Werror -Xfrontend DeprecatedDeclaration`, REGARDLESS of the array's static element
type. A live `xcodebuild` run against the actual project, with one call site in `IdentityStoreSync.swift`
temporarily retyped to `[ASPasswordCredentialIdentity]` end-to-end (both the function parameter and its
caller), under the SAME escalation flag, reproduced this: **exit 0, clean build** -- the retyped array
alone does NOT reproduce the trap. `f2` -- the raw, non-`async` completion-handler form -- DOES bind the
deprecated selector and DOES fail under escalation, confirmed live in the same probe session.

**The corrected finding:** the trap is real, but its trigger is the CALL FORM (completion-handler vs.
`async`/`await` sugar), not the array's element type in isolation. Since every real production call site
in this codebase already uses `try await`, the disfavored-overload mechanism itself protects against an
accidental deprecated bind via typing alone -- the danger is a FUTURE call site written in the older,
completion-handler style (easy to reach for when copying an Objective-C-era code sample), which would
silently bind the deprecated pair with no warning strong enough to catch by inspection.

`replaceCredentialIdentities`'s deprecated sibling has a DIFFERENT ObjC selector
(`replaceCredentialIdentitiesWithIdentities:completion:` vs. current
`replaceCredentialIdentityEntries:completion:` -> Swift `replaceCredentialIdentities(_:completion:)`), so
it was not independently probed -- `IdentityStoreSync.swift` types every array as
`[any ASCredentialIdentity]` explicitly regardless, uniformly across all three methods, both for
self-documentation and because the ACTUAL enforcement below does not depend on which method's names
happen to collide.

**Detection method, the one this phase's own `e41-2-build` subcommand
(`scripts/ios-autofill-e41.sh`) makes a standing, falsifiable build gate rather than a one-time read:**
`-Xfrontend -Werror -Xfrontend DeprecatedDeclaration` (Swift 6's diagnostic-group `-Werror`, confirmed
live against this toolchain -- `swift-frontend -help-hidden` lists `-Werror <diagnostic_group>`, and the
`f2` probe above confirmed the group name is exactly `DeprecatedDeclaration`, escalating the warning to a
build error) turns EVERY deprecated-API binding, anywhere in either target -- including a future
completion-handler-style call this landmine's own correction shows is the REAL risk -- into a build
failure naming the file and line. Same shape L-1 and L-7 already belong to (an authoritative-looking
artifact -- here, the plan's OWN prior text, inherited unverified from research -- being wrong about the
thing that matters), now the fourth member of that family, and itself a live instance of the family's own
lesson: verify against the actual compiler, not against what a prior plan asserted.

**Consequence:** the escalated-warnings build remains the correct standing defense (it catches the REAL
trigger, the completion-handler form, which this correction identifies), but the falsification originally
specified by 41-04-PLAN.md's acceptance criteria ("retype one store call's array as the concrete
password-identity element type... observe a non-zero exit") does not itself reproduce a failure under
`try await` and was corrected in 41-04-SUMMARY.md's own deviation record to retype the CALL FORM instead
(completion-handler, not just the array), which does.

### L-34 -- `credentialIdentities(forService:credentialIdentityTypes:)` returns EMPTY on this simulator/toolchain regardless of a confirmed-durable prior write

**Found 2026-08-20, Phase 41, Plan 41-04, Task 2 (E41-2), writing `AutoFillIdentityStoreUITests`'s
own receiver-side proof.** This task's own must_haves name this exact API as the primary
receiver-side proof: "The write is verified on the RECEIVER side:
`credentialIdentities(forService:credentialIdentityTypes:)` is read back and the returned
identity's `user` and `recordIdentifier` are compared character-for-character with what was
written." Live, this session, that read consistently returned an EMPTY array, in every one of the
following isolated variants:

- Read from the HOST APP process, immediately after `saveCredentialIdentities`/`IdentityStoreSync
  .republish` reported `.success` with no error.
- Read from the EXTENSION process (`prepareInterfaceForExtensionConfiguration()`), after the SAME
  host-side write.
- `credentialIdentityTypes: .password` and `credentialIdentityTypes: []` (the Swift spelling for
  "all types" -- `.all` is itself `@available(*, unavailable)` in Swift, `ASCredentialIdentityTypesAll
  = 0` importing as an empty `OptionSet` rather than a named case; confirmed live via
  `swiftc -typecheck`, `error: 'all' is unavailable: use [] to construct an empty option set`).
- `forService: nil` and an EXPLICIT, matching `ASCredentialServiceIdentifier`.
- A poll window of up to 15 seconds (30 attempts x 500ms), ruling out a simple propagation delay.
- A MINIMAL reproduction that bypasses `IdentityStoreSync` entirely -- 41-03's own original,
  proven-working `ASPasswordCredentialIdentity` construction, `[any ASCredentialIdentity]` typing,
  `try await ...saveCredentialIdentities(identities)` call, inline, with nothing else in between --
  ruling out anything `IdentityStoreSync`'s own generalisation introduced.

**The write is independently proven durable and correct**, by the EXACT mechanism this task's own
action text calls for as corroboration -- a REAL system QuickType sheet, driven via Safari on the
same simulator, screenshotted twice with two different, newly-registered discriminator usernames:

1. First check (not separately saved -- superseded by the second, cleaner one below): "Sign in to
   '127.0.0.1' with your password for 'tracer41-03@pv.test' saved in 'PasskeyVault'?" -- an
   identity written by Plan **41-03**, a DIFFERENT session, DAYS earlier, still durably present.
2. `ios/evidence/41/e41-2-quicktype-fresh-write-proof.png`: the SAME check, immediately after
   `ASCredentialIdentityStore.shared.removeAllCredentialIdentities()` followed by a fresh write of
   a NEW discriminator username: "Sign in to '127.0.0.1' with your password for
   'e412-rawminimal@pv.test' saved in 'PasskeyVault'?" -- proving the NEW write (not a cached
   remnant of #1) reached the real store the system's own AutoFill daemon consults.

**Conclusion:** this is a SIMULATOR-SPECIFIC limitation of the modern (iOS 17.4+,
`NS_REFINED_FOR_SWIFT`) read API, not a defect in `IdentityStoreSync`'s write path, and not
something any code in this phase can work around -- there is no alternative read API in
`ASCredentialIdentityStore.h` (the ObjC-refined method is the only enumeration surface). The write
APIs (`saveCredentialIdentities`/`removeCredentialIdentities`/`replaceCredentialIdentities`,
`removeAllCredentialIdentities`) and the SYSTEM's own internal QuickType matching are unaffected --
only the app-facing enumeration call is broken on THIS toolchain (iOS 26.5 Simulator, Xcode 26.6).
Whether this also affects a real device is untested and unknown; `IdentityStoreSync`/
`IdentityStoreSyncProbe` still attempt the read, logged best-effort (`stage=api-readback`), never
gating pass/fail on it, so a real device where the API works correctly would simply show
`status=ok` there without any code change.

**Consequence for this task's own verification:** Task 2's receiver-side proof
(`AutoFillIdentityStoreUITests`) asserts on Safari's OWN QuickType sheet TEXT (captured via the
test process's own accessibility-tree read, printed to STDOUT under a `PVUITEST|E41-2|` marker and
captured in `ios/evidence/41/e41-2-identity-store.log`) rather than the API read this task's own
must_haves originally specified. The exact-equality claim is therefore scoped to the USERNAME (the
one field the QuickType sheet exposes in human-readable text) rather than to BOTH `user` AND
`recordIdentifier` independently -- `recordIdentifier`'s correctness is still exercised internally
(only one `recordIdentifier` was ever written per test run) but not independently re-verified
receiver-side, because no receiver-side surface on this harness can see it. Documented as a
deviation in `41-04-SUMMARY.md`.

### L-35 -- the AutoFill provider's pluginkit USER ELECTION does not survive `simctl shutdown`+`boot`, even though REGISTRATION does; `kern.bootsessionuuid` never changes on this toolchain either

**Found 2026-08-20, Phase 41, Plan 41-06, Task 2 (E41-6), building the cold/offline fill.** Two
separate, load-bearing simulator-honesty findings, both measured directly rather than assumed:

**1. `pluginkit -m -p com.apple.authentication-services-credential-provider-ui` shows the provider
REGISTERED (`cloud.blonie.PasskeyVault.AutoFill(1.0)`, no prefix) but NOT ELECTED (no leading `+`)
immediately after a real `xcrun simctl shutdown` + `boot` cycle, even though the provider was
elected (Settings toggle ON) before the shutdown.** Consequence, confirmed live twice,
reproducibly: a cold Safari drive against the username field never surfaces our suggestion at all
-- the "Passwords" keyboard-accessory action sheet opens once, contains no "PasskeyVault" row, and
on a SECOND retry the "Passwords" button itself has vanished from the accessibility tree
(`AutoFillColdOfflineUITests`'s own `forceTap` throwing "No matches found for Descendants matching
type Button", reproduced twice at the identical line). This is not a UI-timing flake in the test
code -- the identical retry/fallback shape already works reliably in `AutoFillFillUITests`
(41-03), whose host app is always freshly, warmly launched moments earlier; the difference here is
the underlying election state, not the driving code.

**Fix: `xcrun simctl spawn <udid> pluginkit -e use -i cloud.blonie.PasskeyVault.AutoFill`** --
`pluginkit`'s own `-e election` flag ("Perform a matching operation and apply the given user
election setting... Elections can be 'use', 'ignore', and 'default'"), run CLI-only, immediately
after every `simctl boot` this task's own `run_one_cold_cycle` performs. This is NOT the
prohibited "host app launched after boot": `pluginkit` is a system tool, never
`cloud.blonie.PasskeyVault` itself, and the alternative fix (re-running
`AutoFillInvocationUITests`'s Settings toggle) genuinely WOULD launch the host app and void the
cold claim -- exactly the class of CLI-only substitute L-32's own biometric-enrollment fix already
established for a different piece of state lost across the same cycle.

**2. `kern.bootsessionuuid` -- DR-41-C's own chosen boot-identity key (`ios/IOS-SPIKE-LOG.md` §1i)
-- is the HOST MAC's boot session, not a per-simulator-boot value, and does NOT change across
`simctl shutdown`+`boot`.** Measured directly: `xcrun simctl spawn <udid> sysctl
kern.bootsessionuuid` (full path required -- `simctl spawn <udid> sysctl ...` alone reports "No
such file or directory", a separate minor landmine) returned the IDENTICAL UUID before and after a
real shutdown+boot cycle, matching the plain host-side `sysctl kern.bootsessionuuid` exactly. The
unified log stream's own `bootUUID` field (`log show --style ndjson`) confirms the same value.
**This is why `LockMarker`'s pre-shutdown-written marker reads as still valid after this task's
own cold boot** (`bootSessionId` equality holds, `systemUptimeAtUnlock`'s elapsed delta stays
inside the idle window) -- it is NOT evidence that DR-41-C's own stated premise ("a reboot should
end the session anyway") holds on a real device, where a genuine kernel reboot DOES change this
value. 41-06-SUMMARY.md records this honestly rather than letting E41-6's PASS be read as proof of
DR-41-C's cross-reboot design; Plan 41-07's own clock legs (already flagged `[ASSUMED]`/UNVERIFIED
in `ios/IOS-SPIKE-LOG.md` §1i) are the section that must carry this caveat forward, not this one.

**AMENDMENT (`.planning/debug/faceid-relock-loop-bootsession.md`, 2026-08-21) — the real-device half
this finding's own point 2 flagged as unmeasured is now measured, and the inference drawn from the
simulator side alone was wrong.** On a real iPhone 16 (iOS 27), `kern.bootsessionuuid` is not merely
"changes on a real reboot where the simulator's copy would not" (the framing this landmine used) —
it is UNREADABLE from this app's sandboxed process, full stop: `sysctlbyname("kern.bootsessionuuid",
...)` fails on EVERY call, every entry point, confirmed live via `recordHostUnlock()`'s own
`PVLOCK|stage=host-unlock bootSessionId=unknown-boot-session` log line (the pre-fix fallback
placeholder) appearing on every single real unlock in Bartek's device capture. The simulator
resolving this sysctl successfully (to the host Mac's own boot session) was never evidence the
sysctl is READABLE in a real app-extension-style sandbox at all — the simulator process is not
sandboxed the way a real device app is, so this landmine's own point 2 could only ever have measured
"does the VALUE change", never "is the READ even possible", and the two turned out to have different
answers on real hardware. The fix this amendment accompanies
(`.planning/debug/faceid-relock-loop-bootsession.md`, DR-41-C's own §1i amendment above) makes
`LockMarker.bootSessionId` optional and treats an unreadable boot leg as a missing input, never a
verdict — see that record for the full mechanism and the fix.

### L-36 -- `TEST_RUNNER_<VAR>` does not reach the XCTest UI-runner process on this toolchain; `xcodebuild test`'s per-run env-var passthrough for XCUITest scenario switching does not work the way its name implies

**Found 2026-08-20, Phase 41, Plan 41-07, Task 2 (E41-4).** `xcodebuild test ... TEST_RUNNER_PV_UITEST_E41_4_EXPECT=expired` is Apple's documented mechanism for injecting an env var into the XCTest RUNNER process (distinct from `XCUIApplication.launchEnvironment`, which only reaches the LAUNCHED APP under test, not the test bundle's own process) — the naming and Apple's own docs both say this SHOULD let one test method branch its own assertion per invocation. Measured directly: a test method that read
`ProcessInfo.processInfo.environment["PV_UITEST_E41_4_EXPECT"]` and branched its own `XCTAssertEqual` unconditionally took the SAME branch (the default/unset one) regardless of the `TEST_RUNNER_` override, confirmed by an isolated single-scenario run whose failure message named the WRONG expected value for the override that was supposedly in force.

**Fix: two separate, compile-time-distinct test methods instead of one method switched by an environment variable.** Costs nothing structurally (this file's own E41-7 methods were never driven by a runtime switch in the first place) and sidesteps the whole class of problem — no reliance on an env-var passthrough mechanism this toolchain does not honour for XCUITest bundles. Filed here rather than silently worked around so a future plan does not rediscover the same false assumption; `AutoFillLockUITests.swift`'s own header records the same finding at the call site.

### L-37 -- a single large `Thread.sleep` between two extension-only fills can overshoot the REFRESHED idle window, not just the original one, on its own UI-driving overhead

**Found 2026-08-20, Phase 41, Plan 41-07, Task 3 (E41-7's ACC-07 leg).** With a 60s (1-minute) idle window, a design of "fill once, sleep 65s (past the original window), fill again" is fragile: the SECOND fill's own Safari-driving overhead (navigation, the "Fill Password" confirmation-sheet negotiation, settle margins — empirically ~15-20s on this toolchain) is incurred AFTER the sleep, so the actual lazy-check moment lands at `sleep + overhead` past the FIRST fill's own refresh, not merely `sleep` past it. Measured directly: a 65s sleep plus ~18s of overhead put the second check 83s after the refresh — past even the REFRESHED 60s window — producing a live, reproducible FALSE refusal (`stage=lazy-check status=expired`) that said nothing about ACC-07's real behaviour; the extension's own log showed the correct mechanism working (the marker genuinely had expired by then), the TEST's OWN timing was simply wrong.

**Fix: several smaller hops instead of one big jump.** Three fills with ~25s sleeps between them (each individual gap comfortably under the 60s window on its own) reach the same "past the original window" destination — cumulatively, over the whole sequence — with much wider margin per hop, and are correspondingly more robust to run-to-run timing variance (VM scheduling jitter, simulator load). Any future live proof of an idle-window boundary should default to this shape, not a single sleep sized to "idle window + a safety margin."

### L-38 -- a bare, additive, single-item `IdentityStoreSync` incremental registration for a BRAND-NEW host does not reliably propagate to QuickType, even across 4 retried fresh-Safari-relaunch attempts (24s cumulative); the SAME registration shape for an ALREADY-ESTABLISHED host propagates on the first attempt

**Found live 2026-08-20, Phase 41, Plan 41-08, Task 1 (E41-8/FILL-04), building the third-party-domain fill.** This adds direct, reproducible evidence to E41-3's own unresolved "Falsification 3" finding (`ios/evidence/41/e41-3-matching-matrix.md` §"What this does NOT settle": *"Why the additive, single-identity `saveCredentialIdentities` call ... was never observed to produce a suggestion, in contrast to the batch `removeAll + save` registration that did. Not isolated to a single cause."*).

**What was measured:** `TracerFillSeeder.seedThirdPartyDomain()` registers ONE new item via `IdentityStoreSync.republish(sources: [item])` — production's own single-item incremental path (`state.supportsIncrementalUpdates == true` this session, confirmed in the extension's own log, `PVFILL|E41-2|stage=state supportsIncrementalUpdates=true`), which for a first-time item resolves to a bare `saveCredentialIdentities([identity])` call with no preceding `removeAll`.

- **Against a brand-new host never before registered on this simulator** (`e418-outside-vendor.localhost`), the identity was never offered: 4 retried attempts, each a fresh Safari relaunch and re-navigation, with 0s/4s/8s/12s waits between them (24s cumulative), all showed `reason=no-fill-suggestion-surfaced` — neither the direct single-suggestion sheet nor the "Passwords" keyboard-accessory row ever appeared. The extension's own `os_log` stream shows **zero** fill-entry-point activity across the whole run (`grep -E 'entry=silent|entry=interactive'` — no matches), confirming this is a suggestion-layer non-appearance, not a fill-time refusal.
- **Against `127.0.0.1`** — the SAME host `TracerFillSeeder.seed()`'s own tracer item has been registering into, repeatedly, across every prior plan in this phase — the identical registration shape (single-item, incremental, no preceding `removeAll`) propagated on the FIRST attempt, no retry needed, confirmed both by the real "Fill Password" sheet appearing and by the extension's own `PVFILL|entry=silent stage=fill status=ok` log line.

**Working theory, NOT independently isolated (same honesty discipline E41-3's own matrix used):** the system's suggestion index may treat a host it has never seen a registered identity for differently from a host it already has churn on — e.g. a first-ever registration for a genuinely novel host might need the FULL/replace path (`replaceCredentialIdentities`) to enter the index promptly, while an incremental add against an already-indexed host reuses existing index structure. This was not tested with a controlled A/B (same fresh host, once via `replaceCredentialIdentities`, once via `saveCredentialIdentities`) — flagged as an open question for Phase 42's audit, same as E41-3's own Falsification 3.

**Consequence for any future plan registering a vault item's FIRST identity at a brand-new host via `IdentityStoreSync`:** do not assume immediate QuickType availability; either reuse an already-established host for time-sensitive evidence work (this plan's own fix), or budget for an unbounded propagation delay and design the evidence capture around it, never around a fixed retry count. **Do not change `IdentityStoreSync.swift` itself to always use the full-replacement path** as a workaround without first properly isolating this — that would be a production behaviour change reaching every mutation call site (create/update/delete/sync-pull) on the strength of one demonstration task's own workaround, not a decision this plan is scoped to make.

### L-39 -- git hooks are shared between worktrees

**Numbering note (same reason as L-12's/L-15's/L-33's):** 42-02-PLAN.md's own text names this
landmine "L-9". That ID was already claimed by an unrelated defect from an earlier phase
(`ios/IOS-SPIKE-LOG.md`, "a check that cannot fail" produced FOUR more instances in a single
phase"). It is recorded here as **L-39**, the next free ID after L-38, rather than as a duplicate
L-9 -- two landmines sharing one number breaks every future cross-reference by that number.

**Found 2026-08-20, Phase 42, Plan 42-02.** A `pre-commit` hook written to stop THIS worktree
(`ios/spike`, `commit_docs: false`) from committing `.planning/` fires for the `main` worktree too,
whose entire v0.5 autonomous session commits `.planning/` legitimately and continuously — because
`git rev-parse --git-path hooks` resolves to the **common** directory shared by every worktree of a
repository, not a per-worktree one. A hook naive to this (rejecting any staged `.planning/` path
outright) would break `main`'s live session mid-run the moment it was installed.

**Why:** the hooks directory is the common one (confirmed: `git rev-parse --git-path hooks` from
both worktrees resolves to the identical path under `main`'s `.git/`). The per-worktree
alternatives that would avoid this are all repository-wide mutations of their own: `core.hooksPath`
and `extensions.worktreeConfig` both apply repo-wide, not per-worktree, so "just point each
worktree at its own hooks dir" is not actually available without a shared-state change of the exact
kind this plan's own prohibitions forbid.

**How it was avoided here:** configuration-driven discrimination. The hook delegates to
`gsd-tools query check-commit`, which reads `.planning/config.json`'s `commit_docs` key — `false`
here, `true` on `main` — and is a no-op on `main` **by that value**, not by inspecting which
worktree it is running in. Proven by direct execution, not by argument: the guard was run with
`main`'s worktree as cwd and shown exiting 0 with reason `commit_docs_enabled` BEFORE the hook file
was ever written (E2(a)), and the installed hook file itself was then executed directly (no git,
`main` as cwd) and shown exiting 0 (E2(b)), re-confirmed after install.

**Warning sign:** any hook — for this repository or a future one with the same worktree layout —
that branches its behaviour on branch name, worktree path, or a `$PWD` string match. That shape
cannot generalise to a hooks directory shared by worktrees it does not know about in advance, and
is the exact defect class this landmine documents avoiding.

### L-40 -- "a missing input classified as a verdict" is now a TWICE-recurring defect shape in the
### lock-session subsystem alone, at two different layers of the same computation

**Found 2026-08-21, `.planning/debug/faceid-relock-loop-bootsession.md`, the SECOND Face-ID relock
loop root-caused in this subsystem in as many days.** d8d9c9b (`.planning/debug/faceid-unlock-loop.md`,
2026-08-20) fixed `checkAndExpireIfNeeded` collapsing its own tri-state `LockState`
(`.unlocked`/`.expired`/`.indeterminate`) to a `Bool` at the ROUTING layer — an unreadable marker
(`.indeterminate`, a missing INPUT to the routing decision) was treated identically to a genuine,
evaluated `.expired` verdict, and both drove `performLock()`. This debug session found the
IDENTICAL shape one layer INSIDE that same function, at the INPUT to `LockState` itself: a `nil`
`LockMarker.currentBootSessionId()` (a missing input to the boot-identity comparison, real on
hardware where `kern.bootsessionuuid` is unreadable) was treated identically to a genuine,
both-sides-present mismatch, and both produced a positive `.expired` verdict. Same class of bug,
same subsystem, same symptom (an infinite Face-ID relock loop), found and fixed twice, one layer
apart, within 24 hours.

**Why this recurred instead of being caught once:** the first fix's own review discipline
(WR-03/REQUIRED FIX #1, `.planning/debug/faceid-unlock-loop.md`) explicitly named the PRINCIPLE
("failing CLOSED on an unreadable marker ... is correct; DELETING the key artifact on an
inconclusive read is not") but the fix itself was scoped to the ONE call site that principle was
found to be violated at (`checkAndExpireIfNeeded`'s own return value). The principle was never
generalised into a standing check applied to every OTHER place in the same function (or file, or
subsystem) where an `Optional` result feeds a binary decision — `currentBootSessionId()`'s own `nil`
case, sitting three lines below the exact code the first fix touched, was not re-examined against
the very principle that fix had just established.

**The generalisable check, named so it can be applied prophylactically rather than rediscovered a
third time:** wherever a function returns `Optional` (or any tri-state/richer type collapsing to
"unknown"), and that result feeds a binary/verdict-producing decision, ask explicitly: **does the
"could not determine" case take the SAME branch as either genuine outcome, or does it have its own,
distinct handling?** If a missing input silently rides along one of the two positive branches,
that is this defect shape, regardless of which layer of the computation it occurs at. Both
instances in this subsystem were caught only by a REAL device log — neither was caught by review,
by a type system (both were `Bool`/`String`, not `Optional`/enum, until each fix made them so), or
by a test (the simulator cannot reproduce either: `.indeterminate` requires an unresolvable App
Group, `nil` boot-id requires a real device sandbox — neither exists on the simulator, L-35's own
finding above). The recurrence guard is now `Optional<String>` on `bootSessionId` itself plus the
two DEBUG-only force-unavailable test seams (`forceSharedContainerUnresolvableForTesting`,
`forceBootSessionIdUnavailableForTesting`) that make BOTH missing-input cases deterministically
reproducible without real hardware — see `LockMarkerTests.swift`'s own coverage of both.

**Also examined from the same live device log, recorded rather than left to ride along silently
(orchestrator's own instruction):**

1. **`PVFILL|E41-2|stage=build-identity status=skipped-unparseable-url` ×5 on every republish.**
   Live-probed `OriginNormalize.host(fromURLString:)` against every realistic input this line can
   see: bare host, `host:port` (WR-04's own fix, already correct), an IP and IP:port, `mailto:` —
   all parse correctly. The cases that legitimately return `nil` are NOT parser bugs: an empty/blank
   URL on a `.login` item (`identitySources(from:)`, `VaultStore.swift`, already excludes every
   other content case — `.note`/`.totp`/`.card`/`.identity` — upstream, so a blank-URL skip here is
   specifically a login item with no URL filled in) and a non-http(s) custom URL scheme with no
   domain-shaped authority (`otpauth://`, `steam://`, a bespoke app callback) that could never be an
   `ASCredentialServiceIdentifier(type: .domain)` in the first place — and `.totp` items never even
   reach this code path (filtered upstream by content case, confirmed by reading `ItemFields.swift`).
   Both are routine, not defects. **Fixed:** `IdentityStoreSync.swift`'s own log line downgraded
   `.log` → `.debug` — still diagnosable, no longer reading as if 5 of Bartek's 323 real items were
   silently failing something.

2. **`republish status=ok count=323 mode=incremental` on EVERY foreground transition, resaving all
   323 identities each time.** Read `IdentityStoreSync.republishIncremental` in full: it already
   diffs REMOVALS correctly (`previousKeys.subtracting(desiredKeys)`, only removing what actually
   disappeared) but unconditionally calls `saveWithRetry(desired)` with the ENTIRE current set
   every time, never computing the SAME diff (`desiredKeys.subtracting(previousKeys)`) on the
   ADD/SAVE side — the infrastructure for a cheap fix already exists (the `PublishedKey` `Set`
   this file already persists), the diffing logic is a straightforward mirror of what removals
   already do, and `PublishedKey` already deliberately excludes `rank` from identity (this file's
   own doc comment), so the same exclusion applies consistently on both sides. **Not implemented in
   this debug session**, deliberately: zero existing unit-test coverage exercises
   `republishIncremental` at all (`ASCredentialIdentityStore.shared.state().isEnabled` is false in
   every unit-test process, confirmed by reading `IdentityStoreSyncPendingFlagTests.swift`), so
   verifying a change here safely requires a full live `AutoFillIdentityStoreUITests`/E41-2 harness
   run, which this session's own scope (the relock loop) did not warrant extending into. Filed here,
   with the exact fix shape identified, as a scoped candidate for a future dedicated plan — not a
   silent omission.

3. **Favicon fetch to `https://192.168.9.4/favicon.ico` fails with "Local network prohibited".**
   `FaviconLoader.swift`'s own header already documents this class of failure as expected and
   silent (falls back gracefully, `favicon(forHostname:)`'s own doc comment: "a missing/broken
   favicon is an entirely expected, silent case"). A self-hosted vault reachable only via a LAN IP
   will always hit this without the Local Network permission — a known, inherent limitation of
   fetching favicons for LAN-only hosts on iOS, not a new defect. Filed as a known limitation per
   the orchestrator's own instruction; not chased further this session.

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

### CORRECTION, 2026-08-20 — the membership was purchased; the §3b hardware block on
### `autofill-credential-provider` is retired; a DIFFERENT, narrower App-Group question opened and
### was then itself corrected mid-investigation

**[OBSERVED, root-caused live during `.planning/debug/faceid-unlock-loop.md`.]** Bartek purchased the
paid Apple Developer Program membership. This section amends §3b in this repo's own established
CORRECTION style (see the 2026-08-17 block immediately above) — the original text is not deleted.

**The membership took effect.** Decoding the three profiles actually issued to Bartek's machine
(`~/Library/Developer/Xcode/UserData/Provisioning Profiles`, `security cms -D -i <file> | plutil
-extract Entitlements xml1 -o - -`) on 2026-08-20 shows:

| Profile | `autofill-credential-provider` | `application-groups` | Expires |
|---|---|---|---|
| `cloud.blonie.PasskeyVault` | **PRESENT** | **PRESENT** (`group.cloud.blonie.PasskeyVault`) | 2027-08-17 |
| `cloud.blonie.PasskeyVault.AutoFill` | **PRESENT** | **PRESENT** (`group.cloud.blonie.PasskeyVault`) | 2027-08-17 |
| `cloud.blonie.PasskeyVaultUITests` | n/a (no capabilities requested) | n/a | 2027-08-17 |

**A year-long expiry on all three, matching this section's own free-team/paid-team diagnostic
(§3b above: "a 7-day profile expiry is the free-team signature") — the paid membership is
confirmed active.** `autofill-credential-provider` is granted on BOTH the host app's App ID and
the extension's App ID. **The §3b hardware block on AutoFill device proof is retired** — Phase 41
(cross-process ACC-06/ACC-07) and Phase 43 (conditional passkeys) may now plan real device proofs
against this membership; neither is blocked on entitlement issuance anymore.

**A narrower question was opened, live, mid-investigation, by the debugging session's own
orchestrator: that `application-groups` was ABSENT from these same three profiles.** This section
corrects that claim, in the same spirit §3b's own 2026-08-17 block corrected an earlier inference:
independently re-running the exact decode command above, TWICE, against the profile files actually
on disk (mtime 2026-08-17 22:06 — the same timestamp the orchestrator's own investigation cited),
`application-groups` reads as **present**, not absent, on both App IDs, with the correct group
(`group.cloud.blonie.PasskeyVault`) listed. The `.entitlements` files in this repo
(`PasskeyVault/PasskeyVault.entitlements`, `PasskeyVaultAutoFill/PasskeyVaultAutoFill.entitlements`)
are, as of this same session, in their FULL, non-stripped state — `git diff` against both is empty —
requesting all three capabilities (`autofill-credential-provider`, `application-groups`,
`keychain-access-groups`) exactly as committed.

**Why the debug session's own orchestrator reported the opposite is not established, and is
recorded honestly as unresolved rather than silently reconciled:** the two most likely
explanations — (a) the App Groups capability was added for both App IDs in the Apple Developer
portal, and Xcode silently re-fetched corrected profiles at some point between the orchestrator's
own check and this one, coincidentally landing on the same on-disk mtime because Xcode preserves a
profile's original mtime on re-download; or (b) a transcription error in the orchestrator's own
diagnosis — are both plausible and neither was distinguished. **This does not weaken the debug
session's actual root cause or its fix.** The code-level defect this session addresses — a lazy
lock-state check collapsing "cannot determine" and "positively expired" to the same routing
decision, a per-view `@State` auto-prompt guard that a wrong relock's own remount defeats, and
`LockMarker` having no fallback when its shared container is unresolvable for ANY reason — was
confirmed independently of provisioning-profile specifics: by a full, line-by-line read of the
production source, AND by a live simulator reproduction using a deterministic, software-only "force
the shared container unresolvable" hook (`LockMarker.forceSharedContainerUnresolvableForTesting`,
DEBUG-only) that does not depend on, or make any claim about, which capability is or is not present
in a given provisioning profile. Whatever DID cause `LockMarker.read()` to return `nil` on Bartek's
device on 2026-08-20 — a stale build predating a portal capability fix, a transient App Group
resolution failure, or something not yet identified — the fix holds for all of them, because it
never depends on WHY the container was unresolvable, only on the fact that it was.

**Open item, narrower than before:** whether the SPECIFIC build that produced the observed loop was
built against a provisioning profile missing `application-groups` (now fixed, would not recur on a
fresh build) or something else entirely is unresolved. A real device build+run (out of scope for
this debug session — the rules governing it required simulator-only work and forbade touching
Bartek's real device/vault) is the only way to close this specific question. It does not block
Phase 41/43 device planning, which rests on `autofill-credential-provider` being granted (settled,
above) and on this session's own code fix (settled, `.planning/debug/faceid-unlock-loop.md`).

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
- ~~**The iOS 18 dock fallback (`AvailableFallbackCreateButton`) has never been on a screen.** This
  machine has exactly one simulator runtime installed (`iOS 26.5`); the fallback code path is a
  signature argument (it compiles against the SDK's own `@available` guards), not a picture. Recorded
  as untested, not as working.~~ **CLOSED, Phase 44 (`DR-44-A` item 4, `ios/IOS-SPIKE-LOG.md` §1o):**
  no longer applicable, not finally tested — the deployment floor raise to iOS 26.2 (Plan 44-01)
  deleted this type entirely; it is provably unreachable on any OS version this project now supports.
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
- ~~iOS 18 dock fallback — untested (no iOS 18 runtime on this machine), see proof limitations above.~~
  **CLOSED, Phase 44 (`DR-44-A`):** no longer applicable — the type is deleted, the fallback branch is
  provably unreachable once the deployment floor is 26.2.
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
  **CLAIMED — Plan 41-07, Task 1 (2026-08-20):** moved to `Shared/` (App-Group-backed, was
  `UserDefaults.standard` — genuinely NOT shared between the host app and the extension even under
  the App Group entitlement) and wired as `SessionLifecycle.configuredIdleWindowSeconds()`'s source
  for ACC-06's own idle window, in both processes. Still no settings UI to CHOOSE the value
  (`AutoLockPolicy.write` remains callable/tested with no call site) — that half stays open, out of
  this plan's own scope; see `41-07-SUMMARY.md` "Known Gaps".

## 9. Plan 40-10 closing note — DR-40-B is now IMPLEMENTED, not merely decided (2026-08-19)

`ResealService.swift`/`ResealTrigger.swift` (`Sharing/`) port `web/src/lib/families/reseal.ts`/
`resealTrigger.ts` in full — DR-40-B's own invariant list (§1h above) is now backed by production
code, not a plan-set forward reference. `ResealTrigger` is a Swift `actor`: the reference's own
"claim every fresh pair SYNCHRONOUSLY, before the first `await`" property is not a discipline this
port could get wrong — it is Swift's actor reentrancy model, structurally. Verified by falsifying
it: moving the claim to after an inserted `await` turned the concurrency test RED (two attempts,
two grant requests, instead of one); reverted.

**Production wiring, so a future reader does not have to hunt for it:** `SyncCoordinator.pull()`'s
`fireResealTriggerIfPossible()` is the ONE call site — fire-and-forget (`Task { ... }`, never
awaited by `pull()`'s own return), fetching `family_wide_pending` itself via the existing
`SharedItemsStore.fetchFamilyWidePending` (one query, two consumers — `PendingKeyState`'s `missing`
axis is the other, STILL not wired into any view as of this plan, same "built, not yet surfaced"
precedent 40-05/40-09 already left). `resetAttempts()` is called from both `SyncCoordinator
.start(...)` (unlock) and `.stop()` (lock).

**E-F6, live, roles swapped from E-F4b (40-09):** a web account joined the family before iOS
created a family-wide collection at `family_wide_access_level="read"` while iOS's own creator row
was the server's hard-coded `"edit"` — the exact level-mismatch fixture T-40-43 targets. Unlocking
was represented by invoking the PRODUCTION `ResealTrigger.run`/`ResealService.reshareCollection`
directly (the exact call `fireResealTriggerIfPossible()` makes) — a stronger substitution than
every prior Phase 40 live run, each of which reimplemented the reseal composition as test-only code
because no production caller existed yet. Result: `collection_keys` row created where none existed,
`missing` went non-empty→empty, the web member decrypted the real collection name and item,
delivered level was `"read"` (never iOS's own `"edit"`), and the same probe ciphertext opened under
both iOS's original key and the web member's newly-recovered one. Evidence:
`ios/evidence/40/40-10-ef6-transcript.txt`, `40-10-ef6-web-before.png`, `40-10-ef6-web-after.png`.

## 8b. Phase 40 — human-verify backlog (2026-08-20, orchestrator disposition)

`40-VERIFICATION.md` closed 6/6 after one gap-closure cycle (recipient-delivery render bug
root-caused to body-time store construction; web-side invite redemption proven through real
pv-wasm). Items still owed to a human:

1. **ShareLink control labelled "Skopiuj"** while it opens the system share sheet — copy-vs-share
   wording call (InviteCreateView).
2. **WR-19's reseal-cancellation race half** — the fixer's own flag: cancel-on-lock behavior under a
   mid-flight reseal is timing-dependent and was not driven both ways in a live run.
3. **Family-surface visual conformance sweep** vs ios/brand/screens-vault.html — incl. the
   singleton-family 409 alert (never rendered on a screenshot) and roster/invite screens.

## 8c. Phase 41 — human-verify backlog (2026-08-20, orchestrator disposition)

`41-VERIFICATION.md` closed 5/5 at HEAD d0c3916 (all four live legs re-driven post-fix). Owed to a
human / later phases:

1. **W-1 (pre-release only):** `IdentityStoreSync.readPublishedKeySet()` reads a LEGACY (pre-.v2)
   published-keys blob as empty, so identities published before the format bump survive every
   republish as un-removable QuickType entries until the container is cleared. Narrow, but the live
   effect is an immortal stale suggestion — fix or wipe-on-migrate before any TestFlight build.
2. **T-41-23 / WINDOWS #17:** fill-time origin equality for `.domain` identities is structurally a
   data-integrity check (system API echoes the registered identity, never the visited page) —
   unmitigated, recorded in DR-41-B's CORRECTED FINDING.
3. **WINDOWS #18:** `prepareCredentialList`'s gate never observed firing live (standing capture wired).
4. **CR-04 sleep-clock empiricism:** mach_continuous_time chosen on xnu-header analysis; a real
   device sleep cycle has never exercised the idle window / 12h ceiling.
5. **FILL-02's app half:** every proven fill is Safari `.domain`; filling into another APP's login
   form was never exercised (no SUMMARY overclaims it).
6. **39-evidence regression → Phase 42:** `SyncDecodeTests.decoding*Body()` are RED at HEAD because
   Phase 40's 6701e61 overwrote `ios/evidence/39/01-server-contract.md`'s fenced JSON bodies (tests
   parse an evidence file that live scripts rewrite — a coupling Phase 42's audit must break).

## 10. Phase 42, plan 42-03 — FFI gate composition, WR-05 closed by construction (2026-08-21)

`scripts/check-ios-gate.sh` gained three sub-gates composing Phase 35's two already-falsifiable FFI
gates (`scripts/build-ios.sh` plain + `--verify-falsifiable`, and
`scripts/audit-ffi-opaque-handles.sh`) — `gate_ffi_build`, `gate_ffi_falsifiable`, `gate_ffi_opaque` —
appended to the composer's `GATES` array after `qa05`. All three invoke the existing scripts (`bash
<script>`), never reimplement their logic: `grep -c 'scripts/build-ios.sh'` and `grep -c
'scripts/audit-ffi-opaque-handles.sh'` over the composer both confirm real invocation counts, and
`grep -v '^\s*#' | grep -c vtool` over the composer is `0` — the slice-check logic lives in exactly
one place.

**The hole this closes (35-REVIEW.md WR-05), by construction, not by discipline.**
`audit-ffi-opaque-handles.sh` audits whatever generated Swift bindings an EARLIER build happened to
leave on disk under `ios/**/build/` (gitignored) — nothing stopped a stale-bindings PASS if a raw-byte
accessor were added to `crates/pv-ffi/src/` without rebuilding. `gate_ffi_opaque` now asserts,
POSITIVELY and BEFORE consulting the audit's verdict, that the generated bindings file exists, is
non-empty, and that no `*.rs` under `crates/pv-ffi/src/` is newer than it (`find ... -newer ... -print
-quit`, never `find | head` — the same SIGPIPE-under-`set -euo pipefail` reason `build-ios.sh`'s own
`extract_pv_ffi_object` documents). A stale-bindings state is now `exit 1` naming the specific newer
source file, not a silent pass-through to the audit.

**Falsification, both at the composer's own `--verify-falsifiable` level (zero mutation — every
sub-gate's path is overridable via an env var, mirroring `gate_qa05`'s own `QA05_CONTROL_PATH`
idiom) and, separately, against the REAL artifacts (Task 2's four mutations, transcripts in
`42-03-SUMMARY.md`):**

- **M1 — missing prerequisite.** `PvFfi.xcframework` moved aside; `--only ffi_falsifiable` failed
  non-zero, naming the ordering dependency ("the ffi_build sub-gate ... must run first"); restored,
  green.
- **M2 — stale bindings, the WR-05 hole itself.** `crates/pv-ffi/src/lib.rs` touched (mtime only, no
  rebuild); `--only ffi_opaque` failed non-zero, naming the specific stale file and stating the
  audit's verdict would be about code no longer there — the assertion that distinguishes this
  composer from simply calling the audit script. Rebuilt, green.
- **M3 — a real opaque-handle violation.** A raw-byte accessor (`temp_leak_raw_bytes`) added to `impl
  FfiUserKey`, same shape 35-04/40-04 used; full gate failed non-zero, naming `ffi_opaque` and
  quoting the generated Swift declaration (`open func tempLeakRawBytes() -> Data {`). Reverted via
  `git checkout --`, confirmed by `git diff --stat` (empty, not by eye), rebuilt, green.
- **M4 — the slice gate.** `gate_ffi_falsifiable` delegates to `build-ios.sh --verify-falsifiable`,
  already self-falsifying (both vtool slice halves + the WR-03 pv-ffi-object guard); captured within
  every full composer run above. Inherited coverage, not newly proven by this plan — and the device
  slice's own half of it (35-REVIEW.md WR-10) has never itself been demonstrated able to fail, a gap
  this plan does not close (recorded for 42-06's register, per DR-42-A: this phase's audit finds and
  records, it does not repair `build-ios.sh`/`audit-ffi-opaque-handles.sh`'s own open findings).

Full gate (`bash scripts/check-ios-gate.sh`) verified green end to end both before and after every
mutation, `git rev-parse HEAD` unchanged across the whole task (`0cca540...`), and `git diff --stat --
scripts/build-ios.sh scripts/audit-ffi-opaque-handles.sh` empty throughout — neither pre-existing gate
script was touched. Full transcripts:
`.planning/phases/42-standard-dowodu-bramka-qa-i-ci-dla-ios/42-03-SUMMARY.md` (not committed from this
worktree, per the standing QA-05 convention this record itself documents).
7. §3b hardware block stands: all AutoFill proof is simulator-only until the paid membership.

### L-41 -- a plain-to-panic-probe pv-ffi bindings TRANSITION fails the FIRST `xcodebuild test` attempt, always succeeds on an immediate retry

**Found 2026-08-21, Phase 42, Plan 42-04, Task 2/3, empirically, reproduced three times.** `gate_ffi_build`
(scripts/check-ios-gate.sh, 42-03) runs `scripts/build-ios.sh` PLAIN (no `--with-panic-probe`) --
`ios/PasskeyVault/build/swift-bindings/pv_ffi.swift` on disk afterward carries NO
`ffi06SyntheticPanicProbe` symbol (confirmed: `grep -c ffi06` on the freshly-written file is 0).
`PasskeyVault.xcodeproj`'s own "Build pv-ffi XCFramework" Run Script phase then runs AGAIN, automatically,
the moment ANY `xcodebuild` invocation builds the `PasskeyVault` scheme's Debug configuration -- and
that phase's own script content (`38-01`'s own `$CONFIGURATION`-derived logic) appends
`--with-panic-probe` on Debug, regenerating the SAME shared bindings path WITH the symbol this time.
An `xcodebuild test` invoked immediately after `gate_ffi_build` (i.e. exactly the sequence the composed
`bash scripts/check-ios-gate.sh` runs, `ffi_build` before `swift_tests`) fails ON THE FIRST ATTEMPT with:
```
Cannot find 'uniffi_pv_ffi_checksum_method_ffiuserkey_ffi06_synthetic_panic_probe' in scope
Testing cancelled because the build failed.
```
even though the regenerated header (`ios/PasskeyVault/build/PvFfi.xcframework/ios-arm64-simulator/Headers/pv_ffiFFI.h`)
was independently confirmed, by direct `grep`, to declare that exact symbol correctly by the time the
build fails -- the artifact on disk is right; the build that just failed did not see it. An IMMEDIATE
retry of the exact same `xcodebuild test` command, no changes, succeeded every time (3/3) in this
session, in well under 30 seconds. This reads as an Xcode incremental-build/module-cache staleness
artifact specific to the bindings-VARIANT TRANSITION itself (plain -> panic-probe, both writing the
SAME shared output path -- `scripts/build-ios.sh`'s own documented "whichever variant ran last wins"
limitation, see that script's header), not a real defect in the FFI boundary, the generated bindings,
or the test files. Root cause not fully identified (no clean way to inspect Xcode's own module-cache
invalidation decision from outside); the empirical retry-recovers-100%-of-the-time signature is the
only thing this session could establish with confidence.

**Consequence:** `gate_swift_tests` (scripts/check-ios-gate.sh, 42-04) retries the `xcodebuild test`
invocation EXACTLY ONCE, and ONLY when the failure log contains the literal string `Testing cancelled
because the build failed` -- Xcode's own phrase for a build failure, which a genuine TEST-assertion
failure (the kind 35-VERIFICATION.md's own mutation testing produced, exit 65 with named failing test
cases) never prints. This is a narrow, evidence-scoped retry, not a blanket retry-until-green: a real
compile error in `crates/pv-ffi` or the Swift test files reproduces on the retry too and still fails
the sub-gate. Any future caller chaining a plain `scripts/build-ios.sh` run immediately before an
`xcodebuild test` invocation of the `PasskeyVault` scheme's Debug configuration should expect this same
first-attempt failure and either retry once with the same narrow signature check, or insert a
`--with-panic-probe` (or otherwise matching-variant) rebuild between the two steps to avoid the
transition entirely.

### L-42 -- `declare -A` silently mis-parses under macOS's stock bash 3.2, throwing "unbound variable" on a word INSIDE the key string

**Found 2026-08-21, Phase 42, Plan 42-05, Task 1, empirically, while writing `scripts/qa-audit-
inventory.sh`.** Every other gate script in this repo (`scripts/check-ios-gate.sh`,
`scripts/audit-ffi-opaque-handles.sh`, `scripts/build-ios.sh`) avoids `declare -A` entirely; this
plan discovered why. `/usr/bin/env bash` on this machine resolves to `GNU bash, version
3.2.57(1)-release (arm64-apple-darwin25)` -- Apple has shipped bash 3.2 as the system bash since
GPLv3 licensing changes in 2007 and has never updated it; associative arrays (`declare -A`) are a
bash-4.0+ feature. A `declare -A` whose key string contains a space or a parenthesis does not error
at the `declare` line itself -- it fails LATER, at first use, with a message naming an unrelated WORD
FROM INSIDE the key string as an "unbound variable":

```
$ bash -c 'set -euo pipefail
declare -A GUARD_PATTERNS=(
  ["slice gate (scripts/build-ios.sh)"]="build-ios"
)
echo done'
bash: line 1: gate: unbound variable
```

The error names `gate` (a word from inside the key `"slice gate (scripts/build-ios.sh)"`), which
reads exactly like a real unset-variable bug in unrelated code, not a keyword/version mismatch --
this is the trap. No `bash --version` check, no `shopt` probe, and no syntax highlighter catches it;
`bash -n` (syntax-only check) also passes cleanly, since the parse is syntactically valid bash-3.2
grammar, just not the grammar the author intended.

**Fix used:** parallel indexed arrays (`GUARD_NAMES=(...)` / `GUARD_REGEXES=(...)`, same index) instead
of one associative array -- works identically on bash 3.2 and any later bash, and is the pattern this
repo's other gate scripts already use without anyone having needed to write this down before now.

**Consequence:** any FUTURE gate script in this repo that reaches for `declare -A` for a "self-control"
lookup table (the `EXPECTED_CLASSES`/`GUARD_PATTERNS` shape this phase's own scripts use repeatedly)
should use parallel indexed arrays instead, or explicitly shebang `#!/opt/homebrew/bin/bash` /
equivalent AND verify that path exists on the target machine before relying on bash-4+ features --
this machine has no Homebrew bash installed today (`which -a bash` -> `/bin/bash` only).

## 8d. Phase 42 — human-verify backlog (2026-08-20, orchestrator disposition)

`42-VERIFICATION.md` closed 10/10 must-haves with the verifier re-running every gate, independently
falsifying the register gate on scratch copies, and spot-checking 10 register rows across phases
36-41 (zero overstatements found). Owed to a human:

1. **L-14 IS THE MILESTONE'S SHIP BLOCKER AND IT IS BARTEK'S CALL.** Re-probed live twice today:
   `xcodebuild -configuration Release` still exits 65 with the same `swift-frontend` infinite
   recursion (`EarlyPerfInliner` on `UniffiHandleMap…deinit`, pass #982547) as the 2026-08-16
   finding. Phase 42 discharged its own obligation by recording it unsoftened — DR-42-C decided
   "record, don't repair" BEFORE the audit, and no `-Onone` workaround was committed. But every one
   of the register's 150 evidence rows is Debug-only, so the product cannot ship until one of
   L-14's three recorded options is chosen (bump the UniFFI pin; isolate the generated bindings into
   their own `-Onone` module; report upstream + pin the toolchain).
2. **F-1 (verifier's own new finding, warning):** `git archive HEAD` into a scratch tree makes
   `check-ios-gate.sh` exit 1 — 139 of 267 register refs point into `.planning/`, which QA-05
   forbids committing. So "one command runs every gate green" is true in this worktree and FALSE on
   the committed branch. It fails loudly, never vacuously, but it compounds H-04: the composer is
   not merely un-wired to CI, it is currently un-wirable without either committing `.planning/` or
   re-anchoring those refs at committed artifacts (`ios/evidence/`, `ios/IOS-SPIKE-LOG.md`).
3. **Three unclaimed gap rows** (H-04, H-08, H-10) — each carries a reason, which satisfies 42-07's
   own prohibition on parking work, but they are homeless now that Phase 43 is decision-gated.
4. **Gap #25:** the disclosed `.domain` fill-time limitation (WINDOWS #17) — a product call, not a
   defect.
5. **Sampling level:** 10 of 150 register rows were spot-checked. Accepting that level is a
   judgement call; the register's own resolvability gate cannot catch a semantically wrong row that
   cites a real line (verifier's R5 boundary).
6. §8c items 1-5 carried forward unchanged.

## 9. Phase 43, Plan 43-02 — CTAP2 assertion entry point, Rust/FFI half of the tracer (2026-08-21)

`get_assertion_ctap2` (`crates/pv-provider/src/ceremony.rs`) and its `pv-ffi` export
`provider_get_assertion` (`crates/pv-ffi/src/provider.rs`) are committed
(`8241c56`/`2bf35a4`). This is the deliberate Rust/FFI-only half of the phase's tracer
(43-PLAN-CHECK.md B5 split, 43-02-PLAN.md) — Plan 43-03 owns the Swift `.passkeyAssertion` branch,
the RP fixture, and the live Safari proof.

**Why `get_provider_assertion` (the existing WebAuthn-client-level entry point) cannot serve this
path:** iOS hands a credential provider a pre-computed `clientDataHash` (`ASPasskeyCredentialRequest.
clientDataHash`, header ground truth per 43-RESEARCH.md), never a full WebAuthn options JSON.
`get_provider_assertion` builds/hashes `clientData` internally via `passkey_client::Client::
authenticate` — SHA-256 is not invertible, so there is no way to recover the JSON that function
expects from a hash alone. `get_assertion_ctap2` instead calls `passkey_authenticator::
Authenticator::get_assertion` directly, one layer below `passkey_client::Client`, whose `ctap2::
get_assertion::Request` takes `client_data_hash: Bytes` as a first-class field.

**Proof shape, not just "compiles":** `ceremony::ctap2_tests::
signature_verifies_against_independent_webauthn_rs` builds its own `clientDataJSON` embedding a
GENUINE `webauthn-rs`-issued challenge, hashes it exactly like an OS-level caller would, calls
`get_assertion_ctap2`, then reconstructs a `webauthn-rs` `PublicKeyCredential` from the CTAP2
result's raw bytes and hands it to the SAME independent, cross-vendor verifier
`tests/real_rp_verification.rs` (QA-03) uses — a real ECDSA signature check, not a shape/`.ok`
assertion. Falsified once (corrupted signature byte → genuine failure) before being trusted; full
transcripts at `ios/evidence/43/43-02-rust-ffi-transcripts.md`.

**T-43-02 (Information Disclosure) closed structurally, not by review discipline alone:**
`FfiProviderAssertionResult` carries only `credential_id`/`user_handle`/`signature`/
`authenticator_data` — no handle-typed field at all, so
`scripts/audit-ffi-opaque-handles.sh` needs no new allow-list entry for it; a PASS against the
freshly rebuilt bindings is itself the proof no raw-byte accessor was introduced.

**EXT-10 extended, not re-litigated:** the new `Authenticator::new(...)` construction in
`get_assertion_ctap2` never opts into `make_credentials_with_signature_counter(true)`, same as the
two existing entry points. `tests/ctap2_ceremony.rs` (new file, `pub(crate)` fixture helper for
Plans 43-04/43-09 to reuse) asserts this on raw `authenticator_data` bytes at the documented
signCount offset (33..37), for a single call and across two consecutive calls against the same
seeded store — falsified once before being trusted.

**IOS-06's anticipated conversion landed:** `impl From<pv_provider::PvProviderError> for FfiError`
(`crates/pv-ffi/src/error.rs`) is the exact impl that decision record's own text named as owed
"if/when `pv-provider` is touched" — this plan is that touch, first FFI dependency edge from
`pv-ffi` into `pv-provider`.

**Full-gate confirmation:** `scripts/check-ios-gate.sh` (all six sub-gates: qa05, ffi_build,
ffi_falsifiable, ffi_opaque, swift_tests, qa_register) exits 0 against this plan's changes —
`swift_tests` hit the already-documented L-41 bindings-transition retry (not a regression) and
passed on retry with all 5 required FFI identifiers matched. No `ios/PasskeyVault*` Swift file was
touched by this plan; the scoped Swift test lane exercises the app target linking the freshly
rebuilt XCFramework as a structural confirmation only.

## 11. Phase 43, Plan 43-03 — the `.passkeyAssertion` Swift branch, `crates/rp-fixture`, and the live tracer proof (2026-08-21)

The Swift/fixture/harness half of the phase's tracer (43-PLAN-CHECK.md B5 split, following 43-02's
Rust/FFI half). A real, browser-extension-shaped passkey now asserts successfully against a NEW
independent RP fixture in Safari on the pinned simulator, verified receiver-side and shown
falsifiable — closing the phase's own tracer end-to-end (commits `312e10e`/`8906e32`).

**`crates/rp-fixture` (new workspace member):** a standalone, real `webauthn-rs` (kanidm) Relying
Party over HTTP — never a static file server, never a shape/`.ok`-only check. Parameterized by
`rp_id` on every route (`Arc<Mutex<HashMap<String, RpState>>>`), so Plan 43-08's native-app proof
can reuse this SAME binary for `rp_id=vault.blonie.cloud` via `--origin`, no forked crate. Bound to
`127.0.0.1:8900` (loopback only, T-43-18). This is the ONE RP fixture Plans 43-04/43-07/43-08/43-09
must consume by name (this plan's own `must_haves`).

**FINDING 1 (Rule 1, live): WebAuthn needs a real tap.** The fixture's create/get page originally
fired `navigator.credentials.create()`/`.get()` unconditionally on load — Safari was found, first
attempt, to silently reject this (no genuine user activation). Fixed by wrapping the ceremony in a
`#rp-fixture-start` button's click handler.

**FINDING 2 (Rule 2, live — the consequential one): `prepareCredentialList(for:requestParameters:)`
is the REAL entry point, not the two overrides 43-RESEARCH.md's own diagram named.** With no
`ASPasskeyCredentialIdentity` registered for a credential (identity-store registration for passkeys
is explicitly 43-05's job, not this plan's), Safari does NOT route straight to
`provideCredentialWithoutUserInteraction`/`prepareInterfaceToProvideCredential` the way it does for
PASSWORDS (Phase 41's own precedent, which the diagram generalized from). Instead it shows its own
"Sign In" system sheet ("You don't have any passwords or passkeys saved for this website...") with
an "Other accounts" row naming our provider by icon/name ("More from PasskeyVault..."); selecting
that row and tapping "Continue" invokes `prepareCredentialList(for
serviceIdentifiers:requestParameters:)` (`ASCredentialProviderViewController.h:54`,
`ASPasskeyCredentialRequestParameters` carrying `relyingPartyIdentifier`/`clientDataHash`/
`allowedCredentials`) instead. Live evidence pinned this down precisely: `log show` confirmed the
extension process launched and materialized `CredentialProviderViewController` on the FIRST attempt
(only the two originally-planned overrides implemented), yet ZERO `PVFILL|passkey|` lines ever
appeared and the fixture's own `/assert/finish` was never called — a permanently blank system sheet,
confirmed via a live `xcrun simctl io screenshot` taken well after the test completed. Fixed by
adding the missing override, refactoring the existing single-credential-match logic into a shared
`performPasskeyAssertion(rpId:clientDataHash:allowedCredentialIds:entryPoint:)` both entry points
now call (`allowedCredentialIds` unifies `ASPasskeyCredentialIdentity.credentialID` — always one —
with `ASPasskeyCredentialRequestParameters.allowedCredentials` — a list, empty meaning "any
credential for this rp_id"). This is exactly the class of architectural gap a tracer exists to
catch before every later plan in this phase builds on top of it — **43-05's own planning should
verify empirically, not re-derive from the superseded diagram, what identity-store registration
actually changes (likely which entry point fires for a QuickType-offered credential, not whether
assertion is reachable at all — it already is).**

**Seeding (Rule 2, live):** the tracer's own precondition needs a real, fixture-registered passkey
reachable on the simulator. `crates/pv-provider/examples/ios_seed_passkey.rs` (new, dev-only) runs
the REAL `create_provider_credential` ceremony (43-02) against the fixture's own real
`/challenge/register` output, then registers the result with the fixture via `/register/finish`
(genuine `webauthn-rs` verification — proven this plan by the fixture's own log line
`ok=true reason=registered`), shelling out to `curl` rather than adding an HTTP-client dependency to
`pv-provider` for a harness tool. `PasskeyTracerSeeder.swift` (new, `PV_PROBE_E43_TRACER`-gated,
mirroring `TracerFillSeeder.swift`'s own 41-03 precedent) then stages that real plaintext through
the REAL production writers (`encryptItemWire`, `AppGroupCiphertextCacheStore().write`) — no
cryptographic material is synthesized in Swift at all.

**Falsifiable, in the specified order:** `scripts/ios-autofill-e43.sh tracer --corrupt-signature`
(a `#if DEBUG` harness-side interception flips one byte of the real signature via a marker file,
mirroring `TracerFillSeeder.shouldMutateRevision()`'s convention) correctly FAILS —
`RPFIXTURE|route=/assert/finish rp_id=localhost ok=false reason=An OpenSSL Error has occurred`, the
REAL webauthn-rs signature check genuinely rejecting a corrupted signature — THEN
`scripts/ios-autofill-e43.sh tracer` (uncorrupted) PASSES —
`RPFIXTURE|route=/assert/finish rp_id=localhost ok=true reason=verified`. Extension-side
`PVFILL|passkey|entry=list-passkey stage=fill status=ok` confirms `performPasskeyAssertion` itself
ran end to end. Full official verify sequence run in order
(`build-ios.sh && audit-ffi-opaque-handles.sh && tracer --corrupt-signature && tracer`) — all four
steps PASS. Transcripts: `ios/evidence/43/43-03-tracer.log`, `43-03-tracer-corrupt.log` (+
`.fixture-stdout` siblings).

**Caveat this plan's own SUMMARY restates and every later plan's own roll-up must restate too
(C7):** the RP throughout is `crates/rp-fixture`, a project-controlled stand-in SHAPED LIKE a third
party — never a genuinely external RP.

**Out-of-scope finding, flagged not fixed:** `Dockerfile` never stubs `crates/pv-ffi`'s manifest
(only `pv-core`/`pv-provider`/`pv-wasm`/`pv-server`(stub) are copied before `cargo build -p
pv-server --release` runs), which structurally requires every workspace member's manifest on disk
— meaning a `docker build` of this repo was likely ALREADY broken by 43-02's addition of `pv-ffi` as
a workspace member, before this plan touched anything. `crates/rp-fixture` adds a further member
with the same class of gap, which does not make anything worse (already broken) but does not fix it
either. Not in this plan's `files_modified`, not part of its `<verify>` block — recorded here for
visibility only.

## 12. Phase 43, Plan 43-04 — `make_credential_ctap2` registration + Open Question 3 settled empirically (2026-08-21)

`make_credential_ctap2` (`crates/pv-provider/src/ceremony.rs`, `fe9a0d3`) and its `pv-ffi` export
`provider_make_credential` (`crates/pv-ffi/src/provider.rs`, `5f2873b`) complete the matched pair
43-02 started — 43-RESEARCH.md Pitfall 7 names shipping assertion without registration as a
phase-scope failure. This plan's own genuinely open unknown, Open Question 3 (does `ciborium`'s
`fmt:"none"` attestation object satisfy a real RP verifier?), is closed by evidence in this plan,
not deferred.

**Two deviations from the plan's originally-authored shape, both load-bearing, not cosmetic:**

1. **`existing_credentials_json` parameter added** (absent from the plan's own authored signature).
   Without it, `excluded_credential_ids` is a structural no-op: `PvCredentialStore::from_passkeys_json`
   against an empty store means `Authenticator::find_credentials` always returns
   `Ctap2Error::NoCredentials`, which `make_credential` treats as "nothing to exclude" —
   `create_provider_credential`'s own doc comment already documents this exact behavior for the
   WebAuthn-client path, and the plan's own action text imported that rationale but drew the
   opposite conclusion from it. Fixed by mirroring `get_assertion_ctap2`/`get_provider_assertion`'s
   existing `existing_credentials_json` precedent.

2. **A populated store alone is still not sufficient** — a second, independent finding from direct
   source read of `passkey-authenticator=0.5.0`'s own test suite
   (`authenticator/make_credential/tests.rs::assert_excluded_credentials`): that test's own
   `.expect("Excluded id gets ignored")`, with the CTAP2-spec-correct
   `.expect_err(Ctap2Error::CredentialExcluded)` assertion commented out immediately below it, is
   upstream's own admission that `Authenticator::make_credential` never actually terminates the
   ceremony on an exclude-list match — it only surfaces `UiHint::InformExcludedCredentialFound` as an
   informational hint and proceeds regardless. `make_credential_ctap2` performs its own explicit
   exclude-list rejection against `existing_credentials_json` BEFORE ever calling into the library,
   rather than trusting a library behavior that its own vendored test suite documents as absent.

**A third, smaller deviation (quality improvement, not a correctness fix):** the plan's action text
instructed hand-constructing the CBOR attestation-object map via `ciborium::value::Value::Map` with
integer keys `1`/`2`/`3`, citing WebAuthn §6.5.4 inline. `passkey_types::ctap2::make_credential::
Response` already provides `as_webauthn_bytes()` — the crate's OWN CBOR encoding of exactly this
shape, using the correct WebAuthn STRING keys (`fmt`/`authData`/`attStmt`), not CTAP2's integer
keys. Using the crate's own method is a STRICTER reading of this file's "never hand-assembled
bytes" convention than the plan's own hand-rolled version would have been (and the hand-rolled
version, if written with CTAP2's integer keys as the plan's own action text specified, would have
produced a WIRE-INCOMPATIBLE attestation object — a real third-party RP's CBOR parser expects
WebAuthn's string keys for `attestationObject`, not CTAP2's integer keys for the CBOR request/
response types those integers are scoped to).

**Open Question 3, settled empirically:** `real_rp_verification.rs`'s new
`make_credential_ctap2_attestation_verified_by_independent_webauthn_rs` hands a genuine
`webauthn-rs`-issued challenge through `make_credential_ctap2` (via a hand-built `clientDataJSON` +
its SHA-256 `client_data_hash`, the exact split an OS-level caller performs — `make_credential_ctap2`
never sees the JSON, only the hash), then feeds the CTAP2 result back into `webauthn-rs`'s own
`finish_passkey_registration`. **PASS**: an INDEPENDENT, real third-party RP verifier accepts the
attestation object this crate produces. Full transcripts: `ios/evidence/43/43-04-rust-ffi-
transcripts.log`.

**L-3/L-9 note on the negative control, restated because the first attempt was itself wrong and
worth recording:** the plan's action text asked for "corrupt one byte of `attestation_object`". An
initial draft flipped the LAST byte (part of the EC public key's y-coordinate) — `finish_passkey_
registration` returned `Ok` anyway. This is not a test bug to paper over: `fmt:"none"` attestation
carries NO attestation statement, so nothing cryptographically binds the public key to anything at
registration time — a corrupted public-key byte is simply a DIFFERENT valid credential, not an
invalid one. Direct source read of `webauthn-rs-core-0.5.5/src/core.rs::register_credential_internal`
found the actual verified field: `authData`'s `rpIdHash` (`if data.attestation_object.auth_data.
rp_id_hash != self.rp_id_hash { return Err(...) }`). The negative control now decodes the CBOR
attestation object genuinely (`ciborium`, never a raw byte-offset guess), flips `authData`'s first
byte, and re-encodes. Manually falsified both directions before trusting it: disabling the
corruption line reproduces the original false-pass (`Ok` returned on a corrupted object — see the
"DISABLED" half of `ios/evidence/43/43-04-falsification-proof.log`), restoring it reproduces the
correct `Err` (the "RESTORED" half of the same file).

**T-43-04/T-43-05/T-43-06 closed structurally:** `FfiProviderRegistrationResult` carries only
`credential_id`/`attestation_object` (public) and `new_passkey_json` (secret, the SAME sanctioned
`CreateProviderResult.new_passkey_json` exception, immediately re-encrypted by the caller) — never
`key_cbor`. No handle-typed field at all, so `scripts/audit-ffi-opaque-handles.sh` needs no new
allow-list entry; re-ran it against the freshly rebuilt Swift bindings, PASS (`ios/evidence/43/
43-04-check-ios-gate.log`). `fmt:"none"` only (T-43-05) and `-7`/ES256-only algorithm negotiation,
checked BEFORE any credential is constructed (T-43-06) — a picky RP requesting only a different
algorithm gets `PvProviderError::InvalidInput`, never a wrong-algorithm credential.

**EXT-10 extended, not re-litigated:** the new `Authenticator::new(...)` construction in
`make_credential_ctap2` never opts into `make_credentials_with_signature_counter(true)`, matching
every other entry point in this file, for the identical reasons `get_provider_assertion`'s own
EXT-10 decision record states (a passkey shared across N concurrently active member extensions has
no single authoritative "last counter value" to advance from).

**Full-gate confirmation:** `scripts/check-ios-gate.sh` (all six sub-gates: qa05, ffi_build,
ffi_falsifiable, ffi_opaque, swift_tests, qa_register) exits 0 against this plan's changes —
`swift_tests` hit the already-documented L-41 bindings-transition retry (not a regression) and
passed on retry, all 5 required FFI identifiers matched. No `ios/PasskeyVault*` Swift file was
touched by this plan; the scoped Swift test lane exercises the app target linking the freshly
rebuilt XCFramework as a structural confirmation only, same posture as 43-02's own entry above.
Transcript: `ios/evidence/43/43-04-check-ios-gate.log`.

**Session interruption note:** this plan's execution was interrupted mid-run by the host machine
sleeping (not a work failure — both Rust/FFI commits had already landed cleanly beforehand). Evidence
capture and this spike-log entry were completed in a follow-on continuation of the same plan run, no
task re-done.

## 13. Phase 43, Plan 43-05 — passkey machinery inside FILL-03's choke point (2026-08-21)

`IdentityStoreSync.swift` (`b78a8fe`) gains a full passkey-identity sibling to the existing
password path: `PasskeyIdentitySource` (a top-level struct, sibling to `VaultIdentitySource`,
keyed by relying-party id + credential id — no URL/host concept), `upsertOnePasskey(source:)`
and `republishPasskeys(sources:)` mirroring `upsertOne`/`republish`'s exact CR-01/CR-02 split
(upsert never diffs/removes, republish always does), and its own persisted diff/removal record
(`identityPublishedPasskeyKeysKey`) kept structurally separate from the password path's
`publishedKeysKey` — the plan's own prohibition, since a passkey has no URL/host to collide on
but mixing the two records would still risk a spurious cross-type removal. `ASPasskeyCredentialIdentity`
is constructed via the non-refined factory-derived Swift convenience init
(`ASPasskeyCredentialIdentity(relyingPartyIdentifier:userName:credentialID:userHandle:recordIdentifier:)`),
confirmed against BOTH `ASPasskeyCredentialIdentity.h` (the `+identityWithRelyingPartyIdentifier:...`
factory) and the `arm64-apple-ios-simulator.swiftinterface` on this toolchain before writing the
call — L-1's amended "check both" rule, and L-1's Pitfall 5: the designated init
(`NS_REFINED_FOR_SWIFT`) is not reachable directly from Swift at all here, so there was no simpler
form to accidentally reach for instead.

`scripts/audit-ios-identity-store-chokepoint.sh`'s assertion (A) `WRITE_PATTERN` (`33e43d6`) gained
`ASPasskeyCredentialIdentity\(` as a sixth alternation term, so the gate now polices passkey
construction exactly like it already polices password construction. `ALLOWLIST` needed no new
entry. Falsification transcript (green, inject, red, revert, green) run by hand and captured in
`ios/evidence/43/43-05-chokepoint-falsification.log`: baseline PASS; a throwaway file with a bare
`ASPasskeyCredentialIdentity(` construction outside the allow-list made the gate FAIL, naming the
file/line; deleting it restored a byte-identical PASS.

**New test file** `ios/PasskeyVault/PasskeyVaultTests/IdentityStoreSyncPasskeyTests.swift`
exercises all four `<behavior>` cases against the REAL `ASCredentialIdentityStore.shared` (never
a mock — L-34's own finding means the read-back API is unreliable on this simulator, so these
tests assert on `Swift.Result` return values and on the persisted UserDefaults record instead,
never `credentialIdentities(forService:)`): a valid source saves and returns `.success`; a repeat
upsert for the same `(rpId, credentialId)` is idempotent (persisted set stays at one entry);
`republishPasskeys` dropping a previously-published pair computes it as a removal, diffed against
the passkey-specific persisted set; an empty `credentialId` builds nothing and returns
`.failure(.nothingToWrite)`. A fifth test asserts the passkey and password persisted-key literals
are provably distinct. All 5 green, scoped run
(`-only-testing:PasskeyVaultTests/IdentityStoreSyncPasskeyTests`), positive xcresult count
asserted (L-30). Transcript: `ios/evidence/43/43-05-swift-tests.log`.

**Deviation (Rule 3, blocking): the AutoFill provider was not elected on the fresh
`xcodebuild test` simulator clone.** The first scoped run (default parallel-clone destination)
failed all four behavior tests with `.storeDisabled` — `pluginkit -m -p
com.apple.authentication-services-credential-provider-ui` showed no `+`-prefixed entry on
`Clone 1 of PV-iPhone16`. `scripts/ios-autofill-e41.sh`'s own `ensure_provider_enabled`/e41-6
precedent already names the fix: `xcrun simctl spawn "$udid" pluginkit -e use -i
cloud.blonie.PasskeyVault.AutoFill` (CLI-only re-election, no host-app launch needed). Re-ran the
scoped test WITHOUT letting `xcodebuild` spawn a clone
(`-parallel-testing-enabled NO -maximum-concurrent-test-simulator-destinations 1`) so the
re-elected state stayed in effect for the test process — all 5 tests then passed. No code change;
purged the parallel clone afterward (`simctl --set testing shutdown all && delete all`), leaving
only the base `PV-iPhone16` booted, per this session's own hard rules.

**Known limitation, documented in-code, NOT fixed here (out of this plan's own scope — the call
site is explicitly deferred to Plan 43-07):** on a device where `state.supportsIncrementalUpdates`
is `false`, both `republish(sources:)` and `republishPasskeys(sources:)` fall back to
`replaceCredentialIdentities(with:)`, which replaces the ENTIRE store, not just the type it was
handed — calling the two independently on such a device would make each call erase the OTHER's
identities. Plan 43-07's own call site (the first real integration point) must combine password
and passkey sources into ONE full-replacement write on that branch. This simulator/toolchain
reports `supportsIncrementalUpdates == true` today (confirmed live in the test log above,
`mode=incremental`), so the collision is latent, not exercised, by this plan's own tests — a
design question for 43-07's own `<action>`, not something machinery alone can resolve.

`project.pbxproj` shows a cosmetic `fileSystemSynchronizedGroups` array reordering (same UUIDs,
same paths, different array order) — an automatic side effect of Xcode's build system picking up
the new test file under the already-synchronized `PasskeyVaultTests/` directory; no manual edit
made, no functional change.

This plan builds MACHINERY only, per its own explicit scope boundary; the registration override
that actually calls `upsertOnePasskey` lands in Plan 43-07, which also extends assertion (B)'s
`CALL_SITE_*` arrays once that call site exists to enumerate.

**Full-gate confirmation:** `scripts/check-ios-gate.sh` (all six sub-gates: qa05, ffi_build,
ffi_falsifiable, ffi_opaque, swift_tests, qa_register) exits 0 against this plan's changes --
`swift_tests` hit the already-documented L-41 bindings-transition retry (not a regression) and
passed on retry, executed-test count 5, all 5 required FFI identifiers matched. No pv-ffi source
was touched by this plan; `ffi_build`/`ffi_falsifiable`/`ffi_opaque` ran as part of the composite
gate's own standing checks, same posture as 43-02's/43-04's own entries above. Parallel simulator
clones purged after both this run and the earlier scoped `IdentityStoreSyncPasskeyTests` run,
leaving only the base `PV-iPhone16` booted. Transcript: `ios/evidence/43/43-05-check-ios-gate.log`.

### DR-43-A — the AutoFill extension gains scoped network POST capability: **DECIDED — `VaultAPI.createItem` only, structurally enforced**

Recorded in the SAME OPT-0x/EXT-10 rigor as this project's own decision records (43-PLAN-CHECK.md
C2): a decision is stated, rejected alternatives are named and rejected on their own merits, and
residual risk is stated plainly. This is the FIRST time the AutoFill extension process makes a
real network call in this project's history — Phase 41's password fill is a purely local read of
the host's persisted ciphertext cache; nothing before this plan ever gave the extension a
`URLSession` call.

**1. Decision.** Grant the extension exactly one new capability: `VaultAPI.createItem` over HTTPS,
reusing the host's ALREADY-established session token (`SessionTokenStore`, the same shared
`keychain-access-groups` item both targets already declare, Phase 36) and the host's already-
configured server URL (`ServerSettings`' new App Group companion copy, Plan 43-06, Task 1). The
extension never mints a new credential, never requests one, and never gains any OTHER `VaultAPI`
method — enforced structurally by `scripts/audit-extension-network-scope.sh` (Task 3, this plan),
not by convention or comment alone. Registration's own UI/ceremony wiring (Plan 43-07) is the
first real caller; this plan builds and proves the capability, never uses it for anything itself.

**2. Rejected alternative: route the item-creation POST through the host app instead** (the
extension writes a pending record only, and the host app performs the ONLY network call, on its
next launch or foreground). Rejected because it delays server-side visibility of a freshly
registered passkey by an unbounded, user-dependent interval — until the user next happens to open
the host app — which would make ROADMAP SC4's "visible server-side" proof flaky and slow rather
than immediate. `PendingProviderItemStore` (Task 2, this plan) is kept anyway, but strictly as the
FAILURE-PATH self-heal for a process kill mid-POST, never as the primary path.

**3. Rejected alternative: a second, extension-scoped API credential**, minted and rotated
independently of the host's own session. Rejected because it would be a SECOND secret to manage,
rotate, and revoke for a capability that is already a strict SUBSET of what the host's own session
token authorizes — reusing the existing token via the existing shared keychain-access-group is
simpler and has no larger blast radius than what already exists today: the extension already
reads and decrypts full vault contents under this same session's authority for the password/
passkey fill path (Phase 41/43-05). A second credential would add operational cost (rotation,
revocation, a second place a leak could originate) without narrowing risk anywhere real.

**4. Residual risk, accepted, stated plainly (T-43-11).** The session-token Keychain item is now
readable by a second process — the AutoFill extension, not merely the host app. Accepted because
both targets ALREADY declare the IDENTICAL `keychain-access-groups` entitlement value (Phase 36);
this task adds no new entitlement and no new secret. It makes an ALREADY-shared secret reachable
by code that previously had no reason to read it, not a new secret exposure surface. Bounded
further by the network-scope gate (Task 2/3: one construction site, one method) and the leak proof
(Task 3's `VaultAPILeakProofTests`, asserting the POST body carries ciphertext only).

**5. Load-bearing implementation deviation from this plan's own authored shape, noted here per
this plan's own `<read_first>` instruction.** `VaultAPI.swift` does NOT have zero host-app-only
dependencies as anticipated ("unlikely, but verify") — it throws `PvApiError` throughout its
`send`/`requireStatus` plumbing (which `createItem` itself calls) and its `sync(since:)` method
returns `SyncPullResult`. Both types lived in host-only files (`Core/PvApiClient.swift`,
`Sync/SyncModels.swift`). Rather than trimming `VaultAPI`'s method surface (which Task 3's own gate
design already assumes is NOT trimmed — its assertion (B) is written to catch a call to any OTHER
`VaultAPI` method, which presumes those methods are physically present and merely un-called), both
dependency types were relocated alongside it: `PvApiError` to a new `Shared/PvApiError.swift`, and
the whole of `SyncModels.swift` to `Shared/SyncModels.swift` (its own `CachedSnapshot` bridging
extensions were already safe to relocate -- `CachedSnapshot` itself lives in `PvShared/`, already
synchronized into both targets). Every existing host call site (`VaultStore.swift`,
`FolderStore.swift`, `SyncClient.swift`, `ContentView.swift`, `LiveSyncProbe.swift`,
`PvApiClient.swift`) compiles unchanged -- same module, unqualified references, no import changes.
This IS the "extract the minimal surface... and note the deviation" contingency this plan's own
`<read_first>` named in advance, resolved in the direction Task 3's own gate design requires.

**Verification, re-run at commit time.** `grep -q "DR-43-A" ios/IOS-SPIKE-LOG.md` — this section.
`caffeinate -i bash scripts/build-ios.sh` succeeds for both targets after the `VaultAPI.swift`/
`SessionTokenStore.swift`/`PvApiError.swift`/`SyncModels.swift` relocation.

## 14. Phase 43, Plan 43-07 — registration wired end-to-end, ROADMAP SC4 proven live (2026-08-22)

`prepareInterface(forPasskeyRegistration:)` (`CredentialProviderViewController.swift`, `c1fc50c`) is
the last piece OPT-03 needed: confirmation screen → CTAP2 registration (43-04) →
`PasskeyIdentitySource`/`upsertOnePasskey` (43-05) → `VaultAPI.createItem` + self-heal (43-06). Every
prior wave's own machinery is this plan's sole caller.

**Landmine L-43: the Swift import name for `prepareInterfaceForPasskeyRegistration:` is
`prepareInterface(forPasskeyRegistration:)`, not `prepareInterfaceForPasskeyRegistration(for:)`.**
43-RESEARCH.md's own code example (and this plan's own action text, copied from it) assumed the
latter — a real `swiftc` diagnostic corrected it: `'prepareInterfaceForPasskeyRegistration' has been
renamed to 'prepareInterface(forPasskeyRegistration:)'`. The Clang importer's "For"-splitting
heuristic treats `...ForPasskeyRegistration:` as `prepareInterface` + label `forPasskeyRegistration`,
unlike `prepareInterfaceToProvideCredentialForRequest:`'s existing `prepareInterface(for:)` shape —
the two sibling selectors do NOT import the same way, confirmed by a standalone `swiftc -typecheck`
probe before committing (`/tmp/pv_check_override2.swift`, this session). A fourth extension of L-1's
"the header is not the whole story" family, but from the OPPOSITE direction: here the header's own
selector text was accurate, and it was the PLAN's own inference from it (English-language guesswork
about Swift's argument-label splitting) that was wrong — always verify the ACTUAL Swift-facing
signature with a real compile, never infer it from the ObjC selector by eye.

**The registration DECISION logic could not live in the file it decides for.**
`PasskeyRegistrationPreflight.swift` (new, `Shared/`) holds the pure algorithm/lock-state refusal
decision `PasskeyRegistrationOverrideTests` exercises — NOT because of any AuthenticationServices-
free-testability convention (`IdentityStoreSync.swift` already breaks that convention and is
`@testable`-covered fine), but because `CredentialProviderViewController.swift` compiles ONLY into
the `PasskeyVaultAutoFill` extension target, and `PasskeyVaultTests`' `@testable import PasskeyVault`
reaches the HOST app module only — confirmed directly from the pbxproj's own
`PBXFileSystemSynchronizedRootGroup`/`fileSystemSynchronizedGroups` entries (`PasskeyVaultTests`'s own
group lists only its own folder, never `PasskeyVaultAutoFill`). 43-PLAN-CHECK.md C5's own
"actually run by this plan's own gate" requirement is unsatisfiable for logic that lives only in the
extension folder; this is the general shape, not specific to this one method.

**The chokepoint gate's assertion (B) extended and shown red-then-green (43-PLAN-CHECK.md B6).**
`scripts/audit-ios-identity-store-chokepoint.sh` gains a seventh `CALL_SITE_*` entry
(`3903b55`) for the new override's own `IdentityStoreSync.upsertOnePasskey(` call, anchored on its
corrected declaration line, window a stated generous upper bound (the placement above
`runIdentityRebuildIfPending()` keeps the primary `next_decl_offset` extent-detection path
authoritative, per 43-PLAN-CHECK.md C1). Falsification, captured in
`ios/evidence/43/43-07-t2-chokepoint-falsification.log`: (1) swap the call for
`IdentityStoreSync.republishPasskeys(` → FAIL, naming this exact entry; (2) delete the call
entirely → FAIL, naming the same entry; (3) restore byte-for-byte → PASS. The SAME three-transcript
discipline 43-05's own assertion (A) extension already established, applied here to (B) for the
first time since 41-08 originally built it.

**Carry-forward obligation from 43-05-SUMMARY.md, closed.** `IdentityStoreSync.republishRebuild
(passwordSources:passkeySources:)` (new) is the ONE place password and passkey sources are combined
before a full-vault rebuild — on a device where `state.supportsIncrementalUpdates` is `true` (this
simulator, still, per 43-05's own finding), it delegates unchanged to `republish`/`republishPasskeys`
independently (safe: `saveCredentialIdentities`/`removeCredentialIdentities` only ever touch the
identities they are handed); on the `false` branch it issues ONE combined `replaceCredentialIdentities`
call, closing the erasure collision 43-05 documented and deferred. `combinedRebuildIdentities`
(the pure combination step) is factored out and directly tested — the live collision itself remains
unexercised on this toolchain (still `supportsIncrementalUpdates == true`), the same honest limit
43-05's own entry recorded.

**ROADMAP SC4, proven live, twice (once per harness run, the second with the fix below).**
`scripts/ios-autofill-e43.sh sc4` drives a REAL registration ceremony on the pinned simulator against
`crates/rp-fixture` (`mode=create`), against a genuinely isolated, throwaway `pv-server` (D-23's own
discipline extended: never `data/pv.db`), then a DIRECT `GET /api/vault/items` against that live
server (bypassing any client cache, via a genuinely independent real `pv-wasm` client —
`scripts/ios-autofill-e43-sc4-probe.mjs`, the SAME E-W1 precedent `scripts/sync-contract-probe.sh`
already established) decodes the row and asserts the raw `passkey` wire shape
(`isRawPasskeyWireFields`'s own predicate, re-implemented minimally, never a new, divergent check).
**PASS**: `ios/evidence/43/43-07-sc4-after.json` shows one row, `rpId=localhost`,
`credentialIdLength=16`. Falsification (`sc4 --stale-snapshot`): the SAME assertion against
`ios/evidence/43/43-07-sc4-before.json` (captured right after the throwaway account was created,
before any ceremony ran) shows the row genuinely absent — **PASS**, proving the check can fail.

**LIVE FINDING (first attempt, this session): the system's own "Save Passkey" confirm control has no
"Continue" label at all.** The first `sc4` run's own UI test (`AutoFillPasskeyRegistrationUITests`,
`3903b55`) correctly found and tapped Safari's OWN "Save in PasskeyVault" provider-choice row (a
`Selected` radio-style button in a real system sheet), but then polled for a "Continue" label for 30s
and never found one — the extension process never launched at all (`xcrun simctl spawn ... log show
--predicate 'process == "PasskeyVaultAutoFill"'` returned zero lines for the whole test window,
receiver-side proof the failure was real, not a polling bug). The captured accessibility hierarchy
(`provider-row-found-poll2-hierarchy`, extracted via `xcrun xcresulttool export attachments`) showed
the real confirm control: `Other, identifier: 'ASAuthorizationControllerContinueButton'`, label
**"Add Passkey"** — a DIFFERENT surface, and a DIFFERENT label, than the sibling assertion tracer's
own "Continue" (43-03-PLAN.md's own live finding, a different system sheet entirely). Fixed by
checking the identifier first (stable, not localization-dependent), falling back to the "Add Passkey"
label text, then "Continue" as a last resort. The SECOND run, with this fix, reached and tapped OUR
OWN confirm screen (`passkeyRegistration.confirm`, found via its `accessibilityIdentifier`) and
completed the full ceremony.

**Open Question 1, settled empirically, live (43-RESEARCH.md's own recommendation: settle in this
phase's first live registration experiment, before treating the field-population behavior as
known).** Logged from inside the override, BEFORE any transformation
(`ios/evidence/43/43-07-t1-open-question-1-log.txt`):
```
PVFILL|passkey-reg|stage=opt-01-oq1 userHandleLen=16 userNameLen=20
PVFILL|passkey-reg|stage=opt-01-oq1 userHandle={length = 16, bytes = 0x8a29dbff29d24f5ab19881fd903b0a51} userName=ios-sc4-registration
```
`userName` is an EXACT match for the harness's own `PV_E43_SC4_USERNAME` value, and `userHandle` is
16 bytes — exactly `crates/rp-fixture`'s own `start_passkey_registration(Uuid::new_v4(), &user_name,
&user_name, None)` (`main.rs:283`), a fresh random UUID the RP itself mints for a NEW registration.
**Answer: iOS forwards the RP's real `user.id`/`user.name` values verbatim for a fresh registration —
it does not synthesize a placeholder.** A2 (43-RESEARCH.md's Assumptions Log) confirmed correct.

**Every ceremony stage confirmed green from the device's own log, this same run**
(`ios/evidence/43/43-07-t1-open-question-1-log.txt`): `stage=preflight status=ok` →
`stage=ceremony status=ok` → `stage=encrypt status=ok` → `stage=network status=ok` (the REAL POST to
the live throwaway server) → `stage=identity-store status=ok` → `stage=complete status=ok`.

**`scripts/audit-extension-network-scope.sh` gains its first, and so far only, real caller** —
`CredentialProviderViewController.swift`, exactly as that gate's own header anticipated when 43-06
built it with an empty allow-list. Falsified both directions
(`ios/evidence/43/43-07-network-scope-falsification.log`): a `.sync(` call injected into the
allow-listed file → FAIL under assertion (B); a `VaultAPI(` construction in a scratch file outside
the allow-list → FAIL under assertion (A); both reverted → PASS.

**Full-gate confirmation:** `scripts/check-ios-gate.sh` (all six sub-gates) exits 0 against this
plan's changes. Transcript: `ios/evidence/43/43-07-check-ios-gate.log`.

## 15. Phase 43, Plan 43-08, Task 1 -- SC2 harness scaffold: `PasskeyVaultHarness`, the REAL Coolify/Traefik AASA mechanism, and a `codesign -d --entitlements` red herring (2026-08-22)

`ios/PasskeyVaultHarness` (new Xcode app target, `524CDFDE.../9AB3CA3E...` object IDs, `commit
0ca2c19`) is the phase's FIRST use of AuthenticationServices' REQUESTING side
(`ASAuthorizationController`/`ASAuthorizationPlatformPublicKeyCredentialProvider`) -- every prior
plan (43-02/43-03/43-07) used the PROVIDER side (`ASPasskey*`). Its ONE screen fetches a real
challenge from `crates/rp-fixture`'s `/challenge/assert?rp_id=vault.blonie.cloud` FIRST (the
fixture is authoritative for the challenge, never this app -- 43-PLAN-CHECK.md N2), then runs the
ceremony and POSTs the (possibly `-PVCorruptSignature`-flipped) result to the fixture's own
`/assert/finish` -- the falsification's owning branch lives IN the app (43-PLAN-CHECK.md N3), a
shell script cannot intercept a `URLSession` call.

**Landmine (L-1/L-43 family, new instance): `ASAuthorizationPublicKeyCredentialAssertion.signature`
imports into Swift as `Data!`, not `Data`, unlike its four siblings on the SAME protocol.** A
`swiftc -typecheck` probe using `_ = assertion.signature` (assigning to `_`) and one using `let c:
Data = assertion.signature` (an explicit target type) BOTH compiled cleanly and gave false
confidence -- an implicitly-unwrapped optional auto-unwraps silently in both those shapes. Only a
REAL `xcodebuild`, hitting `var signatureBytes = assertion.signature` with NO explicit annotation
(Swift's own "IUO decays to plain `Optional` on bare assignment" rule), surfaced 4 `Data?`
diagnostics. Root cause, confirmed by reading the ACTUAL header:
`ASAuthorizationPublicKeyCredentialAssertion.h` (declaring `signature`/`rawAuthenticatorData`/
`userID`) has NO `NS_ASSUME_NONNULL_BEGIN`/`NS_HEADER_AUDIT_BEGIN(nullability, ...)` wrapper, while
its sibling `ASPublicKeyCredential.h` (declaring `credentialID`/`rawClientDataJSON`) DOES --
`rawAuthenticatorData`/`userID` still imported as plain `Data` regardless (their own probe showed
no error), so the unaudited-region theory alone does not fully explain why only `signature`
tripped this; recorded as CONFIRMED-BY-REAL-COMPILE, not fully explained by header inspection
alone -- exactly the caution L-1's own amendment already names ("check BOTH representations and
reconcile them; neither is ground truth on its own"). Fixed with an explicit `var signatureBytes:
Data = assertion.signature` annotation, which forces the IUO auto-unwrap visibly at that one line
instead of letting it decay silently.

**A second red herring, more consequential -- `codesign -d --entitlements :-` reads EMPTY for
EVERY Simulator-built target in this project, shipping ones included, and is NOT evidence the
entitlement is missing.** Investigating whether `PasskeyVaultHarness`'s Simulator build actually
carried `com.apple.developer.associated-domains` (needed for Task 3's own live proof), `codesign -d
--entitlements :- PasskeyVaultHarness.app` printed `<dict></dict>` -- empty. Before treating this
as a real gap, the SAME check was run against the ALREADY-WORKING, already-shipping
`PasskeyVaultAutoFill.appex` (`autofill-credential-provider` + `application-groups`, proven live
across Phases 36-43's own many passing ceremonies) -- **also empty**, on the SAME simulator. This
means `codesign -d --entitlements` cannot be evidence of a real gap here: it reads the CMS
signature slot of a "Sign to Run Locally" ad-hoc-signed binary, which Xcode leaves genuinely empty
for Simulator builds regardless of what the source `.entitlements` file requests. The GROUND-TRUTH
check, confirmed via `otool -s __TEXT __entitlements`/`strings -a` on the raw Mach-O binary (not
its code signature): the harness's `PasskeyVaultHarness.app/PasskeyVaultHarness` binary DOES embed
`com.apple.developer.associated-domains` / `webcredentials:vault.blonie.cloud` in its linked
`__TEXT,__entitlements` section (from `-Xlinker -sectcreate ... PasskeyVaultHarness.app-Simulated
.xcent`, a build-setting-generated file DISTINCT from the CMS-signed `.app.xcent`), and the SAME
`strings -a` check against `PasskeyVaultAutoFill`'s own binary shows its two entitlements present
the identical way -- the Simulator's own runtime evidently reads this raw section, not the CMS
entitlements slot, which is why every capability-gated feature in this project has worked on the
Simulator despite `codesign -d --entitlements` reading empty for every target, this plan's
included. **Carry forward for Task 3 and any future entitlement-presence check in this project:
verify via `strings -a <binary> | grep <entitlement-key>` against the raw Simulator binary, never
via `codesign -d --entitlements` alone -- the latter is a vacuous-looking-but-wrong check for this
toolchain's Simulator signing path.**

**A genuinely separate, real gap this same investigation surfaced and fixed: registering
`cloud.blonie.PasskeyVaultHarness` as an App ID with Apple.** A NEW bundle id has no registered
capabilities on Apple's developer portal until Xcode registers it -- confirmed live: a Simulator-
only build (`xcodebuild ... -destination "platform=iOS Simulator,..."`, even with
`-allowProvisioningUpdates`) never triggers this registration (Simulator needs no real
provisioning profile at all). ONE `xcodebuild build ... -destination "generic/platform=iOS"
-allowProvisioningUpdates` (no physical device needed -- `generic/platform=iOS` only requires
signing RESOLUTION, not an attached device) genuinely created "iOS Team Provisioning Profile:
cloud.blonie.PasskeyVaultHarness" against team `4S7F2M7YLW` and registered the Associated Domains
capability with Apple -- confirmed via THAT build's own `codesign -d --entitlements` (a REAL
device/profile-backed identity, "Apple Development: bartek@paczesny.pl (UZNWZA484N)", DOES populate
the CMS entitlements slot correctly, unlike ad-hoc Simulator signing) showing the full, correct
entitlements dict. This one-time registration is a genuine, permanent, harmless side effect (a new
App ID + Development provisioning profile on this project's existing paid team) -- not something
later plans need to repeat.

**The real `vault.blonie.cloud` reverse-proxy mechanism, investigated (never assumed) via read-only
`ssh oracle` (`docker ps`, `docker inspect`, a `GET /api/v1/applications/...` against Coolify's own
API -- no writes):** Traefik (`traefik:v3.6`, container `coolify-proxy`), confirmed Coolify's own
default, IS what fronts `vault.blonie.cloud` -- routing is Docker-label-driven
(`--providers.docker=true`), the `passkey-vault` app's own container already carries its router's
labels directly. `custom_nginx_configuration` is confirmed `null` for this app (a `build_pack:
"dockerfile"` app -- Coolify's nginx-config panel does not apply here, confirmed via the API
response, not assumed absent). A SECOND, also-confirmed mechanism: Traefik's own file provider
(`--providers.file.directory=/traefik/dynamic/`, backed by `/data/coolify/proxy/` on the host) --
documented as a viable Coolify-native alternative in `AASA-DEPLOY.md` Section 5, not used as the
primary recommendation (the Docker-label sidecar mirrors `passkey-vault`'s own router style
byte-for-byte and needs no extra file). Full real-deployment steps (a NEW, separate `nginx:1-alpine`
sidecar container on the `coolify` network, Traefik-labeled with `priority=1000` to win over the
app's own `PathPrefix(`/`)` router for exactly one path, reusing the ALREADY-issued Let's Encrypt
cert via `tls.certresolver=letsencrypt`) are in `ios/PasskeyVaultHarness/AASA-DEPLOY.md` Section 4
-- Task 2's own job, never applied by this session's own automation (43-08-PLAN.md's own
prohibition -- production infra, human-gated).

**A blocking issue (Rule 3), fixed at its actual source, never in `crates/pv-server`:**
`web/public/harness/passkey-native-rp.html` is served from `https://vault.blonie.cloud` but
`fetch()`es `crates/rp-fixture`'s own `http://localhost:8900` cross-origin -- the Mixed Content
spec's own "potentially trustworthy" exception for `localhost` permits the REQUEST despite the
scheme mismatch, but `crates/rp-fixture` had no CORS headers at all, so the RESPONSE would have
been unreadable. Fixed by adding a permissive `tower_http::cors::CorsLayer` to `crates/rp-fixture`
ONLY (a TEST-ONLY, loopback-only fixture with no secret to protect -- T-43-18's own posture,
`Cargo.toml`'s own doc comment states the rationale) -- `crates/pv-server` was never touched
(`git diff --stat -- crates/pv-server` empty throughout, confirmed after this change too).

**A plan-text correction, confirmed against the real fixture source before use:** `crates/rp-
fixture`'s own multi-rp_id override flag is `--origin <rp_id>=<origin>` (`crates/rp-fixture/src/
main.rs`'s own `parse_args`), NOT `--rp-origin` as this plan's own action text assumed for Task 3 --
recorded here so Task 3's own harness-script invocation uses the REAL flag name, not the plan's
guessed one.

## 16. Phase 43, Plan 43-08, Task 3 -- ROADMAP SC2 live proof: three real-environment root causes, none of them SpringBoard timing (2026-08-22)

Task 2's checkpoint discharged: AASA live at `https://vault.blonie.cloud/.well-known/apple-app-
site-association` (`{"webcredentials":{"apps":["4S7F2M7YLW.cloud.blonie.PasskeyVaultHarness"]}}`,
`content-type: application/json`), delivered by the `pv-aasa-harness` sidecar. Task 3 adds a
`native-app` subcommand to `scripts/ios-autofill-e43.sh` and a new
`NativeAppSignInUITests.swift`, and gets a REAL, live, falsifiable proof that a native app --
`ios/PasskeyVaultHarness`, via `ASAuthorizationController` -- routes into Passkey Vault's real
AutoFill extension, verified by `crates/rp-fixture`'s own independent `webauthn-rs` check. Both
legs ultimately PASS. Getting there required finding three genuinely distinct, real-environment
root causes, none of which were the SpringBoard-icon-cache-settle-time theory this session started
with (which more retries/longer sleeps never fixed, up to 15 attempts / 6 minutes of genuinely
idle waiting).

**Registration precondition, disclosed substitution:** 43-08-PLAN.md's own `<precondition>`
describes registering the `rp_id=vault.blonie.cloud` passkey "via Safari against
`web/public/harness/passkey-native-rp.html`". Live investigation: `curl -s https://vault.blonie
.cloud/harness/passkey-native-rp.html` returns HTTP 200 `content-type: text/html`, but the body is
`pv-server`'s own SPA `index.html` fallback (`<title>Passkey Vault</title>`, no `rp-fixture-start`
button anywhere) -- Task 1's own file, committed to this repo, has never been deployed to the LIVE
`vault.blonie.cloud` Next.js frontend (that requires a production web-app redeploy, out of scope
for this session's own hard rule against further Oracle infrastructure changes beyond Task 2's own
sidecar). `crates/pv-provider/examples/ios_seed_passkey.rs`'s own module doc had ALREADY
anticipated exactly this non-localhost case ("A non-localhost rp_id (Plan 43-08) must pass
`--origin` explicitly") -- confirming the seeding-tool path was the plan's own intended fallback,
not an improvisation. `seed_real_passkey`/`ios_seed_passkey` (both already parameterizable, now
generalized in the shell function) perform a GENUINE registration ceremony, verified by the
fixture's own independent `webauthn-rs`, identical rigor to the Safari path -- only the DRIVING
mechanism differs. SC2's own truth (the ASSERTION side, native app -> system picker -> PV's real
extension) is unaffected either way.

**Root cause #1 -- `simctl launch --stdout=<repo-relative-path>` denies with a REAL EROFS, not a
SpringBoard timing race.** Every failed `simctl launch` logged (confirmed via `xcrun simctl spawn
"$udid" log show`, querying the SIMULATOR's own system log, not the host's):
`FBSOpenApplicationServiceErrorDomain Code=1 ... denied by service delegate (SBMainWorkspace)`,
with `NSUnderlyingError=... {Error Domain=NSPOSIXErrorDomain Code=30 "Read-only file system"}`
buried underneath. Before finding this, three escalating retry-loop-with-sleep designs were tried
and ALL failed 100% of the time regardless of how long or how many attempts (3 attempts/3s, 6/5s,
15/6s -- up to ~95s within-script; then a single genuinely idle `sleep 60` x5 rounds, up to 6
minutes) -- yet a brand-new, standalone `xcrun simctl launch` issued moments after the script gave
up succeeded EVERY time, immediately. That pattern (fails 100% inside the script, succeeds 100%
standalone, regardless of elapsed wait) is what pointed away from "SpringBoard needs more time" and
toward "something about THIS invocation's own arguments". Direct reproduction confirmed it: passing
`simctl launch --stdout=<path>` a path resolved under this repo's own working directory
(`ios/evidence/43/...`, exactly what the function used to pass) reproduces the EROFS denial
standalone, with zero build/wait involved; switching ONLY the target to an absolute
`/private/tmp/...` path fixes it immediately, first try, every time. `launchd_sim` opens that file
from ITS OWN process context (not the calling shell's), which in this bypass-permissions-sandboxed
session cannot write under the repo's own working directory.

**Root cause #2 -- `simctl launch --stdout=<path>` never captures a GUI app's own `print()` output
AT ALL, EROFS or not.** After fixing #1, the launch succeeded and the ceremony visibly ran (the
fixture's own `/challenge/assert` log line proved it), but the captured stdout file was STILL
completely empty. `simctl launch --stdout=`/`--stderr=` redirection does not reliably capture a
launched GUI app process's own stdout in this environment. Every OTHER probe/seeder in this
codebase already avoids this exact trap by using `os.Logger` + `xcrun simctl spawn <udid> log show
--predicate '...'` (this script's own header: "log-capture via `os_log` marker greps") --
`NativeSignInView.swift` was switched from `print()` to `os.Logger` (subsystem
`cloud.blonie.PasskeyVaultHarness`, category `sign-in`, every dynamic interpolation explicitly
`privacy: .public`, matching `PasskeyTracerSeeder.swift`'s own established discipline) to match,
and `cmd_native_app` now captures via `simctl spawn log show --predicate ... --start "$run_start"`,
the SAME idiom `ios-autofill-e41.sh`'s own PVFILL captures already use. `--stdout`/`--stderr` are
dropped from the `simctl launch` invocation entirely.

**Root cause #3 -- the system's own "Sign In" sheet defaults to "Scan QR Code" SELECTED, and
tapping the real provider row then "Continue" in the SAME poll iteration outruns the UI.** With
#1 and #2 fixed, the ceremony ran and the system sheet appeared, but the harness's own status froze
at "Requesting passkey..." forever (confirmed: no `PVHARNESS|stage=ceremony` line ever printed --
`ASAuthorizationController`'s own delegate callback never fired). A screenshot pulled from the
xcresult bundle (`xcrun xcresulttool export attachments`) at the moment "Continue" was tapped shows
the checkmark STILL on "Scan QR Code", not "More from PasskeyVault..." -- the test's own poll loop
tapped the provider row AND "Continue" back-to-back in the SAME iteration (two separate un-gated
`if` blocks), before the row-selection had visibly settled, so "Continue" proceeded with the
WRONG option selected, routing into a QR-code cross-device flow that can never complete on a
simulator with no second device to scan. A SECOND, compounding bug in the same screenshot chain:
the provider-row search used a bare `label CONTAINS[cd] "PasskeyVault"` predicate, which matched
the HARNESS APP'S OWN onscreen title text ("PasskeyVaultHarness", visible from launch, well before
any system sheet exists) as a false positive BEFORE the real system row ever appeared -- a
harmless-looking no-op tap on plain text that nonetheless set `selectedProvider = true`
prematurely. Fixed both: narrowed the search to `"More from"` (unique to the real system row's
observed text, "More from PasskeyVault..."), and gated the Continue-tap check on `!actedThisPoll`
plus an explicit `usleep(750_000)` after the provider-row tap, so a genuine settle window exists
before the next control is searched for.

**A bash 3.2 landmine, distinct from L-42's `declare -A` trap but the same species.** This host's
`/usr/bin/env bash` resolves to macOS's bundled bash 3.2.57 (`bash --version`, confirmed), not a
Homebrew-installed newer bash -- this project's own INTERACTIVE shell is zsh (L-3's own landmine),
but `#!/usr/bin/env bash` scripts run under 3.2. Bash 3.2 treats `"${arr[@]}"` on a GENUINELY EMPTY
array as an "unbound variable" error under `set -u`, not an empty expansion (fixed in later bash
versions). This broke the PLAIN (non-`--corrupt-signature`) `native-app` leg specifically, since
only that leg leaves `launch_args`/`extra_args`/`origin_args` empty (`--corrupt-signature` always
populates `launch_args` first, masking the bug there). Fixed with the standard
`${arr[@]+"${arr[@]}"}` bash-3.2-safe idiom everywhere this file expands a possibly-empty array
(`native-app`'s own `launch_args`, and `start_fixture`/`seed_real_passkey`'s pre-existing
`extra_args`/`origin_args`, both of which this plan's own generalization of those two shared
functions newly put at risk for `cmd_tracer`'s and `cmd_sc4`'s own existing, previously-working
call sites -- caught and fixed here before it could regress a phase in production use).

**Final live result, both legs, both signals agreeing:**
```
--corrupt-signature: RPFIXTURE|route=/assert/finish rp_id=vault.blonie.cloud ok=false reason="An OpenSSL Error has occurred"
                      PVHARNESS|stage=complete status=failed
plain:                RPFIXTURE|route=/assert/finish rp_id=vault.blonie.cloud ok=true reason=verified
                      PVHARNESS|stage=complete status=ok
```
`git diff --stat -- crates/pv-server` empty throughout. Evidence under `ios/evidence/43/43-08-
native-app*.{log,harness-stdout,log.fixture-stdout}`.

## 17. Phase 43, Plan 43-09 — ROADMAP SC5 two-direction interop, live and falsifiable, both directions (2026-08-22)

43-PLAN-CHECK.md B3's own gap closed: direction 1 ("iOS creates → extension asserts") had no named
harness anywhere. This plan proves BOTH directions of SC5 receiver-side against `crates/rp-fixture`
(43-03), each with its own corruption falsification, plus the Rust-layer byte-identity round trip
(Task 1) proving `create_provider_credential` and `make_credential_ctap2` produce field-identical
`Passkey` values from equivalent inputs (rp_id/user_handle/username match; credential_id/key
legitimately differ — two independent keypairs, not one credential synced twice).

**Direction 2 ("extension creates → iOS asserts"), the simpler half.** `scripts/ios-autofill
-e43.sh interop` reuses this plan's own `<read_first>`-sanctioned escape hatch: instead of driving
a real headed Chromium/Playwright ceremony, `scripts/ios-autofill-e43-interop-probe.mjs create`
calls `wasmCreateProviderCredential` directly, Node-side — the EXACT function the extension's own
popup calls, real ES256 keypair, real `crates/rp-fixture` verification (`/register/finish
ok=true`), then a real `POST /api/vault/items`. `PasskeyInteropSeeder.swift` (new,
`PV_PROBE_E43_INTEROP`) signs INTO that account (never registers a second one) and drives the
SAME production `VaultStore.refresh()` `ContentView` calls on every foreground — a real `GET
/api/sync` round trip, not a hand-staged cache write. `AutoFillPasskeyTracerUITests` (43-03's own
file) is reused completely unchanged — it just drives Safari generically and has no idea which
seeder populated the local cache.

**The corruption-leg surprise: iOS "kept and marked" vs. the extension's "skipped".** Both
`vault-store.ts` (extension) and `VaultStore.swift` (iOS) handle an undecryptable synced row, but
DIFFERENTLY — the extension's own doc comment says "skipped N undecryptable item(s) during sync"
(dropped from `vault.list` entirely); iOS's own T-38-02-02 discipline says "kept and marked, never
dropped." Live consequence for `interop --corrupt-signature`: the credential-picker sheet still
shows a "PasskeyVault" row (row metadata needs no decrypt), `crates/rp-fixture`'s own
`/challenge/assert` still gets issued (a generic challenge, not credential-specific) — but the
extension's own signing attempt against the corrupted ciphertext fails BEFORE it ever POSTs to
`/assert/finish` at all. Neither `ok=true` nor `ok=false` appears — `assert_tracer`'s own strict
"must find an explicit ok=<expect> line" predicate doesn't recognize this as the expected failure.
Fixed with a new `assert_interop` (reads the SAME `crates/rp-fixture` log lines, never a second RP-
driving mechanism) that accepts EITHER an explicit `ok=false` line OR complete absence of
`/assert/finish` as valid "fails visibly" for the corrupt leg — the ONLY failure mode is an
explicit `ok=true` appearing. Sanity-checked against a synthetic ok=true log line to confirm
`assert_interop` itself is genuinely falsifiable (L-3/L-9).

**Direction 1 ("iOS creates → extension asserts"), three real bugs found live, in order.**
`extension/e2e/ios-created-passkey-assertion.spec.ts` (new, `chromium-ceremony` project) drives a
REAL iOS registration via a new `sc5-register` subcommand (reuses Plan 43-07's own
`PV_PROBE_E43_SC4` + `PasskeyRegistrationSc4Seeder` + `AutoFillPasskeyRegistrationUITests`
VERBATIM — zero new Swift needed for this half, since SC4's own machinery already does exactly
"register a fresh account, then a real registration ceremony against `crates/rp-fixture`"), then
signs into that SAME account via the extension's real popup UI, polls `vault.list` (the real sync
pull), drives a real `navigator.credentials.get()` against `crates/rp-fixture` from the
extension's own browser context, and asserts receiver-side via `#rp-fixture-result[data-ok]`.

1. **Missing extension build.** First run failed in 1ms — `extension/.output/chrome-mv3` didn't
   exist (`npx playwright test` doesn't run the `pretest:e2e:chrome` npm-script hook `wxt build -b
   chrome` that `npm run test:e2e:chrome` would have). Fixed: `npx wxt build -b chrome` first.
2. **`PV_STATIC_DIR` — a pre-existing, previously-undocumented-in-code hazard, now cross-
   referenced.** The extension's own `SignInView.tsx` opens a REAL server-hosted ceremony window
   (`unlock.serverCeremony.start`) — a bare `pv-server` binary with no `PV_STATIC_DIR` is API-only
   (`crates/pv-server/src/main.rs`'s own `PV_STATIC_DIR` env read), so that window has nothing
   servable and the extension's own ceremony-window lifecycle silently self-closes it. This EXACT
   failure mode is already recorded in `STATE.md`'s own `[Phase 28]` note and 27-04/27-05/27-06-
   SUMMARY.md ("two separate agents" before this session) — this plan's `beforeAll` now sets
   `PV_STATIC_DIR=web/out` (built via `npm run build` in `web/`, a `next export` static bundle)
   and `PV_EXTENSION_ORIGINS=chrome-extension://*` directly, so a THIRD agent never repeats it.
3. **The popup closes itself on a successful confirm — a real, documented UX, not a bug.**
   `App.tsx`'s `resolveCeremony()` calls `window.close()` UNCONDITIONALLY on a successful confirm
   (`dual-extension-ceremony.spec.ts`'s own documented precedent, `popupA`/`popupA2`) — this
   spec's OWN first plain-path confirm closed `popup`, and the LATER corruption-phase
   `listVaultItems(popup)` call (many steps downstream, after an unrelated `execFileSync` blocking
   call made the symptom look like a Node-event-loop/CDP-starvation crash) failed with "Target
   page ... has been closed." Two candidate fixes were tried in order: making the corrupt-probe
   call async (`execFile` + `promisify`, objectively better practice regardless, kept) did NOT fix
   it — same failure, three consecutive full runs. The REAL fix: reopen a fresh `popup2` after the
   first confirm, mirroring `dual-extension-ceremony.spec.ts`'s own `popupA2` pattern exactly.

**Final live result, both directions:**
```
interop (plain):          RPFIXTURE|route=/register/finish rp_id=localhost ok=true reason=registered
                           RPFIXTURE|route=/assert/finish rp_id=localhost ok=true reason=verified
interop (--corrupt-signature): RPFIXTURE|route=/challenge/assert rp_id=localhost status=issued
                                (no /assert/finish line at all -- assert_interop's own new predicate)
direction 1 spec:          1 passed (plain path data-ok="true" + its own falsification data-ok="false", one test)
```
Combined plan verify command (`bash scripts/ios-autofill-e43.sh interop && (cd extension && npx
playwright test e2e/ios-created-passkey-assertion.spec.ts --project=chromium-ceremony)`) run once
more, end to end, exit 0. `bash scripts/check-ios-gate.sh` exits 0. Evidence under
`ios/evidence/43/43-09-interop*.{log,log.fixture-stdout}`.

## 18. Debug session -- native-app passkey REGISTRATION on a locked vault hangs silently, real-device report, root-caused and fixed on the simulator (2026-08-22)

Bartek's real iPhone 16 (iOS 27.0, a beta -- Xcode 26.6 on this machine only has the iOS 26.5 SDK,
no local iOS 27 SDK exists): in the Discord native app, "add a passkey" -> chose Passkey Vault ->
tapped Save -> a completely blank white sheet, nothing happened, the flow never completed. His own
host-app-process log capture showed zero `PVFILL|passkey-reg|` lines -- suggestive but not proof
the override never ran (a SEPARATE process's own console).

**Gap found first:** no prior plan in this codebase ever drove a passkey REGISTRATION request from
a genuine NATIVE (non-Safari) app through the system's own credential-picker surface. 43-07/SC4
proved registration via SAFARI's `navigator.credentials.create()` only; 43-08/SC2 proved a native
app's ASSERTION only (`ios/PasskeyVaultHarness/NativeSignInView.swift`, sign-in only, never
create). This exact combination -- native app + registration -- was genuinely untested territory.

**Built to close the gap:** `ios/PasskeyVaultHarness/NativeCreateView.swift` (new, mirrors
`NativeSignInView.swift`'s own `ASAuthorizationController` pattern for
`createCredentialRegistrationRequest(challenge:name:userID:)`, a local random challenge -- no
`crates/rp-fixture` round trip needed since the question is ROUTING, not cryptographic
correctness), `PasskeyVaultUITests/NativeAppRegisterUITests.swift` (new, mirrors
`NativeAppSignInUITests.swift`), and `scripts/ios-autofill-e43.sh native-app-register
{locked|unlocked}` (new subcommand -- `locked` needs no `pv-server` at all, since the extension
refuses before ever reaching the network; `unlocked` reuses `PasskeyRegistrationSc4Seeder`
verbatim). Also added DEBUG-only `PVDIAG|method=<name>` logging
(`CredentialProviderViewController.swift`) to every `AS*` override the class can implement,
including ones with no production implementation (`viewDidLoad`/`viewWillAppear`/`viewDidAppear`,
the deprecated `ASPasswordCredentialIdentity`-typed overloads, the CONDITIONAL registration entry
point, one-time-code and text-insertion entry points) -- converts "we saw nothing" into "the
system called X", the actual diagnostic this investigation needed.

**LIVE FINDING: a REGISTRATION request's own default system sheet is a COMPLETELY DIFFERENT shape
from the assertion sheet every prior harness in this codebase was built against.** Not "Sign In" +
"More from PasskeyVault..." (43-08's own precedent) -- a "Save a passkey?" sheet with PasskeyVault
ALREADY pre-checked (a real app-icon row) and a direct "Add Passkey" confirm button, no separate
row-selection step. The FIRST test run's own gate (copied verbatim from the assertion sibling,
searching for "Add Passkey" only AFTER a "More from" row-tap that this shape never needs) never
even searched for the visible, waiting button -- a pure test-harness bug, caught and fixed by
reading the xcresult's own screenshots (`xcrun xcresulttool export attachments`), not by guessing.

**Root cause, confirmed via a direct live differential (same code, only lock state differs):**
`PasskeyRegistrationPreflight.decide`'s `.refuseLocked` branch cancelled via
`ASExtensionError(.userInteractionRequired)` from INSIDE `prepareInterface(forPasskeyRegistration:)`
-- confirmed against the real iPhoneOS26.5.sdk headers to be the ONLY entry point a standard
registration request ever reaches (no sibling "without user interaction" registration entry point
to retry into, unlike the assertion family's silent -> interactive two-step). Locked run: `viewDidLoad`
fires (6x across repeated user taps of the system's own sheet) but `viewWillAppear`/`viewDidAppear`
NEVER fire even once; the harness's own `ASAuthorizationController` delegate never receives ANY
callback in 50s; the system's chooser sheet stays inert but tappable forever -- directly reproducing
"tapped Save, nothing happened, flow never completed". Unlocked run (identical code, only
`SessionLifecycle.checkAndExpireIfNeeded` returns `.unlocked` instead of `.indeterminate`):
`viewWillAppear`/`viewDidAppear` BOTH fire, and the accessibility dump captured at that moment shows
`identifier: 'passkeyRegistration.confirm'` genuinely on screen.

**Fix:** `.refuseLocked` now cancels with `ASExtensionError(.failed)`, matching this same switch's
sibling refusal (`.refuseUnsupportedAlgorithm`) two lines above and
`ASCredentialProviderViewController.h`'s own documented convention for the interactive
`prepareInterface*` family (`.userInteractionRequired` is documented for the NON-interactive
`provideCredentialWithoutUserInteraction` family only).

**Verification, honestly partial.** A real A/B falsification (revert the one line, rerun live,
restore, rerun live again) found `viewWillAppear` presence to be the CLEAN, reproducible,
code-level causal signal (0-of-7 invocations with `.userInteractionRequired` across two separate
runs; 2-of-2 with `.failed`) -- the exact system-sheet RETRY-TAP COUNT (6x vs 1x) is noisier,
confounded by an XCUITest AX-cache race against a system-owned cross-process element this session's
own defensive `.exists` pre-tap guard sometimes blocks. NOT verified in either state: whether the
REQUESTING app's own `ASAuthorizationController` delegate ever receives a completion callback --
neither pre- nor post-fix runs captured one within 50s+, plausibly because the ephemeral,
test-torn-down harness process never lives long enough for a slower system-level callback, not
necessarily a property of either code path. iOS 27 itself (Bartek's real device) is entirely
untestable from this machine (no iOS 27 SDK/simulator available) -- device-side confirmation is the
one thing this session could not produce. `bash scripts/check-ios-gate.sh` exits 0 (all six
sub-gates). Evidence: `ios/evidence/43/e43-10-native-app-register-{locked,unlocked}.log{,.extension-log,.harness-log}`,
full debug trail in `.planning/debug/resolved/passkey-reg-blank-sheet-discord.md` (not committed --
`.planning/` is never committed from this worktree, D-obligation per `docs/IOS-HANDOFF.md` §8).

## 19. Landmine -- an app extension's main bundle is its own `.appex`, asset lookups degrade silently, and identifier-based UI assertions cannot see it (2026-08-22)

Same debug session as §18, continued: Bartek retested on his REAL iPhone 16 (iOS 27.0) after the
`.failed` fix above landed, and captured the EXTENSION's OWN os_log this time (not the host-app-only
capture §18 had to work from). The ceremony ran CORRECTLY -- unlocked, `PVFILL|passkey-reg|
stage=preflight status=ok`, the RP's real data (`userName=bartek@paczesny.pl`), and the full view
lifecycle (`viewDidLoad` -> `viewWillAppear` -> `viewDidAppear`) -- interleaved with dozens of:

```
No color named 'PVBackground' found in asset catalog for main bundle (.../PasskeyVault.app/PlugIns/PasskeyVaultAutoFill.appex)
No color named 'PVTextPrimary' / 'PVTextMuted' / 'PVAccent' / 'PVOnAccent' / 'PVPasskey' found ...
CoreUI: -[CUICatalog initWithName:fromBundle:error:] unable to find a bundle ... with identifier 'cloud.blonie.PasskeyVault.AutoFill'
```

**The landmine.** `Color("PVAccent")` and friends resolve against the CURRENT process's own main
bundle -- for an app extension that is its `.appex`, never the host app's `.app`, even though the
extension is embedded inside the host app's bundle and the user experiences them as "one app". This
project's own project structure made the mismatch trivial to introduce: `Assets.xcassets` lived
under `PasskeyVault/PasskeyVault/` (Xcode 16's `PBXFileSystemSynchronizedRootGroup` "folder groups"
-- a whole on-disk folder is a target's compiled sources/resources by simple membership in that
target's own `fileSystemSynchronizedGroups`, no per-file checkbox). `PasskeyVaultAutoFill`'s own
`fileSystemSynchronizedGroups` was `(PasskeyVaultAutoFill, Shared, PvShared)` -- it never included
the `PasskeyVault` folder the catalog lived in, so the extension shipped with ZERO asset catalogs of
its own. **Asset lookup failure is silent by design** -- no crash, no build warning, no thrown
error, just a `Fault`-level os_log line an engineer has to already know to go looking for -- so
`PasskeyRegistrationConfirmView.swift` (the ONE screen this extension draws, `43-07-PLAN.md`'s own
scope fence) painted a fully legible SwiftUI view tree with every colour silently substituted by the
platform's own fallback: a literal, completely blank white sheet -- Bartek's own words, verbatim.

**Why THREE separate proof surfaces missed it, live, at the same time.** (1)
`scripts/audit-ios-colour-tokens.sh`'s own check 2 asserts a referenced `PV*` token has a REAL
colorset SOMEWHERE in the repo -- it has no concept of TARGET membership, so a colorset that exists
but ships in the wrong target's bundle passes it cleanly. (2) `NativeAppRegisterUITests.swift`
(§18's own harness) found `passkeyRegistration.confirm` by ACCESSIBILITY IDENTIFIER and tapped it --
XCUITest's identifier lookup walks the accessibility tree regardless of whether anything was ever
actually painted to the screen; the confirm ceremony completed end-to-end (`stage=complete
status=ok`) against a screen with zero legible pixels, and the test suite reported PASS the whole
time. (3) Manual/agent code review, twice, read `PasskeyRegistrationConfirmView.swift` and confirmed
every `Color("PV...")` named a real colorset that existed in the repo -- true, and irrelevant, since
none of the three checks ever asked "does THIS target's own compiled bundle contain it". This is
this project's own recurring defect shape (`ios/IOS-SPIKE-LOG.md` L-9 and 5 other recorded
instances): **evidence that measures the wrong thing** -- every proof surface was green, and none of
them could have caught this class of bug, because none of them measured target-scoped resolution or
actual painted pixels.

**Fix.** Relocated every `PV*`/`AccentColor` colorset (`scripts/gen-ios-colorsets.py`'s own
generated output, from `ios/brand/tokens.json` -- the ONE source of truth) from
`PasskeyVault/PasskeyVault/Assets.xcassets` into a NEW `PasskeyVault/Shared/PVColors.xcassets` --
`Shared/` was ALREADY a `fileSystemSynchronizedGroups` member of BOTH the `PasskeyVault` app target
and the `PasskeyVaultAutoFill` extension target, so this needed ZERO `project.pbxproj` edits.
AppIcon/onboarding images stay app-only (the extension never references them). `ContrastTests.swift`
(reads colorset `Contents.json` files directly from disk at test time) and
`scripts/audit-ios-colour-tokens.sh` (colorset-existence check) both repointed at the new location;
the latter also now scans `PasskeyVaultAutoFill`/`Shared`/`PvShared` sources, not just the app's own
-- it had never scanned the extension's own code at all.

**Closing the evidence gap, not just the bug.** Two new, falsifiable artifacts, both driven RED
against the pre-fix code before being driven GREEN against the fix (never claimed without the
red-then-green transcript):
  - `scripts/measure-ios-color-token.py` -- reads a screenshot's ACTUAL PIXELS (stdlib-only,
    `sips`-via-BMP, same technique as `scripts/measure-ios-dock-panel.py`) and asserts a named
    token's real hex value is present (or, for the RED proof, absent) as a genuine, non-trivial-area
    fill -- never `exists`/`isHittable`, never eyeballing. RED (pre-fix, tolerance=2 to cleanly
    separate `PVBackground`'s `#FCFBFA` from the platform's own `#FFFFFF` fallback, which is
    otherwise a false-positive trap): `PVAccent`/`PVBackground`/`PVTextPrimary`/`PVPasskey` all
    0 matching samples on the confirm screen -- a literal blank white sheet, visually confirmed
    (`ios/evidence/43/asset-resolution/RED-confirm-screenshot.png`). GREEN (post-fix, same harness,
    same test, only the colorset location changed): `PVAccent` 16444 samples, `PVBackground` 259419,
    `PVTextPrimary` 742 -- all well over the 200-sample floor
    (`ios/evidence/43/asset-resolution/GREEN-confirm-screenshot.png`). The SAME live run's raw
    os_log corroborates independently: 131 `No color named ...`/`CUICatalog` fault lines pre-fix
    (`ios/evidence/43/asset-resolution/RED-coreui-warnings.log`), 0 post-fix
    (`GREEN-coreui-warnings.log`) -- reproduced on THIS machine's iOS 26.5 simulator, not only
    inferred from Bartek's real-device log.
  - `scripts/audit-ios-extension-asset-resolution.py` -- a MECHANICAL, static gate (no build, no
    simulator): parses `project.pbxproj`'s own `fileSystemSynchronizedGroups`/
    `PBXFileSystemSynchronizedRootGroup` structure for a named target, resolves which on-disk
    folders (and therefore which `.xcassets` catalogs) that target actually ships, and asserts every
    `Color("...")`/`UIColor(named:)`/`Image("...")` reference in that target's own Swift code
    resolves against THAT set -- never "resolves somewhere in the repo". RED against the unfixed
    project: `FAIL -- 6 asset name(s) referenced by 'PasskeyVaultAutoFill' code do NOT resolve...`
    (naming all six, file:line). GREEN after the relocation: `PASS -- every referenced asset name
    resolves...`. Wired into `scripts/check-ios-gate.sh` as `gate_asset_resolution`, with its own
    `falsify_asset_resolution` proof (a wholly synthetic scratch fixture -- an unresolvable
    reference must FAIL naming it, AND, the positive control this project's own discipline requires
    before trusting an absence assertion, a resolvable reference in the SAME fixture must PASS) --
    this project's `GATES` composer now runs seven sub-gates, not six.

**The landmine, stated for reuse:** an app extension's asset-catalog lookups run against its OWN
main bundle (the `.appex`), never the host app's; the failure mode is silent (no crash, no build
error) rather than loud; and an XCUITest assertion built on accessibility identifiers cannot
distinguish "this control exists and is legible" from "this control exists and painted nothing" --
only a pixel-level or target-membership-level check can. Any future extension target in this
project (or a new asset added to `PasskeyRegistrationConfirmView.swift` or a sibling screen) is
covered going forward by `gate_asset_resolution`, which fails the build the moment a referenced name
stops resolving in that target's own catalogs.

## 20. Phase 43 — whole-phase gate, OPT-04 closure, and SC1-6 roll-up (Plan 43-10, 2026-08-22)

Mirrors §7's own Phase-38 whole-phase-gate pattern and §6's own SC-by-SC evidence pattern: every
named structural-gate command run INDIVIDUALLY, its own exit status and one-line result recorded
below, never inferred from one composed exit code (43-PLAN-CHECK.md C6); then all six ROADMAP
Phase 43 success criteria answered one by one with a specific evidence citation each
(43-PLAN-CHECK.md C7), carrying the SC2/SC3 controlled-stand-in disclosure forward verbatim.

### Gate commands, each run via its own `--only <name>` (or standalone script) invocation

**`scripts/check-ios-gate.sh`'s seven sub-gates (the plan's own `<read_first>` named six; a
seventh, `asset_resolution`, was added by this same phase's own §19 landmine fix, commits
`6fdd8da`/`1c32d2f`, AFTER this plan's text was written — run here too, since the composer's own
`GATES` array now names seven, and citing only six would be exactly the "not re-run against
current reality" gap this task exists to prevent):**

1. **`bash scripts/check-ios-gate.sh --only qa05`** — exit 0. `PASS[qa05]: zero .planning/ commits
   authored on this branch itself since 6bbee654a1a591970e7c6db4d7c933d580061b07 (excluding
   $QA05_EXCLUDE_REF=origin/main; positive control: 364 commit(s) found under -- ios/; commit_docs
   precondition holds)`.
2. **`bash scripts/check-ios-gate.sh --only ffi_build`** — exit 0. Both triples built
   (`aarch64-apple-ios-sim`, `aarch64-apple-ios`), Swift bindings generated, `PvFfi.xcframework`
   assembled, its own vtool slice gate passed both platform tags.
3. **`bash scripts/check-ios-gate.sh --only ffi_falsifiable`** — exit 0. All three falsification
   proofs passed: the device-slice platform-tag corruption genuinely fails the gate, the
   simulator-slice corruption genuinely fails the gate, and the WR-03 "slice must contain pv-ffi's
   own code" guard genuinely refuses a scratch copy with zero `pv_ffi*.o` objects rather than
   validating an unrelated one.
4. **`bash scripts/check-ios-gate.sh --only ffi_opaque`** — exit 0. Bindings freshness precondition
   held (no `crates/pv-ffi/src/` source newer than the generated `pv_ffi.swift`); zero raw-byte
   accessors beyond the two sanctioned exceptions across six audited handle classes and one
   handle-carrying struct.
5. **`bash scripts/check-ios-gate.sh --only swift_tests`** — exit 0 (after 1 known-transitional
   L-41 bindings-transition retry, per this sub-gate's own documented, non-regression retry
   discipline). Scheme `PasskeyVault` present (E9 autocreated); executed-test count=5 (> 0, E8's
   zero-count trap did not fire); all required FFI identifiers matched
   (`FfiRoundTripTests`×3, `FfiPanicSafetyTests`×2).
6. **`bash scripts/check-ios-gate.sh --only qa_register`** — exit 0. 150 rows parsed across 7
   in-coverage phase sections (Phase 35 confirmed among them, the positive control); every row
   resolves to a real file:line with a non-empty excerpt; phases 29/30 (different milestone), 42
   (still executing when it ran its own audit), and 43 (conditional, absence is valid) correctly
   excluded and named, never silently dropped.
7. **`bash scripts/check-ios-gate.sh --only asset_resolution`** — exit 0. For target
   `PasskeyVaultAutoFill`: 6 distinct asset names referenced, all 6 resolve in the target's own
   synced catalogs (23 distinct resolvable names total) — this is the static, mechanical form of
   §19's own pixel-measurement proof, now a standing gate.

**Named structural gates outside the seven-gate composer, each run standalone:**

8. **`bash scripts/audit-ios-identity-store-chokepoint.sh`** — exit 0. `PASS: the identity store
   is written ONLY from the reviewed allow-list
   (IdentityStoreSync.swift, MatchingProbe.swift, IdentityStoreSyncProbe.swift), and all 7
   enumerated mutation call sites still reach their own required IdentityStoreSync entry point
   (FILL-03, CR-01)`.
9. **`bash scripts/audit-extension-network-scope.sh`** (43-06) — exit 0. `PASS: the AutoFill
   extension constructs VaultAPI ONLY from the reviewed allow-list
   (CredentialProviderViewController.swift), and every such construction site calls ONLY
   .createItem( (T-43-10, DR-43-A)`.
10. **`python3 scripts/gen-ios-colorsets.py --check`** — exit 0. `PASS: all 23 colorsets match
    tokens.json (incl. generated AccentColor)`.
11. **`bash scripts/audit-generator-uses-ffi.sh`** — exit 0. All five checks (three negative, two
    positive) hold; negative results confirmed non-vacuous by the script's own positive controls.
12. **`bash scripts/audit-clipboard-single-writer.sh`** — exit 0. `PASS -- UIPasteboard is written
    from the choke point, plus only the one documented, exactly-counted, DEBUG-scoped exception`.
13. **`bash scripts/audit-sync-decision-records.sh`** — exit 0. `PASS: SYNC-05's decision record
    (reasoning, not just the token) found in SyncCoordinator.swift; FILL-03 hook marker present`.
14. **`bash scripts/audit-ios-autofill-deprecated-apis.sh`** — **exit 1, RED. Recorded plainly,
    never softened, mirroring L-14's own precedent.** `FAIL: deprecated AuthenticationServices
    spelling(s) found` — two hits, both in
    `ios/PasskeyVault/PasskeyVaultAutoFill/CredentialProviderViewController.swift`
    (`provideCredentialWithoutUserInteraction(for: ASPasswordCredentialIdentity)` line 84,
    `prepareInterfaceToProvideCredential(for: ASPasswordCredentialIdentity)` line 91). Investigated,
    not merely reported: both call sites sit inside a `#if DEBUG ... #endif` block (lines 48–110)
    added by this same phase's own commit `cf1dfad` (§18 above, the locked-vault registration hang
    fix) — a deliberate, documented diagnostic ("Gated `#if DEBUG` -- never ships in Release",
    the block's own header comment) added specifically to empirically settle whether iOS 27
    reintroduces or prefers these deprecated overloads, never intended as production behavior. This
    audit script's own header (top of file) names no `#if DEBUG` carve-out — unlike
    `audit-clipboard-single-writer.sh`'s own "one documented DEBUG-only exception" — so it flags
    DEBUG-gated diagnostic code identically to production code. This is this gate's FIRST run since
    `cf1dfad` landed (zero prior mention of `audit-ios-autofill-deprecated-apis.sh` anywhere in this
    file); it is a genuine, newly-discovered red state, not a regression this plan's own Task 2
    introduced (Task 2's `files_modified` is `ios/IOS-SPIKE-LOG.md` only — no Swift source touched).
    **Not fixed here** — Task 2 is an evidence roll-up, and whether to strip the DEBUG-only override
    pair, add a DEBUG carve-out to the audit script, or leave both as-is pending further real-device
    investigation (`.planning/debug/passkey-reg-blank-sheet-discord.md`'s own open questions) is a
    call for whichever plan next touches this file, recorded here for visibility rather than
    silently patched over.

**PHASE-GATE:** not a bare `PASS` — one of the fourteen named commands above (#14) is genuinely
RED. Every command that CAN legitimately gate this phase's own work does: #1–13 all PASS
individually-cited, live evidence; #14's red state is investigated to its root cause, shown to be a
pre-existing, DEBUG-only diagnostic addition from this same phase (not this plan's own change), and
recorded unsoftened rather than the phase being marked complete over it.

**CORRECTION, 2026-08-22 (same day) — #14 is GREEN, 14/14, not 13/14.** The paragraph above and
item #14 are left unedited as the honest record of this gate's state at the moment this plan's
Task 2 ran. They are now stale: §19a's real-device measurement (Bartek's iOS 27.0 captures across
password fills, Safari assertion, and registration in Discord and on X) answered the exact question
`cf1dfad`'s diagnostic pair existed to settle — the two deprecated overloads never fired on real
iOS 27 hardware while their sibling `PVDIAG` lines in the same logs did. `da4a836`
(2026-08-22T13:30:30+02:00) removed the diagnostic pair on that basis (commit message: "`audit-ios-
autofill-deprecated-apis` was correctly red on them and is green again; `check-ios-gate.sh` exits 0
across all seven sub-gates"). Independently re-run twice since — once by 43-VERIFICATION.md's own
verifier pass, once again for this correction: `bash scripts/audit-ios-autofill-deprecated-apis.sh`
→ `PASS: no deprecated AuthenticationServices spelling found across 118 Swift file(s) ... (0
skipped)`, exit 0; `bash scripts/check-ios-gate.sh` → exit 0, all seven sub-gates individually
`PASS[...]`. Gate #14 is GREEN. This phase's whole-gate state is **14/14**, not "thirteen-of-
fourteen green" — `.planning/WINDOWS.md` entry 21 (which tracked this same deviation) is closed for
the identical reason.

### ROADMAP Phase 43's six success criteria, answered one by one

**SC1 — OPT-01 decision record committed alone, before any passkey code.** Re-verified by commit
order, not merely position: `git log --oneline --reverse -- ios/IOS-SPIKE-LOG.md crates/pv-provider/
crates/pv-ffi/ ios/PasskeyVault/PasskeyVault/PasskeyVaultAutoFill/` still shows commit `b355d35`
(`docs(43-01): OPT-01 decision record...`) as the sole, newest match in that filtered log at the
time it was authored — no commit touching `crates/pv-provider/`, `crates/pv-ffi/`, or the AutoFill
extension target predates it. Evidence: Plan 43-01's own SUMMARY, `ios/IOS-SPIKE-LOG.md` §1m.

**SC2 — assertion in a native app, via the system's own `ASCredentialProviderViewController`.**
Proven live: `ios/PasskeyVaultHarness` (Plan 43-08), using `ASAuthorizationController`, offers
Passkey Vault's passkey and completes a real sign-in ceremony, verified independently by
`crates/rp-fixture`'s own `webauthn-rs` check, falsifiable via signature corruption —
`RPFIXTURE|route=/assert/finish rp_id=vault.blonie.cloud ok=true reason=verified` (plain) /
`ok=false reason="An OpenSSL Error has occurred"` (corrupted), both legs, `ios/IOS-SPIKE-LOG.md`
§16. **Controlled-stand-in disclosure, carried forward as Plan 43-08's own SUMMARY states it:**
Plan 43-08's SUMMARY describes this proof as "a real native, **third-party-shaped** app
(`ios/PasskeyVaultHarness`)" — `ios/PasskeyVaultHarness` is this project's OWN harness app, built
to be *shaped like* a third-party consumer of the system passkey picker; it is never a genuinely
external, independently-published third-party app. `vault.blonie.cloud` is this project's own
hosted instance, serving AASA for the harness's own bundle id — not a genuinely external RP either.

**SC3 — assertion in Safari, on a real page, asserted receiver-side.** Proven live via the phase's
own tracer (Plan 43-03): a browser-extension-shaped passkey asserts successfully in Safari on the
pinned simulator, verified receiver-side by `crates/rp-fixture`, falsifiable via signature
corruption (`ok=false reason="An OpenSSL Error has occurred"` corrupted →
`ok=true reason=verified` plain), `ios/IOS-SPIKE-LOG.md` §11. **Controlled-stand-in disclosure,
quoted verbatim from Plan 43-03's own SUMMARY (C7):** "the RP throughout is `crates/rp-fixture`, a
project-controlled stand-in SHAPED LIKE a third party — never a genuinely external RP."

**SC4 — registration: a passkey created by PV for a third-party RP is saved in the vault as a
`passkey`-typed item and visible server-side.** Proven live (Plan 43-07): registration wired
end-to-end (confirmation screen → CTAP2 ceremony → item encryption → network creation with
self-heal → identity-store registration → ceremony completion), 6/6 unit tests green
(`PasskeyRegistrationOverrideTests`), plus a live e2e proof —
`scripts/ios-autofill-e43.sh sc4`: live registration ceremony against `crates/rp-fixture`, with
RECEIVER-SIDE assertion via `GET /api/vault/items` against a real, isolated `pv-server` (not iOS,
not a mock — the same `pv-wasm` receiver discipline `scripts/sync-contract-probe.sh` already
established). `ios/IOS-SPIKE-LOG.md` §14.

**SC5 — interop, both directions, asserted receiver-side.** Proven live (Plan 43-09), each
direction with its own corruption falsification: (1) extension creates → iOS asserts —
`scripts/ios-autofill-e43.sh interop`: `RPFIXTURE|route=/register/finish rp_id=localhost ok=true
reason=registered; RPFIXTURE|route=/assert/finish rp_id=localhost ok=true reason=verified`, corrupt
leg shows no `/assert/finish` line at all (iOS's own signing fails before it can POST — a valid
"fails visibly" shape per `assert_interop`'s own documented acceptance); (2) iOS creates →
extension asserts — `extension/e2e/ios-created-passkey-assertion.spec.ts`: 1 passed (2.3m),
`rp-fixture #rp-fixture-result data-ok="true"` for the plain path, `data-ok="false"` after a direct
ciphertext-corrupting `PUT /api/vault/items/{id}` mutation and a real re-sync. `ios/IOS-SPIKE-LOG.md`
§17.

**SC6 — OPT-04: deferred scope recorded with a reason, product compiles/behaves identically
without it.** Proven this plan, Task 1: `cargo build --workspace` green; `.hmac_secret(` confirmed
at exactly the two pre-existing call sites in `ceremony.rs`, zero in either of the two new CTAP2
entry points; `largeBlob`/PRF grep across the shipped Swift surface returns zero functional hits
(one source-comment cross-reference to this very decision record); `crates/rp-fixture` and
`ios/PasskeyVaultHarness` confirmed absent from `Dockerfile` and every production build/deploy
path. `ios/IOS-SPIKE-LOG.md` §1n. **L-14 re-probed live THIS session, recorded unsoftened: STILL
CRASHING** (`xcodebuild -configuration Release` exit 65, identical `UniffiHandleMap...deinit`
crash signature to the 2026-08-16 original and the 2026-08-20 Phase 42 re-probe) — a separate,
pre-existing landmine (Phase 38) this phase neither caused nor fixed, remaining the milestone's own
ship blocker among its three recorded options, Bartek's own call. Evidence:
`ios/evidence/43/43-10-l14-reprobe.log`.

### Operator attestation — real-device confirmation, outside this session's own reach (2026-08-22)

**Given by Bartek directly, today, after the two post-plan fixes (`cf1dfad`, §18; `6fdd8da`/
`1c32d2f`, §19) landed:** rebuilt onto his own iPhone 16 / iOS 27.0 and confirmed passkey
registration **works in the Discord app and on X (twitter)** — real third-party services, not this
project's own fixtures. This is the FIRST real-world confirmation of SC2/SC3-shaped behavior
outside the harness/tracer, on genuinely external, independently-published third-party apps. It is
recorded here precisely as what it is: an **operator attestation on a real device with real RPs**
— the same evidence class Phase 37's own device run used — **NOT a captured artifact** (no log,
transcript, or screenshot from that run exists in this session's own evidence tree), and this
machine cannot reproduce it: Xcode 26.6 tops out at the iOS 26.5 SDK, his device runs 27.0, a
newer SDK than this toolchain can target. Distinct from, and does not substitute for, SC2/SC3's own
controlled-stand-in evidence above — it corroborates that the controlled stand-ins generalize to
genuinely external RPs, without itself being the falsifiable, receiver-side-verified proof this
project's own QA-01 standard requires for a SC2/SC3 claim.

### Evidence-quality lesson, carried forward from §19, not buried

**A green SC4 proof and a green native-app (SC2) proof both survived the `.appex` colour-token bug
§19 found and fixed.** Two independent reasons, both worth restating here rather than only in §19:
XCUITest assertions built on accessibility identifiers match whether or not anything is actually
DRAWN (a control can exist, respond to taps, and paint nothing, and an identifier-based assertion
cannot tell the difference); and the colour gate that existed before §19 verified token USE
(`Color("PV...")` appears in source) never token RESOLUTION in the actual rendering target (whether
that name resolves against the `.appex`'s own bundle). Both gaps are now closed —
`gate_asset_resolution` (#7 above) checks resolution, not use — but the lesson generalizes: a green
functional proof and a green static-use proof together are still not sufficient evidence that a UI
surface renders anything a human can see. Standing caution for any future extension-target UI work
in this project, not a closed incident.

**PHASE 43: OPT-04 closed; SC1-SC6 each answered with a specific, individually-cited evidence
source; the SC2/SC3 controlled-stand-in disclosure carried forward rather than dropped; the
whole-phase gate is thirteen-of-fourteen individually-verified green with the fourteenth's red
state investigated to its root cause and recorded plainly. L-14 remains open, unchanged by this
phase, and remains Bartek's own call.**

## 19a. The legacy `ASPasswordCredentialIdentity` overloads are dead on iOS 27 too — measured, then removed

**2026-08-22.** While root-causing the blank-registration-sheet report, `cf1dfad` temporarily
overrode the two DEPRECATED `ASPasswordCredentialIdentity`-typed entry points
(`provideCredentialWithoutUserInteraction(for:)`, `prepareInterfaceToProvideCredential(for:)`)
purely to log. The question they existed to answer was real and could not be answered here: Bartek's
device runs **iOS 27.0** while this toolchain tops out at the **iOS 26.5 SDK**, so "does a newer OS
reintroduce or prefer the legacy shape?" was genuinely open, and L-1's own lesson says not to assume
either way.

**Answered by measurement, on real hardware.** Across every capture Bartek took on iOS 27.0 —
password fills, passkey assertion in Safari, passkey registration in the Discord app and on X —
neither `PVDIAG|method=provideCredentialWithoutUserInteraction(for:ASPasswordCredentialIdentity)`
nor its `prepareInterfaceToProvideCredential` sibling **ever appeared**, while
`PVDIAG|method=viewDidLoad`/`viewWillAppear`/`viewDidAppear` and the request-typed overloads did.
The absence is informative precisely because the sibling lines in the same log prove the diagnostic
was live and capable of printing.

**So they were removed** (gate `scripts/audit-ios-autofill-deprecated-apis.sh` went red on them, and
it was right to: shipping a deprecated spelling is exactly what it exists to refuse). A diagnostic
that has discharged its question is debt, not evidence — the finding belongs in this log, not in the
shipped class.

## 8e. Phase 43 — human-verify backlog (2026-08-22, orchestrator disposition)

Phase 43 closed after one gap-closure cycle. Owed to a human / later work:

1. **SC2's ASSERTION clause on a genuine third-party app.** Bartek's real-device attestation
   (iPhone 16 / iOS 27.0) covers passkey **registration** in the Discord app and on X — real
   services, and it earned its keep by surfacing two real defects (§18 the locked-vault hang, §19
   the invisible confirm UI). The *assertion* half is proven against PV's own harness app and PV's
   own RP fixture. Honest disposition: mechanism proven receiver-side and falsifiably; the
   third-party-app assertion path is attested-adjacent, not captured.
2. **43-11 never executed** — the safety-designed real-hardware plan. Its product substance is
   largely discharged by Bartek's own device testing, but its *evidence* substance is not: no
   captured device artifact, the Face ID gate never observed under it, and the throwaway-account
   safety protocol never ran.
3. **L-14 remains the milestone's ship blocker** — re-probed live 2026-08-22, still exits 65 with
   the same `UniffiHandleMap…deinit` / `EarlyPerfInliner` crash. **Every Phase 43 proof is a Debug
   build**; no claim in this phase covers Release.
