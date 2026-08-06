---
phase: 26-web-app-sharing-ui-family-management
plan: 02
subsystem: auth
tags: [webassembly, identity, x25519, unlock, fire-and-forget, wasm-handle-discipline]

# Dependency graph
requires:
  - phase: 24-collection-sharing-crypto-server
    provides: "ensureOwnIdentityKeypair (identity/ensure.ts) — idempotent, race-safe identity-keypair generation/publish, already used by invite generation, member removal, and RemoveMemberDialog"
  - phase: 22-collection-sharing-server
    provides: "PUT/GET /api/identity/keypair — idempotent upsert endpoint, proven server-side, never called from an unlock path until this plan"
provides:
  - "publishOnUnlock(uk) — the one shared fire-and-forget wrapper around ensureOwnIdentityKeypair"
  - "KEY-01's client trigger wired at all 4 setUnlockedUserKey call sites (RegisterForm.tsx, UnlockOverlay.tsx x2, passkeys/login.ts)"
affects: [26-collection-sharing-ui, 27-extension-sharing-ui, identity-fingerprint-display]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fire-and-forget crypto side-effect after a synchronous unlock state transition (void promise chain, .then frees the WASM handle, .catch swallows silently)"
    - "Real-WASM test tier that mocks only the wire boundary (@/lib/identity/api), never @/lib/crypto — proves genuine unwrap round trips instead of string-was-sent assertions"

key-files:
  created:
    - web/src/lib/identity/publishOnUnlock.ts
    - web/src/lib/identity/publishOnUnlock.real-wasm.test.ts
  modified:
    - web/src/components/auth/RegisterForm.tsx
    - web/src/components/auth/UnlockOverlay.tsx
    - web/src/lib/passkeys/login.ts
    - web/src/components/auth/RegisterForm.test.tsx
    - web/src/components/auth/UnlockOverlay.test.tsx
    - web/src/lib/passkeys/login.test.ts

key-decisions:
  - "publishOnUnlock lives in its own new module (not folded into lib/crypto/index.ts), avoiding a lib/crypto <-> lib/identity/ensure circular import, per 26-CONTEXT.md A-2/26-RESEARCH.md Pattern 4"
  - "Real-WASM test mocks only @/lib/identity/api's getIdentityKeypair/putIdentityKeypair, never @/lib/crypto — the wrapped secret key genuinely unwraps back to the same key material in every assertion, not just 'a string was sent'"

patterns-established:
  - "Any future fire-and-forget WASM-handle side-effect after an existing synchronous choke point should follow this module's shape: void promise, .then frees the handle unconditionally, .catch swallows silently with a comment explaining the self-healing contract"

requirements-completed: [KEY-01]

coverage:
  - id: D1
    description: "publishOnUnlock(uk) publishes a fresh identity keypair when none exists, and the wrapped secret genuinely round-trips back to the same key material"
    requirement: "KEY-01"
    verification:
      - kind: unit
        ref: "web/src/lib/identity/publishOnUnlock.real-wasm.test.ts#publishes a fresh keypair whose wrapped secret genuinely round-trips back to the same key material, and frees the handle"
        status: pass
    human_judgment: false
  - id: D2
    description: "Idempotency: an already-published keypair is adopted without a second publish call (race-loser-adopts contract, A-3)"
    requirement: "KEY-01"
    verification:
      - kind: unit
        ref: "web/src/lib/identity/publishOnUnlock.real-wasm.test.ts#idempotency contract: an already-published keypair is adopted without a second publish call, and the trigger does not throw"
        status: pass
    human_judgment: false
  - id: D3
    description: "A rejected publish (network failure) is swallowed silently -- publishOnUnlock never throws or surfaces an unhandled rejection to its caller (E9)"
    requirement: "KEY-01"
    verification:
      - kind: unit
        ref: "web/src/lib/identity/publishOnUnlock.real-wasm.test.ts#a rejected publish (mocked network failure) is swallowed -- publishOnUnlock never throws or surfaces an unhandled rejection to its caller"
        status: pass
    human_judgment: false
  - id: D4
    description: "All 4 setUnlockedUserKey call sites (RegisterForm.tsx, UnlockOverlay.tsx password path, UnlockOverlay.tsx PRF-pending path, passkeys/login.ts PRF unlock) invoke publishOnUnlock(uk) immediately after, with the same uk reference"
    requirement: "KEY-01"
    verification:
      - kind: unit
        ref: "web/src/components/auth/RegisterForm.test.tsx#derives auth material once, registers, logs in with the same auth_hash, and unlocks immediately"
        status: pass
      - kind: unit
        ref: "web/src/components/auth/UnlockOverlay.test.tsx#one-click unlocks from pending material without a password prompt"
        status: pass
      - kind: unit
        ref: "web/src/components/auth/UnlockOverlay.test.tsx#shows a password field and unwraps via me()+prelogin() when no pending material exists"
        status: pass
      - kind: unit
        ref: "web/src/lib/passkeys/login.test.ts#PRF-success path calls unwrapUserKey then setUnlockedUserKey directly, and does not call setPendingUnlock"
        status: pass
    human_judgment: false
  - id: D5
    description: "Live 2-account proof that the trigger actually fires against a real server and both accounts' fingerprints resolve after unlock"
    requirement: "KEY-01"
    verification: []
    human_judgment: true
    rationale: "Explicitly deferred to Plan 26-13's live 2-session e2e run per this plan's own 'Test-tiering decision' note -- the genuinely server-dependent half of KEY-01 (a real PUT persisting, a real race resolving to adopted_existing:true against a real DB row) is proven by Phase 22's unmodified identity.rs integration tests plus that later plan's live run, not by this plan's own unit suite."

