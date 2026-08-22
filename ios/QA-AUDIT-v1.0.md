# QA-AUDIT v1.0 — Phase 42 retrospective register (QA-01/QA-02/QA-03)

**Owner:** Phase 42 (`Standard dowodu — bramka QA i CI dla iOS`), built by plan 42-05, filled by
42-06 (phases 35–38) and 42-07 (phases 39–41), which also resolves the 13 pre-seeded hazards below
and delivers the closing verdict.

**Audit-script baseline:** `25d3a1cda079095c765c0184d23cf02701f4937f` — the commit that last touched
`scripts/qa-audit-inventory.sh`, `scripts/check-qa-audit-register.sh`, and `scripts/check-ios-gate.sh`,
captured via `git log -1 --format=%H -- scripts/check-ios-gate.sh scripts/check-qa-audit-register.sh
scripts/qa-audit-inventory.sh` after all three were committed. **42-07 must diff the three scripts
against this exact sha** (`git diff 25d3a1cda079095c765c0184d23cf02701f4937f -- <the three scripts>`,
expected empty) as its own proof that the gate went green by evidence, not by editing the gate — 42-07
is forbidden to touch these three scripts at all. A bare `git diff` (no reference point) compares the
working tree against the index and is empty either way, which is why a pinned sha is required here
rather than a live `git merge-base`/`HEAD` recomputation.

## Why this file lives under `ios/`, not `.planning/`

This worktree never commits `.planning/` (`commit_docs: false`, QA-05, `scripts/check-ios-gate.sh`'s
own `gate_qa05`). `ios/IOS-SPIKE-LOG.md` already declares itself this worktree's durable knowledge
sink for exactly that reason — "anything learned there dies with it. This file is where knowledge is
kept instead." An audit register recorded only in `.planning/` would be an audit that does not exist
for anyone who reads the committed tree; it would die with the worktree the moment this branch is
cleaned up or archived. So: this register lives under `ios/`, is committed, and every row's evidence
is quoted **inline** — never only cited — so the register is self-contained for a reader who has this
committed tree and nothing else (no `.planning/` access required to make sense of any row). This is
QA-05 producing a design constraint on QA-01/QA-02/QA-03's own deliverable.

---

## Decision records

### Numbering note

`DR-42-A` is **already taken** — `ios/IOS-SPIKE-LOG.md` §1k (2026-08-20) records it as the decision to
cache the account's `pw_wrapped_uk` (+ `salt`/`kdf`) locally in the Keychain for offline password
unlock (the cold-launch/offline-unlock fix). That decision has nothing to do with this register. Per
this plan's own instruction to check for collisions before writing (and per the precedent this repo
already set for L-12/L-15/L-33/L-39, each renumbered forward past a taken slot with a note rather than
silently overwriting the meaning of an existing ID — two records sharing one ID breaks every future
cross-reference by that number), the decision this plan's `42-05-PLAN.md` calls "DR-42-A" ("the audit
records; it does not repair") is recorded here as **DR-42-C**, the next free `DR-42-*` letter, instead.
`DR-42-B` (below) is unaffected — no other document uses that ID for a different meaning; both
`42-RESEARCH.md` and `42-06-PLAN.md` already reference it as exactly this register's SC2 decision, so
it keeps its letter.

One further note found while checking for collisions: `42-03-SUMMARY.md` (quoted in
`ios/IOS-SPIKE-LOG.md` around the WR-10 record) already refers to "DR-42-A: this phase's audit finds
and records, it does not repair" — i.e. it made the same collision this numbering note now corrects,
one plan earlier. That reference is left as-is in that already-committed record (not rewritten here);
readers following it should understand it to mean **DR-42-C** below.

### DR-42-C — the audit records; it does not repair

Every ROADMAP success criterion for this phase is audit-shaped: a review confirms, a proof is
documented, a script returns a non-zero exit, a grep confirms. None says the defects are fixed. An
autonomous pass that both audits and repairs blurs the two and produces an audit whose findings were
silently repaired mid-pass — unauditable afterwards, and indistinguishable from an audit that found
nothing. So: findings land in this register with `file:line`, severity and disposition; repairs are
separate, individually-committed work.

**The one exception, stated so it is not a loophole:** defects in the artifacts **this phase itself
authors** (`scripts/qa-audit-inventory.sh`, `scripts/check-qa-audit-register.sh`, the `gate_qa_register`
composition, this file's own mechanics) are fixed inline, because a broken new gate is not a finding,
it is unfinished work.

**Rejected alternative:** audit-and-fix in one pass. Rejected because the register's "found" state is
the deliverable and repairing it in place destroys it — a reader could never tell whether a clean
register reflects a genuinely clean phase or a phase whose defects were quietly patched before anyone
else saw the finding.

### DR-42-B — SC2 is a prose-plus-`file:line` register with a structural coverage gate, never a heading grep

The research measured the alternative and it does not survive contact: the five Phase 35 SUMMARY
headings spell the red/green section four different ways —
`Verify Gate — demonstrated failing before, passing after (QA-02)`,
`` `vtool` Gate — real transcripts, both directions (QA-02/QA-04) ``,
`QA-02 Red/Green Proofs -- Real Transcripts` (×2), and **`Real Transcripts`** (35-04 — no `QA-02` token
in the heading at all). A heading-keyed grep returns a false FAIL on `35-04`; a body-keyed grep for the
token `QA-02` matches all five, but also matches a SUMMARY that merely *mentions* `QA-02` without
carrying a real transcript — so it can pass vacuously. Neither is a gate. Normalizing the headings so
the grep passes is worse still — the checker would be rewriting its own subject, which is precisely the
defect family (T-42-22) this phase exists to police.

**What is mechanizable, and is what `scripts/check-qa-audit-register.sh` builds:** coverage and
resolvability. The gate asserts that every phase with SUMMARY files inside the audited range has a
register section carrying at least one row, that every row's `ref` resolves to a real `file:line`, and
that every row carries a non-empty quoted excerpt. Whether the excerpt is genuine evidence is a
reader's judgement, recorded as prose with a citation — and that judgement is the SC1/SC2 deliverable
itself, not something a script can render a verdict on.

**Rejected alternatives:**
- (a) accept prose only, with no mechanical check at all. Rejected — nothing would catch a phase
  silently omitted from the register (the exact silent-narrowing failure T-42-21/T-42-25 exist to
  police).
- (b) land a heading convention early and reorder the ROADMAP so 36–41 adopt it before this phase runs.
  Rejected — this phase runs last by design (it audits 35–41), and reordering it to make its own gate
  convenient is the tail wagging the dog.

The heading convention is instead recorded below as a **recommendation for v1.1+**, explicitly **not**
used as this phase's gate.

---

## Proof-standard restatement (self-contained, no `.planning/` access required)

This register judges every claim against this project's own inherited, non-negotiable proof standard:

- **QA-01** — no claim touching crypto, raw bytes, real time, or a real server rests on a green unit
  test alone. A green `XCTest`/`cargo test` that mocks the crypto layer is not evidence for a crypto
  claim; the claim needs a real-FFI call, a live server round trip, a real-bytes decode, or a live
  simulator run.
- **QA-02** — every new guard is shown **red** before it is believed, by mutating production code, not
  merely by the test existing.
- **QA-03** — assertions are **positive on the receiver side** ("it is there and it is correct"), never
  only "something is absent".
- **QA-04** — every verification command must be able to fail; that failure is demonstrated and
  recorded, not assumed.
- **QA-05** — `.planning/` is never committed from this worktree.

## Recommendation for v1.1+ (NOT this phase's gate)

A standard `## QA-02 Red/Green Proof` heading, spelled identically, in every phase's SUMMARY.md files
would make a future version of SC2 mechanizable as a heading grep. This phase does **not** adopt or
enforce that convention (see DR-42-B's rejected alternative (b) — reordering the ROADMAP to land it
early is the tail wagging the dog). It is recorded here only as a note for whoever plans v1.1.

---

## Audit scope — which artifacts the review reads

ROADMAP SC1 asks for *"Przeglad wszystkich planow faz 35-41"* — a review of **plans**. The audit this
register backs (42-06/42-07) reads **SUMMARYs first**, and opens a `*-PLAN.md` directly only where a
SUMMARY's claim cannot be traced to real evidence, **or** where `scripts/qa-audit-inventory.sh` itself
flags that plan `UNSUMMARIZED` (a `*-PLAN.md` with no correspondingly-numbered `*-SUMMARY.md` — the
hook that closes the SC1 scoping hole: a claim made only in a plan and never carried into a SUMMARY
would otherwise be invisible to a SUMMARY-first audit).

**Rejected alternative:** re-verify every phase's success criteria from scratch, independent of what
each phase's own SUMMARY/VERIFICATION already claims. Rejected on cost, not on difficulty — Phase 35
alone already has an independent `35-VERIFICATION.md` (score 9/9, an independent re-execution with
adversarial mutation) on top of its own SUMMARYs; re-deriving that work from zero for six more phases
is not what this phase's time budget affords, and it is not what QA-01/QA-02/QA-03 ask for — they ask
for evidence-quality review, not re-verification.

**The audited range is the literal phases 35 through 41**, taken verbatim from `.planning/ROADMAP.md`'s
own Phase 42 success criteria:

> SC1: "Przeglad wszystkich planow faz 35-41 potwierdza, per faza z konkretnym file:line dowodu: kazde
> twierdzenie dotykajace krypto/realnych bajtow/realnego czasu/realnego serwera ma dowod real-FFI lub
> live-run, nie tylko zielony `XCTest` mockujacy warstwe (QA-01)."
>
> SC2: "Co najmniej jeden guard z kazdej fazy 35-41 dotyczacej bezpieczenstwa (panic-catch FFI,
> `.biometryCurrentSet`, ciphertext-only cache) ma udokumentowany dowod 'czerwony przed zielonym' przez
> mutacje kodu produkcyjnego -- nie tylko istnienie testu (QA-02)."

Two phases are deliberately **outside** this range, each for a different, named reason:

- **Phase 42 is out of coverage by construction.** It is the phase *performing* this audit; its own
  SUMMARYs (including this plan's own `42-05-SUMMARY.md`) materialise on disk while this phase is still
  executing, so a coverage gate demanding a register section for Phase 42's own work could never pass —
  the register would be auditing its own in-flight work. This exclusion is a stated scope boundary here
  and in `scripts/check-qa-audit-register.sh`'s own header comment, fixed in **this plan (42-05)**,
  before the `Audit-script baseline` sha below is pinned — never an ad-hoc edit made later to turn a red
  gate green (42-07 is forbidden to edit these three scripts at all).
- **Phase 43 is conditional in the ROADMAP's own words**: *"Ta faza ma pelne prawo zakonczyc sie 'nie
  zrobione' i to nie jest porazka milestone'u"* ("this phase has the full right to end 'not done', and
  that is not a failure of the milestone"). An absent Phase 43 (no SUMMARY files at all, as is the case
  today — `scripts/qa-audit-inventory.sh` reports `summaries=0`) is therefore a **VALID** state, never a
  gap to be flagged the way an absent Phase 36–41 section would be.

That asymmetry — Phase 43's absence is valid, Phase 36–41's absence (or an empty section) is a FAIL —
is encoded explicitly in `scripts/check-qa-audit-register.sh`, not merely assumed.

---

## Row schema

One table per phase, with these columns:

| Column | Meaning |
|---|---|
| `claim / guard` | The claim or guard artifact being audited, in the auditor's own words |
| `requirement` | The requirement ID (e.g. `FFI-02`, `FILL-06`, `QA-01`) the claim/guard maps to |
| `evidence tier` | One of: `real-FFI`, `live-run`, `real-bytes`, `live-simulator`, `unit-test-only` |
| `ref` | A resolvable `file:line` (or `file:line-line` range) |
| `excerpt` | A short quoted line of the REAL transcript, assertion, or code — never paraphrased |
| `severity` | `critical` / `warning` / `info` / `n/a` (backstop/status items) |
| `disposition` | One of: `verified`, `gap`, `open-finding`, `dissolved`, `abstained` |

**A row whose evidence cannot be quoted inline is not a row — it is a gap.** `scripts/check-qa-audit-
register.sh` enforces this mechanically: every row's `ref` must resolve to a real file and a line
number within that file's length, and every row's `excerpt` must be non-empty.

---

## Pre-seeded known-hazard checklist (13 items — resolve, do not rediscover)

These are already-recorded facts as of this plan (none of them speculation), seeded here so 42-06/
42-07 resolve them item by item rather than rediscovering them from zero. **Each item's disposition is
left `open` by this plan, per DR-42-C — 42-06/42-07 resolve them, this plan does not.**

| # | Hazard | Owner phase | Disposition |
|---|---|---|---|
| H-01 | The wrapped-key wire encoding: `WrappedKey` has no serde attributes, so its byte-array field serializes as a number array from the Rust side and as base64 from a default Swift encoder, and nothing validates it — the server stores the field as opaque text and the register endpoint never parses or length-checks it, so it returns success on either encoding. The failure surfaces later, in a different client, as an undecryptable row (treated as a tampering signal by this codebase). Only a two-direction cross-client test catches it; no unit suite on either side can. | not yet determined — owner is "the first phase that writes such a row"; 42-06/42-07 must name the phase or record its absence as a blocker | **resolved — 42-07.** See the dedicated "Wire-encoding hazard (H-01)" subsection immediately below the closing verdict's own hazard-resolution narrative for the full account: Phase 37 first wrote a `WrappedKey`-shaped row from the iOS client (`pw_wrapped_uk`) and proved it two-direction cross-client; Phase 40 independently re-derived and closed the same hazard shape for the family-sharing surface (DR-40-A + E-W2, both directions, on real server rows). |
| H-02 | The FFI panic-probe feature (`ffi06-probe`) must default to an empty feature set the moment a second build path exists; the accepted rationale was explicitly time-bound to Phase 35 being the only consumer. `crates/pv-ffi/Cargo.toml` already shows `default = []` (flipped Phase 36, Plan 36-01) — but `scripts/build-ios.sh`'s Run Script phase invocation still defaults to `--with-panic-probe` for the `PasskeyVault` APP target itself (moved there from the test bundle in Phase 37, Plan 37-02), so the synthetic panic probe still ships inside `PasskeyVault.app` today. Check whether a later phase (38–41) linked the AutoFill extension target without flipping this. | 36 (flip), 37 (moved to app target), 38–41 (must check extension-target linkage) | **still open — confirmed through Phase 41, this plan's own re-check.** `crates/pv-ffi/Cargo.toml:44-47` (updated by Phase 40, Plan 40-04, Task 3, the most recent commentary on this hazard) states it explicitly: `PasskeyVaultAutoFill.appex` links the SAME shared XCFramework artifact but has **no Run Script phase of its own** — it inherits the probe whenever the app-owned phase last built in `Debug` (narrowed from "every configuration" to "every Debug build" by a Phase 39, Plan 39-07 fix, per the same comment) — and names **"Phase 41 (per-target production/test build split) is the named owner of closing this for real."** This plan's own live re-check (`grep -rn 'build-ios.sh' ios/PasskeyVault/PasskeyVault.xcodeproj/project.pbxproj`) confirms exactly ONE Run Script `shellScript` block invoking `build-ios.sh` in the whole project file, and a repo-wide grep of all eight `41-0N-SUMMARY.md` files for `panic-probe`/`per-target`/`ffi06-probe` finds zero on-topic hits — Phase 41 never touched this. **Disposition unchanged from 42-06's own honest narrowing: still open, correctly, owner is the never-executed "per-target build split," which no phase 35–41 implemented.** Practically bounded by L-14 (this register's own closing verdict): Release cannot currently be built at all, so every build this milestone ships today is Debug, and the probe ships in all of them. |
| H-03 | The slice gate's device half had never been demonstrated able to fail; only the simulator half had (35-REVIEW.md WR-10). `scripts/build-ios.sh` now calls `falsify_slice` for BOTH `ios-arm64` (device) and `ios-arm64-simulator` — check whether this was closed inside Phase 42 itself (42-01/42-03/42-04) or in an earlier phase, and record the closing evidence. | 35 (artifact); closing phase to be named by 42-06/42-07 | **resolved — 42-06.** Closed inside Phase 35 itself: the Phase 35 specimen table's own WR-10 row (`scripts/build-ios.sh:337-338`, disposition `verified`) is the closing evidence, dated to Phase 35's own commits, not a later phase. Phases 36–38 reuse `scripts/build-ios.sh` unmodified in every `xcodebuild build`/`--verify-falsifiable` invocation across 21 plans without ever regressing this fix — confirmed by the Phase 36/38 QA-02 tables' own "inherited" cross-reference rows (`gate_ffi_build`/`gate_ffi_falsifiable` in `scripts/check-ios-gate.sh` invoke this script automatically on every gate run). |
| H-04 | The opaque-handle audit (`scripts/audit-ffi-opaque-handles.sh`) is wired into no automated CI lane and has no freshness check of its own; the composition-layer freshness assertion added in 42-03 (`gate_ffi_opaque` in `scripts/check-ios-gate.sh`) closes the RUN-ORDER hole but not the script's OWN staleness detection, and `.github/workflows/ci.yml` still does not invoke it. | 35 (script itself); 42 (composition layer, partial) | **still open — confirmed by this plan's own live re-check.** `grep -n 'audit-ffi-opaque-handles\|check-ios-gate' .github/workflows/ci.yml` returns zero matches (`.github/workflows/ci.yml`, checked directly, 2026-08-21) — neither the opaque-handle script NOR the composed `scripts/check-ios-gate.sh` itself is invoked anywhere in the CI workflow file. This is the concrete instance of the ROADMAP's own proof-limit paragraph ("a static audit plus runnable scripts on the simulator/local machine does not replace a real CI runner"): the gate this milestone built is a **local composer script**, not a wired CI gate. No phase 39–41 touched `.github/workflows/ci.yml` to add this wiring (Phase 41 DID add its own two AutoFill-specific gates to `ci.yml` — `scripts/audit-ios-autofill-deprecated-apis.sh`/`scripts/audit-ios-identity-store-chokepoint.sh`, `.github/workflows/ci.yml:41-42` — proving the wiring mechanism exists and is cheap; it was simply never extended to the opaque-handle audit or the composer). Owner remains named, unclaimed: a future phase (or a direct CI-wiring task, out of THIS plan's `files_modified`, which is `ios/QA-AUDIT-v1.0.md`/`ios/IOS-SPIKE-LOG.md` only) must add it. |
| H-05 | The Rust-side deployment target: `35-REVIEW.md` WR-02 found `IPHONEOS_DEPLOYMENT_TARGET` was never set. `scripts/build-ios.sh` now sets it explicitly (`export IPHONEOS_DEPLOYMENT_TARGET=18.0`) — confirm this matches `project.pbxproj`'s own floor and that the device-slice assertion was updated in lockstep (WR-02 warned a correct fix would flip the device load command and break the old assertion). | 35 | **resolved — 42-06.** Closed inside Phase 35 (Phase 35 specimen table's WR-02 row, `scripts/build-ios.sh:374`, disposition `verified`). No commit under `.planning/phases/3[6-8]-*/` touches `IPHONEOS_DEPLOYMENT_TARGET`, and every Phase 36/37/38 build invocation runs against the same unmodified `build-ios.sh` — no lockstep drift observed in the 35–38 range. |
| H-06 | The slice gate used to inspect whichever object the filesystem yielded first, which in practice was a compiler-support object rather than any of this crate's own (35-REVIEW.md WR-03). `scripts/build-ios.sh` now selects `pv_ffi*.o` specifically — confirm this closes WR-03 and that the falsification (an archive with zero `pv_ffi*.o` objects) has been demonstrated. | 35 | **resolved — 42-06.** Closed inside Phase 35 (specimen table's WR-03 row, `scripts/build-ios.sh:222`, disposition `verified`). Confirmed unmodified and reused (not regressed) through the 35–38 range — cross-referenced in the Phase 38 QA-02 table above. |
| H-07 | Server-supplied KDF parameters are deserialized and used with no bounds check, so a hostile value is an allocation failure, which aborts rather than unwinds and therefore cannot be caught by `catch_unwind` (35-REVIEW.md WR-11). `crates/pv-ffi/src/lib.rs` now has tests named `from_password_rejects_over_ceiling_m_cost_end_to_end` and `from_password_rejects_argon2s_own_max_m_cost` — confirm the bounds check is real (not merely tested) and quote it. | 35 | **resolved — 42-07.** The bounds check is real, not merely tested: `fn validate_kdf_params(params: &KdfParams)` at `crates/pv-ffi/src/lib.rs:307` rejects `m_cost_kib > MAX_M_COST_KIB`, `t_cost > MAX_T_COST`, `p_cost > MAX_P_COST`, each returning `FfiError::InvalidInput` before any Argon2id allocation is attempted — read directly from source this session, not inferred from the test names. Independently corroborated by Phase 37's own re-verification (Phase 37 QA-01 table, "WR-11's untrusted-`KdfParams` guard" row, this register): falsified live by raising `MAX_M_COST_KIB` above 4,000,000, observing the panic, then reverting. |
| H-08 | The residual-risk disclosure (`crates/pv-ffi/src/lib.rs`'s CP-4 header) understates the un-zeroized copies that exist on the Rust side: the UniFFI `RustBuffer` marshalling intermediates, and the plaintext-carrying `String` types on the `encrypt_item`/`decrypt_item` pair. The current header (lines 24-40) still only discloses the SWIFT-side residual; a grep for `RustBuffer` across `crates/pv-ffi/src/lib.rs` returns zero hits. This gap looks STILL OPEN as of this plan — 42-06/42-07 must confirm and either extend the disclosure (in scope for this phase's audit-and-record mandate) or record it as an open-finding for a later phase. | 35 | **still open — confirmed by this plan's own live re-check.** `grep -c RustBuffer crates/pv-ffi/src/lib.rs` still returns `0` as of this session; the CP-4 header at `crates/pv-ffi/src/lib.rs:24-39` still discloses only the Swift-side (owned-`Vec<u8>`-not-retroactively-zeroing-the-caller's-buffer) residual, unchanged in substance since 35-REVIEW.md first found the gap. No phase 36-41 touched this disclosure (confirmed: no `crates/pv-ffi/src/lib.rs` diff in any phase-39/40/41 commit range mentions CP-4 or RustBuffer, per every QA-01 row already written for those phases in this register — none cites this file's header). Per DR-42-C, this plan does not extend the disclosure itself (it is a defect in `crates/pv-ffi/`, not an artifact this phase authors, and not the durable-log falsehood DR-42-C's second exception names) — recorded here, honestly, as an open-finding still owned by whichever phase next touches `crates/pv-ffi/src/lib.rs`'s CP-4 header. |
| H-09 | The Swift round-trip test (`FfiRoundTripTests.swift`) would still pass if the wrap/unwrap operations were identity no-ops, because the original version never inspected the intermediate (35-REVIEW.md WR-12). The file now contains `#expect(Array(wrapped.ciphertext) != originalUserKeyBytes)` and two sibling assertions at lines 107-109 — confirm this closes WR-12. | 35 | **resolved — 42-06.** Closed inside Phase 35 (specimen table's WR-12 row, disposition `verified`). Phase 37, Plan 37-02 moved the file's MODULE OWNERSHIP (`PasskeyVaultTests` → the `PasskeyVault` app target) but left the assertion itself unmodified in substance, gaining only `import PasskeyVault` (`.planning/phases/37-konto-unlock-has-em-i-biometria/37-02-SUMMARY.md:121, 148-149`, cross-referenced in the Phase 37 QA-02 table above as `inherited`) — confirmed not weakened by the move. |
| H-10 | The binding generator's command-line feature (`uniffi = { features = ["cli"] }`, `crates/pv-ffi/Cargo.toml`) pulls a large tool dependency set (clap/goblin/askama/rustix/…) into the library graph that is cross-compiled for iOS, widening the crypto crate's supply-chain surface (35-REVIEW.md WR-08). Confirm whether this was ever split into a separate bindgen crate/feature, or remains open. | 35 | **still open — confirmed by this plan's own live re-check.** `crates/pv-ffi/Cargo.toml:95` still reads `uniffi = { version = "=0.32.0", features = ["cli"] }` in the crate's own main `[dependencies]` block, unchanged since 35-REVIEW.md's WR-08 finding — never split into a separate bindgen-only crate/feature. No phase 36-41 touched this dependency line. Unrelated to, but adjacent to, L-14 (this register's closing verdict): the `=0.32.0` pin this WR-08 finding's own "cheapest to bump" alternative (H-02's cross-reference) would touch is the SAME pin L-14's own recorded option 1 names as the cheapest fix for the Release-build crash — a future bump attempt should evaluate both findings together, not separately. |
| H-11 | The concurrency backstop from Phase 35 verification — one key handle used from multiple Swift threads — abstained with no evidence in the ORIGINAL `35-VERIFICATION.md` truths table (B1, `insufficient_spec`). `35-VERIFICATION.md`'s own frontmatter (`resolution:`) claims this was closed 2026-08-16 via `FfiConcurrencyTests.swift` under TSan+ASan, both instruments falsified before their green runs were believed. Confirm this resolution is real by reading the evidence file it cites directly, not by trusting the claim. | 35 | **resolved — 42-06 (independent confirmation).** `ios/evidence/35/B1-CONCURRENCY-SANITIZERS.md:17-51` read directly (not re-quoted from the specimen table): both instruments' falsification transcripts are real — `FAIL: PasskeyVault (13898) encountered an error :: Early unexpected exit` (TSan, an unsynchronized-increment control) and `FAIL: deliberateHeapOverflowMustBeReported() :: Crash` (ASan) — with the file's own "HONEST NOTE ON A DISCREPANCY" explaining why the ASan link-time check alone was not accepted as sufficient proof. The claim in `35-VERIFICATION.md`'s frontmatter is confirmed genuine. |
| H-12 | Phase 35 left the committed status document (`ios/IOS-SPIKE-LOG.md`) asserting the FFI boundary was "Not started (no code yet)", which was false as of the phase's own later commits, and left an explicit landmine-recording obligation (`.planning/STATE.md:352`) undischarged. `35-VERIFICATION.md`'s own frontmatter claims this gap (`G1`) was resolved 2026-08-16 by later Phase 36/37 sessions carrying the content forward. Confirm by reading the current status row directly. | 35 (defect); 36/37 (claimed fix) | **resolved — 42-06 (independent confirmation).** `ios/IOS-SPIKE-LOG.md:21` read directly: `**Delivered and verified** (Phase 35, commits \`f6cb883\` … \`37c1ff7\`)` — no longer "Not started". The status row also names the current gate scripts (`build-ios.sh`, `audit-ffi-opaque-handles.sh`) and states an explicit proof limit ("simulator only"), consistent with this register's own evidence-tier discipline. |
| H-13 | Three cross-phase premise corrections research already recorded, unclaimed by any phase's own SUMMARY as of this plan: Phase 36's entitlement criteria rest on a premise the simulator cannot measure; Phase 37's Secure Enclave rejection is stated on a factually wrong reason; Phase 38's item-type count is wrong and the field model does not live where its criterion assumes. | 36, 37, 38 respectively | **resolved — 42-06.** All three now carry their own register row, each independently checked against the committed source (not re-quoted from research): Phase 36's corrected SC1–SC3 wording, checked against `.planning/phases/36-bramka-wykonalno-ci-autofilla-entitlement-i-bud-et-pami-ci/36-VERIFICATION.md:104-111` and `ios/AUTOFILL-FEASIBILITY.md:347/755` (Phase 36 QA-01 table, "SC1/SC2 cross-phase correction" row). Phase 37's ACC-05 corrected rationale, checked against `ios/IOS-SPIKE-LOG.md:465-480` (Phase 37 QA-01 table, first row). Phase 38's six-item-type union (L-15), checked against `packages/pv-ui/vault/types.ts:4` and independently re-confirmed by `.planning/phases/38-pe-ny-interfejs-vaulta/38-VERIFICATION.md:68`'s own re-run of `check-item-type-parity.sh` (Phase 38 QA-01 table, first row). |

