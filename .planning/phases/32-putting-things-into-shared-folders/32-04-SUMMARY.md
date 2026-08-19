---
phase: 32-putting-things-into-shared-folders
plan: 04
subsystem: vault
tags: [playwright, e2e, sharing, sync, crypto]

requires:
  - phase: 32-putting-things-into-shared-folders (plan 01, wave 2)
    provides: "moveVaultItem (encrypt-under-destination-key, decrypt-nothing) and moveItemToDestinationViaEditor -- this plan's own two tests consume both directly; the depends_on: [\"32-02\"] in this plan's frontmatter is a file-overlap serialization on web/e2e/sharing.spec.ts, not a content dependency (32-PLAN-CHECK.md W-7)"
provides:
  - "web/e2e/sharing.spec.ts: SC3's TOCTOU-refusal test -- a demoted destination edit-holder's move is refused honestly (error.itemMoveAccessLost, non-retry-inviting) with the item's enc_key/enc_data/revision proven byte-identical before and after, and the destination collection proven to never receive the item"
  - "web/e2e/sharing.spec.ts: SC4's move-out-access-loss test -- a member with ONLY folder-derived access (no direct item_shares grant, by construction) reads the real password before a move-out and genuinely loses that SAME read (not merely list membership) on the next completed sync, no reload"
  - "web/e2e/sharing.spec.ts: apiPut helper, assertRecipientDecryptsLeavingPanelOpen helper (local, non-closing), moveItemOutOfFolderViaEditor helper"
affects: []

tech-stack:
  added: []
  patterns:
    - "A raw DELETE of a caller's own collection_access row is NOT a reliable way to drive a 403-shaped TOCTOU refusal: Collection::resolve_access resolves a fully-missing row to None, which gate::<M>() turns into 404 NotFound (confirmed independently by membership_route_sweep.rs's own 'unrelated caller gets 404' sweep). moveVaultItem's client code recognizes ONLY status === 403 as the refusal signal. A DEMOTION (PUT to a lower access_level, leaving the row present) resolves to Some(lower_level), which gate::<RequireEdit> correctly turns into 403 -- the genuinely client-recognized shape of an access-loss refusal for THIS mechanism (contrast Phase 31's ShareDialog preflight, which catches ANY throw from a bare getCollection() call and is 404-tolerant by construction)."
    - "A live sync test's negative anchor must be falsified against BOTH of a system's redundant delivery paths, not just one. Disabling only the WebSocket-shaped SyncEvent push for a collection still let the test pass, because sync.ts's own pre-existing 30s poll fallback independently recovered via the (still genuinely bumped) DB revision. The DISCRIMINATING probe was disabling the DB revision bump itself -- what both the push and the poll structurally depend on."
    - "A positive-anchor helper that closes its own UI panel cannot be reused for a test whose negative anchor needs that panel to stay open and mounted -- write a local, non-closing copy rather than parameterizing the shared helper with a close/no-close flag, matching this file's own per-file-owns-its-own-tiny-helper convention."

key-files:
  created: []
  modified:
    - web/e2e/sharing.spec.ts

