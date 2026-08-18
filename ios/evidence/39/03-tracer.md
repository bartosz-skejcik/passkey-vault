# Phase 39, Plan 39-03 -- tracer evidence

**Branch implemented:** Branch H (DR-1, confirmed in `ios/evidence/39/02-branch-gate.md`) -- the
App Group container (`group.cloud.blonie.PasskeyVault`), never Keychain, for the ciphertext cache.

**Files this plan produced/modified:** `ios/PasskeyVault/PvShared/CachedSnapshot.swift`,
`ios/PasskeyVault/PvShared/CiphertextCacheStore.swift`, `ios/PasskeyVault/PasskeyVault/Sync/SyncModels.swift`,
`ios/PasskeyVault/PasskeyVault/Sync/SyncClient.swift`, `ios/PasskeyVault/PasskeyVault/Sync/SyncCoordinator.swift`,
`ios/PasskeyVault/PasskeyVault/Vault/VaultStore.swift` (+ `VaultAPI.swift`, `ContentView.swift`,
`Core/AccountService.swift`, `LockView.swift`, `Vault/ItemListView.swift` wiring),
`ios/PasskeyVault/PasskeyVault.xcodeproj/project.pbxproj` (new `PvShared` filesystem-synchronized
group), `ios/PasskeyVault/PasskeyVaultTests/SyncDecodeTests.swift`,
`ios/PasskeyVault/PasskeyVaultTests/SyncTracerLiveProofTests.swift`, `scripts/ios-sync-live-proof.sh`,
`scripts/ios-live-server.sh` (evidence-file collision fix, see below).

## Task 1 -- RED-before-green demonstration (D-08), `SyncDecodeTests`

Per this plan's own acceptance criteria: "with the decoder temporarily changed so a missing item
collection becomes an empty one, the up-to-date decode test FAILS ... both are reverted and both
pass again."

**Mutation applied** to `Sync/SyncModels.swift`'s `SyncPullResult.init(from:)`, replacing:

```swift
let upToDate = try container.decode(UpToDateBody.self)
self = .upToDate(revision: upToDate.revision)
```

with:

```swift
let upToDate = try container.decode(UpToDateBody.self)
self = .snapshot(revision: upToDate.revision, items: [], folders: [])
```

**RED transcript** (`xcodebuild test -only-testing:PasskeyVaultTests/SyncDecodeTests/decodingAnUpToDateBodyYieldsTheUpToDateCase()`):

```
Failing tests:
	SyncDecodeTests.decodingAnUpToDateBodyYieldsTheUpToDateCase()
** TEST FAILED **
SyncDecodeTests.swift:176: Issue recorded: expected the up-to-date branch, got .snapshot(revision: 1, items: [], folders: []) -- there is structurally no item collection on this branch to hand to a cache writer (D-12)
```

**Reverted**, confirmed by `git diff -- ios/PasskeyVault/PasskeyVault/Sync/SyncModels.swift` (empty
after revert), then re-run:

```
Test case 'SyncDecodeTests/decodingAnUpToDateBodyYieldsTheUpToDateCase()' passed on 'Clone 1 of iPhone 17 - PasskeyVault (85960)' (0.004 seconds)
** TEST SUCCEEDED **
```

The full six-test suite (`decodingASnapshotBodyYieldsTheSnapshotCaseWithNonEmptyItems`,
`decodingAnUpToDateBodyYieldsTheUpToDateCase`, `writingASnapshotThenReadingItRoundTripsAllFields`,
`readingFromANeverWrittenStoreReportsAbsenceDistinguishableFromAnEmptySnapshot`,
`snapshotWrittenForOneAccountIsRejectedWhenReadUnderAnotherAccount`,
`applyingASecondSnapshotReplacesThePreviousItemSetEntirely`) passes green, run twice for stability.

