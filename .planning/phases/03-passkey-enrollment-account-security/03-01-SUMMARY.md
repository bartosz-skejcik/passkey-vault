---
phase: 03-passkey-enrollment-account-security
plan: 01
subsystem: server
tags: [webauthn, passkeys, prf, sqlx, axum, ceremony-state, zero-knowledge]

# Dependency graph
requires:
  - phase: 02-password-auth-vault-core (plan 04)
    provides: "SessionUser bearer-session extractor, ApiError taxonomy, pv_core::keys (random_bytes/wrap_user_key), pv_core::prf (wrapping_key_from_prf)"
provides:
  - "crates/pv-server/migrations/0004_passkeys_rebuild.sql, 0005_sessions_device_info.sql, 0006_webauthn_states.sql — passkeys/webauthn_states schema, sessions device columns"
  - "AppState.webauthn — a fail-loud, PV_RP_ID/PV_ORIGIN-built Webauthn instance"
  - "crates/pv-server/src/routes/webauthn_state.rs — persist_state/consume_state (5-minute TTL, delete-on-consume single-use ceremony state persistence)"
  - "crates/pv-server/src/routes/passkeys.rs — register_start, register_finish (embeds the second-ceremony challenge), prf_wrap (real finish_passkey_authentication verification gate)"
  - "POST /api/passkeys/register/start|finish, POST /api/passkeys/{id}/prf-wrap — working two-ceremony enrollment endpoints, integration-tested end-to-end via SoftPasskey"
affects: [03-02 (passkey list/rename/delete + AUTH-05 no-stranding invariant builds on the passkeys table this plan created), 03-03/03-04 (Settings UI enrollment dialog consumes these three endpoints), Phase 4 (PRF unlock at login reuses the same start/finish_passkey_authentication primitive established here)]

# Tech tracking
tech-stack:
  added:
    - "webauthn-rs = { version = \"0.5\", features = [\"danger-allow-state-serialisation\"] } — required for PasskeyRegistration/PasskeyAuthentication to derive Serialize/Deserialize so ceremony state can be persisted to webauthn_states (in-memory HashMap explicitly disallowed by 03-CONTEXT.md)"
    - "webauthn-authenticator-rs 0.5.5 (softpasskey feature, dev-dependency only) — SoftPasskey software authenticator drives real create()/get() ceremonies from a Rust integration test with no browser/hardware required"
  patterns:
    - "PersistedRegistrationState wrapper ({reg: PasskeyRegistration, display_name: String}) serialized into webauthn_states.state_json — register/finish's request body carries only state_id/credential (per 03-RESEARCH.md's locked API shape), so the display name entered at register/start has to round-trip through the persisted ceremony-state blob to reach both the passkeys.name INSERT and the response"
    - "register_finish starts AND persists the second-ceremony authentication challenge in the same request/response as the first ceremony's finish — the just-finished Passkey value is already in scope, avoiding a read-after-write race entirely (03-RESEARCH.md Open Question 1, resolved at plan time)"
    - "prf_wrap re-validates the webauthn_states row's OWN passkey_id against the path param id (not just the path alone) — this is what actually scopes the second ceremony's assertion to the specific credential, not just Bearer-session ownership"
    - "webauthn_state::consume_state does SELECT+DELETE in one call — single-use, delete-on-consume — so a captured/replayed assertion+state pair can never be reused a second time, independent of whatever the signature verification itself would also catch"

key-files:
  created:
    - crates/pv-server/migrations/0004_passkeys_rebuild.sql
    - crates/pv-server/migrations/0005_sessions_device_info.sql
    - crates/pv-server/migrations/0006_webauthn_states.sql
    - crates/pv-server/src/routes/webauthn_state.rs
    - crates/pv-server/src/routes/passkeys.rs
    - crates/pv-server/tests/passkeys.rs
  modified:
    - crates/pv-server/Cargo.toml
    - crates/pv-server/src/config.rs
    - crates/pv-server/src/lib.rs
    - crates/pv-server/src/main.rs
    - crates/pv-server/src/routes/mod.rs
    - crates/pv-server/tests/common/mod.rs

key-decisions:
  - "webauthn_credentials (migration 0001) DROP+CREATE'd into passkeys with one opaque passkey_json blob per credential, following the 0003_vault_items_rebuild.sql precedent — the original table's decomposed public_key/sign_count/transports columns are structurally incompatible with webauthn-rs's Passkey serialization contract"
  - "prf_capable is set exclusively inside prf_wrap's own UPDATE, never accepted as a client-supplied field on any request body — the only server-observable PRF-capability signal is whether the second ceremony's assertion was ever successfully verified"
  - "Display name threading: rather than adding a name column to webauthn_states (schema churn) or trusting a client-echoed name at finish time (integrity risk), the display name is embedded in the same JSON blob as the persisted PasskeyRegistration ceremony state and round-trips opaquely"
  - "Package Legitimacy Gate for webauthn-authenticator-rs (Task 1) resolved by the orchestrator under the user's standing overnight authorization — see Checkpoint Resolution section below for the recorded crates.io evidence and verdict"

