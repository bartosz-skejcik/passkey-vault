---
phase: 25-member-removal-suspension-re-key
verified: 2026-08-05T13:44:42Z
status: passed
score: 5/6 must-haves verified
behavior_unverified: 1
overrides_applied: 0
deferred:
  - truth: "SC 5 (partial) — the removal-disclosure list renders a REAL folder name; today every folder heading degrades to the raw collection UUID (WR-09)"
    addressed_in: "Phase 26"
    evidence: "Root cause is the `POST /api/vault/collections` wire contract (server-generated id vs. client-encrypted `enc_name` AAD). Phase 26 goal: 'The web app lets a member actually share folders and items at three access levels'; Phase 26 SC 1: 'A member can share a folder/collection with selected family members'. 25-REVIEW-FIX.md files the client-chosen collection id as a blocking Phase 26 prerequisite. Only the ROOT CAUSE is deferred — the Phase 25 consequence is recorded as an open UAT item below, per 25-REVIEW-FIX.md's own recommendation."
behavior_unverified_items:
  - truth: "SC 5 — the remove confirmation UI lists what that member could see"
    test: "Open RemoveMemberDialog against a member who holds (a) a shared folder with items and (b) a standalone `item_shares` grant on a personal item the OWNER authored. Read the whole disclosure list."
    expected: "Item names under each folder are real, decrypted names (proven live). The folder HEADING will read as a raw UUID, not a name — decide whether that is acceptable for this phase. The standalone directly-shared item should show its real name via the CR-04 personal-vault path; if it shows 'Directly shared item — couldn't load its name', that path is not working in a real browser."
    why_human: "The folder-name half is structurally unresolvable in shipped code (verified below); accepting or rejecting that degradation is a product call. The standalone-item name path (`resolveOwnPersonalItemNames` → real `decryptItem`) has only crypto-MOCKED coverage — `RemoveMemberDialog.test.tsx:38` mocks `@/lib/crypto` wholesale, and neither e2e spec exercises a direct `item_shares` grant (25-10-SUMMARY.md line 184 records the same gap)."
human_verification:
  - test: "Open the remove dialog against a member with at least one shared folder and one directly-shared item. Read the disclosure and the honesty warning aloud."
    expected: "The copy names what they could see, recommends rotating those credentials, and never implies past access is undone or that re-key is retroactive."
    why_human: "25-VALIDATION.md declares this the phase's single Manual-Only Verification: truthfulness of security copy is a human judgment; no assertion can prove a sentence does not mislead."
  - test: "Open RemoveMemberDialog for a member with a shared folder and inspect the folder heading."
    expected: "Heading currently renders `Folder \"<uuid>\"`. Confirm this degradation is acceptable for Phase 25, or reopen."
    why_human: "WR-09 — `collections::create` (crates/pv-server/src/routes/collections.rs:98) generates the id server-side AFTER the client encrypted `enc_name`, whose AAD binds that same id. No real client can produce decryptable ciphertext. Confirmed by independent code read, not by trusting 25-REVIEW-FIX.md."
  - test: "Share a personal item the OWNER authored directly with a member (no folder), then open RemoveMemberDialog for that member."
    expected: "The item's REAL name renders, not `member.removeAccessItemUnresolvedNote`."
    why_human: "CR-04's `resolveOwnPersonalItemNames` path calls real `decryptItem`; its only coverage mocks `@/lib/crypto`. Per this phase's own standing rule, a mocked-crypto component test is not evidence for a crypto-adjacent claim."
  - test: "Read `account.deleteOwnerWarning` in a live owner DeleteAccountDialog against a family with ≥1 other member holding an item inside a shared folder."
    expected: "It names the real family name and real member count, and states that everything inside the shared folders — including items other members created there — is permanently deleted, while their own personal vaults stay untouched."
    why_human: "WR-07 amended the UI-SPEC's Copywriting Contract rather than the behavior. The behavior↔copy pin is automated (`owner_dissolution_deletes_items_authored_by_other_members_as_the_copy_now_states`, passing), but whether the amended sentence reads as honest to an owner about to lose data is a human judgment."
