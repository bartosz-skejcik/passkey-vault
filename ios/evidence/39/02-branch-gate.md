# Phase 39, Plan 39-02 -- branch gate evidence

Confirmation-of-reading, not a free choice (D-16): this document quotes the committed upstream
records the checkpoint was decided against, verbatim, before recording the decision itself.

## Task 1 -- the DR-1 record, quoted verbatim from `ios/IOS-SPIKE-LOG.md` §1

> ### DR-1 — Data-sharing model: **hybrid (Keychain + App Group)**
>
> **Decision: hybrid.** Both the shared keychain access group (`$(AppIdentifierPrefix)cloud.blonie.
> PasskeyVault`) and the App Group container (`group.cloud.blonie.PasskeyVault`) are load-bearing —
> Keychain for the User Key envelope (small, security-critical), App Group for the ciphertext cache
> Phase 39 will write (larger, file-based).
>
> **Rejected: Keychain-only (MP-2 fallback).** Rejected on its merits, not by omission: Keychain-only
> was the fallback the pitfalls research (L-5) recommended defensively, on the unconfirmed premise
> that App Groups might be refused on a free personal team. Phase 36, Plan 36-02's E2 disproves that
> premise on this simulator (see below) — the App Group container resolves, identically, for both the
> host app (outside, via `simctl`) and the extension (inside, via `FileManager`, from the real running
> process).

**Consequences named for Phase 39, quoted from the same record:**

> **Phase 39** (sync + offline cache): the ciphertext cache the host app writes for a cold-launched
> extension to read lives in the App Group container (`group.cloud.blonie.PasskeyVault`), not
> Keychain. SYNC-03's ciphertext-only constraint is Phase 39's to enforce; this plan wrote only a
> fixed labelled test vector into both storage mechanisms, never real vault data.

**Corroboration read this session -- §3b's 2026-08-17 correction, `ios/IOS-SPIKE-LOG.md` lines
2869-2926, quoted verbatim:**

> **App Groups WAS granted on the free team.** The claim that it was refused is withdrawn. Only the
> AutoFill entitlement is missing from every issued profile, so that is the one the membership buys.
> This also settles §4 q.4 ("App Groups are unavailable on a free Apple ID, unexplored"), which is
> **wrong** and is retired here.

This corroborates DR-1 from an independent angle (the actual hardware provisioning profiles Apple
issued to this free team), rather than merely re-stating DR-1's own simulator-side finding. It does
not change DR-1's decision -- DR-1 was already decided on the simulator-side E2/E3 evidence -- it
closes the one open worry DR-1's own residual-risk paragraph named ("this decision does not
extrapolate automatically to hardware... the device slice has never been run") for the App Group
capability specifically. The AutoFill entitlement itself (a separate capability from App Groups) is
still refused on the free team and remains a live business gate (§3b), unrelated to which storage
branch Phase 39 executes under.

### Branch decision

DR-1 is unambiguously committed and names exactly one branch. Per this plan's own options:

- Branch H (App Group container exists, DR-1 chose the hybrid) is the sole record that matches the
  quoted text above. Branch K (Keychain-only) and the halt option are both contradicted by the
  committed record.

```
BRANCH: branch-h
```

## Task 1 -- the SC2 election outcome, quoted verbatim from `ios/AUTOFILL-FEASIBILITY.md` "SC1 layers
(a) registration, (b) election, (c) Settings visibility"

> ### Layer (b) — user election
>
> **Result: PASS.** The re-queried listing shows the `+` marker against
> `cloud.blonie.PasskeyVault.AutoFill(1.0)` — the extension is electable as a provider on this
> simulator.

And from the same file's "SC1 — the three layers, together" table:

> | (b) election | **PASS** | `ios/evidence/36/pluginkit-elected.txt`, falsified and restored in
> `layer-b-falsification.log` | The extension is electable as a provider via `pluginkit`. |

The extension was recorded electable on this setup (Branch E-yes, per `39-RESEARCH.md`'s Gate 2).
This is the "election outcome" the resume-signal asks for; the resolution below follows from it, not
from inference.

**Resolution: `sc2-real`.**

## Task 2 -- Branch K ceiling measurement: not applicable

Per this plan's own precondition, Task 2's measurement runs only under `branch-k`. DR-1 (quoted
above) chose the hybrid, i.e. `branch-h`. This is a recorded non-result, not silence:

Not applicable. DR-1 committed the hybrid model (Keychain + App Group), so Phase 39's ciphertext
cache is written to the App Group container, not to a Keychain generic-password item. The
shared-Keychain blob ceiling that `E-C4`/Task 2 exists to measure is a question only Branch K's design
depends on; Branch H's cache size posture is "unbounded in practice" per the Branch Matrix
(`39-RESEARCH.md` §"Branch Matrix", Branch H row "Size posture"), and no `SecItemAdd` call is ever
made for the cache. `scripts/keychain-blob-ceiling.swift` was still authored per the plan's
`files_modified` list, so a future Branch K reconsideration (should one ever occur) has a ready
harness -- but it is not run in this plan's execution.

```
BRANCH: branch-h
CEILING: NOT-APPLICABLE
```

### Simulator-versus-hardware honesty note, quoted verbatim from `39-RESEARCH.md`

The note that applies to Branch H's own at-rest claim, from `39-RESEARCH.md` §"Proof limitations to
record (MP-1 style, verbatim into the phase log)":

> 1. **Everything here is a simulator result under a free Apple ID.** Entitlement allowlisting,
>    jetsam, data protection and Keychain hardware backing all differ on real hardware.
> 2. **The simulator has no data protection enforcement** `[INFER]`, so the chosen file-protection
>    class / `kSecAttrAccessible` value is a *declaration*, not a demonstrated behaviour. Say so.

The Branch K-specific form of the same note (quoted for completeness, since it is the wording Task 2
would have appended had the branch been K), from `39-RESEARCH.md` §E-C4:

> **Honesty note to carry:** the simulator's keychain is a plain file-backed store with no SEP; a size
> limit observed (or not observed) here does not transfer to hardware.

Under Branch H the equivalent honest limitation is the file-protection-class declaration above: this
plan's DR-39-A/B records describe where the snapshot lives and how its freshness timestamp is
carried, but the `.completeUntilFirstUserAuthentication`-class write-time flag those decisions specify
is, on this simulator, an unenforced declaration rather than a demonstrated behaviour -- exactly the
posture DR-1's own residual-risk paragraph already disclosed for the App Group capability generally.

## Task 3 -- SC2 wording fixed in advance of the proof

Per the election outcome above (`sc2-real`), the sentence this phase is permitted to write about SC2
is the Branch E-yes variant, copied verbatim from `39-RESEARCH.md` §"Wording the phase record must
use" → "SC2's result, per branch", **fixed here, before the cold-read proof (39-07) is attempted**:

> "The cache was read by a real credential-provider extension process, cold, with the host app
> terminated (`simctl terminate`, absence confirmed by `launchctl list`); the bytes read were
> SHA-256-identical to those the host wrote."

This is the Branch E-yes sentence, not the Branch E-no ("proxy") sentence -- the proxy variant, and
its accompanying "SC2 is recorded as partially unproven on the simulator" qualifier, do not apply,
because the election outcome quoted above is PASS, not a failure to elect. 39-07 (the plan that
actually runs E-C3) must reproduce this exact sentence, word for word, if and only if its own run
also confirms the host is terminated and the SHA-256 comparison is byte-identical; it is not free to
loosen or strengthen the wording after the fact (D-16).
