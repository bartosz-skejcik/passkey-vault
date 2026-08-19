# Phase 41 branch-state — the six upstream questions, collapsed onto committed reality

Written by 41-01, Task 1. Every section below states the question in one line, the verdict, and
either a `file:line` citation into a committed artifact under `ios/` or `crates/` (never
`.planning/`, QA-05) or the token `UNRESOLVED` plus the named blocker. This file is the single
input `scripts/ios-autofill-e41.sh branch-state` validates, and it is the input every later
Phase-41 plan reads before writing a single line of fill code.

## B1 — Phase 36 DR-1: data-sharing model

**Question:** is the data-sharing model between the host app and the extension Keychain-only, or
hybrid (Keychain + App Group)?

**Verdict: RESOLVED — hybrid (Keychain + App Group).**

- Decision record: `ios/IOS-SPIKE-LOG.md:243` (`### DR-1 — Data-sharing model: **hybrid (Keychain +
  App Group)**`).
- Concrete storage locations every later Phase-41 plan uses:
  - The **lock marker** (`unlockedAtMs`, DR-41-C's concern, owned by plan 41-02) lives wherever
    DR-41-C places it inside the hybrid model — either the App Group container or a Keychain item;
    DR-41-C has not run yet (out of this plan's scope), so this row states only that BOTH
    mechanisms are available and proven live, not which one DR-41-C will pick.
  - The **ciphertext cache** lives in the App Group container `group.cloud.blonie.PasskeyVault` —
    `ios/PasskeyVault/PasskeyVault/PasskeyVault.entitlements:15` and
    `ios/PasskeyVault/PasskeyVaultAutoFill/PasskeyVaultAutoFill.entitlements:9` (both declare the
    identical literal, no team-prefix expansion needed for App Group ids), consumed by
    `ios/PasskeyVault/PvShared/CiphertextCacheStore.swift:111` (`AppGroupCiphertextCacheStore
    .groupIdentifier`).
  - The **User Key envelope** lives in the shared Keychain access group
    `$(AppIdentifierPrefix)cloud.blonie.PasskeyVault` —
    `ios/PasskeyVault/PasskeyVault/PasskeyVault.entitlements:24` and
    `ios/PasskeyVault/PasskeyVaultAutoFill/PasskeyVaultAutoFill.entitlements:15` (both declare the
    identical build-variable form).

## B2 — Phase 36 SC1/E4: does the provider register and become electable on the simulator?

**Question:** does the extension register at the credential-provider extension point, become
electable, and appear/toggleable in Settings → Passwords → AutoFill?

**Verdict: RESOLVED — registers + electable + visible in Settings, all three layers PASS in the
CURRENT (restored) build state.**

- Layer (a), registration: `ios/evidence/36/pluginkit-registered.txt` (cited by
  `ios/IOS-SPIKE-LOG.md:2385`), PASS.
- Layer (b), election: `ios/evidence/36/pluginkit-elected.txt` (same citation), PASS.
- Layer (c), Settings visibility: `ios/IOS-SPIKE-LOG.md:2391-2415` — the `ProvidesPasswords`
  bisect. With the capability key **restored** (the current, shipped state —
  `ios/PasskeyVault/PasskeyVaultAutoFill/Info.plist:44`), layer-c's label reads
  `'PasskeyVault, Passwords'` and `AutoFillInvocationUITests.swift:53`
  (`providerSwitchLabel = "PasskeyVault, Passwords"`) PASSes, evidenced by
  `ios/evidence/36/bisect-key-restored-layer-c.png` (`ios/IOS-SPIKE-LOG.md:2410-2412`).
- Every SC in this phase that requires a real AutoFill invocation (SC1 QuickType, SC2 cold fill,
  SC3 no-prompt, SC5 third-party domain) is therefore **runnable**, not degraded per the Branch
  Matrix's B2-FAIL row.

## B3 — Phase 36 DR-2/E6: does Argon2id fit the extension?

**Question:** is the extension permitted to run a KDF at all, or must the host app derive the User
Key and hand it across?

**Verdict: RESOLVED — architectural option (a) recommended: the extension never runs Argon2id.**

- Decision record: `ios/IOS-SPIKE-LOG.md:292` (`### DR-2 — KDF-path architecture: **architectural
  (option a) recommended...**`).
- Measured basis: the ten-run E6 measurement landed the production Argon2id profile
  (`crates/pv-core/src/kdf.rs:23`, 64 MiB/t=3/p=4) at ~85.1–85.3 MB peak `phys_footprint`, but the
  KDF's own cost alone was ~64.06–64.08 MB on every run — at/above the 32 MiB competitor tripwire
  (`ios/IOS-SPIKE-LOG.md:301-308`).
- Consequence for this phase: **this is the branch that makes DR-41-A unavoidable.** The
  extension's only way in is the stored envelope (`pv-ffi`'s `import_user_key_from_session`,
  `crates/pv-ffi/src/lib.rs` — see B5 note below), so whether reading that envelope prompts
  biometry *is* the entire FILL-07 answer. E41-1 (this plan's Task 2) is exactly that read.

## B4 — Phase 37 ACC-03: what exactly is in the Keychain, and can the extension reach it?

**Question:** what is the User Key envelope's `kSecClass`, `kSecAttrAccount`/`kSecAttrService`
value, accessibility class, whether a `SecAccessControl` with `.biometryCurrentSet` is attached,
and the access-group expression?

**Verdict: RESOLVED — one item, `.biometryCurrentSet`, shared access group (Branch Matrix B4 row
1: "SC3 as written cannot pass (F1). Either DR-41-A adds a second artifact, or SC3 is reworded").**

Read directly from Phase 37's actual writer, not its record
(`ios/PasskeyVault/PasskeyVault/Core/Keychain/UkEnvelopeStore.swift`):

- `kSecClass`: `kSecClassGenericPassword` — `UkEnvelopeStore.swift:65`.
- `kSecAttrService` value: `"cloud.blonie.PasskeyVault.uk-envelope"` — `UkEnvelopeStore.swift:36,66`
  (this store keys on `kSecAttrService`, not `kSecAttrAccount`; there is no `kSecAttrAccount` key
  in this item's query at all).
- Accessibility class: `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` —
  `UkEnvelopeStore.swift:44`.
- `SecAccessControl` with `.biometryCurrentSet`: yes, attached **only** through
  `SecAccessControlCreateWithFlags` — `UkEnvelopeStore.swift:46-57` (the flags array literally
  reads `[.biometryCurrentSet]` at line 51), never additionally as a `kSecAttrAccessible` key in
  `SecItemAdd`'s dictionary (confirmed empirically distinct, `errSecParam`/-50 on the collision —
  `ios/IOS-SPIKE-LOG.md:1981-1988`, E4).
- Access-group expression: **not passed explicitly** in `UkEnvelopeStore`'s query dictionaries
  (`UkEnvelopeStore.swift:63-69`, `baseQuery` has no `kSecAttrAccessGroup` key) — the item
  therefore resolves to this bundle's sole declared `keychain-access-groups` entry,
  `$(AppIdentifierPrefix)cloud.blonie.PasskeyVault`, identically declared in both
  `ios/PasskeyVault/PasskeyVault/PasskeyVault.entitlements:24` (host) and
  `ios/PasskeyVault/PasskeyVaultAutoFill/PasskeyVaultAutoFill.entitlements:15` (extension) — the
  Xcode build-variable form, never an expanded literal (landmine L-8).

**E41-1 (Task 2 of this plan) must mirror this exact triple** — `kSecClassGenericPassword` /
`kSecAttrService = "cloud.blonie.PasskeyVault.uk-envelope"` / no explicit access group (rely on
the bundle default, same as `UkEnvelopeStore` itself does) — or the probe measures a different
item and the whole verdict is void.

## B5 — Phase 39 cache: shape, encoding, and what it carries

**Question:** does the Phase-39 ciphertext cache carry both `item_id` and `revision` — the two AAD
inputs `decrypt_item` binds — and what encoding does it use?

**Verdict: RESOLVED — yes, both AAD inputs are present; no blocking finding for 41-03.**

- `decrypt_item(user_key, item: FfiEncryptedItem, item_id: String, revision: u32)` binds `item_id`
  and `revision` as AAD — `crates/pv-ffi/src/lib.rs:552-565` (the current function signature;
  `41-RESEARCH.md` §B5's own `:182-196` citation is stale against this session's `lib.rs`, whose
  line numbers shifted as later phases — 37 through 40 — added code above this function; re-cited
  here against the actual current position, not copied forward unverified).
- The cache's item shape (`ios/PasskeyVault/PvShared/CachedSnapshot.swift:50-63`, `struct Item`)
  carries `id: String` (`CachedSnapshot.swift:51`) and `revision: Int` (`CachedSnapshot.swift:57`)
  as sibling fields alongside the two opaque ciphertext strings `encKey`/`encData`
  (`CachedSnapshot.swift:54,56`) — both AAD inputs are present per record.
- Encoding: the store writes/reads via `JSONEncoder()`/`JSONDecoder()` on the whole `CachedSnapshot`
  struct — `ios/PasskeyVault/PvShared/CiphertextCacheStore.swift:212` (`write`) and `:181`
  (`readCurrentSnapshot`). `encKey`/`encData` are typed `String` (not `Data`), carrying whatever
  string the server's own wire JSON already used — `CachedSnapshot.swift:54,56`'s own doc comments
  state they are "opaque. Never decoded, never re-encoded on this side of the wire/cache boundary
  (D-13, DR-38-C)" — so the Swift-`Data`-defaults-to-base64-vs-`serde_json`-defaults-to-number-array
  hazard F5 names does **not** apply to this specific field: the string is carried verbatim from
  the wire, never round-tripped through a `Data` property on this leg. 41-03/41-06 (whichever plan
  performs the actual decrypt) still owns proving that verbatim carry byte-for-byte, per F5's own
  scoping note (`41-RESEARCH.md` §"The serialization boundary this phase newly owns (F5)": "Phase
  41 owns proving its own leg").
- Storage location: the App Group container, file `vault-cache-v1.json` —
  `CiphertextCacheStore.swift:119` (`AppGroupCiphertextCacheStore.fileName`).

## B6 — Phase 36 E9: which `provideCredentialWithoutUserInteraction` overload does iOS 26.5 call?

**Question:** which of the two `provideCredentialWithoutUserInteraction` overloads (current
`(for: any ASCredentialRequest)` vs. deprecated `(for: ASPasswordCredentialIdentity)`) does the
system actually invoke on this toolchain?

**Verdict: UNRESOLVED — blocker: Phase 36 did not run E9.**

- `41-RESEARCH.md` §B6 records E9 as "marked optional there" (in Phase 36) and states "If E9 was
  not run in Phase 36, Phase 41 must run it."
- A full-text search of `ios/IOS-SPIKE-LOG.md` for `E9` / `E-9` returns zero matches — confirmed
  this session (`grep -n 'E9\b\|E-9\b' ios/IOS-SPIKE-LOG.md`, no output). Phase 36's own status
  table (`ios/IOS-SPIKE-LOG.md:22`) and closing-gates section
  (`ios/IOS-SPIKE-LOG.md:2182-2225`) list SC1/SC4/SC5 and the E1-E8 family but never E9.
- **Named blocker:** E9 has not been run by any prior phase. Per `41-RESEARCH.md` §"Experiment
  Plans", E41-5 (owned by plan 41-03, per this phase's own source-coverage audit,
  `41-01-PLAN.md`'s table row "RESEARCH | E41-1..E41-9 | 41-01 (E41-1), ... 41-03 (E41-5), ...")
  is the plan that runs it. This row stays UNRESOLVED until 41-03 Task 2 records E41-5's result and
  amends this file.

## What a PASS in this phase can and cannot mean

**Phase 37 did NOT settle that the iOS 26.5 simulator enforces a Keychain ACL — it settled the
opposite.** `ios/IOS-SPIKE-LOG.md:1962-1979` (Plan 37-05, Task 1, "E2 — does this simulator enforce
the ACL?") recorded **Result B**: `SecItemCopyMatching` against a freshly-stored ACC-03 envelope
(`.biometryCurrentSet`, Face ID genuinely Enrolled this session) **with NO `LAContext` supplied at
all** returned `errSecSuccess` and the correct bytes, in under 2ms, with no system sheet and no
block. The plan's own mandated wording, quoted verbatim: *"the OS gate was configured correctly and
the code path was exercised; enforcement was NOT observed, because the simulator returns
ACL-protected data unconditionally."*

Therefore, in these words, as `41-RESEARCH.md`'s own Pitfall 5 requires: **every biometric result in
Phase 41 — including E41-1's own silent-read verdict below — is a statement about our code's
intent (does it correctly ask the OS with `LAContext.interactionNotAllowed = true` before reading?),
not about the OS's behaviour (would a real device's Secure Enclave actually gate the read?).** A
PASS-silent verdict on this harness does not mean "silent QuickType fill works on a real iPhone." It
means "the code that will ask the question on a real iPhone was exercised correctly, and this
simulator's own mock AKS happens to answer every question with a release regardless of what was
asked." MP-1 item 1 (`ios/IOS-SPIKE-LOG.md:2001-2003`) applies at full force. The one enforcement
mechanism this harness DOES demonstrate faithfully is keychain-access-group scoping (Phase 36's E3,
`ios/IOS-SPIKE-LOG.md:266-270`: the wrong-access-group negative control fires with
`errSecMissingEntitlement`/-34018) — which is why E41-1's mandatory negative control below is scoped
to access-group, not to biometry: it is the one control on this harness capable of failing for a
real reason.



## E41-1 result

**Verdict: PASS-silent** (silent status=0, nocontext status=0, negative-control status=-34018).

Host-written digest (`00e988677eecf94c0bb9233371c7c0d6f4db8ebdcdecb7c5ebaa666f17249227`) and extension-read digest (`00e988677eecf94c0bb9233371c7c0d6f4db8ebdcdecb7c5ebaa666f17249227`) are byte-for-byte equal -- receiver-side, digest-based, never a non-nil/length-only check (QA-03).

Per this file's own closing section ("What a PASS in this phase can and cannot mean"): this verdict is a statement about our code's intent (did it correctly ask the OS before reading?), not about the OS's behaviour on a real device -- Phase 37's own E2 result (`ios/IOS-SPIKE-LOG.md:1962-1979`) already established this simulator releases ACL-protected data unconditionally, independent of any `LAContext`.

Raw evidence: `ios/evidence/41/e41-1-silent-read.log`.
