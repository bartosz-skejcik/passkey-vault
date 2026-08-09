---
phase: 21-crypto-foundation-asymmetric-identity-collection-keys
verified: 2026-07-30T03:34:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 3/4
  gaps_closed:
    - "SC#3 — reverse-direction cross-scope rejection (collection blob under personal scope) now has an automated assertion (`items::tests::collection_blob_rejected_under_personal_scope`), same key bytes, asserting `Err(CryptoError::Decrypt)`. I additionally proved it load-bearing by mutation (see Falsification Experiments). SC#3 upgraded PRESENT_BEHAVIOR_UNVERIFIED -> VERIFIED."
    - "IN-05's second half — intra-scope key-wrap-vs-data prefix isolation now pinned by `items::tests::key_wrap_prefix_not_interchangeable_with_data_prefix`; also proved load-bearing by mutation."
    - "W1 (half) — KEY-01's roadmap hole is closed: KEY-01 re-opened to `[ ]`/Partial with an explicit delivered-vs-outstanding note, remapped to Phase 21 + Phase 22, and Phase 22 gained a checkable Success Criterion 5 naming the server half. KEY-04 correctly promoted to Complete."
    - "W2 — `identity::tests::seal_unseal_roundtrip`'s doc comment no longer claims two independently-generated keypairs; it now describes the one-keypair body accurately and points at the real cross-party test, which exists (`pv-wasm/src/lib.rs:983`)."
    - "W3 — `backward_compat.rs`'s module doc no longer sends readers to a non-existent generator; its two new factual claims (never committed; `8c24514` predates `caa90c4`) both check out."
  gaps_remaining: []
  regressions:
    - "NEW inaccuracy introduced by commit `56bafad`: KEY-02 was flipped from `[ ]`/Pending to `[x]`/Complete. Two of its clauses are undelivered and now unowned — the same defect class the commit set out to fix, moved from KEY-01 onto KEY-02. See W1b. Not a code defect; does not affect the phase goal."
  verified_unchanged:
    - "SC#1 — decision-record ordering evidence untouched: none of `0975b31`/`31e5ed9`/`56bafad` touches `docs/ARCHITECTURE.md`, `.planning/PROJECT.md`, or `crates/pv-core/Cargo.toml`."
    - "SC#2 — `crates/pv-core/src/identity.rs` diff since `31e5ed9~1` contains ZERO non-doc-comment lines (verified by filtering the diff); all pv-wasm cross-party tests still pass."
    - "SC#4 — `build_item_aad` and `b\"pv:item-key:v1\"`/`b\"pv:item:v1\"` re-confirmed byte-identical against `27735f5~1` (pre-phase) despite `0975b31` editing `items.rs`; `backward_compat.rs`'s 14 changed lines are ALL `//!` doc lines (assertion untouched) and the test still passes."
resolution:
  resolved_by: orchestrator
  resolved_at: 2026-07-30
  commit: 91eb056
  status_change: "human_needed -> passed"
  note: >-
    The single human_verification item below was a milestone-scoping decision, not a code gap —
    this verifier recorded explicitly that all four ROADMAP Success Criteria are met and "the phase
    goal is NOT in doubt; only the REQUIREMENTS.md status field is". Requirement-to-phase mapping
    falls under the project's standing rule that architecture/data-model decisions are the
    orchestrator's to make (crypto/architecture = Claude's discretion; UX/user-story = ask Bartek).
    The decision was made and recorded in commit `91eb056`, exactly as this report specified:
      - KEY-02 reverted to `[ ]`/Partial with an explicit delivered-vs-outstanding note, mirroring
        the KEY-01 treatment.
      - Clause 1 ("sealed independently to EACH member's public key") assigned to Phase 22, which
        owns the `collection_keys` per-recipient data model. New Phase 22 SC#6 makes it checkable:
        N members yield N distinct openable-only-by-that-member `SealedKey` rows, proven with 3+
        members, and adding a member leaves `enc_data` byte-identical.
      - Clause 2 ("adding or removing a member rewraps keys only — `enc_data` never touched")
        assigned to Phase 25, which owns the real removal path. New Phase 25 SC#6 asserts
        `enc_data` byte-identity directly rather than inferring it from SC#2's cost measurement.
      - Verified mechanically afterwards: all seven KEY-0x requirements are declared by >=1 ROADMAP
        phase, so nothing is orphaned. KEY-01 -> 2 phases, KEY-02 -> 3 phases, KEY-03/04/05/06/07 -> 1 each.
    The orchestrator additionally owns the original error: commit `56bafad` (the KEY-02 over-claim)
    was the orchestrator's, not an executor's, and was caught only because this verifier re-checked
    a field it had itself previously ruled on.