key-decisions:
  - "Task 1's TOCTOU-driving mechanism was changed from the plan's literal DELETE to a PUT demotion (edit -> read), after independently verifying that a full DELETE of the owner's own collection_access row resolves server-side to 404 (Collection::resolve_access's None -> NotFound), which moveVaultItem's client code does not treat as the refusal signal (isForbiddenError checks ONLY status === 403). This was verified BEFORE writing the test (by reading membership.rs's gate() function and membership_route_sweep.rs's own assertion of the 404 behavior for an unrelated caller) and CONFIRMED empirically: the demotion-driven test passed cleanly on its first run; a DELETE-driven version was never even attempted live because the code-path analysis already showed it would produce the wrong (generic, retry-inviting) banner instead of the intended error.itemMoveAccessLost."
  - "Task 2's falsification required two rounds to find a genuinely discriminating probe. The first probe (disabling only the source collection's SyncEvent push) did NOT turn the test red -- sync.ts's independent 30s poll fallback recovered the access-loss signal anyway via the still-correctly-bumped DB revision, and the test passed in ~33s instead of the usual ~3s. The second probe (disabling the DB revision bump itself, which both the push and the poll depend on) produced genuine red: the item-row count stayed at 1 for the full 60s timeout. Documented in both places (this SUMMARY and the test's own falsification record) so a future reader does not mistake the first probe's false pass for insufficient rigor -- it correctly demonstrated the app's own redundant delivery design, which is exactly why the test needed a stronger probe."
  - "moveItemOutOfFolderViaEditor deliberately does NOT re-click item-row-${itemId} the way moveItemToDestinationViaEditor does. Its one call site always runs immediately after a prior move-in save left detail-panel open in view mode for the same item; that panel's own side-panel-scrim covers the item list and blocks a click on the row underneath it (observed live: locator.click retried 300+ times against 'element intercepts pointer events' before the test's 180s timeout). Opens edit mode directly from the already-open panel instead."

requirements-completed: [ORG-02, ORG-04]

coverage:
  - id: D1
    description: "SC3: a move whose destination access is revoked mid-session (deliberately driven TOCTOU) is refused with an honest, non-retry-inviting message, and the item's stored ciphertext and revision are byte-identical to before the attempt"
    requirement: "ORG-02"
    verification:
      - kind: e2e
        ref: "web/e2e/sharing.spec.ts -g \"SC3\" (live, two real sessions, fresh build)"
        status: pass
    human_judgment: false
  - id: D2
    description: "SC4: a member with ONLY folder-derived access (no direct item_shares grant, by construction) genuinely loses the ability to read an item after the owner moves it out of the shared folder via the item editor, on the member's own next completed sync -- proven by the SAME read (the password text locator) failing, not merely by the item leaving a list"
    requirement: "ORG-04"
    verification:
      - kind: e2e
        ref: "web/e2e/sharing.spec.ts -g \"SC4\" (live, two real sessions, fresh build)"
        status: pass
    human_judgment: false

duration: ~90min
completed: 2026-08-19
status: complete
---

# Phase 32 Plan 04: SC3 (TOCTOU refusal) and SC4 (move-out access loss) Summary

