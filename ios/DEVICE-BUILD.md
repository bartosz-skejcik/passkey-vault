# Running Passkey Vault on a physical iPhone

**Written 2026-08-17.** Answers the question "did something change, do I need to re-click things in
Xcode?" — and yes, one thing, for a reason that is not a regression.

---

## Short answer

**Nothing in this session's 45 commits touched the Xcode project.** Verified, not assumed:

```bash
git log --oneline 04fdc6b..HEAD -- ios/PasskeyVault/PasskeyVault.xcodeproj/project.pbxproj
# (empty)
```

So no build setting, target, capability or script phase was altered by any of the design/UI work.

**But you do have to set the Team again**, and you always will until it is committed:
`DEVELOPMENT_TEAM` appears **nowhere** in `project.pbxproj`. `CODE_SIGN_STYLE = Automatic` with no team
means Xcode asks every fresh checkout. The team from the Phase 37 device run (`4S7F2M7YLW`,
`ios/evidence/37/DEVICE-VERIFICATION-RESULT.md`) was set in the UI and never committed — that record
says so explicitly: *"All three changes were reverted after the run and never committed."*

That is what you are remembering. It was reverted deliberately, by the session that did the device run,
and it is not something a later session broke.

---

## One hack you no longer need

The Phase 37 device run needed **three** temporary local changes. Plan 38-12 retired the third:

| Phase 37 hack | Still needed? |
|---|---|
| Remove credential-provider entitlement, App Groups, Keychain Sharing from the app target | **Maybe** — see below |
| Drop the embedded `PasskeyVaultAutoFill.appex` | **Maybe** — same reason |
| Repoint the hardcoded server URL from `127.0.0.1` to `https://vault.blonie.cloud` | **No. Obsolete.** |

The URL is now a real setting (`Core/ServerSettings.swift`) that **defaults to
`https://vault.blonie.cloud`**, and onboarding's Server step lets you change it and checks it is
reachable before accepting. A phone cannot reach the Mac's loopback, which is exactly why that hack
existed; there is nothing to edit now.

---

## Steps

1. **Unlock the phone and plug it in.** `xcrun devicectl list devices` currently shows it as
   `unavailable`, which means locked or not trusted — not a project problem. Tap **Trust** if asked.

2. **Open the project** (not a workspace — there is no `.xcworkspace`):

   ```bash
   open ios/PasskeyVault/PasskeyVault.xcodeproj
   ```

3. **Set the Team.** Select the **PasskeyVault** target → **Signing & Capabilities** → **Team** → your
   Apple ID / `4S7F2M7YLW`. Repeat for **PasskeyVaultAutoFill** if you keep the extension (step 5).
   This is the one click you correctly remembered needing.

4. **Pick the device** in the run destination dropdown, then **⌘R**.

5. **If signing fails on the entitlements** — the likely failure, and the reason Phase 37 stripped them.
   The app target currently declares all three in
   `ios/PasskeyVault/PasskeyVault/PasskeyVault.entitlements`:

   - `com.apple.developer.authentication-services.autofill-credential-provider` — Apple **allowlists**
     this one; a personal team is normally refused.
   - `com.apple.security.application-groups`
   - `keychain-access-groups`

   To get the UI onto the phone, in **Signing & Capabilities** remove **AutoFill Credential Provider**,
   **App Groups** and **Keychain Sharing** from the app target, and under **General → Frameworks,
   Libraries, and Embedded Content** remove `PasskeyVaultAutoFill.appex`.

   **Then revert those edits and do not commit them.** They are exactly what the Phase 37 record warns
   about, and committing them would silently disable the extension for everyone.

   What you lose by stripping them: biometric unlock still works (it uses the default keychain access
   group), but nothing about the AutoFill extension is exercised. Phase 41 owes its own device proof and
   cannot inherit one taken this way.

---

## Two hard constraints

- **Debug only.** `xcodebuild -configuration Release` crashes `swift-frontend` — landmine **L-14**,
  infinite recursion in generated UniFFI code (`ios/evidence/38/L14-RELEASE-BUILD-CRASH.md`). Do not try
  to work around it; ⌘R is Debug by default, so this only bites if you deliberately switch.
- **The deployment floor is iOS 18.0** (IOS-03, locked by PRF availability). Any iPhone on 18 or later is
  fine.

## Command-line equivalent

Once the Team is set in Xcode, this works without the UI:

```bash
caffeinate -i xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
  -scheme PasskeyVault -configuration Debug \
  -destination 'platform=iOS,name=Bartek'\''s iPhone' \
  -allowProvisioningUpdates build
```

`-allowProvisioningUpdates` lets Xcode mint the development profile non-interactively. It still needs the
Team to be set, so it does not remove step 3.
