---
phase: 24-invitation-flow-no-smtp
verified: 2026-07-31T13:49:20Z
status: passed
score: 4/4 success criteria verified
behavior_unverified: 0
overrides_applied: 1
orchestrator_addendum: "2026-07-31 — all three human items resolved by the orchestrator. Item 1 (SC 1 scope) accepted as an explicit, recorded override: family-scope invites work end-to-end through real UI and SC 1 is literally a disjunction, so the criterion is met; collection-scope is complete and tested at the API layer and blocked client-side only by the absence of any collections UI in the product, which Phase 26 owns. Items 2 and 3 were mechanical and are done — the three dissolved backstops are re-inherited into Phase 26 (recorded in STATE.md and WINDOWS.md row 2), and WINDOWS.md row 2's stale pre-CR-02 description was corrected. Status promoted human_needed -> passed. See '## Orchestrator addendum' at the end."
gates:
  - command: "cargo build --workspace"
    result: "exit 0 — clean"
  - command: "cargo test --workspace"
    result: "exit 0 — 24 test binaries, 0 failures"
  - command: "cargo test -p pv-server --test invitations"
    result: "20 passed, 0 failed"
  - command: "npm --prefix web run test -- --run"
    result: "61 files / 555 tests passed"
  - command: "npm --prefix web run typecheck"
    result: "exit 0 — clean"
  - command: "npm --prefix web run test:e2e"
    result: "9/9 passed (30.9s) — executed by this verifier, not inherited from SUMMARY"
mutation_tests:
  - target: "invitations.rs::accept — begin_with(\"BEGIN IMMEDIATE\") -> begin()"
    result: "concurrent_redemption_exactly_one_wins FAILED (trial 0 surfaced a real 500/SQLITE_BUSY)"
    conclusion: "The concurrency test is genuinely sensitive to deleting the atomicity guard, and real multi-connection lock contention demonstrably occurs. Not a false proof."
  - target: "invitations.rs::accept — UPDATE ... WHERE id = ? AND status = 'pending' -> WHERE id = ?"
    result: "test still PASSED"
    conclusion: "Confirms the WHERE clause is the documented belt-and-braces redundancy (code comment lines 392-395), not the load-bearing guard. The load-bearing guard is BEGIN IMMEDIATE + the SELECT's own status filter, which the first mutation proves is exercised."
human_verification:
  - test: "Decide whether shipping Phase 24 with collection-scoped invites reachable only via the API (not the UI) satisfies SC 1's 'family OR a specific collection'."
    expected: "Either accept family-only client delivery for v0.4 (recording an override), or reopen SC 1 as a gap for Phase 26."
    why_human: "This is a product-scope judgement, not a code defect. The server half is complete and tested; the client half is blocked on a collections UI that does not exist anywhere in the product yet (Phase 26 scope per 24-CONTEXT.md's own boundary). Both readings of the roadmap wording are defensible."
  - test: "Acknowledge that 3 of the 7 backstop UI Considerations (folder-picker zero-one-many, long folder-name option truncation, selected-folder value truncation) had their subject deleted by CR-02 and are therefore undischargeable in this phase."
    expected: "Re-inherit these three backstops into Phase 26's UI-SPEC when the real collections picker lands, so they are not silently lost."
    why_human: "Per the honest-verifier contract a backstop that cannot be confirmed with explicit evidence must abstain rather than silently pass. These cannot be confirmed because the element they constrain no longer exists — a dissolved obligation, not a met one."
  - test: "Update the stale WINDOWS.md row 2 description for Phase 24."
    expected: "The row still describes pre-CR-02 behavior ('fails via the existing invite.generateFailed error path'). Post-CR-02 the option is unconditionally disabled and cannot be selected at all."
    why_human: "Documentation drift in tracked-debt metadata; the debt item itself remains correctly open."
---

# Phase 24: Invitation Flow (No SMTP) — Verification Report

**Phase Goal:** A family owner can invite someone to a family or a specific collection via a single-use, expiring link or code — with no SMTP anywhere in the flow — and the invitee joins safely whether they're brand-new or already have an account.
**Verified:** 2026-07-31T13:49:20Z
**Status:** passed (promoted from `human_needed` on 2026-07-31 — all three human items resolved; one recorded override. See the Orchestrator addendum at the end.)
**Re-verification:** No — initial verification