human_verification_resolved:
  - test: "Adjudicate the KEY-02 status flip introduced by commit `56bafad`. Decide whether to revert KEY-02 to `[ ]`/Partial with a delivered-vs-outstanding note (mirroring the KEY-01 treatment that same commit applied correctly), and which phase owns its two undelivered clauses — sealing one Collection Key independently to EACH member's public key (Phase 22 or 24, at member-add time) and \"adding or removing a member rewraps keys only — item ciphertext (`enc_data`) is never touched\" (Phase 22 add / Phase 25 remove). If a phase takes them, it needs a checkable Success Criterion, exactly as Phase 22 SC#5 now does for KEY-01."
    expected: "No KEY requirement is marked Complete while clauses of it are unimplemented AND unowned. Today KEY-02 is `[x]`/Complete, but: `identity::seal` is single-recipient (`identity.rs:306`), there is no member/membership/rewrap/re-key symbol anywhere in `pv-core` or `pv-wasm`, no code seals one Collection Key to a set of members, and no add/remove-member operation exists. Phase 22's requirements line does not claim KEY-02; Phase 25 claims KEY-06/KEY-07 and its SC#2/SC#3 cover re-key COST-SCOPING and ATOMICITY — neither states per-member sealing on add nor \"enc_data never touched\". Because KEY-02 is now checked off, no later phase will revisit it."
    why_human: "Milestone-scoping/traceability decision, not something the codebase can settle. It is also a direct contradiction of this verifier's prior recorded finding (the previous report stated explicitly that `Pending` was the honest status for KEY-02, because the rewrap-on-membership-change behaviour is Phase 22/25 work). Phase 21's four ROADMAP Success Criteria are all met without these clauses — the phase goal is NOT in doubt; only the REQUIREMENTS.md status field is."
---

# Phase 21: Crypto Foundation — Asymmetric Identity & Collection Keys — Verification Report

**Phase Goal:** pv-core gains a documented, decision-driven asymmetric sharing primitive — an X25519 identity keypair, sealed-box Collection Key wrapping, and scope-bound AAD — that every downstream sharing feature builds on, without disturbing any existing single-user vault.
**Verified:** 2026-07-30T03:34:00Z (re-verification; initial pass 2026-07-30T01:09:43Z)
**Status:** human_needed
**Re-verification:** Yes — after orchestrator-authored gap closure (`0975b31`, `31e5ed9`, `56bafad`)

