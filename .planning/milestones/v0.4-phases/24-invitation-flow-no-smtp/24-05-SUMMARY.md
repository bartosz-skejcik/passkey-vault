---
phase: 24-invitation-flow-no-smtp
plan: 05
subsystem: api
tags: [typescript, wasm-bindgen, vitest, invitations, identity, i18n]

# Dependency graph
requires:
  - phase: 24-invitation-flow-no-smtp (Plan 24-02)
    provides: "Live /api/invitations/* surface (create/fetch_metadata/accept/revoke, Amendment 2 proof-of-possession)"
  - phase: 24-invitation-flow-no-smtp (Plan 24-03)
    provides: "WasmInviteChannel opaque handle + generateInviteSecret() wasm-bindgen bridge"
  - phase: 22-family-sharing-collections
    provides: "PUT/GET /api/identity/keypair endpoint (KEY-01 idempotent upsert), unwired until this plan"
provides:
  - "web/src/lib/crypto/index.ts widened to re-export Phase 21/24's identity/collection/invite WASM bindings as values — still the sole ./wasm importer"
  - "web/src/lib/identity/{api,ensure}.ts — ensureOwnIdentityKeypair, the phase's first real caller of PUT /api/identity/keypair, with a tested concurrent-loser-adopts-canonical-key resolution"
  - "web/src/lib/invite/{api,crypto}.ts — generateInviteLink (family-only + collection-scoped), fetchInviteMetadataFlow/redeemInviteFlow (self-consistency check before any network call, proof_hash vs invite_proof never conflated)"
  - "web/src/lib/vault/api.ts's new getCollection — the single-collection-fetch client the invite flow needed and no prior plan had built"
  - "41 new i18n keys (35 invite.*, 5 family.*, 1 settings.tabFamily) in web/src/lib/i18n/dictionary.ts, copied verbatim from 24-UI-SPEC.md"