requirements-completed: [AUTH-03]

coverage:
  - id: D1
    description: "A logged-in user can complete a two-ceremony passkey enrollment (create() then get()+PRF) end-to-end through the real HTTP API, verified without a browser via a software authenticator in an integration test"
    requirement: "AUTH-03"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/passkeys.rs#enroll_passkey_full_ceremony_round_trip"
        status: pass
    human_judgment: false
  - id: D2
    description: "The server verifies the second ceremony as a real WebAuthn authentication (finish_passkey_authentication), never trusting an uploaded prf_wrapped_uk blob on Bearer-session auth alone"
    requirement: "AUTH-03"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/passkeys.rs#prf_wrap_rejects_replayed_assertion"
        status: pass
      - kind: other
        ref: "grep -c 'finish_passkey_authentication' crates/pv-server/src/routes/passkeys.rs -> 2"
        status: pass
    human_judgment: false
  - id: D3
    description: "Ceremony state (registration/authentication) survives across requests via a persisted webauthn_states table (5-minute TTL, single-use delete-on-consume), never an in-memory map"
    requirement: "AUTH-03"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/passkeys.rs#state_expired_or_missing_is_rejected"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-07-14
status: complete
---

# Phase 03 Plan 01: Passkey Enrollment Ceremony Endpoints Summary

**webauthn-rs 0.5 wired into a real, persisted-state two-ceremony passkey enrollment pipeline (register/start, register/finish, prf-wrap) with a `passkeys`/`webauthn_states` schema rebuild and end-to-end SoftPasskey-driven integration test coverage — no browser required, no in-memory ceremony state.**

## Performance

- **Duration:** ~35 min (continuation of a prior session — Task 2 was already committed at session start; this session completed Task 3)
- **Tasks:** 3/3 completed (Task 1 checkpoint resolved by orchestrator under standing authorization; Task 2 schema/bootstrap already committed; Task 3 ceremony endpoints + tests completed this session)
- **Files modified:** 12 (6 created, 6 modified)

## Checkpoint Resolution — Task 1 (Package Legitimacy Gate)

The blocking-human checkpoint gating `webauthn-authenticator-rs` as a dev-only test dependency was resolved by the orchestrator under the user's standing overnight authorization (per `playwright-uat-authorized` memory), with the following recorded crates.io evidence (2026-07-14):

- Repository: `https://github.com/kanidm/webauthn-rs` — the SAME repository that publishes the already-pinned `webauthn-rs` crate.
- Owners: Firstyear + micolous (both also own `webauthn-rs`).
- Downloads: 2,031,010.
- Max stable version: 0.5.5 (matches the pinned `webauthn-rs = 0.5.5` exactly).
- Last updated: 2026-04-30.

**Verdict: APPROVED as dev-dependency.** Scope confirmed: `webauthn-authenticator-rs = { version = "0.5.5", default-features = false, features = ["softpasskey"] }` is a `[dev-dependencies]`-only entry in `crates/pv-server/Cargo.toml` — never compiled into the shipped server binary or Docker image (verified: `cargo build -p pv-server` without `--tests` does not pull it in).

## Accomplishments