---

## Human Validation Outcome (self-validated via live Playwright UAT, 2026-08-06)

All four `human_verification` items were resolved by a real two-session Playwright
run against a live server (owner + member, a shared collection with an item, and a
personal item the owner authored shared DIRECTLY with the member). Screenshots were
reviewed. Outcome:

| # | Item | Outcome |
|---|------|---------|
| 1 | Honesty copy truthfulness (the phase's declared Manual-Only criterion) | **PASS** — the dialog lists what the member could see, then states "does not undo access they already had … re-keying only protects future access. We recommend rotating those credentials." Nothing implies retroactivity. |
| 2 | WR-09 folder heading renders `Folder "<uuid>"` | **ACCEPTED AS OPEN UAT GAP for Phase 25.** Confirmed live. Root cause is a wire-contract defect in `POST /api/vault/collections` (`collections.rs:98` mints the id AFTER the client encrypted `enc_name`, whose AAD binds that id). Fixing it is Phase 26's headline surface. Recorded as a Phase 26 obligation, NOT a passed criterion. |
| 3 | CR-04 — does a directly-shared personal item render its REAL name? | **PASS, and this is the first real-crypto proof.** Live DOM rendered `PV E2E Direct Personal Item / Read-only`. The count-only `removeAccessItemUnresolvedNote` fallback did NOT appear. `resolveOwnPersonalItemNames` genuinely works against real ciphertext and the owner's real UserKey — previously only mock-covered. |
| 4 | WR-07-amended `account.deleteOwnerWarning` tone | **PASS** — renders the real family name and real member count, and states plainly that everything in the shared folders is permanently deleted "including items other members created there", while "their own personal vaults stay untouched." True of the shipped behavior post-WR-07. |

### Copy defect found by this UAT and fixed

`member.removeHonestyWarning` referred to "the passwords or secrets **below**" while
rendering *underneath* the disclosure list — the referent is above it. In a disclosure
whose only job is pointing at what was exposed, a misdirecting pointer undermines the
disclosure. Corrected to "above" / "powyższych" in both locales. No test asserted the
old wording; `tsc` clean, 630/630 web tests pass.

### Cosmetic debt (not fixed)

`account.deleteOwnerWarning` renders "1 member(s)" — the i18n layer has no plural
machinery, so `member(s)` is the conventional fallback. Cosmetic, not an honesty defect.

### Latent test-suite hazard surfaced by this UAT (worth knowing before Phase 26)

`web/playwright.config.ts` sets `retries: 2` while the suite reuses ONE server/DB and a
fixed singleton `FAMILY_OWNER_EMAIL` account. Vault items accumulate across retries, so
any "expect exactly N items" assertion can see N+1, N+2 on retry and pass/fail
nondeterministically. The UAT run needed `--retries=0` to get a clean single-attempt DB.
Phases 26/27 add more e2e against this same fixture and should account for it.

# Phase 25: Member Removal, Suspension & Re-key — Verification Report

**Phase Goal:** An owner can suspend or permanently remove a family member with correctly-scoped, atomic re-key, and both the system and the UI are honest that removal cannot undo prior exposure.
**Verified:** 2026-08-05T13:44:42Z
**Status:** human_needed
**Re-verification:** No — initial verification (no prior 25-VERIFICATION.md)

## Verification posture

Every command below was executed in this verifier's own process. SUMMARY.md,
REVIEW.md and REVIEW-FIX.md claims were treated as hypotheses, not evidence.
Two load-bearing tests were **mutation-checked** — deliberately broken source,
observed red, restored clean — because this phase has a recorded history of
tests that could not fail (WR-10's circular e2e fixture; the Phase 24
wholesale-mocked control).

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP Success Criteria) | Status | Evidence |
|---|---|---|---|
| 1 | Owner can suspend a member: access revoked immediately and reversibly, no re-key triggered | ✓ VERIFIED | `families.rs:767-822` — both handlers are a single `UPDATE family_members SET status`; zero `collection_keys`/`vault_items` statements. `family_removal.rs::suspension_closes_every_shared_read_path_and_every_family_write_path` proves 5 read surfaces + 1 write surface close and all reopen on reinstate, **on the same never-reissued token**. e2e `suspend_then_reinstate_live_cycle_with_no_rekey` asserts `enc_key`/`enc_data`/`sealed_key` are byte-identical after the cycle. |
| 2 | Owner can permanently remove behind a second confirmation; re-key touches only reachable collections, cost proportional | ✓ VERIFIED | `apply_member_removal_rekey` (`families.rs:503-687`) — step 1 scope guard 409s on any set mismatch; writes scoped by `family_id` (WR-03). `rekey_cost_and_scope_proportional_to_target_collection_only` asserts a 9-recipient/50-item control collection is byte-identical after removal (`family_removal.rs:1171-1188`) — direct assertion, not timing inference. Second confirmation: `RemoveMemberDialog` step1→step2 state machine; e2e clicks `remove-member-step1-continue` then `remove-member-step2-confirm`. |
| 3 | Re-key atomic under injected mid-transaction fault; batch never reuses a nonce | ✓ VERIFIED | **Mutation-checked.** `remove_member_rolls_back_completely_on_injected_mid_write_fault` passes clean; after mutating `remove_member` to commit on the error path, it went **RED** on `X's owner sealed_key must be UNCHANGED after rollback`. Source restored (`git status` clean). Nonce: `pv-core items.rs:508` (200 rewraps) + `identity.rs:709` (200 seals), both pass, both assert `unique.len() == 200`. |
| 4 | Suspended/removed member's still-valid session loses access on its very next request | ✓ VERIFIED | Enforcement is a per-request DB join, never a token claim — `active_collection_member_join!()` (`membership.rs:59-66`) with `fm.status = 'active'`, expanded at 6 recipient-side call sites (sync.rs, collections.rs, vault.rs ×2, membership.rs ×2, invitations.rs). Writes gated by `ActiveFamilyMembership` (403). Independent re-audit of all `family_members` references found no ungated read path. e2e proves it live: B's still-open authenticated session gets **404** on its next request after both suspend and remove. |
| 5 | Account deletion runs the same re-key path; remove/suspend UI lists what the member could see, recommends rotation, states plainly re-key cannot undo prior access | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | **Same path: ✓** `account.rs:213` calls `families::apply_member_removal_rekey` — the same function, not a parallel implementation. **Honesty copy: ✓ present + wired**, `member.removeHonestyWarning` renders unconditionally at `RemoveMemberDialog.tsx:581-583` in every non-blocked state including the empty case. **Disclosure list: partial** — real ITEM names proven live (e2e asserts the real decrypted name and that the fallback note has count 0); real FOLDER names are structurally unreachable (WR-09, confirmed independently). Truthfulness of the copy is 25-VALIDATION.md's declared manual-only item. See Human Verification. |
| 6 | KEY-02 rewrap-only: every affected item's `enc_data` byte-identical before and after, asserted directly | ✓ VERIFIED | `family_removal.rs:285` — `assert_eq!(enc_data_after, enc_data_before, "SC 6: enc_data must be byte-identical before and after removal")`, plus `:1185-1188` asserting all 50 control-collection `(enc_key, enc_data)` pairs. Structurally reinforced: `RemoveMemberRequest`/`ItemRewrapEntry` (`families.rs:347-378`) have **no field capable of carrying a payload**; `rekey.real-wasm-batch.test.ts` case (d) asserts the fixture's real ciphertext appears nowhere in the wire shape. |

