---
phase: 30-the-living-group-family-wide-sharing
plan: 07
subsystem: crypto
tags: [typescript, wasm, webauthn, zero-knowledge, invitations, family-sharing]

# Dependency graph
requires:
  - phase: 30-the-living-group-family-wide-sharing (30-02)
    provides: "CollectionRow.family_wide_kind / listCollections() already exposing it"
  - phase: 30-the-living-group-family-wide-sharing (30-03)
    provides: "CreateInvitationRequest.family_wide_keys / InvitationPublicResponse.family_wide_keys / AcceptInvitationRequest.family_wide_sealed_keys -- the server-side wire contract this plan's client threads into"
  - phase: 30-the-living-group-family-wide-sharing (30-09)
    provides: "collections.family_wide_kind server-side plumbing this plan's filter relies on"
provides:
  - "generateInviteLink folds every family-wide collection the caller currently holds a key for into createInvite's additive family_wide_keys array"
  - "redeemInviteFlow self-seals every metadata.family_wide_keys entry to the invitee's own freshly-published identity key and submits family_wide_sealed_keys alongside the existing sealed_for_self in one accept() call"
  - "FamilyWideKeyEntry / FamilyWideSealedKeyEntry TS types in lib/invite/api.ts, field-for-field identical to invitations.rs's Rust structs"
