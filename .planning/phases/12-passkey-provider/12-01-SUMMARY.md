---
phase: 12-passkey-provider
plan: 01
subsystem: crypto
tags: [passkey-rs, webauthn, wasm-bindgen, rust, coset, cbor, pollster]

requires: []
provides:
  - "crates/pv-provider: passkey-rs (1Password) soft ES256 WebAuthn authenticator + vault-backed CredentialStore adapter"
  - "wasmCreateProviderCredential/wasmGetProviderAssertion pv-wasm bindings, zero plaintext private-key crossing"
  - "extension/lib/crypto/wasm-loader.ts re-exports of the two new bindings"
affects: [12-02, 12-03, 12-04, secure-phase-12]

tech-stack:
  added:
    - "passkey-authenticator@0.5.0, passkey-client@0.5.0, passkey-types@0.5.0 (1Password's passkey-rs, crates.io [VERIFIED, OK verdict])"
    - "pollster@1.0.1 (single-poll async executor, D-18 pre-approved; legitimacy check inline — see Deviations)"
    - "async-trait@0.1, coset@0.4, url@2 (pv-provider-only, wiring dependencies for the above)"
    - "base64@0.22 (pv-wasm dev-dependency, test-fixture-only)"
  patterns:
    - "SerializablePasskey JSON mirror in credential_store.rs: passkey_types::Passkey has no Serialize/Deserialize of its own (CoseKey has none either, only coset::CborSerializable) — hand-rolled DTO CBOR-encodes just the key field, JSON-encodes everything else"
    - "Combined-function zero-knowledge pattern: wasm_create_provider_credential calls pv_provider::create_provider_credential then IMMEDIATELY core_encrypt_item in the same function body — new_passkey_json never becomes a struct field or return type"

key-files:
  created:
    - crates/pv-provider/Cargo.toml
    - crates/pv-provider/src/lib.rs
    - crates/pv-provider/src/error.rs
    - crates/pv-provider/src/credential_store.rs
    - crates/pv-provider/src/ceremony.rs
  modified:
    - Cargo.toml
    - crates/pv-wasm/Cargo.toml
    - crates/pv-wasm/src/lib.rs
    - extension/lib/crypto/wasm-loader.ts

key-decisions:
  - "pollster async executor: needed (register()/authenticate() are genuinely async fn, no sync variant) — D-18 pre-approval used, legitimacy check performed inline, no human gate"
  - "D-08 satisfied vacuously: zero new HKDF domain-separation constants introduced this phase (ephemeral-wrap de-scoped per D-19)"
  - "Passkey has no Serialize/Deserialize upstream — hand-rolled SerializablePasskey DTO (Rule 1 deviation from 12-RESEARCH.md's assumption that passkey-types derives Serialize/Deserialize)"

patterns-established:
  - "pv-provider is the ONLY crate that imports passkey-authenticator/passkey-client/passkey-types — pv-core and pv-wasm never do (D-02/D-05 boundary, grep-auditable)"
  - "Free functions, not impl methods, for new wasm-bindgen bindings (wasm_create_provider_credential/wasm_get_provider_assertion) — matches this file's existing style and avoids any async-in-impl-block ambiguity"

requirements-completed: [PROV-01, PROV-02, PROV-04]

