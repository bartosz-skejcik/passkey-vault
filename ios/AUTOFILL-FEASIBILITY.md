# AutoFill Feasibility — Phase 36

Phase 36 answers FILL-01/FILL-06 on evidence produced by a real built extension bundle
(`PasskeyVaultAutoFill.appex`), not on a reading of Apple's capability table. This file is the
committed record; `ios/IOS-SPIKE-LOG.md` §3 carries the landmines this phase's own findings touch
(L-7, L-8, L-10).

> **Ograniczenie dowodu**: wynik jest prawdziwy dla **symulatora pod darmowym Apple ID** konkretnie —
> CP-1 sam nazywa napięcie między dwoma sprzecznymi źródłami o tym, czy symulator w ogóle egzekwuje
> allowlisting entitlementu tak jak realne urządzenie. Ten wynik nie ekstrapoluje się automatycznie na
> sprzęt.

This file never states that account type caused an entitlement outcome — the simulator path has no
grantor and measures no such property (D-02, 36-RESEARCH.md Pitfall 1). `scripts/ios-autofill-layers.sh
wording-gate` enforces that discipline mechanically.

## E1 — Do the entitlements survive into the built extension? (SC1, part 1)

**Setup**: `PasskeyVault.app` + `PasskeyVaultAutoFill.appex` built for the simulator via
`scripts/build-ios.sh` (plain, no panic probe) + `xcodebuild -scheme PasskeyVault build`,
`-derivedDataPath /tmp/pv-dd`, no `DEVELOPMENT_TEAM` configured (IOS-04).

### Positive result — both binaries carry all three entitlement keys

`python3 scripts/sim-entitlements.py <binary>` exits 0 against both the built appex
(`ios/evidence/36/appex-entitlements.plist`) and the built app (`ios/evidence/36/app-entitlements.plist`),
and both outputs contain all three:

- `com.apple.developer.authentication-services.autofill-credential-provider = true`
- `com.apple.security.application-groups = [group.cloud.blonie.PasskeyVault]`
- `keychain-access-groups = [FAKETEAMID.cloud.blonie.PasskeyVault]`

