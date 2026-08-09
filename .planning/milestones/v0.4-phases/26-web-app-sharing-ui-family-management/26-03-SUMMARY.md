---
phase: 26-web-app-sharing-ui-family-management
plan: 03
subsystem: ui
tags: [typescript, bip39, wordlist, fingerprint, vitest, vendoring]

# Dependency graph
requires:
  - phase: 22-24 (sharing/authorization backend)
    provides: "families.rs's already-computed SHA-256 hex fingerprint field on FamilyMemberRecord"
provides:
  - "packages/pv-ui/identity/fingerprintWordlist.ts — vendored, verified 2048-entry BIP-39 English wordlist (FINGERPRINT_WORDLIST)"
  - "packages/pv-ui/identity/fingerprint.ts — fingerprintToWords(hex) / formatFingerprintWords(hex), pure hex-to-six-word transform (D-4, A-9, SEC-05)"
  - "package.json exports map entries for pv-ui/identity/fingerprint and pv-ui/identity/fingerprintWordlist"
  - "packages/pv-ui now has its own vitest test runner (previously had none)"
affects: ["26-12 (FamilyTab identity fingerprint card)", "27 (extension, same client trigger + shared identity module)"]

# Tech tracking
tech-stack:
  added: ["vitest ^3.2.4 as packages/pv-ui devDependency (previously only web/ and extension/ had their own)"]
  patterns:
    - "Second vendored-wordlist precedent (after EFF_WORDLIST) — top-of-file comment names source URL, exact count, and explicit non-purpose"
    - "identity/ submodule follows the same package.json exports-map convention as generator/, vault/, components/*"

key-files:
  created:
    - packages/pv-ui/identity/fingerprintWordlist.ts
    - packages/pv-ui/identity/fingerprint.ts
    - packages/pv-ui/identity/fingerprint.test.ts
  modified:
    - packages/pv-ui/package.json
    - packages/pv-ui/package-lock.json

key-decisions:
  - "Fetched the canonical BIP-39 English wordlist live from github.com/bitcoin/bips before vendoring and verified 2048 lines / 2048 unique lowercase entries — closing RESEARCH.md's Assumption A1, which had explicitly flagged the source as unfetched/unverified."
  - "Big-endian 11-bit bit-slice over the leading 66 bits of the 32-byte SHA-256 digest, MSB-first within each byte and across the 6-word sequence — matches A-9 and BIP-39's own entropy-to-word-index convention."
  - "fingerprintToWords fails closed (throws) on any non-hex character or any length other than exactly 64 hex chars, rather than truncating/padding to a plausible-but-wrong six words."
  - "Added vitest as a packages/pv-ui devDependency (it had none) so this plan's own <verify> command is actually runnable — the package previously had an orphaned test file (generator/password.test.ts) with no way to run it standalone."
  - "Added identity/fingerprint and identity/fingerprintWordlist to package.json's exports map, matching the existing generator/vault/components resolution convention, so Plan 26-12 (and Phase 27's extension) can import via 'pv-ui/identity/fingerprint' rather than a relative path."

requirements-completed: [SEC-05]

