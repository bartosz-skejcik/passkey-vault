# Deferred Items — Phase 11 Plan 01

## Pre-existing tsc errors (out of scope, unrelated to this plan's files)

`cd extension && npx tsc --noEmit` reports 3 pre-existing errors in files NOT
touched by this plan, present before any Task 1-3 edits:

- `entrypoints/background/vault-session.ts(184,56)` — Uint8Array|undefined arg type
- `lib/crypto/wasm-loader.ts(24,8)` — Cannot find module `./wasm/pv_wasm.js`
- `lib/crypto/wasm-loader.ts(98,42)` — PublicPath overload mismatch for `/wasm/pv_wasm_bg.wasm`

Root cause: the WASM build artifact (`extension/lib/crypto/wasm/`) does not
exist in this fresh worktree checkout — it is produced by
`scripts/build-wasm.sh`, which requires `wasm-bindgen-cli` (not installed in
this environment) and a `cargo build --target wasm32-unknown-unknown` pass.
Confirmed pre-existing via `git log` on `wasm-loader.ts` (last touched in
Phase 10, unrelated to Phase 11). None of this plan's files
(`ext-protocol.ts`, `router.ts`, `generator/*`, `generate-handler.ts`)
appear in the tsc error output.

Out of scope per execute-plan.md's SCOPE BOUNDARY rule — not fixed here.

## Pre-existing router.test.ts failure (unrelated to Task 3's wiring)

`npx vitest run entrypoints/background/router.test.ts` fails to LOAD (not a
test failure -- a module-load error) with the same missing-WASM-artifact
root cause as above: router.ts imports `handleAutofillFill`/
`handleAutofillMatch`/`handleAutofillTotpCode` from `./autofill-match`,
which router.test.ts has never mocked (confirmed via `git show` on this
plan's base commit `0902ff7` -- the gap predates Phase 11 entirely).
`autofill-match.ts` itself directly imports `totpNow` from
`../../lib/crypto/wasm-loader`, which fails to load for the same reason as
above.

Confirmed NOT caused by this plan's Task 3 changes: reproduced via
`git stash` with only this plan's Task 1/2 commits applied (before any
router.ts/router.test.ts edits) -- the failure is identical. This plan's
own `<verification>` block does not include router.test.ts or the full
suite (only `tsc --noEmit`, `vitest run lib/generator`, and
`vitest run entrypoints/background/generate-handler`), so this is
out of scope per execute-plan.md's SCOPE BOUNDARY rule -- not fixed here.
A future plan touching router.test.ts's autofill-match coverage, or a
wasm-bindgen-cli install to unblock the whole suite, should pick this up.