> Re-verification stance: the three closure commits were written by the orchestrator, not by a plan executor, and were not code-reviewed. I re-adjudicated them independently — reading every test body, running the tests, and additionally **mutating the implementation in a throwaway git worktree to prove the new tests actually fail when the property they claim to protect is broken**. Nothing below rests on a SUMMARY or commit-message claim.

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A documented decision record exists for the sealed-box implementation choice, made and justified **before any dependent code was written** | ✓ VERIFIED (carried forward, re-confirmed unchanged) | Carried from the initial pass, which proved this by direct git inspection: `git show --stat 27735f5` (2026-07-30T00:59:34) touches exactly two files, both docs; the first `identity.rs`/`crypto_box` commit is `6c70ee7` 14 min later. **Re-confirmed undisturbed:** none of the three closure commits touches `docs/ARCHITECTURE.md`, `.planning/PROJECT.md`, or `crates/pv-core/Cargo.toml`. |
| 2 | A client can generate an X25519 identity keypair, publish only the public half, and any client holding the matching private key can seal a Collection Key to it and unseal it back to identical bytes | ✓ VERIFIED (carried forward, re-confirmed unchanged) | Carried from the initial pass (`seal`'s signature takes only `&IdentityPublicKey` at `identity.rs:306`; `WasmIdentityPublicKey::fromBytes` lets a sender be built from published bytes alone; `seal_with_recipient_public_key_only_cross_party` proves the full cross-party flow). **Re-confirmed undisturbed:** `git diff 31e5ed9~1 HEAD -- crates/pv-core/src/identity.rs` filtered for non-`///` lines returns **nothing** — the commit changed doc comments only. All identity/pv-wasm tests still pass in the workspace run below. |
| 3 | Personal- and collection-scope item encryption use distinct, versioned domain-separation constants and AAD; a blob produced under one scope **provably fails to decrypt under any other** (automated cross-context rejection test) | ✓ **VERIFIED** (was ⚠️ PRESENT_BEHAVIOR_UNVERIFIED) | **All three pairwise scope directions now have automated assertions, and I proved each one load-bearing by mutation.** ✓ personal→collection: `personal_blob_rejected_under_collection_scope`. ✓ **collection→personal (the previously missing direction):** `collection_blob_rejected_under_personal_scope` (`items.rs:320-337`) — reads correctly on all three counts I was skeptical about: (a) it **asserts rejection**, `assert!(matches!(decrypt_item(&uk, &item, "item-1", 1), Err(CryptoError::Decrypt)))`, a specific variant not `Err(_)`, not a bare call; (b) the **same-key construction is genuine** — one `key_bytes = [7u8; KEY_LEN]` feeds both `CollectionKey::from_bytes` and `UserKey::from_bytes`, and both take `[u8; KEY_LEN]` **by value** (`items.rs:169`, `keys.rs:46`), so WR-11's internal `bytes.zeroize()` wipes only the callee's `Copy` of the array and the caller's stays `[7u8; 32]` — the two keys really are identical, so AAD is the sole rejecting mechanism; (c) it is the true mirror of the forward test (encrypt under collection scope, decrypt under personal). ✓ collection-A→collection-B: `collection_blob_rejected_under_different_collection`. Plus `coll_aad_handles_empty_ids_without_panic` covers empty-vs-nonempty `collection_id`. **Intra-scope prefix isolation** (IN-05's optional half) is now pinned too by `key_wrap_prefix_not_interchangeable_with_data_prefix` — note this is an AAD-byte inequality assertion rather than a behavioral enc_key↔enc_data swap, which is weaker in form but sufficient given AEAD authenticates AAD; it is also load-bearing (falsified below). **Constants half** unchanged from the initial pass: `AAD_COLL_ITEM_KEY_PREFIX`/`AAD_COLL_ITEM_DATA_PREFIX` versioned and distinct, `INFO_X25519_SK_WRAP` asserted distinct by `constant_distinctness`. No direction remains uncovered. |
| 4 | An existing v0.3 account can be given an identity keypair **without re-encrypting a single byte** of its existing vault (verified against pre-v0.4 fixture data) | ✓ VERIFIED (carried forward, re-confirmed unchanged) | Carried from the initial pass. **Re-confirmed after `0975b31` edited `items.rs` and `31e5ed9` edited `backward_compat.rs`:** (a) `git show 27735f5~1:crates/pv-core/src/items.rs` vs HEAD — `AAD_ITEM_KEY_PREFIX = b"pv:item-key:v1"`, `AAD_ITEM_DATA_PREFIX = b"pv:item:v1"` and `build_item_aad`'s entire body are still **character-for-character identical** to their pre-phase form (`0975b31` added only test-module lines); (b) of the 14 lines `31e5ed9` changed in `backward_compat.rs`, **all 14 are `//!` doc lines** — the hardcoded `UserKey::from_bytes([0x42u8; 32])`, the `include_str!` fixture, and the hardcoded plaintext `assert_eq!` are untouched, so the tripwire is still load-bearing; (c) `cargo test -p pv-core --test backward_compat` → `pre_v0_4_item_decrypts_unchanged ... ok`; (d) the fixture still has exactly one commit, `8c24514` @ 01:00:39, predating the first AAD-code commit `caa90c4` @ 01:11:42. |