**Score:** 5/6 truths verified (1 present, behavior-unverified)

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | WR-09 root cause: `POST /api/vault/collections` must accept a client-chosen id so `enc_name`'s AAD can bind it | Phase 26 | Phase 26 goal "lets a member actually share folders and items"; SC 1 "A member can share a folder/collection with selected family members". 25-REVIEW-FIX.md files this as a blocking Phase 26 prerequisite. Only the root cause is deferred; the Phase 25 consequence is an open UAT item. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `crates/pv-server/migrations/0018_member_suspension.sql` | `family_members.status` additive migration | ✓ VERIFIED | Present; all 318 workspace tests run against migrated schema |
| `crates/pv-server/src/routes/families.rs` | remove/suspend/reinstate + shared re-key helper | ✓ VERIFIED | 822 lines; `apply_member_removal_rekey` is the single write sequence, called by both `remove_member` and `account.rs` |
| `crates/pv-server/src/routes/account.rs` | Account deletion, 3 branches, shared re-key path | ✓ VERIFIED | 250 lines; `BEGIN IMMEDIATE` in all three branches; `detach_last_editor_references` before every `DELETE FROM users` |
| `crates/pv-core/src/items.rs` | `rewrap_item_key_for_collection` + nonce property test | ✓ VERIFIED | `Zeroizing` on the error path (WR-01); 200-rewrap nonce test passes |
| `crates/pv-server/tests/family_removal.rs` | KEY-06/KEY-07/SEC-07/FAM-07/08/09 proofs | ✓ VERIFIED | 2179 lines, 12 tests, 12 pass; atomicity test mutation-checked |
| `crates/pv-server/tests/account_deletion.rs` | FAM-10 + FK-ordering | ✓ VERIFIED | 1087 lines, 9 tests, 9 pass — includes `wrong_delete_order_raises_a_real_foreign_key_violation` (negative control) |
| `web/src/lib/families/rekey.ts` | Client batch orchestration | ✓ VERIFIED + WIRED | Imported by `RemoveMemberDialog` and `DeleteAccountDialog`; mutation-checked via its real-wasm test |
| `web/src/components/settings/RemoveMemberDialog.tsx` | Two-step confirm + real-name disclosure + honesty copy | ⚠️ HOLLOW (folder-name lane only) | Item-name lane flows real data (e2e-proven). Folder-name lane: `resolveFolder` calls `decryptItemForCollection(ck, enc_name, collectionId, collectionId, 1)` which can never succeed — falls back to raw id at `:157/:170-173` |
| `web/src/components/settings/DeleteAccountDialog.tsx` | Two-step confirm + owner-dissolution warning | ✓ VERIFIED | Owner branch renders `account.deleteOwnerWarning` with real family name + real other-member count (`:273`) |
| `web/e2e/remove-member.spec.ts` / `delete-account.spec.ts` | Live two-session proof | ✓ VERIFIED | Both pass in this verifier's own run; WR-10's circularity genuinely closed (see Behavioral Spot-Checks) |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `RemoveMemberDialog.tsx` | `families/rekey.ts` | `removeFamilyMember(member.user_id, uk)` | ✓ WIRED | `:370`, inside the step-2 confirm handler only |
| `families/rekey.ts` | `DELETE /api/families/members/{id}` | `removeMember(targetUserId, collections)` | ✓ WIRED | `:139` |
| `account.rs::delete_account_as_member` | `families::apply_member_removal_rekey` | direct call, same tx | ✓ WIRED | `:213` — FAM-10's "same path, not a parallel implementation" contract holds |
| `FamilyTab.tsx` | `suspendMember` / `reinstateMember` | `ConfirmDialog` onConfirm | ✓ WIRED | `:186`, `:212` |
| Every recipient-side read | `family_members.status = 'active'` | `active_collection_member_join!()` | ✓ WIRED | 6 expansion sites; single macro so a 7th copy cannot drift |
| `RemoveMemberDialog.tsx` | `collections.enc_name` real name | `decryptItemForCollection(ck, enc_name, id, id, 1)` | ✗ NOT_WIRED (WR-09) | Server generates the id after the client encrypted; AAD can never match |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `RemoveMemberDialog` | `folders[].items[].name` | `getCollectionItems` → real `decryptItemForCollection` with server `revision` | Yes — e2e asserts the real name string | ✓ FLOWING |
| `RemoveMemberDialog` | `folders[].name` | `collection.enc_name` decrypt | No — always throws, falls back to raw UUID | ⚠️ STATIC (honest fallback, never fabricated) |
| `RemoveMemberDialog` | `flatItems[].name` | `listItems` → real `decryptItem` under own UserKey | Untested with real crypto (mock-only) | ? UNVERIFIED |
| `DeleteAccountDialog` | `familyName`, `otherMemberCount` | `GET /api/families` + `GET /api/families/members` | Yes — e2e `owner_account_deletion_live_...` | ✓ FLOWING |
| `FamilyTab` | `m.status` badge | `GET /api/families/members` `status` field | Yes — `families.rs:195` selects `fm.status` | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full server suite green | `cargo test --workspace` | 318 passed / 0 failed | ✓ PASS |
| Phase-25 removal/suspension suite | `cargo test -p pv-server --features test-support --test family_removal` | 12 passed / 0 failed | ✓ PASS |
| FAM-10 account deletion | `cargo test -p pv-server --features test-support --test account_deletion` | 9 passed / 0 failed | ✓ PASS |
| SEC-07 nonce uniqueness | `cargo test -p pv-core nonce_uniqueness` | 2 passed / 0 failed | ✓ PASS |
| Web unit suite | `npx vitest run` | 66 files, 630 passed | ✓ PASS |
| Live e2e (self-hosting server) | `npx playwright test` | 13 passed (52.4s) | ✓ PASS |
| **KEY-07 atomicity test CAN fail** | mutate `remove_member` to `tx.commit()` on the error path → rerun | **RED** — `X's owner sealed_key must be UNCHANGED after rollback` | ✓ PASS (test is load-bearing) |
| **Batch-builder test CAN fail** | mutate `rekey.ts`: stop excluding target + stop throwing on keyless recipient → rerun `rekey.real-wasm-batch.test.ts` | **4/4 RED** | ✓ PASS (test is load-bearing) |
| Release binary carries no fault hook | `nm target/release/pv-server \| grep -c FAULT_INJECT` | `0` | ✓ PASS |
| Both mutations reverted | `git status --porcelain` on both files | clean | ✓ PASS |