coverage:
  - id: D1
    description: "create_provider_credential/wasmCreateProviderCredential returns a public-only credential response plus an already-encrypted vault item — no plaintext private key crosses the WASM->JS boundary as a return value"
    requirement: "PROV-01"
    verification:
      - kind: unit
        ref: "crates/pv-provider/src/lib.rs#tests::create_then_get_roundtrip"
        status: pass
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#tests::wasm_create_then_get_roundtrip"
        status: pass
      - kind: other
        ref: "grep -n new_passkey_json crates/pv-wasm/src/lib.rs (local-variable-only usage)"
        status: pass
    human_judgment: false
  - id: D2
    description: "get_provider_assertion/wasmGetProviderAssertion returns a validly signed assertion for a previously-created credential without exposing the decrypted private key to JS"
    requirement: "PROV-02"
    verification:
      - kind: unit
        ref: "crates/pv-provider/src/lib.rs#tests::create_then_get_roundtrip"
        status: pass
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#tests::wasm_get_assertion_from_encrypted_item"
        status: pass
    human_judgment: false
  - id: D3
    description: "passkey-client's own RpIdVerifier/origin validation rejects an origin/RP-ID mismatch — proves the library does the validation, not a manual check in this crate (D-06)"
    requirement: "PROV-02"
    verification:
      - kind: unit
        ref: "crates/pv-provider/src/lib.rs#tests::origin_mismatch_rejected"
        status: pass
    human_judgment: false
  - id: D4
    description: "PRF/hmac-secret capability signal (clientExtensionResults.prf.enabled) is computed by passkey-rs's own HmacSecretConfig extension, not a second hand-rolled implementation"
    requirement: "PROV-04"
    verification:
      - kind: unit
        ref: "crates/pv-provider/src/lib.rs#tests::prf_capable_credential"
        status: pass
    human_judgment: false
  - id: D5
    description: "wasmCreateProviderCredential/wasmGetProviderAssertion re-exported from extension/lib/crypto/wasm-loader.ts, the sole sanctioned importer of ./wasm/pv_wasm.js"
    verification:
      - kind: other
        ref: "extension/lib/crypto/wasm-loader.ts export statements + regenerated extension/lib/crypto/wasm/pv_wasm.d.ts (gitignored build artifact) confirming both names resolve"
        status: pass
    human_judgment: false

duration: ~40min
completed: 2026-07-16
status: complete
---

# Phase 12 Plan 01: passkey-rs Soft Authenticator + Vault-Backed CredentialStore Summary

**New `crates/pv-provider` wires 1Password's `passkey-rs` (0.5.0) soft ES256 authenticator through a hand-rolled JSON-serializable `Passkey` mirror into two `pv-wasm` bindings (`wasmCreateProviderCredential`/`wasmGetProviderAssertion`) that reuse `pv-core`'s existing `encrypt_item`/`decrypt_item` unchanged, so no plaintext passkey private-key material ever crosses the WASM→JS boundary as a return value.**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-07-16
- **Tasks:** 2 (both `tdd="true"`, both with full RED→GREEN commit pairs)
- **Files modified:** 9 (5 created in `crates/pv-provider`, 3 modified: `Cargo.toml`, `crates/pv-wasm/Cargo.toml`, `crates/pv-wasm/src/lib.rs`, plus `extension/lib/crypto/wasm-loader.ts`)

## Accomplishments

- `crates/pv-provider`: `PvCredentialStore` (in-memory `CredentialStore` adapter, zero I/O) + `PvUserValidation` (trivially-verified — consent already happened via the popup ceremony, per D-09) + `create_provider_credential`/`get_provider_assertion` wiring `passkey_client::Client::register()`/`authenticate()` against `Authenticator::new(Aaguid::new_empty(), store, user_validation).hmac_secret(HmacSecretConfig::new_without_uv())`
- `SerializablePasskey`: a hand-rolled serde DTO mirroring `passkey_types::Passkey` field-for-field, since `Passkey` (and its `CoseKey` field) has no `Serialize`/`Deserialize` of its own — see Deviations
- `crates/pv-wasm`: `wasmCreateProviderCredential`/`wasmGetProviderAssertion` free functions + `WasmCreateProviderResult`/`WasmGetProviderResult` opaque result structs (each exposing exactly two getters, nothing else)
- `extension/lib/crypto/wasm-loader.ts` re-exports both bindings and their result types; WASM package rebuilt via the existing `scripts/build-wasm.sh` for both `web/` and `extension/` outputs
- All 5 behavior tests pass: 3 in `pv-provider` (`create_then_get_roundtrip`, `origin_mismatch_rejected`, `prf_capable_credential`) + 2 in `pv-wasm` (`wasm_create_then_get_roundtrip`, `wasm_get_assertion_from_encrypted_item`)
- Full workspace (`cargo build --workspace`, `cargo test --workspace`, `cargo clippy --workspace`) green with zero warnings after this plan's changes

## Task Commits

Each task followed the full RED→GREEN TDD gate:

1. **Task 1: passkey-rs soft authenticator + vault-backed CredentialStore**
   - `b89e6aa` (test) — 3 behavior tests added against a stubbed `ceremony.rs` (bodies return `Err` unconditionally); all 3 fail
   - `e83ba81` (feat) — real `create_provider_credential`/`get_provider_assertion` wiring; all 3 pass
   - `34fc72e` (docs) — clippy `doc_lazy_continuation` fix in `pv-provider`'s module doc comment
