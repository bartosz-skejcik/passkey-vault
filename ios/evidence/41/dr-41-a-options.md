# DR-41-A / DR-41-C — the checkpoint as presented, and the answer given

Written per Plan `41-02` Task 1 (`checkpoint:decision`, gate `blocking`), before any Phase-41 fill
code exists. This file exists so a later reader can see what the decision was made **against**, not
only what it concluded — it is the evidence trail `ios/IOS-SPIKE-LOG.md` §1's DR-41-A/DR-41-C entries
cite by path.

## The evidence that framed the question — E41-1, literal integers

From `ios/evidence/41/e41-1-silent-read.log` (real `os_log` capture, two genuinely distinct
processes — host PID 27630, extension PID 27920):

```
PVFILL|E41-1|stage=seed             status=ok  len=32 digest=00e988677eecf94c0bb9233371c7c0d6f4db8ebdcdecb7c5ebaa666f17249227
PVFILL|E41-1|stage=silent           status=0   len=32 digest=00e988677eecf94c0bb9233371c7c0d6f4db8ebdcdecb7c5ebaa666f17249227
PVFILL|E41-1|stage=nocontext        status=0   len=32 digest=00e988677eecf94c0bb9233371c7c0d6f4db8ebdcdecb7c5ebaa666f17249227
PVFILL|E41-1|stage=negative-control status=-34018
```

Verdict: **PASS-silent** — `LAContext.interactionNotAllowed = true` against the real Phase-37
`.biometryCurrentSet` envelope returned `errSecSuccess` (`status=0`), not `-25308`
(`errSecInteractionNotAllowed`). The negative access-group control fired `-34018`
(`errSecMissingEntitlement`), the one enforcement signal this simulator harness can demonstrate for a
real reason (`ios/evidence/41/branch-state.md` §"What a PASS in this phase can and cannot mean").

**Interpretation constraint, carried forward from `branch-state.md` and Phase 37's own E2 result
(`ios/IOS-SPIKE-LOG.md:1962-1979`):** this simulator's mock AKS releases `.biometryCurrentSet`-gated
data unconditionally, with **no** `LAContext` supplied at all — Phase 37's E2 already proved that
directly. So E41-1's PASS-silent result is **not** evidence that a real device's Secure Enclave would
release the same item without a biometric prompt. It is evidence that the code path that will ask the
question on a real device was exercised correctly. F1's structural argument
(`41-RESEARCH.md` §"The composed fact that decides SC3") — that a `.biometryCurrentSet`-only artifact
makes the QuickType silent branch structurally impossible on a real device, because
`provideCredentialWithoutUserInteraction` forbids UI and an `LAContext` cannot cross the process
boundary — stands un-falsified. It is a statement about API mechanics (an `LAContext` is
process-local; the header prose forbids UI in this method), not about this simulator's ACL
enforcement, so the simulator's non-enforcement does not weaken it.

## The options as presented

| | Option A — biometry every fill | Option B — one non-biometric session artifact |
|---|---|---|
| What the user sees | Face ID sheet on every AutoFill, including QuickType taps | Unlock once in the app; AutoFill then fills with no ceremony until the idle window expires |
| Security posture | ACC-04 unchanged: biometry gates key release, always | For the session window, a second process can read the User Key with **no** biometric challenge |
| ROADMAP SC3 | Cannot pass as written; restated to "exactly one biometric prompt, never a master-password prompt" | Passes as written |
| Reversibility | Reversible | **One-way in practice** — it amends the committed ACC-03 record and defines the milestone's stated security posture; reversing it means reopening Phase 37's design |
| Precedent | — | Structurally what Bitwarden's "biometric unlock bypasses the limit" PSA describes |

Option C — a long-lived pre-authenticated `LAContext` kept alive and shared across the host app and
the extension processes — was **not on the table**. It is impossible: an `LAContext` cannot cross a
process boundary (`37-RESEARCH.md`, OBSERVED). Listed here only so it is rejected in writing and does
not return as a fresh idea in a later phase.

Second, smaller question in the same checkpoint (DR-41-C): may the AutoFill extension refresh the
activity marker? ACC-07 requires it (otherwise an AutoFill-only user is logged out mid-use), but a
process the user never looks at could then extend a session indefinitely with no lock screen ever
appearing. The mitigation on the table was an absolute session ceiling independent of activity.

## The answer given

**DR-41-A = Option B.** A second, non-biometric session artifact in the shared Keychain
(`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, **no** `SecAccessControl`), written by the host app on
successful biometric unlock, deleted by whichever process observes expiry (ACC-06).

**Rationale recorded, not glossed:** the phase's own goal statement (`ROADMAP.md` §"Phase 41", the
`Goal` line) names the Bitwarden "Face ID mówi odblokowane, autofill i tak pyta o hasło główne" class
as the defect this phase exists to avoid. ROADMAP SC3's literal wording — *"odblokowanie w host apce,
potem wywołanie AutoFilla NIE pyta ponownie o hasło"* — is Option B by construction: no rewording of
SC3 that keeps Option A can make that sentence true, because F1's structural argument forbids a silent
read of a `.biometryCurrentSet`-only artifact from a second process. Option A cannot pass SC3 as
written; it can only replace it with a weaker sentence. Option B is chosen so the phase's own stated
goal is met by the artifact, not redefined around its absence.

**Consequence recorded, not glossed:** for the duration of the session window, a second process (the
AutoFill extension) can read the User Key with **no** biometric challenge. This is the exact posture
`ACC-04` was written to prevent — biometry gating key release, always — now scoped to a bounded window
instead of forbidden outright. `ACC-06`'s lazy expiry check and its explicit `SecItemDelete` on expiry
are hereby **load-bearing security controls**, not housekeeping: they are the only thing bounding this
exposure once it exists. Plan `41-07` must prove them **red-first** (a mutation that skips the delete,
shown to fail the guard, before the guard is trusted).

`ACC-04`'s per-release biometric guarantee is **amended for the session artifact only** — the
Phase-37 envelope (Secret A, `.biometryCurrentSet`) keeps its ACL completely unchanged; nothing about
its write path, its accessibility class, or its biometric flag is touched by this decision. This is a
narrower, third artifact alongside Secret A (the biometric UK envelope) and Secret B (the
`ACC-03`-recorded session token, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, no biometric
flag) — named **Secret C** in the committed record to keep the three distinct.

**Option C is rejected in writing**, as stated above: impossible, not merely undesirable. It does not
come back as a fresh idea in a later phase.

**DR-41-C's ceiling question: YES.** An absolute session ceiling exists, independent of AutoFill
activity: **the session ends 12 hours after the last real unlock in the host app** (a successful
biometric or master-password unlock event), regardless of any AutoFill traffic in the interim.
AutoFill-only activity (ACC-07's marker refresh) can extend the *idle* window but can never push the
session past this 12-hour ceiling from the last real unlock. This bounds Secret C's non-biometric
exposure window even under continuous, legitimate AutoFill use — the case Option B's cost statement
names explicitly.

## Decision provenance

**Decided by:** orchestrator, under Bartek's standing full-autonomy brief (`discuss-question-level`
memory: crypto/architecture decisions are Claude's discretion; this is architecture, not a
UX/user-story question).
**Date:** 2026-08-20.
**Overridable:** yes, with full context — recorded as an orchestrator decision, not presented to Bartek
directly, exactly so it remains revisitable rather than treated as his own irreversible call.
