---
phase: 06-import-export-totp-onboarding
plan: 01
subsystem: vault
tags: [totp, rfc6238, totp-rs, wasm-bindgen, pv-core, pv-wasm, daisyui, react]

requires:
  - phase: 02-password-auth-vault-crud
    provides: ItemType discriminated union, TypePicker/ItemForm/DetailPanel/ItemRow per-type switch shape, lib/crypto choke-point convention
provides:
  - RFC 6238 TOTP code generation in pv-core (crates/pv-core/src/totp.rs)
  - totpNow wasm-bindgen export (pv-wasm), typed lib/crypto wrapper
  - TotpCountdownRing component (24px/64px coral radial-progress ring)
  - "totp" as a fifth first-class ItemType, wired into TypePicker/ItemForm/DetailPanel/ItemRow/Sidebar
affects: [06-02-import-pipeline, 06-03-export-pipeline, 06-04-onboarding-wizard]

tech-stack:
  added: [totp-rs 5.7.2 (pv-core, default-features=false, features=["otpauth"])]
  patterns:
    - "TOTP code generation always takes unix_time_seconds as an explicit caller-supplied parameter — never reads a system clock (required for wasm32-unknown-unknown, which has none)"
    - "totpNow is a plain-data wasm export (JSON string, same tier as encryptItem/decryptItem), not an opaque handle — no key material crosses the boundary"
    - "Client-owned setInterval(~1s) countdown ring, single interval cleared on unmount, matching autolock.ts/clipboard.ts's established timer discipline"

key-files:
  created:
    - crates/pv-core/src/totp.rs
    - web/src/components/vault/TotpCountdownRing.tsx
    - web/src/components/vault/TotpCountdownRing.test.tsx
  modified:
    - crates/pv-core/Cargo.toml
    - crates/pv-core/src/lib.rs
    - crates/pv-wasm/src/lib.rs
    - web/src/lib/crypto/index.ts
    - web/src/lib/vault/types.ts
    - web/src/components/vault/TypePicker.tsx
    - web/src/components/vault/ItemForm.tsx
    - web/src/components/vault/DetailPanel.tsx
    - web/src/components/vault/ItemRow.tsx
    - web/src/components/shell/Sidebar.tsx
    - web/src/lib/i18n/dictionary.ts

key-decisions:
  - "totp-rs 5.7.2's actual TOTP::new() constructor takes 7 args (issuer: Option<String>, account_name: String), not the 5-arg shape drafted in the plan's <interfaces> section — passed None/empty-string since this module never calls get_url()"
  - "generate_code() strips whitespace and '=' padding from the input secret before base32-decoding, since totp-rs's Secret::Encoded decodes unpadded RFC 4648 base32 only (padding: false) and would otherwise reject real-world padded secrets"
  - "DetailPanel's renderCopyButton() gained an optional ariaLabelOverride param so the TOTP code's copy button can use the UI-SPEC-mandated aria.copyTotpCode label instead of the generic interpolated aria.copyField — minimal additive extension of an existing helper"

patterns-established:
  - "Pattern: pv-core crypto modules that need 'current time' always take it as an explicit fn parameter, never read via std::time — the wasm32 target has no OS clock"

requirements-completed: [VAULT-07]

