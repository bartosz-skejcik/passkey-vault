---
phase: 05-multi-device-sync
plan: 03
subsystem: web
tags: [nextjs, typescript, websocket, sync, vitest, zustand-style-store]

requires:
  - phase: 05-multi-device-sync (plan 01)
    provides: GET /api/sync?since=N revision-gated pull contract ({revision} cheap-check vs {revision, items, folders} snapshot)
  - phase: 05-multi-device-sync (plan 02)
    provides: GET /api/sync/ws?token= metadata-only push channel; token MUST be percent-encoded (base64 '+' decodes as a space -> 401)
  - phase: 02-vault-crud
    provides: store.ts module singleton, subscribeLockState unlock/lock lifecycle, decryptItemRow/decryptFolderRow, apiJson/apiFetch helpers
provides:
  - "web/src/lib/vault/sync.ts — startSync/stopSync WS client with exponential-backoff reconnect (1s->30s cap, ±25% jitter), unconditional 30s poll fallback, intentional-stop guard"
  - "web/src/lib/vault/syncStatus.ts — connected/reconnecting/offline singleton + useSyncStatus() hook (lib/crypto lock-state shape)"
  - "web/src/lib/vault/api.ts — getSyncSnapshot(since) + SyncSnapshot wire type"
  - "web/src/lib/vault/store.ts — applySyncSnapshot: the single merge implementation shared by initial load and background sync, with lastKnownRevision watermark and lock-race guard"
affects: [05-04]

tech-stack:
  added: []
  patterns:
    - "WS onmessage deliberately unparsed: any frame triggers exactly one pullOnce(); zero code path inspects WS payload bytes (stronger than schema-level no-ciphertext)"
    - "Per-socket local binding in handlers (socket, not module-level ws) so a superseded socket's late events never clobber a newer connection"
    - "intentionalStop flag set BEFORE socket.close() so the closing socket's own trailing onclose never re-arms reconnect"
    - "Snapshot merge replaces arrays wholesale; deletion = absence from new array (no tombstones, no diff pass)"

key-files:
  created:
    - web/src/lib/vault/sync.ts
    - web/src/lib/vault/syncStatus.ts
    - web/src/lib/vault/sync.test.ts
  modified:
    - web/src/lib/vault/api.ts
    - web/src/lib/vault/store.ts
    - web/src/lib/vault/store.test.ts

key-decisions:
  - "pullOnce() re-checks activeCallbacks identity after the awaited fetch so a stopSync() during an in-flight pull drops the snapshot instead of applying it to a stopped session."
  - "applySyncSnapshot sets lastKnownRevision BEFORE the lock-race early return — even a dropped-on-lock snapshot advances the watermark, which is reset to 0 in the lock branch anyway."
  - "startSync() begins with an internal stopSync() call for idempotent re-entry — never two live transports at once."

patterns-established:
  - "Sync transport lifecycle is slaved to the existing subscribeLockState gate: startSync on unlock, stopSync BEFORE clearing state on lock — no new lifecycle hook."

requirements-completed: [SYNC-01, SYNC-02, SYNC-03]

coverage:
  - id: D1
    description: "Client fires a catch-up pull on WS (re)connect and on a fixed 30s poll interval; WS onmessage (unparsed) triggers exactly one pull"
    requirement: "SYNC-01, SYNC-02"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/sync.test.ts (catch-up pull on open, unparsed onmessage pull, 30s poll fallback)"
        status: pass
    human_judgment: false
  - id: D2
    description: "WS drop triggers exponential-backoff reconnect (1000/2000/4000ms, capped 30000ms); a deliberate stopSync() is never undone by the closing socket's trailing close event"
    requirement: "SYNC-02"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/sync.test.ts (strictly-increasing capped delays; intentional-stop guard under direct test)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Snapshot merge replaces items/folders wholesale (deletion via absence), leaves state untouched on up-to-date responses while advancing the watermark, and is a safe no-op if a lock raced the in-flight fetch"
    requirement: "SYNC-01, SYNC-03"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts (applySyncSnapshot describe: wholesale replace, up-to-date untouched + watermark, unrelated-item undisturbed, lock-race no-op)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Sync starts on unlock and stops on lock (before state clearing) — no background network chatter while locked"
    requirement: "SYNC-01, SYNC-03"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts (startSync/stopSync exactly once each across an unlock-then-lock cycle)"
        status: pass
    human_judgment: false