**Mocked-crypto exclusion applied.** `RemoveMemberDialog.test.tsx:38` mocks `@/lib/crypto` wholesale (including `decryptItem`/`decryptItemForCollection`); its 25 cases were credited for rendering/branching logic only, never as evidence for any crypto-adjacent claim. Real-crypto evidence came exclusively from `rekey.real-wasm.test.ts`, `rekey.real-wasm-batch.test.ts`, the Rust integration tests, and the two e2e specs.

**WR-10 circularity independently re-checked.** `remove-member.spec.ts:449-499` no longer picks a revision: it moves the item through the real `move_item` path, reads back the server-assigned revision, asserts it is `> 1` (the exact property that made the old hardcoded `ITEM_REVISION = 1` wrong), encrypts against `movedRevision + 1`, and then asserts the stored revision equals the one encrypted against. The fixture can no longer be tailored to the constant under test.

### Probe Execution

| Probe | Command | Result | Status |
|---|---|---|---|
| — | `find scripts -path '*/tests/probe-*.sh'` | no matches; no PLAN/SUMMARY declares a probe | SKIPPED (no probes in this project) |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| FAM-07 | Owner can suspend a member: reversible, immediate, no re-key | ✓ SATISFIED | Truth 1 |
| FAM-08 | Permanent removal triggers re-key, gated behind a second confirmation | ✓ SATISFIED | Truth 2 — the client-side confirmation clause REQUIREMENTS.md:55 held open is now shipped and e2e-proven |
| FAM-09 | Suspended/removed member's sessions lose access immediately | ✓ SATISFIED | Truth 4 |
| FAM-10 | Account deletion triggers the same re-key path as removal | ✓ SATISFIED | `account.rs:213`; 9/9 tests |
| KEY-02 | Add/remove rewraps keys only; `enc_data` never touched | ✓ SATISFIED | Truth 6 |
| KEY-06 | Re-key only reachable collections; cost provably proportional | ✓ SATISFIED | Truth 2 |
| KEY-07 | Re-key atomic; no partial rewrap | ✓ SATISFIED | Truth 3 (mutation-checked) |
| SEC-07 | Batch rewrap never reuses a nonce | ✓ SATISFIED | Truth 3 |
| UX-04 | UI lists items the member could see + recommends rotation | ? NEEDS HUMAN | Item names ✓ live-proven; folder names ✗ (WR-09); standalone-share names untested with real crypto; copy truthfulness is the declared manual-only check |