coverage:
  - id: D1
    description: "pv-core::totp::generate_code produces RFC 6238-correct codes for SHA1/SHA256/SHA512 known-answer vectors and rejects invalid input without panicking"
    requirement: "VAULT-07"
    verification:
      - kind: unit
        ref: "crates/pv-core/src/totp.rs#tests (rfc6238_sha1/sha256/sha512_known_answer_vectors, same_period_stability, invalid_base32_secret_rejected, zero_period_rejected)"
        status: pass
    human_judgment: false
  - id: D2
    description: "totpNow wasm export returns the {code, secondsRemaining} JSON shape and is callable from @/lib/crypto"
    requirement: "VAULT-07"
    verification:
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#tests (totp_now_returns_rfc6238_json_shape, totp_now_rejects_invalid_secret)"
        status: pass
      - kind: unit
        ref: "cargo build -p pv-wasm --target wasm32-unknown-unknown --release"
        status: pass
    human_judgment: false
  - id: D3
    description: "TotpCountdownRing renders a live, ticking, size-parameterized coral countdown ring backed by totpNow, with a non-crashing error state for invalid secrets"
    requirement: "VAULT-07"
    verification:
      - kind: unit
        ref: "web/src/components/vault/TotpCountdownRing.test.tsx (5 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A totp vault item is fully usable end-to-end in the UI: creatable via TypePicker/ItemForm (with otpauth:// auto-parse and Advanced-toggle-hidden RFC 6238 fields), viewable with a live countdown ring + masked/revealable secret in DetailPanel, and visible with its own live code in ItemRow's list view"
    requirement: "VAULT-07"
    verification:
      - kind: unit
        ref: "web/src/components/vault/{TypePicker,ItemForm,DetailPanel,ItemRow}.test.tsx (43 tests total)"
        status: pass
      - kind: other
        ref: "cd web && npx tsc --noEmit && npm run build"
        status: pass
    human_judgment: false

duration: 23min
completed: 2026-07-14
status: complete
---

# Phase 6 Plan 1: TOTP as a first-class item type Summary

**RFC 6238 TOTP code generation added to pv-core via totp-rs, exposed through a pv-wasm `totpNow` export, and wired end-to-end as a fifth `ItemType` across TypePicker/ItemForm/DetailPanel/ItemRow/Sidebar with a live coral countdown ring component.**

## Performance

- **Duration:** 23 min
- **Started:** 2026-07-14T16:02:04+02:00 (previous phase transition commit)
- **Completed:** 2026-07-14T16:24:45+02:00
- **Tasks:** 3
- **Files modified:** 14 (3 created, 11 modified, plus Cargo.lock)

## Accomplishments
- `crates/pv-core/src/totp.rs`: `generate_code(secret_b32, algorithm, digits, period, unix_time_seconds)` — RFC 6238 Appendix B known-answer tests pass for SHA1/SHA256/SHA512, plus same-period-stability, invalid-base32, and zero-period guard tests. Never reads a system clock — the wasm32 target has none.
- `pv-wasm`'s `totpNow` export (plain-data, JSON string tier — not an opaque handle) plus `web/src/lib/crypto`'s typed wrapper, which handles the `u64` → `bigint` wasm-bindgen marshaling boundary.
- `TotpCountdownRing.tsx`: one component, size-parameterized (24px row / 64px detail), ticking via `setInterval(~1s)`, cleared on unmount, non-crashing error state for invalid secrets.
- `"totp"` added as a fifth `ItemType` across every exhaustive per-type UI switch: `TypePicker`'s tile grid, `ItemForm`'s create/edit form (secret field with `otpauth://` auto-parse, RFC 6238 defaults, default-closed Advanced collapse, submit-time base32 validation), `DetailPanel`'s bespoke countdown-ring block (rendered before the generic masked/revealable `secret` field row), `ItemRow`'s list-row live code (replacing the relative-time column for totp rows only), and `Sidebar`'s category filter maps.

## Task Commits

Each task was committed atomically:

1. **Task 1: pv-core RFC 6238 code generation (`totp.rs`)** - `84140b3` (feat)
2. **Task 2: pv-wasm `totpNow` export + `lib/crypto` wrapper + `TotpCountdownRing` component** - `d31a9df` (feat, TDD RED→GREEN)
3. **Task 3: Wire `totp` into the vault item type union and every per-type UI switch** - `4556300` (feat)

_Note: Task 1/2 followed the plan's `tdd="true"` marker — tests were written alongside implementation and verified failing/passing at each step; no separate RED-only commit was made since the task granularity here is small, focused functions verified by the same commit's test suite._