affects: [24-06-invite-landing-ui, 24-07-owner-invite-panel, 24-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Choke-point value re-export: opaque WASM handle classes (WasmIdentityKey/WasmIdentityPublicKey/WasmCollectionKey/WasmInviteChannel) are exported as VALUES from lib/crypto/index.ts, not just types, exactly like the pre-existing WasmWrappingKey — any consumer needing a static constructor (.generate()/.fromBytes()/.fromSecret()) imports the class itself from this one choke-point, never from ./wasm directly"
    - "Capture-before-zeroize: a raw secret's caller-visible encoding (secretForUrl = base64UrlEncode(secretBytes)) is always computed BEFORE the WASM call that zeroizes the same buffer (WasmInviteChannel.fromSecret), mirroring WasmWrappingKey.fromPassword's existing discipline"
    - "Derive-independently-twice over thread-a-handle: fetchInviteMetadataFlow and redeemInviteFlow each reconstruct their own WasmInviteChannel from the secretFragment STRING rather than sharing one WASM object across two async call sites/React state — the string is the value that must survive the flow, not the derived handle"
    - "404-as-null via apiJson+catch: getIdentityKeypair calls the shared apiJson (not a second inline copy of its error-body parsing) and converts an ApiClientError with status 404 into null, keeping the WR-11 single-apiJson-implementation invariant intact"

key-files:
  created:
    - web/src/lib/identity/api.ts
    - web/src/lib/identity/ensure.ts
    - web/src/lib/identity/ensure.test.ts
    - web/src/lib/invite/api.ts
    - web/src/lib/invite/crypto.ts
    - web/src/lib/invite/crypto.test.ts
  modified:
    - web/src/lib/crypto/index.ts
    - web/src/lib/i18n/dictionary.ts
    - web/src/lib/vault/api.ts
    - web/package.json

key-decisions:
  - "lib/crypto/index.ts exports WasmIdentityKey/WasmIdentityPublicKey/WasmCollectionKey/WasmInviteChannel as VALUES (export { ... }), not merely as types (the plan's literal action text said 'export type') — Task 1/2's own action text immediately calls static methods on these classes (WasmIdentityKey.generate(), WasmInviteChannel.fromSecret(), WasmIdentityPublicKey.fromBytes()) from outside this module, which requires a value import; a type-only export would not compile. Followed the binding shape WasmWrappingKey already established (export as value, which subsumes the type) rather than the plan's literal sub-clause."
  - "getIdentityKeypair converts a 404 to null via apiJson + catch(ApiClientError) rather than duplicating apiJson's own non-ok-status body-parsing inline (as the plan's action text literally described) — preserves the WR-11 single-shared-error-parsing-implementation invariant this codebase already established, with identical observable behavior (404 -> null, everything else -> throw)."
  - "web/src/lib/vault/api.ts gained getCollection (not in this plan's own files_modified frontmatter list) — Task 2's own read_first explicitly anticipated this: 'if none exists, add a minimal getCollection(id) here rather than in lib/invite/'. No single-collection-fetch client existed; generateInviteLink's collection-scope branch needs the caller's own sealed_key before re-wrapping it under the invite channel."
  - "web/package.json gained a typecheck script (aliasing the existing tsc --noEmit already exposed as 'compile') — the plan's own <verification> block and 24-VALIDATION.md both invoke `npm --prefix web run typecheck`, which had no matching script anywhere in the repo (Rule 3 blocking-issue auto-fix, not an architectural change)."
  - "fetchInviteMetadataFlow/redeemInviteFlow each derive their own WasmInviteChannel independently from the secretFragment string, exactly as the plan specified, rather than threading one WASM handle across the two call sites."

patterns-established:
  - "Choke-point-value-re-export: every future opaque WASM handle class this codebase adds should be re-exported as a value from lib/crypto/index.ts (mirrors WasmWrappingKey), not gated behind export type alone, whenever a downstream module needs to call a static constructor on it."

requirements-completed: [FAM-04, FAM-06]

coverage:
  - id: D1
    description: "ensureOwnIdentityKeypair generates+publishes a fresh keypair when none exists, unwraps the existing one when one is already published, and resolves a concurrent race by discarding the loser's local handle and adopting the server's canonical published key"
    requirement: "FAM-06"
    verification:
      - kind: unit
        ref: "web/src/lib/identity/ensure.test.ts#ensureOwnIdentityKeypair > generates and publishes a fresh keypair when the account has none yet"
        status: pass
      - kind: unit
        ref: "web/src/lib/identity/ensure.test.ts#ensureOwnIdentityKeypair > unwraps and returns the ALREADY-published keypair without generating a second one"
        status: pass
      - kind: unit
        ref: "web/src/lib/identity/ensure.test.ts#ensureOwnIdentityKeypair > concurrent-loser path: discards the locally-generated handle and adopts the server's canonical one"
        status: pass
    human_judgment: false
  - id: D2
    description: "generateInviteLink sends proof_hash (never the raw redemption proof) to createInvite for a family-only invite, and the resulting url is self-consistent (fragment decodes to the same invite_id as the path)"
    requirement: "FAM-04"
    verification:
      - kind: unit
        ref: "web/src/lib/invite/crypto.test.ts#generateInviteLink > family-only: sends proof_hash (not the raw redemption proof) and produces a self-consistent url"
        status: pass
    human_judgment: false
  - id: D3
    description: "generateInviteLink for a collection scope re-wraps the SAME Collection Key under the invite channel (never generates a fresh one) — proven by round-tripping the wrapped blob back through an independently-reconstructed channel"
    requirement: "FAM-04"
    verification:
      - kind: unit
        ref: "web/src/lib/invite/crypto.test.ts#generateInviteLink > collection-scoped: re-wraps the SAME Collection Key, never generating a fresh one"
        status: pass
    human_judgment: false
  - id: D4
    description: "fetchInviteMetadataFlow and redeemInviteFlow derive the identical invite_proof from the same fragment secret and send it on every network call (metadata fetch AND accept), never re-derived with a chance to drift"
    requirement: "FAM-06"
    verification:
      - kind: unit
        ref: "web/src/lib/invite/crypto.test.ts#fetchInviteMetadataFlow / redeemInviteFlow > both derive the SAME invite_proof from the fragment and send it to every network call"
        status: pass
    human_judgment: false
  - id: D5
    description: "Both fetchInviteMetadataFlow and redeemInviteFlow reject a fragment/path invite_id mismatch BEFORE any network call, independently of each other"
    verification:
      - kind: unit
        ref: "web/src/lib/invite/crypto.test.ts#fetchInviteMetadataFlow / redeemInviteFlow > fetchInviteMetadataFlow throws before any fetch call when the fragment doesn't match the path invite_id"
        status: pass
      - kind: unit
        ref: "web/src/lib/invite/crypto.test.ts#fetchInviteMetadataFlow / redeemInviteFlow > redeemInviteFlow throws before any fetch call when the fragment doesn't match the path invite_id"
        status: pass
    human_judgment: false
  - id: D6
    description: "All 41 new i18n keys (35 invite.*, 5 family.*, settings.tabFamily) exist with both pl/en fields, copied verbatim from 24-UI-SPEC.md; the choke-point grep-audit still returns empty; full typecheck and whole-suite test run stay green"
    requirement: "FAM-06"
    verification:
      - kind: other
        ref: "grep -c '^\\s*\"invite\\.' web/src/lib/i18n/dictionary.ts == 35; grep -c '^\\s*\"family\\.' == 5; grep -c '\"settings.tabFamily\"' == 1"
        status: pass
      - kind: unit
        ref: "npm --prefix web run typecheck (tsc --noEmit, zero errors)"
        status: pass
      - kind: unit
        ref: "npm --prefix web run test -- --run (58 files, 512 tests, all pass)"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-07-31
status: complete
---

# Phase 24 Plan 05: Web Crypto/Invite Glue + i18n Summary

**Widened `lib/crypto`'s WASM choke-point, built `lib/identity/ensure.ts` (the phase's first real caller of `PUT /api/identity/keypair`) and `lib/invite/{api,crypto}.ts` (Amendment-2-aware invite creation/redemption orchestration), and landed all 41 new invite/family i18n keys — every network/crypto primitive Plans 24-06/24-07 need now exists, is unit-tested in isolation against fakes/mocked fetch, and respects the established WASM choke-point convention.**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-07-31T12:57:00Z
- **Tasks:** 3/3 completed
- **Files modified:** 10 (6 created, 4 modified)