`FAKETEAMID.` is Xcode's own simulator placeholder for `$(AppIdentifierPrefix)` with no team
configured — the literal value observed, never hardcoded in a source file (D-14, landmine L-8; see
`scripts/ios-autofill-layers.sh wording-gate`'s team-prefix scan).

### Falsification, recorded

`python3 scripts/sim-entitlements.py /bin/ls` exits 2 and prints
`FAIL: no __TEXT,__entitlements section in /bin/ls` — the transcript proving this reader is not a
check that always passes.

### The codesign-mechanism disagreement, settled

Two research probes disagreed over whether `codesign` can read simulator entitlements at all. Both
forms were run against the real built appex and captured:

- `codesign -dvvv` (`ios/evidence/36/appex-codesign.txt`) → `Signature=adhoc`, `TeamIdentifier=not set`.
  This machine's toolchain ad-hoc-signs simulator products (via "Sign to Run Locally"); it is **not**
  literally unsigned the way P1's original observation phrased it ("code object is not signed at
  all"), but it carries **no entitlements in the code signature itself** — `codesign -dvvv`'s output
  has no `Entitlements` blob for this binary.
- `codesign -d --entitlements :-` (`ios/evidence/36/appex-codesign-entitlements.txt`) → an **empty**
  plist (`<dict></dict>`), not the populated plist P3's probe predicted.

**Verdict: P1 was right, P3 was wrong on this specific sub-claim.** `codesign` cannot read this
appex's entitlements at all — neither form returns them. The `__TEXT,__entitlements` Mach-O section
reader (`scripts/sim-entitlements.py`) is not a convenience; it is the **only** mechanism this
toolchain exposes for reading a simulator product's entitlements. The `__TEXT,__entitlements`
mechanism claim is therefore **confirmed, not incomplete** — no conclusion drawn from it needs
re-deriving.

### The no-entitlements negative control

A second variant was built with `CODE_SIGN_ENTITLEMENTS` unset via an `xcodebuild` command-line
override (`CODE_SIGN_ENTITLEMENTS=`, not a committed `project.pbxproj` change), into an isolated
`-derivedDataPath /tmp/pv-dd-negctrl`. The reader's result against that variant's appex is recorded at
`ios/evidence/36/negative-control/appex-entitlements.plist`:

```xml
<dict>
	<key>application-identifier</key>
	<string>FAKETEAMID.cloud.blonie.PasskeyVault.AutoFill</string>
</dict>
```

**What this implies about enforcement**: the `__TEXT,__entitlements` section is still present (Xcode
always seals a minimal `application-identifier` entry) but **none of the three capability keys this
phase cares about appear** when `CODE_SIGN_ENTITLEMENTS` is detached — the simulator toolchain does not
fabricate these keys unconditionally; the positive E1 result above is not vacuous. This is what makes
SC1 able to come back negative (36-RESEARCH.md Open Question 1): a build that genuinely lacks the
entitlements file produces a genuinely different, capability-key-free plist.

## E2 — Does an App Group container actually resolve? (SC1 part 2, the decisive test for L-5)

**Baseline established read-only (36-RESEARCH.md E2):** zero `Containers/Shared/AppGroup/` directories
existed across all 12 simulators on this machine before this phase. Any container that appears was
created by this phase's own builds.

### Outside view

`scripts/ios-autofill-layers.sh layer-appgroup` queries `xcrun simctl get_app_container <udid>
cloud.blonie.PasskeyVault groups` (the host bundle id) — `ios/evidence/36/appgroup-host.txt`:

```
group.cloud.blonie.PasskeyVault	/Users/…/CoreSimulator/Devices/…/data/Containers/Shared/AppGroup/8B89C66D-A449-4832-9A27-125948A6E8B5
```

`group.cloud.blonie.PasskeyVault` resolves, non-empty, and the directory exists on disk.

**A recorded scope limit found running this task, not assumed.** The plan's own text called for querying
the extension bundle id (`cloud.blonie.PasskeyVault.AutoFill`) with the identical `simctl
get_app_container … groups` shape, for a genuine two-CLI-call equality comparison. On this toolchain
(CoreSimulator-1051.55, Xcode 26.6) that call — and every other `get_app_container` container type
(`app`, `data`, `groups`) against the extension bundle id — returns `rc=2 "No such file or directory"`
(`ios/evidence/36/appgroup-extension-cli-limitation.txt`). `xcrun simctl listapps` independently confirms
the extension is never listed as its own addressable "app" at all — it only exists inside the containing
app's `PlugInKit`/`NSExtension` registration, a different subsystem than the one `get_app_container`
queries. This is a tool-registry limitation, not an App-Group-entitlement signal: it is the same shape as
Apple's capability table being silent (not negative) on `app-extension` product types (36-RESEARCH.md E2),
just found in `simctl` itself rather than in Apple's docs.

**Also recorded:** the specific-group-identifier positional form (`get_app_container <udid> <bundle>
<group-id>`) is separately broken on this toolchain — it prints the command's own usage text and exits
117 for **any** group identifier, valid or bogus (`group.cloud.blonie.PasskeyVault` and
`group.does.not.exist` both produce identical usage output). A check that fails identically for real and
fake input proves nothing, so this form could never have served as the plan's literal negative control
either. Both limitations are recorded here rather than silently routed around.

### Negative control (working form)

Because the specific-group form is unusable, the negative control uses the working `groups` form against
a never-installed bundle id (`cloud.blonie.NeverInstalled`, same convention as layer-a-falsification.log):
`ios/evidence/36/appgroup-negative-control.txt` shows the identical `rc=2 "No such file or directory"`
error — the check can fail, proving the host-bundle positive result above is not vacuous.

### Inside view — the actual equality proof

Because the outside view cannot address the extension bundle id at all, the equality assertion D-02/QA-03
require (two independent identity resolutions, not two no-error results) is performed between this
outside, CLI-resolved host path and the **inside** view: `AppGroupProbe.swift`, running inside the real
extension process, calls `FileManager.default.containerURL(forSecurityApplicationGroupIdentifier:)`
directly and logs the result via `os_log` — a positive assertion made by the process that will actually
depend on this container, not an inference drawn for it. `ios/evidence/36/appgroup.log`:

```
PVPROBE|stage=appgroup resolved=/Users/…/CoreSimulator/Devices/…/data/Containers/Shared/AppGroup/8B89C66D-A449-4832-9A27-125948A6E8B5 roundtrip=ok
```

**The two paths are byte-for-byte identical, including the container UUID (`8B89C66D-A449-4832-9A27-
125948A6E8B5`).** `scripts/ios-autofill-layers.sh layer-appgroup`, run after the probe, performs this
comparison mechanically and reports `equality=equal`. This is arguably a *stronger* proof than two `simctl`
calls would have been: it is not two CLI reads of a device-level registry from outside, but the host's
outside-CLI-resolved identity matched against the extension's own live, in-process API resolution.

The extension also wrote a fixed 8-byte marker into the resolved container and read it back inside the
same process: `roundtrip=ok`.

**Result: PASS.** The App Group container resolves identically for the host app (via `simctl`, outside)
and the extension (via `FileManager`, inside, from within the real running `.appex` process) — the same
physical directory, confirmed both ways, with a negative control proving the check is not vacuous.
Consistent with App Group containers being allocated per (device, group-identifier), never per bundle —
by construction, any entitled process that resolves the identifier is pointed at the one canonical
directory.

**Scope limit that must travel with this result (36-RESEARCH.md):** Apple's `APP_GROUPS` capability-table
`supportedProductTypes` field never mentions `com.apple.product-type.app-extension` — that field is silent
on app extensions, not negative. This PASS is not "App Groups are broadly permitted on a free team"; it is
"this specific App Group identifier, declared in both this app's and this extension's entitlements, was
observed to resolve to the same real directory on this simulator, under a free Apple ID with no team
configured." `Ograniczenie dowodu` (top of this file) applies unchanged.

## E3 — Cross-process Keychain sharing (the MP-2 fallback path)

`ProbeSeeder.swift` (host app, `PasskeyVaultApp.init()`, `PV_PROBE_KEYCHAIN`) deletes any prior probe
item and adds a fixed, clearly-labelled 32-byte test vector (`[0, 1, 2, … 31]`, never real key material,
no `pv-ffi`/`FfiUserKey` call anywhere on this path — confirmed: `git grep -n kSecValueData
ios/PasskeyVault` shows only `Data([0x00])` discovery-probe writes and `Data(testVector)`) under the
shared keychain access group. `AutoFillInvocationUITests` launches the host app first, unconditionally,
before driving the Settings navigation that invokes the extension — the ordered sequence E3 requires.

**Runtime access-group resolution, never a hardcoded literal (D-14, L-8).** There is no iOS-available
`SecTask` API to read a bundle's own entitlements directly (`SecTaskCreateFromSelf` /
`SecTaskCopyValueForEntitlement` are macOS-only, confirmed absent from the iphonesimulator SDK's
`Security.framework/Headers` this session). Both `ProbeSeeder` and `KeychainProbe` instead round-trip a
throwaway keychain item with no access group specified and read back which access group the OS assigned
it — the actual expanded value, discovered at runtime, never typed into source.