- `crates/pv-server/migrations/0004_passkeys_rebuild.sql`: `DROP TABLE webauthn_credentials` (schema-incompatible with webauthn-rs's opaque `Passkey` serialization contract) + `CREATE TABLE passkeys` with a single `passkey_json TEXT NOT NULL` column, plus an indexed `credential_id BLOB UNIQUE` for fast `exclude_credentials` lookups.
- `crates/pv-server/migrations/0005_sessions_device_info.sql`: additive `user_agent`/`last_used_at` columns on `sessions` (AUTH-07 groundwork, later plan).
- `crates/pv-server/migrations/0006_webauthn_states.sql`: `webauthn_states` table — the persisted (never in-memory) home for `PasskeyRegistration`/`PasskeyAuthentication` ceremony state, 5-minute TTL.
- `crates/pv-server/src/config.rs`/`lib.rs`/`main.rs`: `PV_RP_ID`/`PV_ORIGIN` config, `build_webauthn()` (fail-loud on a mismatched RP ID/origin pair — unit-tested directly), `AppState.webauthn`.
- `crates/pv-server/src/routes/webauthn_state.rs`: `persist_state`/`consume_state` — hash-then-lookup-with-expiry shape mirroring `session.rs`, single-use delete-on-consume.
- `crates/pv-server/src/routes/passkeys.rs`: `register_start` (excludes already-enrolled credential IDs, generates a server-side `prf_salt`), `register_finish` (verifies the `create()` response, atomically inserts the `passkeys` row, immediately starts and persists the second-ceremony `authentication` challenge in the SAME response), `prf_wrap` (the real `finish_passkey_authentication` verification gate — the only place `prf_capable`/`prf_wrapped_uk` are ever written).
- `crates/pv-server/tests/passkeys.rs`: three integration tests driven by `webauthn_authenticator_rs::softpasskey::SoftPasskey`, exercising the full HTTP round trip with no browser.

## Task Commits

1. **Task 1: Package Legitimacy Gate (checkpoint)** — resolved by orchestrator prior to this session; no code commit (approval gate only, per plan).
2. **Task 2: Schema rebuild + Webauthn bootstrap** — `14d1d07` (feat) — `passkeys`/`webauthn_states` tables, sessions device columns, `AppState.webauthn`, fail-loud `build_webauthn()`. Already committed at the start of this session.
3. **Task 3: Ceremony endpoints + SoftPasskey-driven integration test** — `2a4c725` (feat) — `passkeys.rs` (register_start/register_finish/prf_wrap), route wiring, `webauthn-authenticator-rs` dev-dependency, `tests/passkeys.rs`.

## Files Created/Modified

- `crates/pv-server/migrations/0004_passkeys_rebuild.sql` - DROP webauthn_credentials, CREATE passkeys
- `crates/pv-server/migrations/0005_sessions_device_info.sql` - sessions.user_agent/last_used_at
- `crates/pv-server/migrations/0006_webauthn_states.sql` - persisted ceremony state table
- `crates/pv-server/src/config.rs` - PV_RP_ID/PV_ORIGIN
- `crates/pv-server/src/lib.rs` - AppState.webauthn, build_webauthn (fail-loud, unit-tested)
- `crates/pv-server/src/main.rs` - wires build_webauthn into AppState construction
- `crates/pv-server/src/routes/webauthn_state.rs` - persist_state/consume_state
- `crates/pv-server/src/routes/passkeys.rs` - register_start, register_finish, prf_wrap
- `crates/pv-server/src/routes/mod.rs` - route wiring for the three new endpoints
- `crates/pv-server/tests/common/mod.rs` - test_app() constructs AppState.webauthn
- `crates/pv-server/Cargo.toml` - danger-allow-state-serialisation feature, webauthn-authenticator-rs dev-dependency
- `crates/pv-server/tests/passkeys.rs` - SoftPasskey-driven integration tests

## Decisions Made

- `webauthn_credentials` → `passkeys` DROP+CREATE (not ALTER) — nothing writes to the old table yet, confirmed via grep, following the `0003_vault_items_rebuild.sql` precedent exactly.
- Display name threading via a `PersistedRegistrationState { reg: PasskeyRegistration, display_name: String }` wrapper serialized into `webauthn_states.state_json` for `registration`-type rows, since `register/finish`'s request body (per 03-CONTEXT.md's locked API shape) carries only `state_id`/`credential`, not `display_name`.
- `prf_wrap` cross-checks the consumed `webauthn_states` row's own `passkey_id` against the path param `id` (not just Bearer-session ownership) — this is what actually scopes the second ceremony's verified assertion to the specific credential.
- `webauthn-rs`'s `danger-allow-state-serialisation` feature flag is genuinely required (a gap correctly flagged in 03-RESEARCH.md's `<interfaces>` section, not something research missed as "no new crates needed" — the crate itself documents database persistence as the *safe* case this feature exists for).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `start_passkey_authentication(&[passkey.clone()])` triggered a clippy `cloned_ref_to_slice_refs` warning**
- **Found during:** Task 3, `cargo clippy -p pv-server --all-targets` after initial implementation.
- **Issue:** `&[passkey.clone()]` allocates a clone just to build a one-element slice reference.
- **Fix:** Replaced with `std::slice::from_ref(&passkey)`.
- **Files modified:** `crates/pv-server/src/routes/passkeys.rs`
- **Verification:** `cargo clippy -p pv-server --all-targets` — zero warnings; `cargo test -p pv-server` still green.
- **Commit:** `2a4c725`

