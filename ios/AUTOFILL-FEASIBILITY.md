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

**Not filled in by this plan — owned by Plan 36-02.** This is an explicitly unfilled placeholder, never
an inference from (a) or (b) (D-09).
