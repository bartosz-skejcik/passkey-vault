---
status: awaiting_human_verify
trigger: |
  Live e2e failure in web/e2e/family-wide-sharing.spec.ts:1208
  "revocation: a member REMOVED by the owner loses family-wide access on the
  next completed sync; a remaining member sees the quiet re-key notice".
  Fails at the SECOND assertRecipientDecrypts (~line 1268) -- the setup
  anchor before any removal happens. Passive member C cannot read the
  freshly family-wide-shared item, even after relockAndUnlock.
  Two candidate causes since 30-17 (where this test passed, 8 passed/1 skipped):
  1. Un-skipped "leave" test at ~line 1087 (member E self-deletes)
  2. Uncommitted fix in crates/pv-server/src/routes/account.rs
     (delete_account_as_member reassigns vault_items.user_id for
     collection-scoped items to family owner before DELETE FROM users cascade)
  Must discriminate via isolated revert experiments, not guess.
created: 2026-08-11T07:13:51Z
updated: 2026-08-11T09:48:00Z
---

## Current Focus

hypothesis: |
  The ISOLATED run (-g "REMOVED by the owner") fails for a DIFFERENT reason
  than the full-suite run: in isolation, the SC3-fresh-invite test (which is
  what actually makes memberC.joinViaInviteUI into the family) never runs,
  so memberC is NOT a family_members row at all when the isolated test
  starts. CONFIRMED via direct sqlite3 query on a controlled scratch DB:
  family_members only contains owner + F (this test's own new member); C's
  user_id is absent. So isolated-run failure != full-suite failure; the
  isolated repro the task description treated as equivalent is actually a
  test-ordering artifact, not evidence about account.rs or the leave-test
  un-skip. Must run the REAL sequence (SC2 through REMOVED, in order) on a
  fresh DB to observe the actual full-suite failure mode.
test: Run e2e prefix (SC2, SC3 fresh invite, SC3 gap window, timing copy, LEAVES, REMOVED) in order against a fresh scratch DB I control, then inspect collection_keys/family_members directly via sqlite3 after the REMOVED test fails.
expecting: If C IS a real family_members row but collection_keys has no row (or a stale one) for the new removeFolderId collection, that confirms a real fan-out bug reachable only through the full sequence (candidate: interaction with the leave test's rekey or the reassignment fix). If collection_keys DOES have a correct row for C, the bug is client-side discovery, not server-side sealing.
next_action: DONE -- root cause confirmed, fix applied and verified (unit
  tests + full live e2e run, 9/9 passed). Awaiting Bartek's review; explicitly
  instructed not to commit -- no git commit has been made. Files touched:
  crates/pv-server/src/routes/membership.rs (new
  require_collection_access_for_propagation + may_grant_access_level),
  crates/pv-server/src/routes/invitations.rs (create()'s family_wide_keys
  loop now calls the new helper instead of require_collection_edit).
  web/e2e/family-wide-sharing.spec.ts and crates/pv-server/src/routes/account.rs
  are UNCHANGED from their pre-session uncommitted state (both preserved,
  not touched further).

## Symptoms

expected: |
  Member C, a passive recipient of a brand-new family-wide-shared
  collection, should be able to decrypt/read an item in that collection
  after relockAndUnlock -- BEFORE any removal happens. This is the setup
  anchor for a later revocation assertion.
actual: |
  assertRecipientDecrypts for member C fails at line ~1268 -- C cannot
  decrypt the item even after relockAndUnlock(memberC.page, FAMILY_MEMBER_C_PASSWORD).
errors: |
  Test failure at e2e/family-wide-sharing.spec.ts:1268 (assertRecipientDecrypts
  for member C, setup anchor before removal). Exact assertion error TBD --
  need to run isolated to capture.
reproduction: |
  cd web && npx playwright test e2e/family-wide-sharing.spec.ts -g "REMOVED by the owner" --retries=0
started: |
  Regression since 30-17 report (8 passed, 1 skipped). Two changes since then:
  un-skip of leave test (~line 1087, member E self-delete) and uncommitted
  account.rs fix for delete_account_as_member re-parenting vault_items.user_id.
full_suite_run: "5 passed, 1 failed, 3 did not run (~6.6 min)"
isolated_run: "same test, same assertion, still fails"

## Eliminated

## Evidence

- timestamp: 2026-08-11T09:15Z
  checked: sqlite3 dbrun1/pv.db family_members after running the ISOLATED
    test (-g "REMOVED by the owner") alone against a controlled scratch DB
    (fix + un-skip both present, matching working tree)
  found: family_members contains ONLY owner + F (the test's own freshly-
    joined member). memberC's user_id (649f1330-...) is ABSENT.
  implication: the isolated run's failure is NOT the same bug as the full
    suite's. In isolation the SC3-fresh-invite test (the ONLY test that
    actually calls joinViaInviteUI(memberC...)) never runs, so C is simply
    not a family member yet -- assertRecipientDecrypts fails for the mundane
    reason that C has zero collection_keys rows for anything. The task
    framing's "same test, same assertion, still fails" is true at the
    symptom level but NOT proof of a shared root cause. Must use the REAL
    in-order sequence to observe the actual full-suite bug.

- timestamp: 2026-08-11T09:26Z
  checked: ran the real in-order prefix (SC2, SC3 fresh invite, SC3 gap
    window, timing copy/SC5, LEAVES (E self-deletes), REMOVED) against a
    FRESH scratch DB, single worker, no other changes
  found: first 5 tests passed (5.2m total). Test 6 (REMOVED) hit its own
    300_000ms test.setTimeout and Playwright force-closed the page while it
    was still waiting inside generateInviteViaUI(owner.page) for
    invite-link-display to appear -- i.e. it hung generating F's invite,
    BEFORE ever reaching F's or C's assertRecipientDecrypts. server.log shows
    zero errors/warnings for the whole run (RUST_LOG=info). DB snapshot at
    crash time: F IS a real registered user but has NO family_members row
    (never got past invite/join) -- consistent with the hang happening at
    invite generation, not later.
  implication: this does NOT match the reported failure point (C's setup
    anchor) at all -- it hung much earlier, on the OWNER's own UI, right
    after the LEAVE test's E-self-deletion re-keyed every pre-existing
    family-wide collection the owner/C also hold (SC2's, SC3-gap's,
    SC5-clause-2's -- E's invite was generated AFTER all of those existed,
    so invite-time-wrap gave E access to all of them, and
    buildMemberRemovalBatch(isSelf=true) resolves ALL of E's reachable
    collections via listCollections(), not just E's own). Two live
    hypotheses now: (a) genuine timing/perf hang from re-keying N collections
    with real WASM crypto work amplifying the OWNER's next UI interaction
    into a multi-minute stall (a real perf regression, not present when
    LEAVES test was skipped since apply_member_removal_rekey never ran with
    that scope before), or (b) environment resource contention on this
    machine (unrelated). Re-running with console/pageerror instrumentation
    on owner.page + memberC.page to distinguish a JS/WASM error from a pure
    perf stall.

- timestamp: 2026-08-11T09:33Z
  checked: re-ran the same in-order sequence with owner.page request/response
    logging added (temp instrumentation) and test.setTimeout shortened to
    60_000 for fast iteration, fresh scratch DB
  found: |
    [DEBUG owner ->] POST http://localhost:8620/api/invitations
    [DEBUG owner <-] 403 POST http://localhost:8620/api/invitations
    ...then the test times out waiting for invite-link-display, which never
    appears (FamilyTab.tsx's handleGenerate DOES catch the error and set a
    visible generateError state -- the test helper just never checks for it,
    so it hangs for the full budget instead of failing fast).
    Direct sqlite3 query on this run's DB confirms the mechanism: owner's OWN
    collection_keys.access_level for the 4 family-wide collections in
    existence at that point is 'edit','edit','edit','read' -- the LAST one
    (created_at latest, the LEAVE test's own leaveCollectionId) is 'read',
    because e2e/family-wide-sharing.spec.ts:1106 shares it as
    shareFolderFamilyWide(memberE.page, leaveFolderId, "read", ...) -- the
    FIRST "read"-level (not "edit") family-wide share anywhere in this
    file's whole sequence. apply_member_removal_rekey (families.rs) rotates
    sealed_key on departure but never touches access_level (by design --
    re-keying must not escalate/de-escalate a grant), so owner keeps 'read'
    on it after E leaves.
  implication: ROOT CAUSE CONFIRMED. lib/invite/crypto.ts::generateInviteLink
    (lines 100-115) unconditionally folds EVERY family-wide collection the
    caller currently holds ANY key for into the invite's family_wide_keys,
    using the caller's OWN access_level verbatim -- with NO regard to
    whether the caller holds edit on it. Server-side,
    invitations::create (crates/pv-server/src/routes/invitations.rs:232-236)
    validates EVERY family_wide_keys entry via
    membership::require_collection_edit, which 403s unless the caller holds
    edit on THAT SPECIFIC collection. Once the owner holds merely 'read' on
    ANY one family-wide collection, EVERY subsequent invite the owner tries
    to generate -- even a bare family-only invite with no explicit
    collection scope -- 403s and silently hangs the caller's UI in an error
    state. This is 100% reproducible (2/2 full-length runs, byte-identical
    DB state and console signal), not a flake. It is UNRELATED to
    account.rs's reassignment fix (which only touches vault_items.user_id).
    It is exposed -- not created -- by un-skipping the LEAVE test, because
    that is the first test anywhere in this file's sequence to create a
    "read"-level family-wide share and then have the RECIPIENT of that
    share (not its creator) go on to generate a fresh invite.

## Resolution

reasoning_checkpoint:
  hypothesis: |
    POST /api/invitations 403s for the owner because
    invitations::create's per-entry family_wide_keys validation loop calls
    membership::require_collection_edit for EVERY family-wide collection the
    caller holds a key for (an unconditional, additive invite-time-wrap
    fold-in the client performs on every single invite generation), which
    requires the caller to hold `edit` on each one -- but the caller here
    only holds `read` on one of them (E's own family-wide share, the first
    "read"-level one in this suite's sequence), because
    apply_member_removal_rekey correctly preserves each recipient's
    access_level across a re-key rather than escalating it.
  confirming_evidence:
    - "Direct request/response log on owner.page: POST /api/invitations -> 403, immediately before the observed hang, first and only POST to that endpoint in the whole test."
    - "Direct sqlite3 query of owner's own collection_keys rows: access_level is 'read' for exactly the one collection created by shareFolderFamilyWide(..., \"read\", ...) in the LEAVE test, 'edit' for the other three (all created with accessLevel=\"edit\")."
    - "Read invitations.rs:222-236 and membership.rs:480-488: require_collection_edit's gate::<RequireEdit>() 403s on any resolved level other than exactly Edit -- structurally matches the observed status code."
    - "Read lib/invite/crypto.ts:100-115: generateInviteLink's family-wide fold-in loop is unconditional over every family-wide row listCollections() returns, with no access_level filter -- explains why even a bare family-only invite (no explicit collection scope) triggers this."
  falsification_test: "If I revert JUST the family-wide-sharing.spec.ts line that shares leaveFolderId with \"edit\" instead of \"read\" (keeping the un-skip and account.rs fix otherwise untouched) and re-run the same sequence, the 403/hang must disappear. (Not applied -- would be a test-tweak masking a real prod bug, forbidden by this task's own constraints; used only as a mental falsification check, matches the mechanism.)"
  fix_rationale: |
    The fix must live in invitations::create's authorization check, not the
    test: a plain "read" family-wide recipient MUST be able to generate
    invites (including propagating their own "read" grant to the new
    member) -- that is the whole point of family-wide sharing being a
    living group (30-DECISION-FSH-02.md). require_collection_edit is the
    RIGHT gate for the single explicit collection-scope invite (a
    deliberate "share this collection" action, mirroring
    collections::add_member's own RequireEdit-only gate) but the WRONG gate
    for the automatic, additive family-wide fold-in loop, which should only
    require that the caller currently holds SOME access to the collection
    (RequireRead) and that whatever access_level they submit for it does
    not EXCEED what they actually hold (never trust the client's claim
    beyond that bound) -- preserving the existing, test-proven ability for
    an edit-holder to deliberately narrow a propagated grant to "read"
    (invitation_accept_grants_single_collection_and_two_family_wide_collections_atomically
    in crates/pv-server/tests/invitations.rs explicitly proves and depends
    on that narrowing behavior).
  blind_spots: |
    The SAME conceptual bug (RequireEdit gating an automatic propagation
    action rather than a deliberate share action) likely also affects the
    lazy-reseal path: families::family_wide_pending's `resealable` query
    (families.rs:414-426) offers a "read"-only holder as a valid resealer
    with NO access_level filter, but reshareCollectionToNewMember (client)
    calls collections::add_member, which is gated Membership<Collection,
    RequireEdit> -- so a read-only keyholder's reseal attempt would also
    403 (silently, inside resealTrigger.ts's Promise.allSettled). NOT fixed
    here -- out of scope for this specific reproduced test failure (no
    currently-failing test exercises it), and touching a second endpoint
    under time pressure increases risk without a red test proving it's
    needed right now. Flagging plainly per this task's own instructions
    rather than silently leaving it undiscovered.
  candidate_causes:
    - "code: invitations::create's family_wide_keys loop reuses require_collection_edit (built for a different, deliberate-share use case) for an automatic additive-propagation use case that should only require read-and-bounded-by-actual-level"
    - "data/product-flow: the LEAVE test is the first scenario anywhere in this suite to create a 'read'-level (not 'edit') family-wide share and then have a passive recipient of it generate a new invite -- the bug was always latent, never previously exercised"
  and_gate: "no -- single root cause (the authorization gate). The un-skipped LEAVE test and account.rs fix are both present in the failing run, but account.rs's reassignment logic never touches collection_keys/access_level/invitations at all (verified by reading the diff) and is not a contributing cause; it is present but inert for this specific failure."

root_cause: |
  invitations::create (crates/pv-server/src/routes/invitations.rs) gates
  EVERY entry of the automatic, additive family-wide invite-time-wrap
  fold-in via membership::require_collection_edit (RequireEdit), instead of
  a check that only requires the caller to hold SOME access to the
  collection and bounds the requested access_level by what they actually
  hold. Because apply_member_removal_rekey correctly preserves each
  recipient's original access_level across a re-key (by design), any member
  who has ever received "read" (not "edit") access to a family-wide
  collection is permanently unable to generate ANY invite afterward -- not
  just one scoped to that collection. In this suite, the newly-un-skipped
  LEAVE test is the first scenario to create such a "read"-level family-wide
  share and then have its passive recipient (the owner) go on to generate a
  new invite -- exposing a real, previously-uncovered production
  authorization bug, unrelated to the uncommitted account.rs fix (which only
  reassigns vault_items.user_id and never touches collection_keys /
  access_level / invitations at all).
fix: |
  Added membership::require_collection_access_for_propagation (new,
  pub(crate)) alongside require_collection_edit: resolves the caller's own
  AccessLevel for the collection (Collection::resolve_access, unchanged --
  zero-knowledge/resolve_access widening constraint respected) and permits
  the request's claimed access_level only when the caller's actual level
  authorizes it (exact-match, or edit-caller-narrowing-to-read -- an
  explicit, non-Ord may_grant_access_level match, matching this module's
  own "never a transitive ordering shortcut" discipline for AccessLevel).
  invitations::create's family_wide_keys loop now calls this instead of
  require_collection_edit; the single explicit collection-scope check
  (scope.kind === "collection") is untouched -- still require_collection_edit,
  matching collections::add_member's own deliberate-share gate.
verification: |
  cargo test -p pv-server (full workspace test binary set, not just
  invitations/family_wide_sharing): ALL GREEN, 0 failed, 0 ignored, across
  every test file including the two invitations.rs tests that specifically
  pin this exact boundary
  (invitation_create_with_family_wide_collection_caller_lacks_edit_on_rejects
  still 404s as before; invitation_accept_grants_single_collection_and_two_
  family_wide_collections_atomically still proves an edit-holder's
  deliberate read-narrowing choice is honored verbatim).
  Restored web/e2e/family-wide-sharing.spec.ts to byte-identical match
  against the pre-debug-session backup (diff exit 0) before the final run
  -- all temp console/request instrumentation and the shortened
  test.setTimeout were fully removed.
  Full live e2e run, exactly the deliverable's own command
  (`npx playwright test e2e/family-wide-sharing.spec.ts --retries=0`),
  fresh throwaway PV_E2E_DB_DIR, full webServer rebuild (next build +
  cargo build --release): 9 passed, 0 failed, 0 skipped, 1.1m. Test 6 (the
  previously-hanging one) now passes in 32.1s -- both F's and C's
  assertRecipientDecrypts succeed, the removal/notice assertions succeed,
  and every other test in the file (including the two collection-scoped
  deletion/suspension tests that run AFTER it) passes too.
  No leftover pv-server/chromium processes after the run; port 8620 free.
files_changed:
  - crates/pv-server/src/routes/membership.rs
  - crates/pv-server/src/routes/invitations.rs