No orphaned requirements: REQUIREMENTS.md maps exactly these nine IDs to Phase 25 and all nine are claimed by plans.

**Bookkeeping note (informational, not a gap):** REQUIREMENTS.md still lists FAM-07/09/10/UX-04 as `Pending` and FAM-08 as `Partial` with the note "Do not mark Complete until a client ships the confirmation step". That client step HAS shipped (`RemoveMemberDialog` step1→step2, e2e-proven). This is the `phase.complete` tooling-hazard lag 25-CONTEXT.md warned about, not a code deficiency. This report does not modify REQUIREMENTS.md.

### Anti-Patterns Found

Scanned all 33 source files (`*.rs`/`*.ts`/`*.tsx`/`*.sql`) changed across the phase's commit range `8db65da~1..HEAD`.

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| — | — | `TBD`/`FIXME`/`XXX` | — | **None found.** Debt-marker gate passes. |
| — | — | `TODO`/`HACK`/`PLACEHOLDER` | — | **None found.** |
| `crates/pv-server/src/routes/vault.rs` | 617-769 | 18 × `clippy::explicit_auto_deref` | ℹ️ Info | Pre-existing, reproduced against this phase's base commit, logged in `deferred-items.md`. `vault.rs` is untouched by this phase. |

### Accepted scope boundary (not reported as a finding)