**Score:** 4/4 truths verified (0 present-but-behavior-unverified)

### Falsification Experiments (this re-verification only)

Because the closure tests were authored by the party asking me to bless them, I did not accept "the test passes" as evidence that the test *tests anything*. I created a throwaway `git worktree` in scratch, mutated the implementation, and confirmed the tests fail — then removed the worktree (`git status` confirms the real tree was never touched).

| Mutation applied in the isolated worktree | Expected if tests are load-bearing | Actual result |
|---|---|---|
| `build_coll_item_aad` rewritten to delegate to `build_item_aad` with the *personal* prefixes (collapsing the two scopes onto one AAD scheme, `collection_id` discarded) | The three cross-scope rejection tests must FAIL (blobs would now interchange) | **4 tests failed, 9 passed:** `collection_blob_rejected_under_personal_scope`, `personal_blob_rejected_under_collection_scope`, `collection_blob_rejected_under_different_collection`, `coll_aad_handles_empty_ids_without_panic`. This is the decisive evidence for SC#3 — the **new** reverse-direction test does fail when scope separation is removed, which independently proves its rejection comes from AAD/prefix and not from any key mismatch. |
| `AAD_ITEM_DATA_PREFIX` and `AAD_COLL_ITEM_DATA_PREFIX` set equal to their key-wrap siblings | `key_wrap_prefix_not_interchangeable_with_data_prefix` must FAIL | **Failed as required**, with a real byte-vector inequality diff (`left != right`, both `pv:item-key:v1item-1\0\0\0\0`). |

### Required Artifacts

Unchanged from the initial pass (all ✓ VERIFIED) — `docs/ARCHITECTURE.md` §4 "Decyzja D", `.planning/PROJECT.md` Key Decisions row, `crates/pv-core/tests/fixtures/pre_v0_4_item.json`, `crates/pv-core/tests/backward_compat.rs`, `crates/pv-core/src/identity.rs`, `items.rs` collection-scope siblings, `crates/pv-wasm/src/lib.rs` bindings, `crypto_box` exact pin, `deny.toml` watch-list rows, the carried-forward todo file. Deltas since:

| Artifact | Delta this round | Status |
|----------|------------------|--------|
| `crates/pv-core/src/items.rs` | +35 lines, **test module only** (2 new tests) | ✓ VERIFIED — non-test region byte-identical; personal-scope region identical to pre-phase |
| `crates/pv-core/src/identity.rs` | +9/-2 lines, **doc comment only** | ✓ VERIFIED — zero non-doc lines changed |
| `crates/pv-core/tests/backward_compat.rs` | 14 lines, **all `//!` doc** | ✓ VERIFIED — assertion untouched, test green |
| `.planning/REQUIREMENTS.md` | KEY-01 re-opened to Partial + note; KEY-02/03/04 → Complete | ⚠️ **PARTIAL** — KEY-01 fix correct, KEY-02 flip is a new over-claim (W1b) |
| `.planning/ROADMAP.md` | Phase 22 gains `KEY-01 (server half — see SC 5)` + new SC#5 | ✓ VERIFIED — see Requirements Coverage |

### Key Link Verification

Unchanged from the initial pass — all ✓ WIRED. No link was touched: the only non-test, non-doc change in this round was to `.planning/` markdown.

### Data-Flow Trace (Level 4)

Unchanged — not applicable in the rendering sense; the analogous "do real key bytes flow, or are the primitives hollow" check passed in the initial pass and no wiring changed.

