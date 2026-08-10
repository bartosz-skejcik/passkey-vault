---
phase: 30-the-living-group-family-wide-sharing
plan: 04
subsystem: crypto
tags: [webauthn, x25519, sealed-box, wasm, zero-knowledge, families]

# Dependency graph
requires:
  - phase: 30-the-living-group-family-wide-sharing
    provides: "30-01's committed FSH-02 decision record (30-DECISION-FSH-02.md) naming this exact composition as the required lazy-reseal mechanism"
provides:
  - "reshareCollectionToNewMember(collectionId, newRecipientUserId, accessLevel, ownUk) — the unwrap-own-key/reseal-to-one-new-recipient client-side crypto composition FSH-02's lazy-reseal fallback needs"
affects: ["30-12 (lazy-reseal trigger — Wave 4's consumer of this function)", "31-ORG-03/MOD-02 (documented second consumer per PROJECT.md's roadmap mapping)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Unwrap-own-sealed-key, reseal-to-one-new-recipient, no rotation — composed entirely from already-proven primitives (unsealCollectionKey/sealCollectionKey), never a fresh WasmCollectionKey.generate()"
    - "409-as-success idempotency against addCollectionMember, matching the server's existing ON CONFLICT DO NOTHING idiom on collection_keys's composite PK"

key-files:
  created:
    - web/src/lib/families/reseal.ts
    - web/src/lib/families/reseal.test.ts
    - web/src/lib/families/reseal.real-wasm.test.ts
  modified: []

key-decisions:
  - "Recipient public-key resolution (and the T-25-16 throw) happens BEFORE getCollection is called, not after — the plan's <behavior> spec requires the missing-public-key case to make zero network calls, so the resolve-then-fetch order was inverted from the plan's prose <action> description (which listed getCollection first) to satisfy the explicit acceptance criterion."
  - "The plan's dependency, node_modules, and the compiled pv-wasm binary were all absent in this fresh worktree — ran `npm ci` and `bash scripts/build-wasm.sh` before any test could execute; both are gitignored build artifacts, not committed."

requirements-completed: [FSH-02, FSH-03]

coverage:
  - id: D1
    description: "reshareCollectionToNewMember unwraps the caller's own sealed Collection Key and reseals the SAME key (never a fresh one) to exactly one new recipient's published public key, then grants access via the existing addCollectionMember endpoint"
    requirement: "FSH-02"
    verification:
      - kind: unit
        ref: "web/src/lib/families/reseal.test.ts#unwraps the caller's OWN sealed_key and reseals the SAME (never fresh) key to the recipient, then grants via addCollectionMember"
        status: pass
      - kind: unit
        ref: "web/src/lib/families/reseal.real-wasm.test.ts#the resealed blob, unsealed with the RECIPIENT's real identity secret key, decrypts to byte-identical Collection Key material as the ORIGINAL key the caller unwrapped"
        status: pass
    human_judgment: false
  - id: D2
    description: "A recipient with no published public key causes the function to throw before any network call (T-25-16 discipline)"
    requirement: "FSH-02"
    verification:
      - kind: unit
        ref: "web/src/lib/families/reseal.test.ts#throws before getCollection/addCollectionMember when the recipient has no published public key"
        status: pass
    human_judgment: false
  - id: D3
    description: "A 409 from addCollectionMember (recipient already holds a grant, a resealer race) resolves normally rather than throwing"
    requirement: "FSH-02"
    verification:
      - kind: unit
        ref: "web/src/lib/families/reseal.test.ts#resolves normally (does not throw) when addCollectionMember rejects with a structural 409"
        status: pass
    human_judgment: false
  - id: D4
    description: "The unwrapped Collection Key never leaves the function's own scope in plaintext — only the resulting opaque sealed blob crosses the network, proven by a real-WASM byte-comparison, not code inspection alone"
    requirement: "FSH-03"
    verification:
      - kind: unit
        ref: "web/src/lib/families/reseal.real-wasm.test.ts (both cases, real wasm-bindgen calls, no @/lib/crypto mock)"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-08-10
status: complete
---

# Phase 30 Plan 04: reshareCollectionToNewMember Summary

**The unwrap-own-key/reseal-to-one-recipient composition FSH-02's lazy-reseal fallback needs — proven through a real-WASM round trip, not the mocked `@/lib/crypto` lane.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-10
- **Tasks:** 2 (Task 1: tracer/TDD implementation, Task 2: real-WASM proof)
- **Files modified:** 3 (all new)

## Accomplishments
- `reshareCollectionToNewMember` exists in `web/src/lib/families/reseal.ts`: unwraps the caller's own sealed Collection Key, reseals the SAME key (never rotates) to exactly one new recipient's published public key, and grants access via the EXISTING `addCollectionMember` (`collections::add_member`) endpoint — zero new server surface.
- T-25-16 discipline: a recipient with no published public key causes the function to throw before ANY network call (`getFamilyMembers` roster check happens before `getCollection`), mirroring `buildMemberRemovalBatch`'s no-silent-drop rule.
- A structural 409 from `addCollectionMember` (the recipient already holds a grant — a race with another resealer) resolves normally rather than throwing, matching the server's `ON CONFLICT DO NOTHING` idiom.
- Every WASM handle (`identityKey`, unwrapped `ck`, recipient `WasmIdentityPublicKey`) is freed in a `finally` block.
- The real-WASM proof (`reseal.real-wasm.test.ts`) never mocks `@/lib/crypto` — it exercises genuine `unsealCollectionKey`/`sealCollectionKey` calls and proves, via a real encrypt/decrypt round trip on the RECIPIENT's own real identity secret key, that the resealed blob decrypts to byte-identical Collection Key material as the ORIGINAL key the caller unwrapped.

## Task Commits

Each task was committed atomically (Task 1 is `tdd="true"` — separate RED/GREEN commits):

1. **Task 1 (RED): failing unit test** - `38e47a2` (test) — five behavior cases against the mocked `@/lib/crypto` lane; confirmed to fail (`Failed to resolve import "./reseal"`) before the implementation existed.
2. **Task 1 (GREEN): reshareCollectionToNewMember implementation** - `cda7c06` (feat) — all 5 unit test cases pass.
3. **Task 2: real-WASM proof** - `57cb882` (test) — two independent real-identity fixture cases, no `@/lib/crypto` mock anywhere in the file.

**Plan metadata:** this SUMMARY's own commit (docs, immediately following).

## Files Created/Modified
- `web/src/lib/families/reseal.ts` - `reshareCollectionToNewMember`: the unwrap-own-key/reseal-to-one-recipient composition.
- `web/src/lib/families/reseal.test.ts` - Mocked-`@/lib/crypto` unit suite: 5 cases covering the happy path, the T-25-16 throw, 409-as-success, sealed_key:null throw, and WASM `.free()` discipline.
- `web/src/lib/families/reseal.real-wasm.test.ts` - Real-WASM proof: two independent real-identity fixtures, genuine `unsealCollectionKey`/`sealCollectionKey` calls, byte-identical key-material assertion via a real encrypt/decrypt round trip.

## Decisions Made
- **Recipient public-key resolution moved ahead of `getCollection`.** The plan's `<action>` prose lists `getCollection` before resolving the recipient's public key, but the `<behavior>` spec (and its acceptance criterion, "assert via a spy that neither is called") requires the missing-public-key throw to happen before ANY network call, including `getCollection`. Implemented the stricter behavior-spec order — TDD caught this directly: the first implementation attempt called `getCollection` first, and the "throws before getCollection/addCollectionMember" test failed with `getCollection` having been called once. Reordered to resolve the roster/public-key check first, then re-verified GREEN.
- **Environment bootstrap.** This worktree had no `node_modules` and no compiled `pv-wasm` bindings (`web/src/lib/crypto/wasm/`, `web/public/wasm/pv_wasm_bg.wasm`) — both are gitignored build artifacts. Ran `npm ci` (in `web/`) and `bash scripts/build-wasm.sh` (from repo root) before any test could execute. Neither produced any tracked-file changes (confirmed via `git status --short` before/after).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reordered recipient public-key check ahead of `getCollection`**
- **Found during:** Task 1, TDD RED→GREEN cycle
- **Issue:** The plan's `<action>` prose describes `getCollection` running before the recipient roster lookup, but the `<behavior>` spec's second bullet explicitly requires the T-25-16 throw to occur "before calling `getCollection`/`addCollectionMember` at all" — a genuine internal inconsistency in the plan text. Implementing the `<action>`'s literal order made the unit test assert `getCollection` was never called, which failed since it HAD been called.
- **Fix:** Reordered `reshareCollectionToNewMember` to resolve the recipient's public key via `getFamilyMembers()` and throw before touching `getCollection`, matching the `<behavior>` spec (the more precise and safety-relevant of the two plan sections) rather than the `<action>` prose.
- **Files modified:** `web/src/lib/families/reseal.ts`
- **Verification:** `reseal.test.ts`'s "throws before getCollection/addCollectionMember when the recipient has no published public key" case passes; the sealed_key:null test was updated to supply a valid public-key-bearing recipient so it isolates the sealed_key check specifically.
- **Committed in:** `cda7c06` (Task 1 GREEN commit)

**2. [Rule 3 - Blocking] Installed missing worktree dependencies and built pv-wasm bindings**
- **Found during:** Task 1, first `vitest run`
- **Issue:** This fresh git worktree had no `node_modules` in `web/` (vitest/vite unresolvable) and no compiled `web/src/lib/crypto/wasm/pv_wasm.js`/`web/public/wasm/pv_wasm_bg.wasm` (both build artifacts, gitignored, generated per-checkout by `scripts/build-wasm.sh`). This is the exact hazard the wave coordinator flagged mid-task: the obvious-but-wrong fix would have been to mock `@/lib/crypto` in `reseal.real-wasm.test.ts` to route around the missing artifact — rejected outright, since that would satisfy the letter of the test file existing while destroying the one thing SC4/Non-Negotiable #2 requires it to prove.
- **Fix:** Ran `npm ci` in `web/` and `bash scripts/build-wasm.sh` from the repo root (the project's single canonical wasm-build path) — both run BEFORE `reseal.real-wasm.test.ts` was written, so the real artifact was in place from the start; no mock-then-swap-later shortcut was ever taken. `packages/pv-ui/node_modules` (a gap noted on a sibling wave executor) was confirmed unnecessary for this plan's narrow file set — `reseal.ts`/`reseal.test.ts`/`reseal.real-wasm.test.ts` have no `pv-ui` import, and both vitest runs and `tsc --noEmit` passed clean without it.
- **Files modified:** none tracked (both outputs are gitignored; `git status --short` confirmed no new/changed tracked files before or after either command).
- **Verification:** `npx vitest run` resolves and runs; `initCrypto()` loads the real compiled wasm binary successfully in `reseal.real-wasm.test.ts`, which stubs ONLY `global.fetch` — no `vi.mock("@/lib/crypto")` anywhere in that file (confirmed by grep).
- **Committed in:** N/A (no tracked-file change to commit)

---

**Total deviations:** 2 auto-fixed (1 bug/behavior-spec fidelity, 1 blocking/environment bootstrap)
**Impact on plan:** Both necessary for correctness and for the tests to run at all. No scope creep — no lines outside `reseal.ts`/`reseal.test.ts`/`reseal.real-wasm.test.ts` were touched.

## Issues Encountered
- **Double-free in the real-WASM test's first draft.** The test initially freed `callerIdentity` in its own `finally` block after calling `reshareCollectionToNewMember`, but the function already frees the `WasmIdentityKey` it receives from `ensureOwnIdentityKeypair` (mocked in this test to hand back the real fixture identity directly) in its own `finally` — a double-free that wasm-bindgen surfaced as `Error: null pointer passed to rust`. Fixed by removing the test's own `callerIdentity.free?.()` calls, documented inline in the test file.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `reshareCollectionToNewMember` is ready for 30-12's lazy-reseal trigger (Wave 4) to call once per pending grant it discovers.
- `resolve_access`/`Collection::resolve_access` (`membership.rs`) were not touched — the enforcement point for revocation remains exactly as it was.
- No blockers for downstream plans; this function's only network call reuses the existing `add_member` endpoint verbatim, so 30-14's planned adversarial server-side inspection has no new request shape to audit here.

---
*Phase: 30-the-living-group-family-wide-sharing*
*Completed: 2026-08-10*