# Metrics
duration: 30min
completed: 2026-08-06
status: complete
---

# Phase 26 Plan 02: KEY-01 client trigger — publishOnUnlock Summary

**A single fire-and-forget `publishOnUnlock(uk)` wrapper wired at all 4 `setUnlockedUserKey` call sites, making "every account has a published identity keypair" actually true instead of merely possible.**

## Performance

- **Duration:** ~30 min (includes fresh-worktree setup: WASM build, `npm ci` in `web/` and `packages/pv-ui/`)
- **Completed:** 2026-08-06T08:59:55Z
- **Tasks:** 2/2 completed
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments

- Created `web/src/lib/identity/publishOnUnlock.ts` — the shared, never-awaited wrapper around the already-existing, already-race-safe `ensureOwnIdentityKeypair`. Deliberately its own small module to avoid a `lib/crypto` <-> `lib/identity/ensure` circular import.
- Wired `publishOnUnlock(uk)` immediately after `setUnlockedUserKey(uk)` at all 4 real call sites: `RegisterForm.tsx:92` (before the `uk = undefined` ownership-transfer line), `UnlockOverlay.tsx:130` (PRF-pending fast path), `UnlockOverlay.tsx:166` (password path), `passkeys/login.ts:486` (passkey PRF unlock).
- Real-WASM test suite (mocks only `@/lib/identity/api`'s wire functions, never `@/lib/crypto`) proves genuine crypto: the wrapped secret key sent to the server really unwraps back to the same key material via `unwrapIdentitySecretKey`, not merely that some string was transmitted.
- Confirmed the WASM handle is freed on every path that returns one (fresh-publish and race-loser-adopt), via `vi.spyOn(WasmIdentityKey.prototype, "free")`.
- Confirmed a rejected publish never surfaces as an unhandled rejection nor throws synchronously to the caller, using a `process.on("unhandledRejection", ...)` guard in the test itself.

## Task Commits

Each task was committed atomically:

1. **Task 1: publishOnUnlock — the shared fire-and-forget wrapper** - `1919d91` (feat)
2. **Task 2: Wire publishOnUnlock into all 4 unlock call sites** - `35b3973` (feat)

_Note: this plan's tasks were `tdd="true"` in name, but each was authored test-then-implementation in the same commit rather than separate RED/GREEN commits — the plan's own `<action>` gave the exact implementation shape up front, so there was no ambiguity phase to gate with a separately-committed failing test. Both commits contain passing tests plus the implementation together._

## Files Created/Modified

- `web/src/lib/identity/publishOnUnlock.ts` - the shared fire-and-forget `publishOnUnlock(uk)` wrapper
- `web/src/lib/identity/publishOnUnlock.real-wasm.test.ts` - real-WASM proof (fresh publish + unwrap round trip, idempotent adopt, silent-failure swallow)
- `web/src/components/auth/RegisterForm.tsx` - wired `publishOnUnlock(uk)` before the ownership-transfer line
- `web/src/components/auth/UnlockOverlay.tsx` - wired `publishOnUnlock(uk)` at both the PRF-pending and password unlock paths
- `web/src/lib/passkeys/login.ts` - wired `publishOnUnlock(uk)` at the passkey PRF unlock path
- `web/src/components/auth/RegisterForm.test.tsx` - mocks `@/lib/identity/publishOnUnlock`, asserts call with the same `uk` reference
- `web/src/components/auth/UnlockOverlay.test.tsx` - same, at both unlock paths
- `web/src/lib/passkeys/login.test.ts` - same, at the PRF-success path

## Decisions Made

- `publishOnUnlock` is its own new module rather than 4x inline duplication, per 26-RESEARCH.md's Assumption A4 recommendation — a future refactor cannot miss a call site since there is exactly one wrapper to update.
- The real-WASM test file mocks `@/lib/identity/api` (the wire boundary), not `ensureOwnIdentityKeypair` itself — this exercises the REAL idempotency/race-adoption logic in `identity/ensure.ts` end-to-end with real WASM crypto, rather than assuming it behaves correctly.

## Deviations from Plan

None - plan executed exactly as written. `WasmUserKey` is exported as a type-only export from `@/lib/crypto` (not a value), so the real-WASM test uses the existing `generateUserKey()` helper function instead of `WasmUserKey.generate()` directly — this is not a deviation from the plan's own text (the plan never specified the exact generator call), just the correct API usage discovered while implementing Task 1's test.

## Issues Encountered

- Fresh worktree had no `web/public/wasm/`, no `web/node_modules/`, no `packages/pv-ui/node_modules/` (expected per this plan's own environment note) — ran `bash scripts/build-wasm.sh`, `npm ci` in both `web/` and `packages/pv-ui/` before any test could run.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- KEY-01's client trigger is now live at every unlock path — every subsequent Phase 26 surface that depends on the caller having a published identity public key (fingerprint display, collection-key sealing, sharing UI) now has real data to work with for both new and pre-v0.4 accounts, instead of depending on some other code path having incidentally called `ensureOwnIdentityKeypair` first.
- The genuinely server-dependent proof (a real double-unlock race resolving `adopted_existing: true` against a real DB row, both accounts' fingerprints resolving live) is explicitly deferred to Plan 26-13's live 2-session e2e run, per this plan's own test-tiering decision — not a gap, a planned split.
- No blockers for sibling plan 26-01 or 26-03 (disjoint `files_modified`, confirmed no overlap with `web/src/lib/vault/*` or `packages/pv-ui/identity/*`).

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: increased-endpoint-call-frequency | `crates/pv-server/src/routes/identity.rs` (unmodified) | `GET`/`PUT /api/identity/keypair` previously fired only from invite generation, member removal, and `RemoveMemberDialog` (low frequency, user-initiated actions). This plan makes it fire on EVERY unlock (password, PRF, registration, passkey sign-in) for every account — a materially higher call-volume profile on an unchanged endpoint. No new authorization surface is introduced (idempotent upsert, already proven server-side, Phase 22), but the endpoint's traffic pattern changed enough that rate-limiting/abuse-monitoring assumptions made when it was a low-frequency endpoint should be re-checked against its new near-every-unlock call rate. |
| threat_flag: mitigated (T-26-04, plan's own threat register) | `web/src/lib/identity/publishOnUnlock.ts` | WASM handle leak risk from the fire-and-forget publish — mitigated by unconditional `.then((isk) => isk.free?.())` on the resolution path, verified by `vi.spyOn(WasmIdentityKey.prototype, "free")` in both the fresh-publish and race-adopt real-WASM tests. No open follow-up. |
| threat_flag: accepted (T-26-05, plan's own threat register) | `web/src/lib/identity/publishOnUnlock.ts` (new caller only) | Concurrent double-unlock race — no new race logic introduced by this plan; `ensureOwnIdentityKeypair`'s existing idempotent-upsert contract (Phase 22, A-3) already resolves it. Accepted disposition carried forward unchanged from the plan's own threat model. |

## Self-Check: PASSED

- FOUND: web/src/lib/identity/publishOnUnlock.ts
- FOUND: web/src/lib/identity/publishOnUnlock.real-wasm.test.ts
- FOUND: web/src/components/auth/RegisterForm.tsx (modified, contains publishOnUnlock call)
- FOUND: web/src/components/auth/UnlockOverlay.tsx (modified, contains publishOnUnlock calls x2)
- FOUND: web/src/lib/passkeys/login.ts (modified, contains publishOnUnlock call)
- FOUND commit 1919d91 (Task 1)
- FOUND commit 35b3973 (Task 2)

---
*Phase: 26-web-app-sharing-ui-family-management*
*Plan: 02*
*Completed: 2026-08-06*