coverage:
  - id: D1
    description: "Vendored 2048-word BIP-39 English wordlist, verified exactly 2048 unique lowercase entries"
    requirement: "SEC-05"
    verification:
      - kind: unit
        ref: "packages/pv-ui/identity/fingerprint.test.ts#wordlist has exactly 2048 entries"
        status: pass
      - kind: unit
        ref: "packages/pv-ui/identity/fingerprint.test.ts#wordlist every entry is a unique, lowercase, non-empty string"
        status: pass
    human_judgment: false
  - id: D2
    description: "fingerprintToWords/formatFingerprintWords: pure, deterministic, total hex-to-six-word transform with a known-answer vector and fail-closed malformed-input handling"
    requirement: "SEC-05"
    verification:
      - kind: unit
        ref: "packages/pv-ui/identity/fingerprint.test.ts#fingerprintToWords matches the hand-computed known-answer vector"
        status: pass
      - kind: unit
        ref: "packages/pv-ui/identity/fingerprint.test.ts#fingerprintToWords matches the hand-computed 11-bit indices, not just the resulting words"
        status: pass
      - kind: unit
        ref: "packages/pv-ui/identity/fingerprint.test.ts#fingerprintToWords is a total, pure function: identical hex always produces identical words, in identical order"
        status: pass
      - kind: unit
        ref: "packages/pv-ui/identity/fingerprint.test.ts#fingerprintToWords throws on a wrong-length hex string rather than silently truncating or padding"
        status: pass
      - kind: unit
        ref: "packages/pv-ui/identity/fingerprint.test.ts#fingerprintToWords throws on non-hex characters rather than silently producing a partial word list"
        status: pass
      - kind: unit
        ref: "packages/pv-ui/identity/fingerprint.test.ts#formatFingerprintWords joins the six words with D-4's ' · ' separator"
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-08-06
status: complete
---

# Phase 26 Plan 03: Six-Word Identity Fingerprint Summary

**Pure, deterministic hex-to-six-word fingerprint transform over a freshly-fetched-and-verified 2048-word BIP-39 wordlist — no new hash, no new server field, no npm dependency.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-06T10:56:31+02:00 (first commit)
- **Completed:** 2026-08-06T10:58:20+02:00 (last commit)
- **Tasks:** 2
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- Vendored the canonical public-domain BIP-39 English wordlist (2048 entries) as `FINGERPRINT_WORDLIST` — fetched live from `github.com/bitcoin/bips` and verified (exactly 2048 lines, 2048 unique lowercase entries, no whitespace) *before* committing, closing RESEARCH.md's Assumption A1.
- Implemented `fingerprintToWords(hex)` / `formatFingerprintWords(hex)`: a pure, total, deterministic transform of the server-served SHA-256 hex fingerprint into six words, per A-9's exact big-endian 66-bit / six-11-bit-index bit-slicing scheme.
- Regression-tested via a hand-computed known-answer vector that asserts both the final words AND the intermediate 11-bit indices (catching an off-by-one in the bit-slicing itself, not just a coincidentally-plausible final string).
- Made `packages/pv-ui`'s own test suite runnable for the first time (`npx vitest run` from inside the package) and exposed the new module through the package's established `exports` map convention.

## Task Commits

Each task was committed as an explicit RED→GREEN TDD cycle, plus one infra prerequisite and one exports-map follow-up:

1. **Infra prerequisite:** `253c29d` (chore) — add vitest devDependency to `packages/pv-ui`
2. **Task 1 RED:** `0cf3952` (test) — failing wordlist-length/uniqueness tests (import of nonexistent module)
3. **Task 1 GREEN:** `18ca177` (feat) — vendor `FINGERPRINT_WORDLIST`
4. **Task 2 RED:** `0ebe969` (test) — failing `fingerprintToWords`/`formatFingerprintWords` tests (import of nonexistent module)
5. **Task 2 GREEN:** `33c55c5` (feat) — implement the pure hex-to-six-word transform
6. **Follow-up:** `bc78bcd` (feat) — expose `identity/fingerprint` and `identity/fingerprintWordlist` via `package.json`'s exports map

_TDD Gate Compliance: both tasks show a `test(...)` commit immediately followed by a `feat(...)` commit, with the intervening `npx vitest run identity/fingerprint.test.ts` run confirmed RED then GREEN at each step — see git log above._

## Files Created/Modified

- `packages/pv-ui/identity/fingerprintWordlist.ts` — vendored 2048-word BIP-39 English wordlist, `FINGERPRINT_WORDLIST`
- `packages/pv-ui/identity/fingerprint.ts` — `fingerprintToWords(hex)`, `formatFingerprintWords(hex)`
- `packages/pv-ui/identity/fingerprint.test.ts` — wordlist integrity tests + known-answer-vector/determinism/fail-closed tests for the transform
- `packages/pv-ui/package.json` — added `vitest` devDependency, a `test` script, and two new `exports` entries
- `packages/pv-ui/package-lock.json` — regenerated for the new devDependency