**The SAME red-then-green property, exercised through the LIVE proof's own third assertion**
(`SyncTracerLiveProofTests`'s digest-before/after-second-pull check): under the identical mutation
above, `VaultStore.refresh()`'s second (up-to-date) pull would decode into `.snapshot(revision,
items: [], folders: [])` instead of `.upToDate(revision)`, so `persistSnapshotToCache` is called
with an EMPTY item array on the second pull -- overwriting the good, first-pull-persisted cache
file with an empty one (exactly T-39-10, the DoS this plan's threat register names). This is the
check `SyncTracerLiveProofTests.swift:192-196`'s `#require`/`#expect` on
`digestBeforeSecondPull == digestAfterSecondPull` is written to catch; it was not re-run under the
mutation in this session (running the full live proof under a temporary source mutation would have
required a second full server+simulator round trip per mutation state) -- the mechanism is
identical to the one just demonstrated failing above (same decoder, same code path,
`VaultStore.refresh()`'s `switch response` has no other branch), and is the load-bearing reason
`SyncTracerLiveProofTests` reads the file's raw bytes directly rather than trusting an in-memory
flag.

## Task 1 -- `scripts/ios-live-server.sh` evidence-file collision (Rule 3 fix)

`scripts/ios-live-server.sh`'s `EVIDENCE_FILE` was hardcoded to
`ios/evidence/39/01-server-contract.md` -- reusing the harness unmodified for this plan's own live
proof would have silently overwritten 39-01's already-committed evidence on every run. Fixed to
`EVIDENCE_FILE="${PV_IOS_EVIDENCE_FILE:-ios/evidence/39/01-server-contract.md}"` (default
unchanged); `scripts/ios-sync-live-proof.sh`'s outer invocation sets
`PV_IOS_EVIDENCE_FILE=/dev/null` before wrapping itself through `ios-live-server.sh --exec`, since
this script owns and writes its own evidence (this file) directly.

## Task 1 -- D-08 falsification of the live proof itself

`PV_TRACER_FALSIFY_ONE_CHAR=1 scripts/ios-sync-live-proof.sh --expect-password "pv-39-03 tracer
falsify test 1787087397"` -- the item is authored with the real literal, but the script hands
`SyncTracerLiveProofTests` a one-character-longer value to compare against (decoupling "authored"
from "checked" is necessary: under this design the two would otherwise be the SAME shell variable
in both a passing and a "different literal" run, so a naive second run with a different
`--expect-password` can never itself produce a genuine mismatch -- see the script's own header).

**Exit code: 1.** Named the mismatch:

```
ERROR: SyncTracerLiveProofTests FAILED (exit=65, totalTestCount=1).
    SyncTracerLiveProofTests.swift:172: Expectation failed: (loginFields.password → "pv-39-03 tracer falsify test 1787087397") == (expectedItemPassword → "pv-39-03 tracer falsify test 1787087397X"): rendered password "pv-39-03 tracer falsify test 1787087397" != the literal the web client was given "pv-39-03 tracer falsify test 1787087397X"
```

**Restored** (flag removed) and confirmed passing again -- see the "Live proof run" sections below,
several of which post-date this falsification run.

## Task 1 -- crates diff gate falsification (D-01/D-02/D-06)

```
$ git diff --stat -- crates/pv-server crates/pv-core crates/pv-provider
(empty)
$ echo "" >> crates/pv-server/src/main.rs
$ git diff --stat -- crates/pv-server crates/pv-core crates/pv-provider
 crates/pv-server/src/main.rs | 1 +
 1 file changed, 1 insertion(+)
$ git checkout -- crates/pv-server/src/main.rs
$ git diff --stat -- crates/pv-server crates/pv-core crates/pv-provider
(empty)
```

The gate is empty at rest and demonstrated able to report a change.

## Task 1 -- sign-out purge path (D-19)

Phase 37 DID ship a sign-out path (`ContentView.performSignOut`); no gap to record. This plan adds
`AppGroupCiphertextCacheStore().purge()` to that same function, so the cache, its in-blob watermark
and the session token die together.

## Task 1 -- acceptance-criteria greps

```
$ grep -rl 'enum SyncPullResult' ios/PasskeyVault | wc -l
1
$ test -d ios/PasskeyVault/PvShared && test "$(grep -rc 'import UIKit' ios/PasskeyVault/PvShared | grep -v ':0' | wc -l | tr -d ' ')" = "0"
(exit 0)
$ test "$(grep -c 'SYNC-03' ios/PasskeyVault/PvShared/CiphertextCacheStore.swift)" -ge 1
(exit 0)
```

## Task 2 -- SYNC-05 record and the FILL-03 identity-store hook

Both records live in `ios/PasskeyVault/PasskeyVault/Sync/SyncCoordinator.swift`:

- **SYNC-05** (why APNs silent push is absent, the required-external-dependency conclusion, and the
  accepted user-visible consequence): the file-level comment, lines 13-33.
- **FILL-03** (the named, empty-bodied identity-store hook Phase 41 implements): the doc comment and
  `private func notifyIdentityStore()`, lines 65-86. Called from `pull()` (line 53), on the post-pull
  path, so the call site exists and is obvious rather than invented later.

```
$ grep -c "SYNC-05" ios/PasskeyVault/PasskeyVault/Sync/SyncCoordinator.swift
1
$ grep -c "FILL-03" ios/PasskeyVault/PasskeyVault/Sync/SyncCoordinator.swift
2
$ xcodebuild build -project ios/PasskeyVault/PasskeyVault.xcodeproj -scheme PasskeyVault -destination "platform=iOS Simulator,name=iPhone 17"
** BUILD SUCCEEDED **
```

## Full plan `<verify>` block, run end to end

```
$ export PV_TRACER_LITERAL="pv-39-03 tracer plan-verify <timestamp>"
$ test -n "$PV_TRACER_LITERAL"
$ xcodebuild test ... -only-testing:PasskeyVaultTests/SyncDecodeTests
** TEST SUCCEEDED ** (6/6 passed, run twice)
$ scripts/ios-sync-live-proof.sh --expect-password "$PV_TRACER_LITERAL"
==> PASS: rendered password matches, ciphertext digests match, the up-to-date pull left the persisted cache byte-identical.
$ test -z "$(git diff --name-only -- crates/pv-server crates/pv-core crates/pv-provider)"
(exit 0)
```

Overall exit code: **0**.

## Live proof runs (auto-appended by `scripts/ios-sync-live-proof.sh`)

## Live proof run -- 2026-08-18T21:09:54Z

- Server: http://127.0.0.1:8621
- Simulator UDID: 34992BB7-4982-4915-92C7-C7FC987802AF
- Tracer account: pv-39-03-tracer-1787087368@example.invalid
- Item id: c9e3e783-81d5-40dc-b825-e37037d28192, revision after create: 1
- --expect-password literal (verbatim): `pv-39-03 tracer smoke test password 1787087367`
- xcodebuild test totalTestCount: 1, exit status: 0
- App Group container (host path): /Users/j5on/Library/Developer/CoreSimulator/Devices/34992BB7-4982-4915-92C7-C7FC987802AF/data/Containers/Shared/AppGroup/1BAFFC1E-B911-473D-8D85-BBA274FAC34A

### D-13 digest comparison (enc_key/enc_data, curl-fetched vs. persisted store)

| field | curl (same session) | persisted store |
|---|---|---|
| enc_key | `f6cf503ce1ac76504aa96fa76b3b9dc2ec3740dd079c899ecb2c056e5db78aa9` | `f6cf503ce1ac76504aa96fa76b3b9dc2ec3740dd079c899ecb2c056e5db78aa9` |
| enc_data | `236f46eb121ebd4e2981f5370e5b859eaf9f8b7b25e8757d4651b08edf47f205` | `236f46eb121ebd4e2981f5370e5b859eaf9f8b7b25e8757d4651b08edf47f205` |

Digests are IDENTICAL for both fields.

## Live proof run -- 2026-08-18T21:10:53Z

- Server: http://127.0.0.1:8621
- Simulator UDID: 34992BB7-4982-4915-92C7-C7FC987802AF
- Tracer account: pv-39-03-tracer-1787087437@example.invalid
- Item id: 6ecba10f-4258-41f2-9905-8a2353216e0e, revision after create: 1
- --expect-password literal (verbatim): `pv-39-03 tracer final proof 1787087437`
- xcodebuild test totalTestCount: 1, exit status: 0
- App Group container (host path): /Users/j5on/Library/Developer/CoreSimulator/Devices/34992BB7-4982-4915-92C7-C7FC987802AF/data/Containers/Shared/AppGroup/1BAFFC1E-B911-473D-8D85-BBA274FAC34A

### D-13 digest comparison (enc_key/enc_data, curl-fetched vs. persisted store)

| field | curl (same session) | persisted store |
|---|---|---|
| enc_key | `e1a278d1642c2bb5aa022857ab1294a83cb24d0ee5135bdd6d738d673917b131` | `e1a278d1642c2bb5aa022857ab1294a83cb24d0ee5135bdd6d738d673917b131` |
| enc_data | `8e6d46531dab2126a5088a3ea9d13805946cfc3e4b10f7de630caf6fd5a0c877` | `8e6d46531dab2126a5088a3ea9d13805946cfc3e4b10f7de630caf6fd5a0c877` |

Digests are IDENTICAL for both fields.

## Live proof run -- 2026-08-18T21:11:12Z

- Server: http://127.0.0.1:8621
- Simulator UDID: 34992BB7-4982-4915-92C7-C7FC987802AF
- Tracer account: pv-39-03-tracer-1787087458@example.invalid
- Item id: e7afae9b-c65b-4e9d-9f65-b729586ab99a, revision after create: 1
- --expect-password literal (verbatim): `pv-39-03 tracer verify-exit 1787087458`
- xcodebuild test totalTestCount: 1, exit status: 0
- App Group container (host path): /Users/j5on/Library/Developer/CoreSimulator/Devices/34992BB7-4982-4915-92C7-C7FC987802AF/data/Containers/Shared/AppGroup/1BAFFC1E-B911-473D-8D85-BBA274FAC34A

### D-13 digest comparison (enc_key/enc_data, curl-fetched vs. persisted store)

| field | curl (same session) | persisted store |
|---|---|---|
| enc_key | `5e66d0c7731df496c5a3212a51d2665322f1362d048d0351561dea372c6f5e2f` | `5e66d0c7731df496c5a3212a51d2665322f1362d048d0351561dea372c6f5e2f` |
| enc_data | `a322e9e62502618c3579fc0a461195cf4d1e39e1b4f5dd31ccdc572c437d8bca` | `a322e9e62502618c3579fc0a461195cf4d1e39e1b4f5dd31ccdc572c437d8bca` |

Digests are IDENTICAL for both fields.

## Live proof run -- 2026-08-18T21:13:08Z

- Server: http://127.0.0.1:8621
- Simulator UDID: 34992BB7-4982-4915-92C7-C7FC987802AF
- Tracer account: pv-39-03-tracer-1787087561@example.invalid
- Item id: 4f0c9679-b587-4f49-833b-e49373a14a98, revision after create: 1
- --expect-password literal (verbatim): `pv-39-03 tracer plan-verify 1787087483`
- xcodebuild test totalTestCount: 1, exit status: 0
- App Group container (host path): /Users/j5on/Library/Developer/CoreSimulator/Devices/34992BB7-4982-4915-92C7-C7FC987802AF/data/Containers/Shared/AppGroup/1BAFFC1E-B911-473D-8D85-BBA274FAC34A

### D-13 digest comparison (enc_key/enc_data, curl-fetched vs. persisted store)

| field | curl (same session) | persisted store |
|---|---|---|
| enc_key | `8741b1cbd8185749857139d5f260deccbb51fcc55d05021366d98a2f81bb786d` | `8741b1cbd8185749857139d5f260deccbb51fcc55d05021366d98a2f81bb786d` |
| enc_data | `07b009e285c4d25233de80a92ede9f78138c2794c9fa827a2a132c23abe70fc2` | `07b009e285c4d25233de80a92ede9f78138c2794c9fa827a2a132c23abe70fc2` |

Digests are IDENTICAL for both fields.

