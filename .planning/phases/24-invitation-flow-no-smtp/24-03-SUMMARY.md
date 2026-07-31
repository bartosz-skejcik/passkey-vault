---
phase: 24-invitation-flow-no-smtp
plan: 03
subsystem: api
tags: [rust, wasm-bindgen, hkdf, xchacha20poly1305, invitations]

# Dependency graph
requires:
  - phase: 24-invitation-flow-no-smtp (Plan 24-01)
    provides: "pv_core::invite module: derive_invite_id, wrap/unwrap_collection_key_for_invite (AAD-bound), derive_invite_proof, hash_invite_proof"
  - phase: 21-identity-keys-sealed-sharing
    provides: "Phase 21's opaque-handle wasm-bindgen style (WasmWrappingKey, WasmCollectionKey) this plan mirrors"
provides:
  - "generateInviteSecret() — the one place raw invite_secret bytes legitimately cross the WASM boundary, since they must appear in the URL fragment"
  - "WasmInviteChannel opaque handle: fromSecret/inviteId/proofHashForCreation/proofForRedemption/wrapCollectionKey/unwrapCollectionKey"
affects: [24-05-owner-invite-panel, 24-04-invite-landing-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Opaque handle holds the raw secret only, never a pre-derived value — each method re-derives what it needs from pv_core::invite, so the handle never duplicates pv-core's derivation logic"
    - "Two distinctly-named methods (proofHashForCreation vs proofForRedemption) for two byte sequences that must never be confused, per Amendment 2's proof-of-possession leg"

key-files:
  created: []
  modified:
    - crates/pv-wasm/src/lib.rs

key-decisions:
  - "WasmInviteChannel stores invite_secret: [u8; KEY_LEN] plus invite_id: String (#[zeroize(skip)]), never a pre-derived invite_wrap_key or invite_proof — mirrors wrap_collection_key_for_invite/unwrap_collection_key_for_invite/derive_invite_proof/hash_invite_proof's own internal re-derivation-from-secret design, so the WASM layer adds no parallel derivation logic"
  - "generateInviteSecret documented explicitly as the module's THIRD sanctioned raw-bytes exception (after randomSalt and exportUserKeyForSession/importUserKeyFromSession) — updated the file's top-of-module doc comment (which previously said exportUserKeyForSession was the only exception besides randomSalt) so it stays accurate now that a third exists"
  - "New tests live in a separate mod invite_channel_tests (not merged into the file's existing mod tests) — a second same-named test module would not compile, and the distinct module path is what makes `cargo test -p pv-wasm invite_channel_tests::` actually match tests instead of silently matching zero"

patterns-established:
  - "Opaque-handle-holds-raw-secret-only pattern, reusable by any future WASM binding wrapping a pv-core module that itself re-derives from one root secret rather than exposing a pre-derived intermediate value"

requirements-completed: [FAM-04, FAM-06]

coverage:
  - id: D1
    description: "generateInviteSecret() returns 32 fresh random bytes; two consecutive calls differ"
    requirement: "FAM-04"
    verification:
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#invite_channel_tests::generate_invite_secret_returns_32_distinct_bytes_across_two_calls"
        status: pass
    human_judgment: false
  - id: D2
    description: "WasmInviteChannel::fromSecret zeroizes the input buffer regardless of outcome and exposes .inviteId() returning the same string for the same secret across two independently-constructed handles"
    requirement: "FAM-04"
    verification:
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#invite_channel_tests::invite_id_is_deterministic_for_the_same_secret"
        status: pass
    human_judgment: false
  - id: D3
    description: "proofHashForCreation() and proofForRedemption() return different byte sequences on the same channel, and each is stable across two channels built from the same secret (Amendment 2)"
    requirement: "FAM-06"
    verification:
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#invite_channel_tests::proof_hash_for_creation_and_proof_for_redemption_are_different_but_each_is_stable_across_two_channels_built_from_the_same_secret"
        status: pass
    human_judgment: false
  - id: D4
    description: "wrapCollectionKey then unwrapCollectionKey on two independently-constructed handles built from the identical secret round-trips the original Collection Key's data; a handle built from a different secret fails to unwrap"
    requirement: "FAM-06"
    verification:
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#invite_channel_tests::wrap_unwrap_roundtrip_via_two_independently_constructed_channels"
        status: pass
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#invite_channel_tests::unwrap_fails_across_different_secrets"
        status: pass
    human_judgment: false
  - id: D5
    description: "No new real dependency added (base64 stays pv-wasm dev-dependency only); the crate still builds for the real wasm32-unknown-unknown browser target"
    verification:
      - kind: other
        ref: "grep -n '^base64' crates/pv-wasm/Cargo.toml (only under [dev-dependencies]); cargo build -p pv-wasm --target wasm32-unknown-unknown"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-31
status: complete
---

# Phase 24 Plan 03: pv-wasm Invite Channel Bindings Summary

**`WasmInviteChannel` opaque handle + `generateInviteSecret()` bridge Plan 24-01's `pv_core::invite` primitive across the WASM boundary in Phase 21's established opaque-handle style, giving the web layer a tested, deterministic invite-secret → invite_id/proof/wrap-key channel with zero raw secret exposure beyond the sanctioned URL-fragment exception.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-31T10:27:41Z
- **Tasks:** 1/1 completed
- **Files modified:** 1

## Accomplishments
- `generateInviteSecret()` — returns 32 fresh random bytes (`pv_core::keys::random_bytes(KEY_LEN)`), documented as the module's third sanctioned raw-bytes-crossing-the-boundary exception (alongside `randomSalt`/`exportUserKeyForSession`), since the invite secret must literally appear in the URL fragment the owner copies.
- `WasmInviteChannel` — opaque handle storing only the raw `invite_secret: [u8; KEY_LEN]` plus the derived, non-secret `invite_id: String` (`#[zeroize(skip)]`). `#[derive(Zeroize, ZeroizeOnDrop)]` zeroizes `invite_secret` on drop.
  - `fromSecret(secret)` — validates length, copies into a fixed array, derives `invite_id` via `pv_core::invite::derive_invite_id`, zeroizes the caller's buffer regardless of success/failure (mirrors `WasmWrappingKey::from_password`).
  - `inviteId()` — the one non-secret field, returned as a `String`.
  - `proofHashForCreation()` — `SHA-256(invite_proof)`, the value the owner's client sends as `proof_hash` at creation (Plan 24-02).
  - `proofForRedemption()` — the raw `invite_proof`, the value the invitee's client sends to both the metadata-fetch and accept endpoints. Deliberately a separate method from `proofHashForCreation` so the two cannot be confused.
  - `wrapCollectionKey(ck)` / `unwrapCollectionKey(json)` — delegate to `pv_core::invite::wrap_collection_key_for_invite`/`unwrap_collection_key_for_invite`, AAD-bound to `self.invite_id`.
- Updated the file's top-of-module doc comment, which previously claimed `exportUserKeyForSession`/`importUserKeyFromSession` was the only exception besides `randomSalt` — now documents `generateInviteSecret` as the third.
- 5 new native tests in a new, separate `mod invite_channel_tests` (kept distinct from the file's existing `mod tests` per the plan's explicit compile-collision warning).

## Task Commits

Each task was committed atomically:

1. **Task 1: WasmInviteChannel + generateInviteSecret bindings** - `0f0c6de` (feat)

## Files Created/Modified
- `crates/pv-wasm/src/lib.rs` - added `generateInviteSecret()`, `WasmInviteChannel` struct + impl (6 methods), `mod invite_channel_tests` (5 tests), updated top-of-file doc comment for the new sanctioned exception

## Decisions Made
- `WasmInviteChannel` stores the raw secret, never a pre-derived `invite_wrap_key` or `invite_proof` — matches `pv_core::invite`'s own design where `wrap_collection_key_for_invite`/`unwrap_collection_key_for_invite`/`derive_invite_proof`/`hash_invite_proof` each internally re-derive from `invite_secret` + `invite_id`. This keeps the WASM layer a pure bridge with no parallel derivation logic of its own.
- Updated the module-level doc comment's "only exception besides randomSalt" claim to stay accurate now that `generateInviteSecret` is a third sanctioned exception — an existing doc claim would otherwise have gone stale.
- New tests placed in `mod invite_channel_tests`, a separate module from the file's pre-existing `mod tests`, exactly as the plan required — verified the filtered command `cargo test -p pv-wasm invite_channel_tests::` actually runs 5 tests (not 0), closing the exact defect class the plan's critical-correctness notes called out from an earlier draft.

## Deviations from Plan

None - plan executed exactly as written. `wrap_collection_key`/`unwrap_collection_key` construct `WasmCollectionKey(collection_key)` directly from the `[u8; KEY_LEN]` `unwrap_collection_key_for_invite` returns, matching the exact return-shape mirroring the plan specified against `sealCollectionKey`/`unsealCollectionKey`.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
Plan 24-05 (web crypto glue / owner invite panel) now has a ready, tested opaque handle: `generateInviteSecret()` to produce the fragment secret, `WasmInviteChannel.fromSecret()` to reconstruct it on either the owner's or invitee's browser, `.inviteId()` for the public lookup handle, `.proofHashForCreation()`/`.proofForRedemption()` for Amendment 2's two proof-of-possession values, and `.wrapCollectionKey()`/`.unwrapCollectionKey()` for the collection-scoped grant path. No blockers. Plan 24-02's server routes and this plan's WASM bindings share the identical wire contract (verified independently — this plan calls only `pv_core::invite`, never `pv_server::crypto`).

## Threat Flags

The plan's own `<threat_model>` already scoped T-24-11 and T-24-23 against this exact file, and both are directly exercised by this plan's tests: `wrap_unwrap_roundtrip_via_two_independently_constructed_channels`/`unwrap_fails_across_different_secrets` exercise the invite-secret-never-exposed discipline (T-24-11 — no method returns `invite_secret`'s raw bytes; `#[derive(Zeroize, ZeroizeOnDrop)]` with `invite_id` explicitly `#[zeroize(skip)]`; `from_secret` zeroizes the caller-owned input buffer regardless of outcome), and `proof_hash_for_creation_and_proof_for_redemption_are_different_but_each_is_stable_across_two_channels_built_from_the_same_secret` directly proves T-24-23 (the two proof methods cannot be accidentally swapped). No NEW threat-adjacent surface was introduced beyond what the plan's own register already named:

| Flag | File | Description |
|------|------|--------------|
| threat_flag: none-new | crates/pv-wasm/src/lib.rs | Every attack surface this plan introduces (`generateInviteSecret`, `WasmInviteChannel` and its 6 methods) is already named and disposed as `mitigate` (T-24-11, T-24-23) or `accept` (T-24-SC, no new crate dependency) in this plan's own threat register, and each mitigation is directly exercised by a named test above. This module has no I/O and is not yet wired into any web-app call site — Plan 24-05 is where the channel is actually exercised end-to-end against the live `/api/invitations/*` surface; that plan's own test suite is where the full cross-boundary property (owner's browser wraps, invitee's browser unwraps, over the real network) must be proven, not here. |

## Self-Check: PASSED

`crates/pv-wasm/src/lib.rs` verified present on disk with the new code (confirmed via successful Edit/Read tool calls). Commit `0f0c6de` verified present in `git log --oneline -5` (see below).

---
*Phase: 24-invitation-flow-no-smtp*
*Completed: 2026-07-31*