### Positive result — byte-for-byte, from the reading side

`KeychainProbe.swift` (extension, `PV_PROBE_KEYCHAIN`) queries the shared access group and logs the
`OSStatus`, byte count, and a constant-time equality comparison against the same fixed vector.
`ios/evidence/36/keychain.log`:

```
PVPROBE|stage=seed delete_status=0 add_status=0 access_group=FAKETEAMID.cloud.blonie.PasskeyVault
PVPROBE|stage=configure kr=KERN_SUCCESS phys=22251608 peak=25151576 remaining=0 ffi_bytes=32
PVPROBE|stage=keychain status=0 bytes=32 equal=true
PVPROBE|stage=keychain-negative status=-34018
```

**Result: PASS.** `status=0`, `bytes=32`, `equal=true` — the byte-for-byte receiver-side assertion, not a
non-nil or length-only check. The discovered access group (`FAKETEAMID.cloud.blonie.PasskeyVault`) is
the L-8 literal, observed here as runtime evidence, never hardcoded in source.

### Negative control — the control that makes the positive mean something

Same query shape, `kSecAttrAccessGroup` set to the same discovered team prefix plus a suffix this bundle
does **not** declare (`…cloud.blonie.NotOurs`, reconstructed at runtime, never a hardcoded literal):
`PVPROBE|stage=keychain-negative status=-34018` — `errSecMissingEntitlement`, exactly the code
36-RESEARCH.md's observed `securityd` string predicted ("Client explicitly specifies access group %@ but
is only entitled for %@"). The control fires: `securityd` on this simulator enforces access-group
scoping, so the positive result above establishes real enforcement, not an unscoped free-for-all.

