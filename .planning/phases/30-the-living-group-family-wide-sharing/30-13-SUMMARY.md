---
phase: 30-the-living-group-family-wide-sharing
plan: 13
subsystem: client-crypto
tags: [families, fsh-02, lazy-reseal, sync-callbacks, zero-knowledge]

# Dependency graph
requires:
  - phase: 30-the-living-group-family-wide-sharing
    provides: "30-04's reshareCollectionToNewMember (unwrap-own-key / reseal-to-one-new-recipient, 409-is-success); 30-06's familyWidePending.ts synchronous snapshot store and sync.ts's onFamilyWidePending pull hook; 30-02's family-wide-pending discovery endpoint and collection_keys ON CONFLICT DO NOTHING idempotency"
provides:
  - "runFamilyWideResealTrigger(uk) -- FSH-02's lazy-reseal trigger: one reseal per resealable (collection_id, recipient_user_id) pair, per-session deduped, per-entry failure-isolated, never scoped to exclude the sharer"
  - "resetFamilyWideResealAttempts() -- the per-unlock reset of the attempted-pair set"
  - "store.ts's onFamilyWidePending wiring -- the trigger now actually fires, on the same syncCallbacks object every other cross-session signal flows through"
affects: ["30-15 (the `missing` half of the same snapshot renders the newcomer's pending row; this plan consumes only `resealable`)", "30-16/30-17 (a live two-account proof of delivery can now be attempted end to end)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Claim-before-await dedup: every fresh pair is added to the module-private attempted-Set SYNCHRONOUSLY, before the first await, so two overlapping runs in one tick (a WS event and a poll tick landing together) cannot double-fire -- the Set is the whole coordination scheme, and it is per-session, reset on unlock"
    - "Per-entry independent settlement: each pair is its own Promise.allSettled entry with its own try/catch, so a transient failure on one pair neither blocks nor aborts another; partial completion self-heals on the NEXT unlock's fresh snapshot against the server's existing ON CONFLICT DO NOTHING"
    - "Read the caller's OWN grant to answer a question the wire shape cannot: ResealableGrant carries ids only, so the access level is read from the resealer's own collection_keys row via getCollection rather than hardcoded -- correct value, no server change, no widened response"

key-files:
  created:
    - web/src/lib/families/resealTrigger.ts
    - web/src/lib/families/resealTrigger.test.ts
  modified:
    - web/src/lib/vault/store.ts
    - web/src/lib/vault/store.test.ts

key-decisions:
  - "The access level is read from the RESEALER's own getCollection(collection_id).access_level, not hardcoded to 'read'. The plan offered hardcoding as the simple option and this as 'preferred if cheap' -- it is cheap: the row is fetched anyway, so a resealer who is not the original sharer grants at the level the family-wide share actually carries for them, with no server change and no widened response shape. 'read' survives only as the fallback for a null access_level, which the wire type permits."
  - "The trigger skips (never calls reshare for) a collection whose own row carries sealed_key === null. The server's resealable query already excludes that case, and reshareCollectionToNewMember would throw on it -- but must_have truth 3 says never ATTEMPT, and the row is already in hand, so the client-side half of the same invariant costs one comparison."
  - "One getCollection per distinct collection per run, memoized in a run-local Map. Several newcomers pending on the same family-wide folder cost one round trip, not N. The memo is run-local, never a cache across runs, so a changed access level is picked up on the next unlock."
  - "The attempted-Set records ATTEMPTS, not successes -- a failed pair is not retried within the same session. That is the plan's literal contract ('never re-run for a pair already attempted this session'), and the retry occasion is the next unlock's reset, which is exactly the cadence 30-DECISION-FSH-02.md's user-visible caveat already promises."
  - "No sharer exclusion exists anywhere in the module -- the trigger has no notion of the caller's own user id at all, so an exclusion is not even representable. This is the decision record's confirmed refinement implemented by construction rather than by a guard."

requirements-completed: [FSH-02]

coverage:
  - id: D1
    description: "Every resealable entry gets exactly one reshareCollectionToNewMember call, with that entry's own collection_id/recipient_user_id and the caller's OWN access level"
    requirement: "FSH-02"
    verification:
      - kind: unit
        ref: "web/src/lib/families/resealTrigger.test.ts#runFamilyWideResealTrigger > calls reshareCollectionToNewMember exactly once per resealable entry, with that entry's own ids and the caller's OWN access level"
        status: pass
      - kind: unit
        ref: "web/src/lib/families/resealTrigger.test.ts#runFamilyWideResealTrigger > falls back to 'read' when the caller's own collection row carries a null access_level"
        status: pass
    human_judgment: false
  - id: D2
    description: "A reseal failure for one pending pair does not block or abort any other pair in the same batch, and the trigger itself still resolves"
    requirement: "FSH-02"
    verification:
      - kind: unit
        ref: "web/src/lib/families/resealTrigger.test.ts#runFamilyWideResealTrigger > one entry's rejection never blocks or aborts another entry's reseal, and the trigger itself still resolves"
        status: pass
    human_judgment: false
  - id: D3
    description: "The same (collection_id, recipient_user_id) pair is never attempted twice within one session, including two overlapping runs in the same tick; other pairs in a repeating snapshot still fire"
    requirement: "FSH-02"
    verification:
      - kind: unit
        ref: "web/src/lib/families/resealTrigger.test.ts#runFamilyWideResealTrigger > never re-attempts the SAME (collection_id, recipient_user_id) pair within one session, even when a second snapshot still reports it"
        status: pass
      - kind: unit
        ref: "web/src/lib/families/resealTrigger.test.ts#runFamilyWideResealTrigger > still attempts the OTHER pairs in a second snapshot that also repeats an already-attempted one"
        status: pass
      - kind: unit
        ref: "web/src/lib/families/resealTrigger.test.ts#runFamilyWideResealTrigger > marks a pair attempted BEFORE awaiting, so two overlapping runs in the same tick cannot double-fire"
        status: pass
    human_judgment: false
  - id: D4
    description: "A pair left undone by a failed run is re-armed for the next session -- the reset genuinely re-attempts it (edge-probe: partial completion self-heals on the next unlock's fresh snapshot)"
    requirement: "FSH-02"
    verification:
      - kind: unit
        ref: "web/src/lib/families/resealTrigger.test.ts#runFamilyWideResealTrigger > resetFamilyWideResealAttempts() re-arms a pair for a fresh session (the next unlock re-attempts what a failed run left undone)"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#30-13 (FSH-02): onFamilyWidePending wiring + per-unlock attempt reset > every unlock transition clears the trigger's per-session attempted-pair set"
        status: pass
    human_judgment: false
  - id: D5
    description: "The trigger acts only on keys the CURRENT session already holds -- a collection whose own row has sealed_key === null is never resealed (that is the missing side, 30-15's job)"
    requirement: "FSH-02"
    verification:
      - kind: unit
        ref: "web/src/lib/families/resealTrigger.test.ts#runFamilyWideResealTrigger > never reseals a collection the CURRENT session itself lacks a sealed_key for (that is the missing side, not this trigger's job)"
        status: pass
    human_judgment: false
  - id: D6
    description: "T-30-21: nothing pending means zero extra work on unlock -- not even a getCollection round trip; and the trigger never calls the discovery endpoint itself (one query, two consumers)"
    requirement: "FSH-02"
    verification:
      - kind: unit
        ref: "web/src/lib/families/resealTrigger.test.ts#runFamilyWideResealTrigger > does zero work -- not even a getCollection round trip -- when nothing is resealable (T-30-21)"
        status: pass
      - kind: unit
        ref: "web/src/lib/families/resealTrigger.test.ts#runFamilyWideResealTrigger > reads the synchronous snapshot only -- it never calls the discovery endpoint itself (one query, two consumers)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Something actually REACHES the trigger: onFamilyWidePending is on the same syncCallbacks object as onSharedRevisions/onRemovedFromFamily, runs the trigger with the current unlocked key, and is skipped while locked"
    requirement: "FSH-02"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#30-13 (FSH-02): onFamilyWidePending wiring + per-unlock attempt reset > the unlock branch wires an onFamilyWidePending callback into the SAME syncCallbacks object onSharedRevisions/onRemovedFromFamily live in"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#30-13 (FSH-02): onFamilyWidePending wiring + per-unlock attempt reset > invoking onFamilyWidePending while unlocked runs the reseal trigger with the CURRENT unlocked User Key"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#30-13 (FSH-02): onFamilyWidePending wiring + per-unlock attempt reset > invoking onFamilyWidePending while LOCKED (no User Key) never runs the trigger"
        status: pass
    human_judgment: false
  - id: D8
    description: "The trigger set includes the sharer -- no exclusion of 'the member who created the share' exists anywhere in the module"
    requirement: "FSH-02"
    verification:
      - kind: other
        ref: "web/src/lib/families/resealTrigger.ts -- the module takes no caller-identity input at all (no own-user-id read, no roster comparison); every entry of the server's `resealable` list is acted on identically, so an exclusion is not representable. D1's test asserts both entries of a two-entry snapshot fire."
        status: pass
    human_judgment: false

duration: ~25min
completed: 2026-08-10
status: complete
---

# Phase 30 Plan 13: FSH-02's Lazy-Reseal Trigger Summary

**The fallback half of FSH-02 now actually fires: on every pull cycle of ANY current keyholder -- the sharer's own session included -- each resealable (collection, newcomer) pair the session can act on is resealed exactly once, with one pair's failure isolated from every other pair's.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-08-10
- **Tasks:** 2 (Task 1 `tdd="true"` -- separate RED/GREEN commits)
- **Files created:** 2; **modified:** 2

## Accomplishments

- `runFamilyWideResealTrigger(uk)` reads `familyWidePending.ts`'s **synchronous** snapshot -- it never calls `getFamilyWidePending()` itself, so `sync.ts::pullOnce` remains the single fetch per pull cycle and 30-15's pending-row UI reads the `missing` half of the same result.
- **No sharer exclusion, by construction.** The module has no notion of the caller's own user id: every entry of the server's `resealable` list is treated identically. 30-DECISION-FSH-02.md's one refinement over the starting hypothesis is therefore implemented as an absence, not as a guard that could later drift.
- **Claim-before-await dedup.** Each fresh `"${collectionId}:${recipientUserId}"` key is added to a module-private `Set` synchronously, before any await, so a WS event and a poll tick landing in the same tick cannot double-fire. `resetFamilyWideResealAttempts()` clears it, and `store.ts`'s unlock branch calls it alongside the existing per-unlock latch resets.
- **Per-entry independent settlement.** Every pair is its own `Promise.allSettled` entry with its own `try/catch`; a rejected pair is logged and left for the next unlock. Contention between two simultaneously-online resealers rides entirely on the server's existing `INSERT ... ON CONFLICT DO NOTHING` against `collection_keys`' composite PK (and 30-04's structural-409-is-success rule) -- **no coordination scheme was invented here**.
- **Correct access level without a server change.** `ResealableGrant` carries ids only, so the level comes from the resealer's own `getCollection(collection_id).access_level` (memoized once per collection per run), with `"read"` only as the fallback for a null value.
- **The capability is reached.** `onFamilyWidePending` joins `onSharedRevisions`/`onRemovedFromFamily` on the one `syncCallbacks` object, fire-and-forget (never awaited by `pullOnce`), skipped outright while locked. Four store tests assert the wiring; deleting either the null-key guard or the reset makes one of them fail (both falsified, below).

## Task Commits

1. **Task 1 (RED): failing test for `runFamilyWideResealTrigger`** - `afebbf6` (test) -- 10 cases, all failing (the module did not exist).
2. **Task 1 (GREEN): `runFamilyWideResealTrigger` + `resetFamilyWideResealAttempts`** - `4073b7d` (feat) -- 10/10 pass.
3. **Task 2: wire `onFamilyWidePending` into `store.ts`'s `syncCallbacks`** - `86afc69` (feat) -- 4 new store tests; full `store.test.ts` 65/65.

**Plan metadata:** this SUMMARY's own commit (docs, immediately following).

## Files Created/Modified

- `web/src/lib/families/resealTrigger.ts` (new) - `FALLBACK_ACCESS_LEVEL`, the module-private `attemptedPairs` Set, `attemptKey`, `resetFamilyWideResealAttempts`, `runFamilyWideResealTrigger` (snapshot read → synchronous claim loop → run-local `getCollection` memo → `Promise.allSettled` of independently-caught per-pair attempts).
- `web/src/lib/families/resealTrigger.test.ts` (new) - 10 cases; `./reseal`, `@/lib/vault/api` and `./familyWidePending` mocked; the crypto composition itself is deliberately out of scope (see Evidence Limits).
- `web/src/lib/vault/store.ts` - new import of the trigger; `onFamilyWidePending` added to `syncCallbacks`; `resetFamilyWideResealAttempts()` added to the `subscribeLockState` unlock branch.
- `web/src/lib/vault/store.test.ts` - `@/lib/families/resealTrigger` mocked wholesale; new describe block with 4 wiring cases.

## Decisions Made

See `key-decisions` in the frontmatter. The load-bearing three: the access level is read from the resealer's own grant rather than hardcoded; the attempted-Set records attempts (not successes), with the next unlock as the retry occasion; and the sharer is included by having no identity input at all.

## Deviations from Plan

- **Task 2's verify command was VACUOUS and was substituted.** The plan specified `npx vitest run src/lib/vault/store.test.ts -t "familyWide"`. Vitest's `-t` is case-sensitive; the new tests read `onFamilyWidePending`, so that filter selected **0 tests and exited 0** (`Test Files 1 skipped (1) / Tests 65 skipped (65)`) -- success by finding nothing. Substituted `-t "onFamilyWidePending"` (selects 4, all pass), plus the whole file (65/65), plus `src/lib/vault/store.test.ts src/lib/families/resealTrigger.test.ts` together (75/75), plus the full `web` suite (948/948) and `tsc --noEmit`. Task 1's verify command was NOT vacuous -- it selected 10 tests, all red before the implementation existed.
- **Access level resolved from the caller's own row** rather than hardcoded `"read"` -- the plan's own explicitly-preferred option, taken.
- **A `sealed_key === null` skip was added inside the trigger** (not in the plan's action text). `reshareCollectionToNewMember` would throw on that case anyway, but must_have truth 3 says the trigger must never *attempt* it, and the row is already in hand for its access level.
- **`getCollection` is memoized per collection per run** (not in the plan's action text) so N newcomers pending on one family-wide folder cost one round trip, not N. Run-local only -- never a cross-run cache.
- **No `eslint` run**: `web/` has no ESLint config (`npx eslint` errors with the v9 migration notice) and `package.json` exposes no lint script. `tsc --noEmit` and the full vitest suite were used instead.

## Falsification Performed

Each guard was deliberately broken and the suite re-run, to prove the tests are not decorative:

| Guard removed | Result |
|---|---|
| `attemptedPairs.has(key) → continue` (dedup) | 3 tests fail (the two dedup cases + the same-tick case) |
| `sealed_key === null` skip (replaced with `if (false)`) | 1 test fails (D5) |
| `store.ts`'s `uk !== null` guard | 1 test fails (the locked-session case) |
| `store.ts`'s `resetFamilyWideResealAttempts()` call | 1 test fails (the per-unlock reset case) |

All four were restored and the full suite re-run green before committing.

## Issues Encountered

Only the vacuous verify filter described above. It was caught because the run reported `65 skipped`, not because the plan flagged it -- worth repeating that a green `-t` run with a skipped count equal to the file's total is a failing gate, not a passing one.

## Evidence Limits (read before citing these tests as crypto proof)

`resealTrigger.test.ts` mocks `./reseal` **wholesale**. These 10 cases prove the trigger's *scheduling, dedup, failure isolation, access-level resolution and short-circuit* -- they prove **nothing** about whether the resealed key decrypts on the recipient's side. That claim belongs to 30-04's `reseal.real-wasm.test.ts` and to the server-side integration proof already recorded in this phase. `store.test.ts` likewise mocks `@/lib/crypto` and now `@/lib/families/resealTrigger`; its 4 cases prove the wiring, not the trigger's behavior. **A live two-account proof that a newcomer's client actually decrypts a family-wide collection delivered by this trigger is NOT provided by this plan** -- no test here observes a recipient-side decryption.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 30-15 can render the newcomer's pending row from the `missing` half of the very same snapshot this trigger reads; nothing about that half was consumed or mutated here.
- `resolve_access` and `crates/pv-server/src/routes/membership.rs` were **not touched** -- no Rust file changed in this plan at all. The revocation enforcement point is byte-identical.
- `FamilyTab.tsx` (Phase 33) and `AvatarStack.tsx` (Phase 34) were not touched.
- No new user-facing string was added, so no PL/EN i18n obligation arises from this plan; the timing caveat this trigger fulfils (`share.familyWideTimingCaveat`) already shipped in 30-08.

---
*Phase: 30-the-living-group-family-wide-sharing*
*Completed: 2026-08-10*

## Self-Check: PASSED

All claimed files exist (`resealTrigger.ts`, `resealTrigger.test.ts`, `store.ts`, `store.test.ts`, this SUMMARY); all three task commit hashes (`afebbf6`, `4073b7d`, `86afc69`) are present in `git log`; `git diff --stat` for those commits shows exactly the four claimed files and no others.
