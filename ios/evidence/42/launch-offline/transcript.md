# Launch-offline proof — Phase 42-era correction

Debug session: `.planning/debug/ios-cold-launch-blank-offline.md`. Root cause, fix, and the DR
text are recorded there and in `ios/IOS-SPIKE-LOG.md` §1k.

Simulator: `PV-iPhone16` (`34992BB7-4982-4915-92C7-C7FC987802AF`, from `/private/tmp/pv16.udid`).
`scripts/ios-live-server.sh` running throughout at `http://127.0.0.1:8621` (fresh, throwaway
`data/pv.db`).

## (a) BEFORE the fix — blank screen, then bounces a signed-in user to sign-in

Reproduction: a real session (register+signIn against the live local server, via
`AccountFlowLiveTests.registerThenSignInReconstructsSameUserKeyAndDecryptsRealCiphertext()`,
which stores a real token through the SAME `SessionTokenStore.save` the app itself calls) +
`ServerSettings` pointed at `http://203.0.113.1:9999` (TEST-NET-3, RFC 5737 — reserved,
non-routable). Cold launch, screenshots taken in immediate succession.

- `before-fix-01-blank-loading.png` — ~0.3s after `simctl launch`: bare white screen
  (`ContentView`'s `.loading` case, a naked `ProgressView()`), status bar only.
- `before-fix-02-bounced-to-signin.png` — ~1.7s after `simctl launch`: the SAME signed-in
  session's app has already landed on **"Sign in to 203.0.113.1"** — a signed-in user bounced to
  the sign-in screen purely because the network was unreachable. This is `ContentView.reroute()`'s
  pre-fix `catch` block, which routed ANY `restoreSession()` failure (never distinguishing a real
  401 from a transport failure) to `.auth(initialMode: .signIn)`.

Root cause confirmed directly in source (`ContentView.swift`, `AccountService.swift`,
`LockView.swift`) before any edit was made — see the debug session's own Evidence section for the
line-by-line citations.

## (b)/(c) AFTER the fix — instant lock screen, never sign-in, offline unlock succeeds

Same unreachable server (`203.0.113.1:9999`), same class of signed-in session — this time seeded
locally and offline through `OfflineLockUITestSeeder.swift` (`PV_UITEST_OFFLINE_LOCK_SEED`, DEBUG
only), which writes a REAL `pv-ffi`-wrapped account envelope (through the SAME
`deriveAuthMaterial`/`wrapUserKeyJson` calls `AccountService.register`/`signIn` use) with zero
network involved, and points `ServerSettings` at the unreachable host through the REAL
`ServerSettings.store(_:)`.

- `after-fix-01-lock-chrome-mid-transition.png` — the app-icon-zoom launch transition, included to
  show there is no dead time before SOMETHING renders.
- `after-fix-02-lock-chrome-offline-banner.png` — ~1s after `simctl launch`: **"Vault locked" /
  "Signed in as offline-lock-uitest@pv.test.invalid"**, with the EXISTING 38-11 state-8 offline
  banner ("Can't reach the server. You can still unlock; changes will sync later.") — never a
  second, invented offline treatment (REQUIRED FIX #3's own constraint). The password field is
  already focused (the SAME `onChange(of: biometricState)` -> `.envelopeInvalidated` focus-move
  this file's header already documents, firing because the seeder deliberately clears any stale
  biometric envelope). The app is NOT on the sign-in screen.

Automated, repeatable proof of all three claims (a)/(b)/(c) together —
`LaunchOfflineLockUITests.testColdLaunchOfflineRendersLockScreenNeverBouncesToSignInAndUnlocksWithPasswordAlone`:

```
Test Suite 'LaunchOfflineLockUITests' started
Test Case '...testColdLaunchOfflineRendersLockScreenNeverBouncesToSignInAndUnlocksWithPasswordAlone]' started.
Test Case '...testColdLaunchOfflineRendersLockScreenNeverBouncesToSignInAndUnlocksWithPasswordAlone]' passed (11.702 seconds).
Test Suite 'LaunchOfflineLockUITests' passed
```

Command:

```
xcodebuild test-without-building \
  -project ios/PasskeyVault/PasskeyVault.xcodeproj -scheme PasskeyVault -configuration Debug \
  -destination "platform=iOS Simulator,id=$(cat /private/tmp/pv16.udid)" \
  -derivedDataPath /tmp/pv-dd -parallel-testing-enabled NO \
  -only-testing:PasskeyVaultUITests/LaunchOfflineLockUITests/testColdLaunchOfflineRendersLockScreenNeverBouncesToSignInAndUnlocksWithPasswordAlone\(\) \
  test-without-building
```

The test asserts, in order: `lock-title` exists within 3s of `app.launch()` returning and renders
in under 2s of that same instant; `auth-title` does NOT exist; the password field accepts the
fixture password (`Offline-Lock-42-Fixture!`); submit reaches `vault.create.plusMenu` (a
post-unlock-only element) within 10s; `auth-title` still does not exist afterward. Ran green twice
in a row (both scheduled clones, `-parallel-testing-enabled NO` notwithstanding — this project's
own L-28 clone-doubling landmine).

## (d) With the server reachable — background refresh rewrites the cache

Same real session (register+signIn against the live local server). `pv.server.url` restored to
`http://127.0.0.1:8621`. Plain `simctl launch` (no seeding, no password typed, no explicit sign-in
— the ONLY thing that could write `AccountEnvelopeCache` during this launch is the automatic
background refresh, `ContentView.refreshSessionInBackground()`). `log stream` captured for the
whole launch:

```
15:02:06.579  PVLOCK|stage=host-launch-read writer=host bootMatch=true
15:02:06.778  PVLOCK|entry=host-unlock stage=lazy-check status=unlocked
15:02:07.151  PVLOCK|stage=uk-envelope-delete status=-25300     (idempotent -- no biometric envelope was ever enrolled for this fixture)
15:02:07.447  PVLOCK|stage=envelope-cache-save status=0          <-- the background refresh's OWN write
```

`entry=host-unlock` (LockView's own `onAppear` marker) proves the app reached `.lock` from the
LOCAL restore alone, before any network call could have completed. `envelope-cache-save` firing
~0.7s later, with no user interaction in between, is `AccountService.restoreSession()`'s success
path (`GET /api/auth/me` against the now-reachable server) re-writing
`AccountEnvelopeCache` — the "background refresh updates the cache" claim, directly observed.
Screenshot: `after-fix-03-reachable-background-refresh.png`.

## Regression tests

- `ios/PasskeyVault/PasskeyVaultTests/LocalAccountRestoreTests.swift` — 8 cases, all green:
  `AccountService.localAccount()` (Keychain-only, structurally no `apiClient`) and
  `AccountService.unlockLocally(account:password:)` (the offline-unlock primitive: correct
  password round-trips a REAL `pv-ffi`-wrapped key end-to-end through `encryptItem`/`decryptItem`;
  wrong password is rejected locally; a legacy/no-cached-salt account surfaces
  `LocalUnlockError.noCachedCredentials` specifically; the envelope-cache merge never blanks an
  already-cached salt/kdf on a refresh).
- `ios/PasskeyVault/PasskeyVaultUITests/LaunchOfflineLockUITests.swift` — see above.
