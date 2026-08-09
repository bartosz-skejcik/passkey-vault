---
phase: 25-member-removal-suspension-re-key
plan: 07
subsystem: api
tags: [typescript, wasm, crypto, next.js, api-client, i18n]

# Dependency graph
requires:
  - phase: 25-member-removal-suspension-re-key
    plan: "25-02"
    provides: "rewrap_item_key_for_collection (pv-core) + rewrapItemKeyForCollection wasm binding"
  - phase: 25-member-removal-suspension-re-key
    plan: "25-03"
    provides: "DELETE /api/families/members/{user_id} + GET /api/vault/collections/{id}/items server-side wire contract"
provides:
  - "families/api.ts: suspendMember/reinstateMember/removeMember/getMemberAccess/getFamily + FamilyMemberRecord.status + NewSealedKeyEntry/ItemRewrapEntry/CollectionRekeyBatch/MemberAccessResponse wire types"
  - "vault/api.ts: getCollectionItems/getCollectionAccessList + CollectionItemRow/CollectionAccessEntry"
  - "crypto/index.ts: rewrapItemKeyForCollection re-export, plus encryptItemForCollection/decryptItemForCollection re-exports (pre-existing pv-wasm gap closed)"
  - "families/rekey.ts: buildMemberRemovalBatch(targetUserId, ownUk) + removeFamilyMember(targetUserId, ownUk) — the ONE shared batch-building orchestration module"
  - "families/rekey.real-wasm.test.ts: genuine no-mock real-WASM regression proof"
  - "every Phase 25 i18n key in dictionary.ts (45 keys, PL+EN verbatim from 25-UI-SPEC.md)"