### Falsification of the equality assertion itself

Byte 0 of `ProbeSeeder.testVector` was flipped `0x00` → `0xFF` (rebuild, reinstall, re-run) without
touching `KeychainProbe.expectedTestVector`:

```
PVPROBE|stage=keychain status=0 bytes=32 equal=false
```

`status=0`/`bytes=32` unchanged (the read itself still succeeds — only the *content* differs), and
`equal` correctly flips to `false`. The mutation was reverted and re-run, restoring `equal=true`
(both transcripts in `ios/evidence/36/keychain.log`, distinguishable by timestamp). The equality
assertion is not a check that always passes.

### What this pair establishes

Bytes written by the host app process are proven present and byte-for-byte correct when read by the
extension process, and the missing-entitlement control proves that correctness is not an artifact of the
simulator ignoring access-group scoping altogether. Together with E2, both halves of MP-2's fallback and
DR-1's hybrid option are now evidenced, not merely documented.

## SC1 layers (a) registration, (b) election, (c) Settings visibility

Recorded separately, never aggregated (D-09). Layers (a) and (b) — Task 3, `scripts/ios-autofill-layers.sh`.
Layer (c) — Plan 36-02.

### Layer (a) — pluginkit registration

`scripts/ios-autofill-layers.sh layer-a` runs `pluginkit -mAvv -p com.apple.authentication-services-credential-provider-ui`
scoped to the credential-provider extension point on the booted simulator, writes the raw output to
`ios/evidence/36/pluginkit-registered.txt`, and asserts the bundle id appears in that file.

**Result: PASS.** `cloud.blonie.PasskeyVault.AutoFill(1.0)` appears in the registration listing —
the system accepted the built bundle at the extension point at all. This is the weakest of the
three layers (D-09): it proves acceptance, nothing about election or Settings visibility.

**Falsification, recorded** (`ios/evidence/36/layer-a-falsification.log`): the same command run
against `com.nonexistent.NeverInstalled` — a bundle id that was never installed — exits 1 and names
the missing id, proving the assertion is not a check that always passes.

### Layer (b) — user election

`scripts/ios-autofill-layers.sh layer-b` flips the user election for our bundle id
(`pluginkit -e use -i cloud.blonie.PasskeyVault.AutoFill`), re-queries the single-bundle listing into
`ios/evidence/36/pluginkit-elected.txt`, and asserts positively on the leading `+` (elected) marker
in that file — never merely on the bundle id's presence, which would only re-prove layer (a).

**Result: PASS.** The re-queried listing shows the `+` marker against
`cloud.blonie.PasskeyVault.AutoFill(1.0)` — the extension is electable as a provider on this
simulator. **Open assumption A5** (`36-RESEARCH.md` Assumptions Log): whether this CLI-driven
election state is the same state Settings → Passwords → AutoFill shows is unconfirmed by this layer
alone — layer (c), owned by Plan 36-02, exists to check that; this result is never used to infer (c).

**Falsification, recorded** (`ios/evidence/36/layer-b-falsification.log`): the bundle was manually
switched to `pluginkit -e ignore` and re-queried without reissuing the election verb — the same
listing then shows a leading `-` (explicitly ignored) marker, and the `+`-marker assertion no longer
matches (grep exit 1). The elected state was restored immediately afterward by re-running
`scripts/ios-autofill-layers.sh layer-b`, confirmed PASS again.

Neither layer (a) nor layer (b) registered a FAIL, so landmine L-7 (Xcode 26.6's extension template
omitting `ASCredentialProviderExtensionCapabilities`) did not materialize at these two layers on this
run — Task 1 added the capabilities dict to `Info.plist` up front (D-15), which is the preventive
half of L-7's mitigation. L-7 remains a live risk specifically for layer (c) (Settings visibility),
which this plan does not test; see `ios/IOS-SPIKE-LOG.md` §3 L-7.

### Layer (c) — Settings → Passwords → AutoFill visibility