## Accomplishments
- `web/src/lib/crypto/index.ts` — widened to re-export `WasmIdentityKey`/`WasmIdentityPublicKey`/`WasmCollectionKey`/`WasmInviteChannel` (as values) and `wrapIdentitySecretKey`/`unwrapIdentitySecretKey`/`sealCollectionKey`/`unsealCollectionKey`/`generateInviteSecret` (as functions) — still the sole file under `web/src` that imports from `./wasm` (grep-audit still returns empty).
- Ran `scripts/build-wasm.sh` first (Plan 24-03's `WasmInviteChannel`/`generateInviteSecret` bindings were stale in the checked-in `web/src/lib/crypto/wasm/` output) so the new bindings actually resolve from TypeScript.
- `web/src/lib/identity/api.ts` (new) — `getIdentityKeypair` (404 → `null`), `putIdentityKeypair`.
- `web/src/lib/identity/ensure.ts` (new) — `ensureOwnIdentityKeypair`: generate-fresh, adopt-existing, and concurrent-loser (T-24-14) paths, each covered by a dedicated Vitest case against a mocked global `fetch`.
- `web/src/lib/invite/api.ts` (new) — `createInvite`/`fetchInvitePublicMetadata` (POST, proof-gated)/`redeemInvite`/`revokeInvite`, field names matching `invitations.rs`'s structs exactly (`proof_hash` on create, `invite_proof` on both fetch_metadata and accept).
- `web/src/lib/invite/crypto.ts` (new) — `generateInviteLink` (family-only + collection-scoped, capture-secret-before-zeroize, proof_hash never the raw proof), `fetchInviteMetadataFlow`/`redeemInviteFlow` (fragment-vs-path self-consistency check before any network call, the same `invite_proof` reused across both calls), `base64UrlEncode`/`base64UrlDecode` (RFC 4648 §5, used only for the fragment secret).
- `web/src/lib/vault/api.ts` — added `getCollection` (the collection-scope branch needs the caller's own `sealed_key` before re-wrapping it under the invite channel; no such client existed).
- `web/src/lib/i18n/dictionary.ts` — all 41 new keys (35 `invite.*`, 5 `family.*`, `settings.tabFamily`), copied verbatim from `24-UI-SPEC.md`'s Copywriting Contract, including the two honesty-critical strings (`invite.fingerprintHonesty`, `invite.honestVisibilityNote`) byte-for-byte.
- `web/package.json` — added a `typecheck` script alias (Rule 3 auto-fix — the plan's own verification command had no matching script).

## Task Commits

Each task was committed atomically (TDD RED/GREEN pairs for Tasks 1–2, per their `tdd="true"` frontmatter):

1. **Task 1 (RED): failing test for ensureOwnIdentityKeypair** - `44384e7` (test)
2. **Task 1 (GREEN): lib/crypto choke-point + ensureOwnIdentityKeypair** - `751abc8` (feat)
3. **Task 2 (RED): failing test for invite API client + crypto orchestration** - `9246fb0` (test)
4. **Task 2 (GREEN): lib/invite API client + crypto orchestration** - `d6897f8` (feat)
5. **Task 3: i18n dictionary — all 41 new invite/family keys** - `fdec232` (feat)

## Files Created/Modified
- `web/src/lib/crypto/index.ts` - widened choke-point (Phase 21/24 WASM bindings, re-exported as values)
- `web/src/lib/identity/api.ts` - `getIdentityKeypair`/`putIdentityKeypair`
- `web/src/lib/identity/ensure.ts` - `ensureOwnIdentityKeypair`
- `web/src/lib/identity/ensure.test.ts` - 3 tests (generate-fresh, adopt-existing, concurrent-loser)
- `web/src/lib/invite/api.ts` - `createInvite`/`fetchInvitePublicMetadata`/`redeemInvite`/`revokeInvite`
- `web/src/lib/invite/crypto.ts` - `generateInviteLink`/`fetchInviteMetadataFlow`/`redeemInviteFlow`/`base64UrlEncode`/`base64UrlDecode`
- `web/src/lib/invite/crypto.test.ts` - 5 tests (family-only + collection-scoped generation, self-consistent redemption round trip, two independent tamper-rejection cases)
- `web/src/lib/vault/api.ts` - added `getCollection`
- `web/src/lib/i18n/dictionary.ts` - 41 new keys
- `web/package.json` - added `typecheck` script

## Decisions Made
- `lib/crypto/index.ts` exports the four new WASM handle classes as VALUES (not merely types) — see `key-decisions` above; this is the binding shape the plan's own downstream actions require, matching the existing `WasmWrappingKey` precedent.
- `getIdentityKeypair` converts a 404 to `null` via `apiJson` + `catch(ApiClientError)` rather than duplicating `apiJson`'s error-body parsing inline — preserves the WR-11 single-shared-implementation invariant with identical observable behavior.
- `fetchInviteMetadataFlow`/`redeemInviteFlow` each independently reconstruct their own `WasmInviteChannel` from the `secretFragment` string, exactly as specified — the string, not the derived handle, is what must survive the invite flow (including the future inline-register round trip Plan 24-06 builds).
- `lib/invite/crypto.test.ts` mocks `@/lib/crypto` wholesale with a faithful-but-fake invite channel (deterministic `inviteId`/`proofForRedemption`/`proofHashForCreation` derivations, a real wrap/unwrap round trip keyed by `inviteId`) rather than invoking the compiled WASM binary directly — mirrors this codebase's existing convention of mocking the crypto boundary at the module level (`lib/passkeys/enroll.test.ts`), while still proving every property the acceptance criteria named (proof_hash ≠ raw proof, self-consistency, same Collection Key round-tripping, tamper rejection).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `lib/crypto/index.ts`'s new bindings needed value exports, not type-only exports**
- **Found during:** Task 1, writing `lib/identity/ensure.ts`
- **Issue:** The plan's action text said to add `export type { WasmIdentityKey, WasmIdentityPublicKey, WasmCollectionKey, WasmInviteChannel };` — but the SAME task's action text (and Task 2's) immediately calls static methods on these classes from outside `lib/crypto` (`WasmIdentityKey.generate()`, `WasmInviteChannel.fromSecret()`, `WasmIdentityPublicKey.fromBytes()`), which requires a value import. A type-only export would fail to compile.
- **Fix:** Exported the four classes as values (`export { WasmIdentityKey, WasmIdentityPublicKey, WasmCollectionKey, WasmInviteChannel };`), matching the existing `WasmWrappingKey` precedent (a class export is simultaneously a value and a type export in TypeScript).
- **Files modified:** `web/src/lib/crypto/index.ts`
- **Verification:** `npm --prefix web run typecheck` passes; `ensure.test.ts`/`crypto.test.ts` both pass.
- **Committed in:** `751abc8` (Task 1 GREEN commit)

**2. [Rule 2 - Missing Critical] `getCollection` added to `web/src/lib/vault/api.ts`**
- **Found during:** Task 2, `generateInviteLink`'s collection-scope branch
- **Issue:** No single-collection-fetch client function existed anywhere in the codebase, but `generateInviteLink` needs to read the caller's own `sealed_key` for a collection before re-wrapping the Collection Key under the invite channel.
- **Fix:** Added `getCollection(id): Promise<CollectionRow>` to `web/src/lib/vault/api.ts` — a thin `apiJson` wrapper over the already-existing, already-tested `GET /api/vault/collections/{id}` server route. This exact addition (and its location) was explicitly anticipated by Task 2's own `read_first` guidance.
- **Files modified:** `web/src/lib/vault/api.ts`
- **Verification:** `crypto.test.ts`'s collection-scoped generation test passes; `npm --prefix web run typecheck` passes.
- **Committed in:** `d6897f8` (Task 2 GREEN commit)

**3. [Rule 3 - Blocking] `web/package.json` had no `typecheck` script**
- **Found during:** Task 3's own `<verify>`/`<acceptance_criteria>` (`npm --prefix web run typecheck`)
- **Issue:** `web/package.json` only exposed `compile` (`tsc --noEmit`) — no `typecheck` script existed anywhere in the repo, so the plan's own verification command (and `24-VALIDATION.md`'s row for this task) would fail with "Missing script: typecheck".
- **Fix:** Added `"typecheck": "tsc --noEmit"` as an additional script alongside the existing `compile` — same underlying command, no behavior change, makes the plan's own verification runnable.
- **Files modified:** `web/package.json`
- **Verification:** `npm --prefix web run typecheck` now runs and passes with zero errors.
- **Committed in:** `fdec232` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (1 Rule 3 — binding-shape correction necessary for the plan's own downstream code to compile; 1 Rule 2 — missing client function the plan's own read_first anticipated; 1 Rule 3 — missing npm script blocking the plan's own verification command).
**Impact on plan:** No scope creep. All three fixes are narrowly scoped to making the plan's own specified behavior/verification actually work; none introduce new architecture or new attack surface.

## Issues Encountered
None beyond the three auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
Plans 24-06 (invite landing UI) and 24-07 (owner invite panel) now have every network/crypto primitive they need: `ensureOwnIdentityKeypair` for identity keypair lazy-generation, `generateInviteLink`/`fetchInviteMetadataFlow`/`redeemInviteFlow` for the full invite lifecycle, and all 41 i18n keys already in `dictionary.ts` so neither UI plan needs to touch that file (removing the shared-file conflict that would otherwise block their parallel execution). No blockers.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: none-new | web/src/lib/identity/ensure.ts | T-24-14 (Elevation of Privilege — the race-loser path) is the only threat this plan's own register assigns to this file, and it is directly exercised by `ensure.test.ts`'s "concurrent-loser path" case: the loser always discards its locally-generated handle and adopts the server's canonical `wrapped_secret_key` once `adopted_existing: true` comes back. No additional surface introduced. |
| threat_flag: none-new | web/src/lib/invite/crypto.ts | T-24-12 (secret capture-before-zeroize), T-24-13 (fragment-vs-path self-consistency check before any network call), and T-24-24 (proof_hash vs raw invite_proof never conflated) are each directly exercised by a named `crypto.test.ts` case. No new surface beyond this plan's own register. |
| threat_flag: new-surface-mitigated | web/src/lib/vault/api.ts (getCollection) + web/src/lib/invite/crypto.ts | `getCollection` is a new client-side call path reading a collection's `sealed_key` — the raw material `unsealCollectionKey`/`WasmInviteChannel.wrapCollectionKey` operate on before an invite ever exists. This is NOT a new server-side attack surface (the underlying `GET /api/vault/collections/{id}` route already exists, already gated by `Membership<Collection, RequireRead>`, and returns only the CALLER's own `sealed_key`, per that route's own doc comment) — flagged here because this plan is the first CLIENT code to read that field for a purpose other than decrypting the caller's own vault (re-wrapping it for someone else, via the invite channel). The re-wrap itself is AAD-bound to the invite's own `invite_id` (T-24-24's channel discipline), so a stolen `wrapped_collection_key` blob is useless outside the specific invite it was created for. |

## Self-Check: PASSED

All created files verified present on disk (`web/src/lib/identity/api.ts`, `web/src/lib/identity/ensure.ts`, `web/src/lib/identity/ensure.test.ts`, `web/src/lib/invite/api.ts`, `web/src/lib/invite/crypto.ts`, `web/src/lib/invite/crypto.test.ts` all read back successfully during execution). All 5 task commits (`44384e7`, `751abc8`, `9246fb0`, `d6897f8`, `fdec232`) verified present in `git log --oneline -8` above. Full verification block re-run clean: `npm --prefix web run test -- identity/ensure invite i18n` (15/15 pass), whole-suite `npm --prefix web run test -- --run` (58 files / 512 tests, all pass), `npm --prefix web run typecheck` (zero errors), and the choke-point grep-audit (`grep -rn "from \"@/lib/crypto/wasm\|from \"\./wasm" web/src --include=*.ts --include=*.tsx | grep -v "web/src/lib/crypto/index.ts"`) returns empty.

---
*Phase: 24-invitation-flow-no-smtp*
*Completed: 2026-07-31*
