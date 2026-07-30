---
phase: 23-sync-model-extension-shared-data-fan-out
plan: 06
subsystem: testing
tags: [playwright, e2e, ci, sync, sharing, web]

# Dependency graph
requires:
  - phase: 23-sync-model-extension-shared-data-fan-out (Plan 23-04)
    provides: "web/'s Playwright harness (playwright.config.ts, e2e/fixtures.ts's twoSessions fixture, smoke.spec.ts)"
  - phase: 23-sync-model-extension-shared-data-fan-out (Plan 23-02)
    provides: "GET /api/sync/shared, GET /api/vault/collections/{id}/sync, GET /api/sync/shared/direct"
  - phase: 23-sync-model-extension-shared-data-fan-out (Plan 23-05)
    provides: "client sync engine's shared-revisions pull + DetailPanel's two email-attributed conflict banners"
provides:
  - "web/e2e/shared-sync.spec.ts -- two live specs (2 real, independent, concurrently authenticated browser sessions) proving SYNC-04's revision fan-out and SYNC-06/SC3's conflict attribution"
  - ".github/workflows/ci.yml's new web-e2e job -- the first Playwright suite of any kind wired into this repo's CI, real and blocking (no continue-on-error), with a Rust build-cache step ahead of any cargo build/test step"
  - "a resilience fix in web/src/lib/vault/store.ts's applySyncSnapshot -- a single row that fails to decrypt during a sync merge now falls back to the last-known-good local copy instead of crashing the whole merge"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "family-owner seed account (fixed email, idempotent register+login, tolerant of 409 at every step) as the single owner of the v0.4 singleton family across an entire Playwright worker/test-file run -- immune to Playwright's retry-in-a-fresh-worker-process behavior, which a module-level JS token cache is NOT"
    - "context.request calls always use a fully-qualified BASE_URL constant, since a bare browser.newContext() does not inherit playwright.config.ts's use.baseURL the way page.goto() does"
    - "applySyncSnapshot's per-row decrypt now degrades to last-known-good-copy-on-failure rather than crash-the-whole-merge, since it is exactly the recovery path a 409 conflict handler calls immediately after catching the conflict"

key-files:
  created:
    - web/e2e/shared-sync.spec.ts
  modified:
    - .github/workflows/ci.yml
    - web/src/lib/vault/store.ts

key-decisions:
  - "Family membership setup uses a FIXED, deterministic seed account (idempotent register+login, tolerating 409 at every step) rather than a JS module-level 'whoever creates it first' cache -- discovered mid-execution that Playwright retries a failed test in a fresh worker process, resetting module state, while the DB-level families.rs singleton constraint (idx_families_singleton) persists regardless; only a server-persisted, deterministically-reachable identity survives that mismatch."
  - "Both A (item owner) and B (recipient) are added as members of the one singleton family, not just B -- membership.rs::Item::resolve_access's item_shares resolution join requires BOTH parties to share a family_members row in the SAME family (its own WR-07/CR-01 doc comment), even though vault.rs::create_share's own confused-deputy guard at INSERT time only checks the recipient."
  - "web-e2e's Rust build-cache step is an explicit Swatinem/rust-cache step (pinned to a resolved commit SHA, matching this file's existing pin discipline) even though actions-rust-lang/setup-rust-toolchain already caches internally per this project's own 20-RESEARCH.md notes -- the plan's action text explicitly directs this, and a second cache entry is harmless."

patterns-established:
  - "Any future web/ e2e spec needing a real family (a v0.4 singleton, per families.rs's own doc comment) should reuse this file's family-owner seed-account pattern rather than assuming whichever test runs first can safely own it forever."

requirements-completed: [SYNC-04, SYNC-06, SEC-08]

coverage:
  - id: D1
    description: "A live Playwright spec (2 real, independent browser sessions) proves SYNC-04's revision fan-out: a shared item edited by the owner becomes visible to a second, independently authenticated session via GET /api/sync/shared's direct bucket, with zero decryption on the second session's side"
    requirement: "SYNC-04"
    verification:
      - kind: e2e
        ref: "web/e2e/shared-sync.spec.ts#revision fan-out -- cd web && npx playwright test -g \"revision fan-out\""
        status: pass
    human_judgment: false
  - id: D2
    description: "A live Playwright spec proves SYNC-06/SC3: a concurrent edit's 409 conflict attributes to the co-editor's FULL email in the real revision-conflict-banner, not a generic message"
    requirement: "SYNC-06"
    verification:
      - kind: e2e
        ref: "web/e2e/shared-sync.spec.ts#conflict attribution -- cd web && npx playwright test -g \"conflict attribution\""
        status: pass
    human_judgment: false
  - id: D3
    description: "web/'s new Playwright suite is wired into .github/workflows/ci.yml as a real, blocking job (SEC-08) -- not manual-only, not continue-on-error"
    requirement: "SEC-08"
    verification:
      - kind: other
        ref: "python3 (pyyaml) parse of .github/workflows/ci.yml confirming web-e2e is a real top-level job with a test:e2e step at working-directory: web and no continue-on-error anywhere in the job (the plan's own <verify> command)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Neither live spec ever raises an OS-level dialog (Phase 20's standing rule) -- both sessions are password-only throughout"
    verification:
      - kind: e2e
        ref: "web/e2e/shared-sync.spec.ts -- both tests assert a.dialogFired()/b.dialogFired() === false"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-07-30
