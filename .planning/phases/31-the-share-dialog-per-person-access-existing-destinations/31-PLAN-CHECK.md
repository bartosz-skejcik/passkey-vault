# Phase 31 — Plan Check

**Verdict: REVISE**
**Plans checked:** 31-01 … 31-05 · **Issues:** 7 blockers, 6 warnings
**Checked:** 2026-08-18, against live code at HEAD (not against RESEARCH.md's assertions alone)

---

## What passes

- **Requirement coverage.** MOD-01/02/03, ORG-03 all appear in plan frontmatter (`31-02/03/05` carry MOD-01/02/ORG-03, `31-04` carries MOD-03). The sixth obligation is a named, first-class task (31-03-T3), not a footnote.
- **Dependency graph.** 01←02←03←04←05, acyclic, waves consistent with `depends_on`. No forward references.
- **Locked-decision coverage.** "Every family member is a standing row" (31-02-T1), "brak dostępu really revokes" (31-03-T3), destination selector above the list (31-02-T1), `access.*` vocabulary reused verbatim (31-02-T1, 31-04-T2). The `buildMemberRemovalBatch` correction is honoured — plans use `revokeCollectionAccess`/`revokeItemShare` throughout.
- **No deferred-idea creep.** No family-wide+exceptions, no search/add-person, no bulk "set for everyone" anywhere in the five plans.
- **Propagation surfaces (item 1) — enumeration is correct.** I re-derived it independently by grep. 31-RESEARCH.md's 9-row table matches reality exactly, including surface #4, `membership::claim_item_bucket_edit_in_tx` (`membership.rs:687-703`), the `UPDATE ... SET access_level = 'edit'` path that a naive grep for "grant" would miss. No surface is absent.
- **The bound is real, not asserted.** 31-01-T1's action reproduces `add_member`'s sequence verbatim against `collections.rs:532-599`: `parse_access_level_from_request` → `resolve_family_wide_declared_level` three-way match (`Declared`/`LegacyUnknown` → `may_grant_access_level`; `NotFamilyWide` → `RequireEdit::satisfied_by`) → unconditional `enforce_item_bucket_declared_level_bound`. Extractor is `Membership<Collection, RequireRead>`, matching. Item variant correctly takes `RequireEdit` only. Task 2 proves all nine arms plus both `item_bucket` states independently, with falsification. **This is not a fourth propagation surface with a looser check.**
- **No forbidden edits.** Nothing in any plan touches `may_grant_access_level`'s nine arms, `collections::create`'s creator-`edit` INSERT (`collections.rs:290`), or the availability of `hidden_password`.
- **SC2 is observed, not inferred.** `listCollectionIds` (`e2e/sharing.spec.ts:218`) is a real `GET /api/vault/collections` against the server. The count assertion is genuine server state.
- **SC3/ORG-03's real-WASM proof discriminates.** 31-02-T2 asserts *decrypted content* of a *pre-existing* item by a *different* recipient's own identity key, via the production dispatch function, with a mandatory falsification (swap in `WasmCollectionKey.generate()` → decrypt error). All three of your criteria are met.
- **SC5's driving mechanism is specified, not assumed.** 31-05-T1 names the concrete TOCTOU trigger: a second edit-holder issues `DELETE /api/vault/collections/{id}/access/{ownerUserId}` between the owner's destination-select and submit. I verified this is reachable — `revoke_access`'s last-key-holder `EXISTS` guard (`collections.rs:745-751`) does not block it, because the second edit-holder survives.
- **Post-detach assertion discipline (item 3).** Every error assertion is explicitly scoped to the still-mounted dialog (31-03-T3 step 3, 31-05-T1 "query it before any `waitFor({ state: 'detached' })`"). Phase 30's ME-05 lesson is carried correctly. I found no assertion of the *absence* of an error, and no assertion scheduled after a dialog closes.

---

## Blockers

### B-1 — 31-02-T1: the premise that family-wide has "its own" access-level control is false against the code

31-02-T1 instructs: *"the 'Cała rodzina' boxed row and its OWN single access-level control stay completely unchanged"* and *"Replace the per-person checkbox list + shared `ACCESS_LEVEL_VALUES` radio group (ShareDialog.tsx:1307-1344)"*.

There is no separate family-wide control. `ShareDialog.tsx:1329-1345` renders **one** `ACCESS_LEVEL_VALUES` radio group, driven by **one** `accessLevel` state, and it serves the family-wide path too — the checkboxes are disabled when `isFamilyWideSelected`, the radio group is **not**. `submitItemFamilyWide` and the family-wide folder path both read that same `accessLevel`. The `share.familyWideItemContributorEditNote` at `:1365` is also keyed off it (`accessLevel !== null && accessLevel !== "edit"`).

So the instruction is unimplementable as written: deleting `:1307-1344` deletes the family-wide level control, and keeping it means the file has two competing sources of level truth — the exact "which one wins" question CONTEXT.md Area 1 exists to eliminate.

**Fix:** 31-02-T1 must state explicitly that the family-wide branch keeps its own instance of the radio group, rendered under `isFamilyWideSelected` only, with `accessLevel` state retained and scoped to that branch — and that `share.familyWideItemContributorEditNote`'s condition is re-anchored to that scoped state. Add a unit test asserting the family-wide item contributor note still renders at `read`/`hidden_password` after the split.

### B-2 — 31-02/31-03: item scope is left on the old markup for two waves, while both plans' verification runs the item-scope tests

The checkbox list and radio group at `:1301-1345` are **scope-shared**. 31-02 migrates the folder scope only; item scope waits for 31-04. That means through waves 2 and 3 the component must carry two parallel per-person UIs — which 31-02-T1's flat "Replace … (ShareDialog.tsx:1307-1344)" never acknowledges.

The consequence is not a vacuous test — it is a red one. 31-02-T1 verifies with `npm test -- ShareDialog`, which includes the item-scope cases. 31-03-T2/T3 verify with the **whole** `e2e/sharing.spec.ts`, which contains `SHARE-02` (`e2e/sharing.spec.ts:547`) driving item shares through `share-recipient-{id}` + `share-access-level-{value}`. If 31-02 removes those test-ids unconditionally, waves 2 and 3 cannot go green without doing 31-04's work; if it keeps them conditionally, nothing in 31-02 or 31-03 says so.

**Fix (either is acceptable, pick one and write it down):** (a) merge 31-04-T1's item-scope dispatch into 31-02 so one wave migrates both scopes and no dual-UI period exists; or (b) state in 31-02-T1 explicitly that the old checkbox+radio block is retained under `scope.kind === "item" && !isFamilyWideSelected` until 31-04 removes it, and add to 31-02's `<done>` that `SHARE-02` and the item-scope unit tests still pass unmodified.

### B-3 — MOD-03 regression window: hidden-password disclosure is unwired for the row UI across waves 2 and 3

The one-time blocking modal and the inline note are both keyed off the shared `accessLevel` state, and `hiddenPasswordNoteSubject` derives from `selectedRecipientIds` — both of which 31-02 stops populating for the folder scope. 31-04-T2 is what re-wires them to row selects. 31-02 does not mention either.

Result: after 31-02 ships, a user can set a folder row to `hidden_password` and see **no disclosure modal and no inline note** — MOD-03's bar silently false for two waves, on the exact surface this phase exists to make honest. 31-02's own tests will not catch it, because they were never told to check.

**Fix:** move the "modal fires on any row's transition to `hidden_password`" + "note re-anchored to rows at that level" half of 31-04-T2 forward into 31-02-T1, leaving 31-04-T2 with only the copy revision and the scroll/footer restructure. Add a 31-02 unit assertion that the inline note renders when a row is set to `hidden_password`.

### B-4 — Verify commands are below CI width on 8 of 11 tasks, violating this phase's own binding rule

31-VALIDATION.md lines 39-42 are explicit and binding: *"Narrow commands are fine for the per-task sampling above; they are **not** acceptable as a task's `verify` field or as phase acceptance."*

| Task | verify | Problem |
|---|---|---|
| 31-01-T1 | `cargo test --workspace --no-fail-fast update_access update_share` | name-filtered; also see B-5 |
| 31-02-T1 | `npm test -- ShareDialog` | filtered vitest |
| 31-02-T2 | `npm test -- ShareDialog.real-wasm` | filtered vitest |
| 31-03-T1 | `npm test -- ShareDialog` | filtered vitest |
| 31-03-T2 | `npx playwright test e2e/sharing.spec.ts` | no `cargo test --workspace`, no `npm test` |
| 31-03-T3 | same | same |
| 31-04-T1 | `npm test -- ShareDialog` | filtered vitest |
| 31-04-T2 | `npm test -- ShareDialog` | filtered vitest |

Only 31-05-T2 is at CI width. This is precisely the shape that let Phase 30 ship two blockers, and the phase's own validation contract forbids it.

**Fix:** every `<automated>` becomes at minimum `cd web && npm run compile && npm test` for web tasks (filtered runs stay in the sampling lane, not the verify field), and `cargo test --workspace --no-fail-fast` for 31-01. Playwright tasks additionally keep the file-scoped spec run appended.

### B-5 — 31-01-T1's verify command is invalid and will never run a test

`cargo test --workspace --no-fail-fast update_access update_share` — cargo accepts one `[TESTNAME]` positional. Verified empirically at HEAD:

```
$ cargo test -p pv-core --lib aaa bbb
error: unexpected argument 'bbb' found
```

The command errors before a single test executes. A gate that cannot run is a gate that cannot fail.

**Fix:** `cargo test --workspace --no-fail-fast` (which also satisfies B-4).

### B-6 — Falsification is absent on 5 of 11 test-adding tasks

31-VALIDATION.md's sign-off requires *"Every new test **falsification-proven** — reverted, observed red with its exact output recorded, restored."* Present on 31-01-T2, 31-02-T2, 31-03-T3. **Missing entirely** on:

- **31-03-T1** (pending-revocations summary — the assertion "summary is ABSENT when the pending set is pure-addition" is an absence assertion and is exactly the shape that goes vacuous)
- **31-04-T1** (item-scope dispatch + CTA selection)
- **31-04-T2** (the MOD-03/SC4 repeat-share honesty assertion — the single gap the UI checker found)
- **31-05-T1** (the SC5 refusal branch — an untriggered-failure-branch test with no falsification is the phase's own named anti-pattern)
- **31-05-T2** (the Q2 atomicity proof)

None is softened to "if practical"; they are simply not there.

**Fix:** add an explicit, non-optional falsification step with recorded output to each. Concretely: 31-04-T2 → revert `share.hiddenPasswordInlineNote` to its current wording, confirm red; 31-05-T1 → remove the fresh `getCollection` re-fetch (fall back to the dialog-open cached value), confirm the refusal never renders.

### B-7 — 31-05-T2's atomicity assertion cannot distinguish an atomic update from a revoke-then-re-add

The proof obligation (31-VALIDATION.md line 73) is *"no intermediate under/over-access window."* 31-05-T2 reads `GET /api/vault/collections/{id}/access` **after** submit resolves and compares final levels. A revoke-then-re-add implementation would produce an identical final state and pass. The test measures the wrong thing.

The end-state is genuinely safe (31-01's single `UPDATE` statement is atomic by SQLite's own guarantee, and 31-01-T1 proves the statement shape), but nothing asserts the **client** takes that path rather than dispatching revoke+grant.

**Fix:** add to 31-02-T1 or 31-05-T2 a unit assertion that for a row transitioning `(read → edit)`, `updateCollectionAccess` is called exactly once and `revokeCollectionAccess`/`addCollectionMember`/`reshareCollectionToNewMember` are called **zero** times for that userId. That is the assertion that would fail if the feature were wrong.

---

## Warnings

### W-1 — 31-05-T1: the post-refusal "server state unchanged" assertion has no session and no baseline

The plan says *"`GET /api/vault/collections/{id}/access` shows NO new/changed rows."* Two gaps: (a) the **owner has just lost access to that collection** — that GET from the owner's token will 404, so the assertion must use the second edit-holder's token, which the plan never says; (b) "no new/changed rows" needs a captured before-snapshot, not a judgement call at assert time. Left as written, an executor hitting the 404 is likely to soften the assertion rather than fix the session. Specify: capture the access list via the second edit-holder's token before the submit, compare deep-equal after.

### W-2 — 31-03-T3's positive anchor may never fire on a passive session

`family-wide-sharing.spec.ts:1260-1268` documents the trap directly: `refreshCollectionsNow()` fires only on the sharer's own submit, an unlock transition, or the pending/reseal path — **never on a passive session's ambient poll**. The precedent therefore calls `relockAndUnlock(memberC.page, …)` before `assertRecipientDecrypts`. 31-03-T3 step 2 does not mention it. (Lock/unlock is legitimate for the *positive* anchor; the negative anchor must stay reload-free, and the plan correctly says so.) Also, `assertRecipientDecrypts` lives in `family-wide-sharing.spec.ts`, not `sharing.spec.ts` — say whether it is ported or re-derived.

### W-3 — 31-02-T1 is one task carrying about eight distinct changes

Destination selector + rows state + fetch composition + Row Anatomy markup + `reconcileRow` + two submit-path rewrites + family-wide mutual-exclusivity rework + dictionary keys + test migration, against a 1441-line component. This is the plan the split was supposed to prevent; the split fell along the wrong axis (see B-2). Consider splitting 31-02 by *mechanism* (rows+dispatcher, then destination selector) rather than splitting the component by *scope* across four waves.

### W-4 — Fully sequential waves 1→5 with no parallelism

Every plan depends on its predecessor, so this is five serial executions of a single file. Legitimate given they share `ShareDialog.tsx`, but it means no intermediate wave is independently useful, and B-2/B-3 are the direct cost. Worth revisiting alongside W-3.

### W-5 — `membership_route_sweep.rs` is not mentioned by 31-01

`crates/pv-server/tests/membership_route_sweep.rs:302` iterates `["GET","POST","PUT","DELETE"]` against every entry in `membership_routes()`. Adding a `PUT` verb to two existing entries changes what that sweep exercises. I believe it passes (the `Membership` extractor runs before `Json`, so an unrelated caller 404s before body parsing), but the coupling should be named in 31-01 so a `405 → 404` transition is an expected outcome, not a surprise. 31-01-T2's workspace-wide run will catch it either way once B-5 is fixed.

### W-6 — The scroll/footer restructure lands two waves after the rows it exists to contain

CONTEXT.md Area 1: *"Plan for a family large enough that the list scrolls."* Rows appear in 31-02; the single-scroll-region restructure is 31-04-T2. Between them the rows sit inside the old `max-h-48 overflow-y-auto` nested scroller with the pending-revocations summary (31-03) beneath it — the exact trap 31-04 exists to remove. Non-blocking, but the ordering is backwards.

---

## Required changes before execution

1. **B-5** — fix 31-01-T1's verify command (one word; it currently cannot run).
2. **B-4** — raise all eight sub-CI-width verify fields.
3. **B-6** — add falsification to 31-03-T1, 31-04-T1, 31-04-T2, 31-05-T1, 31-05-T2.
4. **B-1/B-2/B-3** — resolve the `ShareDialog.tsx` split: state the family-wide control's real ownership, state what happens to item scope during waves 2-3, and move the hidden-password re-wiring into 31-02.
5. **B-7** — add the "exactly one `updateCollectionAccess`, zero revoke/grant" dispatch assertion.
6. **W-1** — name the session and the baseline for 31-05-T1's unchanged-state assertion.

The server half (31-01) is sound in substance — the bound is genuinely identical to `add_member`'s, the surface enumeration is complete and verified against live code, and the ORG-03 and sixth-obligation proofs discriminate. The defects are concentrated in the client-side split and in the verification width/falsification discipline the phase's own VALIDATION.md already binds.

---

# Iteration 2 — re-check of the 6-plan re-split

**Verdict: REVISE** · 3 blockers, 2 warnings · checked 2026-08-18 against live code at HEAD.

Iteration 1's carried-forward findings (propagation-surface enumeration, 31-01's bound parity, SC2's real-server-state count, SC3's real-WASM shape, SC5's TOCTOU reachability, absence of post-detach assertions) were not re-derived, per instruction.

## Mechanical blockers — verified fixed

- **B-5 fixed.** 31-01-T1's verify is now `cargo test --workspace --no-fail-fast`. Runnable as written.
- **B-4 fixed except one task.** 31-01-T1/T2, 31-03-T1/T2/T3, 31-04-T1/T2, 31-05-T1/T2, 31-06-T1/T2 are all at CI width — no `-p pv-server`, no filtered `vitest`, no `-g`. The single exception is 31-02-T1 (see I2-B2).
- **B-7 fixed in substance.** The dispatch-count assertions in 31-02-T2 (item branch) and 31-03-T1 (collection branch) mock `updateItemShare`/`updateCollectionAccess` alongside `create`/`revoke`/`add`/`reshare` and assert exactly-one / exactly-zero per userId. A revoke-then-re-add implementation converging on the same end state would fail these. **They genuinely discriminate.** 31-06-T2 correctly labels its own live check as the end-state half only.
- **B-6 mostly fixed.** Falsification is now present and non-optional on 31-01-T2, 31-03-T2, 31-04-T1 (two separate falsifications, including the absence-assertion), 31-04-T2, 31-05-T1, 31-05-T2, 31-06-T1. 31-06-T1's falsification (remove the fresh `getCollection` re-fetch, confirm the refusal never renders) is the right one. Residual gap at I2-B3.

## W-1, W-2, W-5, W-6 — verified fixed

- **W-1** — 31-06-T1 now names the session and the baseline explicitly, captures a BEFORE snapshot via the second edit-holder's own token, asserts deep-equality after, and explicitly warns that the owner's own `GET .../access` would itself 404. Exactly the fix requested.
- **W-2** — 31-04-T2 step 2 adds the `relockAndUnlock` before the positive anchor, cites `family-wide-sharing.spec.ts:1260-1268` for why, and specifies a local `assertRecipientDecrypts`-equivalent rather than a cross-file import. Correct.
- **W-5** — 31-01 line 80 now documents the `membership_route_sweep.rs` coupling accurately, including that both entries previously 405'd on `PUT` and that the `Membership` extractor runs before body parsing. Matches the code.
- **W-6** — the Scale & Scroll restructure moved into 31-02-T1, alongside the row list's first appearance. Correct.

## The re-split's central claim — family-wide isolation is real, but the "all pre-existing tests pass" claim is false

**Isolation: specified, not asserted.** ✅ 31-02-T1 gives a concrete mechanism — wrap `ShareDialog.tsx:1329-1345`'s radio group and its `share.accessLevelLabel` heading in an `isFamilyWideSelected` conditional; leave `accessLevel`/`setAccessLevel`/`previousAccessLevel`/`handleSelectAccessLevel`/`handleHiddenPasswordAck`/`handleHiddenPasswordCancel` byte-for-byte unchanged; leave `submitItemFamilyWide` and `submitFolderVariant`'s family-wide branch reading it unchanged; re-verify `share.familyWideItemContributorEditNote`'s condition at `:1364`; add a regression unit test that the note still renders at `read`/`hidden_password`. That is a render-condition change with the state untouched — the correct minimal move, and it does create the separation that did not exist before.

**MOD-03 at every wave boundary: true.** ✅ 31-02-T2 re-anchors the one-time modal trigger and `hiddenPasswordNoteSubject` to the row model in the same plan that introduces rows, explicitly keeping the current wording; 31-05-T2 strengthens only the string. No wave boundary is worse than the pre-phase state.

### I2-B1 (blocker) — three other live e2e specs drive the deleted markup, and no gate in the entire phase ever runs them

`grep -rl` over `web/e2e/` shows **four** specs driving ShareDialog test-ids. Every verify field in all six plans — including 31-06-T2's "final CI-width acceptance sweep" — runs only `e2e/sharing.spec.ts`. The other three are never executed:

- **`e2e/shared-sync.spec.ts:610-611`** — `getByTestId('share-recipient-${bUserId}').click()` then `getByTestId('share-access-level-edit').click()`. Non-family-wide per-person path. 31-02-T1 deletes the checkbox list outright and scopes the radio group to `isFamilyWideSelected`. **Breaks with certainty.**
- **`e2e/export-disclosure.spec.ts:179-180 and 233-234`** — the same checkbox + radio pair, twice, one of them at `hidden_password`. **Breaks with certainty.**
- **`e2e/family-wide-sharing.spec.ts:373-376`** — the load-bearing mutual-exclusivity assertion:
  ```
  await expect(
    page.getByTestId("share-recipient-list").locator("input[type=checkbox]").first(),
    "family-wide is a MODE, not a recipient list -- individual recipients must be mutually exclusive with it",
  ).toBeDisabled();
  ```
  After 31-02 the row list holds `<select>` elements; `input[type=checkbox]` resolves to zero, and `toBeDisabled()` fails. 31-02-T1's claim that every family-wide test "should still pass with zero edits, since the family-wide markup/state/logic is byte-identical" is false — this assertion reads the *per-person* list, not the family-wide row. (The rest of that helper survives correctly: `share-recipient-family-wide` at `:366` and `share-access-level-${accessLevel}` at `:378` both still work under the isolated render condition. ✅)

This is the same defect iteration 1 found, displaced one file over: the migration's blast radius was scoped to `sharing.spec.ts` and the other consumers were never enumerated.

**Fix (concrete):**
1. Add to 31-02-T1's action: update `e2e/shared-sync.spec.ts:608-613` and `e2e/export-disclosure.spec.ts:177-182, 232-241` to drive `share-recipient-row-select-{userId}` instead of the checkbox+radio pair, preserving each helper's external signature.
2. Add to 31-02-T1's action: rewrite `family-wide-sharing.spec.ts:373-376`'s mutual-exclusivity assertion to target the row model — assert `share-recipient-row-select-{userId}` (or the list's first `select`) is `toBeDisabled()`, preserving the assertion's stated intent verbatim in its message.
3. Change 31-06-T2's sweep and 31-02-T2's verify to run the full e2e directory, not one file: `npx playwright test --retries=0` (or explicitly enumerate all four specs). A phase that rewrites this dialog cannot accept a gate that runs one of its four consumers.

### I2-B2 (blocker) — 31-02-T1's own verify is self-contradictory and uses a `-g` filter to conceal a known-red test

```
cd web && npm run compile && npm test && npm run build && npx playwright test e2e/sharing.spec.ts --retries=0 -g "WR-09|Backstop|fingerprint|SHARE-01|SHARE-06"
```

Two problems, both mechanical:

- The `-g` filter deliberately excludes `SHARE-02` — the item-scope test at `e2e/sharing.spec.ts:547` — because T1 deletes the checkbox list for **both** scopes but wires item-scope dispatch only in T2. This is precisely the "`-g`-filtered Playwright run standing in as a task's acceptance" the review brief forbids, and it is the vacuous-gate shape: a gate narrowed to not see a failure the author already knows is there.
- `npm test` in that same command is **unfiltered** and therefore cannot pass at T1's stated scope. T1 says it updates "`ShareDialog.test.tsx`'s folder-scope per-person tests" only, while deleting the checkbox markup for both scopes and scoping the radio group away from the non-family-wide path. The item-scope unit tests and the non-family-wide hidden-password trigger/subject tests (re-wired in T2, not T1) go red. T1's verify contradicts T1's scope.

T1 and T2 are not separable: T1's deletion is what breaks item scope, and T2 is the repair.

**Fix:** merge 31-02 Task 1 and Task 2 into a single task, with T2's unfiltered verify (extended per I2-B1 item 3) as the sole gate. The plan boundary is already correct; it is the task boundary inside it that is not.

### I2-B3 (blocker, small) — the B-7 dispatch-count tests are themselves not falsification-proven, so 31-06-T2's cited exception chains to unfalsified evidence

31-06-T2's exception — cite the dispatch-level unit falsifications rather than re-derive one at the live-e2e layer — **is legitimate in principle.** A dispatch call-shape claim is unobservable at the e2e layer; re-deriving it there would be theatre. The exception is correctly reasoned.

But the two tests it cites carry no falsification of their own: 31-02-T2's item-branch dispatch-count test and 31-03-T1's collection-branch dispatch-count test. These are the load-bearing answer to B-7, and 31-VALIDATION.md line 112 admits no exception. As written, the citation resolves to evidence that was never falsified.

**Fix:** add to both 31-02-T2 and 31-03-T1: *Falsification (mandatory, record exact output): temporarily replace the update branch's single `updateItemShare`/`updateCollectionAccess` call with a revoke-then-re-add pair, re-run the dispatch-count test, confirm it fails (`updateX` called 0 times, expected 1; `revokeX` called 1 time, expected 0), record the exact output, restore, confirm green.* That is the falsification that proves the assertion discriminates the exact substitution B-7 exists to catch — and it makes 31-06-T2's exception sound as written.

Also missing falsification, lower stakes: 31-02-T1's family-wide contributor-note regression guard, and 31-03-T3's SC1/SC2 live assertions. Both would be caught by any real regression; flag rather than block.

## Warnings

- **W-3 persists, arguably worse.** 31-02-T1 now carries: family-wide isolation + full checkbox-list deletion for both scopes + rows state + Row Anatomy markup + `reconcileRow` + folder submit-path rewrite + shell/scroll restructure + dictionary keys + e2e helper migration + unit-test migration. Merging T2 into it (I2-B2) makes it larger still. This is unavoidable given the file's coupling — the deletion cannot be partial — but it should be executed with that understood, not discovered mid-task.
- **W-4 persists.** Six strictly sequential waves against one file, zero parallelism. Correct given the coupling; noted only so the wall-clock cost is not a surprise.

## What a fix looks like — the complete list

1. **I2-B1** — enumerate and migrate the other three consumers (`shared-sync.spec.ts:608-613`, `export-disclosure.spec.ts:177-182 & 232-241`, `family-wide-sharing.spec.ts:373-376`) inside 31-02; widen 31-06-T2's sweep and 31-02's verify from one spec file to the full e2e directory.
2. **I2-B2** — merge 31-02's two tasks; drop the `-g` filter entirely.
3. **I2-B3** — add the revoke-then-re-add falsification to the dispatch-count tests in 31-02 and 31-03.

Everything else from iteration 1 is genuinely closed. The re-split along the capability axis is the right shape — 31-03 through 31-06 are clean additive layers on a dialog that works, and the family-wide isolation is specified in real, checkable terms. The three remaining defects are all in the migration's blast radius and its gates, not in its design.