2. **Task 2: pv-wasm combined bindings + wasm-loader re-exports**
   - `a376c20` (test) — 2 behavior tests added against stubbed `wasm_create_provider_credential`/`wasm_get_provider_assertion` (see Issues Encountered for why the stub design differs from Task 1's); both fail
   - `ba3287e` (feat) — real binding wiring (immediate `core_encrypt_item` of `new_passkey_json` inside `wasm_create_provider_credential`'s body); both pass
   - `b8d2230` (feat) — `wasm-loader.ts` re-exports + WASM package rebuild

**Plan metadata:** (this commit, `docs(12-01): complete plan`, made by the worktree-mode caller after this SUMMARY)

## Files Created/Modified

- `Cargo.toml` — added `crates/pv-provider` as a new workspace member
- `crates/pv-provider/Cargo.toml` — new crate: `passkey-authenticator`/`passkey-client`/`passkey-types`@0.5.0, `pollster`@1, `async-trait`@0.1, `coset`@0.4, `url`@2, `serde`/`serde_json`/`thiserror` (workspace)
- `crates/pv-provider/src/lib.rs` — module docs (D-08 vacuous-satisfaction note) + public re-exports + 3 behavior tests
- `crates/pv-provider/src/error.rs` — `PvProviderError` (thiserror: `Ceremony`, `InvalidInput`, `Serde`)
- `crates/pv-provider/src/credential_store.rs` — `PvCredentialStore`, `PvUserValidation`, `SerializablePasskey` mirror + `passkey_to_json`/`passkeys_from_json`
- `crates/pv-provider/src/ceremony.rs` — `create_provider_credential`, `get_provider_assertion`, `CreateProviderResult`, `GetProviderAssertionResult`
- `crates/pv-wasm/Cargo.toml` — added `pv-provider` path dependency, `base64`@0.22 dev-dependency
- `crates/pv-wasm/src/lib.rs` — `WasmCreateProviderResult`/`WasmGetProviderResult` + `wasm_create_provider_credential`/`wasm_get_provider_assertion` + 2 behavior tests
- `extension/lib/crypto/wasm-loader.ts` — re-exports `wasmCreateProviderCredential`/`wasmGetProviderAssertion`/`WasmCreateProviderResult`/`WasmGetProviderResult`

## Decisions Made

- **Pollster decision (D-18): NEEDED, approved, installed.** `passkey_client::Client::register()`/`authenticate()` are genuinely `async fn` in the pinned 0.5.0 source (verified directly against `~/.cargo/registry/src/.../passkey-client-0.5.0/src/lib.rs` — no sync variant exists). This project has zero tokio/async-runtime dependency anywhere and `PvCredentialStore`/`PvUserValidation` never await real I/O, so `pollster::block_on` (single-poll executor) is sufficient. Legitimacy check performed inline before `cargo add`: **11 published versions spanning 2020-04-07 to 2026-07-10** (steady, multi-year release history, not a recent-only publish), consistent maintainer throughout, real repository at `github.com/zesterer/pollster` (zesterer is an established Rust ecosystem author), no typosquat-style name confusion. **Verdict: OK.** No human checkpoint needed per D-18's pre-approval.
- **D-08 (HKDF domain separation): satisfied vacuously.** This plan introduces zero new HKDF `INFO_*` constants — the previously-planned ephemeral-wrap module was de-scoped per 12-CONTEXT.md's ADDENDUM D-19 before this plan executed.
- **PRF gate (D-06/D-07/D-16/PROV-04):** the authenticator's `HmacSecretConfig::new_without_uv()` is what makes `clientExtensionResults.prf.enabled` report truthy on a create() response that included the `prf` extension — this is passkey-rs's own capability computation, verified by `prf_capable_credential`'s test, never a second/hand-rolled PRF implementation or browser-detection heuristic.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/Assumption correction] `passkey_types::Passkey` has no `Serialize`/`Deserialize` — hand-rolled a JSON mirror DTO**
- **Found during:** Task 1, while implementing `create_provider_credential`
- **Issue:** 12-RESEARCH.md's Architecture Pattern 1 and the plan's Task 1 action text assumed "since `passkey-types` derives `Serialize`/`Deserialize`" (12-RESEARCH.md Assumption A1 explicitly flagged this exact area as unverified from summaries alone). Reading the pinned 0.5.0 source directly (`passkey-types-0.5.0/src/passkey.rs`) confirmed `Passkey` has **no** serde derive at all, and its `key: CoseKey` field (from the `coset` crate) has no serde support of any kind — only `coset::CborSerializable` (CBOR via `ciborium`).
- **Fix:** Added `SerializablePasskey` (in `credential_store.rs`) — a serde-derived DTO mirroring `Passkey`'s public fields 1:1, CBOR-encoding just the `key` field into a `Vec<u8>` (`CoseKey::to_vec()`/`from_slice()` via `coset::CborSerializable`) and JSON-encoding everything else directly. `passkey_to_json`/`passkeys_from_json` convert between `Passkey` and this DTO's JSON form.
- **Files modified:** `crates/pv-provider/src/credential_store.rs` (new module content, documented in its own header comment)
- **Verification:** `create_then_get_roundtrip` proves the JSON mirror round-trips a real `Passkey` (including its ES256 private key) correctly through create → JSON → decrypt-simulated-store → get-assertion
- **Commit:** `e83ba81`

---

**Total deviations:** 1 auto-fixed (Rule 1 — assumption correction, not a bug in written code but a gap in prior research this plan's `<behavior>` contract required adapting around, exactly as the plan's action text anticipated: "verify exact constructor/method names, argument order... adapt exact names/shapes as needed while preserving this task's `<behavior>` contract exactly").
**Impact on plan:** No scope creep — the `<behavior>` contract (three tests' exact assertions) was preserved unchanged; only the internal serialization mechanism differs from the research's (incorrect) assumption.

## Issues Encountered

**Native-test JsValue::Debug abort during Task 2's RED phase.** The first RED-stub design for `wasm_create_provider_credential`/`wasm_get_provider_assertion` (return `Err(to_js_str_err(...))` unconditionally) caused `cargo test -p pv-wasm` to **SIGABRT the entire test process** rather than cleanly fail — `.expect()` on a real `Result::Err(JsValue)` calls `JsValue`'s `Debug` impl to build the panic message, which invokes a wasm-bindgen JS import that panics ("cannot call wasm-bindgen imported functions on non-wasm targets") on native test targets, and a panic-during-panic aborts the process (this codebase's own `to_js_err`/`to_js_str_err` header comment already documents this hazard for `JsValue::from_str`, but I initially missed that the *native* branch's `JsValue::NULL` return value is equally unsafe to `Debug`-format, only safe to construct/drop). **Resolved** by redesigning both RED stubs to return `Ok(...)` with deliberately-wrong-but-valid data instead: the create stub calls the real `core_encrypt_item` on a dummy plaintext (so `decrypt_item` downstream still succeeds normally) and both stubs use different dummy response IDs, so the tests fail via ordinary `assert_eq!`/`.expect()`-on-non-JsValue-type panics — no process abort, both tests report `FAILED` cleanly. This same hazard governs `pv-provider`'s tests too, but that crate's public API never returns `JsValue` (only `PvProviderError`, whose `Display`/`Debug` are ordinary thiserror derives), so Task 1's simpler `Err(...)` stub design was safe as-is.

## User Setup Required

None — no external service configuration required. The three `passkey-rs` crates and `pollster` were installed via `cargo add`/`cargo fetch`, no manual registry/dashboard steps.

## Next Phase Readiness

- `crates/pv-provider` and the two `pv-wasm` bindings are ready for Plan 12-02 (background orchestration: `provider-ceremony.ts`, `credential-store.ts` equivalents wiring `chrome.storage.session` state) to call via `extension/lib/crypto/wasm-loader.ts`'s `wasmCreateProviderCredential`/`wasmGetProviderAssertion` exports.
- `pendingProviderItems` in `chrome.storage.session` (12-02's job) can hold the `encrypted_item_json`/`updated_encrypted_item_json` strings this plan's bindings produce directly — they're already ciphertext under the User Key, no further wrapping needed (D-19).
- No blockers. The `/gsd-secure-phase` gate (D-15) for this phase should specifically grep-audit `crates/pv-wasm/src/lib.rs` for `new_passkey_json` (confirmed local-variable-only in this plan) and confirm `extension/lib/crypto/wasm-loader.ts` remains the sole importer of `./wasm/pv_wasm.js` once 12-02/12-03/12-04 land.

---
*Phase: 12-passkey-provider*
*Completed: 2026-07-16*