## Files Created/Modified
- `crates/pv-core/src/totp.rs` - RFC 6238 TOTP code generation, RFC 6238 Appendix B known-answer tests
- `crates/pv-core/Cargo.toml` - adds `totp-rs = { version = "5.7.2", default-features = false, features = ["otpauth"] }`
- `crates/pv-core/src/lib.rs` - `pub mod totp;`
- `crates/pv-wasm/src/lib.rs` - `totpNow` wasm export + native tests
- `web/src/lib/crypto/index.ts` - typed `totpNow()` wrapper (sole JSON.parse call site)
- `web/src/components/vault/TotpCountdownRing.tsx` - live coral countdown ring component
- `web/src/components/vault/TotpCountdownRing.test.tsx` - 5 tests (render, mount-call, tick, unmount-cleanup, error state)
- `web/src/lib/vault/types.ts` - `ItemType` grows `"totp"`; new `TotpFields` interface
- `web/src/components/vault/TypePicker.tsx`/`.test.tsx` - fifth TOTP tile
- `web/src/components/vault/ItemForm.tsx`/`.test.tsx` - totp create/edit branch, `parseTotpValue`/`isValidBase32Secret` helpers
- `web/src/components/vault/DetailPanel.tsx`/`.test.tsx` - bespoke totp view-mode block, `FIELD_ORDER.totp = ["secret"]`
- `web/src/components/vault/ItemRow.tsx`/`.test.tsx` - totp icon/subtitle/countdown ring in trailing column
- `web/src/components/shell/Sidebar.tsx` - `CATEGORY_ICON`/`CATEGORY_LABEL_KEY`/`ITEM_TYPES` extended
- `web/src/lib/i18n/dictionary.ts` - `itemType.totp`, `field.secret/issuer/algorithm/digits/period`, `totp.advancedToggle/secretHelper/invalidSecretError`, `aria.copyTotpCode/codeRefreshCountdown`, `sidebar.catTotp` (PL/EN)

## Decisions Made
- Passed `None`/`String::new()` for `totp-rs`'s `issuer`/`account_name` constructor params (unused — this module never calls `get_url()`), since the plan's drafted `TOTP::new()` 5-arg signature didn't match the actual verified crate API.
- `generate_code()` strips whitespace/`=` padding from the input secret before decoding (real-world secrets, including some exporters, emit padded base32; `totp-rs`'s `Secret::Encoded` decodes unpadded-only).
- `DetailPanel.renderCopyButton()` gained an optional `ariaLabelOverride` param (additive, backward-compatible) so the TOTP code's copy button can carry the UI-SPEC-mandated `aria.copyTotpCode` label distinct from the generic interpolated `aria.copyField`.
- `aria.codeRefreshCountdown` was added to the dictionary per 06-UI-SPEC.md's Copywriting Contract but is not yet wired to any component in this plan — no task's action text called for an aria-live countdown announcement inside `TotpCountdownRing`; the key is available for a future refinement pass without blocking VAULT-07's literal "shows a live, counting-down code" requirement, which the visual `radial-progress` ring + `aria-valuenow` already satisfies.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `totp-rs` 5.7.2's actual `TOTP::new()` signature has 7 parameters, not 5**
- **Found during:** Task 1 (`cargo test -p pv-core totp::` compile error)
- **Issue:** The plan's `<interfaces>` section (and 06-RESEARCH.md's Pattern 1) drafted `TOTP::new(algorithm, digits, skew, step, secret_bytes)` — the actual crate API additionally requires `issuer: Option<String>` and `account_name: String`.
- **Fix:** Added `None, String::new()` to the call (both otpauth:// URI metadata fields unused by this read-only code-generation path).
- **Files modified:** `crates/pv-core/src/totp.rs`
- **Verification:** `cargo test -p pv-core totp::` — all 6 tests pass.
- **Committed in:** `84140b3` (Task 1 commit)

**2. [Rule 1 - Bug] `totp-rs`'s `Secret::Encoded` rejects base32-padded secrets**
- **Found during:** Task 1 (SHA256/SHA512 known-answer tests failing with `InvalidInput("invalid base32 TOTP secret")`)
- **Issue:** `Secret::Encoded(...).to_bytes()` decodes with `base32::decode(Alphabet::Rfc4648 { padding: false }, ...)` — any `=` padding character causes an outright decode failure, even though the RFC 6238 Appendix B test vectors' canonical base32 form (and many real-world secrets) include padding.
- **Fix:** `generate_code()` strips whitespace and `=` characters from the input before decoding.
- **Files modified:** `crates/pv-core/src/totp.rs`
- **Verification:** `cargo test -p pv-core totp::` — SHA256/SHA512 known-answer tests (which deliberately kept their padded form to exercise this tolerance) pass.
- **Committed in:** `84140b3` (Task 1 commit)

**3. [Rule 3 - Blocking] `web/node_modules` missing in the fresh worktree**
- **Found during:** Task 2 (before running `npx vitest run`)
- **Issue:** The worktree's `web/` directory had no `node_modules` — a known parallel-worktree gap (dependencies aren't checked into git).
- **Fix:** Ran `npm ci` in `web/`.
- **Files modified:** none tracked (node_modules is gitignored)
- **Verification:** `npx vitest run`/`npx tsc --noEmit`/`npm run build` all subsequently succeeded.
- **Committed in:** not applicable (no tracked file change)