## Decisions Made

- **Wordlist source verified live, not trusted blindly.** Fetched `bip-0039/english.txt` from `github.com/bitcoin/bips` via `curl`, confirmed `wc -l` = 2048 and `sort -u | wc -l` = 2048 (no duplicates) before writing the vendored file — RESEARCH.md's Assumption A1 explicitly flagged this as unverified going into this plan.
- **Bit-slicing implemented as documented in A-9:** decode the 64-char hex to 32 bytes, read the leading 66 bits MSB-first (byte 0's most significant bit is bit 0 of the stream), split into six 11-bit unsigned integers in sequence, index the wordlist with each. Only the first 9 bytes of the 32-byte digest are ever read.
- **Fail-closed on malformed input, matching WR-13 discipline.** Both a non-hex character and any hex length other than exactly 64 throw immediately with a descriptive error — the function never truncates, pads, or wraps around to produce output that merely *looks* like a valid six-word fingerprint.
- **`packages/pv-ui` given its own vitest devDependency.** The package previously had a test file (`generator/password.test.ts`) but no way to run it standalone (`npx vitest` would fail — no devDependency, no lockfile entry). This plan's own `<verify>` command requires `cd packages/pv-ui && npx vitest run identity/fingerprint.test.ts` to work, so this was a necessary Rule 3 blocking-issue fix, not scope creep — no project-wide `tsconfig.json` was added (packages/pv-ui deliberately has none per Phase 17-01's precedent; type-checking still happens through the consuming project's own `tsc`, e.g. `web`'s, once Plan 26-12 wires the import).
- **Exports map entries added for the new module**, matching the exact convention every other `pv-ui` submodule already uses (`generator/*`, `vault/*`, `components/*`) — this is how Plan 26-12's `FamilyTab` and Phase 27's extension will import `fingerprintToWords`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `packages/pv-ui` had no test runner**
- **Found during:** Task 1 (attempting to run `npx vitest run identity/fingerprint.test.ts` for the very first RED check)
- **Issue:** `packages/pv-ui/package.json` had no `vitest` devDependency and no matching `package-lock.json` entry — `npx vitest` would either fail outright or silently fetch an unpinned version from the registry.
- **Fix:** Added `"vitest": "^3.2.4"` (same range `web/package.json` already pins) as a devDependency and a `"test": "vitest run"` script; ran `npm install` to regenerate the lockfile.
- **Files modified:** `packages/pv-ui/package.json`, `packages/pv-ui/package-lock.json`
- **Verification:** `npx vitest run identity/fingerprint.test.ts` runs and reports results (RED then GREEN, both confirmed) instead of failing to find the `vitest` binary.
- **Committed in:** `253c29d`