### Behavioral Spot-Checks

All commands run by me in this re-verification, from the repo root.

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| SC#3 — full items module, incl. both new tests | `cargo test -p pv-core --lib items::` | 13 passed, 0 failed; `collection_blob_rejected_under_personal_scope ... ok`, `key_wrap_prefix_not_interchangeable_with_data_prefix ... ok` | ✓ PASS |
| SC#3 — new tests are load-bearing | mutation in isolated `git worktree` (twice, see Falsification Experiments) | both mutations produce the required failures | ✓ PASS |
| SC#4 — fixture still decrypts unchanged | `cargo test -p pv-core --test backward_compat` | `pre_v0_4_item_decrypts_unchanged ... ok`; 1 passed | ✓ PASS |
| Full workspace suite green | `cargo test --workspace` (run **once**, output saved and summed) | **196 passed, 0 failed** across 22 binaries — exactly the prior 194 plus the 2 new tests, so the closure commits added coverage without disturbing anything | ✓ PASS |
| Lint clean | `touch`ed all three changed source files to defeat the cache, then `cargo clippy --workspace --all-targets` | **0** `warning`/`error` lines | ✓ PASS |
| Supply chain | `bash scripts/check-supply-chain.sh` | exit 0; `advisories ok, bans ok, licenses ok, sources ok` | ✓ PASS |
| Debt-marker gate | grep `TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER` over `items.rs`, `identity.rs`, `backward_compat.rs` | **zero matches** | ✓ PASS |
| Working tree not disturbed by my experiments | `git worktree remove --force` + `git status --porcelain` | no crate or planning file modified | ✓ PASS |
| W2 claim — referenced cross-party test exists | `grep -rn seal_with_recipient_public_key_only_cross_party` | `crates/pv-wasm/src/lib.rs:983` | ✓ PASS |
| W3 claim — generator never committed | `git log --all --diff-filter=D --name-only -- 'crates/pv-core/examples/*' 'crates/pv-core/tests/fixtures/*'` | **no output** — nothing was ever committed and deleted, so the new doc text is accurate and the old "recover it via `git log`" text was not | ✓ PASS |
| W3 claim — commit ordering | `git log --format='%H %ci' -- .../pre_v0_4_item.json`, `git show -s 8c24514 caa90c4` | fixture: one commit, `8c24514` @ 01:00:39; `caa90c4` @ 01:11:42 — ordering claim holds | ✓ PASS |
| wasm32 release build | not re-run this round | `identity.rs` changed doc-only and `items.rs` test-only; the initial pass ran it green (exit 0) and clippy `--all-targets` compiles all of it now | ? SKIP |
| web/extension JS suites | not re-run | No file under `web/` or `extension/` was touched by any of the three closure commits | ? SKIP |

### Probe Execution

No probes apply. `find scripts -name 'probe-*.sh'` → none; no PLAN or SUMMARY in this phase references a probe. Step 7c: SKIPPED (no probes in this project).

### Requirements Coverage