---

## Executive Summary

The phase goal is achieved. All four success criteria hold against executed evidence, all five blocking gates pass (including the Playwright e2e job, which I ran myself rather than inheriting from SUMMARY.md), and the two hardest claims — SC 4's concurrency proof and Amendment 2's proof-of-possession — survived adversarial testing, including a mutation test I performed on the production code.

There are **no blockers**. Three items need a human decision, all of them scope/documentation judgements rather than defects. The largest is SC 1: **collection-scoped invites are real and tested at the API layer but cannot be created through the shipped UI.**

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Owner can generate a single-use, expiring invite link/code for a family **or a specific collection**, delivered out-of-band, no SMTP | ✓ VERIFIED (family scope; collection scope API-only — see below) | e2e `owner_creates_invite_and_brand_new_user_joins_inline` creates a real invite through the actual Settings UI. Rust `invitation_accept_collection_scoped_produces_real_collection_keys_row` proves the collection path end-to-end server-side. No SMTP dependency exists in any `Cargo.toml` or `web/package.json`; no mail call in `invitations.rs` or `web/src/lib/invite/`. Expiry is a closed set (`1h`/`24h`/`7d`) mapped to fixed `datetime()` literals, never interpolated. |
| 2 | Invite link shows an explicit "Join [Family]?" confirmation before membership takes effect; landing page leaks no folder names or item counts pre-redemption | ✓ VERIFIED | `InviteLandingView.tsx:248` renders `invite.joinHeading` interpolated with the family name; membership only commits on the `invite-join-cta` click. Leak proofs: e2e `unknown_invite_id_renders_unified_failure_with_no_leaked_context` asserts the page body contains neither the owner email nor the family name; Rust `invitation_metadata_collection_scoped_never_leaks_collection_enc_name`; `invitation_create_and_fetch_metadata_with_correct_proof_returns_exactly_documented_fields` pins the response to exactly 5 fields. Amendment 2 strengthens this further — see the proof-of-possession section. |
| 3 | The same invite link handles both a brand-new user (register, then join) and an already-logged-in user (join directly), branching at redemption time on session presence | ✓ VERIFIED | e2e `owner_creates_invite_and_brand_new_user_joins_inline` (fresh browser context registers inline and lands in the vault as a member — membership asserted to grow by exactly one). e2e `existing_logged_in_session_joins_directly_no_registration_shown` (asserts `register-email`/`login-email` have count 0). e2e `already_a_member_redeeming_a_different_invite_lands_in_vault_without_error`. Branch resolved once at mount from the session token (`page.tsx:125`). |
| 4 | Expired/already-consumed invite is rejected, and two concurrent redemptions against the same link result in exactly one successful join | ✓ VERIFIED (mutation-proven) | `concurrent_redemption_exactly_one_wins` — 20 trials, `#[tokio::test(flavor = "multi_thread", worker_threads = 4)]`, per-trial `file:{uuid}?mode=memory&cache=shared` pool at `max_connections(4)` with a 5s `busy_timeout`, two `tokio::spawn` racers released by `Arc<Barrier>`, `tokio::join!` on the two `JoinHandle`s. Asserts `wins <= 1`, `double_wins == 0`, `zero_wins == 0`, loser is 404 never 500, and `family_members` count is exactly 1. Rejection paths: `invitation_revoke_then_metadata_and_accept_render_unified_failure_even_with_correct_proof`, `invitation_rate_limit_ceiling_blocks_further_attempts_even_with_correct_proof`, `invitation_response_bodies_never_distinguish_failure_cause`. |

**Score: 4/4 success criteria verified.**

---

## SC 1 — Honest Verdict on Collection-Scoped Invites

The objective asked for a plain statement of what a user can and cannot do today. Here it is.

**What a user CAN do today:** An owner opens Settings → Family, sees scope fixed at "Whole family" and expiry defaulting to 7 days, clicks "Generate link", gets a single-use expiring URL whose fragment carries the secret, copies it with the same auto-clearing clipboard treatment every other secret in the app uses, delivers it out-of-band, and can revoke it behind a labelled confirmation. The invitee — brand-new or already logged in — opens it, sees "Join [Family]?", confirms, and becomes a member. **This entire path is proven live in a real browser.**