affects: [25-08-remove-member-ui, 25-09-delete-account-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "buildMemberRemovalBatch: one shared batch-BUILDING function reused by two different SUBMIT call sites (removeFamilyMember for target=other, DeleteAccountDialog calling buildMemberRemovalBatch directly for target=self) — per the orchestrator's resolved decision, never two parallel re-key implementations"
    - "try/finally WASM handle discipline extended to per-collection, per-recipient granularity: every WasmCollectionKey (old/new) and every WasmIdentityPublicKey allocated inside buildMemberRemovalBatch's per-collection loop is freed in that iteration's own finally block, not deferred to the outer function's finally"

key-files:
  created:
    - web/src/lib/families/rekey.ts
    - web/src/lib/families/rekey.real-wasm.test.ts
  modified:
    - web/src/lib/families/api.ts
    - web/src/lib/vault/api.ts
    - web/src/lib/crypto/index.ts
    - web/src/lib/i18n/dictionary.ts

key-decisions:
  - "Rule 2 auto-fix: crypto/index.ts also re-exports encryptItemForCollection/decryptItemForCollection, which have existed in pv-wasm since Plan 21-05 but were never wired through this sole choke-point importer. Without them, rekey.real-wasm.test.ts (this plan's own non-optional evidence) had no way to build a real collection-item fixture to rewrap — the plan's Task 1 action text named only ONE new export (rewrapItemKeyForCollection), but the pre-existing gap blocked Task 3's stated behavior outright."
  - "rewrapItemKeyForCollection's old_enc_key_json parameter is fed the split-out enc_key JSON string directly (CollectionItemRow.enc_key / rewrap.real-wasm.test.ts's splitEncryptedItem helper) — never the combined {enc_key, enc_data} blob encryptItemForCollection produces — matching the wasm binding's own WrappedKey-only parse and the server's own split-column storage convention (lib/vault/store.ts's recombineEncryptedItem/splitCombinedEncryptedItem precedent)."
  - "buildMemberRemovalBatch throws (via a defensive check on collectionRecord.sealed_key === null) if the caller's own sealed_key for a target's collection is missing, mirroring the same fail-loud-never-silently-proceed posture the plan mandates for a keyless remaining recipient — not explicitly named in the plan's action text but required by the same T-25-16 philosophy."

patterns-established:
  - "Two-tier try/finally WASM handle cleanup: an outer finally frees the identity keypair handle across the whole batch-building call, while each per-collection loop iteration owns its own finally block freeing that iteration's old/new CollectionKey and every per-recipient public-key handle — prevents a mid-loop throw (e.g. T-25-16's keyless-recipient guard) from leaking earlier iterations' already-allocated handles."

requirements-completed: [KEY-02, UX-04]

coverage:
  - id: D1
    description: "families/api.ts gains FamilyMemberRecord.status plus suspendMember/reinstateMember/removeMember/getMemberAccess/getFamily client functions matching families.rs's exact routes and wire shapes"
    requirement: "KEY-02"
    verification:
      - kind: unit
        ref: "cd web && npx tsc --noEmit (zero errors)"
        status: pass
    human_judgment: false
  - id: D2
    description: "vault/api.ts gains getCollectionItems(collectionId)/getCollectionAccessList(collectionId), matching collections.rs's collection_items/access_list endpoints exactly"
    requirement: "KEY-02"
    verification:
      - kind: unit
        ref: "cd web && npx tsc --noEmit (zero errors)"
        status: pass
    human_judgment: false
  - id: D3
    description: "crypto/index.ts re-exports rewrapItemKeyForCollection as the sole choke-point importer of ./wasm/pv_wasm.js"
    requirement: "KEY-02"
    verification:
      - kind: unit
        ref: "grep -c \"rewrapItemKeyForCollection\" web/src/lib/crypto/index.ts == 2"
        status: pass
    human_judgment: false
  - id: D4
    description: "buildMemberRemovalBatch(targetUserId, ownIdentityKey) produces a wire-shaped batch by fetching the target's real per-collection access breakdown, unsealing each reachable collection's OLD CollectionKey, generating a fresh one, sealing it to every REMAINING recipient's real published public key, and rewrapping every real item's enc_key"
    requirement: "KEY-02"
    verification:
      - kind: unit
        ref: "cd web && npx tsc --noEmit -- exported signature is exactly (targetUserId: string, ownUk: WasmUserKey) => Promise<CollectionRekeyBatch[]>"
        status: pass
      - kind: integration
        ref: "src/lib/families/rekey.real-wasm.test.ts -- rewrapItemKeyForCollection round-trips under the new key and is rejected under the old key"
        status: pass
    human_judgment: false
  - id: D5
    description: "buildMemberRemovalBatch throws a descriptive error rather than silently omitting a remaining recipient who has no published public key (T-25-16)"
    requirement: "KEY-02"
    verification: []
    human_judgment: true
    rationale: "The throw path is implemented per the plan's exact specification (source-verified in rekey.ts), but no automated test in this plan exercises the missing-public-key branch itself -- Plan 25-08's RemoveMemberDialog UAT is the first live call site that can reach this path with real fixture data."
  - id: D6
    description: "The SAME buildMemberRemovalBatch function is usable by both the remove-member flow (target = someone else) and the self-deleting-member flow (target = caller's own user_id) -- one client orchestration module, not two parallel implementations"
    requirement: "KEY-02"
    verification:
      - kind: unit
        ref: "web/src/lib/families/rekey.ts -- single exported buildMemberRemovalBatch with no target-identity branching in its own signature or body"
        status: pass
    human_judgment: false
  - id: D7
    description: "rekey.real-wasm.test.ts proves rewrapItemKeyForCollection's real, no-mock output round-trips through decryptItemForCollection under the new key and is rejected under the old key -- mirroring invite/crypto.real-wasm.test.ts's structural pattern, never a mocked @/lib/crypto assertion"
    requirement: "UX-04"
    verification:
      - kind: integration
        ref: "cd web && npx vitest run src/lib/families/rekey.real-wasm.test.ts (2/2 pass)"
        status: pass
      - kind: unit
        ref: "grep -c \"vi.mock\" web/src/lib/families/rekey.real-wasm.test.ts == 0"
        status: pass
    human_judgment: false
  - id: D8
    description: "Every Phase 25 i18n key from 25-UI-SPEC.md's Copywriting Contract added to dictionary.ts verbatim, so no later plan touches this file"
    verification:
      - kind: unit
        ref: "grep -c \"member.removeHonestyWarning\\|account.deleteOwnerWarning\\|access.hiddenPassword\" web/src/lib/i18n/dictionary.ts == 3"
        status: pass
      - kind: unit
        ref: "cd web && npx tsc --noEmit (zero errors, satisfies Record<string,{pl,en}> type check)"
        status: pass
    human_judgment: false

# Metrics
duration: ~15min active work (plus one-time worktree bootstrap: cargo/wasm-bindgen build + npm ci for web and packages/pv-ui, not part of plan execution)
completed: 2026-08-05
status: complete
---

# Phase 25 Plan 07: Client-Side Re-Key Orchestration Summary

**`families/rekey.ts`'s `buildMemberRemovalBatch` builds a real, wire-shaped member-removal re-key batch from live server data and real WASM calls (rewrapped item keys, freshly-sealed Collection Keys) — plus the API client surface it depends on and a genuine no-mock real-WASM regression test proving the rewrap primitive.**

## Performance

- **Duration:** ~15 min active work (task execution) — plus a one-time worktree bootstrap (cargo build -p pv-wasm + wasm-bindgen, npm ci for web/ and packages/pv-ui) required because this parallel-executor worktree had no pre-built WASM artifacts or node_modules
- **Tasks:** 3/3 completed
- **Files modified:** 6 (2 new, 4 extended)

## Accomplishments

- `families/api.ts` gains `FamilyMemberRecord.status`, `suspendMember`/`reinstateMember`/`removeMember`/`getMemberAccess`/`getFamily`, and the `NewSealedKeyEntry`/`ItemRewrapEntry`/`CollectionRekeyBatch`/`MemberAccessResponse` wire types matching `families.rs`'s routes exactly.
- `vault/api.ts` gains `getCollectionItems`/`getCollectionAccessList` + `CollectionItemRow`/`CollectionAccessEntry`, matching `collections.rs`'s `collection_items`/`access_list` endpoints.
- `crypto/index.ts` gains `rewrapItemKeyForCollection` (this plan's own new export) plus `encryptItemForCollection`/`decryptItemForCollection` (Rule 2 auto-fix — a pre-existing pv-wasm-to-web gap from Plan 21-05, closed because Task 3's real-WASM test structurally could not be written without it).
- `families/rekey.ts` (new): `buildMemberRemovalBatch(targetUserId, ownUk)` constructs a real `CollectionRekeyBatch[]` — for every collection the target could reach, unseals the OLD Collection Key, generates a fresh one, seals it to every remaining recipient's real published public key (throwing on any recipient with no published key, T-25-16), and rewraps every real item's `enc_key`. `removeFamilyMember` wraps it with the actual `removeMember` submit call.
- `families/rekey.real-wasm.test.ts` (new): a genuine no-mock real-WASM regression test proving `rewrapItemKeyForCollection`'s real output decrypts under the new key with the original `enc_data` and is rejected under the old key, and that `sealCollectionKey`/`unsealCollectionKey` round-trip a real Collection Key through a real identity keypair.
- `dictionary.ts` gains all 45 Phase 25 i18n keys verbatim from `25-UI-SPEC.md`'s Copywriting Contract, including the two hard, non-negotiable honesty strings (`member.removeHonestyWarning`, `account.deleteOwnerWarning`).

## Task Commits

Each task was committed atomically:

1. **Task 1: API client additions + full Phase 25 i18n dictionary pass** - `442d67e` (feat)
2. **Task 2: families/rekey.ts — batch-building orchestration** - `6319e00` (feat)
3. **Task 3: rekey.real-wasm.test.ts — no-mock structural regression** - `882007a` (test)

**Plan metadata:** SUMMARY.md commit (this file) — see below

## Files Created/Modified

- `web/src/lib/families/api.ts` — `FamilyMemberRecord.status`; `suspendMember`/`reinstateMember`/`removeMember`/`getMemberAccess`/`getFamily`; `NewSealedKeyEntry`/`ItemRewrapEntry`/`CollectionRekeyBatch`/`MemberAccessResponse`
- `web/src/lib/vault/api.ts` — `getCollectionItems`/`getCollectionAccessList`; `CollectionItemRow`/`CollectionAccessEntry`
- `web/src/lib/crypto/index.ts` — `rewrapItemKeyForCollection` re-export (new); `encryptItemForCollection`/`decryptItemForCollection` re-exports (Rule 2 gap-fix)
- `web/src/lib/families/rekey.ts` (new) — `buildMemberRemovalBatch`, `removeFamilyMember`
- `web/src/lib/families/rekey.real-wasm.test.ts` (new) — 2 real-WASM tests
- `web/src/lib/i18n/dictionary.ts` — 45 new Phase 25 keys

## Decisions Made

See `key-decisions` in frontmatter above for the full list. Highlights:
- Added `encryptItemForCollection`/`decryptItemForCollection` re-exports to `crypto/index.ts` beyond the plan's literal "ONE new export" wording — Rule 2 (missing critical functionality): the real-WASM test this plan exists to deliver could not be written without them, since `crypto/index.ts` is the enforced sole choke-point importer of `./wasm/pv_wasm.js`.
- `rewrapItemKeyForCollection`'s `old_enc_key_json` argument is fed the collection item's split-out `enc_key` string directly (never the combined `{enc_key, enc_data}` blob) — verified against the wasm binding's own `serde_json::from_str::<WrappedKey>` parse and the server's split-column storage convention already established by `lib/vault/store.ts`.
- `buildMemberRemovalBatch` throws if the caller's own `sealed_key` for a target's collection is `null` — not explicitly spelled out in the plan's action text, but required by the same fail-loud posture T-25-16 mandates for a keyless remaining recipient (Rule 2).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] `encryptItemForCollection`/`decryptItemForCollection` were never re-exported from `crypto/index.ts`**
- **Found during:** Task 1 (while reading `crypto/index.ts` in preparation for Task 3's test)
- **Issue:** These two pv-wasm bindings have existed since Plan 21-05, but `crypto/index.ts` — the codebase's enforced sole choke-point importer of `./wasm/pv_wasm.js` — never re-exported them. Task 3's `rekey.real-wasm.test.ts` (the plan's own non-optional, phase-context-mandated evidence) needs to build a real encrypted-item fixture to rewrap, which is structurally impossible without importing these two functions from `@/lib/crypto`.
- **Fix:** Added both to the existing named-import list from `./wasm/pv_wasm.js` and to the existing re-export statement, as pure pass-throughs (no wrapper logic), matching this module's own "thin WASM bridge" discipline.
- **Files modified:** `web/src/lib/crypto/index.ts`
- **Verification:** `cd web && npx tsc --noEmit` clean; `rekey.real-wasm.test.ts` (which imports both) passes 2/2; full `web` vitest suite (62 files / 562 tests) still green.
- **Committed in:** `442d67e` (Task 1 commit)

**2. [Rule 2 - Missing Critical Functionality] `buildMemberRemovalBatch` fails loud on a missing caller-side `sealed_key`**
- **Found during:** Task 2
- **Issue:** The plan's action text specifies fetching `getCollection(collectionId)` for the caller's own `sealed_key` and unsealing it, but does not explicitly say what to do if that `sealed_key` is `null` (the `CollectionRow.sealed_key` type already allows this). Silently proceeding would either crash inside `unsealCollectionKey` with an unhelpful error or, worse, produce a batch missing that collection's re-key entirely.
- **Fix:** Added an explicit `null` check that throws a descriptive `Error` naming the collection, before calling `unsealCollectionKey` — mirroring the same fail-loud philosophy the plan already mandates for a keyless remaining recipient (T-25-16).
- **Files modified:** `web/src/lib/families/rekey.ts`
- **Verification:** `cd web && npx tsc --noEmit` clean; code-reviewed against the plan's own stated `<threat_model>` intent (T-25-16's "never proceed with a smaller/incomplete re-key" philosophy).
- **Committed in:** `6319e00` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 2 — missing critical functionality)
**Impact on plan:** Both fixes were structurally required for this plan's own stated deliverables (the real-WASM test could not exist without #1; #2 closes a defensive gap consistent with the plan's own threat register). No scope creep — no new functionality beyond what the plan's `must_haves` already require.

