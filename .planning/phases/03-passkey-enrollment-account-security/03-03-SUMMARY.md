---
phase: 03-passkey-enrollment-account-security
plan: 03
subsystem: auth
tags: [webauthn, prf, wasm, react, zero-knowledge]

requires:
  - phase: 03-passkey-enrollment-account-security
    provides: "Plan 03-01's /api/passkeys/register/start|finish and /api/passkeys/{id}/prf-wrap endpoints"
provides:
  - "WasmWrappingKey.fromPrf — client-side PRF-output-to-wrapping-key derivation, mirrors fromPassword"
  - "enrollPasskey() — the full two-ceremony (create()+get()+PRF) client orchestration function"
  - "EnrollPasskeyDialog.tsx — the 7-state ceremony UI, standalone-testable, no Settings shell dependency yet"
affects: ["03-04 (Settings panel/PasskeysTab renders this dialog)"]

tech-stack:
  added: []
  patterns:
    - "Two-ceremony WebAuthn+PRF client orchestration as a pure lib/ function (no React state), same convention as lib/vault/store.ts"
    - "Native PublicKeyCredential.parseCreationOptionsFromJSON/parseRequestOptionsFromJSON/credential.toJSON() for base64url wire handling, superseding the hand-rolled-decode sketch in 03-RESEARCH.md"

key-files:
  created:
    - crates/pv-wasm/src/lib.rs (WasmWrappingKey::fromPrf export, added to existing file)
    - web/src/lib/passkeys/api.ts
    - web/src/lib/passkeys/enroll.ts
    - web/src/lib/passkeys/enroll.test.ts
    - web/src/components/settings/EnrollPasskeyDialog.tsx
    - web/src/components/settings/EnrollPasskeyDialog.test.tsx
  modified:
    - web/src/lib/i18n/dictionary.ts (enroll.* PL/EN keys)
    - web/src/lib/crypto/index.ts (WasmWrappingKey value-export, Rule 3 fix)

key-decisions:
  - "Step-2 (get()+PRF) cancel/failure always resolves to doneNoPrf, never cancelled/failed, so a retry can't orphan the already-registered step-1 credential"
  - "doneWithPrf and doneNoPrf both render identical Check/success styling — no fake success, no hard failure, per 03-CONTEXT.md"
  - "WasmWrappingKey value-exported from lib/crypto/index.ts (was type-only) so enroll.ts can call the static fromPrf method — lib/crypto remains the sole importer of the generated wasm bindings"

patterns-established:
  - "PRF bytes cross the WASM boundary exactly once (read from getClientExtensionResults, fed straight into fromPrf which zeroizes the buffer) — never assigned to a second variable, logged, or included in a request body"

requirements-completed: [AUTH-03]

coverage:
  - id: D1
    description: "WasmWrappingKey.fromPrf derives a wrapping key from 32-byte PRF output, mirroring fromPassword, zeroizing input regardless of outcome, rejecting too-short input"
    requirement: "AUTH-03"
    verification:
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#tests::from_prf_roundtrip"
        status: pass
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#tests::from_prf_rejects_short_input"
        status: pass
    human_judgment: false
  - id: D2
    description: "enrollPasskey() orchestrates the full two-ceremony flow (create -> register/finish -> get+PRF -> prf-wrap) and treats every step-2 outcome as a successful enrollment"
    requirement: "AUTH-03"
    verification:
      - kind: unit
        ref: "web/src/lib/passkeys/enroll.test.ts#enrollPasskey > drives the full PRF-success path and calls prfWrap with the wrapped blob"
        status: pass
      - kind: unit
        ref: "web/src/lib/passkeys/enroll.test.ts#enrollPasskey > resolves to doneNoPrf and never calls prfWrap when the authenticator has no PRF support"
        status: pass
      - kind: unit
        ref: "web/src/lib/passkeys/enroll.test.ts#enrollPasskey > resolves a step-2 get() rejection to doneNoPrf, never cancelled/failed (Pitfall 3 regression)"
        status: pass
      - kind: unit
        ref: "web/src/lib/passkeys/enroll.test.ts#enrollPasskey > resolves a step-1 create() NotAllowedError rejection to cancelled"
        status: pass
      - kind: unit
        ref: "web/src/lib/passkeys/enroll.test.ts#enrollPasskey > throws before any network call when the vault is locked"
        status: pass
    human_judgment: false
  - id: D3
    description: "EnrollPasskeyDialog renders the 7-state ceremony UI, honest success styling for both PRF/no-PRF outcomes, name-prefilled retry, and blocks scrim-dismiss mid-ceremony"
    requirement: "AUTH-03"
    verification:
      - kind: unit
        ref: "web/src/components/settings/EnrollPasskeyDialog.test.tsx#EnrollPasskeyDialog > enables submit once a name is typed and calls enrollPasskey with it"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/EnrollPasskeyDialog.test.tsx#EnrollPasskeyDialog > renders the PRF-success state with the teal badge and calls onEnrolled on done"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/EnrollPasskeyDialog.test.tsx#EnrollPasskeyDialog > renders success styling (not error) with the muted badge for doneNoPrf"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/EnrollPasskeyDialog.test.tsx#EnrollPasskeyDialog > returns to Name entry with the name pre-filled after cancelled + retry"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/EnrollPasskeyDialog.test.tsx#EnrollPasskeyDialog > scrim click is a no-op during step1/step2 but closes in every other state"
        status: pass
    human_judgment: true
    rationale: "Visual/taste correctness (icon placement, badge colors, spinner treatment) against 03-UI-SPEC.md is not fully provable by DOM assertions alone — worth a quick visual check once Plan 03-04 renders this dialog inside the real Settings panel."

