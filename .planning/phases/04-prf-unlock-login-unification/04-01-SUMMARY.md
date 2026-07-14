---
phase: 04-prf-unlock-login-unification
plan: 01
subsystem: auth
tags: [webauthn, passkeys, prf, axum, sqlx, webauthn-rs]

# Dependency graph
requires:
  - phase: 03-passkey-enrollment-account-security
    provides: "consume_state/persist_state, SessionUser extractor, prf_wrap's finish_passkey_authentication ceremony-verification pattern, webauthn_states table"
provides:
  - "Unauthenticated passkey-login ceremony pair (auth::passkey_login_start/finish) — any enrolled passkey logs in; prf_wrapped_uk returned inline when the matched credential is prf_capable"
  - "SessionUser-gated unlock ceremony pair (passkeys::unlock_start/unlock_finish) — prf_capable-only credential set, structurally cannot create a sessions row"
  - "webauthn_state::consume_state_any_user — lets an unauthenticated finish handler learn its own user_id from the persisted state row"
  - "AppState.rp_id plumbing for the enumeration-resistant dummy response's rpId field"
affects: [04-02, phase-4-frontend, unlock-flow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Enumeration-resistant unauthenticated ceremony start: unknown email and known-email-zero-passkeys share one dummy-response branch, comparable work (random challenge, deterministic per-email dummy credential id) with no persisted webauthn_states row"
    - "Ceremony-finish enumeration parity: passkey_login_finish maps BOTH not-found-state and real-crypto-verification-failure to the identical ApiError::BadRequest message string, closing an oracle the plan's literal per-branch message choice would have left open"
    - "Multi-credential PRF salt map keyed by URL_SAFE_NO_PAD-encoded credential id (matches webauthn-rs's own Base64UrlSafeData wire encoding), valued by STANDARD-encoded salt"
    - "Structurally session-less response DTO (UnlockFinishResponse has no session_token field) as the no-redundant-session-row guarantee, not just a runtime choice"

key-files:
  created:
    - crates/pv-server/tests/passkey_login.rs
    - crates/pv-server/tests/unlock.rs
  modified:
    - crates/pv-server/src/lib.rs
    - crates/pv-server/src/main.rs
    - crates/pv-server/src/routes/webauthn_state.rs
    - crates/pv-server/src/routes/auth.rs
    - crates/pv-server/src/routes/passkeys.rs
    - crates/pv-server/src/routes/mod.rs
    - crates/pv-server/tests/common/mod.rs

key-decisions:
  - "AppState.rp_id carried as a plain field (not derived from Webauthn at request time) — webauthn_rs::prelude::Webauthn exposes no public rp_id getter, and the dummy enumeration-resistance path never calls start_passkey_authentication so has no other source of truth for rpId"
  - "passkey_login_finish unifies its not-found-state and crypto-verification-failure error messages to the same ApiError::BadRequest string — deviates from the plan's own <behavior> text (which specified 'passkey ceremony failed' for the crypto-failure branch) because using two different messages would let an attacker distinguish a known account (real, fresh state_id) from an unknown one (dummy, never-persisted state_id) purely by diffing finish()'s error text with a garbage credential, without ever needing a real credential — closing exactly the oracle 04-RESEARCH.md's own Pitfall #1/Pattern 4 warns against"
  - "unlock_start queries only prf_capable=1 passkeys (vs. passkey_login_start's all-enrolled-passkeys set) — unlocking with a non-PRF credential can only ever return null, a pointless physical gesture; zero eligible rows is a 404 so the client never calls navigator.credentials.get() with an empty allowCredentials list"

patterns-established:
  - "Pattern: two ceremony pairs, same webauthn-rs primitive pair (start_passkey_authentication/finish_passkey_authentication), different trust boundary and different Vec<Passkey> selection query"
  - "Pattern: consume_state_any_user as the READ-only sibling of consume_state for the one call site with no SessionUser yet — same atomic DELETE...RETURNING shape, user_id learned from the row instead of supplied by the caller"

requirements-completed: [AUTH-04, AUTH-09]

coverage:
  - id: D1
    description: "Unauthenticated passkey-login: any enrolled passkey (PRF-capable or not) both creates a session and, for a PRF-capable credential, returns prf_wrapped_uk inline in the same response"
    requirement: AUTH-04
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/passkey_login.rs#passkey_login_full_ceremony_with_prf_creates_session_and_returns_wrap"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/passkey_login.rs#passkey_login_without_prf_credential_returns_null_wrap"
        status: pass
    human_judgment: false
  - id: D2
    description: "passkey-login/start is response-indistinguishable for unknown email vs. known-email-zero-passkeys vs. a real account (top-level publicKey key-set parity)"
    requirement: AUTH-04
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/passkey_login.rs#passkey_login_start_shape_parity_unknown_vs_zero_passkey_email"
        status: pass
    human_judgment: false
  - id: D3
    description: "passkey-login/finish maps a dummy (never-persisted) state_id and a real-state-wrong-credential failure to the identical HTTP status and error message"
    requirement: AUTH-04
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/passkey_login.rs#passkey_login_finish_dummy_state_id_and_real_ceremony_failure_same_shape"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/passkey_login.rs#passkey_login_finish_resolves_user_id_from_state_row"
        status: pass
    human_judgment: false
  - id: D4
    description: "prf_salts map keys byte-equal allowCredentials[i].id (URL_SAFE_NO_PAD encoding regression check)"
    requirement: AUTH-09
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/passkey_login.rs#prf_salt_keys_match_credential_id_encoding"
        status: pass
    human_judgment: false
  - id: D5
    description: "SessionUser-gated unlock ceremony round-trips prf_wrapped_uk and structurally cannot create a new sessions row"
    requirement: AUTH-04
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/unlock.rs#unlock_full_ceremony_round_trip"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/unlock.rs#unlock_finish_creates_no_session_row"
        status: pass
    human_judgment: false
  - id: D6
    description: "unlock/start 404s with zero PRF-capable passkeys (no webauthn_states row created); cross-user state_id is rejected"
    requirement: AUTH-04
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/unlock.rs#unlock_start_returns_404_when_zero_prf_capable_passkeys"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/unlock.rs#unlock_ownership_rejects_cross_user_state"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-07-14
status: complete
---

# Phase 4 Plan 1: Unauthenticated Passkey-Login & Session-Gated Unlock Ceremonies Summary

**Four new WebAuthn authentication endpoints (`passkey-login/start|finish`, `unlock/start|finish`) that both call the real `finish_passkey_authentication` verification gate — one issues a session for any enrolled passkey, the other structurally cannot issue a session and only offers PRF-capable credentials.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-14T09:06:33Z
- **Tasks:** 2
- **Files modified:** 6 modified, 2 created (test files)

## Accomplishments
- `auth::passkey_login_start`/`passkey_login_finish` — unauthenticated ceremony pair mirroring `login()`'s session-issuance shape; every enrolled passkey (PRF-capable or not) can complete a login, and `prf_wrapped_uk` comes back inline (no second round trip) when the matched credential is PRF-capable
- `passkeys::unlock_start`/`unlock_finish` — `SessionUser`-gated ceremony pair that offers only `prf_capable = 1` credentials and structurally cannot create a `sessions` row (`UnlockFinishResponse` has no `session_token` field at all)
- `webauthn_state::consume_state_any_user` — the one new plumbing piece Phase 3's `consume_state` couldn't support: lets the unauthenticated `passkey_login_finish` learn its own `user_id` from the persisted state row
- `AppState.rp_id` plumbing so the enumeration-resistant dummy response can byte-match the real path's `rpId` field
- Enumeration resistance proven by dedicated regression tests, not manual review: unknown-email/zero-passkey-email response shape parity at `start`, and unified error message/status at `finish` for a dummy vs. real-but-wrong-credential state
- `prf_salts` map key encoding (`URL_SAFE_NO_PAD`) proven correct against a real `allowCredentials[i].id` via a byte-equality regression test

## Task Commits

Each task was committed atomically:

1. **Task 1: Unauthenticated passkey-login ceremony (auth.rs) + consume_state_any_user + AppState.rp_id plumbing** - `0b91842` (feat)
2. **Task 2: SessionUser-gated unlock ceremony (passkeys.rs) — no redundant session row** - `f295c37` (feat)

**Plan metadata:** (this commit) - `docs(04-01): complete plan`

## Files Created/Modified
- `crates/pv-server/src/lib.rs` - `AppState.rp_id` field
- `crates/pv-server/src/main.rs` - threads `cfg.rp_id.clone()` into `AppState`
- `crates/pv-server/src/routes/webauthn_state.rs` - `consume_state_any_user`
- `crates/pv-server/src/routes/auth.rs` - `passkey_login_start`/`passkey_login_finish` + dummy-response builder
- `crates/pv-server/src/routes/passkeys.rs` - `unlock_start`/`unlock_finish`
- `crates/pv-server/src/routes/mod.rs` - 4 new route registrations
- `crates/pv-server/tests/common/mod.rs` - `test_app` sets `rp_id: "localhost"`
- `crates/pv-server/tests/passkey_login.rs` - 6 integration tests (new)
- `crates/pv-server/tests/unlock.rs` - 4 integration tests (new)

## Decisions Made
- `AppState.rp_id` is a plain carried field, not derived from `Webauthn` at request time — no public getter exists on the vendored `Webauthn` struct, and the dummy-response path never calls `start_passkey_authentication` (its only other source of a real `rpId`).
- `passkey_login_finish` unifies its not-found-state and crypto-verification-failure error messages (see Deviations below) — a security-motivated deviation from the plan's literal per-branch message text.
- `unlock_start` queries only `prf_capable = 1` rows (a narrower set than `passkey_login_start`'s all-enrolled-passkeys query) — a non-PRF credential can only ever return `null` from unlock, so offering it would be a pointless physical gesture; zero eligible rows short-circuits to 404 before ever calling `navigator.credentials.get()`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Unified `passkey_login_finish`'s not-found and crypto-verification-failure error messages**
- **Found during:** Task 1, writing `passkey_login_finish_dummy_state_id_and_real_ceremony_failure_same_shape`
- **Issue:** The plan's `<behavior>` text specified mapping `finish_passkey_authentication` failures to `ApiError::BadRequest("passkey ceremony failed")`, distinct from `consume_state_any_user`'s not-found message `"passkey ceremony expired or not found"`. Following that literally, a dummy (never-persisted) `state_id` and a REAL, freshly-persisted `state_id` paired with a wrong credential produced two *different* error messages — letting an attacker distinguish "this email has enrolled passkeys" from "this email doesn't" simply by diffing `finish()`'s response text with a garbage credential, with no need for a real credential at all. This directly contradicts 04-RESEARCH.md's own Pitfall #1/Architecture Pattern 4 requirement that "finish must map a not-found state_id (dummy path) and a real cryptographic-verification failure (real path) to the exact same `ApiError::BadRequest` variant and message string" — the plan's literal per-branch string choice was internally inconsistent with its own security analysis.
- **Fix:** Both the crypto-verification-failure branch and the passkeys-row-not-found branch in `passkey_login_finish` now return the SAME message (`"passkey ceremony expired or not found"`, shared with `consume_state_any_user`'s not-found branch) via a local `ENUMERATION_SAFE_FINISH_ERROR` constant. `unlock_finish` (SessionUser-gated, no enumeration surface) keeps the original `"passkey ceremony failed"` text, consistent with `register_finish`/`prf_wrap`.
- **Files modified:** `crates/pv-server/src/routes/auth.rs`
- **Verification:** `passkey_login_finish_dummy_state_id_and_real_ceremony_failure_same_shape` asserts identical status AND error string across both failure modes.
- **Committed in:** `0b91842` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix, security-motivated)
**Impact on plan:** Necessary correction to close an enumeration oracle the plan's own research explicitly flagged as required to close; no scope creep — same endpoints, same tests, only the error-message value changed for one endpoint.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both new endpoint pairs are live, routed, and covered by SoftPasskey-driven integration tests — no browser/hardware required.
- `passkey_login_finish` creates a session; `unlock_finish` structurally cannot (no `session_token` field on its response DTO).
- Ready for 04-02 (client orchestration): `web/src/lib/passkeys/login.ts` can call `passkey-login/start|finish` and `unlock/start|finish` directly — no further backend plumbing needed for the one-gesture login+unlock flow.

---
*Phase: 04-prf-unlock-login-unification*
*Completed: 2026-07-14*