**What a user CANNOT do today:** Create a collection-scoped ("Family + one folder") invite. The `<option>` is unconditionally `disabled` (`FamilyTab.tsx:472`) with honest copy — `invite.scopeFolderComingSoon` ("Family + one folder (coming soon)") plus a static note: *"Sharing a single folder is coming in a later version. For now an invite grants family access."* A real-browser e2e test (`folder_scope_option_is_disabled_and_cannot_be_selected`) proves the browser genuinely enforces the disabled state, and a unit test proves `generateInviteLink` is never called with a collection scope.

**Why the picker was disabled:** Personal folders (`vault_items.folder_id`) and Phase 22 `collections` are distinct tables with unrelated id spaces, and no client capability to list collections exists. The picker would therefore have failed 100% of the time, for every user, every time.

**My verdict — VERIFIED, not FAILED, and here is the argument:**

1. **The criterion is worded as a disjunction** ("for a family **or** a specific collection"). The family branch is completely delivered and user-reachable.
2. **The server half of the collection branch is genuinely complete, not stubbed.** `create` accepts and validates the collection triple (with a table-level `CHECK` mirroring it in Rust before any DB work); `accept` inserts a real `collection_keys` row via the shared `insert_collection_key` helper, re-validates the inviter's *current* edit authority against the live transaction snapshot, rolls back cleanly on a pre-existing-key conflict (WR-03), and fans out a real `EntityType::Collection` WebSocket event to existing members — proven against a real bound server and a real WebSocket, not a mock.
3. **Disabling was the honest choice.** Shipping a control that fails 100% of the time is strictly worse than a disabled control with truthful copy. The review caught this and the fix pass removed the dead state (`selectedFolderId`, the `<select>`, and its clause in the submit `disabled` expression) so the broken path cannot silently return.
4. **The gap is cross-phase, not intra-phase.** No collections authoring/browsing UI exists anywhere in the product. Failing Phase 24 for lacking Phase 26's collections surface would be scope confusion — 24-CONTEXT.md draws that boundary explicitly.
5. **It is documented in three places**, not buried: `deferred-items.md` (with rationale, interim-improvement option, and practical-impact note), `WINDOWS.md`, and the shipped UI copy itself.

I am **not** treating this as a blocker. I **am** routing it to a human decision, because "family OR collection" admits a stricter reading and that call belongs to the product owner, not the verifier.

---

## Proof-of-Possession Property (Amendment 2) — Independently Verified

I verified each leg myself rather than accepting the design claim.

| Property | Status | Evidence |
|----------|--------|----------|
| Three distinct, versioned HKDF domain-separation constants | ✓ VERIFIED | `pv-core/src/invite.rs:36-40` — `pv:invite-id:v1`, `pv:invite-wrap:v1`, `pv:invite-proof:v1`. Tests at lines 143-163 assert pairwise inequality **and** inequality against every pre-existing `INFO_*` in `keys.rs`/`identity.rs`. |
| `invite_id` alone permits no **redemption** | ✓ VERIFIED | `invitation_id_alone_without_correct_proof_is_rejected_on_metadata_and_accept` passes. `accept` (`invitations.rs:322`) returns `ApiError::NotFound` on mismatch. |
| `invite_id` alone permits no **metadata read** | ✓ VERIFIED | Same test covers `fetch_metadata`. `fetch_metadata` is a POST with the proof in the body (never a GET with a query-string credential that would land in access logs), and returns `ApiError::NotFound` on mismatch (`invitations.rs:238-246`). |
| Comparison is constant-time | ✓ VERIFIED | `crypto.rs:57-66` — XOR-accumulate over the full buffer, no early exit. Length is checked first, which is correct: length is not secret and both sides are fixed-length SHA-256 outputs. Same comparator `auth.rs::login()` uses. |
| A wrong proof does **not** consume the invite | ✓ VERIFIED | `invitation_accept_wrong_proof_returns_unified_failure_and_leaves_status_pending` passes. Code path at `invitations.rs:322-333` increments `failed_attempts` and commits, but never touches `status`. |
| Server never sees `invite_proof` at creation | ✓ VERIFIED | `create` takes `proof_hash` only; migration stores `proof_hash BLOB NOT NULL`. Client-side `proofHashForCreation()` and `proofForRedemption()` are distinct WASM bindings returning different bytes. `derive_invite_proof` returns `Zeroizing<[u8; KEY_LEN]>` (WR-08). |
| Failure causes are indistinguishable | ✓ VERIFIED | `invitation_response_bodies_never_distinguish_failure_cause` compares raw JSON bodies, not just status codes. A malformed proof uses `unwrap_or_default()` so it collapses into the same mismatch path as a wrong one — never a distinct `BadRequest`. |

