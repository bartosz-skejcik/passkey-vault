---
phase: 30-the-living-group-family-wide-sharing
fixed_at: 2026-08-11T08:43:06Z
review_path: .planning/phases/30-the-living-group-family-wide-sharing/30-REVIEW.md
iteration: 1
findings_in_scope: 16
fixed: 15
skipped: 1
status: partial
---

# Phase 30: Code Review Fix Report

**Fixed at:** 2026-08-11T08:43:06Z
**Source review:** .planning/phases/30-the-living-group-family-wide-sharing/30-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 16 (4 critical, 7 warning, 5 info — full scope, per explicit instruction, not the default critical/warning-only cut)
- Fixed: 15
- Skipped: 1 (WR-07, explicitly excluded by the calling instructions)

**Note on commit granularity:** Several findings share the same source files/functions
(most notably CR-01+CR-03, which the calling instructions required to be fixed
together since fixing one alone would make the other strictly worse). Where a
finding's own fix landed in the same function/file as another finding's fix, it is
committed together rather than split via risky line-level hunk surgery, and that
bundling is called out explicitly below and in `30-REVIEW.md`'s own Dispositions
table.

## Fixed Issues

### CR-01 + CR-03: family-wide grant delivered the propagator's level, not the share's declared level; and a `read`-only member could never reseal (WINDOWS #17)

**Files modified:** `crates/pv-server/migrations/0020_family_wide_access_level.sql` (new),
`crates/pv-server/src/routes/collections.rs`, `crates/pv-server/src/routes/membership.rs`,
`crates/pv-server/tests/collections.rs`, `crates/pv-server/tests/family.rs`,
`crates/pv-server/tests/family_wide_sharing.rs`, `web/src/lib/vault/api.ts`,
`web/src/lib/vault/collections.ts`, `web/src/lib/vault/collections.real-wasm.test.ts`,
`web/src/lib/invite/crypto.ts`, `web/src/lib/invite/crypto.test.ts`,
`web/src/lib/families/resealTrigger.ts`, `web/src/lib/families/resealTrigger.test.ts`,
`web/src/components/vault/ShareDialog.tsx`, `web/src/components/vault/ShareDialog.test.tsx`
**Commit:** `ee928a3`
**Applied fix:**
- New nullable `collections.family_wide_access_level` column (migration 0020) persists
  the access level a family-wide share was *created at*, independent of the creator's
  own `collection_keys` row (still hard-coded `'edit'` — that invariant is untouched).
  `collections::create` now requires (and validates) this field exactly when
  `family_wide_kind` is set, mirroring `family_wide_kind`'s own closed-set validation
  discipline; `get()`/`list()` thread it through.
- `web/src/lib/invite/crypto.ts`'s invite-time-wrap fold-in now sends
  `entry.family_wide_access_level ?? entry.access_level` (falls back to the caller's
  own level only for a legacy/pre-migration row), never `entry.access_level` alone.