## Issues Encountered

**Worktree had no pre-built WASM artifacts or `node_modules`.** This parallel-executor worktree was freshly checked out with no `web/src/lib/crypto/wasm/`, `web/public/wasm/`, `web/node_modules/`, or `packages/pv-ui/node_modules/` — all gitignored build outputs. Ran `scripts/build-wasm.sh` (compiles `pv-wasm` for `wasm32-unknown-unknown`, runs `wasm-bindgen`, produces the JS glue + `.wasm` binary for both `web/` and `extension/`) and `npm ci` in both `web/` and `packages/pv-ui/` before any task work could typecheck or run tests — matches STATE.md's documented "fresh worktree executor requires bootstrap" precedent from Phase 16. No source files were touched by this bootstrap; only gitignored build/dependency artifacts were generated.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: mitigated-as-designed | `web/src/lib/families/rekey.ts` | T-25-16 (Elevation of Privilege / Denial of Service, `buildMemberRemovalBatch` silently omitting a keyless recipient) closed exactly as specified: a `throw new Error(...)` naming the collection and recipient fires before that recipient's `sealed_key` is omitted from the batch — never a silently-shrunk recipient set. Extended (Rule 2, see Deviations #2) with the same posture for a missing CALLER-side `sealed_key`, which the plan's threat register did not name but which the same underlying invariant (never proceed with an incomplete re-key) covers. |
| threat_flag: mitigated-as-designed | `web/src/lib/families/rekey.ts` | T-25-17 (Information Disclosure, WASM key handle lifecycle) closed: every `WasmCollectionKey` (old/new, per collection) and every per-recipient `WasmIdentityPublicKey` is freed via `try/finally`, matching `invite/crypto.ts`'s established discipline — extended to per-collection-loop-iteration granularity (a two-tier try/finally: the outer function frees the identity keypair once; each loop iteration frees its own old/new Collection Key and public-key handles), so a mid-loop throw (e.g. T-25-16's guard firing on collection 2 of 3) cannot leak collection 1's already-freed handles nor leave collection 2's partially-allocated handles unfreed. |
| threat_flag: mitigated-as-designed | `web/src/lib/families/rekey.real-wasm.test.ts` | T-25-18 (Tampering, mocked-crypto structural blind spot) closed: this file contains zero `vi.mock` calls against `@/lib/crypto` (verified via `grep -c "vi.mock"` returning 0) and runs the genuine compiled wasm binary via the same `beforeAll` fetch-stub pattern as `invite/crypto.real-wasm.test.ts` — the phase context's explicitly non-optional evidence class, not a nice-to-have. |
| threat_flag: new-surface | `web/src/lib/crypto/index.ts` | `encryptItemForCollection`/`decryptItemForCollection` are newly reachable from outside `lib/crypto` (Rule 2 fix, see Deviations #1) — this is not new cryptographic surface (the underlying pv-wasm bindings and their pv-core primitives already existed and were already unit-tested since Plan 21-05/21-06), only a new EXPORT path through the established choke point. No new call site outside this plan's own test file uses them yet; `rekey.ts` itself never calls them directly (it only calls `rewrapItemKeyForCollection`). |
| threat_flag: accepted | `web/src/lib/families/api.ts`, `web/src/lib/vault/api.ts` | Every new client function in this plan (`suspendMember`/`reinstateMember`/`removeMember`/`getMemberAccess`/`getFamily`/`getCollectionItems`/`getCollectionAccessList`) is a thin, unauthenticated-on-the-client wrapper over an already-server-authorized route (Plan 25-03/25-04/25-06's `Membership`/owner-only guards) — this plan introduces no new client-side trust boundary; the server remains the sole enforcement point, per this codebase's standing zero-knowledge/server-authorizes-everything architecture. |

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `families/rekey.ts`'s `buildMemberRemovalBatch`/`removeFamilyMember` are ready for Plan 25-08's `RemoveMemberDialog` (target = someone else, via `removeFamilyMember`) and Plan 25-09's `DeleteAccountDialog` (target = caller's own user id, via `buildMemberRemovalBatch` directly plus a different account-deletion submit call) — CONTEXT.md's "one shared implementation, not two parallel ones" instruction is satisfied structurally, since there is exactly one place this batch-building logic is written.
- Every Phase 25 i18n key both Wave-5 UI plans (25-08, 25-09) will reference already exists in `dictionary.ts` — no same-wave file conflict is possible between them on this file.
- `crypto/index.ts` now also exposes `encryptItemForCollection`/`decryptItemForCollection` for any future plan that needs to construct or verify collection-item ciphertext client-side (not currently used outside this plan's own test file).
- No blockers. No stubs. Full `web` vitest suite (62 files / 562 tests) and `npx tsc --noEmit` both green after every task.

## Self-Check: PASSED

- `web/src/lib/families/api.ts` — FOUND
- `web/src/lib/vault/api.ts` — FOUND
- `web/src/lib/crypto/index.ts` — FOUND
- `web/src/lib/families/rekey.ts` — FOUND
- `web/src/lib/families/rekey.real-wasm.test.ts` — FOUND
- `web/src/lib/i18n/dictionary.ts` — FOUND
- Commit `442d67e` (feat: Task 1) — FOUND in git log
- Commit `6319e00` (feat: Task 2) — FOUND in git log
- Commit `882007a` (test: Task 3) — FOUND in git log

---
*Phase: 25-member-removal-suspension-re-key*
*Plan: 07*
*Completed: 2026-08-05*