| Requirement | REQUIREMENTS.md status at HEAD | Actual status | Evidence / verdict on the `56bafad` edit |
|-------------|-------------------------------|---------------|------------------------------------------|
| KEY-01 | `[ ]` / **Partial**, mapped "Phase 21 (crypto half) + Phase 22 (server publication, on-upgrade generation)", with an indented delivered-vs-outstanding note | ✓ **ACCURATE — the hole I reported is genuinely closed** | The note names exactly what landed (generate, wrap under `INFO_X25519_SK_WRAP`, no-re-encryption proof) and exactly what did not (server publication, on-upgrade generation), and instructs "do not mark Complete until Phase 22 delivers the server half". **Phase 22 really does own it now, and checkably:** its Requirements line reads `... SEC-06, KEY-01 (server half — see SC 5)`, and new **SC#5** spells out three testable obligations — public key published to and served by the server, wrapped private key stored as an opaque blob the server never unwraps, and pre-v0.4 accounts getting a keypair on upgrade without re-encrypting a byte. I re-confirmed the server half is still genuinely absent (no migration beyond `0013_*`, no `x25519`/`identity_public` symbol anywhere in `crates/pv-server/src`), so Partial is the correct state. |
| KEY-02 | `[x]` / **Complete** | ⚠️ **OVER-CLAIMED — new inaccuracy introduced by this commit** | The first half ("a shared collection has its own Collection Key") is delivered as a primitive. The rest is not, and is now unowned: `identity::seal` is **single-recipient** (`identity.rs:306`) and nothing seals one Collection Key to a *set* of members; `grep -rniE 'member\|family\|rewrap\|re-key'` over `pv-core/src` + `pv-wasm/src` returns **two comment-only hits** and no membership code at all; there is no add/remove-member operation to "rewrap keys only". Phase 22's Requirements line does not claim KEY-02; Phase 25 claims KEY-06/KEY-07 and its SC#2/SC#3 cover re-key **cost-scoping** and **atomicity**, never "sealed independently to each member's public key" or "`enc_data` is never touched". So KEY-02 is now checked off with two clauses unimplemented and no owning success criterion — precisely the defect this commit fixed for KEY-01. See W1b. |
| KEY-03 | `[x]` / **Complete** | ✓ **ACCEPTED as accurate** | Unlike KEY-02, KEY-03's text imposes no server/membership obligation — it is a pure crypto-scheme requirement (item AAD binds scope), and it is now fully delivered, bridged through pv-wasm, and provably tested in all three scope directions (SC#3). My earlier objection ("nothing stores items under collection scope yet") was about downstream *use*, not about the requirement's own obligation; promoting to Complete is defensible. |
| KEY-04 | `[x]` / **Complete** | ✓ **ACCURATE — my prior under-claim finding was correctly actioned** | Three new `:v1` constants (`INFO_X25519_SK_WRAP`, `AAD_COLL_ITEM_KEY_PREFIX`, `AAD_COLL_ITEM_DATA_PREFIX`), `constant_distinctness` asserting inequality against all four pre-existing `INFO_*`, and now `key_wrap_prefix_not_interchangeable_with_data_prefix` pinning the AAD-prefix pairs too. Nothing remains for a later phase. |
| KEY-05 | `[x]` / **Complete** | ✓ ACCURATE | Truth #1. |