- `web/src/lib/families/resealTrigger.ts`'s lazy reseal now sends
  `collection.family_wide_access_level ?? FALLBACK_ACCESS_LEVEL` ("read", a safe
  never-over-grants default) — never `collection.access_level` (the resealer's own row).
- `collections::add_member` is no longer `RequireEdit`-only. It is now
  `Membership<Collection, RequireRead>`-gated, and the handler body applies
  `RequireEdit::satisfied_by` for an ordinary collection (byte-identical behavior to
  before) or the propagation-bound `may_grant_access_level` (the same bound
  `require_collection_access_for_propagation` already applies to the invite path) for a
  family-wide one (`membership::is_family_wide_collection`, a new shared predicate also
  used by CR-02's fix). This is what lets a `read`-holding member actually reseal a
  `read`-declared share — closing WINDOWS #17 with the mechanism fix the review asked
  for, not a re-record.
- `web/src/components/vault/ShareDialog.tsx`'s `createCollection` calls (both the
  family-wide folder and item-bucket branches) now thread the chosen `level` through as
  a 5th argument, so the share's own declared level actually reaches the server at
  creation time.
- `web/src/lib/vault/collections.ts`'s `Collection` interface gained
  `familyWideAccessLevel`, threaded from the wire the same way `familyWideKind` already
  is.
- **Two existing unit-test assertions were corrected, not weakened** (they encoded the
  bug): `web/src/lib/invite/crypto.test.ts:290-293` asserted "access_level is the
  collection's OWN caller-held level, never hardcoded to read" — the corrected test now
  gives the caller a DIFFERENT held level ("edit") than the share's declared level
  ("read") and asserts the declared level ("read") is what gets propagated, plus a
  second case proving the legacy-row fallback. `web/src/lib/families/resealTrigger.test.ts`'s
  default fixture now deliberately sets `access_level`/`family_wide_access_level` to
  different (trap) values, so every pre-existing assertion in the file that expected the
  old shared value is now a live proof the fix reads the right field.
- **Bundled into this commit** (same functions/files already touched by CR-01/CR-03):
  - **WR-04** (`collections.rs`'s 409 message) — see its own entry below.
  - **CR-04** (`ShareDialog.tsx`'s pending-key handling) — see its own entry below.
  - **IN-04** (`tests/family.rs`'s exact-shape assertion) — see its own entry below.

**Live proof added (mandatory per this task's verification instructions):**
`crates/pv-server/tests/family_wide_sharing.rs::cr01_read_declared_family_wide_share_delivers_read_never_edit_to_late_joiners_via_invite_and_reseal`
drives a `read`-declared family-wide folder through BOTH delivery paths and asserts
recipient-side (`GET /api/vault/collections/{id}` from the newcomer's own token) that
they hold exactly `read`, never `edit`. **Confirmed to fail against the pre-fix
behavior**: I reverted the client-side propagation line (`entry.access_level` instead
of the `?? ` fallback) and re-ran the test — it failed with `Some("edit")` where
`Some("read")` was expected (invite path). Separately, I reverted `add_member`'s gate
back to `Membership<Collection, RequireEdit>` and re-ran the test — the `read`-holding
member's reseal attempt returned `403` instead of `201` (reseal path). Both reverts were
then restored and the fix re-verified passing before committing.

### CR-02: invite propagation exemption not scoped to family-wide collections

**Files modified:** `crates/pv-server/src/routes/invitations.rs`, `crates/pv-server/tests/invitations.rs`
**Commit:** `9cdd0b8` (bundled with WR-01, same file, adjacent loops discovered in the same review pass)
**Applied fix:** `invitations::create`'s `family_wide_keys` loop now checks
`membership::is_family_wide_collection` before choosing which gate to apply: a genuine
family-wide entry keeps the relaxed `require_collection_access_for_propagation` bound;
an ordinary collection now falls back to `require_collection_edit`, matching the
deliberate single-collection-scope branch twenty lines above and `collections::add_member`'s
own gate for the identical deliberate-share action.

**Regression test added:**
`invitation_create_with_read_only_on_a_non_family_wide_collection_in_family_wide_keys_rejects`
grants the caller `read` (not zero access — the existing
`invitation_create_with_family_wide_collection_caller_lacks_edit_on_rejects` test already
covered the zero-access case) on a fellow member's ordinary collection, then submits it
in `family_wide_keys`. **Confirmed to fail against the pre-fix behavior**: with the
`is_family_wide_collection` branch removed (always taking the relaxed bound), the test
failed with `201` (silently authorized) where `403` was expected. Reverted and
re-verified passing before committing.

### WR-01: `accept()` never re-validated the inviter's current authority for family-wide entries

**Files modified:** `crates/pv-server/src/routes/invitations.rs`
**Commit:** `9cdd0b8` (see CR-02 above)
**Applied fix:** The `family_wide_sealed_keys` loop in `accept()` now runs the same
"does the inviter still hold a grant on this collection" check the existing
single-collection-scope branch already had (`active_collection_member_join!()`), before
inserting the newcomer's `collection_keys` row. A stale entry (inviter lost access after
the invite was created) is silently dropped, matching the existing policy for an
unknown/mismatched `collection_id`.

### WR-02: departing member's zero-survivor collection items silently orphaned instead of cascade-deleted

**Files modified:** `crates/pv-server/src/routes/account.rs`, `crates/pv-server/tests/account_deletion.rs`
**Commit:** `8b2d663`
**Applied fix:** `reassign_departing_member_collection_items` now checks
`COUNT(*) FROM collection_keys WHERE collection_id = ? AND recipient_user_id != ?`
before reassigning; when zero survivors remain, the collection is skipped entirely and
its items are left for the ordinary cascade delete, exactly as before the WINDOWS #16
fix existed.

**Regression test added:**
`member_self_deletion_destroys_items_in_a_collection_with_no_surviving_recipients`.
**Confirmed to fail against the pre-fix behavior**: with the `survivors == 0` guard
removed, the item survived the member's self-deletion (reassigned to the owner,
permanently undecryptable) — the test failed asserting `item_still_exists == 0` (got
`1`). Reverted and re-verified passing before committing.

### WR-03: synthetic pending-family-key placeholder rows leaked into type/tag/folder-scoped views

**Files modified:** `web/src/components/vault/ItemList.tsx`
**Commit:** `4b15310`
**Applied fix:** `ItemList` now filters out `pendingFamilyKey === true` rows before
applying any filter other than `"all"` — the placeholder's fabricated `fields.type:
"note"` can no longer make it appear inside a Notes-only (or any other scoped) view.

### WR-04: item-bucket 409 conflict reported the wrong cause

**Files modified:** `crates/pv-server/src/routes/collections.rs`, `crates/pv-server/tests/collections.rs`
**Commit:** `ee928a3` (bundled with CR-01/CR-03, same `create()` function and the same
test function I was already extending for CR-01's required `family_wide_access_level`
field)
**Applied fix:** The `ON CONFLICT DO NOTHING` `None`-branch now disambiguates: an
`item_bucket` conflict reports "this family already has a family-wide item bucket";
every other case keeps the original "a collection with this id already exists" message.
Verified via an exact-string assertion added to the existing
`second_item_bucket_for_same_family_is_409_but_second_folder_succeeds` test.

### WR-05: rekey notice misattributes authorship to every recipient, and its change-detection state survives an account switch

**Files modified:** `web/src/lib/vault/collections.ts` (bundled into commit `ee928a3`,
same file as CR-01's `Collection` interface change), `web/src/lib/i18n/dictionary.ts`
(commit `882c86d`)
**Applied fix:** `clearCollectionsOnRemoval` now resets `lastSealedKeys = new Map()`
alongside `collections = []`, closing the false-positive "your share was re-encrypted"
notice on a same-tab account switch. `share.familyRekeyNotice` reworded from "Jedna z
Twoich udostępnionych pozycji…" / "One of your shared items…" to audience-neutral
"Udostępniony folder został ponownie zaszyfrowany…" / "A shared folder was
re-encrypted…" — true regardless of whether the reader created the share or merely
holds it.

### WR-06: `getFamilyWidePending()` discarded every error class identically

**Files modified:** `web/src/lib/families/api.ts`
**Commit:** `701cab1`
**Applied fix:** The catch now narrows to the two expected statuses (403 suspended
member, 404 no-family/solo account) staying silent; every other cause is
`console.warn`ed, mirroring `resealTrigger.ts`'s own warn-and-continue discipline. The
fail-safe empty-arrays return value is unchanged.

### IN-01: duplicated comment block in `store.ts`

**Files modified:** `web/src/lib/vault/store.ts`
**Commit:** `a22d732`
**Applied fix:** Removed the second, verbatim-duplicate copy of the "30-13 (FSH-02): a
new unlock is a new session…" comment above `resetFamilyWideResealAttempts()`.

### IN-02: `PENDING_FAMILY_KEY_ID_PREFIX` exported with no consumer

**Files modified:** `web/src/lib/vault/store.ts`
**Commit:** `a22d732`
**Applied fix:** Dropped the `export` keyword — confirmed via a repo-wide grep that no
file anywhere in `web/src`, `web/e2e`, or `packages/` imports it; every existing guard
already uses the `pendingFamilyKey` discriminant alone.

### IN-03: unresolved `T-30-XX` placeholder task ids

**Files modified:** `web/src/lib/families/rekey.ts`, `web/src/components/settings/DeleteAccountDialog.tsx`
**Commit:** `22c1be0`
**Applied fix:** Replaced both literal `T-30-XX` references with a pointer to the real
commit that fixed the bug they describe (`1117919`, matching the description "found
live, 30-17-PLAN.md's own Task 2 case 1" exactly — this session's own `git log` showed
`1117919 fix(30-17): let a plain member build their own self-deletion re-key batch
without owner privilege" as the commit in question). No formal task id exists for this
fix in the planning artifacts, so pointing at the resolving commit is more resolvable
than the placeholder, not merely a substitution.

### IN-04: discovery endpoint's empty-result case has no exact-shape test

**Files modified:** `crates/pv-server/tests/family.rs`
**Commit:** `ee928a3` (bundled — same test function I was already extending for CR-01's
required `family_wide_access_level` fixture field)
**Applied fix:** Added an assertion to the existing
`family_wide_pending_empty_when_no_family_wide_collections_exist` test that the response
body's keys are exactly `["missing", "resealable"]`, closing the specific gap the review
named (the adversarial whole-database sweep in `family_wide_sharing.rs` cannot exercise
this shape, since its own generic string sweep requires a non-empty body).

## Skipped Issues

### WR-07: `.planning/WINDOWS.md`'s JSON block drifted from its own table

**File:** `.planning/WINDOWS.md:36-231`
**Reason:** Explicitly excluded by this task's own calling instructions: "Do not
commit `.planning/WINDOWS.md` — I will handle #17's status myself, since my own
characterisation of it was wrong." Not touched in any way.
**Original issue:** Entry #17 present in the table, absent from the JSON; #15/#16
marked `fixed` in the table but `"status": "open"` in the JSON.

## No Change Needed

### IN-05: `submitItemFamilyWide` moves an already-shared item without disclosure

**File:** `web/src/components/vault/ShareDialog.tsx:658-694`
**Reason:** The review itself does not propose a concrete fix — it explicitly frames
this as "consistent rather than novel" (an ordinary `moveItemToCollection` already has
this exact side effect) and flags it only because the family-wide entry point reads as
purely additive. This is a disclosure/product-copy question (whether to warn before
moving an already-shared item into the family bucket), not a code defect with a single
correct implementation — left for a deliberate product decision rather than an
unrequested UX change bundled into this fix pass.

---

_Fixed: 2026-08-11T08:43:06Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
