# SC4 / SC5 — physical-device verification protocol

**Why this exists:** Phase 37 verified 3/5 success criteria. SC4 and SC5 could not be settled on the
simulator — and not merely for lack of trying. Experiment E2 returned **contrary** evidence: with
Face ID genuinely enrolled and **no `LAContext` at all**, `SecItemCopyMatching` returned the
ACL-protected 32 bytes unconditionally in under 2 ms (`/private/tmp/pv37-05-e2.txt`,
`VERDICT=B bytes-match=true`). The iOS Simulator does not enforce `.biometryCurrentSet`.

The mechanism is verified correct in code. What is unverified is whether the **OS** actually gates the
key. Only a physical device can answer that.

**Read this first:** the point of the protocol below is to be **falsifiable**. Step 3 is the one that
matters most — if it does not behave as described, ACC-04 is not satisfied and that is a real finding,
not a testing mishap. Do not skip it because steps 2 and 4 looked fine.

---

## 0. What you need

- An iPhone with Face ID or Touch ID enrolled, running iOS 18.0 or later.
- A Mac with this repo and Xcode 26.6.
- An Apple ID. See the build-path fork below — a **free** one is enough for this test.

## 1. Build path — pick one

### Path A — free Apple ID (sufficient for SC4/SC5)

The app target currently declares three entitlements that a free personal team **cannot** provision:
`com.apple.developer.authentication-services.autofill-credential-provider`,
`com.apple.security.application-groups`, and a team-prefixed `keychain-access-groups`. It also embeds
the AutoFill extension.

None of them are needed to test a biometric Keychain gate inside a single app. So build a
**verification-only variant**:

1. Open `ios/PasskeyVault/PasskeyVault.xcodeproj` in Xcode.
2. Select the `PasskeyVault` target → **Signing & Capabilities**.
3. Set **Team** to your personal Apple ID team. Xcode will report entitlement errors — expected.
4. Remove, **for this local build only**: the *AutoFill Credential Provider* capability, the *App
   Groups* capability, and the *Keychain Sharing* capability.
5. Remove `PasskeyVaultAutoFill.appex` from the app target's **Embed Foundation Extensions** phase.
6. Change the bundle identifier to something unique to you (e.g. `cloud.blonie.PasskeyVault.devtest`)
   — the existing one may collide.
7. Plug in the iPhone, select it as the destination, and Run.
8. On the phone: **Settings → General → VPN & Device Management** → trust your developer certificate.

**Do not commit these project changes.** They are a local instrument, not a product change. Revert with
`git checkout -- ios/PasskeyVault/PasskeyVault.xcodeproj/project.pbxproj` when finished.

**What Path A does NOT test** (record this, do not let it be forgotten): the shared
`keychain-access-groups` path that the AutoFill extension will use in Phase 41. This build proves the
biometric gate for a single app only. Phase 41 needs its own device proof.

### Path B — paid Apple Developer Program ($99/yr)

Set Team and Run. No stripping needed, and the entitlements provision normally. This also unblocks the
Phase 41 cross-process work and Phase 43's passkey provider later — but it is a business decision, not
a technical prerequisite for *this* test.

## 2. Server

The app has a server-URL field. On a phone it cannot reach `127.0.0.1`.

- Easiest: point it at your hosted instance, `https://vault.blonie.cloud` (HTTPS, so App Transport
  Security is satisfied — see hazard H1 in `37-03`). Use a throwaway email; the account is real.
- Alternative: run `pv-server` on the Mac and use its LAN IP — but that is plain HTTP, which ATS
  blocks by default, so it needs an ATS exception. Not worth it for this test.

---

## 3. The protocol

Do these in order. Record the outcome of each — **including any that behave unexpectedly.**

### Step 1 — enrol (setup, proves nothing on its own)

1. Launch the app, enter the server URL, create an account with a throwaway email.
2. Confirm it unlocks and shows the decrypted fixture note.
3. Force-quit the app.

### Step 2 — the positive half of ACC-04

4. Relaunch. The lock screen should appear and **auto-prompt Face ID once** without you tapping.
5. Authenticate successfully.

**Expected:** the vault unlocks and the fixture note decrypts to
`{"type":"note","body":"Phase 37 tracer fixture"}`.

**This is the half that proves the returned bytes are the REAL key** — not merely that some bytes came
back. If the note appears but is garbled or the app errors, the key came back wrong: a finding.

### Step 3 — the negative half of ACC-04 ⚠ the one that actually matters

6. Force-quit and relaunch.
7. When the Face ID sheet appears, **fail it deliberately** — cover the camera, or use a different
   face, until iOS refuses. On Touch ID, use a wrong finger repeatedly.

**Expected:** the vault does **NOT** unlock. No fixture note. You get either the locked-out message or
a fall-through to password unlock, with a readable message — never a silent nothing, and never the
note.

**If the vault unlocks anyway, or the note appears without successful biometry — STOP. That is
ACC-04 failing on real hardware,** and it is exactly the result this whole protocol exists to catch.
Record it verbatim and tell me. It would mean the simulator's Result B is not a simulator artifact.

### Step 4 — SC5, biometric-set invalidation

8. Unlock successfully once more (so the envelope is armed).
9. Force-quit the app.
10. On the phone: **Settings → Face ID & Passcode** → add a face or reset Face ID (on Touch ID: add or
    remove a fingerprint). This changes the *enrolled set*, which is what `.biometryCurrentSet` binds to.
11. Relaunch the app.

**Expected:** biometric unlock no longer works. You see a **readable, specific message** naming the
password route — the English string contains the word "password", the Polish contains "hasł" — and
focus lands in the password field. Never a raw error code, never a silent failure.

12. Unlock with your master password.
13. Force-quit, relaunch.

**Expected:** biometrics work again — the envelope **silently re-armed** on that successful password
unlock, with no toggle to tap. That is the locked decision from `37-CONTEXT.md`.

### Step 5 — the focus behaviour (currently unverified anywhere)

At step 11, when the invalidation message appears: **is the password field focused, with the keyboard
already up?**

This is `WR-03`. It is implemented and RED-verified, but its GREEN run was never observed — the test
harness has no interactive WindowServer session, so nobody has ever watched it work. Your eyes here are
the only evidence that exists.

---

## 4. Report back

For each step: what you expected, what happened, and a photo or screen recording if anything differed.

A **failure at step 3 is the most valuable result this protocol can produce** — far more valuable than
five green steps. If everything passes, SC4 and SC5 flip to verified and Phase 37 closes at 5/5.

Leave the phone's Face ID settings as you found them when finished.