---

**Total deviations:** 3 auto-fixed (2 bug fixes matching a verified-but-slightly-stale API surface, 1 blocking environment gap). No scope creep — all three were necessary to make the plan's own drafted interface actually compile/pass against the real, currently-published `totp-rs` 5.7.2 API.

## Issues Encountered
- `cargo build -p pv-core --target wasm32-unknown-unknown --release` (Task 1's literal acceptance-criterion command) fails due to a **pre-existing** condition confirmed unrelated to this plan's changes (verified via `git stash`: the failure reproduces identically on the pre-Task-1 tree). `pv-core`'s own `Cargo.toml` has no `wasm32`-target `getrandom` `js`-feature dependency — only `pv-wasm`'s `Cargo.toml` sets that (a `[target.'cfg(target_arch = "wasm32")'.dependencies] getrandom = { version = "0.2", features = ["js"] }` line pv-core has never had). `pv-core` was therefore never independently buildable for `wasm32-unknown-unknown` standalone, before or after this plan — the crate has always shipped to the browser only via `pv-wasm`, which does build cleanly (`cargo build -p pv-wasm --target wasm32-unknown-unknown --release` succeeds, confirmed this plan). `cargo tree -i getrandom --target wasm32-unknown-unknown -p pv-core` (the other half of Task 1's acceptance criteria, which doesn't require compiling) confirms a single `getrandom v0.2.17` major — no duplicate-major regression from adding `totp-rs`. Not fixed (out of scope per the deviation rules' scope boundary — a pre-existing gap unrelated to this task's changes); flagged here for visibility.

## Next Phase Readiness
- `"totp"` is a fully first-class `ItemType` — Plan 06-02 (import pipeline) can create standalone TOTP items via the same `createVaultItem`/`ItemFields` path every other type uses, including the `otpauth://`-in-a-field disambiguation this plan's `parseTotpValue` helper already establishes as a pattern (Plan 06-02 may import a real module from `lib/vault/importers/` instead of this plan's inlined copy — no coupling either way).
- `TotpCountdownRing` is reusable as-is by any future surface needing a live TOTP display (e.g. an export preview) without any API changes.
- No blockers for Plan 06-02/06-03/06-04.

---
*Phase: 06-import-export-totp-onboarding*
*Completed: 2026-07-14*

## Self-Check: PASSED

All created files and task commit hashes verified present on disk / in git history.
