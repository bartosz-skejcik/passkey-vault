---
phase: 30-the-living-group-family-wide-sharing
plan: 12
subsystem: ui
tags: [react, share-dialog, families, fsh-01, item-bucket, race-recovery]

# Dependency graph
requires:
  - phase: 30-the-living-group-family-wide-sharing
    provides: "30-01's idx_one_item_bucket_per_family partial unique index and collections::create's bare ON CONFLICT DO NOTHING 409; 30-02/30-09's family_wide_kind wire field and createCollection's 4th parameter; 30-08's family-wide row, roster-at-submit-time rule and keyless-member omission rule"
provides:
  - "findOrCreateFamilyItemBucket -- resolves the ONE per-family item_bucket collection (list-then-create, DB-enforced singular, 409-loser adopts the winner's bucket via bounded polling)"
  - "submitItemVariant's family-wide branch -- a bare item shared family-wide is moved into that bucket and the bucket key granted to every current active member; never a direct item_shares row"
  - "grantCollectionToRecipients / withPublishedPublicKey -- the per-recipient grant loop and the keyless-member rule, now shared by BOTH family-wide call sites"
affects: ["30-13 (lazy-reseal trigger picks up the keyless member this branch omits, and the race loser whose grant never arrived)", "30-14+ (SharingOverviewPanel already reads the bucket this branch fills)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DB-enforced singleton via client find-or-create: list first (order-independent convergence), then rely on a partial unique index for the genuine race -- the loser treats the 409 as 'someone else won' and adopts their row, never surfacing it as a user error"
    - "Bounded poll for a KEY-GATED read-back: because collections::list only returns rows the caller holds a collection_keys row for, the race loser polls a bounded number of times for the winner's grant to become visible, and on exhaustion reports an honest retryable failure rather than proceeding with an undefined id"
    - "One policy, one implementation: the per-recipient grant loop (409-is-success-for-that-recipient) and the family-wide keyless-member rule extracted to module-level helpers used by both the folder and the item branch, so the two provably cannot drift"

key-files:
  created: []
  modified:
    - web/src/components/vault/ShareDialog.tsx
    - web/src/components/vault/ShareDialog.test.tsx

key-decisions:
  - "findOrCreateFamilyItemBucket returns { id, ck } rather than the plan's Promise<string>. The caller must re-encrypt the item UNDER the bucket's Collection Key; returning only the id would force the call site to re-list and re-unseal work this function had already done, and would put a second unseal of the same key in a second place."
  - "The 409 loser POLLS (4 attempts, 200ms apart) instead of re-listing once. collections::list is key-gated: the loser holds no collection_keys row for the winner's bucket until the winner's own addCollectionMember fan-out reaches them, so a single immediate re-list can legitimately return nothing. On exhaustion it throws, rendered as share.createFailed -- never a move into `undefined`."
  - "The bucket row is only accepted as 'found' when it carries a usable sealed_key. A row the caller cannot unseal is not a bucket they can encrypt INTO, so treating it as found would reintroduce exactly the undefined-shaped move the bound exists to prevent."
  - "No new i18n key for the exhausted-poll failure -- the existing share.createFailed ('Nie udało się udostępnić. Spróbuj ponownie.' / \"Couldn't share. Try again.\") is literally the plain retryable message required, and nothing durable landed in that path, so it is honest rather than merely convenient."

requirements-completed: [FSH-01]

coverage:
  - id: D1
    description: "An already-existing item_bucket collection is REUSED -- createCollection is never called, and the share is collection-scoped (no createItemShare row)"
    requirement: "FSH-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ShareDialog.test.tsx#family-wide item share (FSH-01 submitItemVariant) > reuses an ALREADY-EXISTING item_bucket collection -- createCollection is never called"
        status: pass
    human_judgment: false
  - id: D2
    description: "The bucket is lazily created exactly once with family_wide_kind: 'item_bucket', and the item is moved into that same new id"
    requirement: "FSH-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ShareDialog.test.tsx#family-wide item share (FSH-01 submitItemVariant) > lazily creates the bucket ONCE with family_wide_kind: 'item_bucket' when the family has none yet"
        status: pass
    human_judgment: false
  - id: D3
    description: "The item is decrypted under the caller's UK and re-encrypted under the bucket's Collection Key with AAD bound to bucket id + item id + the item's NEXT revision, while expected_revision on the wire is the CURRENT one (submitFolderVariant's seed-move discipline verbatim)"
    requirement: "FSH-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ShareDialog.test.tsx#family-wide item share (FSH-01 submitItemVariant) > reuses an ALREADY-EXISTING item_bucket collection -- createCollection is never called (asserts encryptItemForCollection's exact AAD args and moveItemToCollection's expected_revision)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A keyless current member is OMITTED from the creation-time grant without aborting the share (30-08's rule, applied through the shared helper rather than re-derived)"
    requirement: "FSH-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ShareDialog.test.tsx#family-wide item share (FSH-01 submitItemVariant) > omits a keyless member from the creation-time grant WITHOUT aborting the share (30-08's rule, unchanged)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The race LOSER's 409 resolves to the WINNER's bucket -- exactly one create attempt, the item lands in the winner's bucket, no user-visible error -- even though the winner's grant is not visible on the immediate re-list"
    requirement: "FSH-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ShareDialog.test.tsx#family-wide item share (FSH-01 submitItemVariant) > race loser: a 409 from createCollection resolves to the WINNER's bucket once its grant arrives -- never a second bucket, never a user-visible error"
        status: pass
    human_judgment: false
  - id: D6
    description: "A race loser whose key never arrives inside the bound polls repeatedly, then reports a plain retryable failure and moves/grants NOTHING -- the not-yet-granted case cannot pass by mocking only the happy path"
    requirement: "FSH-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ShareDialog.test.tsx#family-wide item share (FSH-01 submitItemVariant) > race loser whose key never arrives: polls a bounded number of times, then reports a plain retryable failure -- never moves the item into an undefined collection"
        status: pass
    human_judgment: false
  - id: D7
    description: "The ordinary per-person item share path is unchanged -- still createItemShare, never the bucket machinery"
    requirement: "FSH-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ShareDialog.test.tsx#family-wide item share (FSH-01 submitItemVariant) > does not touch the bucket path at all for an ordinary per-person item share"
        status: pass
    human_judgment: false
  - id: D8
    description: "Something actually reaches the new capability: checking 'Cała rodzina' on an ITEM share now enables submit and dispatches into the bucket branch (30-08's temporary disabled-guard discharged by implementing it)"
    requirement: "FSH-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ShareDialog.test.tsx#family-wide row (FSH-01/FSH-05) > enables submit for the ITEM variant when family-wide is selected, with zero individual recipients"
        status: pass
    human_judgment: false

duration: ~30min
completed: 2026-08-10
status: complete
---

# Phase 30 Plan 12: Family-Wide Item Share via the Per-Family item_bucket Collection Summary

**Selecting "Cała rodzina" for a bare item now moves it into the ONE per-family auto-created `item_bucket` collection -- reusing the folder variant's re-encryption machinery verbatim, kept singular by a DB partial unique index rather than by client ordering, with the race loser adopting the winner's bucket through a bounded, key-gate-aware poll instead of a single re-list that could legitimately find nothing.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-08-10
- **Tasks:** 1 (`tdd="true"` -- separate RED then GREEN commits)
- **Files modified:** 2 (`ShareDialog.tsx`, `ShareDialog.test.tsx`)

## Accomplishments
- `findOrCreateFamilyItemBucket(identityKey)` lists collections first and creates only when the family genuinely has no `item_bucket` -- so two members independently sharing their own first item family-wide converge on the SAME bucket by ordering alone in the common case, and by 30-01's `idx_one_item_bucket_per_family` in the racing case.
- `submitItemVariant` grew an `isFamilyWide` parameter (default `false`; the individual-recipient path is byte-identical). When `true`, `submitItemFamilyWide` runs `submitFolderVariant`'s seed-move sequence verbatim against the bucket: `recombineEncryptedItem` → `decryptItem(uk, …, row.revision)` → `encryptItemForCollection(bucketCk, …, bucketId, itemId, row.revision + 1)` → `splitCombinedEncryptedItem` → `moveItemToCollection(itemId, bucketId, …, row.revision)`, then the shared grant loop.
- A family-wide item share is **collection-scoped, never a direct `item_shares` row** -- asserted explicitly (`createItemShare` not called). That is what lets a LATER joiner read it at all; a per-recipient share row can only name recipients who exist at share time.
- The 409 recovery branch is now honest under the key-gate: `awaitFamilyItemBucketGrant` polls `listCollections()` up to 4 times, 200 ms apart, for a bucket row **with a usable `sealed_key`**, and throws a plain retryable failure on exhaustion (rendered as `share.createFailed`) rather than returning an id-less result.
- The per-recipient grant loop (`grantCollectionToRecipients`, including its 409-is-success-for-that-recipient rule and WASM-handle freeing) and the family-wide keyless-member rule (`withPublishedPublicKey`) are extracted to module level and used by BOTH the folder and the item branch -- one policy, one implementation.
- 30-08's temporary "the ITEM variant's family-wide submit stays disabled, that wiring is a later plan's job" guard is **discharged by implementing it**: `familyWideSubmittable` no longer carries the `&& isFolder` co-condition, and its lock-in test was inverted rather than deleted, so the enabled state is now asserted just as deliberately as the disabled one was.

## Task Commits

Task 1 is `tdd="true"` -- separate RED/GREEN commits:

1. **Task 1 (RED): failing tests for submitItemVariant's family-wide bucket branch** - `a8ac36c` (test) -- 5 of 6 new cases confirmed failing before the implementation existed (the 6th, the ordinary per-person item share, already passed by design -- it exercises no new code and exists as the untouched-control case).
2. **Task 1 (GREEN): findOrCreateFamilyItemBucket + submitItemVariant's family-wide branch** - `9b9a75a` (feat) -- all 47 cases in the file pass; full `web` suite 934/934; `tsc --noEmit` clean.

**Plan metadata:** this SUMMARY's own commit (docs, immediately following).

## Files Created/Modified
- `web/src/components/vault/ShareDialog.tsx` - `withPublishedPublicKey`, `grantCollectionToRecipients`, `FAMILY_ITEM_BUCKET_PLACEHOLDER_NAME`, the two poll-bound constants, `familyItemBucketRow`, `awaitFamilyItemBucketGrant`, `findOrCreateFamilyItemBucket`, `submitItemFamilyWide`; `submitItemVariant`'s new `isFamilyWide` parameter and dispatch; `submitFolderVariant`'s grant loop replaced by the shared helper (behaviour identical, its four existing tests still green); `resolveCurrentFamilyRecipients` extracted from `handleSubmit`; `handleSubmit`'s item+family-wide branch; `familyWideSubmittable` de-gated from `isFolder`; header comment updated to describe the family-wide crypto path.
- `web/src/components/vault/ShareDialog.test.tsx` - New describe block `family-wide item share (FSH-01 submitItemVariant)` (6 cases); 30-08's item-variant disabled-guard test inverted to assert the now-honest enabled state.

## Decisions Made
- **`findOrCreateFamilyItemBucket` returns `{ id, ck }`, not the plan's `Promise<string>`.** The caller must re-encrypt the item under the bucket's Collection Key; an id alone would force the call site to re-list and re-unseal the exact key this function had just resolved, putting a second unseal of the same key in a second place. The caller owns and frees the handle in a `finally`.
- **The `uk` parameter in the plan's signature was dropped.** `ensureOwnIdentityKeypair(uk)` is already awaited by the caller and the resulting identity keypair is all the bucket resolution needs; an unused parameter would have been dead weight in a security-relevant signature.
- **The 409 loser polls rather than re-lists once** (see key-decisions above) -- this is the specific close of the plan-checker's residual warning, and the not-yet-granted case has its own test so the branch cannot pass by mocking only the happy path.
- **`refreshCollectionsNow()` is deliberately NOT called after creating the bucket**, unlike the folder branch. The folder branch needs it so the caller's own CollectionPicker shows the folder they just created; the bucket is never rendered as a folder row (30-UI-SPEC.md) and 30-10's `SharingOverviewPanel` reads `listCollections()` directly, so there is no surface that would show a stale absence. Keeping it out also leaves the poll's `listCollections` call accounting readable.
- **No new i18n string.** The exhausted-poll failure surfaces through the existing `share.createFailed`, which is already exactly a plain retryable message and is honest here because nothing durable landed on that path.

## Deviations from Plan
- **Return type and signature of `findOrCreateFamilyItemBucket`** (`{ id, ck }`, no `uk` parameter) -- rationale above.
- **The 409 branch polls instead of performing a single re-list**, which is what the plan's `<action>` literally specified. This is the plan-checker's own residual warning applied: `collections::list` inner-joins `collection_keys` on the caller, so the loser is not guaranteed to see the winner's bucket on the next request. A behaviour bullet's worth of new coverage (D6) was added for the not-yet-granted case specifically so the recovery path cannot be proven by a happy-path mock.
- **The grant loop was extracted rather than duplicated**, which the plan permitted ("prefer extraction if it costs under ~15 lines of diff"). It touches `submitFolderVariant`, but that function's four existing tests (grant-every-member, keyless omission, `family_wide_kind` omission on the ordinary path, T-25-16 throw) plus CR-01's idempotent-retry tests all stayed green unmodified, which is the regression evidence for that edit.
- **One pre-existing test was intentionally changed**: 30-08's `keeps submit disabled for the ITEM variant while family-wide is selected -- that wiring is 30-11's job`. It asserted a temporary scaffold this plan exists to remove. It was inverted (and its comment explains why) rather than deleted, so the new enabled state is locked in.
- **Verify command**: the plan's `<automated>` block (`npx vitest run … -t "family-wide item"`) genuinely runs something -- it selects 6 tests, 5 of which were red before the implementation. It was run as written with `set -o pipefail`, and additionally the whole file, the whole `web` suite (934/934), and `tsc --noEmit` were run. No vacuous gate was found in this plan.

## Issues Encountered
None. The one surprise was the pre-existing 30-08 guard test that this plan's own success makes false -- handled by inverting it rather than by weakening the implementation.

## Evidence Limits (read before citing these tests as crypto proof)
`ShareDialog.test.tsx` mocks `@/lib/crypto` wholesale. These 6 cases prove the **dispatch, bucket resolution, race recovery, and call sequencing**, not that the crypto composes correctly end to end. The crypto sequence itself is `submitFolderVariant`'s seed-move sequence called verbatim with a different destination key, and that sequence's real-WASM evidence is `ShareDialog.real-wasm.test.ts`. A real-WASM lane exercising the bucket destination specifically, and a live two-account proof that a second member's client decrypts an item shared into the bucket, are NOT provided by this plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- 30-13's lazy-reseal trigger now has a second population to pick up: the keyless member this branch omits from a family-wide item grant, and (rarely) a race loser whose bucket grant did not arrive inside the poll bound and who retried. Both resolve through the same `family-wide-pending` `missing` path, no new machinery needed.
- `resolve_access` and `crates/pv-server/src/routes/membership.rs` were not touched -- the revocation enforcement point is exactly as it was. No Rust file changed in this plan at all; only the two TypeScript files listed above.
- `FamilyTab.tsx` and `AvatarStack.tsx` (Phases 33/34) were not touched.

---
*Phase: 30-the-living-group-family-wide-sharing*
*Completed: 2026-08-10*

## Self-Check: PASSED

All claimed files exist (`ShareDialog.tsx`, `ShareDialog.test.tsx`, this SUMMARY); both task commit hashes (`a8ac36c`, `9b9a75a`) are present in `git log`; `git diff --stat` for those two commits shows exactly the two claimed files.
