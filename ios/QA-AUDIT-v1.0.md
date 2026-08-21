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
| H-01 | The wrapped-key wire encoding: `WrappedKey` has no serde attributes, so its byte-array field serializes as a number array from the Rust side and as base64 from a default Swift encoder, and nothing validates it — the server stores the field as opaque text and the register endpoint never parses or length-checks it, so it returns success on either encoding. The failure surfaces later, in a different client, as an undecryptable row (treated as a tampering signal by this codebase). Only a two-direction cross-client test catches it; no unit suite on either side can. | not yet determined — owner is "the first phase that writes such a row"; 42-06/42-07 must name the phase or record its absence as a blocker | open |
| H-02 | The FFI panic-probe feature (`ffi06-probe`) must default to an empty feature set the moment a second build path exists; the accepted rationale was explicitly time-bound to Phase 35 being the only consumer. `crates/pv-ffi/Cargo.toml` already shows `default = []` (flipped Phase 36, Plan 36-01) — but `scripts/build-ios.sh`'s Run Script phase invocation still defaults to `--with-panic-probe` for the `PasskeyVault` APP target itself (moved there from the test bundle in Phase 37, Plan 37-02), so the synthetic panic probe still ships inside `PasskeyVault.app` today. Check whether a later phase (38–41) linked the AutoFill extension target without flipping this. | 36 (flip), 37 (moved to app target), 38–41 (must check extension-target linkage) | **partial — 42-06.** Confirmed via `crates/pv-ffi/Cargo.toml:82` (`default = []`, unchanged) and Phase 38's own two-sided `nm` symbol control (`off=0`/`on=4`, `.planning/phases/38-pe-ny-interfejs-vaulta/38-01-SUMMARY.md:64-70`, cross-referenced in the Phase 36 QA-02 table above) that the CRATE-level default is correctly off. **Still confirmed OPEN through Phase 38**: `.planning/phases/38-pe-ny-interfejs-vaulta/38-01-SUMMARY.md:34-57` shows the app target's Run Script phase still selects `--with-panic-probe` whenever `${CONFIGURATION}` is `Debug` (the residual DR-38-C names explicitly). The extension-target (Phase 41) linkage question is unanswered by this plan — out of the 35–38 range — and is handed to 42-07 as this hazard's remaining owner. |
| H-03 | The slice gate's device half had never been demonstrated able to fail; only the simulator half had (35-REVIEW.md WR-10). `scripts/build-ios.sh` now calls `falsify_slice` for BOTH `ios-arm64` (device) and `ios-arm64-simulator` — check whether this was closed inside Phase 42 itself (42-01/42-03/42-04) or in an earlier phase, and record the closing evidence. | 35 (artifact); closing phase to be named by 42-06/42-07 | **resolved — 42-06.** Closed inside Phase 35 itself: the Phase 35 specimen table's own WR-10 row (`scripts/build-ios.sh:337-338`, disposition `verified`) is the closing evidence, dated to Phase 35's own commits, not a later phase. Phases 36–38 reuse `scripts/build-ios.sh` unmodified in every `xcodebuild build`/`--verify-falsifiable` invocation across 21 plans without ever regressing this fix — confirmed by the Phase 36/38 QA-02 tables' own "inherited" cross-reference rows (`gate_ffi_build`/`gate_ffi_falsifiable` in `scripts/check-ios-gate.sh` invoke this script automatically on every gate run). |
| H-04 | The opaque-handle audit (`scripts/audit-ffi-opaque-handles.sh`) is wired into no automated CI lane and has no freshness check of its own; the composition-layer freshness assertion added in 42-03 (`gate_ffi_opaque` in `scripts/check-ios-gate.sh`) closes the RUN-ORDER hole but not the script's OWN staleness detection, and `.github/workflows/ci.yml` still does not invoke it. | 35 (script itself); 42 (composition layer, partial) | open |
| H-05 | The Rust-side deployment target: `35-REVIEW.md` WR-02 found `IPHONEOS_DEPLOYMENT_TARGET` was never set. `scripts/build-ios.sh` now sets it explicitly (`export IPHONEOS_DEPLOYMENT_TARGET=18.0`) — confirm this matches `project.pbxproj`'s own floor and that the device-slice assertion was updated in lockstep (WR-02 warned a correct fix would flip the device load command and break the old assertion). | 35 | **resolved — 42-06.** Closed inside Phase 35 (Phase 35 specimen table's WR-02 row, `scripts/build-ios.sh:374`, disposition `verified`). No commit under `.planning/phases/3[6-8]-*/` touches `IPHONEOS_DEPLOYMENT_TARGET`, and every Phase 36/37/38 build invocation runs against the same unmodified `build-ios.sh` — no lockstep drift observed in the 35–38 range. |
| H-06 | The slice gate used to inspect whichever object the filesystem yielded first, which in practice was a compiler-support object rather than any of this crate's own (35-REVIEW.md WR-03). `scripts/build-ios.sh` now selects `pv_ffi*.o` specifically — confirm this closes WR-03 and that the falsification (an archive with zero `pv_ffi*.o` objects) has been demonstrated. | 35 | **resolved — 42-06.** Closed inside Phase 35 (specimen table's WR-03 row, `scripts/build-ios.sh:222`, disposition `verified`). Confirmed unmodified and reused (not regressed) through the 35–38 range — cross-referenced in the Phase 38 QA-02 table above. |
| H-07 | Server-supplied KDF parameters are deserialized and used with no bounds check, so a hostile value is an allocation failure, which aborts rather than unwinds and therefore cannot be caught by `catch_unwind` (35-REVIEW.md WR-11). `crates/pv-ffi/src/lib.rs` now has tests named `from_password_rejects_over_ceiling_m_cost_end_to_end` and `from_password_rejects_argon2s_own_max_m_cost` — confirm the bounds check is real (not merely tested) and quote it. | 35 | open |
| H-08 | The residual-risk disclosure (`crates/pv-ffi/src/lib.rs`'s CP-4 header) understates the un-zeroized copies that exist on the Rust side: the UniFFI `RustBuffer` marshalling intermediates, and the plaintext-carrying `String` types on the `encrypt_item`/`decrypt_item` pair. The current header (lines 24-40) still only discloses the SWIFT-side residual; a grep for `RustBuffer` across `crates/pv-ffi/src/lib.rs` returns zero hits. This gap looks STILL OPEN as of this plan — 42-06/42-07 must confirm and either extend the disclosure (in scope for this phase's audit-and-record mandate) or record it as an open-finding for a later phase. | 35 | open |
| H-09 | The Swift round-trip test (`FfiRoundTripTests.swift`) would still pass if the wrap/unwrap operations were identity no-ops, because the original version never inspected the intermediate (35-REVIEW.md WR-12). The file now contains `#expect(Array(wrapped.ciphertext) != originalUserKeyBytes)` and two sibling assertions at lines 107-109 — confirm this closes WR-12. | 35 | **resolved — 42-06.** Closed inside Phase 35 (specimen table's WR-12 row, disposition `verified`). Phase 37, Plan 37-02 moved the file's MODULE OWNERSHIP (`PasskeyVaultTests` → the `PasskeyVault` app target) but left the assertion itself unmodified in substance, gaining only `import PasskeyVault` (`.planning/phases/37-konto-unlock-has-em-i-biometria/37-02-SUMMARY.md:121, 148-149`, cross-referenced in the Phase 37 QA-02 table above as `inherited`) — confirmed not weakened by the move. |
| H-10 | The binding generator's command-line feature (`uniffi = { features = ["cli"] }`, `crates/pv-ffi/Cargo.toml`) pulls a large tool dependency set (clap/goblin/askama/rustix/…) into the library graph that is cross-compiled for iOS, widening the crypto crate's supply-chain surface (35-REVIEW.md WR-08). Confirm whether this was ever split into a separate bindgen crate/feature, or remains open. | 35 | open |
| H-11 | The concurrency backstop from Phase 35 verification — one key handle used from multiple Swift threads — abstained with no evidence in the ORIGINAL `35-VERIFICATION.md` truths table (B1, `insufficient_spec`). `35-VERIFICATION.md`'s own frontmatter (`resolution:`) claims this was closed 2026-08-16 via `FfiConcurrencyTests.swift` under TSan+ASan, both instruments falsified before their green runs were believed. Confirm this resolution is real by reading the evidence file it cites directly, not by trusting the claim. | 35 | **resolved — 42-06 (independent confirmation).** `ios/evidence/35/B1-CONCURRENCY-SANITIZERS.md:17-51` read directly (not re-quoted from the specimen table): both instruments' falsification transcripts are real — `FAIL: PasskeyVault (13898) encountered an error :: Early unexpected exit` (TSan, an unsynchronized-increment control) and `FAIL: deliberateHeapOverflowMustBeReported() :: Crash` (ASan) — with the file's own "HONEST NOTE ON A DISCREPANCY" explaining why the ASan link-time check alone was not accepted as sufficient proof. The claim in `35-VERIFICATION.md`'s frontmatter is confirmed genuine. |
| H-12 | Phase 35 left the committed status document (`ios/IOS-SPIKE-LOG.md`) asserting the FFI boundary was "Not started (no code yet)", which was false as of the phase's own later commits, and left an explicit landmine-recording obligation (`.planning/STATE.md:352`) undischarged. `35-VERIFICATION.md`'s own frontmatter claims this gap (`G1`) was resolved 2026-08-16 by later Phase 36/37 sessions carrying the content forward. Confirm by reading the current status row directly. | 35 (defect); 36/37 (claimed fix) | **resolved — 42-06 (independent confirmation).** `ios/IOS-SPIKE-LOG.md:21` read directly: `**Delivered and verified** (Phase 35, commits \`f6cb883\` … \`37c1ff7\`)` — no longer "Not started". The status row also names the current gate scripts (`build-ios.sh`, `audit-ffi-opaque-handles.sh`) and states an explicit proof limit ("simulator only"), consistent with this register's own evidence-tier discipline. |
| H-13 | Three cross-phase premise corrections research already recorded, unclaimed by any phase's own SUMMARY as of this plan: Phase 36's entitlement criteria rest on a premise the simulator cannot measure; Phase 37's Secure Enclave rejection is stated on a factually wrong reason; Phase 38's item-type count is wrong and the field model does not live where its criterion assumes. | 36, 37, 38 respectively | **resolved — 42-06.** All three now carry their own register row, each independently checked against the committed source (not re-quoted from research): Phase 36's corrected SC1–SC3 wording, checked against `.planning/phases/36-bramka-wykonalno-ci-autofilla-entitlement-i-bud-et-pami-ci/36-VERIFICATION.md:104-111` and `ios/AUTOFILL-FEASIBILITY.md:347/755` (Phase 36 QA-01 table, "SC1/SC2 cross-phase correction" row). Phase 37's ACC-05 corrected rationale, checked against `ios/IOS-SPIKE-LOG.md:465-480` (Phase 37 QA-01 table, first row). Phase 38's six-item-type union (L-15), checked against `packages/pv-ui/vault/types.ts:4` and independently re-confirmed by `.planning/phases/38-pe-ny-interfejs-vaulta/38-VERIFICATION.md:68`'s own re-run of `check-item-type-parity.sh` (Phase 38 QA-01 table, first row). |

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