status: complete
---

# Phase 23 Plan 06: Live Shared-Sync Proof + CI Gate Summary

**Two live Playwright specs (2 real, independently authenticated browser sessions each) prove SYNC-04's cross-session revision fan-out and SYNC-06/SC3's email-attributed conflict banner against the real server stack, wired into `.github/workflows/ci.yml` as the first-ever real, blocking Playwright job in this repo's CI.**

## Performance

- **Duration:** ~35 min
- **Started:** ~2026-07-30T20:35 (approx, base commit)
- **Completed:** 2026-07-30T21:08:05+02:00
- **Tasks:** 2
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

- `web/e2e/shared-sync.spec.ts`: two live specs — **"revision fan-out"** (owner A creates a family, adds member B via raw request, A creates+edits a login item through the REAL UI, B's own raw `GET /api/sync/shared` reflects the item's revision both before and after A's edit — zero decryption on B's side) and **"conflict attribution"** (A opens an edit-shared item in the real DetailPanel, B performs a raw authenticated PUT at the still-current revision, A's own Save submits with the now-stale baseline, the server's 409 attributes to B's real email, and the real `revision-conflict-banner` renders it).
- `.github/workflows/ci.yml`: new `web-e2e` job — mirrors the existing `web` job's checkout/rust-toolchain/node-setup/build-wasm/npm-ci steps, adds an explicit `Swatinem/rust-cache` step ahead of `playwright.config.ts`'s own internal `cargo build --release -p pv-server`, installs Playwright's Chromium binary, and runs `npm run test:e2e`. No `continue-on-error`, no headed-mode carve-out (every session is password-only).
- `web/src/lib/vault/store.ts` (Rule 2 deviation, discovered while getting the "conflict attribution" spec green): `applySyncSnapshot`'s per-row decrypt now falls back to the last-known-good local copy on a single row's decrypt failure instead of throwing and crashing the whole snapshot merge — this is exactly the recovery path `updateVaultItem`'s 409 handler calls immediately after catching a conflict, so the crash was silently replacing the intended `RevisionConflictError` with an unrelated decrypt exception and the conflict banner never rendered.

## Task Commits

Each task was committed atomically:

1. **Task 1: shared-sync.spec.ts — revision fan-out + conflict attribution, live** - `5b48bf5` (test)
2. **Task 2: Wire web-e2e into CI as a real, blocking job** - `8d9d163` (ci)

## Files Created/Modified

- `web/e2e/shared-sync.spec.ts` - the two live specs (new)
- `.github/workflows/ci.yml` - new `web-e2e` blocking job
- `web/src/lib/vault/store.ts` - `applySyncSnapshot` per-row decrypt resilience fix (Rule 2 deviation)

## Decisions Made

- **Family-owner seed account, not a JS state cache.** `families.rs::create`'s own doc comment establishes a strict v0.4 singleton (`idx_families_singleton`) — only ONE `families` row can ever exist per server/DB. My first implementation cached "whoever creates it first" in a module-level JS variable shared by both tests; this broke the moment Playwright retried a failing test (retries run in a fresh worker process, resetting module state, while the DB-level family the earlier attempt created still exists). The fix: a FIXED, deterministic seed account (`pv-e2e-shared-sync-family-owner@example.test`) that every single test independently (idempotently) registers and logs into via raw HTTP, tolerating `409` at register/family-create/add-member time — this works identically on a fresh DB, a DB where an earlier test in the same run already created the family, and across retries, with zero in-process state dependency.
- **Both A and B must be family members, not just B.** Initially assumed (per `vault.rs::create_share`'s own doc comment) that only the RECIPIENT needed family membership for a direct item share. That guard is only enforced at INSERT time. The actual access-resolution check every subsequent read/write goes through (`membership.rs::Item::resolve_access`) requires the item OWNER and the RECIPIENT to share a `family_members` row in the SAME family (its own WR-07/CR-01 doc comment) — without adding A as a member too, B's own raw edit in "conflict attribution" 404'd.
- **Explicit `Swatinem/rust-cache` step even though `setup-rust-toolchain` already caches internally.** This project's own `20-RESEARCH.md` notes the existing toolchain-setup action bundles Rust caching. The plan's action text explicitly directs adding a separate cache step regardless; a second cache entry is harmless, and it satisfies the plan's own written acceptance criterion literally.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `applySyncSnapshot` crashed the whole snapshot merge on a single undecryptable row, swallowing the intended `RevisionConflictError`**

- **Found during:** Task 1, getting the "conflict attribution" spec green
- **Issue:** After B's raw (deliberately crypto-free, per this plan's own opaque-placeholder fixture design) PUT overwrote the shared item's ciphertext with a non-decryptable placeholder, A's own subsequent Save attempt correctly received a `409`. `updateVaultItem`'s 409 handler calls `loadAndDecryptAll()` before throwing `RevisionConflictError` — but `applySyncSnapshot`'s `items.map((row) => decryptItemRow(row, uk))` had no per-row error handling, so decrypting B's placeholder blob threw synchronously (a raw WASM error string, not even an `Error` instance), propagating out of `loadAndDecryptAll()` and replacing the intended `RevisionConflictError` entirely. `err instanceof RevisionConflictError` was then `false` in `DetailPanel`'s `onError`, so `conflict` state was never set and the banner never rendered — confirmed via targeted debug logging (`DEBUG onError invalid type: string "CCCC", expected a sequence at line 1 column 26 false String`) before the fix, removed after.
- **Fix:** `applySyncSnapshot` now builds a `Map` of the previous items/folders by id before merging, and wraps each row's decrypt in try/catch — on failure it keeps the LAST-KNOWN-GOOD local copy (not drops the row entirely, which would make `selectedItem` resolve to `undefined` and unmount the very `DetailPanel` that needs to show the banner) and logs a `console.error`. This is a general resilience improvement (any single corrupted/foreign row should never crash the whole vault snapshot merge), not scoped narrowly to this test's own placeholder-ciphertext scenario — a real production equivalent (a genuinely corrupted item, a version-skewed client) would hit the identical crash today without this fix.
- **Files modified:** `web/src/lib/vault/store.ts`
- **Verification:** Both new specs pass individually (`-g` filtered) and together; full `web/` vitest suite (492 tests) and `tsc --noEmit` both clean afterward.
- **Committed in:** `5b48bf5` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in existing sync-merge resilience, surfaced by this plan's own live 2-session test)
**Impact on plan:** Necessary for the "conflict attribution" spec's own correctness — without it, the conflict banner would never render, live-blocking this plan's entire objective. No scope creep beyond the two touched functions inside `applySyncSnapshot`.

## Issues Encountered

- Initial `setupFamilyWithMember` design (whichever test's own `A` session creates the family first, caching its bearer token in a module-level variable for the other test to reuse) broke on Playwright's retry-in-a-fresh-worker-process behavior — see Decisions Made above for the seed-account fix.
- Discovered (via the same debugging pass) that `vault.rs::create_share`'s recipient-only confused-deputy check does NOT mean the recipient-only family-membership requirement holds at access-resolution time too — `membership.rs::Item::resolve_access`'s `item_shares` join requires BOTH parties in the same family. Fixed by adding A as a family member alongside B in `ensureFamilyMembers`.
- Root-caused the "no conflict banner" failure via temporary `console.log` instrumentation in `ItemForm.tsx`/`DetailPanel.tsx` and Playwright `page.on("response"/"console"/"pageerror")` listeners in the spec file — all removed before the final commit; none of that instrumentation is present in the committed diff (confirmed via `git status --short` showing zero changes to those two component files).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SYNC-04, SYNC-06, and SEC-08 are all closed for this phase: the shared-pull fan-out and conflict-attribution UI now have a live, 2-real-session proof, and that proof runs automatically as a blocking CI gate on every push/PR going forward.
- `web/src/lib/vault/store.ts`'s `applySyncSnapshot` resilience fix is now standing infrastructure any future phase's sync work benefits from — a single bad row (from any cause) can no longer crash a client's whole vault load.
- The family-owner seed-account pattern (`web/e2e/shared-sync.spec.ts`) is reusable by any future `web/` e2e spec that needs a real family, without re-deriving the singleton-vs-Playwright-retry interaction from scratch.
- No blockers for Phase 23 closeout.

---
*Phase: 23-sync-model-extension-shared-data-fan-out*
*Completed: 2026-07-30*

## Self-Check: PASSED

- FOUND: web/e2e/shared-sync.spec.ts
- FOUND: .github/workflows/ci.yml
- FOUND: web/src/lib/vault/store.ts
- FOUND: .planning/phases/23-sync-model-extension-shared-data-fan-out/23-06-SUMMARY.md
- FOUND: commit 5b48bf5 (Task 1)
- FOUND: commit 8d9d163 (Task 2)
