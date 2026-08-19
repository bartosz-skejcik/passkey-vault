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

## Task 1 -- last-synced surface, rendered on the vault list (recent state)

Screenshot, taken immediately after the account's first confirmed pull, before any
interaction or scrolling: `ios/evidence/39/39-06-freshness-recent.png`. The rendered string (
`app.staticTexts["vault.sync.lastSynced"]`, read programmatically by
`FreshnessEvidenceUITests`, never eyeballed) is legible in it.

## Task 3 -- E-F2: the stale-timestamp artifact (SC4, fallback path)

`ios/evidence/39/04-ws.md`'s E-S4 result is **Result B** -- this Simulator does not tear
down a backgrounded socket, so the proof here comes from stopping the server process for
real, not from a backgrounding gesture presented as if it produced the artifact.

- Server: http://127.0.0.1:8623
- Simulator UDID: 34992BB7-4982-4915-92C7-C7FC987802AF
- Account: pv-39-06-ef2-1787099841@example.invalid
- Mutation item id: f190d80c-4d06-4791-acca-015b3cac8c87, server revision after the mutation: 1
- The mutation was authored by a SECOND, independent iOS-toolchain client session (real
  `pv-wasm` crypto, real prelogin/login/create over HTTP -- `scripts/ios-ws-push-proof.sh`'s
  own established `mutate.mjs` technique), not the browser web app -- `pv-ffi`/`pv-wasm`
  crypto is not linked into the `PasskeyVaultUITests` target, so the running app's own
  session could not perform this write itself while staying the surface under test. The
  encrypting key for this ONE item is a fresh, throwaway `WasmUserKey`, unrelated to the
  account's real key -- the on-screen app never decrypts this item in this flow (the server
  is stopped before any further pull can succeed), so decrypt correctness is irrelevant here.

Screenshots: `ios/evidence/39/39-06-freshness-recent.png` (recent state, before the mutation
and before the server stop) and `ios/evidence/39/39-06-freshness-stale.png` (captured after
the mutation, the real server-stop, and a pull-to-refresh gesture that failed against the
now-dead server). The trigger for the second pull is pull-to-refresh
(`.refreshable { await refresh() }`, the SAME `VaultStore.refresh()` Task 2's own proof
exercises), not a background/foreground scene-phase transition -- tried first and found,
live, to cold-relaunch this app under this Simulator/XCUITest-automation combination once
backgrounded, landing back on AuthView instead of demonstrating staleness at all;
`FreshnessEvidenceUITests.swift`'s own header records that finding in full, plus a second,
separate finding: the driving script's original `lsof -ti :$PORT`-based kill matched BOTH
the server's listen socket and this app's own established connection to it, so an
unfiltered kill was sending SIGTERM directly to the app itself -- fixed by filtering to the
`pv-server` binary by command name before killing anything.

Rendered strings, verbatim: `Last synced 4 seconds ago` (recent) and
`Last synced 33 seconds ago` (stale, captured ~29s later). `FreshnessEvidenceUITests` does
NOT assert these two strings are character-for-character identical -- the production
`SyncStatusView` renders with `reference: Date()`, so its relative phrase legitimately
grows the longer the reader looks at it even though the underlying `syncedAtMs` never
moves. The positive assertion instead is that the STALE reading's elapsed-seconds figure
(33) is meaningfully larger than the recent reading's (4) by roughly the real wait this
test held (`XCTAssertGreaterThan(staleSeconds, recentSeconds + 15)`) -- a pull that had
falsely refreshed the timestamp would show the stale reading reset back down near zero
instead, which is exactly the "confident lie" T-39-23 exists to catch and exactly what
this assertion is shaped to fail on. The mutation (revision 1) landed server-side strictly
after the recent screenshot was taken, and the stale screenshot's last-synced time never
reset to reflect it.

The backgrounding half of SC4's proof text was NOT demonstrated on this Simulator -- E-S4
(39-04) already established that this Simulator does not suspend a backgrounded process's
socket the way a real device does, so a backgrounding test here would not distinguish
"correctly observing device behaviour" from "the Simulator simply keeps everything alive".
No sentence in this file claims backgrounding was tested as the proof mechanism; the server
was stopped, for real, and this test's OWN pull-to-refresh gesture is what triggered the
failing pull this evidence shows.

**What the stale screenshot additionally shows, beyond the last-synced text:** a visible
red status banner reading "Couldn't refresh the vault. Couldn't reach the server. Could not
connect to the server." (`ItemListView`'s own `refresh()` wrapper, `StatusCallout(tone:
.error)`) -- the pull's failure is disclosed to the user, not swallowed silently and not
presented as a success. No surface on this screen implies the vault is current.

```
E-F2-BREAK: server-stop
E-F2-SCREENSHOT: ios/evidence/39/39-06-freshness-stale.png
E-F2-BACKGROUNDING: not-demonstrated-on-simulator
```

