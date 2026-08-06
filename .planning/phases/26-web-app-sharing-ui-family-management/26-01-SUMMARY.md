---
phase: 26-web-app-sharing-ui-family-management
plan: 01
subsystem: api
tags: [rust, axum, sqlx, wasm, typescript, vitest, sharing, collections]

# Dependency graph
requires:
  - phase: 25-member-removal-suspension-re-key
    provides: "collections/collection_keys schema, RemoveMemberDialog's resolveFolder decrypt pattern (documented WR-09 as a Phase 26 prerequisite)"
provides:
  - "Client-minted collection id contract: collections::create requires+validates a client-supplied UUID-v4 id, echoes it back unchanged, never mints its own"
  - "collection_id wire field on every vault item (GET /api/vault/items, both sync.rs snapshot builders)"
  - "web/src/lib/vault/api.ts: createCollection, listCollections, moveItemToCollection wrappers"
  - "Real-WASM regression test proving the client-side mint->encrypt->decrypt round trip for a collection name"
affects: [26-02, 26-03, 26-04, 26-05, 26-06, 26-07, 26-08, 26-09, 26-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ON CONFLICT DO NOTHING RETURNING + fetch_optional for client-minted PK collision handling (mirrors insert_collection_key)"
    - "Shape-validate client-minted ids BEFORE any DB work (mirrors invitations.rs's fail-closed discipline)"
    - "Real-WASM test tier: real crypto calls, global.fetch stubbed only at the wasm-bytes and api.ts wrapper boundaries, never vi.mock('@/lib/crypto')"

key-files:
  created:
    - web/src/lib/vault/createCollection.real-wasm.test.ts
  modified:
    - crates/pv-server/src/routes/collections.rs
    - crates/pv-server/src/routes/vault.rs
    - crates/pv-server/src/routes/sync.rs
    - crates/pv-server/tests/collections.rs
    - web/src/lib/vault/api.ts

key-decisions:
  - "Client mints the collection UUID (crypto.randomUUID() in real usage) BEFORE encrypting enc_name, whose AAD binds to that exact id -- server validates shape and uniqueness, never mints its own (26-CONTEXT.md's A-1, locked)."
  - "A colliding client-minted id is a 409 via ON CONFLICT DO NOTHING RETURNING + fetch_optional, never a raw sqlx::Error falling through to a 500."
  - "collection_id is additive-only on the wire: both UNION arms of fetch_items_for gained one SELECT column, zero WHERE/JOIN changes; sync.rs's two snapshot builders set it directly from their own known scope (Some(membership.resource_id) / None) rather than a second query."

patterns-established:
  - "Shape-validate client-minted primary keys before any DB work, mirroring invitations.rs's own discipline -- future client-minted-id endpoints in this codebase should follow the same validate-then-ON-CONFLICT-RETURNING shape."

requirements-completed: [SHARE-01, UX-05]

coverage:
  - id: D1
    description: "collections::create requires and shape-validates a client-minted UUID-v4 id before any DB work, rejecting malformed ids with 400"
    requirement: "SHARE-01"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#create_collection_rejects_malformed_id_before_any_db_work"
        status: pass
    human_judgment: false
  - id: D2
    description: "CollectionResponse.id echoes the client-minted id unchanged; a colliding id returns 409, never 500"
    requirement: "SHARE-01"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#collection_create_wires_creator_edit_access"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#create_collection_duplicate_id_returns_409_not_500"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /api/vault/items returns collection_id -- null for a personal item, the real collection id for a collection-scoped one"
    requirement: "UX-05"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#list_items_returns_collection_id_null_for_personal_real_id_for_collection_scoped"
        status: pass
    human_judgment: false
  - id: D4
    description: "Client-side createCollection/listCollections/moveItemToCollection wrappers exist, and a real-WASM test proves the client half of the WR-09 fix: mint id, encrypt bound to it, decrypt the server's own echoed response back to the original plaintext"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/createCollection.real-wasm.test.ts#createCollection: real-WASM round trip proves the WR-09 fix's client half"
        status: pass
    human_judgment: false
  - id: D5
    description: "Full end-to-end proof that a real client and real server together produce a decryptable collection name (both halves proven independently here, together deferred to Plan 26-13's live Playwright run)"
    verification: []
    human_judgment: true
    rationale: "Task 1's Rust tests prove the server half (echo contract, collision handling) and Task 2's real-WASM test proves the client half (encrypt/decrypt round trip against a mocked echo) independently, by design (this plan's own Test-tiering decision -- no vitest-tier live server exists in this repo). Proving both halves together against one real running server requires Plan 26-13's live 2-session Playwright run, which is out of this plan's scope."

# Metrics
duration: 25min
completed: 2026-08-06
status: complete
---

# Phase 26 Plan 01: Server-side WR-09 fix + client-minted collection id contract Summary

**Client-minted collection UUID closes the WR-09 wire-contract defect end-to-end: `collections::create` now requires and shape-validates a client-supplied id, echoes it back unchanged, rejects a collision with 409 instead of 500, and every vault item carries a new `collection_id` field so the client can pick the correct decryption key.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-06T10:48Z (base commit `9f90263`)
- **Completed:** 2026-08-06T11:09:24+02:00
- **Tasks:** 2
- **Files modified:** 14 (2 server routes files + 1 new server-side test additions in an existing file + 8 pre-existing server test files updated for the new required `id` field + 1 client API file + 1 new client test file + 1 client test fixture file)

## Accomplishments

- **WR-09 closed at the wire-contract level.** `collections::create` no longer mints `let id = uuid::Uuid::new_v4().to_string()` after the client has already encrypted `enc_name` with AAD bound to a different id. The client now mints the UUID-v4 first, the server shape-validates it (36 chars, hyphens at 8/13/18/23, hex elsewhere) before any DB work, and echoes the SAME id back in `CollectionResponse.id`.
- **Collision handling is a clean 409.** The INSERT now uses `ON CONFLICT(id) DO NOTHING RETURNING created_at` + `fetch_optional`, mirroring `insert_collection_key`'s existing idiom — a colliding client-minted id maps to `ApiError::Conflict`, never falls through to the blanket `From<sqlx::Error>` 500 mapping.
- **`collection_id` is now on the wire for every vault item.** `VaultItem::collection_id: Option<String>` is populated additively in both UNION arms of `fetch_items_for` (personal arm: literal `NULL`; collection arm: `i.collection_id`) and in both of `sync.rs`'s snapshot builders (`pull_shared_collection`: `Some(membership.resource_id)`; `pull_shared_direct`: `None`, since those rows are always personal items shared directly).
- **Client-side wrappers exist:** `createCollection`, `listCollections`, `moveItemToCollection` in `web/src/lib/vault/api.ts`, plus `ItemRow.collection_id: string | null`.
- **A real-WASM regression test proves the client half of the fix.** `createCollection.real-wasm.test.ts` mints an id, encrypts a collection name bound to it via the real WASM `encryptItemForCollection`, POSTs through `createCollection` against a mocked echo response (mirroring the real server's own proven contract), and decrypts the response's own `enc_name` back to the original plaintext byte-for-byte — zero `vi.mock` of `@/lib/crypto`.
- **RED proof performed, not asserted.** Mutated the real-WASM test's mock to simulate the OLD server-minted-id bug (return an id different from the one bound into the AAD), ran it, and observed a genuine AEAD failure: `Unknown Error: decryption failed (wrong key or corrupted data)`. Restored immediately after capturing the failure text below.

## Task Commits

Each task was committed atomically:

1. **Task 1: Server — client-minted collection id (A-1 fix) + item collection_id wire field** — `43595d4` (fix)
2. **Task 2: Client — createCollection/listCollections/moveItemToCollection wrappers + real-WASM round-trip proof** — `6bf561a` (feat)

_No plan-metadata commit yet — this SUMMARY/STATE commit follows per the standard final-commit step._

## RED Proof (mandatory per phase_context's "standing hazard")

Per this plan's own done criteria, the RED demonstration was performed on the REAL test harness, not asserted:

1. Temporarily mutated `createCollection.real-wasm.test.ts`'s mocked `/api/vault/collections` response to return a hardcoded id (`11111111-1111-4111-8111-111111111111`) instead of echoing `sentBody.id` — simulating the pre-fix server behavior of minting its own id after the client had already bound `enc_name`'s AAD to a different one.
2. Ran `npx vitest run src/lib/vault/createCollection.real-wasm.test.ts`.
3. **Observed failure:**
   ```
   ❯ src/lib/vault/createCollection.real-wasm.test.ts (2 tests | 1 failed) 10ms
      × createCollection: real-WASM round trip proves the WR-09 fix's client half > mint id -> encrypt enc_name bound to it -> POST -> mocked echo response -> decrypt back to the original plaintext 5ms
        → decryption failed (wrong key or corrupted data)

   FAIL  src/lib/vault/createCollection.real-wasm.test.ts > createCollection: real-WASM round trip proves the WR-09 fix's client half > mint id -> encrypt enc_name bound to it -> POST -> mocked echo response -> decrypt back to the original plaintext
   Unknown Error: decryption failed (wrong key or corrupted data)
   ```
4. Reverted the mutation (restored the echo `id: sentBody.id` and the `expect(response.id).toBe(clientMintedId)` assertion). Re-ran the suite — both tests pass, `npx tsc --noEmit` clean.

This proves the test is a real regression guard: it would have failed on the old WR-09 defect, and it passes against the fixed contract.

## Files Created/Modified

- `crates/pv-server/src/routes/collections.rs` — `CreateCollectionRequest.id`, `validate_collection_id_shape`, `create()` rewired to client-minted id + `ON CONFLICT ... RETURNING`
- `crates/pv-server/src/routes/vault.rs` — `VaultItem.collection_id`, `fetch_items_for`'s additive SELECT-list change
- `crates/pv-server/src/routes/sync.rs` — `collection_id` set in `pull_shared_collection`'s and `pull_shared_direct`'s `VaultItem` constructors
- `crates/pv-server/tests/collections.rs` — id-echo assertion added to the existing create test; 3 new tests (malformed id, duplicate id 409, `collection_id` wire field null-vs-real)
- `crates/pv-server/tests/{account_deletion,family_removal,invitations,membership_route_sweep,sync,sync_shared,vault}.rs` — every existing `POST /api/vault/collections` call site now supplies a client-minted id (Rule 3: the field became required, these tests would otherwise 400)
- `web/src/lib/vault/api.ts` — `createCollection`, `listCollections`, `moveItemToCollection`, `ItemRow.collection_id`
- `web/src/lib/vault/createCollection.real-wasm.test.ts` (new) — the client-half round-trip proof + 409 error-shape test + `ItemRow` typecheck fixture
- `web/src/lib/vault/store.test.ts` — 12 existing `ItemRow` literal fixtures gained `collection_id: null` (same Rule 3 cause: the field became required)

## Decisions Made

- Client mints the UUID before encryption (A-1, locked in 26-CONTEXT.md) over a two-step create→PATCH, per the phase context's own rationale (avoids the extra round trip and the nameless-collection partial-failure window).
- `sync.rs`'s two `VaultItem` constructors set `collection_id` directly from their own already-known query scope (the membership extractor's `resource_id`, or a hardcoded `None` for the `item_shares`-only path) rather than adding a second query — each function's own `WHERE` clause already guarantees the value.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated 8 pre-existing server test files to supply a client-minted `id`**
- **Found during:** Task 1, after making `CreateCollectionRequest.id` required
- **Issue:** `account_deletion.rs`, `family_removal.rs`, `invitations.rs`, `membership_route_sweep.rs`, `sync.rs`, `sync_shared.rs`, and `vault.rs` all POST `/api/vault/collections` with a body that no longer matched the new required-field contract — every one of these would fail JSON deserialization (400) the moment the field became required, breaking `cargo test --workspace`.
- **Fix:** Added a fresh `uuid::Uuid::new_v4().to_string()`-derived literal `id` to every `enc_name`+`sealed_key` create-collection JSON body across those 8 files (30 call sites total, script-assisted via a Python regex pass scoped to `json!({...})` blocks containing both `"enc_name"` and `"sealed_key"` but not `"recipient_user_id"`, to avoid touching `add_member`/folder-creation bodies).
- **Files modified:** `crates/pv-server/tests/{account_deletion,family_removal,invitations,membership_route_sweep,sync,sync_shared,vault}.rs`
- **Verification:** `cargo test --workspace -p pv-server` — all 61+59+... suites green (no test regressions).
- **Committed in:** `43595d4` (Task 1 commit)

**2. [Rule 3 - Blocking] Added `collection_id: null` to 12 `ItemRow` literal fixtures in `store.test.ts`**
- **Found during:** Task 2, after making `ItemRow.collection_id` required in TypeScript
- **Issue:** `web/src/lib/vault/store.test.ts` constructs 12 literal `ItemRow`-typed fixture objects that predate this field; `npx tsc --noEmit` failed with `TS2741: Property 'collection_id' is missing`.
- **Fix:** Added `collection_id: null` alongside each existing `last_editor_email: null` field (script-assisted regex pass).
- **Files modified:** `web/src/lib/vault/store.test.ts`
- **Verification:** `npx tsc --noEmit` clean; full `npx vitest run` — 67 files / 632 tests pass.
- **Committed in:** `6bf561a` (Task 2 commit)

**3. [Process note, no functional deviation] A stray `cargo fmt --package pv-server` run was reverted**
- **Found during:** Task 1, after all tests passed
- **Issue:** Ran `cargo fmt --package pv-server` intending to tidy the scripted single-line JSON insertions; it reformatted the ENTIRE crate (every file, not just touched lines), producing a ~4,000-line unrelated diff.
- **Fix:** Reverted every file to its pre-`cargo fmt` state via `git checkout --`, then re-applied only the intended edits (both the Rust source edits and the Python script pass) without a crate-wide `cargo fmt`. Final diff is scoped to the 11 files this plan actually touches.
- **Files modified:** none beyond what's already listed above (this was a revert-and-redo, not a new change)
- **Verification:** `git diff --stat` confirmed only the 11 intended files changed; `cargo build --workspace` and `cargo test --workspace -p pv-server` re-run clean.

---

**Total deviations:** 2 auto-fixed (both Rule 3 — required-field ripple effects across pre-existing test fixtures), plus 1 process correction (no functional change).
**Impact on plan:** Both auto-fixes are direct, mechanical consequences of making previously-optional/absent fields required, exactly as the plan's own `<action>` specified. No scope creep — no test assertions were weakened, no server behavior changed beyond what Task 1/2's `<action>` blocks specify.

## Issues Encountered

None beyond the two Rule 3 fixes and the fmt-scope correction documented above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The WR-09 wire-contract defect (25-CONTEXT.md's inherited blocker, STATE.md Blockers) is closed at BOTH the server (Rust integration tests) and client (real-WASM test) layers, independently proven. Plan 26-13's live Playwright run is what proves both halves together against one real running server and closes Phase 25's own "real folder name" UAT gap (25-REVIEW-FIX.md references this exact fix).
- `collection_id` is now available on every vault item's wire shape — every downstream plan building decrypt-dispatch, filtering, or "already in a shared folder" UI logic (26-02 through 26-09) can rely on it existing, `null`-for-personal / real-id-for-collection-scoped.
- `createCollection`/`listCollections`/`moveItemToCollection` exist as thin wire wrappers in `web/src/lib/vault/api.ts` for any plan building the actual UI/crypto orchestration on top (explicitly NOT built here — `moveItemToCollection`'s re-encrypt-under-destination-scope logic is Plan 26-08's job, per this plan's own `<action>`).
- No blockers introduced. `26-CONTEXT.md`'s locked A-1 decision is now implemented exactly as specified.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: new-trust-boundary | `crates/pv-server/src/routes/collections.rs::create` | `POST /api/vault/collections` now accepts a client-supplied `id` that becomes a database PRIMARY KEY — previously a server-generated value, this is untrusted input crossing into a PK column for the first time on this endpoint. Mitigated per the plan's own threat model (T-26-01): UUID-v4 shape validation before any DB work, `ApiError::BadRequest` on mismatch, SQLite PK uniqueness enforced. Covered by `create_collection_rejects_malformed_id_before_any_db_work`. |
| threat_flag: error-shape-change | `crates/pv-server/src/routes/collections.rs::create` | The INSERT's error path changed from an unconditional `?`-propagated `sqlx::Error` (opaque 500 on ANY DB failure, including a PK collision) to an explicit `ON CONFLICT DO NOTHING RETURNING` + `fetch_optional` branch that maps a `None` result specifically to `ApiError::Conflict` (409). This narrows what a caller can infer from a 500 vs 409 response — a 500 now means a genuine, non-collision DB failure, whereas before a collision and a genuine failure were indistinguishable. Intentional per the plan's threat register (T-26-02, mitigate, disposition: "never lets a raw sqlx::Error fall through"). Covered by `create_collection_duplicate_id_returns_409_not_500`. |

## Self-Check: PASSED

- FOUND: crates/pv-server/src/routes/collections.rs
- FOUND: crates/pv-server/src/routes/vault.rs
- FOUND: crates/pv-server/src/routes/sync.rs
- FOUND: crates/pv-server/tests/collections.rs
- FOUND: web/src/lib/vault/api.ts
- FOUND: web/src/lib/vault/createCollection.real-wasm.test.ts
- FOUND: web/src/lib/vault/store.test.ts
- FOUND commit 43595d4 in git log
- FOUND commit 6bf561a in git log

---
*Phase: 26-web-app-sharing-ui-family-management*
*Plan: 01*
*Completed: 2026-08-06*
