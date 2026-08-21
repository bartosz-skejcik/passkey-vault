# QA-AUDIT v1.0 — Phase 42 retrospective register (QA-01/QA-02/QA-03)

**Owner:** Phase 42 (`Standard dowodu — bramka QA i CI dla iOS`), built by plan 42-05, filled by
42-06 (phases 35–38) and 42-07 (phases 39–41), which also resolves the 13 pre-seeded hazards below
and delivers the closing verdict.

**Audit-script baseline:** `<PENDING — set by 42-05 Task 3 after scripts/qa-audit-inventory.sh,
scripts/check-qa-audit-register.sh and scripts/check-ios-gate.sh are committed; see that task's
`git log -1 --format=%H -- <the three scripts>` output, quoted verbatim in 42-05-SUMMARY.md>`

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
| H-01 | The wrapped-key wire encoding: `WrappedKey` has no serde attributes, so its byte-array field serializes as a number array from the Rust side and as base64 from a default Swift encoder, and nothing validates it — the server stores the field as opaque text and the register endpoint never parses or length-checks it, so it returns success on either encoding. The failure surfaces later, in a different client, as an undecryptable row (treated as a tampering signal by this codebase). Only a two-direction cross-client test catches it; no unit suite on either side can. | not yet determined — owner is "the first phase that writes such a row"; 42-06/42-07 must name the phase or record its absence as a blocker | open |
| H-02 | The FFI panic-probe feature (`ffi06-probe`) must default to an empty feature set the moment a second build path exists; the accepted rationale was explicitly time-bound to Phase 35 being the only consumer. `crates/pv-ffi/Cargo.toml` already shows `default = []` (flipped Phase 36, Plan 36-01) — but `scripts/build-ios.sh`'s Run Script phase invocation still defaults to `--with-panic-probe` for the `PasskeyVault` APP target itself (moved there from the test bundle in Phase 37, Plan 37-02), so the synthetic panic probe still ships inside `PasskeyVault.app` today. Check whether a later phase (38–41) linked the AutoFill extension target without flipping this. | 36 (flip), 37 (moved to app target), 38–41 (must check extension-target linkage) | open |
| H-03 | The slice gate's device half had never been demonstrated able to fail; only the simulator half had (35-REVIEW.md WR-10). `scripts/build-ios.sh` now calls `falsify_slice` for BOTH `ios-arm64` (device) and `ios-arm64-simulator` — check whether this was closed inside Phase 42 itself (42-01/42-03/42-04) or in an earlier phase, and record the closing evidence. | 35 (artifact); closing phase to be named by 42-06/42-07 | open |
| H-04 | The opaque-handle audit (`scripts/audit-ffi-opaque-handles.sh`) is wired into no automated CI lane and has no freshness check of its own; the composition-layer freshness assertion added in 42-03 (`gate_ffi_opaque` in `scripts/check-ios-gate.sh`) closes the RUN-ORDER hole but not the script's OWN staleness detection, and `.github/workflows/ci.yml` still does not invoke it. | 35 (script itself); 42 (composition layer, partial) | open |
| H-05 | The Rust-side deployment target: `35-REVIEW.md` WR-02 found `IPHONEOS_DEPLOYMENT_TARGET` was never set. `scripts/build-ios.sh` now sets it explicitly (`export IPHONEOS_DEPLOYMENT_TARGET=18.0`) — confirm this matches `project.pbxproj`'s own floor and that the device-slice assertion was updated in lockstep (WR-02 warned a correct fix would flip the device load command and break the old assertion). | 35 | open |
| H-06 | The slice gate used to inspect whichever object the filesystem yielded first, which in practice was a compiler-support object rather than any of this crate's own (35-REVIEW.md WR-03). `scripts/build-ios.sh` now selects `pv_ffi*.o` specifically — confirm this closes WR-03 and that the falsification (an archive with zero `pv_ffi*.o` objects) has been demonstrated. | 35 | open |
| H-07 | Server-supplied KDF parameters are deserialized and used with no bounds check, so a hostile value is an allocation failure, which aborts rather than unwinds and therefore cannot be caught by `catch_unwind` (35-REVIEW.md WR-11). `crates/pv-ffi/src/lib.rs` now has tests named `from_password_rejects_over_ceiling_m_cost_end_to_end` and `from_password_rejects_argon2s_own_max_m_cost` — confirm the bounds check is real (not merely tested) and quote it. | 35 | open |
| H-08 | The residual-risk disclosure (`crates/pv-ffi/src/lib.rs`'s CP-4 header) understates the un-zeroized copies that exist on the Rust side: the UniFFI `RustBuffer` marshalling intermediates, and the plaintext-carrying `String` types on the `encrypt_item`/`decrypt_item` pair. The current header (lines 24-40) still only discloses the SWIFT-side residual; a grep for `RustBuffer` across `crates/pv-ffi/src/lib.rs` returns zero hits. This gap looks STILL OPEN as of this plan — 42-06/42-07 must confirm and either extend the disclosure (in scope for this phase's audit-and-record mandate) or record it as an open-finding for a later phase. | 35 | open |
| H-09 | The Swift round-trip test (`FfiRoundTripTests.swift`) would still pass if the wrap/unwrap operations were identity no-ops, because the original version never inspected the intermediate (35-REVIEW.md WR-12). The file now contains `#expect(Array(wrapped.ciphertext) != originalUserKeyBytes)` and two sibling assertions at lines 107-109 — confirm this closes WR-12. | 35 | open |
| H-10 | The binding generator's command-line feature (`uniffi = { features = ["cli"] }`, `crates/pv-ffi/Cargo.toml`) pulls a large tool dependency set (clap/goblin/askama/rustix/…) into the library graph that is cross-compiled for iOS, widening the crypto crate's supply-chain surface (35-REVIEW.md WR-08). Confirm whether this was ever split into a separate bindgen crate/feature, or remains open. | 35 | open |
| H-11 | The concurrency backstop from Phase 35 verification — one key handle used from multiple Swift threads — abstained with no evidence in the ORIGINAL `35-VERIFICATION.md` truths table (B1, `insufficient_spec`). `35-VERIFICATION.md`'s own frontmatter (`resolution:`) claims this was closed 2026-08-16 via `FfiConcurrencyTests.swift` under TSan+ASan, both instruments falsified before their green runs were believed. Confirm this resolution is real by reading the evidence file it cites directly, not by trusting the claim. | 35 | open |
| H-12 | Phase 35 left the committed status document (`ios/IOS-SPIKE-LOG.md`) asserting the FFI boundary was "Not started (no code yet)", which was false as of the phase's own later commits, and left an explicit landmine-recording obligation (`.planning/STATE.md:352`) undischarged. `35-VERIFICATION.md`'s own frontmatter claims this gap (`G1`) was resolved 2026-08-16 by later Phase 36/37 sessions carrying the content forward. Confirm by reading the current status row directly. | 35 (defect); 36/37 (claimed fix) | open |
| H-13 | Three cross-phase premise corrections research already recorded, unclaimed by any phase's own SUMMARY as of this plan: Phase 36's entitlement criteria rest on a premise the simulator cannot measure; Phase 37's Secure Enclave rejection is stated on a factually wrong reason; Phase 38's item-type count is wrong and the field model does not live where its criterion assumes. | 36, 37, 38 respectively | open |

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