affects: ["30-08", "30-10", "30-11", "30-14 (adversarial wire-inspection test)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Invite-time-wrap fast path (30-DECISION-FSH-02.md): fold N additive family-wide wraps into the SAME createInvite/redeemInvite calls the existing single-collection-scope flow already makes -- never a new server round trip, never mutually exclusive with the existing singular fields"
    - "InvitePublicMetadata.family_wide_keys is optional (not just nullable), mirroring vault/api.ts's CollectionRow.family_wide_kind convention -- a response predating this field, or an existing test fixture, omits the key and still type-checks; every reader treats absence exactly like []"

key-files:
  created: []
  modified:
    - web/src/lib/invite/crypto.ts
    - web/src/lib/invite/api.ts
    - web/src/lib/invite/crypto.test.ts

key-decisions:
  - "InvitePublicMetadata.family_wide_keys made optional (?), not required, on the TS response type -- a required field broke InviteLandingView.test.tsx's pre-existing fixture literals at compile time (out of this plan's files_modified scope); optional-with-absent-means-[] matches the codebase's own established CollectionRow.family_wide_kind precedent and fixes the compile error without touching that file."
  - "createInvite's family_wide_keys and redeemInvite's family_wide_sealed_keys request params kept REQUIRED (non-optional) on the TS type, unlike the response-side field -- crypto.ts is the sole caller of both and always constructs a real array (possibly empty), so there is no fixture-literal breakage to accommodate on the request side."
  - "Both tasks executed as genuine RED/GREEN TDD pairs, not a single combined commit: for each task, the implementation was temporarily reverted to reproduce the failing state, tests were run to confirm the exact 3 new assertions fail (not a vacuous 0-tests pass), then the implementation was reapplied and reverified GREEN before committing."

requirements-completed: [FSH-02]

coverage:
  - id: D1
    description: "generateInviteLink lists the caller's own collections via listCollections(), filters to family_wide_kind !== null, and folds a wrapped key for each into createInvite's additive family_wide_keys array -- additive to, never exclusive with, whatever single explicit collection scope the invite already carries. access_level is the collection's own caller-held level, never hardcoded."
    requirement: "FSH-02"
    verification:
      - kind: unit
        ref: "web/src/lib/invite/crypto.test.ts#family-only invite folds in every current family-wide collection's key, additively (30-07)"
        status: pass
      - kind: unit
        ref: "web/src/lib/invite/crypto.test.ts#zero family-wide collections: family_wide_keys is [] -- byte-identical to pre-30-07 behavior (30-07)"
        status: pass
      - kind: unit
        ref: "web/src/lib/invite/crypto.test.ts#collection-scoped invite ALSO folds in family-wide keys when the caller holds them -- additive, never mutually exclusive (30-07)"
        status: pass
    human_judgment: false
  - id: D2
    description: "redeemInviteFlow unwraps and self-seals every metadata.family_wide_keys entry to the invitee's own freshly-published identity key, and submits family_wide_sealed_keys alongside the existing sealed_for_self in the SAME accept() call. Every intermediate handle from the loop is freed in the same outer finally block as the rest of the function -- no leaks."
    requirement: "FSH-02"
    verification:
      - kind: unit
        ref: "web/src/lib/invite/crypto.test.ts#self-seals every family-wide key the invite's metadata carried, submitted alongside the existing single-collection grant"
        status: pass
      - kind: unit
        ref: "web/src/lib/invite/crypto.test.ts#zero family-wide keys: family_wide_sealed_keys is [] -- existing sealed_for_self/network call unchanged"
        status: pass
      - kind: unit
        ref: "web/src/lib/invite/crypto.test.ts#every intermediate handle from the family-wide loop is freed in the same finally block -- no leaks"
        status: pass
    human_judgment: false
  - id: D3
    description: "Zero regression to the existing single-collection-scope and family-only invite flows -- pre-existing crypto.test.ts cases, InviteLandingView.test.tsx (16 tests), and the full 894-test web suite all pass unmodified in intent."
    requirement: "FSH-02"
    verification:
      - kind: unit
        ref: "web/src/lib/invite/crypto.test.ts (11 tests total, full file)"
        status: pass
      - kind: unit
        ref: "web/src/lib/invite/crypto.real-wasm.test.ts (2 tests, unmodified)"
        status: pass
      - kind: unit
        ref: "web/src/components/invite/InviteLandingView.test.tsx (16 tests, unmodified)"
        status: pass
      - kind: unit
        ref: "full web vitest suite (npx vitest run, 91 files / 894 tests)"
        status: pass
    human_judgment: false

duration: ~20min (coding + RED/GREEN reconstruction + test verification; excludes context-gathering)
completed: 2026-08-10
status: complete
---

# Phase 30 Plan 07: Invite-Time-Wrap Client Threading for Family-Wide Keys Summary

**generateInviteLink/redeemInviteFlow now fold N family-wide collection keys into the existing invite generation/redemption flow, additively -- the client half of FSH-02's invite-time-wrap fast path, wired into 30-03's server contract.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-10T14:06:26+02:00
- **Tasks:** 2 (each executed as a genuine RED then GREEN TDD pair)
- **Files modified:** 3 (`web/src/lib/invite/crypto.ts`, `web/src/lib/invite/api.ts`, `web/src/lib/invite/crypto.test.ts`)

## Accomplishments
- `generateInviteLink` now calls `listCollections()`, filters to `family_wide_kind !== null` entries the caller holds a `sealed_key`/`access_level` for, unseals and re-wraps each Collection Key under the SAME invite `channel` the existing single-collection branch already uses, and threads the resulting `family_wide_keys` array into `createInvite` -- additive to, never exclusive with, an explicit `scope.kind === "collection"` wrap in the same call.
- `redeemInviteFlow` loops `metadata.family_wide_keys ?? []`, unwraps each via the redemption channel, self-seals to the invitee's OWN freshly-published identity public key (never the inviter's), and submits `family_wide_sealed_keys` alongside the existing `sealed_for_self` in the SAME `accept()` call -- both derived from the SAME `inviteProof`, never re-derived.
- Every intermediate `WasmCollectionKey`/`WasmIdentityPublicKey` handle the new family-wide loops create is freed in the SAME outer `finally` block as every pre-existing handle in each function -- no leaked handle across either the family-wide path or the pre-existing single-collection path.
- `lib/invite/api.ts` widened additively: new `FamilyWideKeyEntry`/`FamilyWideSealedKeyEntry` TS types (field-for-field identical to `invitations.rs`'s Rust structs), `createInvite`'s `family_wide_keys` param, `InvitePublicMetadata.family_wide_keys` (optional response field, absence treated exactly like `[]`), `redeemInvite`'s `family_wide_sealed_keys` param.
- T-24-12 (capture-before-zeroize) and T-24-13 (fragment-vs-path `invite_id` self-consistency check before any network call) are both structurally untouched -- neither function's existing pre-network-call guard or secret-capture ordering was touched by this plan; the new family-wide loops run entirely AFTER those checks, inside the same `try` blocks.
- `resolve_access`/`Collection::resolve_access`/`Item::resolve_access` (`membership.rs`) were not touched (confirmed: `git diff --stat 8d38d51 HEAD -- crates/pv-server/src/routes/membership.rs` is empty).

## Task Commits

Each task executed as a genuine TDD RED/GREEN pair (implementation was temporarily reverted to confirm real failures before reapplying, not a post-hoc split):

1. **Task 1 (RED): failing tests for generateInviteLink's family-wide key folding** - `18066b2` (test) -- 3 new cases confirmed to fail against the pre-plan `generateInviteLink` (5 pre-existing tests stayed green).
2. **Task 1 (GREEN): generateInviteLink folds in family-wide keys** - `e9ff3f7` (feat) -- all 8 tests pass.
3. **Task 2 (RED): failing tests for redeemInviteFlow's family-wide self-seal** - `86f8a9c` (test) -- 3 new cases confirmed to fail against the pre-plan `redeemInviteFlow` (8 pre-existing/Task-1 tests stayed green).
4. **Task 2 (GREEN): redeemInviteFlow self-seals family-wide keys** - `0f6332e` (feat) -- all 11 tests pass.

**Plan metadata:** this SUMMARY's own commit (docs, immediately following).

## Files Created/Modified
- `web/src/lib/invite/crypto.ts` - `generateInviteLink`'s family-wide fold-in loop (before the existing `scope.kind === "collection"` branch); `redeemInviteFlow`'s family-wide self-seal loop (after the existing single-collection branch); both loops' handle arrays freed in each function's existing outer `finally` block.
- `web/src/lib/invite/api.ts` - `FamilyWideKeyEntry`/`FamilyWideSealedKeyEntry` types; `createInvite`'s `family_wide_keys` request param; `InvitePublicMetadata.family_wide_keys` (optional) response field; `redeemInvite`'s `family_wide_sealed_keys` request param.
- `web/src/lib/invite/crypto.test.ts` - `mockListCollections` added to the existing `@/lib/vault/api` mock (defaulting to `[]` in `beforeEach`, so every pre-existing test stays byte-identical); `freeCounts` free-handle counters wired into `FakeCollectionKey`/the `WasmIdentityPublicKey` mock; 6 new test cases (3 per task) covering every behavior bullet in both tasks.

## Decisions Made
- **`InvitePublicMetadata.family_wide_keys` made optional, not required.** A required field broke `InviteLandingView.test.tsx`'s pre-existing fixture literals at TS compile time (`tsc --noEmit` surfaced 4 errors) -- that file is outside this plan's `files_modified`. Made the field `family_wide_keys?: FamilyWideKeyEntry[]`, mirroring `vault/api.ts`'s own documented `CollectionRow.family_wide_kind` convention ("optional, not just nullable... treat a missing key exactly like `null`, never a required-field throw"). `redeemInviteFlow` reads it as `metadata.family_wide_keys ?? []`. Fixed the compile error without touching the out-of-scope test file; `tsc --noEmit` and the full 894-test suite both confirmed clean afterward.
- **`createInvite`'s and `redeemInvite`'s new array params kept required (non-optional).** Unlike the response-side field, these are request-construction params with exactly one caller (`crypto.ts`), which always builds a real array. No fixture-literal breakage to accommodate, so no reason to weaken the type.
- **Genuine RED/GREEN split per task**, not a single combined commit. Both tasks are `tdd="true"`. For each, the already-working implementation was temporarily reverted (via saved pre-task snapshots), the new tests were run and confirmed to fail with the EXACT assertions the behavior bullets require (not a vacuous "file not found" or "0 tests" false pass), then the implementation was reapplied and reverified GREEN before committing. This avoided the class of vacuous-verify-command failure this phase's `<verify_command_warning>` calls out.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `InvitePublicMetadata.family_wide_keys` made optional to avoid breaking an out-of-scope test file**
- **Found during:** Task 1, first `tsc --noEmit` after widening the type as a required field per the plan's literal action text
- **Issue:** `web/src/components/invite/InviteLandingView.test.tsx` (not in this plan's `files_modified`) constructs `InvitePublicMetadata` fixture object literals in 4 places without a `family_wide_keys` key. A required field made every one of those a TS2741/TS2345 compile error.
- **Fix:** Changed the field to optional (`family_wide_keys?: FamilyWideKeyEntry[]`), matching the codebase's own established `CollectionRow.family_wide_kind` optional-field convention (documented in `vault/api.ts`) rather than editing the out-of-scope test file. `redeemInviteFlow` treats absence identically to `[]` via `?? []`.
- **Files modified:** `web/src/lib/invite/api.ts` (the response-side type only; `createInvite`/`redeemInvite`'s request-side array params stayed required, since `crypto.ts` is their only caller and always supplies a real array)
- **Verification:** `npx tsc --noEmit -p .` clean; `InviteLandingView.test.tsx`'s 16 tests pass unmodified
- **Committed in:** `e9ff3f7` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (blocking, type-shape adjustment to avoid an out-of-scope compile break)
**Impact on plan:** Necessary for the plan's own stated file scope (`web/src/lib/invite/crypto.ts`, `web/src/lib/invite/api.ts`) to hold without collateral damage to an unrelated component test. Matches an existing codebase convention rather than inventing a new one. No weakening of any threat-register mitigation (T-30-14's opacity guarantee is unaffected -- the field's PRESENCE is optional, its CONTENTS when present are unchanged).

## Issues Encountered
None beyond the deviation documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `generateInviteLink`/`redeemInviteFlow` now consume the full invite-carried half of FSH-02's hybrid mechanism (30-DECISION-FSH-02.md) end-to-end on the client, atop 30-03's server-side wire contract -- an invite generated while family-wide collections exist now delivers them immediately on redemption, per `30-UI-SPEC.md`'s `share.familyWideTimingCaveat` copy's "if you join through a fresh invite" case.
- The lazy-reseal fallback (`reshareCollectionToNewMember`, 30-04) and its trigger wiring (30-12, a later plan) remain the mechanism's second, required-not-optional half for the gap-window case this plan does not and cannot cover (an invite generated BEFORE the family-wide share existed).
- 30-14's planned adversarial wire-inspection test can build directly on this plan's shipped shape: `family_wide_keys[].wrapped_collection_key` and `family_wide_sealed_keys[].sealed_for_self` are the SAME opaque `WrappedKey`-shaped blobs the pre-existing singular fields already carry -- no new plaintext-adjacent surface for that test to find.
- `resolve_access`/`membership.rs` untouched, confirmed via `git diff --stat` against this plan's base commit.
- No blockers for downstream plans in this phase.

---
*Phase: 30-the-living-group-family-wide-sharing*
*Completed: 2026-08-10*

## Self-Check: PASSED