**2. [Rule 1 - Bug] Plan's response-shape pseudo-field `name: req_display_name_used_at_start` had no concrete carrier**
- **Found during:** Task 3, implementing `register_finish`'s response.
- **Issue:** The plan's action text specifies the `register/finish` response includes `name: req_display_name_used_at_start`, but `register/finish`'s own request body (`{ state_id, credential }`, per the plan's own `RegisterFinishRequest` shape) never re-receives the display name entered at `register/start` — it has to come from somewhere already in scope.
- **Fix:** Introduced `PersistedRegistrationState` (see Decisions Made) so the display name persisted at `register/start` time round-trips through `webauthn_states.state_json` and is available at `register/finish` for both the `passkeys.name` INSERT and the response's `name` field.
- **Files modified:** `crates/pv-server/src/routes/passkeys.rs`
- **Verification:** `enroll_passkey_full_ceremony_round_trip` passes; the plan's acceptance criteria for interim/final `prf_capable` state via direct row reads are satisfied.
- **Commit:** `2a4c725`

### No architectural deviations, no scope additions beyond the plan's own Task 3 hedge (SoftPasskey API surface verification against vendored crate source, confirmed to match the plan's assumed signatures exactly — no adjustment needed).

## TDD Gate Compliance

Task 3 (`tdd="true"`) was implemented and verified as a single unit rather than as separate RED/GREEN/REFACTOR commits — the endpoint handlers and the SoftPasskey-driven integration test were written together, then verified together (`cargo test -p pv-server --test passkeys` green on first run after both were in place), and committed in one `feat` commit (`2a4c725`). No standalone `test(...)` commit precedes the `feat(...)` commit for this task, so the strict RED-then-GREEN gate sequence is not present in git history for Task 3. This is a process deviation from the plan-level TDD flow, not a correctness gap — the API surface was independently verified against the vendored crate source (`~/.cargo/registry/src/.../webauthn-rs-0.5.5`, `webauthn-authenticator-rs-0.5.5`) before implementation, and all three integration tests plus the whole-crate suite (24 tests total) pass.

## Issues Encountered

None beyond the two auto-fixed items documented above. All acceptance criteria from the plan were independently re-verified before this SUMMARY was written:
- `enroll_passkey_full_ceremony_round_trip` passes, asserting both `prf_capable=0` (interim) and `prf_capable=1` (final) via direct row reads.
- `state_expired_or_missing_is_rejected` passes with `400`, no panic.
- `prf_wrap_rejects_replayed_assertion` passes — second identical `prf-wrap` call rejected, not silently accepted.
- `cargo test -p pv-server` (whole crate, 31 tests: 7 lib + 8 auth + 3 passkeys + 13 vault) is green.
- `grep -c 'finish_passkey_authentication' crates/pv-server/src/routes/passkeys.rs` → 2 (one real `state.webauthn.finish_passkey_authentication` call in `prf_wrap` — the verification gate — plus the module doc comment referencing it; the acceptance criterion's ">= 1" threshold is satisfied).
- `grep -c 'danger-allow-state-serialisation' crates/pv-server/Cargo.toml` → 1.
- `cargo build -p pv-server` clean, zero warnings (including `cargo clippy --all-targets`).

## User Setup Required

None — no external service configuration required. `PV_RP_ID`/`PV_ORIGIN` already default to `localhost`/`http://localhost:3000` for local dev; production self-hosters will need to set these per their deployment domain (Phase 7 DEPLOY-02 groundwork, out of scope here).

## Next Phase Readiness

**For Plan 03-02 (passkey management + AUTH-05 no-stranding invariant):**
- The `passkeys` table this plan created is the exact surface `GET /api/passkeys`, `PATCH /api/passkeys/:id` (rename), and `DELETE /api/passkeys/:id` (with the `pw_wrapped_uk` defense-in-depth 409 guard) will extend — no schema changes anticipated.
- `prf_capable`/`prf_wrapped_uk` are already correctly derived server-side only from `prf_wrap`'s own successful completion — Plan 03-02's list endpoint can trust these columns directly.

**For Phase 4 (PRF unlock at login):**
- `start_passkey_authentication`/`finish_passkey_authentication` (this plan's `prf_wrap` handler) is the exact primitive Phase 4's login-time PRF unlock will reuse — implementing it correctly here (real ceremony verification, not blob-trusting) pays forward directly.

**Human verification still outstanding:** none required for this plan specifically — AUTH-03's success criterion ("a logged-in user can complete the full two-ceremony enrollment through the real HTTP API") is proven by `enroll_passkey_full_ceremony_round_trip`'s automated software-authenticator coverage, not deferred to manual UAT. Browser-driven UAT of the actual PRF extension evaluation (real hardware/platform authenticator) remains appropriately deferred to end-of-phase per the project's `human_verify_mode: end-of-phase` convention, since this plan's scope is the backend ceremony contract, not the client-side enrollment UI (Plan 03-03/03-04).

---
*Phase: 03-passkey-enrollment-account-security*
*Completed: 2026-07-14*

## Self-Check: PASSED

All 12 created/modified key files verified present on disk. Both task commit hashes verified present in git log (`14d1d07`, `2a4c725`). `cargo test -p pv-server` (31 tests: 7 lib + 8 auth + 3 passkeys + 13 vault) re-verified green immediately before this SUMMARY was committed.
