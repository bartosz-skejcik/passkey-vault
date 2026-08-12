# SC4 / SC5 — physical-device run, result

**Date:** 2026-08-13 · **Operator:** Bartek · **Protocol:** `DEVICE-VERIFICATION-PROTOCOL.md`

## Device and build

| | |
|---|---|
| Device | Bartek's iPhone — `iPhone17,3`, **iOS 27.0** (device ID `00008140-00017C512E68401C`) |
| Build | Debug, `arm64`, `LC_BUILD_VERSION platform IOS`, minos 18.0 |
| Signing | Apple Development, team `4S7F2M7YLW`, profile `b2786787-2e59-4fdb-961d-746218881241` |
| Bundle ID | `cloud.blonie.PasskeyVault.devtest` (local instrument variant) |
| Server | `https://vault.blonie.cloud` — the **live production instance**, unmodified |

**Instrument caveats — this build was NOT the shipping configuration.** To sign on a personal team the
app target had the AutoFill Credential Provider entitlement, App Groups, and Keychain Sharing removed,
and the embedded `PasskeyVaultAutoFill.appex` dropped. The hardcoded server URL was repointed from
`http://127.0.0.1:8620` to the hosted instance, because a phone cannot reach loopback and this app has
no user-configurable server setting (Phase 38 owns that). **All three changes were reverted after the
run and never committed.**

Consequence: this run proves the biometric gate **for a single app using the default keychain access
group**. It does NOT exercise the shared `keychain-access-groups` path the AutoFill extension will use.
**Phase 41 needs its own device proof and cannot inherit this one.**

## Results

### CONFIRMED — observed directly in this session

| Step | Result |
|---|---|
| 1 — account creation | ✅ Account created from the app against the live unmodified `pv-server`. Vault unlocked. |
| 2 — biometric unlock | ✅ **Face ID works on real hardware.** |

This settles the **positive half of ACC-04 on hardware**, and does so against production rather than a
throwaway server — SC1 and SC2 held outside the lab.

### THE HEADLINE FINDING — the simulator was lying

Plan 37-05's experiment E2 returned **Result B** on the simulator: with Face ID enrolled and *no
`LAContext` at all*, `SecItemCopyMatching` returned the ACL-protected 32 bytes unconditionally in under
2 ms. Phase 37 therefore recorded OS-level enforcement as *unprovable on that harness* and refused to
claim it.

The device run shows that non-enforcement was a **simulator artifact**, not a defect in the code or the
ACL construction. The `.biometryCurrentSet` design is sound; the simulator simply does not implement
the gate.

**This is why the phase was right not to soften E2 into a pass.** Had a green simulator suite been
accepted as evidence for ACC-04, the code would have looked verified on a harness that cannot verify
it — and the real question would never have been asked.

### ⚠ PENDING CONFIRMATION — do not treat as verified

The operator reported "all of it works" at the end of the session. That is consistent with a full pass,
but the **per-step observations below were not itemised**, and these are precisely the discriminating
ones. Recording them as verified on a summary statement would be the same error this phase spent five
plans avoiding.

| Step | Claim requiring explicit confirmation |
|---|---|
| 3 | **Deliberately failed biometry does NOT release the key.** The negative half of ACC-04. A positive-only result proves the key can be released, never that it is *gated*. Until confirmed, ACC-04 is half-proven. |
| 4 | **Changing the enrolled biometric set invalidates the envelope**, the app falls back with a readable message naming the password route, and biometrics **silently re-arm** after the next successful password unlock. This is all of SC5. |
| 5 | **The password field is focused with the keyboard up** on the invalidation message. `WR-03` — implemented and RED-verified, but its GREEN run has never been observed anywhere, because the test harness has no interactive WindowServer session. |

**Next session: ask the operator to confirm steps 3, 4 and 5 individually before flipping SC4/SC5 to
verified in `37-VERIFICATION.md`.** If step 3 was not actually performed, it must be run — it is the
single most valuable measurement in this protocol.

## Status

- SC1, SC2, SC3 — verified (unchanged).
- SC4 — **positive half verified on hardware**; negative half pending step-3 confirmation.
- SC5 — pending step-4 confirmation.
- `37-VERIFICATION.md` remains `human_needed` until the above are confirmed.