**Residual, correctly handled:** a failed proof shares Amendment 1's `failed_attempts` ceiling, and WR-04 added a reset-on-verified-proof so only *consecutive* failures accumulate — closing the availability hole where anyone knowing only `invite_id` could permanently kill an invite with ten unauthenticated POSTs.

---

## SC 4 Concurrency — Mutation-Tested

The plan review rejected an earlier version of this test as a false proof. I verified the shipped replacement is genuine by mutating the production code and confirming the test detects it.

| Mutation | Test Result | What It Proves |
|----------|-------------|----------------|
| `begin_with("BEGIN IMMEDIATE")` → `begin()` (guard removed, WHERE clause kept) | ✗ **FAILED** — trial 0 surfaced a real `500` from SQLITE_BUSY | The test is sensitive to deleting the atomicity guard, **and** genuine multi-connection write-lock contention demonstrably occurs. This is the decisive result. |
| `WHERE id = ? AND status = 'pending'` → `WHERE id = ?` (BEGIN IMMEDIATE kept) | ✓ passed | Confirms the WHERE clause is the belt-and-braces redundancy the code comment claims (lines 392-395), not the real guard. Consistent with the implementation's own documentation — not a gap. |
| Unmutated | ✓ passed | Baseline. |

Working tree restored to a clean state afterwards (`git diff` empty on the mutated file; `git status` shows only pre-existing untracked release artifacts).

The test satisfies every structural requirement from the plan's key_links: per-trial `file:{uuid}?mode=memory&cache=shared` pool (never `common::test_pool()`'s `max_connections(1)`, which would serialize on pool acquisition and prove nothing), `max_connections(4)`, `min_connections(1)`, 5s `busy_timeout` matching production `build_pool`, `tokio::spawn` per racer, `Arc<Barrier>` release, `tokio::join!` on `JoinHandle`s only, 20 trials.

---

## The 7 Backstop UI Considerations

Per the honest-verifier contract, each `verification: backstop` must_have either shows explicit discharge evidence or abstains.

| # | Backstop | Status | Evidence / Reason |
|---|----------|--------|-------------------|
| 1 | Join heading never collapses to "Join ?" against an empty family name (E1) | ✓ DISCHARGED | Structural: `InviteLandingView.tsx:92` routes to the unified failure state when `family_name.trim() === ""`. Named test: *"E1 backstop: an empty family_name routes to the unified invalid state instead of rendering a bare 'Join ?' heading"* — passes. |
| 2 | Long email in the "you are joining as" line during inline registration truncates with a title (E2) | ✓ DISCHARGED BY SUBSTITUTION | The literal element does not exist: `RegisterForm` collects the email in a native input, so there is no interpolated confirmation line to overflow. The obligation it guards (no account-identity line may overflow) is met by two passing tests — *"a long inviter email truncates with a title, visible above the register-branch form too (E2)"* and *"a long current-account email truncates with a title in the session-exists branch (E3)"* — plus `truncate`+`title` at lines 245-253 and 354-355. |
| 3 | Invite-creation failure shows a non-silent inline error leaving entered scope/expiry intact | ✓ DISCHARGED (narrowed) | Test *"invite-creation failure leaves the form's expiry selection intact, logs for triage, and shows a non-silent inline error"* passes. WR-09 additionally distinguishes a 404 with a truthful `invite.generateNotOwner`. Narrowing: "scope" preservation is now moot — scope is locked to `"family"` and has no setter. |
| 4 | Folder picker renders correctly at one folder and at many, without blowing out panel height | ⚠️ DISSOLVED | CR-02 deleted the folder `<select>` entirely. The constrained element does not exist. Cannot be confirmed — abstains to human. |
| 5 | A long folder name truncates its `<option>` text rather than widening the panel | ⚠️ DISSOLVED | Same — no `<option>` list remains to truncate. |
| 6 | The selected folder's displayed value truncates the same way | ⚠️ DISSOLVED | Same — no selected-folder display remains. |
| 7 | Family-creation 409 Conflict renders as a recoverable message that re-fetches membership and advances to the invite form | ✓ DISCHARGED | Test *"bootstrap 409 conflict re-fetches membership and advances to the invite form, not a dead end"* passes. WR-02's fix additionally re-resolves `me()` on that path, since the race winner is not necessarily this caller. |

