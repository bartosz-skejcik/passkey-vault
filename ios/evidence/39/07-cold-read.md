# Phase 39, Plan 39-07 -- cold-read proof evidence

## Task 1 -- the cold read (E-C1/E-C3, SYNC-02)

- Server: http://127.0.0.1:8624
- Simulator UDID: 34992BB7-4982-4915-92C7-C7FC987802AF
- Account: pv-39-07-coldread-1787103254@example.invalid
- App Group container (host path): /Users/j5on/Library/Developer/CoreSimulator/Devices/34992BB7-4982-4915-92C7-C7FC987802AF/data/Containers/Shared/AppGroup/1BAFFC1E-B911-473D-8D85-BBA274FAC34A
- Pinned evidence reference (epoch ms): 1787103255244

### Host write digest vs. the reader's digest

| side | SHA-256 |
|---|---|
| host (independently computed over the raw persisted file) | `7c3613ca01736de302c69144eb799f30d6097e9fee7dcd152b1cff489b654264` |
| extension (the digest `CacheColdReadProbe` computed over the bytes it read) | `7c3613ca01736de302c69144eb799f30d6097e9fee7dcd152b1cff489b654264` |

**IDENTICAL.** Item count reported by the reader: 1.

### Host process absence (confirmed, not assumed)

```
$ xcrun simctl spawn 34992BB7-4982-4915-92C7-C7FC987802AF launchctl list | grep -i cloud.blonie.PasskeyVault   # BEFORE terminate
69340	0	UIKitApplication:cloud.blonie.PasskeyVault[78af][rb-legacy]

$ xcrun simctl terminate 34992BB7-4982-4915-92C7-C7FC987802AF cloud.blonie.PasskeyVault

$ xcrun simctl spawn 34992BB7-4982-4915-92C7-C7FC987802AF launchctl list | grep -i cloud.blonie.PasskeyVault   # AFTER terminate
(no output -- absent)
```

The word "cold" applies to this read: the BEFORE capture shows the host process present (1 matching line(s)), the AFTER capture shows it absent (0 matching lines), both captured around a real `xcrun simctl terminate` -- never assumed from having issued that command.

### Wrong-sharing-identifier negative control (E-C1)

Repeated against `group.cloud.blonie.PasskeyVault.NeverDeclared`, an identifier this bundle does NOT declare in `PasskeyVaultAutoFill.entitlements`:

- First invocation (cache present): `resolve_failed`
- Second invocation (cache deleted): `resolve_failed`

Both fail with `resolve_failed` (`containerURL(forSecurityApplicationGroupIdentifier:)` returns nil for an identifier this bundle is not entitled to) -- the platform enforces the boundary on this setup, so the positive read above is not vacuous.

### Deleted-cache control

With `/Users/j5on/Library/Developer/CoreSimulator/Devices/34992BB7-4982-4915-92C7-C7FC987802AF/data/Containers/Shared/AppGroup/1BAFFC1E-B911-473D-8D85-BBA274FAC34A/vault-cache-v1.json` removed and the same read repeated: `status=absent`.

The reader reports absence, not a stale in-process copy -- proving it reads STORAGE, not memory.

### Extension binary carries the shared module (backstop truth)

```
$ nm /tmp/pv-dd-coldread/Build/Products/Debug-iphonesimulator/PasskeyVault.app/PlugIns/PasskeyVaultAutoFill.appex/PasskeyVaultAutoFill.debug.dylib | grep AppGroupCiphertextCacheStore
00000000000098b8 t _$s20PasskeyVaultAutoFill28AppGroupCiphertextCacheStoreC11fileManager33_4376335CCF4A93229568DB803F5122FFLLSo06NSFileK0Cvg
0000000000178cc0 s _$s20PasskeyVaultAutoFill28AppGroupCiphertextCacheStoreC11fileManager33_4376335CCF4A93229568DB803F5122FFLLSo06NSFileK0CvpWvd
0000000000009918 T _$s20PasskeyVaultAutoFill28AppGroupCiphertextCacheStoreC11fileManagerACSo06NSFileK0C_tcfC
0000000000202bf4 S _$s20PasskeyVaultAutoFill28AppGroupCiphertextCacheStoreC11fileManagerACSo06NSFileK0C_tcfCTq
0000000000009960 T _$s20PasskeyVaultAutoFill28AppGroupCiphertextCacheStoreC11fileManagerACSo06NSFileK0C_tcfc
... (52 total matching lines)
```

