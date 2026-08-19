# Plan check — 260812-01e (Phase 30 fix: the family-wide ITEM variant)

**Verdict: REVISE**
Checked at HEAD `3219b16` against the real code, not the plan's summary of it.
5 BLOCKERs, 5 WARNINGs. The plan's diagnosis, file-level accuracy and falsification
discipline are unusually good — every code claim I spot-checked was true (see
"What is right", below). What fails is the *mechanism*: the chosen way of granting
the contributor `edit` opens three access-control side doors that LOCKED decision 1
does not sanction, and the one live test that is supposed to prove Face 2 would pass
with Face 2 still broken.

---

## 1. The self-escalation mechanism — UNSOUND as specified

### B-1 (BLOCKER) — the "correlated to a real contribution by construction" claim is false

Plan `<context>` line 83 and threat register `T-30fix-01` both rest on: the claim
"stays correlated to an actual contribution by construction, since `move_item`'s
`source: Membership<Item, RequireEdit>` extractor already requires the caller to own
(or hold edit-share on) the item being moved."

That extractor constrains the *item*, not the *contribution*. Any family member can
`POST /api/vault/items` with arbitrary opaque `enc_key`/`enc_data` (they own it, so
`Item::resolve_access`'s personal branch returns `Edit` — `membership.rs:262-278`)
and immediately `PUT /api/vault/items/{id}/collection` at the bucket. Two calls, no
content, no cost. The item may then be deleted; nothing in the plan narrows the row
back (and per decision 1's "has ever contributed", nothing should).

So the operative rule the code will implement is not "contributors get edit" but
**"any member holding any row on an item_bucket may self-upgrade to `edit` on
demand"** — i.e. `read` and `hidden_password` on a family-wide item bucket become
indistinguishable from `edit` for anyone who wants the difference.

That consequence may still be acceptable to Bartek — but it is *not* what the threat
register says, and T-30fix-01's "never an ambient, standalone self-promotion
primitive callable without ever contributing anything" is exactly the sentence that
is untrue. In a zero-knowledge product this is the artifact a future reader will
trust. Rewrite T-30fix-01 to state the real reachability (2 API calls, no real
contribution, permanent), or change the mechanism.

**Required:** restate T-30fix-01 honestly. Then B-2/B-3 decide whether "accept" is
still the right disposition.

### B-2 (BLOCKER) — `edit` on a collection is not just "may write items into it": it also confers revocation

`collections::revoke_access` (`crates/pv-server/src/routes/collections.rs:635-638`)
is gated by `Membership<Collection, RequireEdit>` — nothing else. After this plan
lands, a member holding only `read` on a family-wide item_bucket can:

1. create a junk item, move it in (B-1) → now holds `edit` on the bucket;
2. call `DELETE /api/vault/collections/{bucketId}/access/{user_id}` for every other
   member, **including the bucket's creator**.

The only guard is `revoke_access`'s WR-06 last-key-holder check, which stops at one
survivor — the attacker. A `read`-level family member can therefore evict the whole
family from the shared family-wide item bucket. This is a straightforward privilege
escalation introduced by this plan, entirely outside LOCKED decision 1's text
("holds an `edit` row **for themselves**").

### B-3 (BLOCKER) — the same `edit` row re-opens the propagation hole 0020/CR-01 exists to close

Two paths bound a family-wide grant purely by `may_grant_access_level(caller_level, requested)`:

- `collections::add_member`, `collections.rs:541-547`
- the invite-time fold-in, `invitations.rs:262-273` → `require_collection_access_for_propagation`

With `caller_level = Edit`, `(Edit, Edit) => true` (`membership.rs:572`). So a
self-escalated contributor on a bucket **declared `read`** can:

- `add_member` another family member at `"edit"` on that bucket, and
- mint an invite whose `family_wide_keys` entry delivers `"edit"` on that bucket to a
  newcomer.

Neither path re-reads `collections.family_wide_access_level`. This is the same bug
shape migration `0020_family_wide_access_level.sql` was written to fix ("the
PROPAGATOR's own held level substituted for the share's own"), re-opened one level
down, and it directly contradicts the plan's own `must_haves.truths[3]`: *"every
OTHER member holds exactly the bucket's own declared level"* — an invariant the plan
asserts but nothing in it enforces.

### B-4 (BLOCKER) — the sound shape, and what the plan must add

Decision 1 locks the *row* (`edit`, for the contributor, on that bucket). It does not
license the two capabilities that row silently carries. Close them in this same pass,
as a new Task between Tasks 1 and 3:

1. **`revoke_access`**: refuse when
   `is_item_bucket_collection(collection_id)` — membership on a family-wide bucket is
   governed by family membership and the removal re-key path
   (`families.rs:601 apply_member_removal_rekey`), never by a per-share revocation.
   Return `403`. Server test + falsification.
2. **`add_member` and the invite fold-in**: for a collection with
   `family_wide_kind IS NOT NULL`, additionally require
   `requested_level == collections.family_wide_access_level`. This is an *extra*
   bound layered on top of `may_grant_access_level`, not a change to its nine arms —
   LOCKED decision 2 stays intact (do not touch the match). It is also exactly CR-01's
   own stated principle ("every propagation path reads the share's own declared
   level"). Server tests for both paths + falsification.

Note the re-key path itself is clean: `apply_member_removal_rekey`
(`families.rs:601-720`) only rewrites `sealed_key`, never `access_level`, so a
contributor's escalated row survives removal-rekey unchanged and consistently. No
change needed there — but say so in the plan rather than leaving it unexamined.

### W-1 (WARNING) — `is_item_bucket_collection` is a client-settable flag

`family_wide_kind` is taken verbatim from the client in `collections::create`
(`collections.rs:196-243`); only the closed set is validated. So *any* member can
mint a collection flagged `item_bucket`, with a name of their choosing, and — after
this plan — that flag now (a) turns every recipient's `read` row into an on-demand
`edit` (B-1) and (b) hides the collection from the "What you're sharing" tab
(Task 5). Not exploitable across families (`family_id` is server-derived from
`ActiveFamilyMembership`), and pre-existing in kind, but the plan elevates the flag
from cosmetic to security-relevant without noting it. Add it to the threat register.

### W-2 (WARNING) — nothing narrows the row back, and the plan never says so

Deletion of the contributed item, or its removal from the bucket, leaves the `edit`
row. Per decision 1 ("has ever contributed") that is correct — but state it in the
plan and in the SUMMARY, because it is the difference between "contributor" and
"permanent editor" and it is what a reader will assume was considered.

---

## 2. Migration safety — mostly sound, one concrete hardening

`0019_family_wide_sharing.sql:45` currently reads
`CREATE UNIQUE INDEX idx_one_item_bucket_per_family ON collections(family_id) WHERE family_wide_kind = 'item_bucket';`

- **Forward-only / style:** 0014–0020 are pure `ALTER TABLE ... ADD COLUMN`. Task 2's
  `DROP INDEX` + `CREATE UNIQUE INDEX` is still forward-only and data-preserving, and
  it is the only way to re-scope a SQLite index — acceptable. But the plan's own words
  "additive-only migration" (Task 2, line 114) are inaccurate; it drops a schema
  object. Fix the wording so the migration header does not claim something false.
- **Existing families:** a family holding exactly one bucket cannot collide under a
  strictly wider key. Safe. Live DB (`vault.blonie.cloud`, `pv-data`) is safe.
- **Still partial, right predicate:** yes — `WHERE family_wide_kind = 'item_bucket'`
  is preserved, so `'folder'` stays unbounded, and `collections::create`'s bare
  `ON CONFLICT DO NOTHING` (the only form that catches a partial-index conflict —
  `collections.rs:225-243`) keeps working unchanged.
- **NULL level:** the plan's acceptance is *correct*, and I verified the reason it
  gives is real: `validate_family_wide_access_level` (`collections.rs:114-128`)
  returns `BadRequest` for `(Some(kind), None)`, so no new NULL-level item_bucket can
  be created through the API. Good analysis.

### W-3 (WARNING) — make the NULL case structurally impossible, not merely unreachable

The new index permits unbounded NULL-level item_buckets per family (SQLite NULLs are
distinct). One character of extra safety, no behaviour change:

```sql
CREATE UNIQUE INDEX idx_one_item_bucket_per_family
  ON collections(family_id, COALESCE(family_wide_access_level, ''))
  WHERE family_wide_kind = 'item_bucket';
```

Then a legacy NULL row and a future NULL row collide, matching the pre-0021 guarantee
for that case instead of relying on a validator staying correct forever.

---

## 3. Does the proof actually prove?

| Test | Would it pass with the fix absent? | Verdict |
|---|---|---|
| Task 1 (`200 OK` on move into a `read` bucket + `collection_keys` row assertions) | No — 403, exactly VERIFICATION.md's probe. Contributor-vs-member_c asymmetry control is a genuine discriminator. | **Sound** |
| Task 2 (third creation at a different level → `201`, count 2, distinct levels) | No. Falsification restores the old index. | **Sound** |
| Task 3.1 (`hidden_password` arm) | No. Independent falsification demanded rather than inherited from Task 1 — correct instinct. | **Sound** |
| Task 3.2 (Face 2 at server level: two `GET /collections/{id}` resolved levels) | No — but asserts a row's `access_level`, not decrypted content. Acceptable at this layer; its falsification is a deliberate *fixture* error, not a production revert, which the plan states honestly. | **Acceptable** |
| Task 4 (ShareDialog unit tests) | Mocked `@/lib/crypto`; per LOCKED decision 3 these are control-flow evidence only. Falsifications specified. | **Acceptable** |
| Task 6 step 3 (no `share-error` / `share-partial-error`) | Purely negative — would also "pass" if the dialog never opened. Redeemed by step 4. | **Acceptable in combination** |
| Task 6 step 4 (owner decrypts item Y's real name + password) | No. This is the real recipient-side, real-crypto positive that LOCKED decision 3 demands, and it is correctly a *non-creator*, `read`-level share. | **Sound — the strongest thing in the plan** |
| **Task 6 step 5 (two levels are independent buckets)** | **Yes — it passes while broken.** | **B-5, below** |

### B-5 (BLOCKER) — Task 6 step 5 is vacuous, and Face 2 therefore has no falsifiable live proof

Step 5 as written: the owner shares item Z family-wide at `"edit"`, the member
decrypts item Z. With Face 2 still fully present (one singleton bucket, `level`
argument ignored, 409 swallowed), item Z lands in the existing `read` bucket and the
member decrypts it just the same. The assertion cannot distinguish one bucket from
two. Step 5 also carries **no falsification** — the plan's falsification paragraph
(line 201) covers step 3 only.

**Required:** step 5 must assert the thing it claims. Concretely: capture the
collection id each share resolved to (via the recipient's `listCollections()` /
`GET /api/vault/collections`, or a `data-testid` the dialog already exposes) and
assert *(a)* the two ids differ and *(b)* the member's resolved `access_level` is
`"read"` on the first and `"edit"` on the second. Then add step 5 to the falsification
list, with Task 4's level-keying reverted as the revert target.

---

## 4. CI-width verification

LOCKED decision 4's five commands appear in full in Task 6's `<verify>` and in the
plan's `<verification>` block. No narrower substitute (`-p pv-server`, `vitest run`)
slipped in anywhere — the exact failure mode that produced B2/B3 is avoided.

### W-4 (WARNING) — Task 5's `<verify>` omits `npm run build`

Task 5 (`web/src/components/vault/SharingOverviewPanel.tsx`, line 182) runs
`npm run compile && npm test` only. Task 4 and Task 6 both include `npm run build`.
Add it for uniformity; the cost is negligible and per-task narrowness is precisely
the shape decision 4 exists to forbid.

Tasks 1–3 running only `cargo test --workspace --no-fail-fast` is correct — they are
server-only, and Task 6 re-runs the full set. No issue.

---

## 5. The must-not-touch list (LOCKED decision 2)

| Must not change | Plan's disposition | Verdict |
|---|---|---|
| `collections::create`'s hard-coded `'edit'` (`collections.rs:280-289`) | Untouched; `<verification>` asserts via `git diff` on `collections.rs` showing no change | **Honoured** |
| `may_grant_access_level`'s exhaustive nine arms (`membership.rs:553-574`) | Untouched; `git diff` check specified on the function body | **Honoured** — and my recommended B-4 fix is deliberately an *additional* bound, never a new arm, so it stays honoured |
| `hidden_password` + family-wide in `ShareDialog` | Not guarded, not narrowed; Task 3.1 actively proves the combination works | **Honoured** |

One caveat: the `git diff` check on `collections.rs` will need rewording if B-4 is
adopted (that file gains a `revoke_access`/`add_member` change). Scope the assertion
to `create()`'s INSERT hunk specifically, not the whole file.

---

## 6. Scope creep — Task 5 belongs, one thing is missing

### Task 5 (`editableIds`) — KEEP

Verified real: `SharingOverviewPanel.tsx:300-303` filters on `access_level === "edit"`
with no `family_wide_kind` exclusion, while `30-UI-SPEC.md` requires an item_bucket
never render as a folder row. The planner's argument is correct and load-bearing:
today only the bucket's sole creator holds `edit`; after Task 1, *every past
contributor* does — so this fix multiplies the population that hits the leak. Fixing
it in the same pass is proper blast-radius containment, not creep. The planner also
correctly caught that CONTEXT.md's own description of this file (a single `.find()`
at line 144-146) does not match the code — `familyWideBucketRows` at
`SharingOverviewPanel.tsx:386-388` is already a generic `filter` + loop. Good
correction, correctly documented rather than silently absorbed.

### B-6 → recorded as **BLOCKER** — LOCKED decision 1's copy clause has no task

CONTEXT.md line 66: *"It must not be hidden — if any UI copy would now be false, fix
the copy."* CONTEXT.md line 143 also names `ShareDialogItemBucketError` copy as a
surface the change will reach.

The plan contains **zero copy work and zero copy audit**. After this change, a user
who picks "read" on a family-wide item share is told the family gets read-only access,
when in fact any recipient can make themselves an editor of that bucket at will (B-1).
That copy is now false, and Phase 30's SC5 ("the UI states honestly what 'the whole
family' means") is the criterion this contradicts. `ShareDialog`'s access-level
helper text and `SharingOverviewPanel`'s family-wide block both need auditing.

**Required:** add a task that audits and, where false, corrects the family-wide item
share copy — and covers it in Task 6's live run (assert the corrected string renders,
against a hardcoded literal not sourced from `t()`, matching e2e test 4's existing
falsification discipline).

### W-5 (WARNING) — `ShareDialogItemBucketError` untouched and unmentioned

CONTEXT names it. The plan neither changes it nor records that it was checked and
found still correct. One sentence in `<context>`'s findings list closes this.

---

## What is right (so the revision does not undo it)

Every one of these was verified against the code and must survive:

- The root-cause reading is exact. `vault.rs:976`'s `require_collection_edit`,
  `ShareDialog.tsx:437 familyItemBucketRow` (no level filter),
  `ShareDialog.tsx:219-247 grantCollectionToRecipients` (`isConflictError` swallow),
  `migrations/0019:45` — all confirmed as described.
- The three "already generic, no change needed" findings are correct:
  `invite/crypto.ts`, `resealTrigger.ts`, and `SharingOverviewPanel`'s
  `familyWideBucketRows` loop. The planner checked rather than assumed, and
  contradicted CONTEXT.md where CONTEXT.md was wrong.
- The NULL-level migration analysis is correct for the right reason
  (`validate_family_wide_access_level`, `collections.rs:114-128`).
- Task 6 step 4 is a genuine recipient-side, real-crypto, non-creator, below-`edit`
  positive proof on decrypted content. That is the exact evidence class the phase has
  been missing since it shipped. Do not weaken it.
- The pool-deadlock constraint at `vault.rs` Gate 2 (`max_connections(1)` harness) is
  correctly carried into the new helper's contract.
- Per-task falsification is specified everywhere except Task 6 step 5 (B-5).

---

## Required changes, in order

1. **B-1** — rewrite `T-30fix-01` to state the real reachability: two API calls, no
   real contribution, permanent, and `read`/`hidden_password` on an item_bucket
   become on-demand `edit`.
2. **B-2 / B-3 / B-4** — add a task closing `revoke_access` on item_buckets and
   bounding `add_member` + the invite fold-in to the collection's own declared
   `family_wide_access_level`. Tests + falsification each. Do not touch
   `may_grant_access_level`'s arms.
3. **B-5** — make Task 6 step 5 assert two distinct bucket ids and two distinct
   resolved levels, and add it to the falsification list.
4. **B-6** — add the copy audit/fix task required by LOCKED decision 1, live-asserted
   in Task 6.
5. **W-1, W-2, W-5** — three sentences in the threat register / `<context>` findings.
6. **W-3** — `COALESCE(family_wide_access_level, '')` in the new index.
7. **W-4** — add `npm run build` to Task 5's `<verify>`.
8. Reword Task 2's "additive-only" claim, and narrow the `<verification>` block's
   `collections.rs` `git diff` assertion to `create()`'s INSERT hunk.

Re-submit for verification after revision.

---

# Iteration 2 — re-check of the revised plan

**Verdict: REVISE** — but narrowly. Two surgical changes, both one-liners, both specified
below precisely enough to be applied without another planner round. Everything else in the
revision is correct and, in two places, better than what I asked for.

Iteration 1's six blockers: **B-1 resolved, B-2 resolved, B-3 resolved, B-4 resolved,
B-5 resolved, B-6 substantially resolved (one wording defect, C-2 below).** W-1 through
W-5 all resolved. Nothing I previously cleared was broken by the revision.

---

## 1. Task 2 — the side-door closures

### 1a. `revoke_access` refusal breadth — CORRECT, and correctly narrow

Verified there are exactly two places in the server that remove a `collection_keys` row:

| Site | Reached by | Affected by Task 2's refusal? |
|---|---|---|
| `collections.rs:675` (`revoke_access`'s own `DELETE`) | `DELETE /api/vault/collections/{id}/access/{user_id}` | **Yes — intended.** This is the eviction door B-2 found. |
| `families.rs:698` (inside `apply_member_removal_rekey`) | member removal, self-leave, account deletion (`families.rs:819`, `account.rs`) | **No.** Separate handler, separate transaction, never routed through `revoke_access`. |

So SC6 — "leaving, being removed, and account deletion each revoke through the same atomic
re-key path", live-proven by e2e tests 5/6/7 — is untouched. The refusal is neither too broad
(removal still strips a departing member's key) nor too narrow (the only per-share revocation
endpoint is closed). The `item_bucket`-only scoping also correctly leaves family-wide *folder*
revocation alone, where no contributor-escalation path exists.

Residual consequence, correctly implied but worth stating in the SUMMARY: after this change
there is **no** way to remove one member's key from a family-wide item bucket short of
removing them from the family. That is the right semantics for a family-wide resource, and it
is what the doc comment Task 2 specifies already says.

### 1b. The equal-the-declared-level bound — one legitimate flow it BREAKS

I traced every caller of `add_member` and of the invite fold-in:

| Caller | Level it sends | Passes the new bound? |
|---|---|---|
| `collections::create` creator's own row (`collections.rs:283-291`) | hard-coded `'edit'`, direct `INSERT`, never through `add_member` | **N/A — untouched.** LOCKED decision 2 safe. |
| `ShareDialog.tsx:235` (`grantCollectionToRecipients`) | the share's chosen level; after Task 5 that equals the bucket's declared level | ✅ |
| `reseal.ts:103` (lazy reseal) | `resealTrigger.ts:147` — `collection.family_wide_access_level ?? "read"` | ✅ |
| Family-wide **folders** in the invite fold-in | declared level, same source | ✅ (non-`item_bucket`, and the bound reads the row either way) |
| `tests/invitations.rs`'s `..._two_family_wide_collections_atomically` | ordinary collections, resolves `None` | ✅ — the planner verified this independently and correctly |

**C-1 (BLOCKER, but one line to fix) — the legacy-NULL invite path 403s.**

`web/src/lib/invite/crypto.ts:125` builds each `family_wide_keys` entry as:

```
access_level: entry.family_wide_access_level ?? entry.access_level
```

The fallback is **the caller's own held level**, not `"read"`. `resealTrigger.ts:43` uses
`FALLBACK_ACCESS_LEVEL = "read"`. The two client paths already disagree; today nothing
notices, because nothing compares them to the row.

Task 1 specifies `resolve_family_wide_declared_level` as "legacy NULL → `AccessLevel::Read`".
So for any family-wide collection with `family_wide_access_level IS NULL` (a pre-0020 row —
the window exists in dev databases, 0019 and 0020 both landed inside Phase 30), an
`edit`-holding caller's invite sends `"edit"`, the bound demands `"read"`, and
`invitations::create` rejects **the whole request** on the first failing entry. Result: that
member can never generate any invite again — WINDOWS #17's exact failure shape, re-created by
the fix for B-3.

**Minimum fix (choose (a)):**

- **(a) Preferred, one line, zero client change:** make the *bound* skip when the column is
  NULL. `resolve_family_wide_declared_level` returns three states, not two — `NotFamilyWide`
  / `Declared(level)` / `LegacyUnknown` — and Task 2's new `requested_level != declared`
  check applies only to `Declared(level)`. `LegacyUnknown` keeps today's exact behaviour
  (`may_grant_access_level` alone). No verified path changes; the new bound covers every row
  that can exist going forward, since `validate_family_wide_access_level`
  (`collections.rs:114-128`) makes NULL unreachable for new rows.
  Task 1's spec line for that helper and Task 2's `Some(declared)` branch both need the
  wording updated to match.
- (b) Alternative, if the planner prefers symmetry: change `invite/crypto.ts:125`'s fallback
  to `"read"`. Cheaper to write, but it silently narrows a live, e2e-verified invite path and
  needs its own falsification — not worth it for a legacy-only row.

Either way, add a fourth server test to Task 2: a family-wide collection with
`family_wide_access_level` NULL, an `edit`-holding caller generating an invite that folds it
in at `"edit"` — assert the invite is still created (i.e. the bound does not fire on a legacy
row). Without this the regression is invisible until someone with an old dev DB tries to
invite.

### 1c. Declared level read from the row — CONFIRMED

`resolve_family_wide_declared_level(db, collection_id)` takes only an id and reads
`collections.family_wide_access_level`. Nothing client-supplied enters it. `family_id` on the
row is itself server-derived at creation (`ActiveFamilyMembership`). Sound.

### 1d. The three attacker tests — REAL

Each is attacker-path-attempted → refused → **server state asserted unchanged** (creator's row
still present; no row created for the third member; no `invitations` /
`invitation_family_wide_keys` rows written). Each has its own falsification that reverts *its
own specific check* and confirms the attack then **succeeds** — the correct direction, and
the correct granularity (three independent reverts, not one shared one). Test 3 correctly
asserts whole-request refusal, matching the loop's existing validate-everything-before-any-
write discipline (`invitations.rs:248-276`). Each would fail if its bound were absent.

---

## 2. Task 8 step 5 — genuinely falsifiable now

**Yes.** With Face 2 present, `findOrCreateFamilyItemBucket` ignores `level`, all three items
land in the single bucket, the three `collection_id`s are equal, and the distinct-id assertion
is false. The assertion cannot pass while the defect exists. The mechanics are grounded in
code that already exists: `apiGet` at `web/e2e/family-wide-sharing.spec.ts:93`,
`GET /api/vault/items` returning `collection_id` (`vault.rs:350`), and
`GET /api/vault/collections/{id}` returning `family_wide_access_level`
(`collections.rs:176-181`). The recipient-side real-crypto decrypt of item Z is retained.
Step 5 now has its own falsification (revert `familyItemBucketRow`'s level filter). B-5 closed.

**The planner's reason for not asserting a member's resolved level is true, not an excuse.**
By step 5 the member has contributed item Y into bucket 1 (step 3), so Task 1's mechanism has
already given them `edit` there; on bucket 2 the owner grants at the declared `"edit"`. Their
resolved level really is `edit`/`edit`, so that assertion would be confounded and would not
distinguish two buckets from one. Using the collection's own declared level is the right
discriminator.

**Implication, and my judgement on it:** the e2e can no longer distinguish *declared* from
*effective* level for a contributing member. The only guard on that distinction is now
Task 4 test 2 — which uses a recipient in an **overlapping, non-contributing** set and asserts
resolved `"read"` on one bucket and `"edit"` on the other, with a falsification proving the
assertion discriminates. That is the correct instrument for the property, and it is a server
integration test against the real handlers, not a mocked unit test. **Adequate.** Worth one
sentence in the SUMMARY recording that the live suite deliberately delegates this specific
property to `family_wide_sharing.rs`, so a future verifier does not read the e2e's silence as
a gap.

---

## 3. Task 7 — the copy

The mechanism is right: a new conditional note rather than a rewrite of the shared
`access.readOnly` / `access.fullEdit` / `access.hiddenPassword` strings — which the planner
correctly established are used across four surfaces and stay accurate on the other three. The
trigger condition (`scope.kind === "item" && isFamilyWideSelected && accessLevel !== "edit"`)
is exactly the case where the label is no longer the whole truth. It follows
`share.hiddenPasswordInlineNote`'s established pattern, gets its own testid, and is
live-asserted in Task 8 step 3 against a hardcoded literal not sourced from `t()` — the same
falsification discipline e2e test 4 already uses. Good.

**C-2 (BLOCKER, wording only) — the specified sentence soft-pedals.**

Task 7's specified content is: *"any family member who adds their own item to this shared
collection becomes a full editor of it."*

A user reads that as conditional on someone choosing to share something — an ordinary,
in-good-faith event. It does not convey the operative fact from T-30fix-01, which the plan's
own threat register states correctly: reaching `edit` costs **two API calls with no real
content**, is available to **every** recipient **at will**, and is **permanent**. So the
sentence a user would find false after the fact is the implicit one — that picking "read-only"
constrains what recipients can do. It does not.

**Minimum fix:** the note must carry all three of these, in both PL and EN:

1. it is available to **any** family member, **at any time**, by their own choice — not only
   as a by-product of someone genuinely sharing something;
2. it therefore means read-only **does not prevent** a determined member from editing the
   items in this collection;
3. it is **permanent** once acquired.

An EN sentence at roughly the right honesty level, for calibration (not prescriptive wording):
*"Read-only here is not a guarantee: any family member can add an item to this collection at
any time, and doing so makes them a permanent editor of every item in it — including this
one. Choose 'full edit' if that is what you mean, or share this item person-to-person
instead."* The PL string still needs the natural-phrasing and dialog-card-width check
Task 7 already specifies.

Update Task 7's `<action>` to require those three facts, and Task 8 step 3's hardcoded-literal
assertion to target a phrase from the strengthened sentence (so a later softening of the copy
fails the live test rather than sliding through).

---

## 4. Did the revision break anything previously cleared?

No.

- **Renumbering** (old 2→3, 3→4, 4→5, 5→6, 6→8; new 2 and 7 inserted) is consistent
  everywhere: `<objective>`, cross-task references ("Task 3's migration", "Task 5's
  level-keying", "Task 1's new function"), `<verification>` ("all eight tasks"), and
  `must_haves.artifacts`. No dangling reference to an old number.
- **`git diff` narrowing** is correct and necessary: scoped to `create()`'s
  `INSERT INTO collection_keys ... 'edit'` hunk (`~283-291`) rather than the whole file, since
  Task 2 legitimately changes `add_member` and `revoke_access` in the same file. The
  `may_grant_access_level` match-arm check is preserved unscoped. LOCKED decision 2 remains
  verifiable.
- **Threat register**: T-30fix-01 now states the real reachability verbatim (B-1 closed);
  T-30fix-04/05 added at `high` with `mitigate`; T-30fix-06 records W-1 as accepted debt with
  a stated boundary. Honest.
- **W-3** (`COALESCE(family_wide_access_level, '')`) and **W-4** (`npm run build` on Tasks 5,
  6, 7, 8) both applied. The migration header no longer claims "additive-only".
- Everything named in iteration 1's "What is right" survives intact, including Task 8 step 4,
  which the plan explicitly marks do-not-weaken.

---

## Required changes — the complete, minimum set

1. **C-1** — make Task 2's declared-level equality bound skip a legacy NULL
   `family_wide_access_level` (three-state `resolve_family_wide_declared_level`;
   `LegacyUnknown` keeps `may_grant_access_level`-only behaviour). Update Task 1's helper spec
   to match. Add a fourth Task 2 test: an `edit`-holding caller folding a NULL-level
   family-wide collection into an invite at `"edit"` still succeeds.
2. **C-2** — strengthen Task 7's specified copy to carry all three facts (any member, at will;
   read-only does not prevent editing; permanent), and point Task 8 step 3's hardcoded literal
   at the strengthened phrase.

Nothing else. With those two applied the plan delivers the phase goal and is ready to execute.