---

## Durable-log correction (DR-42-C's second named exception) — `ios/IOS-SPIKE-LOG.md`'s status table

**Found (found-and-corrected disposition, per this plan's own instruction — the found-state is quoted
verbatim here BEFORE the fix, so it survives the correction):**

`ios/IOS-SPIKE-LOG.md:22` (the "Status of the spike" table's "Credential provider extension" row, as
committed at the start of this plan) reads, in its own words:

> "Real skeleton built, installed, and exercised end-to-end (Phase 36, Plans 36-01..36-04)... **No
> credential-list/fill *logic* yet (Phase 41)** — this row covers the skeleton, entitlement, and
> memory-budget proof only."

This was TRUE when Phase 36 wrote it (Phase 41 had not run) and is FALSE as of the code Phase 41 has
since delivered: `CredentialProviderViewController.swift`'s real fill path (`fillOrCancel`,
`SessionKeyReader` → `CipherCacheReader` → `decrypt_item` → `completeRequest`) exists, is wired at all
four entry points, and is independently re-verified live at HEAD `d0c3916` by `41-VERIFICATION.md`
(this register's own Phase 41 section, Q1/Q2/Q4 tables above) — a real password filled into a real
Safari form field, cold, offline, with lock-state correctness proven cross-process. The row asserting
"no fill logic yet" is exactly the shape this correction exists to fix: a durable claim the CODE now
contradicts, in the one committed file that survives this worktree and that this very register cites
as its own sibling source.

Additionally, the table has never carried a row for Phase 40 (family sharing) at all — a distinct,
absence-shaped gap from the false-positive-clause above, corrected in the same edit for the same reason
(a reader of this committed file with no `.planning/` access should not have to infer Phase 40 happened
from the decision-record subsections alone).

**Disposition: `found-and-corrected`.** This is DR-42-C's second named exception (the first is this
register's own two mechanical fixes to its own row schema, made by 42-06) — a factual falsehood in the
committed durable knowledge sink this register itself cites, corrected in place, with the found-state
preserved above rather than silently overwritten.

**Recording obligation discharged (Task 2's own required order, item 3):** this row's own correction is
paired with confirming the four durable learnings the plan's action text names were carried into the
log's landmine/decision sections. All four are already present, independently confirmed by direct read
rather than re-authored (the obligation was already discharged, organically, during Phase 35's own
extensive log-writing — this plan's job is to confirm it, not repeat it):
- **The generated-bindings invocation trap** — `ios/IOS-SPIKE-LOG.md:3085`, "L-10 — a cold DerivedData
  mismatches the generated bindings against the linked library."
- **The build-settings discoveries** — `ios/IOS-SPIKE-LOG.md:2135-2143`, the `IPHONEOS_DEPLOYMENT_TARGET`
  mismatch (`project.pbxproj` had `26.5` in all four configurations; fixed to `18.0`) and the
  `PRODUCT_BUNDLE_IDENTIFIER` correction, both recorded with the exact before/after values.
- **The class-body isolation trap that produced a false pass** — `ios/IOS-SPIKE-LOG.md:3034-3041`,
  "L-9 — 'a check that cannot fail' produced FOUR more instances in a single phase," naming the `sed`
  line-range class-body extraction as the mechanism, cross-referenced again at lines 3521 and 3574 as
  "CR-02/CR-03's own lesson."
- **The return-type distinction that decides whether a caught panic is catchable or fatal** —
  `ios/IOS-SPIKE-LOG.md:2190-2214`, naming that UniFFI's `catch_unwind` wrapping is real but an
  allocation failure aborts rather than unwinds on Darwin, so a `catch_unwind`-wrapped function can
  still crash the process for a class of hostile input — the exact distinction WR-11/H-07 (this
  register, above) resolve with a bounds check.

---

## Wire-encoding hazard (H-01) — dedicated subsection, per this plan's own instruction

This is the milestone's highest-risk carried item because it is **inferred, not observed**, by
construction: `WrappedKey { nonce: Vec<u8>, ciphertext: Vec<u8> }` (`crates/pv-core/src/keys.rs:59-62`)
carries no `serde` attributes, so `serde_json` serializes its byte fields as JSON number arrays on the
Rust side, while a default Swift `Codable`/`JSONEncoder` would encode the equivalent `Data` field as
base64. Nothing on the server validates which encoding a client wrote — `pv-server` stores the field as
opaque text and neither the register nor the sync endpoints parse or length-check it, so a client
writing the WRONG encoding gets a `200`/`201` and the failure surfaces only later, in a DIFFERENT
client, as an undecryptable row. **The settling observation this hazard names is cheap: inspecting the
type of one field in one real stored row decides it.** This subsection records, for every layer of the
milestone that uses a `WrappedKey`-shaped wire value, whether that observation was ever actually made —
and in which direction(s).

**Phase that first wrote such a row from the iOS client: Phase 37 (`pw_wrapped_uk`, the account
envelope).** Phase 37's own QA-01 table (this register, above) already carries the two-direction
cross-client proof: *"Two-direction cross-client `pw_wrapped_uk` interop: an iOS-registered account
unlocks from the real `pv-wasm` artifact and vice versa, both directions falsified with a real one-byte
ciphertext corruption producing a genuine AEAD rejection"* (`.planning/phases/37-konto-unlock-has-em-i-biometria/37-03-SUMMARY.md:254-278`,
disposition `verified`), quoting the live transcript `INTEROP D1: PASS` / `INTEROP D1-FALSIFIED: PASS`.
This is exactly the two-direction proof the hazard asks for: a row written by one client (iOS or web),
read successfully by the other, in both directions, on a real server. Phase 38 independently extended
the same proof to VAULT ITEMS (`enc_key`/`enc_data`, the item-level `WrappedKey`-shaped field), not only
the account envelope — Phase 38's own QA-01 table row "E-W1: two-direction cross-client wire proof for
VAULT ITEMS" (`ios/evidence/38/EW1-CROSS-CLIENT-WIRE.md`, disposition `verified`) is the second
independent settling observation, this time explicitly quoting the base64 shape as the REJECTED
encoding (`base64-shaped row: rejected -- invalid type: string ... expected a sequence`), i.e. the
positive control this hazard's own "no unit suite on either side can catch it" warning asks for is on
the record too — a hostile/wrong-encoded row IS observably rejected by the receiving client's decoder,
though (per that same row's own honest QA-03 finding) `pv-server` itself still answers `201` to it.

**Phase 40 independently re-derived the SAME hazard shape for the family-sharing surface, and closed it
BEFORE writing dependent code, not after.** DR-40-A (`.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-01-SUMMARY.md:107`,
this register's own Phase 40 QA-01 table) is a decision record made explicitly BECAUSE of this exact
hazard: *"rejected UniFFI `Record` with `Data`/byte-array fields (Phase 35's `FfiWrappedKey`/
`FfiEncryptedItem` style) — Swift's `JSONEncoder` would encode `Data` as base64 while `serde_json`
encodes `Vec<u8>`/`[u8; N]` as JSON number sequences, so a `Record` hands the wire format to Swift
instead of fixing it in Rust."* Every new sharing-related FFI export (`wrap_identity_secret_key`,
`seal_collection_key`, `FfiInviteChannel::wrap_collection_key`, etc.) therefore returns `String`-JSON
produced by `serde_json` inside Rust, closing the ambiguity at the Rust layer rather than hoping Swift
encodes it correctly. **This decision was then independently PROVEN, not merely asserted**, by E-W2
(Phase 40 QA-01 table, three rows: directions A/B/C) — a real, isolated server, real `pv-ffi` on iOS,
real `pv-wasm` on the "web" side, three directions, each with its own falsification control quoting the
SAME bytes re-encoded as Swift's `JSONEncoder` would (base64) to show the two encodings are textually
distinguishable:
```
$ curl ... | jq -e '.wrapped_secret_key | fromjson | .nonce | type'
"array"
# Falsification control -- the SAME nonce bytes, re-encoded the way Swift's JSONEncoder would:
$ echo '{"nonce":"1cUeLgaoXIxzOV0t/5zcBCpTXynFCusz",...}' | jq -e '.nonce | type'
"string"
```
This is the milestone's clearest instance of the settling observation actually being performed, three
separate times, on three separate layers (account, item, sharing), in both directions each time.

**Disposition: resolved.** The hazard is not merely absent-of-evidence; it is affirmatively,
receiver-side, cross-client, bidirectionally proven at every layer of the milestone that uses a
`WrappedKey`-shaped wire value — the account envelope (Phase 37), vault items (Phase 38), and the
identity/Collection-Key sharing surface (Phase 40) — with Phase 40 additionally demonstrating that the
codebase's own engineers recognised the hazard shape independently and designed against it BEFORE
writing the dependent code, which is the strongest possible form this resolution could take. No
`WrappedKey`-shaped wire value in this milestone is missing a settling observation. Phases 39 and 41
introduce no NEW `WrappedKey`-shaped wire surface of their own (39's ciphertext cache moves `enc_key`/
`enc_data` VERBATIM, byte-for-byte, never re-encoding — `.planning/phases/39-synchronizacja-i-cache-offline/39-VERIFICATION.md:64`;
41's cache read is the same verbatim-move discipline one hop further, `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:150`) — so neither phase re-opens or re-tests this hazard, and neither needed to.

---

## Phase 35 — worked example (format specimen AND the inventory's control target)

Sourced from `35-REVIEW.md` (findings CR-01..CR-03, WR-01..WR-12) and `35-VERIFICATION.md` (score,
B1/G1 resolution), with file:line and excerpt taken from the CURRENT committed tree (not merely
transcribed from the review at the time it was written) — since QA-01 asks whether the claim holds
today, dispositions below reflect what this plan's own read of the current source found, not only what
`35-REVIEW.md` said on 2026-08-11.

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| CR-01: `FfiWrappingKey::from_password` must zeroize its owned password copy on EVERY exit path, including the KDF-params parse-error early return | FFI-01 | real-FFI | `crates/pv-ffi/src/lib.rs:364` | `let password = Zeroizing::new(password);` | critical | verified |
| CR-02: the opaque-handle audit must not silently truncate a class body on an unbalanced brace inside a doc comment | FFI-02 | real-bytes | `scripts/audit-ffi-opaque-handles.sh:176` | `strip_comments_and_strings() {` | critical | verified |
| CR-03: the opaque-handle audit must not silently skip an unrecognized class declaration spelling, and must not hardcode the handle-class list | FFI-02 | real-bytes | `scripts/audit-ffi-opaque-handles.sh:335` | `strip_comments_and_strings "$f" > "$STRIPPED"` | critical | verified |
| WR-02: the Rust-side build must set `IPHONEOS_DEPLOYMENT_TARGET` explicitly, matching `project.pbxproj`'s 18.0 floor | FFI-04 | real-bytes | `scripts/build-ios.sh:374` | `export IPHONEOS_DEPLOYMENT_TARGET=18.0` | warning | verified |
| WR-03: the slice gate must inspect one of `pv-ffi`'s OWN compiled objects, never an arbitrary first-found object | FFI-04 | real-bytes | `scripts/build-ios.sh:222` | `obj=$(find "$scratch" -name 'pv_ffi*.o' -print -quit)` | warning | verified |
| WR-04: `UNIFFI_VERSION`'s parse-failure branch is unreachable under `set -euo pipefail` (a failed grep-then-sed pipeline aborts the script before the `if [ -z ... ]` check runs) | FFI-04 | n/a (build-script correctness, not a crypto claim) | `scripts/build-ios.sh:152-155` | `if [ -z "$UNIFFI_VERSION" ]; then` | info | gap |
| WR-05: the opaque-handle audit is wired into no automated CI lane, and has no freshness check of its own (the composer's freshness check, `gate_ffi_opaque`, lives in `scripts/check-ios-gate.sh`, not in the audited script itself) | FFI-02 | n/a | `scripts/audit-ffi-opaque-handles.sh:1-471` (no `-newer` / freshness assertion anywhere in the file; confirmed by grep) | `(no match for '-newer' or 'freshness' in the file)` | warning | gap |
| WR-06: the CP-4 residual-risk disclosure must enumerate ALL un-zeroized copies, not only the Swift-side buffer — the UniFFI `RustBuffer` intermediate and the `encrypt_item`/`decrypt_item` plaintext `String`s are still undisclosed | FFI-03 | n/a | `crates/pv-ffi/src/lib.rs:24-40` (no `RustBuffer` mention anywhere in the file; confirmed by grep) | `//! CP-4 RESIDUAL RISK (strukturalny, nie do zamknięcia na tej granicy):` | warning | gap |
| WR-07: `ffi06-probe` must default OFF the moment a second build path (an app/extension target) exists | FFI-06 | real-FFI | `crates/pv-ffi/Cargo.toml:82` | `default = []` | warning | verified (see H-02 for the still-open app-target default-flag residual) |
| WR-09: `mod panic_probe;` must be feature-gated, not merely its `impl` block, or `--no-default-features` produces warnings | FFI-06 | real-FFI | `crates/pv-ffi/src/lib.rs:187-188` | `#[cfg(feature = "ffi06-probe")]` / `mod panic_probe;` | info | verified |
| WR-10: the falsifiable-slice-gate mode must falsify BOTH slices (device AND simulator), not only simulator | FFI-04 | real-bytes | `scripts/build-ios.sh:337-338` | `falsify_slice "ios-arm64"           "$DEVICE_EXPECT" "ios"` / `falsify_slice "ios-arm64-simulator" "$SIM_EXPECT"    "iossim"` | warning | verified |
| WR-11: server-supplied `KdfParams` must be bounds-checked before use, or a hostile value is an uncatchable process abort | FFI-01 | real-FFI | `crates/pv-ffi/src/lib.rs:745` | `fn from_password_rejects_over_ceiling_m_cost_end_to_end()` | critical | verified (sibling test `from_password_rejects_argon2s_own_max_m_cost` at line 780) |
| WR-12: the Swift round-trip test must assert the WRAPPED intermediate is not (and does not contain) the raw key bytes, not merely that the final unwrap matches | FFI-05 | real-bytes | `ios/PasskeyVault/PasskeyVaultTests/FfiRoundTripTests.swift:107-109` | `#expect(Array(wrapped.ciphertext) != originalUserKeyBytes)` | warning | verified |
| B1 (backstop): concurrent use of one `FfiUserKey` handle from multiple Swift threads must not corrupt state or double-free | FFI-01 | live-simulator | `ios/PasskeyVault/PasskeyVaultTests/FfiConcurrencyTests.swift:111` | `private static let iterations = 256` | critical | verified (256 concurrent iterations under TSan+ASan per `.planning/phases/35-granica-ffi-rust-swift-i-szkielet/35-VERIFICATION.md:7`, both instruments falsified before their green runs were believed; 42-06 should independently confirm against `ios/evidence/35/B1-CONCURRENCY-SANITIZERS.md`) |
| G1 (doc-drift): `ios/IOS-SPIKE-LOG.md`'s committed status document must not assert the FFI boundary is "Not started" once it is built | QA-05 (durable-sink discipline) | n/a | `ios/IOS-SPIKE-LOG.md:21` | `FFI boundary -- Delivered and verified (Phase 35, commits f6cb883 to 37c1ff7)` | warning | verified (current status row read directly; resolution recorded at `.planning/phases/35-granica-ffi-rust-swift-i-szkielet/35-VERIFICATION.md:39`) |

**Note on the two `verified (claim re-quoted ...)` rows (B1, G1):** per this register's own row schema,
"a row whose evidence cannot be quoted inline is not a row." Both rows ARE quoted inline (from
`35-VERIFICATION.md`'s own frontmatter, itself an independently-authored verification document, not a
SUMMARY narrating its own work) — but this plan did not itself re-open `FfiConcurrencyTests.swift` or
`ios/IOS-SPIKE-LOG.md`'s current status row to re-confirm the claim byte-for-byte, since that
independent confirmation is 42-06's job (this plan's own scope is the register's machinery, not the
audit itself). Recorded honestly as re-quoted, not independently re-verified by this plan.

---

## Phase 36 — Bramka wykonalności AutoFilla (entitlement + budżet pamięci)

**Audited plans:** 36-01, 36-02, 36-03, 36-04 (`summaries=4 plans=4`, per the inventory's own
`MACHINE|36|...|4|4|IN-COVERAGE` line). No `*-PLAN.md` in this phase is flagged `UNSUMMARIZED` by
`scripts/qa-audit-inventory.sh`'s own run — every plan has a matching SUMMARY, so the "read every
UNSUMMARIZED plan" hook is a no-op for this phase (the empty list, shown per the acceptance criterion).
Cross-phase correction check (per this plan's own `<action>` instructions): the entitlement criteria
were rewritten mid-milestone before this phase executed (see the SC1/SC2 row below) — checked against
`.planning/phases/36-bramka-wykonalno-ci-autofilla-entitlement-i-bud-et-pami-ci/36-VERIFICATION.md`'s own "Criteria used" note and found to match the corrected wording, not the
original false premise.

### QA-01 — evidence-tier pass (crypto / bytes / time / server claims)

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| D1: a real `.appex` process crosses the FFI boundary and reports a non-zero `phys_footprint` read from outside the process | FILL-01 | live-simulator | `ios/evidence/36/baseline.log:3` | `PVPROBE\|stage=configure kr=KERN_SUCCESS phys=22349912 peak=25266264 remaining=0 ffi_bytes=32` | warning | verified |
| E1: entitlement embedding — all three keys present in both built binaries, with a no-entitlements negative control proving the reader is not vacuous | FILL-01 | real-bytes | `scripts/sim-entitlements.py` output cited in `.planning/phases/36-bramka-wykonalno-ci-autofilla-entitlement-i-bud-et-pami-ci/36-01-SUMMARY.md:126-131` | `the no-entitlements negative control ... shows the section persists ... but none of the three capability keys` | warning | verified |
| E2: App Group container resolves to the byte-identical path for host (outside, `simctl`) and extension (inside, `FileManager`, from the real running process) | FILL-01 | live-simulator | `ios/evidence/36/appgroup.log:3` | `PVPROBE\|stage=appgroup resolved=.../Containers/Shared/AppGroup/8B89C66D-A449-4832-9A27-125948A6E8B5 roundtrip=ok` | critical | verified |
| E3: a fixed 32-byte test vector written by the host app is read back byte-for-byte inside the extension across the shared keychain access group, missing-entitlement negative control fires | FILL-01 | live-simulator | `ios/evidence/36/keychain.log:6-7` | `PVPROBE\|stage=keychain status=0 bytes=32 equal=true` / `PVPROBE\|stage=keychain-negative status=-34018` | critical | verified |
| E5.a/b: the memory-instrument sampler thread runs inside the real extension process and reports a genuine sample count/peak | FILL-06 | live-simulator | `ios/AUTOFILL-FEASIBILITY.md:374` | `PVPROBE\|stage=sampler kr=KERN_SUCCESS samples=42 peak_sampled=22055000 ledger_peak=24938584` | warning | verified |
| E5.c: the instrument is proven to MOVE with the KDF's own memory parameter — an 8 MiB vs 256 MiB run shows a ~256 MiB peak delta | FILL-06 | live-simulator | `ios/evidence/36/sensitivity.log:4-5` | `label=8mib ... peak_sampled=22399088` / `label=256mib ... peak_sampled=290687280` (delta 268,288,192 bytes) | critical | verified |
| E5.d: a genuine, memset'd 200 MB in-process allocation is measured (not assumed) to survive on this simulator, confirming no jetsam machinery empirically | FILL-06 | live-simulator | `ios/evidence/36/enforcement.log:1-3` | `ordinal=1 ... phys=22087768` / `ordinal=2 ... phys=231917800` / `ordinal=3 ... phys=231950568` | warning | verified |
| E6: production-parameter Argon2id (`m_cost_kib=65536/t_cost=3/p_cost=4`) measured ten times inside the real extension process, peak 89,229,448–89,475,232 bytes | FILL-06 | live-simulator | `ios/AUTOFILL-FEASIBILITY.md:692` | `peak \`phys_footprint\` ranged **89,229,448–89,475,232 bytes (~85.10–85.33 MiB)** across all ten runs` | critical | verified (see next row — the FIRST-recorded version of this same claim was itself a QA-01 failure, corrected before this audit ran) |
| E6 record-vs-evidence defect (self-referential provenance failure, found by `.planning/phases/36-bramka-wykonalno-ci-autofilla-entitlement-i-bud-et-pami-ci/36-VERIFICATION.md`, not by this plan): the ORIGINAL committed peak lower bound (89,163,912 bytes) appeared in NO evidence log and NO commit — the record contradicted its own underlying measurement for five days | FILL-06 | n/a (documentation defect, not a crypto claim) | `.planning/phases/36-bramka-wykonalno-ci-autofilla-entitlement-i-bud-et-pami-ci/36-VERIFICATION.md:51-55` | `89,163,912 appears nowhere: not in kdf-inprocess.log, not in kdf-coldstart.log ... The figure is 65,536 bytes below any measured value.` | warning | verified (resolved 2026-08-16, correction block at `ios/AUTOFILL-FEASIBILITY.md:684-688`) |
| E7: an independent out-of-process (`vmmap`) reading of the same peak, sought via twelve real, escalating attempts | FILL-06 | n/a (sought, not obtained) | `ios/evidence/36/vmmap-crosscheck-race-attempt.txt` cited in `.planning/phases/36-bramka-wykonalno-ci-autofilla-entitlement-i-bud-et-pami-ci/36-04-SUMMARY.md:229-236` | `the tightest attempt ... still found the process "no longer appears to be running" in the gap between detection and attach` | info | gap (honestly recorded as NOT OBTAINED, not inferred from the in-process reading — this is the correct disposition per the plan's own escape hatch, not a defect) |
| ffi06-probe synthetic panic function defaults OFF the moment a second (app-target) build path exists | FILL-01 | real-FFI | `crates/pv-ffi/Cargo.toml:82` | `default = []` (confirmed unchanged since Phase 35, re-verified this audit via `git blame`) | warning | verified — but see H-02 in the hazard checklist: the **app target's own Run Script phase** still defaults to `--with-panic-probe` in Debug, a live, still-open residual this row does not resolve |
| DR-1: hybrid (Keychain + App Group) data-sharing decision, Keychain-only named and rejected on its merits (the premise it hedged against is disproven by E2 on this simulator) | FILL-01 | n/a (decision record, backed by the E2/E3 rows above) | `ios/IOS-SPIKE-LOG.md:250-256` | `Rejected on its merits, not by omission ... Phase 36, Plan 36-02's E2 disproves that premise on this simulator` | warning | verified |
| SC1/SC2 cross-phase correction check (task-mandated): the phase-36 entitlement criteria were rewritten mid-milestone from a false premise ("the simulator grants or refuses the entitlement, and refusal is the $99 trigger") to the corrected wording this phase was actually held to | FILL-01 | n/a (documentation/process claim) | `.planning/phases/36-bramka-wykonalno-ci-autofilla-entitlement-i-bud-et-pami-ci/36-VERIFICATION.md:104-111` | `The instrument deviation SC3 mandates ... is separately recorded by the phase ... The deviation from the original ROADMAP wording is therefore not an undocumented drift: it is the committed criterion.` | warning | verified — what the phase actually recorded (`ios/AUTOFILL-FEASIBILITY.md:347` / `:755`, `nierozstrzygalne na symulatorze — nie FAIL`) matches the corrected wording and does not connect a free account to a grant or a refusal, per the task's own required check |

### QA-02 — guard pass (red before green)

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| `layer-a` (pluginkit registration) demonstrated able to fail against a never-installed bundle id | FILL-01 | live-simulator | `scripts/ios-autofill-layers.sh:62` (`cmd_layer_a`) | exits 1, names the missing id (`.planning/phases/36-bramka-wykonalno-ci-autofilla-entitlement-i-bud-et-pami-ci/36-01-SUMMARY.md:135-136`) | info | verified — 1 falsification input (bundle-id substitution); not composed into `check-ios-gate.sh` (only `qa05/ffi_build/ffi_falsifiable/ffi_opaque/swift_tests/qa_register` are wired — confirmed by grep against the composer, zero hits for `ios-autofill-layers`/`ios-memory-gate`/`ios-vmmap-crosscheck`), reachable only by a human running the script directly |
| `layer-b` (pluginkit election, asserts the leading `+` marker, never bare presence) demonstrated able to fail | FILL-01 | live-simulator | `scripts/ios-autofill-layers.sh:88` (`cmd_layer_b`) | the `+` assertion no longer matches after `pluginkit -e ignore` (`.planning/phases/36-bramka-wykonalno-ci-autofilla-entitlement-i-bud-et-pami-ci/36-01-SUMMARY.md:136-138`); `cmd_layer_b`'s own FAIL branch calls `exit 1` (`scripts/ios-autofill-layers.sh:108`, confirmed by direct source inspection) | info | verified — 1 falsification input, exit 1; not automatic |
| `wording-gate` (four forbidden-phrasing classes: free-Apple-ID grant/refusal sentence, budget-verdict phrasing, expanded team-prefix literal, bash-only `PIPESTATUS` array) | FILL-01 | real-bytes | `scripts/ios-autofill-layers.sh:306` (`cmd_wording_gate`) | failed once per class, reverted (`.planning/phases/36-bramka-wykonalno-ci-autofilla-entitlement-i-bud-et-pami-ci/36-01-SUMMARY.md:139-140`); FAIL branch calls `exit 1` (`scripts/ios-autofill-layers.sh:318`, confirmed by direct source inspection) | warning | verified — 4 structurally distinct falsification inputs (one per forbidden-phrasing class), exit 1; not automatic |
| `scripts/ios-memory-gate.sh instrument` (E5.a/b's own evidence-log assertion) | FILL-06 | live-simulator | `scripts/ios-memory-gate.sh:59` (`cmd_instrument`) | `FAIL: no PVPROBE\|stage=sampler line found ...` / `FAIL: evidence log not found` (`ios/evidence/36/instrument-falsification.log:1-4`); both FAIL branches call `exit 1` (`scripts/ios-memory-gate.sh:67, 77`, confirmed by direct source inspection) | info | verified — 2 falsification inputs (stripped line, missing file), exit 1; not automatic |
| `scripts/ios-memory-gate.sh sensitivity` (E5.c's own accepted-range assertion) | FILL-06 | live-simulator | `scripts/ios-memory-gate.sh:112` (`cmd_sensitivity`) | `FAIL: sensitivity control -- delta=... is outside the accepted range` (line 151); FAIL branch calls `exit 1` (confirmed by direct source inspection of `cmd_sensitivity`) | critical | verified — 1 falsification input (equal-peaks scratch copy), exit 1; not automatic |
| `scripts/ios-memory-gate.sh measure` (E6's own run-sequence assertion) — the FIRST version was itself a self-referential "check that cannot fail" (L-9 family), found and fixed by this plan's own mandated falsification step BEFORE the E6 evidence in the QA-01 table above was captured | FILL-06 | live-simulator | `scripts/ios-memory-gate.sh:233` (`cmd_measure`) | run=3 line removed from a scratch copy → `FAIL: run/invocation sequence ... is '1,2,4,5,', expected the complete permutation '1,2,3,4,'` (`ios/evidence/36/measure-falsification.log:1-8`, post-fix); `cmd_measure`'s own FAIL branches call `exit 1` (confirmed by direct source inspection) | critical | verified (post-fix) — 1 falsification input post-fix, exit 1; the PRE-fix false-pass is the notable finding, recorded not softened; not automatic |
| `scripts/ios-vmmap-crosscheck.sh`'s own no-process-alive path (E7's instrument, separate from whether E7 itself was OBTAINED — see the QA-01 table's honest `gap` row) | FILL-06 | live-simulator | `scripts/ios-vmmap-crosscheck.sh:1` | exits 1 with an explicit message (`.planning/phases/36-bramka-wykonalno-ci-autofilla-entitlement-i-bud-et-pami-ci/36-04-SUMMARY.md` Task 2 transcript) | info | verified — 1 falsification input; not automatic; the guard itself works, the underlying MEASUREMENT (E7) is the honest gap |
| Cross-reference to **H-02** (`ffi06-probe` app-target default-flag residual, still partially open — see hazard table above): the crate-level flip to `default = []` was demonstrated by a real two-sided `nm` symbol-count control performed in Phase 38, not re-demonstrated inside Phase 36 itself | FILL-01 | real-FFI | `crates/pv-ffi/Cargo.toml:82` | `default = []` — falsification transcript (`off=0`/`on=4`) lives in the Phase 38 QA-01 table's "Release-configuration build" row, cross-referenced here per Task 2's own hazard-cross-reference requirement | warning | inherited — the falsification is Phase 38's own work, correctly labelled inherited here rather than re-presented as Phase 36's |

### QA-03 — absence-shaped assertion pass

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| E2's App Group negative control: a never-installed bundle's container resolution fails, proving the positive resolution is not vacuous | FILL-01 | live-simulator | `ios/evidence/36/appgroup-negative-control.txt:1` | control fails as required — same-mechanism `simctl get_app_container ... groups` command shape as the passing read, only the bundle id differs (`.planning/phases/36-bramka-wykonalno-ci-autofilla-entitlement-i-bud-et-pami-ci/36-01-SUMMARY.md:71`) | warning | verified |
| E3's keychain negative control: reading under an undeclared access group returns `errSecMissingEntitlement` (-34018) | FILL-01 | live-simulator | `ios/evidence/36/keychain.log:7` | `PVPROBE\|stage=keychain-negative status=-34018` — same `SecItemCopyMatching` call shape as the passing read at line 6, only the access group differs | critical | verified |
| E1's entitlement negative control: the no-entitlements variant shows Xcode's minimal `application-identifier` entry but none of the three capability keys | FILL-01 | real-bytes | `scripts/sim-entitlements.py:1` | same reader script against a deliberately stripped variant (`.planning/phases/36-bramka-wykonalno-ci-autofilla-entitlement-i-bud-et-pami-ci/36-01-SUMMARY.md:129-131`) | warning | verified |
| ffi06-probe symbol-table check: `nm -gU ... \| grep -c ffi06_synthetic_panic_probe` returns 0 for the plain build (paired positive control, `on=4`, performed in Phase 38 — see that phase's QA-01 table) | FILL-01 | real-bytes | `crates/pv-ffi/Cargo.toml:82` | `off=0` / `on=4` (`.planning/phases/38-pe-ny-interfejs-vaulta/38-01-SUMMARY.md:64-69`) — cited here because Phase 36 is the claim's origin | warning | verified (control performed in Phase 38, cross-referenced) |
| `os_proc_available_memory()` never appears inside a conditional anywhere in the codebase | FILL-06 | real-bytes | `ios/PasskeyVault/PasskeyVaultAutoFill/MemoryProbe.swift:1` | `git grep -nE 'os_proc_available_memory' ios/PasskeyVault` → only inside `emitAvailableMemory()`, no conditional (`.planning/phases/36-bramka-wykonalno-ci-autofilla-entitlement-i-bud-et-pami-ci/36-03-SUMMARY.md:314`) | info | gap — a single-direction structural grep with no demonstrated positive control (no injected conditional-usage case was shown to make the check fail); the check could pass vacuously if `emitAvailableMemory()` itself were deleted |
| `simctl get_app_container`'s specific-group-identifier positional form: confirmed BROKEN (usage text + exit 117 for any group identifier, valid or bogus) — the plan's ORIGINAL negative-control mechanism was itself a check that cannot fail, discovered and routed around before shipping | FILL-01 | live-simulator | `scripts/ios-autofill-layers.sh:140` (`cmd_layer_appgroup`) | `.planning/phases/36-bramka-wykonalno-ci-autofilla-entitlement-i-bud-et-pami-ci/36-02-SUMMARY.md:227-236` | warning | gap (as originally designed) — superseded by the shipped control (row 1 above), which is `verified` |

## Phase 37 — Konto, unlock hasłem i biometria

**Audited plans:** 37-01 through 37-05 (`summaries=5 plans=5`, `MACHINE|37|...|5|5|IN-COVERAGE`). No
`UNSUMMARIZED` `*-PLAN.md` in this phase — the empty list, per the acceptance criterion. Cross-phase
correction check: the phase-37 rejection of the hardware key store (ACC-05) was flagged in the seeded
hazard checklist (H-13) as stated on a factually wrong reason — checked directly against
`ios/IOS-SPIKE-LOG.md`'s own committed ACC-05 record below.

### QA-01 — evidence-tier pass (crypto / bytes / time / server claims)

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| ACC-05 cross-phase correction (task-mandated check): the requirement's original stated reason ("SE cannot protect symmetric blobs") is FALSE and is replaced in the committed record, not silently carried forward | ACC-05 | real-bytes (`.swiftinterface` line cited directly) | `ios/IOS-SPIKE-LOG.md:465-480` | `The requirement's own stated reason is wrong and is replaced here, in writing ... "SE cannot protect symmetric blobs" is refuted by that same \`.swiftinterface\` line` (citing `CryptoKit.framework/.../arm64e-apple-ios.swiftinterface` line 641, `SecureEnclave.P256.KeyAgreement.PrivateKey : HPKEDiffieHellmanPrivateKey`) | critical | verified — the record was checked, not merely quoted; the rejection is upheld on R1-R5 instead of the false premise |
| Real account creation + unlock from the iOS app process against a live, unmodified `pv-server`; decrypted plaintext compared byte-for-byte against a literal | ACC-01 | live-run | `ios/PasskeyVault/PasskeyVaultTests/AccountFlowLiveTests.swift` (`.planning/phases/37-konto-unlock-has-em-i-biometria/37-02-SUMMARY.md:69-73`, `registerThenSignInReconstructsSameUserKeyAndDecryptsRealCiphertext`) | `register-then-sign-in reconstructs the same User Key from the server's \`pw_wrapped_uk\` and decrypts a real ciphertext to a literal byte-for-byte` | critical | verified |
| `pw_wrapped_uk` wire shape settled as `[OBSERVED]` against a real database row, superseding a prior `[INFERRED]` status | ACC-01 | real-bytes | `scripts/check-ios-wire-shape.sh` output, `.planning/phases/37-konto-unlock-has-em-i-biometria/37-02-SUMMARY.md:125` | `\`pw_wrapped_uk\` is stored as \`{"nonce":[<numbers>],"ciphertext":[<numbers>]}\` -- a plain \`serde_json\` number array` | critical | verified |
| Two-direction cross-client `pw_wrapped_uk` interop: an iOS-registered account unlocks from the real `pv-wasm` artifact and vice versa, both directions falsified with a real one-byte ciphertext corruption producing a genuine AEAD rejection | ACC-01 | live-run | `.planning/phases/37-konto-unlock-has-em-i-biometria/37-03-SUMMARY.md:254-278` | `INTEROP D1: PASS` / `INTEROP D1-FALSIFIED: PASS` (real transcript, not paraphrased) | critical | verified — the milestone's largest remaining correctness risk at the time (`ios/IOS-SPIKE-LOG.md` §4 q.5) |
| `INFO_AUTH_HASH`/`INFO_PW_UNLOCK` HKDF domain-separation constants pinned as hex literals independently in Rust and Swift, both halves demonstrated red before green | ACC-02 | real-bytes | `crates/pv-ffi/src/lib.rs` test `derivation_vectors_pin_info_auth_hash_and_info_pw_unlock`, `PvDerivationVectorTests.swift` (`.planning/phases/37-konto-unlock-has-em-i-biometria/37-03-SUMMARY.md:374-380`) | `Test case 'PvDerivationVectorTests/authHashMatchesPastedVectorAndDivergesFromPwUnlock()' failed` (falsification transcript, one-character hex change) | warning | verified |
| WR-11's untrusted-`KdfParams` guard (`validate_kdf_params`, `MAX_M_COST_KIB`/`MAX_T_COST`/`MAX_P_COST`) re-verified against this plan's own spec — already implemented since Phase 35, no functional change needed | ACC-02 | real-FFI | `crates/pv-ffi/src/lib.rs:307` (`fn validate_kdf_params`) | `tests::from_password_rejects_over_ceiling_m_cost_end_to_end`, `tests::kdf_param_bounds_reject_exactly_one_past_the_maximum` (`.planning/phases/37-konto-unlock-has-em-i-biometria/37-03-SUMMARY.md:382-389`, falsified by raising `MAX_M_COST_KIB` above 4,000,000 — panic observed, reverted) | critical | verified |
| ATS recorded as `[OBSERVED]` H1 (cleartext loopback permitted, no `NSAppTransportSecurity` key), both negative (`plutil -p`) and positive (every live `URLSession` call succeeded) evidence, with stated extension/hardware limitations | ACC-02 | live-run | `ios/IOS-SPIKE-LOG.md:2415` (`### ATS — H1 confirmed`) | `H1 confirmed: cleartext loopback permitted with no Info.plist key` | warning | verified — limitation stated explicitly: does NOT extend to the AutoFill extension's own Info.plist (Phase 41's own obligation) |
| E2, the central biometry finding: `SecItemCopyMatching` with NO `LAContext`, against a freshly-stored ACC-03 envelope with Face ID genuinely Enrolled, returns the protected 32 bytes unconditionally in under 2ms | ACC-04 | live-simulator | `ios/IOS-SPIKE-LOG.md:2563-2564` | `E2 VERDICT: Result B` / `\`SecItemCopyMatching\` with \`kSecReturnData: true\` and **NO** \`LAContext\` ... status **\`0\`**, and the returned bytes equal the literal 32-byte fixture **immediately**` | critical | verified — recorded as a NEGATIVE result (this simulator does NOT enforce the ACL), not softened into a pass. This is exactly the "could this claim have been produced by a green test that never touched the real thing?" question this register asks, answered honestly in the negative |
| CR-01 fix: `BiometricUnlockService.unlockWithBiometrics`'s raw 32-byte User Key bytes were never wiped; the naive fix would have been WORSE (Copy-on-Write alias trap) — demonstrated with a dedicated isolation test before trusting the production fix | ACC-01 (memory hygiene) | real-bytes | `ios/PasskeyVault/PasskeyVaultTests/BiometricCoWWipeTests.swift:61` (`dataResetBytesOnANonUniquelyReferencedCopyDoesNotWipeTheOriginal`) + production fix at `ios/PasskeyVault/PasskeyVault/Core/BiometricUnlockService.swift:145` (`consumeOkBytes`) | `wiping a non-uniquely-referenced \`Data\` copy leaves a second live alias completely unwiped` (`.planning/phases/37-konto-unlock-has-em-i-biometria/37-04-SUMMARY.md:190-194`) | critical | verified |
| E-SE-1b: a real `SecureEnclave.P256.KeyAgreement.PrivateKey` + `HPKE.Sender`/`Recipient` round trip, byte-exact, mismatched-`info` control throwing as required — the strongest positive confirmation that an SE-protected envelope is genuinely buildable | ACC-05 | real-FFI (CryptoKit, not pv-ffi, but real cryptographic material on-device) | `ios/PasskeyVault/PasskeyVaultTests/SecureEnclaveProbeTests.swift` (`eSe1b_hpkeRoundTripOverSecureEnclaveKeyAgreement`, `.planning/phases/37-konto-unlock-has-em-i-biometria/37-05-SUMMARY.md:159-162`) | `a real \`SecureEnclave.P256.KeyAgreement.PrivateKey\` + \`HPKE.Sender\`/\`Recipient\` round trip, byte-exact, with the mismatched-\`info\` control throwing as required` | warning | verified |
| E5: SC5's `.biometryCurrentSet` invalidation guarantee is UNPROVABLE on this harness — a read after toggling Face ID Enrolled off still returned the byte-identical key | ACC-04 | live-simulator | `ios/IOS-SPIKE-LOG.md` §"E5" cited in `.planning/phases/37-konto-unlock-has-em-i-biometria/37-05-SUMMARY.md:149-155` | `The read STILL succeeded with the byte-identical key, and \`domainState.biometry.stateHash\` did not change at all` | critical | verified — this is a claim recorded as UNPROVABLE, not as a pass; exactly the QA-01 discipline this register enforces (a green test result here would have overclaimed) |

### QA-02 — guard pass (red before green)

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| CR-01's Copy-on-Write wipe fix (`consumeOkBytes`), proven with a dedicated isolation test first | ACC-01 | real-bytes | `ios/PasskeyVault/PasskeyVault/Core/BiometricUnlockService.swift:145` | `2 of 4 tests failed` after temporarily reverting `outcome = .benignCancel` (`.planning/phases/37-konto-unlock-has-em-i-biometria/37-04-SUMMARY.md:200`); tests at `ios/PasskeyVault/PasskeyVaultTests/BiometricCoWWipeTests.swift:92` and `:112`; `xcodebuild test` reports exit 65 on any Swift Testing failure (this project's own established convention, confirmed directly e.g. `.planning/phases/38-pe-ny-interfejs-vaulta/38-12-SUMMARY.md:201-204`, `$ echo $? / 65`) | critical | verified — 2 falsification inputs (success path, throwing path), exit 65; not automatic. A genuine production security fix whose isolation test proves the CoW trap FIRST — not "resetBytes was called" but "a still-live second reference is unwiped" |
| CR-02's `defer`-based master-password wipe (closing a throw-path leak reachable via a hostile server-returned KDF param) | ACC-01 | unit-test-only | `ios/PasskeyVault/PasskeyVault/Core/AccountService.swift:80` (also `:139`, `:206`) | `defer { passwordData.resetBytes(in: 0..<passwordData.count) }` — verified via `swiftc -parse` + full re-read, not a red/green demonstration (`.planning/phases/37-konto-unlock-has-em-i-biometria/37-04-SUMMARY.md:164-174`) | warning | partial — 0 falsification-input count; not automatic. The fix is real and reasoned, but per this register's own non-negotiable bar ("a test existing is not a proof") this row is NOT `verified`: no mutation-driven red transcript exists for this specific fix |
| Two-direction cross-client interop falsification (real one-byte ciphertext corruption via direct SQL `UPDATE`, and the corruption step's OWN falsifiability demonstrated via a skip flag) | ACC-01 | live-run | `scripts/verify-ios-web-interop.mjs:745` (`process.exit(1)` on a FAILED-direction result) | `INTEROP D1-FALSIFIED: FAIL (... corruption step skipped on purpose, unlock succeeded, so falsification correctly reports FAIL)` (`.planning/phases/37-konto-unlock-has-em-i-biometria/37-03-SUMMARY.md:283-288`, transcript's own closing line `(exit 1)`) | critical | verified — 3 falsification inputs (D1 corruption, D2 corruption, plus the meta-level skip-corruption env var proving the check itself is not vacuous), exit 1; not automatic |
| `scripts/verify-ios-server-contract.sh`'s 12-row auth contract, demonstrated able to fail | ACC-01 | live-run | `scripts/verify-ios-server-contract.sh:84` (FAIL-path `exit 1`) | `FAIL register-201 expected=201 got=201` (`.planning/phases/37-konto-unlock-has-em-i-biometria/37-03-SUMMARY.md:326-335`, transcript's own closing line `(exit 1)`) | warning | verified — 1 falsification input (this transcript), exit 1; the script's 5 negative controls are separately covered under QA-03 below; not automatic |
| E5's UNPROVABLE-marker gate (the equivalence-class discipline for `.biometryCurrentSet` invalidation) | ACC-04 | live-simulator | `scripts/run-ios-biometry-experiments.sh:136` (FAIL-path `exit 1`) | gate fires when the marker is moved outside the equivalence class with the mandatory `E5 UNPROVABLE --` line stripped (`.planning/phases/37-konto-unlock-has-em-i-biometria/37-05-SUMMARY.md:299-302`) | critical | verified — 1 falsification input, exit 1 (confirmed by direct source inspection); not automatic |
| E3-alt falsification: the app's own gating code must never reach `SecItemCopyMatching` without a successful LA evaluation | ACC-04 | live-simulator | `ios/PasskeyVault/PasskeyVaultTests/BiometricGateSimulatorTests.swift:417` (`E3AltTests`) | real red transcript from an inverted assertion, reverted (`.planning/phases/37-konto-unlock-has-em-i-biometria/37-05-SUMMARY.md:52-53`); `xcodebuild test` reports exit 65 on any Swift Testing failure (this project's own established convention) | warning | verified — 1 falsification input, exit 65; not automatic |
| Cross-reference to **H-04** (opaque-handle audit CI-wiring gap): the FFI-02 gate was EXTENDED in this phase to a third shape (Record structs carrying a handle field alongside a raw-byte field), demonstrated failing on an injected field, then reverted | ACC-02 | real-bytes | `scripts/audit-ffi-opaque-handles.sh:1` | `PASS on real bindings; falsified (shape C via injected FfiAuthMaterial.raw ...) and reverted` (`.planning/phases/37-konto-unlock-has-em-i-biometria/37-02-SUMMARY.md:126, 237`); the script's own FAIL branches call `exit 1` (per its Phase 35 disposition, WR-05 row, this file's own convention) | warning | verified (the extension itself) — 1 falsification input, exit 1; not automatic (`gate_ffi_opaque` DOES compose the base script into `check-ios-gate.sh`, but H-04's own finding stands: `.github/workflows/ci.yml` still does not invoke the script directly, and the composed gate only checks freshness, not this specific shape-C scan's own currency) |
| Cross-reference to **H-09** (round-trip test intermediate-check regression risk, WR-12): the assertion survived this phase's module-ownership move UNMODIFIED in substance | FFI-05 | real-bytes | `ios/PasskeyVault/PasskeyVaultTests/FfiRoundTripTests.swift:107` | `Array(wrapped.ciphertext) != originalUserKeyBytes` — `Phase 35's five tests ... survive the move unmodified in substance` (`.planning/phases/37-konto-unlock-has-em-i-biometria/37-02-SUMMARY.md:121, 148-149`) | warning | inherited — WR-12's original Phase 35 falsification still stands; not re-demonstrated here, correctly labelled inherited |

### QA-03 — absence-shaped assertion pass

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| `verify-ios-server-contract.sh`'s 5 negative controls (31-byte `auth_hash` → 400, 15-byte salt → 400, unknown-email vs wrong-hash → byte-identical 401 body, case-sensitive `Bearer` parsing → 401) | ACC-01 | live-run | `scripts/verify-ios-server-contract.sh:1` | `PASS register-31-byte-auth-hash-400` etc., 12/12 in one transcript (`.planning/phases/37-konto-unlock-has-em-i-biometria/37-03-SUMMARY.md:309-320`) | warning | verified — same-mechanism positive control: each negative row runs the identical request shape as its happy-path sibling in the SAME transcript, only the input is invalid |
| `grep -c 'case errSecAuthFailed' BiometricGateSimulatorTests.swift` → 0 (no security branch distinguishes members of the "unusable" OSStatus equivalence class) | ACC-04 | real-bytes | `ios/PasskeyVault/PasskeyVaultTests/BiometricGateSimulatorTests.swift:1` | `grep -c 'case errSecAuthFailed' ...` → `0` (`.planning/phases/37-konto-unlock-has-em-i-biometria/37-05-SUMMARY.md:311`) | info | gap — no falsification transcript demonstrates this specific grep catching an injected `case errSecAuthFailed:` branch; the equivalence-class DISCIPLINE is exercised live (three-bucket classifier), but this exact absence-grep was never shown able to fail |
| `grep -c 'guaranteed' ios/PasskeyVault/PasskeyVault --include=*.swift` → 0 (clipboard/wording never overclaims a guarantee) | UI-07 | real-bytes | `ios/PasskeyVault/PasskeyVault/Core/Keychain/UkEnvelopeStore.swift:1` | no falsification transcript within Phase 37's own SUMMARYs; the SAME check is exercised with a genuine catch later, in Phase 38's `ClipboardService.swift` wording (see that phase's QA-03 table) | info | gap (within Phase 37's own scope; Phase 38 extends the same discipline with better evidence) |
| No `LAContext` held as a stored property anywhere (fresh-per-call discipline) | ACC-04 | real-bytes | `ios/PasskeyVault/PasskeyVault/Core/BiometricUnlockService.swift:1` | `No \`LAContext\` is held as a stored property anywhere (grep-guarded)` (`.planning/phases/37-konto-unlock-has-em-i-biometria/37-04-SUMMARY.md:137`) | warning | gap — stated as grep-guarded but no injected-then-caught transcript is quoted in the cited SUMMARY |
| `touchIDAuthenticationAllowableReuseDuration` absent from the whole app source | ACC-04 | real-bytes | `ios/PasskeyVault/PasskeyVault/Core/BiometricUnlockService.swift:1` | grep-guarded, no counter-example transcript (`.planning/phases/37-konto-unlock-has-em-i-biometria/37-04-SUMMARY.md:133-134`) | warning | gap |
| Phase-closing SC1/SC3 gate: `git diff --stat crates/pv-server` empty, checked via a commit-position comparison (`df53333` a strict ancestor of `120b227`) with the REVERSED comparison demonstrated to fail | ACC-01 | real-bytes | `ios/IOS-SPIKE-LOG.md:243` (DR-1's own decision, cross-referenced by the commit-position gate cited in the SUMMARY below) | `SC3 (commit-position comparison -- df53333 (ACC-03) is a strict ancestor of 120b227 (first Phase-37 code commit), reversed comparison fails, confirming discrimination)` (`.planning/phases/37-konto-unlock-has-em-i-biometria/37-05-SUMMARY.md:169-171`) | warning | verified — the reversed comparison is the same-mechanism negative control, and it was shown to fail, confirming the forward comparison is not vacuous |

## Phase 38 — Pełny interfejs vaulta

**Audited plans:** 38-01 through 38-13 (`summaries=13 plans=13`, `MACHINE|38|...|13|13|IN-COVERAGE`). No
`UNSUMMARIZED` `*-PLAN.md` — the empty list, per the acceptance criterion. One SUMMARY (38-03) is a
retroactive reconstruction (the original executing agent died mid-plan and its local SUMMARY did not
survive; `.planning/` is local-only in this worktree) — read and audited as such, its own provenance
note quoted below rather than treated as a live transcript. Cross-phase correction check: the seeded
hazard checklist (H-13) names the phase-38 item-type count as wrong and the field model as not living
where its criterion assumes — checked directly below (L-15).

### QA-01 — evidence-tier pass (crypto / bytes / time / server claims)

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| L-15 cross-phase correction (task-mandated check): the item type union has SIX members (`login\|card\|identity\|note\|totp\|passkey`), not the ROADMAP/REQUIREMENTS' stated five — the create surface exposes five, but the decode path must tolerate and render the sixth (`passkey`) or silently drop a browser-extension-created row | UI-03 | real-bytes | `packages/pv-ui/vault/types.ts:4` (source of truth) / `ios/PasskeyVault/PasskeyVault/Vault/ItemFields.swift:162` (Swift mirror) | `export type ItemType = "login" \| "card" \| "identity" \| "note" \| "totp" \| "passkey";` (`ios/IOS-SPIKE-LOG.md:3237-3250`) | critical | verified — and independently re-confirmed by `.planning/phases/38-pe-ny-interfejs-vaulta/38-VERIFICATION.md:68` (`bash scripts/check-item-type-parity.sh` → exit 0, 6 members identical on both sides), not merely re-quoted from the phase's own SUMMARY |
| `.planning/phases/38-pe-ny-interfejs-vaulta/38-01-SUMMARY.md`'s own note-worthy self-correction: the plan's `awk` range for counting `### DR-38-[ABCDE]` subsections was "a check that cannot PASS" (the inverse of the usual failure family) — the range's own END pattern matched its START line, zeroing every count | n/a (build-script/verification correctness, not a crypto claim) | n/a | `.planning/phases/38-pe-ny-interfejs-vaulta/38-01-SUMMARY.md:24-28` | `the range's END pattern \`^### \` matches the range's own START line, so awk closes the range on line 1 and every count comes back \`0\`` | info | verified — documented and corrected, not silently patched |
| `wire.rs`'s four new pv-ffi exports (`encrypt_item_wire`/`decrypt_item_wire`/`encrypt_item_combined_json`/`decrypt_item_combined_json`) reject a base64-shaped envelope and require the JSON-array nonce shape (DR-38-C) | UI-01/UI-03 | real-FFI | `crates/pv-ffi/tests/wire_shape.rs`, `.planning/phases/38-pe-ny-interfejs-vaulta/38-02-SUMMARY.md:19-33` | `enc_key.nonce must be a JSON ARRAY of numbers ... it is String(...); A JSON string here is the base64 hazard DR-38-C exists to prevent` (RED transcript, 4 of 7 tests failed under the mutation) | critical | verified |
| E-W1: two-direction cross-client wire proof for VAULT ITEMS (not just the account envelope) — iOS writes, real `pv-wasm` decrypts, and vice versa, with a genuine falsification producing a `pv-server` `201` on a wrong-shaped row | UI-01 | live-run | `ios/evidence/38/EW1-CROSS-CLIENT-WIRE.md`, `.planning/phases/38-pe-ny-interfejs-vaulta/38-02-SUMMARY.md:152-169` | `E-W1 D1 (iOS -> pv-wasm): PASS` / `base64-shaped row: rejected -- invalid type: string ... expected a sequence` | critical | verified — and the finding that "`pv-server` answered `201` to the base64-shaped row" is recorded as a QA-03-relevant observation (server-visible ≠ correctly-shaped), see the QA-03 table below |
| The rejection-sampling generator's bias test: the PLAN'S OWN literal falsification recipe (`raw_u32 % max`) does NOT produce a detectable chi-square failure at this modulus (mathematically undetectable at feasible sample sizes) — a second, more severe single-byte-modulo substitution was required to actually demonstrate the guard can fail | UI-06 | real-bytes | `crates/pv-core/src/generator.rs:285` (`distribution_over_all_classes_does_not_reject_uniformity_at_p_001`), `.planning/phases/38-pe-ny-interfejs-vaulta/38-04-SUMMARY.md:217-233` | `2**32 mod 87 = 16, a bias fraction of 16 / 4294967296 ≈ 3.7e-9 ... Detecting a bias this small ... would need on the order of 10^14-10^15 draws` | critical | verified — this is exactly the QA-02 nuance this register's own task text warns about (a falsification proving less than it appears to); recorded as the finding, with the second, genuinely-discriminating mutation (chi-square 1228.77 vs. critical value 132.277) as the actual proof |
| EFF wordlist byte-for-byte parity with the TypeScript source, pinned by SHA-256 from two independent directions (Node re-deriving from TS, Rust asserting its own compiled array) | UI-06 | real-bytes | `crates/pv-core/src/generator.rs:193` (`wordlist_digest_matches_typescript_source`); `scripts/check-wordlist-parity.mjs:1` | `wordlist parity OK -- 7776 words, digest abae49761b88f3f1ba31ef944bea1f61b795a3cd7e1cfb7d276ed45bf77967ba` (`.planning/phases/38-pe-ny-interfejs-vaulta/38-04-SUMMARY.md:179-215`, both directions independently falsified by swapping two entries) | warning | verified |
| DR-38-A amended: measured (not assumed) `pv-wasm` `.wasm` size delta from the new generator module, +545 bytes across two independently-built worktrees, each rebuilt twice for determinism | UI-06 | real-bytes | `.planning/phases/38-pe-ny-interfejs-vaulta/38-04-SUMMARY.md:239-251` | `Before ... 1,398,081 bytes / After ... 1,398,626 bytes / Delta +545 bytes (~0.04%)` | info | verified |
| The snapshot-cover decoder (`scripts/snapshot-blockmap.py`) validated against REAL Calendar app-switcher content before ever being trusted as evidence for this app's own cover | UI-08 | real-bytes | `.planning/phases/38-pe-ny-interfejs-vaulta/38-05-SUMMARY.md:90` | `198,112 blocks, 10,109 non-flat, 3,259 distinct on the full-resolution copy ... both PNGs legible ("August", "Monday — Aug 17, 2026", hour labels)` | warning | verified |
| E-S1: the real app, backgrounded via a genuine `XCUIDevice.shared.press(.home)`, produces a snapshot that decodes to a single cover-coloured block (`nonflat=0 distinct=1`) matching `PVBackground`'s literal RGB exactly | UI-08 | live-simulator | `.planning/phases/38-pe-ny-interfejs-vaulta/38-05-SUMMARY.md:92` | `nonflat=0 distinct=1; the two live app-switcher directories matched PVBackground's literal RGB exactly (fcfbfa light / 1f1f1f dark)` | critical | verified |
| Optimistic-concurrency `VaultStore.update`: sends the item's CURRENT revision, refuses over an `undecryptable` row BEFORE any network request, mutates local state only AFTER the awaited call returns — proven against a REAL stale-revision conflict on a live `pv-server` (a second writer bumps the row, the phone's stale save is refused) | UI-03 | live-run | `PasskeyVaultTests/VaultMutationTests.swift#aLiveStaleRevisionConflictIsSurfacedAndDoesNotOverwrite`, `.planning/phases/38-pe-ny-interfejs-vaulta/38-09-SUMMARY.md:110` | `a second writer bumps a row to revision 2, the phone's stale (revision-1) save is refused with \`VaultAPIError.revisionConflict\`, and the local copy is asserted unchanged afterward, then confirmed via GET /api/sync that the OTHER writer's edit is the one that stuck` | critical | verified |
| The folder direction of the cross-client proof (F1/F2/F3): folder identifiers are minted BEFORE encryption on both clients; F3 deliberately mints the id AFTER encryption and the row fails to decrypt on BOTH iOS's own next refresh AND `pv-wasm` | UI-04 | live-run | `.planning/phases/38-pe-ny-interfejs-vaulta/38-09-SUMMARY.md:258-291` | `Folder-F3 (iOS-side falsification): PASS ... server-visible: YES ... pv-wasm decrypt: FAILED as required -- decryption failed (wrong key or corrupted data)` | critical | verified |
| `crates/pv-ffi::totp_now` — RFC 6238 boundary export, tested against literal published test vectors, cross-checked against an independently-validated Python oracle (`scripts/totp-oracle.py`) that was itself falsified against RFC 6238 Appendix B BEFORE being trusted for any comparison | UI-05 | real-FFI | `crates/pv-ffi/src/totp.rs`, `.planning/phases/38-pe-ny-interfejs-vaulta/38-10-SUMMARY.md:106-119` | `Step zero (self-test against RFC 6238 Appendix B) run and falsified before ANY comparison was trusted` / `a 35-second continuity sample with exactly one transition at the period boundary and zero mismatches` | critical | verified |
| The lock-teardown weak-reference test: a store's `FfiUserKey` handle is proven RELEASED (not merely "getter reports nil") via a weak reference observed nil AFTER `lock()`, mid-render | UI-01 | real-FFI | `ios/PasskeyVault/PasskeyVaultTests/LockTeardownTests.swift:189` (`lockReleasesTheKeyHandleSoAWeakReferenceIsNilAfterward`) | `A weak-reference test as the strongest available proof a store released its only strong reference to a class-typed key handle` (`.planning/phases/38-pe-ny-interfejs-vaulta/38-11-SUMMARY.md:23`) | critical | verified — this is precisely the QA-01 discipline: a naive "property now reads nil" assertion could pass even with a leaked strong reference elsewhere; the weak-reference technique cannot |
| `ServerReachability.check` distinguishes `wrongServer` (200, foreign body) from `unreachable` (transport failure), never accepting on HTTP status alone — including a live run against a real `pv-server` | n/a | live-run | `.planning/phases/38-pe-ny-interfejs-vaulta/38-12-SUMMARY.md:241-256` | `Test serverAnswering200WithAForeignBodyReportsWrongServerNotReachable() passed` / `liveServerReportsReachable() ... ran for real (not skipped), proving the case against a genuinely live pv-server` | warning | verified |
| CR-02-shaped finding within Phase 38 (H-13's own sibling claim): the ORIGINAL 38-06 TOTP placeholder draft secret decoded to only 10 bytes, below the implementation's own 16-byte floor — a fresh "New Code" draft would have failed validation before any user input, found while writing the validator | UI-03 | real-bytes | `.planning/phases/38-pe-ny-interfejs-vaulta/38-09-SUMMARY.md:153-159` | `\`"JBSWY3DPEHPK3PXP"\`, which decodes to 10 bytes -- below the 16-byte/128-bit floor \`totp-rs\`'s own \`assert_secret_length\` (and this plan's validator) enforces` | warning | verified (fixed, Rule 1 bug) |

### QA-02 — guard pass (red before green)

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| `scripts/audit-generator-uses-ffi.sh` (E-G1, UI-06/SC4's own falsifiable four-check gate, replacing a ROADMAP wording that passes trivially on a generator that never calls Rust) — check 3 (positive, binding-symbol presence) initially FALSE-PASSED (exit 0) on a renamed symbol | UI-06 | real-bytes | `scripts/audit-generator-uses-ffi.sh:222` (`OVERALL: FAIL` branch, `exit 1`) | **PASS (wrong, exit 0 — a landmine)** before anchoring the pattern: `generatePassphraseRENAMED(...)` matched as a PREFIX (`.planning/phases/38-pe-ny-interfejs-vaulta/38-08-SUMMARY.md:150-155`) | critical | verified (post-fix, anchored on the literal open-paren) — 4 falsification inputs (2 negative, 2 positive checks, each independently mutated); check 3's own PRE-fix false-PASS (exit 0) is recorded as the finding, not softened; post-fix the mutation exits 1; not composed into `check-ios-gate.sh` |
| `scripts/check-wordlist-parity.mjs` / `wordlist_digest_matches_typescript_source` (two independent directions pinning one SHA-256) | UI-06 | real-bytes | `crates/pv-core/src/generator.rs:193` | `assertion \`left == right\` failed: wordlist digest moved` (Rust side, `cargo test` exits 101 on any failure per Rust's own standard convention) / `ERROR: wordlist parity FAILED` + `$ echo $? / 1` (Node side) (`.planning/phases/38-pe-ny-interfejs-vaulta/38-04-SUMMARY.md:179-215`) | warning | verified — 2 falsification inputs (one per independent direction, isolated), exit 101 (cargo) / exit 1 (node); not automatic |
| The rejection-sampling chi-square guard — see the QA-01 table's "literal recipe doesn't fail" row for the same claim's evidence tier | UI-06 | real-bytes | `crates/pv-core/src/generator.rs:285` | `chi-square statistic 1228.77019 rejects uniformity at p < 0.001` (`.planning/phases/38-pe-ny-interfejs-vaulta/38-04-SUMMARY.md:227-231`); `cargo test` exits 101 on the panicking assertion | critical | verified — 2 falsification inputs (one non-discriminating, one discriminating — both recorded, not just the one that worked), exit 101; not automatic |
| `SnapshotCoverOverlay`'s negative control (E-S1) — **the negative control CAUGHT A REAL BUG on its first run**: the SwiftUI "cosmetic-only" mirror covered unconditionally regardless of the UIKit mechanism's own disable flag, making the first run pass when it should have failed | UI-08 | live-simulator | `ios/PasskeyVault/PasskeyVault/App/SnapshotCover.swift:85` | first run: clean cover shown (WRONG — the confound is that a CLEAN read was the wrong answer, not that any script/test exited non-zero); after the fix: `nonflat=3954/3957 full-res, 2877/2975 downscaled`, marker secret legible in the block-map PNG (`.planning/phases/38-pe-ny-interfejs-vaulta/38-05-SUMMARY.md:123-129`) — `scripts/snapshot-blockmap.py` itself always exits 0 on a successful decode regardless of block-flatness (it reports a measurement, not a verdict); the pass/fail judgement is applied by the human/plan reading the printed `nonflat=` count against the expected value | critical | verified — 1 pre-fix confound + 1 genuine post-fix falsification; not automatic. The single strongest QA-02/QA-03 exemplar in this milestone: "a negative control that passes on its first run is not evidence — it is a confound waiting to be found" |
| `VaultMutationTests` ordering guard (local state must not mutate before the awaited network call returns) | UI-03 | unit-test-only (fake `URLProtocol` transport, real crypto in-process) | `ios/PasskeyVault/PasskeyVaultTests/VaultMutationTests.swift:169` | `Expectation failed: (store.items[0].fields?.name → "changed") == "original"` (`.planning/phases/38-pe-ny-interfejs-vaulta/38-09-SUMMARY.md:237-238`); `xcodebuild test` reports exit 65 on any Swift Testing failure (this project's own established convention) | critical | verified — 1 falsification input, exit 65; not automatic |
| `VaultMutationTests` refusal guard (undecryptable rows refused BEFORE any request is made) | UI-03 | unit-test-only | `ios/PasskeyVault/PasskeyVaultTests/VaultMutationTests.swift:198` | `expected error of type VaultStoreError, but ... PvApiError was thrown` AND `(VaultMutationStubURLProtocol.requestCount.read() → 1) == 0` — both failed, proving the request WAS attempted (`.planning/phases/38-pe-ny-interfejs-vaulta/38-09-SUMMARY.md:245-255`); exit 65 (Swift Testing convention) | critical | verified — 1 falsification input, exit 65; not automatic |
| `LockTeardownTests`' four RED-before-green demonstrations (navigation-path truncation, sheet dismissal, reveal-set clear, key-handle release) | UI-01 | real-bytes (unit-tested via a plain `@Observable` controller, no SwiftUI view hierarchy) | `ios/PasskeyVault/PasskeyVaultTests/LockTeardownTests.swift:189` | four independent per-component test failures, each reverted and 15/15 re-confirmed before the next (`.planning/phases/38-pe-ny-interfejs-vaulta/38-11-SUMMARY.md:272-299`); exit 65 each (Swift Testing convention) | critical | verified — 4 falsification inputs (one per teardown component), exit 65 each; not automatic |
| `DetailFieldTablesTests` mask-length independence + reveal-set clearing | UI-02 | unit-test-only | `ios/PasskeyVault/PasskeyVaultTests/DetailFieldTablesTests.swift:1` | 3 issues per mutation (mask branch changed to length-dependent dots; `revealedKeys = []` removed from `setItem`) (`.planning/phases/38-pe-ny-interfejs-vaulta/38-07-SUMMARY.md:221-245`); exit 65 (Swift Testing convention) | warning | verified — 2 falsification inputs, exit 65; not automatic |
| `TotpFfiTests`/`totp_now`'s RFC 6238 boundary (TDD RED, plus a digit-count-cast mutation falsification) | UI-05 | real-FFI | `crates/pv-ffi/src/totp.rs:1` | `5/7 failed` both times (stub, then mutated cast, `cargo test` exits 101), byte-identical restore confirmed by `diff` (`.planning/phases/38-pe-ny-interfejs-vaulta/38-10-SUMMARY.md:106-108`) | warning | verified — 2 falsification inputs, exit 101; not automatic |
| Cross-reference to **H-03** (slice gate device-half falsification, WR-10): reused UNMODIFIED across every `xcodebuild build`/`test` invocation in this phase's 13 plans, none re-demonstrating WR-10's falsification | FFI-04 | real-bytes | `scripts/build-ios.sh:337` | `.planning/phases/38-pe-ny-interfejs-vaulta/38-01-SUMMARY.md` (build invocations throughout) | warning | inherited — Phase 35's own falsification stands; automatic via `gate_ffi_build`/`gate_ffi_falsifiable` in `check-ios-gate.sh`, which invoke `scripts/build-ios.sh`/`--verify-falsifiable` on every gate run |
| Cross-reference to **H-06** (slice gate object selection, `pv_ffi*.o`, WR-03): used throughout Phase 38's real `xcodebuild` builds, never re-falsified within this phase | FFI-04 | real-bytes | `scripts/build-ios.sh:222` | `nm PasskeyVault.app/PasskeyVault.debug.dylib \| grep -c uniffi_pv_ffi` → `64` (`.planning/phases/38-pe-ny-interfejs-vaulta/38-02-SUMMARY.md:76-83`, an unrelated but corroborating real symbol-table read) | info | inherited — automatic via `gate_ffi_build` |

### QA-03 — absence-shaped assertion pass

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| `FaviconLoaderPersistenceProofTests` — the ephemeral `URLSession` leaves NO on-disk cache entry | UI-01 | live-run | `ios/PasskeyVault/PasskeyVaultTests/FaviconLoaderPersistenceProofTests.swift:40` | positive control at `:61` (`aDefaultURLSessionDemonstrablyLeavesADiskCacheEntryTheEphemeralLoaderDoesNot`) runs the IDENTICAL fetch through a default `URLSession`, against the SAME real network target (github.com), and genuinely shows a cache entry | warning | verified |
| "No `Data`-typed `Codable` property exists in the persistence path; no base64 call exists under `Vault/`" | UI-01 | real-bytes | `ios/PasskeyVault/PasskeyVault/Vault/VaultStore.swift:1` | `grep -rnE 'base64Encoded\|base64EncodedString' ... Vault --include='*.swift'` → 0 hits, then 1 hit after inserting `Data(id.utf8).base64EncodedString()`, then 0 after revert (`.planning/phases/38-pe-ny-interfejs-vaulta/38-02-SUMMARY.md:124-133`) | warning | verified |
| E-W1/F3's server-side observation: `pv-server` answers `201` to a base64-shaped (WRONG) row — the absence check ("no 4xx from the server") would have been vacuous evidence for correctness | UI-01 | live-run | `crates/pv-server/src/routes/vault.rs:1` (the unmodified route this observation concerns) | `pv-server answered 201 to the base64-shaped row` — the INVERSE shape this task's own text asks about, a positive-looking server response that is NOT evidence of correctness (`.planning/phases/38-pe-ny-interfejs-vaulta/38-02-SUMMARY.md:175-177, 219`) | critical | verified — flagged correctly as a non-evidence signal, never treated as a pass |
| `scripts/audit-ios-colour-tokens.sh` / no `.white` literal on any accent fill | n/a | real-bytes | `scripts/audit-ios-colour-tokens.sh:1` | documented FALSE POSITIVE in the plan's own literal grep (`.whitespacesAndNewlines` matches `"\.white"`); the semantically correct check demonstrated able to fail by inserting `.foregroundStyle(.white)` into `AuthView`, observed (`CHECK FIRED`), reverted (`.planning/phases/38-pe-ny-interfejs-vaulta/38-13-SUMMARY.md:283-303`) | warning | verified (on the corrected, semantically-precise check); the plan's own literal false-positive is recorded, not silently patched |
| `scripts/check-item-type-parity.sh` — the Swift item-type mirror matches `types.ts` exactly | UI-03 | real-bytes | `scripts/check-item-type-parity.sh:90` | `exit 2` with `"This is a broken check, not a passing one."` if it extracts ZERO case names — a deliberate defense against the exact "PASS reached by a broken query" shape this register hunts | warning | verified — the script's own header names the failure mode it defends against, a rare case of the guard documenting its own QA-03 discipline inline |
| `grep -c 'guaranteed' ios/PasskeyVault/PasskeyVault --include=*.swift` → 0 (clipboard/session wording never overclaims) — first caught a real pre-existing violation here (Phase 37's own version of this check had no catch) | UI-07 | real-bytes | `ios/PasskeyVault/PasskeyVault/Vault/ClipboardService.swift:1` | fired against a genuine pre-existing violation (`IdentityAddress.swift`, from 38-03, unrelated to clipboard), fixed by rewording (`.planning/phases/38-pe-ny-interfejs-vaulta/38-07-SUMMARY.md:186-192`) | info | partial — caught a real defect (strong positive signal) but was never itself falsified by injecting a NEW violation and observing the catch, so a silent regression in phrasing elsewhere is not provably catchable |
| `grep -c derive_master_key crates/pv-ffi/src/lib.rs == 1` — exactly one Argon2id pass on the auth-material path (Phase 37's own check, never re-derived by any Phase 38 plan despite building extensively on the account-creation surface) | ACC-01 | n/a | `crates/pv-ffi/src/lib.rs:1` | not re-verified anywhere in Phase 38's own SUMMARYs (noted for completeness) | info | n/a — a positive count check, not absence-shaped; out of this table's scope, recorded only as a coverage note |

## Phase 39 — Synchronizacja i cache offline

**Audited plans:** 39-01 through 39-07 (`summaries=7 plans=7`, per this task's own `bash
scripts/qa-audit-inventory.sh` run: `MACHINE|39|.../|7|7|IN-COVERAGE`). **`UNSUMMARIZED` plan list for
this range, quoted exactly as the inventory printed it: empty — the only `UNSUMMARIZED` lines the
inventory's live run produced are `42|.../42-07-PLAN.md` (this plan itself) and five `43-0N-PLAN.md`
entries, both outside the 39-41 range this task audits.** No plan in 39-41 needed its own direct read
beyond its SUMMARY.

Authority note, same discipline 42-06 established for 36-38: `39-VERIFICATION.md` (2026-08-19,
independently re-verified against commit `8c2e776`, AFTER two `fix(39):` review-fix iterations
totalling 29 commits) supersedes plan-SUMMARY narratives wherever the two disagree. Every row below
citing `39-VERIFICATION.md` is citing an independently re-run verdict, not a plan's own claim about
itself.

### QA-01 — evidence-tier pass (crypto / bytes / time / server claims)

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| `GET /api/sync?since=N`'s two response shapes measured against real bytes: `since=0` returns a non-empty `items` array; `since=<current>` returns `{"revision":1}` with **no `items` key at all** (D-12) | SYNC-01 | real-bytes | `.planning/phases/39-synchronizacja-i-cache-offline/39-VERIFICATION.md:50` | "6 PASS / 0 FAIL... Falsifiability control: `jq -e 'has(\"items\")\|not'` against the snapshot body exits **1** as required" | critical | verified |
| Live WebSocket push from a genuinely independent second client (real `crates/pv-wasm`, not a mock) observed by the real host app, twice on one connection, re-arm proven by frame count 1→2 | SYNC-01 | live-run | `.planning/phases/39-synchronizacja-i-cache-offline/39-VERIFICATION.md:51` | "Mutation driver is an independent Node process linking the REAL `crates/pv-wasm` artifact... not a mock" | critical | verified |
| `crates/pv-server`/`pv-core`/`pv-provider` genuinely untouched for the whole phase, diff gate demonstrated non-vacuous | SYNC-01 | real-bytes | `.planning/phases/39-synchronizacja-i-cache-offline/39-VERIFICATION.md:52` | "Verifier-run: `git log 7040cb5^..HEAD -- crates/` → empty... Diff gate demonstrated able to report a change... (touch `main.rs` → 1 insertion → `git checkout` → empty)" | warning | verified |
| Cold cross-process read (SYNC-02): the real credential-provider `.appex` reads the host's persisted App-Group cache with the host independently confirmed terminated (`launchctl list` BEFORE-present/AFTER-absent around a real `simctl terminate`, never inferred from the terminate command itself), digest byte-for-byte identical to what the host wrote | SYNC-02 | live-simulator | `.planning/phases/39-synchronizacja-i-cache-offline/39-VERIFICATION.md:53` | "host digest `336d7dd7…` == extension-reported digest `336d7dd7…`... `SC2-PROCESS: real-extension`, `SC2-VERDICT: proven`, in the sentence 39-02 fixed in advance (`sc2-real`)" | critical | verified |
| The cold read's success is platform-enforced, not vacuous: wrong sharing identifier → `resolve_failed`; cache deleted → `status=absent` (reads storage, never a stale in-process copy) | SYNC-02 | live-simulator | `.planning/phases/39-synchronizacja-i-cache-offline/39-VERIFICATION.md:54` | "wrong sharing identifier (`…NeverDeclared`) → `resolve_failed`; cache deleted → `status=absent`" | critical | verified |
| The cache admits ONLY ciphertext/revision-shaped fields at the type level (`CachedSnapshot.Item`), cross-checked against the standing gate's closed allowlist for exact correspondence, shown RED four separate ways | SYNC-03 | real-bytes | `.planning/phases/39-synchronizacja-i-cache-offline/39-VERIFICATION.md:55` | "cross-checked `audit-ios-cache-ciphertext.sh`'s closed allowlist (line 188) against the type — exact correspondence, no drift. Gate shown RED four ways" | critical | verified |
| UI renders an explicit last-successful-sync time sourced from the snapshot's own `syncedAtMs` field, one clock-free formatter shared by host and (39-07) the extension, both processes observed rendering the same instant with a control proving the comparison can say `DIFFERENT` | SYNC-04 | live-simulator | `.planning/phases/39-synchronizacja-i-cache-offline/39-VERIFICATION.md:57` | "One formatter, two processes, observed rendering the same instant (`FRESHNESS-MATCH: SAME`) with a control proving the comparison can say `DIFFERENT`" | warning | verified |
| Freshness timestamp does not advance on a failed pull (real `SIGTERM` to `pv-server`, confirmed dead by both empty `lsof` and a failing `curl`), and advances only on a pull the server actually answered (control: two confirmed pulls, timestamp genuinely different) | SYNC-04 | live-run | `.planning/phases/39-synchronizacja-i-cache-offline/39-VERIFICATION.md:58` | "forced pull → `syncedAtMs` unchanged (`1787095463124` → `1787095463124`). Control: two confirmed pulls 1.5 s apart... DIFFERENT" | critical | verified |
| The SYNC-05 decision record (no APNs silent push, the required-external-dependency reasoning, the accepted user-visible consequence) lives in `SyncCoordinator.swift`'s own source with its reasoning, gated by a standing script shown RED three separate ways | SYNC-05 | n/a (decision-record correctness, not a crypto/bytes claim, but gate-verified against real source) | `.planning/phases/39-synchronizacja-i-cache-offline/39-VERIFICATION.md:61` | "`audit-sync-decision-records.sh` → exit 0. Gate shown RED three ways in `05-gates.md` (wrong root; reasoning removed but token kept; FILL-03 marker removed)" | warning | verified |
| Ciphertext moves verbatim wire→cache, byte-identical to what the server sent — bridging is four field-for-field conversions with no re-encode, live proof itself falsified via a deliberate one-character corruption | SYNC-03 | real-bytes | `.planning/phases/39-synchronizacja-i-cache-offline/39-VERIFICATION.md:64` | "`enc_key` and `enc_data` digests IDENTICAL between same-session `curl` and the persisted store... Live proof itself falsified (`PV_TRACER_FALSIFY_ONE_CHAR=1` → exit 1, named the mismatch)" | critical | verified |
| DR-40-A's wire-encoding risk (H-01's own hazard shape, first surfaced here as D-13): `enc_key.nonce` is a `serde_json` **number array**, never a base64 string — confirmed live against a real server row before any Swift decoder existed | SYNC-01 | real-bytes | `.planning/phases/39-synchronizacja-i-cache-offline/39-01-SUMMARY.md:107` | "`items[0].enc_key`, parsed as JSON, has a `.nonce` member whose type is `\"array\"` — the `serde_json` number-array shape, not the base64-string shape Swift's `Codable` would default to" | critical | verified — see the wire-encoding hazard subsection below (Task 2) for the milestone-wide disposition |

### QA-02 — guard pass (red before green)

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| `scripts/audit-ios-cache-ciphertext.sh` (SYNC-03's permanent gate: existence, positive receiver-side byte equality, closed key allowlist, live canary) | SYNC-03 | live-run | `.planning/phases/39-synchronizacja-i-cache-offline/39-05-SUMMARY.md:85-92` | "Four red runs for the cache gate, all against real defects on a real simulator cache: (1) a decrypted-password field... trips Check 2... (2) the SAME leaking cache, re-checked with Check 2 temporarily disabled in the gate script itself, trips Check 3 independently... (3) a harmless non-secret marker key alone trips Check 2... (4) the cache artifact deleted... trips Check 0" | critical | verified — 4 falsification inputs, each independently returned to green; not composed into `check-ios-gate.sh`'s six named sub-gates (a live-server, parametrized gate, consistent with `scripts/check-ios-gate.sh`'s own composed set) |
| `scripts/audit-sync-decision-records.sh` (SYNC-05's permanent gate) | SYNC-05 | real-bytes | `.planning/phases/39-synchronizacja-i-cache-offline/39-05-SUMMARY.md:93-96` | "Three red runs for the record gate: pointed at a directory carrying no sync source (distinct \"vacuous run\" message); the reasoning sentences stripped while the token stayed... the `FILL-03` marker renamed away" | warning | verified — 3 falsification inputs, exit 0 on restore; not composed into `check-ios-gate.sh` |
| `SyncDecodeTests` (6 tests): the up-to-date branch structurally cannot reach the cache writer with an empty collection (D-12) | SYNC-03 | real-bytes (decodes 39-01's own live-captured response bodies, never a hand-written fixture) | `.planning/phases/39-synchronizacja-i-cache-offline/39-03-SUMMARY.md:106` | "RED-before-green demonstrated by temporarily making the up-to-date branch synthesize an empty snapshot — both the unit test and (by the same code path) the live proof's third assertion would fail under that mutation" | critical | **partial — see the LESSON below.** These two tests were RED at HEAD as of Phase 41's own verification (39-VERIFICATION was written BEFORE Phase 40's `6701e61` broke them; 41-VERIFICATION's own Deferred #1 records the regression). Fixed today, before this plan ran, in commit `5e9ef99` (see the LESSON entry in Task 2 below) — not re-verified live by this register, cited as the fix commit exists and is on this branch |
| `SyncSocketTests.swift` (7 tests against a fake transport): re-arm, exactly-one-pull-per-frame, intentional-stop-prevents-reconnect, stale-connection isolation, idempotent restart, doubling+jittered backoff — explicitly disclaimed in its own header as NOT SYNC-01 evidence | SYNC-01 | unit-test-only (fake transport, disclaimed by its own header) | `.planning/phases/39-synchronizacja-i-cache-offline/39-04-SUMMARY.md:86-87` | "RED-before-green, twice, plus three binding-spelling mutations: with the re-arm line removed, the second-frame test fails... with the intentional-stop latch moved after the cancel call, the stop-prevents-reconnect test fails" | info | verified (as unit-test-only evidence for lifecycle plumbing; the live claim itself rests on the two-push proof row above, not this row) |
| `SyncSocket.wsURL`'s `+`-in-query encoding bug (L-23): found live via a genuine 401 against a real session token, root-caused with a local TCP relay proxy, not inferred from source reading | SYNC-01 | real-bytes | `.planning/phases/39-synchronizacja-i-cache-offline/39-04-SUMMARY.md:123-130` | "`pv-server`'s `axum::extract::Query` decodes with `application/x-www-form-urlencoded` semantics... where an unescaped `+` decodes as a space... re-sniffed via the same proxy — the identical `+`-bearing token now arrives pre-encoded (`%2B`)" | warning | verified (Rule 1 bug, fixed and landmine-recorded, `ios/IOS-SPIKE-LOG.md` L-23) |
| E-S4: whether a backgrounded socket on this simulator actually loses its connection is MEASURED, not assumed — a consistency-gate falsified against a deliberately inconsistent block first | SYNC-04 | live-simulator | `.planning/phases/39-synchronizacja-i-cache-offline/39-04-SUMMARY.md:91` | "**Result: no close fired; all 12 frames arrived in a burst at the instant of foregrounding.** Classified Result B (this Simulator does not reproduce device suspension)" | warning | verified — the honest negative measurement IS the finding; downstream 39-06 correctly used the server-stop proof path instead |
| Two review-fix iterations over `fix(39):` (19 + 8 commits): iteration 2 independently re-verified iteration 1's 21 claimed fixes and found 3 not fully resolved plus 4 new defects the fixes themselves introduced, all 8 then fixed and re-verified | SYNC-01/03/04 | n/a (process-integrity claim, backed by the code-level rows above) | `.planning/phases/39-synchronizacja-i-cache-offline/39-REVIEW-FIX.md:23` | "Iteration 2 is a verification pass over the 19 `fix(39):` commits from iteration 1, and found 3 findings reported fixed that were not... plus 4 new defects introduced by iteration 1's fixes themselves" | warning | verified — this is exactly the QA-02 discipline this register enforces, applied by the phase to its own prior claims |

### QA-03 — absence-shaped assertion pass

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| The extension's `nm`/`strings` inspection initially returned zero matches for a real, correctly-running module — a false absence found and corrected (Xcode links real code into a sidecar `.debug.dylib` in Debug, not the plain executable) | SYNC-02 | real-bytes | `.planning/phases/39-synchronizacja-i-cache-offline/39-07-SUMMARY.md:130-136` | "The gate now inspects `PasskeyVaultAutoFill.debug.dylib` when present (52 matches for `AppGroupCiphertextCacheStore`)" | info | verified — a genuine same-mechanism control fix, not a silently-accepted absence |
| The FAKETEAMID discipline check (no literal team-prefix string anywhere this plan's diff touches) — demonstrated as this plan's OWN diff, not the whole file's occurrence count, because the whole-file count is nonzero for a legitimate, pre-existing reason (L-8's own documentation) | QA-05 (durable-sink discipline) | real-bytes | `.planning/phases/39-synchronizacja-i-cache-offline/39-02-SUMMARY.md:160-167` | "`git diff --unified=0 41aa287~1 6cd5cc6 -- ...\| grep '^+' \| grep -v '^+++' \| grep -c FAKETEAMID` returns `0`" | warning | verified — same-mechanism positive control (the plan's own diff, not the file's lifetime total) |
| E2's App-Group / E3's keychain negative controls (36-inherited pattern, re-confirmed live in the 39-07 cold-read harness): wrong sharing identifier and a deleted cache both fire distinctly | SYNC-02 | live-simulator | `.planning/phases/39-synchronizacja-i-cache-offline/39-VERIFICATION.md:54` | "wrong sharing identifier (`…NeverDeclared`) → `resolve_failed`; cache deleted → `status=absent`" | critical | verified |
| `TBD`/`FIXME`/`XXX` debt-marker scan across all 37 changed source files | n/a | real-bytes | `.planning/phases/39-synchronizacja-i-cache-offline/39-VERIFICATION.md:142` | "0 hits" | info | verified — same-mechanism scan, not merely "nothing found" (the verifier's own scoped-file-list is the positive control: the scan ran against a known-nonzero-file-count set) |
| The verifier's own vacuity self-correction: `-only-testing:` selectors without a trailing `()` silently select zero Swift Testing tests while `xcodebuild` reports `** TEST SUCCEEDED **` and exit 0 | n/a | real-bytes | `.planning/phases/39-synchronizacja-i-cache-offline/39-VERIFICATION.md:146` | "the first scoped `VaultMutationTests` run reported `** TEST SUCCEEDED **` with exit 0 while its xcresult read `total 0, passed 0`... Every count in the two rows above is read from the xcresult bundle, not from the \"TEST SUCCEEDED\" banner" | critical | verified — this is the L-30 landmine (Phase 40 names it explicitly; here it is the verifier catching the SAME toolchain trap independently, one phase earlier) |

---

## Phase 40 — Rodzina i współdzielenie na telefonie

**Audited plans:** 40-01 through 40-10 (`summaries=10 plans=10`, per this task's own inventory run:
`MACHINE|40|.../|10|10|IN-COVERAGE`). **`UNSUMMARIZED` plan list for this range: empty** (same live
inventory run quoted under Phase 39 above — no `40-*-PLAN.md` lacks a matching SUMMARY).

Authority note: `40-VERIFICATION.md` is a **re-verification** (2026-08-20, HEAD `9ca0141`, after a
gap-closure cycle `c9fc54e..9ca0141`) — the FIRST verification pass scored 3/6 with `status:
gaps_found`; this register cites the re-verification's own re-run evidence, never the pre-fix pass,
and names the closed gaps explicitly below because DR-42-C's "found-state survives the fix" principle
applies to a phase's own verification history exactly as it applies to this register's later
corrections.

### QA-01 — evidence-tier pass (crypto / bytes / time / server claims)

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| **DR-40-A, the wire-encoding decision this phase made BECAUSE of H-01's hazard shape**: every new sharing-related `#[uniffi::export]` returns/accepts `String`-JSON produced by `serde_json`, never a UniFFI `Record`-of-`Data` — rejected explicitly because Swift's `JSONEncoder` would encode `Data` as base64 while `serde_json` encodes byte arrays as JSON number sequences | FAM-04 | n/a (decision record; the crypto claim it protects is the E-W2 rows below) | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-01-SUMMARY.md:107` | "rejected UniFFI `Record` with `Data`/byte-array fields... Swift's `JSONEncoder` would encode `Data` as base64 while `serde_json` encodes `Vec<u8>`/`[u8; N]` as JSON number sequences, so a `Record` hands the wire format to Swift instead of fixing it in Rust" | critical | verified — the milestone's clearest documented case of a phase independently rediscovering H-01's exact hazard shape and mitigating it at the design layer before writing code |
| E-W2 direction A: identity keypair wire-shape (`wrapped_secret_key.nonce` is a JSON array), iOS writes, real `pv-wasm` reads — falsification control quotes the SAME bytes re-encoded as Swift's `JSONEncoder` would (base64), showing the two encodings are textually distinguishable | FAM-04 | real-bytes | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-02-SUMMARY.md:172-179` | "`curl ... \| jq -e '.wrapped_secret_key \| fromjson \| .nonce \| type'` → `\"array\"`... Falsification control -- the SAME nonce bytes, re-encoded the way Swift's `JSONEncoder` would... → `\"string\"`" | critical | verified |
| E-W2 direction B: Collection Key wire-shape (`sealed_key.ephemeral_pk` is a 32-element JSON array), iOS creates a family-wide collection, real `pv-wasm` reads and decrypts its name, matching the literal iOS authored | FAM-04 | live-run | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-02-SUMMARY.md:229-234` | "`sealed_key.ephemeral_pk` is a JSON array of exactly 32 elements... receiver-side (real pv-wasm) decrypted the iOS-created collection's name and it matches the literal iOS authored" | critical | verified |
| E-W2 direction C (the reverse): real `pv-wasm` creates and shares a family-wide collection to the iOS account; iOS unseals the Collection Key and decrypts the name, matching a literal byte-for-byte, both a Rust-side and a Swift-side falsification demonstrated | FAM-04 | real-FFI | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-02-SUMMARY.md:236-240` | "web-owner created collection... and shared it to iOS... `Test webSealedCollectionKeyUnsealsOnIosAndNameMatchesLiteral() passed`" | critical | verified — this is the **settling observation** the wire-encoding hazard subsection (Task 2) asks whether the milestone ever performed: a real stored row's field TYPE inspected from both sides, in both directions, on a real server |
| SC1 — shared-BY-me vs shared-TO-me distinguishable on the list screen, real two-account, real shared item; regression-checked unchanged across the gap-closure commit range | FAM-04 | live-simulator | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-VERIFICATION.md:83` | "verifier-run `ShareMarkerTests/liveTwoAccountMarkerRun()` green... **re-proven live at the UI layer** by my two green `FamilyWiringLiveUITests` runs" | critical | verified |
| SC2 — invite from the phone redeemed by ANOTHER real client (the web app, real `pv-wasm`), roster read receiver-side with account A's own token showing B `active` with a distinct public key/fingerprint | FAM-02/FAM-04 | live-run | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-VERIFICATION.md:84` | "iOS authored the invite through the production `InviteService`/real pv-ffi... host-side node redeemed it through the **real pv-wasm artifact** `web/` itself imports... roster read **receiver-side**... shows B `active`, distinct `public_key`/`fingerprint`" | critical | verified — this is WR-08's carried-open finding from `40-REVIEW.md`, discharged in the gap-closure cycle; see Task 2's hazard-checklist cross-reference |
| SC3 — hidden password: exact interface-level-protection copy AND the key-holder CAN decrypt via direct FFI (E-F3), five honesty strings byte-identical to `main:dictionary.ts` | FAM-03 | real-FFI | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-VERIFICATION.md:85` | "verifier-run `AccessLevelTests/liveHiddenPasswordFfiRecovery()` green; five honesty strings byte-identical to `main:dictionary.ts`" | critical | verified |
| SC4 — invite-time-wrap AND lazy-reseal proven as two SEPARATE mechanisms, neither inferable from the other, through the PRODUCTION `ResealTrigger`/`ResealService` types (E-F6, the first live run in the phase able to make that claim) | FAM-04 | live-simulator | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-VERIFICATION.md:86` | "E-F4a/E-F4b with a discriminator falsified against itself; E-F6 through the production `ResealTrigger.run`" | critical | verified |
| GAP1 root-caused: `ContentView.vault(_:)` constructed `vaultStore`/`folderStore` **synchronously inside `body`'s own `switch` evaluation**, corrupting SwiftUI Observation tracking so a genuinely-populated store never rendered — independently re-checked (not narrative-trusted) against 4 separate code assertions, including the falsification of the verifier's OWN prior wrong hypothesis (a `hasNoFamily` latch) | FAM-01 | real-bytes | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-VERIFICATION.md:94-106` | "`VaultStore.swift` is **unchanged** by the fix; the merge was never the defect... My own leading hypothesis was falsified" | critical | verified — the milestone's clearest instance of "evidence that measures the wrong thing" being caught and corrected by re-driving the actual failing run rather than trusting a plausible narrative |
| Committed evidence transcripts corrected in place with dated `CORRECTION` blocks (never a silent rewrite) after two transcripts were found to describe a cross-client counterpart that did not exist at the time they were written | n/a (documentation-integrity claim) | n/a | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-VERIFICATION.md:88` | "Both transcripts corrected in `9d03d83` with dated `CORRECTION, 2026-08-19` blocks **prepended**, original runs left untouched below" | warning | verified — same discipline this register's own `found-and-corrected` disposition applies to `ios/IOS-SPIKE-LOG.md` in Task 2 |

### QA-02 — guard pass (red before green)

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| `rewrap_item_key_for_collection`'s AAD binding (collection_id/item_id/revision), three separate named negative tests, one falsified per component via a targeted production-code hardcode (not a generic wrong-value swap) | FAM-04 | real-FFI | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-03-SUMMARY.md:20-21` | "Falsifiability demonstrated via a temporary, targeted production-code mutation (hardcode a caller-supplied AAD component to the value the specific negative test's own fixture used), run to RED, then reverted to GREEN" | critical | verified |
| Direct-share item-key path (`seal_item_key_for_recipient`/`decrypt_item_with_shared_key`): the raw Cipher Key never crosses the FFI boundary (T-40-11), Swift test builds the whole flow end to end through real FFI, no mock | FAM-04 | real-FFI | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-03-SUMMARY.md:59-71` | "seal_item_key_for_recipient (raw Cipher Key never leaves Zeroizing, never crosses the FFI boundary, T-40-11)... Swift test directShareItemKeySealsAndRecipientDecryptsPlaintext builds the whole flow end to end through the real FFI with no mock" | critical | verified |
| `scripts/audit-ffi-opaque-handles.sh`'s FFI-02 gate genuinely extended to shape D (a top-level free function returning bytes naming NO handle type) — closes a gap neither shape A nor shape B could have caught | FFI-02 | real-bytes | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-04-SUMMARY.md:21` | "Audit script shape D: a free top-level function returning Data/[UInt8] whose signature names NO handle type is a distinct leak shape from shape A (which requires a handle type in the signature) -- neither shape A nor shape B (class-method-scoped) could ever have caught it" | warning | verified |
| `ffi06-probe` `default = []` re-verified (not re-flipped — the flip already happened in Phase 36) against Phase 40's new surface, with a fresh falsification proof that the flag's placement in `scripts/build-ios.sh` is load-bearing | FFI-06 | real-FFI | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-04-SUMMARY.md:36` | "treated it as a re-verification: ran every literal acceptance-criterion check (grep, cargo build, xcodebuild test, falsification) against Phase 40's new surface, and recorded the honest history (re-verified, not re-flipped)" | warning | verified — see H-02 cross-reference in Task 2 |
| GAP1 delivery fix, re-driven live 2/2 GREEN on two FRESH isolated servers, where the SAME test failed 2/2 RED at the previous HEAD — the gate is proven non-vacuous by its own prior red | FAM-01 | live-simulator | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-VERIFICATION.md:87` | "run 1 passed in 195.290s, run 2 passed in 195.440s... the same command, same test, same harness failed twice before the fix" | critical | verified |
| The 409-singleton-family dead end fixed with a two-sided falsification test (true on the real thrown 409, FALSE on 500 and `invalidCredentials`) — a negative arm, so the predicate cannot pass by always returning true | FAM-02 | real-bytes | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-VERIFICATION.md:114` | "`isFamilyAlreadyExistsConflictDistinguishesA409FromOtherFailures()` asserts true on the real thrown 409 AND **false** on 500 and `invalidCredentials`" | warning | verified |
| WR-03 (removal-batch scoping mismatch, `RemoveMemberService.swift:267-273,299-307`): carried, genuinely still open — masked by a server-side singleton-family constraint, latent-not-reachable; correctly SKIPPED because the real fix needs a `pv-server` route change forbidden by this milestone's premise | FAM-02 | n/a (gap, not a false claim) | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-REVIEW.md:626` | "the removal batch's sets remain scoped differently from the server's guard" | warning | gap — correctly recorded open, not silently repaired (this phase's own DR-42-C-shaped discipline, applied before this register existed) |
| WR-08 (no artifact proved cross-client web/wasm redemption) — carried open at the END of `40-REVIEW-FIX.md`'s first pass, then explicitly discharged in the gap-closure cycle via `scripts/gap2-web-redemption-e2e.sh` + `InviteAuthoredForWebRedemptionTests`, re-run independently by the verifier | FAM-04 | live-run | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-REVIEW-FIX.md:284` | "GAP 2 -- SC2's web half, WR-08 discharged" | warning | **resolved (this register's own re-check, per the plan's explicit instruction to re-check WR-08's current true state rather than inherit the skip)** — `40-VERIFICATION.md:84`'s SC2 row above is the live re-run confirming the discharge holds at HEAD `9ca0141`, independent of the fix's own narrative |

### QA-03 — absence-shaped assertion pass

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| E-F0 falsification: pre-merge state genuinely fails (migration 0020 absent, `family_wide_access_level` zero hits), post-merge genuinely passes — same-mechanism control over the identical three checks | FAM-04 | real-bytes | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-01-SUMMARY.md:123-147` | "pre-merge (FAILING... 91 / (no output) / 0)... post-merge (PASSING... 0 / 0020_family_wide_access_level.sql / 19)" | warning | verified |
| DR-40-A/DR-40-B commit-order gate: falsified live by staging a scratch file under `crates/pv-ffi/` and amending it into the decision-record commit (exit 1), then reset and re-confirmed clean (exit 0) | n/a (process-integrity, decision-record-before-dependent-code discipline) | real-bytes | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-01-SUMMARY.md:149-158` | "with a scratch file staged under crates/pv-ffi/ and amended into the commit: ... 1 ... after git reset --mixed to the clean commit and removing the scratch file: ... 0" | info | verified |
| Standing Gates re-run at re-verification HEAD `9ca0141`: colour tokens, colorset parity, generator-uses-FFI, clipboard single-writer, SYNC-05 record, cache-ciphertext static arms, server-untouched, debt markers — all PASS, none silently skipped | n/a | real-bytes / live-run mixed | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-VERIFICATION.md:137-149` | "Server-untouched \| `git diff --stat c9fc54e~1..HEAD -- crates/` \| **empty** — no crate touched at all by the gap closure" | warning | verified |
| `TBD`/`FIXME`/`XXX` debt-marker scan over all 6 changed source files in the gap-closure range | n/a | real-bytes | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-VERIFICATION.md:149` | "0 hits" | info | verified |
| The verifier's own runtime-warning check: `xcresulttool get log` returns 0 lines for the green runs, so a `grep -c` over it would be vacuous — stated honestly as UNVERIFIED rather than reported as an absence either way | FAM-01 | n/a | `.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/40-VERIFICATION.md:106` | "**? UNVERIFIED — stated honestly.** `xcresulttool get log --type console` and `--type activity` both return **0 lines** for my green runs, so a `grep -c` over them is vacuous and I will not report it as evidence either way" | info | abstained — exactly the QA-03 discipline this register enforces: an absence check with no positive control is not evidence, and this phase's own verifier declined to claim one |

---

## Phase 41 — AutoFill dla haseł i poprawność blokady między procesami

**Audited plans:** 41-01 through 41-08 (`summaries=8 plans=8`, per this task's own inventory run:
`MACHINE|41|.../|8|8|IN-COVERAGE`). **`UNSUMMARIZED` plan list for this range: empty.**

**This is the cross-process phase — the only phase in the milestone where two independently-scheduled
OS processes exist at once — and per this task's own instruction it receives the deepest pass. Every
row below cites `41-VERIFICATION.md` (2026-08-20, commit `d0c3916`, after 2 review-fix iterations
totalling 33 `fix(41):` commits), which explicitly re-drove 4 of the 5 ROADMAP Success Criteria live
against the post-fix tree — because its own disconfirmation pass found that all 33 fix commits had
landed on top of evidence from BEFORE those fixes (every evidence-file commit timestamped 04:25–11:12,
the first `fix(41):` commit at 11:38), so trusting the original evidence would have been trusting a
stale run.**

### The four cross-process questions this task's own `<action>` names, each answered with its own citation

**Q1 — Is "an unlock in one process is honoured in the other" proven by observing the second process,
or by observing a flag the first process wrote? Only a positive receiver-side observation counts.**

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| Host unlock → AutoFill does NOT re-prompt: the passing evidence is a log line **emitted from inside the extension process itself** (`PVFILL|entry=silent stage=fill status=ok`), not a read of a flag asserted true by the host | FILL-07/ACC-06 | live-simulator | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:94` | "Run 1 (real biometric unlock): `PVLOCK\|entry=silent stage=lazy-check status=unlocked` → `PVFILL\|entry=silent stage=lock-check status=unlocked` → `stage=fill status=ok` — no prompt, positive receiver-side proof from inside the extension process" | critical | verified — this is the receiver-side observation the question asks for, not a writer-side flag |
| Expiry in the host is visible in the extension on its NEXT ACCESS: the host really deletes Secret C (`sessionkey-delete status=0`), then the extension independently confirms the deletion by attempting its OWN read and observing `errSecItemNotFound` (`-25300`), refusing at BOTH of its own entry points | ACC-06 | live-simulator | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:94` | "Run 2 (expiry): host detects it... really deletes Secret C (`sessionkey-delete status=0`, then `-25300` = errSecItemNotFound confirming absence), and the extension refuses at **both** entry points (`lock-check status=locked`)" | critical | verified |
| Extension-only activity (host never opened) refreshes the shared `unlockedAtMs` so the host still sees the session active — measured with real elapsed wall-clock time against a real 60-second window, not an offset hook, host reads the extension's own write on its next launch | ACC-07 | live-simulator | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:95` | "three extension-only fills at 13:54:08 / 13:55:01 / 13:55:46 each succeeded and wrote `activity-refresh writer=extension` — the third is **+127 s** past the host's refresh... Host relaunch... reads `host-launch-read writer=extension bootMatch=true` (receiver-side)" | critical | verified |
| **Residual, disclosed not hidden (W-3):** ACC-07's host-side *verdict* is never itself logged — the host records only `writer`/`bootMatch`, never its own unlocked/expired evaluation, so "the host still sees the session as active" rests on the marker level plus the shared `SessionLifecycle` code path, not a host-process log line stating its own conclusion | ACC-07 | n/a | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:259-263` | "`host-launch-read` records only `writer` and `bootMatch`, never an unlocked/expired evaluation... proven at the *marker* level and by the shared `SessionLifecycle` code path — not by a host-process log line stating its own verdict" | info | gap — honestly disclosed residual, not a defect this register repairs |

**Q2 — Is "a cold-started extension filled a credential" proven by a real field in a real browser on
the simulator, or by an API call having been made?**

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| Cold fill (host force-quit, no prior activity this simulator session): real `simctl shutdown`→`boot`, server confirmed unreachable, host app NEVER launched after boot, extension fills into a real Safari form field with byte-for-byte encoding proof over all 6 fields | FILL-05 | live-simulator | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:93` | "Real `simctl shutdown` 13:46:14 → `boot` 13:46:26; server unreachable (`curl` exit 7) with a paired server-UP falsification proving the check can fail; host app never launched; ... `PVUITEST\|E41-6\|status=ok identity-survived=true field-value-equal=true filled-length=18`" | critical | verified |
| The QuickType receiver-side round trip (SC1): a real system Sign-In sheet showing the MUTATED username after a fix, the STALE username before it — a same-mechanism negative control that could distinguish the two | FILL-03 | live-simulator | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:92` | "negative control 3a (choke point bypassed) shows the **stale** username in the live sheet, 3b (after the fix) shows the **MUTATED** username — the falsification L-34 demands... Screenshot `e41-2-quicktype-fresh-write-proof.png` shows a real system Sign-In sheet" | critical | verified — **but see W-2 below: this specific claim was NOT re-driven live at HEAD `d0c3916`; the choke-point mechanism WAS re-verified, the original QuickType screenshot evidence was carried, not reproduced this verification** |
| **Residual, disclosed not hidden (W-2):** SC1 and SC5 were not re-driven at this verification's own HEAD — their MECHANISMS were (the choke-point gate, the entitlement grep, the full fill chain), but the two specific live evidence artifacts (`e41-2`, `e41-8`) themselves were not re-run against the post-fix tree | FILL-03/FILL-04 | n/a | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:254-257` | "SC1 and SC5 were not re-driven at HEAD. Their mechanisms were... but `e41-2` and `e41-8` themselves were not re-run. Their outcomes are inferred from the re-proven mechanism plus the original evidence" | warning | gap — honestly disclosed, an inference from a re-proven mechanism, not a re-executed proof; recorded per this register's own "could this have failed?" standard |

**Q3 — Is the freshness/expiry claim measured against a real clock and a real wait, or against a value
the test supplied?**

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| ACC-06/07's real-elapsed-time proof, disconfirmed explicitly by the verifier's own pass: "is any truth resting on a green unit test that mocks the layer it claims?" — answered no, citing the specific real-time measurement | ACC-06/07 | live-simulator | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:300-303` | "the one place this could hide is the lock lifecycle — and it does not: `e41-7`'s ACC-06 leg uses **real elapsed time** (65 s against a 60 s window), not an offset hook, and shows the real `OSStatus` of the real Keychain delete plus the paired recreate" | critical | verified |
| **The relock-loop root cause (fixed today, before this register was authored, `d8d9c9b`): a lazy lock-state check collapsed `.expired` and `.indeterminate` ("the marker could not be read at all") to the same Bool, so an INCONCLUSIVE read drove the SAME routing decision as a genuinely evaluated expiry** | ACC-06 | real-bytes | `ios/PasskeyVault/Shared/SessionLifecycle.swift:105` (fixed by commit `d8d9c9b`) | "`SessionLifecycle.checkAndExpireIfNeeded` collapsed its own tri-state `LockState` (.unlocked/.expired/.indeterminate) to a Bool at its return statement... `checkAndExpireIfNeeded` now returns `LockState` directly; a new `LockState.mustRelock` (true only for `.expired`) is the single, tested, named contract" | critical | verified (fixed; see the closing verdict for the full account — this is the first of two Face ID relock loops found on real hardware after this phase's own verification closed) |
| **A SECOND relock loop (`df3e601`), found on Bartek's real iPhone 16 (iOS 27): `kern.bootsessionuuid` is unreadable from a sandboxed process on real hardware on EVERY call, and a missing input was classified identically to a genuine boot-identity mismatch — "a non-verdict routed as a verdict," the same shape as the first fix, found one layer deeper** | ACC-06 | real-bytes (real hardware, not simulator) | `ios/PasskeyVault/Shared/LockMarker.swift:61` (fixed by commit `df3e601`) | "`LockMarker.bootSessionId` is now `Optional<String>`; `isValid` refuses on the boot leg only when both sides are present and disagree... RED (1/25 fail) -> GREEN (32/32 pass), zero regressions across the full 501-test suite" | critical | verified (fixed) — the milestone's only claim in this register backed by REAL HARDWARE evidence, not the simulator; see closing verdict |

**Q4 — Is the offline claim proven with the host process genuinely force-quit and absent from the
session, or with it merely backgrounded?**

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| E41-6's cold/offline proof: `simctl shutdown` (a genuine terminate, not a background transition), server independently confirmed down (`curl` exit 7, a real connection-refused, paired with a server-UP falsification proving the unreachability check itself can fail), host app never launched after boot | FILL-05 | live-simulator | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:93` | "server unreachable (`curl` exit 7) with a paired server-UP falsification proving the check can fail; host app never launched" | critical | verified — genuinely force-quit (`simctl shutdown`), not backgrounded, matching Phase 39's own E-S4 finding that backgrounding alone does not sever a socket on this simulator and therefore is not an acceptable substitute for this claim |
| Cache-encoding host→extension proof: byte-for-byte over all 6 fields, cross-process, independent of the live/offline claim above but load-bearing for it (the extension must decrypt from cache alone, with no live server available to fall back to) | FILL-05 | real-bytes | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:150` | "digests match byte-for-byte across the process boundary (`e41-6-encoding.log`, 6 fields)" | critical | verified |

### Both hunted shapes 42-06 established, checked again here

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| No suite in this phase stubs the generated FFI bindings rather than linking the real framework — every crypto-touching claim in the four Q-tables above cites `real-FFI`/`live-simulator`/`live-run`, never `unit-test-only`, for the load-bearing rows | FILL-05/ACC-06/ACC-07 | n/a (cross-check over the tiers already assigned above) | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:196` | "e41-4/e41-6/e41-7 are all `live-simulator`" | critical | verified — no instance of the mocked-crypto shape found in this phase's load-bearing claims |
| `CredentialMatcher`'s fill-time gate has a criterion that COULD NOT have come out the other way, found and corrected LIVE mid-plan: the original hope (fill-time origin verification against the live page) was assumed achievable, then measured to be structurally impossible for `.domain`-typed identities before the record was finalized | FILL-02 | live-simulator | `ios/IOS-SPIKE-LOG.md:1831-1845` | "**CORRECTED FINDING (E41-3-policy, live this session) — the fill-time gate does NOT enforce origin equality against the live page for `.domain`-typed identities**... `request.credentialIdentity.serviceIdentifier` echoes our own registered `.domain` identity verbatim... a same-host-different-port or different-host VISIT is therefore structurally invisible to `CredentialMatcher` at the fill entry point" | critical | verified — this is exactly the "criterion that could not have come out the other way" shape 42-06 hunted, except caught and corrected by Phase 41 ITSELF, live, before the record was ever committed with the wrong claim — see WINDOWS #17 cross-reference in Task 2 |

### Remaining QA-01/02/03 rows (non-cross-process claims)

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| Third-party fill (FILL-04): entitlement dumps taken from the BUILT binaries carry no `associated-domains` key on either the app or the appex, positive fill on a domain with no relationship to this product, one-character password falsification driven RED then restored GREEN | FILL-04 | live-simulator | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:96` | "Entitlement dumps taken from the **built binaries**... carry no `associated-domains` key... Positive fill on `127.0.0.1:8770`... with a one-character expected-password falsification driven RED (exit 65) and restored GREEN" | warning | verified — **W-4 residual disclosed**: the third-party domain is loopback (`127.0.0.1`), not a registrable third-party DNS domain, chosen after a fresh `.localhost` subdomain failed to propagate to QuickType across 4 retries (L-38); human item, not a defect |
| `scripts/audit-ios-autofill-deprecated-apis.sh` + `scripts/audit-ios-identity-store-chokepoint.sh`: two standing gates, both wired into `.github/workflows/ci.yml`, both PASS at verification HEAD | FILL-03 | real-bytes | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:169-170` | "**AutoFill deprecated APIs** \| exit 0 — 108 Swift files, 0 skipped... **Identity-store choke point** \| exit 0 — allow-list holds, all 6 call sites reach their own required entry point" | warning | verified |
| L-33: the deprecated-overload trap's REAL trigger is the completion-handler call form, not array typing alone under `try await` — corrects the plan's own inherited assumption, found live | FILL-03 | real-bytes | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-04-SUMMARY.md:16` | "landmine L-33: the deprecated-overload trap's REAL trigger (completion-handler call form, not array typing alone under try await) -- corrects the plan's own inherited assumption" | warning | verified |
| L-34: `credentialIdentities(forService:)` returns empty on this simulator/toolchain regardless of a confirmed-durable write — the app-facing enumeration API is broken; QuickType's own system sheet became the working receiver-side proof instead, not a silently-accepted absence | FILL-03 | live-simulator | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-04-SUMMARY.md:17` | "landmine L-34: credentialIdentities(forService:) returns empty on this simulator/toolchain regardless of a confirmed-durable write; QuickType's own system sheet is the working receiver-side proof instead" | warning | verified — same discipline L-14's own "isolate the finding, prove the underlying capability via an independent channel" pattern established at scale |
| W-1 (verifier-observed live, not theoretical): the pre-WR-06 `identityPublishedKeys` upgrade reset makes every identity published before the upgrade unremovable on the incremental path — hit on the verifier's FIRST re-run attempt, not merely predicted | FILL-03 | live-simulator | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:241-252` | "This verifier hit its real effect on the first attempt to re-run `e41-4` at HEAD: a stale `e418-thirdparty-item` identity... survived a fresh whole-vault republish and was offered by QuickType ahead of the freshly-seeded item" | warning | gap — real, narrow, pre-release-only functional defect, honestly recorded, not repaired by this register (DR-42-C) |
| W-5: `removeAllPublished()`'s busy-retry (WR-05) and `unionIntoPublishedKeys`'s compare-and-swap (WR-06) carry NO automated test — no injectable `ASCredentialIdentityStore` mock exists in this codebase, stated as the reason rather than silently omitted | FILL-03 | n/a | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:271-274` | "inspection-verified only; the fixer states the reason (no injectable `ASCredentialIdentityStore` mock). WR-06 also only *narrows* the cross-process race, as its own comment says" | warning | gap — inspection-only, honestly disclosed as a structural test-seam limitation |
| Two review-fix iterations (33 `fix(41):` commits total) — the verifier's own disconfirmation pass explicitly checked whether the SUMMARY narrative was trusted anywhere and found it was not: every gate, the build, the scoped suites, and four live legs were executed in the verifier's own process | FILL-02/03/05/07/ACC-06/07 | n/a (process-integrity) | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:309-310` | "Was the SUMMARY narrative trusted anywhere? No. Every gate, the build, the scoped suites and four live legs were executed in this verifier's own process" | warning | verified |

---

## Closing verdict (plan 42-07, 2026-08-21)

**One command runs every gate in the milestone green** (`bash scripts/check-ios-gate.sh`, exit 0, six
sub-gates named as executed: `qa05 ffi_build ffi_falsifiable ffi_opaque swift_tests qa_register`), **and
`--verify-falsifiable` re-proves all six can fail, `qa_register` included**. Both were re-run live by
this plan, after the register edits above, so the last recorded state of the tree is the state that was
measured — per this plan's own closing instruction.

### Per success criterion — what holds and on what evidence

**SC1** (*"Przegląd wszystkich planów faz 35-41 potwierdza, per faza z konkretnym file:line dowodu:
każde twierdzenie dotykające krypto/realnych bajtów/realnego czasu/realnego serwera ma dowód real-FFI
lub live-run, nie tylko zielony `XCTest` mockujący warstwę"*) — **HOLDS, across all seven phases (35–41),
with 150 register rows carrying `file:line` evidence, evidence tiers drawn from the register's own fixed
set, and every claim citation quoted inline.** No load-bearing claim in this register rests on
`unit-test-only` alone — the two rows tiered `unit-test-only` (Phase 39's `SyncSocketTests`, Phase 37's
CR-02 wipe) are each explicitly disclaimed as NOT sufficient evidence for their own SYNC-01/ACC-01
claims, with the real live-run/real-FFI row that DOES carry the claim cited alongside. Per-phase scope:
35 (specimen, 15 rows), 36 (18 rows), 37 (16 rows), 38 (18 rows), 39 (24 rows, this plan), 40 (24 rows,
this plan), 41 (24 rows, this plan, cross-process given the deepest pass) — 150 total, `qa_register`'s
own count.

**SC2** (*"Co najmniej jeden guard z każdej fazy 35-41 dotyczącej bezpieczeństwa ... ma udokumentowany
dowód 'czerwony przed zielonym' przez mutację kodu produkcyjnego"*) — **HOLDS, one guard per phase, every
one with a real mutation and an observed failing output**: Phase 35 (CR-01 password zeroize path, CR-02
opaque-handle audit unbalanced-brace truncation), Phase 36 (`ios-memory-gate.sh measure`'s
self-referential-check-fixed-then-shown-red), Phase 37 (CR-01's Copy-on-Write wipe, mutation-driven),
Phase 38 (`SnapshotCoverOverlay`'s negative control catching a REAL bug on its first run), Phase 39
(`audit-ios-cache-ciphertext.sh`'s four red runs against real defects on a real simulator cache), Phase
40 (`rewrap_item_key_for_collection`'s AAD-binding negative tests, three components each individually
falsified), Phase 41 (`CredentialMatcher`'s data-integrity gate, falsified live by bypassing the guard
and observing the fill wrongly succeed). Per DR-42-B, this criterion is judged as prose-plus-`file:line`
evidence, never a heading grep — the mechanizable half (coverage, resolvability) is `qa_register`'s job
and it passes.

**SC3** (*"Nowy skrypt weryfikacyjny ... jest dowiedziony zdolny zawieść"*) — **HOLDS.**
`scripts/check-ios-gate.sh --verify-falsifiable` re-ran live by this plan, exit 0, and its own coverage
line names all six sub-gates as having been re-proved falsifiable in that invocation, `qa_register`
included (`R2` resolvability, `R3` parser-abort, both against `mktemp -d` scratch copies, zero mutation
of the real register — quoted transcripts above and in this plan's own SUMMARY). Every one of the
composer's own six sub-gates has its FAIL branch demonstrated reachable in this session.

**SC4** (*"Grep całego drzewa `ios/` i configu GSD potwierdza brak `.planning/` w historii gita tego
worktree"*) — **HOLDS in its restated form, not its literal ROADMAP wording, for a reason already
recorded twice before this plan (`.planning/ROADMAP.md`'s own ⚠️ SC4 note, and `scripts/check-ios-gate.sh`'s
own header "SECOND restatement") and restated here a third time so a future reader does not re-derive
it.** The ROADMAP's literal form (`git log --all --full-history -- .planning/` → empty) is structurally
unachievable — `--all` sweeps `main`/`origin/main` directly, and this branch inherits main's entire
`.planning/` history from the fork point. The ROADMAP's own FIRST restatement (`git log --oneline
6bbee65..HEAD -- .planning/` → empty) is **this plan's own literal Task-3 `<verify>` command** — and it
is ALSO no longer achievable, for a reason the ROADMAP's restatement note predates: Phase 40, Plan 40-01
merged 91 of `main`'s own commits into this branch (`1e0958a`) to pick up server-side migrations, 36 of
which touch `.planning/` (legitimate phase-30/31 web-extension planning docs, committed on `main` where
`commit_docs: true`). Run live by this plan:
```
$ git log --oneline 6bbee654a1a591970e7c6db4d7c933d580061b07..HEAD -- .planning/ | wc -l
36
```
This is NOT a QA-05 violation — `scripts/check-ios-gate.sh`'s own header names this exact fact as a
"SECOND restatement, discovered executing this plan (2026-08-20)" and `gate_qa05` was written against
it: the mechanized, actually-composed gate adds `--no-merges --not <exclude-ref>` (resolved to
`origin/main`), which removes both the reconciliation merge commit itself and every commit already
reachable from `main` — i.e. everything that arrived via legitimate sync rather than being authored on
`ios/spike`. Run live by this plan:
```
$ git log --oneline --no-merges 6bbee654a1a591970e7c6db4d7c933d580061b07..HEAD --not origin/main -- .planning/ | wc -l
0
$ bash scripts/check-ios-gate.sh --only qa05
PASS[qa05]: zero .planning/ commits authored on this branch itself since 6bbee654a1a591970e7c6db4d7c933d580061b07 (excluding $QA05_EXCLUDE_REF=origin/main; positive control: 334 commit(s) found under -- ios/; commit_docs precondition holds)
```
**The true claim SC4 protects — "no `.planning/` commit was ever AUTHORED on `ios/spike` itself" — HOLDS**,
proven by the mechanized `gate_qa05` (which passes) against the scoped, exclusion-aware query, not by
the ROADMAP's literal wording or its own first restatement (both of which this plan's own required verify
command reproduces as non-empty, for the fully-accounted-for reason above — not a finding, a
confirmation of an already-documented fact). A future reader following ROADMAP.md's own restatement note
alone, without also reading `scripts/check-ios-gate.sh`'s header, would re-derive a command that no
longer works; this closing verdict exists partly so that does not happen a third time.

### Complete gap list — every row dispositioned `gap` or `partial`, this milestone's outstanding-debt register

| # | Finding | file:line | Severity | Owner phase |
|---|---|---|---|---|
| 1 | H-02: `ffi06-probe` panic-probe ships in every Debug `PasskeyVault.app`, inherited unchanged by `PasskeyVaultAutoFill.appex` (no per-target build split); named owner Phase 41 never closed it | `crates/pv-ffi/Cargo.toml:44-47` | warning | 41 (named, unclaimed) |
| 2 | H-04: neither `scripts/audit-ffi-opaque-handles.sh` nor the composed `scripts/check-ios-gate.sh` is wired into `.github/workflows/ci.yml` — the milestone's gate is a local composer, not a CI gate | `.github/workflows/ci.yml` (zero matches for either script) | warning | unclaimed |
| 3 | H-08: CP-4's residual-risk disclosure still names only the Swift-side un-zeroized copy; the UniFFI `RustBuffer` intermediate and the `encrypt_item`/`decrypt_item` plaintext `String`s remain undisclosed | `crates/pv-ffi/src/lib.rs:24-39` | warning | unclaimed |
| 4 | H-10: `uniffi = { features = ["cli"] }` still pulls the full binding-generator tool dependency set into the crypto crate's supply-chain surface; never split into a bindgen-only crate | `crates/pv-ffi/Cargo.toml:95` | warning | unclaimed |
| 5 | WR-04 (Phase 35): the falsifiable-slice gate's `UNIFFI_VERSION` parse-failure branch is unreachable under `set -euo pipefail` — a check that cannot fail, in the direction that never blocks a build | `scripts/build-ios.sh:152-155` | info | 35 |
| 6 | WR-05 (Phase 35): the opaque-handle audit has no freshness check of its own (the composer's `gate_ffi_opaque` covers run-order, not the script's own staleness) | `scripts/audit-ffi-opaque-handles.sh:1-471` | warning | 35 / 42 (partial) |
| 7 | WR-06 (Phase 35): duplicate of H-08 above, same finding, same file — Phase 35's own review first found it | `crates/pv-ffi/src/lib.rs:24-40` | warning | 35 |
| 8 | E7 (Phase 36): an independent out-of-process `vmmap` reading of the FILL-06 peak was sought via twelve real escalating attempts and never obtained — honestly recorded absent, not inferred | `ios/evidence/36/vmmap-crosscheck-race-attempt.txt` | info | 36 |
| 9 | `os_proc_available_memory()` never-in-conditional grep (Phase 36) has no demonstrated positive control | `ios/PasskeyVault/PasskeyVaultAutoFill/MemoryProbe.swift:1` | info | 36 |
| 10 | `simctl get_app_container`'s original negative-control mechanism (Phase 36) was itself a check that cannot fail — superseded before shipping, correctly | `scripts/ios-autofill-layers.sh:140` | warning | 36 (superseded, not open) |
| 11 | CR-02's `defer`-based master-password wipe (Phase 37) has no mutation-driven falsification transcript — verified only by `swiftc -parse` + re-inspection | `ios/PasskeyVault/PasskeyVault/Core/AccountService.swift:80` | warning | 37 |
| 12 | `grep -c 'case errSecAuthFailed'` (Phase 37) has no falsification transcript for this specific grep | `ios/PasskeyVault/PasskeyVaultTests/BiometricGateSimulatorTests.swift:1` | info | 37 |
| 13 | `grep -c 'guaranteed'` within Phase 37's own scope has no falsification transcript (Phase 38 later extends the same discipline with a genuine catch) | `ios/PasskeyVault/PasskeyVault/Core/Keychain/UkEnvelopeStore.swift:1` | info | 37 (extended, not closed, by 38) |
| 14 | No `LAContext` held as a stored property (Phase 37) is grep-guarded with no injected-then-caught transcript | `ios/PasskeyVault/PasskeyVault/Core/BiometricUnlockService.swift:1` | warning | 37 |
| 15 | `touchIDAuthenticationAllowableReuseDuration` absence (Phase 37) is grep-guarded with no counter-example transcript | `ios/PasskeyVault/PasskeyVault/Core/BiometricUnlockService.swift:1` | warning | 37 |
| 16 | `grep -c 'guaranteed'` (Phase 38) caught a real pre-existing violation but was never itself falsified by injecting a NEW one | `ios/PasskeyVault/PasskeyVault/Vault/ClipboardService.swift:1` | info | 38 |
| 17 | `SyncDecodeTests`' two decode tests (Phase 39) were RED at HEAD as of Phase 41's own verification — Phase 40's `6701e61` emptied the evidence file they parsed. **Fixed today, before this plan ran, in `5e9ef99`**; captured bodies now live in `PasskeyVaultTests/Fixtures/`, decoupled from a document a live script owns. **LESSON, carried forward:** a test whose input is a document another process owns and rewrites measures the document, not the code — the exact shape this milestone's own QA-01 discipline exists to catch, found here inside the audit's own evidence chain rather than in application code | `.planning/phases/39-synchronizacja-i-cache-offline/39-03-SUMMARY.md:106` | critical (was) → resolved | 39 (regressed by 40, fixed pre-42-07) |
| 18 | WR-03 (Phase 40, carried): the member-removal batch's re-key set is scoped differently from the server's own completeness guard — masked by a server-side singleton-family constraint, correctly left open (the real fix needs a `pv-server` route change, forbidden by this milestone's premise) | `ios/PasskeyVault/PasskeyVault/Family/RemoveMemberService.swift:267-273,299-307` | warning | 40 |
| 19 | W-3 (Phase 41): ACC-07's host-side *verdict* is never itself logged — proven at the marker level, not by a host-process log line stating its own unlock/expired evaluation | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:259-263` | info | 41 |
| 20 | W-2 (Phase 41): SC1 (QuickType) and SC5 (third-party fill) were not RE-driven live at Phase 41's own re-verification HEAD `d0c3916` — their mechanisms were, the two specific evidence artifacts (`e41-2`, `e41-8`) were not | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:254-257` | warning | 41 |
| 21 | W-1 (Phase 41): the pre-WR-06 `identityPublishedKeys` upgrade reset makes any identity published before the upgrade unremovable on the incremental path — verifier-observed live, not theoretical | `ios/PasskeyVault/Shared/IdentityStoreSync.swift:465-471` | warning | 41 |
| 22 | W-5 (Phase 41): `removeAllPublished()`'s busy-retry and `unionIntoPublishedKeys`'s compare-and-swap carry no automated test — no injectable `ASCredentialIdentityStore` mock exists in this codebase | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:271-274` | warning | 41 |
| 23 | W-4 (Phase 41): FILL-04's third-party domain is loopback (`127.0.0.1`), not a registrable third-party DNS domain — chosen after a fresh `.localhost` subdomain failed to propagate to QuickType across 4 retries (L-38) | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:265-269` | warning | 41 |
| 24 | FILL-02's "aplikacjom" half (native third-party app fill, not Safari) was never exercised in this milestone — every fill proof targets Safari with a `.domain` identifier | `.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/41-VERIFICATION.md:220` | warning | 41 |
| 25 | T-41-23 / WINDOWS #17: `.domain`-typed identities' fill-time gate cannot see the live page — a mismatched-VISIT fill is structurally unmitigated on this platform, disclosed unsoftened in DR-41-B's own CORRECTED FINDING | `ios/PasskeyVault/PasskeyVaultAutoFill/CredentialProviderViewController.swift` (per `.planning/WINDOWS.md` row 17) | high (disclosed security limitation) | 41 (human accept/reject decision pending — see human-verification items, 41-VERIFICATION.md) |
| 26 | WINDOWS #18: `prepareCredentialList`'s `SessionLifecycle` gate is present and correct by inspection but was never observed firing live in any Phase-41 plan | `ios/PasskeyVault/PasskeyVaultAutoFill/CredentialProviderViewController.swift` (per `.planning/WINDOWS.md` row 18) | info (unrun-verify) | 41 |
| 27 | **L-14 (this phase's own named obligation): a Swift compiler crash (`swift-frontend`, `EarlyPerfInliner`, infinite recursion in generated `UniffiHandleMap.deinit`) makes `xcodebuild build -configuration Release` fail unconditionally.** Probed live by this plan today (2026-08-21) — **STILL REPRODUCES, byte-identical mangled symbol and crash shape** to the 2026-08-16 finding. See "L-14" subsection below. | `crates/pv-ffi` generated bindings (`pv_ffi.swift`, generator output, not hand-written) | **critical — ship blocker** | 42 (this phase's own named obligation, still open) |

### L-14 — probed live this session, still open, and what that means for shipping

Per this plan's own HARD RULES ("probing L-14's current state with a Release build attempt is
legitimate phase-42 subject matter, provided no workaround is silently committed"), this plan ran a real
Release build against the pinned simulator before writing this verdict:

```
$ cd ios/PasskeyVault && caffeinate -i xcodebuild -project PasskeyVault.xcodeproj -scheme PasskeyVault \
  -configuration Release -destination "id=34992BB7-4982-4915-92C7-C7FC987802AF" build
...
4.  While running pass #982547 SILFunctionTransform "EarlyPerfInliner" on SILFunction
    "@$s12PasskeyVault15UniffiHandleMap33_3020C04B17195456C4681D445E4E403DLLCfD".
4  swift-frontend  0x000000010425744c isCallerAndCalleeLayoutConstraintsCompatible(swift::FullApplySite) + 236
5  swift-frontend  0x000000010425744c isCallerAndCalleeLayoutConstraintsCompatible(swift::FullApplySite) + 236
...
** BUILD FAILED **
```

**Byte-identical in kind to the 2026-08-16 finding**: same mangled symbol (`UniffiHandleMap.deinit`),
same optimizer pass (`EarlyPerfInliner`), same infinite-recursion shape in the same function
(`isCallerAndCalleeLayoutConstraintsCompatible`). No commit across phases 39, 40, or 41 touched the
UniFFI version pin, the codegen invocation, or the app target's build settings in a way that would have
been expected to move this. **L-14 is confirmed STILL OPEN as of this session, not resolved, not
regressed to a different failure — the identical failure.**

**What this means for shipping, stated plainly, per this register's own no-softening standard: a CI (or
a human) that only ever builds Debug would ship this exact defect** — every claim of "works" this entire
150-row register makes was produced under `-Onone` (Debug), because that is the only configuration that
builds at all. `ffi06-probe`'s own unresolved default-on-Debug residual (H-02, gap #1 above) means the
Debug build every proof in this register rests on ALSO ships a synthetic panic vector — two separate,
independently-tracked debts (L-14, H-02) that compound in the same direction: **the only build
configuration that works today is the one configuration this milestone does not intend to ship.** No
workaround (e.g. quietly shipping `-Onone`) was applied or committed by this probe — per this plan's own
prohibition, this plan modifies no file under `crates/` or `ios/PasskeyVault/`, and none was touched.

### Proof limits, restated in the ROADMAP's own terms

Everything in this milestone was built and verified **on a simulator (`PV-iPhone16`, iOS 26.5), under
the paid Apple Developer Program membership Bartek purchased 2026-08-20** (retiring the earlier
free-team hardware block on `autofill-credential-provider` — see "Today's corrections" below), with the
following named, structural limits, none discovered by this plan, all restated here per this plan's own
instruction:

- **Entitlement allowlisting on real hardware is now UNBLOCKED for issuance, but App-Group-dependent
  behaviour on hardware remains unverified.** The membership grants `autofill-credential-provider` on
  both App IDs (confirmed by decoding the issued provisioning profiles, `ios/IOS-SPIKE-LOG.md`'s §3b
  CORRECTION, 2026-08-20); no phase in this milestone has yet exercised AutoFill, App Group sharing, or
  cross-process lock correctness on a REAL device — every SC2/SC4/E41-* proof in Phases 39 and 41 is
  simulator-only. The two Face ID relock loops found and fixed on Bartek's real iPhone 16 TODAY
  (`d8d9c9b`, `df3e601`, see below) are the first and only real-hardware evidence this milestone has
  produced, and both were bugs, not confirmations.
- **Memory-pressure process termination (OS jetsam) remains unverified.** Phase 36's own FILL-06 budget
  work explicitly could not obtain an independent out-of-process reading (gap #8 above); nothing in
  Phases 39–41 changes this.
- **Physical-device Keychain behaviour is unverified by construction.** Every simulator run in this
  milestone (Phases 35–41 alike) confirmed the simulator enforces NO Keychain ACLs at all (Phase 37's
  own E2 finding, re-confirmed by Phase 41's own `branch-state.md`) — every biometric-flavoured claim in
  this register describes code INTENT (does it ask the OS before reading?), never Secure Enclave
  enforcement.
- **This phase's gate script (`scripts/check-ios-gate.sh`) is the milestone's CI surrogate, not a CI
  runner** — confirmed directly by this plan (gap #2 above): the composed gate is not itself invoked from
  `.github/workflows/ci.yml`, only two of Phase 41's own narrower AutoFill-specific gates are. A static
  audit plus runnable scripts on the simulator/local machine, exactly as the ROADMAP's own
  "Ograniczenie dowodu" paragraph for this phase states, does not replace a real CI runner.
- **Release builds do not build at all (L-14, gap #27), so every proof in this register was produced
  under Debug.** Restated here because it is the single limitation this milestone's own proof standard
  would otherwise have missed: a green Debug proof is not evidence about the Release binary this
  milestone would actually ship.

### The two-layer QA-05 claim, with its residuals

**Preventive layer:** `scripts/install-ios-hooks.sh` installs a shared `pre-commit` hook rejecting a
`.planning/` commit from this worktree before it lands, proven a no-op on `main` before install
(`be2c492`, this repository's own git history). **Detective layer:** `gate_qa05` in
`scripts/check-ios-gate.sh`, re-run green by this plan (see SC4 above), asserting the substantive claim
directly against git history rather than trusting the hook to have always been present.

**Residuals, stated with the two layers' own limits, not upgraded to a structural-impossibility claim
(per this plan's own prohibition):**
- **The preventive hook CAN be bypassed** — `git commit --no-verify` skips any local hook unconditionally;
  nothing about a shared `pre-commit` script changes that. The hook is a courtesy against an accidental
  commit, not a barrier against a deliberate one.
- **The guard's discriminating configuration value (`commit_docs: false`) is an uncommitted modification
  to a tracked file** (`.planning/config.json`) — a fresh clone of this repository, or a reviewer reading
  only `main`, would see `commit_docs` at whatever value `main` itself carries, not this worktree's own
  local override. The detective gate (`gate_qa05`) is what asserts the claim POSITIVELY, against real git
  history, independent of whether the config value that motivated it is itself durably recorded — which
  is exactly why QA-05 is proven by `gate_qa05`'s own history query, not by grepping `config.json`.

### Today's corrections folded into this verdict, named and dated

Discovered and fixed on real hardware and in this codebase TODAY (2026-08-20/21), before this plan ran,
all already committed to this branch's own history — recorded here because Task 3's own instruction asks
this verdict to be self-contained, and a reader of this register alone should not have to reconstruct
them from `git log`:

- **`d8d9c9b`** — the first Face ID relock loop: `SessionLifecycle.checkAndExpireIfNeeded` collapsed its
  own tri-state `LockState` to a Bool, so an INCONCLUSIVE marker read drove the same routing decision as
  a genuinely evaluated expiry. Fixed with a named `LockState.mustRelock` contract (this register's own
  Phase 41 Q3 table, above).
- **`df3e601`** — the SECOND Face ID relock loop, found on Bartek's real iPhone 16 (iOS 27):
  `kern.bootsessionuuid` is unreadable from a sandboxed process on real hardware on every call, and a
  missing input was classified identically to a genuine boot-identity mismatch — the same "non-verdict
  routed as a verdict" shape, one layer deeper (this register's own Phase 41 Q3 table, above). **This is
  the milestone's only finding backed by real hardware, not the simulator.**
- **`003cf97`** — app package names (e.g. `com.xiaomi.smarthome`) were being resolved as DNS hostnames
  for favicon lookups AND registered as QuickType `.domain` identities that could never legitimately
  match a real page — a DNS leak with no possible benefit, fixed by a shared shape predicate
  (`OriginNormalize.looksLikeAppPackageName`) reused by both the favicon loader and `IdentityStoreSync`.
- **`6e47711`** — the identity-store choke-point gate (H-04's own composed sibling, `gate_ffi_opaque`'s
  cousin) was found RED on `ios/spike` with no defect behind it: `d8d9c9b`'s own comment-line additions
  pushed a correct, unchanged call site past a FIXED line-window standing in for "inside this function."
  Fixed by ending the window at the next same-indentation declaration; falsified both ways (swapping the
  real call for the exact CR-01 defect this gate exists to catch → exit 1; deleting the call → exit 1;
  restored → exit 0, byte-identical to HEAD).
- **`84f55a7`** — §3b CORRECTED: the paid Apple Developer Program membership was purchased 2026-08-20;
  `autofill-credential-provider` is GRANTED on both App IDs (year-long profiles, confirmed by direct
  decode); the hardware AutoFill block that Phases 41/43 previously could not clear is **retired**. A
  narrower App-Groups-absent claim raised mid-investigation was independently re-checked and found
  FALSE (`application-groups` reads present on both profiles) — recorded honestly as an unresolved
  discrepancy in the debugging session's own account, not silently reconciled.

None of these five commits is this plan's own work — they are prior fixes this plan discovered already
on the branch and is folding into its closing account, per Task 3's own instruction to state what holds
and what does not as precisely as the record allows.

---

## Addendum — Phase 43 rows (added 2026-08-22, post-hoc, per 43-VERIFICATION.md WARNING B)

**Why this section exists and what it is not.** Everything above this addendum is Phase 42's own
closing verdict (2026-08-21), unedited. At that time Phase 43 was genuinely absent
(`summaries=0`) and its exclusion from `gate_qa_register`'s coverage check — hardcoded at
`scripts/check-qa-audit-register.sh:245-246` and `scripts/qa-audit-inventory.sh:109-110` — was
correct: the ROADMAP's own SC1 text scopes this register to *"faz 35-41"* literally, and Phase 43
is explicitly conditional (*"Ta faza ma pelne prawo zakonczyc sie 'nie zrobione'"*). Phase 43 has
since run to completion (`43-VERIFICATION.md`, 2026-08-22, score 4/6 truths verified + 2 present-
but-behaviorally-unverified), so an absent Phase 43 section is no longer an accurate description of
this worktree — 43-VERIFICATION.md's own WARNING recorded exactly this staleness. Per DR-42-C ("the
audit records; it does not repair"), this addendum **adds rows**; it does **not** edit
`scripts/check-qa-audit-register.sh`/`scripts/qa-audit-inventory.sh` to require a Phase 43 section
(those three baseline-pinned scripts are Phase 42's own protected artifacts) — `gate_qa_register`
will continue to report Phase 43 excluded, correctly, by the letter of SC1's own literal scope. This
section exists so a reader of this committed file alone (QA-05's own "self-contained" discipline)
is not misled by the stale "absent is valid" bullet below, now corrected.

**Audited plans:** 43-01 through 43-11 (43-11 never executed — `.planning/ROADMAP.md` marks it
unchecked, 10/11, transparently). Source: `43-VERIFICATION.md` (2026-08-22, independently
re-executed every gate/audit/build/test cited, not carried over from any SUMMARY), cross-referenced
against `ios/IOS-SPIKE-LOG.md` §9–§20/§19a. Do not manufacture green: two of six truths are
`⚠️ PRESENT_BEHAVIOR_UNVERIFIED` and stay that way below, not upgraded.

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| SC1: OPT-01 decision record committed FIRST, alone, before any passkey code | OPT-01 | real-bytes | `43-VERIFICATION.md:104` | "`git show --stat b355d35` → touches `ios/IOS-SPIKE-LOG.md` ONLY (126 insertions, 1 file)... `git merge-base --is-ancestor b355d35 <each>` → true for all three" | critical | verified |
| SC2: assertion in a REAL third-party app via `ASCredentialProviderViewController`, dual-signal receiver-side proof | OPT-03 | live-simulator | `43-VERIFICATION.md:105` | "`RPFIXTURE\|route=/assert/finish rp_id=vault.blonie.cloud ok=true reason=verified` + `PVHARNESS\|stage=complete status=ok`... corrupt leg → `ok=false reason=\"An OpenSSL Error has occurred\"` + `status=failed`" | critical | present + wired, mechanism verified — **⚠️ see the honest caveat row immediately below; not upgraded to `verified`** |
| **Honest caveat on SC2 (verifier's own wording, not softened here):** the app is `ios/PasskeyVaultHarness` (this project's OWN app) and the RP is `vault.blonie.cloud` (this project's OWN domain) — a disclosed controlled stand-in, not a genuinely external third party. Bartek's own real-device attestation (Discord + X, iPhone 16 / iOS 27.0) corroborates the mechanism but covers **REGISTRATION only** — SC2's own ROADMAP clause is **assertion** (sign-in), which no captured artifact in this phase exercises against a genuinely external app | OPT-03 | n/a | `43-VERIFICATION.md:59-60` | "Note the attestation covers REGISTRATION in those apps; SC2's own clause is ASSERTION (sign-in)" | warning | gap — routed to human verification, not a code defect (nothing in this repo can close it) |
| SC3: assertion in Safari on a REAL page, asserted receiver-side by an independent `webauthn-rs` verdict | OPT-03 | live-simulator | `43-VERIFICATION.md:106` | "`data-ok` is set from `finishJson.ok` (`crates/rp-fixture/src/main.rs:246`), i.e. from `webauthn-rs`'s own verdict — genuinely receiver-side" | critical | present + wired, mechanism verified — **⚠️ see the honest caveat row immediately below; not upgraded to `verified`** |
| **Honest caveat on SC3:** the RP is `crates/rp-fixture` on `localhost` — a disclosed stand-in "SHAPED LIKE a third party — never a genuinely external RP". Unlike SC2, no operator attestation names a specific external SITE at all | OPT-03 | n/a | `43-VERIFICATION.md:68-71` | "no attestation names an external site" | warning | gap — routed to human verification |
| SC4: registration → `passkey`-typed vault item, visible server-side, independently reproduced by the verifier's own re-run | OPT-03 | live-run | `43-VERIFICATION.md:107` | "the verifier's own `sc5-register` leg... a direct `GET /api/vault/items` via a real `pv-wasm` client printed `{\"rowCount\":1,\"passkeyRowCount\":1}`" | critical | verified |
| SC5: two-direction interop, both directions asserted receiver-side against `crates/rp-fixture` | OPT-03 | live-run | `43-VERIFICATION.md:108` | "Direction 2... `/register/finish ok=true reason=registered` AND `/assert/finish ok=true reason=verified`. Direction 1... REPRODUCED by the verifier — the spec's line-281 receiver-side assertion `#rp-fixture-result data-ok=\"true\"` passed on all 3 attempts" | critical | verified (substance) — **see GAP 1 row below: the falsification leg's own regression test was RED at verification time, since fixed** |
| SC6: OPT-04 (PRF/`hmac_secret`) deferred with a named reason; product compiles/behaves identically without it | OPT-04 | live-run | `43-VERIFICATION.md:109` | "`cargo test --workspace` → exit 0, 0 `test result: FAILED` across 31 test binaries... Sole `prf` hit in the shipped Swift surface is `PasskeyRegistrationConfirmView.swift:6`, a comment citing the decision record" | critical | verified |

### GAP 1 (resolved 2026-08-22, same day as this addendum) — the falsification leg's root cause and fix

**Finding, as recorded by the verifier:** `extension/e2e/ios-created-passkey-assertion.spec.ts`'s
own named verify command was RED — the positive leg reproduced (3/3), the falsification leg
(post-corruption) timed out 3/3 waiting for a `data-ok="false"` that never arrived, because
`#rp-fixture-result` stayed `"pending"` indefinitely.

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| Root cause, confirmed by direct source read (not inference): once a corrupted item is dropped from `vault.list`, `page-bridge.content.ts`'s own `broker()` has no matching credential and falls through to the REAL native `navigator.credentials.get()` (its own documented D-11 discipline) — which then waits on the browser's own security-key UI indefinitely; there is no synthetic "no candidate" rejection anywhere in that chain | SC5 | real-bytes | `extension/entrypoints/page-bridge.content.ts:324-336` | "Timeout (null), explicit fallthrough, or a relay/ceremony error -- D-11: always fall through to the real native result, never a dead-ended promise or a fabricated error" | critical | verified — root cause, not the symptom |
| Fix: `crates/rp-fixture`'s `index()` page gained an opt-in `abort_ms` query param wired to a real WebAuthn Level 2 `AbortSignal` — absent by default (every pre-existing caller unaffected); the spec's corrupt leg opts in (`abort_ms=8000`), turning the genuine "cannot complete" outcome into a deterministic, receiver-observed `data-ok="false"` instead of an unbounded hang | SC5 | real-bytes | `crates/rp-fixture/src/main.rs:137-161` | "Exists ONLY for a caller that needs a genuine \"this ceremony structurally cannot complete\" outcome to settle to a real, page-JS-observed `data-ok=\"false\"` instead of waiting forever" | critical | verified |
| Non-vacuousness hardening (WARNING A's own lesson applied here too): the falsification leg now additionally asserts `data-ok`'s textContent contains `AbortError` (proving the false came from the abort, not an unrelated exception) AND that rp-fixture's own captured stdout shows a `/challenge/assert ... status=issued` line for THIS ceremony (proving genuine engagement) with no `/assert/finish ... ok=true` line | SC5 | real-bytes | `extension/e2e/ios-created-passkey-assertion.spec.ts:369-394` | `expect(newFixtureLog).toMatch(/RPFIXTURE\|route=\/challenge\/assert rp_id=localhost status=issued/)` | warning | verified |
| Live re-run, both legs, twice consecutively (stability, not "worked once") | SC5 | live-run | `ios/evidence/43/43-09-direction1.log` | "1 passed (1.9m)" / "EXIT=0" (run 1, `ios/evidence/43/43-09-direction1.log`), "1 passed (2.0m)" / "EXIT=0" (run 2, `ios/evidence/43/43-09-direction1-run2.log`) -- two consecutive full live runs, zero flakes | critical | verified |
| Evidence transcript re-recorded under `ios/evidence/43/` (was the only live proof in this phase with none — the verifier's own "missing" item) | SC5 | n/a | `ios/evidence/43/43-09-direction1.log.fixture-stdout` | "RPFIXTURE\|route=/assert/finish rp_id=localhost ok=true reason=verified" (plain leg) then, for the corrupt leg, `/challenge/assert ... status=issued` with NO subsequent `/assert/finish` line at all | info | verified |

### GAP 2 (resolved 2026-08-22, same day) — stale closing-record state, corrected

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| `ios/IOS-SPIKE-LOG.md` §20 recorded gate #14 (`audit-ios-autofill-deprecated-apis.sh`) RED and "thirteen-of-fourteen green"; `da4a836` (same day, 13:30 CEST) made it 14/14 but §20 was never amended | QA-05 (durable-sink discipline) | real-bytes | `ios/IOS-SPIKE-LOG.md` (correction appended after the original §20 paragraph, original left unedited per this file's own "found-and-corrected" precedent) | "Gate #14 is GREEN. This phase's whole-gate state is **14/14**, not \"thirteen-of-fourteen green\"" | warning | resolved — found-and-corrected, independently re-run: `bash scripts/audit-ios-autofill-deprecated-apis.sh` → exit 0, `bash scripts/check-ios-gate.sh` → exit 0, all seven sub-gates |
| `.planning/WINDOWS.md` entry 21 tracked the identical deviation, still `status: open` | QA-05 | n/a | `.planning/WINDOWS.md` row 21 | `status: fixed`, `reason: resolved by da4a836` | warning | resolved (this file is `.planning/`, on-disk only, never committed — QA-05) |

### WARNING A (resolved 2026-08-22, same day) — `assert_interop`'s corrupt-leg predicate hardened

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| `assert_interop`'s absence-tolerant corrupt-leg branch accepted "no `/assert/finish` line" unconditionally — non-vacuous only by accident (the one captured transcript happens to show `/challenge/assert status=issued`, but nothing required it) | SC5 (dir. 2) | n/a | `scripts/ios-autofill-e43.sh:463-496` (function body, pre-fix shape shown by the excerpt) | "the absence branch above is non-vacuous ONLY IF there is POSITIVE evidence the harness genuinely engaged" (fix comment, same file, post-fix) | warning | resolved |
| Fix: require an explicit `/challenge/assert rp_id=localhost status=issued` line before accepting the absence branch | SC5 (dir. 2) | real-bytes | `scripts/ios-autofill-e43.sh:463-496` | `if ! grep -qE "RPFIXTURE\|route=/challenge/assert rp_id=localhost status=issued" "$target"; then` | warning | verified — real corrupt-leg evidence still passes: `bash scripts/ios-autofill-e43.sh interop --assert-only ios/evidence/43/43-09-interop-corrupt.log --expect-ok false` → exit 0 |
| Falsification demonstration (QA-02's own "shown red before believed" standard, applied to a bash predicate): a synthetic log where rp-fixture booted but the ceremony never ran (no `/challenge/assert` line at all) — OLD predicate PASSED it (exit 0, wrongly); NEW predicate FAILS it (exit 1, correctly) | SC5 (dir. 2) | real-bytes | scratch fixture (a two-line synthetic log: `RPFIXTURE\|route=boot ...` only) | "FAIL: interop -- no RPFIXTURE /challenge/assert status=issued line ... cannot distinguish 'the harness genuinely ran and failed closed' from 'the harness never ran at all'" | critical | verified — before/after both demonstrated live via `git stash` (old code: `OLD-PREDICATE-EXIT=0`; new code: exit 1) |

### §19 / §19a — the two evidence-quality lessons this phase paid for (WARNING B's own required content)

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| §19: a real, user-visible defect (the AutoFill extension's confirm screen painted a fully legible view tree with every colour silently substituted — a literal blank white sheet) survived THREE independent green proof surfaces simultaneously: `audit-ios-colour-tokens.sh` (checks a colorset exists SOMEWHERE, not target membership), `NativeAppRegisterUITests.swift` (XCUITest's accessibility-identifier lookup finds and taps a control regardless of whether anything was ever painted), and two rounds of manual code review (confirmed every `Color("PV...")` named a real colorset — true and irrelevant, since none of the three checks asked "does THIS target's own bundle contain it") | QA-01/QA-03 | real-bytes + live-simulator | `ios/IOS-SPIKE-LOG.md:6115-6129` | "evidence that measures the wrong thing -- every proof surface was green, and none of them could have caught this class of bug, because none of them measured target-scoped resolution or actual painted pixels" | critical | resolved — `scripts/audit-ios-extension-asset-resolution.py` (static, target-membership-aware) + `scripts/measure-ios-color-token.py` (pixel-level, one-shot) both driven RED-then-GREEN; `gate_asset_resolution` is now a standing seventh sub-gate |
| §19a: a `#if DEBUG` diagnostic (`cf1dfad`) added purely to answer an empirically open question ("does iOS 27 reintroduce the deprecated `ASPasswordCredentialIdentity` overloads?") is DEBT once the question is answered, not evidence to keep — Bartek's real-device captures across password fills, Safari assertion, and Discord/X registration never showed the deprecated method names firing, while sibling `PVDIAG` lines in the same logs did (proving the diagnostic was live and capable of printing) | QA-01 | real-bytes (real hardware) | `ios/IOS-SPIKE-LOG.md:6396-6399` | "A diagnostic that has discharged its question is debt, not evidence -- the finding belongs in this log, not in the shipped class" | warning | resolved — removed by `da4a836`; see GAP 2 above |

### L-14 — independently reconfirmed by Phase 43, not caused or fixed by it (cross-reference, not a new finding)

| claim / guard | requirement | evidence tier | ref | excerpt | severity | disposition |
|---|---|---|---|---|---|---|
| Phase 43's own verifier re-probed L-14 (already tracked as this milestone's gap #27, `ios/QA-AUDIT-v1.0.md` closing-verdict table above) live, independent of Phase 42's original probe — byte-identical crash signature, ~6 days and two phases later | n/a (ship-blocker, pre-existing) | real-bytes | `43-VERIFICATION.md:203` | "exit 65, `Please submit a bug report`, `EarlyPerfInliner` on `UniffiHandleMap...deinit`, `pv_ffi.swift:406:25`... two identical `isCallerAndCalleeLayoutConstraintsCompatible` frames" | critical — ship blocker (pre-existing, unchanged) | open — same disposition as gap #27 above; every Phase 43 proof is therefore also a Debug build, restated honestly in `43-VERIFICATION.md`'s own closing judgment, not upgraded or downgraded by this addendum |

### Remaining honest gaps (not closed by this addendum — human verification, per `43-VERIFICATION.md`)

| # | Finding | file:line | Severity | Owner |
|---|---|---|---|---|
| 28 | SC2 — no captured artifact of a passkey SIGN-IN (assertion) in a genuinely external third-party app; attestation covers registration only | `43-VERIFICATION.md:72-75` | warning | human (Bartek, real device) |
| 29 | SC3 — no captured artifact of a passkey SIGN-IN on a genuinely external site in Safari; no attestation names a site at all | `43-VERIFICATION.md:76-78` | warning | human (Bartek, real device) |
| 30 | 43-11 — never executed; the Face ID-gating observation and the production-data-untouched pre/post-flight protocol were never exercised (Bartek's own device testing discharged much of the PRODUCT question via Discord/X, but not this plan's own EVIDENCE/safety design) | `43-VERIFICATION.md:79-81` | warning | human (Bartek, real device, throwaway account) |
| 31 | L-14 — three recorded remediation options awaiting Bartek's own product/tooling call | `43-VERIFICATION.md:82-84` | critical — ship blocker | human (Bartek) |

---

## Out-of-coverage phases (recorded here for completeness, never audited)

- **Phase 42** — the phase performing this audit; out of coverage by construction (see "Audit scope"
  above).
- **Phase 43** — conditional per the ROADMAP, and WAS absent (`summaries=0`) when Phase 42's own
  closing verdict above was written — that bullet was true when written. Phase 43 has since run to
  completion; **its rows are now recorded in the "Addendum — Phase 43 rows" section above.**
  `gate_qa_register`'s own mechanical exclusion of phase 43 is UNCHANGED (see the addendum's own
  opening note for why) and remains correct by SC1's literal "faz 35-41" scope — this bullet is
  corrected for honesty, not for the gate's behavior.

## Intended state at the end of plan 42-05

`scripts/check-ios-gate.sh --only qa_register` is **RED** at the end of this plan: phases 36–41 above
have section stubs with **zero rows**, and the coverage gate this file's Task 3 builds measures row
count, not section presence. This is the intended, recorded state — not a defect. 42-06 turns phases
35–38's portion green by supplying real evidence; 42-07 turns phases 39–41's portion green and resolves
the 13 pre-seeded hazards above.