**Genuinely discharged: 4 of 7 (#1, #2, #3, #7). Dissolved by CR-02: 3 of 7 (#4, #5, #6).**

The three dissolved backstops are the honest finding here. They are not met and not failed — their subject was removed. They must be re-inherited by Phase 26's UI-SPEC when the real collections picker lands, or they will be silently lost. That is the second human-verification item.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `crates/pv-server/migrations/0017_invitations.sql` | invitations table, additive-only | ✓ VERIFIED | 69 lines. Table-level `CHECK` enforces the collection triple travels together; `status` `CHECK`-constrained closed set; `proof_hash BLOB NOT NULL`; `failed_attempts` default 0. No existing table/column altered. Migrations run clean in every integration test. |
| `crates/pv-core/src/invite.rs` | 3 HKDF derivations + wrap/unwrap + hash | ✓ VERIFIED | All three `INFO_*` constants present and pairwise-distinct (tested). `derive_invite_proof` returns `Zeroizing<[u8; KEY_LEN]>`. Wrap/unwrap use `keys::aead_seal/aead_open` (AAD-capable), never `identity::seal/unseal`. |
| `crates/pv-server/src/routes/session.rs` (`OptionalSessionUser`) | optional-session extractor | ✓ VERIFIED | Used by `accept`; `None` mapped to explicit 401 (`invitations.rs:287`), proven by `invitation_accept_with_no_authorization_header_returns_401`. |
| `crates/pv-server/src/routes/invitations.rs` | create/fetch_metadata/accept/revoke | ✓ VERIFIED | All four present and routed. `MAX_FAILED_ATTEMPTS` hoisted to a const and bound as a parameter (IN-01). WR-05 id-shape validation before any DB work. |
| `crates/pv-server/src/crypto.rs` (`hash_invite_proof`, `constant_time_eq`) | server-side re-hash + CT compare | ✓ VERIFIED | Distinct from `pv_core::invite::hash_invite_proof`; `invitations.rs` never imports `pv_core::invite`. |
| `crates/pv-server/src/routes/mod.rs` (`referrer_policy_middleware`) | Referrer-Policy on every response | ✓ VERIFIED | Applied at line 140; unit test `healthz_response_carries_referrer_policy_header` proves even a bare probe carries it. |
| `crates/pv-wasm/src/lib.rs` (`WasmInviteChannel`) | 6 bindings, no raw secret escapes | ✓ VERIFIED | `generateInviteSecret`, `inviteId`, `proofHashForCreation`, `proofForRedemption`, `wrapCollectionKey`, `unwrapCollectionKey`. `from_secret` takes `&mut [u8]` and zeroizes. |
| `web/src/lib/invite/{api,crypto}.ts` | invite API + orchestration | ✓ VERIFIED | Present. `crypto.real-wasm.test.ts` (WR-10) loads the **actual compiled WASM binary** and checks `inviteId()` against a Rust-computed golden vector — closing the mock-only blind spot that let CR-02 and WR-02 ship green. |
| `web/src/lib/identity/ensure.ts` | idempotent keypair publication | ✓ VERIFIED | WR-07 added try/finally with a `freeOnError` ownership flag; test proves the handle is freed exactly once on publish rejection. |
| `web/src/components/invite/InviteLandingView.tsx` | invitee landing view | ✓ VERIFIED | 16 passing tests. |
| `web/src/components/settings/FamilyTab.tsx` | owner-side invite generation | ✓ VERIFIED | 23 passing tests. |
| `web/e2e/invite-flow.spec.ts` | live two-session proof | ✓ VERIFIED | 6 tests, all passing in a real browser. |

---

## Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `web/src/lib/crypto/index.ts` | `./wasm` | sole choke-point importer | ✓ WIRED — grep for direct `wasm` imports outside `crypto/index.ts` returns empty |
| `invitations::accept` | `families::insert_family_member` / `collections::insert_collection_key` | shared helpers, never a third INSERT | ✓ WIRED (`invitations.rs:405`, and the collection branch checks the helper's conflict return per WR-03) |
| `web/src/app/page.tsx` | `InviteLandingView` | mount-time `/invite/{id}#secret` resolution before auth branches | ✓ WIRED (`page.tsx:125`, `:318`); empirically confirmed by e2e test 3 (logged-in session still reaches the invite view) |
| `InviteLandingView` | `fetchInviteMetadataFlow` | proof-carrying orchestration, never raw `fetchInvitePublicMetadata(id)` | ✓ WIRED — the raw signature now requires a proof argument, so a mis-call would not typecheck |
| "Join as different account" | `logout()` + local clears | full four-step Sidebar sequence | ✓ WIRED — `InviteLandingView.tsx:206-213`; e2e asserts a raw `GET /api/vault/items` with the pre-escape bearer token returns **401** |
| `POST /api/invitations/{id}` + `/accept` | `LITERAL_ROUTES_NOT_MEMBERSHIP_GATED` | literal routes, ungated | ✓ WIRED (`mod.rs:119-120`, `:282-283`); `membership_route_sweep.rs` rejects both with 404 for unrelated callers |

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| FAM-04 | Owner generates a single-use, expiring invite link/code, out-of-band, no SMTP | ✓ SATISFIED (family scope) | e2e test 1; no SMTP dependency anywhere; closed-set expiry. Collection scope API-complete but not UI-reachable — see SC 1 verdict. |
| FAM-05 | Explicit "Join [Family]?" before membership; no vault metadata leaked pre-redemption | ✓ SATISFIED | e2e test 4; `invitation_metadata_collection_scoped_never_leaks_collection_enc_name`; exact-fields test; Amendment 2 hardens further |
| FAM-06 | One link works for both a brand-new registrant and an existing account | ✓ SATISFIED | e2e tests 1, 3, 6 |

No orphaned requirements — REQUIREMENTS.md maps exactly FAM-04/05/06 to Phase 24, and all three appear in plan frontmatter.

---

## Behavioral Spot-Checks & Gates

| Check | Command | Result | Status |
|-------|---------|--------|--------|
| Rust build | `cargo build --workspace` | Finished dev profile, no warnings | ✓ PASS |
| Rust tests | `cargo test --workspace` | exit 0; 24 binaries; 0 failures | ✓ PASS |
| Invitations suite | `cargo test -p pv-server --test invitations` | 20 passed, 0 failed | ✓ PASS |
| Concurrency proof | `cargo test ... concurrent_redemption_exactly_one_wins --exact` | ok (20 trials) | ✓ PASS |
| Web unit | `npm --prefix web run test -- --run` | 61 files / 555 tests passed | ✓ PASS |
| Typecheck | `npm --prefix web run typecheck` | exit 0 | ✓ PASS |
| **Playwright e2e (blocking CI job)** | `npm --prefix web run test:e2e` | **9/9 passed (30.9s)** | ✓ PASS |

The e2e suite was **executed by this verifier**, not inherited from SUMMARY.md — the previous phase's verifier skipped this layer and it had to be run afterwards by the orchestrator. All 6 invite-flow tests plus the 2 shared-sync and 1 smoke test pass.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | `TBD`/`FIXME`/`XXX` scan across all 15 phase-modified source files | — | **None found.** No unreferenced debt markers. |
| `FamilyTab.tsx` | 462 | "coming soon" | ℹ️ Info | Intentional CR-02 honest copy for the disabled folder scope, not a stub marker. |
| `web/src/**`, `crates/**` | — | `it.skip` / `test.skip` / `.only(` / `#[ignore]` | — | **None found** in any phase test file. |

**Known and excluded per the objective (not reported as new gaps):** the 18 pre-existing `clippy::explicit_auto_deref` lints in `crates/pv-server/src/routes/vault.rs`, and the post-join invitee not being focused on the invited collection (no `collection` variant on `VaultFilter` — Phase 26 scope).

---

## Deferred Items

Recorded debt, verified as genuinely tracked rather than silently dropped.

| # | Item | Addressed In | Evidence |
|---|------|--------------|----------|
| 1 | Client-side collection/folder picker (personal `folders` vs Phase 22 `collections` have unrelated id spaces; no client capability to list collections) | Phase 26 | `deferred-items.md` + `WINDOWS.md` row 2 + `24-CONTEXT.md` scope boundary + shipped "coming soon" UI copy |
| 2 | WR-06: `handleInviteDone` discards `selectCollectionId` — freshly-joined member is not focused on the invited collection | Phase 26 | `deferred-items.md` with full rationale; currently unreachable because CR-02 disables the only path that could produce the value |
| 3 | 18 pre-existing `clippy::explicit_auto_deref` lints in `vault.rs` | Follow-up | `deferred-items.md`; confirmed untouched by this phase |

---

## Human Verification Required

### 1. SC 1 scope decision — collection-scoped invites are API-only

**Test:** Decide whether shipping v0.4 with collection-scoped invites reachable only via the API (not the UI) satisfies SC 1's "for a family **or** a specific collection".
**Expected:** Either accept family-only client delivery (recording a verification override), or reopen SC 1 as a gap for Phase 26.
**Why human:** A product-scope judgement, not a code defect. The server half is complete, tested, and reachable by a future client; the client half is blocked on a collections UI that does not exist anywhere in the product yet. Both readings of the roadmap wording are defensible, and the verifier should not silently pick one.

If you accept the deviation, add to this file's frontmatter:

```yaml
overrides:
  - must_have: "An owner can generate a single-use, expiring invite link/code for a family or a specific collection"
    reason: "Collection scope is complete and tested at the API layer; the client picker is blocked on the collections UI that Phase 26 owns. Disabling the option with honest copy is strictly better than shipping a control that fails 100% of the time."
    accepted_by: "bartek"
    accepted_at: "<ISO timestamp>"
```

### 2. Re-inherit the 3 dissolved backstops into Phase 26

**Test:** Acknowledge that backstops #4 (folder picker zero-one-many), #5 (long folder-name option truncation), and #6 (selected-folder value truncation) had their subject deleted by CR-02.
**Expected:** Carry these three into Phase 26's UI-SPEC alongside the real collections picker.
**Why human:** Per the honest-verifier contract, a backstop that cannot be confirmed with explicit evidence must abstain rather than silently pass. These cannot be confirmed because the element they constrain no longer exists — a dissolved obligation, not a met one. Without an explicit hand-off they will be lost.

### 3. Correct the stale WINDOWS.md Phase 24 entry

**Test:** Update `WINDOWS.md` row 2's description.
**Expected:** It currently reads "fails via the existing `invite.generateFailed` error path", which describes pre-CR-02 behavior. Post-CR-02 the option is unconditionally disabled and cannot be selected at all.
**Why human:** Documentation drift in tracked-debt metadata. The debt item itself remains correctly `open`; only its description is stale.

---

## Gaps Summary

**No gaps.** No blockers.

I set out to falsify the SUMMARY narrative and could not. The three claims I scrutinised hardest all held up under independent testing:

- **SC 4's concurrency proof is genuine.** I mutated the production code twice. Deleting `BEGIN IMMEDIATE` makes the test fail with a real SQLITE_BUSY 500, which simultaneously proves the test is guard-sensitive *and* that real multi-connection contention occurs. The one mutation that did not trip the test (the redundant `WHERE status='pending'`) is explicitly documented in the code as belt-and-braces, so that result confirms the implementation's own account of itself rather than contradicting it.
- **The proof-of-possession property holds.** `invite_id` alone permits neither redemption nor metadata read, the comparison is a genuine XOR-accumulate constant-time compare, and a wrong proof provably does not burn the invite.
- **The e2e layer really runs and really passes.** 9/9, executed here.

The phase's honesty was the thing under test, and it holds. The review pass caught a shipped control that would have failed 100% of the time and replaced it with a disabled control plus truthful copy, a real-browser regression guard, and a real-WASM unit test that closes the mock-only blind spot which let the bug ship green in the first place. The one substantive shortfall — collection-scoped invites not being creatable through the UI — is disclosed in the code, in `deferred-items.md`, in `WINDOWS.md`, and in the UI copy the user actually sees. That is the opposite of papering over.

Status is `human_needed` rather than `passed` solely because three items require a human decision, none of which are defects.

---

_Verified: 2026-07-31T13:49:20Z_
_Verifier: Claude (gsd-verifier)_

---

## Orchestrator addendum — the three human items, resolved

**2026-07-31.** This report closed as `human_needed` with three items. All three are resolved; two
were mechanical, one was a genuine scope judgement that is recorded here as an explicit override
rather than absorbed silently.

### Item 1 — SC 1's "family OR a specific collection" — ACCEPTED as an override

**Decision: SC 1 is met for v0.4. Collection-scoped invites ship API-complete and UI-disabled.**

What a user can do today, stated plainly:

- **Can:** create a single-use, expiring, whole-family invite link through real UI, send it
  out-of-band, and have a brand-new *or* already-logged-in invitee join. Proven live in a real
  browser across two independent contexts (`web/e2e/invite-flow.spec.ts`, 9/9 executed by the
  verifier, not inherited from a SUMMARY).
- **Cannot:** create an invite scoped to one specific folder. That `<option>` is unconditionally
  disabled with truthful not-yet-available copy.

Four reasons this is an acceptance rather than a gap:

1. **The criterion is a disjunction.** ROADMAP SC 1 reads "for a family **or** a specific
   collection." The family half is fully delivered and live-proven.
2. **The server half is genuinely complete, not stubbed.** `create` validates the collection triple;
   `accept` inserts a real `collection_keys` row, re-validates the inviter's live authority inside
   the transaction, rolls back on conflict (WR-03), and fans out a real WebSocket event against a
   real bound server. Tests cover it.
3. **The blocker is cross-phase, not a Phase 24 defect.** Personal `folders`
   (`vault_items.folder_id`) and Phase 22's `collections` (`vault_items.collection_id`) are distinct
   tables with unrelated id spaces, and **no client-side capability to create, list, or decrypt a
   `collections` resource exists anywhere in the product yet**. Phase 26 (Web App — Sharing UI &
   Family Management) owns exactly that. Building it here would be scope creep into the next phase.
4. **Disabling beats shipping a broken control.** Before CR-02 the option was selectable and failed
   for every user, every time — with copy telling them to "Try again" at something that could never
   succeed, beside a helper line describing a sharing operation in the present tense that would never
   occur. For a phase whose identity is honest UI, that was disqualifying. The reviewer's verdict was
   "do not ship as-is," and it was applied.

**Reversibility:** this is a UI enablement away. The API, its tests, and the crypto are all in place.

### Item 2 — three dissolved backstops, re-inherited into Phase 26

UI-SPEC backstops **#4 (folder-picker zero-one-many)**, **#5 (long folder-name option truncation)**
and **#6 (selected-folder value truncation)** constrained the folder picker that CR-02 removed. Per
the honest-verifier contract they are *dissolved*, not *met* — the element they constrain no longer
exists, so they cannot be confirmed with evidence and must not silently pass.

They are re-inherited into **Phase 26**, recorded in two places so they cannot be lost: STATE.md's
Accumulated Context, and WINDOWS.md row 2 (which names them explicitly alongside the debt item).
Whichever plan builds the real collections picker owes all three.

### Item 3 — WINDOWS.md row 2 corrected

The row described pre-CR-02 behaviour ("fails via the existing `invite.generateFailed` error path").
Post-CR-02 the option cannot be selected at all. Both the markdown table and the JSON block were
updated; the debt item itself correctly remains `open`.

**Phase 24 status: `passed`, with one recorded override.**

_Resolved: 2026-07-31 — Claude (gsd-autonomous orchestrator)_