duration: 30min
completed: 2026-07-14
status: complete
---

# Phase 5 Plan 03: Client Sync Engine (WS + Poll + Store Merge) Summary

**Browser-side sync transport: WS client with jittered exponential-backoff reconnect and a 30s poll fallback, both funneling into one internal pullOnce(); store.ts's initial load and background sync unified into a single `applySyncSnapshot` merge with a revision watermark and a lock-race guard — all proven by vitest with a mocked global WebSocket and fake timers.**

## Performance

- **Duration:** ~30 min (across a session restart)
- **Completed:** 2026-07-14
- **Tasks:** 2 completed (both TDD: RED -> GREEN)
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments
- `sync.ts`: `startSync(callbacks)`/`stopSync()` module singleton. WS `onmessage` is deliberately unparsed — ANY frame triggers exactly one `pullOnce()`, so no code path can ever act on WS payload bytes (T-05-09, a deliberate strengthening of SYNC-02's contract). Backoff doubles 1s->30s cap with ±25% jitter applied to the scheduled delay only (T-05-10); `onopen` resets backoff to the floor and fires a catch-up pull. The `intentionalStop` flag (set BEFORE closing) plus per-socket local handler binding make `stopSync()` immune to the closing socket's own trailing async `onclose`.
- WS URL derives from the SAME `NEXT_PUBLIC_API_BASE_URL` env var `lib/auth/api.ts` reads (leading `http`->`ws` replace; same-origin `ws(s)://host` fallback), with the session token percent-encoded via `encodeURIComponent` — honoring Plan 05-02's deviation flag (a raw base64 `+` decodes as a space and 401s).
- `syncStatus.ts`: `connected`/`reconnecting`/`offline` singleton copying `lib/crypto`'s lock-state shape exactly (module state + listener Set + `useSyncExternalStore` hook with a stable non-browser fallback) — ready for Plan 05-04's TopBar dot.
- `store.ts`: `applySyncSnapshot` is now the ONE merge implementation — `loadAndDecryptAll` collapsed to `getSyncSnapshot(0)` -> `applySyncSnapshot`; the ongoing-sync path passes the same function as `onSnapshot`. Watermark advances first (even on cheap up-to-date responses, so the next poll doesn't re-detect a known revision); the `getUnlockedUserKey()` re-check after the await means a lock racing an in-flight fetch can never decrypt with a stale/freed WASM key handle.
- Lock branch stops the transport BEFORE clearing `items`/`folders` and resets `lastKnownRevision = 0`; unlock starts it alongside the initial load — a second tab now observes another tab's create/edit/delete without a page refresh.
- 5 new sync.test.ts cases (mocked global WebSocket + fake timers) and 5 new store.test.ts cases; all 15 pre-existing store cases migrated from `listItems`/`listFolders` mocks to a `getSyncSnapshot` mock. Full web suite: 214/214; `tsc --noEmit` clean.

## Task Commits

Each task was committed atomically (TDD gates):

1. **Task 1: WS client + reconnect/backoff + poll timer + sync-status singleton** - `b2b1a48` (test, RED) -> `95ad8b5` (feat, GREEN)
2. **Task 2: store.ts applySyncSnapshot unification + sync lifecycle wiring** - `3af0e74` (test, RED) -> `fc7bfb9` (feat, GREEN)

**Plan metadata:** (this commit)

_TDD notes: Task 1 RED confirmed by unresolvable `./sync` import (suite fails before implementation); Task 2 RED confirmed with 15/20 failing (store still importing the removed listItems/listFolders mocks, no applySyncSnapshot). No REFACTOR commits needed — both implementations landed clean on the first GREEN pass (one test-side timer-advancement fix and updated_at fixture typing were part of the normal RED->GREEN iteration, committed within GREEN)._

## Files Created/Modified
- `web/src/lib/vault/sync.ts` - new: startSync/stopSync, connectWs, pullOnce, backoff/jitter, intentionalStop guard, poll interval
- `web/src/lib/vault/syncStatus.ts` - new: SyncStatus type, set/get/subscribe + useSyncStatus() hook
- `web/src/lib/vault/sync.test.ts` - new: 5 cases (catch-up pull, unparsed onmessage, increasing capped backoff, intentional-stop, poll fallback)
- `web/src/lib/vault/api.ts` - `SyncSnapshot` interface + `getSyncSnapshot(since)` one-line apiJson wrapper
- `web/src/lib/vault/store.ts` - applySyncSnapshot + lastKnownRevision; loadAndDecryptAll rewritten; lock/unlock branch wires startSync/stopSync
- `web/src/lib/vault/store.test.ts` - api mock reshaped to getSyncSnapshot; ./sync mocked; 5 new merge/lifecycle cases

## Decisions Made
- `pullOnce()` re-checks `activeCallbacks` identity after its awaited fetch — a `stopSync()` racing an in-flight pull drops the snapshot rather than applying it to a stopped (locked) session. Complements the store-level `getUnlockedUserKey()` guard; both layers independently prevent post-lock merges.
- `startSync()` opens with an internal `stopSync()` for idempotent re-entry (double-unlock events can never leak a second WS connection or poll timer).
- Fetch errors inside `pullOnce()` are swallowed silently — the poll timer/next WS event retries, and the pull (not the push) is the source of truth, so transient failures are self-healing by design.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed web dependencies in the fresh worktree**
- **Found during:** Task 1 (RED verification)
- **Issue:** The parallel-execution worktree had no `node_modules` — `vitest: command not found`
- **Fix:** `npm ci` from the existing `package-lock.json` (lockfile install only; no new packages added)
- **Files modified:** none (gitignored install)
- **Verification:** Test runner operational

**2. [Rule 3 - Blocking] Regenerated gitignored WASM bindings for whole-suite verification**
- **Found during:** Plan-level verification (full `npm test`)
- **Issue:** `src/lib/crypto/wasm/` (generated by the predev/prebuild hook, gitignored) didn't exist in the fresh worktree — 8 pre-existing crypto/PasskeysTab tests failed on an unresolvable import, unrelated to this plan's changes
- **Fix:** Ran `scripts/build-wasm.sh` (the exact script the predev hook runs)
- **Files modified:** none (generated output is gitignored)
- **Verification:** Full suite 214/214 green; `tsc --noEmit` clean

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking, both worktree-environment setup, zero source-code scope creep)
**Impact on plan:** None on plan substance — both were required to run the plan's own specified verification commands in an isolated worktree.

## Issues Encountered
None beyond the environment items above.

## Known Stubs
None — all new code paths are wired to real data sources (live `GET /api/sync` + WS endpoints from Plans 05-01/05-02). `useSyncStatus()` has no UI consumer yet by design: Plan 05-04 owns the TopBar dot.

## Threat Flags
None — no security-relevant surface beyond the plan's own threat model (T-05-09 mitigated via the unparsed-onmessage design, T-05-10 via jitter, T-05-11 accepted as planned; no new endpoints, auth paths, or storage).

## User Setup Required
None.

## Next Phase Readiness
- Plan 05-04 (sync UI polish) can consume `useSyncStatus()` for the TopBar dot and build remote-delete/live-edit-conflict detection on top of the now-current `items` array `applySyncSnapshot` maintains (its job ends at "items is the correct, current array" — the ID-comparison logic belongs to 05-04 per plan).
- REQUIREMENTS.md checkbox updates deliberately left to the orchestrator (shared-artifact write in parallel-wave mode).
- Full web suite green (214/214), `tsc --noEmit` clean.

---
*Phase: 05-multi-device-sync*
*Completed: 2026-07-14*

## Self-Check: PASSED

All created files verified present on disk (sync.ts, syncStatus.ts, sync.test.ts, this SUMMARY.md); all TDD task commit hashes (b2b1a48, 95ad8b5, 3af0e74, fc7bfb9) verified present in git log; no unexpected file deletions across the plan's commit range; full web suite 214/214 green and tsc --noEmit clean at completion.
