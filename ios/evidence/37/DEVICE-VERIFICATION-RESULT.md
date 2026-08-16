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

### CONFIRMED — steps 3, 4, 5, itemised (2026-08-16, follow-up session)

The 2026-08-13 01:22 run recorded these three as PENDING, because the operator's closing "all of it
works" was a *summary statement* and these are precisely the discriminating observations. This section
was written to force the next session to ask for them individually rather than infer them.

They were asked individually on **2026-08-16** and confirmed individually:

| Step | Claim | Operator answer |
|---|---|---|
| 3 | **Deliberately failed biometry does NOT release the key** — the negative half of ACC-04 | ✅ Non-matching biometry presented; vault did **not** unlock, no key released |
| 4 | **Biometric-set change invalidates the envelope**, app falls back with a readable message naming the password route, and biometrics **silently re-arm** after the next successful password unlock — all of SC5 | ✅ Invalidated, fell back, re-armed |
| 5 | **Password field focused with the keyboard up** on the invalidation message — `WR-03`, whose GREEN run had never been observed anywhere | ✅ Focused, keyboard up |

Step 3 is the one that matters most: with it, ACC-04 is proven in **both** directions on hardware — the
key is released to a matching biometric and withheld from a non-matching one. Before it, the run proved
only that the key *can* be released, never that it is *gated*.

Step 5 is the first and only GREEN observation of `WR-03` anywhere. The automated harness cannot produce
one — it has no interactive WindowServer session, so the fix was RED-verified only (failure case tested,
passing case never seen).

**Evidence class — read this before citing the section above.** These three are **operator attestation**,
not captured artifacts: there is no screenshot, log, or exit code behind them, and unlike steps 1–2 they
were reported from memory of the session rather than observed live by the tooling. That is a genuinely
weaker evidence class than the rest of this document, and it is recorded as such deliberately. It is
accepted here because the alternative — flipping SC4/SC5 on the unitemised "all of it works" — is
strictly weaker still, and because the discriminating negative case (step 3) was named explicitly and
answered explicitly rather than being folded into a general yes.

## Status

- SC1, SC2, SC3 — verified (unchanged).
- SC4 — **verified on hardware, both directions.** Positive half observed live (steps 1–2); negative
  half by itemised operator attestation (step 3).
- SC5 — **verified** by itemised operator attestation (step 4).
- WR-03 — **GREEN observed** (step 5), by operator attestation.
- `37-VERIFICATION.md` → `passed`.

**Still not inherited by later phases.** This run used a stripped build (no AutoFill entitlement, no App
Groups, no Keychain Sharing, appex dropped) so it proves the gate for a **single app on the default
keychain access group only**. Phase 41 must produce its own device proof for the shared
`keychain-access-groups` path.

**Residual non-blocking a11y items** (never part of the device protocol, carried forward — see
`37-VERIFICATION.md` `residual_items`): the Dynamic Type matrix ran at 390pt instead of the specified
375pt; the AX5 forgot-password alert scroll was never driven (`screens/lock-forgot-light-a11y.png` shows
the body cut mid-sentence at "...No one, including"); three `AuthView` register cells are uncaptured.