`scripts/ios-autofill-layers.sh layer-c` drives `AutoFillInvocationUITests`' existing Settings
navigation (Settings → Apps → Passwords → View AutoFill Settings) and extracts the real
`XCUIApplication.screenshot()` attachment the test already takes at the "autofill-and-passwords-screen"
checkpoint from the run's `.xcresult` via `xcresulttool export attachments` (a deterministic capture of
the exact on-screen state at that navigation point — not a live `simctl io screenshot` racing an
in-process `sleep()` from outside the test process; see the script header for why).

**Result: OBSERVED, PASS.** `ios/evidence/36/settings-autofill.png` shows the "AutoFill & Passwords"
screen with "PasskeyVault" listed under "AutoFill from:" alongside the system "Passwords" row, with a
real, toggleable switch. This is independent of layers (a) and (b): a fresh `xcodebuild test` invocation
that builds, installs, and drives the OS's own Settings UI, never inferred from `pluginkit`'s output.

**Corroborating machine-readable dump:** `ios/evidence/36/layer-c-pluginkit-dump.txt`
(`pluginkit -mAvvv -p`, verbose registration listing, captured alongside the screenshot).

**A recorded deviation from the plan's literal mechanism**, not from its intent: the plan's action text
named a `simctl io screenshot` capture. That mechanism was attempted first and found racy (no reliable
way to fire it from outside the test process at the exact moment of an in-test `sleep()` window without
guessing timing); the `xcresulttool` extraction above is a strictly more deterministic capture of the
identical underlying artifact (both are `XCUIApplication.screenshot()`/OS-level screenshots of the real
on-screen state) and is used instead. See Deviations in the SUMMARY.