**Orphaned requirements:** none at the requirement-ID level. The clause-level hole moved rather than closed: KEY-01's outstanding clauses are now owned by Phase 22 SC#5 (good), but KEY-02's are now owned by nobody *and* marked done (W1b).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` in any file this round touched | — | **None found.** Debt-marker gate passes cleanly. |
| `crates/pv-core/src/identity.rs` | 577-590 | (was W2 — doc overstated the test) | ✓ **RESOLVED** | Doc now says the body uses ONE keypair, explains why the per-seal ephemeral still makes it a meaningful round trip, names the real cross-party test, and even records that the old wording was wrong. Body re-read at `identity.rs:587-596`: `recipient_a` only — the comment now matches the code exactly. |
| `crates/pv-core/tests/backward_compat.rs` | 1-17 | (was W3 — doc pointed at a non-existent generator) | ✓ **RESOLVED** | Doc now states the generator was an ephemeral `examples/` binary deleted before the fixture was committed — deliberately, so no later `cargo test` can regenerate it — never committed, not recoverable from `git log`, with provenance resting on the `8c24514` < `caa90c4` ordering. **Both new factual claims independently verified** (see Behavioral Spot-Checks). |

### Warnings

**W1a — RESOLVED.** KEY-01's over-claim and KEY-04's under-claim are both fixed, and KEY-01's homeless clauses now have a named owner with a checkable criterion (Phase 22 SC#5). This was the substance of the second human-verification item in the previous report.

**W1b — NEW (adjudication requested): the traceability fix over-corrected onto KEY-02.**
`56bafad` flipped KEY-02 from `[ ]`/Pending to `[x]`/Complete. That directly contradicts the previous verification's recorded finding, which stated that the "adding or removing a member rewraps keys only" behaviour is Phase 25 work and that "`Pending` is the honest status". No code changed between the two verifications to justify the flip — the commit is docs-only. The consequence is structural, not cosmetic: because KEY-02 is now checked off and no later phase's requirements line or success criteria claim it, two real obligations (per-member sealing of one Collection Key; rewrap-without-touching-`enc_data` on membership change) will never be re-checked. This is the same failure mode the commit correctly fixed for KEY-01, relocated. Routed to human verification. **It does not touch the phase goal** — all four of Phase 21's ROADMAP Success Criteria are pv-core-scoped and all four now pass.

### Carried-Forward Warnings (WR-13 / WR-14) — unchanged, NOT counted as gaps

Per instruction these remain non-blocking and are not gaps against the phase goal. The initial pass verified that `.planning/todos/pending/2026-07-30-pv-core-zeroize-hardening-gaps.md` describes them accurately (four `generate()` sites leaving an un-zeroized `Copy` of the key array; three `pv-wasm` `mem::take` sites where net exposure is unchanged from pre-fix). Nothing in the three closure commits touched those code paths, so that assessment stands. The accepted deferral of pv-provider zeroize hardening also carries forward unchanged.

### Scope Fence

**Still held.** The three closure commits add: 35 test-only lines in `items.rs`, doc-only edits in `identity.rs` and `backward_compat.rs`, and markdown edits in `.planning/REQUIREMENTS.md` and `.planning/ROADMAP.md`. No migration, no server route, no `web/`, no `extension/`. Server persistence of the keypair remains Phase 22 (now explicitly, via SC#5); re-key on member removal remains Phase 25.

### Gaps Summary

**The phase goal is achieved, and SC#3 — the one criterion I refused to pass last round — is now genuinely closed.** I did not take that on trust: the new reverse-direction test asserts the specific `CryptoError::Decrypt` variant, its same-key construction is real (both `from_bytes` take the array by value, so WR-11's zeroize cannot poison the caller's copy), and when I collapsed the collection AAD scheme onto the personal one in an isolated worktree the test failed exactly as a load-bearing test must. All three pairwise scope directions plus the empty-`collection_id` edge are covered, so "any other scope" is satisfied for the scope set that exists. The prefix-isolation addition is likewise load-bearing, though it pins AAD bytes rather than performing a behavioral blob swap — sufficient, but worth knowing it is the weaker of the two forms IN-05 sketched.

The two stale doc claims are now accurate, and I verified their *new* factual assertions rather than just noting the text changed: no generator was ever committed and deleted (`--diff-filter=D` returns nothing), the commit ordering they cite is real, and the referenced pv-wasm cross-party test exists. SC#1, SC#2 and SC#4 are carried forward and re-confirmed undisturbed — in particular `build_item_aad` and both frozen personal prefixes are still byte-identical to their pre-phase form despite `items.rs` being edited, and `backward_compat.rs`'s 14 changed lines are all `//!` comments with the assertion untouched.

What stops this from being `passed` is one thing, and it is not a code defect:

1. **The traceability fix over-corrected.** It closed KEY-01's hole properly — with a real Phase 22 success criterion — but simultaneously marked **KEY-02 Complete**, which over-claims two unimplemented clauses and leaves them owned by no phase. That is the same defect class, moved one row down, and it contradicts my own prior recorded finding in the direction that costs more later. A one-line revert plus a Phase 22/25 mapping decision fixes it, but *which* phase owns per-member sealing versus rewrap-on-removal is a milestone-scoping call, not something the codebase can settle — so it goes to you rather than to a plan.

No blockers. `cargo test --workspace` 196/0, clippy 0, supply chain clean, debt-marker gate clean.

---

_Verified: 2026-07-30T03:34:00Z_
_Verifier: Claude (gsd-verifier) — re-verification #1_
