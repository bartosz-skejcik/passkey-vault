# Phase 39, Plan 39-06 -- freshness evidence (host app)

## Task 2 -- E-F1: the timestamp does not advance when the server cannot answer

- Server: http://127.0.0.1:8622
- Simulator UDID: 34992BB7-4982-4915-92C7-C7FC987802AF
- Baseline account: pv-39-06-freshness-1787095387@example.invalid
- Control account: pv-39-06-freshness-control-1787095387@example.invalid
- App Group container (host path): /Users/j5on/Library/Developer/CoreSimulator/Devices/34992BB7-4982-4915-92C7-C7FC987802AF/data/Containers/Shared/AppGroup/1BAFFC1E-B911-473D-8D85-BBA274FAC34A

### Methodology note on the rendered strings

Both processes render `SyncFreshness.describe(syncedAtMs:reference:)` with `reference`
pinned to the synced instant itself (elapsed = 0), not to "now" -- two independent
`xcodebuild test` invocations, separated by the host script's kill sequence, would
otherwise risk the RELATIVE phrase crossing a minute boundary between captures for reasons
unrelated to whether the freshness value moved. This still calls the real production
formatter; only the reference instant fed to it is pinned for reproducibility.

### Failed-pull comparison

| capture | stored `syncedAtMs` | rendered string |
|---|---|---|
| before (server up, confirmed pull) | `1787095463124` | `Last synced in 0 seconds` |
| after (server stopped, forced pull) | `1787095463124` | `Last synced in 0 seconds` |

**Identical.** The stored timestamp and the rendered string are unchanged across the
failed pull.

### Control (comparison shown able to fail, D-08)

With the server up throughout, two confirmed pulls 1.5s apart:

| capture | stored `syncedAtMs` | rendered string |
|---|---|---|
| control before | `1787095418560` | `Last synced in 0 seconds` |
| control after | `1787095420117` | `Last synced in 0 seconds` |

**Different.** The same comparison DOES report a difference when a second pull actually
succeeds, proving "unchanged" above is not indistinguishable from a comparison that
never ran.

### Means of stopping the server

`kill -TERM ${SERVER_PID}`, where `SERVER_PID` was resolved via `lsof -ti :8622` --
an external action against the real, separate `pv-server` process, never a flag inside
client code. Confirmed dead by BOTH an empty `lsof -ti :8622` re-check AND a failing
`curl http://127.0.0.1:8622/healthz`.

### What every visible sync-related surface displayed during the failed pull

This app builds no separate connection indicator (`SyncStatusView`'s own header) --
the ONLY sync-related surface is the last-synced text, and `FreshnessLiveProofTests
.aForcedPullAgainstAStoppedServerLeavesTheCacheUntouched()` asserts its underlying value
(`store.currentSnapshot?.syncedAtMs`) is unchanged (see the table above) -- no surface
anywhere claimed the pull succeeded; the pull's own error is caught and swallowed by
`VaultStore.refresh()`'s caller-visible contract exactly as it is for any other network
failure, never surfaced as a success.

```
E-F1-BEFORE-TS: 1787095463124
E-F1-AFTER-TS: 1787095463124
E-F1-CONTROL-BEFORE-TS: 1787095418560
E-F1-CONTROL-AFTER-TS: 1787095420117
```

