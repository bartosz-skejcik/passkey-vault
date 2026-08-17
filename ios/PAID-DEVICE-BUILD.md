# Running Passkey Vault on a physical iPhone — WITH the entitlements

**Written 2026-08-17.** The paid-team successor to [`DEVICE-BUILD.md`](DEVICE-BUILD.md), which covers the
free-team path and the strip-the-entitlements workaround. Read that one for anything this document does
not repeat: trusting the device, the `⌘R` route, why the server URL is no longer a hack.

This document is only about the thing a free team cannot do: sign
`com.apple.developer.authentication-services.autofill-credential-provider` and get the AutoFill
extension onto real hardware.

**Every Apple fact below was verified against `developer.apple.com` on 2026-08-17.** Where Apple does not
publish a fact, this document says so instead of guessing.

---

## 0. What paying actually buys, stated honestly

Paying does **not** make AutoFill work. It makes it **possible to test**.

Nothing in this project has ever exercised the shared keychain access group or the App Group container on
hardware. Not once.

- Phase 36 proved the extension registers, is elected, and appears in Settings — **on the simulator**,
  which `ios/IOS-SPIKE-LOG.md` §1 records as having *"no entitlement-issuing authority at all — no
  provisioning profile, no `amfid`/`taskgated`"*.
- Phase 37's device run proved biometric unlock on real hardware, but with all three entitlement keys
  stripped and the appex dropped. Its own record says so: it proves the gate *"for a single app using the
  default keychain access group"* and **"Phase 41 needs its own device proof and cannot inherit this
  one"** (`ios/evidence/37/DEVICE-VERIFICATION-RESULT.md`).

So after you pay, the honest status is: the build signs, the extension installs, and **Phase 41 can now
begin doing the work it was blocked from doing.** Whether the host app and the extension actually share a
keychain item and an App Group container across the process boundary is unknown, and the first person to
find out will be whoever runs Phase 41. Budget for it failing the first time.

---

## 1. Buying the membership

### Cost — verified 2026-08-17