The built extension binary is inspected directly, not inferred from the build succeeding.

## Task 2 -- the AutoFill surface's own last-synced line, both processes observed rendering the same instant (SYNC-04)

FRESHNESS-HOST: Last synced in 14 seconds
FRESHNESS-EXT: Last synced in 14 seconds
FRESHNESS-MATCH: SAME
FRESHNESS-SCREENSHOT: ios/evidence/39/39-07-coldread-freshness.png

Both strings are the SAME production formatter (`PvShared/SyncFreshness.describe(syncedAtMs:reference:)`), called independently by the host process and the extension process, against the SAME persisted snapshot and the SAME pinned reference instant (`1787103255244`).

### The control (comparison shown able to say DIFFERENT, D-06/D-08)

The identical capture-and-compare mechanism, re-run with the extension deliberately pointed at a snapshot whose `syncedAtMs` is `1787096055244` (the pinned reference minus two hours) instead of the host's real value:

FRESHNESS-EXT-CONTROL: Last synced 2 hours ago
FRESHNESS-MATCH-CONTROL: DIFFERENT

The mechanism reports DIFFERENT when the underlying instant genuinely differs -- "SAME" above is not indistinguishable from a comparison that never ran.

## Task 3 -- SC2's result, in the sentence fixed before the experiment (D-16)

`ios/evidence/39/02-branch-gate.md` fixed the following sentence, before this plan's own proof ran,
as the ONE this phase is permitted to close on if (and only if) a real credential-provider extension
process was reached and the SHA-256 comparison came back byte-identical -- both conditions this run's
own live evidence above satisfies:

> "The cache was read by a real credential-provider extension process, cold, with the host app
> terminated (`simctl terminate`, absence confirmed by `launchctl list`); the bytes read were
> SHA-256-identical to those the host wrote."

Transcribed here with the observed values filled in: the extension was invoked through
`AutoFillInvocationUITests` (Phase 36, unmodified) toggling the real AutoFill provider switch in
Settings -- the same, only established trigger for a genuine `.appex` launch on this setup, and the
same route Phase 36's own layer (b) election proof (`ios/AUTOFILL-FEASIBILITY.md`) already showed
electable. The host app was terminated by `xcrun simctl terminate`, with its absence confirmed by two
independent `launchctl list` captures (BEFORE: present, AFTER: absent) -- never assumed from the
terminate command alone. The bytes the extension read hashed to
`7c3613ca01736de302c69144eb799f30d6097e9fee7dcd152b1cff489b654264`, SHA-256-identical to the digest
independently computed over the host's own persisted write. The election outcome this sentence
depends on was decided upstream (39-02, `sc2-real`), not chosen by this task.

```
SC2-PROCESS: real-extension
SC2-VERDICT: proven
PROOF-LIMITATION-1: Everything here is a simulator result under a free Apple ID. Entitlement allowlisting, jetsam, data protection and Keychain hardware backing all differ on real hardware.
PROOF-LIMITATION-2: The simulator has no data protection enforcement, so the chosen file-protection class / kSecAttrAccessible value is a declaration, not a demonstrated behaviour.
PROOF-LIMITATION-3: Background timing does not transfer. Even where E-S4 returns Result A, the exact interval after which iOS kills a background socket is device- and power-state-dependent.
PROOF-LIMITATION-4: A cold extension read on the simulator is not a cold read after a device reboot. SYNC-02's own text names device restart as the motivating case, and that case cannot be produced here.
PROOF-LIMITATION-5: Phase 39 does not prove the extension can decrypt. Only that it can read the bytes -- FILL-05 is Phase 41's.
PROOF-LIMITATION-6: The cache is personal-vault only. Any statement that "the vault" is cached is false until Phase 40 extends the schema.
```