**2. [Rule 2 - Missing Critical] New module unreachable by consumers without an exports-map entry**
- **Found during:** Task 2 completion, cross-checking against the plan's own `key_links` ("... rendered verbatim in Plan 26-12's `FamilyTab` card")
- **Issue:** Every other `pv-ui` submodule is resolved by consumers exclusively through `package.json`'s `exports` map (D-13's `file:` dependency mechanism — no npm/yarn workspaces, no path aliases). Without an entry, `identity/fingerprint.ts` would be unimportable from `web`/`extension` despite existing on disk.
- **Fix:** Added `./identity/fingerprint` and `./identity/fingerprintWordlist` entries to the exports map, matching the exact shape of the existing `generator/*`/`vault/*`/`components/*` entries.
- **Files modified:** `packages/pv-ui/package.json`
- **Verification:** Entry shape matches existing entries exactly (types + default both pointing at the `.ts` source, since this package is source-only / consumers transpile it themselves).
- **Committed in:** `bc78bcd`

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing-critical)
**Impact on plan:** Both were necessary to make the plan's own `<verify>` command runnable and the plan's own stated purpose ("Plan 26-12's FamilyTab card ... needs" this module) achievable. No architectural changes, no new npm dependency beyond the already-established `vitest`/version-matching pattern used by `web`/`extension`. No scope creep into `crates/pv-server`, `web/src/lib/vault`, `web/src/lib/identity`, or `web/src/components/auth` (sibling plans' territory).

## Issues Encountered

- `npx tsc --version` failed inside `packages/pv-ui` because the package has no `typescript` devDependency and no project-wide `tsconfig.json` — this is a **deliberate** pre-existing architectural decision from Phase 17-01 ("Neither `web/tsconfig.json` nor `extension/tsconfig.json` gains a new path alias" — `pv-ui` typechecks only through its consumers' own `tsc`, never standalone). Resolved by running an ad hoc, non-persisted typecheck instead: `npx --package=typescript@5.9.3 -- tsc --noEmit --strict --skipLibCheck identity/fingerprint.ts identity/fingerprintWordlist.ts identity/fingerprint.test.ts` — zero errors reported against any of the three new files (all errors from an earlier attempt without `--skipLibCheck` were exclusively inside `node_modules/vite`/`vitest`/`rollup`'s own `.d.ts` files, caused by the package legitimately lacking `@types/node`, and none referenced my source). No `tsconfig.json` was added to `packages/pv-ui` — that would be an architectural change beyond this plan's scope, and standalone `tsc` was never this plan's actual `<verify>` requirement (only the orchestrator's advisory environment note).
- `cd web && npx tsc --noEmit` (the environment note's second conditional check) was not run: `web` has no installed `node_modules` in this fresh worktree and does not yet import `identity/fingerprint.ts` — Plan 26-12 is the plan that wires that import. The note's own wording ("if `web` consumes your export") makes this check conditional and, at this plan's execution time, not yet applicable.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: none | packages/pv-ui/identity/fingerprint.ts, packages/pv-ui/identity/fingerprintWordlist.ts | No new trust boundary or secret material introduced. `fingerprintToWords` is a pure client-side presentation transform over the SHA-256 hex fingerprint the server already computes and serves (`crates/pv-server/src/routes/families.rs:153-155`) — a non-secret, already-public derivation of an already-published X25519 public key. No new network call, no new hash, no I/O. On malformed input (wrong length or non-hex characters) the function throws immediately rather than silently truncating, padding, or wrapping to produce a plausible-but-wrong six-word output — this fail-closed behavior is the security-relevant property here: a fingerprint that *looks* valid but doesn't match its true 66-bit slice would defeat the entire out-of-band voice-comparison defense (T-26-06 in the plan's threat register) by teaching a member to trust a corrupted or truncated rendering. The derivation is a pure function of its hex input with no session/device/time/locale dependence, so two honest clients given the same fingerprint hex are mathematically guaranteed to render identical words — the property the whole out-of-band comparison depends on. |

## Known Stubs

None. Both `fingerprintToWords` and `formatFingerprintWords` are fully wired pure functions with real implementations and no placeholder/mock data paths. This plan deliberately does not wire either function into any UI component — that is explicitly Plan 26-12's scope, not a stub in this plan's own deliverable.

## Next Phase Readiness

- `fingerprintToWords`/`formatFingerprintWords` are ready to be imported by Plan 26-12 via `pv-ui/identity/fingerprint` for the `FamilyTab` identity fingerprint card, and by Phase 27's extension work for the same client trigger.
- No blockers. `packages/pv-ui` now has a working, isolated vitest test runner that future `pv-ui`-only plans can reuse without re-solving this same bootstrap problem.

---
*Phase: 26-web-app-sharing-ui-family-management*
*Completed: 2026-08-06*