L-7 (Xcode 26.6's extension template omitting `ASCredentialProviderExtensionCapabilities`) did **not**
materialize as originally speculated at this layer either — see the capability-key bisect below and
`ios/IOS-SPIKE-LOG.md` §3 L-7's Plan 36-02 update for the precise, evidenced finding that replaces the
speculation.

### The capability-key bisect (settles Open Question 4)

`ProvidesPasswords` was removed from `PasskeyVaultAutoFill/Info.plist`'s
`ASCredentialProviderExtensionCapabilities` dict, rebuilt, reinstalled, and layers (a) and (c) re-run;
then restored, rebuilt, reinstalled, and re-run a third time. Four observations, all recorded:

| State | Layer (a) | Layer (c) — provider row |
|---|---|---|
| Key **present** (baseline) | PASS (`ios/evidence/36/bisect-key-present-layer-a.txt`) | Present, label `'PasskeyVault, Passwords'`, toggleable (`bisect-key-present-layer-c.png`) |
| Key **absent** | PASS (`bisect-key-absent-layer-a.txt`) | **Still present**, label `'PasskeyVault'` (no "Passwords" suffix, no subtitle), still toggleable (`bisect-key-absent-layer-c.png`, `bisect-key-absent-hierarchy-excerpt.txt`) |
| Key **restored** | PASS (`bisect-key-restored-layer-a.txt`) | Present, label back to `'PasskeyVault, Passwords'` (`bisect-key-restored-layer-c.png`) |

**Settled: `ProvidesPasswords` is NOT required for the provider to appear, be listed, or be toggleable
in Settings → Passwords → AutoFill on this simulator (iOS 26.5).** Registration (layer a) is unaffected
either way. What the key actually gates is the row's declared capability category — its accessibility
label drops the ", Passwords" component and its subtitle `StaticText` sibling entirely when the key is
absent — which is precisely why `AutoFillInvocationUITests`' exact-label-match query fails without it
(`AutoFillInvocationUITests.swift:271`), not because the row vanished. This is a different, more precise
finding than L-7's original "can silently fail to appear" speculation, which this bisect disproves on
its literal terms while confirming the key is still real, load-bearing, and worth keeping.

This bisect isolated only `ProvidesPasswords`; `ShowsConfigurationUI` and the legacy top-level
`ASCredentialProviderExtensionShowsConfigurationUI` key were never removed, so whether either of those
(rather than `ProvidesPasswords`) is what keeps the row listed at all remains open — out of this
bisect's scope, recorded rather than silently assumed.

## SC1 — the three layers, together

Restated side by side, explicitly as three separate results — D-09 forbids deriving any one from
another, and none of the three below was inferred from the other two:

| Layer | Result | Evidence | What it alone proves |
|---|---|---|---|
| (a) registration | **PASS** | `ios/evidence/36/pluginkit-registered.txt`, falsified in `layer-a-falsification.log` | The system accepted the built bundle at the extension point at all. Nothing about election or Settings. |
| (b) election | **PASS** | `ios/evidence/36/pluginkit-elected.txt`, falsified and restored in `layer-b-falsification.log` | The extension is electable as a provider via `pluginkit`. Whether this is the same state Settings shows was **open assumption A5** until layer (c) ran. |
| (c) Settings visibility | **OBSERVED, PASS** | `ios/evidence/36/settings-autofill.png`, `layer-c-pluginkit-dump.txt` | "PasskeyVault" is real, present, and toggleable in Settings → Passwords → AutoFill — the actual user-facing surface. Closes A5: the CLI-driven state and the Settings-shown state agree on this simulator run. |

**What the combination establishes, and what it does not (D-06, D-09):** all three layers agree — the
extension is registered, electable, and visible with a working toggle, on this simulator, under a free
Apple ID with no team configured. This is a **bundle-and-toolchain** result: it does not test, and
cannot test, anything about a device, a paid Apple Developer account, or provisioning-profile
allowlisting — none of those exist on the simulator path (`Ograniczenie dowodu`, top of this file). The
capability-key bisect additionally shows that a plausible FAIL cause (`ProvidesPasswords` absence) does
**not** produce the "invisible" failure mode L-7 predicted on this OS version — a FAIL here would need a
different, still-undiagnosed cause, and would still not by itself be a business-gate trigger (below).

**The mandated positive label (ROADMAP SC2, last bullet).** This phase has not produced, and by SC2's
own text cannot produce on a simulator, a cause for escalating the $99 Apple Developer Program decision.
The paid-program question is therefore recorded as: **nierozstrzygalne na symulatorze — nie FAIL.**
Every layer above passed; nothing here is a FAIL of any kind, and nothing here decides the $99 question
either way — that decision requires the device path (signing into an Apple ID, never done on this
machine), which this phase does not attempt.

## E5.a / E5.b — the FILL-06 instrument, proven able to run inside the real extension process

Plan 36-03 owns FILL-06's instrument bring-up (SC3, `36-RESEARCH.md` §E5) — before any footprint number
enters this record, the instrument that produces it has to be shown working, in the process that matters,
with its most ambiguous reading recorded but never trusted.

**The instrument in use, named explicitly, and how it deviates from the ROADMAP's original wording
(D-10).** SC3's own text as originally drafted named "Instruments Allocations". This phase does **not**
use Instruments Allocations anywhere: that tool accounts for the **malloc heap**, and jetsam's kill
decision is made on **`phys_footprint`** — a materially different, larger figure (it also counts
mapped/dirty pages the allocator itself never sees). The instrument actually used is in-process
`task_info(mach_task_self_, TASK_VM_INFO, ...)` (`MemoryProbe.readVMInfo()`,
`ios/PasskeyVault/PasskeyVaultAutoFill/MemoryProbe.swift`), read from a dedicated sampler thread polling
every 10 ms and keeping the running maximum of `phys_footprint` — because the KDF call this instrument
wraps (Task 2, E5.c) is blocking, so an inline sampler would observe nothing while it runs.

**E5.a — the instrument runs and reports a plausible reading, inside the real `.appex` process.**
`scripts/ios-probe-run.sh instrument` builds and installs the app+extension with
`PV_PROBE_INSTRUMENT` active, drives `AutoFillInvocationUITests` to reach
`prepareInterfaceForExtensionConfiguration()`, and captures the resulting `os_log` output:

```
PVPROBE|stage=sampler kr=KERN_SUCCESS samples=42 peak_sampled=22055000 ledger_peak=24938584
```

`kr=KERN_SUCCESS`, `samples=42` (greater than 0 — the sampler thread genuinely ran, not a
plausible-looking `0` from a sampler that never started), `peak_sampled=22055000` bytes (~21.0 MiB, a
plausible extension-idle footprint, consistent with 36-01's own baseline `phys=22349912` reading from
the same process shape). Raw evidence: `ios/evidence/36/instrument.log`.

**Field units and provenance** (`<SDK>/usr/include/mach/task_info.h`, `36-RESEARCH.md` "Code Examples"):
`peak_sampled`/`phys_footprint` are bytes, the quantity jetsam caps on a real device; `ledger_peak`
(`ledger_phys_footprint_peak`) is the kernel's own peak-ledger field in the same units, read as a
cross-check only, never as the primary reading.

**E5.b — `os_proc_available_memory()`, recorded once as a finding, never a gate.**
`MemoryProbe.emitAvailableMemory()` is a one-shot call, logged before the sampler starts, and appears in
no `if`, no threshold, and no early return anywhere in this phase (D-13) — mechanically confirmed:
`git grep -nE 'os_proc_available_memory' ios/PasskeyVault` shows the call exists in exactly one place,
`emitAvailableMemory()`'s own body, with every other hit being a doc comment.

```
PVPROBE|stage=availmem available_bytes=0
```

**Finding: `available_bytes=0` inside the real extension process.** `os/proc.h:78-87`'s own wording —
"0 is returned if the calling process is not an app, or the calling process exceeds its memory limit" —
means this single reading cannot, by itself, distinguish "an app extension does not count as an app" (P2's
prior inference, `36-RESEARCH.md` Assumption A4) from "already over some limit". Both are live
possibilities from one `0` reading; this is exactly why the ROADMAP forbids using it as a gate. Recorded
as the finding it is, nothing more.

**Can-fail proof for the gate that reads this evidence** (`scripts/ios-memory-gate.sh instrument`):
demonstrated exiting non-zero against a copy of the real log with the `stage=sampler` line removed, and
against a nonexistent path — both transcripts in `ios/evidence/36/instrument-falsification.log`.

## E5.c — the mandatory sensitivity control

Before any footprint number from this instrument enters a record, it has to be shown to MOVE with the
KDF's own memory parameter, by an amount predicted before the run — a measurement that cannot move
reads green regardless of the truth (`36-RESEARCH.md` Pitfall 4). This is the binding control: if it
fails, the phase halts here and no number from this instrument is recorded, per ROADMAP SC3's second
correction.

**A recorded deviation, found running this control, not assumed.** The production constructor,
`FfiWrappingKey::from_password`, validates `m_cost_kib` against `MAX_M_COST_KIB = 96 * 1024`
(WR-11, `crates/pv-ffi/src/lib.rs`) — a guard that exists to bound an untrusted, server-supplied
parameter, and it correctly REJECTS this control's `256 * 1024` value outright, before Argon2id ever
allocates. That guard is not weakened: `crates/pv-ffi/src/kdf_probe.rs` adds a separate,
feature-gated (`kdf-probe`, default-off) diagnostic constructor, `FfiWrappingKey.fromPasswordProbeUnchecked`,
that skips ONLY that bound, for one fixed, author-chosen, never-server-supplied literal — mirroring
`panic_probe.rs`'s established `ffi06-probe` precedent exactly. `crates/pv-ffi` is a thin FFI binding
crate, not `pv-core`/`pv-provider` — `git diff --stat crates/pv-core crates/pv-provider` stays empty
(P2 held). Full rationale in that module's own header and in `36-03-SUMMARY.md`.

**Setup**: `KdfProbe.run(mCostKiB:tCost:pCost:label:)` runs the real `pv-ffi` KDF entry point twice in one
extension invocation — `m_cost_kib=8*1024` then `m_cost_kib=256*1024`, both at `t_cost=1 p_cost=1` (this
control is about the memory parameter alone, so the cheap time/parallelism values keep the run fast) —
against a fixed, non-secret probe password and salt, sampling the footprint around each call exactly as
E5.a's instrument does.

**Real result** (`ios/evidence/36/sensitivity.log`, captured from the real running extension process,
`scripts/ios-probe-run.sh sensitivity`):

```
PVPROBE|stage=kdf label=8mib   m_cost_kib=8192   t_cost=1 p_cost=1 call_ok=true baseline=22055024 peak_sampled=22399088   samples=1  ledger_peak=24971376  residual=22104176 elapsed_ms=6.208209
PVPROBE|stage=kdf label=256mib m_cost_kib=262144 t_cost=1 p_cost=1 call_ok=true baseline=22104176 peak_sampled=290687280 samples=19 ledger_peak=290687280 residual=22104176 elapsed_ms=228.179209
```

`scripts/ios-memory-gate.sh sensitivity ios/evidence/36/sensitivity.log`:

```
peak_sampled(8mib)=22399088 peak_sampled(256mib)=290687280 delta=268288192 accepted_range=[234042164,286051532] (target 260046848 +-10%)
PASS: sensitivity -- the reported peak moved by 268288192 bytes, within +-10% of the predicted 260046848 byte (248 MiB) delta
```

**Verdict: PASS.** The reported peak moved from ~21.4 MiB to ~277.3 MiB — a delta of 268,288,192 bytes
(~255.9 MiB), within ±10% of the predicted 248 MiB (260,046,848 byte) delta. The instrument genuinely
tracks the allocation it claims to measure; every number this instrument reports from here on is worth
recording. `samples=1` on the 8 MiB run is itself informative, not a defect: that call completed in
~6.2 ms, faster than the sampler's 10 ms interval, so a single sample landing is the expected shape for a
call that fast — the sample COUNT field (E5.a's own contract) is what makes this distinguishable from a
sampler that silently never ran.

**Can-fail proof, recorded** (`ios/evidence/36/sensitivity-falsification.log`): the same gate run against
a scratch copy of the log with the 256 MiB line's peak overwritten to equal the 8 MiB line's peak (delta
forced to 0) exits non-zero, printing "the instrument is not measuring the allocation; no number from
this run may be recorded". The edited copy itself was a scratch file, never committed as evidence.

## E5.d — the enforcement control

Two prior research probes independently concluded this simulator has no jetsam machinery at all, but
neither one deliberately tried to KILL the process to confirm it (`ios/IOS-SPIKE-LOG.md` §3 L-6, Open
Question 7). This control is the cheapest experiment that could have overturned that conclusion — it
measures, rather than assumes, whether the simulator enforces a memory limit on the extension process,
and the answer is recorded whichever way it comes back.

**Setup**: `EnforcementProbe.run()` logs a footprint reading, allocates and fully `memset`s a 200 MB
buffer (dirtying every page — a lazy VA reservation would cost no real physical memory and prove
nothing), logs a second reading, holds for 2 seconds, logs a third, then releases. Dispatched alone
under `PV_PROBE_ENFORCEMENT` — never sharing an invocation with any other probe, so a process death here
could never swallow another probe's output.

**Real result** (`ios/evidence/36/enforcement.log`, captured from the real running extension process,
`scripts/ios-probe-run.sh enforcement`):

```
PVPROBE|stage=enforce ordinal=1 kr=KERN_SUCCESS phys=22087768
PVPROBE|stage=enforce ordinal=2 kr=KERN_SUCCESS phys=231917800
PVPROBE|stage=enforce ordinal=3 kr=KERN_SUCCESS phys=231950568
```

`scripts/ios-memory-gate.sh enforcement ios/evidence/36/enforcement.log`:

```
CLASSIFICATION: survived -- all 3 ordinals present, footprint rose by 209830032 bytes between ordinal 1
(22087768) and ordinal 2 (231917800), within [146800640,272629760] of the ~200 MB allocation. This
confirms, empirically, that this simulator does not enforce a memory kill on the extension process (E5.d).
```

**Verdict: SURVIVED.** All three ordinals present; the footprint rose by 209,830,032 bytes (~200.1 MB)
between the pre-allocation and post-allocation readings, matching the 200 MB `memset`ted buffer almost
exactly, and held steady through the 2-second hold (ordinal 3: 231,950,568, within a few KB of ordinal
2). This confirms, empirically rather than by inference from a code search, that **this simulator does
not enforce a memory kill on the extension process** — the two research probes' no-jetsam conclusion is
confirmed, not overturned. Consequently, this phase can produce a footprint number for FILL-06 but never
a survival verdict: nothing measured here tells us whether the same allocation would survive on a real
device. **The contested device ceiling remains contested and unattributed on both sides**: ~120 MB from
one vendor-sourced figure, <32 MB from a second vendor shipping the same workload class — neither is a
first-party Apple figure, and neither is presented here as established (A11).

**Can-fail proof, recorded** (`ios/evidence/36/enforcement-falsification.log`): the same gate run against
a scratch copy of the log with ordinal 1 removed (leaving only ordinals 2 and 3, a shape matching neither
the "all three present" outcome nor a clean truncation to `''`/`'1,'`/`'1,2,'`) exits non-zero, printing
that the run is unclassifiable.
