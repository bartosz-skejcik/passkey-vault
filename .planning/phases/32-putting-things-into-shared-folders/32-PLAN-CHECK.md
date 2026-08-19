# Phase 32 — Plan Check (pre-execution)

**Checked:** 2026-08-19
**Plans:** 32-01, 32-02, 32-03, 32-04
**Verdict: REVISE** — 5 blockers, 7 warnings.

The plan set is unusually well-grounded: every file:line citation I spot-checked was
accurate, the clippy scope claim is exactly right (independently re-measured, below), the
verify fields order `build` before `compile` everywhere, the SC3 mechanism is genuinely
driven, and the plans name their own departures instead of hiding them. What fails is not
sloppiness — it is four places where a claim is true in the artifact and false in the
product, plus one wave-parallelism hazard this repo has already been bitten by.

---

## Independently verified (no action needed)

| Claim | Verification |
|---|---|
| DEBT-04 scope = 19 `explicit_auto_deref` (pv-server lib) + 6 `doc_lazy_continuation` (pv-provider) | Ran `cargo clippy --workspace --all-targets -- -D warnings`: exactly 28 error lines = 19 + 6 + 3 "could not compile". Then re-ran with both lints `-A`'d: **zero** errors/warnings workspace-wide. So there is no hidden residue in the test targets that the failing lib build was masking. 32-03 Task 2's budget is correct. |
| `ceremony.rs` diagnosis | Confirmed: line 152 ends `(EXT-10 Task` and line 153 begins `/// 1) confirms this empirically` — the accidental ordered-list marker is exactly as described. The reflow fix is right; do not indent. |
| `dest_is_item_bucket` is already computed and threaded | `vault.rs:1020-1034` (Gate 2) and the post-move `claim_item_bucket_edit_in_tx` at `:1117-1120`. Reuse is safe, no recomputation needed. |
| The retarget's item_bucket branch still drives 404 for the right reason | `collections::create` writes a `collection_keys` row **only for the creator** (hard-coded `'edit'`), even for `family_wide_kind: "item_bucket"`; other family members are served by the lazy-reseal/`family_wide_pending` path. So in the retargeted test the recipient has no `collection_keys` row on the bucket, `collection_access` is `None`, and the post-move 404 is driven by the DELETE — not accidentally by bucket membership. The retarget does preserve WR-10's intent on that branch. |
| SC3's byte-identical read is implementable and non-vacuous | `fetch_items_for` (`vault.rs:387`) returns `enc_key`, `enc_data`, `revision`, `collection_id`; the refused item stays personal so arm 1 applies and the owner's token is a valid, un-revoked reader. Gate 2 completes before `begin_with("BEGIN IMMEDIATE")` at `:1053`, so the rollback claim is structurally sound. `GET /api/vault/collections/{id}/items` exists (`mod.rs:450`) for the destination-side cross-check. |
| Encrypt-only `moveVaultItem` cannot be reached without plaintext | Its signature requires `ItemFields`; its only caller is `ItemForm`; `DetailPanel` gates edit mode behind `canEditItem`, so `read`/`hidden_password` holders never mount the form; the existing context-menu `moveItemToFolder` drives personal `folderId` only. Departure from RESEARCH's decrypt-source shape is justified. See W-6 for the guardrail it still needs. |
| Verify-field ordering | All four plans run `npm run build` before any `npm run compile`; 32-03 is Rust-only. Correct. |
| File disjointness in wave 1 | 32-01 (web/*) and 32-03 (crates/*) share no file. But see **B-5**. |

---

## BLOCKERS

### B-1 — 32-03 Task 1: the surviving `item_shares` row is not "inert"; it is a destructive write and delete capability on someone else's shared item

The plan's own new test is designed to assert that after moving a directly-shared personal
item into an **ordinary** shared folder, the direct-share recipient's `PUT /api/vault/items/{id}`
returns **200**. That prediction is correct — and it is the problem.

- `Item::resolve_access` collection branch returns `combine_access(None, Some(Edit)) = Edit`
  (`membership.rs:386`, verified).
- `vault::update` has **no** guard rejecting a direct-share write on a collection-scoped item
  (read the whole handler — the only `collection_id` uses are for fan-out, never authorization).
- `vault::delete` is `Membership<Item, RequireEdit>` — same resolution, so the same
  non-member can **delete** the item out of the shared folder.
- The recipient has **no read path** (`pull_shared_direct` filters `collection_id IS NULL`,
  `sync.rs:401-402`), so anything they write is encrypted under the wrong scope/AAD.

Net effect of this phase as planned: a user who is not a member of a shared folder, and who
cannot see the item, can overwrite that item's ciphertext with a blob no folder member can
decrypt, or delete it outright. That is ORG-02's own non-negotiable — "a move must never
produce a row nobody can decrypt" — defeated through a different door in the same phase,
and it is the exact WR-10 state the DELETE was written to prevent.

Threat register entry **T-32-06** describes this as "authorization-only, functionally inert."
That is factually wrong and is the single most load-bearing error in the plan set. It is also
what allows the plan to present a 200 on that PUT as *proof of correctness*.

Note the shape of the underlying decision: CONTEXT.md's Area 2 was argued from
"zero utraty dostępu przy zmianie folderu", but RESEARCH (Pitfall 1 residual) and the code both
show the surviving grant **restores no access at all** — the recipient still cannot read the
item. So the decision as implemented delivers none of its stated benefit and adds a
destructive capability. The 2026-08-19 correction fixed the factual premise about the DELETE
but did not re-examine whether the decision survives its own correction.

**Required before execution — one of:**
1. Escalate to Bartek: the Area 2 decision rests on a benefit that does not exist. Present the
   two honest options (drop the DELETE-scoping change and keep shipped behaviour; or scope it
   AND close the write/delete hole).
2. Or keep the scoping and add, in this same plan, a guard so a collection-scoped item's
   `item_shares` grant cannot authorize `update`/`delete` for a non-member — with tests on
   **both** verbs, not just `PUT`.

Either way: **T-32-06 must be rewritten** (severity is not `low`, disposition is not
`accept`-with-that-rationale), and 32-03 Task 1's new test must assert the DELETE verb too.

### B-2 — 32-01 Task 1 step 2: the `item_bucket` current-scope guard makes the select lie

The guard renders "the EXISTING, unmodified personal-folder-only select" when the item's
current collection is an `item_bucket`. That shipped select is
`value={fields.folderId ?? ""}` with `<option value="">Bez folderu</option>` first — so an
item that genuinely lives in a family-wide bucket renders as **"Bez folderu"**. The plan
claims this handles the edge case; it renders exactly as if the destination had been reset.

Worse, it is not inert: the select is enabled, so the user can pick a personal folder, which
sets `fields.folderId` and routes to `updateVaultItem` (destination unchanged) — leaving the
item in the family-wide bucket while carrying a personal `folderId` and while the UI shows
the personal folder as its home.

**Fix:** in this branch render a **disabled** select whose single, selected option names the
item's actual scope (e.g. "Udostępnione z rodziną — zmień w oknie udostępniania"), with a new
dictionary key. Never a bare `""`, never enabled.

### B-3 — 32-01 Task 1 step 3: the create-then-move retry can be permanently stuck behind copy that says "try again"

`createdItemState` is written once as `{ id, revision }` and never refreshed. Two reachable
paths make the retry unwinnable:

- The move half fails **after** the server committed (dropped/aborted response). The row is
  now at revision 2 in the destination; every retry re-sends `expected_revision: 1` → 409
  forever, behind `error.itemCreatedButMoveFailed` whose copy the plan explicitly licenses to
  say "Spróbuj ponownie."
- Any 409 at all: `moveVaultItem` is specified to throw `RevisionConflictError`, but create
  mode flattens every throw into `itemCreatedButMoveFailed`. The user is told to retry an
  operation whose precondition is now permanently stale.

This is the WINDOWS #11 / `4450dc0` retry-lie shape the repo has already fixed three times,
re-entered through a new door — and it is precisely the "item left in personal scope while
the UI claims otherwise" failure the prompt named.

**Fix:** before re-dispatching the move on retry, re-resolve the item's current
`revision` **and** `collectionId` from the store (`loadAndDecryptAll` has already run on a
409). If `collectionId` already equals the requested destination, the move in fact succeeded —
treat it as success and call `onCreated()`. Otherwise retry with the fresh revision. Add the
"lost-response" case to 32-02 Task 1's retry-safety describe block (mock `moveVaultItem` to
reject once after the server-side effect, assert the second attempt either succeeds or
surfaces a non-retry-inviting message — never an infinite "try again").

### B-4 — 32-04 Task 2: SC4's negative anchor measures the item list, not the read

SC4's wording is "that member's own client reads the content before the move, and **the same
read** fails after the next completed sync." The positive anchor is a real read
(`assertRecipientDecrypts`). The negative anchor is
`item-row-${itemId}` `toHaveCount(0)` — a list-membership assertion, on a session whose
detail panel the task deliberately leaves **open** with the decrypted password rendered.

Nothing in the task asserts that the still-open panel stopped exposing the plaintext. If
`mergeCollectionSnapshot` drops the cached item but the mounted `DetailPanel` keeps rendering
its stale props, the test goes green while the member is still looking at the password. That
is this project's recurring defect shape, in the test that exists to disprove it.

**Fix:** keep the row-count assertion as a sync-completion signal, then add the actual
negative read on the same session — assert the open panel's password field is gone/emptied
(or that re-attempting the same read path fails). The assertion must be the inverse of the
exact positive anchor used in step 3.

### B-5 — Wave 1 (32-01 ∥ 32-03) is file-disjoint but not build-disjoint

`web/playwright.config.ts` builds the server from the live tree:
`cargo build --manifest-path <repo>/Cargo.toml --release -p pv-server`. 32-01's every
`<verify>` runs that build while 32-03 is mid-edit in `crates/pv-server/src/routes/vault.rs`.
A half-applied clippy sweep or a half-written DELETE condition makes 32-01's live verify fail
for reasons that have nothing to do with 32-01 — and this repo already has a logged incident
of exactly this ("no repo builds while an agent writes"). Phase 31's first plan set was
rejected for intermediate verifications that could not pass; this is the same failure with a
concurrency cause.

**Fix — one of:** (a) put 32-03 alone in wave 1 and move 32-01 to wave 2 (32-03 is short and
Rust-only, so the serialization cost is small); or (b) run the two plans in separate git
worktrees with separate `CARGO_TARGET_DIR`s. Whichever is chosen, say so in the plan
frontmatter — do not leave it to the executor.

---

## WARNINGS

- **W-1 — 32-03 Task 1, the retarget preserves the invariant but not the record.** The
  retarget is sound (verified above): the item_bucket branch still asserts 404 for the DELETE's
  own reason. But the test's name
  (`share_then_move_into_collection_bumps_recipients_direct_revision_and_revokes_their_access`)
  and its BL-01 doc comment both say "into a collection", and after this change that sentence
  documents behaviour the codebase no longer has. Rename it (`..._into_item_bucket_...`) and
  rewrite the doc comment to state which branch it now covers and why. The plan instructs the
  DELETE's own comment to be updated but is silent on the test's.

- **W-2 — 32-03 Task 1, the new ordinary-collection test under-specifies.** As written it
  asserts only `PUT` → 200. It should also (a) assert `DELETE` (see B-1), and (b) assert the
  recipient still has **no read path** for the item, so nobody later reads this test as
  proving "access is preserved" when what survives is authorization without visibility.

- **W-3 — 32-02 Task 1 leaves an assertion choice to the executor.** "no `Udostępnione
  foldery` optgroup renders (or renders empty — pick one, assert it)" — an unresolved fork in
  a plan reliably resolves toward the weaker assertion. Decide it here: assert the optgroup is
  **absent**.

- **W-4 — vacuity scan.** No dead `|| true`, no tail-swallowed exit, no `--lib` matching zero
  tests in this set. Two near-misses worth pinning: 32-04 Task 1's
  `.not.toContain("Try again")` is a pure absence assertion and would pass on a blank banner —
  the plan does pair it with a hardcoded positive literal for `error.itemMoveAccessLost`, so
  keep both and make the positive assertion the primary one. And 32-02 Task 1's
  `disabled`-attribute assertion must read the DOM property, not a class (the plan says so;
  hold the executor to it).

- **W-5 — clippy ordering within 32-03.** Task 1 adds Rust test code; Task 2's gate is
  workspace-wide `--all-targets`. Run Task 2 **after** Task 1 and re-run the full command at
  the end, or Task 1's new test code can reintroduce findings after Task 2 declared victory.
  The plan hints at ordering but does not require it.

- **W-6 — `moveVaultItem`'s plaintext precondition needs to be written down.** The
  encrypt-only departure is safe today only because of a call-site invariant (editor-held live
  plaintext) that nothing enforces. A future "move to shared folder" context-menu action
  calling it with a partially-populated `ItemFields` produces an undecryptable row —
  irreversibly. Require a doc comment on the helper stating the precondition explicitly, and
  a note that the existing `moveItemToFolder` context-menu path must never be widened to
  collection ids without switching to the decrypt-source shape.

- **W-7 — dependency chain is stricter than necessary.** 32-04 `depends_on: ["32-02"]` but
  consumes only 32-01's `moveVaultItem`/`moveItemToDestinationViaEditor`. Serialization cost
  only, no correctness issue — noted so the wave-3 placement is not mistaken for a real
  dependency if B-5's re-waving shuffles things.

---

## Coverage matrix

| SC / Req | Covered by | Discriminating? |
|---|---|---|
| SC1 (edit half) | 32-01 T1 e2e | Yes — API-level `collection_id` read after a real reload |
| SC1 (create half) | 32-02 T2 e2e | Yes — asserts `collection_id != null` after save and after reload |
| SC2 | 32-01 T1 (live recipient read) + T2 (real WASM, negative cross-key check) | Yes — the wrong-key AEAD failure check is what makes it non-vacuous |
| SC3 | 32-04 T1 | Yes — driven TOCTOU, byte-identical read via a valid token, destination cross-check |
| SC4 | 32-04 T2 | **No — see B-4.** Positive anchor is a read; negative anchor is a list count |
| SC5 / DEBT-04 | 32-03 T2 | Yes — the criterion is the command; scope independently confirmed complete |
| ORG-01 / ORG-02 / ORG-04 / DEBT-04 | present in plan `requirements:` frontmatter | Yes, all four mapped |
| CONTEXT Area 1 | 32-01 T1 step 2 + 32-02 T1 | Yes, except **B-2** |
| CONTEXT Area 2 (no disclosure) | honored — no note, no confirm dialog. Not re-opened here. | — |
| CONTEXT Area 2 (`item_shares` survive) | 32-03 T1 | Implemented, but **B-1**: the decision's own premise does not survive its correction |
| Deferred ideas | none present in any plan | ✓ |

---

## What to change, by id

1. **32-03 Task 1** — escalate the Area 2 premise to Bartek, or close the write/delete hole; rewrite T-32-06; add a `DELETE` assertion and a no-read-path assertion to the new test; rename/rewrite the retargeted test's name and BL-01 doc comment. (B-1, W-1, W-2)
2. **32-01 Task 1 step 2** — render a disabled, honestly-labelled select for an item currently in an `item_bucket`; add the dictionary key. (B-2)
3. **32-01 Task 1 step 3** — refresh `createdItemState` (revision + collectionId) before any retry; treat "already at destination" as success; stop flattening `RevisionConflictError` into retry-inviting copy. (B-3)
4. **32-02 Task 1** — add the lost-response retry case; fix the absent-optgroup fork. (B-3, W-3)
5. **32-04 Task 2** — add a real negative read on the still-open member session. (B-4)
6. **Frontmatter/waves** — serialize 32-03 ahead of 32-01, or mandate separate worktrees. (B-5)
7. **32-01 store.ts** — document `moveVaultItem`'s plaintext precondition. (W-6)
8. **32-03** — require Task 2 to run after Task 1 and re-run the full clippy gate last. (W-5)

---

# Iteration 2 (2026-08-19)

**Verdict: REVISE** — 2 blockers remain, both narrow and precisely specifiable. Everything
else from iteration 1 is genuinely closed. Deltas only; iteration 1's independently verified
facts (DEBT-04's 19+6, the `ceremony.rs` diagnosis, SC3's byte-identical implementability,
the encrypt-only departure's safety) are not re-derived.

## B-1 — resolved, and the reversal is clean

`32-CONTEXT.md` Area 2 now records the reversal with its full two-step history. I checked for
vestiges and found none:

- `32-03` `files_modified` no longer lists `crates/pv-server/tests/sync_shared.rs`; its
  `requirements` is now `[DEBT-04]` only; it has exactly one task (the clippy sweep). No
  retarget, no `dest_is_item_bucket` condition, no new server test survives anywhere.
- `32-01`'s objective was updated rather than left stale.
- The only remaining `item_shares` references in the plan set are `32-04` Task 2's
  by-construction scoping ("the member holds no direct grant at any point"), which is still
  correct and still necessary.
- Requirement coverage survives the re-scoping: ORG-01 → 32-01/32-02, ORG-02 → 32-01/32-04,
  ORG-04 → 32-01/32-04, DEBT-04 → 32-03. All four ROADMAP ids still claimed.

## B-2 — resolved

The guard now renders a disabled `<select>` whose single selected option is
`item.folderLockedByFamilyShare`, with `value="item-bucket-locked"` and the "+ new folder"
button omitted. It cannot fall back to the shipped path: the branch replaces the control
outright rather than parameterising it, so `value={fields.folderId ?? ""}` is unreachable
here. A save from this state is also safe — `destinationCollectionId` is initialised from
`currentCollectionId`, so the edit-mode dispatch compares equal and routes to the untouched
`updateVaultItem`, and with the control disabled `fields.folderId` cannot be mutated from this
branch at all. `32-02` Task 1 asserts the disabled property, the label, and the no-side-effect
claim. Copy names where a real change happens. Good.

## B-5 — resolved

Fully serialized: 32-03 wave 1 alone → 32-01 wave 2 → 32-02 wave 3 → 32-04 wave 4, with the
`depends_on` on both 32-01 and 32-04 annotated as build-hazard / file-overlap rather than
content. Since `vault.rs` is only written in wave 1 and every live verify runs in waves 2-4,
the `playwright.config.ts` live-build race is gone.

## Warning dispositions — all confirmed

W-1/W-2 are moot by construction (no retarget, no new server test). W-5 is moot (32-03 adds no
Rust test code, and it is a single task whose gate is the full workspace command). W-3 is
resolved in the plan text itself — the absent-optgroup fork is decided as "assert absent".
W-4's DOM-`disabled`-property requirement is now written into `32-02`. W-6's doc-comment
precondition is spelled out on `moveVaultItem`, including the explicit warning about widening
the context-menu `moveItemToFolder` path. W-7 is annotated. I also confirmed the two new API
symbols the B-3 fix leans on exist: `listItems` (`web/src/lib/vault/api.ts:142`) and
`getItems` (`web/src/lib/vault/store.ts:364`), and that `fetch_items_for` returns
`collection_id` and `revision` on both arms, so the fresh-row check is implementable.

---

## BLOCKER C-1 — 32-04 Task 2 step 3: the negative anchor is still vacuous, because the positive-anchor helper closes the panel

The B-4 fix is correct in intent and the locator shape is right — `assertRecipientDecrypts`
asserts `detail-panel.getByText(password, { exact: true })` after clicking `reveal-password`,
so a page-scoped `getByText(password, { exact: true })` really is its inverse. But the last
line of that helper is:

```ts
await page.getByTestId("detail-panel-close").click();
```

The task says "`assertRecipientDecrypts` (or its local equivalent from 32-01) reads the real
decrypted password, panel left OPEN (no `detail-panel-close`)" — which the existing helper
cannot satisfy. Reuse it as written and the panel is closed before step 4 even begins, so the
step-5 negative assertion counts zero for a reason entirely unrelated to access loss. It would
pass against a build where the member keeps full read access. That is the same defect B-4
identified, re-entering through the helper the fix depends on.

**Required, concretely:**
1. In `32-04` Task 2 step 3, do not call `assertRecipientDecrypts`. Add a local
   `assertRecipientDecryptsLeavingPanelOpen(page, itemId, itemName, password, because)` —
   a copy of the existing helper with the final `detail-panel-close` click removed — and use
   it. State in the task that reusing the closing helper here silently voids step 5.
2. Immediately before step 4's move-out, add the driving pre-check on the **same page-scoped
   locator step 5 uses**:
   `await expect(member.page.getByText(itemPassword, { exact: true })).toHaveCount(1)`
   (adjust the count if the reveal renders the value twice — assert the observed non-zero
   count, not `toBeVisible`). Without this, step 5 remains an unanchored absence assertion:
   with it, the assertion is proven to have been capable of failing.

## BLOCKER C-2 — 32-01 Task 1: the lost-response recovery can report success over a write that never landed

The recovery condition is destination-only: on any failure, re-fetch and *if the row's
`collection_id` already equals `newCollectionId`, return success*. That is right for the
first-attempt lost-response case. It is wrong on a retry, and the retry path is exactly what
B-3 introduced.

Sequence, entirely within the plan's own create-mode flow:

1. Save #1 sends content **A** with the destination. The server commits; the response is lost.
   Suppose the internal recovery also misses it (the `listItems` call fails, or the store
   backstop runs first) — the form stays open with `error.itemCreatedButMoveFailed` and a
   refreshed revision.
2. The user, being told to try again, corrects a field. Content is now **B**.
3. Save #2 sends content **B** at the refreshed revision and fails (409 from the concurrent
   state, or any error).
4. Recovery re-fetches, sees `collection_id === destination` — from step 1's commit — and
   returns **success**. `onCreated()` fires, the form closes.

The item is in the right folder holding content **A**. The user's last edit is gone and the UI
reported success. "Reports success over a write that didn't land" is precisely the state the
fix exists to prevent, and it is reachable through the fix's own retry loop.

The same hole exists in the `ItemForm` backstop, which tests only
`fresh?.collectionId === destinationCollectionId`.

**Required, concretely — one extra conjunct in both layers:**

- In `moveVaultItem`'s recovery check, recover only when the fresh row is at the destination
  **and** its `revision === currentRevision + 1` — i.e. the server row is this attempt's own
  commit, not an earlier one. Any other revision at the destination means someone else's write
  (or an earlier attempt's) is what landed: fall through to the existing classification
  (`isConflictError` → `loadAndDecryptAll()` → `RevisionConflictError`), which is the honest
  outcome and which `DetailPanel` already surfaces as a conflict rather than a retry lie.
- In `ItemForm`'s create-mode backstop, apply the same conjunct against
  `created.revision + 1`; when it does not hold, take the existing refresh-and-report branch.
- Add the case to `32-02` Task 1's retry describe block: `getItems()` returns the item at the
  destination but at an unexpected revision → assert `onCreated` is **not** called and the
  error renders. Without this test the guard is unfalsified.

**Two smaller things to fold into the same edit** (not separately blocking, but cheap and in
the same lines):

- Wrap the recovery `listItems()` call in its own try/catch. If the recovery fetch itself
  fails, rethrow the **original** error so the 403/409 classification below still runs —
  otherwise a network failure during recovery masks a genuine TOCTOU refusal and
  `DetailPanel` shows the generic banner instead of `error.itemMoveAccessLost`, quietly
  weakening SC3's own surfacing path.
- The plan licenses `error.itemCreatedButMoveFailed` to say "Spróbuj ponownie" because "B-3's
  recovery mechanism makes the promise true." With C-2 fixed, one case remains where it is not
  true: destination reached at a foreign revision. That path throws `RevisionConflictError`,
  and create mode currently flattens every throw into the retry-inviting copy. Route a
  `RevisionConflictError` in create mode to the conflict copy, not the retry copy.

---

## Verdict

**REVISE.** Both remaining blockers are localized and fully specified above: one added
non-closing helper plus one pre-check in `32-04` Task 2, and one `revision === currentRevision + 1`
conjunct (plus its unit test and two copy/error-routing details) in `32-01` Task 1 / `32-02`
Task 1. Nothing else in the plan set stands in the way — B-1, B-2, B-5 and all seven warnings
are genuinely closed, and the phase's five success criteria are each covered by a test that
can fail once C-1 is fixed.