| | |
|---|---|
| Price | **99 USD per membership year** — [developer.apple.com/help/account/membership/program-enrollment](https://developer.apple.com/help/account/membership/program-enrollment/) |
| Individual vs organization | **Same price.** Apple's enrollment pages quote one figure for both; the 299 USD tier is the separate Apple Developer *Enterprise* Program, which is for internal-only distribution and is **not** what you want |
| Annual? | Yes. Through the Apple Developer app it is an **auto-renewable subscription**; you can cancel up to one day before the renewal date, and fees for the year you cancel in are nonrefundable |
| Currency / Poland | Apple's exact words: *"99 USD … in local currency where available. Prices may vary by region and are listed in local currency during the enrollment process."* **Apple does not publish a per-country price list, so the PLN figure and its VAT treatment are only visible on the checkout screen.** Expect roughly 450–500 PLN gross; treat that as an estimate, not a verified number — see §8 |

There is a [fee waiver](https://developer.apple.com/support/fee-waiver/), but it is for nonprofits,
accredited educational institutions and government entities. A solo indie does not qualify.

### The two enrolment routes

Apple supports **both** the web and the Apple Developer app
([program-enrollment](https://developer.apple.com/help/account/membership/program-enrollment/)). For an
individual the app route is the smoother one, because identity verification happens in-app with the
camera instead of by email round-trips.

**Use the same device for the entire enrolment.** Apple states this explicitly.

### What to have ready

- An **iPhone or iPad with Face ID / Touch ID / passcode**, or an Apple-silicon Mac. Same device
  throughout.
- Your **Apple Account with two-factor authentication on**, and its name, address, phone, trusted phone
  number and trusted devices **valid and current**. Apple calls out stale account info as a delay cause.
- **Signed in to iCloud** on that device.
- The latest **Apple Developer app**.
- **A government-issued photo ID.** Apple: *"We accept passports in most regions, and some regions can
  accept additional types of government-issued ID, like a driver's license."* For Poland, a passport or
  dowód osobisty is the obvious choice — Apple does not enumerate accepted documents per country, so if
  the app refuses one, try the other.
- A **payment method on the Apple Account**. Apple Gift Card / Apple Account balance is **not accepted**
  (the sole exception Apple documents is India).

### The flow, for an individual

1. Apple Developer app → **Account** tab → sign in → agree to the Apple Developer Agreement → **Enroll
   Now**.
2. Enter your **legal** first and last name and phone. Apple warns twice that an alias, nickname or
   company name here *"will cause a delay in the approval of your enrollment"*. Your legal name becomes
   the App Store seller name.
3. **Photo the ID.** Apple pulls name and address from it and does not keep the image.
4. Select **Individual** as the entity type.
5. Agree to the Apple Developer Program License Agreement.
6. **Subscribe.** Price in local currency appears here.

No D-U-N-S number, no company website, no notarised documents — those are all the *organization* path.
Do not accidentally pick Organization.

### How long approval takes

**Apple publishes no timeframe.** I checked the enrollment, program-enrollment and identity-verification
help pages and none of them state an SLA — the only timing language anywhere is about what causes
*delays*.

What Apple's own docs do tell you, and it is the useful part: *"Individuals and sole proprietors/single-
person businesses can review the license agreement and purchase a membership at the time of enrollment."*
Organizations, by contrast, must wait for Apple Developer Support to verify and email next steps. So as
an individual you pay at the end of the flow rather than after a review queue, which is why individual
enrolments are usually usable quickly. Community reports cluster around 24–48 hours before Certificates,
Identifiers & Profiles actually works. **That last sentence is not from Apple and should not be planned
against** — if it is not live the same day, that is normal, not broken.

---

## 2. What changes in the repo

### The team ID almost certainly changes. This is the one thing that will bite.

`DEVELOPMENT_TEAM = 4S7F2M7YLW` is now committed on all 8 build configurations (commit `16626d7`), so
`DEVICE-BUILD.md` step 3 is no longer needed. But **`4S7F2M7YLW` is the free personal team.**

Apple's glossary: *"The **Team ID** is a unique 10-character string generated by Apple that's assigned to
a **membership** in the Apple Developer Program and Apple Developer Enterprise Program"*
([glossary/team-id](https://developer.apple.com/help/glossary/team-id)). A personal team is not a
membership. Enrolling creates a **new** team alongside the personal one, on the same Apple Account — this
is a well-documented and frequently-reported friction on Apple's own forums (e.g.
[thread 798004](https://developer.apple.com/forums/thread/798004),
[thread 107350](https://developer.apple.com/forums/thread/107350)), where Xcode keeps signing with the
old personal team after enrolment.

**So, after enrolment:**

1. Find the real one: developer.apple.com → **Account** → **Membership details** → Team ID.
2. If it differs from `4S7F2M7YLW` — expect it to — update it in
   `ios/PasskeyVault/PasskeyVault.xcodeproj/project.pbxproj`. It appears on **8 build configurations**;
   change all of them:

   ```bash
   grep -c 'DEVELOPMENT_TEAM = 4S7F2M7YLW' ios/PasskeyVault/PasskeyVault.xcodeproj/project.pbxproj   # expect 8
   sed -i '' 's/DEVELOPMENT_TEAM = 4S7F2M7YLW/DEVELOPMENT_TEAM = <NEW_TEAM_ID>/g' \
     ios/PasskeyVault/PasskeyVault.xcodeproj/project.pbxproj
   ```

   Or do it in Xcode's Signing & Capabilities on each of the four targets; the file edit is faster and
   less likely to miss one.
3. If Xcode still shows the personal team in the Team dropdown after enrolment: **Xcode → Settings →
   Accounts**, remove the Apple Account, add it back. That is the standard fix for the stuck-team
   symptom.

### Nothing else in the repo needs to change

Specifically, **do not touch the entitlements files.** Both already contain the correct values and both
already use `$(AppIdentifierPrefix)` rather than a literal prefix — landmine **L-8**, and the comment in
`PasskeyVault.entitlements` explains why. That decision pays off exactly here: the keychain access group
becomes `<NEW_TEAM_ID>.cloud.blonie.PasskeyVault` on its own, with no edit, the moment the team changes.
Had anyone hardcoded `4S7F2M7YLW.` there, this step would be a silent device-only bug.

If `git status` shows either `.entitlements` file with keys removed, you are looking at the free-team
workaround left behind. Restore it:

```bash
git checkout -- ios/PasskeyVault/PasskeyVault/PasskeyVault.entitlements \
                ios/PasskeyVault/PasskeyVaultAutoFill/PasskeyVaultAutoFill.entitlements
```

Also confirm the appex is still embedded — commit `16626d7` had to split its staging precisely because
Xcode had removed it while working around the free team:

```bash
grep -c 'PasskeyVaultAutoFill.appex' ios/PasskeyVault/PasskeyVault.xcodeproj/project.pbxproj   # expect 5
```

---

## 3. App IDs, the App Group, the keychain group — who registers what

**Short answer: Xcode's automatic signing does all of it. You should not need the developer portal by
hand.**

`CODE_SIGN_STYLE = Automatic` is set on every configuration, and Apple documents that adding a capability
in Xcode *"automatically configures the capability and code signs your app"*, and that app groups can be
created *"when you enable app groups in Xcode"*
([enable-app-capabilities](https://developer.apple.com/help/account/identifiers/enable-app-capabilities/),
[register-an-app-group](https://developer.apple.com/help/account/identifiers/register-an-app-group/)).
With `-allowProvisioningUpdates` the same happens from the command line.

| Thing | Registered by | Needs the portal by hand? |
|---|---|---|
| App ID `cloud.blonie.PasskeyVault` | Xcode automatic signing | No |
| App ID `cloud.blonie.PasskeyVault.AutoFill` | Xcode automatic signing | No |
| App Group `group.cloud.blonie.PasskeyVault` | Xcode, on first build with the capability | No — but see below |
| Keychain access group `$(AppIdentifierPrefix)cloud.blonie.PasskeyVault` | **Nobody.** There is no portal object for a keychain group | No. It is entitlement-only, scoped by your team prefix |
| AutoFill credential provider capability | Xcode, enabled on both App IDs | No |

**Two caveats worth knowing before you go hunting in the portal:**

- **App Group identifiers are globally unique across all of Apple.** If `group.cloud.blonie.PasskeyVault`
  were already taken by someone else, registration fails and you would have to rename it in **both**
  `.entitlements` files and everywhere the Swift code names it. Unlikely for a `cloud.blonie.` prefix, but
  it is the one failure here that is not fixable by clicking.
- Apple's **Automatic Signing Controls** can restrict App ID and device registration for a team
  ([automatic-signing-controls](https://developer.apple.com/help/account/access/automatic-signing-controls/)),
  but they *"default … all options are turned off for a membership"*, and you will be the Account Holder
  of your own individual team, so this cannot be what blocks you.

### Does the AutoFill entitlement need a *separate* Apple request on top of the membership?

**No — verified 2026-08-17, and this contradicts a widely-repeated belief.**

- Apple's [supported capabilities (iOS)](https://developer.apple.com/help/account/reference/supported-capabilities-ios/)
  table lists **AutoFill credential provider** as available to **ADP ✓ / ADEP ✓ / free Apple Developer ✗**,
  with **no footnote marker**. Apple marks the special ones in that table with an asterisk (`Family
  Controls (development) *`, `FileProvider Testing Mode *`, `DriverKit Family MIDI *`). AutoFill carries
  none.
- The [entitlement documentation](https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.developer.authentication-services.autofill-credential-provider)
  says the whole procedure is: *"To add this entitlement to a target, enable the AutoFill Credential
  Provider capability in Xcode. Do this for both your Password AutoFill extension and its host app."* No
  request form, no criteria, no review.
- Apple's [capability requests](https://developer.apple.com/help/account/capabilities/capability-requests/)
  page describes the managed-capability process for entitlements that *"need an entitlement assigned to
  your account by Apple before you can enable them"*. AutoFill credential provider is not one of them.

Note also that the entitlement doc's *"Do this for both your Password AutoFill extension and its host
app"* independently confirms the call recorded in `36-01-PLAN.md` — the host app really does declare the
key too, and the Xcode template that wires only the extension side really is the incomplete one.

So the membership is the whole gate. Once it exists, the entitlement is a checkbox.

---

## 4. Build and install

Restore the entitlements (§2), set the new team (§2), then:

```bash
caffeinate -i xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
  -scheme PasskeyVault -configuration Debug \
  -destination 'platform=iOS,name=Bartek'\''s iPhone' \
  -allowProvisioningUpdates build
```

Then install and launch. `⌘R` from Xcode does the same thing and is fine.

- `caffeinate -i` — the Mac must not sleep mid-build; a device build with provisioning round-trips is
  long enough for that to happen.
- `-allowProvisioningUpdates` — **this is the flag that does the work now.** It lets Xcode create the App
  IDs, register the App Group, enable the capabilities and mint the profiles non-interactively. On a free
  team it could not, and that is exactly where the run died: *"Communication with Apple failed: The
  selected team does not have a program membership that is eligible for this feature"*
  (`ios/IOS-SPIKE-LOG.md` §3b).
- The device must be **unlocked, plugged in and trusted**. `xcrun devicectl list devices` showing
  `unavailable` means locked or untrusted, not a project fault.

**The first paid build is slower than you expect** and may pause while Apple provisions the new App IDs.
If it fails once with a profile error, run it a second time before investigating — automatic signing
occasionally needs the second pass to pick up an identifier it just created.

**What success looks like:** the build signs `PasskeyVaultAutoFill.appex` *without* you having removed
anything, and the `.app` bundle contains it. Cheap check:

```bash
ls "$(xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj -scheme PasskeyVault \
  -showBuildSettings 2>/dev/null | awk -F' = ' '/ BUILT_PRODUCTS_DIR/{print $2; exit}')/PasskeyVault.app/PlugIns"
```

---

## 5. Turning the extension on

On the phone: **Settings → General → AutoFill & Passwords**.

**What you should see:** a list of credential providers under a heading like *AutoFill From*, with
**Passkey Vault** as a row carrying a toggle. Turn it on. iOS allows several providers at once, so
enabling Passkey Vault does not require turning Passwords off — though for testing, having only one
enabled removes an entire class of "which provider answered?" ambiguity.

**If the Passkey Vault row is missing**, the extension was not registered, and the cause is upstream of
the toggle. In rough order of likelihood:

1. **The entitlements got stripped again.** Check both `.entitlements` files actually contain
   `com.apple.developer.authentication-services.autofill-credential-provider`. This is the single most
   likely cause and the one this whole document exists because of.
2. **The appex is not embedded.** The `PlugIns` check in §4 came back empty or missing.
3. **The build signed against the old personal team.** The profile then carries no AutoFill entitlement
   even though the file asked for one. Re-check §2's team ID.
4. **Stale install.** Delete the app from the phone and reinstall; iOS caches extension registrations
   more stubbornly than you would like.

A row that appears but immediately toggles itself back off is a different failure — that is the extension
crashing on launch, and the Console log for the appex process is where the answer is, not this document.

---

## 6. Two constraints that will otherwise cost you an hour

- **Debug configuration only.** `xcodebuild -configuration Release` crashes `swift-frontend` — landmine
  **L-14**, unbounded recursion in `isCallerAndCalleeLayoutConstraintsCompatible` while inlining generated
  UniFFI code (`ios/evidence/38/L14-RELEASE-BUILD-CRASH.md`, reproduced twice on Xcode 26.6 / Swift
  6.3.3). Paying Apple changes nothing about this; it is a compiler bug in the optimiser, not a signing
  problem. `⌘R` is Debug by default, so this only bites if you deliberately switch — and the temptation to
  "try Release now that signing works" is exactly the trap.
- **The deployment floor is iOS 18.0** (IOS-03, locked by PRF availability;
  `IPHONEOS_DEPLOYMENT_TARGET = 18.0` in the project). Any iPhone on 18 or later is fine — the Phase 37
  device was on iOS 27.0.

---

## 7. What is still unproven after all this

Say it plainly, because the temptation after spending money is to treat the spend as the proof:

- **The shared keychain access group has never been exercised on hardware.** Not by Phase 36 (simulator),
  not by Phase 37 (keys stripped). Zero device evidence exists.
- **The App Group container has never been exercised on hardware.** Same.
- **Credential-provider election has never happened on hardware.** Only on the simulator, which §1 of the
  spike log records as having no entitlement-issuing authority at all — the same caveat that turned out to
  be correct about the entitlement itself.
- **Phase 43 (conditional passkeys) inherits all of the above**, since it ships on the same extension.

Phase 41 owes every one of these. It cannot inherit Phase 37's device run, and it cannot inherit a green
simulator suite. The warning sign that this has been forgotten is a phase claiming AutoFill device
coverage without naming a device run of its own.

---

## 8. Facts I could not verify, listed so nobody quotes them as verified

- **The exact PLN price and VAT treatment for Poland.** Apple states 99 USD *"in local currency where
  available"* and that prices *"are listed in local currency during the enrollment process"*, but
  publishes no per-country table. The number is only visible at checkout. Screenshot it when you get
  there.
- **Approval time.** Apple publishes no SLA on any of its enrollment, program-enrollment or
  identity-verification help pages. The 24–48h figure in §1 is community folklore, included as a rough
  expectation and explicitly not as a commitment.
- **Whether your new team ID differs from `4S7F2M7YLW`.** Apple's glossary makes it near-certain that it
  does (a Team ID is assigned to a *membership*, and a personal team is not one), and the forum reports
  are consistent, but Apple does not document the personal-team-to-paid-team transition anywhere. Check
  Membership details and find out; §2 covers both outcomes.
- **Whether `group.cloud.blonie.PasskeyVault` is globally available.** App Group IDs are unique across all
  of Apple and there is no way to check before trying.

## 9. One 2026 change, and why it does not affect you

Since **28 April 2026**, apps uploaded to App Store Connect must be built with **Xcode 26 or later** using
an iOS 26 (or later) SDK
([developer.apple.com/news/upcoming-requirements](https://developer.apple.com/news/upcoming-requirements/),
verified 2026-08-17).

This is an **upload** requirement, not a signing or provisioning one. It does not touch development
builds installed on your own device, and we are on Xcode 26.6 anyway. It matters the day this project
considers TestFlight or the App Store, and not before.

Beyond that, I found no 2026 change to development provisioning or signing that affects this workflow.
The nearest-relevant standing rule is older: memberships created after **6 June 2021** require
development- and ad-hoc-signed apps to check in with `https://ppq.apple.com` on first launch
([provisioning-profile-updates](https://developer.apple.com/help/account/provisioning-profiles/provisioning-profile-updates/)).
Your new membership will fall under it. In practice this only means **the phone needs internet the first
time it launches a freshly signed build** — worth knowing before you debug a launch failure that is
actually a firewall.
