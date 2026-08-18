# Phase 39, Plan 39-05 -- gate evidence

Two permanent gates, each shown red against a real, deliberately-introduced defect before being
trusted: `scripts/audit-ios-cache-ciphertext.sh` (SYNC-03) and
`scripts/audit-sync-decision-records.sh` (SYNC-05).

## Task 1 -- `scripts/audit-ios-cache-ciphertext.sh`

### Setup (shared across every run below)

- Isolated server: `scripts/ios-live-server.sh` (foreground), `PV_IOS_BASE=http://127.0.0.1:8621`,
  throwaway `mktemp -d` sqlite db. D-23 preflight was hit once before this plan's own server could
  bind: a stray `pv-server` (a SIBLING project directory, `/Users/j5on/.work/projects/passkey-vault`,
  not this worktree) was listening on the default port `:8620` with many live connections. Per D-23,
  it was never touched -- this session polled `lsof -nP -i :8620` every 5s until it cleared on its
  own (~100-150s), then proceeded.
- Simulator: `PV-iPhone16` (`34992BB7-4982-4915-92C7-C7FC987802AF`), already booted.
- Fixture: one throwaway account + one login item is registered fresh for EACH scenario below,
  authored via the real `crates/pv-wasm` artifact (never a mock) with the item's password set to a
  single canary literal reused across every scenario:
  `PV-CANARY-39-05-1787093088-8b1a0289d602` (confirmed appearing in NO tracked source file --
  acceptance criterion grep below).
- Real iOS sync: the app is built Debug (`LiveSyncProbe.swift` compiled in), installed, and launched
  with `SIMCTL_CHILD_PV_WS_PROOF_EMAIL`/`SIMCTL_CHILD_PV_WS_PROOF_PASSWORD` set -- the SAME real
  production path (`AccountService` -> `VaultStore` -> `SyncCoordinator` -> `SyncSocket`'s catch-up
  pull on open -> `VaultStore.persistSnapshotToCache`) 39-04's `LiveSyncProbe.swift` already
  established, confirmed via `PVSYNC|event=open` and `PVSYNC|event=render` in the device log for
  every run below. A fresh account is used per scenario so every pull hits the SNAPSHOT branch
  (`since=0`), guaranteeing the cache writer actually runs regardless of source-mutation state.