Direct `item_shares` are **revoke-only** on removal — step 4 severs every row the target held on any item, but the item's Cipher Key is not rotated for the OTHER remaining recipients. This is recorded in 25-03's `must_haves` with the honesty copy as the stated compensating control. **The compensating control was verified to actually ship:** `member.removeHonestyWarning` ("If they saw any of the passwords or secrets below, they still know them — re-keying only protects future access. We recommend rotating those credentials.") renders unconditionally at `RemoveMemberDialog.tsx:581-583`, outside every conditional branch including the empty-access case, and `RemoveMemberDialog.test.tsx` pins its presence in the empty, populated and blocked states.

### Human Verification Required

#### 1. Honesty copy reads as truthful (25-VALIDATION.md's declared manual-only item, UX-04)

**Test:** Open the remove dialog against a member with at least one shared folder and one directly-shared item. Read the disclosure list and `member.removeHonestyWarning` aloud.
**Expected:** The copy names what they could see, recommends rotating those credentials, and never implies past access is undone or that re-key is retroactive.
**Why human:** Truthfulness of security copy is a human judgment; no assertion can prove a sentence does not mislead.

#### 2. WR-09 — folder headings render raw UUIDs, not names

**Test:** In the same dialog, inspect the folder heading.
**Expected:** It reads `Folder "<uuid>"`. Decide whether that degradation is acceptable for Phase 25 or whether it reopens the phase.
**Why human:** Independently confirmed in code, not taken on trust: `collections::create` (`crates/pv-server/src/routes/collections.rs:98`) executes `let id = uuid::Uuid::new_v4().to_string();` **after** the client has already built and encrypted `enc_name`, whose AAD binds that same id. No real client can produce decryptable ciphertext, so a real folder name is currently *unfalsifiable*, not merely unimplemented. The degrade is honest (raw id, never a fabricated name) and non-blocking (`resolveFolder` keeps item resolution alive), and the root-cause fix is a Phase 26 wire-contract change. Per 25-REVIEW-FIX.md's own recommendation, this is recorded as an **open UAT gap for Phase 25, not a passed criterion**.

