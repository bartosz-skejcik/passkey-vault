---
phase: 15-login-unlock-unification-vaultwarden-model
plan: 06
subsystem: extension-i18n-testing
tags: [typescript, extension, vitest, dictionary, structural-guard]

# Dependency graph
requires:
  - phase: 15-login-unlock-unification-vaultwarden-model
    provides: "Plan 15-03's SignInView/UnlockView rewrite and Plan 15-04's hard deletion of the 9 ext-scoped-PRF files/6 message kinds -- both removed every live consumer of the dictionary keys and string literals this plan purges/guards"
provides:
  - "dictionary.ts pruned of all 18 dead ext-scoped-PRF keys (extPasskey.* block x10, unlock.passkeyLoginCta/passkeyBusy/passkeyFailed/passkeyUnsupported/serverCeremonyCta/serverCeremonySigninCta x6, auth.emailLabel/wrongCredentials x2)"
  - "extension/entrypoints/__tests__/no-ext-scoped-prf-strings.test.ts: permanent grep-based structural guard proving zero ext-scoped-PRF string literal survives anywhere in extension/entrypoints/** or extension/lib/**"
  - "AUTH-03 closed as a durable, mechanically-proven invariant, not a one-time deletion pass"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Structural regression guards (server-config.test.ts's URL-literal walk, now this dictionary/message-kind walk) intentionally scan *.test.ts/*.test.tsx too when the threat is a stale reference surviving anywhere in source, including test fixtures -- unlike guards whose threat model is specifically shipped production code reaching a real network call, which legitimately exclude test files as mock-fixture territory"

key-files:
  created:
    - extension/entrypoints/__tests__/no-ext-scoped-prf-strings.test.ts
  modified:
    - extension/lib/i18n/dictionary.ts
    - extension/entrypoints/background/router.ts
    - extension/entrypoints/background/router.test.ts
    - extension/lib/messaging/ext-protocol.ts

key-decisions:
  - "The new guard's own first run caught 3 leftover literal-string references not anticipated by the plan's <files> list (router.ts, ext-protocol.ts doc comments naming the deleted kinds verbatim; router.test.ts's AUTH-03 describe block using the exact deleted \"extPasskey.enroll.start\" string as a negative-test fixture). Reworded the two doc comments to describe the removal without repeating the literal names, and generalized the router.test.ts fixture to an arbitrary unrecognized kind -- the specific-string proof now lives permanently in the new guard test itself, so the literal fixture was redundant rather than a loss of coverage."
  - "Manual server-side dev-database cleanup command documented here per the plan's explicit instruction (never as product code): the extension_passkeys table and its CRUD routes are deliberately untouched by this phase (writes simply stopped once Plan 15-04 removed the only client-side caller) -- run `sqlite3 data/pv.db \"DELETE FROM extension_passkeys;\"` against your own dev database if you want to purge now-orphaned rows. Not required for correctness; purely optional housekeeping."

patterns-established: []

requirements-completed: [AUTH-03]

coverage:
  - id: D1
    description: "All 18 dead ext-scoped-PRF dictionary keys grep-verified to have zero remaining references before deletion, then removed from DICTIONARY"
    requirement: AUTH-03
    verification:
      - kind: automated_ui
        ref: "cd extension && grep -c '\"extPasskey\\.' lib/i18n/dictionary.ts | grep -qx 0 -- Task 1's own verify gate"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit clean -- proves no t(locale, \"...\") call site anywhere references a now-deleted key against the narrowed DICTIONARY key union"
        status: pass
    human_judgment: false
  - id: D2
    description: "unlock.serverCeremonySigninFailed's PL/EN copy re-verified to already carry no stale 'or use your password' clause (Plan 15-03 had already fixed it)"
    requirement: AUTH-03
    verification:
      - kind: other
        ref: "Manual re-read of dictionary.ts lines confirming current copy: PL 'Nie udało się zalogować przez stronę serwera. Spróbuj ponownie.' / EN 'Couldn't sign in via your server. Try again.' -- no password-fallback clause"
        status: pass
    human_judgment: false
  - id: D3
    description: "Permanent grep-based structural guard proves zero occurrence of extPasskey./extPrf/ext-passkey/ext-prf/prf-capability anywhere in extension/entrypoints/** or extension/lib/** (including test files)"
    requirement: AUTH-03
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/no-ext-scoped-prf-strings.test.ts > no_ext_scoped_prf_strings_survive"
        status: pass
    human_judgment: false
  - id: D4
    description: "Full extension vitest + tsc green after both tasks land"
    verification:
      - kind: unit
        ref: "cd extension && npx vitest run && npx tsc --noEmit -- 52 test files / 678 tests passing (+1 vs baseline 677, the new guard test), tsc clean"
        status: pass
    human_judgment: false

# Metrics
duration: ~20min
completed: 2026-07-20
status: complete
---

# Phase 15 Plan 06: Dictionary Cleanup + Permanent AUTH-03 Structural Guard Summary

**Purged all 18 dead ext-scoped-PRF dictionary keys and added a permanent grep-based vitest guard (mirroring server-config.test.ts's URL-literal walk) that fails any future PR reintroducing an ext-scoped-PRF string anywhere in extension source -- closing AUTH-03 as a durable, mechanically-proven invariant rather than a one-time deletion pass.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments
- Deleted 18 dead dictionary keys from `dictionary.ts`: the entire `extPasskey.*` block (10 keys), `unlock.passkeyLoginCta`/`passkeyBusy`/`passkeyFailed`/`passkeyUnsupported`/`serverCeremonyCta`/`serverCeremonySigninCta` (6 keys), `auth.emailLabel`/`auth.wrongCredentials` (2 keys) -- each grep-verified to have zero remaining textual references (key-string level, not just object-literal) under `extension/entrypoints/**`/`extension/lib/**` before deletion
- Re-verified `unlock.serverCeremonySigninFailed`'s copy already carries the corrected, non-stale wording from Plan 15-03 (no "or use your password" clause) -- no fix needed
- Created `extension/entrypoints/__tests__/no-ext-scoped-prf-strings.test.ts`, a permanent structural guard mirroring `server-config.test.ts`'s `no_other_extension_file_hard_codes_a_server_url` walk pattern, with two deliberate deviations from that precedent: it scans `*.test.ts`/`*.test.tsx` too (test fixtures are exactly where a stale string could hide), and its skip-dirs set does NOT exclude `e2e/` (a leftover string there is meaningful signal, not legitimate mock territory)
- The guard's first run caught 3 unanticipated leftover literal references (out of the plan's declared `files_modified`) -- fixed under Rule 3 since they blocked the task's own verify gate

## Task Commits

Each task was committed atomically:

1. **Task 1: Purge dead dictionary keys** - `54bc2b8` (feat)
2. **Task 2: Structural guard test — AUTH-03 closure proof** - `e620d02` (test)

## Files Created/Modified

**Created (Task 2):**
- `extension/entrypoints/__tests__/no-ext-scoped-prf-strings.test.ts` - permanent regression guard, 1 test, walks `entrypoints/`+`lib/` for 5 forbidden substrings

**Modified (Task 1):**
- `extension/lib/i18n/dictionary.ts` - 96 lines removed (18 keys + their doc comments)

**Modified (Task 2, Rule 3 -- own verify gate):**
- `extension/entrypoints/background/router.ts` - header comment reworded to describe the removed extension-scoped-PRF message kinds without repeating their literal names
- `extension/lib/messaging/ext-protocol.ts` - header comment reworded, same reason
- `extension/entrypoints/background/router.test.ts` - the `AUTH-03 hard removal (Plan 15-04)` describe block's first test generalized from the literal `"extPasskey.enroll.start"` fixture to an arbitrary unrecognized-kind fixture (`"not-a-recognized-message-kind"`); block-level comment updated to cross-reference the new guard

## Manual Server-Side Cleanup (Bartek's own dev database, optional)

Per the plan's explicit instruction, this phase deliberately does NOT touch the server-side `extension_passkeys` table or its CRUD routes -- writes simply stopped once Plan 15-04 removed the only client-side caller, no migration needed. If you want to purge now-orphaned rows from your own dev database (not required for correctness):

```bash
sqlite3 data/pv.db "DELETE FROM extension_passkeys;"
```

## Decisions Made
- The guard's own literal-substring scan caught 3 leftover references not in this plan's declared `files_modified` (2 doc comments, 1 test fixture using the exact deleted kind name). Reworded rather than narrowing the guard's scope, per Rule 3 and this phase's established precedent (15-04's own Deviation #1 handled an identical situation the same way).
- Router.test.ts's negative-test fixture was generalized (arbitrary unrecognized kind) rather than removed outright -- it still exercises the same `isProtocolMessage()` "unrecognized kind steps aside" code path; the specific-literal-string proof now lives permanently and more robustly in the new structural guard test itself, so genericizing the fixture loses no coverage.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reworded 2 doc comments + 1 test fixture that tripped the new guard's own first run**
- **Found during:** Task 2 (running the newly-created guard test before commit)
- **Issue:** The guard's forbidden-substring scan (`extPasskey.`, `extPrf`, `ext-passkey`, `ext-prf`, `prf-capability`) is intentionally comprehensive across `extension/entrypoints/**`/`extension/lib/**` including test files. Three leftover literal references -- outside this task's declared `files_modified` -- tripped it on first run: `router.ts`'s header comment named `` `extPasskey.*`/`unlock.extPrf.*` `` verbatim; `ext-protocol.ts`'s header comment did the same; `router.test.ts`'s `AUTH-03 hard removal` describe block used the exact deleted `"extPasskey.enroll.start"` string as a negative-test fixture (dispatching it to assert `isProtocolMessage()` now rejects it).
- **Fix:** Reworded both header comments to describe the removal without repeating the literal kind names (each now cross-references this plan's new guard test for the authoritative record). Generalized the `router.test.ts` fixture to an arbitrary unrecognized kind (`"not-a-recognized-message-kind"`), preserving the same "unrecognized kind steps aside" behavioral assertion without perpetuating the specific dead literal.
- **Files modified:** `extension/entrypoints/background/router.ts`, `extension/lib/messaging/ext-protocol.ts`, `extension/entrypoints/background/router.test.ts`
- **Verification:** `npx vitest run entrypoints/__tests__/no-ext-scoped-prf-strings.test.ts entrypoints/background/router.test.ts` both green (39 tests); full suite 52 files/678 tests passing; `npx tsc --noEmit` clean.
- **Committed in:** `e620d02` (Task 2 commit, same commit as the new guard test -- both are the same atomic unit of work per this task's own verify gate)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking, required for the plan's own declared verify gate to pass)
**Impact on plan:** No scope creep -- the deviation was textually forced by the newly-created guard's own strict scan, discovered and fixed within the same task before commit. No behavior changed beyond comment wording and one test fixture's literal value; the fixture's regression-coverage intent (unrecognized kind rejected) is fully preserved.

## Issues Encountered

None beyond the auto-fixed deviation above.

## User Setup Required

None — the manual `sqlite3` cleanup command above is optional dev-database housekeeping, not a required setup step.

## Next Phase Readiness

- AUTH-03 is now closed with a durable, permanent, mechanically-enforced guarantee (not just a historical deletion pass): any future PR that reintroduces an ext-scoped-PRF string anywhere in `extension/entrypoints/**` or `extension/lib/**` will fail `no-ext-scoped-prf-strings.test.ts`.
- No blockers introduced by this plan. `dictionary.ts` carries zero dead keys from this phase's scope.

---
*Phase: 15-login-unlock-unification-vaultwarden-model*
*Completed: 2026-07-20*

## Self-Check: PASSED

Verified `extension/entrypoints/__tests__/no-ext-scoped-prf-strings.test.ts` exists on disk; both task commits (`54bc2b8`, `e620d02`) confirmed present in `git log --oneline`; full suite re-run at self-check time: 52 test files / 678 tests passing, `npx tsc --noEmit` clean.