- Gate inputs: `PV_IOS_BASE` (server), `PV_GATE_TOKEN` (the fixture account's session token),
  `PV_GATE_ITEM_ID`/`PV_GATE_CANARY` (the plan's own named env vars, exported non-empty before every
  invocation of the plan's literal `<verify>` command).

### Green run 1 -- honest baseline

```
$ export PV_IOS_BASE=http://127.0.0.1:8621 PV_GATE_TOKEN=<token> \
    PV_GATE_ITEM_ID=4c4f6866-1671-4946-b14f-727272d87ff7 PV_GATE_CANARY=PV-CANARY-39-05-1787093088-8b1a0289d602
$ bash -c 'set -e; test -n "$PV_GATE_ITEM_ID"; test -n "$PV_GATE_CANARY"; scripts/audit-ios-cache-ciphertext.sh --item-id "$PV_GATE_ITEM_ID" --canary "$PV_GATE_CANARY"'
PASS (SYNC-03): the persisted cache at .../vault-cache-v1.json holds only allowlisted, ciphertext-shaped
fields -- byte-equal to the server's own copy for item 4c4f6866-1671-4946-b14f-727272d87ff7, and the
canary literal is absent from its raw bytes.
      cache item count: 1
      enc_data digest (server == cache): d537dfd1de56f06f4e112340dcec162d83c8403caa6133f8496fdeab38e7dfa0
exit=0
```

This IS the plan's own literal `<verify>` command, run end to end against a real freshly-synced cache.

### Red run 1 (of 2 from the same defect) -- decrypted-field leak, Check 2

**Mutation:** `PvShared/CachedSnapshot.swift`'s `Item` struct gained a temporary
`let debugLeakPassword: String?` field (no inline default -- Swift's synthesized memberwise init
silently EXCLUDES a defaulted stored property from its own parameter list entirely, confirmed
empirically with a standalone `swift` snippet before touching production code, which would have made
it impossible to ever pass a non-nil value through that init). `VaultStore.persistSnapshotToCache`
was temporarily changed to build each `CachedSnapshot.Item` manually, looking up the matching
ALREADY-DECRYPTED `VaultItemViewModel` in `self.items` and copying `loginFields.password` into the
new field. `Sync/SyncModels.swift`'s `CachedSnapshot.Item.init(row:)` was updated to pass
`debugLeakPassword: nil` so the honest call site kept compiling.

Fresh fixture (account `pv-39-05-gate-leak-1787093288@example.invalid`, item
`d2e2f500-2cbd-447f-949e-7fa06f682080`), rebuilt, relaunched, synced. Raw cache content confirmed the
leak landed:

```
$ jq '.items[0]' vault-cache-v1.json
{
  "revision": 1,
  "id": "d2e2f500-2cbd-447f-949e-7fa06f682080",
  "debugLeakPassword": "PV-CANARY-39-05-1787093088-8b1a0289d602",
  "updatedAt": "2026-08-18 22:48:08",
  "encData": "...",
  "lastEditorEmail": "pv-39-05-gate-leak-1787093288@example.invalid",
  "encKey": "...",
  "isShared": false
}
```

```
$ scripts/audit-ios-cache-ciphertext.sh --item-id d2e2f500-2cbd-447f-949e-7fa06f682080 --canary PV-CANARY-39-05-1787093088-8b1a0289d602
FAIL (Check 2 -- closed allowlist): key(s) not on the allowlist found in the cache: debugLeakPassword
exit=1
```

### Red run 2 (of 2 from the same defect) -- decrypted-field leak, Check 3 alone

Checks run in order and the script exits on the first failure, so Check 3 never independently
executes in the run above. To prove Check 3 is ALSO load-bearing against this same leak (not merely
theoretically), the Check 2 block was TEMPORARILY commented out of the gate script itself (a change
to the gate under test, immediately reverted -- never a change to the leak fixture) and the identical
invocation re-run against the SAME leaking cache:

```
$ scripts/audit-ios-cache-ciphertext.sh --item-id d2e2f500-2cbd-447f-949e-7fa06f682080 --canary PV-CANARY-39-05-1787093088-8b1a0289d602
FAIL (Check 3 -- live canary): the canary literal was found in the raw cache bytes at .../vault-cache-v1.json
-- a decrypted field has leaked into the ciphertext-only cache.
exit=1
```

The gate script's temporary Check-2-disabled state was reverted immediately after this one run
(`diff` confirmed byte-identical to the pre-mutation script before continuing).

### Green run 2 -- leak reverted

`CachedSnapshot.swift`, `VaultStore.swift`, and `Sync/SyncModels.swift` were restored to their
pre-mutation contents (`cp` from a pre-mutation backup, `git diff --stat` confirmed empty on all
three). Rebuilt. Fresh fixture (account `pv-39-05-gate-green2-...`, item
`613822b0-b361-44c4-9802-a030815687bd`), relaunched, synced.

```
$ scripts/audit-ios-cache-ciphertext.sh --item-id 613822b0-b361-44c4-9802-a030815687bd --canary PV-CANARY-39-05-1787093088-8b1a0289d602
PASS (SYNC-03): ... byte-equal ... canary literal is absent ...
      enc_data digest (server == cache): 094c998c326b03813ba8a96ffcab20ecc151e1982b9b6faf7db86d295793e015
exit=0
```

### Red run 3 -- an unknown key ALONE, no secret value, trips Check 2 (Check 3 stays green)

**Mutation:** `CachedSnapshot.Item` gained a different temporary field,
`let debugMarker: String` (required, no default -- same Swift lesson as above), set unconditionally
to the fixed, non-secret literal `"phase-39-05-marker"` in `Sync/SyncModels.swift`'s
`CachedSnapshot.Item.init(row:)`. No decrypted content is ever read for this mutation -- it exists to
prove the allowlist check is load-bearing INDEPENDENTLY of the canary check, not only in combination
with it.

Fresh fixture (account `pv-39-05-gate-marker-1787093420@example.invalid`, item
`5b170dfb-2702-46e4-9592-2a0ddbbe187c`), rebuilt, relaunched, synced.

```
$ scripts/audit-ios-cache-ciphertext.sh --item-id 5b170dfb-2702-46e4-9592-2a0ddbbe187c --canary PV-CANARY-39-05-1787093088-8b1a0289d602
FAIL (Check 2 -- closed allowlist): key(s) not on the allowlist found in the cache: debugMarker
exit=1
```

Isolation confirmed directly (never inferred): the canary was independently confirmed ABSENT from
the raw cache bytes of this same run --

```
$ grep -F -- "PV-CANARY-39-05-1787093088-8b1a0289d602" vault-cache-v1.json
(no output -- canary absent, Check 3 would have passed on its own)
$ jq '.items[0] | keys' vault-cache-v1.json
["debugMarker","encData","encKey","id","isShared","lastEditorEmail","revision","updatedAt"]
```

### Green run 3 -- marker reverted

`CachedSnapshot.swift` and `Sync/SyncModels.swift` restored (`cp`/`git checkout`, `git status --short`
confirmed clean). Rebuilt. Fresh fixture (account `pv-39-05-gate-green3-1787093468@example.invalid`,
item `fce1a158-bb6f-44b4-b0a1-ba47cb89f573`), relaunched, synced.

```
$ scripts/audit-ios-cache-ciphertext.sh --item-id fce1a158-bb6f-44b4-b0a1-ba47cb89f573 --canary PV-CANARY-39-05-1787093088-8b1a0289d602
PASS (SYNC-03): ...
      enc_data digest (server == cache): 6d5b18591b5a725e29f141b4db68b750a1c84dca5dc756a35d1852136417a787
exit=0
```

### Red run 4 -- deleted cache artifact trips Check 0, distinct message

No source mutation, no rebuild -- the honest cache from Green run 3 was moved off its own path
directly on the host filesystem (`mv .../vault-cache-v1.json /tmp/vault-cache-v1.json.backup`),
confirmed absent (`ls` shows no `vault-cache-v1.json` in the container), and the SAME item/token from
Green run 3 re-used:

```
$ scripts/audit-ios-cache-ciphertext.sh --item-id fce1a158-bb6f-44b4-b0a1-ba47cb89f573 --canary PV-CANARY-39-05-1787093088-8b1a0289d602
FAIL (Check 0 -- existence): no cache artifact at .../vault-cache-v1.json -- the cache was never
written. This is a DIFFERENT failure from a bad ciphertext match; do not confuse the two.
exit=1
```

Distinct wording from every Check 1/2/3 failure message above, satisfying the acceptance criterion
that an absent cache is never misread as (or confused with) a content-level failure.

### Green run 4 -- restored via a real re-sync

The app was relaunched with the SAME account (`SIMCTL_CHILD_PV_WS_PROOF_EMAIL`/`_PASSWORD` for
`pv-39-05-gate-green3-...`). With the persisted cache gone, `SyncClient.pull()`'s watermark read
(`cacheStore.readCurrentSnapshot(accountId:)?.revision ?? 0`) fell back to `0`, so the pull hit the
snapshot branch again and re-wrote the cache from scratch -- this is a REAL re-sync, not a file copy.

```
$ scripts/audit-ios-cache-ciphertext.sh --item-id fce1a158-bb6f-44b4-b0a1-ba47cb89f573 --canary PV-CANARY-39-05-1787093088-8b1a0289d602
PASS (SYNC-03): ...
      enc_data digest (server == cache): 6d5b18591b5a725e29f141b4db68b750a1c84dca5dc756a35d1852136417a787
exit=0
```

(Same digest as Green run 3 -- the re-synced ciphertext is byte-identical, as expected: nothing
changed server-side between the deletion and the restore.)

### Allowlist traceability

The allowlist in `scripts/audit-ios-cache-ciphertext.sh` (`ALLOWLIST="schemaVersion revision
syncedAtMs accountId serverBaseURL items folders id encKey encData updatedAt lastUsedAt isShared
collectionId lastEditorEmail encName"`) is the exact, complete set of stored-property names declared
in `ios/PasskeyVault/PvShared/CachedSnapshot.swift` across `CachedSnapshot` (lines 78-99:
`schemaVersion`, `revision`, `syncedAtMs`, `accountId`, `serverBaseURL`, `items`, `folders`),
`CachedSnapshot.Item` (lines 51-62: `id`, `encKey`, `encData`, `revision`, `updatedAt`, `lastUsedAt`,
`isShared`, `collectionId`, `lastEditorEmail`), and `CachedSnapshot.Folder` (lines 69-71: `id`,
`encName`) -- no more, no fewer, both directions confirmed by reading the file at the time this
script was written (`revision`/`id` are shared across levels and appear once in the allowlist, since
the allowlist is a flat set of key NAMES rather than a per-level schema).

Enumerated key set of a real, honest cache (Green run 4, the same document quoted above under Red run
4's restore):

```
$ jq -r '[paths(scalars)[] | select(type == "string")] | unique | .[]' vault-cache-v1.json
accountId
encData
encKey
id
items
lastEditorEmail
revision
schemaVersion
serverBaseURL
syncedAtMs
updatedAt
```

Every one of these is a member of the allowlist above (note `folders`, `collectionId`, `lastUsedAt`,
`encName` are absent from THIS particular document only because `folders` is an empty array and
`collectionId`/`lastUsedAt` are `nil` -- Swift's synthesized `Encodable` conformance omits a `nil`
Optional property's key entirely rather than emitting `null`, confirmed by inspection of this same
document's `items[0]` object, which has no `collectionId`/`lastUsedAt` key at all).

### Acceptance-criteria greps

```
$ test "$(grep -c 'PIPESTATUS' scripts/audit-ios-cache-ciphertext.sh || true)" = "0"
(exit 0)
$ CANARY=PV-CANARY-39-05-1787093088-8b1a0289d602
$ test -n "$CANARY" && test "$(git grep -c -F "$CANARY" -- . | wc -l | tr -d ' ')" = "0"
(exit 0)
```

`git status --short -- ios/` was confirmed empty (no drift left behind by any mutation) before moving
to Task 2.

---

## Task 2 -- `scripts/audit-sync-decision-records.sh`

### Green run (baseline)

```
$ scripts/audit-sync-decision-records.sh
PASS: SYNC-05's decision record (reasoning, not just the token) found in
ios/PasskeyVault/PasskeyVault/Sync/SyncCoordinator.swift; FILL-03 hook marker present under
ios/PasskeyVault/PasskeyVault/Sync
exit=0
```

(First attempt at this baseline failed for a real, distinct reason worth recording: the reasoning
phrases wrap across `//` comment lines in the source -- e.g. "APNs sending\n  capability", "REQUIRED\n
EXTERNAL DEPENDENCY" -- and the block-extraction/normalization needed to strip each line's leading
`//`/`///` marker BEFORE joining lines, or the marker itself lands mid-phrase once joined
(`"sending // capability"`, matching nothing). Fixed once, in the script itself, before any
falsification run below.)

### Red run 1 -- wrong root, no `SYNC-05` token anywhere under it

```
$ scripts/audit-sync-decision-records.sh --root ios/PasskeyVault/PasskeyVaultUITests
FAIL: no file under 'ios/PasskeyVault/PasskeyVaultUITests' contains the SYNC-05 token -- this is
either a vacuous run (wrong path) or the record has gone missing.
exit=1
```

Confirmed distinguishable from a vacuous success: the message names the exact path searched.

### Red run 2 -- reasoning sentences removed, token kept

**Mutation:** `SyncCoordinator.swift`'s file-header comment block was temporarily reduced to just the
`SYNC-05 -- APNs silent push is deliberately NOT built in v1.0.` line plus a marker comment -- every
reasoning sentence (the sending-capability description, the required-external-dependency conclusion,
the user-visible consequence) was removed, the token itself untouched.

```
$ scripts/audit-sync-decision-records.sh
FAIL: SYNC-05 token found in ios/PasskeyVault/PasskeyVault/Sync/SyncCoordinator.swift, but its comment
block is missing reasoning term(s): [a server-side sending capability] [the required-external-dependency
conclusion] [the stated user-visible consequence] -- a bare token is not a decision record.
exit=1
```

Restored (`cp` from a pre-mutation backup), confirmed `git diff --stat` empty, re-run:

```
$ scripts/audit-sync-decision-records.sh
PASS: SYNC-05's decision record (reasoning, not just the token) found in
ios/PasskeyVault/PasskeyVault/Sync/SyncCoordinator.swift; FILL-03 hook marker present under
ios/PasskeyVault/PasskeyVault/Sync
exit=0
```

### Red run 3 -- the FILL-03 hook marker removed, that assertion alone goes red

**Mutation:** every occurrence of the literal `FILL-03` in `SyncCoordinator.swift` (two: the doc
comment and the inline comment inside `notifyIdentityStore()`) was renamed to
`FILL_ZERO_THREE_REMOVED` via `sed`.

```
$ grep -c "FILL-03" ios/PasskeyVault/PasskeyVault/Sync/SyncCoordinator.swift
0
$ scripts/audit-sync-decision-records.sh
FAIL: no file under 'ios/PasskeyVault/PasskeyVault/Sync' contains the FILL-03 identity-store hook marker.
exit=1
```

Restored (`cp` from the pre-mutation backup), confirmed `git diff --stat` empty, re-run:

```
$ scripts/audit-sync-decision-records.sh
PASS: SYNC-05's decision record (reasoning, not just the token) found in
ios/PasskeyVault/PasskeyVault/Sync/SyncCoordinator.swift; FILL-03 hook marker present under
ios/PasskeyVault/PasskeyVault/Sync
exit=0
```

### Plan's own literal `<verify>` block

```
$ bash -c 'set -e; scripts/audit-sync-decision-records.sh; ! scripts/audit-sync-decision-records.sh --root ios/PasskeyVault/PasskeyVaultUITests'
PASS: SYNC-05's decision record (reasoning, not just the token) found in
ios/PasskeyVault/PasskeyVault/Sync/SyncCoordinator.swift; FILL-03 hook marker present under
ios/PasskeyVault/PasskeyVault/Sync
FAIL: no file under 'ios/PasskeyVault/PasskeyVaultUITests' contains the SYNC-05 token -- this is
either a vacuous run (wrong path) or the record has gone missing.
exit=0
```

### Acceptance-criteria grep

```
$ test "$(grep -c 'PIPESTATUS' scripts/audit-sync-decision-records.sh || true)" = "0"
(exit 0)
```

`git status --short -- ios/` confirmed empty at the end of this task, no drift left behind.