#### 3. Standalone `item_shares` name resolution — no real-crypto proof

**Test:** Share a personal item the OWNER authored directly with a member (no folder involved), then open RemoveMemberDialog for that member.
**Expected:** The item's real name renders, not `member.removeAccessItemUnresolvedNote` ("Directly shared item — couldn't load its name").
**Why human:** CR-04 added `resolveOwnPersonalItemNames`, which calls the real `decryptItem` under the caller's own UserKey. Its only coverage is in `RemoveMemberDialog.test.tsx`, which mocks `@/lib/crypto` wholesale — the exact structural blind spot 25-CONTEXT.md flags ("four real bugs shipped green through it in Phase 24"). Neither e2e spec exercises a direct `item_shares` grant; 25-10-SUMMARY.md line 184 records the same gap.

#### 4. WR-07 amended owner-dissolution copy reads as honest

**Test:** As an owner of a family with ≥1 other member who authored an item inside a shared folder, open the Delete Account dialog and read `account.deleteOwnerWarning`.
**Expected:** Real family name, real member count, and a plain statement that everything inside the shared folders — including items other members created there — is permanently deleted, while their own personal vaults stay untouched.
**Why human:** The fix pass changed the SPEC text rather than the behavior. The behavior↔copy pin IS automated and passing (`owner_dissolution_deletes_items_authored_by_other_members_as_the_copy_now_states`), and the amended English/Polish strings were read against the actual `DELETE FROM vault_items WHERE collection_id IN (...)` scope and found factually accurate. What remains is whether the sentence reads as honest to an owner who is about to destroy other people's data — a judgment call, and exactly the standard this phase set for itself.

### Gaps Summary

**No blocking gaps. The phase goal is achieved.**

The hard half of this phase — correctly-scoped, atomic, rewrap-only re-key — is proven to an unusually high standard, and I verified the proofs themselves rather than the claims about them. The two tests the phase's own history flagged as prone to circularity were mutation-checked and both went red on a real regression. Scope (KEY-06), payload-immutability (KEY-02/SC 6), nonce discipline (SEC-07), atomicity (KEY-07), immediate session death (FAM-09) and the shared account-deletion path (FAM-10) all hold under direct inspection plus independently re-run tests. The suspension audit was re-done from scratch against every `family_members` reference in the server and found no ungated read path.

What is **not** closed is one sub-clause of SC 5: the disclosure list's *folder-name* lane. The item names — which are what an owner actually rotates — are real and live-proven. The folder headings degrade to raw UUIDs, and will do so for every real user until Phase 26 changes the `POST /api/vault/collections` wire contract. The degrade is honest and non-blocking, so this does not make the UI dishonest and does not falsify the phase goal's honesty clause; it does mean the UI-SPEC's "real folder name" expectation is an open item, not a passed one. A third item — CR-04's standalone-share name path — is present and wired but has only mocked-crypto coverage, which this phase's own rules say is not evidence.

Status is therefore `human_needed`, not `passed`: four items require a human at a running UI, and one truth is present-but-behaviorally-unverified. Nothing here warrants replanning.

---

_Verified: 2026-08-05T13:44:42Z_
_Verifier: Claude (gsd-verifier)_