**Two new live, two-session Playwright tests close the phase's two hardest proof obligations -- SC3's TOCTOU move-refusal (driven via a PUT demotion after the plan's literal DELETE mechanism was independently verified to produce the wrong, non-discriminating server response for this code path) and SC4's move-out access loss (whose negative anchor is the same password-text read as the positive anchor, not a list-membership count, per 32-PLAN-CHECK.md's B-4/C-1 findings) -- both falsification-proven against the actual production gates they claim to exercise.**

## Performance

- **Duration:** ~90 min
- **Tasks:** 2 planned tasks, both completed, with one significant departure from the plan's literal mechanism in Task 1 (documented below, not a deviation-rule auto-fix since no application code changed -- a plan-authoring correction made before the test was ever run red)
- **Files modified:** 1 (web/e2e/sharing.spec.ts, two separate atomic commits carved out of one working session by line-range splitting since both tasks touch the same file)

## Accomplishments

- **SC3 (ORG-02):** a new live test drives a genuine TOCTOU window between the owner's destination-selection and their Save click: a second real edit-holder (memberA) demotes the owner's own access on the destination collection from `edit` to `read`. The server's pre-existing Gate 2 (`require_collection_edit` in `vault.rs::move_item`, unmodified by this phase) refuses the move before any write; the client's pre-existing 403 handling in `moveVaultItem` (from 32-01) throws `CollectionKeyUnavailableError`, and `DetailPanel` renders the honest, non-retry-inviting `error.itemMoveAccessLost` banner while the item editor is still mounted. The item's `enc_key`/`enc_data`/`revision` are read via the owner's own unaffected token (Gate 0 -- ownership of a personal item -- is never touched by this test) and proven byte-identical before and after the refused attempt; a cross-check via memberA's own token confirms the destination collection never receives the item either.
- **SC4 (ORG-04):** a new live test proves a member with ONLY folder-derived access (never a direct `item_shares` grant -- by construction, so the access-loss claim cannot be confounded per T-32-11) reads an item's real decrypted password while the owner shares it (positive anchor, panel deliberately left open via a new local `assertRecipientDecryptsLeavingPanelOpen` helper), then genuinely loses that SAME read -- not merely list membership -- once the owner moves the item back out of the shared folder and the member's still-open session reaches its next completed sync (no reload, no lock/unlock).
- Both tests are falsification-proven against real production code, not just against themselves: SC3's guard (Gate 2) was temporarily disabled and the move was observed to wrongly succeed; SC4's guard (the source collection's DB revision bump, which both its live push and its 30s poll fallback depend on) was temporarily disabled and the member's session was observed to never lose the item within the 60s timeout window.

## Task Commits

Each task was committed atomically (both touch the same file; split by line range after both were written and verified together, since the plan's `files_modified` lists only `web/e2e/sharing.spec.ts`):

1. **Task 1: SC3 -- TOCTOU refusal via a demoted destination edit-holder** - `91af54c` (test)
2. **Task 2: SC4 -- move-out access loss with a same-read negative anchor** - `5a5013f` (test)

_No separate plan-metadata commit yet -- this SUMMARY/STATE/ROADMAP commit is the final commit for this plan (see `<final_commit>` below)._

## Files Created/Modified

- `web/e2e/sharing.spec.ts` -- `apiPut` helper (Task 1); the SC3 TOCTOU-refusal test (Task 1); `assertRecipientDecryptsLeavingPanelOpen` and `moveItemOutOfFolderViaEditor` helpers (Task 2); the SC4 move-out-access-loss test (Task 2)

## Decisions Made

- **Task 1's driving mechanism: PUT demotion, not the plan's literal DELETE.** Before writing the test, I read `membership.rs`'s `gate::<M>()` function and confirmed `None => Err(ApiError::NotFound)` -- a caller with ZERO relationship to a collection (a fully-deleted `collection_access` row) gets 404, not 403. `membership_route_sweep.rs`'s own sweep independently confirms this for the exact route in question ("an unrelated caller gets 404, not 403"). `moveVaultItem`'s client-side `isForbiddenError` (store.ts) checks ONLY `status === 403`. Phase 31's SC5 (which this plan mirrors) can tolerate a 404 because its own client code (`ShareDialog`'s `submitRowsForExistingDestination`) catches ANY throw from a bare `getCollection()` preflight, 404 included. `moveVaultItem` has no such tolerance -- a 404 falls through to the raw, retry-inviting `error.itemSaveFailed` banner, which would have made the literal-DELETE version of this test either red on a correct build (if I'd asserted the intended non-retry-inviting copy) or vacuously wrong (if I'd asserted the wrong copy to match). A DEMOTION resolves to `Some(Read)`, which `gate::<RequireEdit>` correctly turns into 403 -- verified this is achievable (the collection's last-edit-holder guard in `update_access` does not block it, since memberA remains an edit-holder throughout) before writing a single line of the test. The demotion-driven test passed on its first live run.
- **Task 2's falsification needed two rounds to find a genuinely discriminating probe -- documented as a finding, not hidden.** The first, more "obvious" probe (disable only the source collection's live `SyncEvent` push) did NOT produce red: the test still passed, just slower (~33s instead of ~3s), because `sync.ts`'s own pre-existing 30s poll fallback independently discovered the still-correctly-bumped DB revision and recovered. This is the app working exactly as designed (a genuine belt-and-suspenders redundancy, per 05-CONTEXT.md's own locked decision) -- but it meant the first probe did not isolate what the test claims to prove. The second probe (disable the DB revision bump itself, which both the push and poll structurally depend on) produced clean red: the item-row count stayed at 1 for the full 60-second timeout.
- **`moveItemOutOfFolderViaEditor` does not re-click `item-row-${itemId}`.** Its one call site always runs immediately after a prior move-in save that left `detail-panel` open in view mode for the SAME item; that open panel's `side-panel-scrim` covers the item list underneath and blocks a click on the row (observed live: 300+ retries against "element intercepts pointer events" before a 180s test timeout). The helper opens edit mode directly from the already-open panel instead of mirroring `moveItemToDestinationViaEditor`'s row-click-first shape.

## Deviations from Plan

### Auto-fixed Issues

None applicable under Rules 1-3 -- no production application code was touched by this plan (test-only, per the plan's own `type: execute` scope and `files_modified` list). The one substantive change from the plan's literal text -- Task 1's DELETE-to-PUT-demotion mechanism swap -- is documented above under Decisions Made rather than as a Rule 1-3 auto-fix, since it corrects a TEST-DRIVING MECHANISM to match the actual server/client contract, not a bug in shipped code. It was caught and corrected BEFORE the test was ever run red against the literal plan text (via static analysis of `membership.rs`/`membership_route_sweep.rs`), so there is no "found broken, fixed" sequence to report -- the analysis happened first, and the test was written correctly from the start.

**Total deviations:** 0 (Rules 1-3). One plan-mechanism correction, made proactively and documented above per non-negotiable #8 ("if a proof cannot be made to discriminate, say so plainly").

## Issues Encountered

- `moveItemOutOfFolderViaEditor`'s first draft re-clicked `item-row-${itemId}` (mirroring `moveItemToDestinationViaEditor`'s shape) and hung for the full 180s test timeout retrying a click blocked by `side-panel-scrim`. Fixed by removing the redundant row-click (the panel is already open and showing the correct item at that point in the test) -- see Decisions Made.

## Falsification (non-negotiable #1 and #2)

Both new tests were falsification-proven against real production code paths, with the guarded behavior reverted, red observed with its exact output, the revert restored, and green re-confirmed. `git diff --stat crates/pv-server/src/routes/vault.rs` showed zero diff after each restore.

1. **SC3's guard: `vault.rs::move_item`'s Gate 2 (`require_collection_edit`).** Commented out the call (`if false`-equivalent structural removal, `dest_id` branch). Fresh `CI=1` live run of `-g "SC3"` -> **red**: `Error: the destination-access-lost refusal must render while the item editor is still mounted` / `expect(locator).toBeVisible() failed` / `Timeout: 20000ms` / `Error: element(s) not found` -- the move wrongly succeeded (no refusal banner ever rendered) because the demoted owner's stale client-side cached `CollectionKey` was accepted without a server-side edit check. Restored (`git diff --stat` confirmed byte-identical to HEAD); reran fresh -> green, `1 passed (2.6s)`.
2. **SC4's guard, round 1 (non-discriminating, documented as a finding):** disabled ONLY the source collection's `SyncEvent` push in `move_item`'s post-commit fan-out (wrapped the `state.sync_hub.publish_to_recipients(...)` call for `current_collection` in `if false { ... }`). Fresh `CI=1` live run of `-g "SC4"` -> **still passed**, `1 passed (57.0s)` (vs. the usual ~3s) -- `sync.ts`'s own 30s poll fallback independently recovered via the still-genuinely-bumped DB revision. This round did NOT falsify the test; recorded here because it is itself informative (confirms the app's redundant-delivery design works) and because silently discarding a non-discriminating probe without recording it would hide exactly the kind of "assertion that cannot fail for the wrong reason" this phase's non-negotiables warn against.
3. **SC4's guard, round 2 (discriminating):** restored the push, then disabled the source collection's DB revision bump itself (`bump_collection_revision(&mut tx, cid)` replaced with a fixed `Some(0)` that never touches the DB row). Fresh `CI=1` live run of `-g "SC4"` -> **red**: `Error: sync-completion signal: the member's own still-open session must lose the item from its list on its own NEXT COMPLETED SYNC, no reload` / `Expected: 0` / `Received: 1` / `Timeout: 60000ms` / `123 x locator resolved to 1 element`. Restored (`git diff --stat` confirmed byte-identical to HEAD); reran fresh -> green, `1 passed (3.0s)`.

## Verification (exact commands and results)

- `cd web && npm run build` -> exits 0 (`prebuild` rebuilds `pv_wasm_bg.wasm`, `next build` TypeScript pass finishes in ~1.7s), run repeatedly across the session with no failures.
- `cd web && npm run compile` (after every `build`, per this phase's documented build-before-compile ordering hazard) -> exits 0, `tsc --noEmit` clean, every run.
- `cd web && CI=1 PV_E2E_DB_DIR=<fresh tmp dir> npx playwright test e2e/sharing.spec.ts -g "SC3" --retries=0` -> **1 passed (2.6s)**, fresh `cargo build --release -p pv-server` + fresh `next build` each invocation (`reuseExistingServer: false` under `CI=1`), port 8620 confirmed free before each run.
- `cd web && CI=1 PV_E2E_DB_DIR=<fresh tmp dir> npx playwright test e2e/sharing.spec.ts -g "SC4" --retries=0` -> **1 passed (2.9s-3.0s across runs)**.
- **`cargo test --workspace --no-fail-fast`** -> exit code 0, 13 `test result: ok` blocks (server integration tests across `auth.rs`, `collections.rs`, `families.rs`, `family_wide_sharing.rs`, `invitations.rs`, `membership_route_sweep.rs`, `passkey_login.rs`, `passkeys.rs`, `router_static_fallback.rs`, `sessions.rs`, `sync.rs`, `sync_shared.rs`, `vault.rs`) plus `pv_wasm`'s own unit suite and four doc-test crates, 0 failures.
- **`cargo clippy --workspace --all-targets -- -D warnings`** -> exit code 0 (SC5/DEBT-04's own gate, unaffected by this phase's test-only changes).
- **`cd web && npx vitest run`** (full suite) -> **93 test files, 1021 tests, all pass** -- exact match to 32-02-SUMMARY.md's own recorded baseline (1012 + 9 new from 32-02 = 1021), confirming zero regression from this plan's test-only additions.
- **Full phase gate, superset beyond any `-g` filter:** `cd web && CI=1 PV_E2E_DB_DIR=<fresh tmp dir> npx playwright test e2e/sharing.spec.ts --retries=0` (the FULL spec file, unfiltered) -> **16 passed (1.3m)** -- all 14 pre-existing live tests plus this plan's 2 new ones, together, from one fresh build.
- **`data/pv.db` checksum, before and after the full unfiltered run:** `8e043c9dcbf46bccc534451acc8b4b575007242c0042589df8a96f3b4ab997c8` both times (identical to the checksum independently recorded in 32-01-SUMMARY.md) -- confirms the throwaway `PV_E2E_DB_DIR` genuinely isolated every live run from the developer's real database across this entire session.

## STATE.md Update

Per this plan's own non-negotiable #6: **skipped `state.advance-plan`** (STATE.md template drift, per the orchestrator's own instruction to say so rather than hand-edit). STATE.md/ROADMAP.md/REQUIREMENTS.md updates for this plan are limited to what `roadmap.update-plan-progress`/`requirements.mark-complete` can apply cleanly; no manual STATE.md position edits were made.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

This plan closes the phase's last two open success criteria (SC3/ORG-02, SC4/ORG-04) per `32-VALIDATION.md`'s own Per-Task Verification Map rows `32-04-01`/`32-04-02`, both now proven live and falsification-checked. Combined with 32-01 (SC1/SC2), 32-02 (SC1 create-mode half, ItemForm's own contract), and 32-03 (SC5/DEBT-04), all five of this phase's ROADMAP success criteria have live or unit-level automated verification -- no manual-only verification items remain per `32-VALIDATION.md`'s own "Manual-Only Verifications: None" declaration. No blockers identified.

---
*Phase: 32-putting-things-into-shared-folders*
*Completed: 2026-08-19*

## Self-Check: PASSED

`web/e2e/sharing.spec.ts` verified present on disk with both tests (`SC3`, `SC4`) and their supporting helpers; both task commits (`91af54c`, `5a5013f`) verified present in `git log`.