duration: 30min
completed: 2026-07-14
status: complete
---

# Phase 3 Plan 3: Passkey PRF Enrollment (Client) Summary

**Two-ceremony WebAuthn+PRF enrollment: `WasmWrappingKey.fromPrf` derives a wrapping key from raw PRF output inside WASM, `enrollPasskey()` orchestrates create()→register/finish→get()+PRF→prf-wrap via native `PublicKeyCredential.parse*FromJSON`, and a 7-state `EnrollPasskeyDialog` renders it honestly whether or not the authenticator supports PRF.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-07-14T09:14:00Z
- **Completed:** 2026-07-14T09:42:33Z
- **Tasks:** 3
- **Files modified:** 8 (6 created, 2 modified)

## Accomplishments
- `WasmWrappingKey.fromPrf` — a new WASM export mirroring `from_password`'s opaque-handle/zeroize discipline, deriving a wrapping key from 32-byte PRF output with no KDF pass needed
- `lib/passkeys/api.ts` + `lib/passkeys/enroll.ts` — a thin wire client plus the full two-ceremony orchestration function, using the browser's native `PublicKeyCredential.parseCreationOptionsFromJSON`/`parseRequestOptionsFromJSON`/`credential.toJSON()` methods for correct base64url handling
- `EnrollPasskeyDialog.tsx` — the 7-state ceremony UI (Name entry, step1, step2, doneWithPrf, doneNoPrf, cancelled, failed) per 03-UI-SPEC.md, independently testable with mocked `enrollPasskey`
- The single most important correctness property of this plan — a step-2 (get()+PRF) cancel/failure resolving to `doneNoPrf` rather than `cancelled`/`failed`, so a naive retry can never orphan the already-registered step-1 credential — is covered by a dedicated regression test in `enroll.test.ts`

## Task Commits

Each task was committed atomically:

1. **Task 1: pv-wasm PRF wrapping-key export** - `03b1bb3` (feat)
2. **Task 2: lib/passkeys/api.ts + enroll.ts orchestration** - `e603c02` (feat)
3. **Task 3: EnrollPasskeyDialog (7-state ceremony UI)** - `8517cc3` (feat)

**Plan metadata:** (this commit) (docs: complete plan)

## Files Created/Modified
- `crates/pv-wasm/src/lib.rs` - Added `WasmWrappingKey::fromPrf` export + `from_prf_roundtrip`/`from_prf_rejects_short_input` tests
- `web/src/lib/passkeys/api.ts` - `registerStart`/`registerFinish`/`prfWrap` thin API client (created)
- `web/src/lib/passkeys/enroll.ts` - `enrollPasskey()` two-ceremony orchestration function (created)
- `web/src/lib/passkeys/enroll.test.ts` - 5 unit tests covering the full success path, no-PRF path, the Pitfall-3 step-2-failure regression, step-1 cancellation, and the locked-vault guard (created)
- `web/src/components/settings/EnrollPasskeyDialog.tsx` - 7-state ceremony dialog UI (created)
- `web/src/components/settings/EnrollPasskeyDialog.test.tsx` - 5 component tests (created)
- `web/src/lib/i18n/dictionary.ts` - Added `enroll.*` PL/EN keys per 03-UI-SPEC.md's Copywriting Contract; deliberately did NOT add `passkeys.*`/`sessions.*`/`settings.*` keys (owned by Plan 03-04)
- `web/src/lib/crypto/index.ts` - Value-exported `WasmWrappingKey` (previously type-only) so `enroll.ts` can call its static `fromPrf` method from outside the module