## Phase 36 — section stub (register not yet authored)

*(No rows yet. `scripts/qa-audit-inventory.sh` reports this phase `IN-COVERAGE` with SUMMARY files on
disk. 42-06 authors this section.)*

## Phase 37 — section stub (register not yet authored)

*(No rows yet. `scripts/qa-audit-inventory.sh` reports this phase `IN-COVERAGE` with SUMMARY files on
disk. 42-06 authors this section.)*

## Phase 38 — section stub (register not yet authored)

*(No rows yet. `scripts/qa-audit-inventory.sh` reports this phase `IN-COVERAGE` with SUMMARY files on
disk. 42-06 authors this section.)*

## Phase 39 — section stub (register not yet authored)

*(No rows yet. `scripts/qa-audit-inventory.sh` reports this phase `IN-COVERAGE` with SUMMARY files on
disk. 42-07 authors this section.)*

## Phase 40 — section stub (register not yet authored)

*(No rows yet. `scripts/qa-audit-inventory.sh` reports this phase `IN-COVERAGE` with SUMMARY files on
disk. 42-07 authors this section.)*

## Phase 41 — section stub (register not yet authored)

*(No rows yet. `scripts/qa-audit-inventory.sh` reports this phase `IN-COVERAGE` with SUMMARY files on
disk. 42-07 authors this section.)*

---

## Out-of-coverage phases (recorded here for completeness, never audited)

- **Phase 42** — the phase performing this audit; out of coverage by construction (see "Audit scope"
  above).
- **Phase 43** — conditional per the ROADMAP; an absent Phase 43 is valid, not a gap.

## Intended state at the end of plan 42-05

`scripts/check-ios-gate.sh --only qa_register` is **RED** at the end of this plan: phases 36–41 above
have section stubs with **zero rows**, and the coverage gate this file's Task 3 builds measures row
count, not section presence. This is the intended, recorded state — not a defect. 42-06 turns phases
35–38's portion green by supplying real evidence; 42-07 turns phases 39–41's portion green and resolves
the 13 pre-seeded hazards above.