## Decisions Made
- Reused `apiJson<T>`'s exact non-2xx/204/JSON-body wrapper shape from `lib/vault/api.ts` verbatim in `lib/passkeys/api.ts`, per the plan's explicit instruction not to duplicate `apiFetch`/`ApiClientError` logic
- Typed `challenge`/`credential`/`prf_challenge` as `unknown` in `lib/passkeys/api.ts` — that module is a thin wire client; `enroll.ts` is the one place that interprets WebAuthn JSON shapes via the native parse methods
- Kept the retry-with-prefilled-name behavior "for free" by simply not clearing the dialog's `name` state on cancel/fail — no extra plumbing needed since React state already persists across the state-machine transition back to `"name"`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `WasmWrappingKey` was type-only exported from `lib/crypto/index.ts`, blocking `enroll.ts`'s `WasmWrappingKey.fromPrf(...)` call**
- **Found during:** Task 2 (writing `lib/passkeys/enroll.ts`)
- **Issue:** `lib/crypto/index.ts` only `export type { WasmWrappingKey, ... }` — every existing call to `WasmWrappingKey.fromPassword` happens *inside* that module (in `deriveAuthMaterial`), never from an external file, because the class was never exported as a value. The plan's own action text (and 03-PATTERNS.md) explicitly directs `enroll.ts` to `import { WasmWrappingKey } from "@/lib/crypto"` and call `WasmWrappingKey.fromPrf(...)` as a value, which would fail to compile against the type-only export.
- **Fix:** Added `export { WasmWrappingKey };` alongside the existing `export type { WasmUserKey, WasmAuthMaterial };`, with a comment explaining the module remains the sole importer of the generated wasm bindings — only the class itself, not raw bindings, crosses the boundary.
- **Files modified:** `web/src/lib/crypto/index.ts`
- **Verification:** `npx tsc --noEmit` clean; full `npm test` suite (155 tests, including the pre-existing `lib/crypto/index.test.ts`) still green
- **Committed in:** `e603c02` (Task 2 commit)

**2. [Rule 1 - Bug] `base64Decode`'s `Uint8Array<ArrayBufferLike>` didn't satisfy `BufferSource` for `PublicKeyCredentialRequestOptions.extensions.prf.eval.first`**
- **Found during:** Task 3 (post-implementation `tsc --noEmit` check)
- **Issue:** TypeScript's current DOM lib types `BufferSource` against a plain `ArrayBuffer`, but `Uint8Array`'s generic buffer type widens to `ArrayBufferLike` (which also covers `SharedArrayBuffer`) — a real strictness mismatch, not a logic error, but it failed the typecheck.
- **Fix:** Added an explicit `as BufferSource` cast with a comment explaining why (the value is always a real, non-shared `Uint8Array`).
- **Files modified:** `web/src/lib/passkeys/enroll.ts`
- **Verification:** `npx tsc --noEmit` clean
- **Committed in:** `8517cc3` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking export-visibility fix, 1 blocking TS-strictness cast)
**Impact on plan:** Both auto-fixes were required for the code to compile at all; neither changes runtime behavior or the zero-knowledge/crypto boundary. No scope creep.

## Issues Encountered
- `web/node_modules` was not installed at the start of this plan's execution (fresh worktree checkout) — ran `npm install` once before the first `npm test` invocation; not a plan deviation, just environment setup.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 03-04 can render `EnrollPasskeyDialog` from its `PasskeysTab`/`SettingsPanel` shell, passing `onEnrolled` as a list-refresh callback — no changes needed to this plan's public surface
- `passkeys.*`/`sessions.*`/`settings.*` dictionary keys are still owned by 03-04, as this plan deliberately left them untouched
- No blockers. Full verification (`cargo test -p pv-wasm`, `npm --prefix web test`, `npx tsc --noEmit`) is green

---
*Phase: 03-passkey-enrollment-account-security*
*Completed: 2026-07-14*

## Self-Check: PASSED

All 8 files created/modified in this plan verified present on disk; all 3 task commits (`03b1bb3`, `e603c02`, `8517cc3`) verified present in git log.
